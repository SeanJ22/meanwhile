import type { RoutineSourceContract } from "./contracts.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import { meetingRoutePartition, type MeetingPartitionContract } from "./meeting-partitions.ts";
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

/** Every routine contract code holds: the standing contracts and one per meeting route kind. */
export function firewallRoutineContracts(): readonly RoutineSourceContract[] {
  return [
    ...ROUTINE_SOURCE_CONTRACTS,
    ...RUNTIME_ROUTINE_CONTRACTS,
    ...meetingRouteKindContracts(),
  ];
}
