import { ShuffledFacts } from "@/components/area/shuffled-facts";
import Link from "next/link";

import { areaFactsForState } from "@/lib/area/facts";
import { COVERED } from "@/lib/coverage/artifacts";
import { resolveZip } from "@/lib/geo/zcta";
import { divisionsAt } from "@/lib/registry/server";
import { PRODUCT_NAME, titleFor } from "@/lib/brand";

/**
 * "About this area" v1 (7, 2026-08-17) — built for the mover: the questions
 * people ask before moving to a state, answered before asked, every answer
 * cited to the official source. The register is the same as everywhere:
 * plain sentences, facts, no characterization — the reader judges, we cite.
 *
 * Title/flow decision (recorded for the author to react to): reached from
 * the ballot page and who-governs as "Moving here? The basics"; the page
 * titles itself "The basics of living here". Per state; the zip picks the
 * state.
 */

export const runtime = "nodejs";

export const metadata = {
  title: titleFor("The basics of living here"),
};

export default async function AboutAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ zip?: string; state?: string }>;
}) {
  const { zip: zipParam, state: stateParam } = await searchParams;
  const zip = zipParam && /^\d{5}$/.test(zipParam) ? zipParam : null;

  let state: string | null = stateParam?.toUpperCase() ?? null;
  if (!state && zip) {
    const resolution = resolveZip(zip);
    if (resolution.ok) {
      const divisions = await divisionsAt(
        resolution.centroid.lat,
        resolution.centroid.lng,
      );
      const match = divisions
        .map((d) => d.ocdId.match(/state:([a-z]{2})/)?.[1])
        .find(Boolean);
      state = match ? match.toUpperCase() : null;
    }
  }

  const facts = state ? areaFactsForState(state) : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 text-paper">
      <p className="text-[0.8125rem]">
        <Link
          href={zip ? `/ballot?zip=${zip}` : "/"}
          className="text-muted underline decoration-dotted underline-offset-2 hover:text-signal"
        >
          ← Back
        </Link>
      </p>
      <p className="mt-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
        {PRODUCT_NAME}
      </p>
      <h1 className="mt-1 text-xl font-semibold">
        The basics of living here
        {facts ? ` — ${facts.stateName}` : ""}
      </h1>
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-paper-dim">
        The questions people ask before moving, answered from official
        sources — the state agency or statute is linked on every answer.
        We state the rules; what to make of them is yours.
      </p>

      {!facts && (
        <p className="mt-6 text-[0.8125rem] leading-relaxed text-muted">
          We haven&apos;t written this up for this area yet. Coverage today:
          New Jersey, New Hampshire, and Arizona. This is a gap in our
          pages, not a statement about the place.
        </p>
      )}

      {/* 6g (2026-08-15): the order is shuffled per open. The authoring order
          put marijuana first in all three states, and a page that always
          leads on the same charged question reads as an editorial choice on a
          product that does not make them. Content unchanged; only which
          honest answer a reader sees first moves. */}
      {/* The card markup lives INSIDE ShuffledFacts. It used to be passed in
          as a render prop, which is a function crossing the server/client
          boundary — React refuses that, and the refusal was a 500 at every
          zip. See the component's own note. */}
      {facts && <ShuffledFacts facts={facts.facts} />}

      {facts && facts.notCovered.length > 0 && (
        <section className="mt-6 rounded border border-dashed border-[var(--panel-border)] p-4">
          <h2 className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
            Not covered yet
          </h2>
          <p className="mt-2 text-[0.75rem] leading-relaxed text-paper-dim">
            {facts.notCovered.join(" · ")}
          </p>
        </section>
      )}

      {/* 6d (2026-08-14 second session): one line, the state picker. The
          full side-by-side comparison is deliberately NOT built — tracker
          row for later. */}
      {facts && (
        <p className="mt-6 text-[0.8125rem] leading-relaxed text-paper-dim">
          Curious how another state compares?{" "}
          {/* AUD-06 (g18): the list and the names both come from the coverage
              manifest. It was a hardcoded triple whose label was a ternary
              chain ending in a bare `: "New Hampshire"` — so a fourth state
              would have rendered under New Hampshire's name. A render default
              manufacturing a false claim about a place, one onboarding away. */}
          {COVERED.filter((s) => s.usps !== state).map((s, i) => (
            <span key={s.usps}>
              {i > 0 && <span className="text-muted"> · </span>}
              <Link
                href={`/about-area?state=${s.usps}`}
                className="underline decoration-dotted hover:text-signal"
              >
                {s.name}
              </Link>
            </span>
          ))}
        </p>
      )}

      <p className="mt-8 border-t border-[var(--panel-border)] pt-4 text-[0.75rem] text-muted">
        Rules change. Every answer links the office that owns it — when in
        doubt, their page wins.{" "}
        <Link href="/transparency" className="underline decoration-dotted">
          How we handle data
        </Link>
      </p>
    </main>
  );
}
