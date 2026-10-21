import { neon } from "@neondatabase/serverless";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { isDoorRecord, type DoorRecord } from "../doors/registry.ts";
import { installDoorRecords } from "../doors/meeting-doors.ts";
import type { DoorPassResult } from "../doors/install.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { installConnectAttemptWindow } from "../ops/connect-attempt-window.ts";

/** Door installation uses meeting doors only. Voting-source inventories and
 * other doors remain in the registry instead of entering every state planner. */
export const PLANNER_MEETING_DOORS_SQL = `SELECT id,value FROM cp_doors
  WHERE cp_control_state(value)=$1 AND value->'meeting' IS NOT NULL AND value->'meeting'<>'null'::jsonb AND id>$2
  ORDER BY id LIMIT 100`;

export async function readPlannerMeetingDoors(state: string, query?: ReadOnlyQuery): Promise<readonly DoorRecord[]> {
  const key = state.toLowerCase();
  if (!/^(?:[a-z]{2}|system)$/.test(key)) throw new Error(`PLANNER_DOOR_STATE_INVALID:${state}`);
  if (!query) {
    const url = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
    if (!url) throw new Error("PLANNER_DOOR_STORE_UNCONFIGURED");
    installConnectAttemptWindow();
    installDatabaseTransferCounter();
    const sql = neon(url);
    query = statements => sql.transaction(statements.map(statement => sql.query(statement.text, [...statement.params])), { readOnly: true });
  }
  const doors: DoorRecord[] = [];
  let after = "";
  for (;;) {
    const [rows] = await query([{ text: PLANNER_MEETING_DOORS_SQL, params: [key, after] }]);
    for (const row of rows) if (isDoorRecord(row.value)) doors.push(row.value);
    if (rows.length < 100) break;
    after = String(rows[rows.length - 1].id);
  }
  const rank = { SHUT: 0, SUSPENDED: 1, OPEN: 2 } as const;
  return doors.sort((a, b) => rank[a.status] - rank[b.status] || (a.doorId < b.doorId ? -1 : a.doorId > b.doorId ? 1 : 0));
}

/** Installs the same wiring, hosts and outcome partitions as an ordinary door
 * pass, with only this state's relevant rows crossing the transport. */
export async function refreshPlannerDoorsForPass(state: string, query?: ReadOnlyQuery): Promise<DoorPassResult> {
  let doors: readonly DoorRecord[];
  try { doors = await readPlannerMeetingDoors(state, query); }
  catch (error) {
    return { rows: 0, reason: `the door registry could not be read (${error instanceof Error ? error.message : String(error)})`, partitions: null, outcomes: null };
  }
  const installed = installDoorRecords(doors);
  return { rows: installed.rows, reason: installed.rows === 0 ? "the door registry holds no meeting door in use" : null,
    partitions: installed.partitions, outcomes: installed.outcomes, doors };
}
