import { bodySourceWiringFor } from "../civic-data/derived-meeting-wiring.ts";
import { createHash } from "node:crypto";
import { meetingPartitionId } from "../meetings/body-scope.ts";
import { wiringRowFor } from "../control-plane/discovery/derived-wiring.ts";
import type { MeetingBodyCrosswalkRow } from "../civic-data/meeting-body-crosswalk.ts";
import { doorsFromWiringRow } from "./seed-meetings.ts";
import type { RecordProjection } from "../control-plane/repository/types.ts";
import { isDoorRecord, upsertDerivedDoor, type DoorDraft, type DoorRepository, type DoorRecord, type DoorConfigValue } from "./registry.ts";

/** Acquisition selectors, not discovery metadata or output labels, identify a calendar. */
export function platformCalendarKey(kind: string, config: Readonly<Record<string, DoorConfigValue>>): string {
  const metadata = new Set(["partitionRoute", "governmentWebsite", "platformPublisherUrl", "governmentId", "registeredGovernmentId", "route", "crosswalkRowId", "bodyName", "sourceRoutes"]);
  return createHash("sha256").update(JSON.stringify(Object.entries(config)
    .filter(([key]) => !metadata.has(key) && (key !== "slug" || kind === "legistar"))
    .sort(([a], [b]) => a.localeCompare(b)))).digest("hex").slice(0, 16);
}

export function legacyPlatformDoorId(draft: DoorDraft): string {
  return meetingPartitionId(draft.kind, draft.bodyIds![0]);
}

/** Retain an existing route's pointer, output IDs, manual edits and suspension. */
export function reusePlatformDoor(draft: DoorDraft, legacy: DoorRecord | null): DoorDraft {
  if (!legacy?.meeting || legacy.kind !== draft.kind || legacy.bodyIds[0] !== draft.bodyIds?.[0]
    || platformCalendarKey(legacy.kind, legacy.config) !== platformCalendarKey(draft.kind, draft.config ?? {})) return draft;
  const config: Record<string, DoorConfigValue> = { ...draft.config, ...(typeof legacy.config.slug === "string" ? { slug: legacy.config.slug } : {}) };
  delete config.partitionRoute;
  return { ...draft, doorId: legacy.doorId, config, status: legacy.status === "SUSPENDED" ? "SUSPENDED" : draft.status };
}

/** A verified platform calendar uses the same scheduled door and adapter as an existing meeting source. */
export function platformMeetingDoor(row: MeetingBodyCrosswalkRow): DoorDraft[] {
  return platformWiringDoors(wiringRowFor(row)).map(door => ({ ...door,
    config: { ...door.config, governmentId: row.jurisdictionId, ...(row.governmentId ? { registeredGovernmentId: row.governmentId } : {}), route: row.route, crosswalkRowId: row.id },
    notes: `${row.publishingOrg}: ${row.bodyName}. Platform calendar verified from saved government and publisher pages.`,
    readNow: true,
  }));
}

export function platformWiringDoors(row: import("../civic-data/derived-meeting-wiring.ts").DerivedWiringRow): DoorDraft[] {
  return doorsFromWiringRow(bodySourceWiringFor(row)).map(door => {
    const partitionRoute = platformCalendarKey(door.kind, door.config ?? {});
    return { ...door, doorId: meetingPartitionId(door.kind, row.bodyId, partitionRoute), config: { ...door.config, partitionRoute } };
  });
}

/** Legistar's web API and its InSite portal are one agenda system; every other door kind is its own. */
function agendaSystem(kind: string): string {
  return kind === "legistar-insite" ? "legistar" : kind;
}

type DoorShape = Pick<DoorDraft, "kind" | "config" | "hosts" | "bodyIds">;

function boardName(config: Readonly<Record<string, DoorConfigValue>> = {}): string | null {
  const name = [config.bodyName, config.insiteBodyName, config.eventBodyName].find(value => typeof value === "string" && value.trim());
  return typeof name === "string" ? name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "") : null;
}

/** The publisher account a door reads: a Legistar tenant, an InSite portal, or the door's own host. */
function tenantOf(door: DoorShape): string | null {
  const value = door.kind === "legistar" ? door.config?.slug : door.kind === "legistar-insite" ? door.config?.insiteHost : door.hosts?.[0];
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

/** A meeting door someone wired by hand: not a family member and not opened by the platform census. */
export function handWiredMeetingDoor(door: DoorRecord): boolean {
  return door.meeting != null && (door.meeting.family ?? null) === null && door.config.crosswalkRowId === undefined && door.status !== "SUSPENDED";
}

/** The hand-wired door already reading this board on the same agenda system, if any: same body, or same tenant and board name. */
export function handWiredDoorFor(door: DoorShape, handWired: readonly DoorRecord[]): DoorRecord | null {
  const system = agendaSystem(door.kind), name = boardName(door.config), tenant = tenantOf(door);
  return handWired.find(held => agendaSystem(held.kind) === system && (held.bodyIds[0] === door.bodyIds?.[0] ||
    (name !== null && tenant !== null && boardName(held.config) === name && tenantOf(held) === tenant))) ?? null;
}

/** Only identity and matching fields leave the store; page captures and adapter payloads stay there. */
export const CENSUS_DOOR_MATCH_FIELDS = {
  formatVersion: true, doorId: true, kind: true, bodyIds: true, hosts: true, status: true, updatedAt: true,
  meeting: ["family"], config: ["crosswalkRowId", "bodyName", "insiteBodyName", "eventBodyName", "slug", "insiteHost"],
} as const satisfies RecordProjection;

async function censusDoorMatches(repo: DoorRepository) {
  const rows = (await Promise.all(["OPEN", "SHUT"].map(status =>
    repo.listWhereNarrowed(["status"], status, CENSUS_DOOR_MATCH_FIELDS)))).flat();
  return rows.filter((row): row is typeof row & { value: DoorRecord } => isDoorRecord(row.value))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Census doors that copy a hand-wired door are set aside, so each board is read once. Returns the doors set aside. */
export async function retireCensusDuplicates(repo: DoorRepository, at: string): Promise<string[]> {
  const rows = await censusDoorMatches(repo);
  const handWired = rows.map(row => row.value).filter(handWiredMeetingDoor);
  const retired: string[] = [];
  for (const row of rows) {
    const door = row.value;
    if (door.config.crosswalkRowId === undefined || door.status === "SUSPENDED" || door.meeting == null) continue;
    const held = handWiredDoorFor(door, handWired);
    if (held === null) continue;
    const current = await repo.mustRead(row.id);
    if (current.value.config.crosswalkRowId === undefined || current.value.status === "SUSPENDED" || current.value.meeting == null) continue;
    const currentHeld = handWiredDoorFor(current.value, handWired);
    if (currentHeld === null) continue;
    await repo.compareAndSet(row.id, current.revision, { ...current.value, status: "SUSPENDED", readNow: false,
      notes: `This board is read through ${currentHeld.doorId}`, updatedAt: at }, at);
    retired.push(row.id);
  }
  return retired;
}

export async function openPlatformMeetingDoors(repo: DoorRepository, rows: readonly MeetingBodyCrosswalkRow[], at: string) {
  const opened: string[] = [], seen = new Set<string>();
  const handWired = rows.length ? (await censusDoorMatches(repo)).map(row => row.value).filter(handWiredMeetingDoor) : [];
  for (const row of rows) for (const proposed of platformMeetingDoor(row)) {
    if (handWiredDoorFor(proposed, handWired)) continue;
    const legacy = await repo.read(legacyPlatformDoorId(proposed));
    const draft = reusePlatformDoor(proposed, legacy?.value ?? null);
    if (seen.has(draft.doorId)) continue;
    seen.add(draft.doorId);
    await upsertDerivedDoor(repo, draft, row.evidence.readAt, at);
    opened.push(draft.doorId);
  }
  return opened;
}
