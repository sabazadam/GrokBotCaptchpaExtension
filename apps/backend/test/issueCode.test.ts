import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config.js";
import { issueCode, IssueCodeError, isBackendUnreachable } from "../src/onboarding/issueCode.js";
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
const KEY = "test-capsolver-key";

function unreachableFetch(): typeof fetch {
  return async () => {
    throw Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
  };
}

describe("isBackendUnreachable", () => {
  it("ECONNREFUSED / TimeoutError'ı erişilemez sayar", () => {
    expect(
      isBackendUnreachable(
        Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
      ),
    ).toBe(true);
    expect(isBackendUnreachable(Object.assign(new Error("timeout"), { name: "TimeoutError" }))).toBe(
      true,
    );
  });

  it("HTTP 401'i erişilemez saymaz", () => {
    expect(isBackendUnreachable(new IssueCodeError("nope", 401))).toBe(false);
  });
});

describe("issueCode HTTP önceliği (gömülü DB)", () => {
  let bundle: DbBundle | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
    if (bundle) await bundle.close();
    app = undefined;
    bundle = undefined;
  });

  async function listenAdminApp(): Promise<string> {
    bundle = await createTestDb();
    const credits = new CreditStore(bundle.db);
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
      onboarding: { publicBackendUrl: "http://127.0.0.1:9" },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return `http://127.0.0.1:${port}`;
  }

  it("çalışan sunucunun admin API'sini kullanır; yerel DB açmaz", async () => {
    const backendUrl = await listenAdminApp();
    const cfg = loadConfig({
      CAPSOLVER_API_KEY: KEY,
      ADMIN_TOKEN: ADMIN,
      PUBLIC_BACKEND_URL: backendUrl,
    });
    const result = await issueCode(
      { email: "cli@test.com", credits: 40 },
      cfg,
      {
        openDb: async () => {
          throw new Error("gömülü DB ikinci kez açılmamalı");
        },
      },
    );
    expect(result.activationCode).toBeTruthy();
    expect(result.remainingCredits).toBe(40);
    expect(result.installPrompt).toContain(result.activationCode);
  });

  it("yanlış admin token'da yerel DB'ye düşmez", async () => {
    const backendUrl = await listenAdminApp();
    const cfg = loadConfig({
      CAPSOLVER_API_KEY: KEY,
      ADMIN_TOKEN: "wrong-token",
      PUBLIC_BACKEND_URL: backendUrl,
    });
    let opened = false;
    await expect(
      issueCode({ email: "cli@test.com", credits: 1 }, cfg, {
        openDb: async () => {
          opened = true;
          throw new Error("should not open");
        },
      }),
    ).rejects.toThrow(IssueCodeError);
    expect(opened).toBe(false);
  });

  it("sunucu yoksa yerel gömülü DB'ye düşer", async () => {
    const local = await createTestDb();
    const cfg = loadConfig({
      CAPSOLVER_API_KEY: KEY,
      ADMIN_TOKEN: ADMIN,
      PUBLIC_BACKEND_URL: "http://127.0.0.1:1",
    });
    const result = await issueCode(
      { email: "local@test.com", credits: 7 },
      cfg,
      {
        fetchImpl: unreachableFetch(),
        openDb: async () => local,
      },
    );
    expect(result.remainingCredits).toBe(7);
    expect(result.activationCode).toBeTruthy();
  });
});
