import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../../civic-data/read-model.ts";
import { requiredRoutineContract, routineFreshnessMs } from "../../civic-data/contracts.ts";
import { ballotFreshnessNote } from "../ballot-curated/freshness-note.ts";
import { MissingBallotProjectionError } from "../../ballot/holding.ts";

import type {
  BallotAbsence,
  BallotSet,
  BallotSource,
  Candidacy,
  CandidacyRemoval,
  Contest,
  Election,
  Measure,
} from "../../ballot/types.ts";

/**
 * The Morris County ballot source. `fetch()` reads the one promoted BALLOT_FILING projection.
 */

const SOURCE_NAME = "ballot-nj-morris";
const NJ_CONTRACT = requiredRoutineContract("nj-morris-filing");
const SCOPE = NJ_CONTRACT.scope;

export interface RawFile {
  formatVersion: number;
  curatedAt?: string;
  election: Election;
  contests: Contest[];
  candidacies: Candidacy[];
  measures: Measure[];
  absences: BallotAbsence[];
  removals?: CandidacyRemoval[];
}

export interface NjMorrisContactDocument {
  readonly generatedAt: string;
  readonly route: string;
  readonly note: string;
  readonly contacts: readonly {
    readonly candidacyId: string;
    readonly email?: string | null;
    readonly filedAddress?: string | null;
    readonly sourceUrl: string;
    readonly sourceOrg: string;
    readonly collectedAt: string;
  }[];
}

export interface NjMorrisReadModel {
  readonly ballot: RawFile;
  readonly contacts: NjMorrisContactDocument;
}

let readState: CivicDataReadResult<NjMorrisReadModel> = civicDataReadNotInitialized(
  "BALLOT_FILING",
  SCOPE,
  "The Morris County filing canonical pointer has not been read for this process.",
);

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
  const candidacyIds = new Set((raw.candidacies ?? []).map((candidate) => candidate.id));
  if (candidacyIds.size !== (raw.candidacies ?? []).length) throw new Error("duplicate candidacy ids");
  for (const c of raw.contests) {
    if (!c.ocdId?.startsWith("ocd-division/")) throw new Error(`${c.id}: bad ocdId`);
    if (!c.divisionVintage) throw new Error(`${c.id}: missing division vintage`);
    if (!Number.isInteger(c.voteFor) || c.voteFor === null || c.voteFor < 1) throw new Error(`${c.id}: voteFor`);
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
  // A removal is evidence of a change between two documents, so it cites both
  // — and a person cannot be listed and removed in the same file.
  const listed = new Set((raw.candidacies ?? []).map((c) => c.id));
  for (const r of raw.removals ?? []) {
    if (!r.id || !r.contestId) throw new Error("a removal must keep the candidacy id it had");
    if (listed.has(r.id)) throw new Error(`${r.id}: listed as a candidacy AND recorded as removed`);
    if (r.status !== "REMOVED_FROM_FILING") throw new Error(`${r.id}: unknown removal status`);
    if (!r.lastListed?.sourceUrl || !r.absentFrom?.sourceUrl || !r.statement || !r.firstAbsentOn) {
      throw new Error(
        `${r.id}: a removal cites the document that listed the person, the later document that does not, ` +
          "the day it was first found absent, and states the change",
      );
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

function validateReadModel(value: NjMorrisReadModel, versionId: string): void {
  validateBallotFile(value.ballot);
  if (!value.contacts || !Array.isArray(value.contacts.contacts)) {
    throw new Error(`Morris filing projection ${versionId} carries no contact document.`);
  }
  const current = new Set(value.ballot.candidacies.map((candidate) => candidate.id));
  const contactIds = value.contacts.contacts.map((contact) => contact.candidacyId);
  if (new Set(contactIds).size !== contactIds.length || contactIds.some((id) => !current.has(id))) {
    throw new Error(`Morris filing projection ${versionId} carries duplicate or non-current contact identities.`);
  }
}

/** Typed ballot/contact read outcome. */
export async function readNjMorrisFiling(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<NjMorrisReadModel>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedCivicData<NjMorrisReadModel>("BALLOT_FILING", SCOPE, {
    ...options,
    now,
    maxAgeMs: options.maxAgeMs ?? routineFreshnessMs(NJ_CONTRACT.id, now),
  });
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validateReadModel(result.value, result.metadata.versionId ?? result.kind);
  }
  return result;
}

export function njMorrisFilingReadState(): CivicDataReadResult<NjMorrisReadModel> {
  return readState;
}

/** Synchronous projection only after the request path performed the typed read. */
export function currentNjMorrisReadModel(): NjMorrisReadModel {
  if (readState.kind === "PROMOTED" || readState.kind === "BOOTSTRAP") return readState.value;
  throw new Error(`Morris filing projection is ${readState.kind}; fetch the registered ballot source first.`);
}

export const ballotNjMorrisSource: BallotSource = {
  name: SOURCE_NAME,

  async fetch(): Promise<unknown[]> {
    const result = await readNjMorrisFiling();
    if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
    if (result.kind === "NOT_RECORDED") {
      throw new MissingBallotProjectionError(SOURCE_NAME);
    }
    return [result.value.ballot];
  },

  normalize(raw: unknown[]): BallotSet {
    const [file] = raw;
    validateBallotFile(file);
    const freshnessNote = ballotFreshnessNote(readState, "the Morris County ballot");
    return {
      election: file.election,
      contests: file.contests,
      candidacies: file.candidacies,
      measures: file.measures,
      absences: file.absences,
      removals: file.removals ?? [],
      ...(freshnessNote ? { coverageNotes: [freshnessNote] } : {}),
    };
  },

  async upsert(set: BallotSet) {
    // Compatibility shape only. Persistence is the registered atomic promotion.
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
