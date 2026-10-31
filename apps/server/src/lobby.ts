import { randomInt } from 'node:crypto';
import { DEFAULT_SETTINGS, type MatchSettings } from '@warfront/shared';
import {
  MatchSettingsSchema,
  SEAT_STYLES,
  type Lobby,
  type LobbySeat,
  type MatchStatus,
  type MatchSummary,
  type UpdateSettingsBody,
} from '@warfront/shared/protocol';
import { tx, type Client, type Pool } from './db';
import { conflict, forbidden, HttpError, notFound } from './errors';

// No 0/O or 1/I, so a code read aloud or off a screen is never ambiguous.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

interface MatchRow {
  id: string;
  code: string;
  host_id: string;
  status: MatchStatus;
  settings: MatchSettings;
}

interface SeatRow {
  seat: number;
  user_id: string | null;
  display_name: string | null;
  ready: boolean;
}

export const botName = (seat: number) => `Bot ${seat + 1}`;

export async function readLobby(c: Pick<Pool, 'query'>, matchId: string): Promise<Lobby> {
  const m = await c.query<MatchRow>('SELECT id, code, host_id, status, settings FROM matches WHERE id = $1', [matchId]);
  if (!m.rows.length) throw notFound();
  const s = await c.query<SeatRow>(
    `SELECT s.seat, s.user_id, u.display_name, s.ready FROM seats s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.match_id = $1 ORDER BY s.seat`,
    [matchId],
  );
  const row = m.rows[0];
  return {
    id: row.id,
    code: row.code,
    hostId: row.host_id,
    status: row.status,
    // Lobbies made before a setting existed get its default.
    settings: { ...DEFAULT_SETTINGS, ...row.settings },
    seats: s.rows.map((r): LobbySeat => ({
      seat: r.seat,
      userId: r.user_id,
      name: r.user_id ? r.display_name ?? 'Player' : botName(r.seat),
      bot: r.user_id === null,
      ready: r.ready,
      colour: SEAT_STYLES[r.seat].colour,
      emblem: SEAT_STYLES[r.seat].emblem,
    })),
  };
}

/** Locks the match row so lobby edits never interleave, and checks it is still a lobby. */
async function lockLobby(c: Client, matchId: string): Promise<MatchRow> {
  const { rows } = await c.query<MatchRow>('SELECT id, code, host_id, status, settings FROM matches WHERE id = $1 FOR UPDATE', [matchId]);
  if (!rows.length) throw notFound();
  if (rows[0].status !== 'lobby') throw conflict('not-in-lobby', 'The match has already started');
  return rows[0];
}

async function seatsOf(c: Client, matchId: string): Promise<SeatRow[]> {
  const { rows } = await c.query<SeatRow>('SELECT seat, user_id, NULL AS display_name, ready FROM seats WHERE match_id = $1 ORDER BY seat', [matchId]);
  return rows;
}

function insertSeat(c: Client, matchId: string, seat: number, userId: string | null) {
  const style = SEAT_STYLES[seat];
  return c.query(
    'INSERT INTO seats (match_id, seat, user_id, colour, emblem, ready) VALUES ($1, $2, $3, $4, $5, $6)',
    [matchId, seat, userId, style.colour, style.emblem, userId === null],
  );
}

function requireHost(m: MatchRow, userId: string) {
  if (m.host_id !== userId) throw forbidden('Only the host can do that');
}

export async function createLobby(pool: Pool, hostId: string, settings: MatchSettings = DEFAULT_SETTINGS): Promise<Lobby> {
  for (let attempt = 0; ; attempt++) {
    try {
      const id = await tx(pool, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          'INSERT INTO matches (code, host_id, settings) VALUES ($1, $2, $3) RETURNING id',
          [newCode(), hostId, settings],
        );
        await insertSeat(c, rows[0].id, 0, hostId);
        return rows[0].id;
      });
      return readLobby(pool, id);
    } catch (err) {
      // A clash on the code is rare (one in a billion per pair); try another.
      if ((err as { constraint?: string }).constraint === 'matches_code_key' && attempt < 5) continue;
      throw err;
    }
  }
}

/** Takes the first open seat. Joining a match you already sit in just returns it. */
export async function joinByCode(pool: Pool, userId: string, code: string): Promise<Lobby> {
  const found = await pool.query<{ id: string }>('SELECT id FROM matches WHERE code = $1', [code]);
  if (!found.rows.length) throw notFound('No match with that code');
  const matchId = found.rows[0].id;
  const mine = await pool.query('SELECT 1 FROM seats WHERE match_id = $1 AND user_id = $2', [matchId, userId]);
  if (mine.rows.length) return readLobby(pool, matchId);
  await tx(pool, async (c) => {
    const m = await lockLobby(c, matchId);
    const taken = new Set((await seatsOf(c, matchId)).map((s) => s.seat));
    const seat = Array.from({ length: m.settings.seats }, (_, i) => i).find((i) => !taken.has(i));
    if (seat === undefined) throw conflict('full', 'Every seat is taken');
    await insertSeat(c, matchId, seat, userId);
  });
  return readLobby(pool, matchId);
}

/** Moving to another open seat also changes your colour and emblem, which belong to the seat. */
export async function takeSeat(pool: Pool, userId: string, matchId: string, seat: number): Promise<Lobby> {
  await tx(pool, async (c) => {
    const m = await lockLobby(c, matchId);
    if (seat >= m.settings.seats) throw conflict('closed', 'That seat is closed');
    const seats = await seatsOf(c, matchId);
    if (!seats.some((s) => s.user_id === userId)) throw forbidden('You are not in this match');
    if (seats.some((s) => s.seat === seat)) throw conflict('taken', 'That seat is taken');
    const style = SEAT_STYLES[seat];
    await c.query(
      'UPDATE seats SET seat = $3, colour = $4, emblem = $5, ready = false WHERE match_id = $1 AND user_id = $2',
      [matchId, userId, seat, style.colour, style.emblem],
    );
  });
  return readLobby(pool, matchId);
}

export async function setReady(pool: Pool, userId: string, matchId: string, ready: boolean): Promise<Lobby> {
  await tx(pool, async (c) => {
    await lockLobby(c, matchId);
    const r = await c.query('UPDATE seats SET ready = $3 WHERE match_id = $1 AND user_id = $2', [matchId, userId, ready]);
    if (!r.rowCount) throw forbidden('You are not in this match');
  });
  return readLobby(pool, matchId);
}

export async function addBot(pool: Pool, userId: string, matchId: string, seat: number): Promise<Lobby> {
  await tx(pool, async (c) => {
    const m = await lockLobby(c, matchId);
    requireHost(m, userId);
    if (seat >= m.settings.seats) throw conflict('closed', 'That seat is closed');
    if ((await seatsOf(c, matchId)).some((s) => s.seat === seat)) throw conflict('taken', 'That seat is taken');
    await insertSeat(c, matchId, seat, null);
  });
  return readLobby(pool, matchId);
}

/** The host removes a bot or a player from a seat; the host's own seat stays. */
export async function clearSeat(pool: Pool, userId: string, matchId: string, seat: number): Promise<Lobby> {
  await tx(pool, async (c) => {
    const m = await lockLobby(c, matchId);
    requireHost(m, userId);
    const target = (await seatsOf(c, matchId)).find((s) => s.seat === seat);
    if (!target) throw conflict('empty', 'That seat is already empty');
    if (target.user_id === userId) throw conflict('host-seat', 'Leave the match instead');
    await c.query('DELETE FROM seats WHERE match_id = $1 AND seat = $2', [matchId, seat]);
  });
  return readLobby(pool, matchId);
}

/** Merges a host's change into the current settings and checks the result as a whole. */
export async function updateSettings(pool: Pool, userId: string, matchId: string, change: UpdateSettingsBody): Promise<Lobby> {
  await tx(pool, async (c) => {
    const m = await lockLobby(c, matchId);
    requireHost(m, userId);
    const settings = MatchSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...m.settings, ...change });
    const seats = await seatsOf(c, matchId);
    const highest = Math.max(...seats.map((s) => s.seat));
    if (settings.seats <= highest) throw conflict('seat-in-use', `Seat ${highest + 1} is in use; empty it first`);
    await c.query('UPDATE matches SET settings = $2 WHERE id = $1', [matchId, settings]);
    // Players agreed to the old settings; ask them again.
    await c.query('UPDATE seats SET ready = false WHERE match_id = $1 AND user_id IS NOT NULL AND user_id <> $2', [matchId, userId]);
  });
  return readLobby(pool, matchId);
}

/**
 * Leaving a lobby frees the seat. If the host leaves, the next person in seat order hosts;
 * if nobody is left, the lobby is deleted and null is returned.
 */
export async function leaveLobby(pool: Pool, userId: string, matchId: string): Promise<Lobby | null> {
  const remaining = await tx(pool, async (c) => {
    const m = await lockLobby(c, matchId);
    const r = await c.query('DELETE FROM seats WHERE match_id = $1 AND user_id = $2', [matchId, userId]);
    if (!r.rowCount) throw forbidden('You are not in this match');
    const people = (await seatsOf(c, matchId)).filter((s) => s.user_id !== null);
    if (!people.length) {
      await c.query('DELETE FROM matches WHERE id = $1', [matchId]);
      return 0;
    }
    if (m.host_id === userId) await c.query('UPDATE matches SET host_id = $2 WHERE id = $1', [matchId, people[0].user_id]);
    return people.length;
  });
  return remaining ? readLobby(pool, matchId) : null;
}

/**
 * Checks the lobby can start and marks it as starting, inside the caller's transaction.
 * Every seat up to the seat count must be filled and every other person ready.
 */
export async function claimStart(c: Client, userId: string, matchId: string): Promise<Lobby> {
  const m = await lockLobby(c, matchId);
  requireHost(m, userId);
  const lobby = await readLobby(c, matchId);
  if (lobby.seats.length < m.settings.seats) throw conflict('seats-open', 'Fill or close the empty seats first');
  const waiting = lobby.seats.filter((s) => !s.bot && !s.ready && s.userId !== userId);
  if (waiting.length) throw conflict('not-ready', `Waiting for ${waiting.map((s) => s.name).join(', ')}`);
  if (lobby.seats.every((s) => s.bot)) throw new HttpError(409, 'no-players', 'A match needs at least one person');
  return lobby;
}

/** The home screen list: matches waiting on you first, then picks, games in progress, lobbies, finished. */
export async function myMatches(pool: Pool, userId: string): Promise<MatchSummary[]> {
  const { rows } = await pool.query<{
    id: string; code: string; status: MatchStatus; round: number; active_seat: number; seat: number;
    players: string[]; turn_deadline: Date | null;
  }>(
    `SELECT m.id, m.code, m.status, m.round, m.active_seat, s.seat, m.turn_deadline,
            (SELECT array_agg(COALESCE(u.display_name, 'Bot ' || (o.seat + 1)) ORDER BY o.seat)
               FROM seats o LEFT JOIN users u ON u.id = o.user_id WHERE o.match_id = m.id) AS players
       FROM seats s JOIN matches m ON m.id = s.match_id
      WHERE s.user_id = $1 AND (m.status <> 'finished' OR m.created_at > now() - interval '7 days')
      ORDER BY (m.status = 'playing' AND m.active_seat = s.seat) DESC,
               CASE m.status WHEN 'picking' THEN 0 WHEN 'playing' THEN 1 WHEN 'lobby' THEN 2 ELSE 3 END,
               m.created_at DESC
      LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    round: r.round,
    activeSeat: r.active_seat,
    mySeat: r.seat,
    yourTurn: r.status === 'playing' && r.active_seat === r.seat,
    players: r.players,
    turnDeadline: r.turn_deadline?.toISOString() ?? null,
  }));
}
