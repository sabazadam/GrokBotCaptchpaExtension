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

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: this.apiKey, ...body }),
    });
    if (!res.ok) {
      throw new CapsolverError(
        `Capsolver ${path} HTTP ${res.status}`,
        "error",
        `HTTP_${res.status}`,
      );
    }
    return (await res.json()) as T;
  }

  async getBalance(): Promise<number> {
    const data = await this.post<CapsolverGetBalanceResponse>("/getBalance", {});
    if (data.errorId !== 0) {
      throw new CapsolverError(
        data.errorDescription ?? "getBalance hatası",
        "error",
        data.errorCode ?? undefined,
      );
    }
    return data.balance ?? 0;
  }

  async createTask(task: CapsolverTask): Promise<CapsolverCreateTaskResponse> {
    const data = await this.post<CapsolverCreateTaskResponse>("/createTask", { task });
    if (data.errorId !== 0) {
      throw new CapsolverError(
        data.errorDescription ?? "createTask hatası",
        "error",
        data.errorCode ?? undefined,
      );
    }
    return data;
  }

  async getTaskResult(taskId: string): Promise<CapsolverGetTaskResultResponse> {
    const data = await this.post<CapsolverGetTaskResultResponse>("/getTaskResult", {
      taskId,
    });
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
  async solve(task: CapsolverTask): Promise<Record<string, unknown>> {
    const created = await this.createTask(task);

    if (created.solution && (created.status === "ready" || created.status === undefined)) {
      return created.solution;
    }

    const taskId = created.taskId;
    if (!taskId) {
      throw new CapsolverError("createTask taskId döndürmedi", "error");
    }

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      await this.sleep(this.pollIntervalMs);
      const result = await this.getTaskResult(taskId);
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
