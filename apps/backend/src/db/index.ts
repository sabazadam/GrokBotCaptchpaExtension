import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";
import { DDL } from "./ddl.js";

export type AppDatabase = PgDatabase<any, typeof schema>;

export interface DbBundle {
  db: AppDatabase;
  /** Çoklu-ifade SQL çalıştırır (DDL için). */
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
}

/** Üretim için postgres.js tabanlı bağlantı. */
export function createPostgresDb(connectionString: string): DbBundle {
  const client = postgres(connectionString, { max: 10 });
  const db = drizzle(client, { schema }) as unknown as AppDatabase;
  return {
    db,
    exec: async (sql: string) => {
      await client.unsafe(sql);
    },
    close: async () => {
      await client.end();
    },
  };
}

/** Şemayı (idempotent) kurar. */
export async function migrate(bundle: DbBundle): Promise<void> {
  await bundle.exec(DDL);
}

export { schema };
