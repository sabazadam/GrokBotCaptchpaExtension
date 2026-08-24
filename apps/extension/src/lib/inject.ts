import type { CaptchaTypeId } from "@grokbot/shared";

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

function setField(
  doc: Document,
  name: string,
  token: string,
  createIfMissing: boolean,
): boolean {
  const targets: FieldEl[] = [];
  const byId = doc.getElementById(name);
  if (byId && (byId instanceof HTMLInputElement || byId instanceof HTMLTextAreaElement)) {
    targets.push(byId);
  }
  doc.querySelectorAll(`[name="${name}"]`).forEach((el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) targets.push(el);
  });

  if (targets.length === 0 && createIfMissing && doc.body) {
    const ta = doc.createElement("textarea");
    ta.id = name;
    ta.name = name;
    ta.style.display = "none";
    doc.body.appendChild(ta);
    targets.push(ta);
  }

  let applied = false;
  for (const t of targets) {
    t.value = token;
    t.dispatchEvent(new Event("input", { bubbles: true }));
    t.dispatchEvent(new Event("change", { bubbles: true }));
    applied = true;
  }
  return applied;
}

/**
 * Çözüm token'ını sayfaya enjekte eder (token tabanlı türler için).
 * reCAPTCHA -> g-recaptcha-response, Turnstile -> cf-turnstile-response.
 */
export function injectSolution(type: CaptchaTypeId, token: string, doc: Document): boolean {
  switch (type) {
    case "recaptcha_v2":
    case "recaptcha_v3":
      return setField(doc, "g-recaptcha-response", token, true);
    case "turnstile": {
      const a = setField(doc, "cf-turnstile-response", token, true);
      const b = setField(doc, "g-recaptcha-response", token, false);
      return a || b;
    }
    default:
      return false;
  }
}
