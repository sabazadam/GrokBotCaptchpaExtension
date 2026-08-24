// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { injectSolution } from "../src/lib/inject.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("injectSolution", () => {
  it("reCAPTCHA için g-recaptcha-response textarea'sını oluşturur ve doldurur", () => {
    const ok = injectSolution("recaptcha_v2", "TOKEN123", document);
    expect(ok).toBe(true);
    const ta = document.getElementById("g-recaptcha-response") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe("TOKEN123");
  });

  it("var olan g-recaptcha-response alanını doldurur", () => {
    document.body.innerHTML = '<textarea name="g-recaptcha-response"></textarea>';
    const ok = injectSolution("recaptcha_v2", "TOK", document);
    expect(ok).toBe(true);
    const el = document.querySelector<HTMLTextAreaElement>('[name="g-recaptcha-response"]');
    expect(el?.value).toBe("TOK");
  });

  it("Turnstile için cf-turnstile-response alanını doldurur", () => {
    document.body.innerHTML = '<input name="cf-turnstile-response" />';
    const ok = injectSolution("turnstile", "TT", document);
    expect(ok).toBe(true);
    const el = document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
    expect(el?.value).toBe("TT");
  });

  it("desteklenmeyen tür için false döner", () => {
    expect(injectSolution("cloudflare_challenge", "x", document)).toBe(false);
  });
});
