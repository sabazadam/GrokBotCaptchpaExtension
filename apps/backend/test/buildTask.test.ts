import { describe, it, expect } from "vitest";
import {
  CAPTCHA_REGISTRY,
  CAPTCHA_TYPE_IDS,
  DEFAULT_CREDIT_COSTS,
  type SolveRequest,
} from "@grokbot/shared";
import { buildCapsolverTask, BuildTaskError } from "../src/solve/buildTask.js";
import { normalizeSolution } from "../src/solve/solveService.js";

describe("registry integrity", () => {
  it("her CaptchaTypeId için spec ve kredi maliyeti tanımlı", () => {
    for (const id of CAPTCHA_TYPE_IDS) {
      expect(CAPTCHA_REGISTRY[id].id).toBe(id);
      expect(typeof DEFAULT_CREDIT_COSTS[id]).toBe("number");
    }
  });
});

describe("buildCapsolverTask", () => {
  it("reCAPTCHA v2 -> ReCaptchaV2TaskProxyLess", () => {
    const req: SolveRequest = {
      captchaType: "recaptcha_v2",
      websiteURL: "https://example.com",
      websiteKey: "6Lc-key",
    };
    const task = buildCapsolverTask(req);
    expect(task.type).toBe("ReCaptchaV2TaskProxyLess");
    expect(task["websiteKey"]).toBe("6Lc-key");
  });

  it("reCAPTCHA v2 enterprise -> EnterpriseProxyLess", () => {
    const task = buildCapsolverTask({
      captchaType: "recaptcha_v2",
      websiteURL: "https://example.com",
      websiteKey: "k",
      isEnterprise: true,
    });
    expect(task.type).toBe("ReCaptchaV2EnterpriseTaskProxyLess");
  });

  it("proxy verilince proxied varyant seçilir", () => {
    const task = buildCapsolverTask({
      captchaType: "recaptcha_v2",
      websiteURL: "https://example.com",
      websiteKey: "k",
      proxy: "http:1.2.3.4:8080:u:p",
    });
    expect(task.type).toBe("ReCaptchaV2Task");
    expect(task["proxy"]).toBe("http:1.2.3.4:8080:u:p");
  });

  it("reCAPTCHA v3 pageAction olmadan da kurulur (opsiyonel)", () => {
    const task = buildCapsolverTask({
      captchaType: "recaptcha_v3",
      websiteURL: "https://example.com",
      websiteKey: "k",
    });
    expect(task.type).toBe("ReCaptchaV3TaskProxyLess");
    expect(task["pageAction"]).toBeUndefined();
  });

  it("reCAPTCHA v3 websiteKey zorunlu", () => {
    expect(() =>
      buildCapsolverTask({ captchaType: "recaptcha_v3", websiteURL: "https://example.com" }),
    ).toThrowError(BuildTaskError);
  });

  it("Turnstile metadata action/cdata ekler", () => {
    const task = buildCapsolverTask({
      captchaType: "turnstile",
      websiteURL: "https://example.com",
      websiteKey: "0x4AAA",
      turnstileAction: "login",
      turnstileCdata: "abc",
    });
    expect(task.type).toBe("AntiTurnstileTaskProxyLess");
    expect(task["metadata"]).toEqual({ action: "login", cdata: "abc" });
  });

  it("GeeTest v3 gt+challenge ile kurulur", () => {
    const task = buildCapsolverTask({
      captchaType: "geetest",
      websiteURL: "https://example.com",
      geetest: { gt: "GT", challenge: "CH" },
    });
    expect(task.type).toBe("GeeTestTaskProxyLess");
    expect(task["gt"]).toBe("GT");
    expect(task["challenge"]).toBe("CH");
  });

  it("GeeTest parametresiz hata verir", () => {
    expect(() =>
      buildCapsolverTask({ captchaType: "geetest", websiteURL: "https://example.com" }),
    ).toThrowError(BuildTaskError);
  });

  it("ImageToText body ister", () => {
    const task = buildCapsolverTask({
      captchaType: "image_to_text",
      websiteURL: "https://example.com",
      imageBase64: "AAAA",
      ocrModule: "common",
    });
    expect(task.type).toBe("ImageToTextTask");
    expect(task["body"]).toBe("AAAA");
    expect(task["module"]).toBe("common");
  });

  it("Cloudflare Challenge proxy zorunlu", () => {
    expect(() =>
      buildCapsolverTask({
        captchaType: "cloudflare_challenge",
        websiteURL: "https://example.com",
      }),
    ).toThrowError(BuildTaskError);
  });

  it("AWS WAF websiteURL ile kurulur (proxyless)", () => {
    const task = buildCapsolverTask({ captchaType: "aws_waf", websiteURL: "https://x.com" });
    expect(task.type).toBe("AntiAwsWafTaskProxyLess");
    expect(task["websiteURL"]).toBe("https://x.com");
  });

  it("AWS WAF proxy verilince proxied varyant seçilir", () => {
    const task = buildCapsolverTask({
      captchaType: "aws_waf",
      websiteURL: "https://x.com",
      proxy: "http:1.2.3.4:8080:u:p",
    });
    expect(task.type).toBe("AntiAwsWafTask");
  });

  it("DataDome captchaUrl + userAgent + proxy ile kurulur", () => {
    const task = buildCapsolverTask({
      captchaType: "datadome",
      websiteURL: "https://site.com",
      captchaUrl: "https://geo.captcha-delivery.com/captcha/?t=fe",
      userAgent: "Mozilla/5.0",
      proxy: "1.2.3.4:8080:u:p",
    });
    expect(task.type).toBe("DatadomeSliderTask");
    expect(task["captchaUrl"]).toContain("captcha-delivery.com");
    expect(task["userAgent"]).toBe("Mozilla/5.0");
  });

  it("DataDome eksik proxy hata verir", () => {
    expect(() =>
      buildCapsolverTask({
        captchaType: "datadome",
        websiteURL: "https://site.com",
        captchaUrl: "https://geo.captcha-delivery.com/captcha/?t=fe",
        userAgent: "Mozilla/5.0",
      }),
    ).toThrowError(BuildTaskError);
  });

  it("desteklenmeyen tür hata kodu döner", () => {
    try {
      buildCapsolverTask({
        captchaType: "made_up" as SolveRequest["captchaType"],
        websiteURL: "https://example.com",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BuildTaskError);
      expect((err as BuildTaskError).code).toBe("unsupported_captcha_type");
    }
  });
});

describe("normalizeSolution", () => {
  it("reCAPTCHA token'ı gRecaptchaResponse'tan alır", () => {
    const s = normalizeSolution("recaptcha_v2", { gRecaptchaResponse: "TOK", userAgent: "x" });
    expect(s.token).toBe("TOK");
    expect(s.raw["userAgent"]).toBe("x");
  });

  it("Turnstile token'ı token alanından alır", () => {
    const s = normalizeSolution("turnstile", { token: "TT" });
    expect(s.token).toBe("TT");
  });

  it("token yoksa yalnızca raw döner", () => {
    const s = normalizeSolution("cloudflare_challenge", { cookies: { cf_clearance: "c" } });
    expect(s.token).toBeUndefined();
    expect(s.raw).toEqual({ cookies: { cf_clearance: "c" } });
  });
});
