import { stateBallotContractId } from "../lib/ballot/state-scopes.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseCivicRecords } from "../lib/control-plane/workers/parser.ts";
import type { GeneralizedCivicExtractionContract, WorkerEvidence, WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";
import type { RegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { workerBallotContestsPackage, mergeBallotContests } from "../lib/civic-data/worker-ballot-contests.ts";
import { workerReaderClassMatches } from "../lib/civic-data/worker-reader-contracts.ts";
import { manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { readPlaceMeasureProjection } from "../lib/ballot/place-measures.ts";
import { loadBallotForDivisions } from "../lib/ask/server-sources.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { readMeasureSource, validateBallotMeasureEvidence } from "../lib/ballot/measure-evidence.ts";
import type { MeasureSourceReference } from "../lib/ballot/types.ts";
import { DEFAULT_SOURCE_POLICY } from "../lib/control-plane/promotion/source-kinds.ts";
import { readMeasurePlaces } from "../lib/translate/national.ts";
import { placeMeasureScope } from "../lib/ballot/place-measures.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { readerBallotSourceForTargetId } from "../lib/ballot/reader-sources.ts";
import { getProvisionTargetIds } from "../lib/ballot/measure-provisions.ts";
import { measureRecordsForBallot } from "../lib/ballot/measure-records.ts";
import { createMemoryRepositories } from "./helpers/playbooks.ts";
import { translateMeasure } from "../lib/translate/worker.ts";
import { publishTranslation } from "../lib/translate/publication.ts";
import { translationScope } from "../lib/translate/records.ts";

const now = "2026-10-05T18:00:00Z";
async function fixture(state = "OH", prefix = `state:${state.toLowerCase()}/county:alder`, sourceText?: string) {
  const division = `ocd-division/country:us/${prefix}`;
  const documentUrl = "https://alder.example.gov/measure-12", title = "Proposition 12";
  const question = "Shall the library levy be adopted? A YES vote adopts the levy. A NO vote keeps the existing levy.";
  const fields = ["election", "title", "number", "jurisdictionName", "questionText", "textUrl", "electionDate"];
  const row = ["General election", title, "12", "Alder County", question, documentUrl, "2026-11-03"];
  const text = fields.join(",") + "\n" + row.map(value => '"'+value.replaceAll('"','""')+'"').join(",");
  const evidence: WorkerEvidence = { artifactId: "measure-list", acquiredByAttemptId: "held-list", sourceId: "Fixture election authority",
    methodRouteId: "registered-list", canonicalUrl: "https://alder.example.gov/ballot", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`, text, retrievedAt: now };
  const fullText = sourceText ?? `${title}\n${question}`;
  const document: WorkerEvidence = { ...evidence, artifactId: "full-measure", canonicalUrl: documentUrl, text: fullText,
    contentHash: `sha256-${createHash("sha256").update(fullText).digest("hex")}` };
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "BALLOT_MEASURE", subjectId: "fixture-government",
    jurisdiction: { country: "US", state, canonicalId: "fixture-government" }, identity: { namespace: "fixture-ballot", keyFields: ["election", "number", "jurisdictionName"] },
    sourceScope: { publisher: evidence.sourceId, sourceId: evidence.sourceId, routeIds: ["registered-list"], canonicalUrls: [evidence.canonicalUrl], observationArtifactIds: [evidence.artifactId] },
    methodVersion: 1, requiredFields: fields, completenessScope: "Every saved measure row", expectedSourceDate: null,
    extraction: { format: "DELIMITED_TEXT", delimiter: ",", headerRows: 1, fields: Object.fromEntries(fields.map((field, index) => [field, { source: index, type: "STRING" as const }])) },
    verification: { required: false, authorities: [] } };
  const parsed = parseCivicRecords({ attemptId: "parsed", worker: { role: "PARSER", instance: "fixture", provider: "deterministic", version: "2" }, evidence, contract });
  assert.equal(parsed.verdict, "EXTRACTED", JSON.stringify(parsed));
  const parser = { id: "parsed", workItemId: "measure", endedAt: now, result: parsed } as WorkerResultRecord;
  const plan = { contract, publication: { contractId: division.split("/").length > 3 ? "ballot-measures" : stateBallotContractId("ballot-contests", state), bodyId: "fixture-body" } } as AutonomousWorkPlan;
  const registry = { payload: { registry: { divisions: [{ state, label: "Alder County", ocdId: division, sourceDataset: "fixture" }] } } } as unknown as RegistryRuntimePrior;
  const evidenceStore = new MemoryEvidenceStore();
  const captures = await Promise.all([evidence, document].map(async evidence => {
    const bytes = Buffer.from(evidence.text), key = `project/freshness/source/elections/2026/10/05/measure/${evidence.contentHash}.txt`;
    await evidenceStore.put(key, bytes, { contentHash: evidence.contentHash, contentType: "text/plain", byteLength: bytes.length,
      custom: { tier: "RAW", canonicalUrl: evidence.canonicalUrl, retrievedAt: evidence.retrievedAt } });
    const sourceReference: MeasureSourceReference = { sourceUrl: evidence.canonicalUrl, sourceHash: evidence.contentHash.slice(7),
      retrievedAt: now, publisher: evidence.sourceId, vault: { key, byteLength: bytes.length, contentType: "text/plain" } };
    return { evidence, sourceReference, observedAt: now, partial: false, transport: "REACHABLE" as const, httpStatus: 200 };
  }));
  return { division, question, plan, parser, registry, now, captures, evidenceStore };
}

test("local measures publish in their own place with full official text references and reach Ask", async () => {
  assert.equal(workerReaderClassMatches("ballot-contests:OH", "BALLOT_MEASURE"), true);
  for (const [state, prefix] of [["OH", "state:oh/county:alder"], ["OH", "state:oh/place:alder"], ["OH", "state:oh/school_district:alder"], ["MI", "state:mi/county:alder"], ["DC", "district:dc/ward:1"], ["PR", "territory:pr/municipio:alder"]]) {
    const input = await fixture(state, prefix), checked = workerBallotContestsPackage(input), store = new MemoryRoutineDataStore();
    assert.deepEqual(checked.heldContests, []);
    await validateBallotMeasureEvidence(Object.values((checked.package.payload as GenericBallotProjection).ballots)[0], input.evidenceStore);
    const published = await processRegisteredManualCandidate(store, checked.package.contractId, manualProjectionCandidate(checked.package), now, null, { vault: input.evidenceStore });
    assert.ok(published.promoted, JSON.stringify(published.candidate)); assert.equal(published.readerReadback?.status, "PASS");
    assert.equal(await store.readPromotion("BALLOT_CANDIDACY", "US:state-election-ballots"), null);
    const read = await readPlaceMeasureProjection(input.division, { store, now, bypassCache: true }); assert.equal(read.kind, "PROMOTED");
    if (read.kind !== "PROMOTED") continue;
    const ballot = Object.values(read.value.ballots)[0];
    assert.equal(ballot.measures[0].questionText, input.question); assert.equal(ballot.measures[0].officialNumber, "12");
    assert.equal(await readMeasureSource(input.evidenceStore, ballot.measures[0].officialText!), input.captures[1].evidence.text);
    assert.equal("text" in ballot.measures[0].officialText!, false);
    assert.equal(ballot.measures[0].officialText?.sourceHash, ballot.measureRecords?.[0].sourceHash);
    assert.equal(ballot.measureRecords?.[0].noMeans, "A NO vote keeps the existing levy.");
    assert.deepEqual(ballot.measureRecords?.[0].parts, []); assert.equal(ballot.contests[0].voteFor, null);
    const loaded = await loadBallotForDivisions([input.division], { store, now, bypassCache: true });
    assert.equal(loaded.set?.measures[0].questionText, input.question); assert.deepEqual(loaded.loaderFailures, []);
  }
});

test("a reader receives every touching local measure beside the state election without widening a place", async () => {
  const store = new MemoryRoutineDataStore();
  const divisions = ["state:oh", "state:oh/county:alder", "state:oh/place:alder", "state:oh/school_district:alder", "state:oh/place:other"];
  for (const division of divisions) {
    const input = await fixture("OH", division), checked = workerBallotContestsPackage(input);
    const outcome = await processRegisteredManualCandidate(store, checked.package.contractId, manualProjectionCandidate(checked.package), now, null, { vault: input.evidenceStore });
    assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify(outcome));
  }
  const loaded = await loadBallotForDivisions(divisions.slice(0, 4).map(division => `ocd-division/country:us/${division}`), { store, now, bypassCache: true });
  assert.equal(loaded.contests.length, 4);
  assert.equal(loaded.set?.measures.length, 4);
  assert.ok(loaded.contests.every(contest => !contest.ocdId.endsWith("place:other")));
  assert.deepEqual(loaded.loaderFailures, []);
});

test("national measure reaction authority attaches checked parts absent from the raw ballot and rejects unrelated targets", async () => {
  const text = "Proposition 12\nSECTION 1. Library levy. Shall the library levy be adopted? A YES vote adopts the levy. A NO vote keeps the existing levy.";
  const input = await fixture("OH", "state:oh", text), raw = workerBallotContestsPackage(input).package, store = new MemoryRoutineDataStore();
  const published = await processRegisteredManualCandidate(store, raw.contractId, manualProjectionCandidate(raw), now, null, { vault: input.evidenceStore });
  assert.ok(published.promoted, JSON.stringify(published.candidate));
  const ballot = Object.values((raw.payload as GenericBallotProjection).ballots)[0], prior = ballot.measureRecords![0];
  assert.deepEqual(prior.parts, []);
  const part = { id: `${prior.contestId}#library`, number: "1", kind: "PROGRAM", label: "Library levy", what: "A YES vote adopts the levy." };
  const measure = { ...prior, whatItDoes: "A YES vote adopts the levy.", yesMeans: "A YES vote adopts the levy.", noMeans: "A NO vote keeps the existing levy.", parts: [part] };
  const support = [
    ...(["whatItDoes", "yesMeans", "noMeans"] as const).map(field => ({ field, text: measure[field], quote: measure[field] })),
    { field: `parts.${part.id}.label`, text: part.label, quote: part.label },
    { field: `parts.${part.id}.what`, text: part.what, quote: part.what },
  ];
  const questionSourceUrl = ballot.measures[0].provenance.sourceUrl;
  assert.ok(questionSourceUrl);
  const translation = await translateMeasure({ repos: createMemoryRepositories(), evidence: input.captures[1].evidence,
    sourceReference: input.captures[1].sourceReference, now, subject: { contestId: prior.contestId, title: ballot.contests[0].title,
      state: "OH", ocdId: input.division, prior: null, ballotQuestion: { text: ballot.measures[0].questionText, sourceUrl: questionSourceUrl } },
    transportFor: () => async request => ({ model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "result", name: request.tools[0].name,
      input: request.tools[0].name === "write_measure_translation" ? { measure, sentences: support }
        : { checked: support.map(({ field, text }) => ({ field, text, supported: true })) } }], usage: { input_tokens: 100, output_tokens: 50 } }) });
  const outcome = await publishTranslation(store, { record: translation.record, captures: input.captures, now });
  assert.ok(outcome.promoted, JSON.stringify(outcome.candidate));
  const scopes: string[] = [], read = store.readPromotion.bind(store);
  store.readPromotion = async (recordClass, scope) => { scopes.push(scope); return read(recordClass, scope); };
  const authority = await readerBallotSourceForTargetId(part.id, [input.division], { store, now, bypassCache: true });
  assert.ok(authority);
  const held = authority.source.normalize(await authority.source.fetch());
  assert.ok(getProvisionTargetIds(measureRecordsForBallot(held)).has(part.id));
  assert.deepEqual(new Set(scopes.filter(scope => scope.startsWith("US:plain-english-translations"))), new Set([translationScope(input.division)]));
  assert.equal(await readerBallotSourceForTargetId(`${prior.contestId}#invented`, [input.division], { store, now, bypassCache: true }), null);
  assert.equal(await readerBallotSourceForTargetId(`other-measure#library`, [input.division], { store, now, bypassCache: true }), null);
  const elsewhere = "ocd-division/country:us/state:mi";
  const foreignPart = { ...part, id: `${prior.contestId}#elsewhere` };
  const foreign = { ...translation.record, ocdId: elsewhere, measure: { ...measure, parts: [foreignPart] },
    sentences: translation.record.sentences.map(row => ({ ...row, field: row.field.replace(part.id, foreignPart.id) })),
    checked: translation.record.checked.map(row => ({ ...row, field: row.field.replace(part.id, foreignPart.id) })) };
  assert.ok((await publishTranslation(store, { record: foreign, captures: input.captures, now })).promoted);
  assert.equal(await readerBallotSourceForTargetId(foreignPart.id, [input.division], { store, now, bypassCache: true }), null);
});

test("translation input keysets one state's place pointers and loads only the yielded place", async () => {
  const store = new MemoryRoutineDataStore(), scopes: string[] = [];
  for (const suffix of ["county:alder", "place:alder", "school_district:alder"]) {
    const input = await fixture("OH", `state:oh/${suffix}`), checked = workerBallotContestsPackage(input);
    const outcome = await processRegisteredManualCandidate(store, checked.package.contractId, manualProjectionCandidate(checked.package), now, null, { vault: input.evidenceStore });
    assert.equal(outcome.readerReadback?.status, "PASS"); scopes.push(placeMeasureScope(input.division));
  }
  scopes.sort();
  const reads: string[] = [], promotion = store.readPromotion.bind(store);
  store.readPromotion = async (recordClass, scope) => { reads.push(scope); return promotion(recordClass, scope); };
  const cursors: string[] = [];
  const query: ReadOnlyQuery = async statements => statements.map(statement => {
    assert.match(statement.text, /ORDER BY scope COLLATE "C" LIMIT 100/);
    assert.match(statement.text, /substring\(p.scope from \$5::integer\)/);
    assert.equal(statement.params[0], "US:ballot-measures:ocd-division/country:us/state:oh/%");
    assert.match(statement.text, /scope COLLATE "C">\$2 AND scope COLLATE "C"<\$3/);
    assert.equal(statement.params[2], "US:ballot-measures:ocd-division/country:us/state:oh0");
    const after = String(statement.params[1]); cursors.push(after);
    return scopes.filter(scope => scope > after).slice(0, 2).map(scope => ({ scope }));
  });
  const inputs = readMeasurePlaces("OH", { store, now: () => now, readState: async () => ({ division: "ocd-division/country:us/state:oh", ballots: [] }), query });
  assert.deepEqual((await inputs.next()).value, { division: "ocd-division/country:us/state:oh", ballots: [] });
  assert.equal(reads.length, 0);
  assert.equal((await inputs.next()).value?.division, "ocd-division/country:us/state:oh/county:alder");
  assert.ok(reads.length > 0 && reads.every(scope => scope === scopes[0]));
  const remaining = [];
  for await (const input of inputs) remaining.push(input.division);
  assert.deepEqual(remaining, ["ocd-division/country:us/state:oh/place:alder", "ocd-division/country:us/state:oh/school_district:alder"]);
  assert.deepEqual(cursors.slice(1), [scopes[1], scopes[2]]);
  reads.length = 0;
  const currentQuery: ReadOnlyQuery = async statements => statements.map(statement => {
    assert.match(statement.text, /sourceBallot/);
    const after = String(statement.params[1]);
    return scopes.filter(scope => scope > after).slice(0, 2).map(scope => ({ scope, current_measure_count: 1,
      current_translation: { versionId: `checked:${scope}` } }));
  });
  const current = [];
  for await (const place of readMeasurePlaces("OH", { store, now: () => now, readState: async () => ({ division: "ocd-division/country:us/state:oh", ballots: [] }), query: currentQuery })) current.push(place);
  assert.equal(reads.length, 0, "current raw and checked payloads never load");
  assert.deepEqual(current.slice(1).map(place => place.currentMeasureCount), [1, 1, 1]);
  assert.deepEqual(current.slice(1).map(place => place.currentTranslation), scopes.map(scope => ({ versionId: `checked:${scope}` })));
  assert.ok(current.slice(1).every(place => place.ballots.length === 0));
});

test("a refreshed measure keeps independent guide evidence and replaces its legal source only with held text", async () => {
  const input = await fixture(), first = workerBallotContestsPackage(input).package, payload = first.payload as GenericBallotProjection;
  const ballot = Object.values(payload.ballots)[0], measure = ballot.measures[0];
  const guideText = "The state explains the library levy.", guideHash = createHash("sha256").update(guideText).digest("hex");
  measure.voterGuide = { summary: guideText, vault: { key: `project/freshness/source/elections/2026/10/05/measure/sha256-${guideHash}.txt`, byteLength: Buffer.byteLength(guideText), contentType: "text/plain" }, publisher: "Fixture election authority",
    sourceUrl: "https://alder.example.gov/voter-guide", sourceHash: guideHash, retrievedAt: now };
  const guideMetadata = { ...measure.voterGuide.vault, contentHash: `sha256-${guideHash}`,
    custom: { tier: "RAW", canonicalUrl: measure.voterGuide.sourceUrl } };
  await input.evidenceStore.put(measure.voterGuide.vault.key, Buffer.from(guideText), guideMetadata);
  const latestObservation = "2026-10-06T18:00:00Z";
  ballot.sourceAuthorities = [{ ...measure.voterGuide, retrievedAt: latestObservation }];
  const prior = { versionId: "prior", sourceReceipt: { ...first.sourceReceipt, sources: [...first.sourceReceipt.sources,
    { ...first.sourceReceipt.sources[0], requestedUrl: measure.voterGuide.sourceUrl, finalUrl: measure.voterGuide.sourceUrl,
      rawHash: measure.voterGuide.sourceHash }] }, payload };
  const refreshed = structuredClone(first), freshBallot = Object.values((refreshed.payload as GenericBallotProjection).ballots)[0];
  delete freshBallot.measures[0].voterGuide;
  delete freshBallot.measures[0].officialText;
  freshBallot.sourceAuthorities = [];
  const merged = mergeBallotContests(refreshed, prior);
  const held = Object.values((merged.payload as GenericBallotProjection).ballots)[0];
  assert.deepEqual(held.measures[0].officialText, measure.officialText);
  assert.deepEqual(held.measures[0].voterGuide, measure.voterGuide);
  assert.deepEqual(held.measureRecords, ballot.measureRecords);
  assert.deepEqual(held.sourceAuthorities, ballot.sourceAuthorities);
  assert.ok(merged.sourceReceipt.sources.some(source => source.finalUrl === measure.voterGuide?.sourceUrl));
  const changedInput = await fixture();
  await changedInput.evidenceStore.put(measure.voterGuide.vault.key, Buffer.from(guideText), guideMetadata);
  const nextText = `${changedInput.captures[1].evidence.text}\nSection 2. The levy ends after five years.`;
  changedInput.captures[1].evidence = { ...changedInput.captures[1].evidence, text: nextText,
    contentHash: `sha256-${createHash("sha256").update(nextText).digest("hex")}` };
  const reference = changedInput.captures[1].sourceReference;
  reference.sourceHash = changedInput.captures[1].evidence.contentHash.slice(7);
  reference.vault = { ...reference.vault, key: `project/freshness/source/elections/2026/10/05/measure/sha256-${reference.sourceHash}.txt`, byteLength: Buffer.byteLength(nextText) };
  await changedInput.evidenceStore.put(reference.vault.key, Buffer.from(nextText), { ...reference.vault,
    contentHash: `sha256-${reference.sourceHash}`, custom: { tier: "RAW", canonicalUrl: reference.sourceUrl } });
  const changed = Object.values((mergeBallotContests(workerBallotContestsPackage(changedInput).package, prior).payload as GenericBallotProjection).ballots)[0];
  assert.equal(await readMeasureSource(changedInput.evidenceStore, changed.measures[0].officialText!), changedInput.captures[1].evidence.text);
  assert.notEqual(changed.measureRecords?.[0].sourceHash, ballot.measureRecords?.[0].sourceHash);
  assert.deepEqual(changed.measures[0].voterGuide, measure.voterGuide);
  await validateBallotMeasureEvidence(changed, changedInput.evidenceStore);
});

test("minimum measure facts publish while missing or conflicting full text stays owed; unresolved scope and disabled sources hold", async () => {
  for (const failure of ["missing", "partial", "scope", "conflict", "disabled", "unbound-vault"]) {
    const input = await fixture();
    if (failure === "missing") input.captures.pop();
    if (failure === "partial") input.captures[1].partial = true;
    if (failure === "unbound-vault") Object.assign(input.captures[1], { sourceReference: undefined });
    if (failure === "scope") input.registry = { payload: { registry: { divisions: [] } } } as unknown as RegistryRuntimePrior;
    if (failure === "conflict") {
      const text = `${input.captures[1].evidence.text}\nConflicting revision.`;
      input.captures.push({ ...input.captures[1], evidence: { ...input.captures[1].evidence, text,
        contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}` } });
    }
    if (failure === "disabled") input.captures.forEach(row => Object.assign(row, { sourcePolicy: { ...DEFAULT_SOURCE_POLICY,
      enabled: { ...DEFAULT_SOURCE_POLICY.enabled, OFFICIAL: false } } }));
    if (failure === "disabled" || failure === "scope") assert.throws(() => workerBallotContestsPackage(input), failure);
    else {
      const result = workerBallotContestsPackage(input), ballot = Object.values((result.package.payload as GenericBallotProjection).ballots)[0];
      assert.equal(ballot.contests.length, 1); assert.equal(ballot.measures.length, 0); assert.equal(ballot.measureRecords?.length, 0);
      assert.equal(result.heldContests.length, 1);
    }
  }
});

test("a measure rewrite retains unrelated contests and known election dates, and conflicting election dates never overwrite", async () => {
  const input = await fixture(), first = workerBallotContestsPackage(input).package, payload = first.payload as GenericBallotProjection;
  const ballot = Object.values(payload.ballots)[0], other = { ...ballot.contests[0], id: "another-measure", title: "Proposition 13" };
  const priorBallot = { ...ballot, contests: [...ballot.contests, other],
    measures: [...ballot.measures, { ...ballot.measures[0], id: "another-measure#question", contestId: other.id }],
    measureRecords: [...ballot.measureRecords!, { ...ballot.measureRecords![0], contestId: other.id }] };
  const prior = { versionId: "prior", sourceReceipt: first.sourceReceipt, payload: { ...payload, ballots: { [Object.keys(payload.ballots)[0]]: priorBallot } } };
  const merged = mergeBallotContests({ ...first, payload: { ...payload, ballots: { [Object.keys(payload.ballots)[0]]: { ...ballot, election: { ...ballot.election, date: "" } } } } }, prior);
  const result = Object.values((merged.payload as GenericBallotProjection).ballots)[0];
  assert.equal(result.election.date, "2026-11-03"); assert.equal(result.measures.length, 2); assert.equal(result.measureRecords?.length, 2);
  assert.throws(() => mergeBallotContests({ ...first, payload: { ...payload, ballots: { [Object.keys(payload.ballots)[0]]: { ...ballot, election: { ...ballot.election, date: "2026-12-01" } } } } }, prior), /DATE_CONFLICT/);
});
