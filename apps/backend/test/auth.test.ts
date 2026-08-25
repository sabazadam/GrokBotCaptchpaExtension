import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/pglite.js";
import type { DbBundle } from "../src/db/index.js";
import { AuthService, AuthError } from "../src/auth/deviceAuth.js";

let bundle: DbBundle;
let auth: AuthService;

beforeEach(async () => {
  bundle = await createTestDb();
  auth = new AuthService(bundle.db);
});

afterEach(async () => {
  await bundle.close();
});

describe("AuthService", () => {
  it("provisionUser aynı e-posta için idempotenttir", async () => {
    const a = await auth.provisionUser("u@test.com");
    const b = await auth.provisionUser("u@test.com");
    expect(a).toBe(b);
  });

  it("aktivasyon kodu -> cihaz token -> authenticate", async () => {
    const userId = await auth.provisionUser("u@test.com");
    const code = await auth.issueActivationCode(userId);
    const redeemed = await auth.redeemActivationCode(code, "bot-1");
    expect(redeemed.userId).toBe(userId);
    expect(redeemed.deviceToken.length).toBeGreaterThan(10);

    const ctx = await auth.authenticate(redeemed.deviceToken);
    expect(ctx?.userId).toBe(userId);
    expect(ctx?.deviceId).toBe(redeemed.deviceId);
  });

  it("geçersiz kod AuthError(unauthorized) fırlatır", async () => {
    await expect(auth.redeemActivationCode("BAD-CODE")).rejects.toBeInstanceOf(AuthError);
  });

  it("aynı kod ikinci kez kullanılamaz", async () => {
    const userId = await auth.provisionUser("u@test.com");
    const code = await auth.issueActivationCode(userId);
    await auth.redeemActivationCode(code);
    await expect(auth.redeemActivationCode(code)).rejects.toBeInstanceOf(AuthError);
  });

  it("iptal edilen cihaz artık doğrulanamaz", async () => {
    const userId = await auth.provisionUser("u@test.com");
    const code = await auth.issueActivationCode(userId);
    const redeemed = await auth.redeemActivationCode(code);
    await auth.revokeDevice(redeemed.deviceId);
    expect(await auth.authenticate(redeemed.deviceToken)).toBeNull();
  });

  it("süresi dolmuş kod reddedilir", async () => {
    const userId = await auth.provisionUser("u@test.com");
    const code = await auth.issueActivationCode(userId, -1);
    await expect(auth.redeemActivationCode(code)).rejects.toBeInstanceOf(AuthError);
  });

  it("boş veya uydurma token authenticate null döner", async () => {
    expect(await auth.authenticate("")).toBeNull();
    expect(await auth.authenticate("not-a-real-token")).toBeNull();
  });
});
