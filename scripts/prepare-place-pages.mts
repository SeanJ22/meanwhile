import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readerFactDb } from "../lib/facts/db.ts";
import type { Query } from "../lib/facts/publish.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { productionBuildCanApply } from "./db-apply.mts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { seedRuntimeBodyPageSubjects } from "../lib/reader/page-subjects.ts";
export { seedRuntimeBodyPageSubjects } from "../lib/reader/page-subjects.ts";
import { readerTerritory,territoryBodies } from "../lib/reader/location.ts";
import { fillMissingZipLocations } from "../lib/place-map/location-import.ts";
import type { LegacyZipShard } from "../lib/place-map/legacy.ts";
import { UNBUILT_ZIP_PRIORITY } from "../lib/reader/cache.ts";

interface ZipSeedOptions {
  readonly states?: readonly string[];
  /** The bodies whose territory holds a point, or null for a state without body territories. */
  readonly bodies?: (state:string)=>Promise<((point:{lat:number;lng:number})=>readonly string[])|null>;
  /** Held 2020 Census residents of each of the state's ZCTAs; mail-only ZIPs borrow none. */
  readonly residents?: (state:string)=>Promise<Readonly<Record<string,number>>>;
}

/** Held Census residents order first ZIP builds. Only the build reads these acquired shards, never a reader request. */
function heldZipResidents(root=process.cwd()):(state:string)=>Promise<Readonly<Record<string,number>>> {
  const shards=new Map<string,Promise<Readonly<Record<string,number>>>>();
  let manifest:Promise<{statesToShards:Record<string,string[]>}>|undefined;
  return async state=>{
    manifest??=readFile(join(root,"data/derived/zip-divisions/index.json"),"utf8").then(text=>JSON.parse(text));
    const out:Record<string,number>={};
    for(const prefix of (await manifest).statesToShards[state] ?? []) {
      if(!/^\d{2}$/.test(prefix))throw new Error("Invalid ZIP shard");
      if(!shards.has(prefix))shards.set(prefix,readFile(join(root,"data/derived/zip-divisions",`${prefix}.json`),"utf8")
        .then(text=>(JSON.parse(text) as LegacyZipShard).zipResidents ?? {}));
      for(const [zip,n] of Object.entries(await shards.get(prefix)!))if(Number.isInteger(n)&&n>0)out[zip]=n;
    }
    return out;
  };
}

/** ZIPs whose postal state this is, with a display point and at least one place-map membership. */
const ROUTED_ZIPS_SQL = `SELECT l.zip,l.lat,l.lng,EXISTS(SELECT 1 FROM zip_place m JOIN entity e ON e.id=m.place_id
    WHERE m.zip=l.zip AND e.state=$1::char(2)) AS in_state
  FROM (SELECT DISTINCT ON(zip) zip,lat,lng FROM zip_location WHERE postal->>'state'=$1 ORDER BY zip,boundary_year DESC) l
  WHERE l.lat IS NOT NULL AND EXISTS(SELECT 1 FROM zip_place m WHERE m.zip=l.zip)`;

/** ZIPs are reader selections, so each routed ZIP gets one ready answer of its own. Identities and their
 * map dependencies are written inside the database from the shared place map; only body territories need points.
 * Each identity carries its held population as build priority, written only when it changed. */
export async function seedZipPagePlaces(query: Query, options: ZipSeedOptions = {}): Promise<number> {
  const bodies=options.bodies ?? (async state=>{
    const territory=await readerTerritory(state);
    return territory?point=>territoryBodies(point.lat,point.lng,territory):null;
  });
  const residents=options.residents ?? heldZipResidents();
  let zips=0;
  for(const state of options.states ?? REGISTRY_STATES) {
    const [seeded]=await query(`WITH routed AS (${ROUTED_ZIPS_SQL}), added AS (
        INSERT INTO entity(id,kind,name,state,parent_id,page_priority)
        SELECT 'zip:'||r.zip,'place','ZIP '||r.zip,$1,CASE WHEN r.in_state THEN parent.id END,1+coalesce(($2::jsonb->>r.zip)::int,0)
        FROM routed r LEFT JOIN entity parent ON parent.kind='place' AND parent.state=$1::char(2)
          AND parent.id ~ '^ocd-division/country:us/(state|district|territory):[a-z]{2}$'
        ON CONFLICT(id) DO UPDATE SET page_priority=excluded.page_priority
          WHERE entity.page_priority IS DISTINCT FROM excluded.page_priority RETURNING 1
      ) SELECT (SELECT count(*)::int FROM routed) AS n`,[state,JSON.stringify(await residents(state))]);
    await query(`WITH priorities AS (SELECT e.id,e.page_priority+CASE WHEN p.place_id IS NULL THEN ${UNBUILT_ZIP_PRIORITY} ELSE 0 END AS priority
        FROM entity e LEFT JOIN place_page p ON p.place_id=e.id WHERE e.kind='place' AND e.state=$1::char(2) AND e.id LIKE 'zip:%')
      UPDATE rebuild_queue q SET priority=p.priority FROM priorities p
      WHERE q.place_id=p.id AND q.priority IS DISTINCT FROM p.priority`,[state]);
    await query(`INSERT INTO place_page_dependency(page_id,entity_id)
      SELECT DISTINCT page.id,m.place_id FROM entity page JOIN zip_place m ON m.zip=substr(page.id,5)
      WHERE page.kind='place' AND page.state=$1::char(2) AND page.id LIKE 'zip:%'
      ON CONFLICT(page_id,entity_id) DO NOTHING`,[state]);
    zips+=Number(seeded?.n ?? 0);
    const at=await bodies(state);
    if(!at)continue;
    const dependencies=(await query(ROUTED_ZIPS_SQL,[state])).flatMap(row=>
      at({lat:Number(row.lat),lng:Number(row.lng)}).map(entity_id=>({page_id:`zip:${row.zip}`,entity_id})));
    for(let start=0;start<dependencies.length;start+=500)
      await query(`INSERT INTO place_page_dependency(page_id,entity_id)
        SELECT page.id,subject.id FROM jsonb_to_recordset($1::jsonb) AS d(page_id text,entity_id text)
        JOIN entity page ON page.id=d.page_id JOIN entity subject ON subject.id=coalesce(
          (SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=d.entity_id),d.entity_id)
        ON CONFLICT(page_id,entity_id) DO NOTHING`,[JSON.stringify(dependencies.slice(start,start+500))]);
  }
  return zips;
}

/** Every place and body without a ready page joins the queue the standing runner's place-page lane drains. */
export async function queueUnbuiltPlacePages(query: Query): Promise<number> {
  const [queued] = await query(`WITH queued AS (INSERT INTO rebuild_queue(place_id,queued_at,priority)
    SELECT e.id,statement_timestamp(),e.page_priority+CASE WHEN e.page_priority>0 THEN ${UNBUILT_ZIP_PRIORITY} ELSE 0 END
    FROM entity e LEFT JOIN place_page p ON p.place_id=e.id
    WHERE e.kind IN ('place','body') AND p.place_id IS NULL
    ON CONFLICT(place_id) DO NOTHING RETURNING 1) SELECT count(*)::int AS n FROM queued`);
  return Number(queued?.n ?? 0);
}

export async function prepareProductionPlacePages(env: Record<string,string|undefined> = process.env): Promise<void> {
  if (!productionBuildCanApply(env)) {
    console.log("place pages: identities and queue skipped outside the Netlify production main build; writes=0");
    return;
  }
  const handle = resolveProductionWriteHandle(env);
  if (handle.host.replace(/-pooler(?=\.)/, "").split(".")[0] !== "ep-dry-river-axwtolzc" || !handle.host.endsWith(".neon.tech"))
    throw new Error("Place page identities require the production reader database");
  const {query}=readerFactDb(handle.connection);
  const runtimeBodies=await seedRuntimeBodyPageSubjects(query);
  // ZIP pages and typed ZIPs read display points; a state's map import keeps them current afterward.
  const zipLocations=await fillMissingZipLocations(query,process.cwd());
  const zips=await seedZipPagePlaces(query);
  const queued = await queueUnbuiltPlacePages(query);
  console.log(JSON.stringify({ placePages: "queued for the runner", zipLocations, zips, runtimeBodies, queued }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareProductionPlacePages();
}
