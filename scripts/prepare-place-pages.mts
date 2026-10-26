import { pathToFileURL } from "node:url";
import { readerFactDb } from "../lib/facts/db.ts";
import type { Query } from "../lib/facts/publish.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { productionBuildCanApply } from "./db-apply.mts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { seedRuntimeBodyPageSubjects } from "../lib/reader/page-subjects.ts";
export { seedRuntimeBodyPageSubjects } from "../lib/reader/page-subjects.ts";
import { postalArea,postalTable } from "../lib/geo/postal.ts";
import { lookupZcta } from "../lib/geo/zcta.ts";
import { readZipPlace } from "../lib/reader/national.ts";
import { stateOcdIdFrom } from "../lib/ocd/state-division.ts";
import { readerTerritory,territoryBodies } from "../lib/reader/location.ts";
import { indexedZipPopulation } from "../lib/geo/zip-division-index.ts";
import { UNBUILT_ZIP_PRIORITY } from "../lib/reader/cache.ts";

interface ZipSeedOptions {
  readonly states?: readonly string[];
  readonly postal?: typeof postalTable;
  readonly place?: typeof readZipPlace;
  readonly point?: typeof lookupZcta;
  readonly population?: typeof indexedZipPopulation;
  readonly bodies?: (state:string,point:{lat:number;lng:number})=>Promise<readonly string[]>;
}

/** ZIPs are reader selections, so each routed ZIP gets one ready answer of its own. */
export async function seedZipPagePlaces(query: Query, options: ZipSeedOptions = {}): Promise<number> {
  const postal=(options.postal ?? postalTable)(),point=options.point ?? lookupZcta;
  const place=options.place ?? (zip=>readZipPlace(postalArea(zip)?.zcta ?? zip));
  const bodies=options.bodies ?? (async(state,point)=>territoryBodies(point.lat,point.lng,await readerTerritory(state)));
  let zips=0;
  for(const state of options.states ?? REGISTRY_STATES) {
    let batch:{id:string;name:string;state:string;parent_id:string|null;priority:number}[]=[];
    let dependencies:{page_id:string;entity_id:string}[]=[];
    const flush=async()=>{
      if(!batch.length)return;
      await query(`INSERT INTO entity(id,kind,name,state,parent_id,page_priority)
        SELECT p.id,'place',p.name,p.state,parent.id,p.priority
        FROM jsonb_to_recordset($1::jsonb) AS p(id text,name text,state char(2),parent_id text,priority integer)
        LEFT JOIN entity parent ON parent.id=p.parent_id
        ON CONFLICT(id) DO UPDATE SET page_priority=excluded.page_priority
          WHERE entity.page_priority IS DISTINCT FROM excluded.page_priority`,[JSON.stringify(batch)]);
      await query(`WITH priorities AS (SELECT e.id,e.page_priority+CASE WHEN p.place_id IS NULL THEN ${UNBUILT_ZIP_PRIORITY} ELSE 0 END AS priority
        FROM entity e LEFT JOIN place_page p ON p.place_id=e.id WHERE e.id=ANY($1::text[]))
        UPDATE rebuild_queue q SET priority=p.priority FROM priorities p
        WHERE q.place_id=p.id AND q.priority IS DISTINCT FROM p.priority`,[batch.map(row=>row.id)]);
      await query(`INSERT INTO place_page_dependency(page_id,entity_id)
        SELECT page.id,subject.id FROM jsonb_to_recordset($1::jsonb) AS d(page_id text,entity_id text)
        JOIN entity page ON page.id=d.page_id JOIN entity subject ON subject.id=coalesce(
          (SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=d.entity_id),d.entity_id)
        ON CONFLICT(page_id,entity_id) DO NOTHING`,[JSON.stringify(dependencies)]);
      zips+=batch.length;
      batch=[];
      dependencies=[];
    };
    for(const [zip,row] of Object.entries(postal)) {
      if(row[5]!==state)continue;
      const position=point(zip);
      if(!position)continue;
      const entry=await place(zip);
      const parent=entry?.ids.map(stateOcdIdFrom).find(id=>id?.endsWith(`:${state.toLowerCase()}`)) ?? null;
      batch.push({id:`zip:${zip}`,name:`ZIP ${zip}`,state,parent_id:parent,
        priority:1+await (options.population ?? indexedZipPopulation)(zip)});
      dependencies.push(...[...entry?.ids ?? [],...entry?.fringe ?? [],...await bodies(state,position)]
        .map(entity_id=>({page_id:`zip:${zip}`,entity_id})));
      if(batch.length===500)await flush();
    }
    await flush();
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
  const zips=await seedZipPagePlaces(query);
  const queued = await queueUnbuiltPlacePages(query);
  console.log(JSON.stringify({ placePages: "queued for the runner", zips, runtimeBodies, queued }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareProductionPlacePages();
}
