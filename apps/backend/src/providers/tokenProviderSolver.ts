import type { CaptchaTypeId, NormalizedSolution, SolveRequest } from "@grokbot/shared";
import { normalizeSolution } from "../solve/solveService.js";
import { TaskApiClient, TaskApiError } from "./taskApiClient.js";
import { SolverError, type CaptchaSolver } from "./types.js";

const SUPPORTED: ReadonlySet<CaptchaTypeId> = new Set<CaptchaTypeId>([
  "recaptcha_v2",
  "recaptcha_v3",
  "turnstile",
]);

/** Sağlayıcıya özgü task tipi adları ve Turnstile challenge parametre adları. */
export interface TokenProviderConfig {
  name: string;
  baseUrl: string;
  taskTypes: {
    recaptchaV2: string;
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
          type: this.config.taskTypes.recaptchaV2,
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
          minScore: input.minScore ?? 0.3,
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

  async solve(input: SolveRequest): Promise<NormalizedSolution> {
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
      const raw = await this.client.solve(task);
      return normalizeSolution(input.captchaType, raw);
    } catch (err) {
      if (err instanceof TaskApiError) {
        throw new SolverError(err.message, err.kind, this.name, err.code);
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
    recaptchaV3: "RecaptchaV3TaskProxyless",
    turnstile: "TurnstileTaskProxyless",
  },
  turnstileParamNames: { cData: "data", chlPageData: "pagedata" },
};
