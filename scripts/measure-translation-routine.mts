import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { admittedRuntimeChildEnvironment, assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { CONTROL_PLANE_URL_VAR, controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { WORKER_CREDENTIAL_VAR } from "../lib/control-plane/scheduler/research-policy.ts";
import { anthropicTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
import { loadPromotedMeasureBallots, runMeasureTranslationPass } from "../lib/translate/provider.ts";
import { measureTranslationRoutineId } from "../lib/translate/routine-contract.ts";
import { armRoutineTranslationPaidWork } from "../lib/translate/routine-paid-work.ts";
import { routineTranslationAttempts } from "../lib/translate/routine-attempts.ts";
import { loadRoutineMeasureSources } from "../lib/translate/routine-sources.ts";
import { measureTranslationRoutineReceipt } from "../lib/translate/routine-receipt.ts";
import { routineMeasureSourceOpener } from "../lib/translate/routine-source-http.ts";

const stateArg = process.argv.find(arg => arg.startsWith("--state="))?.slice(8);
if (!stateArg) throw new Error("The standing measure translator requires --state=XX.");
const state = requireBallotState(stateArg), now = () => new Date().toISOString();
const connection = controlPlaneUrlFromEnv();
if (!connection) throw new Error(`${CONTROL_PLANE_URL_VAR} is not configured. The live Admin paid-work gate cannot be read; no model request was sent.`);

if (!process.argv.includes("--manual-child")) {
  assertRuntimeAuthority({ capabilities: ["ROUTINE_CONTRACT"], contract: measureTranslationRoutineId(state) });
  // The routine clock delegates publication to the already registered manual
  // translation door, retaining the admitted checkout and actual parent PID.
  const child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), `--state=${state}`, "--manual-child"], {
    stdio: "inherit",
    env: admittedRuntimeChildEnvironment({ capability: "MANUAL_CONTRACT", contract: "plain-english-translations", parentPid: process.pid }),
  });
  const forward = () => child.kill("SIGTERM");
  process.once("SIGTERM", forward);
  const exit = await new Promise<number>((resolve, reject) => {
    child.once("error", reject); child.once("exit", code => resolve(code ?? 1));
  });
  process.removeListener("SIGTERM", forward);
  process.exitCode = exit;
} else {
  assertRuntimeAuthority({ capabilities: ["MANUAL_CONTRACT"], contract: "plain-english-translations" });
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  const repos = await createPgRepositories(connection, now(), { skipBootstrap: true, planningState: state.toLowerCase() });
  let holdReason: string | null = null;
  try {
    const ballots = await loadPromotedMeasureBallots(state, { store, now: now() });
    const subjects = ballots.flatMap(ballot => ballot.contests.filter(row => row.type === "MEASURE")
      .map(contest => ({ subjectId: contest.id, ocdId: contest.ocdId })));
    const queue = new ModelProviderQueue();
    const key = process.env[WORKER_CREDENTIAL_VAR]?.trim() ?? "";
    const messages = anthropicTransport(key, fetch, undefined, { onRateLimits: (limits, request) => queue.observe(request.model, limits) });
    const armed = await armRoutineTranslationPaidWork({ repos, state, subjects, root: process.cwd(), now,
      messages, batch: backgroundBatchTransport({ apiKey: key }), credentialConfigured: Boolean(key),
      credentialVar: WORKER_CREDENTIAL_VAR, providerQueue: queue,
      onCondition: reason => console.log(`MEASURE_TRANSLATION_HOLD ${reason}`) });
    // Publisher reads remain free while Admin holds paid work.
    const sources = await loadRoutineMeasureSources({ repos, root: process.cwd(), state, ballots, now,
      open: routineMeasureSourceOpener({ repos, state, root: process.cwd(), now }) });
    const attempts = routineTranslationAttempts(repos, state);
    const result = await runMeasureTranslationPass({ states: [state], repos, store, now: now(),
      modelLaneEnabled: armed.closed === null, modelLaneReason: armed.closed?.reason,
      paidWorkerCapacity: () => armed.paidWorkerCapacity(), guardedTransportFor: armed.guardedTransportFor,
      loadBallotsForState: async () => ballots, loadCapturesForState: async () => sources.captures,
      readAttemptsForState: async () => attempts.read(), saveAttempt: attempts.save });
    console.log("MEASURE_TRANSLATION_RESULT=" + JSON.stringify({ state, ...result, sourceFailures: sources.failures }));
    holdReason = result.persistenceError ?? result.unreadable[0]?.reason ?? result.held[0]?.reason ??
      (result.checkedAfter < result.totalMeasures ? "Some measure explainers still need source checking." : null);
  } catch (error) { holdReason = error instanceof Error ? error.message : String(error); }
  const receipt = await measureTranslationRoutineReceipt({ store, state, now: now(), holdReason });
  console.log(receipt.line);
  if (receipt.holdReason) console.error(`MEASURE_TRANSLATION_HOLD ${receipt.holdReason}`);
  process.exitCode = receipt.exitCode;
}
