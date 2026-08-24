import { afterEach, describe, expect, it, vi } from "vitest";
import { apiActivate, apiBalance, apiSolve } from "../src/lib/apiClient.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiClient", () => {
  it("apiActivate /v1/activate'e POST atar", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ deviceToken: "dt", userId: "u", remainingCredits: 0 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiActivate("https://api.test", "CODE-1", "bot");
    expect(res.deviceToken).toBe("dt");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.test/v1/activate");
    expect(JSON.parse(String(init?.body))).toEqual({
      activationCode: "CODE-1",
      deviceLabel: "bot",
    });
  });

  it("apiSolve Authorization başlığı gönderir", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        jsonResponse({
          status: "solved",
          solveId: "s",
          captchaType: "turnstile",
          solution: { token: "T" },
          costCredits: 1,
          remainingCredits: 4,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiSolve("https://api.test", "device-token", {
      captchaType: "turnstile",
      websiteURL: "https://site.com",
      websiteKey: "k",
    });
    expect(res.status).toBe("solved");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.test/v1/solve");
    const headers = init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer device-token");
  });

  it("apiBalance kalan krediyi döner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ remainingCredits: 42, userId: "u" })),
    );
    const res = await apiBalance("https://api.test", "device-token");
    expect(res.remainingCredits).toBe(42);
  });
});
