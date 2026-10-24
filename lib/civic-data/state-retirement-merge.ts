import { retirementMemberKey, verifyStateRetirementUnitSeal } from "./state-retirement-proof.ts";
import { createHash } from "node:crypto";
import { withJsonArraySpool } from "../ops/json-file.ts";
import { stateBallotContractId } from "./state-scopes.ts";
import { stateRegistryRuntimeContractId } from "./state-scopes.ts";
import { readPromotedCivicData } from "./read-model.ts";
import { manualProductionContract } from "./manual-contracts.ts";
import { requiredRoutineContract } from "./contracts.ts";
import { processRegisteredStateRetirementCandidate } from "./promotion.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { civicRecordsFor } from "./changes.ts";
import { consumeStatePublicationRecord, immutableStateCandidate, immutableStateHash, rememberStatePublicationPrior } from "./state-publication.ts";
import { stateRetirementCandidate } from "./state-retirement-publication.ts";
import type { StateRetirementOrigin } from "./state-retirement-inputs.ts";
import type { PublishedCandidateMetadata, RoutineDataStore } from "./store.ts";
import type { PromotedProjection, RoutineCandidate, ValidationReceipt } from "./types.ts";

const authorized = new WeakMap<object, { envelopeHash: string; priorVersionId: string | null }>();
function envelopeHash(candidate: RoutineCandidate): string {
  const { changeSet: _changeSet, normalization, ...envelope } = candidate;
  const { stateRecordHashes: _stateRecordHashes, ...normalized } = normalization;
  return canonicalCivicDataHash({ ...envelope, normalization: normalized });
}
export function stateRetirementCandidateIssue(candidate: RoutineCandidate, priorVersionId: string | null): string | null {
  const saved = candidate.stateRetirement && authorized.get(candidate.stateRetirement);
  if (!saved || saved.priorVersionId !== priorVersionId) return "STATE_RETIREMENT_ADMISSION_MISSING";
  return envelopeHash(candidate) === saved.envelopeHash ? null : "STATE_RETIREMENT_SELECTED_FACTS_CHANGED";
}

type Row = Record<string, unknown>;
type Member = { path: string[]; key: string; value: unknown; patch?: "identity" };
type Unit = { family: StateRetirementOrigin["family"]; state: string; originId: string; originScope: string; originRecordClass: string; originReadModelHash: string;
  promotedAt: string; payload: Row; candidate: RoutineCandidate; receipt: ValidationReceipt; normalizedMetadata: Row };
const object = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const hash = (value: unknown) => immutableStateHash(value);
const recordAliases = (row: Row): string[] => [row.id, object(row.filing).id, object(row.identity).identityId]
  .filter((id): id is string => typeof id === "string" && !!id);
const stamp = (value: unknown, fallback: number): number => {
  const row = object(value), provenance = object(row.provenance), evidence = object(row.evidence);
  // A later verified classification can correct an unchanged capture (for example an unopposed race).
  for (const source of [provenance, row]) {
    const sourceTimes = [source.collectedAt, source.verifiedAt]
      .filter((at): at is string => typeof at === "string" && Number.isFinite(Date.parse(at))).map(Date.parse);
    if (sourceTimes.length) return Math.max(...sourceTimes);
  }
  for (const at of [row.retrievedAt, row.checkedAt, row.writtenAt, evidence.readAt,
    object(row.campaign).attemptedAt, row.updatedAt, row.curatedAt, row.generatedAt]) {
    if (typeof at === "string" && Number.isFinite(Date.parse(at))) return Date.parse(at);
  }
  return fallback;
};

function mergeFacts(held: unknown, incoming: unknown, heldAt: number, incomingAt: number, strict = false): unknown {
  if (held === undefined) return incoming;
  if (incoming === undefined || hash(held) === hash(incoming)) return held;
  if (Array.isArray(held) && Array.isArray(incoming)) {
    const rows = new Map(held.map(row => [typeof row === "object" && row !== null ? retirementMemberKey([], row) : hash(row), row]));
    for (const row of incoming) {
      const key = typeof row === "object" && row !== null ? retirementMemberKey([], row) : hash(row);
      rows.set(key, mergeFacts(rows.get(key), row, heldAt, incomingAt, strict));
    }
    const values = [...rows.values()];
    return values.length === held.length && values.every((row, index) => row === held[index]) ? held : values;
  }
  if (held !== null && incoming !== null && typeof held === "object" && typeof incoming === "object" &&
    !Array.isArray(held) && !Array.isArray(incoming)) {
    const old = object(held), fresh = object(incoming), oldAt = stamp(old, heldAt), newAt = stamp(fresh, incomingAt);
    const result: Row = { ...old };
    for (const [key, value] of Object.entries(fresh)) result[key] = mergeFacts(old[key], value, oldAt, newAt, strict);
    return Object.keys(result).length === Object.keys(old).length && Object.keys(result).every(key => result[key] === old[key]) ? held : result;
  }
  if (strict && incomingAt === heldAt) throw new Error("STATE_RETIREMENT_UNTIMED_CONFLICT");
  return incomingAt > heldAt ? incoming : held;
}

function memberHash(path: readonly string[], value: unknown): string {
  const child = path.at(-1) === "jurisdictions" ? "sites" : path.at(-1) === "bodyRosters" ? "members" : null;
  if (!child) return hash(value);
  const metadata = { ...object(value) }; delete metadata[child]; return hash(metadata);
}

class StateRows {
  readonly payload: Row;
  readonly expected = new Map<string, { path: string[]; key: string; hash: string }>();
  metadataChanged = false;
  readonly selections: { key: string; code: string; detail: string }[] = [];
  private readonly arrays = new Map<unknown[], Map<string, number>>();
  private readonly owned = new WeakSet<object>();
  private readonly incomingHeld = new Map<string, Set<string>>();
  private readonly ballotBoundaries = new Map<string, Map<string, Row>>();
  private readonly ballotAliases = new Map<string, Map<string, { field: string; value: Row }>>();
  private readonly heldAt: number;
  private readonly incomingAt: number;
  private readonly priorKeys: WeakMap<object, string[]>;
  private readonly baseline: Map<string, string>;
  private readonly skeleton: Row;
  constructor(prior: Row, skeleton: Row, priorKeys: WeakMap<object, string[]>, baseline: Map<string, string>) {
    const heldAt = stamp(prior, 0), incomingAt = stamp(skeleton, 0);
    this.priorKeys = priorKeys; this.baseline = baseline; this.skeleton = skeleton;
    this.heldAt = heldAt; this.incomingAt = incomingAt;
    this.payload = { ...prior };
    this.owned.add(this.payload);
    const initialize = (target: Row, shape: Row, beforeAt: number, sourceAt: number) => {
      const oldAt = stamp(target, beforeAt), newAt = stamp(shape, sourceAt);
      for (const [key, value] of Object.entries(shape)) {
        const before = target[key];
        if (Array.isArray(value) && !value.length || value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) {
          if (before === undefined) target[key] = value;
          continue;
        }
        if (value && typeof value === "object" && !Array.isArray(value) && before && typeof before === "object" && !Array.isArray(before)) {
          const copy = { ...object(before) }; initialize(copy, object(value), oldAt, newAt); target[key] = copy; this.owned.add(copy);
        } else {
          const next = mergeFacts(before, value, oldAt, newAt);
          if (next !== before) { target[key] = next; this.metadataChanged = true; }
        }
      }
    };
    initialize(this.payload, skeleton, heldAt, incomingAt);
  }
  private container(root: Row, path: readonly string[], create: boolean): Row | unknown[] | null {
    let current: Row | unknown[] = root;
    for (const key of path) {
      if (Array.isArray(current)) {
        let index = this.arrays.get(current);
        if (!index) { index = new Map(current.map((value, at) => [retirementMemberKey([], value), at])); this.arrays.set(current, index); }
        const at = index.get(key);
        if (at === undefined) return null;
        let next = current[at];
        if (next === null || typeof next !== "object") return null;
        if (create && !this.owned.has(next)) { next = Array.isArray(next) ? [...next] : { ...object(next) }; current[at] = next; this.owned.add(next as object); }
        current = next as Row;
      } else {
        let next = current[key];
        if (next === undefined && create) next = current[key] = {};
        if (next === null || typeof next !== "object") return null;
        if (create && !this.owned.has(next)) { next = Array.isArray(next) ? [...next] : { ...object(next) }; current[key] = next; this.owned.add(next as object); }
        current = next as Row;
      }
    }
    return current;
  }
  private locate(root: Row, member: Member, create: boolean): { get(): unknown; set(value: unknown): void } | null {
    const container = this.container(root, member.path, create);
    if (!container) return null;
    if (!Array.isArray(container)) return { get: () => container[member.key], set: value => { container[member.key] = value; } };
    let index = this.arrays.get(container);
    if (!index) { index = new Map(container.map((row, at) => [retirementMemberKey(member.path, row), at])); this.arrays.set(container, index); }
    const positions = index;
    return { get: () => { const at = positions.get(member.key); return at === undefined ? undefined : container[at]; },
      set: value => { const at = positions.get(member.key); if (at === undefined) { positions.set(member.key, container.length); container.push(value); } else container[at] = value; } };
  }
  private remove(path: readonly string[], key: string): void {
    const container = this.container(this.payload, path, true);
    if (!Array.isArray(container)) return;
    let index = this.arrays.get(container);
    if (!index) { index = new Map(container.map((value, at) => [retirementMemberKey(path, value), at])); this.arrays.set(container, index); }
    const at = index.get(key);
    if (at === undefined) return;
    consumeStatePublicationRecord(container[at], null);
    const last = container.pop(); index.delete(key);
    if (at < container.length) { container[at] = last; index.set(retirementMemberKey(path, last), at); }
    this.metadataChanged = true;
  }
  private boundariesFor(ballotKey: string): Map<string, Row> {
    let boundaries = this.ballotBoundaries.get(ballotKey);
    if (!boundaries) {
      boundaries = new Map();
      const ballot = object(object(this.payload.ballots)[ballotKey]);
      for (const row of [...(ballot.contests as Row[] ?? []).filter(row => row.candidateListComplete === true),
        ...(ballot.heldContests as Row[] ?? [])]) {
        for (const id of recordAliases(row)) boundaries.set(id, row);
      }
      this.ballotBoundaries.set(ballotKey, boundaries);
    }
    return boundaries;
  }
  add(member: Member): void {
    if (!Array.isArray(member.path) || !member.path.length || !member.path.every(key => typeof key === "string" && !["__proto__", "constructor", "prototype"].includes(key)) ||
      typeof member.key !== "string" || !member.key || ["__proto__", "constructor", "prototype"].includes(member.key)) throw new Error("STATE_RETIREMENT_MEMBER_INVALID");
    const ballotKey = member.path[0] === "ballots" ? member.path[1] : null;
    if (ballotKey && member.path.length === 3 && ["contests", "heldContests"].includes(member.path.at(-1)!)) {
      let incoming = object(member.value);
      const boundaries = this.boundariesFor(ballotKey);
      const prior = [member.key, ...recordAliases(incoming)].map(id => boundaries.get(id)).find(Boolean);
      if (prior) {
        for (const id of recordAliases(incoming)) boundaries.set(id, prior);
        incoming = { ...incoming, id: prior.id };
        member = { ...member, key: String(prior.id), value: incoming };
      }
      const incomplete = member.path.at(-1) === "heldContests" || incoming.type !== "MEASURE" && incoming.candidateListComplete !== true;
      if (incomplete) {
        const held = this.incomingHeld.get(ballotKey) ?? new Set<string>(); held.add(member.key); this.incomingHeld.set(ballotKey, held);
        if (prior?.candidateListComplete === true) {
          const complete = { ...incoming, ...prior }; delete complete.reason;
          member = { ...member, path: ["ballots", ballotKey, "contests"], value: complete };
        } else {
          const target = this.container(this.payload, ["ballots", ballotKey], true) as Row;
          target.heldContests ??= [];
          member = { ...member, path: ["ballots", ballotKey, "heldContests"], value: { ...incoming,
            reason: incoming.reason ?? "The inherited official candidate list has not been fully checked." } };
        }
      } else if (prior?.reason && stamp(prior, 0) > stamp(incoming, 0)) {
        member = { ...member, path: ["ballots", ballotKey, "heldContests"], value: { ...incoming, ...prior } };
      } else if (prior?.reason) this.remove(["ballots", ballotKey, "heldContests"], member.key);
    }
    let aliases: Map<string, { field: string; value: Row }> | undefined;
    if (ballotKey && (member.patch === "identity" || ["candidacies", "filingCandidacies"].includes(member.path.at(-1)!))) {
      aliases = this.ballotAliases.get(ballotKey);
      if (!aliases) {
        aliases = new Map(); this.ballotAliases.set(ballotKey, aliases);
        const ballot = object(object(this.payload.ballots)[ballotKey]);
        for (const field of ["candidacies", "filingCandidacies"]) for (const value of Array.isArray(ballot[field]) ? ballot[field] as Row[] : []) {
          for (const id of recordAliases(value)) aliases.set(id, { field, value });
        }
      }
      if (member.patch === "identity") {
        const existing = aliases.get(member.key);
        if (!existing) throw new Error(`STATE_RETIREMENT_IDENTITY_NOT_CARRIED:${member.key}`);
        member = { path: ["ballots", ballotKey, existing.field], key: String(existing.value.id),
          value: { ...existing.value, identity: mergeFacts(existing.value.identity, member.value, this.heldAt, this.incomingAt) } };
      } else {
        let incoming = object(member.value);
        const boundary = this.boundariesFor(ballotKey).get(String(incoming.contestId));
        if (boundary && incoming.contestId !== boundary.id) {
          incoming = { ...incoming, contestId: boundary.id };
          member = { ...member, value: incoming };
        }
        const found = recordAliases(incoming).map(id => aliases!.get(id)).find(Boolean);
        if (found) {
          const released = found.field === "filingCandidacies" && member.path.at(-1) === "candidacies" &&
            !this.incomingHeld.get(ballotKey)?.has(String(incoming.contestId)) && (!boundary || stamp(boundary, 0) <= stamp(incoming, 0));
          if (released) this.remove(["ballots", ballotKey, found.field], String(found.value.id));
          member = { ...member, path: ["ballots", ballotKey, released ? "candidacies" : found.field], key: String(found.value.id),
            value: { ...(released ? found.value : {}), ...incoming, id: found.value.id, contestId: found.value.contestId } };
        }
        else if (member.path.at(-1) === "candidacies") {
          const ballot = object(object(this.payload.ballots)[ballotKey]);
          if (this.incomingHeld.get(ballotKey)?.has(String(incoming.contestId)) ||
            boundary && stamp(boundary, stamp(object(boundary).contest, 0)) > stamp(incoming, 0)) {
            if (!ballot.filingCandidacies) (this.container(this.payload, ["ballots", ballotKey], true) as Row).filingCandidacies = [];
            member = { ...member, path: ["ballots", ballotKey, "filingCandidacies"] };
          }
        }
      }
    }
    const target = this.locate(this.payload, member, true);
    if (!target) throw new Error(`STATE_RETIREMENT_PARENT_MISSING:${member.path.join("/")}:${member.key}`);
    const previous = target.get();
    if (member.path.at(-1) === "contests" && object(previous).scopeNote !== undefined && object(member.value).scopeNote !== undefined &&
      object(previous).scopeNote !== object(member.value).scopeNote && stamp(previous, 0) === stamp(member.value, 0)) {
      member = { ...member, value: { ...object(member.value), scopeNote: object(previous).scopeNote } };
      this.selections.push({ key: member.key, code: "STATE_RETIREMENT_CURRENT_SCOPE_NOTE", detail:
        "Kept the current GOOD reader explanation at the same source clock; earlier wording remains in the pinned original." });
    }
    const candidates = previous && typeof previous === "object" ? this.priorKeys.get(previous) ?? [] : [];
    const prefix = member.path.join(".") === "cards.cards" ? "card" : member.path.join(".") === "links.links" ? "links" : null;
    const key = prefix ? `${prefix}:${member.key}` : candidates.find(key => key.endsWith(`:${member.key}`)) ?? (candidates.length === 1 ? candidates[0] : undefined);
    const baseline = key && this.baseline.get(key);
    let next: unknown;
    if (baseline && hash(member.value) === baseline) next = previous;
    else {
      let contextBefore = baseline && hash(previous) === baseline ? -1 : 0, contextIncoming = 0;
      if (ballotKey && member.path.at(-2) === "lineupReconciliation") {
        const linked = this.ballotAliases.get(ballotKey)?.get(String(object(previous).canonicalCandidacyId))?.value;
        contextBefore = stamp(linked, stamp(object(object(this.payload.ballots)[ballotKey]).lineupReconciliation, contextBefore));
        contextIncoming = stamp(object(object(this.skeleton.ballots)[ballotKey]).lineupReconciliation, 0);
        if (linked && contextBefore > contextIncoming && hash(previous) !== hash(member.value)) {
          const fields = Object.keys(object(member.value)).filter(key => hash(object(previous)[key]) !== hash(object(member.value)[key]));
          this.selections.push({ key: member.key, code: "STATE_RETIREMENT_CURRENT_RECONCILIATION", detail:
            `Kept ${fields.join(", ")} from the current GOOD reconciliation bound to ${String(linked.id)} at ${new Date(contextBefore).toISOString()}; inherited reconciliation source was ${new Date(contextIncoming).toISOString()}.` });
        }
      }
      const beforeAt = stamp(previous, contextBefore);
      const incomingAt = stamp(member.value, contextIncoming);
      try { next = mergeFacts(previous, member.value, beforeAt, incomingAt, true); }
      catch (error) { throw new Error(`${error instanceof Error ? error.message : error}:${member.path.join("/")}:${member.key}`); }
    }
    consumeStatePublicationRecord(previous, next);
    if (next === previous) return;
    target.set(next);
    if (aliases) for (const id of recordAliases(object(next))) aliases.set(id, { field: member.path.at(-1)!, value: object(next) });
    this.expected.set(JSON.stringify([member.path, member.key]), { path: member.path, key: member.key, hash: memberHash(member.path, next) });
  }
  check(payload: unknown): void {
    for (const row of this.expected.values()) {
      const actual = this.locate(object(payload), { ...row, value: null }, false)?.get();
      if (actual === undefined || memberHash(row.path, actual) !== row.hash) throw new Error(`STATE_RETIREMENT_MEMBER_NOT_CARRIED:${row.path.join("/")}:${row.key}`);
    }
  }
}

type RetirementInput = { file: string; sha256: string; seal: string; contractId: string; store: RoutineDataStore; now: string };
type PreparedRetirement = { family: string; state: string; currentSelections: readonly { key: string; code: string; detail: string }[];
  candidate: RoutineCandidate | null; baseVersion: string | null; payload: unknown };

/** The normal publisher and read-only replay share exactly the same source proof and state merge. */
async function withRetirementStateInput<T>(input: RetirementInput, accept: (prepared: PreparedRetirement) => Promise<T>): Promise<T> {
  const digest = createHash("sha256");
  const streamed = new Set(["members", "candidate.identities", "candidate.excludedFacts", "candidate.manualPriorAuthority.retainedMembers",
    "receipt.excludedFacts", "candidate.retrieval.manualSourceReceipt.sources"]);
  return withJsonArraySpool(input.file, { streamArray: path => streamed.has(path.join(".")), onRow: () => {},
    onChunk: chunk => { digest.update(chunk); } }, async (header, members) => {
    if (digest.digest("hex") !== input.sha256) throw new Error("STATE_RETIREMENT_INPUT_HASH_MISMATCH");
    const unit = header as Unit;
    const contractId = unit.family === "registry-runtime" ? stateRegistryRuntimeContractId(unit.state) : stateBallotContractId(unit.family, unit.state);
    if (contractId !== input.contractId) throw new Error("STATE_RETIREMENT_CONTRACT_MISMATCH");
    verifyStateRetirementUnitSeal({ fileSha256: input.sha256, originId: unit.originId, originRecordClass: unit.originRecordClass,
      originScope: unit.originScope, originReadModelHash: unit.originReadModelHash, state: unit.state, contractId }, input.seal);
    const source = await input.store.readStateRetirementOrigin?.(unit.originRecordClass, unit.originScope);
    if (!source?.promoted || source.versionId !== unit.originId || source.lastKnownGoodVersionId !== unit.originId ||
      source.normalizedHash !== unit.originReadModelHash || source.sourceId !== unit.candidate.sourceId || unit.candidate.id !== unit.originId ||
      unit.candidate.scope !== unit.originScope || unit.candidate.recordClass !== unit.originRecordClass ||
      !unit.receipt.checks.some(check => check.check === "SOURCE_AUTHENTICITY" && check.verdict === "PASS" && check.code === source.sourceAuthenticity))
      throw new Error("STATE_RETIREMENT_ORIGIN_MOVED_OR_INVALID");
    const contract = unit.family === "candidate-campaign-sites-derived" ? requiredRoutineContract(contractId) : manualProductionContract(contractId);
    if (!contract) throw new Error("STATE_RETIREMENT_CONTRACT_MISMATCH");
    let metadata: PublishedCandidateMetadata | null = null;
    const readStore = { readPromotion: input.store.readPromotion.bind(input.store), readCandidate: input.store.readCandidate.bind(input.store),
      readPublishedCandidateMetadata: async (id: string) => { metadata = await input.store.readPublishedCandidateMetadata!(id); return metadata; } };
    let read: Awaited<ReturnType<typeof readPromotedCivicData>> | null = await readPromotedCivicData(contract.recordClass, contract.scope, { store: readStore, now: input.now, bypassCache: true });
    if (read.kind !== "PROMOTED" && read.kind !== "NOT_RECORDED" || read.kind === "PROMOTED" && !metadata)
      throw new Error(`STATE_RETIREMENT_STATE_BASE_INVALID:${unit.family}:${unit.state}`);
    let current: PromotedProjection | null = read.kind === "PROMOTED" ? read.projection : null;
    const currentMetadata = metadata ? (metadata as PublishedCandidateMetadata).candidate : null;
    if (current) rememberStatePublicationPrior(input.store, current);
    const keys = new WeakMap<object, string[]>();
    for (const member of civicRecordsFor(contract.recordClass, current?.payload))
      if (member.record && typeof member.record === "object") keys.set(member.record, [...(keys.get(member.record) ?? []), member.key]);
    const baseline = current ? await input.store.readStateRetirementBaseline?.(contract.recordClass, contract.scope) : null;
    let rows: StateRows | null = new StateRows(object(current?.payload), unit.payload, keys, new Map(baseline?.members.map(row => [row.key, row.sha256]) ?? []));
    const shared = new Map((currentMetadata?.retrieval.manualSourceReceipt?.sources ?? []).map(row => [hash(row), row]));
    const sourceStrings = new Map<string, string>();
    for (const source of shared.values()) for (const value of Object.values(source)) if (typeof value === "string") sourceStrings.set(value, value);
    const exclusions = new Map((current?.receipt.excludedFacts ?? []).map(row => [hash(row), row]));
    for await (const [path, value] of members) {
      const name = path.join(".");
      if (name === "members") rows.add(value as Member);
      else if (name === "candidate.retrieval.manualSourceReceipt.sources") {
        const receipt = unit.candidate.retrieval.manualSourceReceipt!;
        const match = shared.get(hash(value));
        if (!match) for (const [key, field] of Object.entries(object(value))) if (typeof field === "string") {
          object(value)[key] = sourceStrings.get(field) ?? field; sourceStrings.set(field, object(value)[key] as string);
        }
        (receipt.sources as unknown[]).push(match ?? value);
      } else if (name === "candidate.excludedFacts" || name === "receipt.excludedFacts") {
        const target = name === "candidate.excludedFacts" ? unit.candidate.excludedFacts : unit.receipt.excludedFacts;
        (target as unknown[]).push(exclusions.get(hash(value)) ?? value);
      }
    }
    const baseVersion = current?.versionId ?? null;
    const currentSelections = rows.selections;
    const prepared = (candidate: RoutineCandidate | null, payload: unknown) => accept({ family: unit.family, state: unit.state, currentSelections, candidate, baseVersion, payload });
    if (current && !rows.expected.size && !rows.metadataChanged && await input.store.hasStateRetirementProof?.(contractId, {
      versionId: unit.originId, recordClass: unit.originRecordClass, scope: unit.originScope, readModelHash: unit.originReadModelHash, sourceAuthenticity: source.sourceAuthenticity!,
    })) return prepared(null, current.payload);
    const selected = new Map(civicRecordsFor(contract.recordClass, rows.payload).map(member => [member.key, member.record]));
    for (const member of civicRecordsFor(contract.recordClass, current?.payload)) consumeStatePublicationRecord(member.record, selected.get(member.key) ?? null, member.key);
    unit.candidate = { ...unit.candidate, excludedFacts: [...unit.candidate.excludedFacts ?? [], ...currentSelections] };
    const candidate = immutableStateCandidate(stateRetirementCandidate({ contractId, state: unit.state, unitSha256: input.sha256,
      origin: { candidate: unit.candidate, receipt: unit.receipt, readModelHash: unit.originReadModelHash }, current, currentMetadata,
      payload: rows.payload, normalizedMetadata: unit.normalizedMetadata }));
    rows.check(candidate.readModel);
    selected.clear(); shared.clear(); sourceStrings.clear(); exclusions.clear();
    authorized.set(candidate.stateRetirement!, { envelopeHash: envelopeHash(candidate), priorVersionId: baseVersion });
    rows = null; current = null; metadata = null; read = null;
    return prepared(candidate, candidate.readModel);
  });
}

export async function reconcileRetirementStateInput(input: RetirementInput) {
  return withRetirementStateInput(input, async prepared => {
    if (prepared.candidate) {
      const published = await processRegisteredStateRetirementCandidate(input.store, input.contractId, prepared.candidate, input.now, prepared.baseVersion);
      if (!published.promoted) throw new Error(`STATE_RETIREMENT_PUBLICATION_FAILED:${published.candidate.failureDetail ?? published.candidate.receipt?.decision ?? "NO_RECEIPT"}`);
    }
    return { family: prepared.family, state: prepared.state, status: prepared.candidate ? "PUBLISHED" as const : "CURRENT" as const, currentSelections: prepared.currentSelections };
  });
}

/** Stops before the publisher; production read-only roles are sufficient for every database operation. */
export async function previewRetirementStateInput(input: RetirementInput) {
  return withRetirementStateInput(input, async prepared => ({ ...prepared, status: prepared.candidate ? "PREVIEW" as const : "CURRENT" as const }));
}
