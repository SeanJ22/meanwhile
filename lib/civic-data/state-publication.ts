import { types } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { STATE_BALLOT_FAMILIES, stateFromBallotScope } from "./state-scopes.ts";
import { stateFromRegistryRuntimeScope } from "./state-scopes.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import type { PromotedProjection, RoutineCandidate } from "./types.ts";

const publicationRead = new AsyncLocalStorage<PromotedProjection>();

export function withStatePublicationRead<T>(projection: PromotedProjection, read: () => Promise<T>): Promise<T> {
  return publicationRead.run(projection, read);
}

export function heldStatePublication(recordClass: string, scope: string): PromotedProjection | null {
  const held = publicationRead.getStore();
  return held?.recordClass === recordClass && held.scope === scope ? held : null;
}

export function statePublicationScope(scope: string): boolean {
  return STATE_BALLOT_FAMILIES.some(family => stateFromBallotScope(scope, family) !== null) ||
    stateFromRegistryRuntimeScope(scope) !== null;
}

const immutableValues = new WeakSet<object>();
const immutableHashes = new WeakMap<object, string>();

export function immutableStateHash(value: unknown): string {
  const owned = value !== null && typeof value === "object" && immutableValues.has(value);
  const saved = owned ? immutableHashes.get(value) : undefined;
  if (saved) return saved;
  const hash = canonicalCivicDataHash(value);
  if (owned) immutableHashes.set(value, hash);
  return hash;
}

export function durableStateHash(value: unknown): string | null {
  try {
    const hash = immutableStateHash(value);
    if (value !== null && typeof value === "object" && immutableValues.has(value)) return hash;
    return hash === canonicalCivicDataHash(value, { durable: true }) ? hash : null;
  } catch { return null; }
}

export function immutableStateCandidate(candidate: RoutineCandidate): RoutineCandidate {
  return immutableStateValue(candidate);
}

export function immutableStateValue<T>(candidate: T): T {
  const omitted = Symbol("omitted"), normalized = new WeakMap<object, unknown>(), parents = new Set<object>();
  const visit = (original: unknown, key: string): unknown => {
    let value = original;
    if (value !== null && (typeof value === "object" || typeof value === "bigint")) {
      const toJSON = (value as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === "function") value = toJSON.call(value, key);
    }
    if (types.isNumberObject(value)) value = Number(value);
    if (types.isStringObject(value)) value = String(value);
    if (types.isBooleanObject(value)) value = Boolean.prototype.valueOf.call(value);
    if (types.isBigIntObject(value)) value = BigInt.prototype.valueOf.call(value);
    if (typeof value === "bigint") throw new TypeError("A state candidate cannot contain a BigInt.");
    if (value === undefined || typeof value === "function" || typeof value === "symbol") return omitted;
    if (typeof value === "number") return Number.isFinite(value) ? value === 0 ? 0 : value : null;
    if (value === null || typeof value !== "object") return value;
    if (immutableValues.has(value)) return value;
    if (parents.has(value)) throw new TypeError("A state candidate cannot contain a circular value.");
    if (normalized.has(value)) return normalized.get(value);
    parents.add(value);
    const array = Array.isArray(value), row = value as Record<string, unknown>;
    let copy: Record<string, unknown> | unknown[] | null = Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype)
      ? null : array ? [...value as unknown[]] : { ...row };
    const keys = array ? Array.from({ length: (value as unknown[]).length }, (_, index) => String(index)) : Object.keys(row);
    for (const childKey of keys) {
      const child = visit(row[childKey], childKey), next = child === omitted && array ? null : child;
      if (next === omitted || !Object.is(next, row[childKey]) || Object.getOwnPropertyDescriptor(value, childKey)?.get) {
        copy ??= array ? [...value as unknown[]] : { ...row };
        if (next === omitted) delete (copy as Record<string, unknown>)[childKey];
        else Object.defineProperty(copy, childKey, { value: next, enumerable: true, configurable: true, writable: true });
      }
    }
    parents.delete(value);
    const result = Object.freeze(copy ?? value);
    immutableValues.add(result);
    normalized.set(value, result);
    return result;
  };
  return visit(candidate, "") as T;
}

const PATH = "$civicCandidatePath";
type PayloadPath = readonly string[];

export function encodeStateCandidate(candidate: RoutineCandidate): RoutineCandidate {
  const paths = new WeakMap<object, PayloadPath>();
  const index = (value: unknown, path: PayloadPath): void => {
    if (value === null || typeof value !== "object" || paths.has(value)) return;
    paths.set(value, path);
    for (const key of Object.keys(value)) index((value as Record<string, unknown>)[key], [...path, key]);
  };
  index(candidate.readModel, []);
  const encoded = new WeakMap<object, unknown>();
  const aliases = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    const path = paths.get(value);
    if (path) return { [PATH]: path };
    if (encoded.has(value)) return encoded.get(value);
    let copy: Record<string, unknown> | unknown[] | null = null;
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key], next = aliases(child);
      if (next !== child) {
        copy ??= Array.isArray(value) ? [...value] : { ...value };
        Object.defineProperty(copy, key, { value: next, enumerable: true, configurable: true, writable: true });
      }
    }
    const result = copy ?? value;
    encoded.set(value, result);
    return result;
  };
  return Object.fromEntries(Object.entries(candidate).map(([key, value]) =>
    [key, key === "readModel" ? value : aliases(value)])) as unknown as RoutineCandidate;
}

export function decodeStateCandidate(value: unknown): unknown {
  if (value === null || typeof value !== "object" || !("readModel" in value)) return value;
  const root = value as Record<string, unknown>;
  const resolve = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    const row = node as Record<string, unknown>;
    if (Object.keys(row).length === 1 && Array.isArray(row[PATH])) {
      let result = root.readModel;
      for (const key of row[PATH]) {
        if (typeof key !== "string" || result === null || typeof result !== "object" || !Object.hasOwn(result, key))
          throw new Error("CIVIC_CANDIDATE_PATH_INVALID");
        result = (result as Record<string, unknown>)[key];
      }
      return result;
    }
    for (const key of Object.keys(row)) row[key] = resolve(row[key]);
    return node;
  };
  for (const key of Object.keys(root)) if (key !== "readModel") root[key] = resolve(root[key]);
  return root;
}

import { civicRecordFacts, civicRecordsFor } from "./changes.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { NormalizationEvidence } from "./types.ts";

export interface StatePublicationPrior {
  readonly versionId: string;
  readonly payloadHash: string;
  readonly recordHashes: RecordHashes;
  readonly members: Map<string, { readonly key: string; readonly factsHash: string; readonly sha256: string; record?: unknown }>;
  readonly ballotCandidates: Map<string, { electionId: string; electionDate: string; contestId: string; ocdId: string;
    candidateListComplete: boolean; sourceUrl: string | null; candidacyCollectedAt: string }>;
  readonly officialIdentityAuthority: unknown;
}

type RecordHashes = NonNullable<NormalizationEvidence["stateRecordHashes"]>;
type RecordHash = RecordHashes["members"][number];
const provenHashes = new WeakMap<object, RecordHashes>();
const recordHashes = new WeakMap<object, Map<string, RecordHash>>();
const SHA256 = /^[a-f0-9]{64}$/;

function rememberRecordHash(record: object, recordClass: RoutineCandidate["recordClass"], member: RecordHash): void {
  let keys = recordHashes.get(record);
  if (!keys) { keys = new Map(); recordHashes.set(record, keys); }
  keys.set(`${recordClass}:${member.key}`, member);
}

export function statePublicationRecordHash(recordClass: RoutineCandidate["recordClass"], member: { key: string; record: unknown }): RecordHash | undefined {
  if (member.record === null || typeof member.record !== "object" || !immutableValues.has(member.record)) return undefined;
  return recordHashes.get(member.record)?.get(`${recordClass}:${member.key}`);
}

export function withStateRecordHashes(candidate: RoutineCandidate): RoutineCandidate {
  if (!statePublicationScope(candidate.scope) || !candidate.normalization.normalizedHash) return candidate;
  const members = civicRecordsFor(candidate.recordClass, candidate.readModel).map(member => {
    const owned = member.record !== null && typeof member.record === "object" && immutableValues.has(member.record);
    const saved = statePublicationRecordHash(candidate.recordClass, member);
    if (saved) return saved;
    const facts = civicRecordFacts(candidate.recordClass, member), sha256 = immutableStateHash(member.record);
    const next = Object.freeze({ key: member.key, sha256, factsHash: facts === member.record ? sha256 : immutableStateHash(facts) });
    if (owned) rememberRecordHash(member.record as object, candidate.recordClass, next);
    return next;
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
  provenHashes.set(projection, immutableStateValue(normalization.stateRecordHashes!));
}

export function heldStatePublicationHashes(projection: PromotedProjection): RecordHashes | undefined {
  return provenHashes.get(projection);
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
  const payload = object(projection.payload);
  if (!payload || !immutableValues.has(payload) || immutableHashes.get(payload) !== hashes.readModelHash)
    throw new Error("STATE_PRIOR_PAYLOAD_NOT_VERIFIED");
  const prior: StatePublicationPrior = { versionId: projection.versionId, payloadHash: hashes.readModelHash, recordHashes: hashes,
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
    const record = immutableStateValue(member.record);
    if (object(record)) {
      const existing = immutableHashes.get(record as object);
      if (existing && existing !== hashes.sha256) throw new Error("STATE_PRIOR_RECORD_HASHES_MISMATCH");
      immutableHashes.set(record as object, hashes.sha256);
      rememberRecordHash(record as object, projection.recordClass, hashes);
    }
    const entry = { ...member, record, factsHash: hashes.factsHash, sha256: hashes.sha256 };
    prior.members.set(member.key, entry);
    index(record, entry);
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

export function reuseStatePublicationRecord(previous: unknown, incoming: unknown): unknown | null {
  if (!object(previous)) return null;
  const entry = replacements.get(previous as object)?.find(entry => !entry.project && entry.member.record === previous);
  if (!entry || !immutableValues.has(previous as object)) return null;
  return sameStateValue(previous, incoming) ? previous : null;
}

function sameStateValue(left: unknown, right: unknown): boolean {
  if (typeof right === "number") right = Number.isFinite(right) ? right === 0 ? 0 : right : null;
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object" || types.isProxy(right)) return false;
  const array = Array.isArray(left);
  if (array !== Array.isArray(right) || Object.getPrototypeOf(right) !== (array ? Array.prototype : Object.prototype) || "toJSON" in right) return false;
  if (array) {
    if ((left as unknown[]).length !== (right as unknown[]).length) return false;
    for (let index = 0; index < (left as unknown[]).length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(right, String(index));
      if (descriptor && !("value" in descriptor)) return false;
      const value = descriptor?.value, kind = typeof value;
      if (!sameStateValue((left as unknown[])[index], value === undefined || kind === "function" || kind === "symbol" ? null : value)) return false;
    }
    return true;
  }
  const previous = left as Record<string, unknown>;
  let count = 0;
  for (const key of Object.keys(right)) {
    const descriptor = Object.getOwnPropertyDescriptor(right, key);
    if (!descriptor || !("value" in descriptor)) return false;
    const value = descriptor.value, kind = typeof value;
    if (value === undefined || kind === "function" || kind === "symbol") continue;
    if (!Object.hasOwn(previous, key) || !sameStateValue(previous[key], value)) return false;
    count++;
  }
  return count === Object.keys(left).length;
}

export function consumeStatePublicationRecord(previous: unknown, next: unknown | null, key?: string): void {
  if (!object(previous)) return;
  const entries = replacements.get(previous as object) ?? [];
  for (const entry of entries) {
    if (key !== undefined && entry.member.key !== key) continue;
    const record = next === null ? null : entry.project ? entry.project(next) : next;
    if (next === previous || next !== null && immutableStateHash(civicRecordFacts(entry.recordClass, { key: entry.member.key, record })) === entry.member.factsHash)
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
