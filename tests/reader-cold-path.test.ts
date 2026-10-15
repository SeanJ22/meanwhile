import assert from "node:assert/strict";

import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { after, test } from "node:test";

import {
  ensureReaderAuthorityEdge,
  publishReaderEdgeArtifacts,
  readReaderManifest,
  READER_MANIFEST_CACHE_TAG,
  READER_MANIFEST_MEMO_MS,
  READER_MAP_AUTHORITY_FAMILIES,
  type PublishAuthority,
} from "../lib/meetings/edge-serving.ts";

import { stateOfOcdId, type ReaderManifest } from "../lib/meetings/edge-artifacts.ts";

import { LocalFileArtifactStore, scopedReaderArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";


import { edgeValidationsRun } from "../lib/civic-data/validated-once.ts";

import { getOutcomeSnapshot, outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted } from "../lib/outcomes/store.ts";

import type { CommentAccessProjection } from "../lib/registry/comment-access.ts";

import { primeRegistryRuntimeFromValue, registryRuntimeReadState } from "../lib/registry/runtime-read-model.ts";

import { currentEverydayRoutingProjection } from "../lib/routing/everyday-data-plane.ts";

import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from "../lib/state-rollcalls/authority.ts";

import { GET as meetingsGET } from "../app/api/meetings/route.ts";

import { GET as representationGET } from "../app/api/representation/[...division]/route.ts";

import { primeReaderEdge } from "../app/api/warm/route.ts";

import { installRegistryAuthority, registryTransferImport, syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";

import { installPimaOutcomes, recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";

import { COMMENT_ACCESS } from "./fixtures/comment-access.ts";

delete process.env.ANTHROPIC_API_KEY;

for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];

await installRegistryAuthority();

const dirs: string[] = [];

const previousEdgeDir = process.env.WTP_READER_EDGE_DIR;

after(() => {
  if (previousEdgeDir === undefined) delete process.env.WTP_READER_EDGE_DIR;
  else process.env.WTP_READER_EDGE_DIR = previousEdgeDir;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

await installPimaOutcomes();

await refreshOutcomeSnapshotFromPromoted();

const outcomes = outcomeProjectionReadState();

assert.ok(outcomes.kind === "BOOTSTRAP" || outcomes.kind === "PROMOTED", "the outcome fixture is readable");

const commentAccessProjection: CommentAccessProjection = {
  kind: "comment-access",
  records: COMMENT_ACCESS.map((value) => ({ id: `comment-access:${value.bodyId}`, ...value })),
};

const stateLegislators = Object.fromEntries(OFFICIAL_STATE_LEGISLATOR_TARGETS.map((target) => [target.jurisdiction, {
  formatVersion: 1,
  sourceId: target.sourceId,
  jurisdiction: target.jurisdiction,
  term: "test",
  generatedAt: "2026-09-25T00:00:00.000Z",
  roster: { scope: target.state.toLowerCase(), generatedAt: "2026-09-25", officeholders: [], divisions: [], unmatched: [] },
}]));

/**
 * The recorded 85701 meetings plus one synthetic sitting each for a New Jersey and a New Hampshire county
 * government, so the edge publishes meeting scopes for three states.
 */
function multiStateSnapshot() {
  const recorded = recordedMeetingsSnapshot().meetings;
  const template = recorded.find((row) => row.id.startsWith("legistar:") && row.location)!;
  const elsewhere = (state: string, county: string, lat: number, lng: number) => ({
    ...template,
    id: `test-calendar:${state}-${county}`,
    ocdId: `ocd-division/country:us/state:${state}/county:${county}`,
    bodyId: `ocd-division/country:us/state:${state}/county:${county}#governing`,
    bodyName: `Synthetic ${county} county board`,
    jurisdiction: `${county} County, ${state.toUpperCase()}`,
    location: { lat, lng, name: "Synthetic test venue", address: "Synthetic test address" },
    actingBodies: undefined,
  });
  return recordedMeetingsSnapshot([...recorded, elsewhere("nj", "morris", 40.7968, -74.4815), elsewhere("nh", "merrimack", 43.2081, -71.5376)]);
}

async function publishEdge(tag: string, options: { readonly legislators?: boolean } = {}): Promise<{ dir: string; manifest: ReaderManifest }> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-c21-edge-"));
  dirs.push(dir);
  const snapshot = multiStateSnapshot();
  assert.ok(snapshot.meetings.length > 0, "the recorded meetings publish the edge's meeting scopes");
  const authority: PublishAuthority = {
    "registry-runtime": { value: registryTransferImport().projection.payload, versionId: `${tag}:registry` },
    "federal-directory": { value: syntheticFederalDirectory(), versionId: `${tag}:federal` },
  };
  const store = new LocalFileArtifactStore(dir);
  const result = await publishReaderEdgeArtifacts(null, {
    sourceThrough: snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    promotedThrough: snapshot.generatedAt,
  }, {
    store,
    now: new Date().toISOString(),
    authority,
    extras: { everydayRouting: currentEverydayRoutingProjection() },
    registrations: {},
  });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  for (const state of ["az","nj","nh"]) {
    const meetings = snapshot.meetings.filter(meeting => (stateOfOcdId(meeting.ocdId) ?? "az") === state);
    const ids = new Set(meetings.map(meeting => meeting.id));
    const scoped = { ...snapshot,meetings,agendaDocuments: snapshot.agendaDocuments.filter(document => ids.has(document.meetingId)) };
    const published = await publishReaderEdgeArtifacts(scoped,{ sourceThrough: snapshot.generatedAt,retrievedAt: snapshot.generatedAt,promotedThrough: snapshot.generatedAt },{
      store: scopedReaderArtifactStore(store,state),extras: { commentAccess: COMMENT_ACCESS },
      ...(state === "az" ? { authority: { "meeting-outcomes": { value: getOutcomeSnapshot(),versionId: `${tag}:outcomes` },
        "comment-access": { value: commentAccessProjection,versionId: `${tag}:comment-access` } } } : {}),
      ...(options.legislators ? { stateLegislators: Object.fromEntries(Object.entries(stateLegislators).filter(([scope]) => scope === `US-${state.toUpperCase()}`)
        .map(([scope,value]) => [scope,{ value,versionId: `${tag}:legislators:${scope}` }])) } : {}),registrations: {},
    });
    assert.equal(published.status,"PUBLISHED",JSON.stringify(published));
  }

  return { dir, manifest: (await store.readManifest())!.manifest };
}

class RecordingStore extends LocalFileArtifactStore {
  readonly keys: string[] = [];
  override async readBytes(key: string): Promise<Uint8Array | null> {
    this.keys.push(key);
    return super.readBytes(key);
  }
}

async function recordingBytes<T>(run: () => Promise<T>): Promise<{ value: T; keys: string[] }> {
  const keys: string[] = [];
  const original = LocalFileArtifactStore.prototype.readBytes;
  LocalFileArtifactStore.prototype.readBytes = async function (this: LocalFileArtifactStore, key: string) {
    keys.push(key);
    return original.call(this, key);
  };
  try {
    return { value: await run(), keys };
  } finally {
    LocalFileArtifactStore.prototype.readBytes = original;
  }
}

test("the map's routes fetch only the authority families they read, never Ask's outcomes or the comment-access artifact", async () => {
  const { dir, manifest } = await publishEdge("c21-families");
  const store = new RecordingStore(dir);
  const bundle = await ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES);
  assert.equal(bundle.registryRuntime?.versionId, "c21-families:registry");
  assert.equal(bundle.federalDirectory?.versionId, "c21-families:federal");
  assert.equal(bundle.meetingOutcomes, undefined, "the recorded outcomes are Ask's, not the map's");
  assert.equal(bundle.commentAccess, undefined, "the meetings route takes comment access from the manifest");
  assert.deepEqual(store.keys.filter((key) => [manifest.authorityArtifacts?.["meeting-outcomes"]?.key, manifest.authorityArtifacts?.["comment-access"]?.key].includes(key)), [], "fetched and parsed for nothing");
  const everything = await ensureReaderAuthorityEdge(manifest, store, undefined, ["az"]);
  assert.equal(everything.meetingOutcomes?.versionId, "c21-families:outcomes", "omitted, every family is fetched, as Ask needs");
  assert.equal(everything.commentAccess?.versionId, "c21-families:comment-access");
});

test("concurrent reads on one instance share one fetch and one parse of an authority family", async () => {
  const { dir, manifest } = await publishEdge("c21-shared");
  const store = new RecordingStore(dir);
  const [first, second] = await Promise.all([
    ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES),
    ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES),
  ]);
  assert.equal(store.keys.filter((key) => key === manifest.authorityArtifacts?.["registry-runtime"]?.key).length, 1, "each concurrent read fetched the registry");
  assert.equal(first.registryRuntime?.value, second.registryRuntime?.value, "one parsed value serves both");
});

test("the Blobs manifest is held fifteen seconds per instance, shared in flight, and an absent one is never held", async () => {
  let reads = 0;
  let answer: ReaderManifest | null = { formatVersion: 1, sequence: 7 } as unknown as ReaderManifest;
  const blobs = {
    kind: "netlify-blobs",
    readManifest: async () => {
      reads += 1;
      return answer ? { manifest: answer, etag: "e" } : null;
    },
  } as unknown as ReaderArtifactStore;
  let clock = 1_000_000_000;
  const now = () => clock;
  const [a, b] = await Promise.all([readReaderManifest(blobs, now), readReaderManifest(blobs, now)]);
  assert.equal(reads, 1, "two requests at once share the read");
  assert.equal(a?.sequence, 7);
  assert.equal(a, b);
  clock += READER_MANIFEST_MEMO_MS - 1;
  await readReaderManifest(blobs, now);
  assert.equal(reads, 1, "a warm request inside the window skips the Blobs round trip");
  clock += 2;
  answer = { formatVersion: 1, sequence: 8 } as unknown as ReaderManifest;
  assert.equal((await readReaderManifest(blobs, now))?.sequence, 8, "past the window the pointer is read again");
  assert.equal(reads, 2);
  answer = null;
  clock += READER_MANIFEST_MEMO_MS;
  assert.equal(await readReaderManifest(blobs, now), null);
  assert.equal(await readReaderManifest(blobs, now), null);
  assert.equal(reads, 4, "an absent manifest is asked for again on the next request");
  assert.equal(READER_MANIFEST_MEMO_MS <= 30_000, true, "the brief's bound");
});

test("an edge value is validated once per object and version, and an invalid one fails every prime", () => {
  const value = registryTransferImport().projection.payload;
  const before = edgeValidationsRun();
  primeRegistryRuntimeFromValue(value, "c21-validate:1");
  primeRegistryRuntimeFromValue(value, "c21-validate:1");
  primeRegistryRuntimeFromValue(value, "c21-validate:1");
  assert.equal(edgeValidationsRun() - before, 1, "the same immutable object at the same version was validated again");
  primeRegistryRuntimeFromValue(value, "c21-validate:2");
  primeRegistryRuntimeFromValue(structuredClone(value), "c21-validate:2");
  assert.equal(edgeValidationsRun() - before, 3, "a new version, or another object claiming one, is validated on its own");
  const broken = { ...value, formatVersion: 2 as unknown as 1 };
  assert.throws(() => primeRegistryRuntimeFromValue(broken, "c21-validate:broken"), /FORMAT_VERSION_UNSUPPORTED/);
  assert.throws(() => primeRegistryRuntimeFromValue(broken, "c21-validate:broken"), /FORMAT_VERSION_UNSUPPORTED/, "a failed validation is never remembered as a pass");
});

const TUCSON = "lat=32.21696&lng=-110.971&zip=85701";

test("a whole /api/meetings answer from the edge is held by the CDN, keyed on every query parameter, and says where its time went", async () => {
  const { dir, manifest } = await publishEdge("c21-route");
  process.env.WTP_READER_EDGE_DIR = dir;
  const { value: response, keys } = await recordingBytes(() => meetingsGET(new Request(`https://wtp.test/api/meetings?${TUCSON}`)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=300, stale-while-revalidate=3600");
  assert.equal(response.headers.get("netlify-cache-tag"), READER_MANIFEST_CACHE_TAG, "the tag the runner purges on every publication");
  assert.equal(READER_MANIFEST_CACHE_TAG, "reader-manifest");
  assert.equal(response.headers.get("netlify-vary"), "query", "every query parameter is in the CDN key");
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate", "the browser revalidates, so a purge reaches it");
  const timing = response.headers.get("server-timing") ?? "";
  for (const stage of ["manifest", "authority", "divisions", "widen", "meetings", "search", "coverage", "total"]) {
    assert.match(timing, new RegExp(`(?:^|, )${stage};dur=\\d+`), `${stage} is not timed: ${timing}`);
  }
  assert.equal(registryRuntimeReadState().metadata.versionId, "c21-route:registry", "the registry was not read from the edge the route entered");
  assert.deepEqual(keys.filter((key) => [manifest.authorityArtifacts?.["meeting-outcomes"]?.key, manifest.authorityArtifacts?.["comment-access"]?.key].includes(key)), [], "the route fetched families it never reads");
  const body = await response.json();
  assert.ok(Array.isArray(body.governingOcdIds) && body.governingOcdIds.length > 0);
  assert.ok(body.coverage && body.coverage.bodies.length > 0);
});

test("the held answer carries nothing about the visitor: other cookies, agents and addresses get the same bytes", async () => {
  const ask = (headers: Record<string, string>) => meetingsGET(new Request(`https://wtp.test/api/meetings?${TUCSON}`, { headers }));
  const plain = await ask({});
  const other = await ask({ cookie: "wtp_session=abc; ab=1", "user-agent": "other-browser", "x-forwarded-for": "203.0.113.9", "x-wtp-synthetic-run": "reader-cold-path-test", "accept-language": "es" });
  assert.equal(plain.headers.get("netlify-cdn-cache-control"), other.headers.get("netlify-cdn-cache-control"));
  assert.equal(await plain.text(), await other.text());
  for (const response of [plain, other]) {
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("vary"), null, "no per-visitor Vary");
  }
});

test("a refusal, and an answer the edge did not serve whole, are never held", async () => {
  const refused = await meetingsGET(new Request(`https://wtp.test/api/meetings?${TUCSON}&debug=1`));
  assert.equal(refused.status, 400);
  assert.equal(refused.headers.get("netlify-cdn-cache-control"), null);
  assert.doesNotMatch(refused.headers.get("cache-control") ?? "", /public/);

  // No edge: the meetings come from the database fallback, which is not the
  // publication the runner's purge replaces.
  delete process.env.WTP_READER_EDGE_DIR;
  const fallback = await meetingsGET(new Request(`https://wtp.test/api/meetings?${TUCSON}`));
  assert.equal(fallback.headers.get("netlify-cdn-cache-control"), null, `status ${fallback.status} was held`);
  assert.equal(fallback.headers.get("cache-control"), "no-store");
});

test("/api/representation reads the registry from the edge it entered, and the CDN holds its answer", async () => {
  const { dir } = await publishEdge("c21-representation");
  process.env.WTP_READER_EDGE_DIR = dir;
  const division = ["ocd-division", "country:us", "state:az", "place:tucson"];
  const response = await representationGET(
    new Request(`https://wtp.test/api/representation/${division.join("/")}`),
    { params: Promise.resolve({ division }) },
  );
  assert.equal(response.status, 200);
  assert.equal(registryRuntimeReadState().metadata.versionId, "c21-representation:registry", "the registry was read from the database, not the edge");
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=300, stale-while-revalidate=3600");
  assert.equal(response.headers.get("netlify-cache-tag"), READER_MANIFEST_CACHE_TAG);
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.match(response.headers.get("server-timing") ?? "", /(?:^|, )authority;dur=\d+/);
  const body = await response.json();
  assert.equal(body.ocdId, division.join("/"));
});

test("a warm call primes national reference artifacts without scanning state meetings",async () => {
  for (const legislators of [false,true]) {
    const { dir,manifest } = await publishEdge(`scoped-warm-${legislators}`,{ legislators });
    process.env.WTP_READER_EDGE_DIR = dir;
    assert.deepEqual(manifest.scopes,[]);
    const primed = await primeReaderEdge();
    assert.equal(primed.manifest,true);
    assert.equal(primed.meetings,false);
    assert.deepEqual({ places: primed.places,placesRefused: primed.placesRefused },{ places: 0,placesRefused: 0 });
  }
});
