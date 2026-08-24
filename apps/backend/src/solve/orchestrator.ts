import { and, eq, sql } from "drizzle-orm";
import { DEFAULT_CREDIT_COSTS } from "@grokbot/shared";
import type {
  ApiErrorCode,
  CaptchaTypeId,
  NormalizedSolution,
  SolveRequest,
  SolveResponse,
} from "@grokbot/shared";
import type { AppDatabase } from "../db/index.js";
import { solves } from "../db/schema.js";
import type { CreditStore } from "../credits/creditStore.js";
import type { UserLimiter } from "../limits/rateLimiter.js";
import type { BudgetCircuitBreaker } from "../limits/budgetBreaker.js";
import type { Logger } from "../observability/logger.js";
import type { Metrics } from "../observability/metrics.js";
import { SolverError, type CaptchaSolver } from "../providers/types.js";
import { buildCapsolverTask, BuildTaskError } from "./buildTask.js";

export interface OrchestratorDeps {
  db: AppDatabase;
  credits: CreditStore;
  limiter: UserLimiter;
  breaker: BudgetCircuitBreaker;
  /** Çok sağlayıcılı çözücü (Capsolver -> Anti-Captcha -> 2Captcha fallback). */
  solver: CaptchaSolver;
  /** Tür bazlı kredi maliyeti (varsayılan DEFAULT_CREDIT_COSTS). */
  creditCosts?: Record<CaptchaTypeId, number>;
  logger?: Logger;
  metrics?: Metrics;
}

interface AuthedContext {
  userId: string;
  deviceId: string;
}

function mapError(err: unknown): { code: ApiErrorCode; message: string } {
  if (err instanceof BuildTaskError) return { code: err.code, message: err.message };
  if (err instanceof SolverError) {
    if (err.kind === "timeout") return { code: "capsolver_timeout", message: err.message };
    if (err.kind === "unsupported") {
      return { code: "unsupported_captcha_type", message: err.message };
    }
    return { code: "capsolver_error", message: err.message };
  }
  return { code: "internal_error", message: (err as Error)?.message ?? "bilinmeyen hata" };
}

export class SolveOrchestrator {
  private readonly costs: Record<CaptchaTypeId, number>;

  constructor(private readonly deps: OrchestratorDeps) {
    this.costs = deps.creditCosts ?? DEFAULT_CREDIT_COSTS;
  }

  private cost(type: CaptchaTypeId): number {
    return this.costs[type] ?? 1;
  }

  private async findSolvedByKey(
    userId: string,
    key: string,
  ): Promise<{ id: string; status: string; solution: unknown; cost: number } | null> {
    const rows = await this.deps.db
      .select({
        id: solves.id,
        status: solves.status,
        solution: solves.solution,
        cost: solves.costCredits,
      })
      .from(solves)
      .where(and(eq(solves.userId, userId), eq(solves.idempotencyKey, key)))
      .limit(1);
    return rows[0] ?? null;
  }

  async handleSolve(ctx: AuthedContext, req: SolveRequest): Promise<SolveResponse> {
    const cost = this.cost(req.captchaType);

    // 0) Parametre doğrulama — geçersizse ücret alınmaz (sağlayıcıdan bağımsız).
    try {
      buildCapsolverTask(req);
    } catch (err) {
      const { code, message } = mapError(err);
      this.deps.logger?.warn("solve_invalid", {
        userId: ctx.userId,
        captchaType: req.captchaType,
        code,
      });
      this.deps.metrics?.recordError(code);
      return { status: "error", code, message };
    }

    // 1) Idempotency — daha önce çözülmüşse önbellekten dön.
    let solveId: string | undefined;
    if (req.idempotencyKey) {
      const existing = await this.findSolvedByKey(ctx.userId, req.idempotencyKey);
      if (existing) {
        if (existing.status === "solved") {
          const remaining = await this.deps.credits.getBalance(ctx.userId);
          return {
            status: "solved",
            solveId: existing.id,
            captchaType: req.captchaType,
            solution: (existing.solution as NormalizedSolution) ?? { raw: {} },
            costCredits: existing.cost,
            remainingCredits: remaining,
          };
        }
        if (existing.status === "pending") {
          return { status: "error", code: "rate_limited", message: "Aynı istek işleniyor" };
        }
        // failed -> aynı satırı yeniden kullan (iade edilmişti, yeniden denenebilir).
        // Atomik claim: eşzamanlı yeniden denemeler çifte rezerv/çözüm üretmesin.
        const claimed = await this.deps.db
          .update(solves)
          .set({ status: "pending", resolvedAt: null })
          .where(and(eq(solves.id, existing.id), eq(solves.status, "failed")))
          .returning({ id: solves.id });
        if (!claimed[0]) {
          return { status: "error", code: "rate_limited", message: "Aynı istek işleniyor" };
        }
        solveId = claimed[0].id;
      }
    }

    if (!solveId) {
      const inserted = await this.deps.db
        .insert(solves)
        .values({
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          captchaType: req.captchaType,
          websiteUrl: req.websiteURL ?? null,
          costCredits: cost,
          status: "pending",
          idempotencyKey: req.idempotencyKey ?? null,
        })
        .onConflictDoNothing({ target: [solves.userId, solves.idempotencyKey] })
        .returning({ id: solves.id });
      solveId = inserted[0]?.id;
      if (!solveId) {
        return { status: "error", code: "rate_limited", message: "Aynı istek işleniyor" };
      }
    }

    // 2) Kullanıcı başına limitler.
    const acq = this.deps.limiter.acquire(ctx.userId);
    if (!acq.ok) {
      await this.markFailed(solveId);
      this.deps.logger?.warn("solve_limited", { userId: ctx.userId, code: acq.code });
      this.deps.metrics?.recordError(acq.code);
      return { status: "error", code: acq.code, message: "Limit aşıldı" };
    }

    try {
      // 3) Global bütçe kesici.
      if (!this.deps.breaker.canSpend(cost)) {
        await this.markFailed(solveId);
        this.deps.logger?.warn("budget_open", { userId: ctx.userId });
        this.deps.metrics?.recordError("budget_circuit_open");
        return {
          status: "error",
          code: "budget_circuit_open",
          message: "Sistem geçici olarak yeni çözümleri durdurdu",
        };
      }

      // 4) Krediyi atomik rezerve et.
      const reserve = await this.deps.credits.reserve(ctx.userId, cost);
      if (!reserve.ok) {
        await this.markFailed(solveId);
        this.deps.logger?.info("insufficient_credits", { userId: ctx.userId });
        this.deps.metrics?.recordError("insufficient_credits");
        return { status: "error", code: "insufficient_credits", message: "Yetersiz kredi" };
      }

      // 5) Çok sağlayıcılı çözücü ile çöz (otomatik fallback).
      try {
        const solution = await this.deps.solver.solve(req);
        await this.deps.credits.settle(ctx.userId, cost, solveId);
        this.deps.breaker.record(cost);
        await this.deps.db
          .update(solves)
          .set({ status: "solved", solution, resolvedAt: sql`now()` })
          .where(eq(solves.id, solveId));
        this.deps.logger?.info("solve_ok", {
          userId: ctx.userId,
          captchaType: req.captchaType,
          cost,
        });
        this.deps.metrics?.recordSolve(req.captchaType, "solved", cost);
        return {
          status: "solved",
          solveId,
          captchaType: req.captchaType,
          solution,
          costCredits: cost,
          remainingCredits: reserve.remaining,
        };
      } catch (err) {
        const remaining = await this.deps.credits.refund(ctx.userId, cost, solveId);
        await this.markFailed(solveId);
        const { code, message } = mapError(err);
        this.deps.logger?.warn("solve_failed", { userId: ctx.userId, code, remaining });
        this.deps.metrics?.recordSolve(req.captchaType, "failed", cost);
        this.deps.metrics?.recordError(code);
        return { status: "error", code, message };
      }
    } finally {
      acq.release();
    }
  }

  private async markFailed(solveId: string): Promise<void> {
    await this.deps.db
      .update(solves)
      .set({ status: "failed", resolvedAt: sql`now()` })
      .where(eq(solves.id, solveId));
  }
}
