/** Owner change leads use the standing Scout lane and its existing mission budgets. */
import { ADMIN_CONFIG_ID, isAdminConfig } from "./gateway/admin-config.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "./expansion/scopes.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import { canonicalJson } from "./repository/types.ts";
import { readCompletedWorkerResultsOf } from "./repository/worker-completion.ts";
import type { StandingObligation } from "./scheduler/durable.ts";
import { withAssignment, type ObligationAssignment } from "./scheduler/obligation.ts";
import type { ObligationProvider, ProvidedObligation, RouteDescriptor } from "./scheduler/registry.ts";

const KIND = "officials-change";
const VERIFIED_REASON = "The reported change was checked against captured official-source evidence.";

/** Like standing official-source work, a statewide roster is shared with each of that state's selected missions. */
export function officialsLeadScopes(divisions: readonly string[], scopes: readonly ExpansionScopeDecision[]): readonly ExpansionScopeDecision[] {
  const states = new Set(divisions.flatMap(id => /^ocd-division\/country:us\/(?:state|territory|district):([a-z]{2})(?=\/|$)/.exec(id)?.[1] ?? []));
  return scopes.filter(scope => states.has(scope.geography.stateAbbr.toLowerCase()));
}

export async function officialsLeadBinding(repos: ControlPlaneRepositories, divisions: readonly string[], at: string): Promise<{
  readonly active: boolean; readonly assignments: readonly ObligationAssignment[];
}> {
  const states = [...new Set(divisions.flatMap(id => /^ocd-division\/country:us\/(?:state|territory|district):([a-z]{2})(?=\/|$)/.exec(id)?.[1] ?? []))];
  const decided: ExpansionScopeDecision[] = [];
  // Each state's selected missions are read by their own state; nothing loads the whole country's.
  for (const state of states) {
    const held = await repos.adminConfig.read(ADMIN_CONFIG_ID, { expansionScopes: { where: { path: ["geography", "stateAbbr"], value: state.toUpperCase() } } });
    if (held === null || !isAdminConfig(held.value)) return { active: false, assignments: [] };
    const scopes = expansionScopesOf(held.value);
    if (scopes.malformed) return { active: false, assignments: [] };
    decided.push(...scopes.scopes);
  }
  const matching = officialsLeadScopes(divisions, decided);
  return { active: matching.some(scope => scope.budgetUsd > 0), assignments: matching.map(scope => ({
    assignmentKey: scope.key, ref: scope.receiptId, relation: "REORDERED", at, questions: ["HAS_CHANGED"],
  })) };
}

async function verifiedLeadAt(repos: ControlPlaneRepositories, row: StandingObligation): Promise<string | null> {
  const contract = row.autonomousPlan?.contract;
  const namespace = contract?.schemaVersion === 2 ? contract.identity.namespace : null;
  if (!namespace) return null;
  // Repair successors retain the original note's identity namespace, so a verified successor settles that lead too.
  const items = await repos.workItems.listWhere(["autonomousPlan", "contract", "identity", "namespace"], namespace);
  const complete = items.filter(item => item.value.state === "VERIFIED_COMPLETE").map(item => item.value.transitions.at(-1)?.at ?? item.value.createdAt);
  const results = await readCompletedWorkerResultsOf(repos, items.map(item => item.id));
  const verified = results.filter(result => result.result.role === "VALIDATOR" && result.result.verdict === "PASS" && result.result.validatedRecordCount > 0).map(result => result.endedAt);
  return [...complete, ...verified].sort().at(-1) ?? null;
}

/** One full runner pass rebinds pending leads to current funded missions and settles independently verified leads. */
export async function refreshOfficialsLeads(repos: ControlPlaneRepositories, at: string, options: { readonly apply?: boolean } = {}): Promise<readonly StandingObligation[]> {
  const rows = await repos.obligations.listWhere(["officialsLead", "kind"], KIND);
  const result: StandingObligation[] = [];
  for (const held of rows) {
    if (held.value.retiredAt) { result.push(held.value); continue; }
    const verifiedAt = await verifiedLeadAt(repos, held.value);
    const binding = verifiedAt === null ? await officialsLeadBinding(repos, held.value.scopeDivisions ?? [], at) : { active: false, assignments: [] };
    let assignments = held.value.assignments;
    for (const mark of binding.assignments) assignments = withAssignment(assignments, mark);
    const next: StandingObligation = { ...held.value, active: binding.active,
      ...(assignments ? { assignments } : {}),
      ...(!binding.active ? { nextDueAt: null } : {}),
      ...(verifiedAt ? { retiredAt: at, retirementReason: VERIFIED_REASON, lastWorkedAt: verifiedAt } : {}) };
    if (canonicalJson(next) !== canonicalJson(held.value) && options.apply !== false) {
      const wrote = await repos.obligations.compareAndSet(held.id, held.revision, { ...next, updatedAt: at }, at);
      result.push(wrote.value);
    } else result.push(options.apply === false ? held.value : next);
  }
  return result;
}

/** These rows are already durable owner instructions, not a new source or an inferred government. */
export function officialsLeadProvider(rows: readonly StandingObligation[]): ObligationProvider {
  const active = rows.filter(row => row.active && !row.retiredAt && row.autonomousPlan);
  return { id: "officials-change-leads", describe: "Reports of changed officials awaiting verification against official sources",
    enumerate() {
      return { obligations: active.map((row): ProvidedObligation => {
        const routeId = `${row.id}:verify-official-source`;
        const route: RouteDescriptor = { routeId, label: "Verify the reported official change", executorClass: "BOUNDED_MODEL_WORKER",
          executorReason: "An owner supplied a lead; a Scout must independently find and verify its official government evidence.",
          open: { kind: "NOT_MACHINE_EXECUTABLE", target: row.subjectId, reason: "The reported change needs an independently captured official source." },
          citation: row.officialsLead!.receiptId };
        return { subjectId: row.subjectId, recordClass: row.recordClass, scopeDivisions: row.scopeDivisions,
          readerImpactAt: row.readerImpactAt, observedChangeRateHours: row.observedChangeRateHours, lastWorkedAt: row.lastWorkedAt,
          routes: [route], autonomousPlans: { [routeId]: row.autonomousPlan! } };
      }), readFailure: null, emptyReason: active.length ? null : "No reported official change is waiting within a funded mission." };
    },
    scheduledId(_record, route) { return route.routeId.replace(/:verify-official-source$/, ""); },
  };
}

/** Used by Admin to show an attempted or budget-held lead as pending until source verification actually completes. */
export async function officialsLeadStatus(repos: ControlPlaneRepositories, id: string): Promise<{ readonly state: "waiting" | "working" | "checked"; readonly checkedAt: string | null }> {
  const row = await repos.obligations.read(id);
  if (row === null) return { state: "waiting", checkedAt: null };
  if (row.value.retiredAt && row.value.retirementReason === VERIFIED_REASON) return { state: "checked", checkedAt: row.value.lastWorkedAt };
  const verifiedAt = await verifiedLeadAt(repos, row.value);
  if (verifiedAt) return { state: "checked", checkedAt: verifiedAt };
  if (row.value.openOccurrenceId) {
    const occurrence = await repos.occurrences.read(row.value.openOccurrenceId);
    if (occurrence && occurrence.value.closedAt === null) return { state: "working", checkedAt: null };
  }
  // A closed unsuccessful occurrence is still waiting for a useful check.
  return { state: "waiting", checkedAt: null };
}
