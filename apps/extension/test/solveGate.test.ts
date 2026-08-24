import { describe, expect, it } from "vitest";
import { SolveGate } from "../src/lib/solveGate.js";

describe("SolveGate", () => {
  it("aynı anahtarı in-flight iken ikinci kez başlatmaz", () => {
    const gate = new SolveGate(1_000);
    expect(gate.tryBegin("k")).toBe(true);
    expect(gate.tryBegin("k")).toBe(false);
  });

  it("çözüldükten sonra tekrar denemez", () => {
    const gate = new SolveGate(1_000);
    expect(gate.tryBegin("k")).toBe(true);
    gate.markSolved("k");
    expect(gate.tryBegin("k")).toBe(false);
  });

  it("başarısızlıktan sonra cooldown bitene kadar denemez", () => {
    const gate = new SolveGate(1_000);
    const t0 = 1_000_000;
    expect(gate.tryBegin("k", t0)).toBe(true);
    gate.markFailed("k", t0);
    expect(gate.tryBegin("k", t0 + 500)).toBe(false);
    expect(gate.tryBegin("k", t0 + 1_000)).toBe(true);
  });
});
