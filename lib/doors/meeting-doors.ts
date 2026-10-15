import { meetingPartitionId, meetingPartitionOfId, refreshMeetingPartitions, type MeetingPartitionRefresh } from "../civic-data/meeting-partitions.ts";
import { refreshOutcomePartitions, type OutcomePartitionRefresh } from "../civic-data/outcome-partitions.ts";
import { installDoorHosts } from "../civic-data/source-authority.ts";
import { refreshCuratedBodyStatus } from "../registry/curated-bodies.ts";
import { activeWiring, installMeetingDoors, type BodySourceWiring } from "../registry/source-wiring.ts";
import { refreshLegistarClients } from "../sources/legistar/client-registry.ts";
import { refreshInSiteTenants } from "../sources/legistar-insite/tenant-registry.ts";
import { isDoorRecord, type DoorRecord, type DoorRepository } from "./registry.ts";
import { meetingDoorHosts, wiringRowOfDoor, wiringRowsFromDoors } from "./rows.ts";

export interface MeetingDoorsInstall {
  readonly rows: number;
  readonly partitions: MeetingPartitionRefresh;
  readonly outcomes: OutcomePartitionRefresh;
}

/** How long a process keeps the doors it installed before it reads its scoped registry rows again. */
export const MEETING_DOORS_REFRESH_MS = 5 * 60_000;

let handWiredBodies = new Set<string>();

export function hasHandWiredMeetingDoor(bodyId: string): boolean { return handWiredBodies.has(bodyId); }

let installed: { readonly at: number; readonly versionId: string } | null = null;

export function installDoorRecords(doors: readonly DoorRecord[], from = "the door registry", at = Date.now()): MeetingDoorsInstall {
  installed = { at, versionId: from };
  handWiredBodies = new Set(doors.filter(door => door.meeting && door.status !== "SUSPENDED" &&
    (door.origin === "MANUAL" || meetingPartitionOfId(door.doorId) !== null)).flatMap(door => door.bodyIds));
  const rows: BodySourceWiring[] = wiringRowsFromDoors(doors);
  installMeetingDoors(rows);
  installDoorHosts(meetingDoorHosts(doors));
  refreshLegistarClients();
  refreshInSiteTenants();
  const owned = doors.flatMap(door => {
    const row = wiringRowOfDoor(door);
    return row ? [{ row, id: meetingPartitionId(door.kind, row.bodyId), suspended: door.status === "SUSPENDED" }] : [];
  });
  const active = new Set(owned.filter(door => !door.suspended).map(door => door.id));
  const suspended = new Set(owned.filter(door => door.suspended && !active.has(door.id)).map(door => door.id));
  const partitions = refreshMeetingPartitions(owned.map(door => door.row), suspended);
  refreshCuratedBodyStatus(rows);
  const outcomes = refreshOutcomePartitions(doors);
  return { rows: rows.length, partitions, outcomes };
}

export async function installMeetingBodyDoors(repo: DoorRepository, bodyId: string): Promise<MeetingDoorsInstall> {
  const records = await repo.listWhere(["bodyIds", "0"], bodyId);
  return installDoorRecords(records.map(record => record.value), `body:${bodyId}`);
}

export type MeetingDoorsReady =
  | { readonly ready: true; readonly versionId: string; readonly rows: number; readonly skipped: readonly string[] }
  | { readonly ready: false; readonly reason: string };

export interface MeetingDoorScope {
  readonly state?: string;
  readonly bodyId?: string;
  readonly repo?: DoorRepository;
  readonly clock?: () => number;
}

export async function ensureMeetingDoors(options: MeetingDoorScope = {}): Promise<MeetingDoorsReady> {
  const now = (options.clock ?? Date.now)();
  const code = options.state?.replace(/^US-/i, "").toUpperCase();
  const state = code ? code === "US" ? "US" : `US-${code}` : null;
  const scope = options.bodyId ? `body:${options.bodyId}` : state ? `state:${state}` : null;
  const current = (): MeetingDoorsReady => ({ ready: true, versionId: installed!.versionId, rows: activeWiring().length, skipped: [] });
  if (scope === null) return installed ? current() : { ready: false, reason: "a body or state is required to read meeting doors" };
  if (installed?.versionId === scope && now - installed.at < MEETING_DOORS_REFRESH_MS) return current();
  try {
    let repo = options.repo;
    if (!repo) {
      const { controlPlaneUrlFromEnv, createPgRepositories } = await import("../control-plane/repository/pg-store.ts");
      const connection = controlPlaneUrlFromEnv();
      if (!connection) throw new Error("MEETING_DOOR_REGISTRY_UNCONFIGURED");
      repo = (await createPgRepositories(connection, new Date(now).toISOString(), { skipBootstrap: true })).doors;
    }
    const records = options.bodyId ? await repo.listWhere(["bodyIds", "0"], options.bodyId)
      : await repo.listWhere(["scopeState"], state!);
    if (records.some(record => !isDoorRecord(record.value))) throw new Error("MEETING_DOOR_RECORD_INVALID");
    const done = installDoorRecords(records.map(record => record.value).filter(isDoorRecord), scope, now);
    return { ready: true, versionId: scope, rows: done.rows, skipped: done.partitions.skipped };
  } catch (error) {
    return { ready: false, reason: `the scoped meeting doors could not be read (${error instanceof Error ? error.message : String(error)})` };
  }
}
