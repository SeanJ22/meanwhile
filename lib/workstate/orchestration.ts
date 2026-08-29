/**
 * SESSION ORCHESTRATION — the engineering-team model, made mechanical.
 *
 * ## Why this file exists
 *
 * `classifySessionStop` answers *was there a legitimate reason to stop?* It
 * cannot answer the question that comes before it: *was the work run as an
 * organization, or as one serial developer with one terminal?*
 *
 * The repository already had the stopping half. A session closed after opening
 * tracker rows for work it could still execute, and the rows read like
 * progress — which is exactly the failure RULING 190 names: **a tracker row is
 * a record of work, never a substitute for it.** The session before that ran
 * eight materially independent workstreams one after another, and no
 * instrument anywhere could say that was a defect, because nothing recorded
 * that they were independent.
 *
 * So the plan itself becomes canonical state. A session declares its
 * workstreams, what each OWNS, what each DEPENDS ON and why, and how each was
 * actually executed. Then the dependency claims are CHECKED rather than
 * believed.
 *
 * ## The semantic being enforced
 *
 * Not "did this session make five branches". A branch count rewards
 * fragmentation and measures nothing; three branches rewriting one module is
 * worse than one branch, not better.
 *
 * What is enforced is the rule itself:
 *
 *     INDEPENDENT + EXECUTABLE + SERIALIZED WITHOUT A PROVEN DEPENDENCY
 *       -> process failure, named pair by pair.
 *
 * ## What makes a dependency PROVEN rather than asserted
 *
 * A declared `dependsOn` edge is not evidence of anything — a session that
 * wants to serialize can declare an edge as easily as it can write a sentence.
 * An edge is proven here by one of exactly two mechanical facts:
 *
 *   1. **Conflict overlap.** The two workstreams' owned paths or owned data
 *      domains actually intersect. Two branches editing one load-bearing file
 *      is a real reason to serialize, and it is checkable.
 *
 *   2. **Artifact handoff.** The upstream `produces` something the downstream
 *      `consumes`, matched on the same token. A branch that must rebase onto a
 *      canonical interface another branch has not landed yet is a real
 *      dependency, and naming the artifact is what makes it one.
 *
 * An edge backed by neither is reported as UNPROVEN. It is not silently
 * accepted, and it is not silently deleted either — the session may have a
 * correctness reason the repository cannot see, and the instrument's job is to
 * make it say so out loud rather than to overrule it.
 *
 * **Two classes, and two is enough.** A third class was considered and refused.
 * Every real dependency reduces to one of these two shapes: *we both write the
 * same thing*, or *I need something you make*. The case that looks like a third
 * — contention over an external resource neither workstream owns a file for, a
 * production database, a rate-limited credential, a canonical store — is a
 * conflict overlap already: `ConflictDomain.data` exists precisely so a domain
 * with no single path is still declarable and still checkable. A third class
 * that took prose and gave it a field name would prove nothing, because the
 * property that makes these two mechanical is that BOTH SIDES declared the same
 * token independently. Free prose is never proof, and renaming it does not make
 * it one.
 *
 * ## The loophole this file used to have, and how it is closed
 *
 * The first implementation walked EVERY DECLARED `dependsOn` EDGE when deciding
 * whether two workstreams were independent, and it did so BEFORE any edge was
 * checked. `areIndependent` returned false the moment one id reached the other
 * through the raw declared graph. The consequence was exact and total: a session
 * that wanted to run independent work single-file only had to DECLARE an edge
 * and write a sentence that dodged every `SERIALIZATION_NON_REASONS` pattern.
 * The declaration suppressed `independent-work-serialized`, the prose survived
 * the non-reason filter, the edge landed in `unprovenDependencies` — which the
 * checker printed and did not fail on — and the plan returned `TEAM` with an
 * empty `findings` array. **The guard could be turned off by the thing it was
 * guarding against.**
 *
 * So the graph that SUPPRESSES independence now contains PROVEN EDGES ONLY. An
 * unproven edge is still carried in the plan, still reported, and still allowed
 * to be a stated hypothesis about the work — it simply cannot make two
 * workstreams non-independent, and it cannot justify a `SERIALIZED` disposition.
 * A SERIALIZED executable workstream whose every edge is unproven is now the
 * finding `serialized-on-unproven-dependency`, and it is fatal.
 *
 * The DECLARED graph survives for the structural checks that legitimately need
 * it. A declared cycle is malformed whether or not anyone could prove its edges,
 * and a declared edge to an id that is not in the plan is malformed for the same
 * reason — those are claims about the plan's own coherence, not about the work.
 *
 * ## The observability limit, named rather than papered over
 *
 * **This file cannot prove wall-clock concurrency.** Nothing in the repository
 * observes when a branch's work actually ran, and an agent cannot stamp a
 * reliable clock — `pnpm stamp` yields a date, not a timeline. So a session
 * that declares `PARALLEL` and secretly ran serially is not caught here.
 *
 * That limit is why the guard checks the SHAPE OF THE PLAN and the JUSTIFICATION
 * OF EVERY SERIALIZATION, which are the two things that are actually written
 * down. `concurrencyEvidence` exists so a session can record the mechanism it
 * used — worktrees, branches, agent ids, concurrent processes — and that is
 * corroboration, never proof. It is reported, never scored.
 *
 * `executionArtifacts` is the same corroboration made MACHINE-READABLE, so that
 * closeout can reconcile the declared plan against what actually ran. It carries
 * one hard prohibition with it, and it is RULING 190's own: **an artifact count
 * is not a workstream count.** One logical workstream may use zero artifacts,
 * one, or six; two branches held by one workstream are still ONE workstream. The
 * mapping is explicit or it does not exist. `lib/workstate/orchestration-closeout.ts`.
 */

/**
 * How a workstream was actually executed.
 *
 * `READY_FOR_INTEGRATION` is the state the engineering-team model exists to
 * make sayable: **a completed branch is not a completed session.**
 */
export const ORCHESTRATION_DISPOSITIONS = [
  /** Declared, not yet begun. */
  "NOT_STARTED",
  /** Executed concurrently with at least one other workstream. */
  "PARALLEL",
  /** Deliberately run after another workstream. Requires a proven dependency. */
  "SERIALIZED",
  /** Cannot proceed. Requires a blocker reason, and never stops the others. */
  "BLOCKED",
  /** Finished and verified on its own branch. NOT a finished session. */
  "READY_FOR_INTEGRATION",
  /** Merged into the integration branch and re-verified there. */
  "INTEGRATED",
] as const;
export type OrchestrationDisposition = (typeof ORCHESTRATION_DISPOSITIONS)[number];

/** The dispositions that mean the workstream still owes executable work. */
export const OPEN_ORCHESTRATION_DISPOSITIONS: readonly OrchestrationDisposition[] = [
  "NOT_STARTED",
  "PARALLEL",
  "SERIALIZED",
];

/**
 * Stated serialization reasons that are NOT reasons.
 *
 * Each entry names a way a session has already talked itself into running
 * independent work single-file. They are refusals of a JUSTIFICATION, never of
 * a decision: a session may still serialize, and it may still be right. It may
 * not call any of these a dependency.
 */
export const SERIALIZATION_NON_REASONS: ReadonlyArray<{
  name: string;
  pattern: RegExp;
  why: string;
}> = [
  {
    name: "PR size",
    pattern:
      /\b(?:pr|diff|change ?set|branch) (?:is |was |already )?(?:too )?(?:large|big|huge)\b|too many files|many files changed|keep the (?:pr|diff) small|reviewable size/i,
    why: "shipping law already ships one combined head; the size of that head is not a dependency between two workstreams",
  },
  {
    name: "branch simplicity",
    pattern:
      /branch simplicity|simpler (?:to |on )?(?:a )?(?:one|single) branch|avoid(?:ing)? (?:merge )?conflicts?\b(?![^.]*\bshared\b)|one branch (?:is |was )?(?:easier|cleaner|simpler)|easier to (?:review|reason|track|manage)|cleaner history/i,
    why: "conflict avoidance is solved by owning disjoint files, not by making independent work wait",
  },
  {
    name: "convenience",
    pattern:
      /\b(?:for )?convenien(?:ce|t)\b|(?:more |feels )?(?:natural|tidy|tidier|neater)\b|one (?:thing|task) at a time|finish(?:ing)? (?:one|this) (?:first|before)\b(?![^.]*\b(?:needs|requires|consumes|depends)\b)|seemed (?:safer|simpler)/i,
    why: "convenience is the defect this rule names; independent work is parallel by default",
  },
  {
    name: "caution",
    pattern:
      /\bout of (?:an abundance of )?caution\b|to be (?:safe|careful|cautious)|didn'?t want to risk|felt risky\b(?![^.]*\bdata loss\b)|conservative(?:ly)? approach/i,
    why: "correctness constraints are named as the specific constraint they are; unspecified caution is not one",
  },
  {
    name: "priority mistaken for a lock",
    pattern:
      /\bp0\b[^.]{0,40}\b(?:first|before|block(?:s|ed|ing)?|freeze|frozen|wait)|(?:block(?:s|ed|ing)?|freeze|frozen|wait(?:s|ed|ing)?)[^.]{0,40}\bp0\b|highest priority[^.]{0,30}(?:first|before)|priority order/i,
    why: "a priority governs what starts first and what merge acceptance requires; it never freezes independent engineers",
  },
  {
    name: "single-threaded tooling",
    pattern:
      /can'?t (?:literally )?spawn|no (?:real |true )?subagents?|only one (?:terminal|shell|thread|agent)|single(?:-| )threaded|tooling (?:does not|doesn'?t) support/i,
    why: "the law governs orchestration semantics, not one tool API — interleave independent work by waits and dependencies instead",
  },
];

/** The non-reason a stated serialization reason appeals to, or `null`. */
export function disqualifyingSerializationReason(
  reason: string,
): { name: string; why: string } | null {
  for (const n of SERIALIZATION_NON_REASONS) {
    if (n.pattern.test(reason)) return { name: n.name, why: n.why };
  }
  return null;
}

/**
 * What a workstream owns.
 *
 * Two workstreams CONFLICT when these intersect. `paths` are repository paths
 * (a trailing `/` or a `**` suffix reads as a subtree); `data` are canonical
 * data or store domains that have no single path — a Drizzle table, a
 * generated view, a canonical store.
 */
export interface ConflictDomain {
  paths: string[];
  data: string[];
}

/**
 * The kinds of thing a workstream can be executed ON.
 *
 * Deliberately a closed list. An open `kind: string` would let a session invent
 * a category to make an unlinked artifact look accounted for at closeout, which
 * is the same shape of evasion the declared-edge loophole was.
 */
export const EXECUTION_ARTIFACT_KINDS = [
  "branch",
  "worktree",
  "agent",
  "process",
  /**
   * The integration branch itself, claimed by a workstream that ran ON it.
   *
   * Its own kind rather than a `branch`, because it is the case that most
   * cleanly disproves the branch-count substitution. The Aug 28 session's
   * `governance-orchestration` workstream held the shared load-bearing files and
   * therefore executed on the integration branch — it produced no `ws/*` ref at
   * all. Under a branch count it does not exist; under an explicit mapping it is
   * a workstream that honestly declares zero private refs.
   */
  "integration-branch",
] as const;
export type ExecutionArtifactKind = (typeof EXECUTION_ARTIFACT_KINDS)[number];

/**
 * One thing the work actually ran on, structured rather than narrated.
 *
 * **This is not a unit of work.** A workstream may declare none of these, one,
 * or many; the count of artifacts and the count of workstreams are different
 * numbers and RULING 190 forbids substituting either for the other. What the
 * field buys is the MAPPING — given an observed ref, which logical workstream
 * claims it — and that mapping is what closeout reconciliation needs and what
 * free prose in `concurrencyEvidence` could never supply.
 */
export interface ExecutionArtifact {
  kind: ExecutionArtifactKind;
  /** The ref, worktree path, or agent id, exactly as it can be observed. */
  ref: string;
}

/** Is this a well-formed artifact, or a shape that only looks like one? */
export function isExecutionArtifact(value: unknown): value is ExecutionArtifact {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Partial<ExecutionArtifact>;
  return (
    typeof a.ref === "string" &&
    a.ref.trim().length > 0 &&
    typeof a.kind === "string" &&
    (EXECUTION_ARTIFACT_KINDS as readonly string[]).includes(a.kind)
  );
}

/**
 * A workstream appended to the plan AFTER it had already executed.
 *
 * The honest alternative to editing history quietly. A session that discovers at
 * closeout that it ran work the plan never carried has exactly two truthful
 * moves: leave the gap and fail, or backfill and SAY that it backfilled. This
 * type is the second one, and its two fields are what make it a record rather
 * than an excuse — WHEN the backfill happened, and WHAT EVIDENCE it was
 * reconstructed from.
 *
 * A backfilled workstream counts as declared, because it is: the plan now
 * carries it. It is counted and reported SEPARATELY, because a session that
 * backfilled three workstreams did not run the append-safe discipline the rule
 * asks for, and a reconciliation that hid that would be reporting the repair as
 * though it were the practice.
 */
export interface PostHocDeclaration {
  /** From `pnpm stamp`. An agent does not know today's date. */
  backfilledOn: string;
  /** The evidence the reconstruction rests on — refs, commits, what was compared. */
  evidence: string;
}

/**
 * A discrepancy between declared and executed that evidence CANNOT resolve.
 *
 * The mechanism exists so that "the counts do not agree and I cannot find out
 * why" is sayable. **Never invent a mapping to make counts agree** — that is a
 * fabricated fact about the session, and the whole reason this file distrusts
 * numbers that were reasoned to rather than read. An unresolvable discrepancy is
 * recorded, named, and carried.
 */
export interface PostHocDiscrepancy {
  kind: string;
  detail: string;
}

/**
 * Every malformed artifact or post-hoc record on a workstream, named one by one.
 *
 * A typed field with no validator is prose wearing a type annotation: the plan
 * is JSON on disk and `JSON.parse` will hand back whatever was written. This is
 * what makes `executionArtifacts` and `declaredPostHoc` evidence rather than two
 * more sentences.
 */
export function validateExecutionArtifacts(w: SessionWorkstream): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [i, a] of (w.executionArtifacts ?? []).entries()) {
    if (!isExecutionArtifact(a)) {
      out.push(
        `${w.id} executionArtifacts[${i}] is not a {kind, ref} of kind ` +
          `${EXECUTION_ARTIFACT_KINDS.join("|")}: ${JSON.stringify(a)}`,
      );
      continue;
    }
    const key = `${a.kind}:${a.ref}`;
    if (seen.has(key)) out.push(`${w.id} declares the artifact ${key} twice`);
    seen.add(key);
  }
  const post = w.declaredPostHoc;
  if (post !== undefined) {
    if (typeof post !== "object" || post === null) {
      out.push(`${w.id} declaredPostHoc is not a {backfilledOn, evidence}: ${JSON.stringify(post)}`);
    } else {
      // Both halves are required. A backfill with no date cannot be placed
      // against the session it repairs, and a backfill with no evidence is the
      // invented mapping this whole mechanism exists to refuse.
      if (typeof post.backfilledOn !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(post.backfilledOn)) {
        out.push(
          `${w.id} declaredPostHoc.backfilledOn is not a stamped date (YYYY-MM-DD, from \`pnpm stamp\`): ` +
            JSON.stringify(post.backfilledOn),
        );
      }
      if (typeof post.evidence !== "string" || post.evidence.trim().length === 0) {
        out.push(
          `${w.id} was declared post hoc and names no evidence — a backfill without evidence is an ` +
            "invented mapping, and inventing one to make counts agree is the defect, not the repair",
        );
      }
    }
  }
  return out;
}

export interface SessionWorkstream {
  /** Stable within the session. Referenced by `dependsOn`. */
  id: string;
  title: string;
  /** Ids this workstream waits on. Every edge must carry a reason. */
  dependsOn: string[];
  /** Why each dependency exists, keyed by the upstream id. */
  dependencyReasons: Record<string, string>;
  /** Files and data this workstream may write. */
  owns: ConflictDomain;
  /** Named artifacts this workstream makes available to others. */
  produces: string[];
  /** Named artifacts this workstream needs from another. */
  consumes: string[];
  /** Is there authorized work here that a session could actually run? */
  executable: boolean;
  disposition: OrchestrationDisposition;
  /** Required when `disposition` is `BLOCKED`. The wall, named. */
  blockedReason?: string;
  /** Corroboration only — worktrees, branches, agent ids. Never proof. */
  concurrencyEvidence?: string[];
  /**
   * The refs this workstream actually ran on, structured for reconciliation.
   *
   * OPTIONAL, so a plan written before the field existed still parses — a
   * schema change that invalidates the canonical record of a shipped session is
   * a worse defect than the gap it closes.
   */
  executionArtifacts?: ExecutionArtifact[];
  /**
   * Declared after the session opened — a mid-session P0, an addendum, work
   * that only became visible once another workstream landed.
   *
   * Recorded because the alternative is that it is invisible: the Aug 28
   * session ran three workstreams that were never appended to its plan, and
   * nothing could tell that from a plan that had simply always had ten.
   */
  addedDuringSession?: boolean;
  /**
   * Appended AFTER it executed, with the backfill said out loud.
   *
   * Distinct from `addedDuringSession`, and the distinction is the point:
   * `addedDuringSession` is the discipline working — a mid-session P0 given an
   * id as it began. `declaredPostHoc` is the discipline having failed and been
   * repaired honestly. Closeout accepts both as declared and reports the second
   * separately.
   */
  declaredPostHoc?: PostHocDeclaration;
}

export interface OrchestrationPlan {
  /** The session this plan belongs to. */
  session: string;
  /** The branch that owns integration, shared stores and the final ship. */
  integrationOwner: string;
  workstreams: SessionWorkstream[];
  /**
   * Declared-versus-executed gaps that evidence could not close.
   *
   * Carried on the PLAN rather than on a workstream, because a discrepancy that
   * cannot be attributed to a workstream is exactly the case: an unaccounted ref
   * whose provenance is gone, a count from a report that no longer reconciles.
   * The alternative to recording it is to guess a mapping, and a guessed mapping
   * is a fabricated fact about the session.
   */
  postHocDiscrepancies?: PostHocDiscrepancy[];
}

export const ORCHESTRATION_STATUSES = [
  /** Independent work ran in parallel, or every serialization is proven. */
  "TEAM",
  /** Independent executable work was serialized with no proven dependency. */
  "UNJUSTIFIED_SERIALIZATION",
  /** One workstream. There is nothing to parallelize. */
  "SINGLE_WORKSTREAM",
  /** The plan cannot be evaluated — missing reasons, dangling ids, cycles. */
  "MALFORMED_PLAN",
] as const;
export type OrchestrationStatus = (typeof ORCHESTRATION_STATUSES)[number];

export interface OrchestrationFinding {
  rule: string;
  detail: string;
  /** The workstreams involved, so the report can name the pair. */
  workstreams: string[];
}

export interface OrchestrationVerdict {
  status: OrchestrationStatus;
  reason: string;
  /** Every problem, not the first one. */
  findings: OrchestrationFinding[];
  /** Dependency edges that exist but are backed by nothing checkable. */
  unprovenDependencies: OrchestrationFinding[];
  /** Pairs the plan itself shows to be independent. */
  independentPairs: Array<[string, string]>;
  counts: {
    workstreams: number;
    executable: number;
    parallel: number;
    serialized: number;
    blocked: number;
    readyForIntegration: number;
    integrated: number;
  };
}

/** Does `a` cover `b`, treating a trailing `/` or `**` as a subtree? */
function pathCovers(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\*+$/, "").replace(/\/$/, "");
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  return y.startsWith(x + "/") || x.startsWith(y + "/");
}

/** The owned paths and data two workstreams actually share. */
export function conflictOverlap(a: SessionWorkstream, b: SessionWorkstream): string[] {
  const out: string[] = [];
  for (const p of a.owns.paths) {
    for (const q of b.owns.paths) if (pathCovers(p, q)) out.push(p === q ? p : `${p} ~ ${q}`);
  }
  for (const d of a.owns.data) {
    for (const e of b.owns.data) if (d === e) out.push(d);
  }
  return [...new Set(out)];
}

/** The artifacts `up` produces that `down` consumes. */
export function artifactHandoff(up: SessionWorkstream, down: SessionWorkstream): string[] {
  return up.produces.filter((p) => down.consumes.includes(p));
}

/**
 * Is a declared dependency backed by a mechanical fact?
 *
 * Returns the evidence, or `null` when the edge rests on prose alone.
 */
export function dependencyEvidence(
  up: SessionWorkstream,
  down: SessionWorkstream,
): { kind: "conflict-overlap" | "artifact-handoff"; detail: string } | null {
  const shared = conflictOverlap(up, down);
  if (shared.length > 0) {
    return { kind: "conflict-overlap", detail: `shared ownership: ${shared.join(", ")}` };
  }
  const handed = artifactHandoff(up, down);
  if (handed.length > 0) {
    return { kind: "artifact-handoff", detail: `${up.id} produces ${handed.join(", ")}` };
  }
  return null;
}

/** The upstream ids of `id` that survive `dependencyEvidence`. Declared or proven. */
function edgesOf(
  id: string,
  byId: Map<string, SessionWorkstream>,
  provenOnly: boolean,
): string[] {
  const down = byId.get(id);
  if (!down) return [];
  if (!provenOnly) return down.dependsOn;
  return down.dependsOn.filter((dep) => {
    const up = byId.get(dep);
    return up ? dependencyEvidence(up, down) !== null : false;
  });
}

/**
 * Every id reachable from `id` by following `dependsOn` as WRITTEN, `id`
 * excluded.
 *
 * This is the plan's claim about itself, and it is the right graph for exactly
 * one job: the structural checks that ask whether the plan is coherent. A
 * declared cycle is malformed no matter what backs its edges — the session said
 * A waits on B waits on A, and that sentence is broken on its own terms.
 *
 * It is the WRONG graph for independence, which is the defect this file used to
 * have. See `provenAncestors`.
 */
function declaredAncestors(id: string, byId: Map<string, SessionWorkstream>): Set<string> {
  return reachable(id, byId, false);
}

/**
 * Every id reachable from `id` through edges `dependencyEvidence` can PROVE.
 *
 * A declared edge is a sentence; this closure is the subset of those sentences
 * the repository can check. Only this graph may suppress independence, because
 * only this graph cannot be extended by writing one.
 */
function provenAncestors(id: string, byId: Map<string, SessionWorkstream>): Set<string> {
  return reachable(id, byId, true);
}

function reachable(
  id: string,
  byId: Map<string, SessionWorkstream>,
  provenOnly: boolean,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...edgesOf(id, byId, provenOnly)];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...edgesOf(next, byId, provenOnly));
  }
  return seen;
}

/**
 * Two workstreams are INDEPENDENT when neither reaches the other through the
 * PROVEN dependency graph and their owned domains do not intersect.
 *
 * Both halves matter. A pair with no edge that both write `app/globals.css` is
 * not independent, and calling it independent is how a session invents a merge
 * conflict for itself.
 *
 * **The word PROVEN is the whole repair.** This predicate previously walked the
 * declared graph, which meant a session could make any pair non-independent by
 * declaring an edge between them — turning off the one finding that exists to
 * catch a serial queue. An unproven edge is still reported, and it is still
 * allowed to be the session's stated hypothesis about the work. It simply gets
 * no vote here, because a vote here is a vote on whether the guard runs.
 */
export function areIndependent(
  a: SessionWorkstream,
  b: SessionWorkstream,
  byId: Map<string, SessionWorkstream>,
): boolean {
  if (provenAncestors(a.id, byId).has(b.id)) return false;
  if (provenAncestors(b.id, byId).has(a.id)) return false;
  return conflictOverlap(a, b).length === 0;
}

/**
 * The declared upstreams of `w` that nothing in the plan can check.
 *
 * Empty means either that every edge is proven or that there are no edges at
 * all — the two are distinguished by `dependsOn.length`, and the caller must,
 * because they are different findings.
 */
export function unprovenUpstreams(
  w: SessionWorkstream,
  byId: Map<string, SessionWorkstream>,
): string[] {
  return w.dependsOn.filter((dep) => {
    const up = byId.get(dep);
    return up ? dependencyEvidence(up, w) === null : false;
  });
}

/**
 * Derive the orchestration verdict from the plan.
 *
 * **The model does not award itself a verdict; the plan does** — the same
 * principle `classifySessionStop` applies to stopping, applied to starting.
 */
export function classifyOrchestration(plan: OrchestrationPlan): OrchestrationVerdict {
  const ws = plan.workstreams;
  const byId = new Map(ws.map((w) => [w.id, w]));
  const findings: OrchestrationFinding[] = [];
  const unproven: OrchestrationFinding[] = [];

  const counts = {
    workstreams: ws.length,
    executable: ws.filter((w) => w.executable).length,
    parallel: ws.filter((w) => w.disposition === "PARALLEL").length,
    serialized: ws.filter((w) => w.disposition === "SERIALIZED").length,
    blocked: ws.filter((w) => w.disposition === "BLOCKED").length,
    readyForIntegration: ws.filter((w) => w.disposition === "READY_FOR_INTEGRATION").length,
    integrated: ws.filter((w) => w.disposition === "INTEGRATED").length,
  };

  // --- structural integrity -------------------------------------------------
  const malformed: OrchestrationFinding[] = [];
  const ids = new Set<string>();
  for (const w of ws) {
    if (ids.has(w.id)) {
      malformed.push({ rule: "duplicate-id", detail: `two workstreams share id ${w.id}`, workstreams: [w.id] });
    }
    ids.add(w.id);
    if (!ORCHESTRATION_DISPOSITIONS.includes(w.disposition)) {
      malformed.push({
        rule: "unknown-disposition",
        detail: `${w.id} carries an unknown disposition: ${w.disposition}`,
        workstreams: [w.id],
      });
    }
    if (w.disposition === "BLOCKED" && !w.blockedReason?.trim()) {
      malformed.push({
        rule: "unnamed-blocker",
        detail: `${w.id} is BLOCKED and does not name the wall`,
        workstreams: [w.id],
      });
    }
    for (const dep of w.dependsOn) {
      if (!byId.has(dep)) {
        malformed.push({
          rule: "dangling-dependency",
          detail: `${w.id} depends on ${dep}, which is not in the plan`,
          workstreams: [w.id],
        });
        continue;
      }
      if (!w.dependencyReasons[dep]?.trim()) {
        malformed.push({
          rule: "unreasoned-dependency",
          detail: `${w.id} depends on ${dep} and gives no reason`,
          workstreams: [w.id, dep],
        });
      }
    }
    // The DECLARED graph, deliberately. A cycle is the plan contradicting
    // itself, and that is broken whether or not any of its edges are provable.
    if (declaredAncestors(w.id, byId).has(w.id)) {
      malformed.push({
        rule: "dependency-cycle",
        detail: `${w.id} reaches itself through dependsOn`,
        workstreams: [w.id],
      });
    }
    for (const bad of validateExecutionArtifacts(w)) {
      malformed.push({ rule: "malformed-execution-artifact", detail: bad, workstreams: [w.id] });
    }
  }

  if (malformed.length > 0) {
    return {
      status: "MALFORMED_PLAN",
      reason:
        `the plan cannot be evaluated: ${malformed.length} structural problem(s). ` +
        "A plan that cannot be checked is not evidence that the rule was followed.",
      findings: malformed,
      unprovenDependencies: [],
      independentPairs: [],
      counts,
    };
  }

  // --- dependency edges: proven, or named as unproven ------------------------
  // Downstream ids already carrying a fatal finding about their OWN edges. A
  // second finding about the same edges would be noise, and noise on a fatal
  // report is how the real line gets skimmed past.
  const alreadyFatalOnItsEdges = new Set<string>();
  for (const w of ws) {
    for (const dep of w.dependsOn) {
      const up = byId.get(dep)!;
      const reason = w.dependencyReasons[dep];
      const non = disqualifyingSerializationReason(reason);
      if (non) {
        findings.push({
          rule: "non-reason-dependency",
          detail:
            `${w.id} waits on ${dep} for a reason that appeals to ${non.name} — ${non.why}. ` +
            `Stated: "${reason}"`,
          workstreams: [w.id, dep],
        });
        alreadyFatalOnItsEdges.add(w.id);
        continue;
      }
      const evidence = dependencyEvidence(up, w);
      if (!evidence) {
        unproven.push({
          rule: "unproven-dependency",
          detail:
            `${w.id} waits on ${dep} with no owned-domain overlap and no produces/consumes handoff. ` +
            `Stated: "${reason}" — the constraint may be real, but nothing in the plan can check it.`,
          workstreams: [w.id, dep],
        });
      }
    }
  }

  // --- the rule itself ------------------------------------------------------
  const independentPairs: Array<[string, string]> = [];
  for (let i = 0; i < ws.length; i += 1) {
    for (let j = i + 1; j < ws.length; j += 1) {
      const a = ws[i];
      const b = ws[j];
      if (!areIndependent(a, b, byId)) continue;
      independentPairs.push([a.id, b.id]);

      // Only executable work can be run in parallel, and BLOCKED is not a
      // serialization — a blocked branch never stops an independent one, which
      // is the point of recording it separately.
      if (!a.executable || !b.executable) continue;
      if (a.disposition !== "SERIALIZED" || b.disposition !== "SERIALIZED") continue;

      findings.push({
        rule: "independent-work-serialized",
        detail:
          `${a.id} and ${b.id} share no PROVEN dependency edge and no owned path or data domain, ` +
          "and both were run SERIALIZED. Independent executable work is parallel by default. " +
          "A declared edge between them, if there is one, does not suppress this: an edge nothing " +
          "can check is not a reason, it is a sentence.",
        workstreams: [a.id, b.id],
      });
    }
  }

  // A SERIALIZED workstream that waits on nothing at all is the unexplained
  // serial chain in its purest form: it is not downstream of anything.
  //
  // Its sibling, below, is the same chain with sentences drawn between the
  // links. The two are kept apart on purpose and never both fire for one
  // workstream: `dependsOn.length === 0` is this rule's whole domain, and
  // `dependsOn.length > 0 with nothing proven` is the other's.
  for (const w of ws) {
    if (w.disposition !== "SERIALIZED" || !w.executable) continue;
    if (w.dependsOn.length > 0) continue;
    findings.push({
      rule: "serialized-without-dependency",
      detail: `${w.id} is SERIALIZED and depends on nothing — there is no dependency to serialize behind`,
      workstreams: [w.id],
    });
  }

  // THE CLOSED LOOPHOLE, stated as a rule.
  //
  // An unproven edge is a hypothesis, and a session is allowed to hold one. It
  // is not allowed to SERIALIZE EXECUTABLE WORK BEHIND ONE — that is the whole
  // decision the guard exists to check, and permitting it means any session can
  // exempt itself by writing a sentence. Reported-and-not-fatal survives for
  // every other disposition, because there the edge changed nothing.
  for (const w of ws) {
    if (w.disposition !== "SERIALIZED" || !w.executable) continue;
    if (w.dependsOn.length === 0) continue;
    if (alreadyFatalOnItsEdges.has(w.id)) continue;
    const unprovenUp = unprovenUpstreams(w, byId);
    if (unprovenUp.length < w.dependsOn.length) continue; // at least one edge is proven
    for (const dep of unprovenUp) {
      findings.push({
        rule: "serialized-on-unproven-dependency",
        detail:
          `${w.id} is SERIALIZED behind ${dep}, and no edge it declares is proven — ` +
          `${dep} and ${w.id} share no owned path or data domain, and ${dep} produces nothing ` +
          `${w.id} consumes. Stated: "${w.dependencyReasons[dep]}". The constraint may be real; ` +
          "it is not a reason to make executable work wait, because nothing in the plan can check it.",
        workstreams: [w.id, dep],
      });
    }
  }

  if (ws.length <= 1) {
    return {
      status: "SINGLE_WORKSTREAM",
      reason: "one workstream — there is no independent work to run beside it",
      findings,
      unprovenDependencies: unproven,
      independentPairs,
      counts,
    };
  }

  if (findings.length > 0) {
    return {
      status: "UNJUSTIFIED_SERIALIZATION",
      reason:
        `${findings.length} finding(s): independent executable work was serialized without a proven ` +
        "dependency, or a dependency was justified by something that is not a dependency.",
      findings,
      unprovenDependencies: unproven,
      independentPairs,
      counts,
    };
  }

  return {
    status: "TEAM",
    reason:
      `${counts.workstreams} workstream(s), ${independentPairs.length} independent pair(s); ` +
      "every serialization is backed by a shared owned domain or a named artifact handoff",
    findings,
    unprovenDependencies: unproven,
    independentPairs,
    counts,
  };
}

/**
 * Refusal raised when a workstream cannot be appended to a plan.
 *
 * A throw rather than a returned error, because there is exactly one caller
 * shape — a session that has just decided to run something — and the only safe
 * response to "this id is already taken" is to stop and pick another. Swallowing
 * it produces the Aug 28 failure: work that ran under a name the plan never
 * carried.
 */
export class WorkstreamAppendError extends Error {
  /*
   * Fields declared and assigned, never a PARAMETER PROPERTY — the suite runs
   * under `--experimental-strip-types`, which refuses a TS feature that emits
   * code. See `lib/ops/denominator-floor.ts` for the same note and the same
   * reason.
   */
  readonly workstream: string;

  constructor(workstream: string, why: string) {
    super(`cannot append workstream "${workstream}" to the plan: ${why}`);
    this.name = "WorkstreamAppendError";
    this.workstream = workstream;
  }
}

/**
 * Append a workstream discovered AFTER the session opened.
 *
 * ## Why this exists at all
 *
 * The Aug 28 session declared ten workstreams and ran thirteen. Three —
 * `ws/mtg13union`, `ws/methodint`, `ws/incum` — were real, authorized,
 * executed work that the canonical plan was never told about, and nothing could
 * see the gap, because a plan is only ever compared against itself. A mid-session
 * P0 or an addendum is NORMAL; RULING 190 explicitly requires that a P0 start
 * immediately without freezing the others. What is not normal is for it to run
 * without a canonical id.
 *
 * So the plan is append-safe DURING a session, and appending is the cheap path:
 * `plan` in, `plan` out, id checked, edges checked, and `addedDuringSession`
 * stamped so closeout can tell an addendum from an original declaration.
 *
 * Returns a NEW plan. The input is not mutated — a caller that has already
 * written the plan to disk should write the result, not assume the object it
 * held changed underneath it.
 */
export function appendWorkstream(
  plan: OrchestrationPlan,
  w: SessionWorkstream,
): OrchestrationPlan {
  const id = w.id?.trim();
  if (!id) throw new WorkstreamAppendError(String(w.id), "the id is empty");
  if (plan.workstreams.some((x) => x.id === id)) {
    throw new WorkstreamAppendError(id, "the plan already carries that id, and ids are the mapping");
  }
  const known = new Set(plan.workstreams.map((x) => x.id));
  for (const dep of w.dependsOn) {
    if (!known.has(dep)) {
      throw new WorkstreamAppendError(id, `it depends on ${dep}, which is not in the plan`);
    }
    if (!w.dependencyReasons[dep]?.trim()) {
      throw new WorkstreamAppendError(id, `it depends on ${dep} and gives no reason`);
    }
  }
  for (const bad of validateExecutionArtifacts(w)) throw new WorkstreamAppendError(id, bad);

  return {
    ...plan,
    workstreams: [...plan.workstreams, { ...w, id, addedDuringSession: true }],
  };
}
