import { requireRegistryState, stateRegistryRuntimeContractId } from "./state-scopes.ts";
import { createHash } from "node:crypto";
import type { BallotSet } from "../ballot/types.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { statePeopleScopeForDivision, type StatePeopleJurisdiction } from "../officials/people-identity.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { readFederalDirectoryProjection } from "../officials/federal-directory-read-model.ts";
import { readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { readRegistryRuntimePrior, reconcileOfficialCandidacies, registryRuntimeCandidate, type OfficialCandidacyBridgeRow } from "../registry/runtime-data-plane.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import type { RoutineDataStore } from "./store.ts";
import type { ManualSourceSetReceipt } from "./types.ts";
import { registryEdition } from "./worker-publication-evidence.ts";

export function statePeopleCandidacyHolders(roster: OfficeholderSet): OfficialCandidacyBridgeRow["holder"][] {
  return roster.officeholders.map(holder => ({ id: holder.id, name: holder.name, officeTitle: holder.officeTitle,
    ...(holder.personId ? { personId: holder.personId } : {}), ...(holder.nativeIds ? { nativeIds: holder.nativeIds } : {}),
    ...(holder.websiteUrl ? { officialProfileUrl: holder.websiteUrl } : {}),
    divisions: [...new Set(roster.divisions.filter(division => division.officeholderId === holder.id).map(division => division.ocdId))],
    authority: "STATE_PEOPLE", sourceUrl: holder.provenance.sourceUrl }));
}

export async function publishOfficialBallotCandidacies(input: {
  readonly store: RoutineDataStore;
  readonly ballots: readonly BallotSet[];
  readonly sourceReceipt: ManualSourceSetReceipt;
  readonly now: string;
  readonly statePeople?: ReadonlyMap<StatePeopleJurisdiction, OfficeholderSet>;
}) {
  const states = [...new Set(input.ballots.map(ballot => requireRegistryState(ballot.election.state)))];
  if (!states.length) return null;
  if (states.length !== 1) throw new Error("OFFICIAL_CANDIDACY_PUBLICATION_REQUIRES_ONE_STATE");
  const state = states[0];
  let prior = await readRegistryRuntimePrior(input.store, input.now, state);
  if (!prior) return null;
  const scopes = [...new Set(input.ballots.flatMap(ballot => ballot.contests.map(contest => statePeopleScopeForDivision(contest.ocdId))
    .filter((scope): scope is StatePeopleJurisdiction => scope !== null)))];
  const stateReads = await Promise.allSettled(scopes.map(async scope => {
    const supplied = input.statePeople?.get(scope);
    if (supplied) return supplied;
    const read = await readStatePeopleProjection(scope, { store: input.store, now: input.now, bypassCache: true });
    return read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? read.value.roster : null;
  }));
  const holders = stateReads.flatMap(read => read.status === "fulfilled" && read.value ? statePeopleCandidacyHolders(read.value) : []);
  holders.push(...prior.payload.statewideExecutives.map(row => ({
    id: row.holder.id, name: row.holder.name, officeTitle: row.holder.officeTitle, divisions: [row.stateOcdId],
    ...(row.holder.personId ? { personId: row.holder.personId } : {}), ...(row.holder.nativeIds ? { nativeIds: row.holder.nativeIds } : {}),
    ...(row.holder.websiteUrl ? { officialProfileUrl: row.holder.websiteUrl } : {}),
    authority: "REGISTRY_STATEWIDE_EXECUTIVE" as const, sourceUrl: row.sourceUrl,
  })));
  const dispositions = new Map((prior.payload.rosterReaderDispositions ?? []).map(row => [row.sourceId, row.state]));
  for (const roster of prior.payload.bodyRosters ?? []) holders.push(...roster.members
    .filter(member => !dispositions.has(member.id) || dispositions.get(member.id) === "READER_ELIGIBLE")
    .map(member => ({ id: member.id, name: member.name, officeTitle: member.officeTitle,
      ...(member.personId ? { personId: member.personId } : {}), ...(member.nativeIds ? { nativeIds: member.nativeIds } : {}),
      ...(member.websiteUrl ? { officialProfileUrl: member.websiteUrl } : {}),
      divisions: [roster.bodyId.split("#")[0]], authority: "REGISTRY_BODY_ROSTER" as const,
      sourceUrl: member.websiteUrl ?? member.membershipSource?.sourceUrl ?? roster.sourceUrl })));
  const federalContests = input.ballots.some(ballot => ballot.contests.some(contest => {
    const office = officeIdentity(contest.title, contest.ocdId);
    return office === "us_senator" || office === "us_representative";
  }));
  if (federalContests) {
    const federal = await readFederalDirectoryProjection([state], { store: input.store, now: input.now, bypassCache: true }).catch(() => null);
    if (federal && (federal.kind === "PROMOTED" || federal.kind === "BOOTSTRAP")) {
      holders.push(...statePeopleCandidacyHolders(federal.value.roster).map(holder => ({ ...holder, authority: "FEDERAL_DIRECTORY" as const })));
    }
  }
  const bridge = reconcileOfficialCandidacies({ bridge: prior.payload.officialCandidacies, ballots: input.ballots, holders });
  const old = new Map(prior.payload.officialCandidacies.rows.map(row => [row.holder.id, canonicalCivicDataJson(row)]));
  const changed = bridge.rows.filter(row => old.get(row.holder.id) !== canonicalCivicDataJson(row));
  if (!changed.length) return null;
  const digest = createHash("sha256").update(canonicalCivicDataJson(changed)).digest("hex").slice(0, 20);
  const candidate = registryRuntimeCandidate({ contractId: stateRegistryRuntimeContractId(state), scope: "MEMBERS",
    version: registryEdition(`ballot-candidacies:${digest}`), sourceThrough: input.now, sourceReceipt: input.sourceReceipt,
    payload: { ...prior.payload, registry: { ...prior.payload.registry, generatedAt: input.now, divisions: [], bodies: [] },
      statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
      officialCandidacies: { ...bridge, rows: changed } } }, { prior });
  const priorVersionId = prior.versionId;
  prior = null;
  const outcome = await processRegisteredManualCandidate(input.store, stateRegistryRuntimeContractId(state), candidate, input.now, priorVersionId);
  if (!outcome.promoted || !outcome.confirmed && outcome.readerReadback?.status !== "PASS") {
    throw new Error(`OFFICIAL_CANDIDACY_PUBLICATION_HELD:${outcome.candidate.failureDetail ?? outcome.readerReadback?.detail ?? outcome.candidate.state}`);
  }
  return outcome;
}
