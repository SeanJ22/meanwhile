import { measureDraft, measureRequestContext } from "./helpers/measure-translation.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { publishTranslation, readTranslations } from "../lib/translate/publication.ts";
import { measureTranslationRoutineReceipt } from "../lib/translate/routine-receipt.ts";
import { CARD_WRITING_RULES } from "../lib/reader/card-writer.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue } from "../lib/civic-data/runner.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import { MEASURE_WRITING_VERSION, translationHash } from "../lib/translate/records.ts";
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
      const message = measureRequestContext(request);
      const measure = { contestId: message.subject.contestId, whatItDoes: summary, yesMeans: yes, noMeans: no, parts: [],
        sourceUrl, sourceHash: translationHash(text), writtenAt: now };
      const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field,
        text: measure[field as "whatItDoes"], quote: measure[field as "whatItDoes"] }));
      return { model: request.model, stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: "tool_use", id: "result", name: request.tools[0].name, input: request.tools[0].name === "write_measure_translation"
          ? measureDraft(measure, sentences) : { checked: sentences.map(({ field, text }) => ({ field, text, supported: checkerPass })) } }],
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

test("a measure with no saved official text stays an open blank while every other measure publishes and the pass reports no save failure", async () => {
  const f = fixture();
  const blank = { id: "measure:14", title: "Proposition 14", type: "MEASURE", ocdId: division, provenance: { sourceUrl: "https://elections.example.gov/prop-14" } };
  const ballot = { ...f.ballot, contests: [...f.ballot.contests, blank] } as unknown as BallotSet;
  const result = await runMeasureTranslationPass({ ...f.input, loadBallotsForState: async () => [ballot] });
  assert.equal(result.totalMeasures, 3);
  assert.equal(result.checkedAfter, 2, JSON.stringify(result));
  assert.deepEqual(result.held, [{ state: "OH", subjectId: "measure:14", reason: "No complete current source capture is held." }]);
  assert.equal(result.persistenceError, null, "only a failed save may hold the run");
  assert.deepEqual(result.unreadable, []);
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
  assert.deepEqual(first.outcomes.map(row => [row.status, row.usage.length]), [["HELD", 4], ["HELD", 4]]);
  const second = await runMeasureTranslationPass(f.input);
  assert.equal(second.held.length, 2);
  assert.equal(f.calls.length, 8, "the existing attempt retry clock prevents duplicate paid calls");
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

test("a pass reads each division's checked explainers once, never again for every missing measure", async () => {
  const f = fixture();
  const send = f.input.guardedTransportFor();
  const refused = (contests: readonly string[]) => () => async (request: ModelRequest) => {
    if (contests.includes(measureRequestContext(request).subject.contestId)) throw new Error("SendBudgetRefusal(SCOPE_BUDGET): fixture budget is spent");
    return send(request);
  };
  const first = await runMeasureTranslationPass({ ...f.input, guardedTransportFor: refused(["measure:13"]) });
  assert.deepEqual(first.outcomes.map(row => [row.subjectId, row.status]), [["measure:12", "PUBLISHED"], ["measure:13", "HELD"]]);
  // Two more measures cite the same held text; they reuse the pass's compact projection.
  const ballot = { ...f.ballot, contests: [...f.ballot.contests, ...[14, 15].map(number => ({ id: `measure:${number}`, title: `Proposition ${number}`,
    type: "MEASURE", ocdId: division, measureTextUrl: sourceUrl, provenance: { sourceUrl } }))] } as unknown as BallotSet;
  const store = f.input.store, reads = { promotion: 0, candidate: 0 };
  const readPromotion = store.readPromotion.bind(store), readCandidateProof = store.readCandidateProof.bind(store), readCandidate = store.readCandidate.bind(store);
  store.readPromotion = (async (...args: Parameters<typeof readPromotion>) => { reads.promotion++; return readPromotion(...args); }) as typeof store.readPromotion;
  store.readCandidateProof = async id => { reads.candidate++; return readCandidateProof(id); };
  store.readCandidate = async id => { reads.candidate++; return readCandidate(id); };
  const second = await runMeasureTranslationPass({ ...f.input, now: "2026-10-20T18:15:00.000Z", loadBallotsForState: async () => [ballot],
    paidWorkerCapacity: () => 3, guardedTransportFor: refused(["measure:13", "measure:14", "measure:15"]) });
  assert.deepEqual(second.outcomes.map(row => row.status), ["HELD", "HELD", "HELD"], JSON.stringify(second));
  assert.deepEqual(reads, { promotion: 1, candidate: 0 }, "the pass reads its projection once and only metadata, never a whole candidate");
});


test("a 5 MB Maryland source is vaulted once, publishes below the limit, and adds no spend on the next run", async () => {
  const f = fixture(), vault = new MemoryEvidenceStore();
  const large = text + " Official ballot style and election instructions.".repeat(115000);
  assert.ok(Buffer.byteLength(large) > 5_000_000);
  const md = "ocd-division/country:us/state:md/county:baltimore_24510";
  const ballot = { ...f.ballot, election: { ...f.ballot.election, state: "MD" },
    contests: f.ballot.contests.map(row => ({ ...row, ocdId: md })) };
  const capture: WorkerPublicationCapture = { evidence: { artifactId: "maryland-source", acquiredByAttemptId: "source-held",
    sourceId: "Election office", methodRouteId: "measure-text", canonicalUrl: sourceUrl,
    contentHash: `sha256-${translationHash(large)}`, retrievedAt: now, text: large },
    observedAt: now, partial: false, httpStatus: 200, transport: "REACHABLE" };
  const create = f.input.store.create.bind(f.input.store), sizes: number[] = [];
  f.input.store.create = async (record, event) => {
    const size = Buffer.byteLength(JSON.stringify(record)); sizes.push(size);
    assert.ok(size < 64 * 1024 * 1024, "the actual candidate sent to the database stays below its request limit");
    return create(record, event);
  };
  f.input.store.readCandidate = async () => { throw new Error("Whole candidate reads are forbidden"); };
  const input = { ...f.input, states: ["MD"], vault, loadBallotsForState: async () => [ballot], loadCapturesForState: async () => [capture] };
  const first = await runMeasureTranslationPass(input);
  assert.equal(first.checkedAfter, 2, JSON.stringify(first));
  assert.equal(f.calls.length, 4);
  assert.ok(CARD_WRITING_RULES.every(rule => f.calls[0].system[0].text.includes(rule)));
  const projection = await f.input.store.readPromotion<{ records: import("../lib/translate/records.ts").MeasureTranslation[] }>("CURATED_READER_RECORD", `US:plain-english-translations:${md}`);
  assert.equal(projection?.payload.records.length, 2);
  const rows = projection!.payload.records;
  assert.ok(rows.every(row => Buffer.byteLength(JSON.stringify(row)) < 1_000_000));
  assert.equal(rows[0].sourceCapture?.vaultKey, rows[1].sourceCapture?.vaultKey);
  assert.equal((await vault.list("project/freshness/")).length, 1);
  const before = (await f.input.repos.costs.readAll()).reduce((sum, row) => sum + (row.cost.usd ?? 0), 0);
  assert.ok(before > 0, "the first run retains both real model prices");
  const second = await runMeasureTranslationPass({ ...input, now: "2026-10-20T18:15:00.000Z" });
  assert.equal(second.checkedAfter, 2, JSON.stringify(second));
  assert.equal(second.outcomes.length, 0);
  assert.equal(f.calls.length, 4);
  const after = (await f.input.repos.costs.readAll()).reduce((sum, row) => sum + (row.cost.usd ?? 0), 0);
  assert.equal(after, before);
  const receipt = await measureTranslationRoutineReceipt({ store: f.input.store, state: "MD", ballots: [ballot], now: "2026-10-20T18:15:00.000Z", holdReason: null });
  assert.equal(receipt.exitCode, 0, JSON.stringify(receipt));
  assert.ok(sizes.every(size => size < 1_000_000), "neither publication nor losing-fact evidence puts the full source back into a candidate");
});

test("a held explainer written under older rules, in any state, is rewritten once at the 9th-grade level and replaces the old record", async () => {
  const f = fixture(), az = "ocd-division/country:us/state:ia";
  const ballot = { ...f.ballot, election: { ...f.ballot.election, state: "IA" }, contests: f.ballot.contests.map(row => ({ ...row, ocdId: az })) };
  const input = { ...f.input, states: ["IA"], loadBallotsForState: async () => [ballot] };
  assert.equal((await runMeasureTranslationPass(input)).checkedAfter, 2);
  const projection = await f.input.store.readPromotion<{ records: import("../lib/translate/records.ts").MeasureTranslation[] }>("CURATED_READER_RECORD", `US:plain-english-translations:${az}`);
  for (const row of projection!.payload.records) {
    const { writingRulesVersion: _oldStyle, ...old } = row;
    const evidence = { artifactId: "official", acquiredByAttemptId: "held", sourceId: "Election office", methodRouteId: "measure-text",
      canonicalUrl: sourceUrl, contentHash: `sha256-${translationHash(text)}`, retrievedAt: now, text };
    await publishTranslation(f.input.store, { record: old, now, captures: [{ evidence, observedAt: now, partial: false, httpStatus: 200, transport: "REACHABLE" }] });
  }
  const rewrite = await runMeasureTranslationPass(input);
  assert.equal(rewrite.checkedAfter, 2, JSON.stringify(rewrite));
  assert.equal(f.calls.length, 8);
  assert.ok(CARD_WRITING_RULES.every(rule => f.calls[4].system[0].text.includes(rule)));
  const writerAsk = measureRequestContext(f.calls[4]).instruction as string, checkerAsk = measureRequestContext(f.calls[5]).instruction as string;
  assert.match(writerAsk, /9th-grade reading level/);
  assert.match(writerAsk, /no legal wording/);
  assert.doesNotMatch(writerAsk, /high-school/);
  assert.match(checkerAsk, /legal wording/);
  assert.match(checkerAsk, /above a 9th-grade level/);
  assert.match(checkerAsk, /do not support/);
  const rewritten = await readTranslations([az], { store: f.input.store, now });
  assert.equal(rewritten.length, 2, "one record per measure; the old wording is replaced, not kept beside the new");
  assert.ok(rewritten.every(row => row.kind === "MEASURE" && row.writingRulesVersion === MEASURE_WRITING_VERSION));
  await runMeasureTranslationPass({ ...input, now: "2026-10-20T18:15:00.000Z" });
  assert.equal(f.calls.length, 8);
});


test("all legacy sources in a division compact together without a model or an oversized intermediate candidate", async () => {
  const f = fixture(), vault = new MemoryEvidenceStore(), md = "ocd-division/country:us/state:md";
  const large = text + " The original official source is retained in the vault.".repeat(100000);
  const hash = translationHash(large);
  const measure = { contestId: "measure:12", whatItDoes: summary, yesMeans: yes, noMeans: no, parts: [], sourceUrl, sourceHash: hash, writtenAt: now };
  const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field, text: measure[field as "whatItDoes"], quote: measure[field as "whatItDoes"] }));
  const legacy: import("../lib/translate/records.ts").MeasureTranslation = { id: "translation:measure:12", kind: "MEASURE", subjectId: "measure:12", ocdId: md,
    sourceUrl, sourceHash: hash, sourceText: large, sourceTextHash: hash, retrievedAt: now, writtenAt: now,
    writerModel: "writer", checkerModel: "checker", playbookVersion: translationHash("legacy"), writingRulesVersion: MEASURE_WRITING_VERSION, measure, sentences,
    checked: sentences.map(({ field, text }) => ({ field, text, supported: true })) };
  const evidence = { artifactId: "held", acquiredByAttemptId: "held", sourceId: "Election office", methodRouteId: "measure-text",
    canonicalUrl: sourceUrl, contentHash: `sha256-${hash}`, retrievedAt: now, text: large };
  const legacyRows = Array.from({ length: 6 }, (_, index) => ({ ...legacy,
    id: `translation:measure:${index + 12}`, subjectId: `measure:${index + 12}`, measure: { ...measure, contestId: `measure:${index + 12}` } }));
  assert.ok((await publishTranslation(f.input.store, { record: legacyRows[0], additionalRecords: legacyRows.slice(1), now,
    captures: [{ evidence, observedAt: now, partial: false, httpStatus: 200, transport: "REACHABLE" }] })).promoted);
  const create = f.input.store.create.bind(f.input.store);
  const candidateBytes: number[] = [];
  f.input.store.create = async (row, event) => {
    const bytes = Buffer.byteLength(JSON.stringify(row)); candidateBytes.push(bytes);
    assert.ok(bytes < 64_000_000, "the first maintenance publication must already fit Neon");
    return create(row, event);
  };
  f.input.store.readCandidate = async () => { throw new Error("Whole candidate reads are forbidden"); };
  const ballot = { ...f.ballot, election: { ...f.ballot.election, state: "MD" }, contests: [{ ...f.ballot.contests[0], ocdId: md }] };
  const result = await runMeasureTranslationPass({ ...f.input, states: ["MD"], vault, now: "2026-10-20T18:15:00.000Z", loadBallotsForState: async () => [ballot], modelLaneEnabled: false });
  assert.equal(result.checkedAfter, 1, JSON.stringify(result));
  assert.deepEqual(result.held, []);
  assert.equal(f.calls.length, 0);
  const projection = await f.input.store.readPromotion<{ records: typeof legacy[] }>("CURATED_READER_RECORD", `US:plain-english-translations:${md}`);
  assert.equal(projection!.payload.records.length, 6);
  assert.equal(candidateBytes.length, 1);
  assert.ok(projection!.payload.records.every(row => Buffer.byteLength(JSON.stringify(row)) < 1_000_000));
  assert.equal(projection!.payload.records[0].writtenAt, now);
  assert.equal(projection!.payload.records[0].retrievedAt, now);
  assert.equal((await vault.list("project/freshness/")).length, 1);
  const changes = await f.input.store.readCandidatePath(projection!.versionId, ["changeSet"]);
  assert.ok(Buffer.byteLength(JSON.stringify(changes)) < 10000);
  assert.equal((changes as { outcome: string }).outcome, "UNCHANGED");
});

test("stale legacy evidence refreshes only from the same official document without buying another model call", async () => {
  for (const changed of [false, true]) {
    const f = fixture(), vault = new MemoryEvidenceStore(), md = "ocd-division/country:us/state:md", old = "2026-10-01T18:00:00.000Z";
    const large = text + " The original official source remains available.".repeat(30000), hash = translationHash(large);
    const measure = { contestId: "measure:12", whatItDoes: summary, yesMeans: yes, noMeans: no, parts: [], sourceUrl, sourceHash: hash, writtenAt: old };
    const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field, text: measure[field as "whatItDoes"], quote: measure[field as "whatItDoes"] }));
    const legacy: import("../lib/translate/records.ts").MeasureTranslation = { id: "translation:measure:12", kind: "MEASURE", subjectId: "measure:12", ocdId: md,
      sourceUrl, sourceHash: hash, sourceText: large, sourceTextHash: hash, retrievedAt: old, writtenAt: old,
      writerModel: "writer", checkerModel: "checker", playbookVersion: translationHash("legacy"), writingRulesVersion: MEASURE_WRITING_VERSION, measure, sentences,
      checked: sentences.map(({ field, text }) => ({ field, text, supported: true })) };
    const evidence = { artifactId: "held", acquiredByAttemptId: "held", sourceId: "Election office", methodRouteId: "measure-text",
      canonicalUrl: sourceUrl, contentHash: `sha256-${hash}`, retrievedAt: old, text: large };
    await publishTranslation(f.input.store, { record: legacy, now: old, captures: [{ evidence, observedAt: old, partial: false, httpStatus: 200, transport: "REACHABLE" }] });
    const freshText = large + (changed ? " The law changed." : ""), fresh = { evidence: { ...evidence, text: freshText,
      contentHash: `sha256-${translationHash(freshText)}`, retrievedAt: now }, observedAt: now, partial: false, httpStatus: 200, transport: "REACHABLE" as const };
    const ballot = { ...f.ballot, election: { ...f.ballot.election, state: "MD" }, contests: [{ ...f.ballot.contests[0], ocdId: md }] };
    const result = await runMeasureTranslationPass({ ...f.input, states: ["MD"], vault, now, modelLaneEnabled: false,
      loadBallotsForState: async () => [ballot], loadCapturesForState: async () => [fresh] });
    assert.equal(f.calls.length, 0);
    const rows = await readTranslations([md], { store: f.input.store, now });
    assert.equal(rows[0].writtenAt, old);
    if (changed) {
      assert.ok(result.held.some(row => row.reason.includes("same official document")));
      assert.equal(rows[0].retrievedAt, old);
      assert.equal(rows[0].kind === "MEASURE" && rows[0].sourceCapture, undefined);
    } else {
      assert.equal(result.checkedAfter, 1, JSON.stringify(result));
      assert.deepEqual(result.held, []);
      assert.equal(rows[0].retrievedAt, now, "a real fresh capture supplies the new retrieval date");
      assert.ok(Buffer.byteLength(JSON.stringify(rows[0])) < 1_000_000);
    }
  }
});
