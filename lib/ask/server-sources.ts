import { stateForRosterFile } from "../holdings/runtime-paths.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ballotSourcesForDivisions } from "../ballot/registry.ts";
import { contestsForDivisions } from "../sources/ballot-nj-morris/index.ts";
import { getGeneralLineup } from "../ballot/general-lineup.ts";
import { summaryForContest } from "../ballot/measure-summary.ts";
import { provisionsForContest } from "../ballot/measure-provisions.ts";
import { getMeasureAnalyses, type MeasureAnalysis } from "../ballot/analyses.ts";
import { positionsFor } from "../candidates/positions.ts";
import { heldRosterFiles } from "../holdings/discovery.ts";
import { mayReadRetiredPluralRoster } from "../officials/roster-authority.ts";
import { getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import type { BallotAbsence, BallotSet, Contest } from "../ballot/types.ts";
import { allSeatHolders, seatHolderById, seatHoldersForDivision } from "../registry/server.ts";
import { officialStateVoteScopeForOfficeholderId } from "../state-rollcalls/authority.ts";
import { statewideExecutivesFor } from "../officials/statewide-executives.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { membersOfBody } from "../registry/body-membership.ts";
import { bindNamedEntity } from "../routing/named-entity.ts";
import type { AskNominee } from "./ballot-inventory.ts";
import { canonicalBodyIdentity } from "./body-identity.ts";
import { stateDivisionsOf, type HeldOfficial } from "./reader-officials.ts";

/**
 * A reader may ask about a held person outside our mapped divisions. Match the
 * question using the existing entity binder, then retrieve only exact held IDs.
 * This adds subjects to an answer, never representatives to a geography.
 */
export async function namedOfficeholders(question: string, explicitIds: readonly string[]): Promise<SeatHolder[]> {
  const targetedStateHolders: SeatHolder[] = [];
  for (const id of new Set(explicitIds)) {
    // Resolve an explicit state-publisher identity against that one authority
    // before the broad federal/local directory is opened.
    if (!officialStateVoteScopeForOfficeholderId(id)) continue;
    const holder = await seatHolderById(id);
    if (holder) targetedStateHolders.push(holder);
  }
  const heldById = new Map((await allSeatHolders()).map((holder) => [holder.id, holder]));
  for (const holder of targetedStateHolders) heldById.set(holder.id, holder);
  const held = [...heldById.values()];
  const binding = bindNamedEntity(question, held.map((seat) => ({
    id: seat.id, name: seat.name, nameClass: "person" as const, divisionType: "person",
  })));
  const wanted = new Set(explicitIds);
  if (binding.kind === "BOUND") wanted.add(binding.entity.id);
  if (binding.kind === "AMBIGUOUS") for (const entity of binding.candidates) wanted.add(entity.id);
  return held.filter((seat) => wanted.has(seat.id));
}

/**
 * The representation selector supplies Ask's officials, with the same IDs and provenance.
 *
 * `held` says where each was found: the division ids (a district, the county, the
 * state) and, for a member of a governing body, that body's name. The state each
 * division sits in is read too — a reader's ZIP divisions name the districts and
 * places, and the U.S. Senators and statewide executives are held under the state
 * itself.
 */
export async function readerOfficeholders(ocdIds: readonly string[], bodyIds: readonly string[] = []): Promise<{ seats: SeatHolder[]; loaderFailures: number; held: HeldOfficial[] }> {
  const seats = new Map(statewideExecutivesFor([...ocdIds]).map((seat) => [seat.id, seat]));
  const where = new Map<string, { divisionIds: Set<string>; bodyId: string | null; bodyName: string | null }>();
  const at = (seat: SeatHolder) => {
    let row = where.get(seat.id);
    if (!row) where.set(seat.id, row = { divisionIds: new Set(), bodyId: null, bodyName: null });
    return row;
  };
  for (const bodyId of bodyIds) {
    const governing = /#(?:governing|board)$/.test(bodyId);
    for (const seat of membersOfBody(bodyId).members) {
      seats.set(seat.id, seat);
      if (governing && !at(seat).bodyId) Object.assign(at(seat), { bodyId, bodyName: canonicalBodyIdentity(bodyId)?.name ?? null });
    }
  }
  let loaderFailures = 0;
  const divisions = new Set([...ocdIds, ...stateDivisionsOf(ocdIds)]);
  for (const ocdId of divisions) {
    try {
      const held = await seatHoldersForDivision(ocdId);
      for (const seat of held) {
        seats.set(seat.id, seat);
        at(seat).divisionIds.add(ocdId);
      }
      if (!mayReadRetiredPluralRoster() && /\/(?:sldu|sldl):/.test(ocdId) && held.length === 0) {
        loaderFailures += 1;
      }
    } catch {
      loaderFailures += 1;
    }
  }
  return {
    seats: [...seats.values()],
    loaderFailures,
    held: [...seats.values()].map((seat) => ({ seat, divisionIds: [...(where.get(seat.id)?.divisionIds ?? [])], bodyId: where.get(seat.id)?.bodyId ?? null, bodyName: where.get(seat.id)?.bodyName ?? null })),
  };
}

/**
 * **THE SERVER-SIDE READS ASK NEEDS, IN ONE PLACE.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * `app/api/ask/grounded/route.ts` is the pipeline and this is what it reads
 * from. Split out for two reasons that are both about not duplicating truth:
 *
 * 1. **The ballot is loaded exactly the way `/ballot` loads it** — the same
 *    canonical ballot registry, the same `contestsForDivisions` filter, the
 *    same committed files. Ask does not hold a copy of ballot truth and cannot
 *    drift from the page that renders it.
 * 2. **A route file that also holds loaders is a route file nothing can test
 *    without standing up a request.** These are ordinary functions.
 *
 * Every read here degrades to EMPTY rather than throwing. An unavailable
 * committed file is a real state and the pipeline reports it as an honest gap;
 * a 500 would take a correct meetings answer down over a ballot file.
 */

export interface BallotForDivisions {
  /** Applicable canonical state holdings that could not be read or validated. */
  loaderFailures: string[];
  analysisLoaderFailed: boolean;
  measureAnalysis: (contestId: string) => MeasureAnalysis | null;
  set: BallotSet | null;
  contests: Contest[];
  absences: BallotAbsence[];
  nominees: (contestId: string) => readonly AskNominee[];
  positions: (targetKey: string) => readonly {
    issueLabel: string;
    quote: string;
    documentUrl: string;
    retrievedAt: string;
  }[];
  measureSummary: (contestId: string) => { summary: string; summarizesUrl: string } | null;
  measureProvisions: (contestId: string) => readonly {
    id: string;
    label: string;
    what: string;
    citesUrl: string;
  }[];
}

const EMPTY: BallotForDivisions = {
  loaderFailures: [],
  analysisLoaderFailed: false,
  measureAnalysis: () => null,
  set: null,
  contests: [],
  absences: [],
  nominees: () => [],
  positions: () => [],
  measureSummary: () => null,
  measureProvisions: () => [],
};

/**
 * The reader's own ballot, matched to their divisions.
 *
 * The loop is `/ballot`'s: first select only authorities named by the resolved
 * state divisions, then take the first that matches anything. An unavailable
 * authority in a different state is outside this Reader's failure domain.
 */
export async function loadBallotForDivisions(
  ocdIds: readonly string[],
): Promise<BallotForDivisions> {
  if (ocdIds.length === 0) return EMPTY;
  const loaderFailures: string[] = [];
  for (const { state, source } of ballotSourcesForDivisions(ocdIds)) {
    try {
      const candidate = source.normalize(await source.fetch());
      const hit = contestsForDivisions(candidate, ocdIds);
      if (hit.contests.length === 0 && hit.absences.length === 0) continue;
      const analyses = state === "az" ? getMeasureAnalyses() : null;
      const lineup = state === "az" ? getGeneralLineup() : null;
      return {
        loaderFailures,
        analysisLoaderFailed: state === "az" && analyses === null,
        measureAnalysis: (contestId) => analyses?.analyses.find((analysis) => analysis.contestId === contestId) ?? null,
        set: candidate,
        contests: hit.contests,
        absences: hit.absences,
        nominees: (contestId) => (lineup?.contests.find((contest) => contest.contestId === contestId)?.nominees ?? []).map((nominee) => ({ ...nominee, sourceUrl: lineup!.canvass.url, sourceOrg: lineup!.canvass.issuedBy, retrievedAt: lineup!.canvass.readAt })),
        positions: sourcedPositions,
        measureSummary: (contestId) => {
          const summary = summaryForContest(contestId);
          return summary
            ? { summary: summary.summary, summarizesUrl: summary.summarizesUrl }
            : null;
        },
        measureProvisions: (contestId) =>
          provisionsForContest(contestId).map((p) => ({
            id: p.id,
            label: p.label,
            what: p.what,
            citesUrl: p.citesUrl,
          })),
      };
    } catch {
      loaderFailures.push(state);
    }
  }
  return { ...EMPTY, loaderFailures };
}

/**
 * **A POSITION IS A QUOTE WITH A URL, OR IT IS NOT A POSITION.**
 *
 * Only `MATCHED` answers are returned, and only their verbatim passages. A
 * `SEARCHED_NOTHING_MATCHED` answer is real and useful on the ballot card,
 * where it renders as *what we searched and did not find* — but as an evidence
 * record it would be a row with no statement in it, and the synthesis rung
 * given a row with no statement will describe the absence as though it were
 * one. The named gap in the route says that instead, once, correctly.
 */
function sourcedPositions(targetKey: string) {
  try {
    return positionsFor(targetKey).flatMap((position) =>
      position.answer.kind === "MATCHED"
        ? position.answer.passages.map((passage) => ({
            issueLabel: position.issue.label,
            quote: passage.quote,
            documentUrl: passage.documentUrl,
            retrievedAt: passage.retrievedAt,
            sourceClass: passage.sourceClass,
            sourceRevisionId: passage.sourceRevisionId,
            sourceArtifactId: passage.sourceArtifactId,
            sourceContentHash: passage.sourceContentHash,
            textStart: passage.textStart,
            textEnd: passage.textEnd,
            revisionStatus: passage.revisionStatus,
            publicationDate: passage.publicationDate,
          }))
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * The legislators whose districts the reader's divisions actually name.
 *
 * **Selected by DIVISION ID, never by state.** A reader in Arizona has two
 * state senators near them and exactly one who represents the district they are
 * standing in; handing them the state's whole roster and calling it "your
 * senator" would be a false relationship for 29 of 30. The `sldu:`/`sldl:` ids
 * in their own division list are what the geometry already resolved.
 *
 * Congressional and federal rows are deliberately not included: the ballot and
 * the who-governs card already carry them with their own provenance, and an Ask
 * answer about a school board agenda listing a U.S. senator would be a contact
 * with no relationship to the question.
 */
export function readerRepresentatives(ocdIds: readonly string[]): {
  id: string;
  name: string;
  officeTitle: string;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  sourceUrl: string | null;
  sourceOrg: string | null;
  collectedAt: string | null;
}[] {
  // The tracked state rosters are recorded Plural/OpenStates research
  // fixtures, not production authority. In production the existing Ask
  // holding-failure path names the missing canonical officeholder projection;
  // only node:test may exercise the historical rows.
  if (!mayReadRetiredPluralRoster()) return [];
  const wanted = new Set(ocdIds.filter((id) => /\/(sldu|sldl):/.test(id)));
  if (wanted.size === 0) return [];

  const out: ReturnType<typeof readerRepresentatives> = [];
  const seen = new Set<string>();

  for (const file of heldRosterFiles(process.cwd())) {
    /* The federal roster is keyed on bare state ids and carries no
       `sldu:`/`sldl:` links, so it contributes nothing here and is skipped
       rather than read and discarded. */
    if (file === "officeholders-us.json") continue;
    const set = readRoster(file);
    if (!set) continue;
    const byId = new Map(set.officeholders.map((o) => [o.id, o]));
    for (const link of set.divisions) {
      if (!wanted.has(link.ocdId)) continue;
      const person = byId.get(link.officeholderId);
      if (!person || seen.has(person.id)) continue;
      seen.add(person.id);
      out.push({
        id: person.id,
        name: person.name,
        officeTitle: person.officeTitle,
        email: person.email ?? null,
        phone: person.phone ?? null,
        websiteUrl: person.websiteUrl ?? null,
        sourceUrl: person.provenance?.sourceUrl ?? null,
        sourceOrg: person.provenance?.sourceOrg ?? null,
        collectedAt: person.provenance?.collectedAt ?? null,
      });
    }
  }
  return out;
}

interface RosterFile {
  officeholders: {
    id: string;
    name: string;
    officeTitle: string;
    email?: string | null;
    phone?: string | null;
    websiteUrl?: string | null;
    provenance?: { sourceUrl?: string | null; sourceOrg?: string | null; collectedAt?: string | null } | null;
  }[];
  divisions: { ocdId: string; officeholderId: string }[];
}

const rosterCache = new Map<string, RosterFile | null>();

/**
 * One roster file, cached per process.
 *
 * Read through `process.cwd()` like every other committed artifact, which is
 * why `/api/ask/grounded` names `./lib/registry/*.json` in
 * `outputFileTracingIncludes` — a file reached this way is absent from a
 * serverless bundle unless the tracer is told, and an absent roster would
 * render as "we have not recorded who represents you", which is
 * indistinguishable from honest missing data.
 */
function readRoster(name: string): RosterFile | null {
  if (rosterCache.has(name)) return rosterCache.get(name) ?? null;
  let parsed: RosterFile | null = null;
  try {
    parsed = stateForRosterFile(name) === null
      ? getFederalOfficeholderSet() as RosterFile
      : JSON.parse(readFileSync(join(process.cwd(), "data", "states", stateForRosterFile(name)!, "officials", name), "utf8")) as RosterFile;
  } catch (error) {
    if (stateForRosterFile(name) === null) throw error;
    parsed = null;
  }
  rosterCache.set(name, parsed);
  return parsed;
}
