import { readerRoute } from "@/lib/api/reader-route";
import { ShuffledFacts } from "@/components/area/shuffled-facts";
import Link from "next/link";

import { areaFactsForState } from "@/lib/area/facts";
import { AREA_FACTS } from "@/lib/area/facts";
const FACT_STATES = AREA_FACTS.map(row => ({ usps: row.state, name: row.stateName, slug: row.state.toLowerCase() }));
import { resolveZip } from "@/lib/geo/zcta";
import { divisionsAt } from "@/lib/registry/server";
import { Logo } from "@/components/brand/logo";
import { titleFor } from "@/lib/brand";
import { stateOfficesForStates } from "@/lib/reference/state-offices";
import { StateOfficeContacts } from "@/components/state-office-contacts";
import { ocdStateCode } from "@/lib/ocd/state-of";

export const runtime = "nodejs";

export const metadata = {
  title: titleFor("The basics of living here"),
};

export default readerRoute("/about-area", async function AboutAreaPage({
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
        .map((d) => ocdStateCode(d.ocdId))
        .find(Boolean);
      state = match ? match.toUpperCase() : null;
    }
  }

  const facts = state ? areaFactsForState(state) : null;

  return (
    <main className="mw-page mx-auto max-w-2xl px-4 py-8 text-paper">
      <p className="text-[0.8125rem]">
        <Link
          href={zip ? `/ballot?zip=${zip}` : "/"}
          className="mw-back-pill"
        >
          ← Back
        </Link>
      </p>
      <div className="mt-3">
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

      {/* The card markup lives inside ShuffledFacts: a render prop would be a function crossing the server/client boundary. */}
      {facts && <ShuffledFacts facts={facts.facts} />}
      <StateOfficeContacts offices={state ? stateOfficesForStates([state]) : []} />

      {facts && (
        <p className="mt-6 text-[0.8125rem] leading-relaxed text-paper-dim">
          Curious how another state compares?{" "}
          {FACT_STATES.filter((s) => s.usps !== state).map((s, i) => (
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
});
