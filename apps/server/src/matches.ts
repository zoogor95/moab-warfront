import { randomBytes } from 'node:crypto';
import {
  applyAction,
  botPickStart,
  createMatch,
  finishPicking,
  playBotTurn,
  RuleError,
  type Action,
  type ActionResultMsg,
  type GameState,
  type Lobby,
  type LoggedEvent,
  type MatchStatus,
  type Standings,
} from '@warfront/shared';
import { tx, type Client, type Pool } from './db';
import { forbidden, HttpError, notFound } from './errors';
import { claimStart, readLobby } from './lobby';

/**
 * One entry of the action log. Besides player actions, the server logs the steps it takes
 * itself, so a replay runs the very same code: a bot's whole turn and the end of the pick phase.
 */
export type StepPayload = Action | { type: 'botTurn' } | { type: 'finishPicking' };
export interface Step {
  seat: number;
  payload: StepPayload;
}

/** The only way state moves forward, both live and when replaying the log. Throws RuleError. */
export function replayStep(state: GameState, step: Step): GameState {
  switch (step.payload.type) {
    case 'botTurn':
      return playBotTurn(state, step.seat);
    case 'finishPicking':
      return finishPicking(state).state;
    default:
      return applyAction(state, step.seat, step.payload).state;
  }
}

/** Events added between two states. The log only grows at the end and drops old rounds from the front. */
export function freshEvents(before: GameState, after: GameState): LoggedEvent[] {
  const dropped = before.log.filter((e) => e.round < after.round - 2).length;
  return after.log.slice(Math.max(0, before.log.length - dropped));
}

export function standingsOf(s: GameState): Standings {
  return {
    cities: s.players.map((p) => s.cities.filter((c) => c.owner === p.seat).length),
    units: s.players.map((p) => s.units.filter((u) => u.owner === p.seat).length),
  };
}

const statusOf = (s: GameState): MatchStatus => s.phase;

export interface LiveMatch {
  id: string;
  state: GameState;
  /** matches.rev: the number of logged steps. */
  rev: number;
  deadline: Date | null;
  /** Human seats by user id. */
  seatOf: Map<string, number>;
  /** Replies to recent actions by `seat:clientActionId`, so a retried action gets the first answer. */
  replies: Map<string, ActionResultMsg>;
}

/** How the match service tells connected players what changed. The realtime layer implements it. */
export interface Notifier {
  lobby(lobby: Lobby): void;
  /** Sends each seat its new view and the given events it saw. */
  update(live: LiveMatch, events: LoggedEvent[]): void;
  turnChanged(live: LiveMatch): void;
  pickUpdated(live: LiveMatch): void;
}

export const quietNotifier: Notifier = { lobby() {}, update() {}, turnChanged() {}, pickUpdated() {} };

export interface ClockJob {
  kind: string;
  payload: { matchId?: string; round?: number; seat?: number };
}

const MAX_REPLIES = 500;
// A bots-only stretch runs in slices so one request never holds the event loop for long.
const BOT_STEPS_PER_SLICE = 12;

class StaleError extends Error {}

export class MatchService {
  private live = new Map<string, LiveMatch>();
  private locks = new Map<string, Promise<unknown>>();
  private pending = new Set<Promise<unknown>>();

  constructor(
    private pool: Pool,
    private notify: Notifier = quietNotifier,
    private now: () => number = Date.now,
  ) {}

  /** Runs `fn` after every earlier call for the same match has finished. */
  private withLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(matchId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this.locks.set(matchId, tail);
    void tail.then(() => {
      if (this.locks.get(matchId) === tail) this.locks.delete(matchId);
    });
    return run;
  }

  /** Waits for background bot slices; tests use it before checking the database. */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** Drops a match from memory; the next use reloads it from the database. */
  forget(matchId: string): void {
    this.live.delete(matchId);
  }

  // --- Loading -------------------------------------------------------------------------------

  /** The live match, loaded from its latest snapshot plus the actions after it if needed. */
  private async load(matchId: string): Promise<LiveMatch> {
    const cached = this.live.get(matchId);
    if (cached) return cached;
    const m = await this.pool.query<{ status: MatchStatus; rev: number; turn_deadline: Date | null }>(
      'SELECT status, rev, turn_deadline FROM matches WHERE id = $1',
      [matchId],
    );
    if (!m.rows.length) throw notFound();
    if (m.rows[0].status === 'lobby') throw new HttpError(409, 'not-started', 'The match has not started yet');
    const snap = await this.pool.query<{ rev: number; state: GameState }>(
      'SELECT rev, state FROM match_snapshots WHERE match_id = $1 ORDER BY rev DESC LIMIT 1',
      [matchId],
    );
    if (!snap.rows.length) throw new Error(`Match ${matchId} has no snapshot`);
    const steps = await this.pool.query<{ rev: number; seat: number; payload: StepPayload }>(
      'SELECT rev, seat, payload FROM match_actions WHERE match_id = $1 AND rev > $2 ORDER BY rev',
      [matchId, snap.rows[0].rev],
    );
    let state = snap.rows[0].state;
    let rev = snap.rows[0].rev;
    for (const row of steps.rows) {
      if (row.rev !== rev + 1) throw new Error(`Match ${matchId} is missing action ${rev + 1}`);
      state = replayStep(state, { seat: row.seat, payload: row.payload });
      rev = row.rev;
    }
    if (rev !== m.rows[0].rev) throw new Error(`Match ${matchId} replayed to rev ${rev}, expected ${m.rows[0].rev}`);
    const live: LiveMatch = {
      id: matchId,
      state,
      rev,
      deadline: m.rows[0].turn_deadline,
      seatOf: await this.seatMap(this.pool, matchId),
      replies: new Map(),
    };
    this.live.set(matchId, live);
    return live;
  }

  private async seatMap(c: Pick<Pool, 'query'>, matchId: string): Promise<Map<string, number>> {
    const { rows } = await c.query<{ user_id: string; seat: number }>(
      'SELECT user_id, seat FROM seats WHERE match_id = $1 AND user_id IS NOT NULL',
      [matchId],
    );
    return new Map(rows.map((r) => [r.user_id, r.seat]));
  }

  /** The caller's seat and the live match. */
  async seatIn(matchId: string, userId: string): Promise<{ live: LiveMatch; seat: number }> {
    return this.withLock(matchId, async () => {
      const live = await this.load(matchId);
      const seat = live.seatOf.get(userId);
      if (seat === undefined) throw forbidden('You are not in this match');
      return { live, seat };
    });
  }

  // --- Starting ------------------------------------------------------------------------------

  /** The host starts the lobby: the engine creates the match and the first snapshot is stored. */
  async start(userId: string, matchId: string): Promise<Lobby> {
    const live = await this.withLock(matchId, async () => {
      const created = await tx(this.pool, async (c) => {
        const lobby = await claimStart(c, userId, matchId);
        const state = createMatch({
          settings: lobby.settings,
          players: lobby.seats.map((s) => ({ name: s.name, bot: s.bot })),
          // The seed lives only inside the stored state's rng, which never reaches a client.
          seed: randomBytes(16).toString('hex'),
        });
        const deadline = this.deadlineFor(state);
        await c.query('UPDATE matches SET status = $2, round = $3, active_seat = $4, turn_deadline = $5, rev = 0 WHERE id = $1', [
          matchId, statusOf(state), state.round, state.activeSeat, deadline,
        ]);
        await this.snapshot(c, matchId, 0, state);
        await this.scheduleClock(c, matchId, state, deadline);
        return { state, deadline, seatOf: await this.seatMap(c, matchId) };
      });
      const fresh: LiveMatch = { id: matchId, rev: 0, replies: new Map(), ...created };
      this.live.set(matchId, fresh);
      return fresh;
    });
    const lobby = await readLobby(this.pool, matchId);
    this.notify.lobby(lobby);
    this.notify.update(live, []);
    if (live.state.phase === 'picking') this.notify.pickUpdated(live);
    else this.notify.turnChanged(live);
    await this.withLock(matchId, () => this.followUps(live));
    return lobby;
  }

  // --- Actions -------------------------------------------------------------------------------

  /** Checks and applies one player action. Rule refusals come back as `ok: false`, not as errors. */
  async submit(
    matchId: string,
    userId: string,
    msg: { clientActionId: string; expectedRev: number; action: Action },
  ): Promise<ActionResultMsg> {
    return this.withLock(matchId, async () => {
      const live = await this.load(matchId);
      const seat = live.seatOf.get(userId);
      if (seat === undefined) throw forbidden('You are not in this match');
      const key = `${seat}:${msg.clientActionId}`;
      const earlier = live.replies.get(key);
      if (earlier) return earlier;

      let reply: ActionResultMsg;
      // Picks are made all at once, and resigning does not depend on the map the player saw,
      // so another seat's action in between must not refuse them.
      const anyRev = msg.action.type === 'pickStart' || msg.action.type === 'resign';
      if (!anyRev && msg.expectedRev !== live.state.rev) {
        reply = { clientActionId: msg.clientActionId, ok: false, error: 'stale', message: 'The match moved on; try again', rev: live.state.rev };
      } else {
        try {
          const events = await this.commit(live, { seat, payload: msg.action });
          reply = { clientActionId: msg.clientActionId, ok: true, rev: live.state.rev, events: events.filter((e) => e.seenBy.includes(seat)) };
        } catch (err) {
          if (!(err instanceof RuleError)) throw err;
          reply = { clientActionId: msg.clientActionId, ok: false, error: err.code, message: err.message, rev: live.state.rev };
        }
      }
      live.replies.set(key, reply);
      if (live.replies.size > MAX_REPLIES) live.replies.delete(live.replies.keys().next().value!);
      if (reply.ok) await this.followUps(live);
      return reply;
    });
  }

  /** Called by the clock worker when a turn or the pick phase runs out of time. */
  async runClock(job: ClockJob): Promise<void> {
    const { matchId, round, seat } = job.payload;
    if (!matchId) return;
    await this.withLock(matchId, async () => {
      let live: LiveMatch;
      try {
        live = await this.load(matchId);
      } catch (err) {
        if (err instanceof HttpError) return; // deleted or never started: nothing to time out
        throw err;
      }
      const s = live.state;
      if (job.kind === 'turnTimeout' && s.phase === 'playing' && s.round === round && s.activeSeat === seat) {
        await this.commit(live, { seat: s.activeSeat, payload: { type: 'endTurn' } });
      } else if (job.kind === 'pickTimeout' && s.phase === 'picking') {
        await this.commit(live, { seat: 0, payload: { type: 'finishPicking' } });
      } else {
        return;
      }
      await this.followUps(live);
    });
  }

  /** Bot picks, then bot turns, until a person has to act. */
  private async followUps(live: LiveMatch): Promise<void> {
    for (let i = 0; i < BOT_STEPS_PER_SLICE; i++) {
      const s = live.state;
      if (s.phase === 'picking') {
        const bot = s.players.find((p) => p.bot && s.picks[p.seat] === undefined);
        if (!bot) return;
        await this.commit(live, { seat: bot.seat, payload: { type: 'pickStart', city: botPickStart(s, bot.seat) } });
      } else if (s.phase === 'playing' && s.players[s.activeSeat].bot) {
        await this.commit(live, { seat: s.activeSeat, payload: { type: 'botTurn' } });
      } else {
        return;
      }
    }
    const next = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.withLock(live.id, async () => {
        // A reload in the meantime means another instance owns this match now.
        if (this.live.get(live.id) === live) await this.followUps(live);
      }))
      .catch((err) => console.error(`Bot turns in match ${live.id} failed:`, err));
    this.pending.add(next);
    void next.finally(() => this.pending.delete(next));
  }

  /**
   * Applies one step and stores it in one transaction: the guarded rev bump, the action row,
   * and at a turn change a snapshot and the next clock. Memory changes only after the commit.
   */
  private async commit(live: LiveMatch, step: Step): Promise<LoggedEvent[]> {
    const before = live.state;
    const after = replayStep(before, step); // refusals throw here, before anything is stored
    const turnChanged = after.phase !== before.phase || after.round !== before.round || after.activeSeat !== before.activeSeat;
    const deadline = turnChanged ? this.deadlineFor(after) : live.deadline;
    try {
      await tx(this.pool, async (c) => {
        const bumped = await c.query(
          `UPDATE matches SET rev = rev + 1, status = $3, round = $4, active_seat = $5, turn_deadline = $6
            WHERE id = $1 AND rev = $2`,
          [live.id, live.rev, statusOf(after), after.round, after.activeSeat, deadline],
        );
        if (!bumped.rowCount) throw new StaleError();
        await c.query('INSERT INTO match_actions (match_id, rev, seat, type, payload) VALUES ($1, $2, $3, $4, $5)', [
          live.id, live.rev + 1, step.seat, step.payload.type, JSON.stringify(step.payload),
        ]);
        if (turnChanged) {
          await this.snapshot(c, live.id, live.rev + 1, after);
          await this.scheduleClock(c, live.id, after, deadline);
          for (const p of after.players) {
            await c.query('UPDATE seats SET alive = $3 WHERE match_id = $1 AND seat = $2', [live.id, p.seat, p.alive]);
          }
        }
      });
    } catch (err) {
      if (err instanceof StaleError) {
        // Someone else moved this match on (another server instance); reload before going further.
        this.live.delete(live.id);
        throw new HttpError(409, 'stale', 'The match moved on; try again');
      }
      throw err;
    }
    live.state = after;
    live.rev += 1;
    live.deadline = deadline;

    const events = freshEvents(before, after);
    this.notify.update(live, events);
    if (after.phase === 'picking') this.notify.pickUpdated(live);
    else if (turnChanged) this.notify.turnChanged(live);
    return events;
  }

  private deadlineFor(s: GameState): Date | null {
    if (s.phase === 'finished') return null;
    return new Date(this.now() + s.settings.turnLimitSeconds * 1000);
  }

  private snapshot(c: Client, matchId: string, rev: number, s: GameState) {
    return c.query('INSERT INTO match_snapshots (match_id, rev, round, state) VALUES ($1, $2, $3, $4)', [
      matchId, rev, s.round, JSON.stringify(s),
    ]);
  }

  /** Replaces the match's pending clock with one for the current turn (or pick phase). */
  private async scheduleClock(c: Client, matchId: string, s: GameState, deadline: Date | null) {
    await c.query(`DELETE FROM jobs WHERE payload ->> 'matchId' = $1 AND kind IN ('turnTimeout', 'pickTimeout')`, [matchId]);
    if (!deadline) return;
    const job = s.phase === 'picking'
      ? { kind: 'pickTimeout', payload: { matchId } }
      : { kind: 'turnTimeout', payload: { matchId, round: s.round, seat: s.activeSeat } };
    await c.query('INSERT INTO jobs (kind, run_at, payload) VALUES ($1, $2, $3)', [job.kind, deadline, JSON.stringify(job.payload)]);
  }
}
