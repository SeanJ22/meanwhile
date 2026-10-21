/**
 * Publish the door registry's hand-wired meeting doors as the promoted
 * `meeting-doors` version every other process reads its doors from.
 *
 *   node --experimental-strip-types scripts/publish-meeting-doors.mts --promote
 *
 * The standing runner's child, run at the start of every routine pass after the
 * registry is brought up to date and before any meeting door is read. It reads
 * the registry and promotes through the registered routine door; an unchanged
 * registry re-confirms the version already pointed at. A registry that cannot
 * be read, or holds no meeting door in use, refuses and the last good doors
 * stay in use.
 */

import { promoteDerivedCandidate } from "../lib/civic-data/derived-child-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { neon } from "@neondatabase/serverless";
import { changedMeetingDoors } from "../lib/doors/changed-meeting-doors.ts";
import { MEETING_DOORS_CONTRACT_ID, meetingDoorsCandidate } from "../lib/doors/meeting-doors.ts";
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
const rows = await changedMeetingDoors({ connection, query: (text, parameters) => sql.query(text, [...parameters]) });
const outcome = await promoteDerivedCandidate(new PostgresRoutineDataStore(), MEETING_DOORS_CONTRACT_ID, meetingDoorsCandidate(rows, now), now);
console.log(`meeting doors: ${outcome.promoted ? "published" : "not published"} from ${rows.length} registry rows`);
