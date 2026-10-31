import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  createMatchBody,
  guestBody,
  joinBody,
  readyBody,
  refreshBody,
  RuleError,
  seatBody,
  settingsBody,
  submitBody,
} from '@warfront/shared';
import { createGuest, refresh, requireUser } from './auth';
import type { Pool } from './db';
import { HttpError } from './errors';
import { RateLimiter } from './limits';
import { addBot, clearSeat, createLobby, joinByCode, leaveLobby, myMatches, readLobby, setReady, takeSeat, updateSettings } from './lobby';
import type { MatchService, Notifier } from './matches';
import { updateFor } from './realtime';

export interface AppDeps {
  pool: Pool;
  matches: MatchService;
  notify: Notifier;
  authSecret: string;
  clientOrigins: string[];
}

const uuid = z.uuid();

function matchId(raw: string | string[] | undefined): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw new HttpError(404, 'not-found', 'That match was not found');
  return parsed.data;
}

/** Allows the web client's origins; the client sends a bearer token, never cookies. */
function cors(origins: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && origins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

function limit(limiter: RateLimiter, key: (req: express.Request) => string): RequestHandler {
  return (req, _res, next) => {
    if (!limiter.take(key(req))) throw new HttpError(429, 'rate-limited', 'Too many requests; wait a moment');
    next();
  };
}

export function createApp(deps: AppDeps): express.Express {
  const { pool, matches, notify, authSecret } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(cors(deps.clientOrigins));
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  const byAddress = limit(new RateLimiter(10, 10 / 60), (req) => req.ip ?? 'unknown');
  app.post('/auth/guest', byAddress, async (req, res) => {
    res.status(201).json(await createGuest(pool, authSecret, guestBody.parse(req.body).name));
  });
  app.post('/auth/refresh', byAddress, async (req, res) => {
    res.json(await refresh(pool, authSecret, refreshBody.parse(req.body).refreshToken));
  });

  const user = requireUser(authSecret);
  const perUser = limit(new RateLimiter(60, 2), (req) => req.userId!);
  const me = (req: express.Request) => req.userId!;
  /** Lobby edits answer with the new lobby and tell everyone watching it. */
  const changed = (res: express.Response, lobby: Awaited<ReturnType<typeof readLobby>>) => {
    notify.lobby(lobby);
    res.json(lobby);
  };

  app.get('/me', user, async (req, res) => {
    const { rows } = await pool.query<{ id: string; display_name: string }>('SELECT id, display_name FROM users WHERE id = $1', [me(req)]);
    if (!rows.length) throw new HttpError(401, 'unauthorized', 'Please sign in again');
    res.json({ id: rows[0].id, name: rows[0].display_name });
  });

  app.get('/matches', user, perUser, async (req, res) => {
    res.json(await myMatches(pool, me(req)));
  });
  app.post('/matches', user, perUser, async (req, res) => {
    res.status(201).json(await createLobby(pool, me(req), createMatchBody.parse(req.body ?? {}).settings));
  });
  app.post('/matches/join', user, perUser, async (req, res) => {
    changed(res, await joinByCode(pool, me(req), joinBody.parse(req.body).code));
  });
  app.get('/matches/:id', user, perUser, async (req, res) => {
    const id = matchId(req.params.id);
    const seated = await pool.query('SELECT 1 FROM seats WHERE match_id = $1 AND user_id = $2', [id, me(req)]);
    if (!seated.rows.length) throw new HttpError(404, 'not-found', 'That match was not found');
    res.json(await readLobby(pool, id));
  });
  app.patch('/matches/:id/settings', user, perUser, async (req, res) => {
    changed(res, await updateSettings(pool, me(req), matchId(req.params.id), settingsBody.parse(req.body).settings));
  });
  app.post('/matches/:id/seat', user, perUser, async (req, res) => {
    changed(res, await takeSeat(pool, me(req), matchId(req.params.id), seatBody.parse(req.body).seat));
  });
  app.post('/matches/:id/ready', user, perUser, async (req, res) => {
    changed(res, await setReady(pool, me(req), matchId(req.params.id), readyBody.parse(req.body).ready));
  });
  app.post('/matches/:id/bots', user, perUser, async (req, res) => {
    changed(res, await addBot(pool, me(req), matchId(req.params.id), seatBody.parse(req.body).seat));
  });
  app.delete('/matches/:id/seats/:seat', user, perUser, async (req, res) => {
    changed(res, await clearSeat(pool, me(req), matchId(req.params.id), seatBody.parse({ seat: Number(req.params.seat) }).seat));
  });
  app.post('/matches/:id/leave', user, perUser, async (req, res) => {
    const lobby = await leaveLobby(pool, me(req), matchId(req.params.id));
    if (lobby) notify.lobby(lobby);
    res.status(204).end();
  });
  app.post('/matches/:id/start', user, perUser, async (req, res) => {
    res.json(await matches.start(me(req), matchId(req.params.id)));
  });
  app.get('/matches/:id/view', user, perUser, async (req, res) => {
    const id = matchId(req.params.id);
    const { live, seat } = await matches.seatIn(id, me(req));
    res.json(updateFor(id, live.state, seat, [], live.deadline?.toISOString() ?? null));
  });
  // For async play from a notification, without opening a socket.
  app.post('/matches/:id/actions', user, perUser, async (req, res) => {
    res.json(await matches.submit(matchId(req.params.id), me(req), submitBody.parse(req.body)));
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not-found', message: 'No such route' });
  });

  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message });
    } else if (err instanceof RuleError) {
      res.status(422).json({ error: err.code, message: err.message });
    } else if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'bad-request', message: err.issues[0]?.message ?? 'Bad request', issues: err.issues });
    } else if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'bad-request', message: 'The body is not valid JSON' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'server-error', message: 'Something went wrong on the server' });
    }
  };
  app.use(errors);
  return app;
}
