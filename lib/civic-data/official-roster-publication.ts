import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "./changes.ts";
import { statePeopleCandidate } from "./state-people-publication.ts";
import type { StatePeopleAcquisition } from "./state-people-publication.ts";
import type { OfficialStateLegislatorReadModel } from "./candidate-builders.ts";
import { readOfficialRosterProjection } from "./official-roster-read-model.ts";
export { readOfficialRosterProjection } from "./official-roster-read-model.ts";
import { processRegisteredRoutineCandidate } from "./promotion.ts";
import type { RoutineDataStore } from "./store.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { officialRosterChanges, officialRosterDisagreements } from "../officials/roster-reconciliation.ts";
import type { OfficialRosterTarget } from "../sources/official-rosters/targets.ts";
import { parseOfficialRoster } from "../sources/official-rosters/index.ts";
import { attachOfficialRosterDivisions } from "../officials/roster-divisions.ts";
import type { RegistryDivisionLite } from "../sources/plural/index.ts";

export const OFFICIAL_ROSTER_PARSER_VERSION = "official-rosters/1";
const hash = (value: unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");

export function officialRosterCandidate(input: {
  target: OfficialRosterTarget; roster: OfficeholderSet; acquisitions: readonly StatePeopleAcquisition[];
  releaseId: string; now: string; prior?: OfficeholderSet | null; mirror?: OfficeholderSet | null;
  gaps?: readonly { sourceUrl: string; detail: string }[];
  geography?: {readonly versionId: string; readonly divisions: readonly RegistryDivisionLite[]};
}): RoutineCandidate {
  const base = statePeopleCandidate({ state: input.target.state ?? "", ...input });
  const sourceId = "official-rosters", scope = input.target.scope;
  const readModel = { ...(base.readModel as OfficialStateLegislatorReadModel), sourceId, jurisdiction: input.target.jurisdiction };
  const changes = officialRosterChanges(input.prior ?? input.mirror ?? null, input.roster);
  const disagreements = officialRosterDisagreements(input.mirror ?? null, input.roster);
  const normalizedPayload = { ...(base.normalizedPayload as object), changes, disagreements, ...(input.geography ? {geography: input.geography} : {}) };
  const records = input.roster.officeholders.length + (input.roster.vacancies?.length ?? 0);
  const sourceThrough = input.acquisitions.map(row => row.retrievedAt).sort().at(-1) ?? input.now;
  const documents = input.acquisitions.map(row => ({url: row.requestedUrl, body: row.body, retrievedAt: row.retrievedAt, checkedAt: row.sourceCheck?.checkedAt}));
  const parsed: OfficeholderSet[] = [];
  for (const group of [documents, ...documents.map(row => [row])]) {
    try {
      const roster = parseOfficialRoster(input.target, group, sourceThrough);
      parsed.push(input.geography && input.target.state ? attachOfficialRosterDivisions(roster, input.target.state, input.geography.divisions) : roster);
    }
    catch { /* A route requiring companion documents is checked as a group. */ }
  }
  const sourceVerified = input.roster.officeholders.every(person => parsed.some(roster => roster.officeholders.some(row =>
    row.id === person.id && row.name === person.name && row.officeTitle === person.officeTitle &&
    row.state === person.state && row.chamber === person.chamber &&
    (person.memberships ?? []).filter(membership => membership.current !== false).every(membership =>
      row.memberships?.some(source => ["personId", "officeId", "jurisdiction", "chamber", "district", "divisionId", "officeTitle", "sourceUrl"].every(field =>
        (source[field as keyof typeof source] ?? null) === (membership[field as keyof typeof membership] ?? null)))) &&
    input.roster.divisions.filter(link => link.officeholderId === person.id).every(link => roster.divisions.some(source => source.officeholderId === row.id && source.ocdId === link.ocdId))))) &&
    (input.roster.vacancies ?? []).every(vacancy => parsed.some(roster => roster.vacancies?.some(row => row.id === vacancy.id && row.since === vacancy.since && row.divisionId === vacancy.divisionId)));
  const personIdentities = input.roster.officeholders.map(person => {
    // A seat-bound source record has an exact scoped office, not a publisher-issued person ID.
    const seatBound = person.id.startsWith("official-roster-record:");
    const identifiers: Record<string, string> = seatBound
      ? { office_id: person.memberships?.find(row => row.current !== false)?.officeId ?? "" }
      : { person_id: person.personId ?? person.id };
    return {subjectId: person.id, jurisdiction: input.target.jurisdiction, identifiers,
      matchBasis: seatBound ? "EXACT_SCOPED_ID" as const : "OFFICIAL_ID" as const,
      ambiguous: false, office: person.officeTitle, chamber: person.chamber};
  });
  return { ...base, id: `cv-${hash([sourceId, scope, base.retrieval.rawHash, readModel, input.now]).slice(0, 32)}`, sourceId, scope,
    normalization: { ...base.normalization, parserVersion: OFFICIAL_ROSTER_PARSER_VERSION, schemaVersion: "official-rosters/1",
      inputRecords: records, outputRecords: records, normalizedHash: hash(readModel), normalizedPayloadHash: hash(normalizedPayload) },
    identities: [...personIdentities,
      ...(input.roster.vacancies ?? []).map(row => ({subjectId: row.id, jurisdiction: input.target.jurisdiction,
        identifiers: { office_id: row.id }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false, office: row.officeTitle, chamber: row.chamber}))],
    temporal: { version: sourceThrough, expectedVersion: sourceThrough, sourceThrough, staleAtRetrieval: false },
    semantics: {factKind: "current officeholders and explicit vacancies verified against saved official roster bytes", violations: []},
    horizon: { ...base.horizon, returnedRecords: records, declaredTotal: input.roster.currentMembershipComplete ? records : null },
    sourceProjectionEvidence: sourceProjectionEvidence(sourceId, "STATE_LEGISLATOR", scope),
    dependentChecks: [{consumer: "saved official roster values", passed: sourceVerified && parsed.length > 0,
      detail: "Every holder, office, division and explicit vacancy is reconstructed from its saved publisher response."},
      {consumer: "official roster reader", passed: records > 0 && input.roster.divisions.every(link => input.roster.officeholders.some(person => person.id === link.officeholderId)),
      detail: `${records} sourced people or explicit vacancies; unresolved records remain source gaps.`}], normalizedPayload, readModel,
  };
}

export async function publishOfficialRoster(input: Parameters<typeof officialRosterCandidate>[0] & {store: RoutineDataStore}) {
  const prior = await readOfficialRosterProjection(input.target.scope, {store: input.store, now: input.now, bypassCache: true});
  if (prior.kind === "STORE_UNREACHABLE") throw new Error("OFFICIAL_ROSTER_PRIOR_UNAVAILABLE");
  const held = prior.kind === "PROMOTED" ? prior.value.roster : null;
  // Independent facts in a partial read enrich the last verified roster; only a complete source or an explicit empty seat retires an occupant.
  const { mergeStatePeople } = await import("../state-rollcalls/legislators.ts");
  const roster = held ? mergeStatePeople(held, input.roster) : input.roster;
  const priorCandidate = prior.kind === "PROMOTED" ? await input.store.readCandidate(prior.metadata.versionId!) : null;
  const oldAcquisitions = (priorCandidate?.candidate.normalizedPayload as {acquisitions?: StatePeopleAcquisition[]}|undefined)?.acquisitions ?? [];
  const keys = new Set(input.acquisitions.map(row => hash([row.requestedUrl, row.body])));
  const acquisitions = [...input.acquisitions, ...oldAcquisitions.filter(row => {
    const id = hash([row.requestedUrl, row.body]); if (keys.has(id)) return false;
    keys.add(id); return !input.roster.currentMembershipComplete;
  })];
  const candidate = officialRosterCandidate({...input, roster, acquisitions, prior: held});
  const outcome = await processRegisteredRoutineCandidate(input.store, input.target.id, candidate, input.now, undefined, {confirmUnchanged: true});
  return {candidate, outcome};
}
