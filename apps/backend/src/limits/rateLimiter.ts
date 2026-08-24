import type { ApiErrorCode } from "@grokbot/shared";

/** Token-bucket: kullanıcı başına hız limiti. */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = now;
  }

  tryConsume(now: number): boolean {
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (now - this.lastRefill) * this.refillPerMs,
    );
    this.lastRefill = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export interface UserLimiterConfig {
  /** Dakikada izin verilen istek sayısı. */
  ratePerMinute: number;
  /** Anlık patlama kapasitesi (varsayılan ratePerMinute). */
  burst?: number;
  /** Aynı anda açık olabilecek maksimum çözüm. */
  maxConcurrent: number;
  /** Kullanıcı başına günlük maksimum çözüm. */
  dailyMax: number;
}

export type AcquireResult =
  | { ok: true; release: () => void }
  | { ok: false; code: ApiErrorCode };

interface UserState {
  bucket: TokenBucket;
  active: number;
  day: string;
  dayCount: number;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Tek instance (in-memory) kullanıcı limitleyici. Yatay ölçeklemede Redis ile
 * değiştirilebilir (aynı arayüz). Bir kullanıcı yalnızca kendi kotasını tüketir.
 */
export class UserLimiter {
  private readonly states = new Map<string, UserState>();
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(private readonly config: UserLimiterConfig) {
    this.capacity = config.burst ?? config.ratePerMinute;
    this.refillPerMs = config.ratePerMinute / 60_000;
  }

  private getState(userId: string, now: number): UserState {
    let s = this.states.get(userId);
    if (!s) {
      s = {
        bucket: new TokenBucket(this.capacity, this.refillPerMs, now),
        active: 0,
        day: utcDay(now),
        dayCount: 0,
      };
      this.states.set(userId, s);
    }
    const today = utcDay(now);
    if (s.day !== today) {
      s.day = today;
      s.dayCount = 0;
    }
    return s;
  }

  acquire(userId: string, now: number = Date.now()): AcquireResult {
    const s = this.getState(userId, now);
    if (s.active >= this.config.maxConcurrent) {
      return { ok: false, code: "concurrency_limit" };
    }
    if (s.dayCount >= this.config.dailyMax) {
      return { ok: false, code: "daily_limit" };
    }
    if (!s.bucket.tryConsume(now)) {
      return { ok: false, code: "rate_limited" };
    }
    s.active += 1;
    s.dayCount += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        const cur = this.states.get(userId);
        if (cur && cur.active > 0) cur.active -= 1;
      },
    };
  }
}
