import { loadConfig } from "./config.js";
import { createPostgresDb, migrate } from "./db/index.js";
import { CreditStore } from "./credits/creditStore.js";
import { AuthService } from "./auth/deviceAuth.js";
import { UserLimiter } from "./limits/rateLimiter.js";
import { BudgetCircuitBreaker } from "./limits/budgetBreaker.js";
import { CapsolverClient } from "./capsolver/client.js";
import { SolveOrchestrator } from "./solve/orchestrator.js";
import { LemonSqueezyWebhookService } from "./payments/lemonSqueezy.js";
import { createLogger } from "./observability/logger.js";
import { Metrics } from "./observability/metrics.js";
import { buildApp } from "./http/app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ base: { service: "grokbot-backend" } });
  const metrics = new Metrics();

  const bundle = createPostgresDb(config.databaseUrl);
  await migrate(bundle);

  const credits = new CreditStore(bundle.db);
  const auth = new AuthService(bundle.db);
  const limiter = new UserLimiter({
    ratePerMinute: config.limits.ratePerMinute,
    maxConcurrent: config.limits.maxConcurrent,
    dailyMax: config.limits.dailyMax,
  });
  const breaker = new BudgetCircuitBreaker(config.budget.windowMs, config.budget.maxSpend, {
    warnRatio: 0.8,
    onWarn: (spend, maxSpend) => {
      logger.warn("budget_spend_warning", { spend, maxSpend });
    },
  });
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
    logger,
    metrics,
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
    metrics,
    appLogger: logger,
    logger: true,
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled_rejection", { reason: String(reason) });
  });
  process.on("uncaughtException", (err) => {
    logger.error("uncaught_exception", { message: err.message, stack: err.stack });
  });

  const shutdown = async (): Promise<void> => {
    logger.info("shutdown");
    await app.close();
    await bundle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info("listening", { port: config.port });
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
