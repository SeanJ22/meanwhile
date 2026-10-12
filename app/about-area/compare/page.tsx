import Link from "next/link";

import {
  COMPARISON_INTRO,
  NOT_WRITTEN_UP,
  compareStates,
  type ComparisonCell,
} from "@/lib/area/comparison";
import { AREA_FACTS } from "@/lib/area/facts";
const FACT_STATES = AREA_FACTS.map(row => ({ usps: row.state, name: row.stateName, slug: row.state.toLowerCase() }));
import { Logo } from "@/components/brand/logo";
import { titleFor } from "@/lib/brand";

/** Nothing here ranks: column order is `?a=`/`?b=` as asked, and row order is the left state's own authoring order. */

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

/** `?a=` and `?b=` are the whole state of this page, so every pill is a plain `Link` with nothing to keep in sync. */
function StatePills({
  a,
  b,
  zip,
}: {
  a: string | undefined;
  b: string | undefined;
  zip: string | undefined;
}) {
  const chosen = [a, b].filter((x): x is string => Boolean(x)).map((x) => x.toUpperCase());
  const keep = (usps: string) => {
    const rest = chosen.filter((c) => c !== usps);
    const params = new URLSearchParams();
    if (rest[0]) params.set("a", rest[0]);
    if (rest[1]) params.set("b", rest[1]);
    if (zip) params.set("zip", zip);
    const q = params.toString();
    return q ? `/about-area/compare?${q}` : "/about-area/compare";
  };
  const add = (usps: string) => {
    const next = [...chosen, usps];
    const params = new URLSearchParams();
    if (next[0]) params.set("a", next[0]);
    if (next[1]) params.set("b", next[1]);
    if (zip) params.set("zip", zip);
    return `/about-area/compare?${params.toString()}`;
  };
  const unchosen = FACT_STATES.filter((s) => !chosen.includes(s.usps));

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {chosen.map((usps) => {
        const state = FACT_STATES.find((s) => s.usps === usps);
        return (
          <Link
            key={usps}
            href={keep(usps)}
            data-state-pill
            data-selected="true"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--link)] bg-[color-mix(in_srgb,var(--link)_10%,transparent)] px-3 py-1 text-[0.75rem] text-paper hover:bg-[color-mix(in_srgb,var(--link)_18%,transparent)]"
          >
            {state?.name ?? usps}
            <span aria-hidden="true">×</span>
            <span className="sr-only">Remove from the comparison</span>
          </Link>
        );
      })}
      {chosen.length < 2 &&
        unchosen.map((state) => (
          <Link
            key={state.usps}
            href={add(state.usps)}
            data-state-pill
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--panel-border)] px-3 py-1 text-[0.75rem] text-muted hover:text-paper"
          >
            <span aria-hidden="true">+</span>
            {state.name}
          </Link>
        ))}
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
    <main className="mw-page mx-auto max-w-4xl px-4 py-8 text-paper">
      <p className="text-[0.8125rem]">
        <Link
          href={zip ? `/?zip=${zip}` : "/"}
          className="mw-back-pill"
        >
          ← Back to the map
        </Link>
      </p>
      <div className="mt-3">
        <Logo variant="wordmark" size={30} />
      </div>
      <h1 className="mt-1 text-xl font-semibold">
        {comparison
          ? `${comparison.left.name} and ${comparison.right.name}, side by side`
          : "Two states, side by side"}
      </h1>

      <StatePills a={a} b={b} zip={zip} />
      <p className="mt-3 max-w-2xl text-[0.8125rem] leading-relaxed text-paper-dim">
        {COMPARISON_INTRO}
      </p>

      {!comparison && (
        <section className="mt-6">
          <h2 className="font-mono text-[0.625rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-muted">
            Pick two
          </h2>
          <ul className="mt-3 space-y-2">
            {FACT_STATES.flatMap((left) =>
              FACT_STATES.filter((right) => right.usps !== left.usps).map((right) => (
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
                    <p className="mb-1.5 font-mono text-[0.625rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-muted">
                      {comparison.left.name}
                    </p>
                    <Cell cell={row.left} />
                  </div>
                  <div>
                    <p className="mb-1.5 font-mono text-[0.625rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-muted">
                      {comparison.right.name}
                    </p>
                    <Cell cell={row.right} />
                  </div>
                </div>
              </section>
            ))}
          </div>

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
