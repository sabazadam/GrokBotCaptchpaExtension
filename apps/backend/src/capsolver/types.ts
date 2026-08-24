/** Capsolver `createTask` gövdesindeki task nesnesi (türe göre değişen alanlar içerir). */
export interface CapsolverTask {
  type: string;
  [key: string]: unknown;
}

export interface CapsolverCreateTaskResponse {
  errorId: number;
  errorCode?: string | null;
  errorDescription?: string | null;
  taskId?: string;
  /** Recognition görevleri (ör. ImageToTextTask) sonucu doğrudan burada döndürür. */
  status?: CapsolverTaskStatus;
  solution?: Record<string, unknown>;
}

export type CapsolverTaskStatus = "idle" | "processing" | "ready" | "failed";

export interface CapsolverGetTaskResultResponse {
  errorId: number;
  errorCode?: string | null;
  errorDescription?: string | null;
  taskId?: string;
  status?: CapsolverTaskStatus;
  solution?: Record<string, unknown>;
}

export interface CapsolverGetBalanceResponse {
  errorId: number;
  errorCode?: string | null;
  errorDescription?: string | null;
  balance?: number;
}
