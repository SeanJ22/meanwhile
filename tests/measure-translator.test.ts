import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { newFieldManualEntry, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { WorkerEvidence } from "../lib/control-plane/workers/types.ts";
import { translateMeasure, translationPlaybook } from "../lib/translate/worker.ts";
import { translationHash, translationRecordIssue } from "../lib/translate/records.ts";
import { publishMeasureTranslation, readTranslations, withMeasureTranslations } from "../lib/translate/publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { MeasureRecord } from "../lib/ballot/measure-records.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { runMeasureTranslation } from "../lib/translate/runtime.ts";

const now = "2026-10-05T18:00:00Z";
const source = "Proposition 12. The levy funds library services. A YES vote adopts the levy. A NO vote keeps the current levy.";
const evidence: WorkerEvidence = { artifactId: "official-text", acquiredByAttemptId: "held", sourceId: "Fixture election office", methodRouteId: "measure",
  canonicalUrl: "https://elections.example.gov/proposition12", contentHash: `sha256-${translationHash(source)}`, text: source, retrievedAt: now };
const measure: MeasureRecord = { contestId: "measure:12", whatItDoes: "The levy funds library services.",
  yesMeans: "A YES vote adopts the levy.", noMeans: "A NO vote keeps the current levy.", parts: [],
  sourceUrl: evidence.canonicalUrl, sourceHash: translationHash(source), writtenAt: now };
const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field, text: measure[field as "whatItDoes"], quote: measure[field as "whatItDoes"] }));
const checked = sentences.map(({ field, text }) => ({ field, text, supported: true as const }));
const subject = { contestId: measure.contestId, title: "Proposition 12", ocdId: "ocd-division/country:us/state:oh/county:alder", state: "OH", prior: null };
const response = (request: ModelRequest, input: unknown): ModelResponse => ({ model: request.model, stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "result", name: request.tools[0].name, input }], usage: { input_tokens: 100, output_tokens: 50 } });

test("the guarded writer and independent checker publish exact source-supported meanings into the typed reader", async () => {
  const requests: ModelRequest[] = [];
  const result = await translateMeasure({ repos: createMemoryRepositories(), evidence, subject, now,
    transportFor: () => async request => { requests.push(request); return response(request, requests.length === 1 ? { measure, sentences } : { checked }); } });
  assert.equal(requests.length, 2); assert.notEqual(requests[0].model, requests[1].model);
  assert.equal(translationRecordIssue(result.record), null);
  assert.ok(result.usage.every(row => typeof row.usd === "number"));
  const store = new MemoryRoutineDataStore();
  const published = await publishMeasureTranslation(store, { record: result.record, now,
    captures: [{ evidence, observedAt: now, httpStatus: 200, partial: false, transport: "REACHABLE" }] });
  assert.ok(published.promoted, JSON.stringify(published.candidate));
  assert.equal(published.readerReadback?.status, "PASS");
  const held = await readTranslations([subject.ocdId], { store, now, bypassCache: true });
  assert.deepEqual(held, [result.record]);
  const ballot = { contests: [{ id: subject.contestId, ocdId: subject.ocdId, type: "MEASURE" }], measureRecords: [{ ...measure, noMeans: null }] } as unknown as BallotSet;
  assert.equal(withMeasureTranslations(ballot, held).measureRecords![0].noMeans, measure.noMeans);
  assert.equal(withMeasureTranslations(ballot, [{ ...result.record, ocdId: "ocd-division/country:us/state:mi" }]).measureRecords![0].noMeans, null);
});

test("an unsupported writer sentence or failed independent check never publishes a translation", async () => {
  for (const failure of ["quote", "checker", "truncation", "identity"]) {
    let calls = 0;
    await assert.rejects(translateMeasure({ repos: createMemoryRepositories(), evidence, subject, now,
      transportFor: () => async request => {
        calls++;
        if (calls === 1) return { ...response(request, { measure: failure === "identity" ? { ...measure, contestId: "other" } : measure,
          sentences: failure === "quote" ? [{ ...sentences[0], quote: "Invented benefit." }, ...sentences.slice(1)] : sentences }),
          ...(failure === "truncation" ? { stop_reason: "max_tokens" } : {}) };
        return response(request, { checked: checked.map((row, at) => ({ ...row, supported: failure !== "checker" || at !== 0 })) });
      } }));
    assert.equal(calls, failure === "checker" ? 2 : 1);
  }
});

test("both model calls retain the existing budget transport and a refusal prevents further work", async () => {
  let calls = 0;
  await assert.rejects(translateMeasure({ repos: createMemoryRepositories(), evidence, subject, now,
    transportFor: () => async () => { calls++; throw new Error("DENIED_BY_POLICY: existing budget paused"); } }), /existing budget paused/);
  assert.equal(calls, 1);
});

test("the next translator start reads the latest Bank playbook and distinct allowed models", async () => {
  const repos = createMemoryRepositories(), defaults = translationPlaybook([]);
  const entry = newFieldManualEntry("translator", "measure", { role: "SHARED", kind: "PLAYBOOK", title: "Measure translation",
    summary: "Translate only official text", outcome: "REFERENCE", observedAt: now, recordClasses: ["BALLOT_MEASURE"],
    payload: { translator: true, text: "Keep every material exception.", writerModel: defaults.writerModel, checkerModel: defaults.checkerModel } });
  await writeFieldManual(repos, [entry], now);
  let system = "";
  await translateMeasure({ repos, evidence, subject, now, transportFor: () => async request => {
    system = request.system[0].text;
    return response(request, request.tools[0].name === "write_measure_translation" ? { measure, sentences } : { checked });
  } });
  assert.match(system, /Keep every material exception/);
  assert.match(system, /Preserve existing spending limits/);
  assert.throws(() => translationPlaybook([{ ...entry, payload: { ...entry.payload as object, checkerModel: defaults.writerModel } }]), /distinct supported/);
});

test("a changed source is rewritten, an unchanged source costs nothing, and a failed check retains the last GOOD version and metered usage", async () => {
  const repos = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  let calls = 0, rejectCheck = false;
  const run = (primary = evidence) => runMeasureTranslation({ repos, store, subject, now, primary: {
    evidence: primary, observedAt: now, httpStatus: 200, partial: false, transport: "REACHABLE",
  }, captures: [{ evidence: primary, observedAt: now, httpStatus: 200, partial: false, transport: "REACHABLE" }],
  transportFor: () => async request => {
    calls++;
    return response(request, request.tools[0].name === "write_measure_translation"
      ? { measure: { ...measure, sourceHash: primary.contentHash.replace(/^sha256-/, "") }, sentences }
      : { checked: checked.map(row => ({ ...row, supported: !rejectCheck })) });
  } });
  const first = await run(); assert.equal(first.status, "PUBLISHED", JSON.stringify(first)); assert.equal(calls, 2);
  assert.equal((await run()).status, "REUSED"); assert.equal(calls, 2);
  rejectCheck = true;
  const changed = { ...evidence, text: `${source} The next review is in 2028.`, contentHash: `sha256-${translationHash(`${source} The next review is in 2028.`)}` };
  const refused = await run(changed); assert.equal(refused.status, "HELD"); assert.equal(refused.usage.length, 2);
  assert.deepEqual((await readTranslations([subject.ocdId], { store, now, bypassCache: true }))[0], first.record);
  rejectCheck = false;
  const rewritten = await run(changed); assert.equal(rewritten.status, "PUBLISHED", JSON.stringify(rewritten));
  assert.equal(rewritten.record?.sourceHash, changed.contentHash.replace(/^sha256-/, ""));
  assert.notEqual(rewritten.versionId, first.versionId);
});

test("a translation for another exact district remains separate and same-place publication retains another checked subject", async () => {
  const store = new MemoryRoutineDataStore(), repos = createMemoryRepositories();
  const translate = () => translateMeasure({ repos, subject, evidence, now,
    transportFor: () => async request => response(request, request.tools[0].name === "write_measure_translation" ? { measure, sentences } : { checked }) });
  const { record } = await translate();
  const captures = [{ evidence, observedAt: now, httpStatus: 200, partial: false, transport: "REACHABLE" as const }];
  await publishMeasureTranslation(store, { record, captures, now });
  const other = { ...record, id: "translation:measure:13", subjectId: "measure:13", measure: { ...measure, contestId: "measure:13" } };
  const published = await publishMeasureTranslation(store, { record: other, captures, now });
  assert.ok(published.promoted, JSON.stringify(published.candidate));
  assert.equal((await readTranslations([subject.ocdId], { store, now, bypassCache: true })).length, 2);
  const elsewhere = "ocd-division/country:us/state:mi/county:birch";
  await publishMeasureTranslation(store, { record: { ...record, ocdId: elsewhere }, captures, now });
  assert.equal((await readTranslations([elsewhere], { store, now, bypassCache: true })).length, 1);
  assert.equal((await readTranslations([subject.ocdId], { store, now, bypassCache: true })).length, 2);
});

test("officially numbered parts retain their reaction identities on a checked rewrite", async () => {
  const original = `${source}\n1. Funding. The levy funds library services.\n2. Oversight. The board reviews spending each year.`;
  const primary = { ...evidence, text: original, contentHash: `sha256-${translationHash(original)}` };
  const parts = [
    { id: `${measure.contestId}#funding`, number: "1", kind: "FUNDING" as const, label: "Funding", what: "The levy funds library services." },
    { id: `${measure.contestId}#oversight`, number: "2", kind: "OVERSIGHT" as const, label: "Oversight", what: "The board reviews spending each year." },
  ];
  const proposed = { ...measure, sourceHash: translationHash(original), parts };
  const support = [...sentences, ...parts.flatMap(part => [
    { field: `parts.${part.id}.label`, text: part.label, quote: part.label },
    { field: `parts.${part.id}.what`, text: part.what, quote: part.what },
  ])];
  const result = await translateMeasure({ repos: createMemoryRepositories(), evidence: primary, subject: { ...subject, prior: proposed }, now,
    transportFor: () => async request => response(request, request.tools[0].name === "write_measure_translation"
      ? { measure: proposed, sentences: support } : { checked: support.map(({ field, text }) => ({ field, text, supported: true })) }) });
  assert.deepEqual(result.record.measure.parts.map(part => [part.id, part.number]), parts.map(part => [part.id, part.number]));
});

test("an independent checker cannot authorize an invented official part number", async () => {
  const part = { id: `${measure.contestId}#funding`, number: "7", kind: "FUNDING" as const, label: "Funding", what: measure.whatItDoes };
  const support = [...sentences, { field: `parts.${part.id}.label`, text: part.label, quote: "funds" },
    { field: `parts.${part.id}.what`, text: part.what, quote: part.what }];
  await assert.rejects(translateMeasure({ repos: createMemoryRepositories(), evidence, subject, now,
    transportFor: () => async request => response(request, request.tools[0].name === "write_measure_translation"
      ? { measure: { ...measure, parts: [part] }, sentences: support }
      : { checked: support.map(({ field, text }) => ({ field, text, supported: true })) }) }), /unique numbering/);
});

test("a rewrite cannot drop or move a prior reaction identity to another official number", async () => {
  const prior = { ...measure, parts: [{ id: `${measure.contestId}#funding`, number: "1", kind: "FUNDING" as const, label: "Funding", what: measure.whatItDoes }] };
  for (const parts of [[], [{ ...prior.parts[0], number: "2" }]]) {
    let calls = 0;
    await assert.rejects(translateMeasure({ repos: createMemoryRepositories(), evidence, subject: { ...subject, prior }, now,
      transportFor: () => async request => { calls++; return response(request, { measure: { ...measure, parts }, sentences }); } }), /reaction identity/);
    assert.equal(calls, 1, "unsupported identity rewrites stop before another paid model call");
  }
});
