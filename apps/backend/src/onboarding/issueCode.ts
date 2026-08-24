import type { AppConfig } from "../config.js";
import { AuthService } from "../auth/deviceAuth.js";
import { CreditStore } from "../credits/creditStore.js";
import { migrate, type DbBundle } from "../db/index.js";
import { openConfiguredDb } from "../db/open.js";
import { buildInstallPrompt } from "./installPrompt.js";

export interface IssueCodeResult {
  userId: string;
  activationCode: string;
  remainingCredits: number;
  installPrompt: string;
}

export interface IssueCodeDeps {
  fetchImpl?: typeof fetch;
  openDb?: (config: AppConfig) => Promise<DbBundle>;
}

const ADMIN_FETCH_MS = 10_000;

export class IssueCodeError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "IssueCodeError";
    this.status = status;
    this.body = body;
  }
}

export function isBackendUnreachable(err: unknown): boolean {
  if (err instanceof IssueCodeError) return false;
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const causeCode = cause?.code ?? "";
  if (
    causeCode === "ECONNREFUSED" ||
    causeCode === "ECONNRESET" ||
    causeCode === "ENOTFOUND" ||
    causeCode === "EAI_AGAIN" ||
    causeCode === "EHOSTUNREACH"
  ) {
    return true;
  }
  const combined = `${err.message} ${cause?.message ?? ""}`;
  return /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(combined);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function adminHeaders(adminToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-admin-token": adminToken,
  };
}

export async function issueViaAdminApi(
  opts: {
    backendUrl: string;
    adminToken: string;
    email: string;
    credits: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<IssueCodeResult> {
  const base = opts.backendUrl.replace(/\/$/, "");
  const headers = adminHeaders(opts.adminToken);
  const signal = AbortSignal.timeout(ADMIN_FETCH_MS);

  if (Number.isFinite(opts.credits) && opts.credits > 0) {
    const creditRes = await fetchImpl(`${base}/admin/credits`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: opts.email, credits: Math.floor(opts.credits) }),
      signal,
    });
    if (!creditRes.ok) {
      throw new IssueCodeError(
        `Admin kredi yükleme başarısız (${creditRes.status})`,
        creditRes.status,
        await readJson(creditRes),
      );
    }
  }

  const codeRes = await fetchImpl(`${base}/admin/activation-codes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: opts.email }),
    signal,
  });
  if (!codeRes.ok) {
    throw new IssueCodeError(
      `Admin aktivasyon kodu başarısız (${codeRes.status})`,
      codeRes.status,
      await readJson(codeRes),
    );
  }
  const body = (await readJson(codeRes)) as {
    userId?: string;
    activationCode?: string;
    remainingCredits?: number;
    installPrompt?: string;
  } | null;
  if (!body?.userId || !body.activationCode) {
    throw new IssueCodeError("Admin API beklenen alanları döndürmedi", codeRes.status, body);
  }
  return {
    userId: body.userId,
    activationCode: body.activationCode,
    remainingCredits: body.remainingCredits ?? 0,
    installPrompt: body.installPrompt ?? "",
  };
}

async function issueViaLocalDb(
  config: AppConfig,
  email: string,
  credits: number,
  openDb: (config: AppConfig) => Promise<DbBundle>,
): Promise<IssueCodeResult> {
  const bundle = await openDb(config);
  try {
    await migrate(bundle);
    const auth = new AuthService(bundle.db);
    const store = new CreditStore(bundle.db);
    const userId = await auth.provisionUser(email);
    if (Number.isFinite(credits) && credits > 0) {
      await store.topUp(userId, Math.floor(credits), "cli-grant");
    }
    const code = await auth.issueActivationCode(userId);
    const remainingCredits = await store.getBalance(userId);
    const installPrompt = buildInstallPrompt({
      activationCode: code,
      backendUrl: config.onboarding.publicBackendUrl,
      ...(config.onboarding.extensionUrl ? { extensionUrl: config.onboarding.extensionUrl } : {}),
    });
    return { userId, activationCode: code, remainingCredits, installPrompt };
  } finally {
    await bundle.close();
  }
}

/**
 * Aktivasyon kodu + isteğe bağlı kredi üretir.
 * Gömülü DB tek süreçlidir: sunucu ayaktaysa admin HTTP kullanılır; yalnızca
 * bağlantı kurulamazsa yerel dosya DB'sine düşülür (401/4xx yerel DB açmaz).
 */
export async function issueCode(
  args: { email: string; credits: number },
  config: AppConfig,
  deps: IssueCodeDeps = {},
): Promise<IssueCodeResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const openDb = deps.openDb ?? ((c: AppConfig) => openConfiguredDb(c));

  if (!config.databaseUrl && config.adminToken) {
    try {
      return await issueViaAdminApi(
        {
          backendUrl: config.onboarding.publicBackendUrl,
          adminToken: config.adminToken,
          email: args.email,
          credits: args.credits,
        },
        fetchImpl,
      );
    } catch (err) {
      if (!isBackendUnreachable(err)) throw err;
    }
  }

  return issueViaLocalDb(config, args.email, args.credits, openDb);
}
