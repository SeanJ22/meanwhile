import { storedKeyEnvironment } from "../lib/core/keys-values.ts";
import { pathToFileURL } from "node:url";
import { readerFactDb } from "../lib/facts/db.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { productionBuildCanApply } from "./db-apply.mts";
import { queueUnbuiltPlacePages } from "../lib/reader/cache.ts";
import { seedRuntimeBodyPageSubjects } from "../lib/reader/page-subjects.ts";
export { seedRuntimeBodyPageSubjects } from "../lib/reader/page-subjects.ts";
import { fillMissingZipLocations } from "../lib/place-map/location-import.ts";

export async function prepareProductionPlacePages(env: Record<string,string|undefined> = storedKeyEnvironment()): Promise<void> {
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
  const queued = await queueUnbuiltPlacePages(query);
  console.log(JSON.stringify({ placePages: "queued for the runner", zipLocations, runtimeBodies, queued }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareProductionPlacePages();
}
