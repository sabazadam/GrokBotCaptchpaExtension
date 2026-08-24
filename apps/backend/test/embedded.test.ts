import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEmbeddedDb, EMBEDDED_DB_LOCK_FILE } from "../src/db/embedded.js";
import { migrate } from "../src/db/index.js";
import { users } from "../src/db/schema.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "grokbot-pglite-"));
  dirs.push(dir);
  return dir;
}

describe("createEmbeddedDb", () => {
  it("bellek içi örnek kilit dosyası oluşturmaz", async () => {
    const bundle = await createEmbeddedDb();
    await migrate(bundle);
    await bundle.close();
  });

  it("aynı dataDir'i ikinci süreç/örnek açamaz", async () => {
    const dir = await tempDir();
    const first = await createEmbeddedDb(dir);
    await migrate(first);
    await expect(createEmbeddedDb(dir)).rejects.toThrow(/zaten/);
    await first.close();
    const second = await createEmbeddedDb(dir);
    await second.close();
  });

  it("ölü kilit dosyasını devralır", async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, EMBEDDED_DB_LOCK_FILE), "99999999\n", "utf8");
    const bundle = await createEmbeddedDb(dir);
    await migrate(bundle);
    const lock = await readFile(path.join(dir, EMBEDDED_DB_LOCK_FILE), "utf8");
    expect(lock.trim()).toBe(String(process.pid));
    await bundle.close();
  });

  it("diske kalıcı olur", async () => {
    const dir = await tempDir();
    const a = await createEmbeddedDb(dir);
    await migrate(a);
    await a.db.insert(users).values({ email: "persist@test.com" });
    await a.close();

    const b = await createEmbeddedDb(dir);
    await migrate(b);
    const rows = await b.db.select({ email: users.email }).from(users);
    expect(rows.map((r) => r.email)).toEqual(["persist@test.com"]);
    await b.close();
  });
});
