import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { after, test } from "./helpers/playbooks.ts";

import { publishReaderEdgeArtifacts, type PublishAuthority } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { enterReaderAuthorityEdge, currentRegistryRuntimeEdge, withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { readRegistryPlace } from "../lib/registry/reader-place.ts";
import type { RecordIndex } from "../lib/meetings/authority-records.ts";
import { federalDirectoryReadState } from "../lib/officials/federal-directory-read-model.ts";
import { getOutcomeSnapshot, loadedFrom, outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted } from "../lib/outcomes/store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishCommentFacts } from "../lib/facts/comment-facts.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { currentCommentAccess, type CommentAccessProjection } from "../lib/registry/comment-access.ts";
import { settleCommentAccessRead } from "../lib/registry/server.ts";
import { COMMENT_ACCESS } from "./fixtures/comment-access.ts";
import { factDb } from "./helpers/fact-db.ts";
import { installRegistryAuthority, registryTransferImport, syntheticAzBallot, syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";
import { installPimaOutcomes, pimaOutcomeFixture, recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { registryPlaceFixtureResult, type FixtureStatement } from "./helpers/registry-place-fetch.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { manualEdgeEntry, promotedFamily } from "./helpers/promoted-edge-entry.ts";
import { september22Sitting } from "./helpers/pima-september-22-sitting.ts";



delete process.env.ANTHROPIC_API_KEY;
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
await installRegistryAuthority();
const registry = registryTransferImport().projection.payload;
let registryVersion = "";
const placeReads: string[] = [];
process.env.DATABASE_URL = "postgres://test:test@ep-reader-context.reader-context.invalid/test?sslmode=require";
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; delete process.env.DATABASE_URL; });
globalThis.fetch = (async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("reader-context.invalid/")) return originalFetch(input, init);
  const request = JSON.parse(String(init?.body)) as { queries?: FixtureStatement[] } & FixtureStatement;
  const empty = { command: "SELECT", rowCount: 0, rowAsArray: true, fields: [], rows: [] };
  const results = (request.queries ?? [request]).map(statement => {
    const result = registryPlaceFixtureResult(statement, registry, registryVersion);
    if (result) placeReads.push(registryVersion);
    return result ?? empty;
  });
  return Response.json(request.queries ? { results } : results[0]);
}) as typeof fetch;

const edgeDir = mkdtempSync(join(tmpdir(), "wtp-reader-edge-"));
const previousEdgeDir = process.env.WTP_READER_EDGE_DIR;
after(() => {
  if (previousEdgeDir === undefined) delete process.env.WTP_READER_EDGE_DIR;
  else process.env.WTP_READER_EDGE_DIR = previousEdgeDir;
  rmSync(edgeDir, { recursive: true, force: true });
});

// The recorded Pima outcome store with the September 22 data-center sitting, promoted.
const recordedOutcomes = pimaOutcomeFixture();
await installPimaOutcomes({ ...recordedOutcomes, sittings: [...recordedOutcomes.sittings, september22Sitting()] });
await refreshOutcomeSnapshotFromPromoted();
const outcomesValue = outcomeProjectionReadState();
assert.ok(outcomesValue.kind === "BOOTSTRAP" || outcomesValue.kind === "PROMOTED", "the outcome fixture is readable");
// Comment rules in the projection shape the edge publishes.
const commentAccessProjection: CommentAccessProjection = {
  kind: "comment-access",
  records: COMMENT_ACCESS.map((value) => ({ id: `comment-access:${value.bodyId}`, ...value })),
};

interface EdgeVersions {
  readonly registry: string;
  readonly federal: string;
  readonly outcomes?: string;
}

async function publishEdge(versions: EdgeVersions): Promise<void> {
  const snapshot = recordedMeetingsSnapshot();
  assert.ok(snapshot.meetings.length > 0, "the recorded meetings publish the edge's meeting scopes");
  const authority: PublishAuthority = {
    "registry-runtime": { value: registryTransferImport().projection.payload, versionId: versions.registry },
    "federal-directory": { value: syntheticFederalDirectory(), versionId: versions.federal },
    ...(versions.outcomes && (outcomesValue.kind === "BOOTSTRAP" || outcomesValue.kind === "PROMOTED")
      ? { "meeting-outcomes": { value: getOutcomeSnapshot(), versionId: versions.outcomes } }
      : {}),
  };
  const result = await publishReaderEdgeArtifacts(snapshot, {
    sourceThrough: snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    promotedThrough: snapshot.generatedAt,
  }, {
    store: new LocalFileArtifactStore(edgeDir),
    now: new Date().toISOString(),
    authority,
  });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  process.env.WTP_READER_EDGE_DIR = edgeDir;
  registryVersion = versions.registry;
  placeReads.length = 0;
}

async function withoutMeetingManifest<T>(run: () => Promise<T>): Promise<T> {
  const original = LocalFileArtifactStore.prototype.readManifest;
  let reads = 0;
  LocalFileArtifactStore.prototype.readManifest = async function () {
    reads += 1;
    return original.call(this);
  };
  try {
    const result = await run();
    assert.equal(reads, 0, "this request must not read the country's meeting manifest");
    return result;
  } finally {
    LocalFileArtifactStore.prototype.readManifest = original;
  }
}

const AZ = "ocd-division/country:us/state:az";

async function askPima(): Promise<{ trace: { preloads?: Record<string, number>; preloadSources?: Record<string, string> }; answer: string | null }> {
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "reader-edge-context-test" },
    body: JSON.stringify({ question: "is pima county voting on data centers", approximateLocation: "85701", surface: "MAP", ocdIds: [AZ, `${AZ}/county:pima`, `${AZ}/place:tucson`], today: "2026-09-24" }),
  }));
  assert.equal(response.status, 200);
  return await response.json() as { trace: { preloads?: Record<string, number>; preloadSources?: Record<string, string> }; answer: string | null };
}

test("Node 24: an edge entered inside a helper never reaches the reads chained on it; entered by the caller, it does", async () => {
  const bundle = { registryRuntime: { value: registryTransferImport().projection.payload, versionId: "als-probe" } };
  // The caller's own context starts from an edge with no registry (the module's installed one is set aside).
  enterReaderAuthorityEdge({});
  const insideHelper = async () => {
    const entered = (async () => { await Promise.resolve(); enterReaderAuthorityEdge(bundle); })();
    return await entered.then(() => currentRegistryRuntimeEdge()?.versionId ?? "none");
  };
  const byCaller = async () => {
    await Promise.resolve();
    enterReaderAuthorityEdge(bundle);
    return await Promise.resolve().then(() => currentRegistryRuntimeEdge()?.versionId ?? "none");
  };
  assert.equal(await insideHelper(), "none", "if this now reads the edge, the runtime changed; the rule below still holds");
  assert.equal(await byCaller(), "als-probe");
});

test("Ask reads the selected registry at the accepted edge version and the published directory and outcomes", async () => {
  await publishEdge({ registry: "edge-test:registry:1", federal: "edge-test:federal:1", outcomes: "edge-test:outcomes:1" });
  const payload = await askPima();
  assert.ok(Number.isFinite(payload.trace.preloads?.authorityEdge), "the edge was not fetched");
  assert.deepEqual(placeReads, [], "the selected registry records are read from the edge without a database query");
  assert.equal(federalDirectoryReadState().metadata?.versionId, "edge-test:federal:1", "the federal directory was read from the database, not the edge");
  assert.match(outcomeProjectionReadState().detail ?? "", /edge artifact \(version edge-test:outcomes:1\)/, "the recorded outcomes were read from the database, not the edge");
  assert.equal(loadedFrom(), "DATA_PLANE", "an edge-served outcome projection is the data plane's own value, never a test fixture");
  assert.deepEqual(
    { registry: payload.trace.preloadSources?.registry, federalDirectory: payload.trace.preloadSources?.federalDirectory, outcomes: payload.trace.preloadSources?.outcomes },
    { registry: "EDGE", federalDirectory: "EDGE", outcomes: "EDGE" },
    "the trace names where each essential source was read",
  );
  assert.match(payload.answer ?? "", /September 22nd, 2026/, "the edge-served outcomes still answer the Pima question");
});

test("a manifest without the outcomes family reads them from the database, and the trace says so", async () => {
  await publishEdge({ registry: "edge-test:registry:2", federal: "edge-test:federal:2" });
  const payload = await askPima();
  assert.equal(payload.trace.preloadSources?.outcomes, "DATABASE");
  assert.doesNotMatch(outcomeProjectionReadState().detail ?? "", /edge-test:outcomes:1/);
  assert.ok(["PROMOTED", "BOOTSTRAP"].includes(outcomeProjectionReadState().kind), "the database fallback read the outcomes");
});

test("a place registry reads only its published records and an exact named body at the accepted version", async () => {
  await publishEdge({ registry: "edge-test:registry:selected", federal: "edge-test:federal:selected" });
  const store = new LocalFileArtifactStore(edgeDir);
  const manifest = (await store.readAuthorityManifest())!.manifest;
  const ref = manifest.authorityArtifacts!["registry-runtime"]!;
  const index = JSON.parse(gunzipSync((await store.readBytes(ref.key))!).toString("utf8")).value as RecordIndex;
  const wanted = `${AZ}/school_district:sunnyside_unified_district`;
  const named = `${AZ}/school_district:vail_unified_district#board`;
  const foreign = index.records.filter(row => row.path[0] === "registry" && row.path[1] === "bodies" &&
    row.tags.some(tag => tag.includes("/state:nh/")));
  assert.ok(foreign.length > 0);
  const opened = new Set<string>();
  const original = LocalFileArtifactStore.prototype.readBytes;
  LocalFileArtifactStore.prototype.readBytes = async function (key) { opened.add(key); return original.call(this, key); };
  try {
    const read = await withReaderAuthorityEdge({}, () => readRegistryPlace([wanted], [named], manifest));
    assert.equal(read.source, "EDGE");
    assert.equal(read.versionId, "edge-test:registry:selected");
    assert.ok(read.value.registry.bodies.some(row => row.id === named));
    assert.ok(read.value.registry.bodies.every(row => row.id === named || row.ocdId === wanted || row.ocdId === AZ || row.alsoServesOcdIds?.includes(wanted)));
    assert.ok(foreign.every(row => !opened.has(row.key)), "another state's body bytes are never fetched");
    assert.deepEqual(placeReads, [], "accepted edge records do not reopen registry SQL");
  } finally { LocalFileArtifactStore.prototype.readBytes = original; }
});

test("comment rules are primed from the edge the caller entered, and read from live facts without one", async () => {
  await (async () => {
    enterReaderAuthorityEdge({ commentAccess: { value: commentAccessProjection, versionId: "edge-test:comment-access:2" } });
    await settleCommentAccessRead();
    assert.deepEqual(currentCommentAccess(), COMMENT_ACCESS, "comment rules were not read from the edge");
  })();
  const db = await factDb();
  const now = new Date();
  const page = "Edge Test Commission, Tucson, Arizona. Public comment: speakers sign up at the clerk's table before the meeting begins.";
  await publishCommentFacts(db, {
    body: { id: "ocd-division/country:us/state:az/place:tucson#edge-test-commission", name: "Edge Test Commission", state: "AZ", parentId: "ocd-division/country:us/state:az/place:tucson" },
    capture: { evidence: { artifactId: "edge-test-comment", contentHash: `sha256-${"c".repeat(64)}`, text: page, acquiredByAttemptId: "attempt",
      canonicalUrl: "https://www.tucsonaz.gov/edge-test-commission", retrievedAt: now.toISOString(), sourceId: "www.tucsonaz.gov", methodRouteId: "held" },
    observedAt: now.toISOString(), httpStatus: 200, transport: "REACHABLE", partial: false },
    reading: { fields: { commentPeriod: "YES", signup: "speakers sign up at the clerk's table before the meeting begins" } },
    producedBy: "reader-edge-context-test",
  }, factClocks(null), now);
  installFactReader(db.query);
  try {
    await (async () => {
      enterReaderAuthorityEdge({});
      await settleCommentAccessRead();
      assert.deepEqual(currentCommentAccess().map((rule) => [rule.bodyId, rule.commentPeriod, rule.signup]),
        [["ocd-division/country:us/state:az/place:tucson#edge-test-commission", "YES", "speakers sign up at the clerk's table before the meeting begins"]]);
    })();
  } finally {
    installFactReader(undefined);
  }
});

test("Campaign money reads the selected registry at the accepted edge version and names every read's time", async () => {
  await publishEdge({ registry: "edge-test:registry:3", federal: "edge-test:federal:3" });
  const { GET } = await import("../app/api/funding/[target]/route.ts");
  const response = await withoutMeetingManifest(() => GET(new Request("https://wtp.test/api/funding/congress%3AC001133?division=ocd-division%2Fcountry%3Aus%2Fstate%3Aaz"), {
    params: Promise.resolve({ target: "congress%3AC001133" }),
  }));
  assert.ok([200, 503].includes(response.status));
  assert.deepEqual(placeReads, [], "funding uses the selected registry records without a database query");
  const timing = response.headers.get("server-timing") ?? "";
  for (const name of ["edgeManifest", "authorityEdge", "registry", "fec", "total"]) {
    assert.match(timing, new RegExp(`(?:^|, )${name};dur=\\d+`), `${name} is not timed: ${timing}`);
  }
});

test("a ballot Ask reads its state authority without opening the meeting manifest", async () => {
  await publishEdge({ registry: "edge-test:registry:ballot", federal: "edge-test:federal:ballot" });
  const ballot = syntheticAzBallot();
  const version = "edge-test:ballot:AZ";
  await publishReaderEdgeArtifacts(null, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, {
    store: new LocalFileArtifactStore(edgeDir),
    stateAuthorities: { "ballot-contests": { AZ: promotedFamily([
      manualEdgeEntry("ballot-contests:AZ", { kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } }, version),
    ], version) } },
  });
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const response = await withoutMeetingManifest(() => POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "reader-edge-context-ballot" },
    body: JSON.stringify({ question: "Who is running for Synthetic Office?", approximateLocation: "85701", surface: "BALLOT", ocdIds: [AZ], today: "2026-10-15" }),
  })));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.trace.resolution.basis, "HELD_BALLOT");
  assert.deepEqual(placeReads, [], "a ballot-only answer performs no registry lookup");
  assert.match(payload.answer, /Alex Candidate/);
});
