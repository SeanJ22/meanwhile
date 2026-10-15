import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
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
import { readTranslationProjection, readTranslations, withMeasureTranslations } from "../lib/translate/projection-reader.ts";
import { publishPlaceReaderEdgeOutcome } from "../lib/civic-data/place-edge-publication.ts";
import { ensureReaderAuthorityEdge, READER_BALLOT_AUTHORITY_FAMILIES } from "../lib/meetings/edge-serving.ts";
import { readerPlaceManifestKey } from "../lib/meetings/place-edge.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-parts.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { publishTranslation, translationPackage } from "../lib/translate/publication.ts";
import { runHeldMeasureTranslations } from "../lib/translate/standing.ts";
import { armHunterLane, hunterLaneArmingPath, laneArmingOf, LaneOwnSpend } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { writeLaneArming } from "../lib/control-plane/workers/hunter-lane-arming-writer.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { buildResearchIntent } from "../lib/control-plane/research-view.ts";
import { scopeModelSpend } from "../lib/control-plane/expansion/membership.ts";
import { SETTLED_HOLD_RETENTION_MS } from "../lib/control-plane/expansion/spend-holds.ts";
import { defaultAdminConfig, withFleetSpendCeiling } from "../lib/control-plane/gateway/admin-config.ts";
import { serializeUnchangedConfirmation, type UnchangedConfirmation } from "../lib/civic-data/unchanged-confirmation.ts";

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
  const stream = vault.stream.bind(vault);
  vault.stream = async key => { vaultGets++; return stream(key); };
  await saveSource(vault, text, ballot.measures[0].officialText!);
  await saveSource(vault, authorityHtml, authority);
  let heldBallot = ballot;
  const save = (value: BallotSet) => { heldBallot = value; };
  const rawSections = Array.from({ length: 90 }, (_, index) => ({ id: `${record.contestId}#section-${index + 1}`,
    number: String(index + 1), kind: "PROGRAM", label: `Section ${index + 1}`, what: record.whatItDoes }));
  await save({ ...ballot, measureRecords: [{ ...record, parts: rawSections }] });
  const repos = createMemoryRepositories(), store = new MemoryRoutineDataStore(), requests: ModelRequest[] = [], lines: string[] = [];
  let now = at, rejects = false, recordedCosts = 0;
  const input = { state: "OH", publishPlace: async () => {}, vault, repos, store, now: () => now, slots: { acquire: async () => () => {} }, capacity: () => 1,
    onCostRecorded: () => { recordedCosts++; },
    readPlaces: async function* (state: string) { if (state === "OH") yield { division, ballots: [heldBallot] }; },
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
  assert.equal(recordedCosts, 2);
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
  const edgePublication = await publishPlaceReaderEdgeOutcome(store, now,
    [{ recordClass: "CURATED_READER_RECORD", scope: translationScope(division) }], { artifactStore: artifacts });
  assert.equal(edgePublication.readerEdge, "PUBLISHED", JSON.stringify(edgePublication));
  const currentIdentity = (await store.readPromotionIdentity("CURATED_READER_RECORD", translationScope(division)))!;
  const noDatabase = new Proxy(store, { get() { throw new Error("A current place must not read the database."); } });
  const currentPublication = await publishPlaceReaderEdgeOutcome(noDatabase, now,
    [{ recordClass: "CURATED_READER_RECORD", scope: translationScope(division), currentIdentity }], { artifactStore: artifacts });
  assert.equal(currentPublication.readerEdge, "CURRENT", JSON.stringify(currentPublication));
  const manifest = (await artifacts.readManifest(readerPlaceManifestKey("plain-english-translations", division)))!.manifest;
  assert.ok(manifest.place?.artifact);
  let edgeReads = 0;
  const counting = new Proxy(artifacts, { get(target, key) {
    if (key === "readBytes") return async (path: string) => { edgeReads++; return target.readBytes(path); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.ok((await ensureReaderAuthorityEdge({}, counting, ["ballot-contests"])).translations,
    "Ask's ballot-only bundle carries the lazy translation loader too");
  const bundle = await ensureReaderAuthorityEdge({}, counting, READER_BALLOT_AUTHORITY_FAMILIES);
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
  assert.ok(vaultGets > 0, "a changed source reference is verified without new model calls");
  now = "2026-10-15T18:01:00Z";
  const reobserved = reference(text, sourceUrl, now);
  await saveSource(vault, text, reobserved);
  vaultGets = 0;
  save({ ...heldBallot, measures: [{ ...heldBallot.measures[0], officialText: reobserved }] });
  assert.equal((await runNationalMeasureTranslations(input))[0].reused, 1);
  assert.equal(requests.length, 2);
  assert.ok(vaultGets > 0, "the newly held vault reference is verified before rebinding checked sentences");
  const refreshed = await readTranslations([division], { store, now, bypassCache: true });
  assert.deepEqual(refreshed[0].checked, translated[0].checked);
  assert.equal(refreshed[0].writtenAt, translated[0].writtenAt);
  if (refreshed[0].kind === "MEASURE") assert.deepEqual(refreshed[0].sourceReference, reobserved);
  vaultGets = 0;
  assert.equal((await runNationalMeasureTranslations(input))[0].reused, 1);
  assert.equal(vaultGets, 0);
  now = "2026-10-15T18:02:00Z";
  const changedText = `${text} This levy takes effect in 2027.`;
  const changed = { ...ballot, measureRecords: [{ ...record, sourceHash: translationHash(changedText), writtenAt: now }],
    measures: [{ ...ballot.measures[0], officialText: reference(changedText, sourceUrl, now) }] };
  await saveSource(vault, changedText, changed.measures[0].officialText!);
  save(changed);
  assert.equal(withMeasureTranslations(changed, translated).measureRecords!.length, 0);
  rejects = true;
  assert.equal((await runNationalMeasureTranslations(input))[0].held, 1);
  assert.equal(requests.length, 4);
  now = "2026-10-15T18:03:00Z";
  assert.equal((await runNationalMeasureTranslations(input))[0].deferred, 1);
  assert.equal(requests.length, 4, "the durable failed attempt preserves the retry clock across passes");
  now = "2026-10-15T18:17:00Z"; rejects = false;
  assert.equal((await runNationalMeasureTranslations(input))[0].published, 1);
  assert.equal(requests.length, 6);
  const repairedArtifacts = new LocalFileArtifactStore(join(directory, "repair"));
  let identityReads = 0;
  const authoritative = new Proxy(store, { get(target, key) {
    if (key === "readPromotionIdentity") return async (...args: Parameters<typeof target.readPromotionIdentity>) => {
      identityReads++; assert.deepEqual(args, ["CURATED_READER_RECORD", translationScope(division)]);
      return target.readPromotionIdentity(...args);
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const selected = [{ recordClass: "CURATED_READER_RECORD" as const, scope: translationScope(division), currentIdentity }];
  assert.equal((await publishPlaceReaderEdgeOutcome(authoritative, now, selected, { artifactStore: repairedArtifacts })).readerEdge, "PUBLISHED");
  assert.equal(identityReads, 1, "a missing artifact discards the cursor's old version and reads the authoritative current identity");
  const repaired = (await repairedArtifacts.readManifest(readerPlaceManifestKey("plain-english-translations", division)))!;
  const latestIdentity = (await store.readPromotionIdentity("CURATED_READER_RECORD", translationScope(division)))!;
  assert.notEqual(latestIdentity.versionId, currentIdentity.versionId);
  assert.ok(repaired.manifest.place!.artifact.version.includes(latestIdentity.versionId));
  assert.equal((await publishPlaceReaderEdgeOutcome(authoritative, now, selected, { artifactStore: repairedArtifacts })).readerEdge, "CURRENT");
  assert.equal(identityReads, 2, "an older cursor observes the newer artifact through the latest authoritative identity");
  assert.equal((await repairedArtifacts.readManifest(readerPlaceManifestKey("plain-english-translations", division)))!.etag, repaired.etag,
    "an old cursor cannot overwrite a concurrent later promotion");
  assert.equal((await publishPlaceReaderEdgeOutcome(authoritative, now,
    [{ ...selected[0], currentIdentity: latestIdentity }], { artifactStore: artifacts })).readerEdge, "PUBLISHED");
  assert.equal(identityReads, 3, "a stale artifact is repaired after checking the authoritative identity");
  const attempts = await repos.attempts.list();
  assert.equal(attempts.filter(row => row.value.translation?.status === "HELD").length, 1);
  now = "2026-10-15T18:18:00Z";
  save({ ...changed, measures: [{ ...changed.measures[0], questionText: "Shall the library levy take effect in 2027?" }] });
  vaultGets = 0;
  assert.equal((await runNationalMeasureTranslations(input))[0].published, 1);
  assert.equal(requests.length, 8, "changed ballot context rechecks the exact question within a shared legal source");
  assert.equal(recordedCosts, 8, "each response is acknowledged after its charge is durably recorded");
  assert.ok(vaultGets > 0);
});

test("the canonical state input decodes only measure fields and keeps unchanged state reads at pointer identity", async () => {
  const valid: BallotSet = { ...ballot, contests: [{ ...ballot.contests[0], electionId: ballot.election.id,
    measureTextUrl: sourceUrl, provenance: { sourceUrl } as BallotSet["contests"][number]["provenance"] }],
    measures: [{ ...ballot.measures[0], questionText: "Official ballot question ".repeat(3000),
      provenance: { sourceUrl } as BallotSet["measures"][number]["provenance"] }] };
  const sourceBallot = { scope: "US-OH:state-election-ballots", versionId: "raw-state-v1" };
  const encoded = partitionCivicPayload(valid.measures), loaded = new Set<string>();
  const fields = Object.entries({ election: [valid.election], contests: valid.contests, measures: encoded.value,
    measureRecords: valid.measureRecords, sourceAuthorities: valid.sourceAuthorities }).map(([field, value]) => ({ ballot: "OH:oh-2026-general", field, value }));
  const query: ReadOnlyQuery = async statements => Promise.all(statements.map(async statement => {
    if (statement.params[0] === sourceBallot.scope) {
      assert.equal(statement.params[1], translationScope(division));
      assert.deepEqual(statement.params[2], ["election", "contests", "measures", "measureRecords", "sourceAuthorities", "sourceCorpus"]);
      assert.equal(statement.params[3], division);
      assert.match(statement.text, /scope=\$1/);
      assert.match(statement.text, /node->>'type'='MEASURE'/);
      assert.ok(!statement.text.includes("US:state-election-ballots"));
      return [{ field: "$source", value: sourceBallot }, ...fields];
    }
    const hashes = statement.params[0] as string[];
    hashes.forEach(hash => loaded.add(hash));
    return encoded.parts.filter(part => hashes.includes(part.hash));
  }));
  const held = await readNationalBallotState("OH", query);
  assert.deepEqual(held.ballots[0].measures[0].officialText, ballot.measures[0].officialText);
  assert.deepEqual(held.sourceBallot, sourceBallot);
  assert.deepEqual(held.ballots[0].candidacies, []);
  assert.equal(JSON.stringify(held).includes(text), false);
  assert.ok(loaded.size > 0);
  const invalid = fields.map(row => row.field === "measures" ? { ...row, value: [{ ...valid.measures[0],
    officialText: { ...valid.measures[0].officialText!, text: "Wrong revision" } }] } : row);
  await assert.rejects(readNationalBallotState("OH", async () => [[{ field: "$source", value: sourceBallot }, ...invalid]]), /invalid/);
  await assert.rejects(readNationalBallotState("OH", async () => [[{ field: "$missing", value: "missing" }]]), /CIVIC_PAYLOAD_PART_MISSING/);
  let reads = 0;
  const currentTranslation = { versionId: "checked-state-v1" };
  assert.deepEqual(await readNationalBallotState("OH", async () => { reads++; return [[{ field: "$source", value: { ...sourceBallot, measureCount: 1, currentTranslation } }]]; }),
    { division, sourceBallot, ballots: [], currentMeasureCount: 1, currentTranslation });
  await assert.rejects(readNationalBallotState("OH", async () => [[{ field: "$source", value: { ...sourceBallot, measureCount: 1 } }]]), /exact promoted identity/);
  assert.equal(reads, 1);
  const confirmation: UnchangedConfirmation = { kind: "UNCHANGED_CONFIRMATION_V1", sourceId: "fixture", recordClass: "CURATED_READER_RECORD",
    scope: translationScope(division), pointerKey: `CURATED_READER_RECORD:${translationScope(division)}`, versionId: currentTranslation.versionId,
    readModelHash: "a".repeat(64), basis: "READ_MODEL_RECOMPUTED", parserVersion: "fixture", observedAt: at, stamps: null,
    retrieval: { requestedUrl: sourceUrl, finalUrl: sourceUrl, httpStatus: 200, rawHash: "b".repeat(64), retrievedAt: at } };
  const confirmed = await readNationalBallotState("OH", async () => [[{ field: "$source", value: { ...sourceBallot, measureCount: 1,
    currentTranslation: { ...currentTranslation, confirmation: serializeUnchangedConfirmation(confirmation) } } }]]);
  assert.deepEqual(confirmed.currentTranslation, { ...currentTranslation, latestConfirmation: confirmation });
});

test("national measures require complete vaulted text with matching source and state identities", async () => {
  const vault = new MemoryEvidenceStore();
  await saveSource(vault, text, ballot.measures[0].officialText!);
  await saveSource(vault, authorityHtml, authority);
  assert.equal((await nationalMeasureInputs(ballot, vault, division)).captures.length, 2);
  for (const invalid of [
    { ...ballot, measures: [{ ...ballot.measures[0], officialText: undefined }] },
    { ...ballot, contests: [{ ...ballot.contests[0], ocdId: "ocd-division/country:us/state:ca" }] },
  ]) assert.equal((await nationalMeasureInputs(invalid, vault, division)).captures.length, 0);
  await assert.rejects(nationalMeasureInputs({ ...ballot, measureRecords: [{ ...record, sourceHash: "0".repeat(64) }] }, vault, division), /differs/);
  await assert.rejects(nationalMeasureInputs(ballot, new MemoryEvidenceStore(), division), /missing/);
  const district = await nationalMeasureInputs({ ...ballot, election: { ...ballot.election, state: "DC" },
    contests: [{ ...ballot.contests[0], ocdId: "ocd-division/country:us/district:dc" }] }, vault, "ocd-division/country:us/district:dc");
  assert.equal(district.captures.length, 2);
  assert.deepEqual(district.divisions, ["ocd-division/country:us/district:dc"]);
});

test("translation publication retains every verified original receipt without reading binary documents again", async () => {
  const vault = new MemoryEvidenceStore(), store = new MemoryRoutineDataStore(), repos = createMemoryRepositories();
  const url = "https://elections.example.gov/pamphlet.pdf";
  const pdf = async (sourceUrl: string): Promise<MeasureSourceReference> => {
    const bytes = Buffer.concat([Buffer.from(`%PDF-1.7 ORIGINAL_BINARY ${sourceUrl}\n`), Buffer.from([255, 254, 0])]);
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const source = { sourceUrl, sourceHash, retrievedAt: at, publisher: "State election authority",
      vault: { key: `project/freshness/source/${new URL(sourceUrl).hostname}/2026/10/14/translation-test/sha256-${sourceHash}.pdf`,
        byteLength: bytes.byteLength, contentType: "application/pdf" } };
    await vault.put(source.vault.key, bytes, { contentHash: `sha256-${sourceHash}`, contentType: source.vault.contentType,
      byteLength: bytes.byteLength, custom: { tier: "RAW", canonicalUrl: sourceUrl } });
    return source;
  };
  const pamphlet = await pdf(url), legislation = await pdf("https://legislature.example.gov/resolution.pdf");
  const question = { ...await pdf("https://elections.example.gov/ballot-language.pdf"), originals: [legislation] };
  const source = { ...reference(text, url), originals: [pamphlet, question, legislation] };
  await vault.put(source.vault.key, Buffer.from(text), { contentHash: `sha256-${source.sourceHash}`, contentType: source.vault.contentType,
    byteLength: source.vault.byteLength, custom: { tier: "SANITIZED_DERIVED", canonicalUrl: url,
      format: "measure-source-text@1", originals: JSON.stringify(source.originals) } });
  const held = { ...ballot, sourceAuthorities: [], measureRecords: [{ ...record, sourceUrl: url }],
    measures: [{ ...ballot.measures[0], officialText: source }] };
  const reads = new Map<string, number>(), stream = vault.stream.bind(vault);
  vault.get = async () => { throw new Error("Original bytes must only be streamed."); };
  vault.stream = async key => { reads.set(key, (reads.get(key) ?? 0) + 1); return stream(key); };
  const admitted = await nationalMeasureInputs(held, vault, division);
  assert.equal(admitted.captures.length, 1, "binary originals do not become text captures");
  assert.equal(admitted.captures[0].originalSourceReceipts?.length, 3, "shared nested originals are receipted once");
  assert.deepEqual([...reads.values()], [1, 1, 1, 1]);
  let requests = 0;
  const result = await runHeldMeasureTranslations({ ...admitted, repos, store, now: at, attempts: [], saveAttempt: async () => {},
    transportFor: () => async request => {
      requests++;
      assert.ok(!JSON.stringify(request).includes("ORIGINAL_BINARY"));
      const payload = JSON.parse(request.messages[0].content as string);
      assert.equal(payload.source ?? payload.originalSource, text);
      const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field,
        text: record[field as "whatItDoes"], quote: record[field as "whatItDoes"] }));
      const value = request.tools[0].name === "write_measure_translation"
        ? { measure: { ...record, sourceUrl: url, writtenAt: payload.writtenAt }, sentences }
        : { checked: payload.proposal.sentences.map((row: { field: string; text: string }) => ({ ...row, supported: true })) };
      return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "result", name: request.tools[0].name, input: value }],
        usage: { input_tokens: 100, output_tokens: 50 } };
    } });
  assert.equal(result.outcomes[0].status, "PUBLISHED", JSON.stringify(result));
  assert.equal(requests, 2);
  assert.deepEqual([...reads.values()], [1, 1, 1, 1], "publication reuses verified lineage metadata without vault reads");
  const candidate = (await store.readCandidate(result.outcomes[0].versionId!))!;
  const receipts = candidate.candidate.retrieval.manualSourceReceipt!.sources;
  assert.equal(receipts.length, 4, "the derived text and its same-URL original retain distinct content hashes");
  for (const reference of [source, pamphlet, question, legislation]) assert.ok(receipts.some(receipt =>
    receipt.finalUrl === reference.sourceUrl && receipt.rawHash === reference.sourceHash && receipt.publisher === reference.publisher));
  const checked = (await readTranslations([division], { store, now: at, bypassCache: true }))[0];
  await assert.rejects(publishTranslation(new MemoryRoutineDataStore(), { record: checked,
    captures: [admitted.captures[0], admitted.captures[0]], now: at }), /MANUAL_SOURCE_PROOF_DUPLICATED/,
    "lineage receipts cannot hide duplicate source captures from the existing source guard");
  for (const originals of [[], admitted.captures[0].originalSourceReceipts!.map((receipt, index) =>
    index ? receipt : { ...receipt, rawHash: "0".repeat(64) })]) {
    assert.throws(() => translationPackage({ record: checked, captures: [{ ...admitted.captures[0], originalSourceReceipts: originals }], now: at }),
      /originals lack their exact verified source receipts/);
  }
  vault.stream = async key => {
    const held = await stream(key);
    return key !== legislation.vault.key || !held ? held : { ...held, body: new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(legislation.vault.byteLength)); controller.close();
    } }) };
  };
  await assert.rejects(nationalMeasureInputs(held, vault, division), /differs from its source reference/);
});

test("one state worker translates county, city and school measures one place at a time and skips current sources", async () => {
  const vault = new MemoryEvidenceStore(), repos = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  await saveSource(vault, text, ballot.measures[0].officialText!);
  await saveSource(vault, authorityHtml, authority);
  const originalText = "Official enrolled legislative publication.";
  const original = reference(originalText, "https://elections.example.gov/enrolled.txt");
  await saveSource(vault, originalText, original);
  const places = ["county:alder", "place:alder", "school_district:alder"].map(suffix => `${division}/${suffix}`);
  let vaultReads = 0, originalReads = 0, requests = 0, yielded = 0, sourceVersion = "initial", clock = at;
  let heldSource: MeasureSourceReference = { ...ballot.measures[0].officialText!, originals: [original] }, missingFirst = false;
  const streamed = vault.stream.bind(vault);
  vault.stream = async key => { vaultReads++; if (key === original.vault.key) originalReads++; return streamed(key); };
  const published: string[] = [], currentIdentities: unknown[] = [];
  const input = { state: "OH", vault, repos, store, now: () => clock, capacity: () => 1,
    slots: { acquire: async () => () => {} }, continueWork: () => true, report: () => {},
    publishPlace: async (division: string, identity?: { versionId: string }) => { published.push(division); currentIdentities.push(identity); },
    readPlaces: async function* () {
      for (const place of places) {
        yielded++;
        const contestId = `ballot-measure:${encodeURIComponent(place)}:12`;
        const contests = place === places[0] ? [contestId, `${contestId}-second`] : [contestId];
        yield { division: place, sourceBallot: { scope: `US:ballot-measures:${place}`, versionId: `held:${sourceVersion}:${place}` }, ballots: [{ ...ballot,
          contests: contests.map(id => ({ ...ballot.contests[0], id, ocdId: place })),
          measures: contests.map((contestId, index) => ({ ...ballot.measures[0], id: `${contestId}#question`, contestId,
            officialText: missingFirst && place === places[0] && index === 0
              ? { ...heldSource, vault: { ...heldSource.vault, key: heldSource.vault.key.replace("/translation-test/", "/missing-law/") } } : heldSource })),
          measureRecords: contests.map(contestId => ({ ...record, contestId })) }] };
      }
    },
    transportFor: (subject: { subjectId: string; state: string; ocdId: string }) => async (request: ModelRequest) => {
      requests++;
      assert.equal(subject.ocdId, places[yielded - 1], "a later place cannot be read while this source is in use");
      const payload = JSON.parse(request.messages[0].content as string);
      const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field, text: record[field as "whatItDoes"], quote: record[field as "whatItDoes"] }));
      const value = request.tools[0].name === "write_measure_translation"
        ? { measure: { ...record, contestId: subject.subjectId, writtenAt: payload.writtenAt }, sentences }
        : { checked: payload.proposal.sentences.map((sentence: { field: string; text: string }) => ({ ...sentence, supported: true })) };
      return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "result", name: request.tools[0].name, input: value }], usage: { input_tokens: 100, output_tokens: 50 } };
    } };
  const firstPlaces = await runNationalMeasureTranslations(input);
  assert.equal(firstPlaces[0].published, 4, JSON.stringify(firstPlaces));
  assert.equal(originalReads, places.length, "verified original identities are shared within one place and released before the next place");
  assert.equal(requests, 8);
  assert.deepEqual(published, places);
  const costs = await repos.costs.readAll(), charges = await repos.modelCharges.readSince("1970-01-01T00:00:00.000Z");
  assert.equal(charges.length, 8);
  assert.ok(costs.every(cost => places.includes(cost.jurisdiction!) && cost.workItemId.startsWith("ballot-measure:")));
  assert.ok((await repos.costs.keys()).every(key => key.startsWith("ballot-measure:")), "cost logs retain the contest identity");
  const billedAt = Math.max(...charges.map(charge => Date.parse(charge.at)));
  const budgetReadAt = new Date(billedAt + SETTLED_HOLD_RETENTION_MS + 1).toISOString();
  const dayStart = new Date(Date.parse(budgetReadAt) - 24 * 3_600_000).toISOString();
  for (const place of places) {
    const daily = scopeModelSpend(charges, new Set([place]), dayStart, budgetReadAt);
    const expected = costs.filter(cost => cost.jurisdiction === place).reduce((sum, cost) => sum + cost.cost.usd!, 0);
    assert.ok(expected > 0); assert.ok(Math.abs(daily.usd! - expected) < 1e-12);
    const area = { key: `area:${place}`, label: place, budgetUsd: expected + 1, historicalUsd: 0, historyReadAt: dayStart };
    const heldAt = new Date(billedAt).toISOString();
    assert.equal((await repos.spendHolds.admit({ holdId: place, jobId: place, obligationId: place,
      lines: { sends: [], areas: [area] }, usd: expected, what: "translation" }, heldAt)).admit, true);
    await repos.spendHolds.settle({ jobId: place, usd: expected, costRecordedAt: heldAt }, heldAt);
    await repos.spendHolds.sweep(budgetReadAt);
    assert.equal((await repos.spendHolds.admit({ holdId: `${place}:next`, jobId: `${place}:next`, obligationId: place,
      lines: { sends: [], areas: [{ ...area, budgetUsd: daily.usd!, historicalUsd: daily.usd!, historyReadAt: budgetReadAt }] },
      usd: 0.01, what: "next translation" }, budgetReadAt)).admit, false, "daily area spend still binds after the settled hold expires");
  }
  assert.deepEqual(await repos.spendHolds.liveAll(budgetReadAt), {});
  assert.equal(scopeModelSpend(charges, new Set([`${division}/place:neighbor`]), dayStart, budgetReadAt).usd, 0);
  for (const place of places) {
    const held = await readTranslations([place], { store, now: at, bypassCache: true });
    assert.equal(held.length, place === places[0] ? 2 : 1);
    assert.equal(held[0].ocdId, place);
    const checkedMeasure = held[0];
    if (checkedMeasure.kind === "MEASURE") {
      const reference = checkedMeasure.sourceReference;
      const reordered = { ...Object.fromEntries(Object.entries(reference).reverse()),
        vault: Object.fromEntries(Object.entries(reference.vault).reverse()) } as MeasureSourceReference;
      assert.notEqual(JSON.stringify(reordered), JSON.stringify(reference));
      const captures = await nationalMeasureInputs({ ...ballot, measures: [{ ...ballot.measures[0], officialText: heldSource }] }, vault, division);
      assert.doesNotThrow(() => translationPackage({ record: { ...checkedMeasure, sourceReference: reordered }, captures: captures.captures, now: at }));
      assert.throws(() => translationPackage({ record: { ...checkedMeasure, sourceReference: { ...reordered, publisher: "Another authority" } },
        captures: captures.captures, now: at }), /differs from its verified capture/);
    }
    const projection = await readTranslationProjection({ scope: translationScope(place), store, now: at, bypassCache: true });
    assert.equal(projection.kind, "PROMOTED");
    if (projection.kind === "PROMOTED") assert.deepEqual(projection.value.sourceBallot, { scope: `US:ballot-measures:${place}`, versionId: `held:${sourceVersion}:${place}`, measureCount: place === places[0] ? 2 : 1 });
  }
  yielded = 0; vaultReads = 0; published.length = 0;
  assert.equal((await runNationalMeasureTranslations(input))[0].reused, 4);
  assert.equal(vaultReads, 0);
  assert.equal(requests, 8);
  assert.deepEqual(published, places, "current checked summaries still repair a missing place edge artifact");
  sourceVersion = "advanced"; clock = "2026-10-15T19:00:00Z"; yielded = 0;
  heldSource = reference(text, sourceUrl, clock);
  await saveSource(vault, text, heldSource);
  const originalChecks = await readTranslations(places, { store, now: at, bypassCache: true });
  const refreshed = await runNationalMeasureTranslations(input);
  assert.equal(refreshed[0].reused, 4, JSON.stringify(refreshed));
  assert.equal(requests, 8, "a moved raw pointer with unchanged law and question never calls the models");
  for (const place of places) {
    const projection = await readTranslationProjection({ scope: translationScope(place), store, now: clock, bypassCache: true });
    assert.equal(projection.kind, "PROMOTED");
    if (projection.kind === "PROMOTED") {
      assert.equal(projection.value.sourceBallot?.versionId, `held:advanced:${place}`);
      for (const row of projection.value.records) {
        assert.equal(row.writtenAt, at); assert.equal(row.retrievedAt, clock);
        assert.deepEqual(row.checked, originalChecks.find(prior => prior.id === row.id)?.checked);
        if (row.kind === "MEASURE") assert.deepEqual(row.sourceReference, heldSource);
      }
    }
  }
  vaultReads = 0; published.length = 0; currentIdentities.length = 0;
  const narrow = await runNationalMeasureTranslations({ ...input, readPlaces: async function* () {
    for (const place of places) yield { division: place, ballots: [], currentMeasureCount: place === places[0] ? 2 : 1,
      currentTranslation: { versionId: `checked:${place}` } };
  } });
  assert.equal(narrow[0].reused, 4); assert.equal(requests, 8); assert.equal(vaultReads, 0);
  assert.deepEqual(published, places);
  assert.deepEqual(currentIdentities, places.map(place => ({ versionId: `checked:${place}` })), "the bounded cursor identity reaches the exact place publisher");
  missingFirst = true; sourceVersion = "source-gap"; clock = "2026-10-15T20:00:00Z"; yielded = 0;
  places.push(`${division}/place:later`);
  const isolated = await runNationalMeasureTranslations(input);
  assert.equal(isolated[0].held, 1, JSON.stringify(isolated));
  assert.equal(isolated[0].published, 1, JSON.stringify(isolated));
  assert.equal(isolated[0].error, null); assert.equal(requests, 10);
  assert.equal((await readTranslations([places[3]], { store, now: clock, bypassCache: true })).length, 1);
});

test("separate full laws in the same state pamphlet keep their exact capture identities", async () => {
  const url = "https://www.ohio.gov/pamphlet.pdf";
  const vault = new MemoryEvidenceStore(), source = reference(text, url);
  await saveSource(vault, text, source);
  const input = await nationalMeasureInputs({ ...ballot, measureRecords: [{ ...record, sourceUrl: url }],
    measures: [{ ...ballot.measures[0], officialText: source }] }, vault, division);
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
    areas: null, lifetimeHuntSubjects: [], circuits: [], worstCaseUsd: 1 }));
  let sends = 0;
  const messages = async () => { sends++; throw new Error("Paused work sent a model request"); };
  const armed = await armHunterLane({ repos, now: () => at, armingPath, messages, batch: backgroundBatchTransport({ apiKey: "" }),
    credentialConfigured: true, credentialVar: "TEST_KEY", providerQueue: new ModelProviderQueue(), ownSpend: new LaneOwnSpend(),
    circuits: null, onCondition: () => {} });
  assert.match(armed.closed?.reason ?? "", /paused the runner/);
  const result = await runNationalMeasureTranslations({ state: "OH", vault: new MemoryEvidenceStore(), repos, store: new MemoryRoutineDataStore(), now: () => at,
    capacity: () => armed.guards?.paidWorkerCapacity() ?? 0, continueWork: () => armed.closed === null,
    readPlaces: async function* () { throw new Error("Paused work read a state"); }, slots: { acquire: async () => () => {} },
    transportFor: () => messages, report: () => {} });
  assert.deepEqual(result, []);
  assert.equal(sends, 0);
});

test("a closed paid lane does not read source evidence or start model work", async () => {
  const result = await runNationalMeasureTranslations({ state: "OH", vault: new MemoryEvidenceStore(),
    repos: createMemoryRepositories(), store: new MemoryRoutineDataStore(), now: () => at, capacity: () => 0,
    slots: { acquire: async () => { throw new Error("No worker should start."); } }, continueWork: () => true,
    transportFor: () => async () => { throw new Error("No model call should start."); }, report: () => {} });
  assert.deepEqual(result, []);
});

test("a state translation observes its admitted process before reading and releases memory on success or failure", async () => {
  for (const fail of [false, true]) {
    const events: string[] = [];
    const result = await runNationalMeasureTranslations({ state: "OH", vault: new MemoryEvidenceStore(), repos: createMemoryRepositories(),
      store: new MemoryRoutineDataStore(), now: () => at, capacity: () => 1, continueWork: () => true, report: () => {},
      slots: { acquire: async entry => {
        events.push(`acquire:${entry}`);
        return Object.assign(() => { events.push("release"); }, { observe: (pid: number) => { assert.equal(pid, process.pid); events.push("observe"); } });
      } },
      readPlaces: async function* () {
        assert.deepEqual(events, ["acquire:scripts/translate-national-measures.mts", "observe"]);
        events.push("read");
        if (fail) throw new Error("Source state is unavailable");
        yield { division, ballots: [] };
      }, transportFor: () => async () => { throw new Error("An empty state cannot send model work"); } });
    assert.deepEqual(events, ["acquire:scripts/translate-national-measures.mts", "observe", "read", "release"]);
    if (fail) assert.match(result[0].error!, /Source state is unavailable/);
    else assert.deepEqual(result, []);
  }
});

test("a failed durable charge write keeps spend reserved and completes the measure's accounting boundary", async () => {
  const vault = new MemoryEvidenceStore(), repos = createMemoryRepositories();
  await saveSource(vault, text, ballot.measures[0].officialText!);
  await saveSource(vault, authorityHtml, authority);
  repos.costs.append = async () => { throw new Error("Charge storage is unavailable"); };
  let released = 0, completed = 0;
  const reports: string[] = [];
  const result = await runNationalMeasureTranslations({ state: "OH", vault, repos, store: new MemoryRoutineDataStore(), now: () => at,
    capacity: () => 1, continueWork: () => true, slots: { acquire: async () => () => {} }, report: line => { reports.push(line); },
    readPlaces: async function* () { yield { division, ballots: [ballot] }; },
    onCostRecorded: () => { released++; }, onMeasureComplete: place => { assert.equal(place, division); completed++; },
    transportFor: () => async request => ({ model: request.model, stop_reason: "tool_use", content: [], usage: { input_tokens: 100, output_tokens: 50 } }) });
  assert.equal(result[0].held, 1);
  assert.ok(reports.some(line => line.includes("Charge storage is unavailable")));
  assert.equal(released, 0); assert.equal(completed, 1);
});

test("an unreadable checked place stops before source hydration or paid rewriting", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  let reads = 0, sends = 0;
  store.readPromotion = async () => { throw new Error("Checked place storage is unavailable"); };
  vault.stream = async () => { reads++; throw new Error("Source bytes must remain unread"); };
  const result = await runNationalMeasureTranslations({ state: "OH", vault, store, repos: createMemoryRepositories(), now: () => at,
    capacity: () => 1, continueWork: () => true, slots: { acquire: async () => () => {} }, report: () => {},
    readPlaces: async function* () { yield { division, ballots: [ballot] }; },
    transportFor: () => async () => { sends++; throw new Error("No paid rewrite should start"); } });
  assert.match(result[0].error!, /Checked measure input .*STORE_UNREACHABLE/);
  assert.equal(reads, 0); assert.equal(sends, 0);
});
