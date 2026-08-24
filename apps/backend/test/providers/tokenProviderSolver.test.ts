import { describe, expect, it } from "vitest";
import type { SolveRequest } from "@grokbot/shared";
import {
  ANTI_CAPTCHA_CONFIG,
  TWO_CAPTCHA_CONFIG,
  TokenProviderSolver,
} from "../../src/providers/tokenProviderSolver.js";
import { SolverError } from "../../src/providers/types.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
const noopSleep = (): Promise<void> => Promise.resolve();

/** createTask gövdesini yakalayan ve verilen çözümü dönen sahte fetch. */
function capturingFetch(solution: Record<string, unknown>): {
  fetchImpl: typeof fetch;
  lastTask: () => Record<string, unknown>;
} {
  let task: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/createTask")) {
      const body = JSON.parse(String(init?.body)) as { task: Record<string, unknown> };
      task = body.task;
      return json({ errorId: 0, taskId: "t1" });
    }
    return json({ errorId: 0, status: "ready", solution });
  };
  return { fetchImpl, lastTask: () => task };
}

describe("TokenProviderSolver (Anti-Captcha)", () => {
  it("reCAPTCHA v2 task tipini ve token'ı doğru kurar", async () => {
    const cap = capturingFetch({ gRecaptchaResponse: "GTOKEN" });
    const solver = new TokenProviderSolver(ANTI_CAPTCHA_CONFIG, {
      apiKey: "k",
      fetchImpl: cap.fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    const req: SolveRequest = {
      captchaType: "recaptcha_v2",
      websiteURL: "https://site.com",
      websiteKey: "6Lc",
    };
    const solution = await solver.solve(req);
    expect(cap.lastTask()["type"]).toBe("RecaptchaV2TaskProxyless");
    expect(cap.lastTask()["websiteKey"]).toBe("6Lc");
    expect(solution.token).toBe("GTOKEN");
  });

  it("reCAPTCHA v3 minScore ve pageAction ile kurar (varsayılan 0.3)", async () => {
    const cap = capturingFetch({ gRecaptchaResponse: "GTOKEN" });
    const solver = new TokenProviderSolver(ANTI_CAPTCHA_CONFIG, {
      apiKey: "k",
      fetchImpl: cap.fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    await solver.solve({
      captchaType: "recaptcha_v3",
      websiteURL: "https://site.com",
      websiteKey: "6Lc",
      pageAction: "login",
    });
    expect(cap.lastTask()["type"]).toBe("RecaptchaV3TaskProxyless");
    expect(cap.lastTask()["minScore"]).toBe(0.3);
    expect(cap.lastTask()["pageAction"]).toBe("login");
  });

  it("reCAPTCHA v3 minScore 0.5 -> 0.7 (eşit mesafede yüksek)", async () => {
    const cap = capturingFetch({ gRecaptchaResponse: "GTOKEN" });
    const solver = new TokenProviderSolver(ANTI_CAPTCHA_CONFIG, {
      apiKey: "k",
      fetchImpl: cap.fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    await solver.solve({
      captchaType: "recaptcha_v3",
      websiteURL: "https://site.com",
      websiteKey: "6Lc",
      pageAction: "login",
      minScore: 0.5,
    });
    expect(cap.lastTask()["minScore"]).toBe(0.7);
  });

  it("reCAPTCHA v2 enterprise task tipini seçer", async () => {
    const cap = capturingFetch({ gRecaptchaResponse: "GTOKEN" });
    const solver = new TokenProviderSolver(ANTI_CAPTCHA_CONFIG, {
      apiKey: "k",
      fetchImpl: cap.fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    await solver.solve({
      captchaType: "recaptcha_v2",
      websiteURL: "https://site.com",
      websiteKey: "6Lc",
      isEnterprise: true,
    });
    expect(cap.lastTask()["type"]).toBe("RecaptchaV2EnterpriseTaskProxyless");
  });

  it("Turnstile cData'yı Anti-Captcha adıyla (cData) gönderir", async () => {
    const cap = capturingFetch({ token: "TT" });
    const solver = new TokenProviderSolver(ANTI_CAPTCHA_CONFIG, {
      apiKey: "k",
      fetchImpl: cap.fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    const solution = await solver.solve({
      captchaType: "turnstile",
      websiteURL: "https://site.com",
      websiteKey: "0x4",
      turnstileAction: "managed",
      turnstileCdata: "cdata-val",
    });
    expect(cap.lastTask()["type"]).toBe("TurnstileTaskProxyless");
    expect(cap.lastTask()["action"]).toBe("managed");
    expect(cap.lastTask()["cData"]).toBe("cdata-val");
    expect(solution.token).toBe("TT");
  });

  it("desteklenmeyen tür -> SolverError(unsupported)", async () => {
    const solver = new TokenProviderSolver(ANTI_CAPTCHA_CONFIG, { apiKey: "k" });
    try {
      await solver.solve({
        captchaType: "datadome",
        websiteURL: "https://site.com",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SolverError);
      expect((err as SolverError).kind).toBe("unsupported");
    }
  });
});

describe("TokenProviderSolver (2Captcha)", () => {
  it("Turnstile cData'yı 2Captcha adıyla (data) gönderir", async () => {
    const cap = capturingFetch({ token: "TT" });
    const solver = new TokenProviderSolver(TWO_CAPTCHA_CONFIG, {
      apiKey: "k",
      fetchImpl: cap.fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    await solver.solve({
      captchaType: "turnstile",
      websiteURL: "https://site.com",
      websiteKey: "0x4",
      turnstileCdata: "cdata-val",
    });
    expect(cap.lastTask()["data"]).toBe("cdata-val");
    expect(cap.lastTask()["cData"]).toBeUndefined();
  });
});
