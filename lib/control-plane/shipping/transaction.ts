/**
 * **ONE LOGICAL CHANGE IS ONE SHIPPING TRANSACTION, AND IT HAS A BUDGET.**
 * (FCP-9A / FCP-9B / FCP-9E, 2026-09-07.)
 *
 * ## The measurement this is written against
 *
 * The MapTiler quota-isolation change was ONE logical engineering change. The
 * hosted path spent five workflow runs on it:
 *
 * ```
 *   #804  superseded / cancelled          a head that was replaced mid-flight
 *   #805  FULL, green                     on an earlier head
 *   #806  FULL, green                     on be6e41ff, after a late review edit
 *   #807  FULL, green                     on the merge commit — same tree
 *   #808  cheap transition run            the observer's former bookkeeping commit
 * ```
 *
 * Roughly forty-five minutes in which the owner could not proceed while the
 * machinery verified one change four times. **The metric this module exists to
 * bound is not Actions cost. It is owner time stranded waiting.**
 *
 * Two of those four full runs were avoidable and each has its own repair:
 *
 * ```
 *   #805 -> #806   a late exploratory review pass changed a head that was
 *                  already green.  FCP-9A: REVIEW FREEZE.
 *   #806 -> #807   Git made a merge commit with a different SHA and the same
 *                  tree.           FCP-9C: tree-equivalence.ts.
 * ```
 *
 * ## What a transaction is, and what it is deliberately NOT
 *
 * It is a durable record of one logical change's passage from local work to
 * shipped tree, keyed by an identity that survives the head changing. It is
 * NOT a WorkItem (that is a piece of work with a completion contract), NOT a
 * gate (it forbids nothing on its own), and NOT a second shipping classifier —
 * `lib/ops/deploy-paths.ts` remains the one table that answers what a commit
 * costs to prove, and nothing here re-derives that.
 *
 * What it adds is the one fact no existing record holds: **how many times one
 * logical change was certified, and why more than once.**
 *
 * ## The budget, and the only way past it
 *
 * ```
 *   <= 1  full hosted certification before merge
 *      0  redundant full certifications after merge when the shipped tree is
 *         proven equivalent to the certified candidate
 *   any   exact-tree attestations and canonical post-deploy observations
 * ```
 *
 * A second full certification is not forbidden — a candidate whose base really
 * moved genuinely needs one. It must carry an `InvalidationReason` and the
 * evidence for it. A certification beyond the first with no reason is a
 * DEFECT, reported as one, and that is the whole enforcement: the record makes
 * the amplification countable, and what is countable stops being invisible.
 *
 * PURE. Every function here is a function of its arguments. Persistence is the
 * caller's (`scripts/shipping-txn.mts` writes through the control plane's
 * append-only log), exactly as `software-release-review.ts` keeps its shape
 * separate from its store.
 */

export const SHIPPING_TRANSACTION_FORMAT_VERSION = 1;

/* ══════════════════════════════════════════════════════════════ the stages ═ */

/**
 * Where a transaction is. Ordered, and a transaction only ever moves forward
 * through them — `advance` refuses a backward move rather than accepting one,
 * because a lifecycle that can be rewound is a lifecycle whose history is a
 * suggestion.
 */
export const TRANSACTION_STAGES = [
  /** Local work. The head may change freely; nothing hosted has been bought. */
  "DEVELOPING",
  /** Local gates green and adversarial review complete. The head is frozen. */
  "REVIEW_FROZEN",
  /** A full hosted certification is in flight against the frozen candidate. */
  "CERTIFYING",
  /** A full hosted certification is green. The candidate may merge. */
  "CERTIFIED",
  /** The certified tree is on the integration branch. */
  "MERGED",
  /** A canonical control-plane post-deploy receipt has been written. */
  "OBSERVED",
] as const;
export type TransactionStage = (typeof TRANSACTION_STAGES)[number];

const STAGE_INDEX = new Map(TRANSACTION_STAGES.map((s, i) => [s, i]));

/* ═══════════════════════════════════════════ what may reopen a frozen head ═ */

/**
 * The complete set of reasons a head may change after a full certification is
 * green. FCP-9A names three; the fourth is the author's own directive, which
 * outranks this file by RULING 272's precedence and is recorded rather than
 * refused.
 *
 * **Everything else is FOLLOW-UP.** "One more review", cleanup, prose
 * polishing, opportunistic hardening and newly discovered adjacent defects are
 * work for the next transaction. That is not a preference: each of them, on
 * 2026-09-07, cost a full hosted certification and a share of the owner's
 * forty-five minutes.
 */
export const INVALIDATION_REASONS = [
  /** The green run itself exposed a genuine failure or inconsistency. */
  "GREEN_RUN_EXPOSED_DEFECT",
  /** The base moved in a way that materially changes the candidate tree. */
  "BASE_MATERIALLY_CHANGED",
  /** A defect was shown to falsify the transaction's own frozen denominator. */
  "DEFECT_FALSIFIES_DENOMINATOR",
  /** The author directed the change. Recorded, never argued with. */
  "AUTHOR_DIRECTIVE",
] as const;
export type InvalidationReason = (typeof INVALIDATION_REASONS)[number];

/** Work that is NOT an invalidation reason, named so a report can say so. */
export const FOLLOW_UP_NOT_INVALIDATION: readonly string[] = [
  "another exploratory review pass on a green head",
  "cleanup, renaming or prose polishing",
  "opportunistic hardening outside the frozen denominator",
  "a newly discovered adjacent defect that does not falsify the denominator",
];

/* ═════════════════════════════════════════════════ the certification ledger ═ */

/** How much a hosted run cost to buy. */
export const CERTIFICATION_KINDS = [
  /** Install, browser, builds, the whole suite. The expensive one. */
  "FULL",
  /** FCP-9C: the shipped tree is the certified tree. No expensive tier. */
  "TREE_EQUIVALENCE_ATTESTATION",
  /** RULING 279: the cheap tier was red, so nothing expensive was bought. */
  "PREFLIGHT_REFUSED",
] as const;
export type CertificationKind = (typeof CERTIFICATION_KINDS)[number];

export const CERTIFICATION_OUTCOMES = ["GREEN", "RED", "CANCELLED", "IN_FLIGHT"] as const;
export type CertificationOutcome = (typeof CERTIFICATION_OUTCOMES)[number];

/** One hosted run, bound to the exact subject it proved. */
export interface CertificationRecord {
  readonly kind: CertificationKind;
  readonly outcome: CertificationOutcome;
  /** The workflow run id, so a reading can be checked against the platform. */
  readonly runId: string | null;
  /** The commit the run had as its subject. */
  readonly sha: string;
  /** That commit's tree — the thing actually under proof. */
  readonly tree: string | null;
  readonly startedAt: string;
  /** Null while IN_FLIGHT. */
  readonly endedAt: string | null;
  /** Billed runner minutes, when the platform reported them. */
  readonly runnerMinutes: number | null;
  /**
   * Why this run happened at all, when it is not the transaction's first FULL.
   * Null on the first FULL and on every cheap kind; a non-null value on a
   * later FULL is what keeps it out of the defect count.
   */
  readonly invalidation: InvalidationReason | null;
  /** One sentence of evidence for that reason. Never a bare code. */
  readonly invalidationEvidence: string | null;
}

/* ═════════════════════════════════════════════════════════ the transaction ═ */

export interface ShippingTransaction {
  readonly formatVersion: typeof SHIPPING_TRANSACTION_FORMAT_VERSION;
  /** Stable across every head change. `txn-<created day>-<slug>`. */
  readonly id: string;
  /** What this change is, in the owner's words. One line. */
  readonly headline: string;
  /**
   * The frozen denominator this transaction is answerable for — the row ids
   * from the brief. RULING 273: the denominator is finite and stated at the
   * start, and discovery does not enlarge it.
   */
  readonly denominator: readonly string[];
  readonly stage: TransactionStage;
  /** The tree under proof right now, and the base it is integrated against. */
  readonly candidateTree: string | null;
  readonly candidateSha: string | null;
  readonly baseTree: string | null;
  readonly baseSha: string | null;
  /** The local gate result, by name, before anything hosted was bought. */
  readonly localGate: { readonly green: boolean; readonly named: readonly string[] } | null;
  /** When the head was frozen, and by what evidence. Null until REVIEW_FROZEN. */
  readonly reviewFreeze: {
    readonly frozenAt: string;
    readonly frozenSha: string;
    readonly evidence: string;
  } | null;
  readonly certifications: readonly CertificationRecord[];
  /** The tree that actually landed on the integration branch. */
  readonly mergedTree: string | null;
  readonly mergedSha: string | null;
  /** Durable release-observation receipts. These are data-plane rows, never Git commits. */
  readonly releaseObservations: readonly {
    readonly producer: string;
    readonly subjectSha: string;
    readonly receiptId: string;
  }[];
  readonly openedAt: string;
  readonly closedAt: string | null;
}

export function openTransaction(input: {
  readonly id: string;
  readonly headline: string;
  readonly denominator: readonly string[];
  readonly now: string;
}): ShippingTransaction {
  return {
    formatVersion: SHIPPING_TRANSACTION_FORMAT_VERSION,
    id: input.id,
    headline: input.headline,
    denominator: input.denominator,
    stage: "DEVELOPING",
    candidateTree: null,
    candidateSha: null,
    baseTree: null,
    baseSha: null,
    localGate: null,
    reviewFreeze: null,
    certifications: [],
    mergedTree: null,
    mergedSha: null,
    releaseObservations: [],
    openedAt: input.now,
    closedAt: null,
  };
}

/** A refusal carries the reason; the caller states it rather than swallowing it. */
export interface StageRefusal {
  readonly refused: true;
  readonly reason: string;
}

export function isRefusal(x: ShippingTransaction | StageRefusal): x is StageRefusal {
  return (x as StageRefusal).refused === true;
}

/**
 * **THE FREEZE.** (FCP-9A.)
 *
 * A candidate may only be frozen when the local work is actually finished, and
 * "finished" is four named facts rather than a feeling. Freezing on an unmet
 * precondition is refused BY NAME — a freeze that could be taken on an
 * unproven candidate would be a ceremony, and the run it is meant to prevent
 * (#805, a full green thrown away by a later edit) would happen anyway.
 */
export function freezeReview(
  txn: ShippingTransaction,
  input: {
    readonly sha: string;
    readonly tree: string;
    readonly baseSha: string;
    readonly baseTree: string;
    readonly localGate: { readonly green: boolean; readonly named: readonly string[] };
    readonly denominatorComplete: boolean;
    readonly adversarialReviewComplete: boolean;
    readonly evidence: string;
    readonly now: string;
  },
): ShippingTransaction | StageRefusal {
  if (txn.stage !== "DEVELOPING") {
    return {
      refused: true,
      reason:
        `the transaction is ${txn.stage}, and a freeze is the move OUT of DEVELOPING; re-freezing ` +
        "a certified candidate is what an invalidation reason is for",
    };
  }
  if (!input.denominatorComplete) {
    return {
      refused: true,
      reason:
        "the frozen denominator is not complete, so freezing would promise a certification of work " +
        "that is not there — every row must be implemented, blocked by name, or explicitly FOLLOW-UP",
    };
  }
  if (!input.localGate.green) {
    return {
      refused: true,
      reason:
        `the local gate is not green (${input.localGate.named.length} check(s) named); buying a ` +
        "hosted certification for a head that fails locally is the spend RULING 279 exists to stop",
    };
  }
  if (input.localGate.named.length === 0) {
    return {
      refused: true,
      reason:
        "the local gate reported green and named no checks; a gate that names nothing has not been " +
        "shown to have run (RULING 267)",
    };
  }
  if (!input.adversarialReviewComplete) {
    return {
      refused: true,
      reason:
        "adversarial/integration review is not complete, and a review that happens after the green " +
        "is the exact pass that turned run #805 into run #806",
    };
  }
  return {
    ...txn,
    stage: "REVIEW_FROZEN",
    candidateSha: input.sha,
    candidateTree: input.tree,
    baseSha: input.baseSha,
    baseTree: input.baseTree,
    localGate: input.localGate,
    reviewFreeze: { frozenAt: input.now, frozenSha: input.sha, evidence: input.evidence },
  };
}

/**
 * Move the head after a freeze.
 *
 * Allowed only with an `InvalidationReason` and evidence. Everything else is
 * refused and named as FOLLOW-UP, which is the sentence a session needs to
 * read at the moment it is tempted to make "one small edit" to a green head.
 */
export function reopenFrozen(
  txn: ShippingTransaction,
  input: {
    readonly reason: InvalidationReason;
    readonly evidence: string;
  },
): ShippingTransaction | StageRefusal {
  if (txn.reviewFreeze === null) {
    return { refused: true, reason: "nothing is frozen, so nothing can be reopened" };
  }
  if (!(INVALIDATION_REASONS as readonly string[]).includes(input.reason)) {
    return {
      refused: true,
      reason:
        `${input.reason} is not one of the ${INVALIDATION_REASONS.length} reasons a frozen head may ` +
        `change; the following are FOLLOW-UP after green: ${FOLLOW_UP_NOT_INVALIDATION.join("; ")}`,
    };
  }
  if (input.evidence.trim().length === 0) {
    return {
      refused: true,
      reason: "an invalidation reason with no evidence is a code, and a code is not a reason",
    };
  }
  return { ...txn, stage: "DEVELOPING", reviewFreeze: null };
}

/**
 * Record a hosted run against the transaction.
 *
 * **This never refuses, and that is deliberate.** An earlier draft rejected a
 * second FULL certification bought without re-freezing — which is exactly the
 * 2026-09-07 defect, and rejecting it meant the ledger could not hold the
 * incident it exists to measure. A record of what happened must be able to
 * describe what went wrong; a ledger that only accepts well-formed history
 * reports a clean record of a system that misbehaved.
 *
 * The discipline lives where it can act: `freezeReview` refuses an unready
 * candidate before the spend, and `readAmplification` names the redundant
 * certification after it. Recording is observation, and observation is faithful.
 */
export function recordCertification(
  txn: ShippingTransaction,
  record: CertificationRecord,
): ShippingTransaction {
  const stage: TransactionStage =
    record.kind === "FULL" && record.outcome === "IN_FLIGHT" && stageAtLeast(txn.stage, "CERTIFYING") === false
      ? "CERTIFYING"
      : record.kind === "FULL" && record.outcome === "GREEN" && stageAtLeast(txn.stage, "CERTIFIED") === false
        ? "CERTIFIED"
        : txn.stage;
  return { ...txn, stage, certifications: [...txn.certifications, record] };
}

export function stageAtLeast(stage: TransactionStage, at: TransactionStage): boolean {
  return (STAGE_INDEX.get(stage) ?? -1) >= (STAGE_INDEX.get(at) ?? Number.MAX_SAFE_INTEGER);
}

/** The tree landed. Recorded with its tree, because the tree is the subject. */
export function recordMerge(
  txn: ShippingTransaction,
  input: { readonly sha: string; readonly tree: string },
): ShippingTransaction | StageRefusal {
  if (!stageAtLeast(txn.stage, "CERTIFIED")) {
    return {
      refused: true,
      reason: `the transaction is ${txn.stage}; a tree merges after it is CERTIFIED, never before`,
    };
  }
  return { ...txn, stage: "MERGED", mergedSha: input.sha, mergedTree: input.tree };
}

export function recordReleaseObservation(
  txn: ShippingTransaction,
  input: {
    readonly producer: string;
    readonly subjectSha: string;
    readonly receiptId: string;
    readonly now: string;
  },
): ShippingTransaction | StageRefusal {
  if (!stageAtLeast(txn.stage, "MERGED") || txn.mergedSha === null) {
    return { refused: true, reason: "a release observation cannot precede the certified merge" };
  }
  if (input.subjectSha !== txn.mergedSha) {
    return {
      refused: true,
      reason: `release observation names ${input.subjectSha}, not merged subject ${txn.mergedSha}`,
    };
  }
  if (!/^[0-9a-f]{40}$/.test(input.subjectSha)) {
    return { refused: true, reason: "release observation subject is not an exact 40-character commit SHA" };
  }
  if (!input.producer.trim() || !input.receiptId.trim()) {
    return { refused: true, reason: "release observation requires a producer and durable receipt id" };
  }
  if (txn.releaseObservations.some((row) => row.receiptId === input.receiptId)) {
    return { refused: true, reason: `release observation receipt ${input.receiptId} is already recorded` };
  }
  return {
    ...txn,
    stage: "OBSERVED",
    closedAt: input.now,
    releaseObservations: [...txn.releaseObservations, {
      producer: input.producer,
      subjectSha: input.subjectSha,
      receiptId: input.receiptId,
    }],
  };
}
