import type { NormalizedSolution } from "@grokbot/shared";
import type { CaptchaSolver } from "../../src/providers/types.js";
import { SolverError, type SolverErrorKind } from "../../src/providers/types.js";

/** Her zaman başarılı olan sahte solver (orkestratör testleri için). */
export function successSolver(token = "TOKEN", name = "mock"): CaptchaSolver {
  return {
    name,
    supports: () => true,
    solve: async (): Promise<NormalizedSolution> => ({
      token,
      raw: { gRecaptchaResponse: token },
    }),
  };
}

/** Her zaman başarısız olan sahte solver. */
export function failingSolver(kind: SolverErrorKind = "error", name = "mock"): CaptchaSolver {
  return {
    name,
    supports: () => true,
    solve: async (): Promise<NormalizedSolution> => {
      throw new SolverError(`${name} başarısız`, kind, name);
    },
  };
}
