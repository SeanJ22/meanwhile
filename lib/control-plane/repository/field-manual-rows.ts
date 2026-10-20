import { entryInSlice, type FieldManualEntry } from "../field-manual.ts";
import { IdentityCollision, type AggregateRepository, type FieldManualRepository, type Persisted } from "./types.ts";
import { forEachAggregate } from "../workers/streamed-history.ts";
import { projectManualRow } from "./manual-slice-projection.ts";

/** The field manual over a store without a query language: one aggregate per entry, a slice filtered as it is read. */
export function fieldManualRows(base: AggregateRepository<FieldManualEntry>, native: Pick<FieldManualRepository,"compareAndSetMergedEntry">): FieldManualRepository {
  return {
    ...base,
    readMany: base.readMany ?? (async (ids) => (await Promise.all([...new Set(ids)].sort().map((id) => base.read(id))))
      .filter((row): row is Persisted<FieldManualEntry> => row !== null)),
    async slice(query) {
      const rows: Persisted<FieldManualEntry>[] = [];
      await this.visitSlice(query, row => { rows.push(row); });
      return rows;
    },
    async visitSlice(query, visit, projection) {
      await forEachAggregate(base, async slot => {
        const row = await projectManualRow(base, slot.id, query);
        if (row && entryInSlice(row.value, query)) {
          const selected = projection ? await base.readNarrowed(row.id, projection) : row;
          if (selected) await visit(selected as Persisted<FieldManualEntry>);
        }
      }, {});
    },
    async insertNew(entries, now) {
      const inserted = new Set<string>();
      for (const entry of entries) {
        try { if ((await base.put(entry.id, entry, now)).created) inserted.add(entry.id); }
        catch (error) { if (!(error instanceof IdentityCollision)) throw error; }
      }
      return inserted;
    },
    ...native,
  };
}
