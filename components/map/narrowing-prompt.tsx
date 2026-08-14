"use client";

import { useEffect, useMemo, useState } from "react";

import { useNarrowing } from "@/hooks/use-narrowing";

/**
 * The reader disambiguation prompt — M26/4.6.3c, built against the author's
 * verbatim wording (docs/state.md §9):
 *
 *   "<zip> covers <N> municipalities and <M> school districts. Do you want
 *    to narrow it?"  → on yes →
 *   "What's the street you live on? That will help us narrow it for you —
 *    no house or apartment number needed."
 *
 * The counts are computed from the street index, never literals. The prompt
 * renders only where a per-zip index file exists — the build writes one only
 * where more than one municipality or school district covers the zip's
 * streets, so there is no prompt where the answer would not change.
 *
 * Declining is the effortless default: the prompt is one quiet line with a
 * "yes" affordance; ignoring it costs nothing, "no thanks" dismisses it for
 * the session, and nothing is gated on answering. The picker comes first
 * where it can resolve (people know their town); the street question covers
 * what a picker cannot (people do not know their school district). Neither
 * path is gated on the other. Everything stays on the device — see
 * hooks/use-narrowing.ts.
 *
 * This optionality is friction-rule exception (2): the default path must
 * stay effortless, and this component is where that is enforced.
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
}: {
  zip: string;
  /** Present so the parent re-reads the store; the hook notifies anyway. */
  onNarrowed?: () => void;
}) {
  const [index, setIndex] = useState<StreetIndex | null>(null);
  const [open, setOpen] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [streetInput, setStreetInput] = useState("");
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
        // 404 is the computed trigger saying "no prompt here".
        if (!response.ok) return;
        setIndex((await response.json()) as StreetIndex);
      } catch {
        // No index, no prompt — never an error state for the reader.
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

  // A made choice renders as its result plus the way back — the prompt
  // itself is done.
  if (hasSelection) {
    const chosen = [...index.municipalities, ...index.schoolDistricts].filter(
      (d) => narrowing.divisions.includes(d.ocdId),
    );
    return (
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-muted">
        Narrowed to {chosen.map((c) => c.label).join(", ")} — stored only on
        this device.{" "}
        <button
          type="button"
          className="underline decoration-dotted hover:text-signal"
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

  if (declined) return null;

  const applyStreet = (name: string) => {
    const street = index.streets[name];
    if (!street) return;
    const ocdIds = [
      ...street.m.map((i) => index.municipalities[i].ocdId),
      ...street.s.map((i) => index.schoolDistricts[i].ocdId),
    ];
    narrowing.setStreet(name);
    narrowing.setDivisions(ocdIds);
    onNarrowed?.();
  };

  return (
    <div className="mt-2.5 border-t border-[var(--panel-border)] pt-2.5">
      {/* The approved wording, counts computed. */}
      <p className="text-[0.75rem] leading-relaxed text-paper-dim">
        {zip} covers{" "}
        {countPhrase(index.municipalities.length, "municipality", "municipalities")}{" "}
        and{" "}
        {countPhrase(index.schoolDistricts.length, "school district", "school districts")}
        . Do you want to narrow it?
      </p>

      {!open ? (
        <p className="mt-1 text-[0.6875rem]">
          <button
            type="button"
            className="underline decoration-dotted text-paper-dim hover:text-signal"
            onClick={() => setOpen(true)}
          >
            yes
          </button>
          <span className="text-muted"> · </span>
          <button
            type="button"
            className="text-muted underline decoration-dotted hover:text-signal"
            onClick={() => setDeclined(true)}
          >
            no thanks
          </button>
        </p>
      ) : (
        <div className="mt-1.5">
          {/* Picker first, where it can resolve. */}
          {index.municipalities.length > 1 && (
            <div className="mb-2">
              <p className="text-[0.625rem] font-mono uppercase tracking-[0.15em] text-muted">
                Your municipality
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {index.municipalities.map((m) => (
                  <button
                    key={m.ocdId}
                    type="button"
                    className="rounded border border-[var(--panel-border)] px-2 py-1 text-[0.6875rem] hover:border-[var(--accent-local)]"
                    onClick={() => {
                      narrowing.setDivisions([m.ocdId]);
                      onNarrowed?.();
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
          <p className="text-[0.75rem] leading-relaxed text-paper-dim">
            What&apos;s the street you live on? That will help us narrow it
            for you — no house or apartment number needed.
          </p>
          <input
            type="text"
            value={streetInput}
            onChange={(e) => setStreetInput(e.target.value)}
            placeholder="Street name"
            className="mt-1.5 w-full rounded border border-[var(--panel-border)] bg-transparent px-2 py-1.5 text-[0.75rem] outline-none focus:border-[var(--accent-local)]"
            aria-label="Street name"
          />
          {streetMatches && streetMatches.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {streetMatches.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="text-[0.6875rem] underline decoration-dotted text-paper-dim hover:text-signal"
                    onClick={() => applyStreet(name)}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {streetMatches && streetMatches.length === 0 && (
            <p className="mt-1 text-[0.6875rem] text-muted">
              We don&apos;t recognize that street in {zip} yet — everything
              stays listed.
            </p>
          )}
          <p className="mt-1.5 text-[0.5625rem] leading-relaxed text-muted">
            Your choice stays on this device. It is never sent anywhere and
            never tied to an account.
          </p>
        </div>
      )}
    </div>
  );
}
