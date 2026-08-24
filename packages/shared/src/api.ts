import type { CaptchaTypeId } from "./captcha.js";
import type { ApiErrorCode } from "./errors.js";

/**
 * Eklenti -> backend çözüm isteği (API sözleşmesi).
 * Eklenti hiçbir zaman Capsolver'ı doğrudan çağırmaz; yalnızca bu sözleşmeyi kullanır.
 */
export interface SolveRequest {
  captchaType: CaptchaTypeId;
  websiteURL: string;
  websiteKey?: string;

  /** reCAPTCHA v3 (ve bazı v2) için action. */
  pageAction?: string;
  /** reCAPTCHA v2 invisible modu. */
  isInvisible?: boolean;
  /** Enterprise varyantını seç. */
  isEnterprise?: boolean;
  enterprisePayload?: Record<string, unknown>;

  /** Cloudflare Turnstile ekstra verisi. */
  turnstileAction?: string;
  turnstileCdata?: string;

  /** GeeTest parametreleri (sayfadan çıkarılır). */
  geetest?: {
    gt?: string;
    challenge?: string;
    captchaId?: string;
    riskType?: string;
    apiServerSubdomain?: string;
  };

  /** ImageToText (OCR) için base64 görsel (data URI ön eki olmadan). */
  imageBase64?: string;
  ocrModule?: string;

  /** proxy-cookie modeli (Cloudflare Challenge / DataDome) için. */
  proxy?: string;
  userAgent?: string;
  /** DataDome için CAPTCHA teslim adresi (geo.captcha-delivery.com ...). */
  captchaUrl?: string;

  /** Tekrarlı isteklerde çifte ücretlendirmeyi önlemek için istemci tarafı anahtar. */
  idempotencyKey?: string;
}

/** Backend'in normalize edilmiş çözümü (token + türe özgü ekstralar). */
export interface NormalizedSolution {
  /** Ana token varsa (reCAPTCHA/Turnstile/GeeTest v4 vb.). */
  token?: string;
  /** Ham Capsolver solution nesnesi (türe göre değişen alanlar). */
  raw: Record<string, unknown>;
}

export interface SolveSuccessResponse {
  status: "solved";
  solveId: string;
  captchaType: CaptchaTypeId;
  solution: NormalizedSolution;
  costCredits: number;
  remainingCredits: number;
}

export interface SolveErrorResponse {
  status: "error";
  code: ApiErrorCode;
  message: string;
}

export type SolveResponse = SolveSuccessResponse | SolveErrorResponse;

/** Bakiye/durum uç noktası yanıtı. */
export interface BalanceResponse {
  remainingCredits: number;
  userId: string;
}

/** Aktivasyon (cihaz bağlama) isteği/yanıtı. */
export interface ActivateRequest {
  activationCode: string;
  deviceLabel?: string;
}

export interface ActivateResponse {
  deviceToken: string;
  userId: string;
  remainingCredits: number;
}
