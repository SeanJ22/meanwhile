import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { readerEdgePieces } from "../lib/civic-data/reader-edge-publication.ts";
import { dispatchStateArtifacts, prepareStateArtifactChild, stateArtifactResultLine } from "../lib/civic-data/state-artifact-dispatch.ts";
import type { BoundedChildLauncher } from "../lib/civic-data/bounded-child-pass.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedEdgeEntry,
} from "../lib/civic-data/read-model.ts";
import {
  promotedEdgePointers,
  selectedStateEdgePointers,
  prepareStateEdgeFamily,
  publishPromotedEdgeFamily,
  type PromotedEdgePointer,
} from "../lib/civic-data/promoted-edge-publication.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, stateCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { computeSplit, type StateMoneySnapshot } from "../lib/funding/state-money.ts";
import { readStateMoneyProjection, settleStateMoneyRead } from "../lib/funding/state-snapshot.ts";
import { authorityPlaceOfScope, authorityPointerKey, ensureReaderAuthorityEdge, readServedPointer, readServedPromotedFamily } from "../lib/meetings/edge-serving.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { publishPointers } from "./helpers/edge-pointers.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { AuthorityArtifactRef, StateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";
import { readPromotedEdgeFirst, ReaderEdgeOnlyRefusal, withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { votingSitesContract, votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import { readVotingSitesProjection } from "../lib/ballot/voting-sites-server.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { manualEdgeEntry, absentEdgeEntry, promotedFamily } from "./helpers/promoted-edge-entry.ts";

// A proven pointer on the reader edge reads exactly as the database read of it: kind, value, metadata, staleness.

for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID", "WTP_READER_EDGE_DIR"]) delete process.env[key];

async function readStateArtifact(family: StateAuthorityFamily, state: string, ref: AuthorityArtifactRef, store: LocalFileArtifactStore) {
  const held = await store.readJsonPointer(authorityPointerKey(family, state));
  await store.writeJsonPointer(authorityPointerKey(family, state), ref, held?.etag ?? null);
  return (await ensureReaderAuthorityEdge(null, store, [family]))!.stateAuthorities!.load(family, state);
}

/** The entries one place's pointer of a family serves. */
async function servedEntries(store: LocalFileArtifactStore, family: "state-money", place: string) {
  const served = await readServedPointer(store, authorityPointerKey(family, place));
  return (await readServedPromotedFamily(family, served?.ref, store, place))?.entries ?? [];
}

function edgeStore() {
  const dir = mkdtempSync(join(tmpdir(), "wtp-promoted-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return new LocalFileArtifactStore(dir);
}

const VOTING_SITES_CONTRACT = votingSitesContract("AZ");
const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-25T15:00:00.000Z";
const PIMA_CAPTURE = [{ url: "https://www.pima.gov/3199/Pima-Votes", contentType: "text/html", vaultKey: "test/pima-votes",
  rawHash: createHash("sha256").update("official voting sites").digest("hex"), byteLength: 21 }];
const AZ_URL = "https://seethemoney.az.gov/Reporting/GetNEWTableData/";
const AZ = STATE_CAMPAIGN_FINANCE_SOURCES.AZ;
const NH = STATE_CAMPAIGN_FINANCE_SOURCES.NH;

const AZ_RECORD = {
  dataClass: "STATE_COMMITTEE", jurisdiction: "AZ", agency: "Arizona Secretary of State — See The Money",
  filingsUrl: "https://seethemoney.az.gov/", committeeId: "100001", registeredName: "Example for Attorney General",
  candidateNameAsFiled: "Avery Example", officeSought: "Attorney General", electionYear: 2026, filingState: "FILED",
  totals: { receipts: 1000, expenditures: 500, cashOnHand: null, reportCount: null, coveringPeriod: "Arizona 2026 election cycle" },
  targetKeys: ["ballot-az-example:attorney-general:example-avery"],
  match: {
    registeredName: "Example for Attorney General", officeAsFiled: "Attorney General", officeOnBallot: "Attorney General",
    electionYearAsFiled: 2026, electionYearOnBallot: 2026, allThreeAgree: true,
    note: "name, exact Arizona seat and election cycle all agree with the certified-ballot row",
  },
  checkedAt: "2026-09-01",
  provenance: { sourceUrl: AZ_URL, sourceOrg: "Arizona Secretary of State — See The Money", collectedAt: "2026-09-01", verifiedAt: "2026-09-01" },
} as unknown as StateMoneySnapshot["records"][number];

const VOTING_SITES: VotingSitesFile = {
  generatedAt: "2026-08-19",
  jurisdictions: [{
    ocdId: "ocd-division/country:us/state:az/county:pima", name: "Pima County", state: "AZ", model: "VOTE_CENTER",
    election: "2026 General",
    sites: [{ id: "az-pima-day-1", name: "Example Event Center", address: "1 Example Road, Tucson, AZ 85730", room: "Hall", lat: 32.18177403, lng: -110.85671097, kind: "ELECTION_DAY", election: "2026 General", serves: null }],
    sourceOrg: "Pima County Recorder and Pima County Elections Department", sourceUrl: "https://www.pima.gov/3199/Pima-Votes",
    collectedAt: "2026-08-19", refusal: null,
  }],
};

function azCandidate() {
  const record = structuredClone(AZ_RECORD);
  const split = computeSplit([record], 1);
  const snapshot: StateMoneySnapshot = { formatVersion: 1, collectedAt: "2026-09-01", cycle: 2026, records: [record], split, byJurisdiction: { AZ: { inScope: 1, filed: split.filed, noReports: split.noReportsOnFile, lead: split.lead } } } as StateMoneySnapshot;
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

test("default rechecks keep one candidate and advance freshness; explicit false stores a new version", async () => {
  const { store, candidate } = await promotedAzStore();
  const recheck = { ...candidate, id: `${candidate.id}-recheck`,
    retrieval: { ...candidate.retrieval, retrievedAt: T1, rawHash: "b".repeat(64) } };
  const outcome = await processRegisteredManualCandidate(store, AZ.contractId, recheck, T1);
  assert.equal(outcome.confirmed?.versionId, candidate.id);
  assert.equal(await store.readCandidate(recheck.id), null, "an unchanged payload is not stored again");
  assert.equal((await store.readPromotion(candidate.recordClass, candidate.scope))?.versionId, candidate.id);
  const read = await readStateMoneyProjection("AZ", { store, now: T1, bypassCache: true });
  assert.equal(read.metadata.retrievedAt, T1);
  const forced = { ...recheck, id: `${candidate.id}-forced` };
  const distinct = await processRegisteredManualCandidate(store, AZ.contractId, forced, T1, undefined, { confirmUnchanged: false });
  assert.equal(distinct.confirmed, undefined);
  assert.equal(distinct.candidate.state, "PROMOTED");
  assert.equal((await store.readPromotion(candidate.recordClass, candidate.scope))?.versionId, forced.id);
});

test("a state whose Reader refuses keeps its accepted entry while a sibling state publishes, each at its own pointer", async () => {
  const { store, candidate: azCandidate } = await promotedAzStore();
  const artifacts = edgeStore();
  const first = await publishStateMoney(store, artifacts, stateMoneyPointers(["AZ", "NH"]));
  assert.deepEqual(first, { published: ["state-money/AZ", "state-money/NH"], skipped: [] });
  const [prior] = await servedEntries(artifacts, "state-money", "AZ");
  const record = { ...structuredClone(AZ_RECORD), jurisdiction: "NH", committeeId: "nh-001", targetKeys: [],
    provenance: { ...AZ_RECORD.provenance, sourceUrl: "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/nh-001", sourceOrg: "New Hampshire Secretary of State" } } as StateMoneySnapshot["records"][number];
  const split = computeSplit([record], 1);
  const snapshot: StateMoneySnapshot = { formatVersion: 1, collectedAt: "2026-09-01", cycle: 2026, records: [record], split,
    byJurisdiction: { NH: { inScope: 1, filed: split.filed, noReports: split.noReportsOnFile, lead: split.lead } } } as StateMoneySnapshot;
  const candidate = stateCampaignFinanceCandidate({ jurisdiction: "NH", snapshot, rawBodies: ["official-NH"],
    requestedUrl: "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/nh-001", finalUrl: "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/nh-001", retrievedAt: T0,
    query: "known committee filing", paginationComplete: true, declaredTotal: 1 });
  const promotion = await processRegisteredManualCandidate(store, NH.contractId, candidate, T0);
  assert.equal(promotion.candidate.state, "PROMOTED", JSON.stringify(promotion.candidate.receipt));
  assert.equal((await store.confirmUnchanged({ sourceId: azCandidate.sourceId, recordClass: azCandidate.recordClass, scope: azCandidate.scope,
    parserVersion: azCandidate.normalization.parserVersion, pointerVersionId: azCandidate.id, readModelHash: azCandidate.normalization.normalizedHash!,
    basis: "READ_MODEL_RECOMPUTED", retrieval: { requestedUrl: AZ_URL, finalUrl: AZ_URL, httpStatus: 200, rawHash: "e".repeat(64), retrievedAt: "2026-09-20T00:00:00.000Z" },
  }, "2026-09-20T00:00:03.000Z")).kind, "CONFIRMED");
  const pointers = stateMoneyPointers(["AZ", "NH"]).map(pointer => pointer.scope === AZ.scope
    ? { ...pointer, reader: async () => ({ kind: "STORE_UNREACHABLE" }) } : pointer);
  const refreshed = await publishStateMoney(store, artifacts, pointers);
  assert.deepEqual(refreshed.published, ["state-money/AZ", "state-money/NH"]);
  assert.deepEqual((await servedEntries(artifacts, "state-money", "AZ"))[0], prior);
  const [nh] = await servedEntries(artifacts, "state-money", "NH");
  assert.equal(nh?.kind, "PROMOTED");
  if (nh?.kind === "PROMOTED") assert.equal(nh.projection.versionId, candidate.id);
  assert.match(refreshed.skipped.join("\n"), /state-money\/AZ .*retaining the accepted prior version/);
});

/** Each state of the family at its own pointer, one place at a time as the edge publishes them. */
async function publishStateMoney(store: Parameters<typeof publishPromotedEdgeFamily>[0]["store"], artifactStore: LocalFileArtifactStore, pointers: readonly PromotedEdgePointer[]) {
  const published: string[] = [], skipped: string[] = [];
  for (const [place, held] of Map.groupBy(pointers, pointer => authorityPlaceOfScope(pointer.scope))) {
    const result = await publishPromotedEdgeFamily({ store, artifactStore, now: T1, family: "state-money", place, pointers: held });
    published.push(...result.published); skipped.push(...result.skipped);
  }
  return { published, skipped };
}

const stateMoneyPointers = (states: readonly ("AZ" | "NH" | "NJ")[]): readonly PromotedEdgePointer[] =>
  promotedEdgePointers()["state-money"].filter((pointer) => states.some((state) => STATE_CAMPAIGN_FINANCE_SOURCES[state].scope === pointer.scope));

const comparable = <T,>(read: CivicDataReadResult<T> | { kind: string }) => {
  const { kind, value, metadata, projection } = read as { kind: string; value?: unknown; metadata?: unknown; projection?: unknown };
  return { kind, value, metadata, projection };
};

test("published voting sites serve the same jurisdictions and sites from the request edge without a database", async () => {
  const store = new MemoryRoutineDataStore();
  const current = structuredClone(VOTING_SITES);
  const candidate = votingSitesCandidate({
    state: "AZ", current, prior: null, failures: [], acquisition: PIMA_CAPTURE,
    successfulAuthorityReads: 1, requestedUrl: "https://www.pima.gov/3199/Pima-Votes",
    finalUrl: "https://www.pima.gov/3199/Pima-Votes", retrievedAt: T0,
  });
  assert.equal((await processRegisteredManualCandidate(store, "voting-sites:AZ", candidate, T0)).candidate.state, "PROMOTED");
  const database = await readVotingSitesProjection("AZ", { store, bypassCache: true, now: T1 });
  const dir = mkdtempSync(join(tmpdir(), "wtp-state-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const artifacts = new LocalFileArtifactStore(dir);
  const published = await prepareStateEdgeFamily({ store, now: T1, artifactStore: artifacts, unit: selectedStateEdgePointers([VOTING_SITES_CONTRACT])[0]! });
  assert.deepEqual(published.skipped, []);
  const loaded = await readStateArtifact("voting-sites", "AZ", published.entry.artifact, artifacts);
  assert.equal(loaded?.entries.length, 1);
  const edge = await withReaderAuthorityEdge({
    edgeOnly: true,
    stateAuthorities: { families: new Set(["voting-sites"] as const), load: async () => loaded },
  }, () => readVotingSitesProjection("AZ"));
  assert.deepEqual(comparable(edge), comparable(database));
});

test("the edge copy of a proven pointer reads exactly as the database read of it, through the family's own Reader", async () => {
  const { store } = await promotedAzStore();
  const artifacts = edgeStore();
  assert.deepEqual((await publishStateMoney(store, artifacts, stateMoneyPointers(["AZ", "NH"]))).skipped, []);
  const [[az], [nh]] = await Promise.all(["AZ", "NH"].map(state => servedEntries(artifacts, "state-money", state)));
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
  const artifacts = edgeStore();
  await publishStateMoney(store, artifacts, stateMoneyPointers(["AZ"]));
  const [az] = await servedEntries(artifacts, "state-money", "AZ");
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

test("the runner leaves a family whose pointers have not moved unread, rewrites it when a confirmation lands, and leaves out one its Reader refuses", async () => {
  const { store, candidate } = await promotedAzStore();
  const artifacts = edgeStore();
  const families = { "state-money": stateMoneyPointers(["AZ"]) };
  assert.deepEqual((await publishStateMoney(store, artifacts, families["state-money"])).published, ["state-money/AZ"]);
  const served = (await readServedPointer(artifacts, authorityPointerKey("state-money", "AZ")))!.ref;

  // Unmoved: neither read nor written.
  let payloadReads = 0;
  const counting = new Proxy(store, { get(target, key, receiver) {
    if (key === "readPromotion" || key === "readCandidateProof" || key === "readCandidate") payloadReads += 1;
    return Reflect.get(target, key, receiver);
  } });
  assert.deepEqual(await publishStateMoney(counting, artifacts, families["state-money"]), { published: [], skipped: [] });
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
  assert.deepEqual((await publishStateMoney(store, artifacts, families["state-money"])).published, ["state-money/AZ"]);
  assert.notEqual((await readServedPointer(artifacts, authorityPointerKey("state-money", "AZ")))!.ref.version, served.version, "a confirmation did not move the family's version");
  const [entry] = await servedEntries(artifacts, "state-money", "AZ");
  assert.equal((await readStateMoneyProjection("AZ", { edge: entry!, now: T1 })).metadata.retrievedAt, "2026-09-20T00:00:00.000Z", "the edge read lost the confirmation");

  // A family whose own Reader refuses the entry is left out whole.
  const refusing: PromotedEdgePointer = { ...families["state-money"][0]!, reader: async () => ({ kind: "PROJECTION_INVALID", metadata: { versionId: null } }) };
  const fresh = edgeStore();
  const left = await publishStateMoney(store, fresh, [refusing]);
  assert.deepEqual(left.published, []);
  assert.equal(await fresh.readJsonPointer(authorityPointerKey("state-money", "AZ")), null);
  assert.match(left.skipped.join("\n"), /state-money\/AZ .*its Reader answered the edge entry PROJECTION_INVALID/);
});

test("published, fetched and entered: a reader request reads the family from the edge; an edge-only context refuses a pointer the edge lacks without reading", async () => {
  const { store } = await promotedAzStore();
  const artifacts = edgeStore();
  await publishStateMoney(store, artifacts, stateMoneyPointers(["AZ"]));

  // A caller that does not ask for the family never fetches it.
  assert.equal((await ensureReaderAuthorityEdge(null, artifacts, ["registry-runtime"]))!.promoted?.size ?? 0, 0);
  const bundle = (await withReaderSelection({ states: ["AZ"], keys: new Set() }, () => ensureReaderAuthorityEdge(null, artifacts, ["state-money"])))!;
  assert.ok(bundle.promoted?.has(`STATE_CAMPAIGN_FINANCE:${AZ.scope}`), "the selected state's pointer is read with the bundle");

  // No database is configured in this process: a PROMOTED answer can only have come from the edge.
  const read = await withReaderAuthorityEdge(bundle, () => settleStateMoneyRead("AZ"));
  assert.equal(read.kind, "PROMOTED");
  const unselected = (await ensureReaderAuthorityEdge(null, artifacts, ["state-money"]))!;
  assert.equal((await withReaderAuthorityEdge(unselected, () => settleStateMoneyRead("AZ"))).kind, "PROMOTED", "an unselected state's pointer is read when asked for");

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

test("direct scoped runner publication skips unrelated contracts and every unchanged payload", async () => {
  const store = new MemoryRoutineDataStore();
  const current = structuredClone(VOTING_SITES);
  const candidate = votingSitesCandidate({ state: "AZ", current, prior: null, failures: [], acquisition: PIMA_CAPTURE,
    successfulAuthorityReads: 1, requestedUrl: "https://www.pima.gov/3199/Pima-Votes", finalUrl: "https://www.pima.gov/3199/Pima-Votes", retrievedAt: T0 });
  assert.ok((await processRegisteredManualCandidate(store, "voting-sites:AZ", candidate, T0)).promoted);
  let payloadReads = 0;
  const scoped = new Proxy(store, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "readPromotionIdentities") return async (recordClass: string, scopes: readonly string[]) => {
      assert.equal(recordClass, VOTING_SITES_CONTRACT.recordClass);
      assert.deepEqual(scopes, [VOTING_SITES_CONTRACT.scope]);
      return target.readPromotionIdentities(recordClass as never, scopes);
    };
    if (String(key).startsWith("readPrepared")) return () => { throw new Error("scoped voting must not read meetings"); };
    if (["readPromotion", "readCandidate", "readCandidateProof"].includes(String(key))) return (...args: unknown[]) => { payloadReads++; return value.apply(target, args); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "runner-scoped-edge-")));
  const launch: BoundedChildLauncher = async command => {
    const arg = (name: string) => command.args.find(value => value.startsWith(`--${name}=`))!.slice(name.length + 3);
    const state = arg("state"), family = arg("family") as StateAuthorityFamily;
    const entry = await prepareStateArtifactChild(scoped, artifacts, state, family, arg("version"), T1);
    return { id: command.id, status: 0, signal: null, termination: "EXITED", stderr: "", errorMessage: null,
      stdout: stateArtifactResultLine(state, family, entry) };
  };
  assert.deepEqual(readerEdgePieces([VOTING_SITES_CONTRACT]), [{ family: "voting-sites", place: "AZ" }]);
  const publish = async () => (await dispatchStateArtifacts({ store: scoped, currentStore: scoped, artifactStore: artifacts, now: T1,
    selected: selectedStateEdgePointers([VOTING_SITES_CONTRACT]), children: { launch, slots: { acquire: async () => () => {} } },
    env: { WTP_READER_EDGE_LOCAL_OK: "1", WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40) } })).skipped.length === 0;
  assert.equal(await publish(), true);
  const pointer = await artifacts.readJsonPointer(authorityPointerKey("voting-sites", "AZ"));
  assert.ok(pointer);
  const initialReads = payloadReads;
  assert.ok(initialReads > 0);
  assert.equal(await publish(), true);
  assert.equal(payloadReads, initialReads);
  assert.deepEqual(await artifacts.readJsonPointer(authorityPointerKey("voting-sites", "AZ")), pointer, "an unchanged pass rewrites nothing");
});

test("state artifacts load only on demand, reject altered bytes and retain unchanged sibling references", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wtp-lazy-state-edge-"));
  after(() => rmSync(directory, { recursive: true, force: true }));
  const artifacts = new LocalFileArtifactStore(directory);
  const az = promotedFamily([manualEdgeEntry("voting-sites:AZ", VOTING_SITES, "lazy-az-v1")], "lazy-az-v1");
  const nh = promotedFamily([absentEdgeEntry("VOTING_SITE", votingSitesContract("NH").scope)], "lazy-nh-v1");
  assert.deepEqual(await publishPointers(artifacts, { stateAuthorities: { "voting-sites": { AZ: az, NH: nh } } }, T1), ["voting-sites/AZ", "voting-sites/NH"]);
  const refs = { AZ: (await readServedPointer(artifacts, authorityPointerKey("voting-sites", "AZ")))!.ref,
    NH: (await artifacts.readJsonPointer(authorityPointerKey("voting-sites", "NH")))!.value };
  assert.equal(await artifacts.readManifest(), null);
  const readKeys: string[] = [];
  const readBytes = artifacts.readBytes.bind(artifacts);
  artifacts.readBytes = async key => { readKeys.push(key); return readBytes(key); };
  const bundle = (await ensureReaderAuthorityEdge(null, artifacts, ["voting-sites"]))!;
  assert.deepEqual(readKeys, [], "constructing the bundle must not fetch any state payload");
  const read = await withReaderAuthorityEdge({ ...bundle, edgeOnly: true }, () => readVotingSitesProjection("AZ"));
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.deepEqual(read.value, VOTING_SITES);
  assert.deepEqual(readKeys, [refs.AZ.key], "an Arizona request reads only Arizona bytes");
  const secondBundle = (await ensureReaderAuthorityEdge(null, artifacts, ["voting-sites"]))!;
  await withReaderAuthorityEdge({ ...secondBundle, edgeOnly: true }, () => readVotingSitesProjection("AZ"));
  assert.deepEqual(readKeys, [refs.AZ.key, refs.AZ.key], "another request reads its own state artifact without retaining the prior request payload");
  assert.equal(await readStateArtifact("voting-sites", "AZ", { ...refs.AZ, sha: "0".repeat(64) }, artifacts), null,
    "a changed integrity digest must not reuse the previously checked version");
  const absent = await withReaderAuthorityEdge({ ...bundle, edgeOnly: true }, () => readVotingSitesProjection("NH"));
  assert.equal(absent.kind, "NOT_RECORDED", "only a published absent pointer proves absence");
  await assert.rejects(withReaderAuthorityEdge({ ...bundle, edgeOnly: true }, () => readVotingSitesProjection("NJ")), ReaderEdgeOnlyRefusal,
    "a state with no pointer cannot be claimed absent");
  const corruptKey = await artifacts.putImmutable(Buffer.from("altered state bytes"), "json.gz");
  assert.equal(await readStateArtifact("voting-sites", "AZ", { ...refs.AZ, key: corruptKey }, artifacts), null);
  const changed = structuredClone(VOTING_SITES);
  changed.jurisdictions[0].sites[0].name = "Updated Example Event Center";
  const successor = promotedFamily([manualEdgeEntry("voting-sites:AZ", changed, "lazy-az-v2")], "lazy-az-v2");
  await readStateArtifact("voting-sites", "AZ", refs.AZ, artifacts);
  readKeys.length = 0;
  assert.deepEqual(await publishPointers(artifacts, { stateAuthorities: { "voting-sites": { AZ: successor } } }, T1), ["voting-sites/AZ"]);
  assert.deepEqual((await artifacts.readJsonPointer(authorityPointerKey("voting-sites", "NH")))!.value, refs.NH);
  assert.notEqual((await readServedPointer(artifacts, authorityPointerKey("voting-sites", "AZ")))!.ref.key, refs.AZ.key);
  assert.deepEqual(readKeys, [], "publishing Arizona never reads sibling payloads");
});
