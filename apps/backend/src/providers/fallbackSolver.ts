import type { CaptchaTypeId, NormalizedSolution, SolveRequest } from "@grokbot/shared";
import type { Logger } from "../observability/logger.js";
import { SolverError, toSolverError, type CaptchaSolver } from "./types.js";

export interface FallbackSolverOptions {
  /** Öncelik sırasına göre sağlayıcılar (ilk = birincil). */
  providers: CaptchaSolver[];
  logger?: Logger;
  /** Sağlayıcı başına yeniden deneme sayısı (geçici hatalarda). Varsayılan 1. */
  retriesPerProvider?: number;
  /** Sağlayıcı denemesi başına duvar-saati zaman aşımı (ms). Varsayılan 130000. */
  attemptTimeoutMs?: number;
}

/** Aynı sağlayıcıda yeniden denemenin işe yaramayacağı kalıcı hata kodları. */
const NON_RETRYABLE_CODES = new Set([
  "ERROR_KEY_DOES_NOT_EXIST",
  "ERROR_ZERO_BALANCE",
  "ERROR_IP_NOT_ALLOWED",
  "ERROR_IP_BLOCKED",
  "ERROR_IP_BANNED",
  "ERROR_METHOD_NOT_SUPPORTED",
  "ERROR_NO_SUCH_METHOD",
  "ERROR_TASK_NOT_SUPPORTED",
  "ERROR_WRONG_USER_KEY",
  "ERROR_KEY_DENIED_ACCESS",
  "ERROR_KEY_DENIED",
  "ERROR_ACCOUNT_SUSPENDED",
  "HTTP_401",
  "HTTP_403",
]);

function isNonRetryable(se: SolverError): boolean {
  if (se.kind === "unsupported" || se.kind === "timeout") return true;
  const code = (se.code ?? "").toUpperCase();
  return NON_RETRYABLE_CODES.has(code);
}

/**
 * Duvar-saati zaman aşımı: süre dolunca AbortSignal tetiklenir ve Promise reddedilir.
 * Asılı kalan sağlayıcı çağrıları sinyali dinliyorsa durur; dinlemiyorsa yine de
 * çağıran taraf beklemeye devam etmez (geç gelen sonuç yok sayılır).
 */
function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  provider: string,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new SolverError(`${provider} ${ms}ms içinde yanıt vermedi`, "timeout", provider));
    }, ms);
    run(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        if (controller.signal.aborted) return;
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        if (controller.signal.aborted) return;
        reject(err);
      },
    );
  });
}

/**
 * Çok sağlayıcılı çözücü: sağlayıcıları öncelik sırasıyla dener; biri başarısız olur,
 * zaman aşımına uğrar veya hata dönerse otomatik olarak bir sonrakine geçer.
 * İlk başarılı çözümü döndürür; hepsi başarısız olursa toplu SolverError fırlatır.
 */
export class FallbackSolver implements CaptchaSolver {
  readonly name = "fallback";
  private readonly providers: CaptchaSolver[];
  private readonly retries: number;
  private readonly attemptTimeoutMs: number;
  private readonly logger: Logger | undefined;

  constructor(options: FallbackSolverOptions) {
    if (options.providers.length === 0) {
      throw new Error("FallbackSolver: en az bir sağlayıcı gerekli");
    }
    this.providers = options.providers;
    this.retries = Math.max(0, options.retriesPerProvider ?? 1);
    this.attemptTimeoutMs = Math.max(1, options.attemptTimeoutMs ?? 130_000);
    this.logger = options.logger;
  }

  supports(type: CaptchaTypeId): boolean {
    return this.providers.some((p) => p.supports(type));
  }

  async solve(input: SolveRequest, signal?: AbortSignal): Promise<NormalizedSolution> {
    const causes: SolverError[] = [];

    for (const provider of this.providers) {
      if (signal?.aborted) {
        throw new SolverError("çözüm iptal edildi", "timeout", "fallback");
      }
      if (!provider.supports(input.captchaType)) continue;

      for (let attempt = 1; attempt <= this.retries + 1; attempt++) {
        try {
          const solution = await withTimeout(
            (attemptSignal) => {
              const combined = signal
                ? AbortSignal.any([signal, attemptSignal])
                : attemptSignal;
              return provider.solve(input, combined);
            },
            this.attemptTimeoutMs,
            provider.name,
          );
          this.logger?.info("solver_success", {
            provider: provider.name,
            captchaType: input.captchaType,
            attempt,
          });
          return solution;
        } catch (err) {
          const se = toSolverError(err, provider.name);
          causes.push(se);
          this.logger?.warn("solver_attempt_failed", {
            provider: provider.name,
            captchaType: input.captchaType,
            attempt,
            kind: se.kind,
            code: se.code,
          });
          // Desteklenmeyen tür, zaman aşımı ve kalıcı sağlayıcı hatalarında
          // aynı sağlayıcıyı tekrar denemek yalnızca ek ücret ve gecikme üretir.
          if (isNonRetryable(se)) break;
        }
      }
    }

    this.logger?.error("solver_all_failed", {
      captchaType: input.captchaType,
      providers: causes.map((c) => c.provider),
    });
    if (causes.length === 0) {
      throw new SolverError(
        `Hiçbir sağlayıcı bu türü desteklemiyor (${input.captchaType})`,
        "unsupported",
        "fallback",
      );
    }
    throw new SolverError(
      `Tüm sağlayıcılar başarısız oldu (${input.captchaType})`,
      causes.every((c) => c.kind === "timeout") ? "timeout" : "error",
      "fallback",
      undefined,
      causes,
    );
  }
}
