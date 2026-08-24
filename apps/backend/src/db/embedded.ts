import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import * as schema from "./schema.js";
import type { AppDatabase, DbBundle } from "./index.js";

/** Disk tabanlı gömülü DB için kilit dosyası (tek süreç / tek bağlantı). */
export const EMBEDDED_DB_LOCK_FILE = ".grokbot.lock";

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireDataDirLock(dataDir: string): Promise<() => Promise<void>> {
  await mkdir(dataDir, { recursive: true });
  const lockFile = path.join(dataDir, EMBEDDED_DB_LOCK_FILE);

  const tryCreate = async (): Promise<boolean> => {
    try {
      await writeFile(lockFile, `${process.pid}\n`, { flag: "wx" });
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      return false;
    }
  };

  if (!(await tryCreate())) {
    const raw = await readFile(lockFile, "utf8").catch(() => "");
    const pid = Number.parseInt(raw.trim(), 10);
    if (pidAlive(pid)) {
      throw new Error(
        `Gömülü veritabanı zaten başka bir süreçte açık (pid ${pid}, ${lockFile}). ` +
          `issue-code için çalışan sunucunun admin API'sini kullanın (ADMIN_TOKEN) ` +
          `veya diğer süreci kapatın.`,
      );
    }
    await unlink(lockFile).catch(() => undefined);
    if (!(await tryCreate())) {
      throw new Error(`Gömülü veritabanı kilit dosyası alınamadı: ${lockFile}`);
    }
  }

  return async () => {
    await unlink(lockFile).catch(() => undefined);
  };
}

/**
 * Gömülü (in-process) PostgreSQL — @electric-sql/pglite ile.
 * Yerel geliştirme/tek makine için harici bir Postgres sunucusu gerektirmez.
 * `dataDir` verilirse diske kalıcı olur; verilmezse bellekte çalışır (testler).
 * Disk modu tek süreçlidir: aynı dizini ikinci bir süreç açamaz.
 * Üretim için gerçek Postgres (DATABASE_URL) kullanın; NODE_ENV=production iken zorunludur.
 */
export async function createEmbeddedDb(dataDir?: string): Promise<DbBundle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");

  const resolvedDir = dataDir ? path.resolve(dataDir) : undefined;
  const releaseLock = resolvedDir ? await acquireDataDirLock(resolvedDir) : undefined;

  try {
    const client = resolvedDir ? await PGlite.create(resolvedDir) : await PGlite.create();
    await client.waitReady;
    const db = drizzle(client, { schema }) as unknown as AppDatabase;
    return {
      db,
      exec: async (sql: string) => {
        await client.exec(sql);
      },
      close: async () => {
        try {
          await client.close();
        } finally {
          await releaseLock?.();
        }
      },
    };
  } catch (err) {
    await releaseLock?.();
    throw err;
  }
}
