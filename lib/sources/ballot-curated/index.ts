import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BallotSet, BallotSource } from "../../ballot/types.ts";
import { validateBallotFile } from "../ballot-nj-morris/index.ts";

/**
 * Every curated ballot file, as an EXPLICIT NAMED READ — R23's fix.
 *
 * This used to be one `readFileSync(join(process.cwd(), file))` over a
 * function parameter, and a path a bundler cannot see is a path a bundler
 * must assume could be anything: Turbopack answered it by tracing the WHOLE
 * PROJECT into the two bundles that reach here. Measured 2026-08-17, before
 * this change: `/api/ballot/scope` traced 2554 files and `/ballot` traced
 * 2567, against 104-195 for every other route, and 122 of each were files
 * from `tests/`. That is how planted credential fixtures reached a deployed
 * artifact and failed Netlify's secrets scan on `main@a8f7ff2`.
 *
 * So each path is a literal at its own call site. Adding a state means adding
 * a line here as well as one in `lib/ballot/registry.ts`; that is the cost of
 * being traceable, and it is a line of typing against a whole-project trace.
 * `scripts/check-build-output.mjs` fails the build if tracing regresses.
 */
const CURATED_FILES: Record<string, { file: string; read: () => string }> = {
  "ballot-az-pima": {
    file: "data/states/az/ballot/az-pima-2026.json",
    read: () =>
      readFileSync(join(process.cwd(), "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8"),
  },
  "ballot-nh-merrimack": {
    file: "data/states/nh/ballot/nh-merrimack-2026.json",
    read: () =>
      readFileSync(
        join(process.cwd(), "data", "states", "nh", "ballot", "nh-merrimack-2026.json"),
        "utf8",
      ),
  },
};

/** The names a curated source may be registered under — the map's own keys. */
export const CURATED_BALLOT_NAMES = Object.keys(CURATED_FILES);

/** The file a curated source reads, for provenance and for the tests. */
export function curatedBallotFile(name: string): string | undefined {
  return CURATED_FILES[name]?.file;
}

/**
 * A curated ballot source over a committed file — the factory form of what
 * `ballot-nj-morris` pioneered, so AZ and NH are a data file plus one line
 * in `lib/ballot/registry.ts` rather than a copied module. The validator is
 * shared: the count invariant, the citation requirement, and the
 * no-empty-candidacy-contest rule hold identically for every state.
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
      const parsed: unknown = JSON.parse(entry.read());
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
