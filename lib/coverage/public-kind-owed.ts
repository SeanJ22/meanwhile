import type { FieldManualEntry } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { readFieldManual } from "../control-plane/field-manual.ts";
import { jurisdictionFromOcdId } from "./states.ts";
import { createHash } from "node:crypto";

export interface PublicKindOwed {
  readonly id: string; readonly divisionId: string; readonly kindLabel: string;
  readonly requirement: string; readonly owedSince: string;
  readonly sourceUrl: string; readonly firstRecordId: string;
}
/** First successful publication dates a kind for this division, independently
 * of the global learned-kind log. It never creates a kind in another place. */
export function publicKindOwedForDivisions(entries: readonly FieldManualEntry[], divisions: readonly string[]): readonly PublicKindOwed[] {
  const allowed = new Set(divisions);
  const rows = entries.flatMap(entry => {
    if (entry.kind !== "PUBLIC_RECORD_PLACE_KIND") return [];
    const value = entry.payload as Partial<PublicKindOwed> | null;
    if (!value || typeof value.divisionId !== "string" || !allowed.has(value.divisionId) ||
      !jurisdictionFromOcdId(value.divisionId) && value.divisionId !== "ocd-division/country:us" ||
      typeof value.kindLabel !== "string" || !value.kindLabel.trim() || typeof value.firstRecordId !== "string" ||
      !/^https:\/\//.test(value.sourceUrl ?? "") || !Number.isFinite(Date.parse(value.owedSince ?? ""))) return [];
    const key = JSON.stringify([value.divisionId,value.kindLabel.normalize("NFKC").toLowerCase().trim()]);
    return [{ id: `public-kind:${createHash("sha256").update(key).digest("hex")}`, divisionId: value.divisionId, kindLabel: value.kindLabel,
      requirement: `Keep ${value.kindLabel} current`, owedSince: value.owedSince!, sourceUrl: value.sourceUrl!, firstRecordId: value.firstRecordId }];
  });
  const first = new Map<string,PublicKindOwed>();
  for (const row of rows) {
    const prior=first.get(row.id);
    if(!prior || Date.parse(row.owedSince)<Date.parse(prior.owedSince))first.set(row.id,row);
  }
  return [...first.values()].sort((a,b) => a.id.localeCompare(b.id));
}
export async function readPublicKindOwed(repos: Pick<ControlPlaneRepositories,"fieldManual">, divisions: readonly string[]) {
  const read = await readFieldManual(repos,{role:"SHARED",recordClass:"PUBLIC_RECORD",kinds:["PUBLIC_RECORD_PLACE_KIND"],ocdIds:divisions});
  if (read.error) throw new Error(read.error);
  return publicKindOwedForDivisions(read.store.entries,divisions);
}
