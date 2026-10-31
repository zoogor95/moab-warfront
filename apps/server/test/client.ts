import { io as connect, type Socket } from 'socket.io-client';
import type { Action } from '@warfront/shared';
import type {
  ActionResultMsg,
  AuthResponse,
  ChatMessage,
  ClientToServerEvents,
  Lobby,
  MatchUpdateMsg,
  ServerToClientEvents,
} from '@warfront/shared/protocol';
import { migrate } from '../src/migrate';
import { startServer, type RunningServer } from '../src/server';
import { freshSchema, SECRET } from './db';

/** A server on a random port with its own fresh schema, migrated, with the clock worker off. */
export async function testServer() {
  const db = await freshSchema();
  await migrate(db.pool);
  let server = await startServer({ port: 0, clientOrigins: ['http://app.test'], authSecret: SECRET }, db.pool, { jobIntervalMs: null });
  return {
    db,
    get server(): RunningServer {
      return server;
    },
    get base() {
      return `http://localhost:${server.port}`;
    },
    /** Stops the server and starts a new one on the same port and database: everything in memory is gone. */
    async restart() {
      const port = server.port;
      await server.close();
      server = await startServer({ port, clientOrigins: [], authSecret: SECRET }, db.pool, { jobIntervalMs: null });
    },
    async stop() {
      await server.close();
      await db.drop();
    },
  };
}
export type TestServer = Awaited<ReturnType<typeof testServer>>;

let ids = 0;

/** One person: a guest account, REST calls with its token, and a socket that records what it receives. */
export class Player {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  lobby: Lobby | null = null;
  update: MatchUpdateMsg | null = null;
  updates: MatchUpdateMsg[] = [];
  chat: ChatMessage[] = [];
  private waiters: Array<() => void> = [];

  private constructor(
    private t: TestServer,
    readonly auth: AuthResponse,
  ) {}

  static async guest(t: TestServer, name: string): Promise<Player> {
    const res = await fetch(`${t.base}/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: name }),
    });
    if (res.status !== 201) throw new Error(`guest sign-in failed: ${res.status} ${await res.text()}`);
    return new Player(t, (await res.json()) as AuthResponse);
  }

  get id() {
    return this.auth.user.id;
  }

  async req<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.t.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.auth.accessToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  /** Like req, but throws unless the status is 2xx. */
  async ok<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req<T>(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  /** Connects and keeps the given matches subscribed, including after a reconnect. */
  async connect(...matchIds: string[]): Promise<void> {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connect(this.t.base, {
      auth: (cb) => cb({ token: this.auth.accessToken }),
      transports: ['websocket'],
      reconnectionDelay: 50,
      reconnectionDelayMax: 200,
      forceNew: true,
    });
    this.socket = socket;
    const changed = () => {
      const w = this.waiters;
      this.waiters = [];
      w.forEach((f) => f());
    };
    socket.on('lobby:updated', (l) => ((this.lobby = l), changed()));
    socket.on('match:events', (u) => {
      this.update = u;
      this.updates.push(u);
      changed();
    });
    socket.on('chat:message', (m) => (this.chat.push(m), changed()));
    socket.on('connect', () => {
      for (const id of matchIds) socket.emit('match:subscribe', { matchId: id, lastRev: this.update?.view.rev ?? 0 }, () => {});
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
  }

  /** Resolves once `pred` holds, re-checking on every message received. */
  async waitFor(pred: () => boolean, what = 'condition', ms = 10_000): Promise<void> {
    const until = Date.now() + ms;
    while (!pred()) {
      const left = until - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${what}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => (clearTimeout(t), resolve()));
      });
    }
  }

  submit(matchId: string, action: Action, expectedRev = this.update?.view.rev ?? 0, clientActionId = `a${++ids}`): Promise<ActionResultMsg & { error?: string }> {
    return new Promise((resolve) => this.socket!.emit('action:submit', { matchId, clientActionId, expectedRev, action }, (r) => resolve(r as never)));
  }

  say(matchId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => this.socket!.emit('chat:message', { matchId, text }, (r) => resolve(r as never)));
  }

  close() {
    this.socket?.close();
  }
}
