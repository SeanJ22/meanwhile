import { fixturePlaybooks } from "./helpers/playbooks.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "./helpers/playbooks.ts";
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
  assert.equal(published.readerReadback?.status, "PASS", JSON.stringify(published.readerReadback));
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

test("source replay accepts official HTML entities and PDF line breaks while rejecting invented passages", async () => {
  const text = source.replace("library services", "library\nservices").replace("adopts the levy", "adopts&nbsp;the levy");
  const primary = { ...evidence, text, contentHash: `sha256-${translationHash(text)}` };
  const proposed = { ...measure, sourceHash: translationHash(text) };
  const result = await translateMeasure({ repos: createMemoryRepositories(), evidence: primary, subject, now,
    transportFor: () => async request => response(request, request.tools[0].name === "write_measure_translation" ? { measure: proposed, sentences } : { checked }) });
  assert.equal(translationRecordIssue(result.record), null);
  assert.match(translationRecordIssue({ ...result.record, sentences: [{ ...sentences[0], quote: "An invented benefit." }, ...sentences.slice(1)] })!, /source passage/);
});

test("a checked explainer attaches to a measure with no hand-made record and retains the official Sources link", async () => {
  const { record } = await translateMeasure({ repos: createMemoryRepositories(), evidence, subject, now,
    transportFor: () => async request => response(request, request.tools[0].name === "write_measure_translation" ? { measure, sentences } : { checked }) });
  const ballot = { contests: [{ id: subject.contestId, ocdId: subject.ocdId, type: "MEASURE", provenance: { sourceUrl: evidence.canonicalUrl } }],
    measures: [{ contestId: subject.contestId, questionText: source, provenance: { sourceUrl: evidence.canonicalUrl } }],
  } as unknown as BallotSet;
  const translated = withMeasureTranslations(ballot, [record]);
  assert.deepEqual(translated.measureRecords, [measure]);
  assert.equal(translated.measures[0].provenance.sourceUrl, translated.measureRecords![0].sourceUrl);
  for (const wrong of [{ ...record, ocdId: "ocd-division/country:us/state:mi" },
    { ...record, sourceUrl: "https://other.example.gov/measure" },
    { ...record, checked: checked.slice(1) },
    { ...record, subjectId: "different-measure" }]) {
    assert.equal(withMeasureTranslations(ballot, [wrong]), ballot);
  }
});

test("checked summary and vote meanings preserve legacy reaction parts and ignore an older translation", async () => {
  const { record } = await translateMeasure({ repos: createMemoryRepositories(), evidence, subject, now,
    transportFor: () => async request => response(request, request.tools[0].name === "write_measure_translation" ? { measure, sentences } : { checked }) });
  const parts = [{ id: `${measure.contestId}#funding`, number: null, kind: "FUNDING", label: "Funding", what: measure.whatItDoes }];
  const prior = { ...measure, noMeans: null, parts };
  const ballot = { contests: [{ id: subject.contestId, ocdId: subject.ocdId, type: "MEASURE" }], measureRecords: [prior] } as unknown as BallotSet;
  const translated = withMeasureTranslations(ballot, [record]);
  assert.equal(translated.measureRecords![0].noMeans, measure.noMeans);
  assert.deepEqual(translated.measureRecords![0].parts, parts);
  const newer = { ...ballot, measureRecords: [{ ...prior, sourceHash: "a".repeat(64), writtenAt: "2026-10-06T18:00:00Z" }] };
  assert.equal(withMeasureTranslations(newer, [record]), newer);
});

test("writer and checker require both vote meanings and forbid favoring a side", async () => {
  for (const missing of ["yesMeans", "noMeans"] as const) {
    const requests: ModelRequest[] = [];
    await assert.rejects(translateMeasure({ repos: createMemoryRepositories(), evidence, subject, now,
      transportFor: () => async request => {
        requests.push(request);
        return response(request, request.tools[0].name === "write_measure_translation"
          ? { measure: { ...measure, [missing]: null }, sentences: sentences.filter(row => row.field !== missing) }
          : { checked: checked.filter(row => row.field !== missing) });
      } }), /vote meanings/);
    assert.match(requests[0].messages[0].content as string, /Never recommend, judge, endorse, favor/);
    assert.match(requests[1].messages[0].content as string, /Reject recommendations, judgments, persuasion/);
  }
});

test("both model calls retain the existing budget transport and a refusal prevents further work", async () => {
  let calls = 0;
  await assert.rejects(translateMeasure({ repos: createMemoryRepositories(), evidence, subject, now,
    transportFor: () => async () => { calls++; throw new Error("DENIED_BY_POLICY: existing budget paused"); } }), /existing budget paused/);
  assert.equal(calls, 1);
});

test("the next translator start reads the latest Bank playbook and distinct allowed models", async () => {
  const repos = createMemoryRepositories(), defaults = translationPlaybook(fixturePlaybooks(["MEASURE_WRITER", "MEASURE_CHECKER"]));
  const entry = newFieldManualEntry("role-playbook", "MEASURE_CHECKER", { role: "MEASURE_CHECKER", kind: "PLAYBOOK", title: "Measure translation",
    summary: "Translate only official text", outcome: "REFERENCE", observedAt: now, recordClasses: ["BALLOT_MEASURE"],
    payload: { text: "Keep every material exception.", model: defaults.checkerModel } });
  await writeFieldManual(repos, [entry], now);
  let system = "";
  await translateMeasure({ repos, evidence, subject, now, transportFor: () => async request => {
    system = request.system[0].text;
    return response(request, request.tools[0].name === "write_measure_translation" ? { measure, sentences } : { checked });
  } });
  assert.match(system, /Keep every material exception/);
  assert.match(system, /Preserve existing spending limits/);
  assert.throws(() => translationPlaybook([...fixturePlaybooks(["MEASURE_WRITER"]), { ...entry, payload: { ...entry.payload as object, model: defaults.writerModel } }]), /distinct supported/);
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

test("a checked measure captured earlier publishes beside a newer source without losing either retrieval date", async () => {
  const store = new MemoryRoutineDataStore();
  const { record } = await translateMeasure({ repos: createMemoryRepositories(), subject, evidence, now,
    transportFor: () => async request => response(request, request.tools[0].name === "write_measure_translation" ? { measure, sentences } : { checked }) });
  const captured = { evidence, observedAt: now, httpStatus: 200, partial: false, transport: "REACHABLE" as const };
  await publishMeasureTranslation(store, { record, captures: [captured], now });
  const earlierAt = "2026-10-05T17:59:00Z";
  const older = { ...record, id: "translation:measure:13", subjectId: "measure:13", retrievedAt: earlierAt,
    measure: { ...measure, contestId: "measure:13" } };
  const result = await publishMeasureTranslation(store, { record: older,
    captures: [{ ...captured, evidence: { ...evidence, retrievedAt: earlierAt }, observedAt: earlierAt }], now });
  assert.equal(result.readerReadback?.status, "PASS", JSON.stringify(result));
  const records = await readTranslations([subject.ocdId], { store, now, bypassCache: true });
  assert.equal(records.length, 2);
  assert.equal(records.find(row => row.subjectId === "measure:13")!.retrievedAt, earlierAt);
  assert.equal(records.find(row => row.subjectId === "measure:12")!.retrievedAt, now);
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
    transportFor: () => async request => {
      if (request.tools[0].name === "write_measure_translation") {
        assert.match(request.messages[0].content as string, /parts\.<exact part id>\.label/);
        assert.match(JSON.stringify(request.tools[0].input_schema), /exact contestId followed by #/);
        assert.match(JSON.stringify(request.tools[0].input_schema), /One contiguous exact supporting passage/);
      }
      return response(request, request.tools[0].name === "write_measure_translation"
        ? { measure: proposed, sentences: support } : { checked: support.map(({ field, text }) => ({ field, text, supported: true })) });
    } });
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
