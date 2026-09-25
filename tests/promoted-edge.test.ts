import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedEdgeEntry,
} from "../lib/civic-data/read-model.ts";
import {
  promotedEdgePointers,
  readPromotedEdgeFamilies,
  type PromotedEdgePointer,
} from "../lib/civic-data/promoted-edge-publication.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, stateCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { computeSplit, type StateMoneySnapshot } from "../lib/funding/state-money.ts";
import { readStateMoneyProjection, settleStateMoneyRead } from "../lib/funding/state-snapshot.ts";
import { ensureReaderAuthorityEdge, publishReaderEdgeArtifacts, type PublishAuthority } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { PromotedFamilyArtifactValue } from "../lib/meetings/edge-artifacts.ts";
import { readPromotedEdgeFirst, ReaderEdgeOnlyRefusal, withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

/**
 * **A PROVEN POINTER ON THE READER EDGE READS EXACTLY AS THE DATABASE READ OF
 * IT.** (2026-09-25.)
 *
 * The runner publishes the pointer row and the attestation of the candidate it
 * proved (`PromotedEdgeEntry`); a reader request answers the same typed read
 * from it. These tests promote a real Arizona state-money version in the
 * in-memory store (the same promotion door production uses), publish it the
 * way the runner does, and compare what the Reader answers from the database
 * with what it answers from the edge: kind, value, metadata, staleness.
 */

for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID", "WTP_READER_EDGE_DIR"]) delete process.env[key];

const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-25T15:00:00.000Z";
const AZ_URL = "https://seethemoney.az.gov/Reporting/GetNEWTableData/";
const AZ = STATE_CAMPAIGN_FINANCE_SOURCES.AZ;
const NH = STATE_CAMPAIGN_FINANCE_SOURCES.NH;

function azCandidate() {
  const source = JSON.parse(readFileSync(join(process.cwd(), "data", "states", "az", "funding", "state-money-az-2026.json"), "utf8")) as StateMoneySnapshot;
  const record = structuredClone(source.records.find((row) => row.filingState === "FILED") ?? source.records[0]!);
  const split = computeSplit([record], 1);
  const snapshot: StateMoneySnapshot = { ...source, records: [record], split, byJurisdiction: { AZ: { inScope: 1, filed: split.filed, noReports: split.noReportsOnFile, lead: split.lead } } };
  return stateCampaignFinanceCandidate({
    jurisdiction: "AZ",
    snapshot,
    rawBodies: ["official-AZ"],
    requestedUrl: AZ_URL,
    finalUrl: AZ_URL,
    retrievedAt: T0,
    query: "deterministic bounded AZ filing projection",
    paginationComplete: true,
    declaredTotal: 1,
  });
}

async function promotedAzStore() {
  const store = new MemoryRoutineDataStore();
  const candidate = azCandidate();
  const outcome = await processRegisteredManualCandidate(store, AZ.contractId, candidate, T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  return { store, candidate };
}

const stateMoneyPointers = (states: readonly ("AZ" | "NH" | "NJ")[]): readonly PromotedEdgePointer[] =>
  promotedEdgePointers()["state-money"].filter((pointer) => states.some((state) => STATE_CAMPAIGN_FINANCE_SOURCES[state].scope === pointer.scope));

function entriesOf(read: Awaited<ReturnType<typeof readPromotedEdgeFamilies>>, family: "state-money"): readonly PromotedEdgeEntry[] {
  const published = read.authority[family];
  assert.ok(published && "value" in published, `${family} was not read: ${JSON.stringify(read.skipped)}`);
  return (published.value as PromotedFamilyArtifactValue).entries;
}

const comparable = <T,>(read: CivicDataReadResult<T> | { kind: string }) => {
  const { kind, value, metadata, projection } = read as { kind: string; value?: unknown; metadata?: unknown; projection?: unknown };
  return { kind, value, metadata, projection };
};

test("the edge copy of a proven pointer reads exactly as the database read of it, through the family's own Reader", async () => {
  const { store } = await promotedAzStore();
  const read = await readPromotedEdgeFamilies({ store, servedManifest: null, now: T1, families: { "state-money": stateMoneyPointers(["AZ", "NH"]) } });
  assert.deepEqual(read.skipped, []);
  const [az, nh] = entriesOf(read, "state-money");
  assert.equal(az?.kind, "PROMOTED");
  assert.deepEqual(nh, { kind: "NOT_RECORDED", recordClass: "STATE_CAMPAIGN_FINANCE", scope: NH.scope }, "an answered, absent pointer travels as NOT_RECORDED");

  const fromDatabase = await readStateMoneyProjection("AZ", { store, now: T1, bypassCache: true });
  const fromEdge = await readStateMoneyProjection("AZ", { edge: az!, now: T1 });
  assert.equal(fromDatabase.kind, "PROMOTED");
  assert.deepEqual(comparable(fromEdge), comparable(fromDatabase), "the edge read is not the database read");
  assert.deepEqual(comparable(await readStateMoneyProjection("NH", { edge: nh!, now: T1 })), comparable(await readStateMoneyProjection("NH", { store, now: T1, bypassCache: true })));

  // Staleness is measured at the reader's own instant, exactly as the database read measures it.
  for (const maxAgeMs of [60_000, 400 * 24 * 3_600_000]) {
    const database: CivicDataReadResult<unknown> = await readPromotedCivicData<unknown>("STATE_CAMPAIGN_FINANCE", AZ.scope, { store, now: T1, maxAgeMs, bypassCache: true });
    const fromEdgeCopy: CivicDataReadResult<unknown> = await readPromotedCivicData<unknown>("STATE_CAMPAIGN_FINANCE", AZ.scope, { edge: az!, now: T1, maxAgeMs });
    assert.deepEqual(fromEdgeCopy.metadata, database.metadata);
  }
});

test("an edge copy the database proof would refuse is refused as PROMOTION_PROOF_INVALID, never served", async () => {
  const { store } = await promotedAzStore();
  const [az] = entriesOf(await readPromotedEdgeFamilies({ store, servedManifest: null, now: T1, families: { "state-money": stateMoneyPointers(["AZ"]) } }), "state-money");
  assert.ok(az?.kind === "PROMOTED");
  const refused = async (entry: PromotedEdgeEntry, scope: string = AZ.scope) => {
    const result = await readPromotedCivicData("STATE_CAMPAIGN_FINANCE", scope, { edge: entry, now: T1 });
    assert.equal(result.kind, "STORE_UNREACHABLE");
    assert.equal((result as { code?: string }).code, "PROMOTION_PROOF_INVALID");
    return (result as { detail: string }).detail;
  };
  const payload = az.projection.payload as StateMoneySnapshot;
  assert.match(await refused({ ...az, projection: { ...az.projection, payload: { ...payload, records: [] } } }), /does not hash to the attested payload/);
  assert.match(await refused(az, NH.scope), /another class or scope/);
  assert.match(await refused({ ...az, attested: { ...az.attested, versionId: "another-version" } }), /attestation does not name/);
  assert.match(await refused({ ...az, projection: { ...az.projection, receipt: { ...az.projection.receipt, candidateId: "another-version" } } }), /GOOD receipt/);
  assert.match(await refused({ ...az, projection: { ...az.projection, lastKnownGoodVersionId: "older" } }), /diverge/);
  assert.match(await refused({ kind: "NOT_RECORDED", recordClass: "STATE_CAMPAIGN_FINANCE", scope: NH.scope }), /answered for/);
});

test("the runner carries a family whose pointers have not moved, re-reads it when a confirmation lands, and leaves out one its Reader refuses", async () => {
  const { store, candidate } = await promotedAzStore();
  const dir = mkdtempSync(join(tmpdir(), "wtp-promoted-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const artifacts = new LocalFileArtifactStore(dir);
  const families = { "state-money": stateMoneyPointers(["AZ"]) };
  const publish = async (authority: PublishAuthority) => {
    const result = await publishReaderEdgeArtifacts({
      formatVersion: 1, generatedAt: T1, counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 }, sources: [], meetings: [], agendaDocuments: [],
    }, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, { store: artifacts, now: T1, authority });
    assert.ok(result.status === "PUBLISHED" || result.status === "CURRENT", JSON.stringify(result));
    return (await artifacts.readManifest())!.manifest;
  };

  const first = await readPromotedEdgeFamilies({ store, servedManifest: null, now: T1, families });
  const served = await publish(first.authority);
  const servedRef = served.authorityArtifacts?.["state-money"];
  assert.ok(servedRef, "the family was published");

  // Unmoved: carried by reference, never read.
  let payloadReads = 0;
  const counting = new Proxy(store, { get(target, key, receiver) {
    if (key === "readPromotion" || key === "readCandidateProof" || key === "readCandidate") payloadReads += 1;
    return Reflect.get(target, key, receiver);
  } });
  const again = await readPromotedEdgeFamilies({ store: counting, servedManifest: served, now: T1, families });
  assert.deepEqual(again.authority["state-money"], { versionId: servedRef.version, carried: true });
  assert.equal(payloadReads, 0, "an unmoved family read its payload");

  // A confirmation moves the retrieval instant a read reports, so the family is read again.
  const confirmed = await store.confirmUnchanged({
    sourceId: candidate.sourceId,
    recordClass: candidate.recordClass,
    scope: candidate.scope,
    parserVersion: candidate.normalization.parserVersion,
    pointerVersionId: candidate.id,
    readModelHash: candidate.normalization.normalizedHash!,
    basis: "READ_MODEL_RECOMPUTED",
    retrieval: { requestedUrl: AZ_URL, finalUrl: AZ_URL, httpStatus: 200, rawHash: "e".repeat(64), retrievedAt: "2026-09-20T00:00:00.000Z" },
  }, "2026-09-20T00:00:03.000Z");
  assert.equal(confirmed.kind, "CONFIRMED");
  const moved = await readPromotedEdgeFamilies({ store, servedManifest: served, now: T1, families });
  const [entry] = entriesOf(moved, "state-money");
  assert.notEqual((moved.authority["state-money"] as { versionId: string }).versionId, servedRef.version, "a confirmation did not move the family's version");
  assert.equal((await readStateMoneyProjection("AZ", { edge: entry!, now: T1 })).metadata.retrievedAt, "2026-09-20T00:00:00.000Z", "the edge read lost the confirmation");

  // A family whose own Reader refuses the entry is left out whole.
  const refusing: PromotedEdgePointer = { ...families["state-money"][0]!, reader: async () => ({ kind: "PROJECTION_INVALID", metadata: { versionId: null } }) };
  const left = await readPromotedEdgeFamilies({ store, servedManifest: null, now: T1, families: { "state-money": [refusing] } });
  assert.equal(left.authority["state-money"], undefined);
  assert.match(left.skipped.join("\n"), /state-money .*its Reader answered the edge entry PROJECTION_INVALID/);
});

test("published, fetched and entered: a reader request reads the family from the edge; an edge-only context refuses a pointer the edge lacks without reading", async () => {
  const { store } = await promotedAzStore();
  const dir = mkdtempSync(join(tmpdir(), "wtp-promoted-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const artifacts = new LocalFileArtifactStore(dir);
  const { authority } = await readPromotedEdgeFamilies({ store, servedManifest: null, now: T1, families: { "state-money": stateMoneyPointers(["AZ"]) } });
  const published = await publishReaderEdgeArtifacts({
    formatVersion: 1, generatedAt: T1, counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 }, sources: [], meetings: [], agendaDocuments: [],
  }, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, { store: artifacts, now: T1, authority });
  assert.equal(published.status, "PUBLISHED");
  const manifest = (await artifacts.readManifest())!.manifest;

  // A caller that does not ask for the family never fetches it.
  assert.equal((await ensureReaderAuthorityEdge(manifest, artifacts, ["registry-runtime"])).promoted, undefined);
  const bundle = await ensureReaderAuthorityEdge(manifest, artifacts, ["state-money"]);
  assert.ok(bundle.promoted?.has(`STATE_CAMPAIGN_FINANCE:${AZ.scope}`));

  // No database is configured in this process: a PROMOTED answer can only have come from the edge.
  const read = await withReaderAuthorityEdge(bundle, () => settleStateMoneyRead("AZ"));
  assert.equal(read.kind, "PROMOTED");

  // Without the pointer, an ordinary request reads the database (here: not configured) ...
  assert.equal((await withReaderAuthorityEdge({}, () => settleStateMoneyRead("AZ"))).kind, "STORE_UNREACHABLE");
  // ... and an edge-only context refuses before its Reader is ever called.
  let called = 0;
  await assert.rejects(
    withReaderAuthorityEdge({ edgeOnly: true }, () => readPromotedEdgeFirst("STATE_CAMPAIGN_FINANCE", AZ.scope, async () => { called += 1; return null; }, "The AZ campaign money")),
    ReaderEdgeOnlyRefusal,
  );
  assert.equal(called, 0, "an edge-only context read the database");
});
