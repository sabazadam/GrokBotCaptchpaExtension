import type {
  CapsolverCreateTaskResponse,
  CapsolverGetBalanceResponse,
  CapsolverGetTaskResultResponse,
  CapsolverTask,
} from "./types.js";

export type CapsolverErrorKind = "error" | "timeout";

/** Capsolver kaynaklı hatalar. `kind === "timeout"` ise çözüm zaman aşımına uğradı. */
export class CapsolverError extends Error {
  readonly kind: CapsolverErrorKind;
  readonly code: string | undefined;

  constructor(message: string, kind: CapsolverErrorKind, code?: string) {
    super(message);
    this.name = "CapsolverError";
    this.kind = kind;
    this.code = code;
  }
}

export interface CapsolverClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** getTaskResult çağrıları arası bekleme (ms). */
  pollIntervalMs?: number;
  /** Bir görevin çözülmesi için toplam üst sınır (ms). */
  timeoutMs?: number;
  /** Test için enjekte edilebilir fetch. */
  fetchImpl?: typeof fetch;
  /** Test için enjekte edilebilir sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_URL = "https://api.capsolver.com";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/**
 * Capsolver REST istemcisi. Yalnızca backend'de kullanılır — API anahtarı asla
 * eklentiye/istemciye gönderilmez.
 */
export class CapsolverClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: CapsolverClientOptions) {
    if (!options.apiKey) {
      throw new Error("CapsolverClient: apiKey gerekli");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
  }

  private requestTimeoutMs(): number {
    return Math.min(MAX_REQUEST_TIMEOUT_MS, Math.max(this.timeoutMs, 1));
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      throw new CapsolverError("istek iptal edildi", "timeout");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs());
    const onParentAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onParentAbort);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, clientKey: this.apiKey }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new CapsolverError(
          `Capsolver ${path} HTTP ${res.status}`,
          "error",
          `HTTP_${res.status}`,
        );
      }
      try {
        return (await res.json()) as T;
      } catch {
        throw new CapsolverError(`Capsolver ${path} geçersiz JSON`, "error");
      }
    } catch (err) {
      if (err instanceof CapsolverError) throw err;
      if (isAbortError(err)) {
        throw new CapsolverError("istek zaman aşımı veya iptal", "timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onParentAbort);
    }
  }

  private async wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new CapsolverError("istek iptal edildi", "timeout");
    if (!signal) {
      await this.sleep(ms);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        cleanup();
        reject(new CapsolverError("istek iptal edildi", "timeout"));
      };
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort);
      void this.sleep(ms).then(
        () => {
          cleanup();
          resolve();
        },
        (err: unknown) => {
          cleanup();
          reject(err);
        },
      );
    });
  }

  async getBalance(signal?: AbortSignal): Promise<number> {
    const data = await this.post<CapsolverGetBalanceResponse>("/getBalance", {}, signal);
    if (data.errorId !== 0) {
      throw new CapsolverError(
        data.errorDescription ?? "getBalance hatası",
        "error",
        data.errorCode ?? undefined,
      );
    }
    return data.balance ?? 0;
  }

  async createTask(
    task: CapsolverTask,
    signal?: AbortSignal,
  ): Promise<CapsolverCreateTaskResponse> {
    const data = await this.post<CapsolverCreateTaskResponse>("/createTask", { task }, signal);
    if (data.errorId !== 0) {
      throw new CapsolverError(
        data.errorDescription ?? "createTask hatası",
        "error",
        data.errorCode ?? undefined,
      );
    }
    return data;
  }

  async getTaskResult(
    taskId: string | number,
    signal?: AbortSignal,
  ): Promise<CapsolverGetTaskResultResponse> {
    const data = await this.post<CapsolverGetTaskResultResponse>(
      "/getTaskResult",
      { taskId },
      signal,
    );
    if (data.errorId !== 0) {
      throw new CapsolverError(
        data.errorDescription ?? "getTaskResult hatası",
        "error",
        data.errorCode ?? undefined,
      );
    }
    return data;
  }

  /**
   * Görevi oluşturur ve çözülene kadar bekler.
   * - Recognition görevleri (ör. ImageToTextTask) createTask sonucunu doğrudan döndürür.
   * - Token görevleri ready/failed olana ya da timeout'a kadar getTaskResult ile beklenir.
   */
  async solve(task: CapsolverTask, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const created = await this.createTask(task, signal);

    if (created.solution && (created.status === "ready" || created.status === undefined)) {
      return created.solution;
    }

    const taskId = created.taskId;
    if (taskId === undefined || taskId === null || taskId === "") {
      throw new CapsolverError("createTask taskId döndürmedi", "error");
    }

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      await this.wait(this.pollIntervalMs, signal);
      const result = await this.getTaskResult(taskId, signal);
      if (result.status === "ready" && result.solution) {
        return result.solution;
      }
      if (result.status === "failed") {
        throw new CapsolverError(
          result.errorDescription ?? "Görev başarısız",
          "error",
          result.errorCode ?? undefined,
        );
      }
    }

    throw new CapsolverError(
      `Çözüm ${this.timeoutMs}ms içinde tamamlanmadı`,
      "timeout",
    );
  }
}
