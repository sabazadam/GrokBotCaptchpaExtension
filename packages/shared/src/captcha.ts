/**
 * Canonical CAPTCHA type registry.
 *
 * Bu tablo hem eklentinin (tespit) hem backend'in (Capsolver `createTask` gövdesini
 * kurma) tek doğru kaynağıdır. Değerler docs.capsolver.com üzerinden doğrulanmıştır.
 *
 * NOT: Capsolver'ın güncel dokümanında hCaptcha ve FunCaptcha/Arkose artık
 * listelenmiyor (sayfalar 404), bu yüzden burada yer almazlar.
 */

/** Çözümün nasıl elde edildiğini ve eklentinin nasıl kullanacağını belirler. */
export type SolveModel =
  /** createTask -> getTaskResult polling; token sayfaya enjekte edilir. */
  | "token"
  /** createTask sonucu doğrudan döner (OCR/görsel tanıma). */
  | "recognition"
  /** Proxy zorunlu; sonuç bir cookie (ör. cf_clearance). Scraping modeli. */
  | "proxy-cookie";

/** Eklentinin bu türü canlı tarayıcıda ne kadar iyi destekleyebildiği. */
export type ExtensionSupport = "full" | "partial" | "limited";

export type CaptchaTypeId =
  | "recaptcha_v2"
  | "recaptcha_v3"
  | "turnstile"
  | "geetest"
  | "aws_waf"
  | "image_to_text"
  | "cloudflare_challenge"
  | "datadome";

/** Capsolver `task.type` varyantları (proxyless / kendi proxy'niz / enterprise). */
export interface CapsolverTaskTypes {
  proxyless: string;
  proxied?: string;
  enterpriseProxyless?: string;
  enterprise?: string;
}

/** Content script'in bu türü sayfada tespit etmesi için sinyaller. */
export interface DetectionSignals {
  /** window üzerindeki global nesneler, ör. "grecaptcha", "turnstile". */
  globals?: string[];
  /** iframe src'sinde aranan alt-dizeler. */
  iframeUrlIncludes?: string[];
  /** varlığı türü ele veren CSS seçicileri. */
  selectors?: string[];
  /** sitekey'i taşıyan DOM özniteliği, ör. "data-sitekey". */
  sitekeyAttr?: string;
}

export interface CaptchaTypeSpec {
  id: CaptchaTypeId;
  label: string;
  solveModel: SolveModel;
  capsolverTaskTypes: CapsolverTaskTypes;
  /** `type` dışındaki zorunlu Capsolver task parametreleri. */
  requiredTaskParams: string[];
  optionalTaskParams: string[];
  /** getTaskResult -> solution içindeki asıl sonuç alan(lar)ı. */
  solutionFields: string[];
  detection: DetectionSignals;
  /** Token/sonucun sayfaya nasıl uygulanacağının insan tarafından okunur açıklaması. */
  injection: string;
  extensionSupport: ExtensionSupport;
  notes?: string;
}

export const CAPTCHA_REGISTRY: Record<CaptchaTypeId, CaptchaTypeSpec> = {
  recaptcha_v2: {
    id: "recaptcha_v2",
    label: "reCAPTCHA v2 (checkbox / invisible)",
    solveModel: "token",
    capsolverTaskTypes: {
      proxyless: "ReCaptchaV2TaskProxyLess",
      proxied: "ReCaptchaV2Task",
      enterpriseProxyless: "ReCaptchaV2EnterpriseTaskProxyLess",
      enterprise: "ReCaptchaV2EnterpriseTask",
    },
    requiredTaskParams: ["websiteURL", "websiteKey"],
    optionalTaskParams: [
      "pageAction",
      "recaptchaDataSValue",
      "enterprisePayload",
      "isInvisible",
      "isSession",
      "apiDomain",
      "proxy",
    ],
    solutionFields: ["gRecaptchaResponse"],
    detection: {
      globals: ["grecaptcha"],
      iframeUrlIncludes: ["google.com/recaptcha", "recaptcha.net/recaptcha"],
      selectors: [".g-recaptcha", "[data-sitekey]"],
      sitekeyAttr: "data-sitekey",
    },
    injection:
      "gRecaptchaResponse token'ını #g-recaptcha-response textarea'sına yaz ve widget callback'ini çağır.",
    extensionSupport: "full",
  },

  recaptcha_v3: {
    id: "recaptcha_v3",
    label: "reCAPTCHA v3 (+ Enterprise)",
    solveModel: "token",
    capsolverTaskTypes: {
      proxyless: "ReCaptchaV3TaskProxyLess",
      proxied: "ReCaptchaV3Task",
      enterpriseProxyless: "ReCaptchaV3EnterpriseTaskProxyLess",
      enterprise: "ReCaptchaV3EnterpriseTask",
    },
    requiredTaskParams: ["websiteURL", "websiteKey"],
    optionalTaskParams: [
      "pageAction",
      "minScore",
      "enterprisePayload",
      "isSession",
      "apiDomain",
      "proxy",
    ],
    solutionFields: ["gRecaptchaResponse"],
    detection: {
      globals: ["grecaptcha"],
      iframeUrlIncludes: ["google.com/recaptcha", "recaptcha.net/recaptcha"],
      selectors: ["[data-sitekey]"],
      sitekeyAttr: "data-sitekey",
    },
    injection:
      "grecaptcha.execute action'ı için üretilen token'ı ilgili gizli alana/callback'e ilet.",
    extensionSupport: "full",
    notes:
      "v3 için pageAction (grecaptcha.execute action) ve minScore opsiyoneldir; doğru action skor doğruluğunu artırır. Sahte 'submit' uydurulmamalıdır.",
  },

  turnstile: {
    id: "turnstile",
    label: "Cloudflare Turnstile",
    solveModel: "token",
    capsolverTaskTypes: {
      proxyless: "AntiTurnstileTaskProxyLess",
    },
    requiredTaskParams: ["websiteURL", "websiteKey"],
    optionalTaskParams: ["metadata.action", "metadata.cdata"],
    solutionFields: ["token"],
    detection: {
      globals: ["turnstile"],
      iframeUrlIncludes: ["challenges.cloudflare.com"],
      selectors: [".cf-turnstile", "[data-sitekey]"],
      sitekeyAttr: "data-sitekey",
    },
    injection:
      "token'ı Turnstile response input'una (ör. [name='cf-turnstile-response']) yaz ve callback'i çağır.",
    extensionSupport: "full",
  },

  geetest: {
    id: "geetest",
    label: "GeeTest v3 / v4",
    solveModel: "token",
    capsolverTaskTypes: {
      proxyless: "GeeTestTaskProxyLess",
    },
    requiredTaskParams: ["websiteURL"],
    optionalTaskParams: [
      "gt",
      "challenge",
      "captchaId",
      "riskType",
      "geetestApiServerSubdomain",
    ],
    solutionFields: ["challenge", "validate", "seccode", "captcha_output", "lot_number", "pass_token"],
    detection: {
      globals: ["initGeetest", "initGeetest4"],
      selectors: [".geetest_holder", ".geetest_wrap"],
    },
    injection:
      "v3: challenge/validate/seccode; v4: captcha_output/lot_number/pass_token değerlerini form alanlarına/callback'e uygula.",
    extensionSupport: "partial",
    notes:
      "v3 için gt+challenge, v4 için captchaId sayfadan çıkarılmalıdır. Parametreler tarayıcıdan doğrudan kopyalanmamalı, istekten alınmalıdır.",
  },

  aws_waf: {
    id: "aws_waf",
    label: "AWS WAF CAPTCHA",
    solveModel: "token",
    capsolverTaskTypes: {
      proxyless: "AntiAwsWafTaskProxyLess",
      proxied: "AntiAwsWafTask",
    },
    requiredTaskParams: ["websiteURL"],
    optionalTaskParams: [
      "awsKey",
      "awsIv",
      "awsContext",
      "awsChallengeJS",
      "awsApiJs",
      "awsProblemUrl",
      "awsApiKey",
      "awsExistingToken",
      "proxy",
    ],
    solutionFields: ["cookie"],
    detection: {
      iframeUrlIncludes: ["captcha.awswaf.com", "captcha-sdk.awswaf.com"],
      selectors: ["#captcha-container"],
    },
    injection: "Dönen aws-waf-token cookie'sini ilgili istek/oturuma uygula.",
    extensionSupport: "partial",
    notes:
      "Çoğu durumda yalnızca websiteURL yeterlidir; render sorununda awsKey/awsIv/awsContext/awsChallengeJS gerekebilir.",
  },

  image_to_text: {
    id: "image_to_text",
    label: "ImageToText (OCR)",
    solveModel: "recognition",
    capsolverTaskTypes: {
      proxyless: "ImageToTextTask",
    },
    requiredTaskParams: ["body"],
    optionalTaskParams: ["websiteURL", "images", "module"],
    solutionFields: ["text", "answers"],
    detection: {
      selectors: ["img[alt*='captcha' i]", "img[src*='captcha' i]"],
    },
    injection: "Dönen metni ilgili input alanına yaz.",
    extensionSupport: "partial",
    notes: "Eklenti görsel öğesini yakalayıp base64 olarak (data URI ön eki olmadan) gönderir.",
  },

  cloudflare_challenge: {
    id: "cloudflare_challenge",
    label: "Cloudflare Challenge ('Just a moment...')",
    solveModel: "proxy-cookie",
    capsolverTaskTypes: {
      proxied: "AntiCloudflareTask",
      proxyless: "AntiCloudflareTask",
    },
    requiredTaskParams: ["websiteURL", "proxy"],
    optionalTaskParams: ["userAgent", "html"],
    solutionFields: ["token", "cookies"],
    detection: {
      selectors: ["#challenge-form", "#cf-challenge-running"],
      iframeUrlIncludes: ["challenges.cloudflare.com/cdn-cgi"],
    },
    injection: "cf_clearance cookie'sini eşleşen proxy IP + userAgent ile uygula.",
    extensionSupport: "limited",
    notes:
      "Proxy zorunlu; cf_clearance modeli scraping içindir. Canlı tarayıcı oturumunda güvenilir kullanım Faz 2'ye bırakıldı.",
  },

  datadome: {
    id: "datadome",
    label: "DataDome (slider / interstitial)",
    solveModel: "proxy-cookie",
    capsolverTaskTypes: {
      proxied: "DatadomeSliderTask",
      proxyless: "DatadomeSliderTask",
    },
    requiredTaskParams: ["captchaUrl", "userAgent", "proxy"],
    optionalTaskParams: ["websiteURL"],
    solutionFields: ["cookie"],
    detection: {
      iframeUrlIncludes: ["captcha-delivery.com", "geo.captcha-delivery.com"],
      selectors: ["#datadome-captcha"],
    },
    injection: "datadome cookie'sini eşleşen proxy IP + userAgent ile uygula.",
    extensionSupport: "limited",
    notes:
      "Proxy + userAgent zorunlu. captchaUrl geo.captcha-delivery.com adresidir. Scraping modeli (Faz 2).",
  },
};

export const CAPTCHA_TYPE_IDS = Object.keys(CAPTCHA_REGISTRY) as CaptchaTypeId[];

export function isCaptchaTypeId(value: string): value is CaptchaTypeId {
  return value in CAPTCHA_REGISTRY;
}

export function getCaptchaSpec(id: CaptchaTypeId): CaptchaTypeSpec {
  return CAPTCHA_REGISTRY[id];
}

/**
 * Kredi maliyeti tablosu (YER TUTUCU).
 * Gerçek değerler Capsolver'ın canlı fiyatlandırmasına göre kalibre edilecek.
 * 1 kredi = temel birim; her türün maliyeti gerçek Capsolver maliyeti + marj olacak.
 */
export const DEFAULT_CREDIT_COSTS: Record<CaptchaTypeId, number> = {
  recaptcha_v2: 1,
  recaptcha_v3: 1,
  turnstile: 1,
  geetest: 2,
  aws_waf: 2,
  image_to_text: 1,
  cloudflare_challenge: 3,
  datadome: 3,
};
