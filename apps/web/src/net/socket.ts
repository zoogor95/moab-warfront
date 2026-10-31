import { io, type Socket } from 'socket.io-client';
import type { Action, ActionResultMsg, ClientToServerEvents, ServerToClientEvents } from '@warfront/shared';
import { freshToken, refreshSession, SERVER_URL } from './api';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;
let ids = 0;

/** The one connection this page keeps. It reconnects by itself and asks for a fresh token each time. */
export function gameSocket(): GameSocket {
  if (socket) return socket;
  const s: GameSocket = io(SERVER_URL, {
    autoConnect: false,
    transports: ['websocket'],
    auth: (cb) => void freshToken().then((token) => cb({ token })),
  });
  s.on('connect_error', (err) => {
    // The server refused the token: refresh it and try again; any other error retries on its own.
    if (err.message === 'unauthorized') void refreshSession().then((next) => next && s.connect());
  });
  socket = s;
  s.connect();
  return s;
}

export function closeSocket(): void {
  socket?.close();
  socket = null;
}

export type SubmitReply = ActionResultMsg | { ok: false; error: string; message: string; rev?: number };

/** Sends one action and waits for the server's answer (or gives up after 15 s). */
export function submitAction(matchId: string, action: Action, expectedRev: number): Promise<SubmitReply> {
  const s = gameSocket();
  const clientActionId = `${Date.now().toString(36)}-${++ids}`;
  return new Promise((resolve) => {
    s.timeout(15_000).emit('action:submit', { matchId, clientActionId, expectedRev, action }, (err: Error | null, reply?: SubmitReply) => {
      resolve(err || !reply ? { ok: false, error: 'offline', message: 'The server did not answer. Check your connection.' } : reply);
    });
  });
}
