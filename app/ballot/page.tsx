import { Card } from "@/components/ui/card";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { ContactPills } from "@/components/officials/contact-pills";
import { CardGapContribution } from "@/components/ui/card-gap-context";
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
import { divisionIdsForZipArea, POINT_GEOMETRY_PLANS, unestablishedDistrictOffices } from "@/lib/ballot/zip-divisions";
import { phoenixToday } from "@/lib/ballot/dated-events";
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
import type { OfficeBlurb } from "@/lib/officials/office-blurbs";
import { readCuratedContestOfficeBlurbs } from "@/lib/officials/curated-definition-reader";
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
import { FilingNote } from "@/components/ballot/filing-note";
import { CandidateBattlecard } from "@/components/ballot/candidate-battlecard";
import { StateMoneySection } from "@/components/funding/state-money-section";
import { stateMoneyForCard } from "@/lib/funding/nominee-money";
import {
  MemberCommitteesContent,
  MemberOfficesContent,
} from "@/components/officials/member-directory";
import { RecentVotes } from "@/components/map/popup/official-popup";
import { personCardSources } from "@/lib/officials/card-sources";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";
import { currentMemberOffices } from "@/lib/officials/member-offices-read";
import type { SeatHolder } from "@/lib/officials/lookup";
import { CandidateCard } from "@/components/ballot/candidate-card";
import {
  CandidatePositions,
} from "@/components/ballot/candidate-positions";
import { readStanceTopics } from "@/lib/stances/read";
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
import { settleStateMoneyRead } from "@/lib/funding/state-snapshot";
import type { StateCampaignFinanceJurisdiction } from "@/lib/funding/data-plane";
import { settleFundingHoldingAnswer } from "@/app/api/funding/[target]/route";
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
import { CandidateContact, CandidateContactSources } from "@/components/ballot/candidate-contact";
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
import { tierForOcdId, tierForOffice } from "@/lib/ocd/tiers";
import { Logo } from "@/components/brand/logo";
import { PRODUCT_NAME, titleFor } from "@/lib/brand";
import { readerPartyLabel } from "@/lib/text/reader-names";
import {
  IncumbencyFootnote,
  IncumbencyMarker,
} from "@/components/ballot/incumbency-note";

/**
 * Renders exactly what the election authorities filed. It never suggests how to vote: no contest or
 * candidate is scored, ranked, matched or recommended.
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

/** Above this many characters a contest's scope note collapses behind "More info"; roughly two lines on a phone. */
const EXTENDED_MECHANICS_CHARS = 180;

function candidatesOf(set: BallotSet, contest: Contest): Candidacy[] {
  return set.candidacies
    .filter((c) => c.contestId === contest.id)
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
}

/** Built once: both `PickControl` and the `MyPicks` manifest call this, so the tally's denominator is the rendered row count. A measure has no `reactionTargetId`: its reactions attach to provisions. */
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

/** The candidate's name as filed, as the door to their battlecard; plain text where the exact-key join finds no record. */
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

/** The funding answer under one candidate: totals with the reaction control, an earned absence, or nothing. */
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
  let partial = false;
  try {
    const settled = await withReaderAuthorityEdge(readerEdge, () => settleFundingHoldingAnswer(targetKey));
    partial = settled.kind === "ANSWER" && settled.holdingStatus === "PARTIAL";
  } catch {
    partial = true;
  }
  if (answer.kind === "none") return partial
    ? <CardGapContribution id={`funding-holdings:${targetKey}`} label="campaign money records" />
    : null;
  // The wrapper carries the marker `pnpm measure:ballot` counts.
  return (
    <div data-candidate-funding>
      {partial && <CardGapContribution id={`funding-holdings:${targetKey}`} label="campaign money records" />}
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
  records: ReturnType<typeof stateMoneyForCard>["records"],
  context: ReactionViewContext | null,
) {
  if (records.length === 0) return null;
  return <StateMoneySection records={records} bare context={context} />;
}

/** One battlecard builder for every person on the ballot: both contest branches call it, and every person gets the same sections (`lib/ballot/battlecard-sections.ts`) whatever we hold. */
async function BallotBattlecard({
  name,
  partyLine,
  partyLabel = null,
  card,
  links = null,
  targetKey,
  contestTitle,
  contestOcdId,
  officeBlurb,
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
  /** The raw party label, so the card can render the coloured pill; `partyLine` stays as the fallback. */
  partyLabel?: string | null;
  /** The candidate's own card row; a photo that failed review is already `null` here. */
  card?: CandidateCardData | null;
  /** The campaign site, so the battlecard can hold what the row let go. */
  links?: CandidateLinks | null;
  /** The candidate key — `${contest.id}|${nominee.name}` or a candidacy id. */
  targetKey: string;
  contestTitle: string;
  /** The contest's division, so a state-scoped office explainer can resolve. */
  contestOcdId: string;
  officeBlurb: OfficeBlurb | null;
  /** Whether the contest is federal, which decides whether FEC money applies. */
  federal: boolean;
  /** Every name in this contest: incumbency is resolved per contest, so either the holder is known or every candidate reads the same not-yet-sourced line. */
  contestCandidates: readonly { key: string; display: string; targetKey: string }[];
  contestId: string;
  /* How many seats this contest fills; the contest-level eligibility gate reconciles holders against it. */
  contestVoteFor: number | null;
  context: { zip: string; lat: number; lng: number } | null;
  authorityAvailability: BallotAuthorityAvailability;
  /** React renders this card outside the page function that entered the edge, so every read below runs inside it explicitly. */
  readerEdge: ReaderAuthorityEdgeBundle | null;
}) {
  /* One lookup for the record section, its empty state, and the committee and office sections, so they cannot disagree. */
  let holder: SeatHolder | null = null;
  let officeholdersAvailable = federal ? authorityAvailability.federalOfficeholders : authorityAvailability.officeholders;
  try {
    holder = await withReaderAuthorityEdge(readerEdge, () => incumbentHolderFor(targetKey));
    if (holder) officeholdersAvailable = true;
  } catch {
    holder = null;
  }

  /* Incumbency comes from the officeholder side, per contest, in three states. A miss is UNKNOWN, never `Challenger`. */
  let resolvedStanding: Awaited<ReturnType<typeof contestIncumbency>> | null = null;
  if (contestVoteFor !== null) {
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
        incumbentHolderFor,
      ));
      officeholdersAvailable = true;
    } catch {
      resolvedStanding = null;
    }
  }
  const standing = resolvedStanding?.decisions.get(targetKey) ?? {
    standing: "UNKNOWN" as const,
    basis: officeholdersAvailable
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

  let positions: ReturnType<typeof positionsFor> = [];
  let positionsUnavailable = !authorityAvailability.candidatePublications;
  if (!positionsUnavailable) {
    try {
      positions = positionsFor(targetKey, null, await readStanceTopics());
    } catch {
      positionsUnavailable = true;
    }
  }
  /* State and local money. LEADs are filtered out inside `stateMoneyForTarget`. */
  /* Keyed by the reconciled candidacy id through the precomputed identity bridge, never by name: a nominee card's key is `${contest.id}|${nominee.name}`. */
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
      tier={tierForOffice(contestTitle, contestOcdId)}
      partyLine={partyLine}
      partyLabel={partyLabel}
      photoUrl={card?.photoUrl ?? null}
      incumbency={standing.standing}
      /* Which gap the third state is: the eligibility gate can refuse a contest whose sitting member we hold. */
      incumbencyGap={standing.gap ?? null}
      speakContext={context ? { lat: context.lat, lng: context.lng } : null}
      subjectId={targetKey}
      /* A fact about the person (do they hold or have they held this office), never about how much we hold on them. */
      holdsOrHeldTheOffice={recordHolder !== null}
      /* The same record the map battlecard renders contact routes from. */
      contactHolder={recordHolder}
      contact={<><CandidateContact card={card ?? null} links={links} filing={filingContact} />{recordHolder && <ContactPills holder={recordHolder} scope="primary" />}{!card?.email && !links?.campaign && !filingContact?.email && !recordHolder && <CardGapContribution id={`candidate-contact:${targetKey}`} label="contact details" subject={{ type: "CANDIDATE", id: targetKey }} />}</>}
      sections={{
        /* Mandatory for every candidate and every elected official. */
        office: officeBlurb ? (
          <>
            <p className="t-body leading-relaxed text-voice">{officeBlurb.text}</p>
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
        /* `recordHolder` is the federal join or the officeholder the contest resolution matched by seat, the same record the map battlecard renders from. */
        /* Null where the member directory does not cover them, so the named gap renders instead of an empty box. */
        committees:
          !officeholdersAvailable ? (
            unavailableHolding("officeholder-directory")
          ) : recordHolder && memberDirectoryReaches(recordHolder.id) ? (
            <MemberCommitteesContent holder={recordHolder} />
          ) : null,
        offices:
          !officeholdersAvailable ? (
            unavailableHolding("officeholder-directory")
          ) : recordHolder && memberDirectoryReaches(recordHolder.id, "offices", recordHolder.state) ? (
            <MemberOfficesContent holder={recordHolder} />
          ) : null,
        money: federal ? (
          <CandidateFunding targetKey={targetKey} context={context} available={authorityAvailability.funding} readerEdge={readerEdge} />
        ) : stateMoneyUnavailable ? (
          unavailableHolding("state campaign-finance")
        ) : stateCandidateFunding(stateMoney, context),
        /* The record, in the card. Not `columns`: the two-column form builds its own top-level sections. */
        /* Gated on whether records exist (`recordHolder`), not on the federal join. */
        record: !officeholdersAvailable ? (
          unavailableHolding("officeholder-directory")
        ) : recordHolder ? (
          <RecentVotes holder={recordHolder} reactionContext={context} contentOnly />
        ) : null,
        /* Renders even with no officeholder record, so a challenger's contacts reach the same Sources section. */
        sources: (
          <>
            {!authorityAvailability.candidateProfiles && unavailableHolding("candidate-profile")}
            {holder && <CandidateSources holder={holder} />}
            <CandidateContactSources links={links} filing={filingContact} />
            
          </>
        ),
      }}
    />
  );
}

/** The card's sources for a person we hold an officeholder record for: the held roster and office records. */
function CandidateSources({ holder }: { holder: SeatHolder }) {
  // Read only as the reader edge primed it: this card never adds a database read to a cold ballot.
  const [office] = currentMemberOffices(holder.id);
  const sources = personCardSources(holder, office
    ? [{ what: "Their capitol and district offices", provenance: { sourceUrl: office.sourceUrl, sourceOrg: office.sourceOrg, collectedAt: office.collectedAt, verifiedAt: null } }]
    : []);
  if (sources.length === 0) return null;
  return <CardSourcesContribution id={`candidate:${holder.id}`} sources={sources} />;
}

interface BallotAuthorityAvailability {
  readonly candidateProfiles: boolean;
  readonly candidatePublications: boolean;
  readonly funding: boolean;
  readonly stateMoney: boolean;
  readonly officeholders: boolean;
  readonly federalOfficeholders: boolean;
}

const HOLDING_LABEL: Record<string, string> = {
  "candidate-publication": "public positions",
  "officeholder-directory": "officeholder information",
  "candidate-profile": "candidate background",
  "federal campaign-finance": "campaign money",
  "state campaign-finance": "campaign money",
};

function unavailableHolding(family: string) {
  return <CardGapContribution id={`ballot-holding:${family}`} label={HOLDING_LABEL[family]} />;
}


/** The tab names the page: this one inherited the map's "Public meetings near you". */
export const metadata: Metadata = {
  title: titleFor("Your ballot"),
  description: "The contests on your ballot, the candidates in them, and where to vote.",
};

/**
 * The reader authority edge for this render, fetched and not entered: an entry made inside a helper never
 * reaches its caller's later reads, so the page enters what this returns. Null when nothing is published or
 * the fetch failed; never reads the database.
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
  /* The reader's resolved divisions, hoisted so the Ask surface receives the same list the contests were matched against. */
  let askOcdIds: string[] = [];
  /* Which divisions cover the whole zip and which only part; the partial ones carry the pill. Null outside the committed geometry. */
  // The reader edge and the committed geometry start before anything waits.
  const readerEdgeRead = centroid ? readBallotReaderEdge() : Promise.resolve(null);
  if (centroid) prefetchReaderGeography();
  // Certainty now includes the publisher's Census serving copy. Read it in
  // the same request bundle as the ballot, never ahead of the edge boundary.
  let certainty = await readerEdgeRead.then(edge => withReaderAuthorityEdge(edge, () => zipCertainty(zip)));

  /*
   * The reader edge is entered here, in the page's own function. Async components React renders later run
   * outside this context, so each is handed `readerEdge`. A supporting family opens only for the ballot that
   * answered.
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
    /* A zip is an area: the centroid answer is widened to every division whose territory reaches inside it (`lib/ballot/zip-divisions.ts`). */
    const ocdIds = await divisionIdsForZipArea(zip, pointDivisionIds, undefined, POINT_GEOMETRY_PLANS);
    askOcdIds = ocdIds;
    for (const { state, source } of await readerBallotSourcesForDivisions(ocdIds)) {
      try {
        const candidate = source.normalize(await source.fetch());
        const selection = { purpose: "election" as const, asOf: phoenixToday(), electionDate: candidate.election.date };
        const electionIds = await divisionIdsForZipArea(zip, pointDivisionIds, selection, POINT_GEOMETRY_PLANS);
        const hit = contestsForDivisions(candidate, electionIds);
        if (hit.contests.length > 0 || hit.absences.length > 0) {
          set = candidate;
          matched = hit;
          askOcdIds = electionIds;
          certainty = await zipCertainty(zip, selection);
          coverageNotes = coverageNotesForScope(candidate, zip, electionIds);
          for (const office of unestablishedDistrictOffices(candidate, electionIds)) {
            coverageNotes.push(`We're working on getting the ${office} district for ZIP ${zip}. ${office} contests aren't shown until we have it.`);
          }
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
    // Each edge first: the edge's proven copy through the family's own Reader, else the database.
    auxiliaryPreloads.set("candidate-profiles", settleCandidateProfilesRead);
    auxiliaryPreloads.set("candidate-publications", settleCandidateCorpusRead);
    // Edge first: the same settles `divisionsAt` and the officeholder
    // graph use, so an edge-served version is never read again from the
    // database in the same render.
    auxiliaryPreloads.set("registry-runtime", () => settleRegistryAuthorityReads("REGISTRY"));
    if (matched.contests.some(isFederalContest)) {
      auxiliaryPreloads.set("federal-directory", settleFederalDirectoryRead);
    }
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
      !auxiliaryFailed.has("registry-runtime"),
    federalOfficeholders:
      auxiliaryPreloads.has("federal-directory") && !auxiliaryFailed.has("federal-directory"),
  };

  let registrationLinks: ReturnType<typeof currentRegistrationLinks> = [];
  let electionOffices: ReturnType<typeof currentElectionOffices> = [];
  if (auxiliaryPreloads.has("ballot-navigation") && !auxiliaryFailed.has("ballot-navigation")) {
    try {
      registrationLinks = currentRegistrationLinks();
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
  /* The authority's own ballot order wins where published; otherwise the proposition number, compared as a number (lib/ballot/measure-order.ts). */
  const measureRecords = set ? measureRecordsForBallot(set) : [];
  const measureContests = orderMeasures(
    matched?.contests.filter((c) => c.type === "MEASURE") ?? [],
  );

  /* Looked up by `contestId`; null renders no block. */
  const measureFor = (contestId: string): Measure | null =>
    set?.measures.find((m) => m.contestId === contestId) ?? null;

  /* Statewide versus local is read off the contest's division: a bare `state:xx` is the whole state. */
  const isStatewideDivision = (ocdId: string): boolean =>
    /^ocd-division\/country:us\/state:[a-z]{2}$/.test(ocdId);
  const statewideMeasures = measureContests.filter((c) =>
    isStatewideDivision(c.ocdId),
  );
  const localMeasures = measureContests.filter(
    (c) => !isStatewideDivision(c.ocdId),
  );

  /* Canonical references, not display strings: each carries the id the cards are keyed with, for referent resolution only. */
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

  /* The tally's denominator: every contest that renders a `PickControl` gets an entry, built by the same `pickOptionsFor`. */
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

  /* Which ballot this page is, read off its own contests rather than the zip. */
  const currentJurisdictionKey =
    matched?.contests
      .map((c) => jurisdictionKeyForContestId(c.id))
      .find((key): key is string => key !== null) ?? null;

  /* A source line identical on every contest renders once at the foot, with a marker at each contest. Distinct sources never collapse. */
  const FOOTNOTE_MARKERS = ["*", "†", "‡", "§", "‖", "¶"];
  /* `*` is reserved for the incumbency footnote, unconditionally, so the source sequence starts at `†`. */
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
  /* Repeated scope notes use the same mechanism and continue the same marker sequence. */
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

  const officeBlurbs = await readCuratedContestOfficeBlurbs(matched?.contests ?? []);

  const filingProjection = await filingRead;
  const filingRows = filingProjection?.kind === "PROMOTED"
    ? filingsForDivisions(filingProjection.value.records as unknown as OfficialFiling[], askOcdIds) : [];

  return (
    /* Prose stays capped at `lg:max-w-2xl`; the extra width buys a second column of whole cards, never of label/value rows. */
    <main className="mx-auto max-w-2xl px-4 py-8 text-paper lg:max-w-[68rem] lg:px-8 lg:py-10 xl:max-w-[76rem]">
      <BallotCapture zip={zip} />
      <div className="ballot-page-chrome flex items-center justify-between gap-3">
        <p className="t-body">
          <Link
            href="/"
            className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            ← Back to the map
          </Link>
        </p>
        <ThemeToggle className="shrink-0" />
      </div>
      <div className="ballot-page-chrome mt-4">
        <Logo variant="wordmark" size={30} />
      </div>
      <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
        What&apos;s on the ballot{zip ? ` near ${zip}` : ""}
      </h1>

      <p className="mt-3 t-body leading-relaxed text-voice lg:max-w-2xl">
        A zip code is orientation, not your exact ballot — zip areas cross
        town and district lines. Everything below is presented as filed with
        election authorities, with the filing linked on every item.{" "}
        <span className="font-medium">We never suggest how to vote.</span>
      </p>

      {zip && (
        <div className="ballot-top-pills">
          <BallotNarrowing zip={zip} className="ballot-top-pill" />
          <Link href={`/about-area?zip=${zip}`} className="ballot-top-pill">
            Moving here? Know the basics →
          </Link>
          <BallotAskPill
            zip={zip}
            ocdIds={askOcdIds}
            activeSubjects={askSubjects}
          />
        </div>
      )}

      <div className="my-4"><WhereToVote /></div>
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
          if (!registration) return null;
          return <section key={state} aria-label={`${state} voting information`} className="my-6 space-y-2">
            <h2 className="text-lg font-semibold">{state} voting information</h2>
            {registration && <p><a href={registration.url}>{registration.label}</a></p>}
          </section>;
        })}
      {set && (divisionHoldingUnavailable || auxiliaryFailures.length > 0) && (
        <section
          className="mt-4 rounded-[8px] border border-line bg-panel p-4 t-body leading-relaxed text-voice lg:max-w-3xl"
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

      {dates &&
        set &&
        (() => {
          const reg = registrationLinkFor(set.election.state, registrationLinks);
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
                {regStep && (
                  <li data-dated-event>
                    Register to vote by{" "}
                    <span className="font-mono t-body font-semibold">
                      {formatDateMDY(regStep.date)}
                    </span>
                    {/* A deadline that has already passed gets no calendar control. */}
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
                    <span className="font-mono t-body font-semibold">
                      {formatDateMDY(earlyStep.date)}
                    </span>
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
              </ul>

              {(
                <div className="mt-3 flex flex-col gap-3">
              {/* Registration status is the state's to answer, so this pill leaves the app and says so. */}
                  {reg && (
                    <div>
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
            </section>
          );
        })()}

      {/* The propositions sentence renders only where propositions share the ballot. */}
      {set && matched && (
        <p className="mt-3 t-body leading-relaxed text-voice lg:max-w-2xl">
          The contests below are recorded for areas that may overlap this ZIP. Check your address with your election office for the exact ballot.
          {measureContests.length > 0 &&
            " Propositions are voted on at the same time."}
        </p>
      )}

      {!zip && (
        <p className="mt-6 t-body text-muted lg:max-w-2xl">
          Open this page with a zip, e.g.{" "}
          <Link href="/ballot?zip=07866" className="underline decoration-dotted">
            /ballot?zip=07866
          </Link>
          .
        </p>
      )}

      {zip && !centroid && (
        <p className="mt-6 t-body text-muted lg:max-w-2xl">
          We couldn&apos;t place that zip. Try another, or return to{" "}
          <Link href="/" className="underline decoration-dotted">
            the map
          </Link>
          .
        </p>
      )}

      {attempted && !matched && ballotLoaderFailures.length > 0 && (
        <p className="mt-6 lg:max-w-2xl">We could not load this ballot just now.</p>
      )}

      {attempted && !matched && ballotLoaderFailures.length === 0 && divisionHoldingUnavailable && (
        <p className="mt-6 lg:max-w-2xl">We could not load the districts for this location just now.</p>
      )}

      {attempted && !matched && ballotLoaderFailures.length === 0 && !divisionHoldingUnavailable && (
        <p className="mt-6 lg:max-w-2xl">We do not have a ballot for this location yet.</p>
      )}

      {/* The private election-day list; renders only once something is marked. Device-local. */}
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
              /* `flex-wrap` and a shrinkable value: the value drops to its own line rather than widening the page. */
              <li
                key={step.label}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
              >
                <span className="t-body">{step.label}</span>
                <span className="ml-auto min-w-0 text-right" data-dated-event>
                  <span className="font-mono text-[0.75rem] text-signal">
                    {formatDateMDY(step.date)}
                  </span>
                  {/* Every dated event with a known date gets the control, windows included; `upcoming` uses the Phoenix wall clock (`lib/ballot/dated-events.ts`). A step whose `date` is a phrase gets nothing. */}
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

      {/* The jurisdiction answer once, above the contests, built from the same `needsPill` decision each contest heading uses. */}
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
                /* The body, not the office: naming the jurisdictions is the point of the block. */
                .map((contest) => jurisdictionNameFromOcdId(contest.ocdId))
                .filter((name): name is string => name !== null),
            ),
          ]}
          /* The block ends with the address prompt, scoped to this page's zip. */
          zip={zip ?? ""}
        />
      )}

      {set && matched && (
      <div className="ballot-office-list">
      {candidacyContests.map((contest, contestIndex) => {
          const lineup = lineupForContest(contest.id);
          const canvass = lineup ? getGeneralLineup()?.canvass : null;
          // A source line identical across contests
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
            <Card
              key={contest.id}
              title={contest.title}
              titleVisible={false}
              attrs={{
                "data-contest-id": contest.id,
                "data-ocd-id": contest.ocdId,
                ...(contestIndex > 0 && tierForOffice(contest.title, contest.ocdId) !== tierForOffice(candidacyContests[contestIndex - 1].title, candidacyContests[contestIndex - 1].ocdId) ? { "data-office-tier-start": "true" } : {}),
                ...(certainty && needsPill(certainty.certaintyOf(contest.ocdId)) ? { "data-could-govern": "true" } : {}),
              }}
              sources={[{ what: "Candidates and voting instructions", provenance: contest.provenance }, ...(lineup && canvass ? [{ what: "Certified primary nominees", provenance: { sourceUrl: canvass.url, sourceOrg: canvass.issuedBy, collectedAt: canvass.readAt, verifiedAt: null } }] : [])]}
              gaps={contest.voteFor === null ? [{ id: `contest-voting:${contest.id}`, label: "voting instructions" }] : []}
              className="ballot-office-card rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-5 shadow-[var(--shadow-panel)] [&>.reader-card-header]:sr-only [&>.reader-card-body]:p-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <h2 className="text-[1.0625rem] font-semibold tracking-tight">
                  {contest.title}
                  {/* The level tag, in the tier's accent; tier from the contest's OCD identity, never the office name. */}
                  <LevelTag tier={tierForOffice(contest.title, contest.ocdId)} />
                  {/* One short mark tied to the page-level block above. Not a completeness marker. */}
                  {certainty && needsPill(certainty.certaintyOf(contest.ocdId)) && (
                    <JurisdictionMark />
                  )}
                  {/* Only on contests that render candidate cards. */}
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
                {(contest.voteFor !== null || contest.termYears) && <p className="t-eyebrow text-muted">
                  {[contest.voteFor !== null ? `Vote for ${contest.voteFor}` : null, contest.termYears ? `${contest.termYears}-year term` : null].filter(Boolean).join(" · ")}
                </p>}
              </div>

              {/* What this office does; describes the office, never the people running for it. */}
              {(() => {
                const blurb = officeBlurbs.get(contest.id) ?? null;
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

              {/* The certified lineup replaces the filing list. */}
              {lineup ? (
                <>
                <ul className="ballot-candidate-grid mt-3.5">
                  {lineup.nominees.map((nominee) => (
                    <li
                      key={nominee.name}
                      data-candidate-target={`${contest.id}|${nominee.name}`}
                    >
                      <CandidateCard
                        name={nominee.name}
                        partyLine={
                          <>
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
                        /* The sections are server components handed across the boundary as children, which is why they are written here rather than inside the pill. */
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
                            officeBlurb={officeBlurbs.get(contest.id) ?? null}
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
                      {/* Reader expression, never a recommendation: stored and aggregated, never rendered back, and nothing orders candidates by it. */}
                      <ReactionControl
                        targetType="CANDIDATE"
                        targetId={`${contest.id}|${nominee.name}`}
                        prompt="Would you vote for them?"
                        context={
                          centroid && zip
                            ? { zip, lat: centroid.lat, lng: centroid.lng }
                            : null
                        }
                        // Counted from the lineup itself, so a contest
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
                {/* The private pick, distinct from the reactions above. */}
                <PickControl
                  contestId={contest.id}
                  contestTitle={contest.title}
                  voteFor={contest.voteFor ?? 0}
                  /* The reaction target for this nominee, through the shared builder so the tally counts exactly these rows. */
                  options={pickOptionsFor(set, contest)}
                />
                </>
              ) : (
                <>
                  {/* Inline when this note is this contest's alone; a marker when other contests carry the same note. */}
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
                      /* Extended election-mechanics text collapses behind "More info"; the office explainer above stays open. */
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
                    {candidatesOf(set, contest).map((cand) => (
                      <li
                        key={cand.id}
                        data-candidate-target={cand.id}
                      >
                        <CandidateCard
                          name={`${cand.givenName} ${surnameDisplayCase(cand.familyName)}`}
                          partyLine={
                            <>
                              {/* Display only; no-affiliation stays gray. */}
                              {/* A missing party label renders nothing. */}
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
                          /* Both branches carry the same sections in the same order. */
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
                              officeBlurb={officeBlurbs.get(contest.id) ?? null}
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
                        {/* Reader expression, never a recommendation. */}
                        <ReactionControl
                          targetType="CANDIDATE"
                          targetId={cand.id}
                          prompt="Would you vote for them?"
                          context={
                            centroid && zip
                              ? { zip, lat: centroid.lat, lng: centroid.lng }
                              : null
                          }
                          // The filing list's own count for this
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
                  {/* The private pick, distinct from reactions. */}
                  <PickControl
                    contestId={contest.id}
                    contestTitle={contest.title}
                    voteFor={contest.voteFor ?? 0}
                    /* Keyed the way this branch keys reactions. */
                    options={pickOptionsFor(set, contest)}
                  />
                </>
              )}
            </Card>
          );
        })}
      </div>
      )}

      {/* The collapsed source lines, cited once. */}
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

      {/* The canvass caveat, once, under the contests it governs. */}
      {set &&
        matched &&
        candidacyContests.some((c) => lineupForContest(c.id)) && (
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted lg:max-w-2xl">
            {getGeneralLineup()?.note}
          </p>
        )}

      {/* Official words verbatim where the authority published them; the plain-language summary labeled as such. Statewide and local groups render separately, and an empty group renders no heading. */}
      {(
        [
          { scope: "STATEWIDE", heading: "Statewide measures", list: statewideMeasures, tier: "state" },
          { scope: "LOCAL", heading: "Local measures", list: localMeasures, tier: "local" },
        ] as const
      )
        .filter((group) => group.list.length > 0)
        .map((group) => (
        <section className="mt-7" key={group.scope} data-measure-scope={group.scope}>
          {/* The section header wears the tier's own colour. */}
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
            /* The official words held for this contest; null renders nothing. */
            const measure = measureFor(contest.id);
            return (
              <Card key={contest.id} attrs={{"data-contest-id": contest.id}} title={contest.title} eyebrow={<LevelTag tier={tierForOffice(contest.title, contest.ocdId)} />} sources={[]}>
              <div>


                {/* The question, verbatim, first. */}
                {/* The plain-language summary leads, for a local measure as well as a statewide one. */}
                {summary ? (
                  <div
                    className="mt-2.5 rounded-md bg-[var(--surface,rgba(255,255,255,0.04))] p-3"
                    data-measure-summary="PRESENT"
                  >
                    <p className="t-eyebrow text-muted">
                      Plain-language summary — read the official text below
                    </p>
                    <p className="mt-1.5 t-body font-semibold leading-relaxed">
                      {summary.summary}
                    </p>
                    {summary.yesMeans && <p className="mt-2 t-body leading-relaxed" data-measure-yes><strong>YES:</strong> {summary.yesMeans}</p>}
                    {summary.noMeans && <p className="mt-2 t-body leading-relaxed" data-measure-no><strong>NO:</strong> {summary.noMeans}</p>}
                  </div>
                ) : (
                  measure && (
                    <CardGapContribution id={`measure-summary:${contest.id}`} label="a plain-language summary" />
                  )
                )}

                {/* Reactions attach to provisions, never to the measure as a whole. Collapsed so the page stays navigable. */}
                {provisionsForContest(contest.id, measureRecords).length > 0 && (
                  <details className="mt-3.5" data-provisions>
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
                          <p className="t-body font-semibold leading-snug">
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
                          {/* The reaction attaches to the provision, after its explanation. `compact` because a measure carries several. */}
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

                {/* A held official statement renders verbatim; a null one says the gap is ours and points at the scope note's document. */}
                {/* The verbatim ballot text sits in a collapsed disclosure; `<details>` keeps the `data-measure-*` children in the DOM. */}
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
                        className="t-record mt-1.5 whitespace-pre-line t-body leading-relaxed text-paper-dim"
                        data-measure-question={measure.id}
                      >
                        {measure.questionText}
                      </p>
                      {measure.officialStatement ? (
                        <div className="mt-3" data-measure-statement="PRESENT">
                          <p className="t-eyebrow text-muted">
                            What the authority published with it
                          </p>
                          <p className="t-record mt-1.5 whitespace-pre-line t-body leading-relaxed text-paper-dim">
                            {measure.officialStatement}
                          </p>
                        </div>
                      ) : (
                        <CardGapContribution id={`measure-statement:${contest.id}`} label="the official statement" />
                      )}
                    </div>
                  </details>
                )}

                {measure && <CardSourcesContribution id={`measure-text:${contest.id}`} sources={[{ what: "Official measure text", provenance: measure.provenance }]} />}

                {analysis?.text ? (
                  // The official analysis collapses by
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

                {/* Identical reader qualifications share one page note. */}
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

                {/* The private pick on measures: Yes/No, this device only. */}
                <PickControl
                  contestId={contest.id}
                  contestTitle={contest.title}
                  voteFor={1}
                  prominent
                  options={pickOptionsFor(set, contest)}
                />

                <CardSourcesContribution id={`measure-analysis:${contest.id}`} sources={[{ what: analysis ? "Official analysis" : "Official measure filing", provenance: { sourceUrl: analysis?.analysisUrl ?? contest.provenance.sourceUrl ?? "", sourceOrg: analysis?.sourceOrg ?? contest.provenance.sourceOrg, collectedAt: analysis?.retrievedAt ?? contest.provenance.collectedAt, verifiedAt: null } }]} />
              </div>
              </Card>
            );
          })}
          </div>
        </section>
      ))}

      {/* Each note is a sourced fact about an authority's own publishing state, explaining why an expected contest is not there. */}
      {matched && !matched.contests.some((c) => tierForOcdId(c.ocdId) === "local") && (
        <section
          className="mt-6 rounded-[10px] border border-dashed border-[var(--panel-border)] p-4 lg:max-w-2xl"
          data-ballot-no-local-races
        >
          <h2 className="t-structure text-paper-dim">County, city and school-board races</h2>
          <p className="mt-2 t-body text-muted">We do not have county, city or school-board races for this ballot yet.</p>
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
          {/* `groupAbsences` merges only where sentence, source, URL and read date all agree, and names every jurisdiction. */}
          {groupAbsences(matched.absences).map((absence) => (
            <section
              key={absence.key}
              className="mt-5 rounded-[10px] border border-[var(--panel-border)] p-4 lg:max-w-2xl"
              data-absence-count={absence.members.length}
              data-absence-ocd-ids={absence.members.map((record) => record.ocdId).join(" ")}
            >
              <p className="t-body leading-relaxed text-paper-dim">
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

          {/* Every scope note that repeats, once, at the foot, with its count. */}
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



          {/* The page-level disclosure, once, inside the block that renders when contests render. */}
          
        </>
      )}

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
