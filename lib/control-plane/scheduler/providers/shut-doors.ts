import { ROUTE_PLAN_CAPABILITY_PREFIX } from "../../workers/route-plan.ts";
import type { WorkItem } from "../../work-item.ts";
/** Each SHUT door becomes an obligation owed since it shut, worked by the existing detective path from the door record's own words. A registry that cannot be read is a named read failure. */

import { listDoors, type DoorRecord, type DoorRepository } from "../../../doors/registry.ts";
import { probeUrlFor } from "../../../doors/probe.ts";
import type { ObligationProvider, ProvidedObligation, ProviderContext, ProviderYield, RouteDescriptor } from "../registry.ts";

export const SHUT_DOORS_PROVIDER_ID = "shut-doors";
export const SHUT_DOORS_RECORD_CLASS = "door-repair";
export const SHUT_DOORS_NAMESPACE = "freshness:shut-door:";
export const SHUT_DOOR_ROUTE = "find-new-route";

export type ShutDoorsReading = { readonly doors: readonly DoorRecord[] } | { readonly unreadable: string };

export interface ShutDoorsInput {
  readonly doors: () => ShutDoorsReading;
}

/** Read once before the pass (`enumerate` is synchronous): the doors, or why they could not be read. */
export async function readShutDoors(repo: DoorRepository): Promise<ShutDoorsReading> {
  try {
    return { doors: (await listDoors(repo)).doors };
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
}

/** The durable obligation id for one door. */
export function shutDoorObligationId(doorId: string): string {
  return `${SHUT_DOORS_NAMESPACE}${doorId}#${SHUT_DOOR_ROUTE}`;
}

/** The door an id names, or null for any other id. */
export function parseShutDoorId(id: string): string | null {
  if (!id.startsWith(SHUT_DOORS_NAMESPACE)) return null;
  const rest = id.slice(SHUT_DOORS_NAMESPACE.length);
  const hash = rest.lastIndexOf("#");
  return hash > 0 && rest.slice(hash + 1) === SHUT_DOOR_ROUTE ? rest.slice(0, hash) : null;
}

/** What the door record says broke, in one paragraph a detective starts from. */
export function shutDoorForWork(item: Pick<WorkItem, "id" | "subject" | "autonomousPlan">): string | null {
  return parseShutDoorId(item.id) ?? (item.autonomousPlan?.capability === `${ROUTE_PLAN_CAPABILITY_PREFIX}${SHUT_DOORS_PROVIDER_ID}` ? item.subject : null);
}

export function shutDoorEvidence(door: DoorRecord): string {
  return [
    `Door ${door.doorId} (${door.kind}) went shut ${door.shutSince ?? "at an unrecorded time"}: ${door.shutReason ?? "no reason was recorded"}.`,
    door.lastSuccessAt === null ? "It has no recorded good read." : `It last read well at ${door.lastSuccessAt}.`,
    door.lastFailureAt === null ? "" : `Its last failed read was at ${door.lastFailureAt}.`,
    `It reads ${door.hosts.length === 0 ? "no recorded host" : door.hosts.join(", ")}.`,
    `Find where it publishes now, or a documented dead end. The kind's saved methods are filed under "${door.kind}".`,
  ].filter((part) => part !== "").join(" ");
}

export function shutDoorRoute(door: DoorRecord): RouteDescriptor {
  const address = probeUrlFor(door);
  return {
    routeId: SHUT_DOOR_ROUTE,
    label: `${door.doorId} — find its new route`,
    executorClass: "BOUNDED_MODEL_WORKER",
    executorReason:
      "a shut door's address no longer works, so no deterministic client may replay it: finding where it publishes " +
      `now is investigation. ${shutDoorEvidence(door)}`,
    open: address === null
      ? { kind: "NOT_MACHINE_EXECUTABLE", target: door.hosts[0] ?? door.doorId, reason: "the door names no one address to open; the detective works from its record" }
      : { kind: "HTTP_GET", url: address },
    citation: `the door registry's record for ${door.doorId}, shut since ${door.shutSince ?? "unrecorded"}`,
  };
}

export function shutDoorsProvider(input: ShutDoorsInput): ObligationProvider {
  return {
    id: SHUT_DOORS_PROVIDER_ID,
    describe: "every door in the registry that is shut, one obligation each, owed since it shut, whatever the dispatch scope",
    scheduledId: (record) => shutDoorObligationId(record.subjectId),

    enumerate(_ctx: ProviderContext): ProviderYield {
      const reading = input.doors();
      if ("unreadable" in reading) {
        return { obligations: [], readFailure: `the door registry could not be read (${reading.unreadable})`, emptyReason: null };
      }
      const shut = reading.doors
        .filter((door) => door.status === "SHUT" && Date.parse(door.validators?.checkedAt ?? "") >=
          Math.max(Date.parse(door.shutSince ?? "1970-01-01"), Date.parse(door.editedAt ?? "1970-01-01")))
        // The longest shut first.
        .sort((a, b) => (a.shutSince ?? "").localeCompare(b.shutSince ?? "") || a.doorId.localeCompare(b.doorId));
      const obligations: ProvidedObligation[] = shut.map((door) => ({
        recordClass: SHUT_DOORS_RECORD_CLASS,
        subjectId: door.doorId,
        readerImpactAt: door.shutSince,
        observedChangeRateHours: null,
        lastWorkedAt: door.lastSuccessAt,
        routes: [shutDoorRoute(door)],
      }));
      return {
        obligations,
        readFailure: null,
        emptyReason: obligations.length === 0 ? (reading.doors.some(door => door.status === "SHUT") ? "the runner transport checks the shut doors first" : "no door in the registry is shut") : null,
      };
    },
  };
}
