"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { COLLECTION_NOTE } from "@/lib/ballot/collection-note";
import {
  BATTLECARD_SECTIONS,
  votingRecordEmptyLine,
  type BattlecardSectionId,
} from "@/lib/ballot/battlecard-sections";
import { CardSection, CardSectionGroup } from "@/components/officials/card-section";
import { PositionsSection } from "@/components/officials/positions-section";
import {
  positionsEmptyLine,
  UNESTABLISHED,
  type PositionsEmptyStateInput,
} from "@/lib/questionnaire/positions-state";

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
  sections,
  holdsOrHeldTheOffice = false,
  questionnaire = UNESTABLISHED,
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
  /**
   * BC-1 (2026-08-22): the SEVEN sections, by id. A slot that is absent or
   * null renders the section anyway, with its own honest empty line inside —
   * the SET never varies, only what is in it.
   */
  sections?: Partial<Record<BattlecardSectionId, React.ReactNode>>;
  /**
   * BC-2: which of the two Voting record empty states applies. A fact about
   * the PERSON — do they hold or have they held this office — never about how
   * much we happen to hold on them.
   */
  holdsOrHeldTheOffice?: boolean;
  /**
   * **THE THIRD EMPTY STATE ON POSITIONS** (2026-08-23, the questionnaire
   * brief, item 1).
   *
   * BC-2 gave the Voting record section two empty states because *never held
   * the office* and *we have not collected it* are different facts. The
   * first-party questionnaire creates a third cause on Positions that neither
   * covers: **we asked this person directly and have not heard back.**
   *
   * Three states, one pill, each attributing the gap to its actual cause —
   * ours, the process's, or the public record's. None of them may read as
   * evasion, and `tests/questionnaire.test.ts` holds the banned shapes.
   *
   * The default asserts nothing: `UNESTABLISHED` falls to the state that
   * describes only our own gap.
   */
  questionnaire?: PositionsEmptyStateInput;
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
        /*
          **BAL-13 (2026-08-25) — THE NAVY TREATMENT.**

          The author red-boxed this control on `09-10-09`: a plain outline
          button in link blue, sitting directly above the filled
          "Would you vote for them?" panel that gives it its width. His note is
          the argument — *it is the thing the product most wants opened and
          nothing says so.*

          Deep navy, white, bolded. The same `--speak-navy` the Speak Your Mind
          pill uses, and for the same reason it uses it: a FILLED control among
          outline controls reads as the action without a word of instruction.
          Two filled navy controls in this product now, and both are the one
          thing a reader is being invited to do on their surface.

          `w-full` is unchanged and is what matches the reaction panel below —
          they are siblings in one column, so the width is shared by
          construction rather than by a number typed twice.
        */
        className="mt-2 w-full cursor-pointer rounded-md border border-[var(--speak-navy)] bg-[var(--speak-navy)] px-3 py-2 text-center text-[0.8125rem] font-semibold text-[var(--speak-on-navy)] transition-colors hover:border-[var(--speak-navy-hover)] hover:bg-[var(--speak-navy-hover)]"
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
              {/*
                **BC-1 — THE SAME SEVEN DROP-DOWNS, ON EVERY CARD, ALWAYS.**
                (2026-08-22, the author's 8/22 walkthrough, item 14.)

                What was here before: whatever the ballot page happened to pass
                as `children`. For Cory Booker that was a funding block and a
                link, so clicking "Battlecard" opened what read as a campaign
                finance page — the author's BC-3 — and the actual record was one
                more click away behind "See their voting record". For Veronica
                Fernandez, an independent with no voting history and no federal
                filing, it was very nearly nothing at all.

                The SET is now fixed. A section with no content renders its
                header and its own honest line inside. Hiding the empty ones
                would make a well-covered person's card taller and more
                substantial than a thin one's, which is a layout asymmetry
                tracking incumbency rather than anything about the people.
              */}
              <CardSectionGroup>
                {BATTLECARD_SECTIONS.map((spec) => {
                  const content = sections?.[spec.id] ?? null;
                  return (
                    <CardSection key={spec.id} title={spec.title}>
                      {content ?? (
                        <p className="text-[0.8125rem] leading-relaxed text-voice">
                          {/*
                            BC-2: two distinct empty states on the record, same
                            pill. Without the distinction a challenger's card
                            reads as thinner than an incumbent's because of
                            COPY rather than data.
                          */}
                          {spec.id === "record"
                            ? votingRecordEmptyLine(holdsOrHeldTheOffice)
                            : spec.id === "positions"
                              ? positionsEmptyLine(questionnaire)
                              : spec.emptyLine}
                        </p>
                      )}
                      {/*
                        ITEM 13: the searchable positions surface, on EVERY
                        candidate's card.

                        It used to sit BELOW the sections as a surface of its
                        own, and BC-1 gave the card a drop-down already called
                        Positions — so a reader opening this card saw the word
                        twice, four inches apart, meaning two different things.
                        It now lives INSIDE the Positions section, under what we
                        hold: those are the evidence laid out, and this is the
                        reader asking their own question of the same person's
                        pages. A search box above the evidence invites a reader
                        to search before knowing there is anything to search.
                      */}
                      {spec.id === "positions" && (
                        <PositionsSection subjectId={subjectId} subjectName={name} />
                      )}
                    </CardSection>
                  );
                })}
              </CardSectionGroup>

              {/*
                RULING 51 (2026-08-21, his note on `PE04`): *"That one line
                should be listed once in the ballot section and once again on
                their battlecard."* Two surfaces, one instance each.

                It is the LAST thing in the body, after everything we hold,
                because it is a statement about what came above it. Read
                before the evidence it describes, it is a disclaimer; read
                after, it is the account of what the reader just looked at.

                It is NOT a per-card marker and RULING 44 is untouched: a
                battlecard is one surface a reader opened, not a card in a
                column of cards, and this sentence says nothing about THIS
                candidate relative to any other. It says the same thing on
                every battlecard in the product.

                LEVEL register — a claim surface, about our own coverage.
              */}
              <p
                data-collection-note
                className="mt-6 text-[0.75rem] leading-relaxed text-voice"
              >
                {COLLECTION_NOTE}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
