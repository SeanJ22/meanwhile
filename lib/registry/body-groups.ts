import type { CoveredBody } from "./coverage.ts";
import { bodyDisplayName, readerGovernmentName } from "../text/reader-names.ts";

type GovernmentType = NonNullable<CoveredBody["governmentType"]>;

export interface GovernmentBodyRow<T extends CoveredBody = CoveredBody> {
  body: T;
  meetingTypes: T[];
}

export interface GovernmentBodyGroup<T extends CoveredBody = CoveredBody> {
  id: string;
  name: string;
  rows: GovernmentBodyRow<T>[];
}

export interface GovernmentBodySection<T extends CoveredBody = CoveredBody> {
  type: GovernmentType;
  label: string;
  governments: GovernmentBodyGroup<T>[];
}

const SECTIONS: readonly [GovernmentType, string][] = [
  ["city", "Cities and towns"],
  ["county", "Counties"],
  ["school_district", "School districts"],
  ["special_district", "Special Districts"],
  ["state", "State"],
  ["national", "Federal"],
  ["other", "Other governments"],
];

function governmentType(body: CoveredBody): GovernmentType {
  if (body.governmentType) return body.governmentType;
  if (body.divisionType === "place" || body.divisionType === "county_subdivision") return "city";
  if (body.divisionType === "county" || body.divisionType === "school_district" || body.divisionType === "special_district") return body.divisionType;
  return body.tier === "local" ? "other" : body.tier === "state" ? "state" : "national";
}

function compareBodies(a: CoveredBody, b: CoveredBody): number {
  return Number(b.bodyClass === "GOVERNING") - Number(a.bodyClass === "GOVERNING")
    || bodyDisplayName(a).localeCompare(bodyDisplayName(b)) || a.bodyId.localeCompare(b.bodyId);
}

/** Group the reader's exact rows, filing meeting types under their held body.
 * A missing parent or a broken parent cycle keeps the original row reachable. */
export function groupBodiesByGovernment<T extends CoveredBody>(bodies: readonly T[]): GovernmentBodySection<T>[] {
  const byId = new Map(bodies.map(body => [body.bodyId, body]));
  const roots = new Map<string, GovernmentBodyRow<T>>();
  for (const body of bodies) {
    let holder = body;
    const seen = new Set([body.bodyId]);
    while (holder.meetingBodyId && byId.has(holder.meetingBodyId)) {
      if (seen.has(holder.meetingBodyId)) { holder = body; break; }
      seen.add(holder.meetingBodyId);
      holder = byId.get(holder.meetingBodyId)!;
    }
    let row = roots.get(holder.bodyId);
    if (!row) { row = { body: holder, meetingTypes: [] }; roots.set(holder.bodyId, row); }
    if (holder.bodyId !== body.bodyId) row.meetingTypes.push(body);
  }
  const groups = new Map<GovernmentType, Map<string, GovernmentBodyGroup<T>>>();
  for (const row of roots.values()) {
    const body = row.body, type = governmentType(body);
    const id = body.governmentId ?? body.ocdId ?? body.bodyId;
    const name = body.governmentName ?? readerGovernmentName(body.divisionLabel, body.divisionType);
    let section = groups.get(type);
    if (!section) { section = new Map(); groups.set(type, section); }
    let government = section.get(id);
    if (!government) { government = { id, name, rows: [] }; section.set(id, government); }
    row.meetingTypes.sort(compareBodies);
    government.rows.push(row);
  }
  return SECTIONS.flatMap(([type, label]) => {
    const governments = [...(groups.get(type)?.values() ?? [])];
    for (const government of governments) government.rows.sort((a, b) => compareBodies(a.body, b.body));
    governments.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return governments.length ? [{ type, label, governments }] : [];
  });
}
