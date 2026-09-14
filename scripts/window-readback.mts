/**
 * `pnpm window:readback` — read the newest nightly-window record back from the
 * control plane, with its incidents and the pipeline counts. (RULING 242.)
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/window-readback.mts [--provider=file] [--out=<path>]
 *
 * Reads only; the optional `--out` JSON is the one write. Env var names only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { readPipelineStates, stageCounts } from "../lib/control-plane/promotion/pipeline.ts";
import { buildWindowView, readLastWindow, readWindowIncidents, renderedNumbersOf } from "../lib/control-plane/window-view.ts";
import { auditRenderedNumbers } from "../lib/control-plane/owner-surface.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const NOW = new Date().toISOString();
const argv = process.argv.slice(2);
const useFile = argv.includes("--provider=file");
const outArg = argv.find((a) => a.startsWith("--out="));
const OUT = outArg ? resolve(ROOT, outArg.slice("--out=".length)) : null;

let repos: ControlPlaneRepositories;
if (useFile) {
  repos = await createFileRepositories(join(ROOT, ".runtime", "control-plane", "freshness-shadow"));
} else {
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    console.error(`window:readback · ${CONTROL_PLANE_URL_VAR} is not set and --provider=file was not asked for.`);
    process.exit(1);
  }
  repos = await createPgRepositories(url, NOW);
}

console.log(`window:readback · ${repos.describe()}`);
const last = await readLastWindow(repos);
if (last.kind !== "HELD") {
  console.log(`  ${last.kind}: ${last.detail}`);
  process.exit(last.kind === "STORE_UNREACHABLE" ? 2 : 0);
}
const run = last.value.last;
const incidents = await readWindowIncidents(repos, run.windowId);
const view = buildWindowView({ nowIso: NOW, lastWindow: last, incidents });
const audit = auditRenderedNumbers(renderedNumbersOf(view));
const states = await readPipelineStates(repos);
const counts = stageCounts(states);

console.log(`  windows recorded   ${last.value.total}`);
console.log(`  newest             ${run.windowId} — local date ${run.localDate} (${run.zone}), trigger ${run.trigger}, mode ${run.mode}`);
console.log(`  timing             scheduled ${run.scheduledFor}; started ${run.startedAt}; finished ${run.finishedAt}; host ${run.host}; SHA ${run.testedSha ?? "unrecorded"}`);
console.log(`  lock               lease ${run.lock.leaseId} held by ${run.lock.holder} ${run.lock.claimedAt} -> ${run.lock.expiresAt}${run.lock.releasedAt ? `, released ${run.lock.releasedAt}` : ""}`);
console.log(`  verdict            ${view.verdict}${view.reasons.length > 0 ? ` — ${view.reasons.join("; ")}` : ""}`);
for (const s of run.stages) console.log(`  stage              ${s.stage} ${s.outcome}${s.reason ? ` — ${s.reason}` : ""}`);
console.log(`  gate               ${run.activationGate.reason}`);
console.log(
  `  ${floorLine(
    floored(
      "items PROMOTED to reader truth (SHADOW)",
      "the pipeline the newest window evaluated",
      run.pipeline.items,
      run.promoted,
      run.pipeline.items === 0 ? "the window evaluated no pipeline item" : undefined,
    ),
  )}`,
);
for (const t of run.pipeline.byRecordClass) {
  console.log(`  ${t.recordClass.padEnd(18)} would promote ${t.promoteWould} of ${t.items}; refused ${t.refuseWould} of ${t.items}; deferred ${t.deferred} of ${t.items}`);
}
console.log(`  pipeline now       ${counts.items} item(s): SCOUTED ${counts.byStage.SCOUTED}, CONFIRMED ${counts.byStage.CONFIRMED}, VERIFIED ${counts.byStage.VERIFIED}, AUDITED ${counts.byStage.AUDITED}, APPROVED ${counts.byStage.APPROVED_FOR_PROMOTION}, refused ${counts.refused}`);
console.log(`  controls           ${run.controls === null ? "NOT MEASURED" : JSON.stringify(run.controls)}`);
console.log(`  incidents          ${incidents.kind === "HELD" ? `${incidents.value.length} in the log` : incidents.detail}; ${run.incidents.length} on the record`);
for (const i of run.incidents) console.log(`      ${i.incidentId} ${i.stage} ${i.code} — ${i.detail}`);
console.log(`  digest             ${run.digestPath ?? "unwritten"}${run.mirrored === null ? "" : run.mirrored ? " (mirror)" : " (.mirror/ FALLBACK)"}`);
console.log(`  record             ${run.recordPath ?? "unwritten"}`);
console.log(`  number audit       ${audit.ok ? "ok" : `REFUSED — ${audit.detail}`}`);

if (OUT !== null) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ readAt: NOW, windowsRecorded: last.value.total, run, incidents: incidents.kind === "HELD" ? incidents.value : null, view, counts }, null, 2)}\n`, "utf8");
  console.log(`  written            ${OUT}`);
}
