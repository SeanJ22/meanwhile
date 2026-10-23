/** Read-only replay. Inputs are SELECT exports from the two production branches;
 * all publication, attempts and metering below use memory stores. No provider is called.
 * node --use-env-proxy --experimental-strip-types --import ./scripts/register-test-loader.mjs
 *   --import ./tests/helpers/install-fixture-doors.ts scripts/ex-03-replay.mts /tmp/ex03
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateEvent, CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { readerBallotSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { summaryForContest } from "../lib/ballot/measure-summary.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { pageWords } from "../lib/control-plane/promotion/section3.ts";
import { saveVotingSourceDoor } from "../lib/ballot/voting-source-publication.ts";
import { runMeasureTranslationPass, loadPromotedMeasureBallots } from "../lib/translate/provider.ts";
import { measureTranslationRoutineReceipt } from "../lib/translate/routine-receipt.ts";
import { measureTranslationRoutineTask } from "../lib/translate/routine-contract.ts";
import { routineAdmissionClock, routineTaskDue } from "../lib/civic-data/runner.ts";
import { routineTranslationAttempts } from "../lib/translate/routine-attempts.ts";
import { routineMeasureFinds } from "../lib/translate/routine-finds.ts";
import { loadRoutineMeasureSources } from "../lib/translate/routine-sources.ts";
import { readTranslations } from "../lib/translate/projection-reader.ts";
import { translationHash, type MeasureTranslation } from "../lib/translate/records.ts";
import { createMemoryRepositories } from "../tests/helpers/playbooks.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const directory = process.argv[2];
if (!directory) throw new Error("Pass the directory containing the production SELECT exports.");
const read = async (name: string) => JSON.parse(await readFile(join(directory, name), "utf8"));
const store = new MemoryRoutineDataStore();
const [authority] = await read("production-al-authority.json");
const ballotPayload = await read("production-al-ballots.json");
const events = await read("production-al-events.json") as CandidateEvent[];
const c = authority.candidate, p = authority.promotion;
// Hydrate the real production candidate with its real payload, receipt and
// pointer history. Ordinary typed reads below must still validate this proof.
const candidate = { ...c.candidate, readModel: ballotPayload, normalizedPayload: ballotPayload };
const snapshot = store as unknown as {
  candidates: Map<string, CandidateVersionRecord>; history: Map<string, CandidateEvent[]>; promotions: Map<string, PromotedProjection>;
};
snapshot.candidates.set(c.id, { candidate, state: c.state, acquisitionSucceeded: c.acquisition_succeeded,
  receipt: c.validation_receipt, promotedVersion: c.promoted_version_id, lastKnownGoodVersion: c.last_known_good_version_id,
  failureCode: c.failure_code, failureDetail: c.failure_detail });
snapshot.history.set(c.id, events);
snapshot.promotions.set(p.key, { key: p.key, sourceId: p.source_id, recordClass: p.record_class, scope: p.scope,
  versionId: p.current_version_id, lastKnownGoodVersionId: p.last_known_good_version_id, promotedAt: p.promoted_at,
  payload: ballotPayload, receipt: p.validation_receipt });

const [{ payload }] = await read("production-al-translations.json");
const records = payload.records as MeasureTranslation[];
assert.equal(records.length, 4);
const now = records[0].writtenAt;
assert.ok(records.every(record => record.writtenAt === now));
const tick = measureTranslationRoutineTask("AL").cadenceMs;
const tomorrow = new Date(Math.ceil((Date.now() + 24 * 60 * 60_000) / tick) * tick).toISOString();
const ballots = await loadPromotedMeasureBallots("AL", { store, now });
const captures = records.map(record => ({ evidence: { artifactId: `replay:${record.sourceTextHash}`, acquiredByAttemptId: record.id,
  sourceId: new URL(record.sourceUrl).hostname, methodRouteId: "production-checked-source", canonicalUrl: record.sourceUrl,
  contentHash: `sha256-${translationHash(record.sourceText)}`, text: record.sourceText, retrievedAt: record.retrievedAt,
  sourceDocument: { artifactId: `replay:${record.sourceHash}`, contentHash: `sha256-${record.sourceHash}`, kind: "PDF_TEXT" as const } },
  observedAt: record.retrievedAt, partial: false, httpStatus: 200, transport: "REACHABLE" }));
let responses = 0;
const repos = createMemoryRepositories();
const input = { states: ["AL"], repos, store, now, modelLaneEnabled: true, paidWorkerCapacity: () => 1,
  loadCapturesForState: async () => captures, readAttemptsForState: async () => [], saveAttempt: async () => {},
  foundSources: new Map(records.map(record => [record.subjectId, [record.sourceUrl]])),
  guardedTransportFor: () => async (request: import("../lib/control-plane/scheduler/scout-executor.ts").ModelRequest) => {
    responses++;
    const message = JSON.parse(request.messages[0].content as string);
    const record = records.find(record => record.subjectId === message.subject.contestId)!;
    const writing = request.tools[0].name === "write_measure_translation";
    assert.equal(request.model, writing ? record.writerModel : record.checkerModel);
    return { model: request.model, stop_reason: "tool_use", usage: { input_tokens: 0, output_tokens: 0 },
      content: [{ type: "tool_use", id: "saved-production-result", name: request.tools[0].name,
        input: writing ? { measure: record.measure, sentences: record.sentences } : { checked: record.checked } }] };
  } };
const first = await runMeasureTranslationPass(input);
assert.equal(first.checkedAfter, 4, JSON.stringify(first));
assert.equal(first.held.length, 0);
assert.equal(responses, 8);
const receipt = await measureTranslationRoutineReceipt({ store, ballots, state: "AL", now, holdReason: null });
assert.equal(receipt.exitCode, 0);
const divisions = [...new Set(records.map(record => record.ocdId))];
const reader = await readerBallotSourcesForDivisions(["ocd-division/country:us/state:al/county:jefferson"], { store, now, bypassCache: true });
const attached = reader.map(({ source }) => source.normalize(ballotPayload));
const summaries = records.map(record => {
  const ballot = attached.find(ballot => ballot.contests.some(contest => contest.id === record.subjectId))!;
  const summary = summaryForContest(record.subjectId, ballot.measureRecords ?? []);
  assert.equal(summary?.summary, record.measure.whatItDoes);
  assert.equal(summary?.yesMeans, record.measure.yesMeans);
  assert.equal(summary?.noMeans, record.measure.noMeans);
  assert.equal(summary?.summarizesUrl, record.sourceUrl);
  return summary!;
});
const response = await fetch(`${PUBLIC_SITE_ORIGIN}/ballot?zip=35203`, { signal: AbortSignal.timeout(30_000) });
assert.equal(response.status, 200);
const html = await response.text(), visible = pageWords(html);
await writeFile(join(directory, "al-live-ballot.html"), html);
const liveMatched = summaries.filter(summary => [summary.summary, summary.yesMeans!, summary.noMeans!]
  .every(sentence => visible.includes(pageWords(sentence)))).length;
const mapUrl = `${PUBLIC_SITE_ORIGIN}/ballot?state=AL&lat=33.52&lng=-86.8`;
const mapResponse = await fetch(mapUrl, { signal: AbortSignal.timeout(30_000) });
assert.equal(mapResponse.status, 200);
const mapHtml = await mapResponse.text(), mapText = pageWords(mapHtml);
await writeFile(join(directory, "al-live-map-ballot.html"), mapHtml);
for (const summary of summaries) {
  assert.ok([summary.summary, summary.yesMeans!, summary.noMeans!].every(sentence => mapText.includes(pageWords(sentence))));
  assert.ok(mapHtml.includes(summary.summarizesUrl));
}
// Render the actual proposed ballot page against the replay's canonical data.
const { installCanonicalEntries, installReaderValues, activateCanonicalFixture } = await import("../tests/helpers/canonical-reader-fixtures.ts");
const { promotedPayloadSha256 } = await import("../lib/civic-data/attested-promotion.ts");
const { clearPromotedReadModelCache } = await import("../lib/civic-data/read-model.ts");
const entries = [await store.readPromotion("BALLOT_CANDIDACY", p.scope),
  ...await store.readPromotions("CURATED_READER_RECORD", records.map(record => `US:plain-english-translations:${record.ocdId}`))]
  .filter(entry => entry !== null).map(projection => ({ kind: "PROMOTED" as const, projection,
    attested: { recordClass: projection.recordClass, scope: projection.scope, versionId: projection.versionId,
      payloadSha256: promotedPayloadSha256(projection.payload), retrievedAt: now, staleAtRetrieval: false, version: null, sourceThrough: now } }));
const fixtureKey = "ex03-production-replay";
installReaderValues({ stateAuthorities: { "ballot-contests": { AL: { value: { kind: "PROMOTED_POINTERS", entries: [entries[0]] }, versionId: p.current_version_id } } } }, fixtureKey);
installCanonicalEntries(entries, fixtureKey);
activateCanonicalFixture(fixtureKey);
clearPromotedReadModelCache();
const { default: BallotPage } = await import("../app/ballot/page.tsx");
const tree = await BallotPage({ searchParams: Promise.resolve({ zip: "35203" }) });
const rendered: string[] = [], sources = new Set<string>();
const visited = new Set<object>();
async function walk(node: unknown): Promise<void> {
  if (node instanceof Promise) { await walk(await node); return; }
  if (typeof node === "string" || typeof node === "number") { rendered.push(String(node)); return; }
  if (!node || typeof node !== "object" || visited.has(node)) return;
  visited.add(node);
  if (Array.isArray(node)) { for (const child of node) await walk(child); return; }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    await walk(await (element.type as (props: unknown) => Promise<unknown>)(element.props ?? {})); return;
  }
  for (const [key, value] of Object.entries(element.props ?? node)) {
    if (key === "sourceUrl" && typeof value === "string") sources.add(value);
    await walk(value);
  }
}
await walk(tree);
const pageText = pageWords(rendered.join(" "));
await writeFile(join(directory, "proposed-ballot-text.txt"), rendered.join(" "));
for (const summary of summaries) {
  for (const sentence of [summary.summary, summary.yesMeans!, summary.noMeans!]) assert.ok(pageText.includes(pageWords(sentence)), summary.contestId);
  assert.ok(sources.has(summary.summarizesUrl));
}

const clock = await store.clock(measureTranslationRoutineTask("AL").sourceId, "CURATED_READER_RECORD", measureTranslationRoutineTask("AL").scope);
assert.equal(routineTaskDue(measureTranslationRoutineTask("AL"), clock, Date.parse(now) + 1), false);
assert.equal(routineTaskDue(measureTranslationRoutineTask("AL"), clock, Date.parse(tomorrow)), true);
const second = await runMeasureTranslationPass({ ...input, now: tomorrow });
assert.equal(second.checkedBefore, 4);
assert.equal(second.outcomes.length, 0);
assert.equal(responses, 8);
assert.equal((await measureTranslationRoutineReceipt({ store, ballots, state: "AL", now: tomorrow, holdReason: null })).exitCode, 0);
assert.equal((await readTranslations(divisions, { store, now: tomorrow, bypassCache: true })).length, 4);

// Alaska's observed production search hit was saved as bytes but rejected by
// the old full-title matcher. Replay the real ballot, door and response bytes.
const akParts = await read("production-ak-parts.json") as { hash: string; payload: unknown }[];
const parts = new CivicPayloadParts({ read: async hashes => akParts.filter(row => hashes.includes(row.hash)),
  existing: async () => [], write: async () => { throw new Error("The snapshot is read only."); } });
const ak = await parts.loadOwned({ $civicPayloadPart: "42900efe055c11c509498edda4cf891371ef40d13b220f2154e439da073133ae" }) as { ballots: Record<string, BallotSet> };
const hearing = "https://ltgov.alaska.gov/newsroom/2026/07/lt-governor-nancy-dahlstrom-to-host-ballot-measure-public-hearings/";
const akRepos = createMemoryRepositories(), finds = routineMeasureFinds(akRepos, "AK");
const [door] = await read("production-ak-door.json");
await saveVotingSourceDoor(akRepos.doors, JSON.parse(door.value.config.votingSource), now);
const root = await mkdtemp(join(tmpdir(), "ex03-replay-"));
let searches = 0;
const previousVault = process.env.WTP_VAULT_PROVIDER;
process.env.WTP_VAULT_PROVIDER = "local";
try {
  const akInput = { repos: akRepos, root, state: "AK", ballots: Object.values(ak.ballots), now: () => now, finds,
    open: async (url: string) => {
      if (url === hearing) return new Response(await readFile(join(directory, "ak-hearing.html")));
      const id = /View.aspx\?id=(224503|224508)$/.exec(url)?.[1];
      if (id) return new Response(await readFile(join(directory, `ak-notice-${id}.html`)));
      return new Response("The observed publisher route failed.", { status: 502 });
    }, search: async () => { searches++; return [{ url: hearing, title: "Ballot measure public hearings" }]; } };
  const captured = await loadRoutineMeasureSources(akInput);
  assert.equal(captured.discovered.size, 2);
  const akAttempts = routineTranslationAttempts(akRepos, "AK");
  const admitCaptures = async (sources: typeof captured, at: string) => {
    const result = await runMeasureTranslationPass({ states: ["AK"], repos: akRepos, store: new MemoryRoutineDataStore(), now: at,
      modelLaneEnabled: true, paidWorkerCapacity: () => 1, loadBallotsForState: async () => Object.values(ak.ballots),
      loadCapturesForState: async () => sources.captures, foundSources: sources.discovered,
      readAttemptsForState: akAttempts.read, saveAttempt: akAttempts.save,
      guardedTransportFor: () => async () => { throw new Error("Production source admitted; replay sends no model request."); } });
    assert.equal(result.outcomes.length, 2, JSON.stringify(result));
    assert.ok(result.outcomes.every(row => row.detail?.includes("Production source admitted")));
    return result.outcomes.length;
  };
  const akAdmitted = await admitCaptures(captured, now);
  const searched = searches;
  const next = await loadRoutineMeasureSources({ ...akInput, now: () => tomorrow });
  assert.equal(next.discovered.size, 2);
  const akAdmittedTomorrow = await admitCaptures(next, tomorrow);
  assert.equal(searches, searched, "tomorrow reads the remembered official pages without another search");
  const admitted = routineAdmissionClock(undefined, now, Date.parse(tomorrow));
  assert.equal(routineTaskDue(measureTranslationRoutineTask("AK"), admitted, Date.parse(now) + 1), false);
  assert.equal(routineTaskDue(measureTranslationRoutineTask("AK"), admitted, Date.parse(tomorrow)), true);
  const proof = { upstream: "BA-01 promoted state ballots; EX-02 source discovery; RN-01 standing task admission",
    downstream: "plain-english-translations publication -> readerBallotSourcesForDivisions -> summaryForContest -> /ballot",
    production: { readerProject: "tiny-hill-13996172", readerBranch: "br-delicate-lab-ax02xuo5", ballotVersion: p.current_version_id,
      controlProject: "withered-sunset-39821877", controlBranch: "br-tiny-frog-aeufpjeq" },
    first: { at: now, alPublished: first.checkedAfter, proposedZipBallotCards: summaries.length, currentLiveZipCards: liveMatched, currentLiveMapCards: summaries.length, recordedModelResponses: responses,
      liveUrl: `${PUBLIC_SITE_ORIGIN}/ballot?zip=35203`, liveMapUrl: mapUrl, akMeasuresReachingWriter: akAdmitted, akFound: Object.fromEntries(captured.discovered) },
    tomorrow: { at: tomorrow, scheduled: true, alReused: second.checkedBefore, additionalModelRequests: 0,
      akMeasuresReachingWriter: akAdmittedTomorrow, akFound: Object.fromEntries(next.discovered), additionalSearches: searches - searched },
    boundary: "Production SELECTs and public GET only. All writes local. Saved production model results replayed; no model request or live publication." };
  await writeFile(join(directory, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof, null, 2));
} finally {
  if (previousVault === undefined) delete process.env.WTP_VAULT_PROVIDER; else process.env.WTP_VAULT_PROVIDER = previousVault;
  await rm(root, { recursive: true, force: true });
}
