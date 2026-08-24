export interface CapsolverConfig {
  apiKey: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface LimitsConfig {
  ratePerMinute: number;
  maxConcurrent: number;
  dailyMax: number;
}

export interface BudgetConfig {
  windowMs: number;
  maxSpend: number;
}

export interface LemonSqueezyConfig {
  signingSecret: string;
  variantCredits: Record<string, number>;
}

export interface OnboardingConfig {
  publicBackendUrl: string;
  extensionUrl?: string;
}

export interface ProvidersConfig {
  /** Fallback sağlayıcı API anahtarları (yalnızca backend'de). */
  anticaptchaApiKey?: string;
  twocaptchaApiKey?: string;
  /** Fallback: sağlayıcı denemesi başına duvar-saati zaman aşımı. */
  attemptTimeoutMs: number;
  /** Fallback: sağlayıcı başına yeniden deneme sayısı. */
  retriesPerProvider: number;
  /** Token sağlayıcıları (Anti-Captcha/2Captcha) için polling ayarları. */
  tokenPollIntervalMs: number;
  tokenTimeoutMs: number;
}

export interface AppConfig {
  capsolver: CapsolverConfig;
  databaseUrl: string;
  port: number;
  limits: LimitsConfig;
  budget: BudgetConfig;
  lemonSqueezy?: LemonSqueezyConfig;
  adminToken?: string;
  onboarding: OnboardingConfig;
  providers: ProvidersConfig;
}

function parseVariantCredits(value: string | undefined): Record<string, number> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function intOr(value: string | undefined, fallback: number): number {
  return optionalInt(value) ?? fallback;
}

/**
 * Ortam değişkenlerinden yapılandırmayı yükler.
 * CAPSOLVER_API_KEY ve DATABASE_URL zorunludur. API anahtarı yalnızca backend'de bulunur.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = env["CAPSOLVER_API_KEY"];
  if (!apiKey) throw new Error("CAPSOLVER_API_KEY ortam değişkeni gerekli");
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL ortam değişkeni gerekli");

  const capsolver: CapsolverConfig = { apiKey };
  const baseUrl = env["CAPSOLVER_BASE_URL"];
  if (baseUrl) capsolver.baseUrl = baseUrl;
  const pollIntervalMs = optionalInt(env["CAPSOLVER_POLL_INTERVAL_MS"]);
  if (pollIntervalMs !== undefined) capsolver.pollIntervalMs = pollIntervalMs;
  const timeoutMs = optionalInt(env["CAPSOLVER_TIMEOUT_MS"]);
  if (timeoutMs !== undefined) capsolver.timeoutMs = timeoutMs;

  const port = intOr(env["PORT"], 3000);
  const extensionUrl = env["EXTENSION_URL"];
  const onboarding: OnboardingConfig = {
    publicBackendUrl: env["PUBLIC_BACKEND_URL"] ?? `http://localhost:${port}`,
    ...(extensionUrl ? { extensionUrl } : {}),
  };

  const providers: ProvidersConfig = {
    attemptTimeoutMs: intOr(env["SOLVER_ATTEMPT_TIMEOUT_MS"], 130_000),
    retriesPerProvider: intOr(env["SOLVER_RETRIES_PER_PROVIDER"], 1),
    tokenPollIntervalMs: intOr(env["SOLVER_TOKEN_POLL_INTERVAL_MS"], 3_000),
    tokenTimeoutMs: intOr(env["SOLVER_TOKEN_TIMEOUT_MS"], 120_000),
  };
  const anticaptchaApiKey = env["ANTICAPTCHA_API_KEY"];
  if (anticaptchaApiKey) providers.anticaptchaApiKey = anticaptchaApiKey;
  const twocaptchaApiKey = env["TWOCAPTCHA_API_KEY"];
  if (twocaptchaApiKey) providers.twocaptchaApiKey = twocaptchaApiKey;

  const config: AppConfig = {
    capsolver,
    databaseUrl,
    port,
    limits: {
      ratePerMinute: intOr(env["LIMIT_RATE_PER_MINUTE"], 30),
      maxConcurrent: intOr(env["LIMIT_MAX_CONCURRENT"], 5),
      dailyMax: intOr(env["LIMIT_DAILY_MAX"], 5000),
    },
    budget: {
      windowMs: intOr(env["BUDGET_WINDOW_MS"], 60_000),
      maxSpend: intOr(env["BUDGET_MAX_SPEND"], 10_000),
    },
    onboarding,
    providers,
  };

  const signingSecret = env["LEMONSQUEEZY_SIGNING_SECRET"];
  if (signingSecret) {
    config.lemonSqueezy = {
      signingSecret,
      variantCredits: parseVariantCredits(env["LEMONSQUEEZY_VARIANT_CREDITS"]),
    };
  }

  const adminToken = env["ADMIN_TOKEN"];
  if (adminToken) config.adminToken = adminToken;

  return config;
}
