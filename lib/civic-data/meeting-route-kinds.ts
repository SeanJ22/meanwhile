/**
 * The meeting contracts the release firewall inspects. Meeting doors are data in the door registry, so code cannot
 * list them; what code does hold is every adapter a door can run. Each adapter route kind gets one partition contract
 * here, with the exact command a door of that kind runs, so every adapter's acquisition path is in the firewall's
 * denominator however many doors of that kind the registry holds.
 */

import type { RoutineSourceContract } from "./contracts.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import { MEETING_PARTITION_CONTRACTS, meetingRoutePartition, type MeetingPartitionContract } from "./meeting-partitions.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "./runtime-routine-contracts.ts";
import { meetingRouteKinds } from "../registry/source-wiring.ts";

/** One contract per adapter route kind; its body is the kind itself, never a real body. */
export function meetingRouteKindContracts(): MeetingPartitionContract[] {
  return meetingRouteKinds().map((name) => meetingRoutePartition(name, `route-kind:${name}`, {
    wiring: null,
    ocdId: null,
    acquisitionFailureDomain: `meeting-route-kind:${name}`,
  }));
}

/** Every routine contract code holds: the standing contracts, the derived families and one per meeting route kind. */
export function firewallRoutineContracts(): readonly RoutineSourceContract[] {
  return [
    ...ROUTINE_SOURCE_CONTRACTS,
    ...RUNTIME_ROUTINE_CONTRACTS,
    ...MEETING_PARTITION_CONTRACTS.filter((partition) => partition.derivedFamily !== null),
    ...meetingRouteKindContracts(),
  ];
}
