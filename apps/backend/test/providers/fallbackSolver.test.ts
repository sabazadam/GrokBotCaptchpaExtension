import { describe, expect, it, vi } from "vitest";
import type { CaptchaTypeId, NormalizedSolution, SolveRequest } from "@grokbot/shared";
import { FallbackSolver } from "../../src/providers/fallbackSolver.js";
import { SolverError, type CaptchaSolver } from "../../src/providers/types.js";

const req: SolveRequest = {
  captchaType: "recaptcha_v2",
  websiteURL: "https://site.com",
  websiteKey: "k",
};

function solverWith(
  name: string,
  impl: () => Promise<NormalizedSolution>,
  supports: (t: CaptchaTypeId) => boolean = () => true,
): CaptchaSolver {
  return { name, supports, solve: impl };
}

describe("FallbackSolver", () => {
  it("sağlayıcısız kurulamaz", () => {
    expect(() => new FallbackSolver({ providers: [] })).toThrow(/en az bir sağlayıcı/);
  });

  it("tüm denemeler timeout ise kind=timeout döner", async () => {
    const fb = new FallbackSolver({
      providers: [
        solverWith("p1", async () => {
          throw new SolverError("t1", "timeout", "p1");
        }),
        solverWith("p2", async () => {
          throw new SolverError("t2", "timeout", "p2");
        }),
      ],
      retriesPerProvider: 0,
    });
    try {
      await fb.solve(req);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SolverError);
      expect((err as SolverError).kind).toBe("timeout");
    }
  });

  it("birincil başarılıysa onu döner, diğerini çağırmaz", async () => {
    const secondary = vi.fn(async (): Promise<NormalizedSolution> => ({ token: "B", raw: {} }));
    const fb = new FallbackSolver({
      providers: [
        solverWith("p1", async () => ({ token: "A", raw: {} })),
        solverWith("p2", secondary),
      ],
    });
    const res = await fb.solve(req);
    expect(res.token).toBe("A");
    expect(secondary).not.toHaveBeenCalled();
  });

  it("birincil başarısızsa bir sonrakine geçer", async () => {
    const fb = new FallbackSolver({
      providers: [
        solverWith("p1", async () => {
          throw new SolverError("boom", "error", "p1");
        }),
        solverWith("p2", async () => ({ token: "B", raw: {} })),
      ],
      retriesPerProvider: 0,
    });
    const res = await fb.solve(req);
    expect(res.token).toBe("B");
  });

  it("hepsi başarısızsa toplu SolverError fırlatır", async () => {
    const fb = new FallbackSolver({
      providers: [
        solverWith("p1", async () => {
          throw new SolverError("e1", "error", "p1");
        }),
        solverWith("p2", async () => {
          throw new SolverError("e2", "timeout", "p2");
        }),
      ],
      retriesPerProvider: 0,
    });
    try {
      await fb.solve(req);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SolverError);
      expect((err as SolverError).causes).toHaveLength(2);
    }
  });

  it("desteklemeyen sağlayıcı atlanır", async () => {
    const p1 = vi.fn(async (): Promise<NormalizedSolution> => ({ token: "A", raw: {} }));
    const fb = new FallbackSolver({
      providers: [
        solverWith("p1", p1, () => false),
        solverWith("p2", async () => ({ token: "B", raw: {} })),
      ],
    });
    const res = await fb.solve(req);
    expect(res.token).toBe("B");
    expect(p1).not.toHaveBeenCalled();
  });

  it("geçici hatada aynı sağlayıcıyı yeniden dener", async () => {
    let attempts = 0;
    const fb = new FallbackSolver({
      providers: [
        solverWith("p1", async () => {
          attempts++;
          if (attempts < 2) throw new SolverError("transient", "error", "p1");
          return { token: "A", raw: {} };
        }),
      ],
      retriesPerProvider: 1,
    });
    const res = await fb.solve(req);
    expect(res.token).toBe("A");
    expect(attempts).toBe(2);
  });

  it("sağlayıcı zaman aşımına uğrarsa bir sonrakine geçer", async () => {
    const fb = new FallbackSolver({
      providers: [
        solverWith("slow", () => new Promise(() => {})), // asla çözülmez
        solverWith("fast", async () => ({ token: "B", raw: {} })),
      ],
      retriesPerProvider: 0,
      attemptTimeoutMs: 10,
    });
    const res = await fb.solve(req);
    expect(res.token).toBe("B");
  });
});
