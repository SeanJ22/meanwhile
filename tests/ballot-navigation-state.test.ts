import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { readBallotNavigationEdgeStates, promotedEdgePointers } from "../lib/civic-data/promoted-edge-publication.ts";
import { routineProcessSlots, workerMemoryHost } from "../lib/control-plane/workers/worker-slots.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ballotNavigationFor } from "../lib/ballot/navigation.ts";
import { publishElectionFields } from "../lib/civic-data/election-field-publication.ts";
import type { ElectionFieldInput, PublishedElectionField } from "../lib/civic-data/election-fields.ts";
import type { CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { section3Record } from "../lib/control-plane/promotion/section3.ts";
import { ensureReaderAuthorityEdge, publishReaderEdgeArtifacts } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { manualEdgeEntry, promotedFamily } from "./helpers/promoted-edge-entry.ts";
import { createHash } from "node:crypto";

const now = "2026-10-15T19:00:00.000Z";
const state = "ocd-division/country:us/state:oh";
const county = `${state}/county:franklin`, neighbor = `${state}/county:delaware`;
function field(id: string, divisionId = state): PublishedElectionField {
  return { id, kind: "ELECTION_FIELD", value: { state: "OH", divisionId, fieldKind: "registration_lookup",
    text: `https://elections.example.gov/${id}`, quote: "Check registration", dates: [], url: "https://elections.example.gov/oh",
    navigationUrl: `https://elections.example.gov/${id}`, verifiedAt: now, collectedAt: now, sourceOrg: "Election office" } };
}

test("one version is validated once, and county navigation stays in its county", () => {
  let reads = 0;
  const rows = [field("state"), field("franklin", county), field("delaware", neighbor)];
  const projection: CuratedReaderProjection = { kind: "ballot-navigation", records: rows.map(row => ({ id: row.id, kind: row.kind,
    get value() { reads++; return row.value; } })) };
  assert.equal(ballotNavigationFor("OH", projection, "v1", [county]).registrations.length, 2);
  const indexedReads = reads;
  for (let i = 0; i < 4; i++) assert.deepEqual(ballotNavigationFor("OH", projection, "v1", [county]).registrations.map(row => row.url),
    ["https://elections.example.gov/state", "https://elections.example.gov/franklin"]);
  assert.equal(reads, indexedReads);
  Object.assign(rows[1], { value: { ...rows[1].value, state: "MI" } });
  assert.throws(() => ballotNavigationFor("OH", projection, "v2", [county]), /state boundary/);
});

test("streamed fields are verified before the next source is produced", async () => {
  let verified = 0;
  const source = "https://elections.example.gov/oh", text = '<a href="https://elections.example.gov/register">Check registration</a>';
  const make = (divisionId: string): ElectionFieldInput => ({ divisionId, kind: "registration_lookup", sourceUrl: source,
    value: "https://elections.example.gov/register", quote: "Check registration", dates: [],
    document: { url: source, text, collectedAt: now, capture: { observedAt: now, httpStatus: 200, transport: "REACHABLE", partial: false,
      evidence: { artifactId: "isolated-source", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`,
        text, canonicalUrl: source, retrievedAt: now, sourceId: "Election office", acquiredByAttemptId: "source", methodRouteId: "official" } } } });
  const store = new MemoryRoutineDataStore();
  const result = await publishElectionFields({ store, now,
    fields: (async function* () { yield make(county); assert.equal(verified, 1); yield make(neighbor); })(),
    verify: input => { verified++; return section3Record(input); } });
  assert.equal(result.fields.length, 2);
  assert.equal(result.gaps.length, 0);
  const entries = [];
  for await (const entry of readBallotNavigationEdgeStates({ store, now, manifest: null,
    pointers: promotedEdgePointers()["ballot-navigation"].filter(pointer => pointer.scope === "US-OH:official-ballot-navigation"),
    onFailure: (_state, error) => { throw error; } })) entries.push(entry);
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], "OH");
  assert.ok("value" in entries[0][1]);
});

test("the manifest serves one state's navigation without fetching other state artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "navigation-state-edge-"));
  try {
    const store = new LocalFileArtifactStore(directory);
    const metadata = { sourceThrough: null, retrievedAt: null, promotedThrough: null };
    const result = await publishReaderEdgeArtifacts(null, metadata, { store, ballotNavigation: (async function* () {
      for (const stateCode of ["OH", "MI"]) {
        const row = field(stateCode); Object.assign(row, { value: { ...row.value, state: stateCode, divisionId: `ocd-division/country:us/state:${stateCode.toLowerCase()}` } });
        yield [stateCode, promotedFamily([manualEdgeEntry("ballot-navigation", { kind: "ballot-navigation", records: [row] }, stateCode)], stateCode)] as const;
      }
    })() });
    assert.equal(result.status, "PUBLISHED");
    const held = (await store.readManifest())!;
    await store.writeManifest({ ...held.manifest, sequence: held.manifest.sequence + 1,
      authorityArtifacts: { "ballot-navigation": held.manifest.ballotNavigation!.OH } }, held.etag ?? null);
    const carried = () => (async function* () { yield ["OH", { versionId: "OH", carried: true }] as const; })();
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store, ballotNavigation: carried() })).status, "PUBLISHED");
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store, ballotNavigation: carried() })).status, "CURRENT");
    const manifest = (await store.readManifest())!.manifest;
    assert.equal(manifest.authorityArtifacts?.["ballot-navigation"], undefined);
    const reads: string[] = [], read = store.readBytes.bind(store);
    store.readBytes = async key => { reads.push(key); return read(key); };
    const bundle = await ensureReaderAuthorityEdge(manifest, store, ["ballot-navigation"]);
    assert.equal(reads.length, 0);
    const first = await bundle.ballotNavigation!.load("OH");
    assert.equal(first?.kind, "PROMOTED");
    assert.equal(await bundle.ballotNavigation!.load("OH"), first);
    assert.equal(reads[0], manifest.ballotNavigation!.OH.key);
    assert.ok(reads.length > 1);
    assert.ok(!reads.includes(manifest.ballotNavigation!.MI.key));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("navigation admission reserves the largest state after a small state's measured run", async () => {
  const mib = 1024 * 1024;
  const host = workerMemoryHost({ processes: () => [] });
  host.transact(state => { state.peaks = { "ballot-navigation-refresh.mts": [300 * mib] }; }, false);
  let free = (768 + 2047) * mib;
  const slots = routineProcessSlots({ host, availableBytes: () => free });
  await assert.rejects(slots.acquire("ballot-navigation-il/ballot-navigation-refresh.mts", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  free = (768 + 2048) * mib;
  const release = await slots.acquire("ballot-navigation-il/ballot-navigation-refresh.mts", Date.now() + 100);
  release();
});

test("a state outage records a held source outcome in that state", async () => {
  const store = new MemoryRoutineDataStore(), contract = requiredManualProductionContract("ballot-navigation");
  const candidate = failedAcquisitionCandidate({ sourceId: contract.sourceId, recordClass: contract.recordClass,
    scope: "US-OH:official-ballot-navigation", requestedUrl: "", attemptedAt: now, failureDetail: "Official source unavailable",
    parserVersion: contract.parserNormalizerVersion });
  const outcome = await processRegisteredManualCandidate(store, "ballot-navigation", candidate, now);
  assert.equal(outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal(outcome.promoted, null);
});
