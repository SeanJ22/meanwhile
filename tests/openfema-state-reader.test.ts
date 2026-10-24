import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FederalMoneySection } from "../components/funding/federal-money-section.tsx";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { processRegisteredFanOutCandidate } from "../lib/civic-data/promotion.ts";
import { federalMoneyCandidate, federalMoneyCounts } from "../lib/federal-money/candidate.ts";
import { publishFederalMoneyPartition, publishFederalMoneyProgress } from "../lib/federal-money/edge-publication.ts";
import { joinFederalMoneyFacts } from "../lib/federal-money/join.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { OPENFEMA_STATE_PROJECTION_VERSION, federalMoneyPartitionOf, federalMoneyPartitionScope, type FederalMoneyCheckpoint, type FederalMoneyPage, type FederalMoneyProjection } from "../lib/federal-money/model.ts";
import { federalMoneyPartitionBaselines, writeFederalMoneyPartitions, type FederalMoneyPartitionChange } from "../lib/federal-money/partitions.ts";
import type { FederalMoneyStateProgress } from "../lib/federal-money/candidate.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { saveFederalMoneyCapture, withFederalMoneyVault } from "../lib/federal-money/vault.ts";
import { federalMoneyRows } from "../lib/federal-money/view.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";

const divisionId = "ocd-division/country:us/state:ct";
const planningRegions = ["capitol", "greater_bridgeport", "lower_connecticut_river_valley", "naugatuck_valley", "northeastern_connecticut", "northwest_hills", "south_central_connecticut", "southeastern_connecticut", "western_connecticut"]
  .map((name, index) => ({ ocdId: `${divisionId}/county:${name}`, geoid: `09${110 + index * 10}`, divisionType: "county" as const }));
const sourceUrl = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?%24filter=state+eq+%27CT%27&%24orderby=id&%24top=500&%24skip=0&%24inlinecount=allpages";
const retrievedAt = "2026-10-23T09:20:09.130Z";
const bytes = await readFile(new URL("./fixtures/federal-money/openfema-ct-live-2026-10-23.json", import.meta.url), "utf8");

async function heldSource() {
  const evidenceStore = new MemoryEvidenceStore();
  const capture = await saveFederalMoneyCapture({ url: sourceUrl, retrievedAt, publicationDate: null, body: bytes }, evidenceStore);
  const facts = parseFederalMoney("openfema", capture, "CT", bytes);
  return { evidenceStore, capture, facts };
}

test("all 266 real CT disaster records reach their reported state without a legacy county crosswalk", async () => {
  const { capture, facts } = await heldSource();
  assert.equal(capture.rawHash, "b3547cb32c6f8198e4037da3218b6326423a21db658641f1597ad3c0aeefe22f");
  assert.equal(facts.length, 266);
  const joined = joinFederalMoneyFacts(facts, { divisions: planningRegions, bodies: [], governments: [] });
  assert.ok(joined.every(row => row.details.reportedState === "CT" && row.joinStatus === "JOINED"));
  assert.ok(joined.every(row => row.divisionIds.length === 1 && row.divisionIds[0] === divisionId && row.bodyIds.length === 0));
  assert.ok(joined.some(row => row.geography.length === 0 && row.title.includes("Mashantucket Pequot")), "the source-named tribal area has its state association without an invented county");
  assert.equal(federalMoneyRows(joined, { divisionId }).length, 266);
  for (const county of planningRegions) assert.deepEqual(federalMoneyRows(joined, { divisionId: county.ocdId }), []);
  assert.deepEqual(federalMoneyRows(joined, { divisionId, bodyId: `${divisionId}#unrelated-government` }), []);
  assert.deepEqual(federalMoneyRows(joined, { divisionId: "ocd-division/country:us/state:ri" }), []);
});

test("OpenFEMA state associations require the exact publisher field and preserve exact county cards", async () => {
  const { facts } = await heldSource();
  for (const reportedState of [null, "RI", "XX"]) {
    const [row] = joinFederalMoneyFacts([{ ...facts[0], details: { ...facts[0].details, reportedState } }], { divisions: planningRegions, bodies: [], governments: [] });
    assert.deepEqual(row.divisionIds, []);
    assert.equal(federalMoneyRows([row], { divisionId }).length, 0);
  }
  const county = `${divisionId}/county:new_haven`;
  const sourceCounty = facts.find(row => row.geography.some(geo => geo.geoid === "09009"))!;
  const [matched] = joinFederalMoneyFacts([sourceCounty], { divisions: [{ ocdId: county, geoid: "09009", divisionType: "county" }], bodies: [], governments: [] });
  assert.ok(matched.divisionIds.includes(county));
  assert.equal(federalMoneyRows([matched], { divisionId: county, bodyId: `${county}#governing` }).length, 1);
  assert.equal(federalMoneyRows([matched], { divisionId: planningRegions[0].ocdId }).length, 0);
});

test("CT source bytes publish through artifacts and the real card on initial, next20minute, and tomorrow replays", async t => {
  const root = await mkdtemp(join(tmpdir(), "openfema-ct-reader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { evidenceStore, capture, facts } = await heldSource(), store = new MemoryRoutineDataStore(), artifactStore = new LocalFileArtifactStore(root);
  let clock = "2026-10-23T09:21:00.000Z";
  t.mock.method(Date, "now", () => Date.parse(clock));
  const task = routineTaskFromContract(requiredRoutineContract("openfema"));
  const input = { source: "openfema" as const, store, states: ["CT"], now: () => clock,
    acquireOptions: { evidenceStore }, acquire: async () => ({ facts, captures: [capture], complete: true, declaredTotal: 266 }),
    identities: async () => ({ divisions: planningRegions, bodies: [], governments: [] }),
    onPartition: (change: FederalMoneyPartitionChange) => publishFederalMoneyPartition({ ...change, store: artifactStore }),
    onProgress: (row: FederalMoneyStateProgress, checkedAt: string) => publishFederalMoneyProgress({ store: artifactStore, source: "openfema", state: row.state, checkedAt, complete: row.status === "COMPLETE", reason: row.reason }) };
  for (const at of [clock, "2026-10-23T09:41:00.000Z", "2026-10-24T09:21:00.000Z"]) {
    clock = at;
    const prior = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
    assert.ok(routineTaskDue(task, prior, Date.parse(clock)));
    const publication = await refreshFederalMoney(input);
    assert.ok(publication.outcome.promoted, publication.outcome.candidate.failureDetail ?? "");
    assert.deepEqual(publication.projection.counts, { loaded: 266, joined: 266, unjoined: 0 });
    const firstPage = await readFederalMoneyForPlace({ divisionId }, { artifactStore });
    const found = new Set<string>();
    let page = firstPage;
    do {
      for (const row of page.sources.find(source => source.source === "openfema")!.records) found.add(row.id);
      if (!page.nextCursor) break;
      page = await readFederalMoneyForPlace({ divisionId }, { artifactStore, cursor: page.nextCursor });
    } while (true);
    assert.equal(found.size, 266);
    const html = renderToStaticMarkup(createElement(FederalMoneySection, { divisionId, data: firstPage }));
    assert.match(html, /data-federal-source="openfema"/); assert.match(html, /Disaster declaration/);
    const unrelated = await readFederalMoneyForPlace({ divisionId: planningRegions[0].ocdId }, { artifactStore });
    assert.equal(unrelated.sources.find(source => source.source === "openfema")!.records.length, 0);
  }
});

test("old completed OpenFEMA projections rebuild once, retain LKG, resume pending pages and return to incremental reads", async t => {
  const root = await mkdtemp(join(tmpdir(), "openfema-legacy-reader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { evidenceStore, capture, facts: captured } = await heldSource();
  const facts = captured, store = new MemoryRoutineDataStore(), artifactStore = new LocalFileArtifactStore(root);
  let clock = "2026-10-23T09:21:00.000Z";
  t.mock.method(Date, "now", () => Date.parse(clock));
  const onPartition = (change: FederalMoneyPartitionChange) => publishFederalMoneyPartition({ ...change, store: artifactStore });
  const legacyCounty = `${divisionId}/county:new_haven`;
  const legacyRecords = facts.map(fact => {
    const divisionIds = fact.geography.some(geo => geo.type === "county" && geo.geoid === "09009") ? [legacyCounty] : [];
    return { ...fact, divisionIds, bodyIds: [], joinStatus: divisionIds.length ? "JOINED" as const : "UNJOINED" as const, joinReason: "Source county matched the formerly held county identity." };
  });
  const legacyPage: FederalMoneyPage = { facts: legacyRecords, captures: [capture], declaredTotal: facts.length, complete: true };
  await withFederalMoneyVault(evidenceStore, async () => {
    const baselines = await federalMoneyPartitionBaselines(store, "openfema", "CT", legacyRecords);
    await writeFederalMoneyPartitions({ source: "openfema", state: "CT", page: legacyPage, store, now: clock, baselines, onPartition });
  });
  const legacyCheckpoint: FederalMoneyCheckpoint = { formatVersion: 2, source: "openfema", state: "CT", counts: federalMoneyCounts(legacyRecords),
    checkpoint: { complete: true, cursor: null, lastCompleteAt: clock, refreshStartedAt: clock } };
  const seeded = await processRegisteredFanOutCandidate(store, "openfema", federalMoneyCandidate({ projection: legacyCheckpoint, page: { ...legacyPage, facts: [], captures: [] }, now: clock }), clock);
  assert.ok(seeded.promoted);
  const legacyLeafScope = federalMoneyPartitionScope("openfema", "CT", federalMoneyPartitionOf(facts[0]));
  const heldLeaf = await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", legacyLeafScope);
  assert.ok(heldLeaf);
  assert.equal((await readFederalMoneyForPlace({ divisionId }, { artifactStore })).sources.find(row => row.source === "openfema")!.records.length, 0);
  const oldCountyReader = (await readFederalMoneyForPlace({ divisionId: legacyCounty }, { artifactStore })).sources.find(row => row.source === "openfema")!;
  assert.ok(oldCountyReader.records.length > 0);
  const reads: { cursor: unknown; since: unknown }[] = [];
  let identityUnavailable = true;
  const input = { source: "openfema" as const, store, states: ["CT"], now: () => clock, maxRounds: 1, acquireOptions: { evidenceStore },
    acquire: async (_source: string, _state: string, options: { cursor?: unknown; since?: string } = {}): Promise<FederalMoneyPage> => {
      reads.push({ cursor: options.cursor ?? null, since: options.since ?? null });
      if (options.since) return { facts: [], captures: [], declaredTotal: 0, complete: true };
      return options.cursor ? { facts: [], captures: [], declaredTotal: facts.length, complete: true }
        : { facts, captures: [capture], declaredTotal: null, complete: false, continuation: { source: "openfema", phase: "declarations", offset: facts.length } };
    },
    identities: async () => { if (identityUnavailable) throw new Error("Identity read interrupted after source capture"); return { divisions: planningRegions, bodies: [], governments: [] }; }, onPartition,
    onProgress: (row: FederalMoneyStateProgress, checkedAt: string) => publishFederalMoneyProgress({ store: artifactStore, source: "openfema", state: "CT", checkedAt, complete: row.status === "COMPLETE", reason: row.reason }) };
  clock = "2026-10-23T09:22:00.000Z";
  const interrupted = await refreshFederalMoney(input);
  assert.equal(interrupted.projection.states[0].status, "OUTAGE");
  assert.deepEqual(reads, [{ cursor: null, since: null }], "a fresh legacy checkpoint must still start a full source pass");
  assert.equal((await store.readPromotion("FEDERAL_MONEY", legacyLeafScope))?.versionId, heldLeaf.versionId, "an interrupted repair retains the original published partition");
  const retainedCountyReader = (await readFederalMoneyForPlace({ divisionId: legacyCounty }, { artifactStore })).sources.find(row => row.source === "openfema")!;
  assert.equal(retainedCountyReader.versionId, oldCountyReader.versionId);
  assert.deepEqual(retainedCountyReader.records, oldCountyReader.records, "an interrupted repair keeps the last known good county card readable");
  const pending = await store.readPromotion<FederalMoneyCheckpoint>("FEDERAL_MONEY", "openfema:CT");
  assert.equal(pending?.payload.checkpoint.projectionVersion, OPENFEMA_STATE_PROJECTION_VERSION);
  assert.ok(pending?.payload.checkpoint.pending);
  assert.equal(pending?.payload.counts.loaded, facts.length);
  identityUnavailable = false;
  clock = "2026-10-23T09:23:00.000Z";
  const resumedPending = await refreshFederalMoney(input);
  assert.equal(resumedPending.projection.states[0].status, "BACKFILL");
  assert.equal(reads.length, 1, "the saved pending source page is reused after an interruption");
  assert.deepEqual(resumedPending.projection.counts, { loaded: facts.length, joined: facts.length, unjoined: 0 });
  assert.ok((await readFederalMoneyForPlace({ divisionId }, { artifactStore })).sources.find(row => row.source === "openfema")!.records.length > 0, "each verified repair page reaches the state card while later pages remain open");
  clock = "2026-10-23T09:24:00.000Z";
  const completed = await refreshFederalMoney(input);
  assert.deepEqual(reads[1], { cursor: { source: "openfema", phase: "declarations", offset: facts.length }, since: null });
  assert.deepEqual(completed.projection.counts, { loaded: facts.length, joined: facts.length, unjoined: 0 });
  const reader = await readFederalMoneyForPlace({ divisionId }, { artifactStore });
  assert.ok(reader.sources.find(row => row.source === "openfema")!.records.length > 0);
  assert.match(renderToStaticMarkup(createElement(FederalMoneySection, { divisionId, data: reader })), /data-federal-record="openfema:/);
  clock = "2026-10-23T09:44:00.000Z";
  const incremental = await refreshFederalMoney(input);
  assert.deepEqual(reads[2], { cursor: null, since: "2026-10-23T09:22:00.000Z" }, "the next ordinary run uses the completed repair's refresh start for incremental changes");
  assert.deepEqual(incremental.projection.counts, { loaded: facts.length, joined: facts.length, unjoined: 0 });
});
