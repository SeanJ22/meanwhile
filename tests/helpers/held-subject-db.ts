import { readerMigrationDb, savePromotedFixture } from "./dg-migration-db.ts";

/** The fact store and immutable registry parts used by a held subject's exact-body reads. */
export async function heldSubjectDb() {
  const db = await readerMigrationDb();
  const saveRegistry = (state: string, value: unknown) => savePromotedFixture(db, { recordClass: "REGISTRY_RUNTIME_BINDING",
    scope: `US-${state}:reader-registry-runtime`, sourceId: "dg-held-registry-fixture", value });
  return { ...db, saveRegistry };
}
