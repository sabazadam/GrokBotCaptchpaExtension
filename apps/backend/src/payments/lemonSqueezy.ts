import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/index.js";
import { webhookEvents } from "../db/schema.js";
import type { CreditStore } from "../credits/creditStore.js";
import type { AuthService } from "../auth/deviceAuth.js";

/** Kredi verilen olaylar (diğerleri yalnızca idempotency için kaydedilir). */
const CREDIT_GRANTING_EVENTS = new Set([
  "order_created",
  "subscription_payment_success",
]);

export interface LemonSqueezyOptions {
  signingSecret: string;
  /** variant_id -> kredi eşlemesi (custom_data.credits yoksa kullanılır). */
  variantCredits?: Record<string, number>;
}

export interface WebhookResult {
  ok: boolean;
  code?: string;
  duplicate?: boolean;
  creditsAdded?: number;
  userId?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export class LemonSqueezyWebhookService {
  private readonly variantCredits: Record<string, number>;

  constructor(
    private readonly db: AppDatabase,
    private readonly credits: CreditStore,
    private readonly auth: AuthService,
    private readonly options: LemonSqueezyOptions,
  ) {
    this.variantCredits = options.variantCredits ?? {};
  }

  /** X-Signature (hex HMAC-SHA256) doğrulaması — ham gövde üzerinden. */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const digest = createHmac("sha256", this.options.signingSecret)
      .update(rawBody)
      .digest("hex");
    const a = Buffer.from(digest, "hex");
    let b: Buffer;
    try {
      b = Buffer.from(signature, "hex");
    } catch {
      return false;
    }
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Webhook'u işler: imza doğrula -> idempotent kaydet -> kredi yükle.
   * Aynı gövde tekrar gelirse (duplicate) kredi yeniden eklenmez.
   */
  async handle(rawBody: Buffer, signature: string | undefined): Promise<WebhookResult> {
    if (!this.verifySignature(rawBody, signature)) {
      return { ok: false, code: "invalid_signature" };
    }

    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(rawBody.toString("utf8")));
    } catch {
      return { ok: false, code: "invalid_json" };
    }

    const eventId = createHash("sha256").update(rawBody).digest("hex");

    // Idempotency: aynı olay iki kez işlenmez.
    const inserted = await this.db
      .insert(webhookEvents)
      .values({ provider: "lemonsqueezy", eventId, payload })
      .onConflictDoNothing({ target: webhookEvents.eventId })
      .returning({ id: webhookEvents.id });
    if (!inserted[0]) {
      return { ok: true, duplicate: true };
    }

    const meta = asRecord(payload["meta"]);
    const eventName = typeof meta["event_name"] === "string" ? meta["event_name"] : "";
    if (!CREDIT_GRANTING_EVENTS.has(eventName)) {
      return { ok: true, code: "ignored_event" };
    }

    const custom = asRecord(meta["custom_data"]);
    const data = asRecord(payload["data"]);
    const attributes = asRecord(data["attributes"]);

    // Kullanıcı çözümü: önce custom_data.user_id, sonra e-posta.
    let userId =
      typeof custom["user_id"] === "string" ? (custom["user_id"] as string) : undefined;
    if (!userId) {
      const email =
        typeof attributes["user_email"] === "string"
          ? (attributes["user_email"] as string)
          : undefined;
      if (email) userId = await this.auth.provisionUser(email);
    }
    if (!userId) return { ok: true, code: "no_user" };

    // Kredi miktarı: önce custom_data.credits, sonra variant eşlemesi.
    let credits = Number(custom["credits"] ?? 0);
    if (!Number.isFinite(credits) || credits <= 0) {
      const firstItem = asRecord(attributes["first_order_item"]);
      const variantId = String(
        firstItem["variant_id"] ?? attributes["variant_id"] ?? "",
      );
      credits = this.variantCredits[variantId] ?? 0;
    }
    if (!Number.isFinite(credits) || credits <= 0) {
      return { ok: true, code: "no_credits" };
    }

    const amount = Math.floor(credits);
    const ref = String(attributes["identifier"] ?? data["id"] ?? eventId);
    await this.credits.topUp(userId, amount, ref);
    return { ok: true, code: "credited", creditsAdded: amount, userId };
  }
}
