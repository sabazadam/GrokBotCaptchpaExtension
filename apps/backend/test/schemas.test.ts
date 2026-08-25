import { describe, expect, it } from "vitest";
import {
  activateRequestSchema,
  adminActivationCodeSchema,
  adminCreditsSchema,
  solveRequestSchema,
} from "../src/http/schemas.js";
import { httpStatusForCode } from "../src/http/app.js";

describe("solveRequestSchema", () => {
  const base = {
    captchaType: "recaptcha_v3" as const,
    websiteURL: "https://example.com",
    websiteKey: "k",
  };

  it("minScore 0–1 aralığını doğrular", () => {
    expect(solveRequestSchema.safeParse({ ...base, minScore: 0 }).success).toBe(true);
    expect(solveRequestSchema.safeParse({ ...base, minScore: 0.7 }).success).toBe(true);
    expect(solveRequestSchema.safeParse({ ...base, minScore: 1 }).success).toBe(true);
    expect(solveRequestSchema.safeParse({ ...base, minScore: 1.1 }).success).toBe(false);
    expect(solveRequestSchema.safeParse({ ...base, minScore: -0.1 }).success).toBe(false);
  });

  it("bilinmeyen captchaType ve boş websiteURL reddeder", () => {
    expect(
      solveRequestSchema.safeParse({ captchaType: "hcaptcha", websiteURL: "https://e.com" }).success,
    ).toBe(false);
    expect(solveRequestSchema.safeParse({ captchaType: "recaptcha_v2", websiteURL: "" }).success).toBe(
      false,
    );
  });

  it("pageAction ve minScore olmadan reCAPTCHA v3 kabul eder", () => {
    expect(solveRequestSchema.safeParse(base).success).toBe(true);
  });
});

describe("activateRequestSchema", () => {
  it("boş aktivasyon kodunu reddeder", () => {
    expect(activateRequestSchema.safeParse({ activationCode: "" }).success).toBe(false);
    expect(activateRequestSchema.safeParse({ activationCode: "ABCD" }).success).toBe(true);
  });
});

describe("admin schemas", () => {
  it("geçersiz e-posta ve non-pozitif krediyi reddeder", () => {
    expect(adminCreditsSchema.safeParse({ email: "not-email", credits: 10 }).success).toBe(false);
    expect(adminCreditsSchema.safeParse({ email: "a@b.com", credits: 0 }).success).toBe(false);
    expect(adminCreditsSchema.safeParse({ email: "a@b.com", credits: -1 }).success).toBe(false);
    expect(adminCreditsSchema.safeParse({ email: "a@b.com", credits: 10 }).success).toBe(true);
  });

  it("expiresInMs pozitif tam sayı ister", () => {
    expect(
      adminActivationCodeSchema.safeParse({ email: "a@b.com", expiresInMs: 0 }).success,
    ).toBe(false);
    expect(
      adminActivationCodeSchema.safeParse({ email: "a@b.com", expiresInMs: 60_000 }).success,
    ).toBe(true);
  });
});

describe("httpStatusForCode", () => {
  it("API hata kodlarını doğru HTTP durumuna eşler", () => {
    expect(httpStatusForCode("unauthorized")).toBe(401);
    expect(httpStatusForCode("insufficient_credits")).toBe(402);
    expect(httpStatusForCode("rate_limited")).toBe(429);
    expect(httpStatusForCode("concurrency_limit")).toBe(429);
    expect(httpStatusForCode("daily_limit")).toBe(429);
    expect(httpStatusForCode("budget_circuit_open")).toBe(503);
    expect(httpStatusForCode("invalid_params")).toBe(400);
    expect(httpStatusForCode("unsupported_captcha_type")).toBe(400);
    expect(httpStatusForCode("capsolver_error")).toBe(502);
    expect(httpStatusForCode("capsolver_timeout")).toBe(502);
    expect(httpStatusForCode("internal_error")).toBe(500);
  });
});
