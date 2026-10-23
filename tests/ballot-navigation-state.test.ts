import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { routineProcessSlots, workerMemoryHost } from "../lib/control-plane/workers/worker-slots.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { ballotNavigationFor } from "../lib/ballot/navigation.ts";
import { publishElectionFields } from "../lib/civic-data/election-field-publication.ts";
import type { ElectionFieldInput, PublishedElectionField } from "../lib/civic-data/election-fields.ts";
import type { CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { section3Record } from "../lib/control-plane/promotion/section3.ts";
import { readBallotNavigationProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { stateAuthorityPointers } from "../lib/civic-data/state-reader.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { primeReaderCanonicalStore } from "../lib/reader/canonical-context.ts";
import { readCanonicalPackages } from "../lib/reader/canonical.ts";
import { readerDatabaseQuery } from "../lib/reader/database.ts";
import { installReaderValues } from "./helpers/canonical-reader-fixtures.ts";
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
  assert.equal(ballotNavigationFor("OH", projection, "v1", [county]).links.length, 2);
  const indexedReads = reads;
  for (let i = 0; i < 4; i++) assert.deepEqual(ballotNavigationFor("OH", projection, "v1", [county]).links.map(row => row.url),
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
  const ohio = await readBallotNavigationProjection("OH", { store, now, bypassCache: true });
  assert.equal(ohio.kind, "PROMOTED");
  assert.equal(ohio.kind === "PROMOTED" && ohio.projection.scope, "US-OH:official-ballot-navigation");
  assert.equal(ohio.kind === "PROMOTED" && ohio.value.records.length, 2);
  assert.equal((await readBallotNavigationProjection("MI", { store, now, bypassCache: true })).kind, "NOT_RECORDED");
});

test("a reader request reads its own state's navigation pointer and no other state's", async () => {
  const stateNavigation = (stateCode: string) => {
    const row = field(stateCode); Object.assign(row, { value: { ...row.value, state: stateCode, divisionId: `ocd-division/country:us/state:${stateCode.toLowerCase()}` } });
    return { versionId: stateCode, value: promotedFamily([manualEdgeEntry("ballot-navigation", { kind: "ballot-navigation", records: [row] }, stateCode)], stateCode).value };
  };
  installReaderValues({ stateAuthorities: { "ballot-navigation": { OH: stateNavigation("OH"), MI: stateNavigation("MI") } } });
  const asked: unknown[] = [], query = readerDatabaseQuery()!;
  const read = await withReaderSelection({ states: ["OH"], keys: new Set() }, async () => {
    const pointers = stateAuthorityPointers("ballot-navigation", "OH");
    await primeReaderCanonicalStore(pointers, readCanonicalPackages([pointers], statements => { asked.push(statements); return query(statements); }));
    return readBallotNavigationProjection("OH");
  });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.kind === "PROMOTED" && (read.value.records[0].value as { state: string }).state, "OH");
  const keys = JSON.stringify(asked).match(/CURATED_READER_RECORD:[A-Z:-]*official-ballot-navigation/g) ?? [];
  assert.deepEqual([...new Set(keys)], ["CURATED_READER_RECORD:US-OH:official-ballot-navigation"]);
});

test("navigation admission reserves the largest state after a small state's measured run", async () => {
  const mib = 1024 * 1024;
  const host = workerMemoryHost({ processes: () => [] });
  host.transact(state => { state.peaks = { "ballot-navigation-refresh.mts": [300 * mib] }; }, false);
  let free = (768 + 767) * mib;
  const slots = routineProcessSlots({ host, availableBytes: () => free });
  await assert.rejects(slots.acquire("ballot-navigation-il/ballot-navigation-refresh.mts", Date.now() + 25), /WORKER_MEMORY_DEADLINE/);
  free = (768 + 768) * mib;
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
