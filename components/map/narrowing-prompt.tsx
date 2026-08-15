"use client";

import { useEffect, useMemo, useState } from "react";

import { useNarrowing } from "@/hooks/use-narrowing";
import { locateStreetInZip, type StreetPoint } from "@/lib/geo/census-geocoder";

/**
 * The reader disambiguation affordance — M26/4.6.3c, rebuilt as a PASSIVE
 * CHIP (design pass item 6, 2026-08-15, the author's brief).
 *
 * What it replaced, and why: the modal form asked the approved question
 * over a blurred map and demanded a response before anything else could
 * happen. Keyed per zip, that meant free panning across a ZCTA line
 * remounted it and popped the modal again — the reader was interrupted
 * constantly for a question they had already ignored.
 *
 * THE INTERACTION RULE (recorded beside the old trigger rule it
 * supersedes): the narrowing affordance is a quiet chip inside the
 * who-governs card — "Narrow to this area?" — that never overlays the
 * map, never blocks panning, and is never modal. It expands IN PLACE
 * only on tap; collapsing it costs one tap and decides nothing. It does
 * not re-open itself: within a session it only reappears when the
 * resolved area (the zip this component is keyed on) changes — a
 * meaningful viewport change — and even then only as the same quiet
 * chip. The approved wording (docs/state.md §9) is unchanged and lives
 * in the expanded state:
 *
 *   "<zip> covers <N> municipalities and <M> school districts. Do you
 *    want to narrow it?"  →
 *   "What's the street you live on? That will help us narrow it for you
 *    — no house or apartment number needed."
 *
 * The optionality is friction-rule exception (2) and is stronger here
 * than in the modal form: ignoring the chip is now the zero-tap default,
 * and "No thanks, show me everything" (one tap, device-recorded, never
 * asked again for the zip) remains inside the expanded state. Everything
 * stays on the device — see hooks/use-narrowing.ts.
 */

interface StreetIndex {
  zip: string;
  municipalities: { ocdId: string; label: string }[];
  schoolDistricts: { ocdId: string; label: string }[];
  streets: Record<string, { m: number[]; s: number[] }>;
}

function countPhrase(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function NarrowingPrompt({
  zip,
  onNarrowed,
  onApplied,
  onPoint,
}: {
  zip: string;
  /** Present so the parent re-reads the store; the hook notifies anyway. */
  onNarrowed?: () => void;
  /** Item 7: fires ONLY when a narrowing is applied (street match or
   *  municipality pick) — the map answers with its boundary shading.
   *  Declining and undoing never fire it. */
  onApplied?: () => void;
  /**
   * D53 (2026-08-15): the street resolved to a POINT, so the map can
   * re-centre and the meetings, officials and counters can answer for that
   * point rather than for the whole ZCTA. Fires only on success, always
   * after the narrowing has already applied — the shading never waits on a
   * network call, and a lookup that fails changes nothing the reader can
   * see. Nothing here is stored or transmitted to us; see
   * lib/geo/census-geocoder.ts.
   */
  onPoint?: (point: StreetPoint) => void;
}) {
  const [index, setIndex] = useState<StreetIndex | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [streetInput, setStreetInput] = useState("");
  const [locating, setLocating] = useState(false);
  const narrowing = useNarrowing(zip);

  // Per-zip state resets by remount: the parent keys this component on the
  // zip, so a new zip is a fresh instance rather than a synchronous reset.
  useEffect(() => {
    if (!/^\d{5}$/.test(zip)) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/streets/${zip}.json`, {
          signal: controller.signal,
        });
        // 404 is the computed trigger saying "no chip here".
        if (!response.ok) return;
        setIndex((await response.json()) as StreetIndex);
      } catch {
        // No index, no chip — never an error state for the reader.
      }
    })();
    return () => controller.abort();
  }, [zip]);

  const streetMatches = useMemo(() => {
    if (!index || streetInput.trim().length < 3) return null;
    const needle = streetInput.trim().toUpperCase();
    const names = Object.keys(index.streets).filter((name) =>
      name.includes(needle),
    );
    return names.slice(0, 8);
  }, [index, streetInput]);

  if (!index) return null;

  const hasSelection = narrowing.divisions.length > 0;

  // A made choice renders as its result plus the way back — the chip
  // itself is done. This line lives in the who-governs card.
  if (hasSelection) {
    const chosen = [...index.municipalities, ...index.schoolDistricts].filter(
      (d) => narrowing.divisions.includes(d.ocdId),
    );
    return (
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-voice">
        Narrowed to {chosen.map((c) => c.label).join(", ")} — stored only on
        this device.
        {locating ? " Finding the street on the map…" : ""}{" "}
        <button
          type="button"
          className="cursor-pointer text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
          onClick={() => {
            narrowing.clear();
            onNarrowed?.();
          }}
        >
          undo
        </button>
      </p>
    );
  }

  if (narrowing.declined) return null;

  const applyStreet = (name: string) => {
    const street = index.streets[name];
    if (!street) return;
    const ocdIds = [
      ...street.m.map((i) => index.municipalities[i].ocdId),
      ...street.s.map((i) => index.schoolDistricts[i].ocdId),
    ];
    // The narrowing applies FIRST and completely. Everything below is extra
    // precision that may or may not arrive; nothing the reader can see is
    // waiting on it (D53).
    narrowing.setStreet(name);
    narrowing.setDivisions(ocdIds);
    onNarrowed?.();
    onApplied?.();

    if (!onPoint) return;
    setLocating(true);
    void locateStreetInZip(name, zip)
      .then((point) => {
        if (point) onPoint(point);
      })
      .finally(() => setLocating(false));
  };

  // The chip: quiet, in the card's flow, decides nothing.
  if (!expanded) {
    return (
      <p className="mt-2.5">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--panel-border)] bg-[var(--surface,rgba(255,255,255,0.04))] px-3 py-1.5 text-[0.75rem] text-paper-dim transition-colors hover:border-[var(--signal)]/60 hover:text-paper"
        >
          Narrow to this area?
          <span aria-hidden="true" className="text-muted">
            ›
          </span>
        </button>
      </p>
    );
  }

  // The expanded state, in place — never an overlay.
  return (
    <div className="mt-2.5 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3">
      <div className="flex items-start justify-between gap-2">
        {/* The approved wording, counts computed. */}
        <p className="text-[0.8125rem] leading-relaxed text-paper">
          {zip} covers{" "}
          {countPhrase(index.municipalities.length, "municipality", "municipalities")}{" "}
          and{" "}
          {countPhrase(index.schoolDistricts.length, "school district", "school districts")}
          . Do you want to narrow it?
        </p>
        <button
          type="button"
          aria-label="Collapse — decides nothing"
          onClick={() => setExpanded(false)}
          className="shrink-0 cursor-pointer p-0.5 text-muted hover:text-paper"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Picker first, where it can resolve. */}
      {index.municipalities.length > 1 && (
        <div className="mt-2.5">
          <p className="t-eyebrow text-muted">Your municipality</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {index.municipalities.map((m) => (
              <button
                key={m.ocdId}
                type="button"
                className="cursor-pointer rounded border border-[var(--panel-border)] px-2.5 py-1.5 text-[0.75rem] hover:border-[var(--accent-local)]"
                onClick={() => {
                  narrowing.setDivisions([m.ocdId]);
                  onNarrowed?.();
                  onApplied?.();
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The street question, verbatim — for what a picker cannot
          resolve. Never gated on the picker. */}
      <p className="mt-2.5 text-[0.75rem] leading-relaxed text-voice">
        What&apos;s the street you live on? That will help us narrow it
        for you — no house or apartment number needed.
      </p>
      <input
        type="text"
        value={streetInput}
        onChange={(e) => setStreetInput(e.target.value)}
        placeholder="Street name"
        className="mt-1.5 w-full rounded-md border border-[var(--panel-border)] bg-[var(--bg)] px-2.5 py-2 text-[0.8125rem] outline-none focus:border-[var(--accent-local)]"
        aria-label="Street name"
      />
      {streetMatches && streetMatches.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {streetMatches.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="cursor-pointer text-[0.75rem] text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                onClick={() => applyStreet(name)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {streetMatches && streetMatches.length === 0 && (
        <p className="mt-1.5 text-[0.75rem] text-voice">
          We don&apos;t recognize that street in {zip} yet — everything
          stays listed.
        </p>
      )}

      {/* Declining stays effortless — one tap, recorded on the device,
          never asked again for this zip. */}
      <button
        type="button"
        className="mt-3 w-full cursor-pointer rounded-md border border-[var(--panel-border)] px-4 py-2 text-[0.8125rem] font-medium text-paper transition-colors hover:border-paper"
        onClick={() => {
          narrowing.setDeclined();
          onNarrowed?.();
        }}
      >
        No thanks, show me everything
      </button>
      {/* D53: this line had to change the day the geocoder was wired. It used
          to say the street was "never sent anywhere", and once a street name
          goes to the Census Bureau's public address service that sentence is
          false. Naming the route is friction-rule exception (3) — it is
          consent to collection — and a promise we keep is worth more than a
          shorter one we do not. */}
      <p className="mt-2 text-[0.625rem] leading-relaxed text-muted">
        Your choice stays on this device. We never store it, never send it to
        us, and never tie it to an account. To put your street on the map we
        ask the U.S. Census Bureau&apos;s free address lookup for its location
        — the street name and this zip code, never a house number.
      </p>
    </div>
  );
}
