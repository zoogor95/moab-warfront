import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, Lobby, MatchUpdateMsg } from '@warfront/shared/protocol';
import { gameSocket } from '../net/socket';

export interface MatchChannel {
  lobby: Lobby | null;
  update: MatchUpdateMsg | null;
  chat: ChatMessage[];
  connected: boolean;
  error: string | null;
  setLobby: (l: Lobby) => void;
  say: (text: string) => Promise<string | null>;
}

/**
 * Follows one match over the socket: its lobby, this seat's view and the chat. On every
 * (re)connect it subscribes again, and the server answers with the current lobby and view.
 */
export function useMatch(matchId: string): MatchChannel {
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [update, setUpdate] = useState<MatchUpdateMsg | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The last rev seen, for the server to know what this client already has.
  const lastRev = useRef(0);
  lastRev.current = update?.view.rev ?? 0;

  useEffect(() => {
    const s = gameSocket();
    const mine = <T extends { matchId?: string; id?: string }>(m: T) => (m.matchId ?? m.id) === matchId;
    const subscribe = () =>
      s.emit('match:subscribe', { matchId, lastRev: lastRev.current }, (r) => setError('ok' in r && r.ok ? null : (r as { message: string }).message));
    const onLobby = (l: Lobby) => mine(l) && setLobby(l);
    const onUpdate = (u: MatchUpdateMsg) => mine(u) && setUpdate(u);
    const onChat = (m: ChatMessage) => mine(m) && setChat((list) => [...list.slice(-99), m]);
    const onHistory = (h: { matchId: string; messages: ChatMessage[] }) => mine(h) && setChat(h.messages);
    const onConnect = () => {
      setConnected(true);
      subscribe();
    };
    const onDisconnect = () => setConnected(false);
    s.on('lobby:updated', onLobby);
    s.on('match:events', onUpdate);
    s.on('chat:message', onChat);
    s.on('chat:history', onHistory);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    if (s.connected) onConnect();
    return () => {
      s.off('lobby:updated', onLobby);
      s.off('match:events', onUpdate);
      s.off('chat:message', onChat);
      s.off('chat:history', onHistory);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.emit('match:unsubscribe', { matchId });
    };
  }, [matchId]);

  const say = (text: string) =>
    new Promise<string | null>((resolve) => {
      gameSocket()
        .timeout(10_000)
        .emit('chat:message', { matchId, text }, (err: Error | null, r?: { ok: boolean; message?: string }) =>
          resolve(err || !r ? 'Not sent. Check your connection.' : r.ok ? null : r.message ?? 'Not sent'),
        );
    });

  return { lobby, update, chat, connected, error, setLobby, say };
}
