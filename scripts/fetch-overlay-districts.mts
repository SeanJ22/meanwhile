import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { acquireOverlayScopes } from "../lib/overlay-geography/acquire.ts";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = arg("output");
if (!output) throw new Error("usage: tsx scripts/fetch-overlay-districts.mts --output=<dataset.json> [--states=<state FIPS,...>]");
const stateCodes = arg("states");
const result = await acquireOverlayScopes({ states: stateCodes ? new Set(stateCodes.split(",")) : undefined });
await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
console.log(`${result.scopes.reduce((n, scope) => n + scope.instanceCount, 0)} verified overlay districts; ${result.reports.length} source differences; ${result.failures.length} source failures; ${resolve(output)}`);
for (const report of result.reports) console.log(`${report.label}: ${report.reason}; boundary-only towns ${report.geometryOnly.join(", ") || "none"}; document-only towns ${report.documentOnly.join(", ") || "none"}; partial towns ${report.partialTowns.join(", ") || "none"}`);
for (const failure of result.failures) console.log(`${failure.sourceId}: ${failure.reason}`);
if (result.failures.length) process.exitCode = 2;
