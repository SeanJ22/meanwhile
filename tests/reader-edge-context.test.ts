import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "./helpers/playbooks.ts";

import { publishReaderEdgeArtifacts, type PublishAuthority } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { writeFactBucket, writeFactRecord } from "../lib/meetings/edge-serving.ts";
import type { BodyFacts } from "../lib/facts/registry-overlay.ts";
import { azDistricts } from "./helpers/ballot-district-fixtures.ts";
import { enterReaderAuthorityEdge, currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { federalDirectoryReadState } from "../lib/officials/federal-directory-read-model.ts";
import { getOutcomeSnapshot, loadedFrom, outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted } from "../lib/outcomes/store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishCommentFacts } from "../lib/facts/comment-facts.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { currentCommentAccess, type CommentAccessProjection } from "../lib/registry/comment-access.ts";
import { settleCommentAccessRead } from "../lib/registry/server.ts";
import { COMMENT_ACCESS } from "./fixtures/comment-access.ts";
import { factDb } from "./helpers/fact-db.ts";
import { installRegistryAuthority, syntheticFederalDirectory, stateFederalDirectoryArtifacts } from "./helpers/promoted-fixtures.ts";
import { installPimaOutcomes, pimaOutcomeFixture, recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { september22Sitting } from "./helpers/pima-september-22-sitting.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

function stateRegistryArtifacts(versionId: string, states: readonly string[], value: RegistryRuntimeReadModel = registryTransferImport().projection.payload) {
  return Object.fromEntries(states.map(state => [state, { versionId: `${versionId}:${state}`, value: { kind: "PROMOTED_POINTERS" as const,
    entries: [provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state), sourceId: "registry-reviewed-bindings",
      versionId: `${versionId}:${state}`, value: registryFixtureForState(state, value) })] } }]));
}



delete process.env.ANTHROPIC_API_KEY;
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
await installRegistryAuthority();

const edgeDir = mkdtempSync(join(tmpdir(), "wtp-reader-edge-"));
const previousEdgeDir = process.env.WTP_READER_EDGE_DIR;
const openedArtifacts: string[] = [];
const readBytes = LocalFileArtifactStore.prototype.readBytes;
LocalFileArtifactStore.prototype.readBytes = function(key) {
  openedArtifacts.push(key);
  return readBytes.call(this, key);
};
let registryArtifactKey = "";
after(() => {
  if (previousEdgeDir === undefined) delete process.env.WTP_READER_EDGE_DIR;
  else process.env.WTP_READER_EDGE_DIR = previousEdgeDir;
  rmSync(edgeDir, { recursive: true, force: true });
  LocalFileArtifactStore.prototype.readBytes = readBytes;
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
    "census-districts": { value: azDistricts, versionId: azDistricts.versionId },
    ...(versions.outcomes && (outcomesValue.kind === "BOOTSTRAP" || outcomesValue.kind === "PROMOTED")
      ? { "meeting-outcomes": { value: getOutcomeSnapshot(), versionId: versions.outcomes } }
      : {}),
  };
  const store = new LocalFileArtifactStore(edgeDir);
  const records = await Promise.all(COMMENT_ACCESS.map(async (comment, index) => {
    const body: BodyFacts = { id: comment.bodyId, division: comment.bodyId.split("#")[0], fields: {}, roster: null, comment, sittings: [], dispositions: [] };
    return { path: ["bodies", index], ...await writeFactRecord(store, body), tags: [body.id, body.division] };
  }));
  const result = await publishReaderEdgeArtifacts(snapshot, {
    sourceThrough: snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    promotedThrough: snapshot.generatedAt,
  }, {
    store,
    stateAuthorities: { "registry-runtime": stateRegistryArtifacts(versions.registry, ["AZ"]), "federal-directory": stateFederalDirectoryArtifacts(versions.federal) },
    ...(versions.commentAccess ? { stateFacts: { AZ: { versionId: versions.commentAccess, value: { buckets: [await writeFactBucket(store, "AZ", 0, versions.commentAccess,
      { kind: "READER_RECORDS", base: { bodies: [] }, records }, new Date().toISOString())] } } } } : {}),
    now: new Date().toISOString(),
    authority,
  });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  process.env.WTP_READER_EDGE_DIR = edgeDir;
  registryArtifactKey = (await store.readManifest())!.manifest.stateAuthorities!["registry-runtime"]!.AZ!.key;
  openedArtifacts.length = 0;
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
  const bundle = { promotedFamilies: new Set(["als-probe"]) };
  // The caller's own context starts from an edge with no registry (the module's installed one is set aside).
  enterReaderAuthorityEdge({});
  const insideHelper = async () => {
    const entered = (async () => { await Promise.resolve(); enterReaderAuthorityEdge(bundle); })();
    return await entered.then(() => currentReaderAuthorityEdge()?.promotedFamilies?.has("als-probe") ? "als-probe" : "none");
  };
  const byCaller = async () => {
    await Promise.resolve();
    enterReaderAuthorityEdge(bundle);
    return await Promise.resolve().then(() => currentReaderAuthorityEdge()?.promotedFamilies?.has("als-probe") ? "als-probe" : "none");
  };
  assert.equal(await insideHelper(), "none", "if this now reads the edge, the runtime changed; the rule below still holds");
  assert.equal(await byCaller(), "als-probe");
});

test("Ask reads the registry, the federal directory and the recorded outcomes from the edge it entered", async () => {
  await publishEdge({ registry: "edge-test:registry:1", federal: "edge-test:federal:1", outcomes: "edge-test:outcomes:1", commentAccess: "edge-test:comment-access:1" });
  const payload = await askPima();
  assert.ok(Number.isFinite(payload.trace.preloads?.authorityEdge), "the edge was not fetched");
  assert.ok(openedArtifacts.includes(registryArtifactKey), "the request opens the published Arizona registry version");
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
  assert.ok(openedArtifacts.includes(registryArtifactKey), "the request opens the published Arizona registry version");
  const timing = response.headers.get("server-timing") ?? "";
  for (const name of ["edgeManifest", "authorityEdge", "registry", "fec", "total"]) {
    assert.match(timing, new RegExp(`(?:^|, )${name};dur=\\d+`), `${name} is not timed: ${timing}`);
  }
});
