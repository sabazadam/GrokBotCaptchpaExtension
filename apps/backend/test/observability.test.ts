import { describe, expect, it, vi } from "vitest";
import { Metrics } from "../src/observability/metrics.js";
import { BudgetCircuitBreaker } from "../src/limits/budgetBreaker.js";
import { createLogger } from "../src/observability/logger.js";

describe("Metrics", () => {
  it("çözüm ve hata sayaçlarını toplar", () => {
    const m = new Metrics();
    m.recordSolve("recaptcha_v2", "solved", 1);
    m.recordSolve("turnstile", "solved", 2);
    m.recordSolve("recaptcha_v2", "failed", 1);
    m.recordError("insufficient_credits");

    const snap = m.snapshot();
    expect(snap.solvesTotal).toBe(3);
    expect(snap.byStatus["solved"]).toBe(2);
    expect(snap.byStatus["failed"]).toBe(1);
    expect(snap.byType["recaptcha_v2"]).toBe(2);
    expect(snap.spendCreditsTotal).toBe(3); // yalnızca solved: 1 + 2
    expect(snap.errorsByCode["insufficient_credits"]).toBe(1);
  });
});

describe("BudgetCircuitBreaker uyarısı", () => {
  it("harcama eşiği aşılınca onWarn tetiklenir", () => {
    const onWarn = vi.fn();
    const b = new BudgetCircuitBreaker(60_000, 10, { warnRatio: 0.5, onWarn });
    const now = 1_000_000;
    b.record(3, now);
    expect(onWarn).not.toHaveBeenCalled();
    b.record(3, now); // toplam 6 >= 5 (0.5 * 10)
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0]![0]).toBeGreaterThanOrEqual(5);
  });
});

describe("createLogger", () => {
  it("JSON satır üretir ve seviye filtreler", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info", sink: (l) => lines.push(l) });
    logger.debug("gizli");
    logger.info("olay", { userId: "u" });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("olay");
    expect(parsed.userId).toBe("u");
  });
});
