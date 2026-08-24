import { describe, expect, it } from "vitest";
import { UserLimiter } from "../src/limits/rateLimiter.js";
import { BudgetCircuitBreaker } from "../src/limits/budgetBreaker.js";

describe("UserLimiter", () => {
  it("eşzamanlılık limitini uygular ve release ile serbest bırakır", () => {
    const limiter = new UserLimiter({ ratePerMinute: 1000, maxConcurrent: 2, dailyMax: 1000 });
    const a = limiter.acquire("u");
    const b = limiter.acquire("u");
    const c = limiter.acquire("u");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.code).toBe("concurrency_limit");
    if (a.ok) a.release();
    const d = limiter.acquire("u");
    expect(d.ok).toBe(true);
  });

  it("hız limitini uygular (burst tükenince)", () => {
    const limiter = new UserLimiter({
      ratePerMinute: 60,
      burst: 2,
      maxConcurrent: 100,
      dailyMax: 1000,
    });
    const now = 1_000_000;
    expect(limiter.acquire("u", now).ok).toBe(true);
    expect(limiter.acquire("u", now).ok).toBe(true);
    const third = limiter.acquire("u", now);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("rate_limited");
  });

  it("günlük limiti uygular", () => {
    const limiter = new UserLimiter({ ratePerMinute: 1000, maxConcurrent: 100, dailyMax: 1 });
    const first = limiter.acquire("u");
    expect(first.ok).toBe(true);
    if (first.ok) first.release();
    const second = limiter.acquire("u");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("daily_limit");
  });

  it("kullanıcılar birbirinden izoledir", () => {
    const limiter = new UserLimiter({ ratePerMinute: 1000, maxConcurrent: 1, dailyMax: 1000 });
    expect(limiter.acquire("u1").ok).toBe(true);
    expect(limiter.acquire("u2").ok).toBe(true);
  });
});

describe("BudgetCircuitBreaker", () => {
  it("eşiğe kadar harcamaya izin verir", () => {
    const b = new BudgetCircuitBreaker(60_000, 5);
    const now = 1_000_000;
    expect(b.canSpend(5, now)).toBe(true);
    b.record(5, now);
    expect(b.canSpend(1, now)).toBe(false);
    expect(b.isOpen(now)).toBe(true);
  });

  it("pencere kayınca harcama sıfırlanır", () => {
    const b = new BudgetCircuitBreaker(60_000, 5);
    b.record(5, 1_000_000);
    expect(b.isOpen(1_000_000)).toBe(true);
    expect(b.currentSpend(1_000_000 + 60_001)).toBe(0);
    expect(b.canSpend(5, 1_000_000 + 60_001)).toBe(true);
  });
});
