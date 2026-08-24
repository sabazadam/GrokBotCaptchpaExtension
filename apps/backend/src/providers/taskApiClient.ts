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
  taskId?: string;
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
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: this.options.apiKey, ...body }),
    });
    if (!res.ok) {
      throw new TaskApiError(`${path} HTTP ${res.status}`, "error", `HTTP_${res.status}`);
    }
    return (await res.json()) as T;
  }

  async getBalance(): Promise<number> {
    const data = await this.post<{ errorId: number; balance?: number; errorCode?: string | null }>(
      "/getBalance",
      {},
    );
    if (data.errorId !== 0) {
      throw new TaskApiError("getBalance hatası", "error", data.errorCode ?? undefined);
    }
    return data.balance ?? 0;
  }

  async solve(task: Record<string, unknown>): Promise<Record<string, unknown>> {
    const createBody: Record<string, unknown> = { task };
    if (this.options.softId !== undefined) createBody["softId"] = this.options.softId;

    const created = await this.post<CreateTaskResponse>("/createTask", createBody);
    if (created.errorId !== 0) {
      throw new TaskApiError(
        created.errorDescription ?? "createTask hatası",
        "error",
        created.errorCode ?? undefined,
      );
    }
    const taskId = created.taskId;
    if (!taskId) throw new TaskApiError("createTask taskId döndürmedi", "error");

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      await this.sleep(this.pollIntervalMs);
      const result = await this.post<GetTaskResultResponse>("/getTaskResult", { taskId });
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
