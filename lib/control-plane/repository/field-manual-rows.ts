import { entryInSlice, type FieldManualEntry } from "../field-manual.ts";
import { IdentityCollision, type AggregateRepository, type FieldManualRepository, type Persisted } from "./types.ts";

/** The field manual over a store without a query language: one aggregate per entry, a slice filtered as it is read. */
export function fieldManualRows(base: AggregateRepository<FieldManualEntry>): FieldManualRepository {
  return {
    ...base,
    readMany: base.readMany ?? (async (ids) => (await Promise.all([...new Set(ids)].sort().map((id) => base.read(id))))
      .filter((row): row is Persisted<FieldManualEntry> => row !== null)),
    slice: async (query) => (await base.list()).filter((row) => entryInSlice(row.value, query)),
    async insertNew(entries, now) {
      const inserted = new Set<string>();
      for (const entry of entries) {
        try { if ((await base.put(entry.id, entry, now)).created) inserted.add(entry.id); }
        catch (error) { if (!(error instanceof IdentityCollision)) throw error; }
      }
      return inserted;
    },
  };
}
