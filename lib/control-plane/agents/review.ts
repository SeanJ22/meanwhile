/**
 * **ASK BOTH IS NOT INDEPENDENT REVIEW.** (ADM-C9; §4 of the Admin C brief,
 * 2026-09-06.)
 *
 * The brief states it flatly — *"The two modes are not identical"* — and then
 * says what independence costs:
 *
 * ```
 *   same frozen snapshot
 *   separate execution
 *   no access to the other reviewer's answer before completion
 *   each result stored separately
 *   comparison occurs only after both finish
 * ```
 *
 * A comment promising that is worth nothing. The whole design of this module is
 * to make the promise a property of the code, in three layers that each hold on
 * their own:
 *
 * ### Layer 1 — the type has no channel
 *
 * {@link ReviewerAssignment} is everything a reviewer is given, and it has no
 * field through which a peer's conclusion could arrive. {@link ReviewerExecutor}
 * takes exactly that one argument. There is no `peer`, no `otherSaid`, no
 * `context.previous`. A reviewer cannot read what it was never handed, and the
 * shape of the function says so before any code runs.
 *
 * ### Layer 2 — the conclusion is sealed, and only opens in pairs
 *
 * A finished conclusion goes into a {@link SealedConclusion}: an opaque handle
 * whose payload lives in a module-private `WeakMap`. The ONLY exported way back
 * to the content is {@link openBoth}, which needs both handles and refuses
 * unless both have been sealed, which happens only at completion. There is
 * deliberately no `open(one)` — *"a function
 * that could read the other result before completion is a defect"*, so the
 * function does not exist to be called by mistake.
 *
 * ### Layer 3 — the order is fixed and stamped
 *
 * Both assignments are built and frozen BEFORE either executor is called, both
 * are started in one `Promise.all` over seat runners that never reject (each
 * catches its own provider), and {@link compareConclusions} is
 * reached only on the far side of it. {@link proveIsolation} then records what
 * was actually true of the run — same snapshot hash on both sides, each
 * reviewer echoing the hash it was given, the comparison stamped at or after
 * both completions — so the page shows evidence rather than an assurance.
 *
 * `ASK_BOTH` gets none of that, and says so. It is two answers side by side,
 * it may share context or run in sequence, and its outcome type carries
 * `preservesIndependence: false` as a literal so the two results are not
 * interchangeable anywhere in the type system. The console may never describe
 * an `ASK_BOTH` run as a second, independent opinion, because it is not one.
 *
 * PURE except for the injected executor, log and clock.
 */

import {
  completeJob,
  failJob,
  freezeContext,
  openJob,
  persistJob,
  refuseJob,
  type AgentJobLog,
  type AllowedReach,
  type DelegatedAgentJob,
  type FrozenContext,
  type JobState,
} from "./job.ts";
import { PROVIDER_WORDS, type AgentProviderId, type ExecutionChoice } from "./provider.ts";

/* ------------------------------------------------------------- reviewers */

/** Which of the two seats this is. Two, never more: a tie is a disagreement, not a vote. */
export const REVIEWER_SLOTS = ["A", "B"] as const;
export type ReviewerSlot = (typeof REVIEWER_SLOTS)[number];

/** Where a reviewer landed on one named topic. */
export const STANCES = ["YES", "NO", "UNSURE"] as const;
export type Stance = (typeof STANCES)[number];

export const CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/**
 * One claim from one reviewer, on one named topic.
 *
 * The topic is what makes agreement computable rather than editorial: two
 * reviewers agree when they took the same stance on the same topic, and the
 * console never has to decide whether two paragraphs mean the same thing.
 */
export interface ReviewPoint {
  /** A short stable name for what this claim is about. */
  readonly topic: string;
  readonly stance: Stance;
  /** The claim in the reviewer's own words. */
  readonly says: string;
  readonly confidence: Confidence;
  /** What the reviewer pointed at inside the frozen snapshot. */
  readonly evidence: string;
}

/**
 * EVERYTHING a reviewer is given.
 *
 * Layer 1 of the independence guarantee lives in this interface's field list.
 * Adding a field here that could carry another reviewer's work — a transcript,
 * a "previous answer", a shared conversation id — would silently repeal
 * ADM-C9, which is why `tests/agent-bridge.test.ts` asserts the declared field
 * set directly.
 */
export interface ReviewerAssignment {
  readonly reviewId: string;
  readonly slot: ReviewerSlot;
  readonly provider: AgentProviderId;
  /** The question both reviewers were asked. Identical for both, by construction. */
  readonly question: string;
  /** The identity of what was frozen. */
  readonly snapshot: FrozenContext;
  /** The exact frozen bytes. Identical for both, by construction. */
  readonly body: string;
  /** How long this reviewer has, and what it may touch. */
  readonly bounds: { readonly wallMs: number; readonly allowed: AllowedReach };
}

/** What a reviewer concluded. */
export interface ReviewerConclusion {
  readonly slot: ReviewerSlot;
  readonly provider: AgentProviderId;
  /** The snapshot hash the reviewer echoed back — proof it read what it was given. */
  readonly reviewedHash: string;
  /** The reviewer's overall answer, in one sentence. */
  readonly verdict: string;
  readonly points: readonly ReviewPoint[];
  readonly startedAt: string;
  readonly completedAt: string;
}

/** The one shape a reviewer runner may have. One argument, and it carries no peer. */
export type ReviewerExecutor = (assignment: ReviewerAssignment) => Promise<ReviewerConclusion>;

/* ---------------------------------------------------------------- sealing */

/**
 * The vault. Module-private on purpose: nothing outside this file holds the
 * map, so nothing outside this file can look a conclusion up by its handle.
 *
 * A `WeakMap` rather than a `Map` so a sealed conclusion nobody kept a handle to
 * is collectable — a review that was abandoned should not pin its contents in
 * memory for the life of the process.
 */
const VAULT = new WeakMap<SealedConclusion, ReviewerConclusion>();

/**
 * A finished conclusion, closed. The handle carries only what the console may
 * know before the pair opens: which seat, which provider, and when it finished.
 * The verdict, the points and the evidence are not on it and are not reachable
 * from it.
 */
export interface SealedConclusion {
  readonly kind: "SEALED_REVIEWER_CONCLUSION";
  readonly slot: ReviewerSlot;
  readonly provider: AgentProviderId;
  readonly completedAt: string;
}

/** Seal a conclusion. The only way in. */
export function seal(conclusion: ReviewerConclusion): SealedConclusion {
  const handle: SealedConclusion = Object.freeze({
    kind: "SEALED_REVIEWER_CONCLUSION" as const,
    slot: conclusion.slot,
    provider: conclusion.provider,
    completedAt: conclusion.completedAt,
  });
  VAULT.set(handle, conclusion);
  return handle;
}

export type OpenedPair =
  | { readonly ok: true; readonly a: ReviewerConclusion; readonly b: ReviewerConclusion }
  | { readonly ok: false; readonly why: string };

/**
 * The ONLY way out — and it takes both.
 *
 * There is no single-handle opener anywhere in this module's exported surface,
 * which is the point: ADM-C9 says neither reviewer may see the other's
 * conclusion before completing its own, and a function that returned one
 * conclusion on its own would be the exact seam through which that could
 * happen. Two handles from the same seat, or a handle this module did not
 * seal, are both refused rather than half-answered.
 */
export function openBoth(a: SealedConclusion, b: SealedConclusion): OpenedPair {
  if (a === b || a.slot === b.slot) {
    return { ok: false, why: "Both handles are the same reviewer's, so there is no pair to open." };
  }
  const left = VAULT.get(a);
  const right = VAULT.get(b);
  if (left === undefined || right === undefined) {
    return { ok: false, why: "One of these conclusions was not sealed here, so it cannot be opened here." };
  }
  return left.slot === "A" ? { ok: true, a: left, b: right } : { ok: true, a: right, b: left };
}

/* ------------------------------------------------------------ comparison */

export interface Disagreement {
  readonly topic: string;
  readonly aSays: string;
  readonly bSays: string;
  readonly aStance: Stance;
  readonly bStance: Stance;
  readonly aConfidence: Confidence;
  readonly bConfidence: Confidence;
  /** What each pointed at. A disagreement without both sides' evidence is an opinion poll. */
  readonly aEvidence: string;
  readonly bEvidence: string;
}

export interface Agreement {
  readonly topic: string;
  readonly stance: Stance;
  readonly aSays: string;
  readonly bSays: string;
  /** The weaker of the two confidences: two reviewers are only as sure as the less sure one. */
  readonly confidence: Confidence;
  readonly aEvidence: string;
  readonly bEvidence: string;
}

export interface ReviewComparison {
  readonly agreements: readonly Agreement[];
  readonly disagreements: readonly Disagreement[];
  /** Topics only one reviewer raised. Not a disagreement — a difference in what they looked at. */
  readonly onlyA: readonly ReviewPoint[];
  readonly onlyB: readonly ReviewPoint[];
  readonly comparedAt: string;
  /** One plain sentence: what the two of them add up to. */
  readonly says: string;
}

/** The weaker of two confidences. Two reviewers are only as sure as the less sure one. */
function weaker(a: Confidence, b: Confidence): Confidence {
  const rank: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return rank[a] <= rank[b] ? a : b;
}

/**
 * Compare two conclusions, by topic.
 *
 * Called only after both are open, which is only after both are complete. It is
 * deliberately dumb: same topic and same stance is agreement, same topic and a
 * different stance is disagreement, a topic on one side only is a difference in
 * what they looked at and is reported as itself rather than folded into either.
 */
export function compareConclusions(a: ReviewerConclusion, b: ReviewerConclusion, comparedAt: string): ReviewComparison {
  const byTopicB = new Map(b.points.map((p) => [p.topic, p]));
  const agreements: Agreement[] = [];
  const disagreements: Disagreement[] = [];
  const onlyA: ReviewPoint[] = [];
  for (const pa of a.points) {
    const pb = byTopicB.get(pa.topic);
    if (pb === undefined) {
      onlyA.push(pa);
      continue;
    }
    if (pa.stance === pb.stance) {
      agreements.push({
        topic: pa.topic,
        stance: pa.stance,
        aSays: pa.says,
        bSays: pb.says,
        confidence: weaker(pa.confidence, pb.confidence),
        aEvidence: pa.evidence,
        bEvidence: pb.evidence,
      });
    } else {
      disagreements.push({
        topic: pa.topic,
        aSays: pa.says,
        bSays: pb.says,
        aStance: pa.stance,
        bStance: pb.stance,
        aConfidence: pa.confidence,
        bConfidence: pb.confidence,
        aEvidence: pa.evidence,
        bEvidence: pb.evidence,
      });
    }
  }
  const topicsA = new Set(a.points.map((p) => p.topic));
  const onlyB = b.points.filter((p) => !topicsA.has(p.topic));
  const says = disagreements.length === 0
    ? `Both reviewers agreed on all ${agreements.length} point${agreements.length === 1 ? "" : "s"} they both looked at.`
    : `They disagreed on ${disagreements.length} of ${agreements.length + disagreements.length} points they both looked at.`;
  return { agreements, disagreements, onlyA, onlyB, comparedAt, says };
}

/* -------------------------------------------------------------- isolation */

/**
 * What was actually true about the run, computed from its own stamps rather
 * than asserted by the code that ran it.
 */
export interface IsolationProof {
  /** Both reviewers were given the same frozen snapshot. */
  readonly sameSnapshot: boolean;
  /** Each reviewer echoed back the hash it was given. */
  readonly eachReviewedWhatItWasGiven: boolean;
  /** The comparison happened at or after both completions. */
  readonly comparedAfterBoth: boolean;
  readonly snapshotHash: string;
  readonly assignmentsFrozenAt: string;
  readonly comparedAt: string;
  /** All three, and the structural guarantee that neither could reach the other. */
  readonly holds: boolean;
  readonly says: string;
}

/**
 * Prove — or fail to prove — the isolation of one completed review.
 *
 * `holds` is a conjunction of three measured facts, not a flag anyone set. A
 * run where a reviewer echoed a different hash than it was given did NOT review
 * the frozen snapshot, and the console must not present it as an independent
 * second reading of the same thing.
 */
export function proveIsolation(input: {
  readonly assignmentA: ReviewerAssignment;
  readonly assignmentB: ReviewerAssignment;
  readonly a: ReviewerConclusion;
  readonly b: ReviewerConclusion;
  readonly assignmentsFrozenAt: string;
  readonly comparedAt: string;
}): IsolationProof {
  const sameSnapshot = input.assignmentA.snapshot.hash === input.assignmentB.snapshot.hash;
  const eachReviewedWhatItWasGiven =
    input.a.reviewedHash === input.assignmentA.snapshot.hash && input.b.reviewedHash === input.assignmentB.snapshot.hash;
  const comparedAfterBoth = input.comparedAt >= input.a.completedAt && input.comparedAt >= input.b.completedAt;
  const holds = sameSnapshot && eachReviewedWhatItWasGiven && comparedAfterBoth;
  return {
    sameSnapshot,
    eachReviewedWhatItWasGiven,
    comparedAfterBoth,
    snapshotHash: input.assignmentA.snapshot.hash,
    assignmentsFrozenAt: input.assignmentsFrozenAt,
    comparedAt: input.comparedAt,
    holds,
    says: holds
      ? "Both reviewed the same frozen copy, each was handed only that copy, and the two answers were only put side by side after both were finished."
      : "This run cannot be shown as an independent review: one of the three checks below did not hold.",
  };
}

/* ---------------------------------------------------------- the run types */

export interface ReviewerRunOutcome {
  readonly slot: ReviewerSlot;
  readonly provider: AgentProviderId;
  /** The control plane's own job vocabulary, not a second one for this surface. */
  readonly state: JobState;
  readonly conclusion: ReviewerConclusion | null;
  /** Why, when there is no conclusion. Plain language. */
  readonly why: string | null;
  readonly jobId: string;
}

export interface IndependentReviewOutcome {
  readonly mode: "INDEPENDENT_REVIEW";
  /** A literal, so this outcome is not interchangeable with an ASK_BOTH one. */
  readonly preservesIndependence: true;
  readonly reviewId: string;
  readonly question: string;
  readonly snapshot: FrozenContext;
  readonly a: ReviewerRunOutcome;
  readonly b: ReviewerRunOutcome;
  /** Null unless both finished. One conclusion compared against nothing is a fabricated agreement. */
  readonly comparison: ReviewComparison | null;
  readonly isolation: IsolationProof | null;
  readonly startedAt: string;
  readonly says: string;
}

export interface AskBothOutcome {
  readonly mode: "ASK_BOTH";
  /** A literal `false`: this mode collects two answers and proves nothing about how they were reached. */
  readonly preservesIndependence: false;
  readonly askId: string;
  readonly question: string;
  readonly snapshot: FrozenContext;
  readonly a: ReviewerRunOutcome;
  readonly b: ReviewerRunOutcome;
  readonly comparison: ReviewComparison | null;
  readonly startedAt: string;
  readonly says: string;
}

/** What both runners need. The executor is the only thing that reaches a provider. */
export interface ReviewDeps {
  readonly execute: ReviewerExecutor;
  readonly log: AgentJobLog;
  readonly now: () => string;
  /** Whether this provider can take the work, and on which path. From `chooseExecutionPath`. */
  readonly pathFor: (provider: AgentProviderId) => ExecutionChoice;
}

export interface ReviewInput {
  /** The exact bytes both reviewers read. */
  readonly body: string;
  /** What those bytes are, in the owner's words. */
  readonly describes: string;
  readonly question: string;
  readonly scope: string;
  readonly allowed: AllowedReach;
  readonly requestedOutput: string;
  readonly providers: { readonly a: AgentProviderId; readonly b: AgentProviderId };
  readonly idempotencyKey: string;
}

/** Freeze an object and everything under it, so an executor cannot mutate its own brief. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  return Object.freeze(value);
}

/**
 * Build one seat's assignment. Both are built from the same frozen body and the
 * same question, and neither builder is ever given a conclusion.
 */
function assignmentFor(
  reviewId: string,
  slot: ReviewerSlot,
  provider: AgentProviderId,
  snapshot: FrozenContext,
  input: ReviewInput,
  wallMs: number,
): ReviewerAssignment {
  return deepFreeze({
    reviewId,
    slot,
    provider,
    question: input.question,
    snapshot,
    body: input.body,
    bounds: { wallMs, allowed: { files: [...input.allowed.files], systems: [...input.allowed.systems] } },
  });
}

/** Run one seat, recording the job whatever happens. Never sees the other seat. */
async function runOneSeat(
  deps: ReviewDeps,
  mode: "INDEPENDENT_REVIEW" | "ASK_BOTH",
  role: "REVIEWER_A" | "REVIEWER_B",
  assignment: ReviewerAssignment,
  snapshot: FrozenContext,
  input: ReviewInput,
  startedAt: string,
): Promise<{ readonly outcome: ReviewerRunOutcome; readonly job: DelegatedAgentJob }> {
  const words = PROVIDER_WORDS[assignment.provider];
  const job = openJob({
    mode,
    role,
    provider: assignment.provider,
    context: snapshot,
    scope: input.scope,
    authority: "READ_ONLY",
    allowed: input.allowed,
    requestedOutput: input.requestedOutput,
    startedAt,
    idempotencyKey: `${input.idempotencyKey}:${assignment.slot}`,
  });
  await persistJob(deps.log, job, startedAt);

  const choice = deps.pathFor(assignment.provider);
  if (choice.path === "REFUSE") {
    const at = deps.now();
    const refused = refuseJob(job, { code: "AGENT_PROVIDER_UNAVAILABLE", says: choice.says }, at);
    await persistJob(deps.log, refused, at);
    return {
      outcome: { slot: assignment.slot, provider: assignment.provider, state: "REFUSED", conclusion: null, why: choice.says, jobId: job.jobId },
      job: refused,
    };
  }

  try {
    const conclusion = await deps.execute(assignment);
    const at = conclusion.completedAt;
    const done = completeJob(
      job,
      { says: conclusion.verdict, detail: conclusion.points.map((p) => `${p.topic}: ${p.stance} — ${p.says}`).join("\n"), reviewedHash: conclusion.reviewedHash },
      at,
    );
    await persistJob(deps.log, done, at);
    return { outcome: { slot: assignment.slot, provider: assignment.provider, state: "DONE", conclusion, why: null, jobId: job.jobId }, job: done };
  } catch (error) {
    const at = deps.now();
    const why = `${words.name} started this review and did not finish it (${(error as Error)?.name ?? "error"}).`;
    const failed = failJob(job, why, at);
    await persistJob(deps.log, failed, at);
    return { outcome: { slot: assignment.slot, provider: assignment.provider, state: "FAILED", conclusion: null, why, jobId: job.jobId }, job: failed };
  }
}

/**
 * INDEPENDENT_REVIEW.
 *
 * The order of the six statements below is the guarantee, and it is the reason
 * this is one function rather than a class with methods someone could call out
 * of order:
 *
 *   1. freeze the snapshot ONCE, so both reviewers get the same bytes;
 *   2. build BOTH assignments and deep-freeze them, before either runs;
 *   3. start both, and wait for both, in one `Promise.all`;
 *   4. seal each conclusion as it arrives;
 *   5. open the pair — which is impossible unless both are sealed;
 *   6. compare, and prove the isolation from the run's own stamps.
 *
 * Nothing between (2) and (5) can reach a conclusion: the executor is handed a
 * frozen assignment with no peer field, and a sealed conclusion has no single
 * opener.
 */
export async function runIndependentReview(deps: ReviewDeps, input: ReviewInput): Promise<IndependentReviewOutcome> {
  const startedAt = deps.now();
  const snapshot = freezeContext(input.body, input.describes, startedAt);
  const reviewId = `ir-${snapshot.hash.slice(-16)}-${input.idempotencyKey}`;

  // (2) Both briefs exist, complete and frozen, before a single provider is called.
  const assignmentA = assignmentFor(reviewId, "A", input.providers.a, snapshot, input, 15 * 60_000);
  const assignmentB = assignmentFor(reviewId, "B", input.providers.b, snapshot, input, 15 * 60_000);
  const assignmentsFrozenAt = startedAt;

  // (3) Both run; neither awaits the other.
  const [ra, rb] = await Promise.all([
    runOneSeat(deps, "INDEPENDENT_REVIEW", "REVIEWER_A", assignmentA, snapshot, input, startedAt),
    runOneSeat(deps, "INDEPENDENT_REVIEW", "REVIEWER_B", assignmentB, snapshot, input, startedAt),
  ]);

  let comparison: ReviewComparison | null = null;
  let isolation: IsolationProof | null = null;
  let says: string;

  if (ra.outcome.conclusion !== null && rb.outcome.conclusion !== null) {
    // (4) and (5): sealed separately, opened only as a pair.
    const pair = openBoth(seal(ra.outcome.conclusion), seal(rb.outcome.conclusion));
    if (pair.ok) {
      const comparedAt = deps.now();
      comparison = compareConclusions(pair.a, pair.b, comparedAt);
      isolation = proveIsolation({ assignmentA, assignmentB, a: pair.a, b: pair.b, assignmentsFrozenAt, comparedAt });
      says = isolation.holds ? comparison.says : isolation.says;
      const comparisonJob = openJob({
        mode: "INDEPENDENT_REVIEW",
        role: "COMPARISON",
        provider: null,
        context: snapshot,
        scope: input.scope,
        authority: "READ_ONLY",
        allowed: { files: [], systems: [] },
        requestedOutput: "The points both reviewers agreed on, and the points they did not.",
        startedAt: comparedAt,
        idempotencyKey: `${input.idempotencyKey}:comparison`,
      });
      await persistJob(
        deps.log,
        completeJob(comparisonJob, { says, detail: JSON.stringify({ comparison, isolation }), reviewedHash: snapshot.hash }, comparedAt),
        comparedAt,
      );
    } else {
      says = pair.why;
    }
  } else {
    const missing = [ra.outcome, rb.outcome].filter((o) => o.conclusion === null);
    says =
      `Only one side of this review came back, so nothing was compared. ` +
      missing.map((o) => `${PROVIDER_WORDS[o.provider].name}: ${o.why ?? "no reason recorded"}`).join(" ");
  }

  return {
    mode: "INDEPENDENT_REVIEW",
    preservesIndependence: true,
    reviewId,
    question: input.question,
    snapshot,
    a: ra.outcome,
    b: rb.outcome,
    comparison,
    isolation,
    startedAt,
    says,
  };
}

/**
 * ASK_BOTH.
 *
 * Two answers, side by side. It shares the executor and the job log with the
 * independent path, and shares nothing else: no sealing, no isolation proof,
 * and `preservesIndependence: false` on the record, because this mode makes no
 * claim about how either answer was reached. §4 allows it to *"collect two
 * perspectives for comparison"* and that is all it does.
 */
export async function runAskBoth(deps: ReviewDeps, input: ReviewInput): Promise<AskBothOutcome> {
  const startedAt = deps.now();
  const snapshot = freezeContext(input.body, input.describes, startedAt);
  const askId = `ab-${snapshot.hash.slice(-16)}-${input.idempotencyKey}`;
  const assignmentA = assignmentFor(askId, "A", input.providers.a, snapshot, input, 15 * 60_000);
  const assignmentB = assignmentFor(askId, "B", input.providers.b, snapshot, input, 15 * 60_000);

  const [ra, rb] = await Promise.all([
    runOneSeat(deps, "ASK_BOTH", "REVIEWER_A", assignmentA, snapshot, input, startedAt),
    runOneSeat(deps, "ASK_BOTH", "REVIEWER_B", assignmentB, snapshot, input, startedAt),
  ]);

  const ca = ra.outcome.conclusion;
  const cb = rb.outcome.conclusion;
  const both = ca !== null && cb !== null;
  const comparison = ca !== null && cb !== null ? compareConclusions(ca, cb, deps.now()) : null;
  return {
    mode: "ASK_BOTH",
    preservesIndependence: false,
    askId,
    question: input.question,
    snapshot,
    a: ra.outcome,
    b: rb.outcome,
    comparison,
    startedAt,
    says: both
      ? `Two answers, side by side. This mode does not prove they were reached separately — for that, run an independent review.`
      : "Only one side answered, so there is nothing to compare.",
  };
}
