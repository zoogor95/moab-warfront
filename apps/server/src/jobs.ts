import type { Pool } from './db';
import type { ClockJob } from './matches';

export interface Job extends ClockJob {
  id: string;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

/**
 * Runs due rows of the jobs table. Claiming uses FOR UPDATE SKIP LOCKED with a lease, so two
 * server instances never run one job at once, and a job whose server died is retried later.
 */
export class JobWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(
    private pool: Pool,
    private handle: (job: Job) => Promise<void>,
    private intervalMs = 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((err) => console.error('Job worker:', err)), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => {});
  }

  /** Claims and runs every due job once. Returns how many ran. */
  tick(): Promise<number> {
    // One pass at a time; a slow pass makes the next interval wait instead of piling up.
    this.running ??= this.pass().finally(() => (this.running = null));
    return this.running;
  }

  private async pass(): Promise<number> {
    const { rows } = await this.pool.query<{ id: string; kind: string; payload: ClockJob['payload']; attempts: number }>(
      `UPDATE jobs SET locked_until = now() + interval '1 minute', attempts = attempts + 1
        WHERE id IN (SELECT id FROM jobs
                      WHERE run_at <= now() AND (locked_until IS NULL OR locked_until < now())
                      ORDER BY run_at LIMIT 20 FOR UPDATE SKIP LOCKED)
        RETURNING id, kind, payload, attempts`,
    );
    for (const job of rows) {
      try {
        await this.handle(job);
        await this.pool.query('DELETE FROM jobs WHERE id = $1', [job.id]);
      } catch (err) {
        console.error(`Job ${job.id} (${job.kind}) failed, attempt ${job.attempts}:`, err);
        if (job.attempts >= MAX_ATTEMPTS) await this.pool.query('DELETE FROM jobs WHERE id = $1', [job.id]);
      }
    }
    return rows.length;
  }
}
