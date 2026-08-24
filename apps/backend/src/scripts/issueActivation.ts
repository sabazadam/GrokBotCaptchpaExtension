import { loadConfig } from "../config.js";
import { createPostgresDb, migrate } from "../db/index.js";
import { AuthService } from "../auth/deviceAuth.js";
import { CreditStore } from "../credits/creditStore.js";
import { buildInstallPrompt } from "../onboarding/installPrompt.js";

/**
 * Operatör CLI'si: bir e-posta için kullanıcı hazırlar, opsiyonel kredi yükler,
 * tek kullanımlık aktivasyon kodu üretir ve Grok botuna yapıştırılacak talimatı yazdırır.
 *
 * Kullanım: pnpm --filter @grokbot/backend issue-code <email> [krediMiktarı]
 */
async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    process.stderr.write("Kullanım: issue-code <email> [krediMiktarı]\n");
    process.exit(1);
  }
  const credits = Number(process.argv[3] ?? 0);

  const config = loadConfig();
  const bundle = createPostgresDb(config.databaseUrl);
  await migrate(bundle);

  const auth = new AuthService(bundle.db);
  const store = new CreditStore(bundle.db);

  const userId = await auth.provisionUser(email);
  if (Number.isFinite(credits) && credits > 0) {
    await store.topUp(userId, Math.floor(credits), "cli-grant");
  }
  const code = await auth.issueActivationCode(userId);
  const prompt = buildInstallPrompt({
    activationCode: code,
    backendUrl: config.onboarding.publicBackendUrl,
    ...(config.onboarding.extensionUrl ? { extensionUrl: config.onboarding.extensionUrl } : {}),
  });

  process.stdout.write(
    `\n=== Kullanıcı ===\n${email} (${userId})\n\n=== Aktivasyon kodu ===\n${code}\n\n=== Grok botuna yapıştırılacak talimat ===\n${prompt}\n\n`,
  );
  await bundle.close();
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
