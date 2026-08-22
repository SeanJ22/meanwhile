import Link from "next/link";

import { contestsForDivisions } from "@/lib/sources/ballot-nj-morris";
import { BALLOT_SOURCES } from "@/lib/ballot/registry";
import { divisionIdsForZipArea } from "@/lib/ballot/zip-divisions";
import { analysisForContest } from "@/lib/ballot/analyses";
import { summaryForContest } from "@/lib/ballot/measure-summaries";
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
} from "@/lib/ballot/candidate-sites";
import { blurbForContestTitle } from "@/lib/officials/office-blurbs";
import { surnameDisplayCase } from "@/lib/ballot/name-case";
import {
  cardForCandidacy,
  cardForNominee,
} from "@/lib/ballot/candidate-cards";
import { BallotNarrowing } from "@/components/ballot/ballot-narrowing";
import { photosFirst } from "@/lib/ballot/photo-order";
import { COLLECTION_NOTE } from "@/lib/ballot/collection-note";
import { FilingNote } from "@/components/ballot/filing-note";
import { CandidateBattlecard } from "@/components/ballot/candidate-battlecard";
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
import { registrationLinkFor } from "@/lib/ballot/registration-links";
import { pollingPlaceLinkFor } from "@/lib/ballot/polling-place-links";
import { WhereToVote } from "@/components/ballot/where-to-vote";
import { incumbentHolderFor } from "@/lib/ballot/incumbent-record";
import {
  IncumbentNameLink,
  IncumbentRecordLink,
} from "@/components/ballot/incumbent-record-link";
import { partyColorVar } from "@/lib/officials/party-color";
import { formatDateMDY } from "@/lib/map/format";
import {
  fundingAnswerForTarget,
  STATE_FUNDING_NOTE,
  type FundingAnswer,
} from "@/lib/funding/display";
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
} from "@/lib/ballot/types";
import { sharedNotesFor } from "@/lib/ballot/shared-notes";
import { resolveZip } from "@/lib/geo/zcta";
import { divisionsAt } from "@/lib/registry/server";
import { PRODUCT_NAME } from "@/lib/brand";
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

/** 4 (2026-08-19): the incumbent's voting-record link, where the exact-key
 *  join holds — an incumbent on a ballot IS an official we hold. No join,
 *  no link; never a wrong one. */
async function IncumbentRecord({
  targetKey,
  context,
}: {
  targetKey: string;
  context: { zip: string; lat: number; lng: number } | null;
}) {
  const holder = await incumbentHolderFor(targetKey);
  if (!holder) return null;
  return <IncumbentRecordLink holder={holder} context={context} />;
}

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
}: {
  targetKey: string;
  name: string;
  context: { zip: string; lat: number; lng: number } | null;
}) {
  const holder = await incumbentHolderFor(targetKey);
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
function CandidateFunding({
  targetKey,
  context,
}: {
  targetKey: string;
  context: { zip: string; lat: number; lng: number } | null;
}) {
  let answer: FundingAnswer;
  try {
    answer = fundingAnswerForTarget(targetKey);
  } catch {
    // A missing snapshot renders nothing — never an error in the reader's way.
    return null;
  }
  if (answer.kind === "none") return null;
  // Item 12: the wrapper carries the marker `pnpm measure:ballot` counts, so
  // "the section moved" is a measured claim rather than a described one.
  return (
    <div data-candidate-funding>
      {answer.kind === "absence" ? (
        <FundingAbsence data={answer.data} />
      ) : (
        <FundingDisplay data={answer.data} context={context} />
      )}
    </div>
  );
}

export default async function BallotPage({
  searchParams,
}: {
  searchParams: Promise<{ zip?: string }>;
}) {
  const { zip: zipParam } = await searchParams;
  const zip = zipParam && /^\d{5}$/.test(zipParam) ? zipParam : null;

  const resolution = zip ? resolveZip(zip) : null;
  const centroid = resolution?.ok ? resolution.centroid : null;

  // Every registered source is asked; a source whose contests match none of
  // the point's divisions contributes nothing. One source answers per state,
  // and the ballot follows wherever the zip actually is (2e).
  let set: BallotSet | null = null;
  let matched: {
    contests: Contest[];
    absences: BallotAbsence[];
  } | null = null;
  let coverageNotes: string[] = [];
  let attempted = false;

  if (centroid) {
    attempted = true;
    const divisions = await divisionsAt(centroid.lat, centroid.lng);
    /*
     * A ZIP IS AN AREA (`NJ01`, 2026-08-22). The centroid answer is kept whole
     * and widened to every division whose territory reaches inside this zip —
     * see `lib/ballot/zip-divisions.ts` for why, and for what this deliberately
     * does not claim.
     */
    const ocdIds = await divisionIdsForZipArea(zip, divisions.map((d) => d.ocdId));
    for (const { source } of BALLOT_SOURCES) {
      const candidate = source.normalize(await source.fetch());
      const hit = contestsForDivisions(candidate, ocdIds);
      if (hit.contests.length > 0 || hit.absences.length > 0) {
        set = candidate;
        matched = hit;
        coverageNotes = candidate.coverageNotes ?? [];
        break;
      }
    }
  }

  const dates =
    set && matched && matched.contests.length > 0
      ? electionDatesFor(set.election.state)
      : null;

  const candidacyContests =
    matched?.contests.filter((c) => c.type === "CANDIDACY") ?? [];
  const measureContests =
    matched?.contests.filter((c) => c.type === "MEASURE") ?? [];

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
      ? [...candidacyContests, ...measureContests].map((contest) => ({
          contestId: contest.id,
          contestTitle: contest.title,
          voteFor: contest.type === "MEASURE" ? 1 : contest.voteFor,
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
  const scopeNotes = sharedNotesFor(
    matched?.contests ?? [],
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

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 text-paper">
      {/* 6b: the way back, top-left — the map is where the reader came from. */}
      <p className="text-[0.8125rem]">
        <Link
          href="/"
          className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          ← Back to the map
        </Link>
      </p>
      <p className="t-eyebrow mt-4 text-muted">{PRODUCT_NAME}</p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
        What&apos;s on the ballot{zip ? ` near ${zip}` : ""}
      </h1>

      {/* The app's voice (design pass): guidance renders in the voice
          register, distinct from the filed record below. */}
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-voice">
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
      {zip && <BallotNarrowing zip={zip} />}

      {/* Item 4 (2026-08-14 second session): the standing header — the
          tester's "that's when you want to catch somebody and make them
          ready to vote." The dates a reader acts on, at the top, each from
          the state's own timeline (cited on the dates section below), and
          election day one tap from their calendar. */}
      {dates &&
        set &&
        (() => {
          const reg = registrationLinkFor(set.election.state);
          const polls = pollingPlaceLinkFor(set.election.state);
          const regStep = dates.steps.find((s) =>
            /registration deadline/i.test(s.label),
          );
          const earlyStep = dates.steps.find((s) =>
            /early voting/i.test(s.label),
          );
          return (
            <section className="mt-6 rounded-[10px] border border-[var(--signal)]/60 bg-[var(--signal)]/5 p-5 shadow-[var(--shadow-panel)]">
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
                  <li>
                    Register to vote by{" "}
                    <span className="font-mono text-[0.8125rem] font-semibold">
                      {formatDateMDY(regStep.date)}
                    </span>
                    {reg && (
                      <>
                        {" — "}
                        <a
                          href={reg.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                        >
                          {reg.label} →
                        </a>
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
                  while `data/voting-sites.json` held six retrieved, sourced,
                  dated voting locations for this reader's own township. The
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
                {polls && (
                  <li>
                    <WhereToVote fallback={polls} />
                    <p className="mt-0.5 text-[0.75rem] leading-relaxed text-voice">
                      {polls.note}
                    </p>
                  </li>
                )}
              </ul>
              {/* The tester's exact confusion, answered in one line. The
                  propositions sentence renders only where propositions
                  actually share the ballot. */}
              <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-voice">
                Everyone below is on this ballot.
                {measureContests.length > 0 &&
                  " Propositions are voted on at the same time."}
              </p>
            </section>
          );
        })()}

      {/* 7: the mover's page — the questions people ask before moving,
          answered from official sources. */}
      {zip && (
        <p className="mt-2 text-[0.8125rem]">
          <Link
            href={`/about-area?zip=${zip}`}
            className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {/* 3c: the author's line, verbatim. Marijuana stays in the
                section; it left the teaser. */}
            Moving here? Know the basics →
          </Link>
        </p>
      )}

      {!zip && (
        <p className="mt-6 text-[0.8125rem] text-muted">
          Open this page with a zip, e.g.{" "}
          <Link href="/ballot?zip=07866" className="underline decoration-dotted">
            /ballot?zip=07866
          </Link>
          .
        </p>
      )}

      {zip && !centroid && (
        <p className="mt-6 text-[0.8125rem] text-muted">
          We couldn&apos;t place that zip. Try another, or return to{" "}
          <Link href="/" className="underline decoration-dotted">
            the map
          </Link>
          .
        </p>
      )}

      {attempted && !matched && (
        <p className="mt-6 text-[0.8125rem] leading-relaxed text-muted">
          We haven&apos;t built the ballot for this area yet. Ballot coverage
          currently reaches Pima County AZ, Morris County NJ, and Merrimack
          County NH. This is not a statement that nothing is on your ballot.
        </p>
      )}

      {/* 2c: the registration checker, prominent — the first thing a voter
          needs to know is whether they can vote at all. */}
      {dates && set && (() => {
        const reg = registrationLinkFor(set.election.state);
        return reg ? (
          <div className="mt-6 rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3.5 shadow-[var(--shadow-panel)]">
            {reg && (
              <p className="text-[0.9375rem]">
                <a
                  href={reg.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  {reg.label} →
                </a>{" "}
                <span className="text-[0.75rem] text-muted">
                  on the {reg.sourceOrg}&apos;s site
                </span>
              </p>
            )}
            {/* F21 (2026-08-20, the author's ruling): the polling-place
                pointer USED TO RENDER HERE TOO, and no longer does. Item 6
                (2026-08-15) required it in the dates header AND this box,
                which was right while the two were links with different
                surrounding context; item 15 made both the same in-app pill,
                and a repeated identical control makes a reader wonder which
                one is the real one. The ruling: once per page, in the dates
                header. This box keeps the registration half, which is a
                different question with a different answer. The note about
                what the state's tool asks for moved UP with the pointer
                rather than being lost with the duplicate. */}
          </div>
        ) : null;
      })()}

      {/* 4a: the private election-day list — renders only once something
          is marked. Device-local; the component says so itself. */}
      <MyPicks
        currentJurisdictionKey={currentJurisdictionKey}
        pickable={pickableContests}
      />

      {dates && (
        <section className="mt-6 rounded-[10px] border border-[var(--panel-border)] p-5">
          <h2 className="t-structure text-paper-dim">
            Dates that decide whether you can vote
          </h2>
          <ul className="mt-2.5 space-y-1.5">
            {calendarableSteps(dates.steps).map(({ step, window, upcoming }) => (
              <li key={step.label} className="flex items-baseline justify-between gap-3">
                <span className="text-[0.8125rem]">{step.label}</span>
                <span className="shrink-0 text-right" data-dated-event>
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

      {set &&
        matched &&
        candidacyContests.map((contest) => {
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
              className="mt-5 rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-5 shadow-[var(--shadow-panel)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <h2 className="text-[1.0625rem] font-semibold tracking-tight">
                  {contest.title}
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
                  Vote for {contest.voteFor}
                  {contest.termYears ? ` · ${contest.termYears}-year term` : ""}
                </p>
              </div>

              {/* 4b (2026-08-17): what this office actually does, in the
                  register, at the top of the contest. Describes the office,
                  never the people running for it. Voice register. */}
              {(() => {
                const blurb = blurbForContestTitle(contest.title);
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

              {/* The certified lineup retires the filing-list fallback (6a):
                  what a November voter actually chooses among. */}
              {lineup ? (
                <>
                <ul className="mt-3.5 space-y-3">
                  {photosFirst(lineup.nominees, (n) => Boolean(cardForNominee(contest.id, n.name)?.photoUrl)).map((nominee) => (
                    <li
                      key={nominee.name}
                      className="border-b border-[var(--panel-border)] pb-3 last:border-0 last:pb-0"
                    >
                      <CandidateCard
                        name={nominee.name}
                        partyLine={
                          <>
                            {/* 3a: display only, colored per the palette. */}
                            <span style={{ color: partyColorVar(nominee.partyLabel) }}>
                              {nominee.partyLabel}
                            </span>
                            {nominee.note && <> · {nominee.note}</>}
                          </>
                        }
                        card={cardForNominee(contest.id, nominee.name)}
                        links={linksForNominee(contest.id, nominee.name)}
                        derivedBlurb={derivedBlurbFor(`${contest.id}|${nominee.name}`)}
                        nameSlot={
                          <IncumbentName
                            targetKey={`${contest.id}|${nominee.name}`}
                            name={nominee.name}
                            context={
                              centroid && zip
                                ? { zip, lat: centroid.lat, lng: centroid.lng }
                                : null
                            }
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
                          <CandidateBattlecard
                            name={nominee.name}
                            partyLine={nominee.partyLabel}
                            subjectId={`${contest.id}|${nominee.name}`}
                          >
                            {/* P02 + D05 (2026-08-19, g20): their own words,
                                per issue, sourced. The SAME issue list for
                                every candidate in the contest — that is the
                                equal-effort rule made visible, and the header
                                states the denominator before any count. */}
                            <CandidatePositions
                              headline={positionsHeadline(
                                positionsFor(`${contest.id}|${nominee.name}`),
                              )}
                              positions={positionsFor(`${contest.id}|${nominee.name}`)}
                            />
                            <IncumbentRecord
                              targetKey={`${contest.id}|${nominee.name}`}
                              context={
                                centroid && zip
                                  ? { zip, lat: centroid.lat, lng: centroid.lng }
                                  : null
                              }
                            />
                            {isFederalContest(contest) && (
                              <CandidateFunding
                                targetKey={`${contest.id}|${nominee.name}`}
                                context={
                                  centroid && zip
                                    ? { zip, lat: centroid.lat, lng: centroid.lng }
                                    : null
                                }
                              />
                            )}
                          </CandidateBattlecard>
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
                  voteFor={contest.voteFor}
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
                  {contest.scopeNote &&
                    (scopeNotes.isShared(contest.id) ? (
                      <p className="mt-1.5 font-mono text-[0.6875rem] text-muted">
                        <a
                          href="#scope-notes"
                          className="underline decoration-dotted underline-offset-2 hover:text-link"
                        >
                          {scopeNotes.markerFor(contest.id)} see note
                        </a>
                      </p>
                    ) : (
                      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
                        {contest.scopeNote}
                      </p>
                    ))}
                  <ul className="mt-3.5 space-y-3">
                    {photosFirst(candidatesOf(set, contest), (x) => Boolean(cardForCandidacy(x.id)?.photoUrl)).map((cand) => (
                      <li
                        key={cand.id}
                        className="border-b border-[var(--panel-border)] pb-3 last:border-0 last:pb-0"
                      >
                        <CandidateCard
                          name={`${cand.givenName} ${surnameDisplayCase(cand.familyName)}`}
                          partyLine={
                            <>
                              {/* 3a: display only, colored per the palette;
                                  no-affiliation stays gray. */}
                              <span style={{ color: partyColorVar(cand.partyLabel) }}>
                                {cand.partyLabel ?? "No party label filed"}
                              </span>
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
                          card={cardForCandidacy(cand.id)}
                          links={linksForCandidacy(cand.id)}
                          derivedBlurb={derivedBlurbFor(cand.id)}
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
                            />
                          }
                          /* ITEM 12: the identical move on the filed-candidate
                             side. The two branches must carry the same
                             sections in the same order — a build where they
                             could diverge would produce a ranking by
                             accident, which is the note the positions call
                             already carried and applies to the whole card. */
                          battlecardSlot={
                            <CandidateBattlecard
                              name={`${cand.givenName} ${surnameDisplayCase(cand.familyName)}`}
                              partyLine={cand.partyLabel ?? "No party label filed"}
                              subjectId={cand.id}
                            >
                              <CandidatePositions
                                headline={positionsHeadline(positionsFor(cand.id))}
                                positions={positionsFor(cand.id)}
                              />
                              <IncumbentRecord
                                targetKey={cand.id}
                                context={
                                  centroid && zip
                                    ? { zip, lat: centroid.lat, lng: centroid.lng }
                                    : null
                                }
                              />
                              {isFederalContest(contest) && (
                                <CandidateFunding
                                  targetKey={cand.id}
                                  context={
                                    centroid && zip
                                      ? { zip, lat: centroid.lat, lng: centroid.lng }
                                      : null
                                  }
                                />
                              )}
                            </CandidateBattlecard>
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
                    voteFor={contest.voteFor}
                    /* M134: same, keyed the way this branch keys reactions. */
                    options={pickOptionsFor(set, contest)}
                  />
                </>
              )}
            </section>
          );
        })}

      {/* Item 5: the collapsed source lines, cited once. Each marker above
          lands here; provenance stays one glance away. */}
      {sharedSources.length > 0 && (
        <section className="mt-5 border-t border-[var(--panel-border)] pt-3">
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
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted">
            {getGeneralLineup()?.note}
          </p>
        )}

      {/* Statewide measures (2b): the official short title, the plain-
          language summary labeled as such, and the Legislative Council's
          analysis VERBATIM — the official explainer, rendered rather than
          merely linked. Data in hand is never displayed as missing. */}
      {measureContests.length > 0 && (
        <section className="mt-7">
          <h2 className="t-structure text-paper-dim">Statewide measures</h2>
          {measureContests.map((contest) => {
            const analysis = analysisForContest(contest.id);
            const summary = summaryForContest(contest.id);
            return (
              <div
                key={contest.id}
                data-contest-id={contest.id}
                className="mt-3.5 rounded-[10px] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-5 shadow-[var(--shadow-panel)]"
              >
                <h3 className="text-[0.9375rem] font-semibold tracking-tight">
                  {contest.title}
                </h3>

                {summary && analysis?.text && (
                  <div className="mt-2.5 rounded-md bg-[var(--surface,rgba(255,255,255,0.04))] p-3">
                    <p className="t-eyebrow text-muted">
                      Plain-language summary — read the official text below
                    </p>
                    {/* 3b: the product's voice renders BOLD. */}
                    <p className="mt-1.5 text-[0.8125rem] font-semibold leading-relaxed">
                      {summary.summary}
                    </p>
                  </div>
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
                  state's own words. It is NOT collapsed — this is the
                  explanation the reader came for, and hiding it behind a click
                  would be the reader friction rule's own defect.
                */}
                {provisionsForContest(contest.id).length > 0 && (
                  <div className="mt-3.5">
                    <p className="t-eyebrow text-muted">
                      What&apos;s in it, part by part
                    </p>
                    <ul className="mt-1.5 space-y-2.5">
                      {provisionsForContest(contest.id).map((provision) => (
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
                  </div>
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
                    <p className="mt-1.5 max-h-72 overflow-y-auto whitespace-pre-line rounded-md border border-[var(--panel-border)] p-3 text-[0.75rem] leading-relaxed text-paper-dim">
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

                {/* F01 11.1 — the author's named instance: eleven Arizona
                    measures each carrying the identical "the Secretary of State
                    has not yet published the final ballot wording" paragraph.
                    Marker here, the note once at the page's foot. */}
                {contest.scopeNote &&
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
                      {contest.scopeNote}
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
        </section>
      )}

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
        `data/ballot/az-pima-2026.json` and never appeared in `app/` at all.
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
      {matched && coverageNotes.length > 0 && (
        <section className="mt-6 rounded-[10px] border border-dashed border-[var(--panel-border)] p-4">
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
          {matched.absences.map((absence) => (
            <section
              key={absence.ocdId}
              className="mt-5 rounded-[10px] border border-[var(--panel-border)] p-4"
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
              className="mt-6 border-t border-[var(--panel-border)] pt-4"
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

          <p className="mt-6 text-[0.75rem] leading-relaxed text-voice">
            {NEUTRAL_NOTE}
          </p>

          {/* RULING 42: the page-level disclosure, once, at the bottom. It
              renders inside this block because this block is what renders
              when contests render — a note about the cards on a page with no
              cards would be a claim about nothing. */}
          <p
            data-collection-note
            className="mt-3 text-[0.75rem] leading-relaxed text-voice"
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

      <p className="mt-8 border-t border-[var(--panel-border)] pt-4 text-[0.75rem]">
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
