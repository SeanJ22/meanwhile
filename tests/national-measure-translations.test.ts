import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryRepositories } from "./helpers/playbooks.ts";
import type { ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { BallotSet, MeasureSourceReference } from "../lib/ballot/types.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { nationalMeasureInputs, readNationalBallotState, runNationalMeasureTranslations } from "../lib/translate/national.ts";
import { translationHash, translationScope } from "../lib/translate/records.ts";
import { readTranslations, withMeasureTranslations } from "../lib/translate/projection-reader.ts";
import { publishRoutineReaderEdgeOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { ensureReaderAuthorityEdge, READER_BALLOT_AUTHORITY_FAMILIES } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-parts.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { runHeldMeasureTranslations } from "../lib/translate/standing.ts";
import { armHunterLane, hunterLaneArmingPath, laneArmingOf, LaneOwnSpend } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { writeLaneArming } from "../lib/control-plane/workers/hunter-lane-arming-writer.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { buildResearchIntent } from "../lib/control-plane/research-view.ts";
import { defaultAdminConfig, withFleetSpendCeiling } from "../lib/control-plane/gateway/admin-config.ts";

const at = "2026-10-14T18:00:00Z";
function reference(body: string, url: string, retrievedAt = at, publisher = "Ohio election authority"): MeasureSourceReference {
  const sourceHash = translationHash(body);
  return { sourceUrl: url, sourceHash, retrievedAt, publisher,
    vault: { key: `project/freshness/source/${new URL(url).hostname}/${retrievedAt.slice(0, 10).replaceAll("-", "/")}/translation-test/sha256-${sourceHash}.txt`,
      byteLength: Buffer.byteLength(body), contentType: "text/plain" } };
}
async function saveSource(vault: MemoryEvidenceStore, body: string, source: MeasureSourceReference) {
  const { artifact } = recordAcquisition({ canonicalUrl: source.sourceUrl, retrievedAt: source.retrievedAt, httpStatus: 200,
    contentType: source.vault.contentType, sourceId: new URL(source.sourceUrl).hostname, methodRouteId: "test", workItemId: "translation-test",
    attemptId: "test", permission: "ALLOWED", transport: "REACHABLE" }, body);
  const held = await putArtifact(vault, "freshness", artifact, new TextEncoder().encode(body));
  assert.equal(held.key, source.vault.key);
}
const authorityHtml = '<a href="https://elections.state.oh.us/">Election office directory</a>';
const authority = reference(authorityHtml, "https://www.example.gov/election-offices");

const text = "SECTION 1. The levy funds library services. A YES vote adopts the levy. A NO vote keeps the current levy." +
  Array.from({ length: 89 }, (_, index) => `\nSECTION ${index + 2}. The levy funds library services.`).join("");
const sourceUrl = "https://elections.state.oh.us/2026/hjr12.pdf";
const record = { contestId: "oh-measure-12", whatItDoes: "The levy funds library services.",
  yesMeans: "A YES vote adopts the levy.", noMeans: "A NO vote keeps the current levy.",
  parts: [], sourceUrl, sourceHash: translationHash(text), writtenAt: at };
const division = "ocd-division/country:us/state:oh";
const ballot: BallotSet = { election: { id: "oh-2026-general", name: "General Election", state: "OH", date: "2026-11-03" },
  contests: [{ id: record.contestId, title: "Proposition 12", type: "MEASURE", ocdId: division } as BallotSet["contests"][number]],
  measureRecords: [record], measures: [{ id: record.contestId, contestId: record.contestId, questionText: "Shall the levy be adopted?", officialStatement: null,
    officialText: reference(text, sourceUrl),
    voterGuide: { ...reference("ARGUMENTS_DO_NOT_TRANSLATE", "https://elections.example.gov/guide"), argumentsFor: ["ARGUMENTS_DO_NOT_TRANSLATE"] }, provenance: { sourceUrl: "https://elections.example.gov/questions" } as BallotSet["measures"][number]["provenance"] }],
  candidacies: [], absences: [], sourceAuthorities: [authority] };

test("national translation binds its official question and uses the full legislative text without importing state arguments", async t => {
  const directory = await mkdtemp(join(tmpdir(), "national-measure-translations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vault = new MemoryEvidenceStore();
  let vaultGets = 0;
  const get = vault.get.bind(vault);
  vault.get = async key => { vaultGets++; return get(key); };
  await saveSource(vault, text, ballot.measures[0].officialText!);
  await saveSource(vault, authorityHtml, authority);
  let heldBallot = ballot;
  const save = (value: BallotSet) => { heldBallot = value; };
  const rawSections = Array.from({ length: 90 }, (_, index) => ({ id: `${record.contestId}#section-${index + 1}`,
    number: String(index + 1), kind: "PROGRAM", label: `Section ${index + 1}`, what: record.whatItDoes }));
  await save({ ...ballot, measureRecords: [{ ...record, parts: rawSections }] });
  const repos = createMemoryRepositories(), store = new MemoryRoutineDataStore(), requests: ModelRequest[] = [], lines: string[] = [];
  let now = at, rejects = false;
  const input = { vault, repos, store, now: () => now, slots: { acquire: async () => () => {} }, capacity: () => 1,
    readState: async (state: string) => state === "OH" ? [heldBallot] : [],
    continueWork: () => true, report: (line: string) => { lines.push(line); }, transportFor: () => async (request: ModelRequest) => {
      requests.push(request);
      const payload = JSON.parse(request.messages[0].content as string) as { source?: string; sourceHash?: string; writtenAt?: string; proposal?: { sentences: { field: string; text: string }[] } };
      const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field, text: record[field as "whatItDoes"], quote: record[field as "whatItDoes"] }));
      const value = request.tools[0].name === "write_measure_translation" ? {
        measure: { ...record, sourceHash: payload.sourceHash, writtenAt: payload.writtenAt }, sentences,
      } : { checked: payload.proposal!.sentences.map(row => ({ ...row, supported: !rejects })) };
      return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "result", name: request.tools[0].name, input: value }],
        usage: { input_tokens: 100, output_tokens: 50 } };
    } };
  const first = await runNationalMeasureTranslations(input);
  assert.equal(first[0].published, 1, lines.join("\n"));
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].model, requests[1].model);
  assert.equal(JSON.parse(requests[0].messages[0].content as string).subject.prior, null,
    "unpublished source sections do not force ninety generated summaries; checked reaction parts remain authoritative on rewrites");
  assert.ok(requests.every(request => !JSON.stringify(request).includes("ARGUMENTS_DO_NOT_TRANSLATE")));
  assert.ok(requests.every(request => !JSON.stringify(request).includes("Election office directory")));
  const writerInput = JSON.parse(requests[0].messages[0].content as string);
  assert.equal(writerInput.subject.ballotQuestion.text, "Shall the levy be adopted?");
  assert.equal(writerInput.source, text, "ballot context is never substituted for the complete legal source");
  const translated = await readTranslations([division], { store, now, bypassCache: true });
  assert.equal(withMeasureTranslations(ballot, translated).measureRecords![0].yesMeans, record.yesMeans);
  const artifacts = new LocalFileArtifactStore(join(directory, "edge"));
  const edgePublication = await publishRoutineReaderEdgeOutcome(store, now,
    [{ recordClass: "CURATED_READER_RECORD", scope: translationScope(division) }], { artifactStore: artifacts });
  assert.equal(edgePublication.readerEdge, "PUBLISHED", JSON.stringify(edgePublication));
  const manifest = (await artifacts.readManifest())!.manifest;
  assert.ok(manifest.translations?.[division]);
  let edgeReads = 0;
  const counting = new Proxy(artifacts, { get(target, key) {
    if (key === "readBytes") return async (path: string) => { edgeReads++; return target.readBytes(path); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.ok((await ensureReaderAuthorityEdge(manifest, counting, ["ballot-contests"])).translations,
    "Ask's ballot-only bundle carries the lazy translation loader too");
  const bundle = await ensureReaderAuthorityEdge(manifest, counting, READER_BALLOT_AUTHORITY_FAMILIES);
  assert.equal(edgeReads, 0, "request setup loads no state's translation source documents");
  const served = await withReaderAuthorityEdge({ ...bundle, edgeOnly: true }, () => readTranslations([division], { now }));
  assert.deepEqual(served, translated, "normal ballot request reads the checked publication from its state artifact");
  assert.equal(edgeReads, 1);
  await withReaderAuthorityEdge({ ...bundle, edgeOnly: true }, () => readTranslations([division], { now }));
  assert.equal(edgeReads, 1, "unchanged state artifact is reused");
  now = "2026-10-14T18:01:00Z";
  vaultGets = 0;
  assert.equal((await runNationalMeasureTranslations(input))[0].reused, 1);
  assert.equal(requests.length, 2);
  assert.equal(vaultGets, 0, "unchanged checked sources need no vault downloads");
  save({ ...heldBallot, measures: [{ ...heldBallot.measures[0], officialText: { ...heldBallot.measures[0].officialText!, retrievedAt: now } }] });
  assert.equal((await runNationalMeasureTranslations(input))[0].reused, 1);
  assert.equal(requests.length, 2);
  assert.equal(vaultGets, 0, "a later observation of identical held bytes does not start a new translation");
  now = "2026-10-15T18:01:00Z";
  const reobserved = reference(text, sourceUrl, now);
  await saveSource(vault, text, reobserved);
  vaultGets = 0;
  save({ ...heldBallot, measures: [{ ...heldBallot.measures[0], officialText: reobserved }] });
  assert.equal((await runNationalMeasureTranslations(input))[0].reused, 1);
  assert.equal(requests.length, 2);
  assert.equal(vaultGets, 0, "a new dated vault key for unchanged text reuses the checked original copy");
  assert.deepEqual(await readTranslations([division], { store, now, bypassCache: true }), translated);
  now = "2026-10-14T18:01:00Z";
  const changedText = `${text} This levy takes effect in 2027.`;
  const changed = { ...ballot, measureRecords: [{ ...record, sourceHash: translationHash(changedText), writtenAt: now }],
    measures: [{ ...ballot.measures[0], officialText: reference(changedText, sourceUrl, now) }] };
  await saveSource(vault, changedText, changed.measures[0].officialText!);
  save(changed);
  assert.equal(withMeasureTranslations(changed, translated).measureRecords!.length, 0);
  rejects = true;
  assert.equal((await runNationalMeasureTranslations(input))[0].held, 1);
  assert.equal(requests.length, 4);
  now = "2026-10-14T18:02:00Z";
  assert.equal((await runNationalMeasureTranslations(input))[0].deferred, 1);
  assert.equal(requests.length, 4, "the durable failed attempt preserves the retry clock across passes");
  now = "2026-10-14T18:16:00Z"; rejects = false;
  assert.equal((await runNationalMeasureTranslations(input))[0].published, 1);
  assert.equal(requests.length, 6);
  const attempts = await repos.attempts.list();
  assert.equal(attempts.filter(row => row.value.translation?.status === "HELD").length, 1);
  now = "2026-10-14T18:17:00Z";
  save({ ...changed, measures: [{ ...changed.measures[0], questionText: "Shall the library levy take effect in 2027?" }] });
  vaultGets = 0;
  assert.equal((await runNationalMeasureTranslations(input))[0].published, 1);
  assert.equal(requests.length, 8, "changed ballot context rechecks the exact question within a shared legal source");
  assert.ok(vaultGets > 0);
});

test("the canonical input reader decodes only the selected state's references and refuses invalid source bindings", async () => {
  const valid: BallotSet = { ...ballot, contests: [{ ...ballot.contests[0], electionId: ballot.election.id,
    measureTextUrl: sourceUrl, provenance: { sourceUrl } as BallotSet["contests"][number]["provenance"] }],
    measures: [{ ...ballot.measures[0], provenance: { sourceUrl } as BallotSet["measures"][number]["provenance"] }] };
  const encoded = partitionCivicPayload({ ...valid, coverageNotes: ["Official election coverage.".repeat(3000)] });
  const loaded = new Set<string>();
  const query: ReadOnlyQuery = async statements => Promise.all(statements.map(async statement => {
    if (statement.params[0] === "US:state-election-ballots") {
      assert.deepEqual(statement.params, ["US:state-election-ballots", "OH"]);
      assert.match(statement.text, /split_part\(e.key,':',1\)=\$2/);
      return [{ value: encoded.value }];
    }
    const hashes = statement.params[0] as string[];
    hashes.forEach(hash => loaded.add(hash));
    return encoded.parts.filter(part => hashes.includes(part.hash));
  }));
  const held = await readNationalBallotState("OH", query);
  assert.deepEqual(held[0].measures[0].officialText, ballot.measures[0].officialText);
  assert.equal(JSON.stringify(held).includes(text), false);
  assert.ok(loaded.size > 0);
  await assert.rejects(readNationalBallotState("OH", async () => [[{ value: { ...valid,
    measures: [{ ...valid.measures[0], officialText: { ...valid.measures[0].officialText!, text: "Wrong revision" } }] } }]]), /invalid/);
  await assert.rejects(readNationalBallotState("OH", async () => [[{ value: { $missing: "missing" } }]]), /CIVIC_PAYLOAD_PART_MISSING/);
});

test("national measures require complete vaulted text with matching source and state identities", async () => {
  const vault = new MemoryEvidenceStore();
  await saveSource(vault, text, ballot.measures[0].officialText!);
  await saveSource(vault, authorityHtml, authority);
  assert.equal((await nationalMeasureInputs(ballot, vault)).captures.length, 2);
  for (const invalid of [
    { ...ballot, measures: [{ ...ballot.measures[0], officialText: undefined }] },
    { ...ballot, contests: [{ ...ballot.contests[0], ocdId: "ocd-division/country:us/state:ca" }] },
  ]) assert.equal((await nationalMeasureInputs(invalid, vault)).captures.length, 0);
  await assert.rejects(nationalMeasureInputs({ ...ballot, measureRecords: [{ ...record, sourceHash: "0".repeat(64) }] }, vault), /differs/);
  await assert.rejects(nationalMeasureInputs(ballot, new MemoryEvidenceStore()), /missing/);
  const district = await nationalMeasureInputs({ ...ballot, election: { ...ballot.election, state: "DC" },
    contests: [{ ...ballot.contests[0], ocdId: "ocd-division/country:us/district:dc" }] }, vault);
  assert.equal(district.captures.length, 2);
  assert.deepEqual(district.divisions, ["ocd-division/country:us/district:dc"]);
});

test("separate full laws in the same state pamphlet keep their exact capture identities", async () => {
  const url = "https://www.ohio.gov/pamphlet.pdf";
  const vault = new MemoryEvidenceStore(), source = reference(text, url);
  await saveSource(vault, text, source);
  const input = await nationalMeasureInputs({ ...ballot, measureRecords: [{ ...record, sourceUrl: url }],
    measures: [{ ...ballot.measures[0], officialText: source }] }, vault);
  const otherText = "SECTION 1. A separate measure changes a different law.";
  const other = { ...input.captures[0], evidence: { ...input.captures[0].evidence, text: otherText, contentHash: `sha256-${translationHash(otherText)}` } };
  let writes = 0;
  const result = await runHeldMeasureTranslations({ ...input, captures: [...input.captures, other],
    repos: createMemoryRepositories(), store: new MemoryRoutineDataStore(), now: at, attempts: [], saveAttempt: async () => {},
    transportFor: () => async request => {
      writes++;
      assert.equal(JSON.parse(request.messages[0].content as string).source, text);
      throw new Error("Exact law reached the writer");
    } });
  assert.equal(writes, 1);
  assert.deepEqual(result.deferred, []);
  assert.match(result.outcomes[0].detail!, /Exact law reached the writer/);
});

test("the live runner pause closes national translation before state reads and model requests", async t => {
  const directory = await mkdtemp(join(tmpdir(), "national-translation-pause-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repos = createMemoryRepositories();
  const config = withFleetSpendCeiling(defaultAdminConfig(at), { rollingCeilingUsd: 50, previousUsd: 50,
    decidedAt: at, decidedBy: "test", receiptId: "test" });
  await repos.adminConfig.put("current", config, at);
  const intent = buildResearchIntent("PAUSE_RUNNER", at, "test", null, "test");
  await repos.researchIntents.append("level-1", intent.intentId, intent, at);
  const armingPath = hunterLaneArmingPath(directory, {});
  writeLaneArming(armingPath, laneArmingOf({ readAt: at, specs: [], historical: new Map(), knownKeys: [], reached: new Map(),
    areas: null, lifetimeHuntSubjects: [], placeOrder: [], circuits: [], worstCaseUsd: 1 }));
  let sends = 0;
  const messages = async () => { sends++; throw new Error("Paused work sent a model request"); };
  const armed = await armHunterLane({ repos, now: () => at, armingPath, messages, batch: backgroundBatchTransport({ apiKey: "" }),
    credentialConfigured: true, credentialVar: "TEST_KEY", providerQueue: new ModelProviderQueue(), ownSpend: new LaneOwnSpend(),
    circuits: null, onCondition: () => {} });
  assert.match(armed.closed?.reason ?? "", /paused the runner/);
  const result = await runNationalMeasureTranslations({ vault: new MemoryEvidenceStore(), repos, store: new MemoryRoutineDataStore(), now: () => at,
    capacity: () => armed.guards?.paidWorkerCapacity() ?? 0, continueWork: () => armed.closed === null,
    readState: async () => { throw new Error("Paused work read a state"); }, slots: { acquire: async () => () => {} },
    transportFor: () => messages, report: () => {} });
  assert.deepEqual(result, []);
  assert.equal(sends, 0);
});

test("a closed paid lane does not read source evidence or start model work", async () => {
  const result = await runNationalMeasureTranslations({ vault: new MemoryEvidenceStore(),
    repos: createMemoryRepositories(), store: new MemoryRoutineDataStore(), now: () => at, capacity: () => 0,
    slots: { acquire: async () => { throw new Error("No worker should start."); } }, continueWork: () => true,
    transportFor: () => async () => { throw new Error("No model call should start."); }, report: () => {} });
  assert.deepEqual(result, []);
});
