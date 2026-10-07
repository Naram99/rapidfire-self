import { createHash } from 'node:crypto';
import type { Clock } from '../application/ports.js';
import type { BetterAuthRateLimitStorage } from 'better-auth';

/** Bounded, expiring keys; addresses are hashed and never logged. */
export class EmailRateLimit {
  private readonly entries = new Map<string, number>();
  constructor(
    private readonly clock: Clock,
    private readonly capacity = 10000,
  ) {}
  allow(purpose: string, email: string): boolean {
    const now = this.clock.now();
    for (const [key, until] of this.entries)
      if (until <= now) this.entries.delete(key);
    const key = createHash('sha256')
      .update(`${purpose}:${email.toLowerCase()}`)
      .digest('hex');
    if (this.entries.has(key) || this.entries.size >= this.capacity)
      return false;
    this.entries.set(key, now + 60000);
    return true;
  }
}

export class RequestRateLimit implements BetterAuthRateLimitStorage {
  private readonly entries = new Map<
    string,
    { count: number; deadline: number }
  >();
  constructor(
    private readonly clock: Clock,
    private readonly capacity = 10000,
  ) {}
  async consume(key: string, rule: Readonly<{ window: number; max: number }>) {
    const now = this.clock.now();
    for (const [stored, entry] of this.entries)
      if (entry.deadline <= now) this.entries.delete(stored);
    const entry = this.entries.get(key);
    if (entry && entry.count >= rule.max)
      return {
        allowed: false,
        retryAfter: Math.ceil((entry.deadline - now) / 1000),
      };
    if (!entry && this.entries.size >= this.capacity)
      return { allowed: false, retryAfter: rule.window };
    // There is no await between checking and incrementing in this Node process.
    this.entries.set(key, {
      count: (entry?.count ?? 0) + 1,
      deadline: entry?.deadline ?? now + rule.window * 1000,
    });
    return { allowed: true, retryAfter: null };
  }
}
