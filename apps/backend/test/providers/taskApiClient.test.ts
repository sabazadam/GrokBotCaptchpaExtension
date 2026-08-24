import { describe, expect, it } from "vitest";
import { TaskApiClient, TaskApiError } from "../../src/providers/taskApiClient.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
const noopSleep = (): Promise<void> => Promise.resolve();

describe("TaskApiClient", () => {
  it("createTask + polling ile çözüm döner", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/createTask")) return json({ errorId: 0, taskId: "t1" });
      calls++;
      if (calls < 2) return json({ errorId: 0, status: "processing" });
      return json({ errorId: 0, status: "ready", solution: { gRecaptchaResponse: "TOK" } });
    };
    const client = new TaskApiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
      fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    const solution = await client.solve({ type: "RecaptchaV2TaskProxyless" });
    expect(solution["gRecaptchaResponse"]).toBe("TOK");
  });

  it("createTask errorId!=0 -> TaskApiError", async () => {
    const fetchImpl: typeof fetch = async () =>
      json({ errorId: 1, errorCode: "ERROR_KEY_DOES_NOT_EXIST", errorDescription: "bad key" });
    const client = new TaskApiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
      fetchImpl,
      sleepImpl: noopSleep,
    });
    await expect(client.solve({ type: "x" })).rejects.toBeInstanceOf(TaskApiError);
  });

  it("timeout -> kind=timeout", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/createTask")) return json({ errorId: 0, taskId: "t1" });
      return json({ errorId: 0, status: "processing" });
    };
    const client = new TaskApiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
      fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
      timeoutMs: 5,
    });
    try {
      await client.solve({ type: "x" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TaskApiError);
      expect((err as TaskApiError).kind).toBe("timeout");
    }
  });

  it("softId gövdeye eklenir", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/createTask")) {
        capturedBody = JSON.parse(String(init?.body));
        return json({ errorId: 0, taskId: "t1" });
      }
      return json({ errorId: 0, status: "ready", solution: { token: "T" } });
    };
    const client = new TaskApiClient({
      apiKey: "secret",
      baseUrl: "https://api.example.com",
      fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
      softId: 1234,
    });
    await client.solve({ type: "TurnstileTaskProxyless" });
    expect(capturedBody["clientKey"]).toBe("secret");
    expect(capturedBody["softId"]).toBe(1234);
  });

  it("sayısal taskId kabul edilir ve getTaskResult'a aynen gider", async () => {
    let polledId: unknown;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/createTask")) return json({ errorId: 0, taskId: 74069493922 });
      polledId = JSON.parse(String(init?.body)).taskId;
      return json({ errorId: 0, status: "ready", solution: { token: "T" } });
    };
    const client = new TaskApiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
      fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    const solution = await client.solve({ type: "x" });
    expect(polledId).toBe(74069493922);
    expect(solution["token"]).toBe("T");
  });

  it("gövdedeki clientKey apiKey'i ezemez", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/createTask")) {
        capturedBody = JSON.parse(String(init?.body));
        return json({ errorId: 0, taskId: "t1" });
      }
      return json({ errorId: 0, status: "ready", solution: { token: "T" } });
    };
    const client = new TaskApiClient({
      apiKey: "real-secret",
      baseUrl: "https://api.example.com",
      fetchImpl,
      sleepImpl: noopSleep,
      pollIntervalMs: 1,
    });
    await client.solve({ type: "x", clientKey: "attacker" });
    expect(capturedBody["clientKey"]).toBe("real-secret");
  });

  it("iptal edilmiş AbortSignal -> kind=timeout", async () => {
    const ac = new AbortController();
    ac.abort();
    const client = new TaskApiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
      fetchImpl: async () => json({ errorId: 0, taskId: "t1" }),
      sleepImpl: noopSleep,
    });
    try {
      await client.solve({ type: "x" }, ac.signal);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TaskApiError);
      expect((err as TaskApiError).kind).toBe("timeout");
    }
  });
});
