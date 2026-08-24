import type { CaptchaTypeId, SolveRequest } from "@grokbot/shared";

export interface DetectedCaptcha {
  type: CaptchaTypeId;
  websiteKey?: string;
  pageAction?: string;
  turnstileAction?: string;
}

function parseParam(src: string, param: string): string | undefined {
  try {
    return new URL(src, "https://placeholder.invalid").searchParams.get(param) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sayfadaki CAPTCHA'ları tespit eder (tür + sitekey + varsa action).
 * Öncelik: Cloudflare Turnstile, reCAPTCHA v2 (widget/iframe), reCAPTCHA v3 (render).
 * Not: hCaptcha/FunCaptcha Capsolver'ın güncel desteğinde olmadığından tespit edilmez.
 */
export function detectCaptchas(doc: Document): DetectedCaptcha[] {
  const found: DetectedCaptcha[] = [];
  const seen = new Set<string>();
  const add = (c: DetectedCaptcha): void => {
    const key = `${c.type}:${c.websiteKey ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push(c);
    }
  };

  // Cloudflare Turnstile
  doc.querySelectorAll(".cf-turnstile").forEach((el) => {
    const key = el.getAttribute("data-sitekey") ?? undefined;
    const action = el.getAttribute("data-action") ?? undefined;
    add({
      type: "turnstile",
      ...(key ? { websiteKey: key } : {}),
      ...(action ? { turnstileAction: action } : {}),
    });
  });

  // reCAPTCHA v2 (açık widget)
  doc.querySelectorAll(".g-recaptcha[data-sitekey]").forEach((el) => {
    const key = el.getAttribute("data-sitekey") ?? undefined;
    add({ type: "recaptcha_v2", ...(key ? { websiteKey: key } : {}) });
  });

  // reCAPTCHA v2 (iframe üzerinden — açık widget yoksa)
  const iframe = doc.querySelector(
    'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]',
  );
  if (iframe) {
    const key = parseParam(iframe.getAttribute("src") ?? "", "k");
    if (key) add({ type: "recaptcha_v2", websiteKey: key });
  }

  // reCAPTCHA v3 (api.js?render=SITEKEY)
  doc.querySelectorAll('script[src*="recaptcha/api.js"]').forEach((el) => {
    const render = parseParam(el.getAttribute("src") ?? "", "render");
    if (render && render !== "explicit") {
      add({ type: "recaptcha_v3", websiteKey: render });
    }
  });

  return found;
}

export function toSolveRequest(c: DetectedCaptcha, websiteURL: string): SolveRequest {
  return {
    captchaType: c.type,
    websiteURL,
    ...(c.websiteKey ? { websiteKey: c.websiteKey } : {}),
    ...(c.pageAction ? { pageAction: c.pageAction } : {}),
    ...(c.turnstileAction ? { turnstileAction: c.turnstileAction } : {}),
  };
}
