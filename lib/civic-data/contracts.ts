import { VALIDATION_CHECKS, type RoutineDataClassification, type RoutineRecordClass } from "./types.ts";
import type { SourceAuthorityId } from "./source-authority.ts";
import {
  OFFICIAL_STATE_LEGISLATOR_TARGETS,
  OFFICIAL_STATE_ROLL_CALL_TARGETS,
} from "../state-rollcalls/authority.ts";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

export interface RoutineCadencePolicy {
  readonly description: string;
  readonly defaultEveryMs: number;
  readonly phases?: readonly {
    readonly through: string;
    readonly everyMs: number;
    readonly description: string;
  }[];
}

/**
 * **MEETING SOURCES FOLLOW THEIR SITTINGS** (owner decision, 2026-09-24).
 *
 * A meeting source is re-read hourly while its body has any sitting, upcoming
 * or past, within seven days of now, and twice daily otherwise. The window
 * rolls with the clock: a sitting entering it makes the source hourly at that
 * instant, and the source leaves it seven days after its last sitting. It
 * covers calendars, agendas, changes, cancellations, decisions and minutes;
 * an outcome routine follows the partitions that carry its body's sittings.
 *
 * This is how often the runner re-reads, never how old a Reader may see a
 * record: Reader freshness stays on each contract's `cadence`, which must
 * outlast `baseEveryMs` so a re-read lands before the record reads STALE. No
 * other data family's schedule is changed by this policy.
 */
export interface SittingWindowSchedule {
  readonly kind: "SITTING_WINDOW";
  /** A sitting starting within this distance of now, on either side, makes the source hot. */
  readonly windowMs: number;
  readonly hotEveryMs: number;
  readonly baseEveryMs: number;
  /** The meeting partitions whose sittings drive this task; omitted means the task's own payload. */
  readonly follows?: readonly { readonly meetingSource: string; readonly bodyId: string }[];
}

export const MEETING_SITTING_WINDOW = {
  kind: "SITTING_WINDOW",
  windowMs: 7 * DAY,
  hotEveryMs: HOUR,
  baseEveryMs: 12 * HOUR,
} as const satisfies SittingWindowSchedule;

/** Polling admission is not acquisition; source contracts retain their own cadence. */
export const ROUTINE_DATA_ADMISSION_MS = 5 * 60_000;

/**
 * Whether a body has a sitting within the window of `nowMs`, from its
 * partitions' sitting starts. `undefined` means it cannot be told: a sitting
 * list could not be read.
 */
export function sittingWindowHot(
  schedule: SittingWindowSchedule,
  sittingLists: readonly (readonly string[] | undefined)[],
  nowMs: number,
): boolean | undefined {
  let unknown = sittingLists.length === 0;
  for (const starts of sittingLists) {
    if (starts === undefined) {
      unknown = true;
      continue;
    }
    for (const start of starts) {
      const at = Date.parse(start);
      if (Number.isFinite(at) && Math.abs(at - nowMs) <= schedule.windowMs) return true;
    }
  }
  return unknown ? undefined : false;
}

/** How long after its last success a sitting-window task is re-read; unknown counts as hot. */
export function sittingWindowRereadMs(schedule: SittingWindowSchedule, hot: boolean | undefined): number {
  return hot === false ? schedule.baseEveryMs : schedule.hotEveryMs;
}

/**
 * The instant a succeeded sitting-window task falls due: one re-read interval
 * after its store-observed success, less one admission pass, so "hourly" is
 * at most an hour and never drifts later pass by pass. The runner admits on it
 * and Admin shows it, so the owner sees the instant the runner acts on.
 */
export function sittingWindowDueAtMs(
  schedule: SittingWindowSchedule,
  succeededMs: number,
  hot: boolean | undefined,
): number {
  return succeededMs + sittingWindowRereadMs(schedule, hot) - ROUTINE_DATA_ADMISSION_MS;
}

export interface RoutineSourceContract {
  readonly id: string;
  readonly sourceId: SourceAuthorityId;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  /** Shared upstream lane; omitted contracts default to their source id. */
  readonly acquisitionFailureDomain?: string;
  readonly acquisitionAdapter:
    | {
        readonly authorityMode: "SINGLE_ROUTE";
        readonly command: readonly string[];
        readonly requestedUrl: string;
      }
    | {
        readonly authorityMode: "REGISTERED_SOURCE_ROUTES";
        readonly command: readonly string[];
      };
  readonly parserNormalizerVersion: string;
  readonly cadence: RoutineCadencePolicy;
  /** Omitted: the runner re-reads on `cadence`. See `SittingWindowSchedule`. */
  readonly schedule?: SittingWindowSchedule;
  readonly retry: { readonly afterMs: number; readonly description: string };
  readonly authorityConstraint: { readonly registry: "SOURCE_AUTHORITIES"; readonly sourceId: SourceAuthorityId };
  readonly validationContract: typeof VALIDATION_CHECKS;
  readonly canonicalProductionStore: "civic_data_candidates+civic_data_candidate_events+civic_data_promotions";
  readonly readerProjection: null | {
    readonly id: string;
    readonly consumers: readonly string[];
  };
  readonly lkgBehavior: string;
  readonly autoPromotable: boolean;
  /**
   * A fan-out contract owns a scope family: its per-state marker at `scope`
   * plus one bounded per-member candidate at `<sourceId>:<officeholderId>`. The
   * runner still enumerates and clocks exactly this one contract; the family
   * lives inside the acquisition child. Verification stays per-contract.
   */
  readonly fanOut?: boolean;
  readonly classification: RoutineDataClassification;
  /** Bundled inputs are seed/test material only; never a store-error fallback. */
  readonly bootstrapFixturePaths: readonly string[];
  /**
   * Terminal live-proof law. Omitted means two post-deploy source-authenticated
   * GOOD versions are required. A bounded source whose complete official
   * horizon is not yet available may instead prove one durable fail-closed
   * attempt while preserving an exact LKG or an honest not-recorded pointer.
   */
  readonly liveAcceptance?: {
    readonly kind: "AUTHENTICATED_FAIL_CLOSED_ATTEMPT";
    readonly acceptedStates: readonly ["SOURCE_BLOCKED", "HORIZON_UNRESOLVED"];
  };
}

const STORE = "civic_data_candidates+civic_data_candidate_events+civic_data_promotions" as const;
const CHECKS = VALIDATION_CHECKS;
const MEETING_CADENCE: RoutineCadencePolicy = {
  description: "daily through the 2026 general election, then weekly",
  defaultEveryMs: 7 * DAY,
  phases: [{ through: "2026-11-04T00:00:00.000Z", everyMs: DAY, description: "daily through 2026-11-03" }],
};

/**
 * Shared policy for SOURCE_WIRING-derived meeting partition contracts. This
 * is not itself a contract, pointer, promotion scope, or executable task.
 */
export const MEETING_PARTITION_POLICY = {
  sourceId: "meetings-public-bodies",
  recordClass: "MEETING",
  parserNormalizerVersion: "meetings-composite/2",
  cadence: MEETING_CADENCE,
  schedule: MEETING_SITTING_WINDOW,
  retry: { afterMs: HOUR, description: "one hour after a failed source/body attempt" },
  authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "meetings-public-bodies" },
  validationContract: CHECKS,
  canonicalProductionStore: STORE,
  autoPromotable: true,
  classification: "RUNTIME_CIVIC_DATA",
  readerConsumers: ["/api/meetings", "/api/agenda", "Ask", "Admin", "map"],
} as const;

/**
 * The single membership and lifecycle registry for every routine supported
 * production source. The runner and Admin derive from this array; workflows do
 * not schedule these contracts and no second cadence table may repeat them.
 */
export const ROUTINE_SOURCE_CONTRACTS: readonly RoutineSourceContract[] = [
  {
    id: "fec-funding",
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/fetch-fec.mts", "--promote"], requestedUrl: "https://api.open.fec.gov/v1/" },
    parserNormalizerVersion: "fec-funding/2",
    cadence: { description: "weekly", defaultEveryMs: 7 * DAY },
    retry: { afterMs: 6 * HOUR, description: "six hours after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "fec-open-api" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "funding-snapshot", consumers: ["lib/funding/snapshot.ts", "ballot", "funding", "Ask"] },
    lkgBehavior: "The current atomic pointer remains on the last GOOD FEC projection after every refused or failed attempt.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: ["data/fec/fec-2026.json"],
  },
  {
    id: "nh-members",
    sourceId: "nh-general-court",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/nh-gencourt-members.mts", "--promote"], requestedUrl: "https://gc.nh.gov/downloads/Members.txt" },
    parserNormalizerVersion: "nh-general-court/3",
    cadence: { description: "daily while the supported term is live", defaultEveryMs: DAY },
    retry: { afterMs: HOUR, description: "one hour after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "nh-general-court" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "nh-state-members", consumers: ["app/api/state-members/route.ts", "lib/ballot/seat-holders.ts", "ballot"] },
    lkgBehavior: "The current atomic pointer remains on the last GOOD complete official roster after refusal.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: ["data/states/nh/hunt/nh-gencourt-members.json"],
  },
  ...OFFICIAL_STATE_LEGISLATOR_TARGETS
    .filter((target) => target.contractId !== "nh-members")
    .map((target): RoutineSourceContract => ({
      id: target.contractId,
      sourceId: target.sourceId,
      recordClass: "STATE_LEGISLATOR",
      scope: target.jurisdiction,
      acquisitionFailureDomain: `routine-source:${target.sourceId}`,
      acquisitionAdapter: {
        authorityMode: "REGISTERED_SOURCE_ROUTES",
        command: ["scripts/state-legislators.mts", "--promote", `--state=${target.state}`],
      },
      parserNormalizerVersion: `${target.sourceId}/2`,
      cadence: { description: "daily while the supported legislative term is live", defaultEveryMs: DAY },
      retry: { afterMs: HOUR, description: "one hour after a failed or incomplete official roster attempt" },
      authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: target.sourceId },
      validationContract: CHECKS,
      canonicalProductionStore: STORE,
      readerProjection: {
        id: `${target.state.toLowerCase()}-official-state-legislators`,
        consumers: ["lib/registry/server.ts", "app/api/state-members/route.ts", "map", "ballot", "Ask", "Admin"],
      },
      lkgBehavior:
        `Only ${target.publisher} evidence may move ${target.jurisdiction}. An unavailable or incomplete roster leaves that state's prior GOOD pointer live and cannot affect another state.`,
      autoPromotable: true,
      classification: "RUNTIME_CIVIC_DATA",
      bootstrapFixturePaths: [],
    })),
  ...OFFICIAL_STATE_ROLL_CALL_TARGETS.map((target): RoutineSourceContract => {
    // New Hampshire promotes through the per-legislator fan-out — one contract,
    // one per-state clock, bounded per-member writes — so the largest
    // legislature we will ever load never exceeds the write path. Arizona and
    // New Jersey keep the per-jurisdiction STATE_ROLL_CALL path until they are
    // migrated the same way.
    const fanOut = target.state === "NH";
    return {
      id: target.contractId,
      sourceId: target.sourceId,
      recordClass: fanOut ? "STATE_LEGISLATOR_VOTES" : "STATE_ROLL_CALL",
      scope: target.jurisdiction,
      acquisitionFailureDomain: `routine-source:${target.sourceId}`,
      acquisitionAdapter: {
        authorityMode: "REGISTERED_SOURCE_ROUTES",
        command: ["scripts/state-rollcalls.mts", "--promote", `--state=${target.state}`],
      },
      parserNormalizerVersion: target.state === "NH" ? "nh-general-court/3" : `${target.sourceId}/2`,
      cadence: { description: "daily and after each legislative sitting", defaultEveryMs: DAY },
      retry: { afterMs: HOUR, description: "one hour after a failed or incomplete official horizon attempt" },
      authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: target.sourceId },
      validationContract: CHECKS,
      canonicalProductionStore: STORE,
      readerProjection: {
        id: fanOut
          ? `${target.state.toLowerCase()}-official-state-legislator-votes`
          : `${target.state.toLowerCase()}-official-state-rollcalls`,
        consumers: ["app/api/votes/route.ts", "lib/ask/votes.ts", "Ask", "map", "ballot", "Admin"],
      },
      lkgBehavior:
        `Only ${target.publisher} evidence may move ${target.jurisdiction}. An unavailable or incomplete horizon leaves that state's prior GOOD pointer live and cannot affect another state.`,
      autoPromotable: true,
      ...(fanOut ? { fanOut: true as const } : {}),
      classification: "RUNTIME_CIVIC_DATA",
      // The retained LegiScan aggregate is research/test evidence, never a
      // bootstrap or store-error fallback for an official production pointer.
      bootstrapFixturePaths: [],
      ...(target.state === "AZ" ? {
        liveAcceptance: {
          kind: "AUTHENTICATED_FAIL_CLOSED_ATTEMPT" as const,
          acceptedStates: ["SOURCE_BLOCKED", "HORIZON_UNRESOLVED"] as const,
        },
      } : {}),
    };
  }),
  {
    id: "census-acs-population",
    sourceId: "census-data-api",
    recordClass: "CENSUS_REFERENCE",
    scope: "acs-population",
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/acs-population-promote.mts"], requestedUrl: "https://api.census.gov/data/2024/acs/acs5" },
    parserNormalizerVersion: "census-data-api/2",
    cadence: { description: "monthly check for the supported Census product vintage", defaultEveryMs: 30 * DAY },
    retry: { afterMs: 6 * HOUR, description: "six hours after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "census-data-api" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "acs-population-reference", consumers: ["lib/reference/acs-population.ts", "readiness", "Admin"] },
    lkgBehavior: "The current atomic pointer remains on the last GOOD complete ACS projection after refusal.",
    autoPromotable: true,
    classification: "OPERATIONAL_REFERENCE_DATA",
    bootstrapFixturePaths: ["data/reference/acs5_2024_b01003_zcta.csv", "data/reference/acs5_2024_b01003_state.csv"],
  },
  {
    id: "census-geography-overlaps",
    sourceId: "census-geography-relationships",
    recordClass: "CENSUS_GEOGRAPHY",
    scope: "US:zcta-geography-overlaps",
    acquisitionAdapter: { authorityMode: "REGISTERED_SOURCE_ROUTES", command: ["scripts/census-geography-refresh.mts"] },
    parserNormalizerVersion: "census-geography-overlaps/1",
    cadence: { description: "monthly check for a new Census relationship-file vintage", defaultEveryMs: 30 * DAY },
    retry: { afterMs: 6 * HOUR, description: "six hours after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "census-geography-relationships" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: {
      id: "census-geography-zcta-overlaps",
      consumers: ["lib/census-geography/reader.ts", "Admin scope preview", "Admin collection assignments", "Admin geographic reporting"],
    },
    lkgBehavior: "A missing, malformed, empty, or internally inconsistent ZCTA-overlap dataset records a refusal and leaves the prior promoted census-geography version live.",
    autoPromotable: true,
    classification: "OPERATIONAL_REFERENCE_DATA",
    bootstrapFixturePaths: ["lib/census-geography/bootstrap-az.json"],
  },
  {
    id: "nj-morris-filing",
    sourceId: "nj-morris-county-clerk",
    recordClass: "BALLOT_FILING",
    scope: "US-NJ:county:morris:2026-general",
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/build-nj-morris-ballot.mts", "--promote"], requestedUrl: "https://www.morriscountyclerk.org/" },
    parserNormalizerVersion: "nj-morris-filing/2",
    cadence: {
      description: "daily through the 2026 general election, then weekly",
      defaultEveryMs: 7 * DAY,
      phases: [{ through: "2026-11-04T00:00:00.000Z", everyMs: DAY, description: "daily through 2026-11-03" }],
    },
    retry: { afterMs: HOUR, description: "one hour after a failed filing attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "nj-morris-county-clerk" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "nj-morris-ballot", consumers: ["ballot", "Ask", "candidate contact operations"] },
    lkgBehavior: "The current ballot pointer and complete removal history remain on the last GOOD filing projection after refusal.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: ["data/states/nj/ballot/nj-morris-2026.json", "data/states/nj/ballot/nj-morris-2026-contacts.json"],
  },
  {
    id: "pima-legistar-outcomes",
    sourceId: "pima-legistar-outcomes",
    recordClass: "MEETING_OUTCOME",
    scope: "US-AZ:county:pima:legistar-outcomes",
    acquisitionAdapter: {
      authorityMode: "SINGLE_ROUTE",
      command: ["scripts/legistar-outcomes-ingest.mts", "--promote", "--slug", "pima"],
      requestedUrl: "https://webapi.legistar.com/v1/pima/events",
    },
    parserNormalizerVersion: "pima-legistar-outcomes/2",
    // Reader freshness only; re-reads follow the Board's sitting window below.
    // Fourteen hours outlasts the twelve-hour re-read plus one failed retry.
    cadence: {
      description: "fresh for fourteen hours through the 2026 general election, then a day",
      defaultEveryMs: DAY,
      phases: [{ through: "2026-11-04T00:00:00.000Z", everyMs: 14 * HOUR, description: "fourteen hours through 2026-11-03" }],
    },
    // The Board of Supervisors' sittings are carried by both of its partitions:
    // the Legistar Web API events and the InSite portal grid.
    schedule: {
      ...MEETING_SITTING_WINDOW,
      follows: [
        { meetingSource: "legistar", bodyId: "ocd-division/country:us/state:az/county:pima#governing" },
        { meetingSource: "legistar-insite", bodyId: "ocd-division/country:us/state:az/county:pima#governing" },
      ],
    },
    retry: { afterMs: HOUR, description: "one hour after a failed events, items, or votes attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "pima-legistar-outcomes" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "pima-legistar-outcomes", consumers: ["agenda", "Ask", "meeting Reader records", "map"] },
    lkgBehavior: "A failed sitting/items/votes acquisition is stored as a refused candidate; prior GOOD outcomes remain live and later unaffected sitting candidates may still promote.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: ["data/states/az/outcomes/legistar-outcomes.json"],
  },
  {
    id: "dotgov",
    sourceId: "cisa-dotgov-registry",
    recordClass: "DOTGOV_REFERENCE",
    scope: "US:current-full:election-domains",
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/fetch-dotgov.mts", "--promote"], requestedUrl: "https://api.github.com/repos/cisagov/dotgov-data/commits?path=current-full.csv&per_page=1" },
    parserNormalizerVersion: "cisa-dotgov/2",
    cadence: { description: "monthly", defaultEveryMs: 30 * DAY },
    retry: { afterMs: 6 * HOUR, description: "six hours after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "cisa-dotgov-registry" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: null,
    lkgBehavior: "The current operational pointer remains on the last GOOD complete CISA registry projection after refusal.",
    autoPromotable: true,
    classification: "OPERATIONAL_REFERENCE_DATA",
    bootstrapFixturePaths: ["data/dotgov/snapshot.json"],
  },
] as const;

export function cadenceMsAt(contract: Pick<RoutineSourceContract, "cadence">, nowMs: number): number {
  for (const phase of contract.cadence.phases ?? []) {
    const through = Date.parse(phase.through);
    if (Number.isFinite(through) && nowMs < through) return phase.everyMs;
  }
  return contract.cadence.defaultEveryMs;
}

export function routineContract(id: string): RoutineSourceContract | null {
  return ROUTINE_SOURCE_CONTRACTS.find((contract) => contract.id === id) ?? null;
}

export function requiredRoutineContract(id: string): RoutineSourceContract {
  const contract = routineContract(id);
  if (!contract) throw new Error(`ROUTINE_SOURCE_CONTRACT_MISSING:${id}`);
  return contract;
}

/** Reader freshness is derived from the same phase policy as standing execution. */
export function routineFreshnessMs(id: string, now: string): number {
  return cadenceMsAt(requiredRoutineContract(id), Date.parse(now));
}

export function meetingPartitionFreshnessMs(now: string): number {
  return cadenceMsAt({ cadence: MEETING_PARTITION_POLICY.cadence }, Date.parse(now));
}
