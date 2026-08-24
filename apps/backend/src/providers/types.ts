import type { CaptchaTypeId, NormalizedSolution, SolveRequest } from "@grokbot/shared";

export type SolverErrorKind = "timeout" | "error" | "unsupported";

/** Tüm sağlayıcı adaptörlerinin fırlattığı birleşik hata türü. */
export class SolverError extends Error {
  readonly kind: SolverErrorKind;
  readonly provider: string;
  readonly code: string | undefined;
  /** Fallback'te tüm sağlayıcılar başarısız olduğunda toplanan alt hatalar. */
  readonly causes: SolverError[];

  constructor(
    message: string,
    kind: SolverErrorKind,
    provider: string,
    code?: string,
    causes: SolverError[] = [],
  ) {
    super(message);
    this.name = "SolverError";
    this.kind = kind;
    this.provider = provider;
    this.code = code;
    this.causes = causes;
  }
}

/**
 * Tüm CAPTCHA çözüm sağlayıcılarının ortak arayüzü.
 * Yeni bir sağlayıcı eklemek = bu arayüzü uygulayan bir sınıf yazıp fallback zincirine
 * eklemektir. Sağlayıcıya özgü API anahtarları yalnızca adaptörün içinde yaşar.
 */
export interface CaptchaSolver {
  readonly name: string;
  /** Bu sağlayıcının verilen CAPTCHA türünü destekleyip desteklemediği. */
  supports(type: CaptchaTypeId): boolean;
  /** CAPTCHA'yı çözer; başarısızlıkta SolverError fırlatır. */
  solve(input: SolveRequest, signal?: AbortSignal): Promise<NormalizedSolution>;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** Bilinmeyen bir hatayı SolverError'a normalize eder. */
export function toSolverError(err: unknown, provider: string): SolverError {
  if (err instanceof SolverError) return err;
  if (isAbortError(err)) {
    return new SolverError((err as Error).message || "iptal edildi", "timeout", provider);
  }
  if (err instanceof Error) {
    return new SolverError(err.message, "error", provider);
  }
  return new SolverError(String(err), "error", provider);
}
