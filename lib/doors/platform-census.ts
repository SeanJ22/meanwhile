import { bodySourceWiringFor } from "../civic-data/derived-meeting-wiring.ts";
import { createHash } from "node:crypto";
import { meetingPartitionId } from "../meetings/body-scope.ts";
import { wiringRowFor } from "../control-plane/discovery/derived-wiring.ts";
import type { MeetingBodyCrosswalkRow } from "../civic-data/meeting-body-crosswalk.ts";
import { doorsFromWiringRow } from "./seed-meetings.ts";
import { upsertDerivedDoor, type DoorDraft, type DoorRepository, type DoorRecord, type DoorConfigValue } from "./registry.ts";

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

export async function openPlatformMeetingDoors(repo: DoorRepository, rows: readonly MeetingBodyCrosswalkRow[], at: string) {
  const opened: string[] = [], seen = new Set<string>();
  for (const row of rows) for (const proposed of platformMeetingDoor(row)) {
    const legacy = await repo.read(legacyPlatformDoorId(proposed));
    const draft = reusePlatformDoor(proposed, legacy?.value ?? null);
    if (seen.has(draft.doorId)) continue;
    seen.add(draft.doorId);
    await upsertDerivedDoor(repo, draft, row.evidence.readAt, at);
    opened.push(draft.doorId);
  }
  return opened;
}
