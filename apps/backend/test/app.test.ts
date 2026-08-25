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

let bundle: DbBundle;
let app: FastifyInstance;
let auth: AuthService;
let credits: CreditStore;

beforeEach(async () => {
  bundle = await createTestDb();
  credits = new CreditStore(bundle.db);
  auth = new AuthService(bundle.db);
  const orchestrator = new SolveOrchestrator({
    db: bundle.db,
    credits,
    limiter: new UserLimiter({ ratePerMinute: 1000, maxConcurrent: 50, dailyMax: 100000 }),
    breaker: new BudgetCircuitBreaker(60_000, 1_000_000),
    solver: successSolver(),
  });
  app = buildApp({ auth, credits, orchestrator });
});

afterEach(async () => {
  await app.close();
  await bundle.close();
});

async function activate(): Promise<string> {
  const userId = await auth.provisionUser("http@test.com");
  const code = await auth.issueActivationCode(userId);
  const res = await app.inject({
    method: "POST",
    url: "/v1/activate",
    payload: { activationCode: code, deviceLabel: "bot-1" },
  });
  return res.json().deviceToken as string;
}

describe("HTTP app", () => {
  it("GET /health -> ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("token'sız /v1/solve -> 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/solve",
      payload: { captchaType: "recaptcha_v2", websiteURL: "https://e.com", websiteKey: "k" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("unauthorized");
  });

  it("geçersiz aktivasyon kodu -> 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/activate",
      payload: { activationCode: "BAD" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("aktivasyon -> bakiye -> çözüm akışı", async () => {
    const token = await activate();

    const balance0 = await app.inject({
      method: "GET",
      url: "/v1/balance",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(balance0.statusCode).toBe(200);
    expect(balance0.json().remainingCredits).toBe(0);

    // Kredisiz çözüm denemesi -> 402
    const noCredit = await app.inject({
      method: "POST",
      url: "/v1/solve",
      headers: { authorization: `Bearer ${token}` },
      payload: { captchaType: "recaptcha_v2", websiteURL: "https://e.com", websiteKey: "k" },
    });
    expect(noCredit.statusCode).toBe(402);

    // Kredi yükle, sonra çöz
    const ctx = await auth.authenticate(token);
    await credits.topUp(ctx!.userId, 5, null);
    const solved = await app.inject({
      method: "POST",
      url: "/v1/solve",
      headers: { authorization: `Bearer ${token}` },
      payload: { captchaType: "recaptcha_v2", websiteURL: "https://e.com", websiteKey: "k" },
    });
    expect(solved.statusCode).toBe(200);
    expect(solved.json().status).toBe("solved");
    expect(solved.json().remainingCredits).toBe(4);
  });

  it("reCAPTCHA v3 pageAction olmadan çözülebilir", async () => {
    const token = await activate();
    const ctx = await auth.authenticate(token);
    await credits.topUp(ctx!.userId, 5, null);
    const solved = await app.inject({
      method: "POST",
      url: "/v1/solve",
      headers: { authorization: `Bearer ${token}` },
      payload: { captchaType: "recaptcha_v3", websiteURL: "https://e.com", websiteKey: "k" },
    });
    expect(solved.statusCode).toBe(200);
    expect(solved.json().status).toBe("solved");
  });

  it("geçersiz minScore -> 400 invalid_params", async () => {
    const token = await activate();
    const res = await app.inject({
      method: "POST",
      url: "/v1/solve",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        captchaType: "recaptcha_v3",
        websiteURL: "https://e.com",
        websiteKey: "k",
        minScore: 1.5,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_params");
  });

  it("bilinmeyen captchaType -> 400", async () => {
    const token = await activate();
    const res = await app.inject({
      method: "POST",
      url: "/v1/solve",
      headers: { authorization: `Bearer ${token}` },
      payload: { captchaType: "hcaptcha", websiteURL: "https://e.com", websiteKey: "k" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_params");
  });

  it("boş aktivasyon gövdesi -> 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/activate",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_params");
  });

  it("geçersiz Authorization şeması -> 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/balance",
      headers: { authorization: "Token not-bearer" },
    });
    expect(res.statusCode).toBe(401);
  });
});
