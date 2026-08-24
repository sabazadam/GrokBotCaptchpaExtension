/** Backend API'sinin döndürebileceği kararlı hata kodları (eklenti bunlara göre davranır). */
export type ApiErrorCode =
  | "unauthorized"
  | "insufficient_credits"
  | "rate_limited"
  | "concurrency_limit"
  | "daily_limit"
  | "budget_circuit_open"
  | "unsupported_captcha_type"
  | "invalid_params"
  | "capsolver_error"
  | "capsolver_timeout"
  | "internal_error";

/** Hata kodunun kullanıcı hatası mı (kredi iadesi gerekmez) yoksa çözüm hatası mı olduğunu ayırt etmeye yardımcı olur. */
export const REFUNDABLE_ERROR_CODES: ReadonlySet<ApiErrorCode> = new Set([
  "capsolver_error",
  "capsolver_timeout",
  "internal_error",
]);

export function isRefundable(code: ApiErrorCode): boolean {
  return REFUNDABLE_ERROR_CODES.has(code);
}
