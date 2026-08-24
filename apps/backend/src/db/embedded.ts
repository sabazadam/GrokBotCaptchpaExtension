import * as schema from "./schema.js";
import type { AppDatabase, DbBundle } from "./index.js";

/**
 * Gömülü (in-process) PostgreSQL — @electric-sql/pglite ile.
 * Yerel geliştirme/tek makine için harici bir Postgres sunucusu gerektirmez.
 * `dataDir` verilirse diske kalıcı olur; verilmezse bellekte çalışır (testler).
 * Üretim için gerçek Postgres (DATABASE_URL) kullanın.
 */
export async function createEmbeddedDb(dataDir?: string): Promise<DbBundle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema }) as unknown as AppDatabase;
  return {
    db,
    exec: async (sql: string) => {
      await client.exec(sql);
    },
    close: async () => {
      await client.close();
    },
  };
}
