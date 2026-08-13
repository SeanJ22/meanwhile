import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  BallotAbsence,
  BallotSet,
  BallotSource,
  Candidacy,
  Contest,
  Election,
  Measure,
} from "../../ballot/types.ts";

/**
 * The Morris County ballot source — S2, tracker D08's first implementation.
 *
 * `fetch()` reads a committed curated file, exactly as the meetings snapshot
 * pattern prescribes (§0a): curation is an adapter, not a literal. The file
 * was transcribed by hand from the county clerk's filed-candidate PDFs —
 * column-aligned PDFs are the only form the county publishes — and every
 * record carries the PDF it was read from. A licensed national feed (D08)
 * replaces this directory, not the shape.
 */

const SOURCE_NAME = "ballot-nj-morris";
const FILE = join("data", "ballot", "nj-morris-2026.json");

interface RawFile {
  formatVersion: number;
  election: Election;
  contests: Contest[];
  candidacies: Candidacy[];
  measures: Measure[];
  absences: BallotAbsence[];
}

/** The count invariant at the source boundary. */
export function validateBallotFile(value: unknown): asserts value is RawFile {
  const raw = value as RawFile;
  if (!raw || typeof raw !== "object") throw new Error("ballot file is not an object");
  if (raw.formatVersion !== 1) throw new Error("unknown ballot formatVersion");
  if (!raw.election?.id || !raw.election?.date) throw new Error("election missing");
  if (!Array.isArray(raw.contests) || raw.contests.length === 0) {
    throw new Error("a ballot file with zero contests is a broken file, not an empty ballot");
  }
  const contestIds = new Set(raw.contests.map((c) => c.id));
  if (contestIds.size !== raw.contests.length) throw new Error("duplicate contest ids");
  for (const c of raw.contests) {
    if (!c.ocdId?.startsWith("ocd-division/")) throw new Error(`${c.id}: bad ocdId`);
    if (!c.divisionVintage) throw new Error(`${c.id}: missing division vintage`);
    if (!Number.isInteger(c.voteFor) || c.voteFor < 1) throw new Error(`${c.id}: voteFor`);
    if (!c.provenance?.sourceUrl) throw new Error(`${c.id}: uncited contest`);
  }
  for (const cand of raw.candidacies ?? []) {
    if (!contestIds.has(cand.contestId)) {
      throw new Error(`${cand.id}: candidacy for unknown contest`);
    }
    if (!cand.provenance?.sourceUrl) throw new Error(`${cand.id}: uncited candidacy`);
  }
  for (const m of raw.measures ?? []) {
    if (!m.questionText) throw new Error(`${m.id}: a measure must carry the question text verbatim`);
    if (!m.provenance?.sourceUrl) throw new Error(`${m.id}: uncited measure`);
  }
  for (const a of raw.absences ?? []) {
    if (!a.statement || !a.provenance?.sourceUrl) {
      throw new Error("an absence must state itself and cite its authority");
    }
  }
  // Every CANDIDACY contest must have candidates or be an accounted absence —
  // an empty contest reads as "nobody is running", which is a claim.
  for (const c of raw.contests) {
    if (c.type !== "CANDIDACY") continue;
    const n = (raw.candidacies ?? []).filter((x) => x.contestId === c.id).length;
    if (n === 0) throw new Error(`${c.id}: a candidacy contest with zero candidates`);
  }
}

export const ballotNjMorrisSource: BallotSource = {
  name: SOURCE_NAME,

  async fetch(): Promise<unknown[]> {
    const parsed: unknown = JSON.parse(
      readFileSync(join(process.cwd(), FILE), "utf8"),
    );
    return [parsed];
  },

  normalize(raw: unknown[]): BallotSet {
    const [file] = raw;
    validateBallotFile(file);
    return {
      election: file.election,
      contests: file.contests,
      candidacies: file.candidacies,
      measures: file.measures,
      absences: file.absences,
    };
  },

  async upsert(set: BallotSet) {
    // Nothing persists ballots yet; the page reads the normalized set.
    return { inserted: 0, updated: set.contests.length };
  },
};

/**
 * The contests a point's voter sees: contests whose division contains the
 * point, plus state-level contests for the state those divisions sit in.
 * Pure join on OCD-IDs — never on names.
 */
export function contestsForDivisions(
  set: BallotSet,
  divisionOcdIds: readonly string[],
): { contests: Contest[]; absences: BallotAbsence[] } {
  const present = new Set(divisionOcdIds);
  for (const id of divisionOcdIds) {
    const m = id.match(/^(ocd-division\/country:us\/state:[a-z]{2})\//);
    if (m) present.add(m[1]);
  }
  return {
    contests: set.contests.filter((c) => present.has(c.ocdId)),
    absences: set.absences.filter((a) => present.has(a.ocdId)),
  };
}
