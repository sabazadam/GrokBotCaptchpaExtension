import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDb } from "./helpers/pglite.js";
import { successSolver } from "./helpers/solver.js";
import type { DbBundle } from "../src/db/index.js";
import { CreditStore } from "../src/credits/creditStore.js";
import { AuthService } from "../src/auth/deviceAuth.js";
import { UserLimiter } from "../src/limits/rateLimiter.js";
import { BudgetCircuitBreaker } from "../src/limits/budgetBreaker.js";
import { SolveOrchestrator } from "../src/solve/orchestrator.js";
import { buildApp } from "../src/http/app.js";

const ADMIN = "admin-secret";

let bundle: DbBundle;
let app: FastifyInstance;
let credits: CreditStore;

beforeEach(async () => {
  bundle = await createTestDb();
  credits = new CreditStore(bundle.db);
  const auth = new AuthService(bundle.db);
  const orchestrator = new SolveOrchestrator({
    db: bundle.db,
    credits,
    limiter: new UserLimiter({ ratePerMinute: 100, maxConcurrent: 5, dailyMax: 100 }),
    breaker: new BudgetCircuitBreaker(60_000, 1_000_000),
    solver: successSolver(),
  });
  app = buildApp({
    auth,
    credits,
    orchestrator,
    adminToken: ADMIN,
    onboarding: { publicBackendUrl: "https://api.example.com", extensionUrl: "https://store/x" },
  });
});

afterEach(async () => {
  await app.close();
  await bundle.close();
});

describe("admin uçları", () => {
  it("admin token'sız 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      payload: { email: "a@b.com" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("aktivasyon kodu + kurulum promptu üretir", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      headers: { "x-admin-token": ADMIN },
      payload: { email: "a@b.com" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.activationCode).toBeTruthy();
    expect(body.installPrompt).toContain(body.activationCode);
    expect(body.installPrompt).toContain("https://api.example.com");
  });

  it("kredi yükler", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/credits",
      headers: { "x-admin-token": ADMIN },
      payload: { email: "a@b.com", credits: 1000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().remainingCredits).toBe(1000);
  });

  it("üretilen kodla cihaz aktive edilebilir", async () => {
    const issue = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      headers: { "x-admin-token": ADMIN },
      payload: { email: "a@b.com" },
    });
    const code = issue.json().activationCode as string;
    const activate = await app.inject({
      method: "POST",
      url: "/v1/activate",
      payload: { activationCode: code },
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json().deviceToken).toBeTruthy();
  });
});
