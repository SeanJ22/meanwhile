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
}

export interface OrchestrationPlan {
  /** The session this plan belongs to. */
  session: string;
  /** The branch that owns integration, shared stores and the final ship. */
  integrationOwner: string;
  workstreams: SessionWorkstream[];
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

/** Every id reachable from `id` by following `dependsOn`, `id` excluded. */
function ancestors(id: string, byId: Map<string, SessionWorkstream>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(byId.get(id)?.dependsOn ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(byId.get(next)?.dependsOn ?? []));
  }
  return seen;
}

/**
 * Two workstreams are INDEPENDENT when neither reaches the other through the
 * dependency graph and their owned domains do not intersect.
 *
 * Both halves matter. A pair with no declared edge that both write
 * `app/globals.css` is not independent, and calling it independent is how a
 * session invents a merge conflict for itself.
 */
export function areIndependent(
  a: SessionWorkstream,
  b: SessionWorkstream,
  byId: Map<string, SessionWorkstream>,
): boolean {
  if (ancestors(a.id, byId).has(b.id)) return false;
  if (ancestors(b.id, byId).has(a.id)) return false;
  return conflictOverlap(a, b).length === 0;
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
    if (ancestors(w.id, byId).has(w.id)) {
      malformed.push({
        rule: "dependency-cycle",
        detail: `${w.id} reaches itself through dependsOn`,
        workstreams: [w.id],
      });
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
          `${a.id} and ${b.id} share no dependency edge and no owned path or data domain, ` +
          "and both were run SERIALIZED. Independent executable work is parallel by default.",
        workstreams: [a.id, b.id],
      });
    }
  }

  // A SERIALIZED workstream that waits on nothing at all is the unexplained
  // serial chain in its purest form: it is not downstream of anything.
  for (const w of ws) {
    if (w.disposition !== "SERIALIZED" || !w.executable) continue;
    if (w.dependsOn.length > 0) continue;
    findings.push({
      rule: "serialized-without-dependency",
      detail: `${w.id} is SERIALIZED and depends on nothing — there is no dependency to serialize behind`,
      workstreams: [w.id],
    });
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
