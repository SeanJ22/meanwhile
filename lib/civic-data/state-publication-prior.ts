import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { civicRecordFacts, civicRecordsFor } from "./changes.ts";
import { statePublicationScope } from "./state-publication.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { PromotedProjection, RoutineCandidate } from "./types.ts";

export interface StatePublicationPrior {
  readonly versionId: string;
  readonly payloadHash: string;
  readonly members: Map<string, { readonly key: string; readonly factsHash: string; readonly sha256: string; record?: unknown }>;
  readonly ballotCandidates: Map<string, { electionId: string; electionDate: string; contestId: string; ocdId: string;
    candidateListComplete: boolean; sourceUrl: string | null; candidacyCollectedAt: string }>;
  readonly officialIdentityAuthority: unknown;
}

const priors = new WeakMap<object, Map<string, StatePublicationPrior>>();
const replacements = new WeakMap<object, { member: StatePublicationPrior["members"] extends Map<string, infer T> ? T : never;
  recordClass: RoutineCandidate["recordClass"]; project?: (value: unknown) => unknown }[]>();
const bound = new WeakMap<RoutineCandidate, StatePublicationPrior>();
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" ? value as Record<string, unknown> : null;

export function rememberStatePublicationPrior(store: object, projection: PromotedProjection): void {
  if (!statePublicationScope(projection.scope)) return;
  const prior: StatePublicationPrior = { versionId: projection.versionId, payloadHash: canonicalCivicDataHash(projection.payload),
    members: new Map(), ballotCandidates: new Map(), officialIdentityAuthority: object(projection.payload)?.officialIdentityAuthority ?? null };
  const index = (value: unknown, member: StatePublicationPrior["members"] extends Map<string, infer T> ? T : never,
    project?: (value: unknown) => unknown) => {
    if (!object(value)) return;
    const entries = replacements.get(value as object) ?? [];
    entries.push({ member, recordClass: projection.recordClass, project });
    replacements.set(value as object, entries);
  };
  for (const member of civicRecordsFor(projection.recordClass, projection.payload)) {
    const entry = { ...member, factsHash: canonicalCivicDataHash(civicRecordFacts(projection.recordClass, member)),
      sha256: canonicalCivicDataHash(member.record) };
    prior.members.set(member.key, entry);
    index(member.record, entry);
  }
  if (projection.recordClass === "VOTING_SITE") for (const jurisdiction of (object(projection.payload)?.jurisdictions ?? []) as Record<string, unknown>[]) {
    const entry = prior.members.get(`jurisdiction:${jurisdiction.ocdId}`);
    if (entry) index(jurisdiction, entry, value => {
      const { sites: _sites, ...metadata } = object(value) ?? {};
      return metadata;
    });
  }
  if (projection.recordClass === "BALLOT_CANDIDACY") for (const ballot of Object.values((projection.payload as GenericBallotProjection).ballots ?? {})) {
    const contests = new Map(ballot.contests.map(contest => [contest.id, contest]));
    for (const candidacy of ballot.candidacies) {
      const contest = contests.get(candidacy.contestId);
      if (!contest) continue;
      const context = { electionId: ballot.election.id, electionDate: ballot.election.date, contestId: contest.id, ocdId: contest.ocdId,
        candidateListComplete: contest.candidateListComplete === true, sourceUrl: contest.provenance.sourceUrl,
        candidacyCollectedAt: candidacy.provenance.collectedAt };
      prior.ballotCandidates.set(`candidacy:${candidacy.id}`, context);
      prior.ballotCandidates.set(`contact:${candidacy.id}`, context);
    }
  }
  let states = priors.get(store);
  if (!states) { states = new Map(); priors.set(store, states); }
  states.set(`${projection.recordClass}:${projection.scope}`, prior);
}

export function consumeStatePublicationRecord(previous: unknown, next: unknown | null, key?: string): void {
  if (!object(previous)) return;
  const entries = replacements.get(previous as object) ?? [];
  for (const entry of entries) {
    if (key !== undefined && entry.member.key !== key) continue;
    const record = next === null ? null : entry.project ? entry.project(next) : next;
    if (next !== null && canonicalCivicDataHash(civicRecordFacts(entry.recordClass, { key: entry.member.key, record })) === entry.member.factsHash)
      delete entry.member.record;
  }
  const remaining = key === undefined ? [] : entries.filter(entry => entry.member.key !== key);
  if (remaining.length) replacements.set(previous as object, remaining);
  else replacements.delete(previous as object);
}

export function takeStatePublicationPrior(store: object, recordClass: string, scope: string): StatePublicationPrior | undefined {
  const states = priors.get(store), key = `${recordClass}:${scope}`, prior = states?.get(key);
  states?.delete(key);
  return prior;
}

export function bindStatePublicationPrior(candidate: RoutineCandidate, prior: StatePublicationPrior): void { bound.set(candidate, prior); }
export function statePublicationPriorOf(candidate: RoutineCandidate): StatePublicationPrior | undefined { return bound.get(candidate); }
