import { routineScopeState } from "../civic-data/state-scope.ts";
import { randomUUID } from "node:crypto";
import { contentHash } from "./ids.ts";
import { canonicalJson, ConcurrentModification, IdentityCollision, type AggregateRepository, type AppendOnlyRepository, type ArtifactRecord } from "./repository/types.ts";
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
}
export interface BoxInput {
  readonly subjectId: string;
  readonly exactQuote: string | null;
  readonly sourceUrl: string | null;
  readonly origin: BoxOrigin;
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

export const BOX_PUBLICATION_STATE_SQL = "coalesce(upper(substring(value->>'subjectId' from '(?i)(?:^|/(?:state|district|territory):|^curated:)([a-z]{2})(?=[:/#]|$)')), upper(substring(jsonb_path_query_first(value, '$.origins[*].resultKey ? (@ like_regex \"/(state|district|territory):[a-z]{2}\")') #>> '{}' from '/(?:state|district|territory):([a-z]{2})')), 'US')";
export const boxFindingState = (row: Pick<BoxFinding, "subjectId" | "origins">): string => {
  const subject = routineScopeState(row.subjectId);
  const packet = row.origins.find(origin => /\/(state|district|territory):[a-z]{2}/i.test(origin.resultKey ?? ""))?.resultKey;
  return (subject === "US" && packet ? routineScopeState(packet) : subject).replace(/^US-/, "");
};

/** Missing old evidence is retained by origin; it must not collapse into one empty finding. */
export function boxFindingId(input: BoxInput): string {
  const identity = input.exactQuote && input.sourceUrl
    ? [input.exactQuote, input.sourceUrl, input.subjectId]
    : [input.subjectId, input.origin.kind, input.origin.resultId, input.origin.collection ?? "findings", input.origin.findingIndex];
  return `box-${contentHash(canonicalJson(identity))}`;
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
  const id = boxFindingId(input);
  for (;;) {
    const held = await repo.read(id);
    if (!held) {
      const next: BoxFinding = { id, subjectId: input.subjectId, exactQuote: input.exactQuote, sourceUrl: input.sourceUrl,
        origins: [input.origin], state: "waiting", claim: null, attempts: [], generation: 0, publicationId: null, refusal: null };
      try { return (await repo.put(id, next, now)).persisted.value; }
      catch (error) { if (error instanceof IdentityCollision) continue; throw error; }
    }
    const prior = held.value.origins.find(origin => originId(origin) === originId(input.origin));
    if (prior && (!input.origin.resultKey || prior.resultKey === input.origin.resultKey)) return held.value;
    const origins = prior ? held.value.origins.map(origin => origin === prior ? { ...origin, resultKey: input.origin.resultKey } : origin)
      : [...held.value.origins, input.origin];
    const next = { ...held.value, origins: origins.sort((a, b) => originId(a).localeCompare(originId(b))) };
    try { return (await repo.compareAndSet(id, held.revision, next, now)).value; }
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
  { readonly state: "refused"; readonly reason: string } | { readonly state: "failed"; readonly reason: string };

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
      attempts: [...value.attempts, { ...value.claim, outcome: outcome.state, endedAt: now, detail }] };
    try { await repo.compareAndSet(id, held.revision, next, now); return true; }
    catch (error) { if (!(error instanceof ConcurrentModification)) throw error; }
  }
}

/** A finding's field, value and origin: a mid-hunt drop carries them; a Scout finding is read from its saved result. */
export async function findingFact(results: Pick<AppendOnlyRepository<ScoutResult>, "readWhere">, row: BoxFinding):
  Promise<{ readonly origin: BoxOrigin; readonly field: string; readonly value: string | number | boolean } | null> {
  const origin = row.origins.find(o => o.reported) ?? row.origins.find(o => o.kind === "SCOUT" && o.resultKey);
  if (!origin) return null;
  if (origin.reported) return { origin, field: origin.reported.field, value: origin.reported.value };
  const result = (await results.readWhere(origin.resultKey!, ["attemptId"], origin.resultId)).find(row => row.attemptId === origin.resultId);
  const finding = result?.findings[origin.findingIndex];
  return finding?.field && finding.value !== undefined && finding.value !== null ? { origin, field: finding.field, value: finding.value } : null;
}

/** Used by both Scout writers and the historical-result backfill. No finding is filtered out. */
export type BoxScoutResult = Pick<ScoutResult, "findings" | "subjectId" | "attemptId" | "workItemId" | "recordedAt"> & Partial<Pick<ScoutResult, "obligationId">>;
export async function indexScoutFindings(repo: AggregateRepository<BoxFinding>, result: BoxScoutResult, now: string): Promise<readonly BoxFinding[]> {
  const indexed: BoxFinding[] = [];
  for (const [findingIndex, finding] of result.findings.entries()) indexed.push(await indexBoxFinding(repo, {
    subjectId: finding.subjectId ?? result.subjectId, exactQuote: finding.exactQuote ?? null, sourceUrl: finding.sourceUrl ?? null,
    origin: { kind: "SCOUT", resultId: result.attemptId, ...(result.obligationId ? { resultKey: result.obligationId } : {}), workItemId: result.workItemId, findingIndex,
      artifactIds: finding.artifactIds, recordedAt: result.recordedAt, ...(finding.missionPart ? { missionPart: finding.missionPart } : {}) },
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
      reported: { field: finding.field, value: finding.value, subjectHint: finding.subjectHint } } }, now);
}

export interface BoxDetectiveRecord {
  readonly id: string;
  readonly workItemId: string;
  readonly endedAt: string;
  readonly result: Pick<DetectiveResult, "role" | "spans" | "findings" | "artifactIds"> & { readonly question: Pick<DetectiveResult["question"], "subjectId"> };
}

/** Detective spans retain their exact quote and saved-copy identity; unquoted findings remain references. */
export async function indexDetectiveFindings(repo: AggregateRepository<BoxFinding>, record: BoxDetectiveRecord,
  artifacts: ReadonlyMap<string, Pick<ArtifactRecord, "canonicalUrl">>, now: string): Promise<readonly BoxFinding[]> {
  const indexed: BoxFinding[] = [];
  const base = { kind: "DETECTIVE" as const, resultId: record.id, workItemId: record.workItemId, recordedAt: record.endedAt };
  for (const [findingIndex, span] of record.result.spans.entries()) indexed.push(await indexBoxFinding(repo, {
    subjectId: record.result.question.subjectId, exactQuote: span.quote, sourceUrl: artifacts.get(span.artifactId)?.canonicalUrl ?? null,
    origin: { ...base, collection: "spans", findingIndex, artifactIds: [span.artifactId] },
  }, now));
  for (const [findingIndex] of record.result.findings.entries()) indexed.push(await indexBoxFinding(repo, {
    subjectId: record.result.question.subjectId, exactQuote: null, sourceUrl: null,
    origin: { ...base, collection: "findings", findingIndex, artifactIds: record.result.artifactIds },
  }, now));
  return indexed;
}

/** Indexes only the Scout and Detective results the Box does not already hold; one read of the Box per call. */
export async function backfillBox(repo: AggregateRepository<BoxFinding>, input: {
  readonly scouts: readonly BoxScoutResult[];
  readonly detectives: readonly BoxDetectiveRecord[];
  readonly artifacts: ReadonlyMap<string, Pick<ArtifactRecord, "canonicalUrl">>;
}, now: string): Promise<number> {
  const held = new Map<string, number>();
  for (const row of await repo.list()) for (const origin of row.value.origins) {
    if (origin.collection === "reported") continue;
    const key = `${origin.kind}:${origin.resultId}`;
    held.set(key, (held.get(key) ?? 0) + 1);
  }
  let indexed = 0;
  for (const result of input.scouts) {
    if ((held.get(`SCOUT:${result.attemptId}`) ?? 0) < result.findings.length) indexed += (await indexScoutFindings(repo, result, now)).length;
  }
  for (const result of input.detectives) {
    if ((held.get(`DETECTIVE:${result.id}`) ?? 0) < result.result.spans.length + result.result.findings.length) indexed += (await indexDetectiveFindings(repo, result, input.artifacts, now)).length;
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
