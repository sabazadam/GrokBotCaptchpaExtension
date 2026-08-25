import { describe, expect, it } from "vitest";
import { generateActivationCode, generateToken, hashSecret } from "../src/auth/tokens.js";

describe("hashSecret", () => {
  it("aynı girdi için deterministik SHA-256 hex üretir", () => {
    expect(hashSecret("abc")).toBe(hashSecret("abc"));
    expect(hashSecret("abc")).not.toBe(hashSecret("abd"));
    expect(hashSecret("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("generateActivationCode", () => {
  it("gruplu, belirsiz karakter içermeyen kod üretir", () => {
    const code = generateActivationCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(code).not.toMatch(/[01ILO]/);
  });
});

describe("generateToken", () => {
  it("opak ve çakışmayan token üretir", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});
