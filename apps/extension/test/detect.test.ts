// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { detectCaptchas, toSolveRequest } from "../src/lib/detect.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("detectCaptchas", () => {
  it("Cloudflare Turnstile'ı sitekey ve action ile tespit eder", () => {
    document.body.innerHTML =
      '<div class="cf-turnstile" data-sitekey="0xAAA" data-action="login"></div>';
    const found = detectCaptchas(document);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      type: "turnstile",
      websiteKey: "0xAAA",
      turnstileAction: "login",
    });
  });

  it("reCAPTCHA v2 widget'ını tespit eder", () => {
    document.body.innerHTML = '<div class="g-recaptcha" data-sitekey="6Lc-v2"></div>';
    const found = detectCaptchas(document);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "recaptcha_v2", websiteKey: "6Lc-v2" });
  });

  it("reCAPTCHA v2'yi iframe üzerinden (k parametresi) tespit eder", () => {
    document.body.innerHTML =
      '<iframe src="https://www.google.com/recaptcha/api2/anchor?ar=1&k=IFRAME_KEY&co=abc"></iframe>';
    const found = detectCaptchas(document);
    expect(found.some((c) => c.type === "recaptcha_v2" && c.websiteKey === "IFRAME_KEY")).toBe(
      true,
    );
  });

  it("reCAPTCHA v3'ü api.js?render ile tespit eder (sahte pageAction uydurmaz)", () => {
    document.body.innerHTML =
      '<script src="https://www.google.com/recaptcha/api.js?render=V3_SITEKEY"></script>';
    const found = detectCaptchas(document);
    const v3 = found.find((c) => c.type === "recaptcha_v3" && c.websiteKey === "V3_SITEKEY");
    expect(v3).toBeDefined();
    expect(v3?.pageAction).toBeUndefined();
  });

  it("render=explicit v3 olarak sayılmaz", () => {
    document.body.innerHTML =
      '<script src="https://www.google.com/recaptcha/api.js?render=explicit"></script>';
    const found = detectCaptchas(document);
    expect(found.some((c) => c.type === "recaptcha_v3")).toBe(false);
  });

  it("toSolveRequest alanları doğru eşler", () => {
    const req = toSolveRequest(
      { type: "recaptcha_v3", websiteKey: "K", pageAction: "checkout" },
      "https://site.com/pay",
    );
    expect(req).toEqual({
      captchaType: "recaptcha_v3",
      websiteURL: "https://site.com/pay",
      websiteKey: "K",
      pageAction: "checkout",
      idempotencyKey: "https://site.com:recaptcha_v3:K",
    });
  });

  it("Turnstile action'ı pageAction değil turnstileAction olarak eşler", () => {
    const fromPageAction = toSolveRequest(
      { type: "turnstile", websiteKey: "0xAAA", pageAction: "login" },
      "https://site.com",
    );
    expect(fromPageAction).toEqual({
      captchaType: "turnstile",
      websiteURL: "https://site.com",
      websiteKey: "0xAAA",
      turnstileAction: "login",
      idempotencyKey: "https://site.com:turnstile:0xAAA",
    });
    const fromField = toSolveRequest(
      { type: "turnstile", websiteKey: "0xAAA", turnstileAction: "login" },
      "https://site.com/login",
    );
    expect(fromField.turnstileAction).toBe("login");
    expect(fromField.pageAction).toBeUndefined();
  });
});
