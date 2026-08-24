import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.js";
import { migrate, type AppDatabase, type DbBundle } from "../../src/db/index.js";

/** Test için gömülü (in-process) Postgres — gerçek SQL semantiği, sunucu gerektirmez. */
export async function createTestDb(): Promise<DbBundle> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as AppDatabase;
  const bundle: DbBundle = {
    db,
    exec: async (sql: string) => {
      await client.exec(sql);
    },
    close: async () => {
      await client.close();
    },
  };
  await migrate(bundle);
  return bundle;
}
