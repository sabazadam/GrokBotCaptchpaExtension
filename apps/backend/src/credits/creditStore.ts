import { and, eq, gte, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/index.js";
import { creditAccounts, creditLedger } from "../db/schema.js";

export type LedgerReason = "topup" | "solve" | "refund" | "adjust";

export interface ReserveResult {
  ok: boolean;
  remaining: number;
}

/**
 * Atomik kredi defteri. Çekirdek güvenlik deseni:
 *   reserve (atomik düş) -> Capsolver çöz -> settle (kalıcı) | refund (geri ekle)
 * Böylece yarış koşulu / çifte harcama olmaz ve başarısız çözümde ücret alınmaz.
 */
export class CreditStore {
  constructor(private readonly db: AppDatabase) {}

  /** Hesabı yoksa oluşturur (bakiye 0). */
  async ensureAccount(userId: string): Promise<void> {
    await this.db
      .insert(creditAccounts)
      .values({ userId, balanceCredits: 0 })
      .onConflictDoNothing({ target: creditAccounts.userId });
  }

  async getBalance(userId: string): Promise<number> {
    const rows = await this.db
      .select({ balance: creditAccounts.balanceCredits })
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, userId))
      .limit(1);
    return rows[0]?.balance ?? 0;
  }

  /**
   * Krediyi atomik olarak rezerve eder (düşer). Yalnızca bakiye yeterliyse başarılı olur.
   * Tek bir UPDATE ... WHERE balance >= cost RETURNING ile yarış koşulu engellenir.
   */
  async reserve(userId: string, cost: number): Promise<ReserveResult> {
    if (cost <= 0) {
      const remaining = await this.getBalance(userId);
      return { ok: true, remaining };
    }
    const rows = await this.db
      .update(creditAccounts)
      .set({
        balanceCredits: sql`${creditAccounts.balanceCredits} - ${cost}`,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(creditAccounts.userId, userId), gte(creditAccounts.balanceCredits, cost)),
      )
      .returning({ balance: creditAccounts.balanceCredits });

    const row = rows[0];
    if (!row) {
      return { ok: false, remaining: await this.getBalance(userId) };
    }
    return { ok: true, remaining: row.balance };
  }

  /** Rezerve edilmiş krediyi kalıcılaştırır: yalnızca defter kaydı yazar (bakiye zaten düşüldü). */
  async settle(userId: string, cost: number, ref: string | null): Promise<void> {
    if (cost <= 0) return;
    await this.db.insert(creditLedger).values({
      userId,
      deltaCredits: -cost,
      reason: "solve",
      ref: ref ?? null,
    });
  }

  /** Rezerve edilmiş krediyi geri verir (başarısız çözüm): bakiye += cost + defter kaydı. */
  async refund(userId: string, cost: number, ref: string | null): Promise<number> {
    if (cost <= 0) return this.getBalance(userId);
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(creditAccounts)
        .set({
          balanceCredits: sql`${creditAccounts.balanceCredits} + ${cost}`,
          updatedAt: sql`now()`,
        })
        .where(eq(creditAccounts.userId, userId))
        .returning({ balance: creditAccounts.balanceCredits });
      await tx.insert(creditLedger).values({
        userId,
        deltaCredits: cost,
        reason: "refund",
        ref: ref ?? null,
      });
      return rows[0]?.balance ?? 0;
    });
  }

  /** Kredi yükler (ödeme sonrası): bakiye += credits + defter kaydı. Hesap yoksa oluşturur. */
  async topUp(
    userId: string,
    credits: number,
    ref: string | null,
    reason: LedgerReason = "topup",
  ): Promise<number> {
    if (credits <= 0) return this.getBalance(userId);
    return this.db.transaction(async (tx) => {
      await tx
        .insert(creditAccounts)
        .values({ userId, balanceCredits: credits })
        .onConflictDoUpdate({
          target: creditAccounts.userId,
          set: {
            balanceCredits: sql`${creditAccounts.balanceCredits} + ${credits}`,
            updatedAt: sql`now()`,
          },
        });
      const rows = await tx
        .select({ balance: creditAccounts.balanceCredits })
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, userId))
        .limit(1);
      await tx.insert(creditLedger).values({
        userId,
        deltaCredits: credits,
        reason,
        ref: ref ?? null,
      });
      return rows[0]?.balance ?? 0;
    });
  }
}
