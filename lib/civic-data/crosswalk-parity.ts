/**
 * **DOES THE AUTOMATIC CROSSWALK HOLD WHAT THE MANUAL ONE PRODUCED?** (DB-24, the check before retiring the manual
 * `meeting-body-crosswalk` contract.)
 *
 * The manual crosswalk is composed with the automatic one and wins over it (`composeCrosswalk`). Retiring it is safe
 * only if the automatic crosswalk already holds an ACTIVE row for every connection the manual one holds ACTIVE, and
 * only after what a manual WITHDRAWN row stops is handled: a withdrawal by review is never undone by the reviewer
 * today, because the manual row shadows it. Without the manual row the reviewer could accept that route again.
 *
 * PURE: it reads two row lists and says what is covered, what is not, and what differs. It writes nothing.
 */
import { crosswalkRowId, type MeetingBodyCrosswalkRow } from "./meeting-body-crosswalk.ts";
import { canonicalCivicDataJson } from "./changes.ts";

export interface CrosswalkParity {
  readonly manualRows: number;
  readonly derivedRows: number;
  /** Manual ACTIVE connections the automatic crosswalk also holds ACTIVE. */
  readonly covered: readonly string[];
  /** Manual ACTIVE connections the automatic crosswalk does not hold ACTIVE: retiring the manual contract loses these. */
  readonly onlyManualActive: readonly string[];
  /** Manual WITHDRAWN connections: retiring the manual contract lets the reviewer accept them again unless handled. */
  readonly manualWithdrawn: readonly string[];
  /** Covered connections whose settings differ (calendar filter, body role, zone, publisher), so the wiring would change. */
  readonly differs: readonly { readonly id: string; readonly fields: readonly string[] }[];
}

const DEFINING = ["jurisdictionId", "ocdId", "bodyRole", "bodyName", "officialHost", "filter", "publishingOrg", "timeZone"] as const;

export function crosswalkParity(
  manual: readonly MeetingBodyCrosswalkRow[],
  derived: readonly MeetingBodyCrosswalkRow[],
): CrosswalkParity {
  const key = (row: MeetingBodyCrosswalkRow) => crosswalkRowId(row.bodyId, row.kind, row.route);
  const derivedActive = new Map(derived.filter((row) => row.status === "ACTIVE").map((row) => [key(row), row] as const));
  const covered: string[] = [];
  const onlyManualActive: string[] = [];
  const manualWithdrawn: string[] = [];
  const differs: { id: string; fields: string[] }[] = [];
  for (const row of manual) {
    const id = key(row);
    if (row.status === "WITHDRAWN") { manualWithdrawn.push(id); continue; }
    const other = derivedActive.get(id);
    if (other === undefined) { onlyManualActive.push(id); continue; }
    covered.push(id);
    const fields = DEFINING.filter((field) => canonicalCivicDataJson(row[field]) !== canonicalCivicDataJson(other[field]));
    if (fields.length > 0) differs.push({ id, fields });
  }
  const sort = (rows: string[]) => rows.sort();
  return {
    manualRows: manual.length,
    derivedRows: derived.length,
    covered: sort(covered),
    onlyManualActive: sort(onlyManualActive),
    manualWithdrawn: sort(manualWithdrawn),
    differs: differs.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}
