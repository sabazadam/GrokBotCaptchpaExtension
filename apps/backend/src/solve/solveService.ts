import {
  getCaptchaSpec,
  type NormalizedSolution,
  type SolveRequest,
} from "@grokbot/shared";
import type { CapsolverClient } from "../capsolver/client.js";
import { buildCapsolverTask } from "./buildTask.js";

/** Ham Capsolver solution'ını türe göre normalize eder (ana token + ham nesne). */
export function normalizeSolution(
  captchaType: SolveRequest["captchaType"],
  raw: Record<string, unknown>,
): NormalizedSolution {
  const spec = getCaptchaSpec(captchaType);
  let token: string | undefined;
  for (const field of spec.solutionFields) {
    const value = raw[field];
    if (typeof value === "string" && value.length > 0) {
      token = value;
      break;
    }
  }
  return token === undefined ? { raw } : { token, raw };
}

/**
 * Bir CAPTCHA'yı Capsolver üzerinden çözer (kredi/limit orkestrasyonu M1'de eklenir).
 * buildTask -> client.solve -> normalize.
 */
export async function solveCaptcha(
  client: CapsolverClient,
  req: SolveRequest,
): Promise<NormalizedSolution> {
  const task = buildCapsolverTask(req);
  const raw = await client.solve(task);
  return normalizeSolution(req.captchaType, raw);
}
