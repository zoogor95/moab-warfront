/**
 * Token buckets keyed by user (or address). Each key holds up to `burst` tokens and regains
 * `perSecond` of them every second. In memory: limits reset on restart, which is fine for them.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private burst: number,
    private perSecond: number,
    private now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: t };
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.at) / 1000) * this.perSecond);
    b.at = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.prune(t);
    return ok;
  }

  private prune(t: number): void {
    const full = this.burst / this.perSecond;
    for (const [k, b] of this.buckets) if ((t - b.at) / 1000 > full) this.buckets.delete(k);
  }
}
