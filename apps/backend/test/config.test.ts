import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("CAPSOLVER_API_KEY yoksa fırlatır", () => {
    expect(() => loadConfig({})).toThrow(/CAPSOLVER_API_KEY/);
  });

  it("DATABASE_URL olmadan gömülü DB yolunu kullanır", () => {
    const cfg = loadConfig({ CAPSOLVER_API_KEY: "k" });
    expect(cfg.databaseUrl).toBeUndefined();
    expect(cfg.embeddedDataDir).toBe("./.data/pglite");
    expect(cfg.port).toBe(3000);
    expect(cfg.limits).toEqual({ ratePerMinute: 30, maxConcurrent: 5, dailyMax: 5000 });
    expect(cfg.budget).toEqual({ windowMs: 60_000, maxSpend: 10_000 });
    expect(cfg.lemonSqueezy).toBeUndefined();
    expect(cfg.adminToken).toBeUndefined();
  });

  it("limit, bütçe, sağlayıcı ve ödeme env değerlerini okur", () => {
    const cfg = loadConfig({
      CAPSOLVER_API_KEY: "k",
      DATABASE_URL: "postgres://x",
      PORT: "8080",
      PGLITE_DATA_DIR: "/tmp/pg",
      LIMIT_RATE_PER_MINUTE: "10",
      LIMIT_MAX_CONCURRENT: "2",
      LIMIT_DAILY_MAX: "50",
      BUDGET_WINDOW_MS: "120000",
      BUDGET_MAX_SPEND: "99",
      ADMIN_TOKEN: "adm",
      ANTICAPTCHA_API_KEY: "ac",
      TWOCAPTCHA_API_KEY: "tc",
      PUBLIC_BACKEND_URL: "https://api.example.com",
      EXTENSION_URL: "https://store/x",
      LEMONSQUEEZY_SIGNING_SECRET: "sec",
      LEMONSQUEEZY_VARIANT_CREDITS: '{"111": 500, "bad": "nope"}',
    });
    expect(cfg.databaseUrl).toBe("postgres://x");
    expect(cfg.port).toBe(8080);
    expect(cfg.embeddedDataDir).toBe("/tmp/pg");
    expect(cfg.limits).toEqual({ ratePerMinute: 10, maxConcurrent: 2, dailyMax: 50 });
    expect(cfg.budget).toEqual({ windowMs: 120_000, maxSpend: 99 });
    expect(cfg.adminToken).toBe("adm");
    expect(cfg.providers.anticaptchaApiKey).toBe("ac");
    expect(cfg.providers.twocaptchaApiKey).toBe("tc");
    expect(cfg.onboarding).toEqual({
      publicBackendUrl: "https://api.example.com",
      extensionUrl: "https://store/x",
    });
    expect(cfg.lemonSqueezy).toEqual({
      signingSecret: "sec",
      variantCredits: { "111": 500 },
    });
  });

  it("geçersiz JSON variantCredits boş nesneye düşer", () => {
    const cfg = loadConfig({
      CAPSOLVER_API_KEY: "k",
      LEMONSQUEEZY_SIGNING_SECRET: "sec",
      LEMONSQUEEZY_VARIANT_CREDITS: "{not-json",
    });
    expect(cfg.lemonSqueezy?.variantCredits).toEqual({});
  });

  it("geçersiz sayısal env varsayılana düşer", () => {
    const cfg = loadConfig({ CAPSOLVER_API_KEY: "k", PORT: "nope", LIMIT_RATE_PER_MINUTE: "" });
    expect(cfg.port).toBe(3000);
    expect(cfg.limits.ratePerMinute).toBe(30);
  });
});
