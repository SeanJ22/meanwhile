/** Existing production place obligations, expressed as the runner's actual child commands. */
import { neon } from "@neondatabase/serverless";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stateOfZip } from "../lib/control-plane/bulk-hunts/zip-state.ts";
import { stateRegistryRuntimeContractId, stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { enableProductionReadAccounting } from "./rh01-network.mjs";

enableProductionReadAccounting("production-obligation-inventory");

const output = process.argv.find(value => value.startsWith("--out="))?.slice(6);
if (!output) throw Error("RH01 production inventory requires --out=<manifest.json>");
const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!connection || decodeURIComponent(new URL(connection).username) !== "wtp_cp_release_readonly") throw Error("RH01 production inventory requires the control-plane read-only role");
const sql = neon(connection), jobs = [];
let after = "";
for (;;) {
  const rows = await sql.query(`SELECT id,value->>'subjectId' AS subject FROM cp_obligations
    WHERE value->>'routeId'='national-place-sources' AND (value->>'active')::boolean=true AND id>$1 ORDER BY id LIMIT 32`, [after]);
  for (const row of rows) {
    const zip = /^zip:(\d{5})$/.exec(String(row.subject))?.[1];
    if (!zip) throw Error("RH01 national obligation does not name its exact ZIP");
    const state = await stateOfZip(zip);
    if (!state) throw Error(`RH01 existing national obligation has no indexed state: ${row.id}`);
    const script = "scripts/promote-registry-runtime.mts";
    jobs.push({ id: `worker:${row.id}`, script,
      command: [script, "--promote", `--state=${state}`, `--national-zips=${zip}`, `--place-task=${row.id}`],
      source: "production standing national-place obligation", scope: stateRegistryRuntimeScope(state), recordClass: "REGISTRY_RUNTIME_BINDING",
      authority: { capability: "MANUAL_CONTRACT", contract: stateRegistryRuntimeContractId(state) } });
  }
  if (rows.length < 32) break;
  after = String(rows.at(-1)!.id);
}
await writeFile(resolve(output), JSON.stringify({ capturedAt: new Date().toISOString(), productionReadOnly: true, jobs }, null, 2));
console.log(JSON.stringify({ manifest: resolve(output), nationalPlaceOffers: jobs.length }));
