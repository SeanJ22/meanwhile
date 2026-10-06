/**
 * DB-22: outcomes are a capability of a door kind, not of a place.
 *
 * A door of kind `legistar` (the Legistar Web API) or `legistar-insite` (the portal's calendar and minutes) that holds
 * `outcomes` as well as `meetings` collects the body's agenda actions, decisions and roll calls, in its own scope and
 * under its own pointer, with no code release. The two per-place contracts that came first (`pima-legistar-outcomes`,
 * `mesa-legistar-minutes-outcomes`) stay as they are until a live read of the door-built contracts matches them: a
 * door that names the same body and route as one of them is not built twice.
 *
 * The contracts are rebuilt from the registry's doors at the start of a pass (`refreshDoorsForPass`), swapped in only
 * when every one builds, so a door that cannot be built leaves the previous list in place. With the registry switch
 * off the list is empty and nothing changes.
 */
import { MEETING_SITTING_WINDOW, type RoutineSourceContract } from "./contracts.ts";
import { VALIDATION_CHECKS } from "./types.ts";
import { meetingAcquisitionFailureDomain, meetingPartitionId, setExtraSittingWindowSources } from "./meeting-partitions.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "./runtime-routine-contracts.ts";
import type { BodySourceWiring } from "../registry/source-wiring.ts";
import { wiringRowsFromDoors } from "../doors/rows.ts";
import type { DoorRecord } from "../doors/registry.ts";
import type { OutcomeTenant } from "../outcomes/data-plane.ts";
import { setDoorOutcomePointers } from "../outcomes/door-outcome-pointers.ts";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

/** The source authority every door-built outcome contract promotes under (`source-authority.ts`). */
export const DOOR_OUTCOMES_SOURCE_ID = "door-outcomes" as const;

/** The hold a door names to collect outcomes. */
export const OUTCOMES_HOLD = "outcomes";

export const OUTCOME_DOOR_KINDS = ["legistar", "legistar-insite"] as const;
export type OutcomeDoorKind = (typeof OUTCOME_DOOR_KINDS)[number];

/**
 * Routes the per-place contracts already read. A door on one of these is served by that contract until the door-built
 * one is checked live against it; building both would write each sitting twice.
 */
const STILL_ON_PLACE_CONTRACT: ReadonlySet<string> = new Set(["legistar:pima", "legistar-insite:mesa"]);

export interface OutcomePartitionContract extends RoutineSourceContract {
  /** The meeting door this partition reads, i.e. its meeting partition id. */
  readonly doorId: string;
  readonly kind: OutcomeDoorKind;
  readonly bodyId: string;
  readonly tenant: OutcomeTenant;
  /** The wiring row the door describes; the ingest builds its Legistar client from it. */
  readonly wiring: BodySourceWiring;
  /** The Legistar event body id to read when the door names one, else the whole tenant's events. */
  readonly eventBodyId: number | null;
}

export function outcomePartitionId(doorId: string): string {
  return `${doorId}:outcomes`;
}

export function outcomePartitionScope(doorId: string): string {
  return `door:${encodeURIComponent(doorId)}:outcomes`;
}

export function isOutcomePartitionScope(scope: string): boolean {
  return scope.startsWith("door:") && scope.endsWith(":outcomes");
}

/** `ocd-division/country:us/state:az/county:pima` -> `US-AZ`; null when the id names no state. */
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

/** The doors that collect outcomes: a Legistar kind, a meeting door, holding `outcomes`, not suspended. */
export function outcomeDoors(doors: readonly DoorRecord[]): readonly DoorRecord[] {
  return doors.filter((door) =>
    door.status !== "SUSPENDED" && door.meeting != null && door.meeting.family === null && door.bodyIds.length === 1 &&
    outcomeDoorKind(door) !== null && door.holds.includes(OUTCOMES_HOLD));
}

export interface OutcomePartitionBuild {
  readonly contracts: OutcomePartitionContract[];
  /** Doors left out, each with the reason in a sentence. One door that cannot be built never holds back another. */
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
  return {
    id,
    sourceId: DOOR_OUTCOMES_SOURCE_ID,
    recordClass: "MEETING_OUTCOME",
    scope,
    // The body's own lane: its outcomes are read from the host its meetings are, one request at a time.
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
    // Reader freshness as the per-place outcomes: the twelve-hour re-read plus one failed retry lands inside it.
    cadence: {
      description: "fresh for fourteen hours through the 2026 general election, then a day",
      defaultEveryMs: DAY,
      phases: [{ through: "2026-11-04T00:00:00.000Z", everyMs: 14 * HOUR, description: "fourteen hours through 2026-11-03" }],
    },
    // Re-reads follow the body's sittings, which its meeting door carries.
    schedule: { ...MEETING_SITTING_WINDOW, follows: [{ meetingSource: kind, bodyId: door.bodyIds[0] }] },
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

/** The door-built outcome contracts in use now; empty until the registry's doors are read. Replaced in place. */
export const OUTCOME_PARTITION_CONTRACTS: OutcomePartitionContract[] = [];

let outcomePartitionsCurrent = false;

/**
 * Whether this process built its list from a registry read. A publisher that combines the doors' outcomes for the
 * Reader must not publish from an empty list that only means "the doors were not read"; it carries what is served.
 */
export function outcomePartitionsAreCurrent(): boolean {
  return outcomePartitionsCurrent;
}

export interface OutcomePartitionRefresh {
  readonly refreshed: boolean;
  readonly partitions: number;
  /** Doors left out of this pass, with why; empty when every door built. */
  readonly skipped: readonly { readonly doorId: string; readonly why: string }[];
  readonly reason: string | null;
}

/**
 * Rebuild the list from the doors in use. Built first and swapped in only if every door builds, so a door that cannot
 * be built (no slug, no state, a collision) leaves the last good list in place.
 */
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
