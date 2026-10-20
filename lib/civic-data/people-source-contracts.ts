import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { PEOPLE_SOURCE_IDS, peopleSourceRecordClass, peopleSourceScope, type PeopleSourceId } from "../officials/people-sources.ts";
import { VALIDATION_CHECKS } from "./types.ts";
import type { RoutineSourceContract } from "./contracts.ts";
import { sourceAuthority } from "./source-authority.ts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const STORE = "civic_data_candidates+civic_data_candidate_events+civic_data_promotions" as const;

export type StandingPeopleSourceId = Exclude<PeopleSourceId, "people-portraits">;
export const STANDING_PEOPLE_SOURCE_IDS = PEOPLE_SOURCE_IDS.filter((sourceId): sourceId is StandingPeopleSourceId => sourceId !== "people-portraits");
export const PEOPLE_SOURCE_STATES: readonly string[] = Object.values(FIPS_TO_STATE).map(state => state.postal.toLowerCase());

export const peopleSourceContractId = (state: string, sourceId: StandingPeopleSourceId): string =>
  `people-${sourceId}-${state.toLowerCase()}`;

/** Each invocation holds one state. The upstream transport owns shared release and host pacing. */
export const PEOPLE_SOURCE_CONTRACTS: readonly RoutineSourceContract[] = [
  {
    id: peopleSourceContractId("us", "statewide-executive-sources"), sourceId: "statewide-executive-sources", recordClass: "STATE_LEGISLATOR",
    scope: peopleSourceScope("US", "statewide-executive-sources"), acquisitionFailureDomain: "routine-source:statewide-executive-sources:us",
    acquisitionAdapter: { authorityMode: "REGISTERED_SOURCE_ROUTES", command: ["scripts/national-people-refresh.mts", "--promote", "--state=us", "--source=statewide-executive-sources"] },
    parserNormalizerVersion: sourceAuthority("statewide-executive-sources")!.parserVersion,
    cadence: { description: "daily current President refresh from the White House administration", defaultEveryMs: DAY },
    retry: { afterMs: HOUR, description: "retry the White House; failed reads preserve the verified President" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "statewide-executive-sources" }, validationContract: VALIDATION_CHECKS,
    canonicalProductionStore: STORE, readerProjection: { id: "us-current-president", consumers: ["registry", "people", "representation", "map", "Ask", "Admin"] },
    lkgBehavior: "The administration's current President link and the captured own page establish the holder. Failed reads preserve the last verified record.",
    autoPromotable: true, childTimeoutMs: 0, classification: "RUNTIME_CIVIC_DATA", bootstrapFixturePaths: [],
  },
  ...PEOPLE_SOURCE_STATES.flatMap(state => STANDING_PEOPLE_SOURCE_IDS.map((sourceId): RoutineSourceContract => ({
    id: peopleSourceContractId(state, sourceId), sourceId,
    recordClass: peopleSourceRecordClass(sourceId),
    scope: peopleSourceScope(`US-${state.toUpperCase()}`, sourceId),
    acquisitionFailureDomain: `routine-source:${sourceId}:${state}`,
    acquisitionAdapter: { authorityMode: "REGISTERED_SOURCE_ROUTES", command: [
      "scripts/national-people-refresh.mts", "--promote", `--state=${state}`, `--source=${sourceId}`,
    ] },
    // The authority is the one place a source's parser version lives; Congress.gov and GovInfo share theirs with the federal civic records.
    parserNormalizerVersion: sourceAuthority(sourceId)?.parserVersion ?? "people-sources/1",
    cadence: { description: "daily source refresh for every state, independent of paid work and roster providers", defaultEveryMs: DAY },
    retry: { afterMs: HOUR, description: "retry this source in this state; failures preserve every verified person" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId },
    validationContract: VALIDATION_CHECKS, canonicalProductionStore: STORE,
    readerProjection: { id: `${state}-${sourceId}-people`, consumers: ["registry", "people", "representation", "map", "ballot", "Ask", "Admin"] },
    lkgBehavior: "A failed source leaves this state's last verified people live. Complementary sources publish independently; missing pages leave standing gaps.",
    autoPromotable: true, childTimeoutMs: 0, classification: "RUNTIME_CIVIC_DATA", bootstrapFixturePaths: [],
  }))),
  ...PEOPLE_SOURCE_STATES.map((state): RoutineSourceContract => ({
    id: `people-portraits-${state}`,
    sourceId: "people-portraits",
    recordClass: peopleSourceRecordClass("people-portraits"),
    scope: peopleSourceScope(`US-${state.toUpperCase()}`, "people-portraits"),
    acquisitionFailureDomain: `routine-source:people-portraits:${state}`,
    acquisitionAdapter: { authorityMode: "DERIVED", command: ["scripts/people-portraits-refresh.mts", "--promote", `--state=${state}`] },
    parserNormalizerVersion: "people-portraits/1",
    cadence: { description: "standing verification of every missing or due official portrait", defaultEveryMs: HOUR },
    retry: { afterMs: HOUR, description: "retry the state's remaining portraits independently of roster refresh" },
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "people-portraits" },
    validationContract: VALIDATION_CHECKS, canonicalProductionStore: STORE,
    readerProjection: { id: `${state}-verified-portraits`, consumers: ["registry", "people", "representation", "map", "ballot", "Ask", "Admin"] },
    lkgBehavior: "Each person's verified photo survives another person's failed read. Every missing photo or expired check remains standing work with its recorded reason.",
    autoPromotable: true, childTimeoutMs: 0, classification: "RUNTIME_CIVIC_DATA", bootstrapFixturePaths: [],
  })),
];
