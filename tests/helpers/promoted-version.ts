import type { CandidateVersionRecord, PromotedProjection, RoutineRecordClass } from "../../lib/civic-data/types.ts";

export { routineVersionFixture as version } from "./routine-candidate-fixture.ts";

export const CLASS: RoutineRecordClass = "FEC_FUNDING";

export interface Version {
  projection: PromotedProjection;
  candidate: CandidateVersionRecord;
}
