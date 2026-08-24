import { loadConfig } from "./config.js";
import { createPostgresDb, migrate } from "./db/index.js";
import { CreditStore } from "./credits/creditStore.js";
import { AuthService } from "./auth/deviceAuth.js";
import { UserLimiter } from "./limits/rateLimiter.js";
import { BudgetCircuitBreaker } from "./limits/budgetBreaker.js";
import { CapsolverClient } from "./capsolver/client.js";
import { SolveOrchestrator } from "./solve/orchestrator.js";
import { LemonSqueezyWebhookService } from "./payments/lemonSqueezy.js";
import { buildApp } from "./http/app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bundle = createPostgresDb(config.databaseUrl);
  await migrate(bundle);

  const credits = new CreditStore(bundle.db);
  const auth = new AuthService(bundle.db);
  const limiter = new UserLimiter({
    ratePerMinute: config.limits.ratePerMinute,
    maxConcurrent: config.limits.maxConcurrent,
    dailyMax: config.limits.dailyMax,
  });
  const breaker = new BudgetCircuitBreaker(config.budget.windowMs, config.budget.maxSpend);
  const client = new CapsolverClient({
    apiKey: config.capsolver.apiKey,
    ...(config.capsolver.baseUrl ? { baseUrl: config.capsolver.baseUrl } : {}),
    ...(config.capsolver.pollIntervalMs
      ? { pollIntervalMs: config.capsolver.pollIntervalMs }
      : {}),
    ...(config.capsolver.timeoutMs ? { timeoutMs: config.capsolver.timeoutMs } : {}),
  });
  const orchestrator = new SolveOrchestrator({
    db: bundle.db,
    credits,
    limiter,
    breaker,
    client,
    logger: (event) => {
      process.stdout.write(`${JSON.stringify({ ts: Date.now(), ...event })}\n`);
    },
  });

  const lemonSqueezy = config.lemonSqueezy
    ? new LemonSqueezyWebhookService(bundle.db, credits, auth, {
        signingSecret: config.lemonSqueezy.signingSecret,
        variantCredits: config.lemonSqueezy.variantCredits,
      })
    : undefined;

  const app = buildApp({
    auth,
    credits,
    orchestrator,
    ...(lemonSqueezy ? { lemonSqueezy } : {}),
    ...(config.adminToken ? { adminToken: config.adminToken } : {}),
    onboarding: config.onboarding,
    logger: true,
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await bundle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
