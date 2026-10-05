import { randomUUID } from "node:crypto";
import { contentHash } from "./ids.ts";
import { canonicalJson, ConcurrentModification, IdentityCollision, type AggregateRepository, type ArtifactRecord } from "./repository/types.ts";
import type { ScoutResult } from "./scheduler/scout-result.ts";
import type { DetectiveResult } from "./workers/research-types.ts";

/** References into the existing result and artifact stores, never another evidence store. */
export interface BoxOrigin {
  readonly kind: "SCOUT" | "DETECTIVE";
  readonly resultId: string;
  readonly workItemId: string;
  readonly findingIndex: number;
  readonly collection?: "findings" | "spans";
  readonly artifactIds: readonly string[];
  readonly missionPart?: string;
  readonly recordedAt: string;
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
  readonly refusal: string | null;
}

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
    if (held.value.origins.some(origin => originId(origin) === originId(input.origin))) return held.value;
    const next = { ...held.value, origins: [...held.value.origins, input.origin].sort((a, b) => originId(a).localeCompare(originId(b))) };
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
  { readonly state: "refused"; readonly reason: string } | { readonly state: "failed"; readonly reason: string };

/** BX-02 must publish with finding.id as its idempotency key before recording built. */
export async function finishBoxFinding(repo: AggregateRepository<BoxFinding>, id: string, token: string, outcome: BoxOutcome, now: string): Promise<boolean> {
  instant(now);
  const detail = outcome.state === "built" ? outcome.publicationId : outcome.reason;
  if (!detail.trim()) throw new Error("BOX_OUTCOME_DETAIL_REQUIRED");
  for (;;) {
    const held = await repo.mustRead(id), value = held.value;
    if (value.state !== "taken" || value.claim?.token !== token || instant(value.claim.expiresAt) <= instant(now)) return false;
    const next: BoxFinding = { ...value, state: outcome.state === "failed" ? "waiting" : outcome.state, claim: null,
      publicationId: outcome.state === "built" ? outcome.publicationId : null,
      refusal: outcome.state === "refused" ? outcome.reason : null,
      attempts: [...value.attempts, { ...value.claim, outcome: outcome.state, endedAt: now, detail }] };
    try { await repo.compareAndSet(id, held.revision, next, now); return true; }
    catch (error) { if (!(error instanceof ConcurrentModification)) throw error; }
  }
}

/** Used by both Scout writers and the historical-result backfill. No finding is filtered out. */
export type BoxScoutResult = Pick<ScoutResult, "findings" | "subjectId" | "attemptId" | "workItemId" | "recordedAt">;
export async function indexScoutFindings(repo: AggregateRepository<BoxFinding>, result: BoxScoutResult, now: string): Promise<readonly BoxFinding[]> {
  const indexed: BoxFinding[] = [];
  for (const [findingIndex, finding] of result.findings.entries()) indexed.push(await indexBoxFinding(repo, {
    subjectId: finding.subjectId ?? result.subjectId, exactQuote: finding.exactQuote ?? null, sourceUrl: finding.sourceUrl ?? null,
    origin: { kind: "SCOUT", resultId: result.attemptId, workItemId: result.workItemId, findingIndex,
      artifactIds: finding.artifactIds, recordedAt: result.recordedAt, ...(finding.missionPart ? { missionPart: finding.missionPart } : {}) },
  }, now));
  return indexed;
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

/** Startup replays are harmless: each old origin is indexed once, including a crash after the source append. */
export async function backfillBox(repo: AggregateRepository<BoxFinding>, input: {
  readonly scouts: readonly BoxScoutResult[];
  readonly detectives: readonly BoxDetectiveRecord[];
  readonly artifacts: ReadonlyMap<string, Pick<ArtifactRecord, "canonicalUrl">>;
}, now: string): Promise<void> {
  for (const result of input.scouts) await indexScoutFindings(repo, result, now);
  for (const result of input.detectives) await indexDetectiveFindings(repo, result, input.artifacts, now);
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
