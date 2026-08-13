import Link from "next/link";

import {
  ballotNjMorrisSource,
  contestsForDivisions,
} from "@/lib/sources/ballot-nj-morris";
import { electionDatesFor } from "@/lib/ballot/election-dates";
import type { BallotSet, Candidacy, Contest } from "@/lib/ballot/types";
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
  "Candidates are listed alphabetically by surname — the county's drawn ballot order was not machine-readable from the clerk's scanned drawing. Party labels and slogans are shown as filed. Nothing here is a recommendation.";

function candidatesOf(set: BallotSet, contest: Contest): Candidacy[] {
  return set.candidacies
    .filter((c) => c.contestId === contest.id)
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
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

  let set: BallotSet | null = null;
  let matched: ReturnType<typeof contestsForDivisions> | null = null;

  if (centroid) {
    const raw = await ballotNjMorrisSource.fetch();
    set = ballotNjMorrisSource.normalize(raw);
    const divisions = await divisionsAt(centroid.lat, centroid.lng);
    matched = contestsForDivisions(
      set,
      divisions.map((d) => d.ocdId),
    );
  }

  const dates = matched && matched.contests.length > 0 ? electionDatesFor("NJ") : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 text-paper">
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
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

      {matched && matched.contests.length === 0 && (
        <p className="mt-6 text-[0.8125rem] leading-relaxed text-muted">
          We haven&apos;t built the ballot for this area yet. Ballot coverage
          currently reaches Morris County, New Jersey (07866); Arizona and New
          Hampshire are next. This is a gap in our data, not a statement that
          nothing is on your ballot.
        </p>
      )}

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
                  {step.date}
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
            , read {dates.collectedAt}.
          </p>
        </section>
      )}

      {set &&
        matched &&
        matched.contests.map((contest) => (
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
            {contest.scopeNote && (
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
                {contest.scopeNote}
              </p>
            )}
            <ul className="mt-3 space-y-2">
              {candidatesOf(set, contest).map((cand) => (
                <li
                  key={cand.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-[var(--panel-border)] pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-[0.875rem]">
                    {cand.givenName} {cand.familyName}
                    {cand.websiteUrl && (
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
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[0.6875rem] text-muted">
              <a
                href={contest.provenance.sourceUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted"
              >
                {contest.provenance.sourceOrg} filing
              </a>{" "}
              · read {contest.provenance.collectedAt}
            </p>
          </section>
        ))}

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
                · read {absence.provenance.collectedAt}
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
