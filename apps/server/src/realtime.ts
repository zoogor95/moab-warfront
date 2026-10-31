import type { Server as IoServer, Socket } from 'socket.io';
import {
  chatSendMsg,
  RuleError,
  submitMsg,
  subscribeMsg,
  viewFor,
  type ChatMessage,
  type ClientToServerEvents,
  type LoggedEvent,
  type MatchUpdateMsg,
  type ServerToClientEvents,
} from '@warfront/shared';
import { verifyAccess } from './auth';
import type { Pool } from './db';
import { HttpError } from './errors';
import { RateLimiter } from './limits';
import { readLobby } from './lobby';
import { standingsOf, type LiveMatch, type MatchService, type Notifier } from './matches';

interface SocketData {
  userId: string;
}

export type Io = IoServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const room = (matchId: string) => `m:${matchId}`;
const CHAT_HISTORY = 50;

/** Pushes match changes to the sockets watching each match, each seat getting only its own view. */
export class SocketNotifier implements Notifier {
  constructor(private io: Io) {}

  lobby(lobby: Parameters<Notifier['lobby']>[0]): void {
    this.io.to(room(lobby.id)).emit('lobby:updated', lobby);
  }

  update(live: LiveMatch, events: LoggedEvent[]): void {
    const snapshot = { state: live.state, deadline: live.deadline?.toISOString() ?? null };
    void this.eachSeat(live, (sock, seat) => sock.emit('match:events', updateFor(live.id, snapshot.state, seat, events, snapshot.deadline)));
  }

  turnChanged(live: LiveMatch): void {
    this.io.to(room(live.id)).emit('turn:changed', {
      matchId: live.id,
      round: live.state.round,
      activeSeat: live.state.activeSeat,
      deadline: live.deadline?.toISOString() ?? null,
    });
  }

  pickUpdated(live: LiveMatch): void {
    // Who has picked, never where.
    this.io.to(room(live.id)).emit('pick:updated', {
      matchId: live.id,
      picked: Object.keys(live.state.picks).map(Number),
      deadline: live.deadline?.toISOString() ?? null,
    });
  }

  private async eachSeat(live: LiveMatch, send: (sock: Awaited<ReturnType<Io['fetchSockets']>>[number], seat: number) => void) {
    for (const sock of await this.io.in(room(live.id)).fetchSockets()) {
      const seat = live.seatOf.get(sock.data.userId);
      if (seat !== undefined) send(sock, seat);
    }
  }
}

export function updateFor(matchId: string, state: LiveMatch['state'], seat: number, events: LoggedEvent[], deadline: string | null): MatchUpdateMsg {
  return {
    matchId,
    view: viewFor(state, seat),
    events: events.filter((e) => e.seenBy.includes(seat)),
    deadline,
    ...(state.phase === 'finished' ? { standings: standingsOf(state) } : {}),
  };
}

function refusal(err: unknown): { ok: false; error: string; message: string } {
  if (err instanceof HttpError) return { ok: false, error: err.code, message: err.message };
  if (err instanceof RuleError) return { ok: false, error: err.code, message: err.message };
  if (err && typeof err === 'object' && 'issues' in err) return { ok: false, error: 'bad-request', message: 'That message was not understood' };
  console.error('Socket handler failed:', err);
  return { ok: false, error: 'server-error', message: 'Something went wrong on the server' };
}

export function attachRealtime(io: Io, pool: Pool, matches: MatchService, secret: string): void {
  const actionLimit = new RateLimiter(40, 20);
  const chatLimit = new RateLimiter(5, 0.5);
  const chats = new Map<string, ChatMessage[]>();

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const userId = verifyAccess(secret, typeof token === 'string' ? token : undefined);
    if (!userId) return next(new Error('unauthorized'));
    socket.data.userId = userId;
    next();
  });

  /** The caller's seat in a match of any status, from the database. */
  async function seatOf(matchId: string, userId: string): Promise<number> {
    const { rows } = await pool.query<{ seat: number }>('SELECT seat FROM seats WHERE match_id = $1 AND user_id = $2', [matchId, userId]);
    if (!rows.length) throw new HttpError(403, 'forbidden', 'You are not in this match');
    return rows[0].seat;
  }

  io.on('connection', (socket: Sock) => {
    const userId = socket.data.userId;

    socket.on('match:subscribe', async (raw, ack) => {
      try {
        const { matchId } = subscribeMsg.parse(raw);
        await seatOf(matchId, userId);
        await socket.join(room(matchId));
        const lobby = await readLobby(pool, matchId);
        socket.emit('lobby:updated', lobby);
        if (lobby.status !== 'lobby') {
          const { live, seat } = await matches.seatIn(matchId, userId);
          socket.emit('match:events', updateFor(matchId, live.state, seat, [], live.deadline?.toISOString() ?? null));
        }
        socket.emit('chat:history', { matchId, messages: chats.get(matchId) ?? [] });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(refusal(err) as never);
      }
    });

    socket.on('match:unsubscribe', (raw) => {
      if (typeof raw?.matchId === 'string') void socket.leave(room(raw.matchId));
    });

    socket.on('action:submit', async (raw, ack) => {
      const clientActionId = typeof raw?.clientActionId === 'string' ? raw.clientActionId : undefined;
      try {
        if (!actionLimit.take(userId)) return ack?.({ ok: false, error: 'rate-limited', message: 'Slow down a little', clientActionId });
        const { matchId, ...msg } = submitMsg.parse(raw);
        ack?.(await matches.submit(matchId, userId, msg));
      } catch (err) {
        ack?.({ ...refusal(err), clientActionId } as never);
      }
    });

    socket.on('chat:message', async (raw, ack) => {
      try {
        if (!chatLimit.take(userId)) return ack?.({ ok: false, error: 'rate-limited', message: 'Slow down a little' });
        const { matchId, text } = chatSendMsg.parse(raw);
        const seat = await seatOf(matchId, userId);
        const name = (await pool.query<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [userId])).rows[0]?.display_name ?? 'Player';
        const msg: ChatMessage = { matchId, seat, name, text, at: new Date().toISOString() };
        const list = chats.get(matchId) ?? [];
        list.push(msg);
        chats.set(matchId, list.slice(-CHAT_HISTORY));
        io.to(room(matchId)).emit('chat:message', msg);
        ack?.({ ok: true });
      } catch (err) {
        ack?.(refusal(err) as never);
      }
    });
  });
}
