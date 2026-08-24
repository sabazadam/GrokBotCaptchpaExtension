import {
  getCaptchaSpec,
  isCaptchaTypeId,
  type CaptchaTypeSpec,
  type SolveRequest,
} from "@grokbot/shared";
import type { ApiErrorCode } from "@grokbot/shared";
import type { CapsolverTask } from "../capsolver/types.js";

/** buildTask sırasında oluşan, API hata koduna eşlenebilen hata. */
export class BuildTaskError extends Error {
  readonly code: ApiErrorCode;
  constructor(message: string, code: ApiErrorCode) {
    super(message);
    this.name = "BuildTaskError";
    this.code = code;
  }
}

function selectTaskType(
  spec: CaptchaTypeSpec,
  opts: { isEnterprise: boolean; hasProxy: boolean },
): string {
  const t = spec.capsolverTaskTypes;
  if (opts.isEnterprise) {
    if (opts.hasProxy && t.enterprise) return t.enterprise;
    if (t.enterpriseProxyless) return t.enterpriseProxyless;
  }
  if (opts.hasProxy && t.proxied) return t.proxied;
  return t.proxyless;
}

function requireField<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null || value === "") {
    throw new BuildTaskError(`Eksik zorunlu parametre: ${field}`, "invalid_params");
  }
  return value;
}

/**
 * SolveRequest'i Capsolver `createTask` task nesnesine dönüştürür.
 * Türe özgü zorunlu parametreleri doğrular; geçersizse BuildTaskError fırlatır.
 */
export function buildCapsolverTask(req: SolveRequest): CapsolverTask {
  if (!isCaptchaTypeId(req.captchaType)) {
    throw new BuildTaskError(
      `Desteklenmeyen CAPTCHA türü: ${req.captchaType}`,
      "unsupported_captcha_type",
    );
  }
  const spec = getCaptchaSpec(req.captchaType);
  const hasProxy = Boolean(req.proxy);
  const isEnterprise = Boolean(req.isEnterprise);
  const type = selectTaskType(spec, { isEnterprise, hasProxy });

  switch (req.captchaType) {
    case "recaptcha_v2": {
      const task: CapsolverTask = {
        type,
        websiteURL: requireField(req.websiteURL, "websiteURL"),
        websiteKey: requireField(req.websiteKey, "websiteKey"),
      };
      if (req.isInvisible !== undefined) task["isInvisible"] = req.isInvisible;
      if (req.pageAction) task["pageAction"] = req.pageAction;
      if (req.enterprisePayload) task["enterprisePayload"] = req.enterprisePayload;
      if (req.proxy) task["proxy"] = req.proxy;
      return task;
    }

    case "recaptcha_v3": {
      // pageAction v3 için opsiyoneldir (Capsolver, Anti-Captcha ve 2Captcha dokümanları),
      // ama skor doğruluğu için tavsiye edilir.
      const task: CapsolverTask = {
        type,
        websiteURL: requireField(req.websiteURL, "websiteURL"),
        websiteKey: requireField(req.websiteKey, "websiteKey"),
      };
      if (req.pageAction) task["pageAction"] = req.pageAction;
      if (req.enterprisePayload) task["enterprisePayload"] = req.enterprisePayload;
      if (req.proxy) task["proxy"] = req.proxy;
      return task;
    }

    case "turnstile": {
      const task: CapsolverTask = {
        type,
        websiteURL: requireField(req.websiteURL, "websiteURL"),
        websiteKey: requireField(req.websiteKey, "websiteKey"),
      };
      const metadata: Record<string, string> = {};
      if (req.turnstileAction) metadata["action"] = req.turnstileAction;
      if (req.turnstileCdata) metadata["cdata"] = req.turnstileCdata;
      if (Object.keys(metadata).length > 0) task["metadata"] = metadata;
      return task;
    }

    case "geetest": {
      const g = req.geetest;
      const hasV3 = Boolean(g?.gt && g?.challenge);
      const hasV4 = Boolean(g?.captchaId);
      if (!hasV3 && !hasV4) {
        throw new BuildTaskError(
          "GeeTest için v3 (gt+challenge) veya v4 (captchaId) gerekli",
          "invalid_params",
        );
      }
      const task: CapsolverTask = {
        type,
        websiteURL: requireField(req.websiteURL, "websiteURL"),
      };
      if (g?.gt) task["gt"] = g.gt;
      if (g?.challenge) task["challenge"] = g.challenge;
      if (g?.captchaId) task["captchaId"] = g.captchaId;
      if (g?.riskType) task["riskType"] = g.riskType;
      if (g?.apiServerSubdomain) task["geetestApiServerSubdomain"] = g.apiServerSubdomain;
      return task;
    }

    case "aws_waf": {
      const task: CapsolverTask = {
        type,
        websiteURL: requireField(req.websiteURL, "websiteURL"),
      };
      if (req.proxy) task["proxy"] = req.proxy;
      return task;
    }

    case "image_to_text": {
      const task: CapsolverTask = {
        type,
        body: requireField(req.imageBase64, "imageBase64"),
      };
      if (req.ocrModule) task["module"] = req.ocrModule;
      if (req.websiteURL) task["websiteURL"] = req.websiteURL;
      return task;
    }

    case "cloudflare_challenge": {
      const task: CapsolverTask = {
        type,
        websiteURL: requireField(req.websiteURL, "websiteURL"),
        proxy: requireField(req.proxy, "proxy"),
      };
      if (req.userAgent) task["userAgent"] = req.userAgent;
      return task;
    }

    case "datadome": {
      const task: CapsolverTask = {
        type,
        captchaUrl: requireField(req.captchaUrl, "captchaUrl"),
        userAgent: requireField(req.userAgent, "userAgent"),
        proxy: requireField(req.proxy, "proxy"),
      };
      if (req.websiteURL) task["websiteURL"] = req.websiteURL;
      return task;
    }

    default: {
      const exhaustive: never = req.captchaType;
      throw new BuildTaskError(
        `İşlenmeyen CAPTCHA türü: ${String(exhaustive)}`,
        "unsupported_captcha_type",
      );
    }
  }
}
