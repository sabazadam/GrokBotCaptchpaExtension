import { describe, expect, it } from "vitest";
import type { SolveRequest } from "@grokbot/shared";
import { CapsolverSolver } from "../../src/providers/capsolverSolver.js";
import { SolverError } from "../../src/providers/types.js";
import { failingClient, successClient } from "../helpers/capsolver.js";

const req: SolveRequest = {
  captchaType: "recaptcha_v2",
  websiteURL: "https://site.com",
  websiteKey: "k",
};

describe("CapsolverSolver", () => {
  it("başarılı çözümde normalize edilmiş token döner", async () => {
    const solver = new CapsolverSolver(successClient({ gRecaptchaResponse: "TOK" }));
    const solution = await solver.solve(req);
    expect(solution.token).toBe("TOK");
  });

  it("Capsolver hatasında SolverError fırlatır", async () => {
    const solver = new CapsolverSolver(failingClient());
    await expect(solver.solve(req)).rejects.toBeInstanceOf(SolverError);
  });

  it("geçersiz parametrede SolverError(unsupported) fırlatır", async () => {
    const solver = new CapsolverSolver(successClient());
    try {
      await solver.solve({ captchaType: "recaptcha_v3", websiteURL: "u" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SolverError);
      expect((err as SolverError).kind).toBe("unsupported");
    }
  });

  it("tüm kayıtlı türleri destekler", () => {
    const solver = new CapsolverSolver(successClient());
    expect(solver.supports("recaptcha_v2")).toBe(true);
    expect(solver.supports("datadome")).toBe(true);
  });
});
