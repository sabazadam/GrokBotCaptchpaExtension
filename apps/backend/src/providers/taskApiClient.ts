export type TaskApiErrorKind = "timeout" | "error";

export class TaskApiError extends Error {
  readonly kind: TaskApiErrorKind;
  readonly code: string | undefined;
  constructor(message: string, kind: TaskApiErrorKind, code?: string) {
    super(message);
    this.name = "TaskApiError";
    this.kind = kind;
    this.code = code;
  }
}

interface CreateTaskResponse {
  errorId: number;
  errorCode?: string | null;
  errorDescription?: string | null;
  /** Anti-Captcha/2Captcha sayı, bazı uyumlu API'ler dize döndürür. */
  taskId?: string | number;
}

interface GetTaskResultResponse {
  errorId: number;
  errorCode?: string | null;
  errorDescription?: string | null;
  status?: string;
  solution?: Record<string, unknown>;
}

export interface TaskApiClientOptions {
  apiKey: string;
  baseUrl: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** İş ortağı komisyonu için opsiyonel softId (Anti-Captcha/2Captcha). */
  softId?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 120_000;
/** Tek HTTP çağrısı için üst sınır — asılı soketlerin poll döngüsünü kilitlemesini önler. */
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/**
 * Anti-Captcha uyumlu JSON API istemcisi (Anti-Captcha ve 2Captcha aynı şemayı kullanır):
 * createTask -> getTaskResult polling. clientKey gövdede gönderilir (anahtar sunucuda kalır).
 */
export class TaskApiClient {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: TaskApiClientOptions) {
    if (!options.apiKey) throw new Error("TaskApiClient: apiKey gerekli");
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
      throw new TaskApiError("istek iptal edildi", "timeout");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs());
    const onParentAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onParentAbort);
    try {
      const res = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // clientKey sona yazılır; gövde anahtarı ezemez.
        body: JSON.stringify({ ...body, clientKey: this.options.apiKey }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new TaskApiError(`${path} HTTP ${res.status}`, "error", `HTTP_${res.status}`);
      }
      try {
        return (await res.json()) as T;
      } catch {
        throw new TaskApiError(`${path} geçersiz JSON`, "error");
      }
    } catch (err) {
      if (err instanceof TaskApiError) throw err;
      if (isAbortError(err)) {
        throw new TaskApiError("istek zaman aşımı veya iptal", "timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onParentAbort);
    }
  }

  private async wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new TaskApiError("istek iptal edildi", "timeout");
    if (!signal) {
      await this.sleep(ms);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        cleanup();
        reject(new TaskApiError("istek iptal edildi", "timeout"));
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
    const data = await this.post<{ errorId: number; balance?: number; errorCode?: string | null }>(
      "/getBalance",
      {},
      signal,
    );
    if (data.errorId !== 0) {
      throw new TaskApiError("getBalance hatası", "error", data.errorCode ?? undefined);
    }
    return data.balance ?? 0;
  }

  async solve(task: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const createBody: Record<string, unknown> = { task };
    if (this.options.softId !== undefined) createBody["softId"] = this.options.softId;

    const created = await this.post<CreateTaskResponse>("/createTask", createBody, signal);
    if (created.errorId !== 0) {
      throw new TaskApiError(
        created.errorDescription ?? "createTask hatası",
        "error",
        created.errorCode ?? undefined,
      );
    }
    const taskId = created.taskId;
    if (taskId === undefined || taskId === null || taskId === "") {
      throw new TaskApiError("createTask taskId döndürmedi", "error");
    }

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      await this.wait(this.pollIntervalMs, signal);
      const result = await this.post<GetTaskResultResponse>(
        "/getTaskResult",
        { taskId },
        signal,
      );
      if (result.errorId !== 0) {
        throw new TaskApiError(
          result.errorDescription ?? "getTaskResult hatası",
          "error",
          result.errorCode ?? undefined,
        );
      }
      if (result.status === "ready" && result.solution) {
        return result.solution;
      }
    }
    throw new TaskApiError(`Çözüm ${this.timeoutMs}ms içinde tamamlanmadı`, "timeout");
  }
}
