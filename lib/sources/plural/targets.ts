import { FIPS_TO_STATE } from "../../ocd/fips.ts";

/** These are the known upstream people directories, independent of any Send. */
export const PLURAL_STATES: readonly string[] = Object.values(FIPS_TO_STATE)
  .filter(state => state.prefix === "state" || state.postal === "DC" || state.postal === "PR")
  .map(state => state.postal.toLowerCase());
export const PLURAL_SOURCE_ID = "plural-openstates" as const;
export const PLURAL_PARSER_VERSION = "plural-roster/3";
export const PLURAL_REVISION_URL = "https://api.github.com/repos/openstates/people/commits?per_page=1";

/** The independently parsed source check belongs only to these exact immutable values. */
export function pluralRetirementCheckConsumer(candidate:import("../../civic-data/types.ts").RoutineCandidate,
  prior:import("../../civic-data/types.ts").CandidateVersionRecord|null):string {
  return ["OpenStates native tenure end",candidate.id,candidate.normalization.normalizedHash,candidate.normalization.normalizedPayloadHash,
    prior?.candidate.id,prior?.candidate.normalization.normalizedHash,prior?.candidate.normalization.normalizedPayloadHash].join(":");
}
