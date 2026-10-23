import { meetingSittingWindow, type RoutineSourceContract } from "./contracts.ts";
import { VALIDATION_CHECKS } from "./types.ts";
import { meetingAcquisitionFailureDomain, meetingPartitionId, setExtraSittingWindowSources } from "./meeting-partitions.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "./runtime-routine-contracts.ts";
import type { BodySourceWiring } from "../registry/source-wiring.ts";
import { wiringRowsFromDoors } from "../doors/rows.ts";
import type { DoorRecord } from "../doors/registry.ts";
import type { OutcomeTenant } from "../outcomes/data-plane.ts";
import { outcomePartitionScope, setDoorOutcomePointers } from "../outcomes/door-outcome-pointers.ts";
export { outcomePartitionScope } from "../outcomes/door-outcome-pointers.ts";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

export const DOOR_OUTCOMES_SOURCE_ID = "door-outcomes" as const;

export const OUTCOMES_HOLD = "outcomes";

export const OUTCOME_DOOR_KINDS = ["legistar", "legistar-insite"] as const;
export type OutcomeDoorKind = (typeof OUTCOME_DOOR_KINDS)[number];

/** A door on one of these routes is served by that contract; building both would write each sitting twice. */
const STILL_ON_PLACE_CONTRACT: ReadonlySet<string> = new Set(["legistar:pima", "legistar-insite:mesa"]);

export interface OutcomePartitionContract extends RoutineSourceContract {
  readonly doorId: string;
  readonly kind: OutcomeDoorKind;
  readonly bodyId: string;
  readonly tenant: OutcomeTenant;
  readonly wiring: BodySourceWiring;
  readonly eventBodyId: number | null;
}

export function outcomePartitionId(doorId: string): string {
  return `${doorId}:outcomes`;
}

export function isOutcomePartitionScope(scope: string): boolean {
  return scope.startsWith("door:") && scope.endsWith(":outcomes");
}

export function stateJurisdictionOf(ocdId: string): string | null {
  const state = /\/state:([a-z]{2})(?:\/|$)/.exec(ocdId)?.[1];
  return state ? `US-${state.toUpperCase()}` : null;
}

function portalHostOf(row: BodySourceWiring): string | null {
  const host = row.config.insiteHost?.trim().toLowerCase();
  return host && /^[a-z0-9.-]+$/.test(host) ? host : null;
}

function tenantFor(row: BodySourceWiring, kind: OutcomeDoorKind, id: string, scope: string): OutcomeTenant {
  const slug = row.config.slug?.trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error(`OUTCOME_DOOR_SLUG_INVALID:${row.bodyId}`);
  const jurisdiction = stateJurisdictionOf(row.ocdId ?? "");
  if (jurisdiction === null) throw new Error(`OUTCOME_DOOR_STATE_UNKNOWN:${row.bodyId}`);
  const portalHost = kind === "legistar-insite" ? portalHostOf(row) : null;
  if (kind === "legistar-insite" && portalHost === null) throw new Error(`OUTCOME_DOOR_PORTAL_HOST_MISSING:${row.bodyId}`);
  return {
    contractId: id,
    sourceId: DOOR_OUTCOMES_SOURCE_ID,
    recordClass: "MEETING_OUTCOME",
    scope,
    parserVersion: kind === "legistar" ? "legistar-outcomes/2" : "legistar-minutes-outcomes/1",
    slug,
    label: row.jurisdiction,
    jurisdiction,
    requestedUrl: kind === "legistar" ? `https://webapi.legistar.com/v1/${slug}/events` : `https://${portalHost}/Calendar.aspx`,
    portalHost,
  };
}

function outcomeDoorKind(door: DoorRecord): OutcomeDoorKind | null {
  return (OUTCOME_DOOR_KINDS as readonly string[]).includes(door.kind) ? (door.kind as OutcomeDoorKind) : null;
}

export function outcomeDoors(doors: readonly DoorRecord[]): readonly DoorRecord[] {
  return doors.filter((door) =>
    door.status !== "SUSPENDED" && door.meeting != null && door.meeting.family === null && door.bodyIds.length === 1 &&
    outcomeDoorKind(door) !== null && door.holds.includes(OUTCOMES_HOLD));
}

export interface OutcomePartitionBuild {
  readonly contracts: OutcomePartitionContract[];
  readonly skipped: readonly { readonly doorId: string; readonly why: string }[];
}

export function buildOutcomePartitions(doors: readonly DoorRecord[]): OutcomePartitionBuild {
  const contracts: OutcomePartitionContract[] = [];
  const skipped: { doorId: string; why: string }[] = [];
  for (const door of outcomeDoors(doors)) {
    try {
      const built = buildOne(door);
      if (built !== null) contracts.push(built);
    } catch (error) {
      skipped.push({ doorId: door.doorId, why: error instanceof Error ? error.message : String(error) });
    }
  }
  const ids = new Set<string>();
  const scopes = new Set<string>();
  for (const contract of contracts) {
    if (ids.has(contract.id) || scopes.has(contract.scope)) throw new Error(`OUTCOME_PARTITION_COLLISION:${contract.id}`);
    ids.add(contract.id);
    scopes.add(contract.scope);
  }
  return { contracts, skipped };
}

function buildOne(door: DoorRecord): OutcomePartitionContract | null {
  const kind = outcomeDoorKind(door)!;
  const [row] = wiringRowsFromDoors([door]);
  if (row === undefined) return null;
  const slug = row.config.slug?.trim() ?? "";
  if (STILL_ON_PLACE_CONTRACT.has(`${kind}:${slug}`)) return null;
  if (kind === "legistar-insite" && (!row.config.insiteBodyNames?.trim() || !row.config.insiteBodyName?.trim())) {
    throw new Error(`OUTCOME_DOOR_INSITE_BODY_NAMES_MISSING:${row.bodyId}`);
  }
  const doorId = meetingPartitionId(kind, door.bodyIds[0]);
  const id = outcomePartitionId(doorId);
  const scope = outcomePartitionScope(doorId);
  const tenant = tenantFor(row, kind, id, scope);
  const body = row.config.eventBodyId?.trim();
  const eventBodyId = kind === "legistar" && body && /^\d+$/.test(body) ? Number(body) : null;
  if (kind === "legistar" && eventBodyId === null && !row.config.eventBodyName?.trim() && !row.config.insiteBodyName?.trim()) {
    throw new Error(`OUTCOME_DOOR_NATIVE_BODY_UNRESOLVED:${row.bodyId}`);
  }
  return {
    id,
    sourceId: DOOR_OUTCOMES_SOURCE_ID,
    recordClass: "MEETING_OUTCOME",
    scope,
    acquisitionFailureDomain: meetingAcquisitionFailureDomain(kind, row),
    acquisitionAdapter: {
      authorityMode: "SINGLE_ROUTE",
      command: [
        kind === "legistar" ? "scripts/legistar-outcomes-ingest.mts" : "scripts/legistar-insite-minutes-ingest.mts",
        "--promote", "--slug", tenant.slug, "--door", doorId,
        ...(eventBodyId === null ? [] : ["--body", String(eventBodyId)]),
      ],
      requestedUrl: tenant.requestedUrl,
    },
    parserNormalizerVersion: tenant.parserVersion,
    cadence: {
      description: "fresh for fourteen hours through the 2026 general election, then a day",
      defaultEveryMs: DAY,
      phases: [{ through: "2026-11-04T00:00:00.000Z", everyMs: 14 * HOUR, description: "fourteen hours through 2026-11-03" }],
    },
    schedule: meetingSittingWindow([{ meetingSource: kind, bodyId: door.bodyIds[0] }]),
    retry: { afterMs: HOUR, description: "one hour after a failed events, items, votes or minutes attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: DOOR_OUTCOMES_SOURCE_ID },
    validationContract: VALIDATION_CHECKS,
    canonicalProductionStore: "civic_data_candidates+civic_data_candidate_events+civic_data_promotions",
    readerProjection: { id: `door-outcomes:${doorId}`, consumers: ["agenda", "Ask", "meeting Reader records", "map"] },
    lkgBehavior:
      "A failed sitting, items, votes or minutes read is stored as a refused candidate; prior GOOD outcomes of this door " +
      "remain live and never move another door's pointer.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
    doorId,
    kind,
    bodyId: door.bodyIds[0],
    tenant,
    wiring: row,
    eventBodyId,
  };
}

export const OUTCOME_PARTITION_CONTRACTS: OutcomePartitionContract[] = [];

let outcomePartitionsCurrent = false;

/** False means the doors were not read; a publisher must not treat the empty list as "no outcomes". */
export function outcomePartitionsAreCurrent(): boolean {
  return outcomePartitionsCurrent;
}

export interface OutcomePartitionRefresh {
  readonly refreshed: boolean;
  readonly partitions: number;
  readonly skipped: readonly { readonly doorId: string; readonly why: string }[];
  readonly reason: string | null;
}

/** Swapped in only if every door builds; otherwise the last good list stays. */
export function refreshOutcomePartitions(doors: readonly DoorRecord[]): OutcomePartitionRefresh {
  try {
    const { contracts, skipped } = buildOutcomePartitions(doors);
    OUTCOME_PARTITION_CONTRACTS.splice(0, OUTCOME_PARTITION_CONTRACTS.length, ...contracts);
    RUNTIME_ROUTINE_CONTRACTS.splice(0, RUNTIME_ROUTINE_CONTRACTS.length, ...contracts);
    setDoorOutcomePointers(contracts.map((contract) => ({
      contractId: contract.id, scope: contract.scope, recordClass: "MEETING_OUTCOME" as const, slug: contract.tenant.slug, kind: contract.kind,
    })));
    setExtraSittingWindowSources(new Map(contracts.map((contract) => [contract.id, [contract.doorId]] as const)));
    outcomePartitionsCurrent = true;
    return { refreshed: true, partitions: contracts.length, skipped, reason: null };
  } catch (error) {
    return {
      refreshed: false,
      partitions: OUTCOME_PARTITION_CONTRACTS.length,
      skipped: [],
      reason: `the registry's doors could not be built into outcome work (${error instanceof Error ? error.message : String(error)}), so the previous list stays in use`,
    };
  }
}

export function outcomePartitionContract(id: string): OutcomePartitionContract | null {
  return OUTCOME_PARTITION_CONTRACTS.find((contract) => contract.id === id) ?? null;
}

export function outcomePartitionForDoor(doorId: string): OutcomePartitionContract | null {
  return OUTCOME_PARTITION_CONTRACTS.find((contract) => contract.doorId === doorId) ?? null;
}
