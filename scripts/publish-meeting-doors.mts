/**
 * Publish the door registry's hand-wired meeting doors as the promoted
 * `meeting-doors` version every other process reads its doors from.
 *
 *   node --experimental-strip-types scripts/publish-meeting-doors.mts --promote
 *
 * The standing runner's child, run at the start of every routine pass after the
 * registry is brought up to date and before any meeting door is read. It reads
 * the registry one state at a time and promotes through the registered routine
 * door; an unchanged state re-confirms its version. States without a hand-wired
 * door still have their derived routes and standing work.
 */

import { processRegisteredFanOutCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { neon } from "@neondatabase/serverless";
import { requireRegistryState } from "../lib/civic-data/state-scopes.ts";
import { assignment } from "./cli-args.mts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { MEETING_DOORS_CONTRACT_ID, MEETING_DOOR_STATES_SQL, MEETING_DOORS_STATE_SQL, meetingDoorsCandidate } from "../lib/doors/meeting-doors.ts";
import { isDoorRecord, type DoorRecord } from "../lib/doors/registry.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/publish-meeting-doors.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const connection = controlPlaneUrlFromEnv();
if (connection === null) throw new Error("MEETING_DOORS_REGISTRY_UNCONFIGURED: the door registry's database is not configured, so no doors were published");
const now = new Date().toISOString();
const sql = neon(connection);
const wanted = assignment(process.argv, "state");
const states = wanted ? [requireRegistryState(wanted)] : (await sql.query(MEETING_DOOR_STATES_SQL)).flatMap(row => typeof row.state === "string" ? [requireRegistryState(row.state)] : []);
const store = new PostgresRoutineDataStore();
for (const state of states) {
  const found = await sql.query(MEETING_DOORS_STATE_SQL,
    [`/(state|district|territory):${state.toLowerCase()}(/|$)`, `^curated:${state.toLowerCase()}/`]);
  const rows = found.flatMap(row => isDoorRecord(row.value) ? [{ revision: Number(row.revision), updatedAt: String(row.updated_at), value: row.value as DoorRecord }] : []);
  if (rows.length === 0) continue;
  const candidate = meetingDoorsCandidate(rows, now, state);
  const outcome = await processRegisteredFanOutCandidate(store, MEETING_DOORS_CONTRACT_ID, candidate, now, undefined, { confirmUnchanged: true });
  printSourceRunnerReceipt(MEETING_DOORS_CONTRACT_ID, candidate, outcome);
  if (!outcome.promoted && !outcome.confirmed) process.exitCode = 2;
  console.log(`meeting doors ${state}: ${outcome.promoted || outcome.confirmed ? "published" : "not published"} from ${rows.length} registry rows`);
}
