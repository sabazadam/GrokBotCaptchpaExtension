import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { ApiErrorCode, SolveRequest } from "@grokbot/shared";
import type { AuthService, AuthedDevice } from "../auth/deviceAuth.js";
import { AuthError } from "../auth/deviceAuth.js";
import type { CreditStore } from "../credits/creditStore.js";
import type { SolveOrchestrator } from "../solve/orchestrator.js";
import type { LemonSqueezyWebhookService } from "../payments/lemonSqueezy.js";
import { buildInstallPrompt } from "../onboarding/installPrompt.js";
import {
  activateRequestSchema,
  adminActivationCodeSchema,
  adminCreditsSchema,
  solveRequestSchema,
} from "./schemas.js";

export interface OnboardingConfig {
  publicBackendUrl: string;
  extensionUrl?: string;
}

export interface AppDeps {
  auth: AuthService;
  credits: CreditStore;
  orchestrator: SolveOrchestrator;
  lemonSqueezy?: LemonSqueezyWebhookService;
  /** Admin uçlarını korur (x-admin-token). Ayarlanmazsa admin uçları kapalıdır. */
  adminToken?: string;
  onboarding?: OnboardingConfig;
  logger?: boolean;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function httpStatusForCode(code: ApiErrorCode): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "insufficient_credits":
      return 402;
    case "rate_limited":
    case "concurrency_limit":
    case "daily_limit":
      return 429;
    case "budget_circuit_open":
      return 503;
    case "unsupported_captcha_type":
    case "invalid_params":
      return 400;
    case "capsolver_error":
    case "capsolver_timeout":
      return 502;
    case "internal_error":
      return 500;
    default:
      return 500;
  }
}

function getBearer(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  // Ham gövdeyi de sakla (webhook imza doğrulaması için), JSON'u da ayrıştır.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
      if ((body as Buffer).length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse((body as Buffer).toString("utf8")));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  async function requireAuth(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthedDevice | null> {
    const token = getBearer(req);
    if (!token) {
      await reply
        .code(401)
        .send({ status: "error", code: "unauthorized", message: "Cihaz token'ı gerekli" });
      return null;
    }
    const ctx = await deps.auth.authenticate(token);
    if (!ctx) {
      await reply
        .code(401)
        .send({ status: "error", code: "unauthorized", message: "Geçersiz cihaz token'ı" });
      return null;
    }
    return ctx;
  }

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/v1/activate", async (req, reply) => {
    const parsed = activateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ status: "error", code: "invalid_params", message: parsed.error.message });
    }
    try {
      const result = await deps.auth.redeemActivationCode(
        parsed.data.activationCode,
        parsed.data.deviceLabel,
      );
      const remainingCredits = await deps.credits.getBalance(result.userId);
      return reply.code(200).send({
        deviceToken: result.deviceToken,
        userId: result.userId,
        remainingCredits,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply
          .code(httpStatusForCode(err.code))
          .send({ status: "error", code: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.get("/v1/balance", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    const remainingCredits = await deps.credits.getBalance(ctx.userId);
    return reply.code(200).send({ remainingCredits, userId: ctx.userId });
  });

  app.post("/v1/solve", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    const parsed = solveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ status: "error", code: "invalid_params", message: parsed.error.message });
    }
    const res = await deps.orchestrator.handleSolve(ctx, parsed.data as unknown as SolveRequest);
    const status = res.status === "error" ? httpStatusForCode(res.code) : 200;
    return reply.code(status).send(res);
  });

  const adminToken = deps.adminToken;
  if (adminToken) {
    const requireAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
      const header = req.headers["x-admin-token"];
      if (typeof header !== "string" || !safeEqual(header, adminToken)) {
        void reply.code(401).send({ status: "error", code: "unauthorized", message: "Admin token gerekli" });
        return false;
      }
      return true;
    };

    app.post("/admin/activation-codes", async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const parsed = adminActivationCodeSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ status: "error", code: "invalid_params", message: parsed.error.message });
      }
      const userId = await deps.auth.provisionUser(parsed.data.email);
      const code = await deps.auth.issueActivationCode(userId, parsed.data.expiresInMs);
      const remainingCredits = await deps.credits.getBalance(userId);
      const onboarding = deps.onboarding;
      const installPrompt = onboarding
        ? buildInstallPrompt({
            activationCode: code,
            backendUrl: onboarding.publicBackendUrl,
            ...(onboarding.extensionUrl ? { extensionUrl: onboarding.extensionUrl } : {}),
          })
        : undefined;
      return reply.code(200).send({ userId, activationCode: code, remainingCredits, installPrompt });
    });

    app.post("/admin/credits", async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const parsed = adminCreditsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ status: "error", code: "invalid_params", message: parsed.error.message });
      }
      const userId = await deps.auth.provisionUser(parsed.data.email);
      const balance = await deps.credits.topUp(userId, parsed.data.credits, "admin-grant");
      return reply.code(200).send({ userId, remainingCredits: balance });
    });
  }

  const lemonSqueezy = deps.lemonSqueezy;
  if (lemonSqueezy) {
    app.post("/webhooks/lemonsqueezy", async (req, reply) => {
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from("");
      const signature = req.headers["x-signature"];
      const result = await lemonSqueezy.handle(
        rawBody,
        typeof signature === "string" ? signature : undefined,
      );
      if (!result.ok) {
        return reply.code(400).send({ status: "error", code: result.code });
      }
      return reply.code(200).send({ received: true, ...result });
    });
  }

  return app;
}
