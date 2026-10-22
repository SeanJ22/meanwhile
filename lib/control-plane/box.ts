import { randomUUID } from "node:crypto";
import { contentHash } from "./ids.ts";
import { canonicalJson, ConcurrentModification, IdentityCollision, type AggregateRepository, type AppendOnlyRepository, type ArtifactRecord,
  type ControlPlaneRepositories } from "./repository/types.ts";
import { completedWorkerResults } from "./repository/worker-completion.ts";
import type { WorkerResultRecord } from "./workers/types.ts";
import type { ScoutResult } from "./scheduler/scout-result.ts";
import type { DetectiveResult } from "./workers/research-types.ts";

/** References into the existing result and artifact stores, never another evidence store. */
export interface BoxOrigin {
  readonly kind: "SCOUT" | "DETECTIVE";
  readonly resultId: string;
  /** Existing Scout log partition; old origins are upgraded by backfill. */
  readonly resultKey?: string;
  readonly workItemId: string;
  readonly findingIndex: number;
  readonly collection?: "findings" | "spans" | "reported";
  readonly artifactIds: readonly string[];
  readonly missionPart?: string;
  readonly recordedAt: string;
  /** A mid-walk drop has no Scout result row yet, so its origin carries the fact itself. */
  readonly reported?: { readonly field: string; readonly value: string | number | boolean; readonly subjectHint: string | null };
  /** The page and quote this origin saw, set only where they differ from the row's own: a repeat of the same fact from another page adds a source, not a row. */
  readonly source?: { readonly exactQuote: string | null; readonly sourceUrl: string };
}
/** What a finding claims, held on its row so a builder never reads the whole result it came from. */
interface BoxFact { readonly field: string; readonly value: string | number | boolean; readonly recordClass: string | null }
export interface BoxInput {
  readonly subjectId: string;
  readonly exactQuote: string | null;
  readonly sourceUrl: string | null;
  readonly origin: BoxOrigin;
  readonly fact?: BoxFact;
}
export interface BoxClaim {
  readonly builder: string;
  readonly token: string;
  readonly generation: number;
  readonly takenAt: string;
  readonly expiresAt: string;
}
export interface BoxFinding {
  readonly id: string;
  readonly subjectId: string;
  readonly exactQuote: string | null;
  readonly sourceUrl: string | null;
  readonly origins: readonly BoxOrigin[];
  readonly fact?: BoxFact;
  /** The newest origin's time, so the due queue reads a window without opening every row. */
  readonly lastRecordedAt?: string;
  readonly state: "waiting" | "taken" | "built" | "refused";
  readonly claim: BoxClaim | null;
  readonly attempts: readonly (BoxClaim & { readonly outcome: "failed" | "expired" | "built" | "refused"; readonly endedAt: string; readonly detail: string })[];
  readonly generation: number;
  readonly publicationId: string | null;
  /** Durable extraction; built is not a claim of reader delivery. */
  readonly buildResultId?: string;
  readonly refusal: string | null;
  /** Why a waiting finding has no slot yet, under the slot map it was read with; a newer map looks at it again. */
  readonly waitingFor?: { readonly class: string; readonly reason: string; readonly slots: string };
}

/** The builder that publishes hunters' findings into the fact store; its refusals are looked at again when its slot map moves. */
export const PUBLISHER = "fact-publisher";

/** The Box's reads for builders, filtered and limited by the store rather than read whole. */
interface BoxQueue {
  /** Rows a pass must look at, at most `limit`: parked ones first (waiting or refused by the fact publisher under another slot map, or taken past their lease), then ones never looked at. */
  due(input: { readonly slots: string; readonly now: string; readonly limit: number }): Promise<readonly BoxFinding[]>;
  /** Waiting rows handed to one builder, by the reason it gave them. */
  waitingFor(reason: string, limit: number, subjectIds?: readonly string[]): Promise<readonly BoxFinding[]>;
  /** Waiting rows handed to one builder, by the reason it gave them, about any board of the given governments (`<government>`, `<government>#governing`, `#board`, `#body:<slug>`); at most `limit` per government. */
  waitingUnder(reason: string, limit: number, governmentIds: readonly string[]): Promise<readonly BoxFinding[]>;
}
export type BoxRepository = AggregateRepository<BoxFinding> & BoxQueue;

/** The queue for a store that is read whole: the in-memory and file stores. */
export function listedBoxRepository(repo: AggregateRepository<BoxFinding>): BoxRepository {
  const rows = async () => (await repo.list()).map(row => row.value).sort((a, b) => a.id.localeCompare(b.id));
  return { ...repo,
    due: async ({ slots, now, limit }) => {
      const parked = (row: BoxFinding) => row.state !== "waiting" || row.waitingFor !== undefined;
      const due = (await rows()).filter(row => row.state === "waiting" && row.waitingFor?.slots !== slots ||
        row.state === "refused" && row.attempts.at(-1)?.builder === PUBLISHER && row.waitingFor?.slots !== slots ||
        row.state === "taken" && row.claim !== null && row.claim.expiresAt <= now);
      return [...due.filter(parked), ...due.filter(row => !parked(row))].slice(0, limit);
    },
    waitingFor: async (reason, limit, subjectIds) => {
      const subjects = subjectIds ? new Set(subjectIds) : null;
      return (await rows()).filter(row => row.state === "waiting" && row.waitingFor?.reason === reason && (!subjects || subjects.has(row.subjectId))).slice(0, limit);
    },
    waitingUnder: async (reason, limit, governmentIds) => {
      const all = (await rows()).filter(row => row.state === "waiting" && row.waitingFor?.reason === reason);
      return governmentIds.flatMap(id => all.filter(row => row.subjectId === id || row.subjectId.startsWith(`${id}#`)).slice(0, limit));
    },
  };
}

const factValue = (value: string | number | boolean): string => String(value).replace(/\s+/g, " ").trim().toLowerCase();

/** The identity rows had before one row per fact: the quote, page and subject, or the origin where the old evidence is missing. */
function legacyBoxFindingId(input: BoxInput): string {
  const identity = input.exactQuote && input.sourceUrl
    ? [input.exactQuote, input.sourceUrl, input.subjectId]
    : [input.subjectId, input.origin.kind, input.origin.resultId, input.origin.collection ?? "findings", input.origin.findingIndex];
  return `box-${contentHash(canonicalJson(identity))}`;
}

/** One row per subject, field and value, whatever page said it; a finding that names no field keeps its quote, page and subject, and missing old evidence is retained by origin. */
export function boxFindingId(input: BoxInput): string {
  return input.fact ? `box-${contentHash(canonicalJson([input.subjectId, input.fact.field, factValue(input.fact.value)]))}` : legacyBoxFindingId(input);
}
const originId = (origin: BoxOrigin) => canonicalJson([origin.kind, origin.resultId, origin.collection ?? "findings", origin.findingIndex]);
function instant(value: string): number {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) throw new Error("BOX_INVALID_TIME");
  return at;
}

/** Replaying old or newly appended results merges references without resetting builder state. */
export async function indexBoxFinding(repo: AggregateRepository<BoxFinding>, input: BoxInput, now: string): Promise<BoxFinding> {
  instant(now);
  if (!input.subjectId || !input.origin.resultId || !input.origin.workItemId || !Number.isSafeInteger(input.origin.findingIndex) || input.origin.findingIndex < 0) throw new Error("BOX_INVALID_ORIGIN");
  const id = boxFindingId(input), legacyId = legacyBoxFindingId(input);
  for (;;) {
    // A row made before one row per fact is still the row for its fact; it keeps its id.
    const held = await repo.read(id) ?? (input.fact && legacyId !== id ? await repo.read(legacyId) : null);
    const at = held?.value.id ?? id;
    if (!held) {
      const next: BoxFinding = { id, subjectId: input.subjectId, exactQuote: input.exactQuote, sourceUrl: input.sourceUrl,
        origins: [input.origin], ...(input.fact ? { fact: input.fact } : {}), lastRecordedAt: input.origin.recordedAt,
        state: "waiting", claim: null, attempts: [], generation: 0, publicationId: null, refusal: null };
      try { return (await repo.put(id, next, now)).persisted.value; }
      catch (error) { if (error instanceof IdentityCollision) continue; throw error; }
    }
    const elsewhere = input.sourceUrl !== null && input.sourceUrl !== held.value.sourceUrl;
    const origin: BoxOrigin = elsewhere && !input.origin.source ? { ...input.origin, source: { exactQuote: input.exactQuote, sourceUrl: input.sourceUrl! } } : input.origin;
    const prior = held.value.origins.find(held => originId(held) === originId(origin));
    const gains = !held.value.fact && input.fact !== undefined || held.value.lastRecordedAt === undefined;
    if (prior && (!origin.resultKey || prior.resultKey === origin.resultKey) && !gains) return held.value;
    const origins = prior ? held.value.origins.map(known => known === prior ? { ...known, resultKey: origin.resultKey ?? known.resultKey } : known)
      : [...held.value.origins, origin];
    const fact = held.value.fact ?? input.fact;
    const next = { ...held.value, origins: origins.sort((a, b) => originId(a).localeCompare(originId(b))), ...(fact ? { fact } : {}),
      lastRecordedAt: origins.map(known => known.recordedAt).sort().at(-1)! };
    try { return (await repo.compareAndSet(at, held.revision, next, now)).value; }
    catch (error) { if (!(error instanceof ConcurrentModification)) throw error; }
  }
}

/** The caller supplies its existing lease duration; Box creates no work or spending budget. */
export async function takeBoxFinding(repo: AggregateRepository<BoxFinding>, id: string, builder: string, now: string, expiresAt: string): Promise<BoxClaim | null> {
  if (!builder || instant(expiresAt) <= instant(now)) throw new Error("BOX_INVALID_CLAIM");
  for (;;) {
    const held = await repo.mustRead(id), value = held.value;
    if (value.state === "built" || value.state === "refused") return null;
    if (value.state === "taken" && value.claim && instant(value.claim.expiresAt) > instant(now)) return null;
    const generation = value.generation + 1;
    const claim: BoxClaim = { builder, token: randomUUID(), generation, takenAt: now, expiresAt };
    const attempts = value.claim ? [...value.attempts, { ...value.claim, outcome: "expired" as const, endedAt: now, detail: "Builder lease expired; finding remains available." }] : value.attempts;
    try {
      await repo.compareAndSet(id, held.revision, { ...value, state: "taken", claim, generation, attempts }, now);
      return claim;
    } catch (error) { if (!(error instanceof ConcurrentModification)) throw error; }
  }
}

export type BoxOutcome = { readonly state: "built"; readonly publicationId: string } |
  { readonly state: "built"; readonly buildResultId: string } |
  { readonly state: "refused"; readonly reason: string; readonly slots?: string } | { readonly state: "failed"; readonly reason: string };

/** A finding with nowhere to go yet stays in the Box, saying what it waits for. */
export async function holdBoxFinding(repo: AggregateRepository<BoxFinding>, id: string, waitingFor: NonNullable<BoxFinding["waitingFor"]>, now: string): Promise<void> {
  for (;;) {
    const held = await repo.mustRead(id), value = held.value;
    const lapsed = value.state === "taken" && value.claim !== null && instant(value.claim.expiresAt) <= instant(now);
    if (value.state !== "waiting" && !lapsed) return;
    const attempts = lapsed ? [...value.attempts, { ...value.claim!, outcome: "expired" as const, endedAt: now, detail: "Builder lease expired; finding remains available." }] : value.attempts;
    try { await repo.compareAndSet(id, held.revision, { ...value, state: "waiting", claim: null, attempts, waitingFor }, now); return; }
    catch (error) { if (!(error instanceof ConcurrentModification)) throw error; }
  }
}

/** A finding the publisher refused goes back to waiting under the slot map now in force, so the next look at it is a fresh one. */
export async function reopenBoxFinding(repo: AggregateRepository<BoxFinding>, id: string, slots: string, now: string): Promise<void> {
  for (;;) {
    const held = await repo.mustRead(id), value = held.value;
    if (value.state !== "refused") return;
    try { await repo.compareAndSet(id, held.revision, { ...value, state: "waiting", refusal: null, waitingFor: { class: value.waitingFor?.class ?? "other", reason: value.refusal!, slots } }, now); return; }
    catch (error) { if (!(error instanceof ConcurrentModification)) throw error; }
  }
}

/** Record the durable extraction or publication before finishing its fenced claim. */
export async function finishBoxFinding(repo: AggregateRepository<BoxFinding>, id: string, token: string, outcome: BoxOutcome, now: string): Promise<boolean> {
  instant(now);
  const detail = outcome.state === "built" ? ("buildResultId" in outcome ? outcome.buildResultId : outcome.publicationId) : outcome.reason;
  if (!detail.trim()) throw new Error("BOX_OUTCOME_DETAIL_REQUIRED");
  for (;;) {
    const held = await repo.mustRead(id), value = held.value;
    if (value.state !== "taken" || value.claim?.token !== token || instant(value.claim.expiresAt) <= instant(now)) return false;
    const next: BoxFinding = { ...value, state: outcome.state === "failed" ? "waiting" : outcome.state, claim: null,
      publicationId: outcome.state === "built" && "publicationId" in outcome ? outcome.publicationId : null,
      ...(outcome.state === "built" && "buildResultId" in outcome ? { buildResultId: outcome.buildResultId } : {}),
      refusal: outcome.state === "refused" ? outcome.reason : null,
      ...(outcome.state === "refused" && outcome.slots ? { waitingFor: { class: value.waitingFor?.class ?? "other", reason: outcome.reason, slots: outcome.slots } } : {}),
      attempts: [...value.attempts, { ...value.claim, outcome: outcome.state, endedAt: now, detail }] };
    try { await repo.compareAndSet(id, held.revision, next, now); return true; }
    catch (error) { if (!(error instanceof ConcurrentModification)) throw error; }
  }
}

/** A finding's field, value and the Scout origin that carried them; null when it names no field. */
export function findingFact(row: BoxFinding): (BoxFact & { readonly origin: BoxOrigin }) | null {
  const own = row.origins.filter(o => !o.source);
  const origin = own.find(o => o.reported) ?? own.find(o => o.kind === "SCOUT");
  return origin && row.fact ? { origin, ...row.fact } : null;
}

/** The other pages that said the same fact: each with the quote and address it saw and the origin that carries its saved copy. */
export function otherSources(row: BoxFinding): readonly { readonly origin: BoxOrigin; readonly exactQuote: string; readonly sourceUrl: string }[] {
  const seen = new Set<string>(row.sourceUrl ? [row.sourceUrl] : []);
  return row.origins.flatMap(origin => origin.kind === "SCOUT" && origin.source?.exactQuote && !seen.has(origin.source.sourceUrl) && seen.add(origin.source.sourceUrl)
    ? [{ origin, exactQuote: origin.source.exactQuote, sourceUrl: origin.source.sourceUrl }] : []);
}

/** Used by both Scout writers and the historical-result backfill. No finding is filtered out. */
type BoxScoutResult = Pick<ScoutResult, "findings" | "subjectId" | "attemptId" | "workItemId" | "recordedAt"> & Partial<Pick<ScoutResult, "obligationId" | "recordClass">>;
export async function indexScoutFindings(repo: AggregateRepository<BoxFinding>, result: BoxScoutResult, now: string): Promise<readonly BoxFinding[]> {
  const indexed: BoxFinding[] = [];
  for (const [findingIndex, finding] of result.findings.entries()) indexed.push(await indexBoxFinding(repo, {
    subjectId: finding.subjectId ?? result.subjectId, exactQuote: finding.exactQuote ?? null, sourceUrl: finding.sourceUrl ?? null,
    origin: { kind: "SCOUT", resultId: result.attemptId, ...(result.obligationId ? { resultKey: result.obligationId } : {}), workItemId: result.workItemId, findingIndex,
      artifactIds: finding.artifactIds, recordedAt: result.recordedAt, ...(finding.missionPart ? { missionPart: finding.missionPart } : {}) },
    ...(finding.field && finding.value !== undefined && finding.value !== null ? { fact: { field: finding.field, value: finding.value, recordClass: result.recordClass ?? null } } : {}),
  }, now));
  return indexed;
}

/** A finding a Scout dropped mid-walk (`report_finding`), keyed by its attempt and drop order. */
export async function indexReportedFinding(repo: AggregateRepository<BoxFinding>, input: {
  readonly workItemId: string; readonly attemptId: string; readonly obligationId?: string; readonly missionPart: string | null;
  readonly finding: { readonly subjectId: string; readonly field: string; readonly value: string | number | boolean; readonly exactQuote: string;
    readonly sourceUrl: string; readonly artifactIds: readonly string[]; readonly subjectHint: string | null; readonly index: number };
}, now: string): Promise<BoxFinding> {
  const { finding } = input;
  return indexBoxFinding(repo, { subjectId: finding.subjectId, exactQuote: finding.exactQuote, sourceUrl: finding.sourceUrl,
    origin: { kind: "SCOUT", resultId: input.attemptId, ...(input.obligationId ? { resultKey: input.obligationId } : {}), workItemId: input.workItemId,
      findingIndex: finding.index, collection: "reported", artifactIds: finding.artifactIds, recordedAt: now,
      ...(input.missionPart ? { missionPart: input.missionPart } : {}),
      reported: { field: finding.field, value: finding.value, subjectHint: finding.subjectHint } },
    fact: { field: finding.field, value: finding.value, recordClass: null } }, now);
}

interface BoxDetectiveRecord {
  readonly id: string;
  readonly workItemId: string;
  readonly endedAt: string;
  readonly result: Pick<DetectiveResult, "role" | "spans" | "findings" | "artifactIds"> & { readonly question: Pick<DetectiveResult["question"], "subjectId"> };
}

/** The page each saved copy was taken from, read by its id alone. */
async function capturedUrls(artifacts: AppendOnlyRepository<ArtifactRecord>, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const out = new Map<string, string>();
  for (const id of new Set(ids)) for (const key of await artifacts.keysWhere(["artifactId"], id)) {
    const [held] = await artifacts.readWhere(key, ["artifactId"], id);
    if (held) out.set(id, held.canonicalUrl);
  }
  return out;
}

/** Detective spans retain their exact quote and saved-copy identity; unquoted findings remain references. */
export async function indexDetectiveFindings(repo: AggregateRepository<BoxFinding>, record: BoxDetectiveRecord,
  artifacts: AppendOnlyRepository<ArtifactRecord>, now: string): Promise<readonly BoxFinding[]> {
  const indexed: BoxFinding[] = [];
  const base = { kind: "DETECTIVE" as const, resultId: record.id, workItemId: record.workItemId, recordedAt: record.endedAt };
  const urls = await capturedUrls(artifacts, record.result.spans.map(span => span.artifactId));
  for (const [findingIndex, span] of record.result.spans.entries()) indexed.push(await indexBoxFinding(repo, {
    subjectId: record.result.question.subjectId, exactQuote: span.quote, sourceUrl: urls.get(span.artifactId) ?? null,
    origin: { ...base, collection: "spans", findingIndex, artifactIds: [span.artifactId] },
  }, now));
  for (const [findingIndex] of record.result.findings.entries()) indexed.push(await indexBoxFinding(repo, {
    subjectId: record.result.question.subjectId, exactQuote: null, sourceUrl: null,
    origin: { ...base, collection: "findings", findingIndex, artifactIds: record.result.artifactIds },
  }, now));
  return indexed;
}

const BACKFILL_CURSOR = "box-backfill";
// A result stamped just before the last pass read the clock may commit after it; each pass looks a minute further back.
const BACKFILL_OVERLAP_MS = 60_000;

type BackfillRepositories = Pick<ControlPlaneRepositories, "boxFindings" | "scoutResults" | "workerResults" | "artifacts" | "attempts" | "passCursors">;

async function indexResults(repos: BackfillRepositories, scouts: readonly ScoutResult[], workers: readonly WorkerResultRecord[], now: string): Promise<number> {
  let indexed = 0;
  for (const result of scouts) indexed += (await indexScoutFindings(repos.boxFindings, result, now)).length;
  for (const record of (await completedWorkerResults(repos, workers)).filter(record => record.result.role === "DETECTIVE")) {
    indexed += (await indexDetectiveFindings(repos.boxFindings, record as BoxDetectiveRecord, repos.artifacts, now)).length;
  }
  return indexed;
}

export async function backfillBox(repos: BackfillRepositories, now: string, cursorId = BACKFILL_CURSOR): Promise<number> {
  const cursor = await repos.passCursors.read(cursorId);
  const since = cursor ? new Date(Date.parse(cursor.value.through) - BACKFILL_OVERLAP_MS).toISOString() : null;
  let indexed = 0;
  const scouts = await repos.scoutResults.readChangedSince(since, [], { page: async records => {
    indexed += await indexResults(repos, records.map(({ record }) => record), [], now);
  } });
  const workers = await repos.workerResults.readChangedSince(since, [], { page: async records => {
    indexed += await indexResults(repos, [], records.map(({ record }) => record), now);
  } });
  const through = [scouts.through, workers.through].flatMap(at => at ?? []).sort()[0];
  if (through) {
    if (cursor) await repos.passCursors.compareAndSet(cursorId, cursor.revision, { through }, now);
    else await repos.passCursors.put(cursorId, { through }, now);
  }
  return indexed;
}

/** Count once per linked work item, never once per result. Admin joins the canonical Send mapping. */
export async function boxCountsByWorkItem(repo: AggregateRepository<BoxFinding>): Promise<Readonly<Record<string, Readonly<Record<BoxFinding["state"], number>>>>> {
  const counts: Record<string, Record<BoxFinding["state"], number>> = Object.create(null);
  for (const row of await repo.list()) for (const workItem of new Set(row.value.origins.map(origin => origin.workItemId))) {
    counts[workItem] ??= { waiting: 0, taken: 0, built: 0, refused: 0 };
    counts[workItem][row.value.state]++;
  }
  return counts;
}

/** A failed read throws; Admin must show unknown rather than a fabricated empty backlog. */
export async function boxCounts(repo: AggregateRepository<BoxFinding>): Promise<Readonly<Record<BoxFinding["state"], number>>> {
  const counts = { waiting: 0, taken: 0, built: 0, refused: 0 };
  for (const row of await repo.list()) counts[row.value.state]++;
  return counts;
}
