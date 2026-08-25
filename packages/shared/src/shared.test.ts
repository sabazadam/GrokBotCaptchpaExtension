import { describe, expect, it } from "vitest";
import {
  CAPTCHA_TYPE_IDS,
  DEFAULT_CREDIT_COSTS,
  getCaptchaSpec,
  isCaptchaTypeId,
  isRefundable,
} from "./index.js";

describe("isCaptchaTypeId", () => {
  it("kayıtlı türleri kabul eder, bilinmeyenleri reddeder", () => {
    expect(isCaptchaTypeId("recaptcha_v2")).toBe(true);
    expect(isCaptchaTypeId("datadome")).toBe(true);
    expect(isCaptchaTypeId("hcaptcha")).toBe(false);
    expect(isCaptchaTypeId("")).toBe(false);
  });
});

describe("getCaptchaSpec", () => {
  it("her id için eşleşen spec döner", () => {
    for (const id of CAPTCHA_TYPE_IDS) {
      const spec = getCaptchaSpec(id);
      expect(spec.id).toBe(id);
      expect(spec.capsolverTaskTypes.proxyless.length).toBeGreaterThan(0);
    }
  });
});

describe("isRefundable", () => {
  it("yalnızca çözüm/sağlayıcı hatalarında iade edilir", () => {
    expect(isRefundable("capsolver_error")).toBe(true);
    expect(isRefundable("capsolver_timeout")).toBe(true);
    expect(isRefundable("internal_error")).toBe(true);
    expect(isRefundable("insufficient_credits")).toBe(false);
    expect(isRefundable("invalid_params")).toBe(false);
    expect(isRefundable("unauthorized")).toBe(false);
    expect(isRefundable("rate_limited")).toBe(false);
    expect(isRefundable("budget_circuit_open")).toBe(false);
  });
});

describe("DEFAULT_CREDIT_COSTS", () => {
  it("her tür için pozitif tam sayı maliyeti vardır", () => {
    for (const id of CAPTCHA_TYPE_IDS) {
      expect(DEFAULT_CREDIT_COSTS[id]).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_CREDIT_COSTS[id])).toBe(true);
    }
  });
});
