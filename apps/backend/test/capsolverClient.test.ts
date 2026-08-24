import { describe, it, expect } from "vitest";
import { CapsolverClient, CapsolverError } from "../src/capsolver/client.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const noopSleep = (): Promise<void> => Promise.resolve();

describe("CapsolverClient.solve", () => {
  it("token görevinde createTask + polling ile çözüm döner", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/createTask")) {
        return jsonResponse({ errorId: 0, status: "idle", taskId: "task-1" });
      }
      // getTaskResult: önce processing, sonra ready
      if (calls.filter((c) => c.endsWith("/getTaskResult")).length < 2) {
        return jsonResponse({ errorId: 0, status: "processing" });
      }
      return jsonResponse({
        errorId: 0,
        status: "ready",
        solution: { gRecaptchaResponse: "TOKEN123" },
      });
    };

    const client = new CapsolverClient({
      apiKey: "k",
      fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    const solution = await client.solve({
      type: "ReCaptchaV2TaskProxyLess",
      websiteURL: "https://example.com",
      websiteKey: "site",
    });
    expect(solution["gRecaptchaResponse"]).toBe("TOKEN123");
  });

  it("recognition görevinde createTask sonucu doğrudan döner", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ errorId: 0, status: "ready", solution: { text: "abc123" } });
    const client = new CapsolverClient({ apiKey: "k", fetchImpl, sleepImpl: noopSleep });
    const solution = await client.solve({ type: "ImageToTextTask", body: "AAAA" });
    expect(solution["text"]).toBe("abc123");
  });

  it("createTask errorId!=0 ise CapsolverError fırlatır", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ errorId: 1, errorCode: "ERROR_KEY_DENIED", errorDescription: "bad key" });
    const client = new CapsolverClient({ apiKey: "k", fetchImpl, sleepImpl: noopSleep });
    await expect(
      client.solve({ type: "ReCaptchaV2TaskProxyLess", websiteURL: "u", websiteKey: "s" }),
    ).rejects.toBeInstanceOf(CapsolverError);
  });

  it("failed durumunda CapsolverError fırlatır", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/createTask")) {
        return jsonResponse({ errorId: 0, status: "idle", taskId: "t" });
      }
      return jsonResponse({ errorId: 0, status: "failed", errorDescription: "solve failed" });
    };
    const client = new CapsolverClient({
      apiKey: "k",
      fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    await expect(
      client.solve({ type: "ReCaptchaV2TaskProxyLess", websiteURL: "u", websiteKey: "s" }),
    ).rejects.toBeInstanceOf(CapsolverError);
  });

  it("timeout durumunda kind=timeout hatası fırlatır", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/createTask")) {
        return jsonResponse({ errorId: 0, status: "idle", taskId: "t" });
      }
      return jsonResponse({ errorId: 0, status: "processing" });
    };
    const client = new CapsolverClient({
      apiKey: "k",
      fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
      timeoutMs: 5,
    });
    try {
      await client.solve({ type: "ReCaptchaV2TaskProxyLess", websiteURL: "u", websiteKey: "s" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CapsolverError);
      expect((err as CapsolverError).kind).toBe("timeout");
    }
  });
});
