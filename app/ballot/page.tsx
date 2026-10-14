import { stateOfficesForDivisions } from "../../lib/reference/state-offices.ts";
import { StateOfficeContacts } from "../../components/state-office-contacts.tsx";
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
import { CandidateCard, CandidatePortraitSources } from "@/components/ballot/candidate-card";
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
import { currentRegistrationLinks } from "@/lib/ballot/registration-links";
import { currentElectionOffices } from "@/lib/ballot/election-offices";
import { currentPollingPlaceLinks } from "@/lib/ballot/polling-place-links";
import { electionFieldState } from "@/lib/civic-data/election-fields";
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
import { STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "@/lib/funding/data-plane";
import { settleCampaignFinanceReads } from "@/lib/funding/campaign-finance-reader";
import { officeIdentity } from "@/lib/officials/office-identity";
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
import { currentElectionDates, electionDatesFor } from "@/lib/ballot/election-dates";
import {
  calendarableSteps,
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

export const runtime = "nodejs";

const AUXILIARY_READER_LABEL: Record<BallotAuxiliaryFamily, string> = {
  "candidate-profiles": "candidate profiles",
  "candidate-publications": "what candidates say in their own words",
  "federal-funding": "federal campaign money",
  "state-money": "state campaign money",
  "campaign-finance": "campaign money filings",
  "federal-directory": "federal officeholders",
  "registry-runtime": "the officials and districts that go with this ZIP",
  "nh-members": "New Hampshire legislators",
  "ballot-navigation": "registration and polling-place links",
};

const EXTENDED_MECHANICS_CHARS = 180;

function candidatesOf(set: BallotSet, contest: Contest): Candidacy[] {
  return set.candidacies
    .filter((c) => c.contestId === contest.id)
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
}

function pickOptionsFor(
  set: BallotSet | null,
  contest: Contest,
): { id: string; label: string; reactionTargetId?: string }[] {
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

function isFederalContest(contest: Contest): boolean {
  const office = officeIdentity(contest.title);
  return office === "us_senator" || office === "us_representative";
}

async function IncumbentName({ name, context, holder }: {
  name: string;
  context: { zip: string; lat: number; lng: number } | null;
  holder: SeatHolder | null;
}) {
  return holder ? <IncumbentNameLink holder={holder} name={name} context={context} />
    : <span className="text-[0.9375rem] font-semibold tracking-tight">{name}</span>;
}

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
    answer = await withReaderAuthorityEdge(readerEdge, async () => fundingAnswerForTarget(targetKey));
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

function stateCandidateFunding(
  records: ReturnType<typeof stateMoneyForCard>["records"],
  context: ReactionViewContext | null,
) {
  if (records.length === 0) return null;
  return <StateMoneySection records={records} bare context={context} />;
}

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
  resolvedStanding,
  contestId,
  context,
  authorityAvailability,
  readerEdge,
}: {
  name: string;
  partyLine: React.ReactNode;

  partyLabel?: string | null;

  card?: CandidateCardData | null;

  links?: CandidateLinks | null;

  targetKey: string;
  contestTitle: string;

  contestOcdId: string;
  officeBlurb: OfficeBlurb | null;

  federal: boolean;

  resolvedStanding: Awaited<ReturnType<typeof contestIncumbency>> | null;
  contestId: string;

  context: { zip: string; lat: number; lng: number } | null;
  authorityAvailability: BallotAuthorityAvailability;

  readerEdge: ReaderAuthorityEdgeBundle | null;
}) {
  const recordHolder = resolvedStanding?.holderFor.get(targetKey) ?? null;
  const officeholdersAvailable = recordHolder !== null || (federal
    ? authorityAvailability.federalOfficeholders : authorityAvailability.officeholders);
  const standing = resolvedStanding?.decisions.get(targetKey) ?? {
    standing: "UNKNOWN" as const,
    basis: officeholdersAvailable
      ? "this candidate was not among the names this contest was resolved against"
      : "the canonical officeholder authority could not be read",
    source: null,
  };

  let positions: ReturnType<typeof positionsFor> = [];
  let positionsUnavailable = !authorityAvailability.candidatePublications;
  if (!positionsUnavailable) {
    try {
      positions = await withReaderAuthorityEdge(readerEdge, async () =>
        positionsFor(targetKey, null, await readStanceTopics(), recordHolder?.id));
    } catch {
      positionsUnavailable = true;
    }
  }

  let stateMoney: ReturnType<typeof stateMoneyForCard>["records"] = [];
  let stateMoneyUnavailable = !federal && (!authorityAvailability.campaignFinance ||
    (authorityAvailability.stateMoneyApplicable && !authorityAvailability.stateMoney));
  if (!federal) {
    try {
      stateMoney = await withReaderAuthorityEdge(readerEdge, async () => stateMoneyForCard(targetKey, contestId).records);
    } catch {
      stateMoneyUnavailable = true;
    }
  }
  const contactCandidacyId = targetKey.includes("|") ? reconciledCandidacyIdForCard(targetKey) : targetKey;
  const filingContact = contactCandidacyId ? candidateContactForCandidacy(contactCandidacyId) : null;

  return (
    <CandidateBattlecard
      name={name}

      tier={tierForOffice(contestTitle, contestOcdId)}
      partyLine={partyLine}
      partyLabel={partyLabel}
      photoUrl={card?.photoUrl ?? recordHolder?.photoUrl ?? null}
      incumbency={standing.standing}

      incumbencyGap={standing.gap ?? null}
      speakContext={context ? { lat: context.lat, lng: context.lng } : null}
      subjectId={targetKey}

      contactHolder={recordHolder}
      contact={<><CandidateContact card={card ?? null} links={links} filing={filingContact} />{recordHolder && <ContactPills holder={recordHolder} scope="primary" />}{!card?.email && !links?.campaign && !filingContact?.email && !recordHolder && <CardGapContribution id={`candidate-contact:${targetKey}`} label="contact details" subject={{ type: "CANDIDATE", id: targetKey }} />}</>}
      sections={{

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
          <CandidateFunding targetKey={recordHolder?.id ?? targetKey} context={context} available={authorityAvailability.funding} readerEdge={readerEdge} />
        ) : <>{stateMoneyUnavailable && unavailableHolding("state campaign-finance")}{stateCandidateFunding(stateMoney, context)}</>,

        record: !officeholdersAvailable ? (
          unavailableHolding("officeholder-directory")
        ) : recordHolder ? (
          <RecentVotes holder={recordHolder} reactionContext={context} contentOnly />
        ) : null,

        sources: (
          <>
            {!authorityAvailability.candidateProfiles && unavailableHolding("candidate-profile")}
            <CandidatePortraitSources card={card ?? null} />
            {recordHolder && <CandidateSources holder={recordHolder} />}
            <CandidateContactSources links={links} filing={filingContact} />

          </>
        ),
      }}
    />
  );
}

function CandidateSources({ holder }: { holder: SeatHolder }) {
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
  readonly stateMoneyApplicable: boolean;
  readonly campaignFinance: boolean;
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

export const metadata: Metadata = {
  title: titleFor("Your ballot"),
  description: "The contests on your ballot, the candidates in them, and where to vote.",
};

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
  let set: BallotSet | null = null;
  let matched: {
    contests: Contest[];
    absences: BallotAbsence[];
  } | null = null;
  let coverageNotes: string[] = [];
  let attempted = false;
  let divisionHoldingUnavailable = false;
  const ballotLoaderFailures: string[] = [];

  let askOcdIds: string[] = [];
  const readerEdgeRead = centroid ? readBallotReaderEdge() : Promise.resolve(null);
  if (centroid) prefetchReaderGeography();
  let certainty = await readerEdgeRead.then(edge => withReaderAuthorityEdge(edge, () => zipCertainty(zip)));

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
      divisionHoldingUnavailable = true;
    }

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

  const auxiliaryPreloads = new Map<BallotAuxiliaryFamily, () => Promise<unknown>>();
  if (centroid) auxiliaryPreloads.set("ballot-navigation", settleBallotNavigationRead);
  if (set && matched) {
    auxiliaryPreloads.set("candidate-profiles", settleCandidateProfilesRead);
    auxiliaryPreloads.set("candidate-publications", settleCandidateCorpusRead);
    auxiliaryPreloads.set("registry-runtime", () => settleRegistryAuthorityReads("REGISTRY"));
    if (matched.contests.some(isFederalContest)) {
      auxiliaryPreloads.set("federal-directory", settleFederalDirectoryRead);
    }
    if (matched.contests.some(nhLegislativeRosterAppliesTo)) {
      auxiliaryPreloads.set("nh-members", settleNhSeatHolders);
    }
    if (matched.contests.some((contest) => isFederalContest(contest))) {
      auxiliaryPreloads.set("federal-funding", settleFundingRead);
    }
    auxiliaryPreloads.set("campaign-finance", () => settleCampaignFinanceReads(askOcdIds));
    if (matched.contests.some((contest) => !isFederalContest(contest)) &&
        Object.hasOwn(STATE_CAMPAIGN_FINANCE_SOURCES, set.election.state)) {
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
    stateMoneyApplicable: auxiliaryPreloads.has("state-money"),
    campaignFinance: auxiliaryPreloads.has("campaign-finance") && !auxiliaryFailed.has("campaign-finance"),
    officeholders:
      auxiliaryPreloads.has("registry-runtime") &&
      !auxiliaryFailed.has("registry-runtime"),
    federalOfficeholders:
      auxiliaryPreloads.has("federal-directory") && !auxiliaryFailed.has("federal-directory"),
  };

  let registrationLinks: ReturnType<typeof currentRegistrationLinks> = [];
  let electionOffices: ReturnType<typeof currentElectionOffices> = [];
  let pollingLinks: ReturnType<typeof currentPollingPlaceLinks> = [];
  let electionDates: ReturnType<typeof currentElectionDates> = [];
  if (auxiliaryPreloads.has("ballot-navigation") && !auxiliaryFailed.has("ballot-navigation")) {
    try {
      registrationLinks = currentRegistrationLinks();
      electionOffices = currentElectionOffices(askOcdIds);
      pollingLinks = currentPollingPlaceLinks();
      electionDates = currentElectionDates();
    } catch {
      auxiliaryFailures.push("ballot-navigation");
      auxiliaryFailed.add("ballot-navigation");
    }
  }

  const availableCardForNominee = (contestId: string, name: string): CandidateCardData | null =>
    cardForNominee(contestId, name);
  const availableLinksForNominee = (contestId: string, name: string): CandidateLinks | null =>
    authorityAvailability.candidateProfiles ? linksForNominee(contestId, name) : null;
  const availableCardForCandidacy = (candidacyId: string): CandidateCardData | null =>
    cardForCandidacy(candidacyId);
  const availableLinksForCandidacy = (candidacyId: string): CandidateLinks | null =>
    authorityAvailability.candidateProfiles ? linksForCandidacy(candidacyId) : null;
  const availableDerivedBlurbFor = (candidateId: string) =>
    authorityAvailability.candidatePublications ? derivedBlurbFor(candidateId) : null;

  const navigationStates = [...new Set(askOcdIds.map(electionFieldState).filter((state): state is string => state !== null))];

  const candidacyContests =
    matched?.contests.filter((c) => c.type === "CANDIDACY") ?? [];
  const contestResolutions = new Map(await Promise.all(candidacyContests.map(async contest => {
    const lineup = lineupForContest(contest.id);
    const candidates = lineup ? lineup.nominees.map(n => ({ key: `${contest.id}|${n.name}`,
      display: n.name, targetKey: `${contest.id}|${n.name}` })) : candidatesOf(set!, contest).map(c => ({
      key: c.id, display: `${c.givenName} ${surnameDisplayCase(c.familyName)}`, targetKey: c.id,
    }));
    const result = await contestIncumbency({ ...contest, candidates, federal: isFederalContest(contest) },
      incumbentHolderFor).catch(() => null);
    return [contest.id, result] as const;
  })));
  const resolvedHolder = (contestId: string, key: string) => contestResolutions.get(contestId)?.holderFor.get(key) ?? null;

  const measureRecords = set ? measureRecordsForBallot(set) : [];
  const measureContests = orderMeasures(
    matched?.contests.filter((c) => c.type === "MEASURE") ?? [],
  );

  const measureFor = (contestId: string): Measure | null =>
    set?.measures.find((m) => m.contestId === contestId) ?? null;

  const isStatewideDivision = (ocdId: string): boolean =>
    /^ocd-division\/country:us\/state:[a-z]{2}$/.test(ocdId);
  const statewideMeasures = measureContests.filter((c) =>
    isStatewideDivision(c.ocdId),
  );
  const localMeasures = measureContests.filter(
    (c) => !isStatewideDivision(c.ocdId),
  );

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

    ...(set
      ? candidacyContests.flatMap((c) =>
          candidatesOf(set, c).map((k) => ({
            id: k.id,
            name: [k.givenName, k.familyName].filter(Boolean).join(" "),
            kind: "PERSON" as const,
          })),
        )
      : []),

    ...candidacyContests.flatMap((c) =>
      (lineupForContest(c.id)?.nominees ?? []).map((n) => ({
        id: `${c.id}|${n.name}`,
        name: n.name,
        kind: "PERSON" as const,
      })),
    ),
  ].filter((v) => v.name.length > 0);

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

  const currentJurisdictionKey =
    matched?.contests
      .map((c) => jurisdictionKeyForContestId(c.id))
      .find((key): key is string => key !== null) ?? null;

  const FOOTNOTE_MARKERS = ["*", "†", "‡", "§", "‖", "¶"];

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
          <BallotNarrowing zip={zip} electionDate={set?.election.date ?? null} className="ballot-top-pill" />
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
      <StateOfficeContacts offices={stateOfficesForDivisions(askOcdIds).filter(office => office.kind === "CAMPAIGN_FINANCE_OFFICE")} />

      {navigationStates.map(state => {
        const dates = electionDatesFor(state, electionDates, set?.election.state === state ? set.election.date : "2026-11-03");
        const registrationRequired = !dates?.steps.some(step => step.label === "Voter registration" &&
          /\b(?:do(?:es)?(?:\s+not|n['’]t)\s+require\s+(?:voter\s+)?registration|(?:voter\s+)?registration\s+is\s+not\s+required)\b/i.test(step.detail ?? ""));
        const offices = electionOffices.filter(office => office.state === state);
        const links = [...registrationLinks, ...pollingLinks].filter(link => link.state === state);
        const sources = [
          ...offices.map(office => ({ what: "Election office", provenance: { sourceUrl: office.url, sourceOrg: office.sourceOrg, collectedAt: office.collectedAt, verifiedAt: office.verifiedAt } })),
          ...links.map(link => ({ what: link.label, provenance: { sourceUrl: link.sourceUrl ?? link.url, sourceOrg: link.sourceOrg, collectedAt: link.verifiedAt, verifiedAt: link.verifiedAt } })),
          ...(dates?.steps ?? []).map(step => ({ what: step.label, provenance: { sourceUrl: step.sourceUrl, sourceOrg: step.sourceOrg, collectedAt: step.collectedAt, verifiedAt: step.verifiedAt } })),
        ];
        return <section key={state} className="my-6 lg:max-w-3xl" aria-label={`${state} voting information`}>
          <Card title={`${state} voting information`} attrs={{ "data-ballot-navigation": state }} sources={sources}
            gaps={[
              ...(!offices.length ? [{ id: `election-office:${state}`, label: "election office" }] : []),
              ...(!links.some(link => link.purpose === "registration_page") ? [{ id: `registration-page:${state}`, label: "voter registration" }] : []),
              ...(registrationRequired && !links.some(link => link.purpose === "registration_lookup") ? [{ id: `registration-lookup:${state}`, label: "registration status" }] : []),
              ...(!links.some(link => link.purpose === "polling_lookup") ? [{ id: `polling-lookup:${state}`, label: "polling-place lookup" }] : []),
              ...(!links.some(link => link.purpose === "ballot_lookup") ? [{ id: `sample-ballot:${state}`, label: "sample-ballot lookup" }] : []),
              ...["Voter registration", "Mail-ballot request", "Early voting"].flatMap(label => dates?.steps.some(step => step.label === label)
                ? [] : [{ id: `election-dates:${state}:${label}`, label: `${label.toLowerCase()} deadlines` }]),
            ]}>
            {offices.map(office => <p key={`${office.divisionId}:${office.phone}`} className="mt-2" data-ballot-election-offices>
              <a href={office.navigationUrl ?? office.url}>{office.text}</a>
              {office.phone && <> · <a href={`tel:+1${office.phone.replace(/\D/g, "").slice(-10)}`}>{office.phone}</a></>}
            </p>)}
            {links.length > 0 && <div className="mt-3 flex flex-wrap gap-3">
              {links.map(link => <a key={`${link.purpose}:${link.url}`} href={link.url} target="_blank" rel="noreferrer"
                data-leaves-app data-registration-pill={link.purpose === "registration_lookup" ? true : undefined}
                data-navigation-kind={link.purpose} className="voting-open-button"
                aria-label={`${link.label} — opens the official site in a new tab`}>
                {link.label}<span aria-hidden="true" className="ml-1.5">↗</span>
              </a>)}
            </div>}
            {dates && <>
              <h3 className="mt-4 font-semibold">Election Day: {formatDateMDY(dates.electionDay)}</h3>
              <AddToCalendar event={{ id: `election-day-${state}-${dates.electionDay}`, title: `Election Day — vote (${state})`,
                allDayDate: dates.electionDay, description: `Your ballot, with sources: found via ${PRODUCT_NAME}.` }} />
              <ul className="mt-3 space-y-3">
                {calendarableSteps(dates.steps).map(({ step, window, upcoming }, index) => <li key={`${step.label}:${index}`} data-dated-event>
                  <p className="font-semibold">{step.label}</p>
                  {step.date && <p className="font-mono text-[0.875rem]" data-navigation-date>
                    {formatDateMDY(step.date.replaceAll(" – ", ", "))}
                  </p>}
                  <p className="t-body">{step.detail}</p>
                  {window && upcoming && !window.end && <AddToCalendar event={{
                    id: `ballot-${state}-${window.start}-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                    title: `${step.label} (${state})`, allDayDate: window.start,
                    description: step.detail ?? undefined,
                  }} />}
                </li>)}
              </ul>
            </>}
          </Card>
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

      <MyPicks
        currentJurisdictionKey={currentJurisdictionKey}
        pickable={pickableContests}
      />

      {set && matched && certainty && (
        <JurisdictionNote
          electionDate={set?.election.date ?? null}

          unplaceable={
            candidacyContests.filter(
              (contest) => certainty.certaintyOf(contest.ocdId) === "UNKNOWN",
            ).length
          }
          jurisdictions={[
            ...new Set(
              candidacyContests
                .filter((contest) => certainty.certaintyOf(contest.ocdId) === "AMBIGUOUS")

                .map((contest) => jurisdictionNameFromOcdId(contest.ocdId))
                .filter((name): name is string => name !== null),
            ),
          ]}

          zip={zip ?? ""}
        />
      )}

      {set && matched && (
      <div className="ballot-office-list">
      {candidacyContests.map((contest, contestIndex) => {
          const lineup = lineupForContest(contest.id);
          const canvass = lineup ? getGeneralLineup()?.canvass : null;
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

                  <LevelTag tier={tierForOffice(contest.title, contest.ocdId)} />

                  {certainty && needsPill(certainty.certaintyOf(contest.ocdId)) && (
                    <JurisdictionMark />
                  )}

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
                        holder={resolvedHolder(contest.id, `${contest.id}|${nominee.name}`)}
                        links={availableLinksForNominee(contest.id, nominee.name)}
                        derivedBlurb={availableDerivedBlurbFor(`${contest.id}|${nominee.name}`)}
                        nameSlot={
                          <IncumbentName
                            holder={resolvedHolder(contest.id, `${contest.id}|${nominee.name}`)}
                            name={nominee.name}
                            context={
                              centroid && zip
                                ? { zip, lat: centroid.lat, lng: centroid.lng }
                                : null
                            }
                          />
                        }

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
                            resolvedStanding={contestResolutions.get(contest.id) ?? null}
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

                      <ReactionControl
                        targetType="CANDIDATE"
                        targetId={`${contest.id}|${nominee.name}`}
                        prompt="Would you vote for them?"
                        context={
                          centroid && zip
                            ? { zip, lat: centroid.lat, lng: centroid.lng }
                            : null
                        }
                        singleCandidateContest={lineup.nominees.length === 1}
                      />
                    </li>
                  ))}
                </ul>
                <IncumbencyFootnote />
                {!isFederalContest(contest) && (
                  <StateFundingNote note={STATE_FUNDING_NOTE} />
                )}

                {contest.voteFor !== null && <PickControl
                  contestId={contest.id}
                  contestTitle={contest.title}
                  voteFor={contest.voteFor}

                  options={pickOptionsFor(set, contest)}
                />}
                </>
              ) : (
                <>

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
                          holder={resolvedHolder(contest.id, cand.id)}
                          links={availableLinksForCandidacy(cand.id)}
                          derivedBlurb={availableDerivedBlurbFor(cand.id)}
                          filedSiteUrl={cand.websiteUrl}
                          nameSlot={
                            <IncumbentName
                              holder={resolvedHolder(contest.id, cand.id)}
                              name={`${cand.givenName} ${surnameDisplayCase(cand.familyName)}`}
                              context={
                                centroid && zip
                                  ? { zip, lat: centroid.lat, lng: centroid.lng }
                                  : null
                              }
                            />
                          }

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
                              resolvedStanding={contestResolutions.get(contest.id) ?? null}
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

                        <ReactionControl
                          targetType="CANDIDATE"
                          targetId={cand.id}
                          prompt="Would you vote for them?"
                          context={
                            centroid && zip
                              ? { zip, lat: centroid.lat, lng: centroid.lng }
                              : null
                          }
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

                  {contest.voteFor !== null && <PickControl
                    contestId={contest.id}
                    contestTitle={contest.title}
                    voteFor={contest.voteFor}

                    options={pickOptionsFor(set, contest)}
                  />}
                </>
              )}
            </Card>
          );
        })}
      </div>
      )}

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

      {set &&
        matched &&
        candidacyContests.some((c) => lineupForContest(c.id)) && (
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted lg:max-w-2xl">
            {getGeneralLineup()?.note}
          </p>
        )}

      {(
        [
          { scope: "STATEWIDE", heading: "Statewide measures", list: statewideMeasures, tier: "state" },
          { scope: "LOCAL", heading: "Local measures", list: localMeasures, tier: "local" },
        ] as const
      )
        .filter((group) => group.list.length > 0)
        .map((group) => (
        <section className="mt-7" key={group.scope} data-measure-scope={group.scope}>

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

            const measure = measureFor(contest.id);
            return (
              <Card key={contest.id} attrs={{"data-contest-id": contest.id}} title={contest.title} eyebrow={<LevelTag tier={tierForOffice(contest.title, contest.ocdId)} />} sources={[]}>
              <div>

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

                          <p className="t-eyebrow mt-0.5 text-muted">
                            {PROVISION_KIND_LABEL[provision.kind]}
                          </p>
                          <p className="mt-1 text-[0.75rem] leading-relaxed text-paper-dim">
                            {provision.what}
                          </p>

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
                    <p className="mt-2 text-[0.75rem] leading-relaxed text-muted">
                      We retrieved this measure&apos;s official analysis but
                      couldn&apos;t extract its text — read it at the link
                      below.
                    </p>
                  )
                )}

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
