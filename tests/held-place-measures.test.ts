import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishHeldPlaceMeasures } from "../lib/ballot/held-place-measures.ts";
import { placeMeasureScope, readPlaceMeasureProjection, type PlaceMeasureProjection } from "../lib/ballot/place-measures.ts";
import type { MeasureSourceReference } from "../lib/ballot/types.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { manualProjectionCandidate, readManualProjectionPrior, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { mergeBallotContests } from "../lib/civic-data/worker-ballot-contests.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { promotedPointerVersion } from "../lib/civic-data/reader-edge-outcome.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { readerPlaceManifestKey } from "../lib/meetings/place-edge.ts";

const now = "2026-10-15T18:00:00.000Z", division = "ocd-division/country:us/state:oh/county:alder";
const key = "OH:oh-2026-11-03";
async function sourcePackage(vault: MemoryEvidenceStore, place = division, number = "12"): Promise<ManualProjectionPackage> {
  const sourceUrl = `https://alder.example.gov/measure-${number}`, title = `Proposition ${number}`;
  const question = `Shall the library levy ${number} be adopted?`, statement = `The levy ${number} funds library services.`;
  const body = `${title}\n${question}\n${statement}\nA YES vote adopts the levy. A NO vote keeps the existing levy.`;
  const bytes = Buffer.from(body), sourceHash = createHash("sha256").update(bytes).digest("hex");
  const vaultKey = `project/freshness/source/elections/2026/10/15/measure/sha256-${sourceHash}.txt`;
  const publisher = "Alder County Elections";
  await vault.put(vaultKey, bytes, { contentHash: `sha256-${sourceHash}`, contentType: "text/plain", byteLength: bytes.length,
    custom: { tier: "RAW", canonicalUrl: sourceUrl, retrievedAt: now } });
  const source: MeasureSourceReference = { sourceUrl, sourceHash, publisher, retrievedAt: now,
    vault: { key: vaultKey, byteLength: bytes.length, contentType: "text/plain" } };
  const contestId = `ballot-measure:${encodeURIComponent(place)}:${number}`;
  const provenance = { sourceUrl, sourceOrg: publisher, collectedAt: now, verifiedAt: now };
  return { contractId: "ballot-measures", version: sourceHash, sourceThrough: now,
    sourceReceipt: { contractVersion: 1, reviewedAt: now, reviewedBy: "Official measure fixture",
      sources: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, publisher, sourceClass: "ELECTION_AUTHORITY", retrievedAt: now,
        httpStatus: 200, rawHash: sourceHash, reviewedEvidence: "Exact full official measure and published explanation." }] },
    payload: { kind: "ballot-measures", ocdId: place, ballots: { [key]: {
      election: { id: "oh-2026-11-03", state: "OH", name: "General Election", date: "2026-11-03" },
      contests: [{ id: contestId, electionId: "oh-2026-11-03", ocdId: place, divisionVintage: "2026", title, type: "MEASURE",
        measureTextUrl: sourceUrl, voteFor: null, termYears: null, scopeNote: null, provenance }],
      candidacies: [], absences: [], measures: [{ id: `${contestId}#question`, contestId, questionText: question,
        officialNumber: number, officialStatement: statement, officialText: source, voterGuide: { ...source, summary: statement }, provenance }],
      measureRecords: [{ contestId, whatItDoes: statement, yesMeans: "A YES vote adopts the levy.", noMeans: "A NO vote keeps the existing levy.",
        parts: [], sourceUrl, sourceHash, writtenAt: now }],
    } } } };
}

test("held place files publish verified vault references and skip current files without loading evidence or database payloads", async t => {
  const root = await mkdtemp(join(tmpdir(), "held-place-measures-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new MemoryEvidenceStore(), store = new MemoryRoutineDataStore(), artifactStore = new LocalFileArtifactStore(join(root, "edge"));
  const file = join(root, "data/ballot/measures/2026-general/OH", `${encodeURIComponent(division)}.json`);
  await mkdir(join(root, "data/ballot/measures/2026-general/OH"), { recursive: true });
  const held = await sourcePackage(vault);
  await writeFile(file, JSON.stringify(held));
  const lines: string[] = [], input = { root, state: "OH", vault, store, artifactStore, now: () => now, report: (line: string) => lines.push(line) };
  assert.deepEqual(await publishHeldPlaceMeasures(input), { state: "OH", published: 1, reused: 0, held: 0 }, lines.join("\n"));
  const published = await readPlaceMeasureProjection(division, { store, now, bypassCache: true });
  assert.equal(published.kind, "PROMOTED");
  assert.ok(await artifactStore.readManifest(readerPlaceManifestKey("ballot-measures", division)));
  assert.equal(await store.readPromotionIdentity("BALLOT_CANDIDACY", "US:state-election-ballots:OH"), null);
  const stream = vault.stream.bind(vault), candidate = store.readCandidate.bind(store), read = store.readPromotion.bind(store);
  const identity = store.readPromotionIdentity.bind(store);
  let identityReads = 0;
  store.readPromotionIdentity = async (...args) => { identityReads++; return identity(...args); };
  vault.stream = async () => { throw new Error("current files must not read source bytes"); };
  store.readCandidate = async () => { throw new Error("current files must not read candidate payloads"); };
  store.readPromotion = async () => { throw new Error("current files must not read promoted payloads"); };
  assert.deepEqual(await publishHeldPlaceMeasures(input), { state: "OH", published: 0, reused: 1, held: 0 }, lines.join("\n"));
  assert.equal(identityReads, 1, "a current file and edge share the exact pointer identity read");
  store.readCandidate = candidate; store.readPromotion = read;
  const manifestKey = readerPlaceManifestKey("ballot-measures", division), scope = placeMeasureScope(division);
  const expectedVersion = promotedPointerVersion("BALLOT_CANDIDACY", scope, (await identity("BALLOT_CANDIDACY", scope))!);
  await rm(join(root, "edge", manifestKey));
  identityReads = 0;
  assert.deepEqual(await publishHeldPlaceMeasures(input), { state: "OH", published: 0, reused: 1, held: 0 }, lines.join("\n"));
  assert.equal(identityReads, 2, "a missing edge rereads the latest authority before rebuilding");
  const restored = (await artifactStore.readManifest(manifestKey))!;
  assert.equal(restored.manifest.place!.artifact.version, expectedVersion);
  await artifactStore.writeManifest({ ...restored.manifest, place: { ...restored.manifest.place!,
    artifact: { ...restored.manifest.place!.artifact, version: "stale-version" } } }, restored.etag, manifestKey);
  identityReads = 0;
  assert.deepEqual(await publishHeldPlaceMeasures(input), { state: "OH", published: 0, reused: 1, held: 0 }, lines.join("\n"));
  assert.equal(identityReads, 2, "a stale edge rereads the latest authority before rebuilding");
  assert.equal((await artifactStore.readManifest(manifestKey))!.manifest.place!.artifact.version, expectedVersion);
  vault.stream = stream; store.readPromotionIdentity = identity;

  const prior = await readManualProjectionPrior("ballot-measures", store, now, placeMeasureScope(division));
  const worker = await sourcePackage(vault, division, "13");
  const workerPublication = await processRegisteredManualCandidate(store, "ballot-measures",
    manualProjectionCandidate(mergeBallotContests(worker, prior)), now, prior!.versionId, { vault });
  assert.ok(workerPublication.promoted);
  assert.deepEqual(await publishHeldPlaceMeasures(input), { state: "OH", published: 1, reused: 0, held: 0 }, lines.join("\n"));
  const merged = await readPlaceMeasureProjection(division, { store, now, bypassCache: true });
  assert.equal(merged.kind, "PROMOTED");
  if (merged.kind === "PROMOTED") assert.equal(merged.value.ballots[key].measures.length, 2, "a moved worker pointer invalidates the file cache and its facts survive the merge");
  assert.equal((await artifactStore.readManifest(manifestKey))!.manifest.place!.artifact.version,
    promotedPointerVersion("BALLOT_CANDIDACY", scope, (await identity("BALLOT_CANDIDACY", scope))!),
    "a changed publication reaches the edge through its latest authority identity");
  const cached = JSON.parse(await readFile(join(root, ".runtime/held-place-measures/2026-general/OH", `${encodeURIComponent(division)}.json`), "utf8"));
  assert.deepEqual(Object.keys(cached).sort(), ["inputHash", "versionId"]);

  const changed = structuredClone(held), payload = changed.payload as PlaceMeasureProjection;
  payload.ballots[key].measures[0].voterGuide!.summary = "An invented official explanation.";
  await writeFile(file, JSON.stringify(changed));
  assert.deepEqual(await publishHeldPlaceMeasures(input), { state: "OH", published: 0, reused: 0, held: 1 }, lines.join("\n"));
  assert.equal((await store.readPromotionIdentity("BALLOT_CANDIDACY", placeMeasureScope(division)))!.versionId, cached.versionId,
    "an unsupported changed file leaves the published place intact and is not cached");
});

test("a malformed or foreign place file cannot block another place or open another state", async t => {
  const root = await mkdtemp(join(tmpdir(), "held-place-scope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "data/ballot/measures/2026-general/OH");
  await mkdir(directory, { recursive: true });
  const vault = new MemoryEvidenceStore(), store = new MemoryRoutineDataStore(), lines: string[] = [];
  await writeFile(join(directory, `${encodeURIComponent(division)}.json`), JSON.stringify(await sourcePackage(vault)));
  await writeFile(join(directory, `${encodeURIComponent("ocd-division/country:us/state:ca/county:alameda")}.json`), "{}");
  await writeFile(join(directory, `${encodeURIComponent("ocd-division/country:us/state:oh/place:broken")}.json`), "{invalid");
  const input = { root, state: "OH", vault, store, artifactStore: new LocalFileArtifactStore(join(root, "edge")),
    now: () => now, report: (line: string) => lines.push(line) };
  assert.deepEqual(await publishHeldPlaceMeasures(input), { state: "OH", published: 1, reused: 0, held: 2 }, lines.join("\n"));
  assert.deepEqual(await publishHeldPlaceMeasures({ ...input, state: "CA" }), { state: "CA", published: 0, reused: 0, held: 0 });
});
