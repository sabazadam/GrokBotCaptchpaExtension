import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/pglite.js";
import { successSolver } from "./helpers/solver.js";
import type { DbBundle } from "../src/db/index.js";
import { CreditStore } from "../src/credits/creditStore.js";
import { AuthService } from "../src/auth/deviceAuth.js";
import { UserLimiter } from "../src/limits/rateLimiter.js";
import { BudgetCircuitBreaker } from "../src/limits/budgetBreaker.js";
import { SolveOrchestrator } from "../src/solve/orchestrator.js";
import { LemonSqueezyWebhookService } from "../src/payments/lemonSqueezy.js";
import { buildApp } from "../src/http/app.js";

const SECRET = "test-signing-secret";

let bundle: DbBundle;
let credits: CreditStore;
let auth: AuthService;
let service: LemonSqueezyWebhookService;

function sign(raw: string): string {
  return createHmac("sha256", SECRET).update(Buffer.from(raw)).digest("hex");
}

beforeEach(async () => {
  bundle = await createTestDb();
  credits = new CreditStore(bundle.db);
  auth = new AuthService(bundle.db);
  service = new LemonSqueezyWebhookService(bundle.db, credits, auth, {
    signingSecret: SECRET,
    variantCredits: { "999": 1000 },
  });
});

afterEach(async () => {
  await bundle.close();
});

describe("LemonSqueezyWebhookService", () => {
  it("geçerli imzalı order_created kredi yükler (custom_data)", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const raw = JSON.stringify({
      meta: { event_name: "order_created", custom_data: { user_id: userId, credits: 1000 } },
      data: { id: "ord_1", attributes: { identifier: "ORD-1" } },
    });
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.ok).toBe(true);
    expect(result.creditsAdded).toBe(1000);
    expect(await credits.getBalance(userId)).toBe(1000);
  });

  it("geçersiz imza reddedilir", async () => {
    const raw = JSON.stringify({ meta: { event_name: "order_created" } });
    const result = await service.handle(Buffer.from(raw), "deadbeef");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_signature");
  });

  it("imza yoksa reddedilir", async () => {
    const result = await service.handle(Buffer.from("{}"), undefined);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_signature");
  });

  it("imzalı ama geçersiz JSON reddedilir", async () => {
    const raw = "not-json";
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_json");
  });

  it("aynı olay iki kez işlenmez (idempotency)", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const raw = JSON.stringify({
      meta: { event_name: "order_created", custom_data: { user_id: userId, credits: 500 } },
      data: { id: "ord_2" },
    });
    const sig = sign(raw);
    await service.handle(Buffer.from(raw), sig);
    const second = await service.handle(Buffer.from(raw), sig);
    expect(second.duplicate).toBe(true);
    expect(await credits.getBalance(userId)).toBe(500);
  });

  it("variant eşlemesinden kredi belirler", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const raw = JSON.stringify({
      meta: { event_name: "order_created", custom_data: { user_id: userId } },
      data: { id: "ord_3", attributes: { first_order_item: { variant_id: 999 } } },
    });
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.creditsAdded).toBe(1000);
    expect(await credits.getBalance(userId)).toBe(1000);
  });

  it("user_id yoksa e-postadan kullanıcı oluşturur", async () => {
    const raw = JSON.stringify({
      meta: { event_name: "order_created", custom_data: { credits: 250 } },
      data: { id: "ord_4", attributes: { user_email: "new@test.com" } },
    });
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.ok).toBe(true);
    expect(result.creditsAdded).toBe(250);
    expect(result.userId).toBeDefined();
    expect(await credits.getBalance(result.userId!)).toBe(250);
  });

  it("kredi verilmeyen olay yok sayılır", async () => {
    const raw = JSON.stringify({ meta: { event_name: "subscription_updated" } });
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.ok).toBe(true);
    expect(result.code).toBe("ignored_event");
  });

  it("HTTP rotası imza doğrulayıp kredi yükler", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const orchestrator = new SolveOrchestrator({
      db: bundle.db,
      credits,
      limiter: new UserLimiter({ ratePerMinute: 100, maxConcurrent: 5, dailyMax: 100 }),
      breaker: new BudgetCircuitBreaker(60_000, 1_000_000),
      solver: successSolver(),
    });
    const app = buildApp({ auth, credits, orchestrator, lemonSqueezy: service });
    const raw = JSON.stringify({
      meta: { event_name: "order_created", custom_data: { user_id: userId, credits: 750 } },
      data: { id: "ord_5" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/lemonsqueezy",
      headers: { "content-type": "application/json", "x-signature": sign(raw) },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    expect(await credits.getBalance(userId)).toBe(750);
    await app.close();
  });
});
