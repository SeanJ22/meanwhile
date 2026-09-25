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
import type { ReaderManifest } from "../lib/meetings/edge-artifacts.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { edgeValidationsRun } from "../lib/civic-data/validated-once.ts";
import type { CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { importReachability } from "../lib/holdings/reader-census.ts";
import { federalDirectoryFirstSeed } from "../lib/officials/federal-directory-read-model.ts";
import { outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted } from "../lib/outcomes/store.ts";
import { currentCommentAccess } from "../lib/registry/comment-access.ts";
import { primeRegistryRuntimeFromValue, registryRuntimeFirstSeed, registryRuntimeReadState } from "../lib/registry/runtime-read-model.ts";
import { currentEverydayRoutingProjection } from "../lib/routing/everyday-data-plane.ts";
import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from "../lib/state-rollcalls/authority.ts";
import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import { GET as representationGET } from "../app/api/representation/[...division]/route.ts";
import { primeReaderEdge } from "../app/api/warm/route.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

/**
 * **A COLD READER INSTANCE ANSWERS THE MAP WITHOUT PAYING FOR WHAT IT DOES NOT
 * READ, AND THE CDN HOLDS A WHOLE ANSWER.** (C21, 2026-09-25.)
 *
 * Production, 2026-09-25: from a fresh instance `/api/meetings?zip=85701` took
 * a median 3.8 s (five of ten over the 3 s bar); on pool instances after the
 * pinger, a median ~1.0 s and up to 2.4 s. These tests hold the pieces of the
 * repair against a real local reader edge (`WTP_READER_EDGE_DIR`), the way
 * tests/reader-edge-context.test.ts proves where each read comes from.
 */

delete process.env.ANTHROPIC_API_KEY;
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
await installRegistryRuntimeFirstSeeds();

const dirs: string[] = [];
const previousEdgeDir = process.env.WTP_READER_EDGE_DIR;
after(() => {
  if (previousEdgeDir === undefined) delete process.env.WTP_READER_EDGE_DIR;
  else process.env.WTP_READER_EDGE_DIR = previousEdgeDir;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

await refreshOutcomeSnapshotFromPromoted();
const outcomes = outcomeProjectionReadState();
assert.ok(outcomes.kind === "BOOTSTRAP" || outcomes.kind === "PROMOTED", "the outcome fixture is readable");
const commentAccessProjection: CuratedReaderProjection = {
  kind: "comment-access",
  records: currentCommentAccess().map((value) => ({ id: `comment-access:${value.bodyId}`, ...value }) as unknown as CuratedReaderProjection["records"][number]),
};
/** An edge state-legislators value for every official target, with nobody on it: enough for coverage to settle from the edge. */
const stateLegislators = Object.fromEntries(OFFICIAL_STATE_LEGISLATOR_TARGETS.map((target) => [target.jurisdiction, {
  formatVersion: 1,
  sourceId: target.sourceId,
  jurisdiction: target.jurisdiction,
  term: "test",
  generatedAt: "2026-09-25T00:00:00.000Z",
  roster: { scope: target.state.toLowerCase(), generatedAt: "2026-09-25", officeholders: [], divisions: [], unmatched: [] },
}]));

/** A reader edge published from the bundled first seeds into a fresh directory, as the runner publishes production's. */
async function publishEdge(tag: string, options: { readonly legislators?: boolean } = {}): Promise<{ dir: string; manifest: ReaderManifest }> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-c21-edge-"));
  dirs.push(dir);
  const snapshot = readSnapshot();
  assert.ok(snapshot, "the bundled meetings snapshot publishes the edge's meeting scopes");
  const authority: PublishAuthority = {
    "registry-runtime": { value: registryRuntimeFirstSeed().value, versionId: `${tag}:registry` },
    "federal-directory": { value: federalDirectoryFirstSeed().value, versionId: `${tag}:federal` },
    "meeting-outcomes": { value: (outcomes as { value: unknown }).value, versionId: `${tag}:outcomes` },
    "comment-access": { value: commentAccessProjection, versionId: `${tag}:comment-access` },
    ...(options.legislators ? { "state-legislators": { value: stateLegislators, versionId: `${tag}:legislators` } } : {}),
  };
  const store = new LocalFileArtifactStore(dir);
  const result = await publishReaderEdgeArtifacts(snapshot, {
    sourceThrough: snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    promotedThrough: snapshot.generatedAt,
  }, {
    store,
    now: new Date().toISOString(),
    extras: { commentAccess: currentCommentAccess(), everydayRouting: currentEverydayRoutingProjection() },
    authority,
    registrations: {},
  });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  return { dir, manifest: (await store.readManifest())!.manifest };
}

/** A local store that records every artifact key it is asked for. */
class RecordingStore extends LocalFileArtifactStore {
  readonly keys: string[] = [];
  override async readBytes(key: string): Promise<Uint8Array | null> {
    this.keys.push(key);
    return super.readBytes(key);
  }
}

/** Records every compressed artifact any local store reads while `run` runs. */
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

test("C21 · the map's routes fetch only the authority families they read, never Ask's outcomes or the comment-access artifact", async () => {
  const { dir, manifest } = await publishEdge("c21-families");
  const store = new RecordingStore(dir);
  const bundle = await ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES);
  assert.equal(bundle.registryRuntime?.versionId, "c21-families:registry");
  assert.equal(bundle.federalDirectory?.versionId, "c21-families:federal");
  assert.equal(bundle.meetingOutcomes, undefined, "the recorded outcomes are Ask's, not the map's");
  assert.equal(bundle.commentAccess, undefined, "the meetings route takes comment access from the manifest");
  assert.deepEqual(store.keys.filter((key) => /meeting-outcomes|comment-access/.test(key)), [], "fetched and parsed for nothing");
  const everything = await ensureReaderAuthorityEdge(manifest, store);
  assert.equal(everything.meetingOutcomes?.versionId, "c21-families:outcomes", "omitted, every family is fetched, as Ask needs");
  assert.equal(everything.commentAccess?.versionId, "c21-families:comment-access");
});

test("C21 · concurrent reads on one instance share one fetch and one parse of an authority family", async () => {
  const { dir, manifest } = await publishEdge("c21-shared");
  const store = new RecordingStore(dir);
  const [first, second] = await Promise.all([
    ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES),
    ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES),
  ]);
  assert.equal(store.keys.filter((key) => key.includes("registry-runtime")).length, 1, "each concurrent read fetched the registry");
  assert.equal(first.registryRuntime?.value, second.registryRuntime?.value, "one parsed value serves both");
});

test("C21 · the Blobs manifest is held fifteen seconds per instance, shared in flight, and an absent one is never held", async () => {
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

test("C21 · an edge value is validated once per object and version, and an invalid one fails every prime", () => {
  const value = registryRuntimeFirstSeed().value;
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

test("C21 · a whole /api/meetings answer from the edge is held by the CDN, keyed on every query parameter, and says where its time went", async () => {
  const { dir } = await publishEdge("c21-route");
  process.env.WTP_READER_EDGE_DIR = dir;
  const { value: response, keys } = await recordingBytes(() => meetingsGET(new Request(`https://wtp.test/api/meetings?${TUCSON}`)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=300, stale-while-revalidate=3600");
  assert.equal(response.headers.get("netlify-cache-tag"), READER_MANIFEST_CACHE_TAG, "the tag the runner purges on every publication");
  assert.equal(READER_MANIFEST_CACHE_TAG, "reader-manifest");
  assert.equal(response.headers.get("netlify-vary"), "query", "every query parameter is in the CDN key (D40)");
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate", "the browser revalidates, so a purge reaches it");
  const timing = response.headers.get("server-timing") ?? "";
  for (const stage of ["manifest", "authority", "divisions", "widen", "meetings", "search", "coverage", "total"]) {
    assert.match(timing, new RegExp(`(?:^|, )${stage};dur=\\d+`), `${stage} is not timed: ${timing}`);
  }
  assert.equal(registryRuntimeReadState().metadata.versionId, "c21-route:registry", "the registry was not read from the edge the route entered");
  assert.deepEqual(keys.filter((key) => /meeting-outcomes|comment-access/.test(key)), [], "the route fetched families it never reads");
  const body = await response.json();
  assert.ok(Array.isArray(body.governingOcdIds) && body.governingOcdIds.length > 0);
  assert.ok(body.coverage && body.coverage.bodies.length > 0);
});

test("C21 · the held answer carries nothing about the visitor: other cookies, agents and addresses get the same bytes", async () => {
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

test("C21 · a refusal, and an answer the edge did not serve whole, are never held", async () => {
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

test("C21 · the route loads the ZIP table on demand, never as a 961 KB static import", () => {
  const reach = importReachability(process.cwd(), "app/api/meetings/route.ts", "lib/geo/zcta.ts");
  assert.equal(reach.reached, false, `the route reaches the static table again: ${reach.path.join(" -> ")}`);
  assert.equal(importReachability(process.cwd(), "app/api/meetings/route.ts", "lib/geo/zcta-table.ts").reached, true);
});

test("C21 · /api/representation reads the registry from the edge it entered, and the CDN holds its answer", async () => {
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

test("C21 · a warm call resolves one place per published state from the edge, and refuses what the edge does not carry", async () => {
  const withoutLegislators = await publishEdge("c21-warm-partial");
  process.env.WTP_READER_EDGE_DIR = withoutLegislators.dir;
  const states = withoutLegislators.manifest.scopes.map((scope) => scope.scope).filter((scope) => scope !== "us");
  assert.ok(states.length >= 3, `the fixture publishes meetings for several states: ${states.join(", ")}`);
  const partial = await primeReaderEdge();
  assert.equal(partial.manifest, true);
  assert.equal(partial.meetings, true);
  assert.equal(registryRuntimeReadState().metadata.versionId, "c21-warm-partial:registry", "the warm call read the registry from the database");
  assert.equal(partial.places, 0, "a place whose legislators are not on the edge must not count as warmed");
  assert.equal(partial.placesRefused, states.length, "every state-legislative read was refused instead of sent to the database");

  const whole = await publishEdge("c21-warm-whole", { legislators: true });
  process.env.WTP_READER_EDGE_DIR = whole.dir;
  const primed = await primeReaderEdge();
  assert.deepEqual({ places: primed.places, placesRefused: primed.placesRefused }, { places: states.length, placesRefused: 0 });
  assert.equal(registryRuntimeReadState().metadata.versionId, "c21-warm-whole:registry");
});
