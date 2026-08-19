import Link from "next/link";

import {
  COMPARISON_INTRO,
  NOT_WRITTEN_UP,
  compareStates,
  type ComparisonCell,
} from "@/lib/area/comparison";
import { COVERED } from "@/lib/coverage/artifacts";
import { PRODUCT_NAME, titleFor } from "@/lib/brand";

/**
 * **Two states, side by side** — tracker **D47**, the author's disposition
 * "Build pre H".
 *
 * The moving-here page carried only a one-line state picker; this is the
 * comparison that link always implied. Same questions down the left, one
 * column per state, every answer cited to that state's own agency.
 *
 * **Nothing here ranks.** No score, no total, no "better for families", no
 * ordering derived from the content — the column order is `?a=`/`?b=` as the
 * reader asked for it, and the row order is the left state's own authoring
 * order. `CLAUDE.md`'s no-composite-score rule arriving on a new surface: the
 * moment the product says one state is better, its neutrality claim is gone.
 *
 * The row's original reasoning — build only when demand appears in the
 * refusal and search logs — is superseded by the author's disposition and is
 * recorded on the tracker row rather than re-derived here.
 */

export const runtime = "nodejs";

export const metadata = {
  title: titleFor("Two states, side by side"),
};

function Cell({ cell }: { cell: ComparisonCell }) {
  if (!cell.fact) {
    // A named gap, in the gap's own register — outlined, never filled, and it
    // says whose gap it is. "This state has no rule about that" would be a
    // specific false claim about a government.
    return (
      <div className="rounded border border-dashed border-[var(--panel-border)] p-3 text-[0.75rem] leading-relaxed text-muted">
        {NOT_WRITTEN_UP}
      </div>
    );
  }
  const { answer, sourceOrg, sourceUrl, verification } = cell.fact;
  return (
    <div className="rounded border border-[var(--panel-border)] p-3">
      <p className="text-[0.8125rem] leading-relaxed text-paper">{answer}</p>
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-muted">
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-dotted underline-offset-2"
        >
          {sourceOrg}
        </a>
        {" — "}
        {verification}
      </p>
    </div>
  );
}

export default async function CompareStatesPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string; zip?: string }>;
}) {
  const { a, b, zip } = await searchParams;
  const comparison = a && b ? compareStates(a, b) : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 text-paper">
      <p className="text-[0.8125rem]">
        <Link
          href={
            zip
              ? `/about-area?zip=${zip}`
              : a
                ? `/about-area?state=${a.toUpperCase()}`
                : "/about-area"
          }
          className="text-muted underline decoration-dotted underline-offset-2 hover:text-signal"
        >
          ← Back
        </Link>
      </p>
      <p className="mt-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
        {PRODUCT_NAME}
      </p>
      <h1 className="mt-1 text-xl font-semibold">
        {comparison
          ? `${comparison.left.name} and ${comparison.right.name}, side by side`
          : "Two states, side by side"}
      </h1>
      <p className="mt-3 max-w-2xl text-[0.8125rem] leading-relaxed text-paper-dim">
        {COMPARISON_INTRO}
      </p>

      {!comparison && (
        <section className="mt-6">
          <h2 className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
            Pick two
          </h2>
          {/* The manifest's own onboarding order, never an order derived from
              the content — "most different first" would be a ranking wearing
              an ordering. */}
          <ul className="mt-3 space-y-2">
            {COVERED.flatMap((left) =>
              COVERED.filter((right) => right.usps !== left.usps).map((right) => (
                <li key={`${left.usps}-${right.usps}`}>
                  <Link
                    href={`/about-area/compare?a=${left.usps}&b=${right.usps}`}
                    className="text-[0.8125rem] underline decoration-dotted underline-offset-2 hover:text-signal"
                  >
                    {left.name} and {right.name}
                  </Link>
                </li>
              )),
            )}
          </ul>
        </section>
      )}

      {comparison && (
        <>
          <div className="mt-6 space-y-5">
            {comparison.rows.map((row) => (
              <section key={row.topic}>
                <h2 className="text-[0.9375rem] font-semibold">{row.question}</h2>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1.5 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
                      {comparison.left.name}
                    </p>
                    <Cell cell={row.left} />
                  </div>
                  <div>
                    <p className="mb-1.5 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
                      {comparison.right.name}
                    </p>
                    <Cell cell={row.right} />
                  </div>
                </div>
              </section>
            ))}
          </div>

          {/* The denominator, stated rather than implied. A comparison that
              aligned nothing would render as two empty columns and read as
              "these states are the same". */}
          <p className="mt-6 text-[0.75rem] leading-relaxed text-muted">
            {comparison.census.rows} questions, {comparison.census.bothAnswered}{" "}
            answered for both states.
            {comparison.census.onlyLeft + comparison.census.onlyRight > 0 &&
              ` ${comparison.census.onlyLeft + comparison.census.onlyRight} we have written up for only one of them so far.`}
          </p>
        </>
      )}

      <p className="mt-8 border-t border-[var(--panel-border)] pt-4 text-[0.75rem] leading-relaxed text-muted">
        Rules change. Every answer links the office that owns it — when in
        doubt, their page wins.{" "}
        <Link href="/transparency" className="underline decoration-dotted">
          How we handle data
        </Link>
      </p>
    </main>
  );
}
