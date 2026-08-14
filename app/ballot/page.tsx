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
  type CandidateLinks,
} from "@/lib/ballot/candidate-sites";
import { registrationLinkFor } from "@/lib/ballot/registration-links";
import { formatDateMDY } from "@/lib/map/format";
import { ReactionControl } from "@/components/reactions/reaction-control";
import { electionDatesFor } from "@/lib/ballot/election-dates";
import type {
  BallotAbsence,
  BallotSet,
  Candidacy,
  Contest,
} from "@/lib/ballot/types";
import { resolveZip } from "@/lib/geo/zcta";
import { divisionsAt } from "@/lib/registry/server";

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

/**
 * The hunted-and-verified links for a candidate (2b): official page first,
 * campaign site second, both labeled. Rendered only where the hunt verified
 * them — an absent link means the hunt is recorded in the data file, never
 * that a URL was guessed.
 */
function CandidateLinkRow({ links }: { links: CandidateLinks | null }) {
  if (!links || (!links.official && !links.campaign)) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-2 text-[0.75rem]">
      {links.official && (
        <a
          href={links.official.url}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted"
        >
          official site
        </a>
      )}
      {links.campaign && (
        <a
          href={links.campaign.url}
          target="_blank"
          rel="noreferrer"
          className="text-muted underline decoration-dotted"
        >
          campaign site
        </a>
      )}
    </span>
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

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 text-paper">
      {/* 6b: the way back, top-left — the map is where the reader came from. */}
      <p className="text-[0.8125rem]">
        <Link
          href="/"
          className="text-muted underline decoration-dotted underline-offset-2 hover:text-signal"
        >
          ← Back to the map
        </Link>
      </p>
      <p className="mt-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
        We the People
      </p>
      <h1 className="mt-1 text-xl font-semibold">
        What&apos;s on the ballot{zip ? ` near ${zip}` : ""}
      </h1>

      <p className="mt-3 text-[0.8125rem] leading-relaxed text-paper-dim">
        A zip code is orientation, not your exact ballot — zip areas cross
        town and district lines. Everything below is presented as filed with
        election authorities, with the filing linked on every item.{" "}
        <span className="text-muted">
          We never suggest how to vote.
        </span>
      </p>

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
        return reg ? (
          <p className="mt-6 rounded border border-[var(--panel-border)] bg-[var(--surface,rgba(255,255,255,0.04))] p-3 text-[0.875rem]">
            <a
              href={reg.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline decoration-dotted"
            >
              {reg.label} →
            </a>{" "}
            <span className="text-[0.75rem] text-muted">
              on the {reg.sourceOrg}&apos;s site
            </span>
          </p>
        ) : null;
      })()}

      {dates && (
        <section className="mt-6 rounded border border-[var(--panel-border)] p-4">
          <h2 className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
            Dates that decide whether you can vote
          </h2>
          <ul className="mt-2 space-y-1.5">
            {dates.steps.map((step) => (
              <li key={step.label} className="flex items-baseline justify-between gap-3">
                <span className="text-[0.8125rem]">{step.label}</span>
                <span className="shrink-0 font-mono text-[0.75rem] text-signal">
                  {formatDateMDY(step.date)}
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
          return (
            <section
              key={contest.id}
              className="mt-5 rounded border border-[var(--panel-border)] p-4"
            >
              <h2 className="text-[0.9375rem] font-semibold">{contest.title}</h2>
              <p className="mt-0.5 font-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted">
                Vote for {contest.voteFor}
                {contest.termYears
                  ? ` · ${contest.termYears}-year term`
                  : ""}
              </p>

              {/* 6c: the record behind this contest, at the top of the card
                  — never buried at the page bottom. */}
              <p className="mt-1 text-[0.6875rem] text-muted">
                {lineup && canvass ? (
                  <>
                    Nominees per the{" "}
                    <a
                      href={canvass.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-dotted"
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
                      className="underline decoration-dotted"
                    >
                      {contest.provenance.sourceOrg} filing
                    </a>{" "}
                    · read {formatDateMDY(contest.provenance.collectedAt)}
                  </>
                )}
              </p>

              {/* The certified lineup retires the filing-list fallback (6a):
                  what a November voter actually chooses among. */}
              {lineup ? (
                <ul className="mt-3 space-y-2">
                  {lineup.nominees.map((nominee) => (
                    <li
                      key={nominee.name}
                      className="border-b border-[var(--panel-border)] pb-2 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-[0.875rem]">
                          {nominee.name}{" "}
                          <CandidateLinkRow
                            links={linksForNominee(contest.id, nominee.name)}
                          />
                        </span>
                        <span className="text-right text-[0.75rem] text-muted">
                          {nominee.partyLabel}
                          {nominee.note && <> · {nominee.note}</>}
                        </span>
                      </div>
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
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  {contest.scopeNote && (
                    <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
                      {contest.scopeNote}
                    </p>
                  )}
                  <ul className="mt-3 space-y-2">
                    {candidatesOf(set, contest).map((cand) => (
                      <li
                        key={cand.id}
                        className="border-b border-[var(--panel-border)] pb-2 last:border-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="text-[0.875rem]">
                            {cand.givenName} {cand.familyName}{" "}
                            <CandidateLinkRow links={linksForCandidacy(cand.id)} />
                            {cand.websiteUrl && !linksForCandidacy(cand.id) && (
                              <>
                                {" "}
                                <a
                                  href={cand.websiteUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[0.75rem] underline decoration-dotted"
                                >
                                  site
                                </a>
                              </>
                            )}
                          </span>
                          <span className="text-right text-[0.75rem] text-muted">
                            {cand.partyLabel ?? "No party label filed"}
                            {cand.slogan && (
                              <>
                                {" "}
                                · <span className="italic">&ldquo;{cand.slogan}&rdquo;</span>
                              </>
                            )}
                          </span>
                        </div>
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
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          );
        })}

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
        <section className="mt-6">
          <h2 className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
            Statewide measures
          </h2>
          {measureContests.map((contest) => {
            const analysis = analysisForContest(contest.id);
            const summary = summaryForContest(contest.id);
            return (
              <div
                key={contest.id}
                className="mt-3 rounded border border-[var(--panel-border)] p-4"
              >
                <h3 className="text-[0.875rem] font-semibold">{contest.title}</h3>

                {summary && analysis?.text && (
                  <div className="mt-2.5 rounded bg-[var(--surface,rgba(255,255,255,0.04))] p-3">
                    <p className="font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted">
                      Plain-language summary — read the official text below
                    </p>
                    <p className="mt-1.5 text-[0.8125rem] leading-relaxed">
                      {summary.summary}
                    </p>
                  </div>
                )}

                {analysis?.text ? (
                  <div className="mt-2.5">
                    <p className="font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted">
                      Official analysis — {analysis.sourceOrg}
                    </p>
                    {/* Verbatim, whole, and scrollable — never excerpted. */}
                    <p className="mt-1.5 max-h-72 overflow-y-auto whitespace-pre-line rounded border border-[var(--panel-border)] p-3 text-[0.75rem] leading-relaxed text-paper-dim">
                      {analysis.text}
                    </p>
                  </div>
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
        <section className="mt-6 rounded border border-dashed border-[var(--panel-border)] p-4">
          <h2 className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
            Not here yet
          </h2>
          {coverageNotes.map((note) => (
            <p
              key={note}
              className="mt-2 text-[0.75rem] leading-relaxed text-paper-dim"
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
              className="mt-5 rounded border border-[var(--panel-border)] p-4"
            >
              <p className="text-[0.8125rem] leading-relaxed text-paper-dim">
                {absence.statement}
              </p>
              <p className="mt-2 text-[0.6875rem] text-muted">
                <a
                  href={absence.provenance.sourceUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted"
                >
                  {absence.provenance.sourceOrg}
                </a>{" "}
                · read {formatDateMDY(absence.provenance.collectedAt)}
              </p>
            </section>
          ))}

          <p className="mt-6 text-[0.75rem] leading-relaxed text-muted">
            {NEUTRAL_NOTE}
          </p>
        </>
      )}

      <p className="mt-8 border-t border-[var(--panel-border)] pt-4 text-[0.75rem] text-muted">
        <Link href="/" className="underline decoration-dotted">
          Back to the map
        </Link>{" "}
        ·{" "}
        <Link href="/transparency" className="underline decoration-dotted">
          How we handle data
        </Link>
      </p>
    </main>
  );
}
