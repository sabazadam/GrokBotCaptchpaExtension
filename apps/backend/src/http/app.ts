import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { ApiErrorCode, SolveRequest } from "@grokbot/shared";
import type { AuthService, AuthedDevice } from "../auth/deviceAuth.js";
import { AuthError } from "../auth/deviceAuth.js";
import type { CreditStore } from "../credits/creditStore.js";
import type { SolveOrchestrator } from "../solve/orchestrator.js";
import { activateRequestSchema, solveRequestSchema } from "./schemas.js";

export interface AppDeps {
  auth: AuthService;
  credits: CreditStore;
  orchestrator: SolveOrchestrator;
  logger?: boolean;
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

  return app;
}
