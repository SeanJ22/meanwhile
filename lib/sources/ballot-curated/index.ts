import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BallotSet, BallotSource } from "../../ballot/types.ts";
import { validateBallotFile } from "../ballot-nj-morris/index.ts";

/**
 * A curated ballot source over a committed file — the factory form of what
 * `ballot-nj-morris` pioneered, so AZ and NH are a data file plus one line
 * in `lib/ballot/registry.ts` rather than a copied module. The validator is
 * shared: the count invariant, the citation requirement, and the
 * no-empty-candidacy-contest rule hold identically for every state.
 */
export function curatedBallotSource(name: string, file: string): BallotSource {
  return {
    name,

    async fetch(): Promise<unknown[]> {
      const parsed: unknown = JSON.parse(
        readFileSync(join(process.cwd(), file), "utf8"),
      );
      return [parsed];
    },

    normalize(raw: unknown[]): BallotSet {
      const [parsed] = raw;
      validateBallotFile(parsed);
      const withNotes = parsed as { coverageNotes?: string[] };
      return {
        election: parsed.election,
        contests: parsed.contests,
        candidacies: parsed.candidacies,
        measures: parsed.measures,
        absences: parsed.absences,
        coverageNotes: withNotes.coverageNotes ?? [],
      };
    },

    async upsert(set: BallotSet) {
      return { inserted: 0, updated: set.contests.length };
    },
  };
}
