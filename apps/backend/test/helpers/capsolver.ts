import { CapsolverClient } from "../../src/capsolver/client.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const noopSleep = (): Promise<void> => Promise.resolve();

/** createTask'i doğrudan çözümle yanıtlayan sahte istemci. */
export function successClient(
  solution: Record<string, unknown> = { gRecaptchaResponse: "TOKEN" },
): CapsolverClient {
  const fetchImpl: typeof fetch = async () =>
    json({ errorId: 0, status: "ready", solution });
  return new CapsolverClient({ apiKey: "k", fetchImpl, sleepImpl: noopSleep, pollIntervalMs: 1 });
}

/** createTask'te hata döndüren sahte istemci. */
export function failingClient(): CapsolverClient {
  const fetchImpl: typeof fetch = async () =>
    json({ errorId: 1, errorCode: "ERROR_CAPTCHA_UNSOLVABLE", errorDescription: "unsolvable" });
  return new CapsolverClient({ apiKey: "k", fetchImpl, sleepImpl: noopSleep, pollIntervalMs: 1 });
}
