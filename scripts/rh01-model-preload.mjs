/** Exact native model entry, brokered under one shared cap. No provider key enters a child. */
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { installMeasurementNetworkBoundary } from "./rh01-network.mjs";

installMeasurementNetworkBoundary();
const descriptorPath = process.env.WTP_RH01_MODEL_BROKER;
if (descriptorPath) {
  const broker = JSON.parse(readFileSync(descriptorPath, "utf8"));
  if (new URL(broker.url).hostname !== "127.0.0.1") throw Error("RH01 model broker must be local");
  process.env.WTP_WORKERS_ANTHROPIC_API_KEY = "rh01-local-capped-model-broker";
  const root = process.env.WTP_RH01_CODE_ROOT ?? process.cwd(), prefix = pathToFileURL(root + "/").href;
  const client = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? process.cwd(), "scripts/rh01-model-client.mts")).href;
  const leaseEntry = join(root, "lib/control-plane/workers/lease-worker.ts");
  registerHooks({ load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith(prefix) || url.includes("/node_modules/") || !result.source) return result;
    const modelEntry = url.endsWith("/lib/control-plane/scheduler/scout-executor.ts");
    const capturedPlace = url.endsWith("/lib/civic-data/held-place-capture.ts") && process.env.WTP_RH01_MODEL_CAPTURE;
    const baselineBootstrap = process.env.WTP_RH01_MODEL_PHASE === "before" && process.env.WTP_RH01_BASELINE_COMPONENT_STORE &&
      url === pathToFileURL(leaseEntry).href && resolve(process.argv[1] ?? "") === leaseEntry;
    if (!modelEntry && !capturedPlace && !baselineBootstrap) return result;
    // Decode only modules actually transformed. JSON and every other
    // native source retain their loader result without a byte-to-string rewrite.
    let source = typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
    if (modelEntry) {
      const declaration = "export function anthropicTransport(";
      if (!source.includes(declaration)) throw Error("RH01 native model transport declaration changed");
      source = source.replace(declaration, "function rhNativeAnthropicTransport(");
      source += `\nimport {diagnosticModelClient as rhModelClient} from ${JSON.stringify(client)};
        export function anthropicTransport(apiKey,fetchImpl,endpoint,options={}) { return rhModelClient(options); }\n`;
    } else if (capturedPlace) {
      const declaration = "export async function readHeldPlaceCapture(";
      if (!source.includes(declaration)) throw Error("RH01 native held-place declaration changed");
      source = source.replace(declaration, "async function rhNativeHeldPlaceCapture(");
      source += `\nimport {readFileSync as rhReadCapture} from 'node:fs';
        export async function readHeldPlaceCapture(ids,options={}) {
          if(ids.length!==1||ids[0]!=='ocd-division/country:us/state:az/county:pima')throw Error('RH01 captured packet escaped its original place');
          return JSON.parse(rhReadCapture(process.env.WTP_RH01_MODEL_CAPTURE,'utf8'));
        }\n`;
    } else if (baselineBootstrap) {
      // The original lease child did not initialize process-local meeting partitions.
      // This disclosed component startup reads only its already-held AZ File store;
      // it does not stand in for the original country's parent startup or its memory.
      const fileStore = pathToFileURL(join(root, "lib/control-plane/repository/file-store.ts")).href;
      const doors = pathToFileURL(join(root, "lib/doors/install.ts")).href;
      const references = pathToFileURL(join(root, "lib/civic-data/operational-references.ts")).href;
      const registry = pathToFileURL(join(root, "lib/registry/runtime-read-model.ts")).href;
      const routineStore = pathToFileURL(join(root, "lib/civic-data/store.ts")).href;
      const declaration = "async function work(config: LeaseWorkerConfig): Promise<void> {";
      if (!source.includes(declaration)) throw Error("RH01 baseline lease entry declaration changed");
      source = source.replace(declaration, declaration + `
        if(config.postgres||config.fileStoreRoot!==process.env.WTP_RH01_BASELINE_COMPONENT_STORE)
          throw Error('RH01_BASELINE_COMPONENT_BOOTSTRAP_STORE_MISMATCH');
        const rhBaselineRepos=await rhBaselineRepositories(process.env.WTP_RH01_BASELINE_COMPONENT_STORE);
        const rhBodyContext=JSON.parse(rhBaselineReadFile(process.env.WTP_RH01_BASELINE_COMPONENT_STORE+'/rh01-model-replay.json','utf8')).inputs?.beforeBodyContext;
        if(rhBodyContext){
          if(rhBodyContext.state!=='AZ'||rhBodyContext.subjectId!=='ocd-division/country:us/state:az/county:pima#governing')throw Error('RH01_BASELINE_BODY_CONTEXT_SCOPE_MISMATCH');
          const rhReference=await rhBaselineAzReference({store:new RhBaselineRoutineStore(),bypassCache:true});
          const rhRegistry=await rhBaselineRegistry(['az'],{store:new RhBaselineRoutineStore(),bypassCache:true});
          if(rhReference.metadata.versionId!==rhBodyContext.operationalVersionId||rhRegistry.kind!=='PROMOTED'||rhRegistry.metadata.versionId!==rhBodyContext.registryVersionId)
            throw Error('RH01_BASELINE_BODY_CONTEXT_PUBLICATION_CHANGED');
        }
        const rhBaselineDoors=await rhBaselineRefreshDoors(rhBaselineRepos.doors,{state:'AZ'});
        if(rhBaselineDoors.reason||!rhBaselineDoors.rows||rhBaselineDoors.partitions?.refreshed!==true||
          !rhBaselineDoors.doors?.length||rhBaselineDoors.doors.some(door=>!door.ocdId?.startsWith('ocd-division/country:us/state:az/')))
          throw Error('RH01_BASELINE_COMPONENT_BOOTSTRAP_FAILED:'+JSON.stringify({reason:rhBaselineDoors.reason,rows:rhBaselineDoors.rows,partitions:rhBaselineDoors.partitions?.reason}));
        console.log('RH01_BASELINE_COMPONENT_BOOTSTRAP '+JSON.stringify({phase:'before',scope:'AZ held File model component; original country parent excluded',rows:rhBaselineDoors.rows,partitions:rhBaselineDoors.partitions.partitions}));
        \n`);
      source += `\nimport {createFileRepositories as rhBaselineRepositories} from ${JSON.stringify(fileStore)};
        import {refreshDoorsForPass as rhBaselineRefreshDoors} from ${JSON.stringify(doors)};
        import {readFileSync as rhBaselineReadFile} from 'node:fs';
        import {preloadAzOperationalReferenceBundle as rhBaselineAzReference} from ${JSON.stringify(references)};
        import {readRegistryRuntimeProjection as rhBaselineRegistry} from ${JSON.stringify(registry)};
        import {PostgresRoutineDataStore as RhBaselineRoutineStore} from ${JSON.stringify(routineStore)};\n`;
    }
    return { ...result, source };
  } });
}
