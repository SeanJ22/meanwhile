import Link from "next/link";

import {
  COMPARISON_INTRO,
  NOT_WRITTEN_UP,
  compareStates,
  type ComparisonCell,
} from "@/lib/area/comparison";
import { COVERED } from "@/lib/coverage/artifacts";
import { Logo } from "@/components/brand/logo";
import { titleFor } from "@/lib/brand";

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

/**
 * One pill per selected state, each removing itself; the rest offered to add.
 *
 * `?a=` and `?b=` are the whole state of this page, so every pill is a plain
 * `Link` and there is nothing to keep in sync — a client component holding a
 * mirrored copy of the selection is how two surfaces come to disagree about
 * what is selected.
 */
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
  const unchosen = COVERED.filter((s) => !chosen.includes(s.usps));

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {chosen.map((usps) => {
        const state = COVERED.find((s) => s.usps === usps);
        return (
          <Link
            key={usps}
            href={keep(usps)}
            data-state-pill
            data-pearl
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
            data-pearl
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
    <main className="mx-auto max-w-4xl px-4 py-8 text-paper">
      {/*
        **AZ-2 (item 5, 2026-08-23, the author's ruling) — Back goes to the
        MAP.**

        It went to `/about-area?state=AZ` — one state, alone, which is neither
        where the reader came from nor where they were trying to get to. The
        author: *Back returns to Arizona alone when the expected destination is
        the map.* The map is the product's home surface and the only
        destination that is right from every path into this page.

        Changing which comparison is on screen is the PILLS' job now, not
        Back's — see the row below. Two controls that both change what is being
        compared, one of them by navigating away, is the friction that made the
        destination feel wrong in the first place.
      */}
      <p className="text-[0.8125rem]">
        <Link
          href={zip ? `/?zip=${zip}` : "/"}
          className="text-muted underline decoration-dotted underline-offset-2 hover:text-signal"
        >
          ← Back to the map
        </Link>
      </p>
      {/* ITEM J (2026-09-01): the page eyebrow was the product name typed as
          display text in a 10px uppercase MONO treatment — the register this
          system reserves for numerals and identifiers, worn by the one string
          that is neither. It is the lockup now, at the 18px wordmark floor. */}
      <div className="mt-3">
        {/* BAL-40 (2026-09-02): logo-first hierarchy — the wordmark leads the
            page-title headline below it. */}
        <Logo variant="wordmark" size={30} />
      </div>
      <h1 className="mt-1 text-xl font-semibold">
        {comparison
          ? `${comparison.left.name} and ${comparison.right.name}, side by side`
          : "Two states, side by side"}
      </h1>

      {/*
        **AZ-2 — the selected states are PILLS in the title bar, and
        deselecting one drops it from the comparison.**

        The author's instruction, and the reason it beats a reset link: a
        comparison holding one pair at a time is right, but the reader had no
        way to say *keep Arizona, swap the other one* except by going back and
        starting over. A pill that removes its own state leaves the other one
        selected and the picker open beneath it, which is the gesture the
        product already teaches everywhere else.

        Playful register — this is an interaction surface, not a claim
        surface. Nothing here orders the states by anything but the manifest's
        own onboarding order (`COVERED`), because an ordering derived from the
        content would be a ranking wearing an ordering.
      */}
      <StatePills a={a} b={b} zip={zip} />
      <p className="mt-3 max-w-2xl text-[0.8125rem] leading-relaxed text-paper-dim">
        {COMPARISON_INTRO}
      </p>

      {!comparison && (
        <section className="mt-6">
          <h2 className="font-mono text-[0.625rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-muted">
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
