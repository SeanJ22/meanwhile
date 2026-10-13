import { seedMeasureRecords } from "../../ballot/measure-records.ts";
import { MissingBallotProjectionError } from "../../ballot/holding.ts";
import type { BallotSet, BallotSource } from "../../ballot/types.ts";
import { curatedCoverageNotes } from "../../ballot/coverage-notes.ts";
import { validateBallotFile } from "../ballot-nj-morris/index.ts";
import { ballotFreshnessNote } from "./freshness-note.ts";
import { CivicDataStoreUnavailableError, type CivicDataReadResult } from "../../civic-data/read-model.ts";
import {
  azBallotReadState,
  nhBallotReadState,
  settleAzBallotRead,
  settleNhBallotRead,
} from "../../civic-data/manual-read-models.ts";
import type { AzBallotProjection, NhBallotProjection } from "../../civic-data/manual-projections.ts";

/**
 * Curated ballots read their exact promoted projections. A reader request that entered the reader edge
 * reads the pointer's proven copy through the same Reader; any other caller reads the database.
 */
type CuratedProjection = AzBallotProjection | NhBallotProjection;
type CuratedEntry = {
  readonly read: () => Promise<CivicDataReadResult<CuratedProjection>>;
  readonly state: () => CivicDataReadResult<CuratedProjection>;
};

const CURATED_FILES: Record<string, CuratedEntry> = {
  "ballot-az-pima": {
    read: settleAzBallotRead,
    state: azBallotReadState,
  },
  "ballot-nh-merrimack": {
    read: settleNhBallotRead,
    state: nhBallotReadState,
  },
};

/** The names a curated source may be registered under — the map's own keys. */
export const CURATED_BALLOT_NAMES = Object.keys(CURATED_FILES);

/**
 * A curated ballot source over one canonical production pointer. The validator
 * remains shared: count, citation, and no-empty-contest invariants are applied
 * after the durable promotion proof has been verified.
 */
export function curatedBallotSource(name: string): BallotSource {
  const entry = CURATED_FILES[name];
  if (!entry) {
    throw new Error(
      `curated ballot source "${name}" has no file — add its explicit read to CURATED_FILES`,
    );
  }

  return {
    name,

    async fetch(): Promise<unknown[]> {
      const result = await entry.read();
      if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
      if (result.kind === "NOT_RECORDED") throw new MissingBallotProjectionError(name);
      return [result.value.ballot];
    },

    normalize(raw: unknown[]): BallotSet {
      const [parsed] = raw;
      validateBallotFile(parsed);
      const notes = curatedCoverageNotes(name, parsed as { coverageNotes?: unknown; scopedCoverageNotes?: unknown });
      const state = entry.state();
      const authorityNote = ballotFreshnessNote(state, "this ballot");
      const projection = state.kind === "PROMOTED" || state.kind === "BOOTSTRAP" ? state.value : null;
      const seeded = seedMeasureRecords(parsed, projection && name === "ballot-az-pima"
        ? (projection as AzBallotProjection).measureAnalyses.analyses : []);
      return {
        measureRecords: seeded.measureRecords,
        election: parsed.election,
        contests: parsed.contests,
        candidacies: parsed.candidacies,
        measures: parsed.measures,
        absences: parsed.absences,
        ...notes,
        coverageNotes: [...(notes.coverageNotes ?? []), ...(authorityNote ? [authorityNote] : [])],
      };
    },

    async upsert(set: BallotSet) {
      return { inserted: 0, updated: set.contests.length };
    },
  };
}
