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

function orderPayload(opts: {
  userId?: string;
  credits?: number;
  orderId?: string;
  variantId?: number | string;
  email?: string;
  status?: string;
}): Record<string, unknown> {
  const custom: Record<string, unknown> = {};
  if (opts.userId !== undefined) custom["user_id"] = opts.userId;
  if (opts.credits !== undefined) custom["credits"] = opts.credits;
  const attributes: Record<string, unknown> = {
    identifier: `ORD-${opts.orderId ?? "1"}`,
    status: opts.status ?? "paid",
  };
  if (opts.email) attributes["user_email"] = opts.email;
  if (opts.variantId !== undefined) {
    attributes["first_order_item"] = { variant_id: opts.variantId };
  }
  return {
    meta: { event_name: "order_created", custom_data: custom },
    data: { id: opts.orderId ?? "ord_1", attributes },
  };
}

beforeEach(async () => {
  bundle = await createTestDb();
  credits = new CreditStore(bundle.db);
  auth = new AuthService(bundle.db);
  service = new LemonSqueezyWebhookService(bundle.db, credits, auth, {
    signingSecret: SECRET,
    variantCredits: { "999": 1000, "42": 250 },
  });
});

afterEach(async () => {
  await bundle.close();
});

describe("LemonSqueezyWebhookService", () => {
  it("geçerli imzalı order_created kredi yükler (variant eşlemesi)", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const raw = JSON.stringify(orderPayload({ userId, variantId: 999 }));
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

  it("aynı olay iki kez işlenmez (idempotency)", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const raw = JSON.stringify(orderPayload({ userId, variantId: 42, orderId: "ord_2" }));
    const sig = sign(raw);
    await service.handle(Buffer.from(raw), sig);
    const second = await service.handle(Buffer.from(raw), sig);
    expect(second.duplicate).toBe(true);
    expect(await credits.getBalance(userId)).toBe(250);
  });

  it("aynı event_name+id, farklı gövdeyle yeniden gelirse yine tek kredi yazar", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const first = JSON.stringify(
      orderPayload({ userId, variantId: 999, orderId: "ord_stable" }),
    );
    const replay = JSON.stringify({
      ...orderPayload({ userId, variantId: 999, orderId: "ord_stable" }),
      meta: {
        event_name: "order_created",
        custom_data: { user_id: userId },
        webhook_id: "replay-2",
      },
    });
    await service.handle(Buffer.from(first), sign(first));
    const second = await service.handle(Buffer.from(replay), sign(replay));
    expect(second.duplicate).toBe(true);
    expect(await credits.getBalance(userId)).toBe(1000);
  });

  it("variant eşlemesinden kredi belirler", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const raw = JSON.stringify({
      meta: { event_name: "order_created", custom_data: { user_id: userId } },
      data: {
        id: "ord_3",
        attributes: { status: "paid", first_order_item: { variant_id: 999 } },
      },
    });
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.creditsAdded).toBe(1000);
    expect(await credits.getBalance(userId)).toBe(1000);
  });

  it("custom_data.credits yok sayılır (checkout URL'sinden şişirilebilir)", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const raw = JSON.stringify(
      orderPayload({ userId, credits: 999_999, variantId: 999, orderId: "ord_spoof" }),
    );
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.creditsAdded).toBe(1000);
    expect(await credits.getBalance(userId)).toBe(1000);
  });

  it("eşlemesi olmayan variant + custom_data.credits -> kredi yok", async () => {
    const userId = await auth.provisionUser("pay@test.com");
    const raw = JSON.stringify(
      orderPayload({ userId, credits: 999_999, orderId: "ord_novar" }),
    );
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.ok).toBe(true);
    expect(result.code).toBe("no_credits");
    expect(result.creditsAdded).toBeUndefined();
    expect(await credits.getBalance(userId)).toBe(0);
  });

  it("user_id yoksa e-postadan kullanıcı oluşturur", async () => {
    const raw = JSON.stringify(
      orderPayload({ email: "new@test.com", variantId: 42, orderId: "ord_4" }),
    );
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.ok).toBe(true);
    expect(result.creditsAdded).toBe(250);
    expect(result.userId).toBeDefined();
    expect(await credits.getBalance(result.userId!)).toBe(250);
  });

  it("geçersiz custom_data.user_id e-postaya düşer (LS doküman örneği 123)", async () => {
    const raw = JSON.stringify(
      orderPayload({
        userId: "123",
        email: "from-email@test.com",
        variantId: 999,
        orderId: "ord_badid",
      }),
    );
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.ok).toBe(true);
    expect(result.creditsAdded).toBe(1000);
    expect(result.userId).toBeDefined();
    expect(await credits.getBalance(result.userId!)).toBe(1000);
  });

  it("var olmayan UUID user_id e-postaya düşer (topUp FK hatası + stuck duplicate olmaz)", async () => {
    const raw = JSON.stringify(
      orderPayload({
        userId: "00000000-0000-4000-8000-000000000000",
        email: "fallback@test.com",
        variantId: 42,
        orderId: "ord_ghost",
      }),
    );
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.ok).toBe(true);
    expect(result.creditsAdded).toBe(250);
    expect(await credits.getBalance(result.userId!)).toBe(250);
  });

  it("subscription_payment_success initial order_created ile çifte kredi yazmaz", async () => {
    const userId = await auth.provisionUser("sub@test.com");
    const order = JSON.stringify(
      orderPayload({ userId, variantId: 999, orderId: "ord_sub" }),
    );
    await service.handle(Buffer.from(order), sign(order));

    const invoice = JSON.stringify({
      meta: {
        event_name: "subscription_payment_success",
        custom_data: { user_id: userId, credits: 1000 },
      },
      data: {
        id: "inv_1",
        attributes: {
          billing_reason: "initial",
          status: "paid",
          user_email: "sub@test.com",
          variant_id: 999,
        },
      },
    });
    const second = await service.handle(Buffer.from(invoice), sign(invoice));
    expect(second.ok).toBe(true);
    expect(second.code).toBe("ignored_event");
    expect(await credits.getBalance(userId)).toBe(1000);
  });

  it("subscription_payment_success renewal variant eşlemesiyle kredi yükler", async () => {
    const userId = await auth.provisionUser("renew@test.com");
    const raw = JSON.stringify({
      meta: { event_name: "subscription_payment_success", custom_data: { user_id: userId } },
      data: {
        id: "inv_renew",
        attributes: {
          billing_reason: "renewal",
          status: "paid",
          variant_id: 42,
        },
      },
    });
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.creditsAdded).toBe(250);
    expect(await credits.getBalance(userId)).toBe(250);
  });

  it("paid olmayan sipariş kredi yazmaz", async () => {
    const userId = await auth.provisionUser("unpaid@test.com");
    const raw = JSON.stringify(
      orderPayload({ userId, variantId: 999, orderId: "ord_unpaid", status: "pending" }),
    );
    const result = await service.handle(Buffer.from(raw), sign(raw));
    expect(result.code).toBe("ignored_event");
    expect(await credits.getBalance(userId)).toBe(0);
  });

  it("topUp hata verirse claim silinir ve retry kredi yazar", async () => {
    const userId = await auth.provisionUser("retry@test.com");
    const raw = JSON.stringify(
      orderPayload({ userId, variantId: 999, orderId: "ord_retry" }),
    );
    const sig = sign(raw);
    const original = credits.topUp.bind(credits);
    let shouldFail = true;
    credits.topUp = async (uid, amount, ref, reason) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("simulated topUp failure");
      }
      return original(uid, amount, ref, reason);
    };

    await expect(service.handle(Buffer.from(raw), sig)).rejects.toThrow("simulated topUp failure");
    expect(await credits.getBalance(userId)).toBe(0);

    const retry = await service.handle(Buffer.from(raw), sig);
    expect(retry.creditsAdded).toBe(1000);
    expect(await credits.getBalance(userId)).toBe(1000);
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
    const raw = JSON.stringify(
      orderPayload({ userId, variantId: 42, orderId: "ord_5" }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/lemonsqueezy",
      headers: { "content-type": "application/json", "x-signature": sign(raw) },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    expect(await credits.getBalance(userId)).toBe(250);
    await app.close();
  });
});
