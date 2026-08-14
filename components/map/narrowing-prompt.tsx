"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useNarrowing } from "@/hooks/use-narrowing";

/**
 * The reader disambiguation prompt — M26/4.6.3c, rebuilt as a modal (3b,
 * 2026-08-16, author-directed). The approved wording is unchanged
 * (docs/state.md §9):
 *
 *   "<zip> covers <N> municipalities and <M> school districts. Do you want
 *    to narrow it?"  → on yes →
 *   "What's the street you live on? That will help us narrow it for you —
 *    no house or apartment number needed."
 *
 * The shape: on zip entry where the answer would change (a street index
 * exists) and no response is recorded, a centered overlay over a blurred
 * map asks the question ONCE, with two equally-weighted buttons — "Yes,
 * help me narrow it" and "No thanks, show me everything". No X to hunt, no
 * backdrop dismiss: the modal forces a RESPONSE, never a narrowing —
 * declining is one tap, recorded on the device, and never asked again for
 * that zip. This optionality is friction-rule exception (2), and the
 * forced-response-never-forced-narrowing distinction is where the consent
 * exception survives.
 *
 * The old quiet-line yes/no-thanks links in the who-governs card retire;
 * the card keeps only the narrowed-state result line with its undo.
 * Everything stays on the device — see hooks/use-narrowing.ts.
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
  const [narrowingOpen, setNarrowingOpen] = useState(false);
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
  // itself is done. This line lives in the who-governs card.
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

  if (narrowing.declined) return null;

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

  // Portaled to <body>: the card this mounts from sits inside panels that
  // may carry transforms, which would turn `fixed` into a local overlay.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Narrow what ${zip} covers`}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      {/* The blurred ground. Deliberately not a dismiss control — the modal
          asks for a response, and both responses are one tap below. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
      />

      <div className="panel pointer-events-auto relative w-full max-w-md p-5">
        {/* The approved wording, counts computed. */}
        <p className="text-[0.9375rem] leading-relaxed text-paper">
          {zip} covers{" "}
          {countPhrase(index.municipalities.length, "municipality", "municipalities")}{" "}
          and{" "}
          {countPhrase(index.schoolDistricts.length, "school district", "school districts")}
          . Do you want to narrow it?
        </p>

        {!narrowingOpen ? (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="rounded border border-[var(--accent-local)] px-4 py-2.5 text-[0.875rem] font-medium text-paper transition-colors hover:bg-[var(--accent-local)]/10"
              onClick={() => setNarrowingOpen(true)}
            >
              Yes, help me narrow it
            </button>
            <button
              type="button"
              className="rounded border border-[var(--panel-border)] px-4 py-2.5 text-[0.875rem] font-medium text-paper transition-colors hover:border-paper"
              onClick={() => {
                narrowing.setDeclined();
                onNarrowed?.();
              }}
            >
              No thanks, show me everything
            </button>
          </div>
        ) : (
          <div className="mt-4">
            {/* Picker first, where it can resolve. */}
            {index.municipalities.length > 1 && (
              <div className="mb-3">
                <p className="text-[0.625rem] font-mono uppercase tracking-[0.15em] text-muted">
                  Your municipality
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {index.municipalities.map((m) => (
                    <button
                      key={m.ocdId}
                      type="button"
                      className="rounded border border-[var(--panel-border)] px-2.5 py-1.5 text-[0.75rem] hover:border-[var(--accent-local)]"
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
            <p className="text-[0.8125rem] leading-relaxed text-paper-dim">
              What&apos;s the street you live on? That will help us narrow it
              for you — no house or apartment number needed.
            </p>
            <input
              type="text"
              value={streetInput}
              onChange={(e) => setStreetInput(e.target.value)}
              placeholder="Street name"
              className="mt-1.5 w-full rounded border border-[var(--panel-border)] bg-transparent px-2.5 py-2 text-[0.8125rem] outline-none focus:border-[var(--accent-local)]"
              aria-label="Street name"
            />
            {streetMatches && streetMatches.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {streetMatches.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      className="text-[0.75rem] underline decoration-dotted text-paper-dim hover:text-signal"
                      onClick={() => applyStreet(name)}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {streetMatches && streetMatches.length === 0 && (
              <p className="mt-1.5 text-[0.75rem] text-muted">
                We don&apos;t recognize that street in {zip} yet — everything
                stays listed.
              </p>
            )}

            {/* Declining stays effortless from inside the narrowing UI too. */}
            <button
              type="button"
              className="mt-4 w-full rounded border border-[var(--panel-border)] px-4 py-2.5 text-[0.875rem] font-medium text-paper transition-colors hover:border-paper"
              onClick={() => {
                narrowing.setDeclined();
                onNarrowed?.();
              }}
            >
              No thanks, show me everything
            </button>
            <p className="mt-2 text-[0.625rem] leading-relaxed text-muted">
              Your choice stays on this device. It is never sent anywhere and
              never tied to an account.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
