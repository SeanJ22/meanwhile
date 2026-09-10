/**
 * `pnpm pipeline:map` — map the evidence the control plane already holds into
 * the verification pipeline, idempotently, and report counts by stage.
 * (RULING 242.)
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/pipeline-map.mts [--provider=file]
 *
 * Writes only the `promotion_pipeline` log. Env var names only.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { mapEvidenceIntoPipeline, mappingLines } from "../lib/control-plane/promotion/mapping.ts";

const ROOT = process.cwd();
const NOW = new Date().toISOString();
const argv = process.argv.slice(2);
const useFile = argv.includes("--provider=file");

let repos: ControlPlaneRepositories;
if (useFile) {
  const root = join(ROOT, ".runtime", "control-plane", "freshness-shadow");
  mkdirSync(root, { recursive: true });
  repos = await createFileRepositories(root);
} else {
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    console.error(`pipeline:map · ${CONTROL_PLANE_URL_VAR} is not set and --provider=file was not asked for. Nothing was mapped.`);
    process.exit(1);
  }
  repos = await createPgRepositories(url, NOW);
}

console.log(`pipeline:map · ${repos.describe()}`);
const report = await mapEvidenceIntoPipeline(repos, ROOT, NOW);
for (const line of mappingLines(report)) console.log(line);
console.log(
  `  VERIFIED and beyond: 0 of ${report.counts.items} — no CONFIRMED item exists to verify, and no worker writes an audit record yet. ` +
    "Neither number is a defect in the evidence; both are the honest state of the pipeline.",
);
