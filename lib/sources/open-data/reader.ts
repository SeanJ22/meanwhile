import type { PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { lookupZcta } from "../../geo/zcta.ts";
import { ocdStateCode } from "../../ocd/state-of.ts";
import { nearbyFacilityCells, facilityNear, FACILITY_RADIUS_KM } from "./geography.ts";
import { divisionPartition, zipPartition, type OpenDataFact, type OpenDataSource } from "./model.ts";
import { readOpenDataPartition } from "./artifacts.ts";
import { readOpenDataArea, readLegacyOpenDataRecords } from "./area-read.ts";
import { readOpenDataProjection } from "./publication.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";

export async function readerOpenData(input: { divisionIds?: readonly string[]; zip?: string | null; bodyId?: string | null }, options: PromotedCivicDataReadOptions & { vault?: EvidenceStore } = {}) {
  const divisions = [...new Set(input.divisionIds ?? [])], states = [...new Set(divisions.flatMap(id => ocdStateCode(id)?.toUpperCase() ?? []))];
  if (states.length > 1) throw new Error("OPEN_DATA_STATE_BOUNDARY_MISMATCH");
  const point = input.zip ? lookupZcta(input.zip) : null, state = states[0] ?? point?.postal?.state?.toUpperCase();
  const requested = [
    ...(divisions.length ? [{ source: "socrata-discovery" as const, partitions: divisions.map(divisionPartition) }] : []),
    ...(input.zip && /^\d{5}$/.test(input.zip) ? [{ source: "epa-echo" as const, partitions: [zipPartition(input.zip), ...(point ? nearbyFacilityCells(point) : [])] }] : []),
  ];
  const records = new Map<string, OpenDataFact>(), unavailable: OpenDataSource[] = [], notHeld: OpenDataSource[] = [], checkedAt: Record<string, string> = {};
  for (const item of requested) {
    if (!state) continue;
    const add = (row: OpenDataFact) => {
      // The state line remains a hard boundary, including nearby-cell and shared-ZIP reads.
      if (row.state !== state && !(row.sourceId === "socrata-discovery" && divisions.some(id => row.divisionIds.includes(id)))) return;
      if (row.sourceId === "socrata-discovery" && !divisions.some(id => row.divisionIds.includes(id))) return;
      if (row.sourceId === "socrata-discovery" && input.bodyId && row.bodyIds.length && !row.bodyIds.includes(input.bodyId)) return;
      if (row.sourceId === "epa-echo" && row.zip !== input.zip && (!point || !facilityNear(row, point))) return;
      records.set(row.id, row);
    };
    try {
      const read = await readOpenDataArea(item.source, state, item.partitions, options);
      if (read.kind === "STORE_UNREACHABLE") { unavailable.push(item.source); continue; }
      if (read.kind !== "PROMOTED") { notHeld.push(item.source); continue; }
      const release = await readOpenDataProjection(item.source, "release", options);
      const clock = release.kind === "PROMOTED" ? release.metadata : read.metadata;
      const date = clock.checkedAt ?? clock.retrievedAt; if (date) checkedAt[item.source] = date;
      for (const row of read.value.records) add(row);
      for (const reference of read.value.partitions ?? []) {
        try { const value = await readOpenDataPartition(item.source, reference, options.vault); for (const row of value.records) add(row); }
        catch { unavailable.push(item.source); }
      }
      for (const row of await readLegacyOpenDataRecords(item.source, input, options)) add(row);
    } catch { unavailable.push(item.source); }
  }
  return { records: [...records.values()], unavailable: [...new Set(unavailable)], notHeld: [...new Set(notHeld)], radiusKm: point ? FACILITY_RADIUS_KM : null, checkedAt };
}
