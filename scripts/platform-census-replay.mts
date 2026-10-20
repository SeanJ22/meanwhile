/** Held platform acquisitions through ordinary doors, partition promotion, fact publication and the place reader. Production connections are disabled. */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { publishReadMeetingFacts } from "../lib/civic-data/meeting-fact-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { ensureEntity } from "../lib/facts/entities.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { searchMeetings } from "../lib/meetings/query.ts";
import { snapshotSourceFor } from "../lib/meetings/snapshot-source.ts";
import { lookupZcta } from "../lib/geo/zcta.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import type { FamilyMemberRead } from "../lib/civic-data/derived-meeting-family.ts";
import { DERIVED_WIRING_SOURCE_NAMES, type DerivedWiringRow } from "../lib/civic-data/derived-meeting-wiring.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { upsertDerivedDoor } from "../lib/doors/registry.ts";
import { platformWiringDoors } from "../lib/doors/platform-census.ts";
import { installDoorRecords } from "../lib/doors/meeting-doors.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { meetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { promoteMeetingPartitions } from "./ingest.ts";
import { primeCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { GET as meetingApi } from "../app/api/meetings/route.ts";

const arg = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const publicFetch = globalThis.fetch;
let publicGeocoderRequests = 0, heldGeocoderReads = 0;
const venueFetch: typeof fetch = async (url, init) => {
  const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  if (!arg("geocode") || new URL(target).hostname !== "geocoding.geo.census.gov") throw new Error("This replay permits only explicitly requested public Census geocoding");
  const root = "/tmp/mp01-platform-replay-census", path = join(root, createHash("sha256").update(target).digest("hex") + ".json");
  if (existsSync(path)) {
    const held = JSON.parse(readFileSync(path, "utf8"));
    if (Date.now() - Date.parse(held.observedAt) < 86_400_000) { heldGeocoderReads++; return new Response(held.body, { status: held.status }); }
  }
  publicGeocoderRequests++;
  const response = await publicFetch(url, init), body = await response.clone().text();
  if (response.ok) { mkdirSync(root, { recursive: true }); writeFileSync(path, JSON.stringify({ url: target, observedAt: new Date().toISOString(), status: response.status, body })); }
  return response;
};
if (arg("venues")) {
  const venue = JSON.parse(readFileSync(arg("venues")!, "utf8"));
  primeCuratedReaderProjection("venue-resolutions", venue.payload, venue.version);
}
const directories = arg("readings")?.split(",");
if (!directories?.length) throw new Error("Use --readings=<held .readings directories>");
const pg = new PGlite();
for (const file of ["0035_r1_fact_store.sql", "0037_r1_fact_scale.sql"]) {
  for (const statement of readFileSync(join(process.cwd(), "lib/db/migrations", file), "utf8").split("--> statement-breakpoint")) await pg.exec(statement);
}
await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,payload jsonb,promoted_at timestamptz,current_version_id text);
 CREATE TABLE cp_work_items_history(id text PRIMARY KEY,value jsonb);
 CREATE TABLE civic_data_candidate_events(candidate_id text,detail text,sequence bigint);
 CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
 CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,retrieved_at timestamptz,candidate jsonb,state text,
 acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,validation_receipt jsonb)`);
for (const statement of readFileSync(join(process.cwd(), "lib/db/migrations/0036_ne01.sql"), "utf8").split("--> statement-breakpoint")
  .filter(statement => /^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(statement))) await pg.exec(statement);
Reflect.deleteProperty(process.env, "DATABASE_URL");
globalThis.fetch = async () => { throw new Error("The local platform replay never uses the network"); };
const query: Query = async (text, parameters = []) => (await pg.query<Record<string, unknown>>(text, [...parameters])).rows;
installReaderDatabaseQuery(async statements => Promise.all(statements.map(statement => query(statement.text, statement.params))));
installFactReader(query);
const db: FactDb & { query: Query } = { query, transaction: work => pg.transaction(tx => work(async (text, parameters = []) => (await tx.query<Record<string, unknown>>(text, [...parameters])).rows)) };
const vault = new DurableEvidenceStore(arg("vault") ?? "/tmp/mp01-platform-replay-sources"), totals = new Map<string, { state: string; platform: string; facts: number; held: number; blanks: number }>();
const now = new Date(arg("at") ?? Date.now()), zipChecks: unknown[] = [], publishedMeetings: unknown[] = [];
const zips = JSON.parse(readFileSync(arg("zip-baseline") ?? "/tmp/mp01-live-api-measure.json", "utf8")) as { zip: string; governingOcdIds: string[] }[];
const placeBaselines = arg("place-baselines") ? JSON.parse(readFileSync(arg("place-baselines")!, "utf8")).places as { zip: string; state: string; registry: unknown }[] : [];
let government: string | null = null, state: string | null = null;
let store = new MemoryRoutineDataStore();
const promotionFailures: unknown[] = [];
let partitionsPromoted = 0;
const finishGovernment = async () => {
  if (!government || !state) return;
  const counts = await query("SELECT produced_by,count(*)::int AS facts FROM fact WHERE status='live' GROUP BY produced_by");
  for (const row of counts) {
    const platform = String(row.produced_by).split(":").at(-1)!;
    const total = totals.get(`${state}|${platform}`);
    if (total) total.facts += Number(row.facts);
  }
  const count = await query(`SELECT count(*)::int AS meetings FROM entity m WHERE kind='meeting'
    AND EXISTS (SELECT 1 FROM fact WHERE entity_id=m.id AND field='title' AND status='live')
    AND EXISTS (SELECT 1 FROM fact WHERE entity_id=m.id AND field='starts_at' AND status='live')`);
  const platforms = await query(`SELECT split_part(f.produced_by,':',2) AS platform,count(*)::int AS meetings
    FROM entity m JOIN fact f ON f.entity_id=m.id AND f.field='title' AND f.status='live'
    WHERE m.kind='meeting' AND EXISTS (SELECT 1 FROM fact WHERE entity_id=m.id AND field='starts_at' AND status='live')
    GROUP BY 1 ORDER BY 1`);
  publishedMeetings.push({ government, state, meetings: count[0].meetings, platforms });
  writeFileSync(arg("report") ?? "/tmp/mp01-platform-replay.json", JSON.stringify({ complete: false, observedAt: now.toISOString(), productionReadBytes: 0,
    statePlatforms: [...totals.values()], publishedMeetings, zipChecks,
    liveFacts: [...totals.values()].reduce((count, row) => count + row.facts, 0), partitionsPromoted, promotionFailures,
    peakMemoryBytes: process.resourceUsage().maxRSS * 1024, publicGeocoderRequests, heldGeocoderReads }, null, 2));
  for (const zip of zips.filter(zip => zip.governingOcdIds.some(id => id.includes(`/state:${state!.toLowerCase()}/`)))) {
    const start = performance.now();
    const place = await readPlacePackage({ state, divisionIds: zip.governingOcdIds }, query);
    const point = lookupZcta(zip.zip)!;
    const result = await searchMeetings(point.lat, point.lng, 25, now, new Set(zip.governingOcdIds), snapshotSourceFor(place.snapshot),
      { shownBackDays: 90, shownAheadDays: 90 }, new Set(place.bodies.map(body => body.id)), new Set(place.bodies.map(body => body.id)));
    if (result.meetings.some(meeting => !zip.governingOcdIds.includes(meeting.ocdId ?? ""))) throw new Error("A ZIP received another place's meeting");
    let api: unknown;
    const baseline = placeBaselines.find(place => place.zip === zip.zip);
    if (baseline && result.meetings.length) {
      await pg.query(`INSERT INTO civic_data_promotions VALUES($1,'REGISTRY_RUNTIME_BINDING',$2,$3,now(),'retained-reader-baseline')
        ON CONFLICT(key) DO UPDATE SET payload=excluded.payload`,
      [`REGISTRY_RUNTIME_BINDING:US-${state}:reader-registry-runtime`, `US-${state}:reader-registry-runtime`, JSON.stringify(baseline.registry)]);
      const started = performance.now(), response = await meetingApi(new Request(`https://meanwhileusa.com/api/meetings?zip=${zip.zip}`));
      const body = await response.json(), ms = performance.now() - started;
      if (response.status !== 200 || !body.meetings?.length || ms >= 3000 || body.meetings.some((meeting: { ocdId: string }) => !zip.governingOcdIds.includes(meeting.ocdId)))
        throw new Error(`The actual meeting API did not serve this ZIP's own meetings under three seconds: ${response.status}, ${ms}ms`);
      if (arg("api-responses")) {
        mkdirSync(arg("api-responses")!, { recursive: true });
        writeFileSync(join(arg("api-responses")!, `${zip.zip}-${government.replaceAll(":", "_")}.json`), JSON.stringify(body));
      }
      api = { status: response.status, meetings: body.meetings.length, pins: body.meetings.filter((meeting: { location: unknown }) => meeting.location).length, ms };
    }
    zipChecks.push({ zip: zip.zip, government, meetings: result.meetings.length, pins: result.meetings.filter(meeting => meeting.location).length, ms: performance.now() - start, api,
      examples: result.meetings.slice(0, 2).map(meeting => ({ title: meeting.title, startsAt: meeting.startsAt, ocdId: meeting.ocdId, url: meeting.provenance.sourceUrl })) });
  }
  await pg.exec("TRUNCATE entity, source_copy, civic_data_promotions, civic_data_candidates RESTART IDENTITY CASCADE");
  store = new MemoryRoutineDataStore();
};
type HeldReading = { government: string; state: string; platform: string; row: DerivedWiringRow; reads: FamilyMemberRead[];
  responses: { finalUrl: string; body?: string; path?: string; sha256?: string; status: number; contentType: string; retrievedAt: string }[] };
/** One government at a time. Pages of a native route combine; newer copies of the same URL replace older copies. */
function* heldRoutes(): Generator<HeldReading> {
  const paths = directories!.flatMap(directory => readdirSync(directory).filter(file => file.endsWith(".json")).map(file => ({ file, path: join(directory, file) })))
    .sort((a, b) => a.file.localeCompare(b.file));
  let owner: string | null = null;
  const groups = new Map<string, HeldReading[]>();
  function* flush() {
    for (const readings of groups.values()) {
      const ordered = readings.sort((a, b) => Math.max(...a.responses.map(r => Date.parse(r.retrievedAt))) - Math.max(...b.responses.map(r => Date.parse(r.retrievedAt))));
      let current: HeldReading[] = [];
      for (const reading of ordered) {
        const urls = new Set(reading.responses.map(response => response.finalUrl));
        current = current.filter(held => !held.responses.some(response => urls.has(response.finalUrl)));
        current.push(reading);
      }
      const latest = current.at(-1)!;
      const meetings = new Map(current.flatMap(reading => reading.reads.flatMap(read => read.ok ? read.freshMeetings : [])).map(meeting => [meeting.id, meeting]));
      yield { ...latest, responses: current.flatMap(reading => reading.responses),
        reads: [{ ...latest.reads[0], ok: true, error: null, freshMeetings: [...meetings.values()] }] } as HeldReading;
    }
    groups.clear();
  }
  for (const { path } of paths) {
    const reading = JSON.parse(readFileSync(path, "utf8")) as HeldReading;
    if (owner !== reading.government) { yield* flush(); owner = reading.government; }
    const key = platformWiringDoors(reading.row)[0].doorId;
    groups.set(key, [...groups.get(key) ?? [], reading]);
  }
  yield* flush();
}
for (const reading of heldRoutes()) {
  if (reading.government !== government) { await finishGovernment(); government = reading.government; state = reading.state; }
  await ensureEntity(query, { id: reading.row.ocdId, kind: "place", name: reading.row.publishingOrg, state: reading.state, parentId: null });
  const key = `${reading.state}|${reading.platform}`;
  const total = totals.get(key) ?? { state: reading.state, platform: reading.platform, facts: 0, held: 0, blanks: 0 };
  totals.set(key, total);
  const meetings = reading.reads.flatMap(read => read.ok ? read.freshMeetings : []).filter(meeting => Math.abs(Date.parse(meeting.startsAt) - now.getTime()) <= 90 * 86_400_000);
  const responses = reading.responses.map(response => {
      const bytes = response.body !== undefined ? new TextEncoder().encode(response.body) : new Uint8Array(readFileSync(response.path!));
      if (response.sha256 && createHash("sha256").update(bytes).digest("hex") !== response.sha256) throw new Error("The retained response no longer matches its digest");
      return { source: DERIVED_WIRING_SOURCE_NAMES[reading.row.kind], requestedUrl: response.finalUrl, finalUrl: response.finalUrl, httpStatus: response.status, bytes, byteCount: bytes.length,
        rawHash: createHash("sha256").update(bytes).digest("hex"), retrievedAt: response.retrievedAt, contentType: response.contentType };
    });
  const report = await publishReadMeetingFacts({ facts: db, vault, producedBy: `platform-census-readonly-replay:${reading.platform}`, now, clocks: factClocks(null), meetings, responses });
  total.held += report.held; total.blanks += report.blanks;
  if (meetings.length) {
    const repos = createMemoryRepositories();
    const drafts = platformWiringDoors(reading.row);
    for (const draft of drafts) await upsertDerivedDoor(repos.doors, draft, reading.row.verifiedAt, now.toISOString());
    const installed = installDoorRecords((await repos.doors.list()).map(row => row.value), "read-only platform replay");
    if (!installed.partitions.refreshed || installed.partitions.skipped.length) throw new Error(JSON.stringify(installed));
    const source = DERIVED_WIRING_SOURCE_NAMES[reading.row.kind], partition = meetingPartitionContract(drafts[0].doorId);
    if (!partition) throw new Error("The ordinary platform door did not produce its meeting partition");
    const [promoted] = await promoteMeetingPartitions({ store, partitions: [partition], meetings, agendaDocuments: [], generatedAt: now.toISOString(),
      reports: [{ source, ok: true, error: null, fetched: meetings.length, normalized: meetings.length,
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
        acquisitions: responses.map(({ requestedUrl, finalUrl, httpStatus, rawHash, byteCount }) => ({ source, requestedUrl, finalUrl, httpStatus, rawHash, byteCount })) }], retainedResponses: responses,
      venueFetch });
    const projection = await store.readPromotion("MEETING", partition.scope);
    if (!projection || !(promoted?.outcome.promoted || promoted?.outcome.confirmed)) promotionFailures.push({ government, bodyId: reading.row.bodyId, detail: promoted?.outcome.candidate.failureDetail });
    else {
      partitionsPromoted++;
      const candidate = promoted.outcome.candidate;
      await pg.query(`INSERT INTO civic_data_candidates(id,record_class,scope,source_id,retrieved_at,candidate,state,acquisition_succeeded,promoted_version_id,last_known_good_version_id,normalized_hash,validation_receipt)
        VALUES($1,'MEETING',$2,$3,$4,$5,'PROMOTED',true,$1,$1,$6,$7) ON CONFLICT(id) DO NOTHING`,
      [projection.versionId, projection.scope, projection.sourceId, candidate.candidate.retrieval.retrievedAt, JSON.stringify(candidate.candidate), candidate.candidate.normalization.normalizedHash, JSON.stringify(projection.receipt)]);
      await pg.query(`INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3,$4,$5)
        ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,promoted_at=excluded.promoted_at,current_version_id=excluded.current_version_id`,
      [projection.key, projection.scope, JSON.stringify(projection.payload), projection.promotedAt, projection.versionId]);
    }
  }
}
await finishGovernment();
const report = { complete: true, observedAt: now.toISOString(), productionReadBytes: 0, statePlatforms: [...totals.values()], publishedMeetings, zipChecks,
  liveFacts: [...totals.values()].reduce((count, row) => count + row.facts, 0), partitionsPromoted, promotionFailures,
  peakMemoryBytes: process.resourceUsage().maxRSS * 1024, publicGeocoderRequests, heldGeocoderReads };
writeFileSync(arg("report") ?? "/tmp/mp01-platform-replay.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
await pg.close();
