import assert from "node:assert/strict";

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { after, test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import type { Officeholder } from "../lib/officials/types.ts";

import {
  authorityPointerKey,
  ensureReaderAuthorityEdge,
  publishReaderMeetings,
  readReaderManifest,
  readServedPointer,
  READER_MANIFEST_CACHE_TAG,
  READER_MANIFEST_MEMO_MS,
  READER_MAP_AUTHORITY_FAMILIES,
  readReaderEdgeMeetings,
  servedWholeFromReaderEdge,
  stateFactsPointerKey,
  writeFactBucket,
  writeFactRecord,
  type PublishAuthorityValue,
} from "../lib/meetings/edge-serving.ts";
import { publishPointers } from "./helpers/edge-pointers.ts";
import type { GlobalAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";

import { stateOfOcdId, type ReaderManifest } from "../lib/meetings/edge-artifacts.ts";

import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";



import { getOutcomeSnapshot, outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted } from "../lib/outcomes/store.ts";

import type { CommentAccessProjection } from "../lib/registry/comment-access.ts";

import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

import { buildEverydayRoutingProjection } from "../lib/routing/everyday.ts";

import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from "../lib/state-rollcalls/authority.ts";

import { resolveZip } from "../lib/geo/zcta.ts";
import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import { GET as directoryGET } from "../app/api/directory/route.ts";

import { GET as representationGET } from "../app/api/representation/[...division]/route.ts";

import { GET as warmGET, KEEP_WARM_MARKER } from "../app/api/warm/route.ts";

import { installRegistryAuthority, registryTransferImport, stateFederalDirectoryArtifacts } from "./helpers/promoted-fixtures.ts";

import { installPimaOutcomes, recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { planMeetingBodies } from "../lib/meetings/body-publication.ts";
import { promoteRecorded, promoteRows, ownPartition } from "./helpers/reader-edge-meetings.ts";
import { row as partitionRow } from "./helpers/meeting-body-fixtures.ts";

import { COMMENT_ACCESS } from "./fixtures/comment-access.ts";
import type { BodyFacts } from "../lib/facts/registry-overlay.ts";
import type { RecordIndex } from "../lib/meetings/authority-records.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
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


const READ_AT = "2026-09-25T12:00:00.000Z";
const PUBLISHED_AT = "2026-09-25T13:00:00.000Z";
const countyDoor = (state: string, county: string) => MEETING_PARTITION_CONTRACTS.find((row) =>
  row.derivedFamily === null && row.ocdId === `ocd-division/country:us/state:${state}/county:${county}` && row.bodyId.endsWith("#governing"))!;

const recorded = recordedMeetingsSnapshot();
const SITTING = recorded.meetings.find(row => row.bodyId && ownPartition(row) !== null && stateOfOcdId(row.ocdId) === "az")!;
const SITTING_TITLE = { meetingId: SITTING.id, field: "title" as const, value: "Title as its saved page states it",
  source: { sourceUrl: "https://example.gov/calendar", sourceOrg: "example.gov", collectedAt: SITTING.startsAt, verifiedAt: SITTING.startsAt, quote: "Title as its saved page states it" } };

/** Arizona's recorded sittings, each promoted through the partition that owns it, and one county board in New Jersey and in New Hampshire. */
async function recordedMeetingsStore(): Promise<MemoryRoutineDataStore> {
  const store = new MemoryRoutineDataStore();
  await promoteRecorded(store, recorded.meetings, recorded.agendaDocuments, READ_AT);
  for (const [state, county] of [["nj", "morris"], ["nh", "merrimack"]] as const) {
    const door = countyDoor(state, county);
    await promoteRows(store, door, [partitionRow(door, "1", "2026-10-10T17:00:00.000Z", READ_AT)], [], READ_AT);
  }
  return store;
}

/** The fixture's rosters, comment rules and one sitting's title as one record per body, as the publisher writes them. */
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

interface PublishedKeys {
  readonly registry: Readonly<Record<string, string>>;
  readonly federal: Readonly<Record<string, string>>;
  readonly outcomes: string;
}

async function publishEdge(tag: string, options: { readonly legislators?: boolean } = {}): Promise<{ dir: string; manifest: ReaderManifest; keys: PublishedKeys }> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-c21-edge-"));
  dirs.push(dir);
  const store = new LocalFileArtifactStore(dir);
  const plan = await planMeetingBodies({ store: await recordedMeetingsStore(), artifacts: store, now: PUBLISHED_AT, served: undefined, registryVersion: () => null, registry: async () => null });
  assert.deepEqual(plan.stats.failed, []);
  assert.ok(Object.keys(plan.entries).length > 0, "the recorded meetings publish the edge's meeting indexes");
  const registry = registryTransferImport().projection.payload;
  const authority: Partial<Record<GlobalAuthorityFamily, PublishAuthorityValue>> = {
    "meeting-outcomes": { value: getOutcomeSnapshot(), versionId: `${tag}:outcomes` },
    "everyday-routing": { value: { projection: buildEverydayRoutingProjection() }, versionId: `${tag}:routing` },
  };
  await store.writeJsonPointer(stateFactsPointerKey("AZ"), { state: "AZ", versionId: `${tag}:facts:AZ`,
    buckets: [await writeFactBucket(store, "AZ", 0, `${tag}:facts:AZ`, await factRecords(store, registry), new Date().toISOString())] }, null);
  const result = await publishReaderMeetings({ store, now: new Date().toISOString(), meetingStates: plan.entries });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  const none = { value: null, versionId: "none" };
  await publishPointers(store, { authority,
    stateAuthorities: { "registry-runtime": stateRegistryArtifacts(`${tag}:registry`, ["AZ", "NH", "NJ"], registry), "federal-directory": stateFederalDirectoryArtifacts(`${tag}:federal`) },
    stateLegislators: options.legislators ? Object.fromEntries(Object.entries(stateLegislators).map(([scope, value]) => [scope, { value, versionId: `${tag}:legislators:${scope}` }])) : {},
    registrations: { az: none, nh: none, nj: none } });
  const key = async (family: Parameters<typeof authorityPointerKey>[0], place?: string) => (await readServedPointer(store, authorityPointerKey(family, place)))!.ref.key;
  const registryKeys = Object.fromEntries(await Promise.all(["AZ", "NH", "NJ"].map(async state => [state, await key("registry-runtime", state)] as const)));
  const federalKeys = Object.fromEntries(await Promise.all(["AZ"].map(async state => [state, await key("federal-directory", state)] as const)));
  const outcomes = (await Promise.all(["US", "AZ"].map(place => readServedPointer(store, authorityPointerKey("meeting-outcomes", place))))).find(Boolean)!.ref.key;
  return { dir, manifest: (await store.readManifest())!.manifest, keys: { registry: registryKeys, federal: federalKeys, outcomes } };
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

test("directory requests load only their legislator's jurisdiction and serve sourced offices without provider SQL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-directory-edge-"));
  dirs.push(dir);
  const at = "2026-10-01T00:00:00Z";
  const sourceUrl = "https://example.gov/legislature/offices";
  const personId = "plural:00000000-0000-4000-8000-000000000021";
  const person: Officeholder = {
    id: "az-legislature:9001", personId, name: "Arizona Example", officeTitle: "State Senator", level: "STATE",
    termStart: "", termEnd: "", birthDate: null, partyLabel: null, websiteUrl: null, contactFormUrl: null,
    phone: null, email: null, campaignUrl: null, photo: null, state: "AZ", chamber: "upper",
    provenance: { sourceUrl, sourceOrg: "Arizona Legislature", collectedAt: at, verifiedAt: at },
    offices: [{ name: "district", address: "100 Main St, Tucson, AZ 85701", email: "district@example.gov", sourceUrl, collectedAt: at }],
  };
  const store = new LocalFileArtifactStore(dir);
  await publishPointers(store, {
    stateLegislators: {
      "US-AZ": { versionId: "directory:AZ", value: { ...stateLegislators["US-AZ"],
        roster: { scope: "US-AZ", generatedAt: at, officeholders: [person], divisions: [], unmatched: [] } } },
      "US-NH": { versionId: "directory:NH", value: stateLegislators["US-NH"] },
    },
  });
  const legislatorKey = async (scope: string) => (await readServedPointer(store, authorityPointerKey("state-legislators", scope)))!.ref.key;
  const previousDirectory = process.env.WTP_READER_EDGE_DIR;
  const previousDatabase = process.env.DATABASE_URL;
  const previousFetch = neonConfig.fetchFunction;
  let providerQueries = 0;
  process.env.WTP_READER_EDGE_DIR = dir;
  process.env.DATABASE_URL = "postgresql://test:test@ep-directory-test.example.invalid/none?sslmode=require";
  neonConfig.fetchFunction = async () => { providerQueries += 1; throw new Error("Unexpected provider SQL"); };
  try {
    const read = await recordingBytes(async () => {
      for (const member of [person.id, personId]) {
        const response = await directoryGET(new Request(`https://meanwhile.example/api/directory?member=${encodeURIComponent(member)}&state=AZ`));
        assert.equal(response.status, 200);
        const directory = await response.json();
        assert.deepEqual(directory.districtOffices, [{ address: "100 Main St", city: "Tucson", state: "AZ", zip: "85701",
          email: "district@example.gov", phone: null, lat: null, lng: null }]);
        assert.equal(directory.officeDetails.length, 1);
        assert.equal(directory.officeDetails[0].sourceUrl, sourceUrl);
        assert.equal(directory.officeDetails[0].collectedAt, at);
      }
    });
    assert.equal(providerQueries, 0);
    assert.ok(read.keys.includes(await legislatorKey("US-AZ")));
    assert.equal(read.keys.includes(await legislatorKey("US-NH")), false);
  } finally {
    neonConfig.fetchFunction = previousFetch;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousDirectory === undefined) delete process.env.WTP_READER_EDGE_DIR;
    else process.env.WTP_READER_EDGE_DIR = previousDirectory;
  }
});

test("the map's routes fetch only the authority families they read, never Ask's outcomes; comment rules come with the states' facts", async () => {
  const { dir, manifest, keys: published } = await publishEdge("c21-families");
  const store = new RecordingStore(dir);
  const bundle = (await ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES))!;
  assert.equal(store.keys.includes(published.registry.AZ), false, "a manifest load leaves state payloads lazy");
  const registry = await withReaderAuthorityEdge(bundle, () => readRegistryRuntimeProjection(["AZ"]));
  assert.equal(registry.metadata.versionId, "c21-families:registry:AZ");
  assert.equal(store.keys.includes(published.registry.NH), false);
  assert.equal(store.keys.includes(published.federal.AZ), false, "each place's members of Congress also load only when asked");
  assert.equal(bundle.meetingOutcomes, undefined, "the recorded outcomes are Ask's, not the map's");
  const byId = (records: readonly { readonly id: string }[] = []) => [...records].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(bundle.commentAccess?.value.records), byId(commentAccessProjection.records), "the meetings route takes comment access from the states' facts");
  assert.deepEqual(store.keys.filter((key) => key === published.outcomes), [], "fetched and parsed for nothing");
  const everything = (await ensureReaderAuthorityEdge(manifest, store))!;
  assert.equal(everything.meetingOutcomes?.versionId, "c21-families:outcomes", "omitted, every family is fetched, as Ask needs");
  await withReaderAuthorityEdge(everything, () => readRegistryRuntimeProjection(["AZ"]));
  assert.equal(everything.commentAccess?.versionId, bundle.commentAccess?.versionId);
});

test("each served sitting carries its body's live facts from that body's record", async () => {
  const { dir, manifest } = await publishEdge("c21-sittings");
  const read = await readReaderEdgeMeetings({ store: new LocalFileArtifactStore(dir), manifest, ocdIds: [SITTING.ocdId!], window: "HELD", now: SITTING.startsAt });
  assert.equal(read.kind, "PROMOTED");
  const served = read.value.meetings.find(row => row.id === SITTING.id);
  assert.deepEqual([served?.title, served?.fieldSources?.title?.sourceUrl], [SITTING_TITLE.value, SITTING_TITLE.source.sourceUrl]);
  assert.ok(servedWholeFromReaderEdge(read));
});

test("concurrent reads share one state artifact inside a request without retaining it across requests", async () => {
  const { dir, manifest, keys: published } = await publishEdge("c21-shared");
  const store = new RecordingStore(dir);
  const first = await ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES);
  const values = await withReaderAuthorityEdge(first, () => Promise.all([readRegistryRuntimeProjection(["AZ"]), readRegistryRuntimeProjection(["AZ"])]));
  assert.equal(store.keys.filter(key => key === published.registry.AZ).length, 1);
  assert.equal(values[0].kind, "PROMOTED");
  assert.equal(values[0], values[1]);
  const second = await ensureReaderAuthorityEdge(manifest, store, READER_MAP_AUTHORITY_FAMILIES);
  const independent = await withReaderAuthorityEdge(second, () => readRegistryRuntimeProjection(["AZ"]));
  assert.notEqual(independent.value, values[0].value);
  assert.equal(store.keys.filter(key => key === published.registry.AZ).length, 2);
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

test("corrupt state artifact bytes are refused before a reader can use their payload", async t => {
  const { dir, manifest, keys: published } = await publishEdge("c21-integrity");
  const ref = { key: published.registry.AZ };
  const bytes = readFileSync(join(dir, ref.key)); bytes[bytes.length - 1] ^= 1; writeFileSync(join(dir, ref.key), bytes);
  const warnings: unknown[][] = []; t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
  const edge = await ensureReaderAuthorityEdge(manifest, new LocalFileArtifactStore(dir), ["registry-runtime"]);
  await assert.rejects(withReaderAuthorityEdge({ ...edge, edgeOnly: true }, () => readRegistryRuntimeProjection(["AZ"])), /never reads the database/);
  assert.deepEqual(warnings, [["READER_STATE_ARTIFACT_MISS", { family: "registry-runtime", state: "AZ", key: ref.key, error: "STATE_ARTIFACT_HASH_MISMATCH" }]]);
});

const TUCSON = "lat=32.21696&lng=-110.971&zip=85701";

test("a whole /api/meetings answer from the edge is held by the CDN, keyed on every query parameter, and says where its time went", async () => {
  const { dir, keys: published } = await publishEdge("c21-route");
  process.env.WTP_READER_EDGE_DIR = dir;
  const { value: response, keys } = await recordingBytes(() => meetingsGET(new Request(`https://wtp.test/api/meetings?${TUCSON}`)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=300, stale-while-revalidate=3600");
  assert.equal(response.headers.get("netlify-cache-tag"), READER_MANIFEST_CACHE_TAG, "the tag the runner purges on every publication");
  assert.equal(READER_MANIFEST_CACHE_TAG, "reader-manifest");
  assert.equal(response.headers.get("netlify-vary"), "query", "every query parameter is in the CDN key");
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate", "the browser revalidates, so a purge reaches it");
  const timing = response.headers.get("server-timing") ?? "";
  for (const stage of ["manifest", "authority", "divisions", "zipArea", "meetings", "search", "coverage", "total"]) {
    assert.match(timing, new RegExp(`(?:^|, )${stage};dur=\\d+`), `${stage} is not timed: ${timing}`);
  }
  assert.ok(keys.includes(published.registry.AZ));
  assert.equal(keys.includes(published.registry.NH), false);
  assert.deepEqual(keys.filter((key) => key === published.outcomes), [], "the route fetched families it never reads");
  const body = await response.json();
  assert.ok(Array.isArray(body.governingOcdIds) && body.governingOcdIds.length > 0);
  assert.ok(body.coverage && body.coverage.bodies.length > 0);
});

test("panning Arizona to New Hampshire and back loads each state's officials and meetings from its own artifacts and carries nothing across", async () => {
  const { dir, keys: published } = await publishEdge("xs-crossing");
  process.env.WTP_READER_EDGE_DIR = dir;
  const registry = (state: string) => published.registry[state];
  const stateOf = (id: string | null | undefined) => stateOfOcdId(id ?? "");
  const answers: { ids: string[]; governing: string[]; bodies: number }[] = [];
  for (const [state, query] of [["az", "lat=32.21696&lng=-110.971"], ["nh", "lat=43.2081&lng=-71.5376"], ["az", "lat=32.21696&lng=-110.971"]] as const) {
    const { value: response, keys } = await recordingBytes(() => meetingsGET(new Request(`https://wtp.test/api/meetings?${query}`)));
    assert.equal(response.status, 200, state);
    const body = await response.json();
    const other = state === "az" ? "NH" : "AZ";
    assert.ok(keys.includes(registry(state.toUpperCase())), `${state} did not read its own registry`);
    assert.equal(keys.includes(registry(other)), false, `${state} read ${other}'s registry`);
    assert.ok(body.governingOcdIds.length > 0 && body.governingOcdIds.every((id: string) => stateOf(id) === state || stateOf(id) === null), `${state}: ${body.governingOcdIds}`);
    assert.ok(body.coverage.bodies.every((row: { ocdId: string | null }) => stateOf(row.ocdId) === state || stateOf(row.ocdId) === null));
    assert.ok(body.meetings.every((row: { ocdId: string }) => stateOf(row.ocdId) === state), `${state} showed another state's meeting`);
    if (body.nearZip) assert.equal(resolveZip(body.nearZip).ok && (resolveZip(body.nearZip) as { centroid: { postal?: { state: string } } }).centroid.postal?.state, state.toUpperCase());
    answers.push({ ids: body.meetings.map((row: { id: string }) => row.id).sort(), governing: [...body.governingOcdIds].sort(), bodies: body.coverage.bodies.length });
  }
  assert.ok(answers[0].ids.length > 0 && answers[1].bodies > 0, "each state answers from its own records");
  assert.equal(answers[1].ids.some(id => answers[0].ids.includes(id)), false, "no Arizona meeting stays on the New Hampshire map");
  assert.deepEqual(answers[2], answers[0], "moving back restores the first state");
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
  const { dir, keys: published } = await publishEdge("c21-representation");
  process.env.WTP_READER_EDGE_DIR = dir;
  const division = ["ocd-division", "country:us", "state:az", "place:tucson"];
  const { value: response, keys } = await recordingBytes(() => representationGET(
    new Request(`https://wtp.test/api/representation/${division.join("/")}`),
    { params: Promise.resolve({ division }) },
  ));
  assert.equal(response.status, 200);
  assert.ok(keys.includes(published.registry.AZ));
  assert.equal(keys.includes(published.registry.NH), false);
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=300, stale-while-revalidate=3600");
  assert.equal(response.headers.get("netlify-cache-tag"), READER_MANIFEST_CACHE_TAG);
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.match(response.headers.get("server-timing") ?? "", /(?:^|, )authority;dur=\d+/);
  const body = await response.json();
  assert.equal(body.ocdId, division.join("/"));
});

test("a warm call keeps useful meeting and Ask warming without opening every state's registry", async () => {
  const { dir, keys: published } = await publishEdge("c21-warm", { legislators: true });
  process.env.WTP_READER_EDGE_DIR = dir;
  const { value: primed, keys } = await recordingBytes(async () => (await (await warmGET(new Request("https://wtp.test/api/warm", { headers: { "x-wtp-synthetic-run": KEEP_WARM_MARKER } }))).json()).primed);
  assert.equal(primed.manifest, true);
  assert.equal(primed.meetings, true);
  assert.ok(primed.ask);
  for (const key of Object.values(published.registry)) assert.equal(keys.includes(key), false);
});


test("a marked warm places request lists published counties without loading state authority artifacts", async () => {
  const { dir, manifest } = await publishEdge("warm-published-places");
  process.env.WTP_READER_EDGE_DIR = dir;
  const { value: response, keys } = await recordingBytes(() => warmGET(new Request("https://wtp.test/api/warm?places=1", {
    headers: { "x-wtp-synthetic-run": KEEP_WARM_MARKER },
  })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  const result = await response.json() as { places: { zip: string; lat: number; lng: number }[]; skipped: number };
  for (const prefix of ["85", "03", "07"]) assert.ok(result.places.some(place => place.zip.startsWith(prefix)), `published county in ZIP region ${prefix} is listed`);
  assert.equal(new Set(result.places.map(place => place.zip)).size, result.places.length);
  assert.ok(result.places.every(place => /^\d{5}$/.test(place.zip) && Number.isFinite(place.lat) && Number.isFinite(place.lng)));
  assert.ok(Number.isInteger(result.skipped) && result.skipped >= 0);
  assert.deepEqual([...new Set(keys)].sort(), Object.values(manifest.meetingStates!).map(ref => ref.key).sort(),
    "the places route opens each state's meeting index and nothing else: no body record and no state authority payload");
});
