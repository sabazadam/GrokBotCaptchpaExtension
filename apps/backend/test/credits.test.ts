import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/pglite.js";
import type { DbBundle } from "../src/db/index.js";
import { CreditStore } from "../src/credits/creditStore.js";
import { AuthService } from "../src/auth/deviceAuth.js";
import { creditLedger } from "../src/db/schema.js";

let bundle: DbBundle;
let credits: CreditStore;
let userId: string;

beforeEach(async () => {
  bundle = await createTestDb();
  credits = new CreditStore(bundle.db);
  const auth = new AuthService(bundle.db);
  userId = await auth.provisionUser("credits@test.com");
});

afterEach(async () => {
  await bundle.close();
});

describe("CreditStore", () => {
  it("topUp bakiyeyi artırır", async () => {
    await credits.topUp(userId, 10, "ls-order-1");
    expect(await credits.getBalance(userId)).toBe(10);
  });

  it("reserve yeterli bakiyede başarılı, aksi halde reddeder", async () => {
    await credits.topUp(userId, 3, null);
    const r1 = await credits.reserve(userId, 2);
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(1);
    const r2 = await credits.reserve(userId, 2);
    expect(r2.ok).toBe(false);
    expect(await credits.getBalance(userId)).toBe(1);
  });

  it("refund rezerve edileni geri verir", async () => {
    await credits.topUp(userId, 5, null);
    await credits.reserve(userId, 2);
    const remaining = await credits.refund(userId, 2, "solve-1");
    expect(remaining).toBe(5);
    expect(await credits.getBalance(userId)).toBe(5);
  });

  it("eşzamanlı reserve'lerde toplam bakiyeyi aşamaz (atomik)", async () => {
    await credits.topUp(userId, 5, null);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => credits.reserve(userId, 1)),
    );
    const okCount = results.filter((r) => r.ok).length;
    expect(okCount).toBe(5);
    expect(await credits.getBalance(userId)).toBe(0);
  });

  it("settle bakiyeyi tekrar düşmez, deftere solve kaydı yazar", async () => {
    await credits.topUp(userId, 5, null);
    await credits.reserve(userId, 2);
    expect(await credits.getBalance(userId)).toBe(3);
    await credits.settle(userId, 2, "solve-ref");
    expect(await credits.getBalance(userId)).toBe(3);
    const rows = await bundle.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.ref, "solve-ref"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("solve");
    expect(rows[0]?.deltaCredits).toBe(-2);
  });

  it("sıfır/negatif maliyet bakiyeyi ve defteri değiştirmez", async () => {
    await credits.topUp(userId, 5, "top-1");
    const reserved = await credits.reserve(userId, 0);
    expect(reserved.ok).toBe(true);
    expect(reserved.remaining).toBe(5);
    expect(await credits.refund(userId, 0, "noop")).toBe(5);
    expect(await credits.topUp(userId, 0, null)).toBe(5);
    expect(await credits.topUp(userId, -3, null)).toBe(5);
    await credits.settle(userId, 0, "zero-settle");
    const extra = await bundle.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.ref, "zero-settle"));
    expect(extra).toHaveLength(0);
  });
});
