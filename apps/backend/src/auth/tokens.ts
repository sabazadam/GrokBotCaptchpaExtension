import { randomBytes, createHash } from "node:crypto";

/** Kriptografik rastgele opak token (cihaz token'ı). Yalnızca hash'i saklanır. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Token/kod için SHA-256 hash (DB'de düz metin saklanmaz). */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // görsel olarak belirsiz karakterler çıkarıldı

/** İnsan tarafından okunabilir, tek kullanımlık aktivasyon kodu (ör. ABCD-EFGH-JKLM-NPQR). */
export function generateActivationCode(groups = 4, groupLen = 4): string {
  const bytes = randomBytes(groups * groupLen);
  const chars: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length] ?? "A");
  }
  const out: string[] = [];
  for (let g = 0; g < groups; g++) {
    out.push(chars.slice(g * groupLen, (g + 1) * groupLen).join(""));
  }
  return out.join("-");
}
