import { createPostgresDb, type DbBundle } from "./index.js";
import { createEmbeddedDb } from "./embedded.js";

/** Yapılandırmaya göre Postgres veya gömülü pglite açar. */
export async function openConfiguredDb(opts: {
  databaseUrl?: string;
  embeddedDataDir: string;
}): Promise<DbBundle> {
  if (opts.databaseUrl) return createPostgresDb(opts.databaseUrl);
  return createEmbeddedDb(opts.embeddedDataDir);
}
