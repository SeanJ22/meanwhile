import Link from "next/link";

import { areaFactsForState } from "@/lib/area/facts";
import { resolveZip } from "@/lib/geo/zcta";
import { divisionsAt } from "@/lib/registry/server";

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
  title: "The basics of living here — We the People",
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
        We the People
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

      {facts &&
        facts.facts.map((fact) => (
          <section
            key={fact.topic}
            className="mt-4 rounded border border-[var(--panel-border)] p-4"
          >
            <h2 className="text-[0.875rem] font-semibold">{fact.question}</h2>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
              {fact.answer}
            </p>
            <p className="mt-2 text-[0.6875rem]">
              <a
                href={fact.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted"
              >
                {fact.sourceOrg}
              </a>
            </p>
          </section>
        ))}

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
          {(["AZ", "NJ", "NH"] as const)
            .filter((s) => s !== state)
            .map((s, i) => (
              <span key={s}>
                {i > 0 && <span className="text-muted"> · </span>}
                <Link
                  href={`/about-area?state=${s}`}
                  className="underline decoration-dotted hover:text-signal"
                >
                  {s === "AZ"
                    ? "Arizona"
                    : s === "NJ"
                      ? "New Jersey"
                      : "New Hampshire"}
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
