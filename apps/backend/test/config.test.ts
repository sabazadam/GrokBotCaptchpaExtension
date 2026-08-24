import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const KEY = "test-capsolver-key";

describe("loadConfig", () => {
  it("CAPSOLVER_API_KEY yoksa reddeder", () => {
    expect(() => loadConfig({})).toThrow(/CAPSOLVER_API_KEY/);
  });

  it("geliştirmede DATABASE_URL olmadan gömülü DB yolunu kullanır", () => {
    const cfg = loadConfig({ CAPSOLVER_API_KEY: KEY });
    expect(cfg.databaseUrl).toBeUndefined();
    expect(path.isAbsolute(cfg.embeddedDataDir)).toBe(true);
    expect(cfg.embeddedDataDir).toMatch(/pglite/);
  });

  it("üretimde DATABASE_URL yoksa fail-closed olur (sessiz pglite yok)", () => {
    expect(() => loadConfig({ CAPSOLVER_API_KEY: KEY, NODE_ENV: "production" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("üretimde boş veya yalnızca boşluk DATABASE_URL reddedilir", () => {
    expect(() =>
      loadConfig({
        CAPSOLVER_API_KEY: KEY,
        NODE_ENV: "production",
        DATABASE_URL: "   ",
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("DATABASE_URL baş/son boşluklarını kırpar", () => {
    const cfg = loadConfig({
      CAPSOLVER_API_KEY: KEY,
      DATABASE_URL: " postgres://user:pass@localhost:5432/grokbot ",
    });
    expect(cfg.databaseUrl).toBe("postgres://user:pass@localhost:5432/grokbot");
  });

  it("PGLITE_DATA_DIR mutlak yola çözülür", () => {
    const cfg = loadConfig({
      CAPSOLVER_API_KEY: KEY,
      PGLITE_DATA_DIR: "custom-pgdata",
    });
    expect(cfg.embeddedDataDir).toBe(path.resolve("custom-pgdata"));
  });

  it("HOST yoksa 0.0.0.0 dinler (LAN senaryosu)", () => {
    const cfg = loadConfig({ CAPSOLVER_API_KEY: KEY });
    expect(cfg.listenHost).toBe("0.0.0.0");
  });

  it("HOST ile dinleme adresi kısıtlanabilir", () => {
    const cfg = loadConfig({ CAPSOLVER_API_KEY: KEY, HOST: "127.0.0.1" });
    expect(cfg.listenHost).toBe("127.0.0.1");
  });
});
