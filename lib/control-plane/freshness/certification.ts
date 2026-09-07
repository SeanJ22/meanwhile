/**
 * **CONSUMER CERTIFICATION IS DEPENDENCY-AWARE, AND LOCAL.**
 * (FCP-3, 2026-09-07.)
 *
 * ## The two defects this closes
 *
 * **One.** The daily refresh's gate is `pnpm test` — the whole suite — and a
 * changed FEC filing is therefore certified by, among several hundred other
 * things, a meeting-agenda selector, an Arizona campaign-money witness and a
 * browser. Every one of those can go red for reasons that have nothing to do
 * with the bytes under proof, and when one does, the changed holding is held
 * back. The suite is right to refuse; what is wrong is that the refusal is
 * attributed to whatever happened to be changed that night.
 *
 * **Two.** A red proof and a proof that could not run are the same colour.
 * `PROOF_INFRASTRUCTURE_BLOCKED` is a different state from `CONSUMER_DEFECT`
 * because they are different facts with opposite remedies: the first retries
 * itself, the second must not. Collapsing them is how a Playwright timeout
 * becomes a permanent claim that a government's filing is wrong.
 *
 * ## Dependency-awareness, stated as a table
 *
 * ```
 *   meetings      -> meeting Reader / read-model proof
 *   fec           -> federal-money proof
 *   state-votes   -> state-vote proof
 *   nj-filing     -> NJ filing / ballot proof
 * ```
 *
 * An executor runs when it declares a dependency on the changed holding's
 * record class, and not otherwise. **An unrelated Arizona governor or
 * campaign-money witness cannot veto an unrelated holding** — that is FCP-3's
 * own sentence, and `selectExecutors` is where it becomes true.
 *
 * ## The direction of every unknown
 *
 * An executor whose dependencies cannot be resolved RUNS. A record class no
 * executor claims is `CERTIFICATION_PENDING` with the reason named, never
 * `CERTIFIED` by default. Certifying a holding because nothing objected is
 * the shape of a capture script reporting `0 offenders` about a panel it never
 * opened (RULING 159), and the whole point of the dependency table is to spend
 * less, not to prove less.
 *
 * ## Where it runs, and what it may not need
 *
 * On the standing runner, against the exact local production build (RULING
 * 266: verification happens on the local production build) or a smaller
 * deterministic consumer contract where that is sufficient. Retries of
 * `PROOF_INFRASTRUCTURE_BLOCKED` happen locally under a bounded backoff and
 * spend no hosted Actions minutes — `resource-policy.ts` is what makes that a
 * refusal rather than an intention.
 *
 * PURE.
 */

import type { CandidateHolding } from "./acquisition.ts";

export const CERTIFICATION_FORMAT_VERSION = 1;

/** The four states FCP-3 requires. */
export const CERTIFICATION_STATES = [
  /** Not yet proved. The last-known-good continues to serve. */
  "CERTIFICATION_PENDING",
  /** Every dependent proof passed against these exact bytes. */
  "CERTIFIED",
  /** A dependent proof found the CONTENT wrong. This does not self-retry. */
  "CONSUMER_DEFECT",
  /** A proof could not RUN. This self-retries, locally, under backoff. */
  "PROOF_INFRASTRUCTURE_BLOCKED",
] as const;
export type CertificationState = (typeof CERTIFICATION_STATES)[number];

/** What one proof executor reported. */
export const EXECUTOR_RESULTS = ["PASS", "FAIL", "BLOCKED", "NOT_RUN"] as const;
export type ExecutorResult = (typeof EXECUTOR_RESULTS)[number];

/**
 * One proof, and the record classes it actually depends on.
 *
 * `dependsOn` is the whole design. An executor that named no classes would run
 * for everything, which is the current whole-suite behaviour wearing a table's
 * name; an executor that named a class it does not read would veto a holding
 * it cannot see.
 */
export interface ProofExecutor {
  readonly id: string;
  /** Record classes whose change makes this proof relevant. Never empty. */
  readonly dependsOn: readonly string[];
  /** One line: what a reader gets from this proof passing. */
  readonly proves: string;
  /**
   * Scarce resources this executor spends. Declared so `resource-policy.ts`
   * can refuse it under a policy that forbids one of them — the MapTiler
   * coordination FCP-3 asks for is exactly this field being honest.
   */
  readonly spends: readonly string[];
}

/**
 * The dependency table. Derived from what each proof reads, never from what
 * would be convenient. Adding an executor is adding a row; widening a row is a
 * claim that the proof reads that class, and `tests/freshness-control-plane.test.ts`
 * asserts every declared class is one some source actually produces.
 */
export const PROOF_EXECUTORS: readonly ProofExecutor[] = [
  {
    id: "meeting-read-model",
    dependsOn: ["meetings"],
    proves: "a reader asking what meeting is next gets the meeting the clerk published",
    spends: ["local-compute"],
  },
  {
    id: "federal-money",
    dependsOn: ["fec"],
    proves: "both sides of the federal money render at equal depth (RULING 255)",
    spends: ["local-compute"],
  },
  {
    id: "state-vote",
    dependsOn: ["state-votes"],
    proves: "a recorded vote reaches the reader attached to the member who cast it",
    spends: ["local-compute"],
  },
  {
    id: "nj-filing-ballot",
    dependsOn: ["nj-filing"],
    proves: "the NJ ballot renders every filed candidate and states N equal to rendered rows",
    spends: ["local-compute"],
  },
  {
    id: "reader-last-mile",
    dependsOn: ["meetings", "fec", "state-votes", "nj-filing"],
    proves:
      "the Reader Last-Mile closure receipt still binds every holding by exact byte — the one " +
      "cross-holding proof, and it is cross-holding because the receipt genuinely is",
    spends: ["local-compute", "local-production-build"],
  },
] as const;

/**
 * The executors a changed holding must satisfy.
 *
 * The empty case is NOT an empty list quietly meaning "nothing to do". A record
 * class no executor claims comes back with `unclaimed` set, and `judge` turns
 * that into CERTIFICATION_PENDING with the reason. A holding nobody knows how
 * to prove is a gap in the proof table, and a gap that certifies itself is the
 * worst kind.
 */
export function selectExecutors(
  holding: CandidateHolding,
  executors: readonly ProofExecutor[] = PROOF_EXECUTORS,
): { readonly selected: readonly ProofExecutor[]; readonly unclaimed: boolean } {
  const selected = executors.filter((e) => e.dependsOn.includes(holding.recordClass));
  return { selected, unclaimed: selected.length === 0 };
}

/** What one executor did to one holding. */
export interface ExecutorReading {
  readonly executorId: string;
  readonly result: ExecutorResult;
  /** Quotable. On BLOCKED, what was unavailable — never why the data is wrong. */
  readonly detail: string;
}

export interface CertificationVerdict {
  readonly formatVersion: typeof CERTIFICATION_FORMAT_VERSION;
  readonly holding: CandidateHolding;
  readonly state: CertificationState;
  /** Executors that were selected, so a report can say what was NOT run. */
  readonly ran: readonly string[];
  /** Every executor the table holds that was deliberately not run, by name. */
  readonly skipped: readonly string[];
  readonly readings: readonly ExecutorReading[];
  readonly reason: string;
}

/**
 * Judge one holding.
 *
 * The precedence is the argument, and it is deliberately NOT "any failure
 * wins":
 *
 * ```
 *   1  a FAIL is a CONSUMER_DEFECT              the content is wrong; do not retry
 *   2  a BLOCKED is PROOF_INFRASTRUCTURE_BLOCKED  we could not look; retry locally
 *   3  a NOT_RUN is CERTIFICATION_PENDING       nothing has been proved yet
 *   4  all PASS is CERTIFIED
 * ```
 *
 * A real defect outranks an infrastructure block because a holding whose
 * content is known wrong must not be re-attempted into a green: the retry
 * would find the same wrong bytes and the backoff would only delay the
 * finding. That ordering is the one thing here that a later edit is most
 * likely to get backwards, so it is stated.
 */
export function judgeCertification(input: {
  readonly holding: CandidateHolding;
  readonly readings: readonly ExecutorReading[];
  readonly executors?: readonly ProofExecutor[];
}): CertificationVerdict {
  const table = input.executors ?? PROOF_EXECUTORS;
  const { selected, unclaimed } = selectExecutors(input.holding, table);
  const ran = selected.map((e) => e.id);
  const skipped = table.filter((e) => !ran.includes(e.id)).map((e) => e.id);

  const base = {
    formatVersion: CERTIFICATION_FORMAT_VERSION as typeof CERTIFICATION_FORMAT_VERSION,
    holding: input.holding,
    ran,
    skipped,
    readings: input.readings,
  };

  if (unclaimed) {
    return {
      ...base,
      state: "CERTIFICATION_PENDING",
      reason:
        `no proof executor declares a dependency on record class ${JSON.stringify(input.holding.recordClass)}, ` +
        "so nothing here can certify it; a holding nobody knows how to prove stays pending rather " +
        "than certifying itself on an empty list",
    };
  }

  const missing = ran.filter((id) => !input.readings.some((r) => r.executorId === id));
  if (missing.length > 0) {
    return {
      ...base,
      state: "CERTIFICATION_PENDING",
      reason: `${missing.length} selected executor(s) reported nothing: ${missing.join(", ")}`,
    };
  }

  const relevant = input.readings.filter((r) => ran.includes(r.executorId));
  const failed = relevant.filter((r) => r.result === "FAIL");
  if (failed.length > 0) {
    return {
      ...base,
      state: "CONSUMER_DEFECT",
      reason:
        `${failed.map((r) => `${r.executorId}: ${r.detail}`).join("; ")} — a proof that DEPENDS on ` +
        "this holding found its content wrong, so this does not retry itself",
    };
  }
  const blocked = relevant.filter((r) => r.result === "BLOCKED");
  if (blocked.length > 0) {
    return {
      ...base,
      state: "PROOF_INFRASTRUCTURE_BLOCKED",
      reason:
        `${blocked.map((r) => `${r.executorId}: ${r.detail}`).join("; ")} — the proof could not RUN, ` +
        "which says nothing about the bytes; the acquisition stands and this retries locally under " +
        "a bounded backoff, spending no hosted minutes",
    };
  }
  const notRun = relevant.filter((r) => r.result === "NOT_RUN");
  if (notRun.length > 0) {
    return {
      ...base,
      state: "CERTIFICATION_PENDING",
      reason: `${notRun.map((r) => r.executorId).join(", ")} has not been attempted`,
    };
  }
  return {
    ...base,
    state: "CERTIFIED",
    reason:
      `${ran.length} dependent proof(s) passed against content hash ` +
      `${input.holding.contentHash.slice(0, 12)}: ${ran.join(", ")}. ` +
      `${skipped.length} executor(s) were not run because they do not read this record class`,
  };
}

/**
 * **THE CROSS-HOLDING COUPLING SET.**
 *
 * FCP-4 says one uncertified source does not block unrelated certified sources
 * "unless an existing cross-holding invariant proves they are coupled". This is
 * that set, and the distinction between its two MODES is where the reasoning
 * actually lives.
 *
 * ```
 *   REGENERATE_OVER_FINAL_SET   the invariant is a GENERATED artifact over
 *                               whatever ships. It does not couple the
 *                               holdings; it couples the artifact to the final
 *                               coalesced tree, and is satisfied by
 *                               regenerating once at the end.
 *   SHIP_TOGETHER               the holdings are genuinely inseparable and one
 *                               being uncertified holds the others.
 * ```
 *
 * The Reader Last-Mile closure receipt looks like the second and is the first.
 * It binds every holding by exact byte, so a receipt renewed against a tree
 * nobody built does not bind — but `scripts/refresh-reader-renewal.mts` already
 * re-proves only the invalidated rows and inherits the rest from the committed
 * closure. A held-back holding stays at HEAD, and HEAD's row is exactly what the
 * receipt already binds. So the requirement is *regenerate once over the final
 * set*, which is FCP-4's own words, and not *hold everything*.
 *
 * **There is deliberately no SHIP_TOGETHER member today.** Adding one is adding
 * a claim that two record classes cannot ship apart, and every such member
 * converts an independent failure domain back into a shared one — the
 * architecture this whole repair exists to undo. It is available because
 * refusing to model a real coupling would be worse; it is empty because no
 * measured coupling is that shape.
 */
export const COUPLING_MODES = ["REGENERATE_OVER_FINAL_SET", "SHIP_TOGETHER"] as const;
export type CouplingMode = (typeof COUPLING_MODES)[number];

export const CROSS_HOLDING_COUPLINGS: readonly {
  readonly id: string;
  readonly mode: CouplingMode;
  readonly classes: readonly string[];
  readonly why: string;
}[] = [
  {
    id: "reader-last-mile-closure",
    mode: "REGENERATE_OVER_FINAL_SET",
    classes: ["meetings", "fec", "state-votes", "nj-filing"],
    why:
      "the closure receipt binds every holding by exact byte (RL-2). The renewal is dependency-aware " +
      "and inherits unaffected rows from the committed closure, so a held-back holding's row is " +
      "already bound at HEAD; what the invariant requires is ONE regeneration over the tree that " +
      "actually ships, not that every holding ship together",
  },
] as const;
