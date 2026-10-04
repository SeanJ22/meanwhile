import { measureRecordsForBallot } from "@/lib/ballot/measure-records";
import type { Metadata } from "next";
import Link from "next/link";
import { FilingChanges } from "@/components/ballot/filing-changes";
import { OfficialFilings } from "@/components/ballot/official-filings";
import { filingsForDivisions, type OfficialFiling } from "@/lib/civic-data/official-filings";
import { readOfficialFilingsForReader } from "@/lib/civic-data/curated-reader-read-model";

import { contestsForDivisions } from "@/lib/sources/ballot-nj-morris";
import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { coverageNotesForScope } from "@/lib/ballot/coverage-notes";
import {
  ballotAuxiliaryPreloadSucceeded,
  settleBallotAuxiliaryPreloads,
  type BallotAuxiliaryFamily,
} from "@/lib/ballot/auxiliary-preloads";
import { divisionIdsForZipArea } from "@/lib/ballot/zip-divisions";
import { needsPill, zipCertainty } from "@/lib/geo/zip-certainty";
import { analysisForContest } from "@/lib/ballot/analyses";
import { orderMeasures } from "@/lib/ballot/measure-order";
import { summaryForContest } from "@/lib/ballot/measure-summary";
import {
  PROVISION_KIND_LABEL,
  provisionsForContest,
} from "@/lib/ballot/measure-provisions";
import {
  getGeneralLineup,
  lineupForContest,
} from "@/lib/ballot/general-lineup";
import {
  linksForCandidacy,
  linksForNominee,
  type CandidateLinks,
} from "@/lib/ballot/candidate-sites";
import { blurbForContestTitle } from "@/lib/officials/office-blurbs";
import { surnameDisplayCase } from "@/lib/ballot/name-case";
import {
  cardForCandidacy,
  cardForNominee,
  type CandidateCardData,
} from "@/lib/ballot/candidate-cards";
import { BallotAskPill } from "@/components/ballot/ballot-ask-pill";
import { BallotNarrowing } from "@/components/ballot/ballot-narrowing";
import { JurisdictionMark, JurisdictionNote } from "@/components/ballot/jurisdiction-note";
import { jurisdictionNameFromOcdId } from "@/lib/ballot/could-govern";
import { photosFirst } from "@/lib/ballot/photo-order";
import { COLLECTION_NOTE } from "@/lib/ballot/collection-note";
import { FilingNote } from "@/components/ballot/filing-note";
import { CandidateBattlecard } from "@/components/ballot/candidate-battlecard";
import { StateMoneySection } from "@/components/funding/state-money-section";
import { stateMoneyForCard } from "@/lib/funding/nominee-money";
import {
  MemberCommitteesContent,
  MemberOfficesContent,
} from "@/components/officials/member-directory";
import { CardSourcesList } from "@/components/officials/card-sources-list";
import { RecentVotes } from "@/components/map/popup/official-popup";
import { personCardSources } from "@/lib/officials/card-sources";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";
import { currentMemberOffices } from "@/lib/officials/member-offices-read";
import type { SeatHolder } from "@/lib/officials/lookup";
import { CandidateCard } from "@/components/ballot/candidate-card";
import {
  CandidatePositions,
} from "@/components/ballot/candidate-positions";
import {
  positionsFor,
  positionsHeadline,
} from "@/lib/candidates/positions";
import { derivedBlurbFor } from "@/lib/candidates/blurbs";
import { MyPicks } from "@/components/ballot/my-picks";
import { jurisdictionKeyForContestId } from "@/lib/ballot/pick-jurisdiction";
import { PickControl } from "@/components/ballot/pick-control";
import { currentRegistrationLinks, registrationLinkFor } from "@/lib/ballot/registration-links";
import { currentElectionOffices } from "@/lib/ballot/election-offices";
import { currentPollingPlaceLinks, pollingPlaceLinkFor } from "@/lib/ballot/polling-place-links";
import { WhereToVote } from "@/components/ballot/where-to-vote";
import { incumbentHolderFor } from "@/lib/ballot/incumbent-record";
import { contestIncumbency } from "@/lib/ballot/incumbency-resolve";
import {
  nhLegislativeRosterAppliesTo,
  settleNhSeatHolders,
} from "@/lib/ballot/seat-holders";
import {
  IncumbentNameLink,
} from "@/components/ballot/incumbent-record-link";
import { partyColorVar } from "@/lib/officials/party-color";
import { formatDateMDY } from "@/lib/map/format";
import {
  fundingAnswerForTarget,
  STATE_FUNDING_NOTE,
  type FundingAnswer,
} from "@/lib/funding/display";
import { settleFundingRead } from "@/lib/funding/snapshot";
import { settleStateMoneyRead, stateMoneyReadState } from "@/lib/funding/state-snapshot";
import type { StateCampaignFinanceJurisdiction } from "@/lib/funding/data-plane";
import { fundingFreshnessNote } from "@/lib/funding/freshness";
import { directFundingTargetPlan, settleFundingHoldingAnswer } from "@/app/api/funding/[target]/route";
import {
  ensureReaderAuthorityEdge,
  READER_BALLOT_AUTHORITY_FAMILIES,
  readReaderManifest,
} from "@/lib/meetings/edge-serving";
import {
  enterReaderAuthorityEdge,
  withReaderAuthorityEdge,
  type ReaderAuthorityEdgeBundle,
} from "@/lib/registry/runtime-edge";
import {
  settleCandidateCorpusRead,
  settleCandidateProfilesRead,
} from "@/lib/civic-data/manual-read-models";
import {
  settleBallotNavigationRead,
} from "@/lib/civic-data/curated-reader-read-model";
import {
  FundingAbsence,
  FundingDisplay,
  StateFundingNote,
} from "@/components/funding/funding-section";
import { ReactionControl } from "@/components/reactions/reaction-control";
import { questionForTargetType } from "@/lib/signal/reactions";
import { electionDatesFor } from "@/lib/ballot/election-dates";
import {
  calendarableSteps,
  isUpcoming,
  windowOf,
} from "@/lib/ballot/dated-events";
import { AddToCalendar } from "@/components/calendar/add-to-calendar";
import type {
  BallotAbsence,
  BallotSet,
  Candidacy,
  Contest,
  Measure,
} from "@/lib/ballot/types";
import { CandidateContact, TAGLINE_SOURCE_NOTE } from "@/components/ballot/candidate-contact";
import { candidateContactForCandidacy } from "@/lib/ballot/candidate-contacts";
import { reconciledCandidacyIdForCard } from "@/lib/identity/az-2026";
import { groupAbsences } from "@/lib/ballot/absence-grouping";
import { sharedNotesFor } from "@/lib/ballot/shared-notes";
import { readerContestScope } from "@/lib/ballot/reader-scope";
import { resolveZip } from "@/lib/geo/zcta";
import {
  divisionsAt,
  prefetchReaderGeography,
  settleFederalDirectoryRead,
  settleRegistryAuthorityReads,
} from "@/lib/registry/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { LevelTag } from "@/components/ui/level-tag";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { BallotCapture } from "@/components/ballot/ballot-capture";
import { tierForOcdId } from "@/lib/ocd/tiers";
import { Logo } from "@/components/brand/logo";
import { PRODUCT_NAME, titleFor } from "@/lib/brand";
import { readerPartyLabel } from "@/lib/text/reader-names";
import {
  IncumbencyFootnote,
  IncumbencyMarker,
} from "@/components/ballot/incumbency-note";

/**
 * The ballot surface — S2.
 *
 * Renders exactly what the election authorities filed: contests, candidates
 * with party label and filed slogan, official question text where a question
 * exists, and the state's own dates. **It never suggests how to vote**:
 * candidates order by the recorded ballot drawing where one was machine-
 * readable and alphabetically by surname otherwise, no contest or candidate
 * is scored, ranked, matched or recommended, and
 * `tests/neutrality-guards.test.ts` holds the record shapes to that.
 *
 * A zip is orientation, not identity — the ZCTA can cross municipal and
 * district lines, and the page says so before it says anything else.
 */

export const runtime = "nodejs";

/** What each supporting holding means to a reader, in their words. */
const AUXILIARY_READER_LABEL: Record<BallotAuxiliaryFamily, string> = {
  "candidate-profiles": "candidate profiles",
  "candidate-publications": "what candidates say in their own words",
  "federal-funding": "federal campaign money",
  "state-money": "state campaign money",
  "federal-directory": "federal officeholders",
  "registry-runtime": "the officials and districts that go with this ZIP",
  "nh-members": "New Hampshire legislators",
  "ballot-navigation": "registration and polling-place links",
};

/**
 * **F01 11.3 and 11.4 (2026-08-19, the author).**
 *
 * 11.3, the defect: *"'Candidates are listed alphabetically by surname.' That's
 * no longer the case, because we prioritize pictures as we should."* He is
 * right, and it had been wrong since the photo-first ordering shipped — the
 * page was making a checkable claim about its own contents that its own
 * contents contradicted. `photosFirst` puts candidates with a portrait above
 * those without, and surname order runs inside each of those two blocks.
 *
 * 11.4, what replaces it: *"the official ballot order either has not been drawn
 * yet or was not machine-readable from the authorities' filings; labels and
 * slogans appear as filed. Nothing on the page is a recommendation. Say that,
 * and stop claiming alphabetical order."*
 *
 * The ordering sentence now describes what the page actually does, and says
 * why in the same breath — a portrait is what makes a stranger able to tell two
 * candidates apart, and the alternative to leading with it is leading with the
 * alphabet, which is no less arbitrary and less useful. Naming the criterion is
 * what keeps it neutral: order by a stated, uniform, non-substantive property
 * is what `CLAUDE.md`'s never-rank rule permits, and equal effort per candidate
 * is what stops the photo block tracking incumbency.
 *
 * "Nothing on this page is a recommendation" is the vote-recommendation ban
 * made visible to the reader, and it is worded as a fact about the page rather
 * than as a disclaimer defending it — the author's distinction, and the same
 * one rule 4g drew when it cut "that's not a bias, it's a record".
 */
const NEUTRAL_NOTE =
  "The official ballot order either hasn't been drawn yet or wasn't machine-readable from the authority's filings. Candidates with a photo are listed first, then the rest, alphabetically by surname within each group — a photo is what lets someone tell two names apart. Party labels and slogans appear as filed. Nothing on this page is a recommendation.";

/**
 * **BAL-48 (2026-09-02): the length at which a contest's scope note is
 * "extended election-mechanics text" and collapses behind "More info".**
 *
 * The owner's instance was Corporation Commissioner on a phone: the office
 * explainer (which stays open — every race has one) followed by a further open
 * paragraph on how many seats are up, the document that states the seat count,
 * and the primary vote totals. That paragraph is `contest.scopeNote`, and at
 * ~300 characters it walls off the ballot on a narrow screen. A short authority
 * note — a one-line "nomination papers are not certified until September 2" —
 * is context a reader should see at a glance and stays inline. The threshold is
 * a plain character count, deterministic and viewport-independent; roughly two
 * lines of body text on a phone.
 */
const EXTENDED_MECHANICS_CHARS = 180;

/**
 * **THE ONE PAGE-LEVEL DISCLOSURE** (RULING 42, Prompt E item 3, 2026-08-20).
 *
 * It replaces `THIN_CANDIDATE_LINE`, which rendered per card and therefore
 * rendered only on the shortest card in a race — a badge on the least
 * resourced person running, which is the information asymmetry the
 * equal-effort rule exists to catch, wearing the costume of honesty about it.
 *
 * The fact worth telling a reader was never about one candidate. It is about
 * the page: cards are different lengths because we have collected different
 * amounts, and a short card is the end of our research rather than the end of
 * a person. Said once, at the foot, about every card equally, it cannot single
 * anybody out.
 *
 * ONCE PER PAGE, not once per contest and never per card — the repetition
 * RULING 28 ended. It sits below the contests, beside `NEUTRAL_NOTE`, and it
 * replaces nothing else: the contest-level incumbency footnote is a different
 * statement about a different thing and is untouched.
 *
 * LEVEL REGISTER, and unhedged. This is a claim surface — it is about our own
 * coverage of real people — so it is plain, and it does not apologize. "We
 * show what we have collected" is a fact; "we're sorry we don't have more"
 * would be an editorial about ourselves, which F01 struck from this product.
 */
/*
 * **THE AUTHOR'S OWN WORDS, AND THEY ARE SHORTER THAN MINE** (2026-08-20, his
 * note on `PE01`, verbatim: *"We should simply say \"What we have found, we are
 * displaying here.\" That's it."*).
 *
 * The first version of this shipped earlier the same day as two sentences —
 * *"We show what we have collected. Every card here carries every detail we
 * could find, so cards are different lengths."* He read it on the live deploy
 * and cut it to one. The second sentence was explaining the FIRST one, which is
 * the product talking about itself rather than telling a reader anything, and
 * "That's it" is the whole instruction: say it once and stop.
 */
/* The sentence itself now lives in `lib/ballot/collection-note.ts`, imported
   above, because RULING 51 gives it a second surface. Two literals is how a
   sentence he has already rewritten once drifts into two sentences. */

function candidatesOf(set: BallotSet, contest: Contest): Candidacy[] {
  return set.candidacies
    .filter((c) => c.contestId === contest.id)
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
}

/**
 * **The pick options for one contest, built ONCE** (F01-continued item 8).
 *
 * Both the rendered `PickControl` and the manifest handed to `MyPicks` call
 * this, so the tally's denominator is the rendered row count by construction.
 * A second query that produced its own list would be free to disagree with
 * what is on screen, and a denominator that can disagree with its own page is
 * the shape the stated-N-equals-rendered-rows rule exists to refuse.
 *
 * The measure branch carries no `reactionTargetId` and that is correct rather
 * than missing: a measure's reactions attach to its PROVISIONS, so there is no
 * measure-level Yes to derive a pick from. A candidate has one, which is
 * exactly why candidate picks were the half going uncounted.
 */
function pickOptionsFor(
  set: BallotSet | null,
  contest: Contest,
): { id: string; label: string; reactionTargetId?: string }[] {
  // A measure's options are the question itself and need no candidacy data,
  // which is why the measure section can call this without a set in hand.
  if (contest.type === "MEASURE") {
    return [
      { id: "YES", label: "Yes" },
      { id: "NO", label: "No" },
    ];
  }
  if (!set) return [];
  const lineup = lineupForContest(contest.id);
  if (lineup) {
    return lineup.nominees.map((n) => ({
      id: n.name,
      label: n.name,
      reactionTargetId: `${contest.id}|${n.name}`,
    }));
  }
  return candidatesOf(set, contest).map((cand) => ({
    id: cand.id,
    label: `${cand.givenName} ${surnameDisplayCase(cand.familyName)}`,
    reactionTargetId: cand.id,
  }));
}

/** Federal is decided by the contest, never by division shape — a governor's
 *  division is the state root exactly like a US Senate seat's. */
function isFederalContest(contest: Contest): boolean {
  return /:us-senate$|:us-house-\d+$/.test(contest.id);
}

/*
 * BC-3 (2026-08-22): `IncumbentRecord` is GONE, and the door it opened with it.
 *
 * It rendered "See their voting record →", which opened a SECOND modal from
 * inside the battlecard — so clicking Battlecard for Cory Booker showed his
 * campaign finance and the actual record was one more click down. The record
 * now renders INSIDE the battlecard's own Voting record drop-down, on the same
 * card as everything else, for every person on the page.
 *
 * The incumbency disclosure it carried is not lost: RULING 28's contest-level
 * footnote says the same thing once per contest instead of once per incumbent,
 * and it is untouched.
 */

/**
 * The candidate's NAME as the door to their large battlecard (g3 item 7) —
 * the map's click grammar, applied here.
 *
 * The name shown is the one AS FILED, never the roster's spelling: the ballot
 * is the ballot's document, and swapping in our own version of a person's
 * name because we happen to hold a record for them would be the card editing
 * the ballot. Falls back to plain text where the exact-key join finds no
 * record, because a door onto an empty card is worse than no door.
 */
async function IncumbentName({
  targetKey,
  name,
  context,
  readerEdge,
}: {
  targetKey: string;
  name: string;
  context: { zip: string; lat: number; lng: number } | null;
  /** The page's reader edge: React renders this component outside the page's own context. */
  readerEdge: ReaderAuthorityEdgeBundle | null;
}) {
  let holder: SeatHolder | null = null;
  try {
    holder = await withReaderAuthorityEdge(readerEdge, () => incumbentHolderFor(targetKey));
  } catch {
    // The page-level canonical holding notice names this failure. The filed
    // ballot name remains valid and must not disappear with an optional
    // officeholder join.
    holder = null;
  }
  if (!holder) {
    return (
      <span className="text-[0.9375rem] font-semibold tracking-tight">{name}</span>
    );
  }
  return <IncumbentNameLink holder={holder} name={name} context={context} />;
}

/** D34: the funding answer under one candidate — totals with the reaction
 *  control, an earned absence, or nothing when the snapshot has no record
 *  either way. */
async function CandidateFunding({
  targetKey,
  context,
  available,
  readerEdge,
}: {
  targetKey: string;
  context: { zip: string; lat: number; lng: number } | null;
  available: boolean;
  readerEdge: ReaderAuthorityEdgeBundle | null;
}) {
  if (!available) return unavailableHolding("federal campaign-finance");
  let answer: FundingAnswer;
  try {
    answer = fundingAnswerForTarget(targetKey);
  } catch {
    return unavailableHolding("federal campaign-finance");
  }
  /*
   * FRESHNESS PARITY (#6). The map official popup discloses campaign-finance
   * staleness / holding state in one sentence above the very same records
   * (funding-block.tsx). This surface used to render `fundingAnswerForTarget`
   * — the source-linked CORE answer — and drop the availability envelope, so
   * a stale or bootstrap FEC holding was disclosed on the map and silently
   * under-reported here. `assert.equal(ballotText, mapText)` in
   * reader-last-mile-render.mts is exactly this defect.
   *
   * The note is derived from the SAME settlement the /api/funding route uses
   * and the SAME shared helper the map renders, so the two surfaces cannot
   * drift, and it shows the ACTUAL source-through/status values rather than a
   * fixed date. It renders as a sibling above the section — mirroring the
   * map's structure — so the framed ballot leaf differs only by its own FEC
   * eyebrow. A settlement failure only drops the note; the source-linked
   * records below are unaffected.
   */
  let freshness: string | null = null;
  try {
    const settled = await withReaderAuthorityEdge(readerEdge, () => settleFundingHoldingAnswer(targetKey));
    if (settled.kind === "ANSWER") freshness = fundingFreshnessNote(settled);
  } catch {
    freshness = null;
  }
  if (answer.kind === "none" && !freshness) return null;
  // Item 12: the wrapper carries the marker `pnpm measure:ballot` counts, so
  // "the section moved" is a measured claim rather than a described one.
  return (
    <div data-candidate-funding>
      {freshness && <p className="funding-data-freshness">{freshness}</p>}
      {answer.kind === "absence" ? (
        <FundingAbsence data={answer.data} />
      ) : answer.kind === "funding" ? (
        <FundingDisplay data={answer.data} context={context} />
      ) : null}
    </div>
  );
}


/** State records and their disclosure use the same already-loaded authority. */
function stateCandidateFunding(
  targetKey: string,
  records: ReturnType<typeof stateMoneyForCard>["records"],
  context: ReactionViewContext | null,
) {
  const state = directFundingTargetPlan(targetKey).state;
  const read = state === null ? null : stateMoneyReadState(state);
  const freshness = read?.kind === "PROMOTED"
    ? fundingFreshnessNote({ holdingStatus: "HELD", dataState: "PROMOTED", dataMetadata: read.metadata })
    : null;
  // Return the slot itself synchronously: an empty component element would
  // prevent the battlecard's named gap from rendering. No new per-card read
  // is needed; the page has already checked this state's preload outcome.
  if (records.length === 0 && !freshness) return null;
  return <>
    {freshness && <p className="funding-data-freshness">{freshness}</p>}
    <StateMoneySection records={records} bare context={context} />
  </>;
}

/**
 * **ONE BATTLECARD BUILDER FOR EVERY PERSON ON THE BALLOT.**
 * (BC-1, BC-2, BC-3, BC-4, 2026-08-22, the author's 8/22 walkthrough, items 13
 * and 14.)
 *
 * ## What was wrong, in his words
 *
 * *"Right now there is no way to see data about a candidate from the ballot
 * page."* Clicking **Battlecard** for Cory Booker opened his campaign finance;
 * the actual battlecard was reachable only by clicking *"See their voting
 * record"* — a second modal, one more click down, inside the first. And
 * **Veronica Fernandez**, an independent running for the U.S. Senate with no
 * voting history, therefore had no voting-record link, therefore no way in at
 * all: no candidate info, no contact info, no campaign site, nothing.
 *
 * ## What this is
 *
 * The two contest branches — the party lineup and the filed candidacies — each
 * assembled their own battlecard children, with a comment noting that they
 * "must carry the same sections in the same order" and nothing enforcing it.
 * There is now ONE builder and both branches call it, so they cannot diverge.
 *
 * Every person gets the same seven drop-downs
 * (`lib/ballot/battlecard-sections.ts`), always, whatever we hold. **Being a
 * candidate is sufficient; a voting record is not a prerequisite for having a
 * card.**
 *
 * ## The record is IN the card now
 *
 * BC-3. Where a person holds or has held the office, their roll-call record
 * renders inside the Voting record drop-down rather than behind a link to a
 * second modal. Where they have not, the section says so in its own words —
 * which is a fact about their situation, not about our research, and BC-2 keeps
 * those two sentences apart.
 */
async function BallotBattlecard({
  name,
  partyLine,
  partyLabel = null,
  card,
  links = null,
  targetKey,
  contestTitle,
  contestOcdId,
  federal,
  contestCandidates,
  contestId,
  contestVoteFor,
  context,
  authorityAvailability,
  readerEdge,
}: {
  name: string;
  partyLine: React.ReactNode;
  /**
   * BAL-18: the raw label, so the card can render the map's coloured pill
   * rather than grey prose. `partyLine` stays as the fallback.
   */
  partyLabel?: string | null;
  /**
   * BAL-17: the candidate's own card row, which is where the portrait lives
   * and where the four-door photo rule has already had its say — a photo that
   * failed review is already `null` here (`lib/ballot/candidate-cards.ts`), so
   * this surface cannot resurrect one the review process removed.
   */
  card?: CandidateCardData | null;
  /** BAL-15: the campaign site, so the battlecard can hold what the row let go. */
  links?: CandidateLinks | null;
  /** The candidate key — `${contest.id}|${nominee.name}` or a candidacy id. */
  targetKey: string;
  contestTitle: string;
  /** The contest's division, so a state-scoped office explainer can resolve. */
  contestOcdId: string;
  /** Whether the contest is federal, which decides whether FEC money applies. */
  federal: boolean;
  /**
   * EVERY name in this contest, because incumbency is resolved PER CONTEST.
   * (2026-08-26, Items 10-15.)
   *
   * Either the seat's holder is known — in which case exactly the people who
   * hold it read `Incumbent` and everyone else in the contest reads
   * `Challenger` — or the holder is not known, in which case EVERY candidate in
   * the contest reads the same not-yet-sourced line. Resolved per candidate,
   * one card at a time, it would put a sourcing state on the card of whichever
   * person we happen to know less about, which is the per-card completeness
   * marker RULING 42 deleted.
   */
  contestCandidates: readonly { key: string; display: string; targetKey: string }[];
  contestId: string;
  /*
   * How many seats this contest fills. The contest-level eligibility gate
   * reconciles the holders a source returns against it (2026-08-28).
   */
  contestVoteFor: number | null;
  context: { zip: string; lat: number; lng: number } | null;
  authorityAvailability: BallotAuthorityAvailability;
  /**
   * The page's reader edge (R30, 2026-09-25). React renders this card from its
   * own render loop, outside the page function that entered the edge, so every
   * read below runs inside it explicitly or it would wake the database.
   */
  readerEdge: ReaderAuthorityEdgeBundle | null;
}) {
  /*
   * ONE lookup, used for three things: whether the record section has content,
   * which of BC-2's two empty states it shows, and whether the committee and
   * office sections have a holder to read. Resolved here rather than inside
   * each section so the card cannot say "no voting record" in one place and
   * render committees for the same person in another.
   */
  let holder: SeatHolder | null = null;
  if (authorityAvailability.officeholders && authorityAvailability.funding) {
    try {
      holder = await withReaderAuthorityEdge(readerEdge, () => incumbentHolderFor(targetKey));
    } catch {
      holder = null;
    }
  }

  /*
   * ITEMS 10-15 (2026-08-26) — INCUMBENCY COMES FROM HOLDING THE OFFICE.
   *
   * This used to be `incumbent={holder !== null}` off the line above, and the
   * line above is the FEC funding join, which its own doc block calls "federal
   * only by construction". Every non-federal candidate in the product therefore
   * arrived here as `false` and the card rendered `Challenger` — including for
   * Karen Ebel, the sitting Deputy Speaker of the New Hampshire House.
   *
   * `contestIncumbency` reads the OFFICEHOLDER side, per contest, and returns
   * three states. A miss is UNKNOWN, never `Challenger`.
   */
  let resolvedStanding: Awaited<ReturnType<typeof contestIncumbency>> | null = null;
  if (authorityAvailability.officeholders && contestVoteFor !== null) {
    try {
      resolvedStanding = await withReaderAuthorityEdge(readerEdge, () => contestIncumbency(
        {
          id: contestId,
          title: contestTitle,
          ocdId: contestOcdId,
          candidates: contestCandidates,
          federal,
          voteFor: contestVoteFor,
        },
        authorityAvailability.funding ? incumbentHolderFor : async () => null,
      ));
    } catch {
      resolvedStanding = null;
    }
  }
  const standing = resolvedStanding?.decisions.get(targetKey) ?? {
    standing: "UNKNOWN" as const,
    basis: authorityAvailability.officeholders
      ? "this candidate was not among the names this contest was resolved against"
      : "the canonical officeholder authority could not be read",
    source: null,
  };

  /*
   * The officeholder record to READ VOTES FROM. The federal join first,
   * because it is exact; otherwise the officeholder the contest resolution
   * matched to this candidate by seat.
   */
  const recordHolder = holder ?? resolvedStanding?.holderFor.get(targetKey) ?? null;

  const officeBlurb = blurbForContestTitle(contestTitle, contestOcdId);
  let positions: ReturnType<typeof positionsFor> = [];
  let positionsUnavailable = !authorityAvailability.candidatePublications;
  if (!positionsUnavailable) {
    try {
      positions = positionsFor(targetKey);
    } catch {
      positionsUnavailable = true;
    }
  }
  /*
   * State and local money (2026-08-24). Until this line existed, `money` was `null` for
   * every non-federal candidate — so a Morris County commissioner candidate,
   * who files with the New Jersey Election Law Enforcement Commission rather
   * than with the FEC, had a Campaign money section that STRUCTURALLY could
   * not fill. Not "no data yet": no code path.
   *
   * LEADs are already filtered out inside `stateMoneyForTarget`, so this
   * surface cannot render an unproven committee even by accident.
   */
  /*
   * **AND THE KEY IS THE RECONCILED CANDIDACY ID, NOT THE NOMINEE'S NAME.**
   * (Session C3, 2026-09-01. RULING 229.)
   *
   * This read `stateMoneyForTarget(targetKey)`, and `targetKey` on a certified
   * general-election nominee card is `${contest.id}|${nominee.name}` while the
   * state campaign-money snapshot keys its records to canonical CANDIDACY ids.
   * The two never met. Katie Hobbs' own card asked for
   * `ballot-az-pima:governor|Katie Hobbs`, the snapshot held
   * `ballot-az-pima:governor:hobbs-katie` carrying a reconciled FILED
   * $11,109,719.95, and the card rendered *"We don't hold a campaign finance
   * filing for this person"* — a sentence about US that was false about us.
   * Measured on rendered DOM at 9703dc9d: 4 money states across 22 non-federal
   * cards at 85701, and 4 across 25 at 85641.
   *
   * `stateMoneyForCard` resolves the card key through the PRECOMPUTED bridge in
   * `data/identity/` and hands `stateMoneyForTarget` the candidacy id. It does
   * no name matching — the matching happened once, over the whole population,
   * in `pnpm identity:az`, and a nominee it could not resolve comes back as the
   * OURS-gap state rather than as silence.
   */
  let stateMoney: ReturnType<typeof stateMoneyForCard>["records"] = [];
  let stateMoneyUnavailable = !federal && !authorityAvailability.stateMoney;
  if (!federal && !stateMoneyUnavailable) {
    try {
      stateMoney = stateMoneyForCard(targetKey, contestId).records;
    } catch {
      stateMoneyUnavailable = true;
    }
  }
  const contactCandidacyId = targetKey.includes("|") ? reconciledCandidacyIdForCard(targetKey) : targetKey;
  const filingContact = contactCandidacyId ? candidateContactForCandidacy(contactCandidacyId) : null;

  return (
    <CandidateBattlecard
      name={name}
      /* The contest's real government tier for the modal's tier ring — derived
         from the contest OCD id, never guessed; null stays neutral. */
      tier={tierForOcdId(contestOcdId)}
      partyLine={partyLine}
      partyLabel={partyLabel}
      photoUrl={card?.photoUrl ?? null}
      /*
       * BAL-20, corrected 2026-08-26. It used to read `incumbent={holder !==
       * null}` — a BOOLEAN off a federal-only lookup, so a null meant
       * `Challenger` rather than "we have not sourced this". Three states now,
       * resolved per contest, and the third is visibly about our sourcing.
       */
      incumbency={standing.standing}
      /*
       * WHICH gap the third state is (2026-08-28). The contest-level
       * eligibility gate can refuse a contest whose sitting member we DO hold,
       * and the original sentence would be false about US there. Both
       * sentences are about us; this picks the one that is also true.
       */
      incumbencyGap={standing.gap ?? null}
      speakContext={context ? { lat: context.lat, lng: context.lng } : null}
      subjectId={targetKey}
      /*
       * BC-2. A fact about the PERSON — do they hold or have they held this
       * office — never about how much we happen to hold on them. Without the
       * distinction a challenger's card reads as thinner than an incumbent's
       * because of COPY rather than data, which is the information asymmetry
       * the equal-effort rule exists to catch.
       */
      holdsOrHeldTheOffice={recordHolder !== null}
      /*
       * BAL-33 / BAL-35: the SAME record the map battlecard renders contact
       * routes from. One person, one record, both surfaces — which is what
       * the owner asked for in the sentence "anything the app holds anywhere
       * is available everywhere".
       */
      contactHolder={recordHolder}
      sections={{
        /* BC-6: mandatory for every candidate and every elected official.
           Somebody voting for governor needs to know what a governor does. */
        office: officeBlurb ? (
          <>
            <p className="text-[0.8125rem] leading-relaxed text-voice">{officeBlurb.text}</p>
            {officeBlurb.basis && (
              <p className="mt-1.5 text-[0.6875rem] text-muted">{officeBlurb.basis}</p>
            )}
          </>
        ) : null,
        positions:
          positionsUnavailable ? (
            unavailableHolding("candidate-publication")
          ) : positions.length > 0 ? (
            <CandidatePositions headline={positionsHeadline(positions)} positions={positions} />
          ) : null,
        /*
         * **BAL-33 (2026-08-30) — THE SAME DEFECT ITEM 14 FIXED, TWO LINES
         * ABOVE THE COMMENT EXPLAINING IT.**
         *
         * These read `holder`, which is `incumbentHolderFor` — the FEC funding
         * join, needing a `congress:` roster id. So for every non-federal
         * officeholder these sections had NO CODE PATH, and the owner opened
         * Katie Hobbs' ballot card, expanded *Offices near you*, and read *"We
         * don't hold an office location for this person"* beside a map card
         * for the same person carrying a phone number, an email, a contact
         * form and her official page.
         *
         * That sentence is about US and it was FALSE about us. We hold her
         * offices; this surface was asking the wrong record for them.
         *
         * ITEM 14 diagnosed exactly this on 2026-08-26 and repaired `record:`
         * — and `committees:` and `offices:`, immediately above it, kept the
         * federal-only lookup. The owner's standing instruction, failing
         * inside one object literal: *if the defect exists at that instance it
         * exists at the class.*
         *
         * `recordHolder` is the federal join OR the officeholder the contest
         * resolution matched to this candidate by seat — the same record the
         * map battlecard renders from.
         */
        /*
         * **AND THE SLOT IS NULL WHERE THE SOURCE DOES NOT REACH THEM.**
         * (Part C, 2026-08-31, found by grading `vac:ballot-offices-from-record`.)
         *
         * `recordHolder` being non-null says the RECORD exists. It says
         * nothing about whether the member DIRECTORY — committee seats and
         * district offices, sourced from the congressional snapshot — covers
         * them. Gating on `recordHolder` alone handed this card a truthy React
         * element that then rendered null, and `content ?? emptyLine` above
         * tests the SLOT rather than what the slot rendered — so the named gap
         * never fired and both sections opened to an EMPTY BOX. Measured on
         * Katie Hobbs' card at 85701: `innerHTML === ""`, zero children.
         *
         * A null renders as its named gap on every surface, always. The map
         * battlecard already did this correctly; this surface did not, which
         * is the same asymmetry BAL-33 was reported for.
         */
        committees:
          !authorityAvailability.officeholders ? (
            unavailableHolding("officeholder-directory")
          ) : recordHolder && memberDirectoryReaches(recordHolder.id) ? (
            <MemberCommitteesContent holder={recordHolder} />
          ) : null,
        offices:
          !authorityAvailability.officeholders ? (
            unavailableHolding("officeholder-directory")
          ) : recordHolder && memberDirectoryReaches(recordHolder.id, "offices") ? (
            <MemberOfficesContent holder={recordHolder} />
          ) : null,
        money: federal ? (
          <CandidateFunding targetKey={targetKey} context={context} available={authorityAvailability.funding} readerEdge={readerEdge} />
        ) : stateMoneyUnavailable ? (
          unavailableHolding("state campaign-finance")
        ) : stateCandidateFunding(targetKey, stateMoney, context),
        /* BC-3: the record, in the card. Not `columns` — the two-column form
           builds its own top-level sections, which would compete with the
           seven this card owns. */
        /*
         * ITEM 14 (2026-08-26) — THE PANEL GATES ON WHETHER RECORDS EXIST,
         * NOT ON THE FEDERAL JOIN.
         *
         * `holder` alone is `incumbentHolderFor`, which reads the FEC funding
         * snapshot and needs a `congress:` roster id. So a sitting state
         * legislator with roll calls already in
         * `data/votes/state-votes-snapshot.json` had NO DOOR to them: whether
         * someone has held office and whether we hold voting records for them
         * are two different questions, and collapsing them is why a sitting
         * Deputy Speaker rendered blank while her votes sat in a committed
         * file.
         *
         * `recordHolder` is the federal join OR the officeholder the contest
         * resolution matched by seat. Verified 2026-08-26: Karen Ebel resolves
         * to `plural:947e2e2b-04eb-4f92-9f83-aef8760517e0`, which carries
         * positions in the snapshot.
         */
        record: !authorityAvailability.officeholders ? (
          unavailableHolding("officeholder-directory")
        ) : recordHolder ? (
          <RecentVotes holder={recordHolder} reactionContext={context} contentOnly />
        ) : null,
        /*
         * **BAL-15 (2026-08-25).** Sources now carries three things the ballot
         * row let go of, plus the sentence Sean asked for about the tagline.
         *
         * It renders even where there is no officeholder record — which is the
         * change that matters for equal effort. `CandidateSources` returns
         * `null` for a challenger, so before this the Sources section on a
         * challenger's card was the honest empty line while an incumbent's
         * listed provenance. The contact a challenger DID publish now reaches
         * the same place, on the same card, in the same section.
         */
        sources: (
          <>
            {!authorityAvailability.candidateProfiles && unavailableHolding("candidate-profile")}
            {holder && <CandidateSources holder={holder} />}
            <CandidateContact card={card ?? null} links={links} filing={filingContact} />
            <p className="mt-2 text-[0.6875rem] leading-relaxed text-muted">
              {TAGLINE_SOURCE_NOTE}
            </p>
          </>
        ),
      }}
    />
  );
}

/**
 * The card's answer to "says who?", for a person we hold an officeholder
 * record for.
 *
 * Money and votes are deliberately absent from the list: those sections cite
 * themselves on the row, and the same claim in two registers reads as two
 * claims. Same assembler as the map's person card — one function, so the two
 * surfaces cannot disagree about provenance.
 */
function CandidateSources({ holder }: { holder: SeatHolder }) {
  // Read only as the reader edge primed it: this card never adds a database read to a cold ballot.
  const [office] = currentMemberOffices(holder.id);
  const sources = personCardSources(holder, office
    ? [{ what: "Their capitol and district offices", provenance: { sourceUrl: office.sourceUrl, sourceOrg: office.sourceOrg, collectedAt: office.collectedAt, verifiedAt: null } }]
    : []);
  if (sources.length === 0) return null;
  return <CardSourcesList sources={sources} />;
}

interface BallotAuthorityAvailability {
  readonly candidateProfiles: boolean;
  readonly candidatePublications: boolean;
  readonly funding: boolean;
  readonly stateMoney: boolean;
  readonly officeholders: boolean;
}

function unavailableHolding(family: string) {
  return (
    <p className="text-[0.8125rem] leading-relaxed text-voice" data-ballot-authority-unavailable={family}>
      Our canonical {family} holding could not be read for this request. This is an unknown holding state, not evidence that no record exists.
    </p>
  );
}


/** The tab names the page: this one inherited the map's "Public meetings near you". */
export const metadata: Metadata = {
  title: titleFor("Your ballot"),
  description: "The contests on your ballot, the candidates in them, and where to vote.",
};

/**
 * The reader authority edge for this render, fetched and NOT entered: an entry
 * made inside a helper never reaches its caller's later reads on Node 24
 * (tests/reader-edge-context.test.ts), so the page enters what this returns.
 * The four families the map's routes read (divisions, the federal
 * officeholders, the campaign-site URLs that key the officeholder graph in
 * production, the state legislators incumbency asks about), and since
 * 2026-09-25 the proven pointers the page read from the database: the ballot,
 * the candidate profiles and publications, the navigation links, the NH
 * roster, FEC and state money (`READER_BALLOT_AUTHORITY_FAMILIES`). Null when
 * nothing is published or the fetch failed; never reads the database.
 */
async function readBallotReaderEdge(): Promise<ReaderAuthorityEdgeBundle | null> {
  const manifest = await readReaderManifest().catch(() => null);
  if (!manifest?.authorityArtifacts) return null;
  return ensureReaderAuthorityEdge(manifest, undefined, READER_BALLOT_AUTHORITY_FAMILIES).catch(() => null);
}

export default async function BallotPage({
  searchParams,
}: {
  searchParams: Promise<{ zip?: string }>;
}) {
  const { zip: zipParam } = await searchParams;
  const zip = zipParam && /^\d{5}$/.test(zipParam) ? zipParam : null;
  let filingRead: Promise<Awaited<ReturnType<typeof readOfficialFilingsForReader>> | null> = Promise.resolve(null);

  const resolution = zip ? resolveZip(zip) : null;
  const centroid = resolution?.ok ? resolution.centroid : null;

    // Resolve the applicable state authority before opening its canonical
    // pointer. An unavailable ballot in another state cannot take this
    // Reader path down.
  let set: BallotSet | null = null;
  let matched: {
    contests: Contest[];
    absences: BallotAbsence[];
  } | null = null;
  let coverageNotes: string[] = [];
  let attempted = false;
  let divisionHoldingUnavailable = false;
  const ballotLoaderFailures: string[] = [];
  /* ASK04: the reader's resolved divisions, hoisted so the Ask surface at the
     foot of the page receives the SAME division list the contests were matched
     against. Rebuilding it there would be a second answer to one question. */
  let askOcdIds: string[] = [];
  /*
   * RULING 71 (NJ Hunt 3 item 3). Which of the divisions this zip reaches
   * COVER THE WHOLE ZIP, and which cover only part of it. A division covering
   * part governs some readers at this zip and not others, and which is a fact
   * about the reader's street rather than about our data. Those carry the
   * pill; the rest render with no marker at all. Null when the zip is outside
   * our committed geometry — in which case nothing is called certain, because
   * a render default may never manufacture a claim out of an unmeasured thing.
   */
  // The reader edge and the committed geometry start before anything waits (R30).
  const readerEdgeRead = centroid ? readBallotReaderEdge() : Promise.resolve(null);
  if (centroid) prefetchReaderGeography();
  // Certainty now includes the publisher's Census serving copy. Read it in
  // the same request bundle as the ballot, never ahead of the edge boundary.
  const certainty = await readerEdgeRead.then(edge => withReaderAuthorityEdge(edge, () => zipCertainty(zip)));

  /*
   * **THE READER EDGE IS ENTERED HERE, IN THE PAGE'S OWN FUNCTION.** (R30,
   * 2026-09-25.)
   *
   * A cold /ballot read about 50 MB from the database (measured on an isolated
   * copy, 2026-09-24): the registry runtime alone is ~24 MB, and it and the
   * federal directory are already published on the reader edge. Entered here,
   * every read this function awaits after this line (divisions, the
   * officeholder preloads) primes those families from the edge instead. The
   * async components React renders later run outside this function's context,
   * so each is handed `readerEdge` and runs its reads inside it.
   *
   * 2026-09-25: the ballot itself, the candidate profiles and publications,
   * the navigation links, the NH roster, FEC and state money are proven
   * pointers on the edge too (`PromotedEdgeEntry`), each read through its own
   * Reader (`readPromotedEdgeFirst`). On production a cold render's first
   * request still took 5.1–5.8 s reading them from a cold database: a pointer
   * and a proof read each, the ballot's first and alone. From the edge, the
   * ballot stage and the supporting stage below are memory reads; the order
   * stays because it is the failure-domain rule (a supporting family opens only
   * for the ballot that answered), not a database order. A family the manifest
   * does not carry, or a failed fetch, reads the database as before.
   */
  let readerEdge: ReaderAuthorityEdgeBundle | null = null;
  if (centroid) {
    readerEdge = await readerEdgeRead;
    if (readerEdge) enterReaderAuthorityEdge(readerEdge);
    filingRead = readOfficialFilingsForReader().catch(() => null);
    attempted = true;
    let pointDivisionIds: string[] = [];
    try {
      const divisions = await divisionsAt(centroid.lat, centroid.lng);
      pointDivisionIds = divisions.map((division) => division.ocdId);
    } catch {
      // The static, versioned zip-area index can still identify the requested
      // state authority. The unavailable registry/officeholder holding is
      // named below and may not turn a readable ballot into a 500.
      divisionHoldingUnavailable = true;
    }
    /*
     * A ZIP IS AN AREA (`NJ01`, 2026-08-22). The centroid answer is kept whole
     * and widened to every division whose territory reaches inside this zip —
     * see `lib/ballot/zip-divisions.ts` for why, and for what this deliberately
     * does not claim.
     */
    const ocdIds = await divisionIdsForZipArea(zip, pointDivisionIds);
    askOcdIds = ocdIds;
    for (const { state, source } of await readerBallotSourcesForDivisions(ocdIds)) {
      try {
        const candidate = source.normalize(await source.fetch());
        const hit = contestsForDivisions(candidate, ocdIds);
        if (hit.contests.length > 0 || hit.absences.length > 0) {
          set = candidate;
          matched = hit;
          coverageNotes = coverageNotesForScope(candidate, zip, ocdIds);
          break;
        }
      } catch {
        ballotLoaderFailures.push(state);
      }
    }
  }

  /*
   * The exact ballot authority has now answered. Only now may supporting
   * projections be opened, each in its own failure domain. Their outcome
   * controls only their own section; none can erase or replace `set`.
   */
  const auxiliaryPreloads = new Map<BallotAuxiliaryFamily, () => Promise<unknown>>();
  // Verified registration/polling routes are useful before a ballot or an
  // election calendar has been acquired. Neither is a publication dependency.
  if (centroid) auxiliaryPreloads.set("ballot-navigation", process.env.NODE_ENV === "production" ? settleBallotNavigationRead : async () => null);
  if (set && matched) {
    // Each edge first (2026-09-25): the edge's proven copy through the family's own Reader, else the database.
    auxiliaryPreloads.set("candidate-profiles", settleCandidateProfilesRead);
    auxiliaryPreloads.set("candidate-publications", settleCandidateCorpusRead);
    // Edge first (R30): the same settles `divisionsAt` and the officeholder
    // graph use, so an edge-served version is never read again from the
    // database in the same render.
    auxiliaryPreloads.set("registry-runtime", () => settleRegistryAuthorityReads("REGISTRY"));
    auxiliaryPreloads.set("federal-directory", settleFederalDirectoryRead);
    if (matched.contests.some(nhLegislativeRosterAppliesTo)) {
      // Incumbency completeness comes from the General Court's own whole
      // membership projection. It must be established before the synchronous
      // exact-seat resolver runs; a failed/absent read leaves that resolver
      // explicitly incomplete and is surfaced in the holding-gap list below.
      auxiliaryPreloads.set("nh-members", settleNhSeatHolders);
    }
    if (matched.contests.some((contest) => isFederalContest(contest))) {
      auxiliaryPreloads.set("federal-funding", settleFundingRead);
    }
    if (matched.contests.some((contest) => !isFederalContest(contest))) {
      const state = set.election.state as StateCampaignFinanceJurisdiction;
      auxiliaryPreloads.set(
        "state-money",
        () => settleStateMoneyRead(state),
      );
    }
  }
  const auxiliaryOutcomes = await settleBallotAuxiliaryPreloads(auxiliaryPreloads);
  const auxiliaryFailures = [...auxiliaryOutcomes.entries()]
    .filter(([, outcome]) => !ballotAuxiliaryPreloadSucceeded(outcome))
    .map(([family]) => family);
  const auxiliaryFailed = new Set(auxiliaryFailures);
  const authorityAvailability: BallotAuthorityAvailability = {
    candidateProfiles:
      auxiliaryPreloads.has("candidate-profiles") && !auxiliaryFailed.has("candidate-profiles"),
    candidatePublications:
      auxiliaryPreloads.has("candidate-publications") && !auxiliaryFailed.has("candidate-publications"),
    funding:
      auxiliaryPreloads.has("federal-funding") && !auxiliaryFailed.has("federal-funding"),
    stateMoney:
      auxiliaryPreloads.has("state-money") && !auxiliaryFailed.has("state-money"),
    officeholders:
      auxiliaryPreloads.has("registry-runtime") &&
      auxiliaryPreloads.has("federal-directory") &&
      !auxiliaryFailed.has("registry-runtime") &&
      !auxiliaryFailed.has("federal-directory"),
  };

  let registrationLinks: ReturnType<typeof currentRegistrationLinks> = [];
  let pollingPlaceLinks: ReturnType<typeof currentPollingPlaceLinks> = [];
  let electionOffices: ReturnType<typeof currentElectionOffices> = [];
  if (auxiliaryPreloads.has("ballot-navigation") && !auxiliaryFailed.has("ballot-navigation")) {
    try {
      registrationLinks = currentRegistrationLinks();
      pollingPlaceLinks = currentPollingPlaceLinks();
      electionOffices = currentElectionOffices(askOcdIds);
    } catch {
      auxiliaryFailures.push("ballot-navigation");
      auxiliaryFailed.add("ballot-navigation");
    }
  }

  const availableCardForNominee = (contestId: string, name: string): CandidateCardData | null =>
    authorityAvailability.candidateProfiles ? cardForNominee(contestId, name) : null;
  const availableLinksForNominee = (contestId: string, name: string): CandidateLinks | null =>
    authorityAvailability.candidateProfiles ? linksForNominee(contestId, name) : null;
  const availableCardForCandidacy = (candidacyId: string): CandidateCardData | null =>
    authorityAvailability.candidateProfiles ? cardForCandidacy(candidacyId) : null;
  const availableLinksForCandidacy = (candidacyId: string): CandidateLinks | null =>
    authorityAvailability.candidateProfiles ? linksForCandidacy(candidacyId) : null;
  const availableDerivedBlurbFor = (candidateId: string) =>
    authorityAvailability.candidatePublications ? derivedBlurbFor(candidateId) : null;

  const dates =
    set && matched && matched.contests.length > 0
      ? electionDatesFor(set.election.state)
      : null;

  const candidacyContests =
    matched?.contests.filter((c) => c.type === "CANDIDACY") ?? [];
  /*
   * BAL-29 (2026-08-28): measures carried NO ordering rule, so they rendered
   * in whatever order the curated file listed them — which is how Proposition
   * 425 came to sit above Proposition 423. The authority's own ballot order
   * wins where one is published; otherwise the proposition number, compared
   * as a NUMBER so 100 never sorts before 20. See lib/ballot/measure-order.ts.
   */
  const measureRecords = set ? measureRecordsForBallot(set) : [];
  const measureContests = orderMeasures(
    matched?.contests.filter((c) => c.type === "MEASURE") ?? [],
  );

  /*
   * **BAL-30 (2026-08-28) — THE MEASURE TEXT WAS ALREADY IN THE REPOSITORY
   * AND THE PAGE RENDERED IT AS MISSING.**
   *
   * `data/states/az/ballot/az-pima-2026.json` has carried a `measures[]` array since
   * 2026-08-27 holding four LOCAL measures with the official question verbatim
   * and, for two of them, the official interpretive statement verbatim. This
   * page referenced none of it: no `set.measures`, no `questionText`, no
   * `officialStatement`. Its only consumer was `lib/ask/ballot-inventory.ts`,
   * so a reader could get the words by ASKING for them and not by reading the
   * card they belong to.
   *
   * `lib/ballot/analyses.ts` states the rule this violated in its own header:
   * data in hand may never be displayed as missing. It is rendered now.
   *
   * The lookup is by `contestId` because that is the key the card is already
   * rendered under, and it returns null rather than throwing — a measure with
   * no record renders no block at all, which is what the eleven statewide
   * propositions (whose official words arrive as the Legislative Council
   * analysis below instead) legitimately are.
   */
  const measureFor = (contestId: string): Measure | null =>
    set?.measures.find((m) => m.contestId === contestId) ?? null;

  /*
   * **AND THE HEADING WAS WRONG ABOUT WHOSE BALLOT THIS IS.**
   *
   * One `<h2>Statewide measures</h2>` sat over a list that contains a Vail
   * Unified School District budget override — a question only the voters of
   * one district see. A reader at 85641 was told a school-district override
   * was a statewide proposition, which is a false claim about a government
   * made by a heading.
   *
   * The split is read off the DIVISION the contest already carries, never
   * asserted from the title: a bare `state:xx` identifier is the whole state,
   * and anything deeper — a county, a school district — is not.
   */
  const isStatewideDivision = (ocdId: string): boolean =>
    /^ocd-division\/country:us\/state:[a-z]{2}$/.test(ocdId);
  const statewideMeasures = measureContests.filter((c) =>
    isStatewideDivision(c.ocdId),
  );
  const localMeasures = measureContests.filter(
    (c) => !isStatewideDivision(c.ocdId),
  );

  /*
   * ASK04: what is ON SCREEN, for referent resolution only.
   *
   * The interpretation rung is handed these so a question like "what has she
   * done?" can resolve WHEN exactly one person is on the page and must ask
   * WHEN more than one is. It is contest titles and candidate names — public
   * facts about an election, already rendered on this page — and nothing about
   * the reader.
   */
  /*
   * **CANONICAL REFERENCES, NOT DISPLAY STRINGS** (PR #212 follow-up,
   * 2026-08-28).
   *
   * This used to be a list of contest titles and candidate names. They reached
   * the interpretation rung as prose and stopped there — the binder never saw
   * them, so nothing on this page was an entity Ask could RESOLVE, and
   * retrieval had nothing to select on. Katie Hobbs answered here by
   * coincidence, because she is a sitting statewide executive; the challenger
   * beside her on the same governor line did not exist to Ask at all.
   *
   * So every reference carries its canonical id — the same `candidacy.id`,
   * `contest.id` and general-lineup target key the cards above are rendered
   * and keyed with. Ballot truth is not duplicated into Ask: the id is the
   * pointer, and `lib/ask/ballot-inventory.ts` retrieves through it.
   */
  const askSubjects: {
    id: string;
    name: string;
    kind: "CONTEST" | "MEASURE" | "PERSON";
  }[] = [
    ...candidacyContests.map((c) => ({
      id: c.id,
      name: c.title,
      kind: "CONTEST" as const,
    })),
    ...measureContests.map((c) => ({
      id: c.id,
      name: c.title,
      kind: "MEASURE" as const,
    })),
    /* Read through the page's OWN helper, so the people offered as referents
       are exactly the people rendered on the cards above. */
    ...(set
      ? candidacyContests.flatMap((c) =>
          candidatesOf(set, c).map((k) => ({
            id: k.id,
            name: [k.givenName, k.familyName].filter(Boolean).join(" "),
            kind: "PERSON" as const,
          })),
        )
      : []),
    /* And the general-election nominees, keyed EXACTLY as the cards key them
       (`contestId|name`) — a differently derived key would resolve to a person
       and retrieve nothing. */
    ...candidacyContests.flatMap((c) =>
      (lineupForContest(c.id)?.nominees ?? []).map((n) => ({
        id: `${c.id}|${n.name}`,
        name: n.name,
        kind: "PERSON" as const,
      })),
    ),
  ].filter((v) => v.name.length > 0);

  /*
   * F01-continued item 8 — THE TALLY'S DENOMINATOR, and it is the rendered
   * rows rather than a number about them.
   *
   * Every contest below that renders a `PickControl` gets an entry here,
   * built by the SAME `pickOptionsFor` the control is rendered with. The two
   * candidacy branches and the measure branch all pass through it, so
   * "N of M" cannot describe a different ballot from the one on screen.
   *
   * `set &&` because the options builder needs the ballot set; with no set
   * there are no contests, hence no rows and nothing to count.
   */
  const pickableContests =
    set && matched
      ? [...candidacyContests, ...measureContests].filter(contest => contest.voteFor !== null).map((contest) => ({
          contestId: contest.id,
          contestTitle: contest.title,
          contestOcdId: contest.ocdId,
          voteFor: contest.type === "MEASURE" ? 1 : contest.voteFor ?? 0,
          options: pickOptionsFor(set, contest),
        }))
      : [];

  /*
   * 4c (2026-08-15): which ballot this page IS, read off its own contests
   * rather than from the zip. The zip is orientation and a ZCTA can cross a
   * county line; the contests that actually matched are what the reader is
   * looking at, so they are what a stored pick is compared against.
   */
  const currentJurisdictionKey =
    matched?.contests
      .map((c) => jurisdictionKeyForContestId(c.id))
      .find((key): key is string => key !== null) ?? null;

  /*
   * Item 5 (design pass): when the IDENTICAL source line would repeat on
   * every contest, it renders once — a marker at each contest, the full
   * citation once at the page's foot. Distinct sources never collapse
   * together, and a source used by one contest keeps its inline line.
   * De-cluttering, never de-sourcing.
   */
  const FOOTNOTE_MARKERS = ["*", "†", "‡", "§", "‖", "¶"];
  /*
   * **`*` IS RESERVED FOR THE INCUMBENCY FOOTNOTE** (RULING 28, Prompt D
   * item 1d, 2026-08-20), so the source sequence starts at `†`.
   *
   * The page has always run ONE marker sequence — source notes first, scope
   * notes continuing where they stop — precisely so that a `*` on this page
   * means one thing. RULING 28 puts an asterisk on every contest heading that
   * renders candidate cards, and without this the US Senate contest at 07866
   * rendered "Member of the United States Senate**": one asterisk meaning the
   * incumbency note and one meaning a source cited at the foot of the page,
   * side by side, indistinguishable.
   *
   * Reserved UNCONDITIONALLY, including on a ballot that renders no candidate
   * cards at all. A symbol that means different things on different pages is
   * the same defect one page later.
   */
  const MARKER_START = 1;
  type SourceCite =
    | { kind: "canvass"; url: string; issuedBy: string; readAt: string }
    | { kind: "filing"; url: string | null; org: string; collectedAt: string };
  const contestSourceKey = (cite: SourceCite): string =>
    cite.kind === "canvass"
      ? `canvass|${cite.url}|${cite.issuedBy}|${cite.readAt}`
      : `filing|${cite.url ?? ""}|${cite.org}|${cite.collectedAt}`;
  const contestCites = new Map<string, { cite: SourceCite; count: number }>();
  for (const contest of candidacyContests) {
    const lineup = lineupForContest(contest.id);
    const canvass = lineup ? getGeneralLineup()?.canvass : null;
    const cite: SourceCite =
      lineup && canvass
        ? {
            kind: "canvass",
            url: canvass.url,
            issuedBy: canvass.issuedBy,
            readAt: canvass.readAt,
          }
        : {
            kind: "filing",
            url: contest.provenance.sourceUrl ?? null,
            org: contest.provenance.sourceOrg,
            collectedAt: contest.provenance.collectedAt,
          };
    const key = contestSourceKey(cite);
    const entry = contestCites.get(key);
    if (entry) entry.count += 1;
    else contestCites.set(key, { cite, count: 1 });
  }
  // Markers are assigned in first-appearance order, only to sources that
  // actually repeat.
  const sharedSources: { key: string; marker: string; cite: SourceCite }[] = [];
  for (const [key, { cite, count }] of contestCites) {
    if (count > 1) {
      sharedSources.push({
        key,
        marker:
          FOOTNOTE_MARKERS[MARKER_START + sharedSources.length] ??
          `${MARKER_START + sharedSources.length + 1}`,
        cite,
      });
    }
  }
  /*
   * F01 11.1 (2026-08-19, the author) — THE SAME TRADE, APPLIED TO SCOPE NOTES.
   *
   * Eleven Arizona measures carry a byte-identical paragraph about the ballot
   * wording not being published yet. The mechanism above already exists for
   * exactly this shape (a source line repeated on every contest), so this uses
   * it rather than inventing a second one — same symbols, same first-appearance
   * order, same only-what-actually-repeats threshold — and CONTINUES the
   * sequence, so a `*` on this page means one thing.
   *
   * Both contest kinds go in: a scope note repeated across candidacy contests
   * is the same defect as one repeated across measures, and fixing only the
   * eleven the author happened to be looking at would be the instance rather
   * than the class.
   */
  const readerScopeNotes = new Map((matched?.contests ?? []).map((contest) => {
    const lineup = lineupForContest(contest.id);
    const canvass = lineup ? getGeneralLineup()?.canvass : null;
    const scope = readerContestScope(contest, {
      certified: lineup && canvass ? { count: lineup.nominees.length, sourceUrl: canvass.url, sourceOrg: canvass.issuedBy, readAt: canvass.readAt } : null,
      questionTextHeld: set?.measures.some((measure) => measure.contestId === contest.id && Boolean(measure.questionText.trim())),
    });
    return [contest.id, scope.currentNote] as const;
  }));
  const scopeNotes = sharedNotesFor(
    (matched?.contests ?? []).map((contest) => ({ id: contest.id, scopeNote: readerScopeNotes.get(contest.id) ?? null })),
    MARKER_START + sharedSources.length,
  );

  const contestSourceRef = (
    key: string,
  ): { shared: boolean; marker: string | null; anchor: string | null } => {
    const index = sharedSources.findIndex((s) => s.key === key);
    return index === -1
      ? { shared: false, marker: null, anchor: null }
      : { shared: true, marker: sharedSources[index].marker, anchor: `source-note-${index}` };
  };

  const filingProjection = await filingRead;
  const filingRows = filingProjection?.kind === "PROMOTED"
    ? filingsForDivisions(filingProjection.value.records as unknown as OfficialFiling[], askOcdIds) : [];

  return (
    /*
      **BAL-25 (2026-08-28) — THE BALLOT'S FIRST BREAKPOINT.**

      This element read `mx-auto max-w-2xl px-4 py-8` and there was not one
      `sm:`/`md:`/`lg:`/`xl:` utility anywhere on this surface — not in this
      2,282-line page and not in any of the thirteen `components/ballot/*`
      files. A 2,000px desktop rendered a 672px column and 1,328px of nothing.

      **WHAT THE WIDTH IS SPENT ON, and what it is deliberately not.** The
      reading measure does not move: prose stays capped at `lg:max-w-2xl`, the
      same 42rem a phone reader gets, because a 1,600px paragraph is not a
      desktop composition — it is the mobile page with the guard rails taken
      off. The width buys a SECOND COLUMN OF CARDS instead, so a desktop
      reader sees roughly twice as much of their ballot per screen at exactly
      the same line length.

      **AND IT IS A GRID OF WHOLE CARDS, NEVER OF LABEL/VALUE ROWS**
      (`docs/DESIGN.md` — "The two-column trap"). A contest heading is an
      arbitrarily long office title and a body name; put one in a fixed
      column beside a value and the value starves. Every card here spans its
      whole grid cell and stacks internally exactly as it does on a phone, so
      the trap has nothing to bite: the columns divide CARDS, not FIELDS.
    */
    <main className="mx-auto max-w-2xl px-4 py-8 text-paper lg:max-w-[68rem] lg:px-8 lg:py-10 xl:max-w-[76rem]">
      <BallotCapture zip={zip} />
      {/*
        **DARK-3 (2026-08-25) — THE TOGGLE IS ON THIS PAGE TOO.**

        Sean: *"no theme toggle on the ballot page; switching requires going
        back to the map."* The control lived only in the map sidebar, so a
        reader who came here to read a ballot in the dark had to leave the
        thing they came for, switch, and come back — which is the
        reader-friction rule almost exactly: an unnecessary trip between a
        reader and what they are trying to do.

        **IT IS THE SAME COMPONENT, not a second one.** `ThemeToggle` reads
        and writes `wtp.theme` through `useStoredTheme`, so the setting
        persists across the session no matter WHERE it was switched — which is
        the second half of what he asked for, and it is true by construction
        rather than by a second implementation agreeing with the first
        (RULING 103).

        It sits on the back-link row rather than in a bar of its own: that row
        is already the page chrome, and a new bar would push the ballot itself
        further down the first screen.
      */}
      <div className="ballot-page-chrome flex items-center justify-between gap-3">
        {/* 6b: the way back, top-left — the map is where the reader came from. */}
        <p className="text-[0.8125rem]">
          <Link
            href="/"
            className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            ← Back to the map
          </Link>
        </p>
        <ThemeToggle className="shrink-0" />
      </div>
      {/* ITEM J (2026-09-01): the page eyebrow was the product name typed as
          display text in a 10px uppercase MONO treatment — the register this
          system reserves for numerals and identifiers, worn by the one string
          that is neither. It is the lockup now.

          BAL-40 (2026-09-02): and the lockup leads. It sat at the 18px wordmark
          floor beneath a 24px headline — small, big, small down the page, with
          the brand the smallest mark on it. The owner's rule is that the logo
          is the prominent element and the headline comes down to sit under it;
          the wordmark reads first. 30px clears the 18px floor with room, and the
          headline drops from text-2xl to text-xl so the hierarchy reads logo,
          then page. Applied wherever the wordmark sits above a page headline. */}
      <div className="ballot-page-chrome mt-4">
        <Logo variant="wordmark" size={30} />
      </div>
      <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
        What&apos;s on the ballot{zip ? ` near ${zip}` : ""}
      </h1>

      {/* The app's voice (design pass): guidance renders in the voice
          register, distinct from the filed record below. */}
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-voice lg:max-w-2xl">
        A zip code is orientation, not your exact ballot — zip areas cross
        town and district lines. Everything below is presented as filed with
        election authorities, with the filing linked on every item.{" "}
        <span className="font-medium">We never suggest how to vote.</span>
      </p>

      {/* RULING 59 (2026-08-21) — THE COVERAGE NOTE IS DELETED, and this
          comment is its headstone rather than a TODO.

          A <CoverageNote> rendered here through NH Hunt 4. It stated a tier
          headline, counted the governments we had confirmed against the ones
          we had not, and named a residue: "18 more — water districts, fire
          districts, and the like — exist in the counties around you. We have
          not worked out which of them reach this ZIP code."

          It went false in one merge. The same session's first ship began
          rendering Lake Todd Village District's meetings on this page while
          that sentence, four inches away, still counted Lake Todd among the
          eighteen nobody had worked out. No test caught it and no test could
          have: the sentence is a claim ABOUT data that changes underneath it,
          and nothing can tell a correct render from a stale note about that
          render. It was caught by a human reading a screenshot.

          The author's ruling is that the page says one thing about
          completeness and nothing else — COLLECTION_NOTE, at the foot of the
          ballot section, which says the same thing about everything at once
          and cannot go stale. The enumeration of what is known-to-exist-but-
          not-reached is not lost; it moved to docs/gap-ledger.md, which is
          internal, generated, and current by construction. */}

      {/* Item 2 (2026-08-15): the way out of the limitation the sentence
          above states. Until now the page named the gap and stopped there;
          this resolves a street to a point and narrows the contests to the
          districts that actually contain it. Nothing is deleted — the
          set-aside contests are one tap from coming back. */}
      {/*
        **BAL-11 (2026-08-25) — BOTH LINKS BECOME PILLS, AT THE TOP.**

        His capture 09-08-18 has four things a reader can do on this page, drawn
        as two different kinds of object: "Where can I vote?" and "Check whether
        you're registered" are pills inside the election box, while "Narrow this
        to where you live" and "Moving here? Know the basics" are underlined
        links a screen apart — one above the election box and one below the
        whole contest list.

        Same kind of thing, two shapes, two places. They are pills now, and they
        are together directly under the heading, which is his stated lean.

        **REVERSIBLE, and noted as such because it is a lean rather than a
        ruling.** Putting them back is moving this block: the movers link is a
        plain Link and the narrowing is one self-contained component, so neither
        depends on sitting here. The narrowing keeps its internal phases exactly
        as they were.
      */}
      {zip && (
        <div className="ballot-top-pills">
          <BallotNarrowing zip={zip} className="ballot-top-pill" />
          <Link href={`/about-area?zip=${zip}`} className="ballot-top-pill">
            {/* 3c: the author's line, verbatim. Marijuana stays in the
                section; it left the teaser. */}
            Moving here? Know the basics →
          </Link>
          {/*
            **BAL-26 (2026-08-28) — ASK JOINS THE PILL ROW.**

            It was mounted dead last on this page, below every contest, every
            footnote, the measures, the scope notes, the absence blocks and
            the collection note — roughly 20,000px down at 1280 and 25,000px
            at 390. The engine was correct and reachable by nobody.

            The row directly under the h1 is where the page's other two
            doors already are, so Ask becomes the third rather than a fourth
            pattern. The panel itself is unchanged: same component, same
            engine, same props, same DOM contract.

            Third and last, so the two pills a reader arrived for keep their
            position. See `components/ballot/ballot-ask-pill.tsx` for what was
            borrowed from the map's cluster and what could not be.
          */}
          <BallotAskPill
            zip={zip}
            ocdIds={askOcdIds}
            activeSubjects={askSubjects}
          />
        </div>
      )}

      <OfficialFilings rows={filingRows} />
      {/* Who runs this reader's elections and how to reach them, from their own city's or county's saved page. */}
      {electionOffices.length > 0 && (
        <section aria-label="Your election offices" className="my-6 space-y-2 lg:max-w-3xl" data-ballot-election-offices>
          <h2 className="text-lg font-semibold">Your election offices</h2>
          {electionOffices.map((office) => (
            <p key={`${office.divisionId}:${office.phone}`}>
              {office.text}
              {office.phone && (
                <>
                  {", "}
                  <a href={`tel:+1${office.phone.replace(/\D/g, "").slice(-10)}`}>{office.phone}</a>
                </>
              )}
              <span className="text-paper-dim">
                {" · as listed on "}
                <a href={office.url}>{new URL(office.url).hostname.replace(/^www\./, "")}</a>
              </span>
            </p>
          ))}
        </section>
      )}
      {[...new Set(askOcdIds.flatMap(id => /\/state:([a-z]{2})(?:\/|$)/.exec(id)?.[1]?.toUpperCase() ?? []))]
        .filter(state => !(dates && set?.election.state === state)).map(state => {
          const registration = registrationLinkFor(state, registrationLinks);
          const polling = pollingPlaceLinkFor(state, pollingPlaceLinks);
          if (!registration && !polling) return null;
          return <section key={state} aria-label={`${state} voting information`} className="my-6 space-y-2">
            <h2 className="text-lg font-semibold">{state} voting information</h2>
            {registration && <p><a href={registration.url}>{registration.label}</a></p>}
            {polling && <p><a href={polling.url}>{polling.label}</a></p>}
          </section>;
        })}
      {set && (divisionHoldingUnavailable || auxiliaryFailures.length > 0) && (
        <section
          className="mt-4 rounded-[8px] border border-line bg-panel p-4 text-[0.8125rem] leading-relaxed text-voice lg:max-w-3xl"
          data-ballot-canonical-holding-gaps
        >
          <p>
            The ballot below is complete as filed. A few extras that go with it could not be loaded just now, and each is marked as not loaded where it would appear:
          </p>
          <ul className="mt-2 list-disc pl-5">
            {divisionHoldingUnavailable && <li>the officials and districts that go with this ZIP</li>}
            {auxiliaryFailures.map((family) => (
              <li key={family}>{AUXILIARY_READER_LABEL[family]}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Item 4 (2026-08-14 second session): the standing header — the
          tester's "that's when you want to catch somebody and make them
          ready to vote." The dates a reader acts on, at the top, each from
          the state's own timeline (cited on the dates section below), and
          election day one tap from their calendar. */}
      {dates &&
        set &&
        (() => {
          const reg = registrationLinkFor(set.election.state, registrationLinks);
          const polls = pollingPlaceLinkFor(set.election.state, pollingPlaceLinks);
          const regStep = dates.steps.find((s) =>
            /registration deadline/i.test(s.label),
          );
          const earlyStep = dates.steps.find((s) =>
            /early voting/i.test(s.label),
          );
          return (
            <section className="mt-6 rounded-[10px] border border-[var(--signal)]/60 bg-[var(--signal)]/5 p-5 shadow-[var(--shadow-panel)] lg:max-w-3xl">
              <h2 className="t-structure text-signal">The next election</h2>
              <p className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-[1.375rem] font-semibold tracking-tight">
                  {formatDateMDY(dates.electionDay)}
                </span>
                <AddToCalendar
                  event={{
                    id: `election-day-${set.election.state}-${dates.electionDay}`,
                    title: `Election Day — vote (${set.election.state})`,
                    allDayDate: dates.electionDay,
                    description:
                      `Your ballot, with sources: found via ${PRODUCT_NAME}.`,
                  }}
                />
              </p>
              <ul className="mt-2.5 space-y-1.5 text-[0.875rem]">
                {/*
                  **AZ-3, AZ-4 and AZ-5 (item 5, 2026-08-23) — the deadline is
                  a DATE here, and the action is the pill below.**

                  The registration destination reached the reader three times
                  inside about ten lines: an inline link on this line, the
                  Secretary of State named beneath it, and a third box below
                  the card repeating the same words. The author's ruling is
                  one prominent pill, and a repeated identical control makes a
                  reader wonder which one is the real one — the same reasoning
                  F21 applied to the polling-place pointer, applied to its
                  sibling.
                */}
                {regStep && (
                  <li data-dated-event>
                    Register to vote by{" "}
                    <span className="font-mono text-[0.8125rem] font-semibold">
                      {formatDateMDY(regStep.date)}
                    </span>
                    {/*
                      **BAL-21 (2026-08-25) — EVERY DATE THAT MATTERS GETS THE
                      SAME TREATMENT.**

                      Sean red-boxed the empty space right here on `17-44-07`:
                      election day had an Add to calendar, in-person early
                      voting had one, and the New Jersey registration deadline
                      — October 13th, 2026 — had nothing beside it. It is the
                      one date on this card a reader can MISS ENTIRELY and be
                      unable to fix afterwards, which makes it the worst one to
                      leave unsaveable.

                      `isUpcoming` guards it exactly as the early-voting window
                      is guarded: a deadline that has already passed gets no
                      control, because offering to put a dead date in somebody
                      calendar is friction that buys them nothing.

                      MTG-4 (8/22) is what the event carries: a title naming
                      the state and the act, and a description that says what
                      the date is for rather than repeating the label.
                    */}
                    {isUpcoming({ start: regStep.date, end: null }) && (
                      <>
                        {" "}
                        <AddToCalendar
                          event={{
                            id: `ballot-${set.election.state}-${regStep.date}-registration-deadline`,
                            title: `Voter registration deadline (${set.election.state})`,
                            allDayDate: regStep.date,
                            description:
                              regStep.detail ??
                              `Last day to register to vote in ${set.election.state} for the November 3rd, 2026 general election. Your ballot, with sources: found via ${PRODUCT_NAME}.`,
                          }}
                        />
                      </>
                    )}
                  </li>
                )}
                {earlyStep && (
                  <li data-dated-event>
                    {earlyStep.label}:{" "}
                    <span className="font-mono text-[0.8125rem] font-semibold">
                      {formatDateMDY(earlyStep.date)}
                    </span>
                    {/*
                      ITEM 16 (2026-08-19): THIS IS THE LINE THE AUTHOR
                      PHOTOGRAPHED. On 07866 it read
                      "In-person early voting: 10/24/2026 – 11/01/2026" with
                      no way to save it, sitting directly beneath an election
                      day that had one.

                      `formatDateMDY` already converts every ISO token in a
                      string, so the hand-rolled split on an en dash above it
                      was doing nothing the shared formatter did not — and it
                      would have failed on any other separator an authority
                      published.
                    */}
                    {(() => {
                      const w = windowOf(earlyStep.date);
                      if (!w || !isUpcoming(w)) return null;
                      return (
                        <>
                          {" "}
                          <AddToCalendar
                            event={{
                              id: `ballot-${set.election.state}-${w.start}-early-voting`,
                              title: `${earlyStep.label} (${set.election.state})`,
                              allDayDate: w.start,
                              allDayEndDate: w.end ?? undefined,
                              description: earlyStep.detail ?? undefined,
                            }}
                          />
                        </>
                      );
                    })()}
                  </li>
                )}
                {/* Item 6 (2026-08-15): "where do I vote" beside the dates
                    that decide whether you can. The state's own lookup, and
                    what it will ask for stated before the tap — a link that
                    demands a driver's licence number on arrival is friction
                    the reader could have been warned about. */}
                {/*
                  ITEM 15 (2026-08-19): the IN-APP answer, from the same panel
                  the map pill opens. This was a link OUT to the state's tool
                  while the canonical voting-site projection held six retrieved,
                  sourced, dated locations for this reader's own township. The
                  authority's tool is still offered below it, labelled as
                  leaving.

                F21 RESOLVED (2026-08-20, the author's ruling). It used to
                  render in BOTH this header and the checker box below,
                  because item 6 (2026-08-15) committed a guard naming both
                  places — written when the two were LINKS with different
                  surrounding context. Item 15 turned both into the same
                  in-app pill, and two identical controls read worse than the
                  two links did: a repeated identical control makes a reader
                  wonder which one is the real one, which is reader friction
                  and claims none of the four exceptions.

                  The author's ruling: the pointer is required ONCE PER PAGE,
                  and the dates header is where it lives. The guard's intent
                  was that a reader can always find it; one pill satisfies
                  that, and duplication was never the point.

                  THE NOTE CAME WITH IT rather than being deleted with the
                  duplicate. What the state's tool will ask for is worth
                  stating before the tap — a link that demands a driver's
                  licence number on arrival is friction the reader could have
                  been warned about — and that warning belongs wherever the
                  pointer now is.
                */}
              </ul>

              {/*
                **AZ-3 (item 5, 2026-08-23, the author's ruling) — the DATES
                are a list and the ACTIONS are pills.**

                *The voting section is five separate items — next election, add
                to calendar, check registration, where can I vote, search the
                Secretary of State's tool — and should read as next election,
                2026, early voting. Cut the rest of the noise.*

                The noise was that two ACTIONS were sitting in a list of DATES,
                so a reader scanning for when had to read past what-to-do, and
                a reader looking for what-to-do had to find it among dates. The
                list above is now dates only — election day, the registration
                deadline, early voting — and the two things a reader does are
                pills beneath it. Nothing was deleted: the polling-place
                pointer is still exactly once per page (F21), with the note
                about what the state's tool asks for still attached to it.
              */}
              {(polls || reg) && (
                <div className="mt-3 flex flex-col gap-3">
                  {/*
                    **BAL-3 (2026-08-24, the author's ruling) — the prompt is
                    DELETED.** It read "You will need your date of birth and
                    either a driver's licence number or the last four of your
                    Social Security number" and it was a warning about a tool
                    the reader is no longer being sent to: BAL-2 removed that
                    link, and the pill opens our own sourced answer, which asks
                    for nothing. A caution about a demand nothing makes is
                    friction with no reader on the other end of it.

                    The note itself is untouched in
                    lib/ballot/polling-place-links.ts — it is a fact about the
                    state tool, correctly recorded, and it stops RENDERING here
                    rather than being deleted.
                  */}
                  {polls && <WhereToVote />}
              {/*
                **ONE PILL, AT THE MOMENT OF NEED** (AZ-4 and AZ-5, the
                author's ruling, 2026-08-23).

                *The Secretary of State is the only authoritative source for
                registration status and polling location; the app cannot
                answer either, and a reader who trusts an in-app answer and
                does not check loses their vote.* Keeping readers in the app
                is right for everything except the two actions where the state
                is the system of record — so this one leaves, deliberately,
                and says so at the point of the tap.

                It sits inside the next-election box rather than in a separate
                card below it, which is where it was buried: the moment of
                need is beside the deadline, not four sections down.
              */}
                  {reg && (
                    <div>
                      {/*
                        **BAL-4 (2026-08-24) — THE WARNING MOVES ONTO THE
                        CONTROL, and this is the one place the author's cut
                        needed thinking about rather than executing.**

                        His spec is exact: this box holds the election date,
                        the registration deadline, early voting and the two
                        pills, and every other line comes out. The line that
                        came out under this pill was *"The Arizona Secretary of
                        State is the only place this can be checked — that
                        opens in a new tab and leaves this app."*

                        That sentence was doing a job the rest of the deleted
                        copy was not. This pill genuinely LEAVES THE PRODUCT,
                        and the friction rule's own example is a link that
                        springs a demand on a reader who was not told. Deleting
                        the sentence and nothing else would have satisfied
                        BAL-4 by making the app quieter about the one thing on
                        the page it should not be quiet about.
                        {" "}
                        So it is not deleted, it is RELOCATED ONTO THE CONTROL:
                        the arrow is the universal leaving mark, the accessible
                        name carries the whole sentence for a reader who cannot
                        see it, and the title shows it on hover. No line is
                        added to the box — a property of a control is not a
                        line — and nothing about the handoff is now implicit.
                      */}
                      <a
                        href={reg.url}
                        target="_blank"
                        rel="noreferrer"
                        data-leaves-app
                        data-registration-pill
                        className="voting-open-button"
                        title={`The ${reg.sourceOrg} is the only place this can be checked — that opens in a new tab and leaves this app.`}
                        aria-label={`${reg.label} — the ${reg.sourceOrg} is the only place this can be checked, and that opens in a new tab and leaves this app`}
                      >
                        {reg.label}
                        <span aria-hidden="true" className="ml-1.5">
                          ↗
                        </span>
                      </a>
                    </div>
                  )}
                </div>
              )}
              {/*
                **BAL-4 (2026-08-24) — this sentence LEAVES THE BOX.**

                The author's spec for the next-election box is exact: the
                election date, the registration deadline, early voting, and the
                two pills. Every other line comes out.

                It is not deleted from the page — it answered a real confusion
                the tester reported on 2026-08-14 and it still does. It moves
                below the box, where it introduces the contests it is about
                rather than sitting inside a card about dates.
              */}
            </section>
          );
        })()}

      {/* BAL-4: the tester's exact confusion (2026-08-14), answered in one
          line — now BELOW the next-election box rather than inside it. The
          propositions sentence renders only where propositions actually share
          the ballot. */}
      {set && matched && (
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-voice lg:max-w-2xl">
          The contests below are recorded for areas that may overlap this ZIP. Check your address with your election office for the exact ballot.
          {measureContests.length > 0 &&
            " Propositions are voted on at the same time."}
        </p>
      )}

      {/* 7: the mover's page. BAL-11 (2026-08-25) moved this link UP into the
          pill row under the heading — see there for why, and for how to put it
          back. Nothing was deleted; the route is unchanged. */}

      {!zip && (
        <p className="mt-6 text-[0.8125rem] text-muted lg:max-w-2xl">
          Open this page with a zip, e.g.{" "}
          <Link href="/ballot?zip=07866" className="underline decoration-dotted">
            /ballot?zip=07866
          </Link>
          .
        </p>
      )}

      {zip && !centroid && (
        <p className="mt-6 text-[0.8125rem] text-muted lg:max-w-2xl">
          We couldn&apos;t place that zip. Try another, or return to{" "}
          <Link href="/" className="underline decoration-dotted">
            the map
          </Link>
          .
        </p>
      )}

      {attempted && !matched && ballotLoaderFailures.length > 0 && (
        <p
          className="mt-6 text-[0.8125rem] leading-relaxed text-muted lg:max-w-2xl"
          data-ballot-authority-unavailable={ballotLoaderFailures.join(",")}
        >
          The canonical ballot authority for this area could not be read. This is an unknown holding state, not evidence that no candidates or ballot items exist.
        </p>
      )}

      {attempted && !matched && ballotLoaderFailures.length === 0 && divisionHoldingUnavailable && (
        <p
          className="mt-6 text-[0.8125rem] leading-relaxed text-muted lg:max-w-2xl"
          data-ballot-division-authority-unavailable
        >
          The canonical division registry could not be read, so this request could not be assigned to a ballot authority. This is an unknown holding state, not evidence that no ballot exists.
        </p>
      )}

      {attempted && !matched && ballotLoaderFailures.length === 0 && !divisionHoldingUnavailable && (
        <p className="mt-6 text-[0.8125rem] leading-relaxed text-muted lg:max-w-2xl">
          We&apos;re working on getting this info. Ballot coverage
          currently reaches Pima County AZ, Morris County NJ, and Merrimack
          County NH. This is not a statement that nothing is on your ballot.
        </p>
      )}

      {/*
        **THE SEPARATE REGISTRATION CHECKER BOX IS GONE** (AZ-4 and AZ-5, the
        author's ruling, item 5, 2026-08-23; it was `2c`, 2026-08-15).

        It was the THIRD appearance of one destination inside about ten lines
        — an inline link on the deadline line, the Secretary of State named
        beneath it, and this box repeating the same words in a card of its
        own. Its stated purpose, *prominent — the first thing a voter needs to
        know is whether they can vote at all*, is exactly right and is now
        served better: the single pill sits INSIDE the next-election box,
        beside the deadline it belongs to, rather than four sections below it.

        This is F21's reasoning applied to registration. F21 removed the
        duplicate polling-place pointer from this same box and left the
        registration half standing, because at the time it was the only copy
        that had a card to itself. It was still a duplicate.
      */}

      {/* 4a: the private election-day list — renders only once something
          is marked. Device-local; the component says so itself. */}
      <MyPicks
        currentJurisdictionKey={currentJurisdictionKey}
        pickable={pickableContests}
      />

      {dates && (
        <section className="mt-6 rounded-[10px] border border-[var(--panel-border)] p-5 lg:max-w-2xl">
          <h2 className="t-structure text-paper-dim">
            Dates that decide whether you can vote
          </h2>
          <ul className="mt-2.5 space-y-1.5">
            {calendarableSteps(dates.steps).map(({ step, window, upcoming }) => (
              /*
                **BAL-25 (2026-08-28) — THIS ROW PUSHED THE PHONE PAGE 75px
                SIDEWAYS, AND IT IS THE TWO-COLUMN TRAP EXACTLY.**

                Found by measuring `document.documentElement.scrollWidth` at
                390x844 on 07866 rather than by looking at a screenshot: the
                page scrolled horizontally and nothing about it looked wrong.

                `docs/DESIGN.md`, "The two-column trap": a row that puts a
                label and a value in competition for a fixed width will
                eventually starve the value, and the answer where either side
                can be arbitrarily long is to STACK rather than to tune the
                width. This row was `flex justify-between` with a `shrink-0`
                value — so the value could not give ground, and New Jersey's
                in-person early voting WINDOW ("October 24th, 2026 – November
                1st, 2026" plus its Add-to-calendar control, 374px of it) took
                the ground from the viewport instead.

                `flex-wrap` and a value that may shrink: the value drops to
                its own line when it does not fit beside the label, and its
                own contents wrap within that line. Nothing is truncated,
                nothing is abbreviated, and no width is tuned.
              */
              <li
                key={step.label}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
              >
                <span className="text-[0.8125rem]">{step.label}</span>
                <span className="ml-auto min-w-0 text-right" data-dated-event>
                  <span className="font-mono text-[0.75rem] text-signal">
                    {formatDateMDY(step.date)}
                  </span>
                  {/*
                    ITEM 16 (2026-08-19): every dated voting event with a
                    known date carries the affordance, WINDOWS INCLUDED.

                    This used to read `/^\d{4}-\d{2}-\d{2}$/.test(step.date)`
                    with a comment saying ranges render without a link — so
                    New Jersey's in-person early voting, 10/24 through 11/01,
                    was the one event on the page a reader could not save. It
                    is also the one with a window to MISS rather than a
                    deadline to remember.

                    The second half was invisible: `upcoming` used to be
                    decided by `new Date().toISOString().slice(0, 10)`, a UTC
                    day, which is AHEAD of Phoenix for the seven hours after
                    5pm — so a step dated today lost its affordance every
                    evening. It is decided on the Phoenix wall clock now
                    (`lib/ballot/dated-events.ts`), and a window counts as
                    ahead until its LAST day is past.

                    A step whose `date` is an official phrase rather than a
                    date still gets nothing, and that is right: inventing a
                    date to make a button possible is the fabrication rule.
                  */}
                  {window && upcoming && (
                    <>
                      {" "}
                      <AddToCalendar
                        event={{
                          id: `ballot-${set?.election.state ?? "xx"}-${window.start}-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                          title: `${step.label} (${set?.election.state ?? ""})`,
                          allDayDate: window.start,
                          // Inclusive; the exclusive DTEND is computed once,
                          // in lib/calendar/event-links.ts.
                          allDayEndDate: window.end ?? undefined,
                          description: step.detail ?? undefined,
                        }}
                      />
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6875rem] text-muted">
            From the{" "}
            <a
              href={dates.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted"
            >
              {dates.sourceOrg} official timeline
            </a>
            , read {formatDateMDY(dates.collectedAt)}.
          </p>
        </section>
      )}

      {/*
        JUR-4 (`NH84`, 2026-08-23): the jurisdiction answer ONCE, above the
        contests, instead of eleven words repeated down the page. The list is
        built from the same `needsPill` decision each contest heading uses, so
        the block and the marks can never disagree about which contests are
        affected — a second query would be free to.
      */}
      {set && matched && certainty && (
        <JurisdictionNote
          /*
           * UNKNOWN is COUNTED, not named — see the component. Naming a
           * division we hold no boundary for would turn our missing polygon
           * into a claim about that district's geography.
           */
          unplaceable={
            candidacyContests.filter(
              (contest) => certainty.certaintyOf(contest.ocdId) === "UNKNOWN",
            ).length
          }
          jurisdictions={[
            ...new Set(
              candidacyContests
                .filter((contest) => certainty.certaintyOf(contest.ocdId) === "AMBIGUOUS")
                /*
                 * The BODY, not the OFFICE. The first version of this block
                 * mapped `contest.title` and told the reader the governments
                 * covering part of their zip were "Member of the Borough
                 * Council, Member of the Board of Education, Member of the
                 * Board of Education — Unexpired Term" — three job titles, two
                 * of them identical, which a reader who knows their own town
                 * cannot use. Naming the jurisdictions is the whole point of
                 * the block; caught by reading the rendered page.
                 */
                .map((contest) => jurisdictionNameFromOcdId(contest.ocdId))
                .filter((name): name is string => name !== null),
            ),
          ]}
          /* BAL-7 (2026-08-24): the block ends with the address prompt itself.
             The zip scopes the prompt to this page's area. */
          zip={zip ?? ""}
        />
      )}

      {/* BAL-43: offices read top to bottom. Desktop columns compare the
          candidates within one office, with the same ballot order below. */}
      {set && matched && (
      <div className="ballot-office-list">
      {candidacyContests.map((contest, contestIndex) => {
          const lineup = lineupForContest(contest.id);
          const canvass = lineup ? getGeneralLineup()?.canvass : null;
          // Item 5 (design pass): a source line identical across contests
          // renders as a footnote marker here and one citation at the
          // page's foot. Distinct sources never collapse together.
          const sourceRef =
            lineup && canvass
              ? contestSourceRef(
                  `canvass|${canvass.url}|${canvass.issuedBy}|${canvass.readAt}`,
                )
              : contestSourceRef(
                  `filing|${contest.provenance.sourceUrl ?? ""}|${contest.provenance.sourceOrg}|${contest.provenance.collectedAt}`,
                );
          return (
            <section
              key={contest.id}
              // Item 2: what the address narrowing hides and un-hides. The
              // page always RENDERS every contest the zip produced — the
              // narrowing is presentation, so "show the whole zip again" is
              // instant and can never fail.
              data-contest-id={contest.id}
              /*
               * RULING 71. The division this contest sits on, so the pill's
               * client half can clear exactly the ones a session address
               * resolves — and so a walk can assert which contests carried it
               * without reading pixels.
               */
              data-ocd-id={contest.ocdId}
              data-office-tier-start={
                contestIndex > 0 &&
                tierForOcdId(contest.ocdId) !== tierForOcdId(candidacyContests[contestIndex - 1].ocdId)
                  ? "true"
                  : undefined
              }
              data-could-govern={
                certainty && needsPill(certainty.certaintyOf(contest.ocdId))
                  ? "true"
                  : undefined
              }
              className="ballot-office-card rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-5 shadow-[var(--shadow-panel)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <h2 className="text-[1.0625rem] font-semibold tracking-tight">
                  {contest.title}
                  {/* BAL-41 (2026-09-02): the level tag, immediately after the
                      last word of the race title, in the tier's accent. Tier
                      from the contest's OCD identity — never the office name. */}
                  <LevelTag tier={tierForOcdId(contest.ocdId)} />
                  {/*
                    RULING 71, as JUR-4 leaves it (2026-08-23). The full
                    eleven-word pill rendered here twelve times across nine
                    contests, which is the repetition the author named the
                    headline UX problem of the New Jersey pass. It is one short
                    mark now, tied to the single page-level block above. Still
                    NOT a completeness marker: our data is complete and the
                    reader's location is not. See the component for why that
                    distinction is load-bearing.
                  */}
                  {certainty && needsPill(certainty.certaintyOf(contest.ocdId)) && (
                    <JurisdictionMark />
                  )}
                  {/* RULING 28: the one buried annotation, on contests that
                      actually render candidate cards. */}
                  {(lineup || candidatesOf(set, contest).length > 0) && (
                    <IncumbencyMarker />
                  )}
                  {sourceRef.shared && (
                    <sup>
                      <a
                        href={`#${sourceRef.anchor}`}
                        title="Source, cited once at the foot of this page"
                        className="ml-0.5 font-mono text-[0.6875rem] text-muted no-underline hover:text-link"
                      >
                        {sourceRef.marker}
                      </a>
                    </sup>
                  )}
                </h2>
                <p className="t-eyebrow text-muted">
                  {contest.voteFor !== null ? `Vote for ${contest.voteFor}` : "We're working on getting this info"}
                  {contest.termYears ? ` · ${contest.termYears}-year term` : ""}
                </p>
              </div>

              {/* 4b (2026-08-17): what this office actually does, in the
                  register, at the top of the contest. Describes the office,
                  never the people running for it. Voice register. */}
              {(() => {
                const blurb = blurbForContestTitle(contest.title, contest.ocdId);
                return blurb ? (
                  <p className="mt-2 text-[0.75rem] leading-relaxed text-voice">
                    {blurb.text}
                    {blurb.basis && (
                      <span className="text-muted">
                        {" "}
                        (Powers defined in: {blurb.basis}.)
                      </span>
                    )}
                  </p>
                ) : null;
              })()}

              {/* 6c: the record behind this contest, at the top of the card
                  — never buried at the page bottom. When the identical line
                  covers several contests it collapses to the marker above
                  (item 5) — de-cluttering, never de-sourcing. */}
              {/*
                G05 rule 4h (2026-08-17): the same record, behind one tap.
                The pointer NAMES the source organisation, so the summary is
                honest standing alone; the panel carries the link and the read
                date, verbatim and complete, in the app.
              */}
              {!sourceRef.shared && (
                <FilingNote
                  summary={
                    lineup && canvass
                      ? `Nominees per the certified primary canvass (${canvass.issuedBy})`
                      : `Candidates as filed with ${contest.provenance.sourceOrg}`
                  }
                >
                  {lineup && canvass ? (
                    <>
                      Nominees per the{" "}
                      <a
                        href={canvass.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted underline-offset-2 hover:text-link"
                      >
                        certified primary canvass
                      </a>{" "}
                      ({canvass.issuedBy}) · read {formatDateMDY(canvass.readAt)}
                    </>
                  ) : (
                    <>
                      <a
                        href={contest.provenance.sourceUrl ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted underline-offset-2 hover:text-link"
                      >
                        {contest.provenance.sourceOrg} filing
                      </a>{" "}
                      · read {formatDateMDY(contest.provenance.collectedAt)}
                    </>
                  )}
                </FilingNote>
              )}

              <FilingChanges removals={(set.removals ?? []).filter((record) => record.contestId === contest.id)} />

              {/* The certified lineup retires the filing-list fallback (6a):
                  what a November voter actually chooses among. */}
              {lineup ? (
                <>
                <ul className="ballot-candidate-grid mt-3.5">
                  {photosFirst(lineup.nominees, (n) => Boolean(availableCardForNominee(contest.id, n.name)?.photoUrl)).map((nominee) => (
                    <li
                      key={nominee.name}
                      data-candidate-target={`${contest.id}|${nominee.name}`}
                    >
                      <CandidateCard
                        name={nominee.name}
                        partyLine={
                          <>
                            {/* 3a: display only, colored per the palette. */}
                            <span style={{ color: partyColorVar(nominee.partyLabel) }}>
                              {readerPartyLabel(nominee.partyLabel)}
                            </span>
                            {nominee.note && <> · {nominee.note}</>}
                          </>
                        }
                        card={availableCardForNominee(contest.id, nominee.name)}
                        links={availableLinksForNominee(contest.id, nominee.name)}
                        derivedBlurb={availableDerivedBlurbFor(`${contest.id}|${nominee.name}`)}
                        nameSlot={
                          <IncumbentName
                            targetKey={`${contest.id}|${nominee.name}`}
                            name={nominee.name}
                            context={
                              centroid && zip
                                ? { zip, lat: centroid.lat, lng: centroid.lng }
                                : null
                            }
                            readerEdge={readerEdge}
                          />
                        }
                        /* ITEM 12 (2026-08-19): the long sections moved off
                           the inline row and into the battlecard. Three of
                           them — "in their own words", campaign money, and
                           the incumbent record door — and the ROW now keeps
                           only portrait, name, party, the short sourced line,
                           the links row and this pill.

                           The sections are server components handed across
                           the boundary as children, which is why they are
                           written here rather than inside the pill. */
                        battlecardSlot={
                          <BallotBattlecard
                            name={nominee.name}
                            partyLine={readerPartyLabel(nominee.partyLabel)}
                            partyLabel={readerPartyLabel(nominee.partyLabel)}
                            card={availableCardForNominee(contest.id, nominee.name)}
                            links={availableLinksForNominee(contest.id, nominee.name)}
                            targetKey={`${contest.id}|${nominee.name}`}
                            contestTitle={contest.title}
                            contestOcdId={contest.ocdId}
                            federal={isFederalContest(contest)}
                            contestId={contest.id}
                            contestVoteFor={contest.voteFor}
                            contestCandidates={lineup.nominees.map((n) => ({
                              key: `${contest.id}|${n.name}`,
                              display: n.name,
                              targetKey: `${contest.id}|${n.name}`,
                            }))}
                            context={
                              centroid && zip
                                ? { zip, lat: centroid.lat, lng: centroid.lng }
                                : null
                            }
                            authorityAvailability={authorityAvailability}
                            readerEdge={readerEdge}
                          />
                        }
                      />
                      {/* 3d: reader expression, never a recommendation — the
                          answer is stored and aggregated, never rendered
                          back, and nothing orders candidates by it.

                          STAYS INLINE, and the decision is recorded rather
                          than assumed. It is not a long section and step 3's
                          constraint is "nothing long"; it has no battlecard
                          slot on the candidate path; and moving the revenue
                          path behind a tap changes WHAT GETS CAPTURED, which
                          `CLAUDE.md`'s "Ask before" list reserves to the
                          author. The tension with "reactions are always asked
                          after the explanation" is real and is answered by
                          the row keeping the short sourced line and the blurb
                          above this control, with the fuller explanation one
                          tap away in the pill directly above it. */}
                      <ReactionControl
                        targetType="CANDIDATE"
                        targetId={`${contest.id}|${nominee.name}`}
                        prompt="Would you vote for them?"
                        context={
                          centroid && zip
                            ? { zip, lat: centroid.lat, lng: centroid.lng }
                            : null
                        }
                        // M63: counted from the lineup itself, so a contest
                        // stops being uncontested the moment a second name
                        // appears. The server derives the same set.
                        singleCandidateContest={lineup.nominees.length === 1}
                      />
                    </li>
                  ))}
                </ul>
                <IncumbencyFootnote />
                {!isFederalContest(contest) && (
                  <StateFundingNote note={STATE_FUNDING_NOTE} />
                )}
                {/* 4a: the private pick — a different thing from the
                    reactions above, and it says so. */}
                <PickControl
                  contestId={contest.id}
                  contestTitle={contest.title}
                  voteFor={contest.voteFor ?? 0}
                  /* M134: the reaction target for this nominee, so a Yes on
                     the control above becomes the pick here. F01-continued
                     item 8: through the shared builder, so the tally counts
                     exactly these rows. */
                  options={pickOptionsFor(set, contest)}
                />
                </>
              ) : (
                <>
                  {/* F01 11.1: inline when this note is this contest's alone;
                      a marker when it is the same note eleven contests carry. */}
                  {readerScopeNotes.get(contest.id) &&
                    (scopeNotes.isShared(contest.id) ? (
                      <p className="mt-1.5 font-mono text-[0.6875rem] text-muted">
                        <a
                          href="#scope-notes"
                          className="underline decoration-dotted underline-offset-2 hover:text-link"
                        >
                          {scopeNotes.markerFor(contest.id)} see note
                        </a>
                      </p>
                    ) : (readerScopeNotes.get(contest.id)?.length ?? 0) > EXTENDED_MECHANICS_CHARS ? (
                      /* BAL-48: extended election-mechanics text collapses
                         behind "More info", by default, on every viewport — the
                         office explainer above stays open. Same disclosure
                         pattern the measures' official analysis uses. */
                      <details className="mt-1.5" data-scope-note-collapsed>
                        <summary className="t-eyebrow cursor-pointer text-muted hover:text-link">
                          More info
                        </summary>
                        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
                          {readerScopeNotes.get(contest.id)}
                        </p>
                      </details>
                    ) : (
                      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
                        {readerScopeNotes.get(contest.id)}
                      </p>
                    ))}
                  <ul className="ballot-candidate-grid mt-3.5">
                    {photosFirst(candidatesOf(set, contest), (x) => Boolean(availableCardForCandidacy(x.id)?.photoUrl)).map((cand) => (
                      <li
                        key={cand.id}
                        data-candidate-target={cand.id}
                      >
                        <CandidateCard
                          name={`${cand.givenName} ${surnameDisplayCase(cand.familyName)}`}
                          partyLine={
                            <>
                              {/* 3a: display only, colored per the palette;
                                  no-affiliation stays gray. */}
                              {/*
                                **A MISSING PARTY LABEL RENDERS NOTHING**
                                (2026-08-23, item 3). This read `?? "No party
                                label filed"`, which is a specific, checkable
                                claim about a named person's FILING — made from
                                a null that far more often means nobody has
                                collected the party yet. It is the render-
                                default rule exactly: our gap becoming their
                                fact. RULING 28 says a field with no data
                                renders nothing, and every other party surface
                                in this product already does — the officials
                                popup, the entity modal, the coverage notice
                                and the identity chip all guard on the value.
                                This was the outlier.
                              */}
                              {cand.partyLabel !== null && (
                                <span style={{ color: partyColorVar(cand.partyLabel) }}>
                                  {readerPartyLabel(cand.partyLabel)}
                                </span>
                              )}
                              {cand.slogan && (
                                <>
                                  {" "}
                                  ·{" "}
                                  <span className="italic">
                                    &ldquo;{cand.slogan}&rdquo;
                                  </span>
                                </>
                              )}
                            </>
                          }
                          card={availableCardForCandidacy(cand.id)}
                          links={availableLinksForCandidacy(cand.id)}
                          derivedBlurb={availableDerivedBlurbFor(cand.id)}
                          filedSiteUrl={cand.websiteUrl}
                          nameSlot={
                            <IncumbentName
                              targetKey={cand.id}
                              name={`${cand.givenName} ${surnameDisplayCase(cand.familyName)}`}
                              context={
                                centroid && zip
                                  ? { zip, lat: centroid.lat, lng: centroid.lng }
                                  : null
                              }
                              readerEdge={readerEdge}
                            />
                          }
                          /* ITEM 12: the identical move on the filed-candidate
                             side. The two branches must carry the same
                             sections in the same order — a build where they
                             could diverge would produce a ranking by
                             accident, which is the note the positions call
                             already carried and applies to the whole card. */
                          battlecardSlot={
                            <BallotBattlecard
                              name={`${cand.givenName} ${surnameDisplayCase(cand.familyName)}`}
                              partyLine={readerPartyLabel(cand.partyLabel)}
                              partyLabel={readerPartyLabel(cand.partyLabel)}
                              card={availableCardForCandidacy(cand.id)}
                              links={availableLinksForCandidacy(cand.id)}
                              targetKey={cand.id}
                              contestTitle={contest.title}
                              contestOcdId={contest.ocdId}
                              federal={isFederalContest(contest)}
                              contestId={contest.id}
                              contestVoteFor={contest.voteFor}
                              contestCandidates={candidatesOf(set, contest).map((x) => ({
                                key: x.id,
                                display: `${x.givenName} ${surnameDisplayCase(x.familyName)}`,
                                targetKey: x.id,
                              }))}
                              context={
                                centroid && zip
                                  ? { zip, lat: centroid.lat, lng: centroid.lng }
                                  : null
                              }
                              authorityAvailability={authorityAvailability}
                              readerEdge={readerEdge}
                            />
                          }
                        />
                        {/* 3d: reader expression, never a recommendation.
                            Stays inline — see the note on the lineup branch. */}
                        <ReactionControl
                          targetType="CANDIDATE"
                          targetId={cand.id}
                          prompt="Would you vote for them?"
                          context={
                            centroid && zip
                              ? { zip, lat: centroid.lat, lng: centroid.lng }
                              : null
                          }
                          // M63: the filing list's own count for this
                          // contest — the same derivation the server makes
                          // from the same committed file.
                          singleCandidateContest={
                            candidatesOf(set, contest).length === 1
                          }
                        />
                      </li>
                    ))}
                  </ul>
                  <IncumbencyFootnote />
                  {!isFederalContest(contest) && (
                    <StateFundingNote note={STATE_FUNDING_NOTE} />
                  )}
                  {/* 4a: the private pick — distinct from reactions. */}
                  <PickControl
                    contestId={contest.id}
                    contestTitle={contest.title}
                    voteFor={contest.voteFor ?? 0}
                    /* M134: same, keyed the way this branch keys reactions. */
                    options={pickOptionsFor(set, contest)}
                  />
                </>
              )}
            </section>
          );
        })}
      </div>
      )}

      {/* Item 5: the collapsed source lines, cited once. Each marker above
          lands here; provenance stays one glance away. */}
      {sharedSources.length > 0 && (
        <section className="mt-5 border-t border-[var(--panel-border)] pt-3 lg:max-w-2xl">
          {sharedSources.map((s, i) => (
            <p
              key={s.key}
              id={`source-note-${i}`}
              className="mt-1 text-[0.6875rem] leading-relaxed text-muted first:mt-0"
            >
              <span className="font-mono">{s.marker}</span>{" "}
              {s.cite.kind === "canvass" ? (
                <>
                  Nominees per the{" "}
                  <a
                    href={s.cite.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-link"
                  >
                    certified primary canvass
                  </a>{" "}
                  ({s.cite.issuedBy}) · read {formatDateMDY(s.cite.readAt)}
                </>
              ) : (
                <>
                  <a
                    href={s.cite.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-link"
                  >
                    {s.cite.org} filing
                  </a>{" "}
                  · read {formatDateMDY(s.cite.collectedAt)}
                </>
              )}
            </p>
          ))}
        </section>
      )}

      {/* The canvass caveat, once, under the AZ contests it governs. */}
      {set &&
        matched &&
        candidacyContests.some((c) => lineupForContest(c.id)) && (
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted lg:max-w-2xl">
            {getGeneralLineup()?.note}
          </p>
        )}

      {/* Measures (2b): the official short title, the official question and
          statement VERBATIM where the authority published them, the plain-
          language summary labeled as such, and the Legislative Council's
          analysis VERBATIM — the official explainer, rendered rather than
          merely linked. Data in hand is never displayed as missing.

          BAL-30 (2026-08-28): TWO HEADINGS, because one of them was a false
          claim. See `isStatewideDivision` above — a school-district override
          filed under "Statewide measures" tells a reader the whole state
          votes on it. The groups render in this order and an empty group
          renders no heading at all. */}
      {(
        [
          { scope: "STATEWIDE", heading: "Statewide measures", list: statewideMeasures, tier: "state" },
          { scope: "LOCAL", heading: "Local measures", list: localMeasures, tier: "local" },
        ] as const
      )
        .filter((group) => group.list.length > 0)
        .map((group) => (
        <section className="mt-7" key={group.scope} data-measure-scope={group.scope}>
          {/* BAL-41 (2026-09-02): the section header wears the tier's own
              colour — the owner asked "Statewide measures" to read in the State
              accent and "Local measures" in the Local one, matching the words
              on the Who Governs Here card. Same structure eyebrow, only the ink
              changes; the tier is the group's own scope, not a title match. */}
          <h2
            className="t-structure level-heading"
            data-level-heading={group.tier}
            style={{ "--level-heading-color": `var(--accent-${group.tier})` } as React.CSSProperties}
          >
            {group.heading}
          </h2>
          <div className="ballot-card-grid">
          {group.list.map((contest) => {
            const analysis = analysisForContest(contest.id);
            const summary = summaryForContest(contest.id, measureRecords);
            /*
             * BAL-30: the official words this repository already holds for
             * this contest. Null for the eleven statewide propositions, whose
             * official words arrive as the Legislative Council analysis
             * further down — a null renders NOTHING here rather than a gap
             * sentence about a document that was never the source.
             */
            const measure = measureFor(contest.id);
            return (
              <div
                key={contest.id}
                data-contest-id={contest.id}
                className="mt-3.5 rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-5 shadow-[var(--shadow-panel)]"
              >
                <h3 className="text-[0.9375rem] font-semibold tracking-tight">
                  {contest.title}
                  {/* BAL-41 (2026-09-02): the level tag on every proposition
                      title too — a statewide measure reads State, a county or
                      district one reads Local, from the measure's OCD identity. */}
                  <LevelTag tier={tierForOcdId(contest.ocdId)} />
                </h3>

                {/*
                  **THE QUESTION, VERBATIM, FIRST** (BAL-30, 2026-08-28).

                  It is the thing the reader will actually see on the paper,
                  in the authority's own words, and it was in the repository
                  unrendered. It sits above the plain-language summary on
                  purpose: the summary's own label says "read the official
                  text below", and until now the only official text below was
                  the Legislative Council analysis, which the four local
                  measures do not have and never will — their authority is a
                  county board and three school boards.
                */}
                {/*
                  **BAL-46 (2026-09-02): the plain-language summary leads, for a
                  LOCAL measure as well as a statewide one.**

                  The condition was `summary && analysis?.text`, which could
                  never fire for a local measure — a county resolution or a
                  district Notice of Election has no Legislative Council analysis
                  — so Prop 425 rendered its verbatim ballot text and its fiscal
                  statement with no basic explainer at all, the exact gap the
                  owner reported. It now fires on the summary alone. The "official
                  text below" it points to is the statewide analysis for a state
                  measure and the collapsed ballot-text disclosure (below) for a
                  local one; both exist on the card. Sans, in the app's own
                  voice, matching the state cards — the BAL-45 font parity.
                */}
                {summary ? (
                  <div
                    className="mt-2.5 rounded-md bg-[var(--surface,rgba(255,255,255,0.04))] p-3"
                    data-measure-summary="PRESENT"
                  >
                    <p className="t-eyebrow text-muted">
                      Plain-language summary — read the official text below
                    </p>
                    {/* 3b: the product's voice renders BOLD. */}
                    <p className="mt-1.5 text-[0.8125rem] font-semibold leading-relaxed">
                      {summary.summary}
                    </p>
                    {summary.yesMeans && <p className="mt-2 text-[0.8125rem] leading-relaxed" data-measure-yes><strong>YES:</strong> {summary.yesMeans}</p>}
                    {summary.noMeans && <p className="mt-2 text-[0.8125rem] leading-relaxed" data-measure-no><strong>NO:</strong> {summary.noMeans}</p>}
                  </div>
                ) : (
                  measure && (
                    /* The honest gap: a local measure whose plain-language layer
                       has not been written yet says so, in our register, above
                       the verbatim official text below — never a guessed
                       summary. */
                    <p
                      className="mt-2.5 text-[0.75rem] leading-relaxed text-muted"
                      data-measure-summary="GAP_OURS"
                    >
                      We haven&apos;t written a plain-language summary for this
                      measure yet — the official ballot text is below, word for
                      word.
                    </p>
                  )
                )}

                {/*
                  P01 (2026-08-18) — the measure, decomposed into the parts a
                  reader can hold separate opinions about.

                  CLAUDE.md: reactions attach to PROVISIONS, never to the
                  measure as a whole — a reader can want Proposition 320's
                  classroom spending floor and not want the penalty that
                  enforces it, and one Yes/No throws that away. This renders
                  the decomposition; P03 attaches the reactions to it, which is
                  why every row already carries its own stable id.

                  Between the plain-language summary and the official text on
                  purpose: summary, then what is actually in it, then the
                  state's own words.

                  **BAL-8 (2026-08-24) — IT IS COLLAPSED NOW, AND THIS
                  DELIBERATELY REVERSES THE PARAGRAPH THAT USED TO SIT HERE.**

                  What that paragraph said: *"It is NOT collapsed — this is the
                  explanation the reader came for, and hiding it behind a click
                  would be the reader friction rule's own defect."* The
                  reasoning was sound and the author has ruled the other way,
                  with a better reason: **collapsing is what gets it read.**

                  A reader scrolling a ballot page meets three provisions, each
                  with a reaction control under it, before reaching the next
                  contest — so the fully-expanded form is a wall that gets
                  scrolled PAST, and content nobody reaches is not less hidden
                  for being technically on screen. The content itself is
                  untouched and verbatim; he called it excellent. What changed
                  is that a reader chooses to open it.

                  The friction rule is not weakened by this. Its defect is a
                  click that buys the reader nothing — a duplicate control, a
                  needless confirmation, an entry point nobody can find. This
                  one buys a page a reader can navigate, and the control names
                  exactly what is behind it.
                */}
                {provisionsForContest(contest.id, measureRecords).length > 0 && (
                  <details className="mt-3.5" data-provisions>
                    {/* Styled as the voting pills are — the author named them
                        as the pattern: light-purple, bolded, a right-pointing
                        arrow that turns down when open. */}
                    <summary className="provisions-summary">
                      <span aria-hidden="true" className="provisions-caret">
                        ›
                      </span>
                      What&apos;s in it, part by part
                    </summary>
                    <ul className="mt-2.5 space-y-2.5">
                      {provisionsForContest(contest.id, measureRecords).map((provision) => (
                        <li
                          key={provision.id}
                          data-provision-id={provision.id}
                          className="border-l-2 border-[var(--panel-border)] pl-3"
                        >
                          <p className="text-[0.8125rem] font-semibold leading-snug">
                            {provision.label}
                          </p>
                          {/* The kind names itself in the reader's words. The
                              enum never renders — a label map or no row. */}
                          <p className="t-eyebrow mt-0.5 text-muted">
                            {PROVISION_KIND_LABEL[provision.kind]}
                          </p>
                          <p className="mt-1 text-[0.75rem] leading-relaxed text-paper-dim">
                            {provision.what}
                          </p>
                          {/*
                            P03 (2026-08-18): the reaction attaches HERE —
                            to the contested provision, never to the measure
                            as a whole, which is what CLAUDE.md's reaction
                            section asks for and what the provision id was
                            shaped for.

                            AFTER the explanation, always: the label, the
                            kind and what it would do are all above this, so
                            the reader is answering about something they have
                            just read rather than being asked cold.

                            `compact` because a measure carries several of
                            these and a column of full-size frames turns an
                            explanation into a questionnaire — the same
                            reason the vote rows inside a battlecard use it.
                          */}
                          <div className="mt-1.5">
                            <ReactionControl
                              targetType="MEASURE_PROVISION"
                              targetId={provision.id}
                              prompt={questionForTargetType("MEASURE_PROVISION")}
                              context={null}
                              frame="compact"
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[0.6875rem] text-muted">
                      Each part is written from the official analysis below, and
                      says what it would do — never whether it is a good idea.
                    </p>
                  </details>
                )}

                {/*
                  **THE OFFICIAL STATEMENT, AND THE CONTROL THAT PROVES THIS
                  IS NOT ONE SENTENCE FOR TWO DIFFERENT FACTS** (BAL-30).

                  Propositions 423 and 425 carry an official interpretive
                  statement — the district's Notice of Election and the
                  county's ballot-language document — and they render it
                  verbatim. Propositions 428 and 429 are the same class of
                  question from the same publisher and their statement is
                  null, because the Pima County School Superintendent's list
                  is the only document read for them and it titles the
                  question without stating the fiscal terms.

                  Those two states may never render as the same sentence, and
                  the null one has to say WHOSE gap it is. It is ours: the
                  district publishes a Notice of Election and we have not read
                  it. The scope note directly below names the document, so
                  this points at it rather than repeating it — and only where
                  there is a note to point at.
                */}
                {/*
                  **BAL-45 / BAL-47 (2026-09-02): the verbatim ballot text moves
                  into a collapsed disclosure, where the statewide measures keep
                  their Legislative Council analysis.**

                  The owner struck the fiscal statement open on the card face
                  (BAL-47) and the serif question text that made the local card
                  read unlike the state ones (BAL-45). Both are quoted public
                  record, so both belong one level down, behind a control that
                  names them — exactly the treatment the state analysis gets. The
                  plain-language summary above now speaks on the face; serif
                  (`t-record`) is correct INSIDE the disclosure, the same
                  register the state analysis wears there. The question and the
                  statement stay addressable by a walk (`data-measure-question`,
                  `data-measure-statement`) even collapsed — `<details>` keeps
                  its children in the DOM. */}
                {measure && (
                  <details className="mt-2.5" data-measure-official-text>
                    <summary className="t-eyebrow cursor-pointer text-muted hover:text-link">
                      The official ballot text
                    </summary>
                    <div className="mt-2 rounded-md border border-[var(--panel-border)] p-3">
                      <p className="t-eyebrow text-muted">
                        The question on the ballot, word for word
                      </p>
                      <p
                        className="t-record mt-1.5 whitespace-pre-line text-[0.8125rem] leading-relaxed text-paper-dim"
                        data-measure-question={measure.id}
                      >
                        {measure.questionText}
                      </p>
                      {measure.officialStatement ? (
                        <div className="mt-3" data-measure-statement="PRESENT">
                          <p className="t-eyebrow text-muted">
                            What the authority published with it
                          </p>
                          <p className="t-record mt-1.5 whitespace-pre-line text-[0.8125rem] leading-relaxed text-paper-dim">
                            {measure.officialStatement}
                          </p>
                        </div>
                      ) : (
                        <p
                          className="mt-3 text-[0.75rem] leading-relaxed text-muted"
                          data-measure-statement="GAP_OURS"
                        >
                          We have not recorded an official statement for this
                          question.
                        </p>
                      )}
                    </div>
                  </details>
                )}

                {/*
                  The measure text's OWN citation, and only when the card's
                  foot does not already carry it. Every current row cites the
                  same document the contest does, so nothing renders here
                  today; a future row whose question came from a different
                  document gets its own line rather than borrowing the foot's.
                */}
                {measure &&
                  measure.provenance.sourceUrl !==
                    (analysis?.analysisUrl ?? contest.provenance.sourceUrl) && (
                    <p className="mt-2 text-[0.6875rem]">
                      <a
                        href={measure.provenance.sourceUrl ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted"
                      >
                        {measure.provenance.sourceOrg}
                      </a>{" "}
                      <span className="text-muted">
                        · read {formatDateMDY(measure.provenance.collectedAt)}
                      </span>
                    </p>
                  )}

                {analysis?.text ? (
                  // 3f (2026-08-19): the official analysis collapses by
                  // default — the control names it and its source, expands
                  // downward on click. The plain-language summary stays open
                  // above. Verbatim and whole once open — never excerpted.
                  <details className="mt-2.5">
                    <summary className="t-eyebrow cursor-pointer text-muted hover:text-link">
                      Official analysis — {analysis.sourceOrg}
                    </summary>
                    <p className="t-record mt-1.5 max-h-72 overflow-y-auto whitespace-pre-line rounded-md border border-[var(--panel-border)] p-3 text-[0.75rem] leading-relaxed text-paper-dim">
                      {analysis.text}
                    </p>
                  </details>
                ) : (
                  analysis?.extractionNote && (
                    // Extraction failed: say so honestly and keep the link.
                    <p className="mt-2 text-[0.75rem] leading-relaxed text-muted">
                      We retrieved this measure&apos;s official analysis but
                      couldn&apos;t extract its text — read it at the link
                      below.
                    </p>
                  )
                )}

                {/* F01 11.1: identical current reader qualifications share one
                    page note. The reader-scope selector distinguishes our held
                    wording gap from the earlier source's publication claim. */}
                {readerScopeNotes.get(contest.id) &&
                  (scopeNotes.isShared(contest.id) ? (
                    <p className="mt-2 font-mono text-[0.6875rem] text-muted">
                      <a
                        href="#scope-notes"
                        className="underline decoration-dotted underline-offset-2 hover:text-link"
                      >
                        {scopeNotes.markerFor(contest.id)} see note
                      </a>
                    </p>
                  ) : (
                    <p className="mt-2 text-[0.75rem] leading-relaxed text-muted">
                      {readerScopeNotes.get(contest.id)}
                    </p>
                  ))}

                {/* 4a: the private pick on measures — Yes/No, this device
                    only, stated in the control. 6a: prominent here — the
                    ask whispered on the cards where it matters most. */}
                <PickControl
                  contestId={contest.id}
                  contestTitle={contest.title}
                  voteFor={1}
                  prominent
                  options={pickOptionsFor(set, contest)}
                />

                <p className="mt-2 text-[0.6875rem]">
                  <a
                    href={analysis?.analysisUrl ?? contest.provenance.sourceUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted"
                  >
                    {analysis?.sourceOrg ?? contest.provenance.sourceOrg}
                  </a>{" "}
                  <span className="text-muted">
                    · read{" "}
                    {analysis
                      ? formatDateMDY(analysis.retrievedAt.slice(0, 10))
                      : formatDateMDY(contest.provenance.collectedAt)}
                  </span>
                </p>
              </div>
            );
          })}
          </div>
        </section>
      ))}

      {/*
        RULING 59 (2026-08-21) — THE HEADING WAS "NOT HERE YET", AND IT WAS THE
        BANNED FORM WITH A SECTION AROUND IT.

        This block was introduced as "our gaps, stated as ours, never smoothed
        into implied completeness". Under RULING 59 the page says ONE thing
        about completeness — Sean's line — and nothing else, so a heading that
        announces a list of what is missing cannot stay, whatever is under it.

        It survived the first sweep of this session because the sweep was a
        source-text scan and this heading is three ordinary words in a JSX
        element, while the sentence that made it a coverage claim lived in
        `data/states/az/ballot/az-pima-2026.json` and never appeared in `app/` at all.
        **It was caught by reading a production screenshot as an image** —
        exactly as NH Hunt 4's stale note was, and for the same reason: the DOM
        assertion was happy, and the reader's view was not.

        One note went with it: "Pima County offices, City of Tucson offices,
        and school-district (TUSD, Vail Unified) contests are not curated yet."
        That is an aggregate enumeration of what has not been worked out, in
        hunt-queue vocabulary RULING 28 already keeps off reader surfaces, and
        it goes false the day any one of them is curated.

        WHAT REMAINS IS NOT A COVERAGE LIST. Every surviving note is a sourced
        fact about an AUTHORITY's own publishing state — the Secretary of State
        has not published the seat count, nomination papers are not certified
        until September 2, no CACR reached the ballot — and each explains why a
        contest a reader might expect to see is not there. Those are the
        authorities' absences, not ours, and the render-default rule requires
        them to stay distinguishable from ours rather than deleted. The heading
        now names what the block is instead of what the product lacks.
      */}
      {matched && !matched.contests.some((c) => tierForOcdId(c.ocdId) === "local") && (
        <section
          className="mt-6 rounded-[10px] border border-dashed border-[var(--panel-border)] p-4 lg:max-w-2xl"
          data-ballot-no-local-races
        >
          <h2 className="t-structure text-paper-dim">County, city and school-board races</h2>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-voice">
            We&apos;re working on getting this info. The state and federal races above are read from the official filings; the county, city, town and school-district contests that share this ballot appear here once their election office publishes them and we have read them. Your county election office has the complete ballot for your address.
          </p>
        </section>
      )}

      {matched && coverageNotes.length > 0 && (
        <section className="mt-6 rounded-[10px] border border-dashed border-[var(--panel-border)] p-4 lg:max-w-2xl">
          <h2 className="t-structure text-paper-dim">Notes on this ballot</h2>
          {coverageNotes.map((note) => (
            <p
              key={note}
              className="mt-2 text-[0.75rem] leading-relaxed text-voice"
            >
              {note}
            </p>
          ))}
        </section>
      )}

      {matched && matched.contests.length > 0 && (
        <>
          {/*
            **BAL-24 (2026-08-25) — WHY THIS IS GROUPED AND NOT DEDUPED.**

            Sean drew an arrow between two blocks on `17-46-00` that both open
            "NO LOCAL ELECTION — the Morris County Clerk's 2026 general-election
            candidate list carries this entry for …". Read as an image they
            differ by two words: one is DENVILLE TOWNSHIP and the other is
            ROCKAWAY TOWNSHIP.

            **It is not one record through two paths.** 07866 straddles both
            municipalities, so a reader there is owed both facts, and filtering
            the output would have deleted a true sourced statement about a real
            government. `groupAbsences` merges only where the sentence, the
            source, the URL and the read date all agree, and it NAMES every
            jurisdiction in the merged sentence — nothing is lost, and the
            reader stops being shown the same sentence twice.
          */}
          {groupAbsences(matched.absences).map((absence) => (
            <section
              key={absence.key}
              className="mt-5 rounded-[10px] border border-[var(--panel-border)] p-4 lg:max-w-2xl"
              data-absence-count={absence.members.length}
              data-absence-ocd-ids={absence.members.map((record) => record.ocdId).join(" ")}
            >
              <p className="text-[0.8125rem] leading-relaxed text-paper-dim">
                {absence.statement}
              </p>
              <p className="mt-2 text-[0.6875rem] text-muted">
                <a
                  href={absence.provenance.sourceUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-link"
                >
                  {absence.provenance.sourceOrg}
                </a>{" "}
                · read {formatDateMDY(absence.provenance.collectedAt)}
              </p>
            </section>
          ))}

          {/* F01 11.1: every scope note that repeats, once, at the foot —
              verbatim, with the count so a reader can see it is shared. */}
          {scopeNotes.notes.length > 0 && (
            <div
              id="scope-notes"
              className="mt-6 border-t border-[var(--panel-border)] pt-4 lg:max-w-2xl"
            >
              {scopeNotes.notes.map((note) => (
                <p
                  key={note.marker}
                  className="mt-1.5 text-[0.75rem] leading-relaxed text-muted first:mt-0"
                >
                  <span aria-hidden="true" className="mr-1 font-mono text-paper-dim">
                    {note.marker}
                  </span>
                  {note.text}{" "}
                  <span className="text-paper-dim">
                    (applies to {note.count} contests on this page)
                  </span>
                </p>
              ))}
            </div>
          )}

          <p className="mt-6 text-[0.75rem] leading-relaxed text-voice lg:max-w-2xl">
            {NEUTRAL_NOTE}
          </p>

          {/* RULING 42: the page-level disclosure, once, at the bottom. It
              renders inside this block because this block is what renders
              when contests render — a note about the cards on a page with no
              cards would be a claim about nothing. */}
          <p
            data-collection-note
            className="mt-3 text-[0.75rem] leading-relaxed text-voice lg:max-w-2xl"
          >
            {COLLECTION_NOTE}
          </p>
        </>
      )}

      {/* 3e (2026-08-19) put the picks disclosure here, stated ONCE, after it
          had repeated under every contest. F01 11.2 removes it entirely — the
          note below is the whole account, and the 3e paragraph is not a thing
          to restore.

          F01 11.2 (2026-08-19, the author): *"'Your pick boxes are saved to
          this device only. We never see them. The yes/no reaction buttons are
          different, those answers join anonymous local totals.' That is
          completely counterintuitive to its own statement. It's saying we
          don't know who you picked — however if you pick yes or no, we totally
          know. That needs to change. I would remove that statement entirely.
          You can just put 'How we handle data' at the bottom."*

          Both underlying facts are still true and neither has changed: picks
          are device-local, and reactions are write-only and never rendered
          back to any reader, in aggregate or otherwise. What was wrong was
          asking one small paragraph to hold both at once — read quickly it
          says "we can't see your choices" and then "we can see your choices",
          and a reader who catches that stops believing either half.

          So the paragraph is GONE and the link carries the explanation. The
          link is not new and it is not hidden: it already sat in the footer
          below, which is where the author asked for it, and the reaction
          buttons keep their own disclosure at the point of capture — the
          one-time acknowledged notice `CLAUDE.md` requires, which is the
          load-bearing consent surface and is untouched by this. */}

      {/*
        ASK04 (2026-08-27): Ask reaches the ballot.

        The SAME engine the map's panel uses — `/api/ask/grounded`, which holds
        interpretation, canonical resolution, retrieval, synthesis and
        validation. Only the surface differs, and the ballot's context is
        genuinely its own: the contests and candidates actually on this page are
        what let the pipeline resolve a referent, and refuse one where more than
        one person is on screen.

        **BAL-26 (2026-08-28) — IT NO LONGER SITS HERE, AND THE PARAGRAPH THAT
        PUT IT HERE IS WORTH KEEPING RATHER THAN DELETING.**

        What it said: *"It sits below the contests because it is a follow-up to
        what the reader has just read, not a substitute for it."* The reasoning
        is right and the placement it produced was not, because it assumed a
        reader who reaches the bottom. This page is ~20,000px at 1280 and
        ~25,000px at 390: below the contests and below the absence blocks are
        the same place, and that place is off the end of the reading.

        A COLLAPSED pill under the heading keeps the whole of that reasoning —
        it is closed, so it substitutes for nothing, and a reader has to have
        decided to ask before anything happens — and drops only the assumption
        that turned it into a feature nobody found. There is no mount here now;
        `BallotAskPill` in the pill row above owns it, and it is still exactly
        one `<BallotAsk>` on the page.
      */}

      <p className="mt-8 border-t border-[var(--panel-border)] pt-4 text-[0.75rem] lg:max-w-2xl">
        <Link
          href="/"
          className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          Back to the map
        </Link>{" "}
        <span className="text-muted">·</span>{" "}
        <Link
          href="/transparency"
          className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          How we handle data
        </Link>
      </p>
    </main>
  );
}
