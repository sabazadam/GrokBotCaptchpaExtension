import type { CaptchaTypeId, NormalizedSolution, SolveRequest } from "@grokbot/shared";
import { normalizeSolution } from "../solve/solveService.js";
import { TaskApiClient, TaskApiError } from "./taskApiClient.js";
import { isAbortError, SolverError, type CaptchaSolver } from "./types.js";

const SUPPORTED: ReadonlySet<CaptchaTypeId> = new Set<CaptchaTypeId>([
  "recaptcha_v2",
  "recaptcha_v3",
  "turnstile",
]);

const ALLOWED_MIN_SCORES = [0.3, 0.7, 0.9] as const;

/** Anti-Captcha/2Captcha yalnızca 0.3 / 0.7 / 0.9 kabul eder; en yakına (eşitlikte yükseğe) yuvarla. */
export function snapMinScore(value: number | undefined): number {
  const n = value ?? 0.3;
  let best: (typeof ALLOWED_MIN_SCORES)[number] = ALLOWED_MIN_SCORES[0];
  for (const allowed of ALLOWED_MIN_SCORES) {
    const d = Math.abs(allowed - n);
    const bestD = Math.abs(best - n);
    if (d < bestD || (d === bestD && allowed > best)) best = allowed;
  }
  return best;
}

/** Sağlayıcıya özgü task tipi adları ve Turnstile challenge parametre adları. */
export interface TokenProviderConfig {
  name: string;
  baseUrl: string;
  taskTypes: {
    recaptchaV2: string;
    recaptchaV2Enterprise: string;
    recaptchaV3: string;
    turnstile: string;
  };
  turnstileParamNames: {
    cData: string;
    chlPageData: string;
  };
}

export interface TokenProviderOptions {
  apiKey: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  softId?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

/** Anti-Captcha uyumlu sağlayıcılar (Anti-Captcha, 2Captcha) için ortak adaptör. */
export class TokenProviderSolver implements CaptchaSolver {
  readonly name: string;
  private readonly client: TaskApiClient;

  constructor(
    private readonly config: TokenProviderConfig,
    options: TokenProviderOptions,
  ) {
    this.name = config.name;
    this.client = new TaskApiClient({
      apiKey: options.apiKey,
      baseUrl: config.baseUrl,
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.softId !== undefined ? { softId: options.softId } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.sleepImpl ? { sleepImpl: options.sleepImpl } : {}),
    });
  }

  supports(type: CaptchaTypeId): boolean {
    return SUPPORTED.has(type);
  }

  private buildTask(input: SolveRequest): Record<string, unknown> {
    switch (input.captchaType) {
      case "recaptcha_v2": {
        const task: Record<string, unknown> = {
          type: input.isEnterprise
            ? this.config.taskTypes.recaptchaV2Enterprise
            : this.config.taskTypes.recaptchaV2,
          websiteURL: input.websiteURL,
          websiteKey: input.websiteKey,
        };
        if (input.isInvisible !== undefined) task["isInvisible"] = input.isInvisible;
        return task;
      }
      case "recaptcha_v3": {
        const task: Record<string, unknown> = {
          type: this.config.taskTypes.recaptchaV3,
          websiteURL: input.websiteURL,
          websiteKey: input.websiteKey,
          minScore: snapMinScore(input.minScore),
        };
        if (input.pageAction) task["pageAction"] = input.pageAction;
        if (input.isEnterprise !== undefined) task["isEnterprise"] = input.isEnterprise;
        return task;
      }
      case "turnstile": {
        const task: Record<string, unknown> = {
          type: this.config.taskTypes.turnstile,
          websiteURL: input.websiteURL,
          websiteKey: input.websiteKey,
        };
        if (input.turnstileAction) task["action"] = input.turnstileAction;
        if (input.turnstileCdata) task[this.config.turnstileParamNames.cData] = input.turnstileCdata;
        return task;
      }
      default:
        throw new SolverError(
          `${this.name} bu türü desteklemiyor: ${input.captchaType}`,
          "unsupported",
          this.name,
        );
    }
  }

  async solve(input: SolveRequest, signal?: AbortSignal): Promise<NormalizedSolution> {
    if (!this.supports(input.captchaType)) {
      throw new SolverError(
        `${this.name} bu türü desteklemiyor: ${input.captchaType}`,
        "unsupported",
        this.name,
      );
    }
    if (!input.websiteKey) {
      throw new SolverError("websiteKey gerekli", "unsupported", this.name);
    }
    const task = this.buildTask(input);
    try {
      const raw = await this.client.solve(task, signal);
      return normalizeSolution(input.captchaType, raw);
    } catch (err) {
      if (err instanceof TaskApiError) {
        throw new SolverError(err.message, err.kind, this.name, err.code);
      }
      if (isAbortError(err)) {
        throw new SolverError((err as Error).message || "iptal edildi", "timeout", this.name);
      }
      throw new SolverError((err as Error).message, "error", this.name);
    }
  }
}

/** Anti-Captcha yapılandırması (https://anti-captcha.com). */
export const ANTI_CAPTCHA_CONFIG: TokenProviderConfig = {
  name: "anticaptcha",
  baseUrl: "https://api.anti-captcha.com",
  taskTypes: {
    recaptchaV2: "RecaptchaV2TaskProxyless",
    recaptchaV2Enterprise: "RecaptchaV2EnterpriseTaskProxyless",
    recaptchaV3: "RecaptchaV3TaskProxyless",
    turnstile: "TurnstileTaskProxyless",
  },
  turnstileParamNames: { cData: "cData", chlPageData: "chlPageData" },
};

/** 2Captcha yapılandırması (https://2captcha.com, Anti-Captcha uyumlu JSON API). */
export const TWO_CAPTCHA_CONFIG: TokenProviderConfig = {
  name: "2captcha",
  baseUrl: "https://api.2captcha.com",
  taskTypes: {
    recaptchaV2: "RecaptchaV2TaskProxyless",
    recaptchaV2Enterprise: "RecaptchaV2EnterpriseTaskProxyless",
    recaptchaV3: "RecaptchaV3TaskProxyless",
    turnstile: "TurnstileTaskProxyless",
  },
  turnstileParamNames: { cData: "data", chlPageData: "pagedata" },
};
