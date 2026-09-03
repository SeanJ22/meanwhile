import { ShuffledFacts } from "@/components/area/shuffled-facts";
import Link from "next/link";

import { areaFactsForState } from "@/lib/area/facts";
import { COVERED } from "@/lib/coverage/artifacts";
import { resolveZip } from "@/lib/geo/zcta";
import { divisionsAt } from "@/lib/registry/server";
import { Logo } from "@/components/brand/logo";
import { titleFor } from "@/lib/brand";

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
        The basics of living here
        {facts ? ` — ${facts.stateName}` : ""}
      </h1>
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-paper-dim">
        The questions people ask before moving, answered from official
        sources — the state agency or statute is linked on every answer.
        We state the rules; what to make of them is yours.
      </p>

      {/* RULING 59 (2026-08-21): the coverage note is deleted here too. See
          the headstone on app/ballot/page.tsx for why. */}

      {/* RULING 59 (2026-08-21): "Coverage today: New Jersey, New Hampshire,
          and Arizona" rendered here for a zip we have no facts page for. It is
          the banned form twice over — it enumerates coverage, and it
          characterises what has not been worked out — and it is the exact
          maintenance trap the ruling names: the day a fourth state lands, that
          sentence is false on a page nobody thought to edit, and no test can
          see it. Nothing replaces it. A page with nothing to say says
          nothing, which is RULING 28's principle for a field applied to a
          section; it asserts no absence and makes no claim about the place. */}

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

      {/* RULING 59 (2026-08-21): a section headed "Not covered yet",
          enumerating to the reader what had not been worked out. Deleted with
          its data field — every state's list was empty, so it rendered for
          nobody and waited to be filled in. A banned form that never fired is
          still a banned form, and leaving the field behind is an invitation
          to render it again. What it was for lives in docs/gap-ledger.md. */}

      {/* 6d (2026-08-14) shipped one line, the state picker, and deferred
          the side-by-side to D47. D47 is built (g21, 2026-08-19), so the
          picker's links now go to the comparison rather than to the other
          state's own page — the reader asked how it COMPARES, and sending
          them somewhere they have to hold two pages in their head was the
          friction the row existed to remove. */}
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
                href={`/about-area/compare?a=${state}&b=${s.usps}${
                  zip ? `&zip=${zip}` : ""
                }`}
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
