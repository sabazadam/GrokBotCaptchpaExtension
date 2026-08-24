import { and, eq, isNull, or, gt, sql } from "drizzle-orm";
import type { ApiErrorCode } from "@grokbot/shared";
import type { AppDatabase } from "../db/index.js";
import { activationCodes, creditAccounts, devices, users } from "../db/schema.js";
import { generateActivationCode, generateToken, hashSecret } from "./tokens.js";

export class AuthError extends Error {
  readonly code: ApiErrorCode;
  constructor(message: string, code: ApiErrorCode) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface AuthedDevice {
  userId: string;
  deviceId: string;
}

export interface RedeemResult {
  deviceToken: string;
  userId: string;
  deviceId: string;
}

export class AuthService {
  constructor(private readonly db: AppDatabase) {}

  /** Dashboard/test için kullanıcı oluşturur ve kredi hesabını hazırlar. */
  async provisionUser(email: string): Promise<string> {
    const inserted = await this.db
      .insert(users)
      .values({ email })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });

    let userId = inserted[0]?.id;
    if (!userId) {
      const existing = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      userId = existing[0]?.id;
    }
    if (!userId) throw new AuthError("Kullanıcı oluşturulamadı", "internal_error");

    await this.db
      .insert(creditAccounts)
      .values({ userId, balanceCredits: 0 })
      .onConflictDoNothing({ target: creditAccounts.userId });
    return userId;
  }

  /**
   * Tek kullanımlık aktivasyon kodu üretir. Düz metin kod yalnızca burada döner;
   * DB'de yalnızca hash saklanır.
   */
  async issueActivationCode(userId: string, expiresInMs?: number): Promise<string> {
    const code = generateActivationCode();
    const expiresAt =
      expiresInMs !== undefined ? new Date(Date.now() + expiresInMs) : null;
    await this.db.insert(activationCodes).values({
      userId,
      codeHash: hashSecret(code),
      expiresAt,
    });
    return code;
  }

  /**
   * Aktivasyon kodunu kullanır: yeni bir cihaz oluşturur ve iptal edilebilir cihaz
   * token'ı döner. Kod tek kullanımlıktır ve cihaza bağlanır.
   */
  async redeemActivationCode(code: string, deviceLabel?: string): Promise<RedeemResult> {
    const codeHash = hashSecret(code);
    const rows = await this.db
      .select({ id: activationCodes.id, userId: activationCodes.userId })
      .from(activationCodes)
      .where(
        and(
          eq(activationCodes.codeHash, codeHash),
          isNull(activationCodes.usedAt),
          or(isNull(activationCodes.expiresAt), gt(activationCodes.expiresAt, sql`now()`)),
        ),
      )
      .limit(1);

    const codeRow = rows[0];
    if (!codeRow) {
      throw new AuthError("Geçersiz, süresi dolmuş veya kullanılmış kod", "unauthorized");
    }

    const deviceToken = generateToken();
    const deviceRows = await this.db
      .insert(devices)
      .values({
        userId: codeRow.userId,
        deviceTokenHash: hashSecret(deviceToken),
        label: deviceLabel ?? null,
        lastSeenAt: new Date(),
      })
      .returning({ id: devices.id });

    const deviceId = deviceRows[0]?.id;
    if (!deviceId) throw new AuthError("Cihaz oluşturulamadı", "internal_error");

    // Kodu kullanılmış işaretle ve cihaza bağla (tekrar kullanımı engelle).
    const claim = await this.db
      .update(activationCodes)
      .set({ usedAt: sql`now()`, deviceId })
      .where(and(eq(activationCodes.id, codeRow.id), isNull(activationCodes.usedAt)))
      .returning({ id: activationCodes.id });

    if (!claim[0]) {
      throw new AuthError("Kod aynı anda başka bir cihazda kullanıldı", "unauthorized");
    }

    await this.db
      .insert(creditAccounts)
      .values({ userId: codeRow.userId, balanceCredits: 0 })
      .onConflictDoNothing({ target: creditAccounts.userId });

    return { deviceToken, userId: codeRow.userId, deviceId };
  }

  /** Cihaz token'ını doğrular; geçerliyse kullanıcı+cihaz döner, değilse null. */
  async authenticate(deviceToken: string): Promise<AuthedDevice | null> {
    if (!deviceToken) return null;
    const tokenHash = hashSecret(deviceToken);
    const rows = await this.db
      .update(devices)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(devices.deviceTokenHash, tokenHash), isNull(devices.revokedAt)))
      .returning({ id: devices.id, userId: devices.userId });

    const row = rows[0];
    if (!row) return null;
    return { userId: row.userId, deviceId: row.id };
  }

  /** Cihaz token'ını iptal eder (abonelik bitti / cihaz kaldırıldı). */
  async revokeDevice(deviceId: string): Promise<void> {
    await this.db
      .update(devices)
      .set({ revokedAt: sql`now()` })
      .where(eq(devices.id, deviceId));
  }
}
