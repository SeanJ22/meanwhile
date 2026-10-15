import { meetingPublication } from "./helpers/meeting-publication.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "./helpers/playbooks.ts";

import { publishReaderEdgeArtifacts, type PublishAuthority } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore, scopedReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { enterReaderAuthorityEdge, currentRegistryRuntimeEdge } from "../lib/registry/runtime-edge.ts";
import { registryRuntimeReadState } from "../lib/registry/runtime-read-model.ts";
import { federalDirectoryReadState } from "../lib/officials/federal-directory-read-model.ts";
import { getOutcomeSnapshot, loadedFrom, outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted } from "../lib/outcomes/store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishCommentFacts } from "../lib/facts/comment-facts.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { currentCommentAccess, type CommentAccessProjection } from "../lib/registry/comment-access.ts";
import { settleCommentAccessRead } from "../lib/registry/server.ts";
import { COMMENT_ACCESS } from "./fixtures/comment-access.ts";
import { factDb } from "./helpers/fact-db.ts";
import { installRegistryAuthority, registryTransferImport, syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";
import { installPimaOutcomes, pimaOutcomeFixture, recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { september22Sitting } from "./helpers/pima-september-22-sitting.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { pimaLegistarOutcomesCandidate } from "../lib/outcomes/data-plane.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

delete process.env.ANTHROPIC_API_KEY;
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
await installRegistryAuthority();

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
  readonly commentAccess?: string;
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
    ...(versions.commentAccess ? { "comment-access": { value: commentAccessProjection, versionId: versions.commentAccess } } : {}),
  };
  const store = new LocalFileArtifactStore(edgeDir);
  const metadata = {
    sourceThrough: snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    promotedThrough: snapshot.generatedAt,
  };
  const meetings = await publishReaderEdgeArtifacts(meetingPublication(snapshot), metadata, {
    store: scopedReaderArtifactStore(store, "AZ"),
  });
  assert.ok(["PUBLISHED", "CURRENT"].includes(meetings.status), JSON.stringify(meetings));
  const result = await publishReaderEdgeArtifacts(null, metadata, {
    store,
    now: new Date().toISOString(),
    authority,
  });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  process.env.WTP_READER_EDGE_DIR = edgeDir;
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

test("Ask reads the registry, the federal directory and the recorded outcomes from the edge it entered", async () => {
  await publishEdge({ registry: "edge-test:registry:1", federal: "edge-test:federal:1", outcomes: "edge-test:outcomes:1", commentAccess: "edge-test:comment-access:1" });
  const payload = await askPima();
  assert.ok(Number.isFinite(payload.trace.preloads?.authorityEdge), "the edge was not fetched");
  assert.equal(registryRuntimeReadState().metadata?.versionId, "edge-test:registry:1", "the registry was read from the database, not the edge");
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

test("a manifest without the outcomes family reads them from the database, and the trace says so", async (t) => {
  const candidate = pimaLegistarOutcomesCandidate({ snapshot: recordedOutcomes, acquisitions: [],
    retrievedAt: "2026-09-25T12:00:00.000Z", sourceThrough: "2026-09-25" });
  const entry = provenEdgeEntry({ ...candidate, versionId: candidate.id, value: recordedOutcomes });
  const database = new MemoryRoutineDataStore();
  Object.assign(database, {
    promotions: new Map([[entry.projection.key, entry.projection]]),
    candidates: new Map([[candidate.id, { candidate, state: "PROMOTED", acquisitionSucceeded: true,
      receipt: entry.projection.receipt, promotedVersion: candidate.id, lastKnownGoodVersion: candidate.id,
      failureCode: null, failureDetail: null }]]),
  });
  const read = t.mock.method(PostgresRoutineDataStore.prototype, "readPromotion", database.readPromotion.bind(database));
  for (const method of ["readPromotions", "readPromotionIdentity", "readPromotionIdentities", "readCandidate", "readCandidates", "readCandidateProof", "readCandidateProofs"] as const) {
    t.mock.method(PostgresRoutineDataStore.prototype, method, database[method].bind(database));
  }
  clearPromotedReadModelCache();
  process.env.DATABASE_URL = "postgresql://fixture:fixture@database.test/reader";
  t.after(() => { delete process.env.DATABASE_URL; clearPromotedReadModelCache(); });
  await publishEdge({ registry: "edge-test:registry:2", federal: "edge-test:federal:2" });
  const payload = await askPima();
  assert.ok(read.mock.callCount() > 0, "the fallback consulted the durable pointer store");
  assert.equal(payload.trace.preloadSources?.outcomes, "DATABASE");
  assert.doesNotMatch(outcomeProjectionReadState().detail ?? "", /edge-test:outcomes:1/);
  assert.ok(["PROMOTED", "BOOTSTRAP"].includes(outcomeProjectionReadState().kind), "the database fallback read the outcomes");
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

test("Campaign money reads the registry from the edge it entered, and names every read's time", async () => {
  await publishEdge({ registry: "edge-test:registry:3", federal: "edge-test:federal:3" });
  const { GET } = await import("../app/api/funding/[target]/route.ts");
  const response = await GET(new Request("https://wtp.test/api/funding/congress%3AC001133"), {
    params: Promise.resolve({ target: "congress%3AC001133" }),
  });
  assert.ok([200, 503].includes(response.status));
  assert.equal(registryRuntimeReadState().metadata?.versionId, "edge-test:registry:3", "the registry was read from the database, not the edge");
  const timing = response.headers.get("server-timing") ?? "";
  for (const name of ["edgeManifest", "authorityEdge", "registry", "fec", "total"]) {
    assert.match(timing, new RegExp(`(?:^|, )${name};dur=\\d+`), `${name} is not timed: ${timing}`);
  }
});
