import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMessage } from "../src/lib/handler.js";
import type { Settings } from "../src/lib/storage.js";
import type { StatusReply } from "../src/lib/messages.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const enabledWithToken: Settings = {
  backendUrl: "https://api.test",
  deviceToken: "dt",
  enabled: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleMessage", () => {
  it("status: token varsa bakiyeyi getirir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ remainingCredits: 7, userId: "u" })),
    );
    const reply = (await handleMessage({ kind: "status" }, enabledWithToken)) as StatusReply;
    expect(reply.hasToken).toBe(true);
    expect(reply.remainingCredits).toBe(7);
  });

  it("status: bakiye isteği başarısızsa kredi null kalır", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const reply = (await handleMessage({ kind: "status" }, enabledWithToken)) as StatusReply;
    expect(reply.hasToken).toBe(true);
    expect(reply.remainingCredits).toBeNull();
  });

  it("status: token yoksa kredi null", async () => {
    const reply = (await handleMessage(
      { kind: "status" },
      { backendUrl: "https://api.test", deviceToken: null, enabled: true },
    )) as StatusReply;
    expect(reply.hasToken).toBe(false);
    expect(reply.remainingCredits).toBeNull();
  });

  it("solve: devre dışıysa unauthorized", async () => {
    const res = await handleMessage(
      { kind: "solve", request: { captchaType: "turnstile", websiteURL: "u", websiteKey: "k" } },
      { ...enabledWithToken, enabled: false },
    );
    expect(res).toMatchObject({ status: "error", code: "unauthorized" });
  });

  it("solve: token yoksa unauthorized", async () => {
    const res = await handleMessage(
      { kind: "solve", request: { captchaType: "turnstile", websiteURL: "u", websiteKey: "k" } },
      { ...enabledWithToken, deviceToken: null },
    );
    expect(res).toMatchObject({ status: "error", code: "unauthorized" });
  });

  it("solve: backend'e iletir ve çözümü döner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "solved",
          solveId: "s",
          captchaType: "turnstile",
          solution: { token: "T" },
          costCredits: 1,
          remainingCredits: 3,
        }),
      ),
    );
    const res = await handleMessage(
      { kind: "solve", request: { captchaType: "turnstile", websiteURL: "u", websiteKey: "k" } },
      enabledWithToken,
    );
    expect(res).toMatchObject({ status: "solved" });
  });
});
