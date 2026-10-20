/** Exact native model entry, brokered under one shared cap. No provider key enters a child. */
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { installMeasurementNetworkBoundary } from "./rh01-network.mjs";

installMeasurementNetworkBoundary();
const descriptorPath = process.env.WTP_RH01_MODEL_BROKER;
if (descriptorPath) {
  const broker = JSON.parse(readFileSync(descriptorPath, "utf8"));
  if (new URL(broker.url).hostname !== "127.0.0.1") throw Error("RH01 model broker must be local");
  process.env.WTP_WORKERS_ANTHROPIC_API_KEY = "rh01-local-capped-model-broker";
  const root = process.env.WTP_RH01_CODE_ROOT ?? process.cwd(), prefix = pathToFileURL(root + "/").href;
  const client = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? process.cwd(), "scripts/rh01-model-client.mts")).href;
  registerHooks({ load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith(prefix) || url.includes("/node_modules/") || !result.source) return result;
    const modelEntry = url.endsWith("/lib/control-plane/scheduler/scout-executor.ts");
    const capturedPlace = url.endsWith("/lib/civic-data/held-place-capture.ts") && process.env.WTP_RH01_MODEL_CAPTURE;
    if (!modelEntry && !capturedPlace) return result;
    // Decode only the two modules actually transformed. JSON and every other
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
    }
    return { ...result, source };
  } });
}
