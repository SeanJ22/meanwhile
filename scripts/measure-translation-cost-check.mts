/** An isolated, paid sample of the ordinary measure writer/checker. No reader
 * data or live Admin setting is written. Omit --run to inspect the selection. */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import { saveVotingSourceDoor } from "../lib/ballot/voting-source-publication.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, withDiscoverySearch, withFleetSpendCeiling } from "../lib/control-plane/gateway/admin-config.ts";
import { seedRolePlaybooks } from "../lib/control-plane/playbook-seed.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { WORKER_CREDENTIAL_VAR } from "../lib/control-plane/scheduler/research-policy.ts";
import { anthropicTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { routineMeasureSourceOpener } from "../lib/translate/routine-source-http.ts";
import { armRoutineTranslationPaidWork } from "../lib/translate/routine-paid-work.ts";
import { runMeasureTranslationPass } from "../lib/translate/provider.ts";
import { loadRoutineMeasureSources } from "../lib/translate/routine-sources.ts";
import { routineTranslationAttempts } from "../lib/translate/routine-attempts.ts";
import { readTranslations } from "../lib/translate/projection-reader.ts";

const root = process.cwd(), now = () => new Date().toISOString();
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const all = process.argv.includes("--all"), run = process.argv.includes("--run");
const state = (arg("state") ?? "CA").toUpperCase(), selectedSubject = arg("subject");
const fromState = arg("from-state")?.toUpperCase();
if (fromState && (!all || !/^[A-Z]{2}$/.test(fromState))) throw new Error("--from-state=XX requires --all.");
if (!/^[A-Z]{2}$/.test(state)) throw new Error("Use --state=XX for one state.");
if (all && (arg("state") || selectedSubject)) throw new Error("Choose --all or one --state/--subject selection.");
const directory = join(root, "data", "ballot", "2026-general");
const readState = async (file: string) => JSON.parse(await readFile(join(directory, file), "utf8")) as { ballots: Record<string, BallotSet> };
const files = (await readdir(directory)).filter(file => /^[a-z]{2}\.json$/.test(file)).sort();
const national: { state: string; measures: number }[] = [];
const selections: { state: string; subjectIds: string[] }[] = [];
for (const file of files) {
  const code = file.slice(0, 2).toUpperCase(), held = await readState(file);
  const subjectIds = [...new Set(Object.values(held.ballots).flatMap(ballot => ballot.contests.filter(contest => contest.type === "MEASURE").map(contest => contest.id)))];
  national.push({ state: code, measures: subjectIds.length });
  if (all && subjectIds.length) selections.push({ state: code, subjectIds });
  else if (!all && code === state) {
    const selected = selectedSubject ? subjectIds.filter(id => id === selectedSubject) : subjectIds.slice(0, 1);
    if (!selected.length) throw new Error(`No held measure matches the ${state} sample selection.`);
    selections.push({ state: code, subjectIds: selected });
  }
}
if (!selections.length) throw new Error("The selection contains no held measures.");
const nationwideHeldMeasures = national.reduce((sum, row) => sum + row.measures, 0);
if (fromState) {
  const at = selections.findIndex(selection => selection.state === fromState);
  if (at < 0) throw new Error("The resume state has no held measures.");
  selections.splice(0, at);
}
const plan = { mode: "ISOLATED_LOCAL_COPY", run, selections, nationwideHeldMeasures,
  controls: { rolling24HourModelCeilingUsd: 100, paidPause: false, runnerPause: false, discoverySearch: true, apiFallback: false },
  controlBasis: "Sean's supplied live control values copied locally, with the paid pause cleared only in this isolated copy. Other live control settings were unavailable.",
  publication: "Memory only; no production reader data or live Admin setting is written." };
console.log("MEASURE_TRANSLATION_COST_PLAN=" + JSON.stringify(plan));
if (!run) process.exit(0);

const keyVariable = arg("key-env") ?? (process.env[WORKER_CREDENTIAL_VAR]?.trim() ? WORKER_CREDENTIAL_VAR : "ANTHROPIC_API_KEY");
if (!/^[A-Z][A-Z0-9_]*$/.test(keyVariable)) throw new Error("The model credential variable name is invalid.");
const key = process.env[keyVariable]?.trim() ?? "";
if (!key) throw new Error(`${keyVariable} is not configured; no paid call was sent.`);
const output = resolve(arg("output") ?? join(root, ".scratch", "ex-01-cost-check", now().replaceAll(":", "-")));
await mkdir(output, { recursive: true });
// The ordinary source loader chooses its vault provider from this variable.
// Keep all evidence in this isolated local copy, even on a configured runner.
process.env.WTP_VAULT_PROVIDER = "local";
const repos = await createFileRepositories(join(output, "control-plane"));
const observedAt = now();
if (await repos.adminConfig.read(ADMIN_CONFIG_ID)) throw new Error("The output already contains a control copy; choose a fresh --output directory.");
const config = withDiscoverySearch(withFleetSpendCeiling(defaultAdminConfig(observedAt), {
  rollingCeilingUsd: 100, previousUsd: 100, decidedAt: observedAt, decidedBy: "Sean", receiptId: "isolated-cost-check-ceiling",
}), { enabled: true, decidedAt: observedAt, decidedBy: "Sean", receiptId: "isolated-cost-check-search" });
await repos.adminConfig.put(ADMIN_CONFIG_ID, config, observedAt);
await seedRolePlaybooks(repos, observedAt);
await writeFile(join(output, "plan.json"), JSON.stringify({ ...plan, credentialVariable: keyVariable, output }, null, 2) + "\n");
const store = new MemoryRoutineDataStore(), queue = new ModelProviderQueue();
const transport = anthropicTransport(key, fetch, undefined, { onRateLimits: (limits, request) => queue.observe(request.model, limits) });
let modelResult = 0;
const messages: typeof transport = async request => {
  const response = await transport(request);
  // Keep the structured proposals and checks in the isolated test copy so a
  // rejection can be investigated without another paid call.
  await writeFile(join(output, `model-result-${++modelResult}.json`), JSON.stringify({ model: response.model,
    toolResults: response.content.filter(block => block.type === "tool_use") }, null, 2) + "\n")
    .catch(() => console.error("The isolated copy could not retain a structured model result."));
  return response;
};
type Pass = Awaited<ReturnType<typeof runMeasureTranslationPass>>;
const passes: { state: string; result: Pass; sourceFailures: { url: string; reason: string }[] }[] = [];
let fatal: string | null = null;
try {
  for (const selection of selections) {
    const held = await readState(`${selection.state.toLowerCase()}.json`);
    const wanted = new Set(selection.subjectIds);
    const ballots: BallotSet[] = Object.values(held.ballots).map(ballot => ({ ...ballot,
      contests: ballot.contests.filter(contest => contest.type === "MEASURE" && wanted.has(contest.id)),
    })).filter(ballot => ballot.contests.length);
    const subjects = ballots.flatMap(ballot => ballot.contests.map(contest => ({ subjectId: contest.id, ocdId: contest.ocdId })));
    // The local copy includes this state's held door metadata. Its recorded
    // authority URL is fetched by the ordinary source loader; saved excerpts
    // never stand in for that government's actual response.
    const doors = JSON.parse(await readFile(join(root, "data", "reference", "voting-source-doors.json"), "utf8")) as VotingSourceDoor[];
    for (const door of doors.filter(door => door.scope.state === selection.state)) await saveVotingSourceDoor(repos.doors, door, now());
    const armed = await armRoutineTranslationPaidWork({ repos, state: selection.state, subjects, root, now, messages,
      batch: backgroundBatchTransport({ apiKey: key }), batchEnv: { WTP_BACKGROUND_WORKER_BATCH: "0" },
      credentialConfigured: true, credentialVar: keyVariable, providerQueue: queue,
      onCondition: reason => console.log(`MEASURE_TRANSLATION_COST_HOLD ${reason}`) });
    const sources = await loadRoutineMeasureSources({ repos, root: output, state: selection.state, ballots, now,
      open: routineMeasureSourceOpener({ repos, state: selection.state, root, now }) });
    const attempts = routineTranslationAttempts(repos, selection.state);
    const result = await runMeasureTranslationPass({ states: [selection.state], repos, store, now: now(),
      modelLaneEnabled: armed.closed === null, modelLaneReason: armed.closed?.reason,
      paidWorkerCapacity: () => armed.paidWorkerCapacity(), guardedTransportFor: armed.guardedTransportFor,
      loadBallotsForState: async () => ballots, loadCapturesForState: async () => sources.captures,
      readAttemptsForState: () => attempts.read(), saveAttempt: attempts.save });
    passes.push({ state: selection.state, result, sourceFailures: sources.failures });
    const records = await readTranslations([...new Set(subjects.map(subject => subject.ocdId))], { store, now: now(), bypassCache: true });
    await writeFile(join(output, `${selection.state.toLowerCase()}-checked-explainers.json`), JSON.stringify(records, null, 2) + "\n");
    await writeFile(join(output, `${selection.state.toLowerCase()}-result.json`), JSON.stringify({ result, sourceFailures: sources.failures }, null, 2) + "\n");
    console.log("MEASURE_TRANSLATION_COST_STATE=" + JSON.stringify({ state: selection.state, ...result, sourceFailures: sources.failures }));
  }
} catch (error) { fatal = error instanceof Error ? error.message : String(error); }
const perMeasure = passes.flatMap(pass => pass.result.outcomes.map(outcome => ({ state: pass.state,
  subjectId: outcome.subjectId, status: outcome.status, detail: outcome.detail ?? null, calls: outcome.usage,
  modelCalls: outcome.usage.length,
  measuredUsd: outcome.usage.every(call => call.usd !== null) ? outcome.usage.reduce((sum, call) => sum + call.usd!, 0) : null,
})));
const usage = perMeasure.flatMap(measure => measure.calls);
const measuredUsd = usage.every(call => call.usd !== null) ? usage.reduce((sum, call) => sum + call.usd!, 0) : null;
const checked = perMeasure.filter(measure => measure.status === "PUBLISHED" || measure.status === "REUSED");
const attemptedWithPaidCalls = perMeasure.filter(measure => measure.modelCalls > 0);
const meanUsdPerAttemptedMeasure = measuredUsd !== null && attemptedWithPaidCalls.length ? measuredUsd / attemptedWithPaidCalls.length : null;
const summary = { mode: "ISOLATED_LOCAL_COPY", output, nationwideHeldMeasures, fatal,
  selectedMeasures: selections.reduce((sum, selection) => sum + selection.subjectIds.length, 0),
  checkedMeasures: checked.length, attemptedWithPaidCalls: attemptedWithPaidCalls.length, modelCalls: usage.length, measuredUsd,
  perMeasure, held: passes.flatMap(pass => pass.result.held), unreadable: passes.flatMap(pass => pass.result.unreadable),
  sourceFailures: passes.flatMap(pass => pass.sourceFailures),
  nationalEstimate: { meanUsdPerAttemptedMeasure,
    estimatedUsdForAllHeld: meanUsdPerAttemptedMeasure === null ? null : meanUsdPerAttemptedMeasure * nationwideHeldMeasures,
    basis: "Arithmetic extrapolation from this measured sample. Source length and rejected drafts can change the actual total.",
    estimateForCheckedExplainersAvailable: checked.length > 0 },
};
await writeFile(join(output, "cost-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log("MEASURE_TRANSLATION_COST_RESULT=" + JSON.stringify(summary));
if (fatal || summary.held.length || summary.unreadable.length || checked.length !== summary.selectedMeasures) process.exitCode = 2;
