import { describe, expect, it } from "vitest";
import { buildInstallPrompt } from "../src/onboarding/installPrompt.js";

describe("buildInstallPrompt", () => {
  it("kod ve backend URL'sini içerir", () => {
    const prompt = buildInstallPrompt({
      activationCode: "ABCD-EFGH",
      backendUrl: "https://api.example.com",
    });
    expect(prompt).toContain("ABCD-EFGH");
    expect(prompt).toContain("https://api.example.com");
    expect(prompt).toContain("Etkinleştir");
  });

  it("extensionUrl verilince kurulum linkini ekler", () => {
    const prompt = buildInstallPrompt({
      activationCode: "X",
      backendUrl: "https://api",
      extensionUrl: "https://store/xyz",
    });
    expect(prompt).toContain("https://store/xyz");
  });
});
