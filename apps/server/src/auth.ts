import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { AuthResponse } from '@warfront/shared';
import { tx, type Pool } from './db';
import { HttpError } from './errors';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const hash = (token: string) => createHash('sha256').update(token).digest();

/** Access tokens are `payload.signature`, HMAC-SHA256 over the payload. No library needed for one claim. */
export function signAccess(secret: string, userId: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + ACCESS_TTL_SECONDS }));
  return `${payload}.${b64(createHmac('sha256', secret).update(payload).digest())}`;
}

/** The user id, or null when the token is malformed, forged or expired. */
export function verifyAccess(secret: string, token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const want = createHmac('sha256', secret).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: unknown; exp?: unknown };
    if (typeof sub !== 'string' || typeof exp !== 'number' || exp * 1000 <= now) return null;
    return sub;
  } catch {
    return null;
  }
}

async function issue(c: { query: Pool['query'] }, secret: string, user: { id: string; name: string }): Promise<AuthResponse> {
  const refreshToken = b64(randomBytes(32));
  await c.query(
    `INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hash(refreshToken), user.id, REFRESH_TTL_DAYS],
  );
  return { user, accessToken: signAccess(secret, user.id), refreshToken, expiresIn: ACCESS_TTL_SECONDS };
}

/** A guest is a user with no login rows; linking a provider later keeps the same id. */
export async function createGuest(pool: Pool, secret: string, name: string): Promise<AuthResponse> {
  return tx(pool, async (c) => {
    const { rows } = await c.query<{ id: string }>('INSERT INTO users (display_name) VALUES ($1) RETURNING id', [name]);
    return issue(c, secret, { id: rows[0].id, name });
  });
}

/** Swaps a refresh token for a new pair; the old refresh token stops working. */
export async function refresh(pool: Pool, secret: string, refreshToken: string): Promise<AuthResponse> {
  return tx(pool, async (c) => {
    const { rows } = await c.query<{ id: string; display_name: string }>(
      `WITH used AS (DELETE FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now() RETURNING user_id)
       SELECT u.id, u.display_name FROM users u JOIN used ON used.user_id = u.id`,
      [hash(refreshToken)],
    );
    if (!rows.length) throw new HttpError(401, 'unauthorized', 'Please sign in again');
    return issue(c, secret, { id: rows[0].id, name: rows[0].display_name });
  });
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireUser(secret: string): RequestHandler {
  return (req, _res, next) => {
    const header = req.get('authorization');
    const userId = verifyAccess(secret, header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!userId) throw new HttpError(401, 'unauthorized', 'Please sign in again');
    req.userId = userId;
    next();
  };
}
