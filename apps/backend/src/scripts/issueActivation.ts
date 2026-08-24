import { loadConfig } from "../config.js";
import { issueCode } from "../onboarding/issueCode.js";

/**
 * Operatör CLI'si: bir e-posta için kullanıcı hazırlar, opsiyonel kredi yükler,
 * tek kullanımlık aktivasyon kodu üretir ve Grok botuna yapıştırılacak talimatı yazdırır.
 *
 * Kullanım: pnpm --filter @grokbot/backend issue-code <email> [krediMiktarı]
 *
 * Gömülü DB tek süreçlidir. Sunucu çalışıyorsa ADMIN_TOKEN ile admin API kullanılır;
 * aksi halde (sunucu kapalıysa) yerel dosya DB'si açılır.
 */
async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    process.stderr.write("Kullanım: issue-code <email> [krediMiktarı]\n");
    process.exit(1);
  }
  const credits = Number(process.argv[3] ?? 0);

  const config = loadConfig();
  const result = await issueCode(
    { email, credits: Number.isFinite(credits) ? credits : 0 },
    config,
  );

  process.stdout.write(
    `\n=== Kullanıcı ===\n${email} (${result.userId})\n\n=== Aktivasyon kodu ===\n${result.activationCode}\n\n=== Grok botuna yapıştırılacak talimat ===\n${result.installPrompt}\n\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
