import { VALIDATION_CHECKS, type RoutineDataClassification, type RoutineRecordClass } from "./types.ts";
import type { SourceAuthorityId } from "./source-authority.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "./runtime-routine-contracts.ts";
import { FEDERAL_SOURCE_IDS, FEDERAL_SOURCES, FEDERAL_PARSER_VERSION, FEDERAL_RECORD_CLASS, federalScope } from "../sources/congress/targets.ts";
import {
  OFFICIAL_STATE_LEGISLATOR_TARGETS,
  OFFICIAL_STATE_ROLL_CALL_TARGETS,
} from "../state-rollcalls/authority.ts";
import { REGISTRATION_PARSER_VERSION, REGISTRATION_SOURCE_ID, REGISTRATION_TARGETS } from "../registration/publication.ts";

import { PLURAL_STATES, PLURAL_PARSER_VERSION, PLURAL_SOURCE_ID } from "../sources/plural/targets.ts";
import { GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_SCOPE, GOOGLE_CIVIC_PARSER_VERSION } from "../sources/google-civic/targets.ts";
import { PEOPLE_SOURCE_CONTRACTS } from "./people-source-contracts.ts";
import { OPEN_DATA_SOURCES, OPEN_DATA_PARSER, OPEN_DATA_CLOCKS, SOCRATA_CATALOG, ECHO_EXPORT } from "../sources/open-data/model.ts";

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

export const ROUTINE_DATA_ADMISSION_MS = 5 * 60_000;

export const PLAIN_ENGLISH_TRANSLATION_ROUTINE = {
  id: "plain-english-translations",
  inputRecordClass: "BALLOT_MEASURE",
  heldInputKinds: ["MEASURE", "BODY_CLASS", "BODY", "OFFICE", "AGENDA", "MINUTES"],
  publicationRecordClass: "CURATED_READER_RECORD",
  execution: "EXISTING_GUARDED_WORKER",
  trigger: "HELD_SOURCE_CHANGED",
  retryAfterMs: 15 * 60_000,
  readerConsumers: ["/ballot", "body and office cards", "meeting cards", "Ask"],
} as const;

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
      }
    | {
        readonly authorityMode: "DERIVED";
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
  /** Zero keeps finite standing work alive; its individual requests still have transport deadlines. */
  readonly childTimeoutMs?: number;
  /**
   * A fan-out contract owns a scope family: its clock marker at `scope`
   * plus bounded member or session candidates under `<sourceId>:`. The
   * runner still enumerates and clocks exactly this one contract; the family
   * lives inside the acquisition child. Verification stays per-contract.
   */
  readonly fanOut?: boolean;
  readonly classification: RoutineDataClassification;
  /** Bundled inputs are seed/test material only; never a store-error fallback. */
  readonly bootstrapFixturePaths: readonly string[];
}

const STORE = "civic_data_candidates+civic_data_candidate_events+civic_data_promotions" as const;
const CHECKS = VALIDATION_CHECKS;
const MEETING_CADENCE: RoutineCadencePolicy = {
  description: "daily through the 2026 general election, then weekly",
  defaultEveryMs: 7 * DAY,
  phases: [{ through: "2026-11-04T00:00:00.000Z", everyMs: DAY, description: "daily through 2026-11-03" }],
};

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

export const DERIVED_MEETING_FAMILY_STATES: readonly DerivedMeetingFamilyState[] = REGISTRATION_TARGETS.map(
  (target) => target.jurisdiction as DerivedMeetingFamilyState,
);
export type DerivedMeetingFamilyState = `US-${string}`;

export const DERIVED_MEETING_FAMILY_POLICY = {
  sourceId: "meetings-derived-routes",
  recordClass: "MEETING",
  parserNormalizerVersion: "meetings-composite/2",
  cadence: MEETING_CADENCE,
  schedule: MEETING_SITTING_WINDOW,
  retry: { afterMs: 6 * HOUR, description: "six hours after a failed family attempt; a family with no member yet holds, and says so" },
  authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "meetings-derived-routes" },
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
    acquisitionAdapter: { authorityMode: "REGISTERED_SOURCE_ROUTES", command: ["scripts/fetch-fec.mts", "--promote"] },
    parserNormalizerVersion: "fec-funding/4",
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
    readerProjection: { id: "nh-state-members", consumers: ["lib/ballot/seat-holders.ts", "ballot"] },
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
        consumers: ["lib/registry/server.ts", "map", "ballot", "Ask", "Admin"],
      },
      lkgBehavior:
        `Only ${target.publisher} evidence may move ${target.jurisdiction}. An unavailable or incomplete roster leaves that state's prior GOOD pointer live and cannot affect another state.`,
      autoPromotable: true,
      classification: "RUNTIME_CIVIC_DATA",
      bootstrapFixturePaths: [],
    })),
  ...PLURAL_STATES.map((state): RoutineSourceContract => ({
    id: `openstates-people-${state}`,
    sourceId: PLURAL_SOURCE_ID,
    recordClass: "STATE_LEGISLATOR",
    scope: `US-${state.toUpperCase()}:openstates-people:v1`,
    acquisitionFailureDomain: `routine-source:${PLURAL_SOURCE_ID}:${state}`,
    acquisitionAdapter: { authorityMode: "REGISTERED_SOURCE_ROUTES", command: ["scripts/openstates-people-refresh.mts", "--promote", `--state=${state}`] },
    parserNormalizerVersion: PLURAL_PARSER_VERSION,
    cadence: { description: "daily known-source people refresh, independent of Sends", defaultEveryMs: DAY },
    retry: { afterMs: HOUR, description: "one hour after a failed state acquisition; other states remain independent" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: PLURAL_SOURCE_ID },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: `${state}-openstates-people`, consumers: ["lib/registry/server.ts", "people", "map", "ballot", "Ask", "Admin"] },
    lkgBehavior: "Unusable release bytes leave this state's existing people live. Official source facts retain their authority; source-native people do not require local boundary coverage.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  })),
  ...PLURAL_STATES.map((state): RoutineSourceContract => ({
    id: `openstates-votes-${state}`,
    sourceId: "plural-openstates-votes",
    recordClass: "STATE_ROLL_CALL",
    scope: `US-${state.toUpperCase()}:openstates-votes:v1`,
    acquisitionFailureDomain: `routine-source:plural-openstates-votes:${state}`,
    acquisitionAdapter: { authorityMode: "REGISTERED_SOURCE_ROUTES", command: ["scripts/openstates-votes-refresh.mts", "--promote", `--state=${state}`] },
    parserNormalizerVersion: "plural-votes/2",
    cadence: { description: "daily public bulk session votes; Open States API v3 fallback", defaultEveryMs: DAY },
    retry: { afterMs: HOUR, description: "retry failed state sources independently; unchanged votes are successful checks" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "plural-openstates-votes" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: `${state}-openstates-native-votes`, consumers: ["app/api/votes/route.ts", "lib/ask/votes.ts", "Ask", "map", "ballot", "Admin"] },
    lkgBehavior: "Exact Open States person positions publish independently. Incomplete acquisition preserves earlier votes and sessions; zero added votes makes no absence claim.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  })),
  ...PLURAL_STATES.map((state): RoutineSourceContract => ({
    id: `legiscan-votes-${state}`,
    sourceId: "legiscan",
    recordClass: "STATE_ROLL_CALL",
    scope: `US-${state.toUpperCase()}:legiscan-votes:v1`,
    acquisitionFailureDomain: `routine-source:legiscan:${state}`,
    acquisitionAdapter: { authorityMode: "REGISTERED_SOURCE_ROUTES", command: ["scripts/legiscan-votes-refresh.mts", "--promote", `--state=${state}`] },
    parserNormalizerVersion: "legiscan-votes/1",
    cadence: { description: "weekly LegiScan session datasets", defaultEveryMs: 7 * DAY },
    retry: { afterMs: HOUR, description: "retry failed state datasets independently" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "legiscan" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: `${state}-legiscan-votes`, consumers: ["app/api/votes/route.ts", "lib/ask/votes.ts", "Ask", "map", "ballot", "Admin"] },
    lkgBehavior: "Attributed LegiScan roll calls attach only through exact Open States person crosswalks. Failed datasets preserve previously verified positions.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  })),
  ...OFFICIAL_STATE_ROLL_CALL_TARGETS.filter(target => target.state !== "AZ").map((target): RoutineSourceContract => {
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
      bootstrapFixturePaths: [],
    };
  }),
  {
    id: "census-acs-population",
    sourceId: "census-data-api",
    recordClass: "CENSUS_REFERENCE",
    scope: "acs-population",
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/acs-population-promote.mts"], requestedUrl: "https://api.census.gov/data/" },
    parserNormalizerVersion: "census-data-api/3",
    cadence: { description: "monthly check of Census's annual ACS five-year release catalog; read the newest published vintage", defaultEveryMs: 30 * DAY },
    retry: { afterMs: 6 * HOUR, description: "six hours after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "census-data-api" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "acs-population-reference", consumers: ["lib/reference/acs-population.ts", "readiness", "Admin", "data business", "Ask"] },
    lkgBehavior: "The current atomic pointer remains on the last GOOD complete ACS projection after refusal.",
    autoPromotable: true,
    classification: "OPERATIONAL_REFERENCE_DATA",
    bootstrapFixturePaths: [],
  },
  {
    id: "census-geography-overlaps",
    sourceId: "census-geography-relationships",
    recordClass: "CENSUS_GEOGRAPHY",
    scope: "US:zcta-geography-overlaps",
    acquisitionAdapter: { authorityMode: "REGISTERED_SOURCE_ROUTES", command: ["scripts/census-geography-refresh.mts"] },
    parserNormalizerVersion: "census-geography-overlaps/2",
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
    bootstrapFixturePaths: [],
  },
  {
    id: "pima-legistar-outcomes",
    sourceId: "pima-legistar-outcomes",
    recordClass: "MEETING_OUTCOME",
    scope: "US-AZ:county:pima:legistar-outcomes",
    acquisitionAdapter: {
      // Native body lookup, events, items and votes all stay within the registered Pima tenant.
      authorityMode: "REGISTERED_SOURCE_ROUTES",
      command: ["scripts/legistar-outcomes-ingest.mts", "--promote", "--slug", "pima"],
    },
    parserNormalizerVersion: "pima-legistar-outcomes/2",
    // Fourteen hours outlasts the twelve-hour re-read plus one failed retry.
    cadence: {
      description: "fresh for fourteen hours through the 2026 general election, then a day",
      defaultEveryMs: DAY,
      phases: [{ through: "2026-11-04T00:00:00.000Z", everyMs: 14 * HOUR, description: "fourteen hours through 2026-11-03" }],
    },
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
    bootstrapFixturePaths: [],
  },
  {
    id: "mesa-legistar-minutes-outcomes",
    sourceId: "mesa-legistar-minutes-outcomes",
    recordClass: "MEETING_OUTCOME",
    scope: "US-AZ:place:mesa:legistar-minutes-outcomes",
    acquisitionFailureDomain: "meeting-upstream:mesa.legistar.com",
    acquisitionAdapter: {
      authorityMode: "SINGLE_ROUTE",
      command: ["scripts/legistar-insite-minutes-ingest.mts", "--promote", "--slug", "mesa"],
      requestedUrl: "https://mesa.legistar.com/Calendar.aspx",
    },
    parserNormalizerVersion: "mesa-legistar-minutes-outcomes/1",
    cadence: {
      description: "fresh for fourteen hours through the 2026 general election, then a day",
      defaultEveryMs: DAY,
      phases: [{ through: "2026-11-04T00:00:00.000Z", everyMs: 14 * HOUR, description: "fourteen hours through 2026-11-03" }],
    },
    schedule: {
      ...MEETING_SITTING_WINDOW,
      follows: [{ meetingSource: "legistar-insite", bodyId: "ocd-division/country:us/state:az/place:mesa#governing" }],
    },
    retry: { afterMs: HOUR, description: "one hour after a failed calendar or minutes read" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "mesa-legistar-minutes-outcomes" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "mesa-legistar-minutes-outcomes", consumers: ["agenda", "Ask", "meeting Reader records", "map"] },
    lkgBehavior: "A failed calendar or minutes read is stored as a refused candidate; prior GOOD outcomes remain live, and a sitting whose minutes are not yet published is recorded as such, never as a sitting without decisions.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  },
  {
    id: "dotgov",
    sourceId: "cisa-dotgov-registry",
    recordClass: "DOTGOV_REFERENCE",
    scope: "US:current-full:domains",
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/fetch-dotgov.mts", "--promote"], requestedUrl: "https://api.github.com/repos/cisagov/dotgov-data/commits?path=current-full.csv&per_page=1" },
    parserNormalizerVersion: "cisa-dotgov/3",
    cadence: { description: "monthly", defaultEveryMs: 30 * DAY },
    retry: { afterMs: 6 * HOUR, description: "six hours after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "cisa-dotgov-registry" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "government-domains", consumers: ["government listings", "government detail", "Ask"] },
    lkgBehavior: "The current government-domain pointer remains on the last GOOD complete CISA registry projection after refusal.",
    autoPromotable: true,
    classification: "OPERATIONAL_REFERENCE_DATA",
    bootstrapFixturePaths: [],
  },
  ...REGISTRATION_TARGETS.map((target): RoutineSourceContract => ({
    id: target.contractId,
    sourceId: REGISTRATION_SOURCE_ID,
    recordClass: "REGISTRATION",
    scope: target.scope,
    acquisitionFailureDomain: `routine-source:${REGISTRATION_SOURCE_ID}:${target.state}`,
    acquisitionAdapter: {
      authorityMode: "REGISTERED_SOURCE_ROUTES",
      command: ["scripts/registration-refresh.mts", "--promote", `--state=${target.state}`],
    },
    parserNormalizerVersion: REGISTRATION_PARSER_VERSION,
    // Versioned held bytes are replayed before a conditional publisher check.
    cadence: { description: "known government and school directory checks every 90 days", defaultEveryMs: 90 * DAY },
    retry: { afterMs: 6 * HOUR, description: "six hours after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: REGISTRATION_SOURCE_ID },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: `${target.state.toLowerCase()}-registration`, consumers: ["lib/registration/reader.ts"] },
    lkgBehavior:
      `Versioned known-source government listings may move ${target.jurisdiction}'s registration after validation. An unavailable or incomplete release leaves that state's prior GOOD registration live and cannot affect another state.`,
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  })),
  {
    id: "meeting-body-crosswalk-derived",
    sourceId: "meeting-source-wiring",
    recordClass: "CURATED_READER_RECORD",
    scope: "US:meeting-body-crosswalk-derived",
    acquisitionFailureDomain: "derived:meeting-body-crosswalk",
    acquisitionAdapter: { authorityMode: "DERIVED", command: ["scripts/derive-meeting-body-crosswalk.mts", "--promote"] },
    parserNormalizerVersion: "meeting-source-wiring/1",
    cadence: { description: "every six hours", defaultEveryMs: 6 * HOUR },
    retry: { afterMs: 6 * HOUR, description: "six hours after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "meeting-source-wiring" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "meeting-body-crosswalk-derived", consumers: ["derived meeting-source wiring", "Admin"] },
    lkgBehavior: "A version with a malformed row, a conflicting pair, an input the door cannot find promoted, or any other failed check records its refusal and leaves the prior GOOD rows live; an accepted row is never dropped, and an outage or an absent walk carries it exactly as it was.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  },
  {
    id: "meeting-doors",
    sourceId: "meeting-doors",
    recordClass: "CURATED_READER_RECORD",
    scope: "US:meeting-doors",
    acquisitionFailureDomain: "derived:meeting-doors",
    acquisitionAdapter: { authorityMode: "DERIVED", command: ["scripts/publish-meeting-doors.mts", "--promote"] },
    parserNormalizerVersion: "meeting-doors/1",
    cadence: { description: "at the start of every routine pass, before any meeting door is read", defaultEveryMs: ROUTINE_DATA_ADMISSION_MS },
    retry: { afterMs: ROUTINE_DATA_ADMISSION_MS, description: "the next routine pass" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "meeting-doors" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "meeting-doors", consumers: ["meeting partitions", "the Reader's covered bodies", "agenda reads", "Admin"] },
    lkgBehavior: "A version with no door, a malformed door or an input the door cannot vouch for is refused and the prior GOOD doors stay in use; an unchanged registry re-confirms the version it already points at.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  },
  {
    id: "meeting-source-wiring",
    sourceId: "meeting-source-wiring",
    recordClass: "CURATED_READER_RECORD",
    scope: "US:meeting-source-wiring",
    acquisitionFailureDomain: "derived:meeting-source-wiring",
    acquisitionAdapter: { authorityMode: "DERIVED", command: ["scripts/derive-meeting-source-wiring.mts", "--promote"] },
    parserNormalizerVersion: "meeting-source-wiring/1",
    cadence: { description: "every six hours", defaultEveryMs: 6 * HOUR },
    retry: { afterMs: 6 * HOUR, description: "six hours after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "meeting-source-wiring" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "meeting-source-wiring", consumers: ["derived meeting families", "Admin"] },
    lkgBehavior: "A version with a refused decision, an input the door cannot find promoted, or any other failed check records its refusal and leaves the prior GOOD wiring live; no row is ever dropped, and a suspended row stays marked until a later review.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  },
  {
    id: "candidate-campaign-sites-derived",
    sourceId: "candidate-campaign-site-chain",
    recordClass: "CURATED_READER_RECORD",
    scope: "US:candidate-campaign-sites-derived",
    acquisitionFailureDomain: "derived:candidate-campaign-sites",
    acquisitionAdapter: { authorityMode: "DERIVED", command: ["scripts/derive-candidate-campaign-sites.mts", "--promote"] },
    parserNormalizerVersion: "candidate-campaign-site-chain/1",
    cadence: { description: "hourly, the research cycle's own rhythm", defaultEveryMs: HOUR },
    retry: { afterMs: HOUR, description: "one hour after a failed attempt" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "candidate-campaign-site-chain" },
    validationContract: CHECKS,
    canonicalProductionStore: STORE,
    readerProjection: { id: "candidate-verified-campaign-sites", consumers: ["/ballot", "Ask candidate profiles"] },
    lkgBehavior: "A pass that cannot read the pipeline's approvals, the promoted candidate-profiles version or an approval's vaulted bytes records its refusal and leaves the prior GOOD sites live; an approval whose vaulted bytes no longer verify is held by name and not published.",
    autoPromotable: true,
    classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  },
  {
    id: "legiscan-bulk", sourceId: "legiscan-bills", recordClass: "STATE_BILL", scope: "US:legiscan-datasets",
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/legiscan-bulk.mts", "--promote"], requestedUrl: "https://api.legiscan.com/?op=getDatasetList" },
    parserNormalizerVersion: "legiscan-bulk/2",
    cadence: { description: "weekly, following LegiScan's weekly dataset publication", defaultEveryMs: 7 * DAY },
    retry: { afterMs: HOUR, description: "one hour after a failed bulk pass; already published sessions remain live" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "legiscan-bills" },
    validationContract: CHECKS, canonicalProductionStore: STORE,
    readerProjection: { id: "legiscan-bills", consumers: ["legislator cards", "Ask"] },
    lkgBehavior: "Each complete session publishes independently; failed archives leave prior bills live. Unchanged dataset hashes confirm success. Unjoined bills and sponsors remain in the session with their reason.",
    autoPromotable: true, fanOut: true, classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: [],
  },
  {
    id: GOOGLE_CIVIC_SOURCE_ID,
    sourceId: GOOGLE_CIVIC_SOURCE_ID,
    recordClass: "GOOGLE_CIVIC_VOTERINFO",
    scope: GOOGLE_CIVIC_SCOPE,
    acquisitionAdapter: { authorityMode: "REGISTERED_SOURCE_ROUTES", command: ["scripts/google-civic-refresh.mts", "--promote"] },
    parserNormalizerVersion: GOOGLE_CIVIC_PARSER_VERSION,
    cadence: { description: "daily elections-catalog checks through November 3; weekly outside the election window; voterinfo only on an explicit reader fallback where official sources are absent", defaultEveryMs: 7 * DAY,
      phases: [{ through: "2026-11-04T00:00:00.000Z", everyMs: DAY, description: "daily through the November 3 election" }] },
    retry: { afterMs: HOUR, description: "one hour after source failure; honor provider Retry-After" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: GOOGLE_CIVIC_SOURCE_ID },
    validationContract: CHECKS, canonicalProductionStore: STORE,
    readerProjection: { id: "google-civic-voterinfo", consumers: ["ballot", "voting-sites", "Admin"] },
    lkgBehavior: "Failed catalog reads retain the prior catalog. Reader voterinfo is transient, explicitly requested only where official voting sources are absent; held source observations remain separate from official lists.",
    autoPromotable: true, fanOut: true, classification: "RUNTIME_CIVIC_DATA",
    bootstrapFixturePaths: ["tests/fixtures/google-civic/elections.json", "tests/fixtures/google-civic/az-voterinfo.json", "tests/fixtures/google-civic/mi-voterinfo.json", "tests/fixtures/google-civic/va-voterinfo.json"],
  },
  ...PEOPLE_SOURCE_CONTRACTS,
  ...OPEN_DATA_SOURCES.map((sourceId): RoutineSourceContract => ({
    id: sourceId, sourceId, recordClass: "CURATED_READER_RECORD", scope: `${sourceId}:national`,
    acquisitionFailureDomain: `routine-source:${sourceId}`,
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/open-data-refresh.mts", "--promote", `--source=${sourceId}`],
      requestedUrl: sourceId === "socrata-discovery" ? SOCRATA_CATALOG : ECHO_EXPORT },
    parserNormalizerVersion: OPEN_DATA_PARSER,
    cadence: { description: sourceId === "socrata-discovery" ? "Daily Discovery catalog refresh; each dataset retains its publisher's own update dates and frequency" : "Weekly EPA ECHO Exporter publication", defaultEveryMs: OPEN_DATA_CLOCKS[sourceId] },
    retry: { afterMs: HOUR, description: "Retry failed source acquisition in one hour, honoring provider Retry-After" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId }, validationContract: CHECKS, canonicalProductionStore: STORE,
    readerProjection: { id: sourceId, consumers: ["government cards", "place cards", "Ask", "blanks loop", "Admin"] },
    lkgBehavior: "Each domain, division and ZIP retains its last verified facts after a failed read. Unjoined rows are retained and counted. An unchanged source confirms a successful check.",
    autoPromotable: true, classification: "RUNTIME_CIVIC_DATA", bootstrapFixturePaths: [],
  })),
  ...FEDERAL_SOURCE_IDS.map((id): RoutineSourceContract => ({
    id, sourceId: id, recordClass: FEDERAL_RECORD_CLASS, scope: federalScope(id), fanOut: true,
    acquisitionAdapter: { authorityMode: "SINGLE_ROUTE", command: ["scripts/src-cg-refresh.mts", "--promote", `--source=${id}`], requestedUrl: FEDERAL_SOURCES[id].url },
    parserNormalizerVersion: FEDERAL_PARSER_VERSION,
    cadence: { description: FEDERAL_SOURCES[id].clock, defaultEveryMs: FEDERAL_SOURCES[id].everyMs },
    retry: { afterMs: HOUR, description: "Retry source outages after an hour, honoring a longer provider Retry-After." },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: id }, validationContract: CHECKS, canonicalProductionStore: STORE,
    readerProjection: { id: `src-cg-${id}`, consumers: ["member cards", "Make your voice heard", "Ask", "Admin"] },
    lkgBehavior: "Failed pages retain the last GOOD member, bill and national rule partitions. Every unmatched native row is kept and counted. An unchanged provider check succeeds.",
    autoPromotable: true, classification: "RUNTIME_CIVIC_DATA", bootstrapFixturePaths: [],
  })),
] as const;

export function cadenceMsAt(contract: Pick<RoutineSourceContract, "cadence">, nowMs: number): number {
  for (const phase of contract.cadence.phases ?? []) {
    const through = Date.parse(phase.through);
    if (Number.isFinite(through) && nowMs < through) return phase.everyMs;
  }
  return contract.cadence.defaultEveryMs;
}

export function routineContract(id: string): RoutineSourceContract | null {
  return ROUTINE_SOURCE_CONTRACTS.find((contract) => contract.id === id) ??
    RUNTIME_ROUTINE_CONTRACTS.find((contract) => contract.id === id) ?? null;
}

export function requiredRoutineContract(id: string): RoutineSourceContract {
  const contract = routineContract(id);
  if (!contract) throw new Error(`ROUTINE_SOURCE_CONTRACT_MISSING:${id}`);
  return contract;
}

export function routineFreshnessMs(id: string, now: string): number {
  return cadenceMsAt(requiredRoutineContract(id), Date.parse(now));
}

export function meetingPartitionFreshnessMs(now: string): number {
  return cadenceMsAt({ cadence: MEETING_PARTITION_POLICY.cadence }, Date.parse(now));
}
