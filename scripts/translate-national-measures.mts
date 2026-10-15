import { netlifyEvidenceStoreFromEnv } from "../lib/control-plane/evidence/netlify-store.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { anthropicTransport, type ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { WORKER_CREDENTIAL_VAR } from "../lib/control-plane/scheduler/research-policy.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { armHunterLane, hunterLaneArmingPath, LaneOwnSpend, HUNTER_LANE_REFRESH_MS, type ArmedHunterLane } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { reportingWorkerSlots, workerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { runNationalMeasureTranslations } from "../lib/translate/national.ts";
import { assertRegisteredRuntimeContract } from "../lib/civic-data/runtime-authority.ts";
import { FleetPreSendRefusal, modelRequestWorstCaseUsd, modelResponseUsd } from "../lib/control-plane/fleet-safety.ts";
import { SendBudgetRefusal } from "../lib/control-plane/expansion/spend-holds.ts";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { translationScope } from "../lib/translate/records.ts";

const state = process.argv.find(value => value.startsWith("--state="))?.slice(8).toUpperCase();
if (!state || !US_JURISDICTIONS.some(row => row.usps === state)) throw new Error("Measure translation requires --state with one registered jurisdiction.");

assertRegisteredRuntimeContract("plain-english-translations", "manual");
prepareProductionCivicDataWrite();
const controlPlane = controlPlaneUrlFromEnv();
if (!controlPlane) throw new Error("The current control-plane connection is unavailable.");
const now = () => new Date().toISOString();
const repos = await createPgRepositories(controlPlane, now(), { skipBootstrap: true });
const providerQueue = new ModelProviderQueue();
const key = process.env[WORKER_CREDENTIAL_VAR]?.trim() ?? "";
const messages = anthropicTransport(key, fetch, undefined, {
  onRateLimits: (limits, request) => providerQueue.observe(request.model, limits) });
const batch = backgroundBatchTransport({ apiKey: key });
const ownSpend = new LaneOwnSpend();
const pendingCharges = new WeakMap<ModelResponse, ReturnType<LaneOwnSpend["begin"]>>();
let armed: ArmedHunterLane | null = null, refreshing: Promise<void> | null = null;
const refresh = async () => {
  if (refreshing) return refreshing;
  if (armed && Date.now() - Date.parse(armed.armedAt) < HUNTER_LANE_REFRESH_MS) return;
  refreshing = (async () => {
    armed = await armHunterLane({ repos, now, armingPath: hunterLaneArmingPath(process.cwd()), messages, batch,
      providerQueue, ownSpend, credentialConfigured: Boolean(key), credentialVar: WORKER_CREDENTIAL_VAR,
      circuits: armed?.fleetSafety?.snapshot(now()).providerCircuits ?? null, onCondition: console.log });
  })();
  try { await refreshing; } finally { refreshing = null; }
};
await refresh();
const current = () => armed!;
if (current().closed) {
  console.log(`Measure summaries deferred: ${current().closed!.reason}`);
  process.exit(0);
}
const vault = netlifyEvidenceStoreFromEnv();
if (!vault) throw new Error("National measure translation requires the shared Netlify evidence vault.");
let stopped = false;
process.on("SIGTERM", () => { stopped = true; });
const reports = await runNationalMeasureTranslations({ vault, repos, state,
  onMeasureComplete: division => ownSpend.finished(translationScope(division)),
  onCostRecorded: response => {
    const charge = pendingCharges.get(response);
    if (charge) ownSpend.recorded(charge);
    pendingCharges.delete(response);
  },
  store: new PostgresRoutineDataStore(), now, capacity: () => current().guards?.paidWorkerCapacity() ?? 0,
  slots: reportingWorkerSlots(workerProcessSlots(() => current().guards?.paidWorkerCapacity() ?? 0)),
  continueWork: () => !stopped && current().closed === null, report: console.log,
  transportFor: subject => async request => {
    await refresh();
    const live = current();
    if (!live.guards || live.closed) throw new Error(live.closed?.reason ?? "The current paid model lane is closed.");
    const scope = translationScope(subject.ocdId);
    const charge = ownSpend.begin(scope, now(), modelRequestWorstCaseUsd(request) ?? 0);
    try {
      const response = await live.guards.autonomousTransportFor(messages)({ ...subject, subjectId: subject.ocdId })(request);
      ownSpend.settle(charge, modelResponseUsd(response));
      pendingCharges.set(response, charge);
      return response;
    } catch (error) {
      if (error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal) ownSpend.unsent(charge);
      else { ownSpend.settle(charge, null); ownSpend.finished(scope); }
      throw error;
    }
  } });
console.log(JSON.stringify(reports));
process.exitCode = reports.some(row => row.error) ? 2 : 0;
