/**
 * **THE EXPANSION PAGE'S VIEW OF EACH SELECTED SCOPE.** (Expansion controls, 2026-09-23.)
 *
 * The owner's decision (from the policy row, read live) joined to what the
 * runner last measured about it (the research state's expansion reading) and
 * to the published assignment list — and nothing else. Three rules the page
 * rests on, enforced here rather than in JSX:
 *
 * ```
 *   a reading older than the decision is not shown as the decision's reading:
 *     the page says the runner has not picked the change up yet
 *   unknown is never zero: every count is a number or null, and a null
 *     carries the sentence the page prints instead
 *   every number the page draws is in `renderedNumbers`, with a denominator
 *     and an interpretation contract, for the page's own audit
 * ```
 *
 * PURE.
 */
import type { AssignmentListRow, AssignmentState } from "../assignment-view.ts";
import type { RenderedNumber } from "../owner-surface.ts";
import type { DispatchWorkReading, DispatchWorkTargetReading } from "./dispatch-work.ts";
import type { ExpansionCycleReading, ExpansionScopeReading } from "./reading.ts";
import type { ExpansionScopeDecision } from "./scopes.ts";
import { subjectOfObligationId } from "./subjects.ts";

/* -------------------------------------------------- what a Send created (MW-028) */

export type ScopeCreationView =
  | { readonly kind: "READ"; readonly target: DispatchWorkTargetReading; readonly at: string; readonly planOnly: string | null }
  | { readonly kind: "NOT_YET"; readonly says: string };

/**
 * What the runner created for this decision, from the research state's
 * `dispatchWork` reading. The same rule as `runnerViewFor`: a reading taken at
 * a cycle that started before the decision is not this decision's.
 */
export function scopeCreationView(decision: ExpansionScopeDecision, reading: DispatchWorkReading | null): ScopeCreationView {
  if (reading === null) {
    return { kind: "NOT_YET", says: "The runner has not created anything for a geography yet: it does so at the start of its next cycle." };
  }
  if (reading.at < decision.decidedAt) {
    return { kind: "NOT_YET", says: "You changed this after the runner's last cycle started; what it creates here is counted at the start of the next one." };
  }
  const target = reading.targets.find((t) => t.kind === "SCOPE" && t.key === decision.key);
  if (target === undefined) {
    return { kind: "NOT_YET", says: "The runner's last cycle did not carry this geography. It is counted at the start of the next cycle." };
  }
  return { kind: "READ", target, at: reading.at, planOnly: reading.writes === "PLAN_ONLY" ? reading.planOnlyWhy : null };
}

/** Every number a surface draws for one target's creation receipt, each with its denominator and contract. */
export function scopeCreationNumbers(target: DispatchWorkTargetReading): RenderedNumber[] {
  const r = target.requirements;
  const label = target.label;
  const out: RenderedNumber[] = [
    { label: `${label} requirements created`, value: r.created, denominator: r.defined, contract: "requirements the promoted registry defines for the governments here that the owner's Send created, of every one it defines here" },
    { label: `${label} created this cycle`, value: r.createdThisCycle, denominator: r.created, contract: "of those created, how many the runner's last cycle wrote" },
    { label: `${label} requirements reordered`, value: r.carried, denominator: r.defined, contract: "requirements here already on a standing clock, which the Send puts first rather than creates" },
    { label: `${label} standing obligations reordered`, value: target.reordered.obligations, denominator: target.reordered.of, contract: "standing obligations about the governments here, of every standing obligation that cycle" },
    { label: `${label} requirements deferred`, value: r.deferred, denominator: r.defined, contract: "requirements here still owed and not yet written: the per-cycle write budget ran out" },
    { label: `${label} requirements beyond the cap`, value: r.capped, denominator: r.defined, contract: `requirements here beyond this geography's cap of ${target.cap}` },
  ];
  if (target.units.blocked !== null) {
    out.push({
      label: `${label} governments blocked`,
      value: target.units.blocked,
      denominator: target.units.placed + target.units.blocked,
      contract: "governments in this geography that no dataset can give requirements to, of every government it holds that can be named",
    });
  }
  return out;
}

export type ScopeRunnerView =
  | { readonly kind: "READ"; readonly reading: ExpansionScopeReading; readonly at: string }
  | { readonly kind: "NOT_YET"; readonly says: string };

export interface ScopeAssignmentView {
  /** Listed assignment rows about a subject in this scope, by state. */
  readonly byState: readonly { readonly state: AssignmentState; readonly count: number }[];
  readonly inScope: number;
  /** How many rows the published list carries at all, and how many assignments exist. */
  readonly listed: number;
  readonly total: number | null;
  /** True when the subject list the runner published was cut; the counts are then a floor. */
  readonly floor: boolean;
}

export interface ScopeCard {
  readonly decision: ExpansionScopeDecision;
  readonly runner: ScopeRunnerView;
  readonly assignments: ScopeAssignmentView | null;
  readonly assignmentsSays: string | null;
}

/**
 * Which runner reading belongs to this decision. A reading taken at a cycle that
 * started before the decision was made describes the OLD decision (or none),
 * so it is not shown as this one's.
 */
export function runnerViewFor(decision: ExpansionScopeDecision, reading: ExpansionCycleReading | null): ScopeRunnerView {
  if (reading === null) {
    return { kind: "NOT_YET", says: "The runner has not measured any scope yet: it reads your list at the start of its next cycle." };
  }
  if (reading.at < decision.decidedAt) {
    return {
      kind: "NOT_YET",
      says: "You changed this after the runner's last cycle started, so what it last measured is not this decision's. It takes effect at the start of the next cycle.",
    };
  }
  const match = reading.scopes.find((s) => s.key === decision.key);
  if (match === undefined) {
    return { kind: "NOT_YET", says: "The runner's last cycle did not carry this scope. It takes effect at the start of the next cycle." };
  }
  return { kind: "READ", reading: match, at: reading.at };
}

/** Listed assignment rows in a scope, counted by assignment state. */
export function assignmentsInScope(
  rows: readonly AssignmentListRow[],
  subjectIds: ReadonlySet<string>,
  total: number | null,
  floor: boolean,
): ScopeAssignmentView {
  const counts = new Map<AssignmentState, number>();
  let inScope = 0;
  for (const row of rows) {
    const subject = subjectOfObligationId(row.id);
    if (subject === null || !subjectIds.has(subject)) continue;
    inScope += 1;
    counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
  }
  return {
    byState: [...counts.entries()].map(([state, count]) => ({ state, count })),
    inScope,
    listed: rows.length,
    total,
    floor,
  };
}

/** Every scope card, in run order. */
export function scopeCards(input: {
  readonly scopes: readonly ExpansionScopeDecision[];
  readonly reading: ExpansionCycleReading | null;
  /** The published assignment list, or null when it is not published. */
  readonly assignmentRows: readonly AssignmentListRow[] | null;
  readonly assignmentTotal: number | null;
}): ScopeCard[] {
  return input.scopes.map((decision) => {
    const runner = runnerViewFor(decision, input.reading);
    if (runner.kind !== "READ" || runner.reading.work === null) {
      return {
        decision,
        runner,
        assignments: null,
        assignmentsSays:
          runner.kind === "READ"
            ? "Nothing can be counted as in this scope until it resolves."
            : "Counted once the runner has resolved this scope.",
      };
    }
    if (input.assignmentRows === null) {
      return { decision, runner, assignments: null, assignmentsSays: "The assignment list is not on the published snapshot yet, so nothing is counted here — not an empty scope." };
    }
    const work = runner.reading.work;
    return {
      decision,
      runner,
      assignments: assignmentsInScope(input.assignmentRows, new Set(work.subjectIds), input.assignmentTotal, !work.subjectIdsComplete),
      assignmentsSays: null,
    };
  });
}

/** Every number the page draws for the scope cards, for its audit. */
export function scopeCardNumbers(cards: readonly ScopeCard[], registeredObligations: number | null): RenderedNumber[] {
  const out: RenderedNumber[] = [];
  for (const card of cards) {
    const label = card.decision.geography.label;
    out.push({ label: `${label} priority`, value: card.decision.priority, denominator: Math.max(cards.length, card.decision.priority), contract: "the owner's run order among the selected scopes; 1 runs first" });
    out.push({ label: `${label} budget`, value: card.decision.budgetUsd, denominator: card.decision.budgetUsd, contract: "the owner's rolling 24-hour cap on paid model work in this scope, in dollars" });
    if (card.runner.kind === "READ") {
      const r = card.runner.reading;
      if (r.resolution.kind === "RESOLVED" && r.coverage !== null) {
        const z = r.resolution.zctaCount;
        out.push({ label: `${label} ZCTAs`, value: z, denominator: z, contract: "Census ZIP-code tabulation areas wholly or partly inside this geography" });
        out.push({ label: `${label} ZCTAs with local work`, value: r.coverage.zctasWithLocalWork, denominator: z, contract: "scope ZCTAs overlapped by a registered local government that has standing work" });
        out.push({ label: `${label} gap ZCTAs`, value: r.coverage.gapZctas, denominator: z, contract: "scope ZCTAs no local government with standing work overlaps" });
        out.push({ label: `${label} governments with work`, value: r.coverage.withWork, denominator: r.coverage.registeredJurisdictions, contract: "registered governments overlapping this scope that carry standing work, of all registered governments overlapping it" });
      }
      if (r.work !== null) {
        const denominator = registeredObligations ?? r.work.registeredObligations;
        out.push({ label: `${label} obligations`, value: r.work.registeredObligations, denominator, contract: "standing obligations about a government in this scope, of every standing obligation registered" });
        out.push({ label: `${label} due`, value: r.work.dueThisCycle, denominator: r.work.registeredObligations, contract: "obligations in this scope that were due at the start of the runner's last cycle" });
        out.push({ label: `${label} scout rows first`, value: r.work.scoutRowsPlacedFirst, denominator: r.work.dueThisCycle, contract: "due paid-lane rows in this scope placed ahead of the rest" });
        if (r.work.scoutAdmitted !== null && r.heldThisCycle !== null) {
          out.push({ label: `${label} scouts admitted`, value: r.work.scoutAdmitted, denominator: r.work.scoutAdmitted + r.heldThisCycle, contract: "paid Scouts for this scope that passed its budget last cycle, of those that asked" });
        }
      }
      if (r.heldThisCycle !== null) {
        const asked = (r.work?.scoutAdmitted ?? 0) + r.heldThisCycle;
        out.push({ label: `${label} scouts held`, value: r.heldThisCycle, denominator: asked, contract: "paid Scouts this scope's budget held back last cycle, of those that asked" });
      }
      if (r.spend !== null) {
        if (r.spend.rolling24hUsd !== null) out.push({ label: `${label} 24h spend`, value: r.spend.rolling24hUsd, denominator: card.decision.budgetUsd, contract: "measured model dollars attributed to work in this scope in the rolling 24 hours, against its budget" });
        if (r.spend.sevenDayUsd !== null) out.push({ label: `${label} 7d spend`, value: r.spend.sevenDayUsd, denominator: card.decision.budgetUsd * 7, contract: "measured model dollars attributed to work in this scope in the last 7 days, against seven days at its budget" });
      }
    }
    if (card.assignments !== null) {
      for (const s of card.assignments.byState) {
        out.push({ label: `${label} assignments ${s.state}`, value: s.count, denominator: card.assignments.inScope, contract: "listed assignments about a government in this scope in this state, of all listed assignments in the scope" });
      }
      out.push({ label: `${label} assignments listed`, value: card.assignments.inScope, denominator: card.assignments.listed, contract: "listed assignments about a government in this scope, of every row the published list carries" });
    }
  }
  return out;
}
