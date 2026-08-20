"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { PositionsSection } from "@/components/officials/positions-section";

/**
 * **The candidate battlecard, and the pill that opens it** — F01-continued
 * session 2, item 12, 2026-08-19.
 *
 * ## The complaint
 *
 * The author, on device: *"the ballot is a forever scroll because every long
 * section — 'in their own words', campaign funding, and the rest — renders
 * inline on the ballot itself. The large battlecard already has slots for
 * these sections and they are not being used."*
 *
 * Measured before touching anything, at 430×932: **07866 was 20,510 px — 22
 * phone screens — and 85701 was 41,558 px, 44.6 screens.** A ballot is a
 * thing a reader takes into a booth. Forty-four screens is not a document,
 * it is a wall, and reader friction is a defect with the same standing as a
 * wrong number.
 *
 * ## Why this is a NEW component and not the existing battlecard
 *
 * `OfficialModal` is the large person surface and it already carries every
 * slot the moved sections need. It also **only opens for an incumbent** — it
 * is built from a `SeatHolder`, which comes from the exact-key incumbent
 * join, and a challenger has none.
 *
 * So moving the long sections into `OfficialModal` would have deleted "in
 * their own words" and the funding block **for every challenger in every
 * contest** while leaving them for the incumbent. That is not a layout
 * regression, it is the **equal-effort rule** broken at its most sensitive
 * point: `CLAUDE.md` says a thin card tracks incumbency and campaign
 * professionalism rather than merit, and that "the app can say nothing about
 * anyone and still tilt a race". A reorganisation that hides a challenger's
 * own words behind nothing while an incumbent keeps theirs is the thumb on
 * the scale, wearing a tidiness argument.
 *
 * This card therefore takes **children**, not a holder. Every candidate in a
 * contest gets the identical pill, opening the identical card, with whatever
 * we actually hold about them inside — including, honestly, very little. The
 * asymmetry that remains is the asymmetry in the DATA, which is named on the
 * card in the standard line, and that is the version of it the rule allows.
 *
 * ## Server sections inside a client modal
 *
 * The sections are server components — they read committed data files. They
 * arrive here as `children`, which is a ReactNode and crosses the boundary.
 * Never a render prop: `CandidateCard`'s own `nameSlot` carries the note that
 * a function cannot cross that boundary, and doing it is what 500'd
 * `/about-area`.
 */
export function CandidateBattlecard({
  name,
  partyLine,
  subjectId,
  children,
}: {
  name: string;
  /** Already-formatted party text. Display only — nothing here ranks. */
  partyLine?: React.ReactNode;
  /**
   * The key this person's published text is stored under — a candidate key
   * (`ballot-nj-morris:us-house-11:mejia`) on this surface.
   *
   * ITEM 13 (2026-08-19): the searchable Positions section takes it. It used
   * to exist only on `OfficialModal`, keyed by an OFFICEHOLDER id, and search
   * only the officeholder-keyed corpus — so a challenger had no searchable
   * positions at all and an incumbent's search could not see the candidate
   * corpus. Both halves are fixed: the section is on every candidate's card,
   * and `lib/corpus/unified.ts` indexes both key spaces.
   */
  subjectId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/*
        The pill: full width of the ballot column, directly beneath the links
        row, on every candidate.

        FULL WIDTH IS THE SPEC and it is also the equal-effort answer. A chip
        sized to its content would be the same width on every card here, but a
        full-width bar reads as one repeated affordance down the whole
        contest rather than as a decoration some cards happen to carry — the
        reader learns one gesture and it is in the same place every time.

        Register: PLAYFUL, because this is an INTERACTION surface — a call to
        action, in `CLAUDE.md`'s two-register doctrine. Everything INSIDE the
        card is a claim surface and stays level. The seam is the rule.

        NO pushed history entry — `official-modal.tsx` carries the full
        diagnosis: Next's router owns history, a push remounts the island, and
        the modal dies in the tick it opens on every viewport under 1024px.
        That was the phone click-dead defect. Escape, ×, and backdrop close.
      */}
      <button
        type="button"
        data-battlecard-pill
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mt-2 w-full cursor-pointer rounded-md border border-[var(--panel-border)] bg-[var(--panel-raised)] px-3 py-2 text-center text-[0.8125rem] font-medium text-link transition-colors hover:border-[var(--link)] hover:bg-[var(--panel)]"
      >
        View Battlecard
      </button>

      {open && (
        <div
          className="account-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={name}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="account-modal" data-candidate-battlecard>
            <header className="account-modal-header">
              <div className="min-w-0">
                <p className="popup-type" style={{ color: "var(--accent-local)" }}>
                  Candidate
                </p>
                <p className="truncate text-[1rem] font-semibold tracking-tight">
                  {name}
                </p>
                {partyLine && (
                  <p className="text-[0.75rem] text-muted">{partyLine}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="popup-expand-btn !static shrink-0"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="account-modal-body" data-battlecard-body>
              {children}
              {/*
                ITEM 13: the searchable positions surface, on EVERY
                candidate's card.

                It sits below the moved sections deliberately. Those are what
                we hold, laid out; this is the reader asking their own
                question of the same person's pages. A search box above the
                evidence invites a reader to search before knowing there is
                anything to search.
              */}
              <PositionsSection subjectId={subjectId} subjectName={name} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
