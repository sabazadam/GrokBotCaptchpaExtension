export interface CapsolverConfig {
  apiKey: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface AppConfig {
  capsolver: CapsolverConfig;
}

function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Ortam değişkenlerinden yapılandırmayı yükler.
 * CAPSOLVER_API_KEY zorunludur ve yalnızca backend'de bulunur — asla eklentiye gönderilmez.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = env["CAPSOLVER_API_KEY"];
  if (!apiKey) {
    throw new Error("CAPSOLVER_API_KEY ortam değişkeni gerekli");
  }
  const config: CapsolverConfig = { apiKey };
  const baseUrl = env["CAPSOLVER_BASE_URL"];
  if (baseUrl) config.baseUrl = baseUrl;
  const pollIntervalMs = optionalInt(env["CAPSOLVER_POLL_INTERVAL_MS"]);
  if (pollIntervalMs !== undefined) config.pollIntervalMs = pollIntervalMs;
  const timeoutMs = optionalInt(env["CAPSOLVER_TIMEOUT_MS"]);
  if (timeoutMs !== undefined) config.timeoutMs = timeoutMs;
  return { capsolver: config };
}
