import Link from "next/link";

import { contestsForDivisions } from "@/lib/sources/ballot-nj-morris";
import { BALLOT_SOURCES } from "@/lib/ballot/registry";
import { analysisForContest } from "@/lib/ballot/analyses";
import { summaryForContest } from "@/lib/ballot/measure-summaries";
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
import { CandidateCard } from "@/components/ballot/candidate-card";
import { MyPicks } from "@/components/ballot/my-picks";
import { jurisdictionKeyForContestId } from "@/lib/ballot/pick-jurisdiction";
import { PickControl } from "@/components/ballot/pick-control";
import { registrationLinkFor } from "@/lib/ballot/registration-links";
import { pollingPlaceLinkFor } from "@/lib/ballot/polling-place-links";
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
import { electionDatesFor } from "@/lib/ballot/election-dates";
import { AddToCalendar } from "@/components/calendar/add-to-calendar";
import type {
  BallotAbsence,
  BallotSet,
  Candidacy,
  Contest,
} from "@/lib/ballot/types";
import { resolveZip } from "@/lib/geo/zcta";
import { divisionsAt } from "@/lib/registry/server";
import { PRODUCT_NAME } from "@/lib/brand";

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

const NEUTRAL_NOTE =
  "Candidates are listed alphabetically by surname — the official ballot order either has not been drawn yet or was not machine-readable from the authority's publication. Party labels (and slogans where filed) are shown as filed. Nothing here is a recommendation.";

function candidatesOf(set: BallotSet, contest: Contest): Candidacy[] {
  return set.candidacies
    .filter((c) => c.contestId === contest.id)
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
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
  if (answer.kind === "absence") return <FundingAbsence data={answer.data} />;
  return <FundingDisplay data={answer.data} context={context} />;
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
    const ocdIds = divisions.map((d) => d.ocdId);
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
          FOOTNOTE_MARKERS[sharedSources.length] ??
          `${sharedSources.length + 1}`,
        cite,
      });
    }
  }
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
                  <li>
                    {earlyStep.label}:{" "}
                    <span className="font-mono text-[0.8125rem] font-semibold">
                      {/^\d{4}-\d{2}-\d{2}$/.test(earlyStep.date)
                        ? formatDateMDY(earlyStep.date)
                        : earlyStep.date
                            .split("–")
                            .map((d) => formatDateMDY(d.trim()))
                            .join(" – ")}
                    </span>
                  </li>
                )}
                {/* Item 6 (2026-08-15): "where do I vote" beside the dates
                    that decide whether you can. The state's own lookup, and
                    what it will ask for stated before the tap — a link that
                    demands a driver's licence number on arrival is friction
                    the reader could have been warned about. */}
                {polls && (
                  <li>
                    <a
                      href={polls.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    >
                      {polls.label} →
                    </a>{" "}
                    <span className="text-[0.75rem] text-muted">
                      on the {polls.sourceOrg}&apos;s site
                    </span>
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
          County NH. This is a gap in our data, not a statement that nothing
          is on your ballot.
        </p>
      )}

      {/* 2c: the registration checker, prominent — the first thing a voter
          needs to know is whether they can vote at all. */}
      {dates && set && (() => {
        const reg = registrationLinkFor(set.election.state);
        const polls = pollingPlaceLinkFor(set.election.state);
        return reg || polls ? (
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
            {/* Item 6: the second half of "can I vote, and where" — same
                block, same weight, the authority's own tool. */}
            {polls && (
              <p className={reg ? "mt-2 text-[0.9375rem]" : "text-[0.9375rem]"}>
                <a
                  href={polls.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  {polls.label} →
                </a>{" "}
                <span className="text-[0.75rem] text-muted">
                  on the {polls.sourceOrg}&apos;s site
                </span>
                <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-voice">
                  {polls.note}
                </span>
              </p>
            )}
          </div>
        ) : null;
      })()}

      {/* 4a: the private election-day list — renders only once something
          is marked. Device-local; the component says so itself. */}
      <MyPicks currentJurisdictionKey={currentJurisdictionKey} />

      {dates && (
        <section className="mt-6 rounded-[10px] border border-[var(--panel-border)] p-5">
          <h2 className="t-structure text-paper-dim">
            Dates that decide whether you can vote
          </h2>
          <ul className="mt-2.5 space-y-1.5">
            {dates.steps.map((step) => (
              <li key={step.label} className="flex items-baseline justify-between gap-3">
                <span className="text-[0.8125rem]">{step.label}</span>
                <span className="shrink-0 text-right">
                  <span className="font-mono text-[0.75rem] text-signal">
                    {formatDateMDY(step.date)}
                  </span>
                  {/* Item 4: every rendered future date is one tap from
                      the reader's calendar. Range and past dates render
                      without a link — an event you can no longer act on
                      isn't calendar material. */}
                  {/^\d{4}-\d{2}-\d{2}$/.test(step.date) &&
                    step.date >= new Date().toISOString().slice(0, 10) && (
                      <>
                        {" "}
                        <AddToCalendar
                          event={{
                            id: `ballot-${set?.election.state ?? "xx"}-${step.date}-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                            title: `${step.label} (${set?.election.state ?? ""})`,
                            allDayDate: step.date,
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
              {!sourceRef.shared && (
                <p className="mt-1 text-[0.6875rem] text-muted">
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
                </p>
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
                      />
                      <IncumbentRecord
                        targetKey={`${contest.id}|${nominee.name}`}
                        context={
                          centroid && zip
                            ? { zip, lat: centroid.lat, lng: centroid.lng }
                            : null
                        }
                      />
                      {/* 3d: reader expression, never a recommendation — the
                          answer is stored and aggregated, never rendered
                          back, and nothing orders candidates by it. */}
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
                    </li>
                  ))}
                </ul>
                {!isFederalContest(contest) && (
                  <StateFundingNote note={STATE_FUNDING_NOTE} />
                )}
                {/* 4a: the private pick — a different thing from the
                    reactions above, and it says so. */}
                <PickControl
                  contestId={contest.id}
                  contestTitle={contest.title}
                  voteFor={contest.voteFor}
                  options={lineup.nominees.map((n) => ({
                    id: n.name,
                    label: n.name,
                  }))}
                />
                </>
              ) : (
                <>
                  {contest.scopeNote && (
                    <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
                      {contest.scopeNote}
                    </p>
                  )}
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
                        />
                        <IncumbentRecord
                          targetKey={cand.id}
                          context={
                            centroid && zip
                              ? { zip, lat: centroid.lat, lng: centroid.lng }
                              : null
                          }
                        />
                        {/* 3d: reader expression, never a recommendation. */}
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
                      </li>
                    ))}
                  </ul>
                  {!isFederalContest(contest) && (
                    <StateFundingNote note={STATE_FUNDING_NOTE} />
                  )}
                  {/* 4a: the private pick — distinct from reactions. */}
                  <PickControl
                    contestId={contest.id}
                    contestTitle={contest.title}
                    voteFor={contest.voteFor}
                    options={candidatesOf(set, contest).map((cand) => ({
                      id: cand.id,
                      label: `${cand.givenName} ${surnameDisplayCase(cand.familyName)}`,
                    }))}
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

                {contest.scopeNote && (
                  <p className="mt-2 text-[0.75rem] leading-relaxed text-muted">
                    {contest.scopeNote}
                  </p>
                )}

                {/* 4a: the private pick on measures — Yes/No, this device
                    only, stated in the control. 6a: prominent here — the
                    ask whispered on the cards where it matters most. */}
                <PickControl
                  contestId={contest.id}
                  contestTitle={contest.title}
                  voteFor={1}
                  prominent
                  options={[
                    { id: "YES", label: "Yes" },
                    { id: "NO", label: "No" },
                  ]}
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

      {/* Our gaps, stated as ours — never smoothed into implied
          completeness. Distinct from the authorities' absence statements. */}
      {matched && coverageNotes.length > 0 && (
        <section className="mt-6 rounded-[10px] border border-dashed border-[var(--panel-border)] p-4">
          <h2 className="t-structure text-paper-dim">Not here yet</h2>
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

          <p className="mt-6 text-[0.75rem] leading-relaxed text-voice">
            {NEUTRAL_NOTE}
          </p>
        </>
      )}

      {/* 3e (2026-08-19): the picks disclosure, stated ONCE — the TOS
          pattern. It carried the same sentence under every contest before;
          the distinction from the reaction buttons lives here now.

          g3 item 7 (2026-08-16): the label this sentence QUOTES changed with
          the control, so the quote changed with it. A disclosure quoting
          wording that is no longer on the page points the reader at
          nothing. */}
      {matched && matched.contests.length > 0 && (
        <p className="mt-6 text-[0.6875rem] leading-relaxed text-voice">
          &ldquo;Your pick&rdquo; boxes are saved on this device only — we
          never see them. The Yes/No/Unsure reaction buttons are different:
          those answers join anonymous local totals.{" "}
          <Link
            href="/transparency"
            className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            How we handle data →
          </Link>
        </p>
      )}

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
