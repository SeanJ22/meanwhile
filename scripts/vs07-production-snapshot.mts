/** Read-only export of production's voting-sites pointers, routine clocks and exact promoted candidates for
 * scripts/vs07-replay.mts. DATABASE_URL must be the read-only production role (WTP_PRODUCTION_DATABASE_URL_READONLY):
 * the export refuses a role that can write, and every read goes through the same PostgresRoutineDataStore methods
 * the runner uses for admission (`store.clock`) and the reader uses for publication (`readPromotedCivicData`).
 *
 *   DATABASE_URL=$WTP_PRODUCTION_DATABASE_URL_READONLY node --experimental-strip-types --import ./scripts/register-test-loader.mjs \
 *     scripts/vs07-production-snapshot.mts --states=NC,PA --out=.scratch/vs07-production */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { assignment } from "./cli-args.mts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";

const url = process.env.DATABASE_URL;
assert.ok(url, "DATABASE_URL must name the read-only production role");
const out = resolve(assignment(process.argv, "out") ?? ".scratch/vs07-production");
const branchId = assignment(process.argv, "branch") ?? "br-delicate-lab-ax02xuo5";
const sql = neon(url);
// One read-only transaction proves the role and session cannot write before anything else is read.
const [[identity]] = await sql.transaction(txn => [txn`SELECT current_user, current_setting('transaction_read_only') AS read_only,
  has_table_privilege(current_user, 'civic_data_promotions', 'INSERT') OR has_table_privilege(current_user, 'civic_data_candidates', 'INSERT') AS can_write`],
  { readOnly: true }) as unknown as [[{ current_user: string; read_only: string; can_write: boolean }]];
assert.equal(identity.read_only, "on");
assert.equal(identity.can_write, false, "the export role must not be able to write");

const tasks = AUTOMATIC_REFRESH_TASKS.filter(task => /^voting-sites:[A-Z]{2}$/.test(task.id));
const wanted = assignment(process.argv, "states")?.split(",").map(requireBallotState) ?? tasks.map(task => task.id.slice(-2));
const store = new PostgresRoutineDataStore();
const capturedAt = new Date().toISOString();
const pointers: unknown[] = [], clocks: unknown[] = [];
await mkdir(out, { recursive: true });
for (const task of tasks) {
  const state = task.id.slice(-2);
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  clocks.push({ scope: task.scope, ...clock });
  const read = await readPromotedCivicData<VotingSitesFile>(task.recordClass, task.scope, { store, bypassCache: true });
  if (read.kind !== "PROMOTED") continue;
  const sites = read.value.jurisdictions.reduce((sum, row) => sum + row.sites.length, 0);
  pointers.push({ scope: task.scope, versionId: read.metadata.versionId, promotedAt: read.projection.promotedAt, jurisdictions: read.value.jurisdictions.length, sites: String(sites) });
  if (!wanted.includes(state)) continue;
  const record = await store.readCandidateProof(read.projection.versionId);
  assert.ok(record, `${state}: promoted candidate ${read.metadata.versionId} is readable`);
  await writeFile(join(out, `${state}.json`), JSON.stringify({ identity, projection: read.projection, record }));
}
await writeFile(join(out, "metadata.json"), JSON.stringify({ capturedAt, database: { projectId: "tiny-hill-13996172", branchId, databaseName: "neondb" },
  identity, pointers, clocks }, null, 2));
console.log(`VS07_PRODUCTION_SNAPSHOT capturedAt=${capturedAt} pointers=${pointers.length} clocks=${clocks.length} exported=${wanted.join(",")}`);
