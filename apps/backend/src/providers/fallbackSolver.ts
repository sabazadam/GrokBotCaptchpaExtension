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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  provider: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SolverError(`${provider} ${ms}ms içinde yanıt vermedi`, "timeout", provider));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
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
    this.retries = options.retriesPerProvider ?? 1;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? 130_000;
    this.logger = options.logger;
  }

  supports(type: CaptchaTypeId): boolean {
    return this.providers.some((p) => p.supports(type));
  }

  async solve(input: SolveRequest): Promise<NormalizedSolution> {
    const causes: SolverError[] = [];

    for (const provider of this.providers) {
      if (!provider.supports(input.captchaType)) continue;

      for (let attempt = 1; attempt <= this.retries + 1; attempt++) {
        try {
          const solution = await withTimeout(
            provider.solve(input),
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
          // Desteklenmeyen tür bu sağlayıcıda çözülemez — yeniden deneme, sonraki sağlayıcıya geç.
          if (se.kind === "unsupported") break;
        }
      }
    }

    this.logger?.error("solver_all_failed", {
      captchaType: input.captchaType,
      providers: causes.map((c) => c.provider),
    });
    throw new SolverError(
      `Tüm sağlayıcılar başarısız oldu (${input.captchaType})`,
      causes.some((c) => c.kind === "timeout") && causes.every((c) => c.kind === "timeout")
        ? "timeout"
        : "error",
      "fallback",
      undefined,
      causes,
    );
  }
}
