import {
  isCaptchaTypeId,
  type CaptchaTypeId,
  type NormalizedSolution,
  type SolveRequest,
} from "@grokbot/shared";
import { CapsolverClient, CapsolverError } from "../capsolver/client.js";
import { buildCapsolverTask, BuildTaskError } from "../solve/buildTask.js";
import { normalizeSolution } from "../solve/solveService.js";
import { isAbortError, SolverError, type CaptchaSolver } from "./types.js";

/** Birincil sağlayıcı. Mevcut CapsolverClient'ı ortak CaptchaSolver arayüzüne sarar. */
export class CapsolverSolver implements CaptchaSolver {
  readonly name = "capsolver";

  constructor(private readonly client: CapsolverClient) {}

  supports(type: CaptchaTypeId): boolean {
    return isCaptchaTypeId(type);
  }

  async solve(input: SolveRequest, signal?: AbortSignal): Promise<NormalizedSolution> {
    let task;
    try {
      task = buildCapsolverTask(input);
    } catch (err) {
      if (err instanceof BuildTaskError) {
        throw new SolverError(err.message, "unsupported", this.name, err.code);
      }
      throw new SolverError((err as Error).message, "error", this.name);
    }
    try {
      const raw = await this.client.solve(task, signal);
      return normalizeSolution(input.captchaType, raw);
    } catch (err) {
      if (err instanceof CapsolverError) {
        throw new SolverError(err.message, err.kind, this.name, err.code);
      }
      if (isAbortError(err)) {
        throw new SolverError((err as Error).message || "iptal edildi", "timeout", this.name);
      }
      throw new SolverError((err as Error).message, "error", this.name);
    }
  }
}
