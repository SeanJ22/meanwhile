import { civicRecordFacts, civicRecordsFor } from "./changes.ts";
import { immutableStateHash, statePublicationScope } from "./state-publication.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { NormalizationEvidence, PromotedProjection, RoutineCandidate } from "./types.ts";

export interface StatePublicationPrior {
  readonly versionId: string;
  readonly payloadHash: string;
  readonly members: Map<string, { readonly key: string; readonly factsHash: string; readonly sha256: string; record?: unknown }>;
  readonly ballotCandidates: Map<string, { electionId: string; electionDate: string; contestId: string; ocdId: string;
    candidateListComplete: boolean; sourceUrl: string | null; candidacyCollectedAt: string }>;
  readonly officialIdentityAuthority: unknown;
}

type RecordHashes = NonNullable<NormalizationEvidence["stateRecordHashes"]>;
const provenHashes = new WeakMap<object, RecordHashes>();
const SHA256 = /^[a-f0-9]{64}$/;

export function withStateRecordHashes(candidate: RoutineCandidate): RoutineCandidate {
  if (!statePublicationScope(candidate.scope) || !candidate.normalization.normalizedHash) return candidate;
  const members = civicRecordsFor(candidate.recordClass, candidate.readModel).map(member => {
    const facts = civicRecordFacts(candidate.recordClass, member), sha256 = immutableStateHash(member.record);
    return Object.freeze({ key: member.key, sha256, factsHash: facts === member.record ? sha256 : immutableStateHash(facts) });
  });
  const stateRecordHashes = Object.freeze({ readModelHash: candidate.normalization.normalizedHash, members: Object.freeze(members) });
  return Object.freeze({ ...candidate, normalization: Object.freeze({ ...candidate.normalization, stateRecordHashes }) });
}

function stateRecordHashesIssue(hashes: NormalizationEvidence["stateRecordHashes"], readModelHash: string | null): string | null {
  if (!hashes || hashes.readModelHash !== readModelHash || !SHA256.test(hashes.readModelHash) || !Array.isArray(hashes.members))
    return "STATE_RECORD_HASHES_PAYLOAD_MISMATCH";
  const keys = new Set<string>();
  for (const member of hashes.members) {
    if (!member || typeof member.key !== "string" || !member.key || keys.has(member.key) ||
        typeof member.sha256 !== "string" || !SHA256.test(member.sha256) || typeof member.factsHash !== "string" || !SHA256.test(member.factsHash))
      return "STATE_RECORD_HASHES_MEMBER_INVALID";
    keys.add(member.key);
  }
  return null;
}

export function rememberStatePublicationHashes(projection: Pick<PromotedProjection, "scope">, normalization: Pick<NormalizationEvidence, "normalizedHash" | "stateRecordHashes">): void {
  if (!statePublicationScope(projection.scope)) return;
  const issue = stateRecordHashesIssue(normalization.stateRecordHashes, normalization.normalizedHash);
  if (issue) throw new Error(issue);
  provenHashes.set(projection, normalization.stateRecordHashes!);
}

const priors = new WeakMap<object, Map<string, StatePublicationPrior>>();
const replacements = new WeakMap<object, { member: StatePublicationPrior["members"] extends Map<string, infer T> ? T : never;
  recordClass: RoutineCandidate["recordClass"]; project?: (value: unknown) => unknown }[]>();
const bound = new WeakMap<RoutineCandidate, StatePublicationPrior>();
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" ? value as Record<string, unknown> : null;

export function rememberStatePublicationPrior(store: object, projection: Pick<PromotedProjection, "scope" | "recordClass" | "versionId" | "payload">): void {
  if (!statePublicationScope(projection.scope)) return;
  const hashes = provenHashes.get(projection);
  if (!hashes) throw new Error("STATE_RECORD_HASHES_NOT_VERIFIED");
  const prior: StatePublicationPrior = { versionId: projection.versionId, payloadHash: hashes.readModelHash,
    members: new Map(), ballotCandidates: new Map(), officialIdentityAuthority: object(projection.payload)?.officialIdentityAuthority ?? null };
  const index = (value: unknown, member: StatePublicationPrior["members"] extends Map<string, infer T> ? T : never,
    project?: (value: unknown) => unknown) => {
    if (!object(value)) return;
    const entries = replacements.get(value as object) ?? [];
    entries.push({ member, recordClass: projection.recordClass, project });
    replacements.set(value as object, entries);
  };
  const stored = new Map(hashes.members.map(member => [member.key, member]));
  for (const member of civicRecordsFor(projection.recordClass, projection.payload)) {
    const hashes = stored.get(member.key);
    if (!hashes) throw new Error(`STATE_RECORD_HASHES_MEMBER_MISSING:${member.key}`);
    stored.delete(member.key);
    const entry = { ...member, factsHash: hashes.factsHash, sha256: hashes.sha256 };
    prior.members.set(member.key, entry);
    index(member.record, entry);
  }
  if (stored.size) throw new Error("STATE_RECORD_HASHES_MEMBER_EXTRA");
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
    if (next !== null && immutableStateHash(civicRecordFacts(entry.recordClass, { key: entry.member.key, record })) === entry.member.factsHash)
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

export function bindStatePublicationPrior(candidate: RoutineCandidate, prior: StatePublicationPrior): void {
  const hashes = candidate.normalization.stateRecordHashes;
  if (stateRecordHashesIssue(hashes, prior.payloadHash) || hashes!.members.length !== prior.members.size || hashes!.members.some(member => {
    const saved = prior.members.get(member.key);
    return !saved || saved.factsHash !== member.factsHash || saved.sha256 !== member.sha256;
  })) throw new Error("STATE_PRIOR_RECORD_HASHES_MISMATCH");
  bound.set(candidate, prior);
}
export function statePublicationPriorOf(candidate: RoutineCandidate): StatePublicationPrior | undefined { return bound.get(candidate); }
