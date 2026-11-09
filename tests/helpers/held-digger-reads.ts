import { HELD_DIGGER_CLASSES, HELD_DIGGER_SOURCE_FIELDS, type HeldDiggerReads, type HeldDiggerSourceRow } from "../../lib/control-plane/workers/held-digger-sources.ts";
import type { ControlPlaneRepositories } from "../../lib/control-plane/repository/types.ts";

/** The held-digger source reads the production runner makes against Postgres, served from in-memory repositories. */
export function memoryDiggerReads(repos: ControlPlaneRepositories): HeldDiggerReads {
  return {
    async sourceChanges(since, page) {
      const changed = await repos.routeTasks.listChangedSince!(since, undefined, { projection: HELD_DIGGER_SOURCE_FIELDS,
        page: rows => page(rows as unknown as readonly HeldDiggerSourceRow[]) });
      return { through: changed.through! };
    },
    async pendingTaskIds() {
      const ids: string[] = [];
      for (const kind of HELD_DIGGER_CLASSES) for (const row of await repos.routeTasks.listWhereNarrowed(["workerTask", "contract", "recordClass"], kind, { state: true })) {
        const state = (row.value as { state: string }).state;
        if (state === "PENDING" || state === "RECLAIMABLE") ids.push(row.id);
      }
      return ids;
    },
  };
}
