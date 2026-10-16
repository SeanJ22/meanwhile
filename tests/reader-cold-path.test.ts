import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { after, test } from "./helpers/playbooks.ts";

import {
  ensureReaderAuthorityEdge,
  publishReaderEdgeArtifacts,
  readReaderManifest,
  READER_MANIFEST_CACHE_TAG,
  READER_MANIFEST_MEMO_MS,
  READER_MAP_AUTHORITY_FAMILIES,
  readReaderEdgeMeetings,
  servedWholeFromReaderEdge,
  writeFactBucket,
  writeFactRecord,
  type PublishAuthority,
} from "../lib/meetings/edge-serving.ts";

import { stateOfOcdId, type ReaderManifest, type ReaderAuthorityManifest } from "../lib/meetings/edge-artifacts.ts";

import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";

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
import type { BodyFacts } from "../lib/facts/registry-overlay.ts";
import type { RecordIndex } from "../lib/meetings/authority-records.ts";

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

const SITTING = recordedMeetingsSnapshot().meetings.find(row => row.bodyId && stateOfOcdId(row.ocdId) === "az")!;
const SITTING_TITLE = { meetingId: SITTING.id, field: "title" as const, value: "Title as its saved page states it",
  source: { sourceUrl: "https://example.gov/calendar", sourceOrg: "example.gov", collectedAt: SITTING.startsAt, verifiedAt: SITTING.startsAt, quote: "Title as its saved page states it" } };

async function factRecords(store: LocalFileArtifactStore, registry: ReturnType<typeof registryTransferImport>["projection"]["payload"]): Promise<RecordIndex> {
  const ids = [...new Set([...(registry.bodyRosters ?? []).map(roster => roster.bodyId), ...COMMENT_ACCESS.map(row => row.bodyId), SITTING.bodyId!])].sort();
  const records = await Promise.all(ids.map(async (id, n) => {
    const roster = registry.bodyRosters?.find(row => row.bodyId === id) ?? null;
    const memberIds = new Set(roster?.members.map(member => member.id));
    const body: BodyFacts = { id, division: id.split("#")[0]!, fields: {}, roster, comment: COMMENT_ACCESS.find(row => row.bodyId === id) ?? null,
      sittings: id === SITTING.bodyId ? [SITTING_TITLE] : [], dispositions: (registry.rosterReaderDispositions ?? []).filter(row => memberIds.has(row.sourceId)) };
    return { path: ["bodies", n], ...await writeFactRecord(store, body), tags: [id, body.division, ...memberIds] };
  }));
  return { kind: "READER_RECORDS", base: { bodies: [] }, records };
}

async function publishEdge(tag: string, options: { readonly legislators?: boolean; readonly routing?: ReturnType<typeof currentEverydayRoutingProjection> | null } = {}): Promise<{ dir: string; manifest: ReaderAuthorityManifest; meetings: ReaderManifest }> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-c21-edge-"));
  dirs.push(dir);
  const snapshot = multiStateSnapshot();
  assert.ok(snapshot.meetings.length > 0, "the recorded meetings publish the edge's meeting scopes");
  const registry = registryTransferImport().projection.payload;
  const authority: PublishAuthority = {
    "registry-runtime": { value: registry, versionId: `${tag}:registry` },
    "federal-directory": { value: syntheticFederalDirectory(), versionId: `${tag}:federal` },
    "meeting-outcomes": { value: getOutcomeSnapshot(), versionId: `${tag}:outcomes` },
    "everyday-routing": { value: { projection: options.routing === undefined ? currentEverydayRoutingProjection() : options.routing }, versionId: `${tag}:everyday-routing` },
  };
  const store = new LocalFileArtifactStore(dir);
  const result = await publishReaderEdgeArtifacts(snapshot, {
    sourceThrough: snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    promotedThrough: snapshot.generatedAt,
  }, {
    store,
    now: new Date().toISOString(),
    stateFacts: { AZ: { versionId: `${tag}:facts:AZ`, value: { buckets: [await writeFactBucket(store, "AZ", 0, `${tag}:facts:AZ`, await factRecords(store, registry), new Date().toISOString())] } } },
    authority,
    ...(options.legislators ? { stateLegislators: Object.fromEntries(Object.entries(stateLegislators).map(([scope, value]) => [scope, { value, versionId: `${tag}:legislators:${scope}` }])) } : {}),
    registrations: {},
  });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  return { dir, manifest: (await store.readAuthorityManifest())!.manifest, meetings: (await store.readManifest())!.manifest };
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

test("the map's routes fetch only the authority families they read, never Ask's outcomes; comment rules come with the states' facts", async () => {
  const { dir, manifest } = await publishEdge("c21-families");
  const store = new RecordingStore(dir);
  const bundle = await ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES);
  assert.match(bundle.registryRuntime?.versionId ?? "", /^c21-families:registry\+[0-9a-f]{16}$/, "the partition's version and its states' facts");
  assert.equal(bundle.federalDirectory?.versionId, "c21-families:federal");
  assert.equal(bundle.meetingOutcomes, undefined, "the recorded outcomes are Ask's, not the map's");
  const byId = (records: readonly { readonly id: string }[] = []) => [...records].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(bundle.commentAccess?.value.records), byId(commentAccessProjection.records), "the meetings route takes comment access from the states' facts");
  assert.deepEqual(store.keys.filter((key) => key === manifest.authorityArtifacts?.["meeting-outcomes"]?.key), [], "fetched and parsed for nothing");
  const everything = await ensureReaderAuthorityEdge(manifest, store);
  assert.equal(everything.meetingOutcomes?.versionId, "c21-families:outcomes", "omitted, every family is fetched, as Ask needs");
  assert.equal(everything.commentAccess?.versionId, bundle.commentAccess?.versionId);
});

test("each served sitting carries its body's live facts from that body's record", async () => {
  const { dir, meetings } = await publishEdge("c21-sittings");
  const read = await readReaderEdgeMeetings({ store: new LocalFileArtifactStore(dir), manifest: meetings, ocdIds: [SITTING.ocdId!], window: "HELD", now: SITTING.startsAt });
  assert.equal(read.kind, "PROMOTED");
  const served = read.value.meetings.find(row => row.id === SITTING.id);
  assert.deepEqual([served?.title, served?.fieldSources?.title?.sourceUrl], [SITTING_TITLE.value, SITTING_TITLE.source.sourceUrl]);
  assert.ok(servedWholeFromReaderEdge(read));
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
  assert.match(registryRuntimeReadState().metadata.versionId ?? "", /^c21-route:registry\+/, "the registry was not read from the edge the route entered");
  assert.equal(keys.includes(manifest.authorityArtifacts!["meeting-outcomes"]!.key), false, "the route does not read recorded outcomes");
  assert.ok(keys.includes(manifest.stateFacts!.AZ!.key), "comment rules are read from selected body facts");
  assert.ok(keys.includes(manifest.authorityArtifacts!["everyday-routing"]!.key), "routing is read from its explicit artifact");
  const routingIndex = JSON.parse(gunzipSync((await new LocalFileArtifactStore(dir).readBytes(manifest.authorityArtifacts!["everyday-routing"]!.key))!).toString("utf8")).value as RecordIndex;
  const otherZips = routingIndex.records.filter(row => row.tags.some(tag => /^zip:\d{5}$/.test(tag) && tag !== "zip:85701"));
  assert.ok(otherZips.length > 0);
  assert.ok(otherZips.every(row => !keys.includes(row.key)), "another ZIP's routing bytes are never fetched");
  const body = await response.json();
  assert.ok(Array.isArray(body.governingOcdIds) && body.governingOcdIds.length > 0);
  assert.ok(body.coverage && body.coverage.bodies.length > 0);
  assert.deepEqual(body.commentAccess, COMMENT_ACCESS.filter(row => row.ocdId && body.governingOcdIds.includes(row.ocdId)).sort((a, b) => a.bodyId.localeCompare(b.bodyId)));
  assert.equal(body.commentAccessDataState, "PROMOTED");
  assert.deepEqual(body.everydayRouting, { ...currentEverydayRoutingProjection(), records: currentEverydayRoutingProjection().records.filter(row => row.zip === "85701") });
  assert.equal(body.everydayRoutingDataState, "PROMOTED");
  assert.equal("commentAccess" in manifest, false);
  assert.equal("everydayRouting" in manifest, false);
});

test("missing body facts leave meetings and routing readable without holding the partial response", async () => {
  const { dir, manifest } = await publishEdge("c21-comment-unavailable");
  process.env.WTP_READER_EDGE_DIR = dir;
  rmSync(join(dir, manifest.stateFacts!.AZ!.key));
  const response = await meetingsGET(new Request(`https://wtp.test/api/meetings?${TUCSON}`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.meetings.length > 0);
  assert.deepEqual(body.commentAccess, []);
  assert.equal(body.commentAccessDataState, "STORE_UNREACHABLE");
  assert.deepEqual(body.everydayRouting, { ...currentEverydayRoutingProjection(), records: currentEverydayRoutingProjection().records.filter(row => row.zip === "85701") });
  assert.equal(body.everydayRoutingDataState, "PROMOTED");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("netlify-cdn-cache-control"), null);
});

test("a published null routing artifact remains not recorded without reopening another source", async () => {
  const { dir } = await publishEdge("c21-routing-absent", { routing: null });
  process.env.WTP_READER_EDGE_DIR = dir;
  const response = await meetingsGET(new Request(`https://wtp.test/api/meetings?${TUCSON}`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.everydayRouting, null);
  assert.equal(body.everydayRoutingDataState, "NOT_RECORDED");
  assert.deepEqual(body.commentAccess, COMMENT_ACCESS.filter(row => row.ocdId && body.governingOcdIds.includes(row.ocdId)).sort((a, b) => a.bodyId.localeCompare(b.bodyId)));
  assert.equal(body.commentAccessDataState, "PROMOTED");
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
  assert.match(registryRuntimeReadState().metadata.versionId ?? "", /^c21-representation:registry\+/, "the registry was read from the database, not the edge");
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=300, stale-while-revalidate=3600");
  assert.equal(response.headers.get("netlify-cache-tag"), READER_MANIFEST_CACHE_TAG);
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.match(response.headers.get("server-timing") ?? "", /(?:^|, )authority;dur=\d+/);
  const body = await response.json();
  assert.equal(body.ocdId, division.join("/"));
});

test("a warm call loads meetings and Ask sources without the country registry or any state's payload", async () => {
  const whole = await publishEdge("c21-warm-lazy", { legislators: true });
  process.env.WTP_READER_EDGE_DIR = whole.dir;
  const opened: string[] = [];
  const original = LocalFileArtifactStore.prototype.readBytes;
  LocalFileArtifactStore.prototype.readBytes = async function (key) {
    opened.push(key);
    return original.call(this, key);
  };
  try {
    const primed = await primeReaderEdge();
    assert.equal(primed.manifest, true);
    assert.equal(primed.meetings, true);
    assert.ok(primed.ask && primed.ask.sources > 0, "useful Ask sources still warm from the edge");
    assert.equal(opened.includes(whole.manifest.authorityArtifacts!["registry-runtime"]!.key), false);
    for (const ref of Object.values(whole.manifest.stateLegislators ?? {})) assert.equal(opened.includes(ref.key), false);
    assert.equal(Object.hasOwn(primed, "places"), false, "the retired country sweep has no success counter");
  } finally {
    LocalFileArtifactStore.prototype.readBytes = original;
  }
});
