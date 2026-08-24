import { createEmbeddedDb } from "../../src/db/embedded.js";
import { migrate, type DbBundle } from "../../src/db/index.js";

/** Test için bellek içi gömülü Postgres (pglite) — gerçek SQL, sunucu gerektirmez. */
export async function createTestDb(): Promise<DbBundle> {
  const bundle = await createEmbeddedDb();
  await migrate(bundle);
  return bundle;
}
