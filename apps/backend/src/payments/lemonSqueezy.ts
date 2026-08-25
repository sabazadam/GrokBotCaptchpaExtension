import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/index.js";
import { users, webhookEvents } from "../db/schema.js";
import type { CreditStore } from "../credits/creditStore.js";
import type { AuthService } from "../auth/deviceAuth.js";

/** Kredi verilen olaylar (diğerleri yalnızca idempotency için kaydedilir). */
const CREDIT_GRANTING_EVENTS = new Set([
  "order_created",
  "subscription_payment_success",
]);

/** PostgreSQL `integer` üst sınırı — daha büyük değerler overflow ile topUp'ı düşürür. */
const PG_INT_MAX = 2_147_483_647;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LemonSqueezyOptions {
  signingSecret: string;
  /** variant_id -> kredi eşlemesi. Checkout custom_data.credits kullanılmaz. */
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

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** LS `data.id` string veya sayı gelebilir. */
function objectId(data: Record<string, unknown>): string {
  const id = data["id"];
  if (typeof id === "string" && id.length > 0) return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return "";
}

/**
 * Aynı LS olayının yeniden teslimini yakala. Ham gövde hash'i, payload'daki
 * `updated_at` gibi alanlar değişince çift kredi yazardı.
 */
function eventKey(eventName: string, data: Record<string, unknown>, rawBody: Buffer): string {
  const id = objectId(data);
  if (eventName && id) return `${eventName}:${id}`;
  return createHash("sha256").update(rawBody).digest("hex");
}

/**
 * Kredi miktarı yalnızca sunucu tarafı variant eşlemesinden okunur.
 * `meta.custom_data.credits` checkout URL'sinden (`checkout[custom][credits]=`)
 * alıcı tarafından ayarlanabilir — asla güvenilmez.
 */
function creditsForVariant(
  attributes: Record<string, unknown>,
  variantCredits: Record<string, number>,
): number {
  const firstItem = asRecord(attributes["first_order_item"]);
  const variantId = String(firstItem["variant_id"] ?? attributes["variant_id"] ?? "");
  if (!variantId || variantId === "undefined" || variantId === "null") return 0;
  const mapped = variantCredits[variantId];
  if (typeof mapped !== "number" || !Number.isFinite(mapped) || mapped <= 0) return 0;
  const amount = Math.floor(mapped);
  if (amount > PG_INT_MAX) return 0;
  return amount;
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
   * Aynı olay tekrar gelirse (duplicate) kredi yeniden eklenmez.
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

    const meta = asRecord(payload["meta"]);
    const eventName = typeof meta["event_name"] === "string" ? meta["event_name"] : "";
    const data = asRecord(payload["data"]);
    const attributes = asRecord(data["attributes"]);
    const eventId = eventKey(eventName, data, rawBody);

    // Idempotency: aynı olay iki kez işlenmez.
    const inserted = await this.db
      .insert(webhookEvents)
      .values({ provider: "lemonsqueezy", eventId, payload })
      .onConflictDoNothing({ target: webhookEvents.eventId })
      .returning({ id: webhookEvents.id });
    if (!inserted[0]) {
      return { ok: true, duplicate: true };
    }
    const claimedId = inserted[0].id;

    try {
      return await this.processClaimedEvent({
        eventName,
        meta,
        data,
        attributes,
        eventId,
      });
    } catch (err) {
      // topUp/DB hatasında claim'i geri al — aksi halde LS 500 sonrası retry
      // duplicate sayılır ve ödenmiş kredi hiç yazılmaz.
      await this.db.delete(webhookEvents).where(eq(webhookEvents.id, claimedId));
      throw err;
    }
  }

  private async processClaimedEvent(args: {
    eventName: string;
    meta: Record<string, unknown>;
    data: Record<string, unknown>;
    attributes: Record<string, unknown>;
    eventId: string;
  }): Promise<WebhookResult> {
    const { eventName, meta, data, attributes, eventId } = args;

    if (!CREDIT_GRANTING_EVENTS.has(eventName)) {
      return { ok: true, code: "ignored_event" };
    }

    // İlk abonelik ödemesi: LS hem order_created hem subscription_payment_success
    // gönderir. İkisini de kredilendirmek çifte yükleme olur. Yenileme yalnızca
    // subscription_payment_success gelir (billing_reason=renewal).
    if (eventName === "subscription_payment_success") {
      if (attributes["billing_reason"] !== "renewal") {
        return { ok: true, code: "ignored_event" };
      }
    }

    const status = attributes["status"];
    if (typeof status === "string" && status !== "paid") {
      return { ok: true, code: "ignored_event" };
    }

    const custom = asRecord(meta["custom_data"]);
    const userId = await this.resolveUserId(custom, attributes);
    if (!userId) return { ok: true, code: "no_user" };

    const amount = creditsForVariant(attributes, this.variantCredits);
    if (amount <= 0) {
      return { ok: true, code: "no_credits" };
    }

    const ref = String(attributes["identifier"] ?? data["id"] ?? eventId);
    await this.credits.topUp(userId, amount, ref);
    return { ok: true, code: "credited", creditsAdded: amount, userId };
  }

  /**
   * custom_data.user_id yalnızca mevcut bir UUID hesabına işaret ediyorsa kullanılır.
   * LS dokümanındaki `user_id=123` gibi geçersiz değerler e-postaya düşer; aksi halde
   * topUp FK/uuid hatası verir, olay "işlendi" kalır ve retry kredi yazmaz.
   */
  private async resolveUserId(
    custom: Record<string, unknown>,
    attributes: Record<string, unknown>,
  ): Promise<string | undefined> {
    const rawId = custom["user_id"];
    const candidate =
      typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : undefined;
    if (candidate && isUuid(candidate)) {
      const rows = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, candidate))
        .limit(1);
      if (rows[0]) return rows[0].id;
    }

    const email =
      typeof attributes["user_email"] === "string" ? attributes["user_email"] : undefined;
    if (email) return this.auth.provisionUser(email);
    return undefined;
  }
}
