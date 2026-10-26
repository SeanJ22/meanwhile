import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "./changes.ts";
import { sourceContentHash } from "./source-hash.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { StatePeopleAcquisition, StatePeopleCapture } from "./state-people-publication.ts";

export function peopleNormalizationInputHash(roster: OfficeholderSet): string {
  const sort = (rows: unknown[][]) => rows.sort((a,b) => canonicalCivicDataJson(a).localeCompare(canonicalCivicDataJson(b)));
  const members = roster.officeholders.map(person => [person.id, person.officeTitle, person.termStart, person.termEnd,
    sort(person.memberships?.map(row => [row.id, row.current, row.divisionId]) ?? [])]);
  return createHash("sha256").update(canonicalCivicDataJson({ members: sort(members),
    divisions: sort(roster.divisions.map(row => [row.officeholderId, row.membershipId ?? null, row.ocdId, row.bodyId])),
    vacancies: sort((roster.vacancies ?? []).map(row => [row.ocdId, row.reason, row.since ?? null])) })).digest("hex");
}

export function peopleSourceContentHash(pages: readonly (StatePeopleAcquisition | StatePeopleCapture)[], roster: OfficeholderSet): string {
  return sourceContentHash(pages, { normalizationInputHash: peopleNormalizationInputHash(roster) });
}
