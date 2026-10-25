import { pathToFileURL } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import { readerFactDb } from "../lib/facts/db.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { productionBuildCanApply } from "./db-apply.mts";
import { rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { seedRuntimeBodyPageSubjects } from "../lib/reader/page-subjects.ts";
export { seedRuntimeBodyPageSubjects } from "../lib/reader/page-subjects.ts";
import { postalArea,postalTable } from "../lib/geo/postal.ts";
import { lookupZcta } from "../lib/geo/zcta.ts";
import { readZipPlace } from "../lib/reader/national.ts";
import { stateOcdIdFrom } from "../lib/ocd/state-division.ts";
import { readerTerritory,territoryBodies } from "../lib/reader/location.ts";

type PageDatabase = FactDb & { readonly query: Query };
interface PreparationOptions {
  readonly db: PageDatabase;
  readonly rebuild?: typeof rebuildPlacePages;
  readonly waitForWorkers?: () => Promise<void>;
}

interface ZipSeedOptions {
  readonly states?: readonly string[];
  readonly postal?: typeof postalTable;
  readonly place?: typeof readZipPlace;
  readonly point?: typeof lookupZcta;
  readonly bodies?: (state:string,point:{lat:number;lng:number})=>Promise<readonly string[]>;
}

/** ZIPs are reader selections, so each routed ZIP gets one ready answer of its own. */
export async function seedZipPagePlaces(query: Query, options: ZipSeedOptions = {}): Promise<number> {
  const postal=(options.postal ?? postalTable)(),point=options.point ?? lookupZcta;
  const place=options.place ?? (zip=>readZipPlace(postalArea(zip)?.zcta ?? zip));
  const bodies=options.bodies ?? (async(state,point)=>territoryBodies(point.lat,point.lng,await readerTerritory(state)));
  let zips=0;
  for(const state of options.states ?? REGISTRY_STATES) {
    let batch:{id:string;name:string;state:string;parent_id:string|null}[]=[];
    let dependencies:{page_id:string;entity_id:string}[]=[];
    const flush=async()=>{
      if(!batch.length)return;
      await query(`INSERT INTO entity(id,kind,name,state,parent_id)
        SELECT p.id,'place',p.name,p.state,parent.id
        FROM jsonb_to_recordset($1::jsonb) AS p(id text,name text,state char(2),parent_id text)
        LEFT JOIN entity parent ON parent.id=p.parent_id
        ON CONFLICT(id) DO NOTHING`,[JSON.stringify(batch)]);
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
      batch.push({id:`zip:${zip}`,name:`ZIP ${zip}`,state,parent_id:parent});
      dependencies.push(...[...entry?.ids ?? [],...entry?.fringe ?? [],...await bodies(state,position)]
        .map(entity_id=>({page_id:`zip:${zip}`,entity_id})));
      if(batch.length===500)await flush();
    }
    await flush();
  }
  return zips;
}

/** Populate pages before Netlify can atomically publish the reader that consumes them. */
export async function preparePlacePages({ db, rebuild = rebuildPlacePages,waitForWorkers=()=>wait(1_000) }: PreparationOptions) {
  await db.query(`INSERT INTO rebuild_queue(place_id,queued_at)
    SELECT e.id,statement_timestamp() FROM entity e LEFT JOIN place_page p ON p.place_id=e.id
    WHERE e.kind IN ('place','body') AND p.place_id IS NULL
    ON CONFLICT(place_id) DO NOTHING`);
  let rebuilt = 0;
  let remaining: number;
  do {
    const result = await rebuild({ db, limit: 512, concurrency: 4, timeBudgetMs: 240_000, initialBackfill: true });
    rebuilt += result.rebuilt;
    remaining = result.remaining;
    if(result.rebuilt || result.failed || !remaining)
      console.log(JSON.stringify({ placePages: "before deployment", rebuilt, remaining, failed: result.failed }));
    if (result.failed) throw new Error("Some place pages could not be built; the current reader keeps serving");
    if (remaining && result.rebuilt === 0) {
      const [running]=await db.query("SELECT count(*)::int AS active FROM rebuild_queue WHERE lease_token IS NOT NULL AND lease_until>=clock_timestamp()");
      if(!Number(running?.active))throw new Error("Place pages are still queued without progress; the current reader keeps serving");
      await waitForWorkers();
    }
  } while (remaining);
  const [population] = await db.query(`SELECT
    count(*) FILTER (WHERE e.kind='place')::int AS places,
    count(*) FILTER (WHERE e.kind='body')::int AS bodies,
    count(*) FILTER (WHERE p.place_id IS NULL)::int AS missing
    FROM entity e LEFT JOIN place_page p ON p.place_id=e.id WHERE e.kind IN ('place','body')`);
  if (!population || Number(population.missing) !== 0)
    throw new Error("Some reader places have no built page; the current reader keeps serving");
  return { rebuilt, places: Number(population.places), bodies: Number(population.bodies), missing: 0 };
}

export async function prepareProductionPlacePages(env: Record<string,string|undefined> = process.env): Promise<void> {
  if (!productionBuildCanApply(env)) {
    console.log("place pages: initial publication skipped outside the Netlify production main build; writes=0");
    return;
  }
  const handle = resolveProductionWriteHandle(env);
  if (handle.host.replace(/-pooler(?=\.)/, "").split(".")[0] !== "ep-dry-river-axwtolzc" || !handle.host.endsWith(".neon.tech"))
    throw new Error("Initial place pages require the production reader database");
  const db=readerFactDb(handle.connection);
  const runtimeBodies=await seedRuntimeBodyPageSubjects(db.query);
  const zips=await seedZipPagePlaces(db.query);
  const result = await preparePlacePages({ db });
  console.log(JSON.stringify({ placePages: "ready for deployment", zips, runtimeBodies, ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareProductionPlacePages();
}
