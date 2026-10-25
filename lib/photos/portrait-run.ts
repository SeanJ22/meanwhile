/** Whether a state's portrait run has anything to do, read from its own record before anything large. */
import { ROUTINE_SOURCE_CONTRACTS } from "../civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../civic-data/manual-contracts.ts";
import { peopleSourceScope } from "../officials/people-sources.ts";
import { peopleJurisdiction } from "../civic-data/people-source-read.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";

/** The promotions a state's portraits are built from: its people and federal directory records and, for a state, its local rosters. */
export function portraitInputScopes(state: string): readonly { readonly recordClass: RoutineRecordClass; readonly scope: string; readonly sourceId: string }[] {
  const jurisdiction = peopleJurisdiction(state);
  const sources = [...ROUTINE_SOURCE_CONTRACTS, ...MANUAL_PRODUCTION_SOURCE_CONTRACTS]
    .filter(row => row.sourceId !== "people-portraits" && ["STATE_LEGISLATOR", "FEDERAL_DIRECTORY"].includes(row.recordClass) &&
      (row.scope === jurisdiction || row.scope.startsWith(`${jurisdiction}:`)))
    .map(row => ({ recordClass: row.recordClass, scope: row.scope, sourceId: row.sourceId }));
  return state.toLowerCase() === "us" ? sources
    : [...sources, { recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope(state), sourceId: "reader-registry-runtime" }];
}

/** Run only when an input's promotion moved since the last portrait run, or a photo is due. */
export async function portraitRunNeeded(store: RoutineDataStore, state: string, now: string): Promise<{ needed: boolean; reason: string }> {
  const last = await store.readPortraitRunState(peopleSourceScope(peopleJurisdiction(state), "people-portraits"));
  if (!last) return { needed: true, reason: "No portrait record is held for this state yet." };
  if (!last.nextDueAt || !(Date.parse(last.nextDueAt) > Date.parse(now))) {
    return { needed: true, reason: last.nextDueAt ? `A portrait fell due at ${last.nextDueAt}.` : "The last run saved no next due time." };
  }
  const held = new Map(last.inputs.map(row => [`${row.recordClass}\t${row.scope}`, row.versionId]));
  const inputs = portraitInputScopes(state);
  for (const recordClass of new Set(inputs.map(row => row.recordClass))) {
    const scopes = inputs.filter(row => row.recordClass === recordClass).map(row => row.scope);
    const current = new Map((await store.readPromotionIdentities(recordClass, scopes)).map(row => [row.scope, row.versionId]));
    for (const scope of scopes) {
      if ((current.get(scope) ?? null) !== (held.get(`${recordClass}\t${scope}`) ?? null)) {
        return { needed: true, reason: `${scope} changed since the last portrait run.` };
      }
    }
  }
  return { needed: false, reason: `No portrait input changed and the next photo is due ${last.nextDueAt}.` };
}
