import type { AuthResponse } from '@warfront/shared/protocol';

export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || 'http://localhost:3100').replace(/\/$/, '');

const KEY = 'warfront.auth.v1';

export interface Session {
  user: { id: string; name: string };
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token runs out. */
  expiresAt: number;
}

/** A refusal from the server, with its code (such as 'not-ready') and a message fit to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Browser storage can be blocked; the session then lasts as long as the page.
let session: Session | null = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
})();

const listeners = new Set<(s: Session | null) => void>();

function store(next: Session | null): void {
  session = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  listeners.forEach((f) => f(next));
}

export const currentSession = () => session;

export function onSession(f: (s: Session | null) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

function adopt(r: AuthResponse): Session {
  const next = { user: r.user, accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: Date.now() + r.expiresIn * 1000 };
  store(next);
  return next;
}

async function send(method: string, path: string, body: unknown, token?: string): Promise<Response> {
  try {
    return await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach the game server. Check your connection and try again.');
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'server-error', data?.message ?? 'Something went wrong');
  return data as T;
}

export async function signInAsGuest(name: string): Promise<Session> {
  return adopt(await parse<AuthResponse>(await send('POST', '/auth/guest', { displayName: name })));
}

export function signOut(): void {
  store(null);
}

let refreshing: Promise<Session | null> | null = null;

/** Swaps the refresh token for new tokens. One refresh at a time; a refused refresh signs out. */
export function refreshSession(): Promise<Session | null> {
  const s = session;
  if (!s) return Promise.resolve(null);
  refreshing ??= (async () => {
    try {
      const res = await send('POST', '/auth/refresh', { refreshToken: s.refreshToken });
      if (res.status === 401) {
        store(null);
        return null;
      }
      return adopt(await parse<AuthResponse>(res));
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** A token that is good for at least another half minute. */
export async function freshToken(): Promise<string | null> {
  if (!session) return null;
  if (session.expiresAt - Date.now() < 30_000) return (await refreshSession())?.accessToken ?? null;
  return session.accessToken;
}

/** An authenticated call; refreshes the token once if the server says it has expired. */
export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const token = await freshToken();
  if (!token) throw new ApiError(401, 'unauthorized', 'Please sign in again');
  let res = await send(method, path, body, token);
  if (res.status === 401) {
    const again = await refreshSession();
    if (!again) throw new ApiError(401, 'unauthorized', 'Please sign in again');
    res = await send(method, path, body, again.accessToken);
  }
  return parse<T>(res);
}
