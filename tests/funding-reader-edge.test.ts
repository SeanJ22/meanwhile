import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { publishReaderEdgeArtifacts, type PublishAuthority } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { readAzBallotProjection } from "../lib/civic-data/manual-read-models.ts";
import { fundingReadState, readFundingSnapshot } from "../lib/funding/snapshot.ts";
import { stateMoneyReadState } from "../lib/funding/state-snapshot.ts";
import { registryRuntimeFirstSeed, registryRuntimeReadState } from "../lib/registry/runtime-read-model.ts";
import { federalDirectoryFirstSeed } from "../lib/officials/federal-directory-read-model.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
import { manualEdgeEntry, promotedFamily, provenEdgeEntry, servedValue, stateMoneyFixtureEntries } from "./helpers/promoted-edge-entry.ts";

/**
 * **A COLD /api/funding READS NOTHING FROM THE DATABASE WHEN THE EDGE CARRIES
 * IT.** (2026-09-25.)
 *
 * Campaign money is a reader action, so it answers under 3 s on a cold
 * instance too. The route started the reads its target's own id decides (FEC,
 * the state's money, the AZ ballot identity) before it entered the reader
 * edge, beside the manifest fetch (C22), so those reads went to the database
 * even after FEC, state money and the AZ ballot became proven pointers on the
 * edge. The edge is now entered first, in the handler, and every read after it
 * is edge first.
 *
 * The real route is asked with no database: DATABASE_URL names an `.invalid`
 * host and every Neon HTTP request is answered here with no rows and counted,
 * so a read that reaches the database is seen. The pilot targets are the
 * reader proof's own (scripts/reader-last-mile-production-readback.mts).
 */

for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID", "WTP_READER_EDGE_DIR"]) delete process.env[key];
await installRegistryRuntimeFirstSeeds();

const seedStore = new MemoryRoutineDataStore();
const fec = requiredRoutineContract("fec-funding");
const EDGE = { registry: "edge-test:funding:registry", fec: "edge-test:funding:fec", az: "edge-test:funding:az", money: (state: string) => `edge-test:funding:money:${state}` };
const PROMOTED: PublishAuthority = {
  "federal-funding": promotedFamily([provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fec.scope, sourceId: fec.sourceId, versionId: EDGE.fec, value: servedValue(await readFundingSnapshot({ store: seedStore, bypassCache: true })) })], EDGE.fec),
  "state-money": promotedFamily(stateMoneyFixtureEntries(EDGE.money), "edge-test:funding:money"),
  "ballot-az": promotedFamily([manualEdgeEntry("az-sos-ballot", servedValue(await readAzBallotProjection({ store: seedStore, bypassCache: true })), EDGE.az)], EDGE.az),
};

async function publishEdge(authority: PublishAuthority): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-funding-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const published = await publishReaderEdgeArtifacts({
    formatVersion: 1, generatedAt: "2026-09-25T00:00:00.000Z", counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 }, sources: [], meetings: [], agendaDocuments: [],
  }, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, {
    store: new LocalFileArtifactStore(dir),
    authority: {
      "registry-runtime": { value: registryRuntimeFirstSeed().value, versionId: EDGE.registry },
      "federal-directory": { value: federalDirectoryFirstSeed().value, versionId: "edge-test:funding:federal" },
      ...authority,
    },
  });
  assert.equal(published.status, "PUBLISHED", JSON.stringify(published));
  return dir;
}
/** What production served before the proven-pointer families: the registry and the federal directory. */
const authorityOnlyDir = await publishEdge({});
/** And with FEC, state money and the AZ ballot on it. */
const fullEdgeDir = await publishEdge(PROMOTED);

const databaseReads: string[] = [];
process.env.DATABASE_URL = "postgresql://edge-test:edge-test@ep-funding-edge-test.funding-edge-test.invalid/none?sslmode=require";
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("funding-edge-test.invalid/")) throw new Error(`the funding route fetched ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}")) as { params?: unknown[]; queries?: { params?: unknown[] }[] };
  const queries = body.queries ?? [body];
  for (const query of queries) {
    const recordClass = (query.params ?? []).find((p): p is string => typeof p === "string" && /^[A-Z][A-Z_]+$/.test(p) && p !== "UNCHANGED_CONFIRMATION_V1");
    const scope = (query.params ?? []).find((p): p is string => typeof p === "string" && p !== recordClass && /[:+-]/.test(p));
    databaseReads.push(`${recordClass ?? "UNKNOWN"}${scope ? `:${scope}` : ""}`);
  }
  const empty = { command: "SELECT", rowCount: 0, rows: [], fields: [] };
  return new Response(JSON.stringify(body.queries ? { results: queries.map(() => empty) } : empty), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

/** The reader proof's pilot officials and ballot keys, and a federal officeholder. */
const PILOT_TARGETS = [
  "statewide:az/governor",
  "ballot-az-pima:governor:hobbs-katie",
  "roster:morris#6",
  "ballot-nj-morris:county-commissioner:selen",
  "statewide:nh/governor",
  "ballot-nh-merrimack:governor:ayotte-kelly",
  "congress:C001133",
];

/** One cold request: no read-model cache, the route's own handler. */
async function coldFunding(target: string): Promise<{ status: number; body: Record<string, unknown>; reads: string[] }> {
  clearPromotedReadModelCache();
  databaseReads.length = 0;
  const { GET } = await import("../app/api/funding/[target]/route.ts");
  const response = await GET(new Request(`https://wtp.test/api/funding/${encodeURIComponent(target)}`), { params: Promise.resolve({ target: encodeURIComponent(target) }) });
  return { status: response.status, body: await response.json() as Record<string, unknown>, reads: [...databaseReads].sort() };
}

const answerOf = ({ dataState: _state, dataMetadata: _metadata, ...answer }: Record<string, unknown>) => answer;

test("with only the registry and the federal directory on the edge, a cold /api/funding reads FEC, state money and the AZ ballot from the database", async () => {
  process.env.WTP_READER_EDGE_DIR = authorityOnlyDir;
  const counts: Record<string, number> = {};
  for (const target of PILOT_TARGETS) {
    const { status, reads } = await coldFunding(target);
    assert.ok([200, 503].includes(status), `${target}: ${status}`);
    counts[target] = reads.length;
    assert.ok(reads.length > 0, `${target} read nothing from the database`);
    assert.deepEqual(reads.filter((read) => /^(REGISTRY_RUNTIME_BINDING|FEDERAL_DIRECTORY)/.test(read)), [], `${target}: an edge family was read from the database`);
  }
  console.log(`authority-only edge, database pointer reads per target: ${JSON.stringify(counts)}`);
});

test("with FEC, state money and the AZ ballot on the edge, a cold /api/funding for every pilot target makes no database read, and answers the same money", async () => {
  const fromDatabase = new Map<string, Record<string, unknown>>();
  delete process.env.WTP_READER_EDGE_DIR;
  for (const target of PILOT_TARGETS) fromDatabase.set(target, (await coldFunding(target)).body);

  process.env.WTP_READER_EDGE_DIR = fullEdgeDir;
  const served = new Map<string, Awaited<ReturnType<typeof coldFunding>>>();
  for (const target of PILOT_TARGETS) served.set(target, await coldFunding(target));
  assert.deepEqual(
    Object.fromEntries([...served].map(([target, { reads }]) => [target, reads])),
    Object.fromEntries(PILOT_TARGETS.map((target) => [target, []])),
    "a pilot target read the database with the edge present",
  );
  for (const [target, { status, body }] of served) {
    assert.equal(status, 200, target);
    // The money itself is the same answer the database path gives (these edge values are the fixtures it serves);
    // only the data state differs here, PROMOTED from the edge against the test process's BOOTSTRAP first seed.
    assert.deepEqual(answerOf(body), answerOf(fromDatabase.get(target)!), `${target}: the edge answered different money`);
  }
  assert.equal(registryRuntimeReadState().metadata.versionId, EDGE.registry, "the registry was not served from the edge");
  assert.equal(fundingReadState().metadata.versionId, EDGE.fec, "FEC was not served from the edge");
  assert.equal(stateMoneyReadState("NH").metadata.versionId, EDGE.money("NH"), "NH money was not served from the edge");
});

test("as production runs it (NODE_ENV=production, no test fixtures), the same cold requests read nothing from the database and answer PROMOTED money", async () => {
  process.env.WTP_READER_EDGE_DIR = fullEdgeDir;
  const env = { NODE_ENV: process.env.NODE_ENV, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT };
  Reflect.set(process.env, "NODE_ENV", "production");
  Reflect.deleteProperty(process.env, "NODE_TEST_CONTEXT");
  try {
    for (const target of PILOT_TARGETS) {
      const { status, body, reads } = await coldFunding(target);
      assert.deepEqual(reads, [], `${target} read the database in production mode`);
      assert.equal(status, 200, `${target}: ${JSON.stringify(body)}`);
      assert.equal(body.dataState, "PROMOTED", `${target} did not answer the edge's promoted money`);
      assert.equal(body.holdingStatus, "HELD", target);
    }
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, value);
    }
  }
});
