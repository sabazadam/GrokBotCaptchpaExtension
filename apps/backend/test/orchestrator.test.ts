import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SolveRequest } from "@grokbot/shared";
import { createTestDb } from "./helpers/pglite.js";
import { failingClient, successClient } from "./helpers/capsolver.js";
import type { DbBundle } from "../src/db/index.js";
import { CreditStore } from "../src/credits/creditStore.js";
import { AuthService } from "../src/auth/deviceAuth.js";
import { UserLimiter, type UserLimiterConfig } from "../src/limits/rateLimiter.js";
import { BudgetCircuitBreaker } from "../src/limits/budgetBreaker.js";
import { SolveOrchestrator } from "../src/solve/orchestrator.js";
import type { CapsolverClient } from "../src/capsolver/client.js";

let bundle: DbBundle;
let credits: CreditStore;
let userId: string;
let deviceId: string;

const wideLimits: UserLimiterConfig = {
  ratePerMinute: 1000,
  maxConcurrent: 50,
  dailyMax: 100000,
};

const recaptchaReq: SolveRequest = {
  captchaType: "recaptcha_v2",
  websiteURL: "https://example.com",
  websiteKey: "site-key",
};

function makeOrchestrator(opts: {
  client: CapsolverClient;
  limits?: UserLimiterConfig;
  breaker?: BudgetCircuitBreaker;
}): SolveOrchestrator {
  return new SolveOrchestrator({
    db: bundle.db,
    credits,
    limiter: new UserLimiter(opts.limits ?? wideLimits),
    breaker: opts.breaker ?? new BudgetCircuitBreaker(60_000, 1_000_000),
    client: opts.client,
  });
}

beforeEach(async () => {
  bundle = await createTestDb();
  credits = new CreditStore(bundle.db);
  const auth = new AuthService(bundle.db);
  userId = await auth.provisionUser("solver@test.com");
  const code = await auth.issueActivationCode(userId);
  const redeemed = await auth.redeemActivationCode(code);
  deviceId = redeemed.deviceId;
});

afterEach(async () => {
  await bundle.close();
});

describe("SolveOrchestrator", () => {
  it("başarılı çözümde krediyi düşer ve token döner", async () => {
    await credits.topUp(userId, 10, null);
    const orch = makeOrchestrator({ client: successClient() });
    const res = await orch.handleSolve({ userId, deviceId }, recaptchaReq);
    expect(res.status).toBe("solved");
    if (res.status === "solved") {
      expect(res.solution.token).toBe("TOKEN");
      expect(res.costCredits).toBe(1);
      expect(res.remainingCredits).toBe(9);
    }
    expect(await credits.getBalance(userId)).toBe(9);
  });

  it("yetersiz kredide çözmez ve ücret almaz", async () => {
    const orch = makeOrchestrator({ client: successClient() });
    const res = await orch.handleSolve({ userId, deviceId }, recaptchaReq);
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.code).toBe("insufficient_credits");
    expect(await credits.getBalance(userId)).toBe(0);
  });

  it("Capsolver hatasında krediyi iade eder", async () => {
    await credits.topUp(userId, 10, null);
    const orch = makeOrchestrator({ client: failingClient() });
    const res = await orch.handleSolve({ userId, deviceId }, recaptchaReq);
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.code).toBe("capsolver_error");
    expect(await credits.getBalance(userId)).toBe(10);
  });

  it("geçersiz parametrede ücret almaz", async () => {
    await credits.topUp(userId, 10, null);
    const orch = makeOrchestrator({ client: successClient() });
    const res = await orch.handleSolve(
      { userId, deviceId },
      { captchaType: "recaptcha_v3", websiteURL: "https://example.com", websiteKey: "k" },
    );
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.code).toBe("invalid_params");
    expect(await credits.getBalance(userId)).toBe(10);
  });

  it("idempotency: aynı anahtar tekrar çözülmez, tek kez ücretlendirilir", async () => {
    await credits.topUp(userId, 10, null);
    const orch = makeOrchestrator({ client: successClient() });
    const req: SolveRequest = { ...recaptchaReq, idempotencyKey: "key-1" };
    const first = await orch.handleSolve({ userId, deviceId }, req);
    const second = await orch.handleSolve({ userId, deviceId }, req);
    expect(first.status).toBe("solved");
    expect(second.status).toBe("solved");
    expect(await credits.getBalance(userId)).toBe(9);
  });

  it("bütçe kesici açıkken çözmez ve ücret almaz", async () => {
    await credits.topUp(userId, 10, null);
    const orch = makeOrchestrator({
      client: successClient(),
      breaker: new BudgetCircuitBreaker(60_000, 0),
    });
    const res = await orch.handleSolve({ userId, deviceId }, recaptchaReq);
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.code).toBe("budget_circuit_open");
    expect(await credits.getBalance(userId)).toBe(10);
  });

  it("günlük limit aşımında çözmez ve ücret almaz", async () => {
    await credits.topUp(userId, 10, null);
    const orch = makeOrchestrator({
      client: successClient(),
      limits: { ratePerMinute: 1000, maxConcurrent: 50, dailyMax: 1 },
    });
    const first = await orch.handleSolve({ userId, deviceId }, recaptchaReq);
    const second = await orch.handleSolve({ userId, deviceId }, recaptchaReq);
    expect(first.status).toBe("solved");
    expect(second.status).toBe("error");
    if (second.status === "error") expect(second.code).toBe("daily_limit");
    expect(await credits.getBalance(userId)).toBe(9);
  });
});
