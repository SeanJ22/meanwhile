/**
 * CLOSEOUT RECONCILIATION — the declared plan against what actually ran.
 *
 * ## The defect this closes
 *
 * `classifyOrchestration` reads a plan and asks whether it is SHAPED like a
 * team. That question is answerable from the plan alone, and that is exactly its
 * limit: **a plan is only ever compared against itself.** A session can declare
 * ten workstreams, run thirteen, and pass, because nothing on either side of the
 * check ever looks outside the file.
 *
 * On 2026-08-28 that happened, and the numbers are worth writing down because all
 * three of them are different and only one of them is the workstream count.
 * `data/workstate/orchestration/2026-08-28-finish-aug28.json` DECLARES TEN
 * workstreams. TWELVE `ws/*` refs existed. The session's final report said
 * TWELVE — which was the BRANCH COUNT, the exact substitution RULING 190
 * forbids. And the true logical count was THIRTEEN: nine refs mapped 1:1 onto
 * declared workstreams, a tenth workstream (`governance-orchestration`) held the
 * shared load-bearing files and ran on the INTEGRATION BRANCH with no `ws/*` ref
 * of its own, and three refs — `ws/mtg13union`, `ws/methodint`, `ws/incum` —
 * carried real, authorized, shipped work the canonical plan was never told about.
 *
 * Ten declared, twelve refs, thirteen workstreams. Every instrument in the
 * repository agreed the session had been run as a team, and every instrument was
 * reading a denominator the session had quietly outgrown.
 *
 * ## The repair is declared, not quiet
 *
 * A gap found at closeout has exactly two truthful resolutions, and editing the
 * plan to look as though it always said thirteen is neither of them. A workstream
 * reconstructed from evidence is backfilled with `declaredPostHoc` — the date of
 * the backfill and the evidence it rests on — and reconciliation then treats it
 * as DECLARED while counting it SEPARATELY, because the record being repaired and
 * the discipline having held are not the same claim. A gap that evidence cannot
 * close is recorded as a `postHocDiscrepancy` and carried unresolved. **A mapping
 * is never invented to make two counts agree.**
 *
 * ## THE PROHIBITION THAT COMES FIRST
 *
 * **AN ARTIFACT COUNT IS NEVER A WORKSTREAM COUNT.** RULING 190 forbids the
 * substitution in both directions, and reconciliation is precisely where the
 * temptation lives, because reconciliation is the one place both numbers are in
 * scope. A logical workstream may run on zero execution artifacts (the
 * integration owner's own stream usually does), on one, or on many; two branches
 * held by one workstream are ONE workstream, and a session that split its work
 * across six refs did not thereby do six workstreams of work.
 *
 * So this module never derives either number from the other. It reports
 * `declaredWorkstreams` and `observedArtifacts` as two separate counts, and it
 * requires the mapping between them to be DECLARED — `SessionWorkstream.executionArtifacts`
 * — rather than inferred from a name that happens to look like an id. An observed
 * ref that no workstream claims is not promoted to a workstream and is not
 * silently dropped either: it is named as an **EXECUTION ARTIFACT REQUIRING
 * DISPOSITION**, which is the honest description of a branch nobody has accounted
 * for, and it fails the reconciliation until someone accounts for it.
 *
 * ## Why this is a sibling module rather than more of `orchestration.ts`
 *
 * Different input domain, and that is the whole of it. `classifyOrchestration`
 * is a pure function of the plan; it can be run on a file, in a test, in CI, with
 * nothing else present. Reconciliation needs OBSERVED state from outside the
 * repository's own records — refs, worktrees, agent ids — and folding that into
 * the classifier would give a plan-only check a dependency on the observed world,
 * which is how a guard acquires an excuse for not running.
 *
 * ## What is still not observable, said plainly
 *
 * This module cannot tell that an observed branch contains WORK. It reconciles
 * NAMES against NAMES. A session that creates a ref and never commits to it is
 * reported as an unaccounted artifact, which is the correct thing to say about
 * it — the disposition it requires may simply be "created and abandoned". What
 * the module refuses to do is decide that for the session.
 */

import {
  OPEN_ORCHESTRATION_DISPOSITIONS,
  type ExecutionArtifact,
  type OrchestrationFinding,
  type OrchestrationPlan,
  validateExecutionArtifacts,
} from "./orchestration.ts";

/**
 * The dispositions that CLOSE a workstream.
 *
 * `BLOCKED` belongs here and its presence is not a softening: a named wall is a
 * terminal answer under the transparency mandate, and a workstream that ends
 * blocked has said what stopped it. `BLOCKED` with no wall named is not in this
 * set by accident — it is caught as its own finding, because an unnamed wall is
 * an absence asserted about the work.
 */
export const TERMINAL_DISPOSITIONS = ["READY_FOR_INTEGRATION", "INTEGRATED", "BLOCKED"] as const;

/**
 * What the session is observed to have actually done.
 *
 * Deliberately two independent channels, because they answer different
 * questions and one cannot stand in for the other:
 *
 * - `artifacts` is what the environment shows — refs, worktrees, agent ids. It
 *   is discovered, not declared, and it is the channel that catches work the
 *   plan never heard of.
 * - `executedWorkstreamIds` is what the session says it ran, in canonical ids.
 *   It is the channel that catches an id running without a declaration, which
 *   an artifact sweep cannot see when the work shared someone else's branch.
 */
export interface ObservedExecution {
  /** Refs actually present: branches, worktrees, agent ids, processes. */
  artifacts: ExecutionArtifact[];
  /** Canonical workstream ids the session actually executed, if it recorded them. */
  executedWorkstreamIds?: string[];
  /**
   * Refs belonging to the integration owner rather than to any one workstream.
   *
   * The integration branch is not a workstream and must never be counted as
   * one; naming it here is what keeps it from landing in `unlinkedArtifacts`.
   */
  integrationArtifacts?: ExecutionArtifact[];
}

export const CLOSEOUT_STATUSES = [
  /** Every executed thing is declared, every declared thing has an end. */
  "RECONCILED",
  /** At least one of those two is false, named item by item. */
  "UNRECONCILED",
] as const;
export type CloseoutStatus = (typeof CLOSEOUT_STATUSES)[number];

/** One workstream and the refs it claims. Many-to-one, and never counted as many. */
export interface WorkstreamArtifactLink {
  workstream: string;
  /** `kind:ref`, as declared. Zero is legitimate; more than one is still ONE workstream. */
  artifacts: string[];
}

export interface CloseoutReconciliation {
  status: CloseoutStatus;
  reason: string;
  /** Every problem, not the first one. */
  findings: OrchestrationFinding[];
  /**
   * Reported, never fatal — the things a reader of the report must be told even
   * when nothing failed. A backfill that reconciles is still a backfill.
   */
  notes: string[];
  /** The EXPLICIT mapping. Never inferred from a ref that resembles an id. */
  links: WorkstreamArtifactLink[];
  /** Observed `kind:ref`s no workstream and no integration owner claims. */
  unlinkedArtifacts: string[];
  counts: {
    /** Logical workstreams. NOT a function of the artifact count. */
    declaredWorkstreams: number;
    declaredExecutable: number;
    addedDuringSession: number;
    /**
     * Workstreams backfilled after they executed.
     *
     * Reported on its own line and never folded into `addedDuringSession`. A
     * session that backfilled three workstreams at closeout did not keep the
     * plan append-safe during the session; the record is repaired and the
     * discipline still failed, and a count that ran the two together would
     * report the repair as though it were the practice.
     */
    declaredPostHoc: number;
    /** Gaps the session recorded as unresolvable rather than guessing a mapping. */
    unresolvedDiscrepancies: number;
    /** Terminal executable workstreams — an END was recorded, whatever it was. */
    terminal: number;
    /** Executable workstreams still open at closeout. Any is a failure. */
    nonTerminal: number;
    /** Execution artifacts observed. NOT a workstream count. */
    observedArtifacts: number;
    linkedArtifacts: number;
    unlinkedArtifacts: number;
  };
}

function key(a: ExecutionArtifact): string {
  return `${a.kind}:${a.ref}`;
}

/**
 * Reconcile a plan against the execution the environment can actually see.
 *
 * The four populations RULING 190 requires be held apart, and they are held
 * apart here because collapsing any two of them is the failure:
 *
 *   1. declared logical workstreams,
 *   2. observed execution artifacts,
 *   3. the integration owner's own work,
 *   4. workstreams appended mid-session (`addedDuringSession`).
 */
export function reconcileCloseout(
  plan: OrchestrationPlan,
  observed: ObservedExecution,
): CloseoutReconciliation {
  const findings: OrchestrationFinding[] = [];
  const declared = new Map(plan.workstreams.map((w) => [w.id, w]));

  // --- the declared mapping, workstream by workstream ------------------------
  const links: WorkstreamArtifactLink[] = [];
  /** `kind:ref` -> every workstream claiming it. More than one is ambiguous. */
  const claimedBy = new Map<string, string[]>();

  for (const w of plan.workstreams) {
    for (const bad of validateExecutionArtifacts(w)) {
      findings.push({ rule: "malformed-execution-artifact", detail: bad, workstreams: [w.id] });
    }
    const claims = (w.executionArtifacts ?? []).filter(
      (a): a is ExecutionArtifact => typeof a?.ref === "string" && typeof a?.kind === "string",
    );
    links.push({ workstream: w.id, artifacts: claims.map(key) });
    for (const a of claims) {
      const k = key(a);
      claimedBy.set(k, [...(claimedBy.get(k) ?? []), w.id]);
    }
  }

  // Two workstreams claiming one ref is not a many-to-one mapping, it is an
  // AMBIGUOUS one — the ref cannot be dispositioned without knowing whose it is.
  for (const [k, owners] of claimedBy) {
    if (owners.length > 1) {
      findings.push({
        rule: "ambiguous-artifact-claim",
        detail:
          `the execution artifact ${k} is claimed by ${owners.length} workstreams (${owners.join(", ")}). ` +
          "One artifact may serve one workstream; the mapping must be explicit, and this one is not.",
        workstreams: owners,
      });
    }
  }

  // --- executed but never declared -------------------------------------------
  // The direct form of the Aug 28 defect: work that ran under a name the
  // canonical plan does not carry. `appendWorkstream` is the mechanism that
  // makes this avoidable at the moment the work starts.
  for (const id of observed.executedWorkstreamIds ?? []) {
    if (declared.has(id)) continue;
    findings.push({
      rule: "undeclared-workstream",
      detail:
        `${id} was executed and is not in the plan. A workstream created after session start ` +
        "still gets a canonical id and is appended before or as it begins — a plan compared only " +
        "against itself cannot see the work it never heard of.",
      workstreams: [id],
    });
  }

  // --- declared, executable, and never brought to an end ---------------------
  let terminal = 0;
  let nonTerminal = 0;
  for (const w of plan.workstreams) {
    if (!w.executable) continue;
    if (w.disposition === "BLOCKED" && !w.blockedReason?.trim()) {
      nonTerminal += 1;
      findings.push({
        rule: "blocked-without-named-wall",
        detail:
          `${w.id} closed BLOCKED and does not name the wall. A blocked route is a real state; ` +
          "an unnamed one is an absence asserted about the work.",
        workstreams: [w.id],
      });
      continue;
    }
    if ((TERMINAL_DISPOSITIONS as readonly string[]).includes(w.disposition)) {
      terminal += 1;
      continue;
    }
    nonTerminal += 1;
    findings.push({
      rule: "non-terminal-at-closeout",
      detail:
        `${w.id} is executable and closed ${w.disposition}, which is not an end. ` +
        `A workstream ends READY_FOR_INTEGRATION, INTEGRATED, or BLOCKED with a named wall. ` +
        `${(OPEN_ORCHESTRATION_DISPOSITIONS as readonly string[]).join(", ")} all mean work is still owed, ` +
        "and owed work at closeout is not a status a session may award itself.",
      workstreams: [w.id],
    });
  }

  // --- observed refs nobody claims -------------------------------------------
  const integration = new Set((observed.integrationArtifacts ?? []).map(key));
  const unlinked: string[] = [];
  for (const a of observed.artifacts) {
    const k = key(a);
    if (integration.has(k)) continue;
    if (claimedBy.has(k)) continue;
    unlinked.push(k);
    findings.push({
      rule: "unlinked-execution-artifact",
      detail:
        `${k} — EXECUTION ARTIFACT REQUIRING DISPOSITION. No declared workstream claims it and it is ` +
        "not the integration owner's.",
      workstreams: [],
    });
  }

  const counts = {
    declaredWorkstreams: plan.workstreams.length,
    declaredExecutable: plan.workstreams.filter((w) => w.executable).length,
    addedDuringSession: plan.workstreams.filter((w) => w.addedDuringSession === true).length,
    declaredPostHoc: plan.workstreams.filter((w) => w.declaredPostHoc !== undefined).length,
    unresolvedDiscrepancies: (plan.postHocDiscrepancies ?? []).length,
    terminal,
    nonTerminal,
    observedArtifacts: observed.artifacts.length,
    linkedArtifacts: observed.artifacts.filter(
      (a) => claimedBy.has(key(a)) || integration.has(key(a)),
    ).length,
    unlinkedArtifacts: unlinked.length,
  };

  // --- what the reader is told even when nothing failed ----------------------
  const notes: string[] = [];
  if (unlinked.length > 0) {
    // Said ONCE, not once per ref. A paragraph repeated twelve times is a report
    // a reader skims, and the line that matters is the one that gets skimmed.
    notes.push(
      `${unlinked.length} execution artifact(s) require a disposition. NONE of them is counted as a ` +
        "workstream — an artifact count is not a workstream count. For each: either a workstream " +
        "claims it in `executionArtifacts` (backfilled with `declaredPostHoc` if it ran undeclared), " +
        "or the session records what it was and why it carries no work.",
    );
  }
  if (counts.declaredPostHoc > 0) {
    notes.push(
      `${counts.declaredPostHoc} workstream(s) declared post hoc — the plan was not kept append-safe ` +
        "during the session. The record is now truthful; the discipline still failed, and these are " +
        "counted apart from the mid-session appends for exactly that reason.",
    );
  }
  if (counts.unresolvedDiscrepancies > 0) {
    notes.push(
      `${counts.unresolvedDiscrepancies} declared-versus-executed discrepancy(ies) the session recorded ` +
        "as unresolvable rather than guessing a mapping. A guessed mapping would be a fabricated fact " +
        "about the session.",
    );
  }
  // The substitution, refused in the report itself rather than only in the doc
  // block — this is the line the Aug 28 session needed and did not have.
  if (counts.observedArtifacts > 0 && counts.observedArtifacts !== counts.declaredWorkstreams) {
    notes.push(
      `${counts.declaredWorkstreams} logical workstream(s) ran on ${counts.observedArtifacts} execution ` +
        "artifact(s). These are DIFFERENT NUMBERS and neither is the other: a workstream may run on " +
        "zero artifacts, one, or many, and reporting the artifact count as the workstream count is the " +
        "substitution RULING 190 forbids.",
    );
  }

  if (findings.length > 0) {
    return {
      status: "UNRECONCILED",
      reason:
        `${findings.length} finding(s): the declared plan and the observed execution do not agree. ` +
        `${counts.declaredWorkstreams} declared workstream(s) and ${counts.observedArtifacts} observed ` +
        "artifact(s) are separate counts and neither is evidence for the other.",
      findings,
      notes,
      links,
      unlinkedArtifacts: unlinked,
      counts,
    };
  }

  return {
    status: "RECONCILED",
    reason:
      `${counts.declaredWorkstreams} declared workstream(s), ${counts.terminal} terminal, ` +
      `${counts.addedDuringSession} appended mid-session, ${counts.declaredPostHoc} declared post hoc; ` +
      `${counts.observedArtifacts} observed artifact(s), all linked. Every executed name is declared ` +
      "and every declared workstream has an end.",
    findings,
    notes,
    links,
    unlinkedArtifacts: unlinked,
    counts,
  };
}
