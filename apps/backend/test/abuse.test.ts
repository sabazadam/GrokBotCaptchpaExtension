import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SolveRequest } from "@grokbot/shared";
import { createTestDb } from "./helpers/pglite.js";
import { successSolver } from "./helpers/solver.js";
import type { DbBundle } from "../src/db/index.js";
import { CreditStore } from "../src/credits/creditStore.js";
import { AuthService } from "../src/auth/deviceAuth.js";
import { UserLimiter } from "../src/limits/rateLimiter.js";
import { BudgetCircuitBreaker } from "../src/limits/budgetBreaker.js";
import { Metrics } from "../src/observability/metrics.js";
import { SolveOrchestrator } from "../src/solve/orchestrator.js";
import { buildApp } from "../src/http/app.js";

let bundle: DbBundle;
let credits: CreditStore;
let auth: AuthService;
let metrics: Metrics;
let orch: SolveOrchestrator;

const req: SolveRequest = {
  captchaType: "recaptcha_v2",
  websiteURL: "https://example.com",
  websiteKey: "k",
};

async function makeUser(email: string): Promise<{ userId: string; deviceId: string }> {
  const userId = await auth.provisionUser(email);
  const code = await auth.issueActivationCode(userId);
  const redeemed = await auth.redeemActivationCode(code);
  return { userId, deviceId: redeemed.deviceId };
}

beforeEach(async () => {
  bundle = await createTestDb();
  credits = new CreditStore(bundle.db);
  auth = new AuthService(bundle.db);
  metrics = new Metrics();
  orch = new SolveOrchestrator({
    db: bundle.db,
    credits,
    limiter: new UserLimiter({ ratePerMinute: 10000, maxConcurrent: 50, dailyMax: 2 }),
    breaker: new BudgetCircuitBreaker(60_000, 1_000_000),
    solver: successSolver(),
    metrics,
  });
});

afterEach(async () => {
  await bundle.close();
});

describe("kötüye kullanım / izolasyon", () => {
  it("bir kullanıcının limiti diğerini etkilemez", async () => {
    const a = await makeUser("a@test.com");
    const b = await makeUser("b@test.com");
    await credits.topUp(a.userId, 100, null);
    await credits.topUp(b.userId, 100, null);

    // A kullanıcısını günlük limitin (2) üzerine zorla
    const aResults = [];
    for (let i = 0; i < 5; i++) {
      aResults.push(await orch.handleSolve({ userId: a.userId, deviceId: a.deviceId }, req));
    }
    const aSolved = aResults.filter((r) => r.status === "solved").length;
    const aLimited = aResults.filter(
      (r) => r.status === "error" && r.code === "daily_limit",
    ).length;
    expect(aSolved).toBe(2);
    expect(aLimited).toBe(3);

    // B kullanıcısı hâlâ çözebilir (izolasyon)
    const bRes = await orch.handleSolve({ userId: b.userId, deviceId: b.deviceId }, req);
    expect(bRes.status).toBe("solved");

    // A yalnızca kendi kredisini tüketti (2), B kendi kredisini (1)
    expect(await credits.getBalance(a.userId)).toBe(98);
    expect(await credits.getBalance(b.userId)).toBe(99);

    const snap = metrics.snapshot();
    expect(snap.byStatus["solved"]).toBe(3);
    expect(snap.errorsByCode["daily_limit"]).toBe(3);
  });

  it("/metrics ucu admin token ile snapshot döner", async () => {
    const app = buildApp({
      auth,
      credits,
      orchestrator: orch,
      metrics,
      adminToken: "adm",
    });
    const unauth = await app.inject({ method: "GET", url: "/metrics" });
    expect(unauth.statusCode).toBe(401);
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { "x-admin-token": "adm" },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().solvesTotal).toBe("number");
    await app.close();
  });

  it("/metrics admin token yapılandırılmadan 401 (fail-closed)", async () => {
    const app = buildApp({
      auth,
      credits,
      orchestrator: orch,
      metrics,
    });
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
