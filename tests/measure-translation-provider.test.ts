import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue } from "../lib/civic-data/runner.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import { translationHash } from "../lib/translate/records.ts";
import { loadPromotedMeasureBallots, runMeasureTranslationPass } from "../lib/translate/provider.ts";
import { MEASURE_TRANSLATION_ROUTINE_TASKS, measureTranslationRoutineTask } from "../lib/translate/routine-contract.ts";
import type { TranslationAttempt } from "../lib/translate/standing.ts";
import { createMemoryRepositories } from "./helpers/playbooks.ts";

const now = "2026-10-20T18:00:00.000Z";
const division = "ocd-division/country:us/state:oh";
const sourceUrl = "https://elections.example.gov/measures";
const summary = "The levy funds library services.";
const yes = "A YES vote adopts the levy.";
const no = "A NO vote keeps the current levy.";
const text = `Proposition 12. Proposition 13. ${summary} ${yes} ${no}`;

function fixture() {
  const calls: ModelRequest[] = [], saved: TranslationAttempt[] = [];
  const capture: WorkerPublicationCapture = {
    evidence: { artifactId: "official", acquiredByAttemptId: "held", sourceId: "Fixture election office", methodRouteId: "measure-text",
      canonicalUrl: sourceUrl, contentHash: `sha256-${translationHash(text)}`, retrievedAt: now, text },
    observedAt: now, partial: false, httpStatus: 200, transport: "REACHABLE",
  };
  const ballot = { election: { state: "OH", id: "general", date: "2026-11-03" }, candidacies: [], measures: [],
    contests: [12, 13].map(number => ({ id: `measure:${number}`, title: `Proposition ${number}`, type: "MEASURE", ocdId: division,
      provenance: { sourceUrl } })),
    // A held human-written summary still owes independently checked vote meanings.
    measureRecords: [{ contestId: "measure:12", whatItDoes: summary, yesMeans: null, noMeans: null, parts: [],
      sourceUrl, sourceHash: translationHash(text), writtenAt: now }],
  } as unknown as BallotSet;
  let captureReads = 0, attemptReads = 0, checkerPass = true;
  const input = {
    states: ["OH"], repos: createMemoryRepositories(), store: new MemoryRoutineDataStore(), now,
    modelLaneEnabled: true as boolean | null, paidWorkerCapacity: () => 1,
    loadBallotsForState: async () => [ballot],
    loadCapturesForState: async () => { captureReads++; return [capture]; },
    readAttemptsForState: async () => { attemptReads++; return saved; },
    saveAttempt: async (attempt: TranslationAttempt) => { saved.push(attempt); },
    guardedTransportFor: () => async (request: ModelRequest) => {
      calls.push(request);
      const message = JSON.parse(request.messages[0].content as string);
      const measure = { contestId: message.subject.contestId, whatItDoes: summary, yesMeans: yes, noMeans: no, parts: [],
        sourceUrl, sourceHash: translationHash(text), writtenAt: now };
      const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field,
        text: measure[field as "whatItDoes"], quote: measure[field as "whatItDoes"] }));
      return { model: request.model, stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: "tool_use", id: "result", name: request.tools[0].name, input: request.tools[0].name === "write_measure_translation"
          ? { measure, sentences } : { checked: sentences.map(({ field, text }) => ({ field, text, supported: checkerPass })) } }],
      };
    },
  };
  return { input, calls, saved, ballot, reads: () => ({ captureReads, attemptReads }), failChecker: () => { checkerPass = false; } };
}

test("standing provider fills both a hand-written summary and a measure without a record, then spends nothing on checked explainers", async () => {
  const f = fixture();
  const first = await runMeasureTranslationPass(f.input);
  assert.equal(first.totalMeasures, 2);
  assert.equal(first.checkedBefore, 0);
  assert.equal(first.checkedAfter, 2, JSON.stringify(first));
  assert.deepEqual(first.outcomes.map(row => row.status), ["PUBLISHED", "PUBLISHED"]);
  assert.equal(f.calls.length, 4);
  const second = await runMeasureTranslationPass(f.input);
  assert.equal(second.checkedBefore, 2);
  assert.equal(second.checkedAfter, 2);
  assert.equal(second.outcomes.length, 0);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.reads(), { captureReads: 1, attemptReads: 1 });
});

test("closed or unknown paid lane keeps every missing explainer open without loading paid work", async () => {
  for (const modelLaneEnabled of [false, null]) {
    const f = fixture();
    const result = await runMeasureTranslationPass({ ...f.input, modelLaneEnabled, modelLaneReason: "" });
    assert.equal(result.totalMeasures, 2);
    assert.equal(result.checkedAfter, 0);
    assert.equal(result.held.length, 2);
    assert.match(result.held[0].reason, modelLaneEnabled === false ? /lane is closed/ : /could not be read/);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.reads(), { captureReads: 0, attemptReads: 0 });
  }
});

test("the provider honors existing paid capacity and never invents spending authority", async () => {
  const f = fixture();
  const result = await runMeasureTranslationPass({ ...f.input, paidWorkerCapacity: () => 0 });
  assert.equal(result.held.length, 2);
  assert.match(result.held[0].reason, /capacity is closed/);
  assert.equal(f.calls.length, 0);
});

test("two admitted writers publish the same division concurrently without losing either checked explainer", { timeout: 5_000 }, async () => {
  const f = fixture();
  const send = f.input.guardedTransportFor();
  let writers = 0;
  let release!: () => void;
  const bothWriters = new Promise<void>(resolve => { release = resolve; });
  const result = await runMeasureTranslationPass({ ...f.input, paidWorkerCapacity: () => 2,
    guardedTransportFor: () => async request => {
      if (request.tools[0].name === "write_measure_translation") {
        if (++writers === 2) release();
        await bothWriters;
      }
      return send(request);
    },
  });
  assert.equal(writers, 2);
  assert.equal(result.checkedAfter, 2, JSON.stringify(result));
  assert.deepEqual(result.outcomes.map(row => row.status), ["PUBLISHED", "PUBLISHED"]);
  assert.equal(f.calls.length, 4, "the publication merge never repeats a paid call");
  const replay = await runMeasureTranslationPass(f.input);
  assert.equal(replay.checkedBefore, 2, "both independently checked records remain in the current projection");
  assert.equal(f.calls.length, 4);
});

test("a failed sentence check holds the explainer, retains both charges, and remains open on the next pass", async () => {
  const f = fixture(); f.failChecker();
  const first = await runMeasureTranslationPass(f.input);
  assert.equal(first.checkedAfter, 0);
  assert.deepEqual(first.outcomes.map(row => [row.status, row.usage.length]), [["HELD", 2], ["HELD", 2]]);
  const second = await runMeasureTranslationPass(f.input);
  assert.equal(second.held.length, 2);
  assert.equal(f.calls.length, 4, "the existing attempt retry clock prevents duplicate paid calls");
});

test("source or durable-attempt failures stay visible and never start a model", async () => {
  const f = fixture();
  const sourceFailure = await runMeasureTranslationPass({ ...f.input, loadCapturesForState: async () => { throw new Error("Source store unavailable"); } });
  assert.deepEqual(sourceFailure.unreadable, [{ state: "OH", reason: "Source store unavailable" }]);
  const attemptFailure = await runMeasureTranslationPass({ ...f.input, saveAttempt: async () => { throw new Error("Attempt store unavailable"); } });
  assert.equal(attemptFailure.persistenceError, "Attempt store unavailable");
  assert.equal(attemptFailure.held.length, 2);
  assert.equal(f.calls.length, 0);
});

test("the provider refuses a cross-state ballot and the canonical loader reports a missing promoted authority", async () => {
  const f = fixture();
  const result = await runMeasureTranslationPass({ ...f.input, states: ["CA"] });
  assert.match(result.unreadable[0].reason, /outside its scheduled state/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(loadPromotedMeasureBallots("OH", f.input), /held ballot for OH is/);
});

test("each state has an independent routine translation clock and an exact manual-publication scope", () => {
  assert.equal(MEASURE_TRANSLATION_ROUTINE_TASKS.length, REGISTRY_STATES.length);
  assert.equal(new Set(MEASURE_TRANSLATION_ROUTINE_TASKS.map(task => task.id)).size, REGISTRY_STATES.length);
  assert.equal(new Set(MEASURE_TRANSLATION_ROUTINE_TASKS.map(task => task.acquisitionFailureDomain)).size, REGISTRY_STATES.length);
  for (const task of MEASURE_TRANSLATION_ROUTINE_TASKS) {
    assert.equal(task.sourceId, "curated-reader-primary-sources");
    assert.equal(task.recordClass, "CURATED_READER_RECORD");
    assert.deepEqual(task.command, ["scripts/measure-translation-routine.mts", `--state=${task.id.split(":")[1]}`]);
    assert.equal(routineTaskDue(task, undefined, Date.parse(now)), true);
    const clock = { lastAttemptedAt: now, lastSucceededObservedAt: now };
    assert.equal(routineTaskDue(task, clock, Date.parse(now) + task.cadenceMs - 1), false);
    assert.equal(routineTaskDue(task, clock, Date.parse(now) + task.cadenceMs), true);
  }
  assert.match(measureTranslationRoutineTask("DC").scope, /district:dc$/);
  assert.match(measureTranslationRoutineTask("PR").scope, /territory:pr$/);
});

test("the production routine supervisor registers every state's independent translation task", () => {
  const scheduled = ROUTINE_SOURCE_TASKS.filter(task => task.id.startsWith("measure-translations:"));
  assert.deepEqual(scheduled.map(task => task.id), MEASURE_TRANSLATION_ROUTINE_TASKS.map(task => task.id));
  for (const expected of MEASURE_TRANSLATION_ROUTINE_TASKS) {
    const actual = scheduled.find(task => task.id === expected.id)!;
    assert.deepEqual(actual.command, expected.command);
    assert.equal(actual.scope, expected.scope);
    assert.equal(actual.retryMs, expected.retryMs);
    assert.equal(actual.ownerInvocation, undefined, "standing explainers do not depend on a research Send to keep their source clock");
  }
});
