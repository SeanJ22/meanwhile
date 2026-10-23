import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { runMeasureTranslationPass } from "../lib/translate/provider.ts";

// A read-only national count, with each state's records released before the
// next. An unreadable state keeps the national denominator explicitly unknown.
const result = await runMeasureTranslationPass({ states: REGISTRY_STATES,
  repos: {} as Parameters<typeof runMeasureTranslationPass>[0]["repos"], store: new PostgresRoutineDataStore(),
  now: new Date().toISOString(), modelLaneEnabled: false, modelLaneReason: "Coverage count only.",
  paidWorkerCapacity: () => 0, guardedTransportFor: () => async () => { throw new Error("A coverage count cannot call a model."); },
  loadCapturesForState: async () => [], readAttemptsForState: async () => [], saveAttempt: async () => { throw new Error("A coverage count cannot write attempts."); },
});
console.log(JSON.stringify({ checkedExplainers: result.checkedBefore, measuresInReadableStates: result.totalMeasures,
  nationalTotal: result.unreadable.length ? null : result.totalMeasures, unreadableStates: result.unreadable }, null, 2));
process.exitCode = result.unreadable.length ? 2 : 0;
