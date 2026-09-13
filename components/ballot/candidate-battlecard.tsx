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
import { ContactPills } from "@/components/officials/contact-pills";
import { OfficialTermNote } from "@/components/officials/official-term-note";
import type { SeatHolder } from "@/lib/officials/lookup";
import { IdentityChip, IdentityPortrait } from "@/components/officials/person-identity";
import { incumbencyLabel, type Incumbency, type IncumbencyGap } from "@/lib/ballot/incumbency";
import { SpeakYourMind } from "@/components/speak/speak-your-mind";
import { partyFillVar } from "@/lib/officials/party-color";
import { PositionsSection } from "@/components/officials/positions-section";
import { PublicStatementsProfile } from "@/components/officials/public-statements-profile";
import { OfficialActions } from "@/components/officials/official-actions";
import { DemandPill } from "@/components/demand/demand-pill";
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
  partyLabel = null,
  photoUrl = null,
  incumbency = "UNKNOWN",
  incumbencyGap = null,
  speakContext = null,
  subjectId,
  sections,
  holdsOrHeldTheOffice = false,
  questionnaire = UNESTABLISHED,
  contactHolder = null,
}: {
  name: string;
  /**
   * **BAL-33 / BAL-35 (2026-08-30) — the officeholder record behind this
   * candidate, where one joins.**
   *
   * The card's doc block above explains why it takes `children` rather than a
   * holder, and that reasoning is untouched: the SECTIONS still come from the
   * page so a challenger's own words and funding are never deleted to tidy an
   * incumbent's card.
   *
   * This is narrower and is the thing the owner asked for: the CONTACT ROUTES,
   * from the same `SeatHolder` the map battlecard renders, so one record
   * answers on both surfaces. Null for a candidate with no officeholder
   * record, and the row then renders nothing rather than an empty state.
   */
  contactHolder?: SeatHolder | null;
  /**
   * **BAL-18 (2026-08-25) — the party is a COLOURED PILL, matching the map.**
   *
   * Sean: *"party affiliation renders as gray text. Make it a colored pill —
   * the party's color — matching the map card."* The map card has always done
   * this, through `IdentityChip fill={partyColorVar(...)}`; the ballot card
   * rendered `text-muted` prose. Same person, same card, two renderings.
   *
   * `partyLine` is kept as the FALLBACK for a surface that has already
   * formatted something richer than a bare label, so nothing that renders
   * today can render nothing tomorrow.
   */
  partyLabel?: string | null;
  /**
   * **BAL-17 (2026-08-25) — the photo, in both Arizona and New Jersey.**
   *
   * The map card renders `IdentityPortrait`; this one rendered no circle at
   * all. It is the SAME component here, so the geometry cannot drift and a
   * photo-less candidate gets the identical circle with initials rather than a
   * smaller shape (the four-door photo rule's own reason).
   */
  photoUrl?: string | null;
  /**
   * **BAL-20 (2026-08-25) — incumbency, stated, and stated HERE.**
   *
   * Sean: *"the ballot card is exactly where incumbency belongs."* It renders
   * as an outlined chip beside the party pill — the same `chips` slot the map
   * card uses for it — so the two surfaces say it the same way.
   *
   * It is a FACT ABOUT THE PERSON (do they hold this office), never a ranking
   * and never a completeness marker: both candidates in a contest carry a
   * chip, one reading `Incumbent` and the other `Challenger`, so neither is
   * marked by the presence or absence of a badge (RULING 42).
   *
   * **THREE STATES, NOT A BOOLEAN (2026-08-26, Items 10-15).** This was
   * `incumbent?: boolean` rendered as `incumbent ? "Incumbent" : "Challenger"`,
   * fed by a lookup that is federal-only by construction. Every state and local
   * candidate in this product therefore rendered `Challenger`, including every
   * actual incumbent — a component default converting an absence into a
   * specific, checkable, false claim about a named person, which is the render-
   * default rule verbatim.
   *
   * The third state is resolved PER CONTEST, so it is never worn by one card in
   * a race and not the other.
   */
  incumbency?: Incumbency;
  /**
   * WHICH gap the third state is, so the sentence on the chip is the true one
   * (2026-08-28). A contest can be refused a label while we DO hold the
   * sitting member — the candidate universe is not certified, or the
   * officeholder universe is not shown complete — and the original sentence
   * would then be a false statement about our own sourcing. Null keeps the
   * original and commonest one.
   *
   * Every card in a contest receives the SAME value, so this can never read as
   * a remark about one candidate (RULING 42).
   */
  incumbencyGap?: IncumbencyGap | null;
  /** Where the reader is, for the Speak Your Mind row. Never who they are. */
  speakContext?: { lat?: number | null; lng?: number | null } | null;
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

        /*
          **BAL-14 (2026-08-25) — SEAN SETTLED THIS, AND IT SUPERSEDES BAL-13.**

          BAL-13, on 2026-08-25 that morning, made this control navy for a good
          reason: a FILLED control among outline controls reads as the action.
          The mechanism stays and only the hue moves. His words, and the reason
          is his: GREEN, because it is the only option that does not compete
          with the red and blue of party affiliation — which now sit on this
          very card as a coloured pill under BAL-18, directly above this button.

          Both themes, and the token is theme-aware for DARK-2 reason: the navy
          it replaced did not survive a dark ground, and shipping a second
          control with the same defect on the same day would be the fix and the
          bug in one commit.

          `w-full` is untouched, which is the other half of what he asked for:
          the width matches the "Would you vote for them?" panel below because
          they are siblings in one column, so it is shared by construction
          rather than by a number typed twice.
        */
        className="battlecard-cta"
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
          <div className="account-modal" data-candidate-battlecard data-candidate-subject={subjectId}>
            <header className="account-modal-header">
              {/*
                **BAL-17, BAL-18 and BAL-20 — the ballot card's header is the
                MAP card's header.** (2026-08-25, Sean's walkthrough.)

                His frame for all three: *same person, same card, same
                rendering; the map version is the reference.* So the pieces are
                the map's own components rather than a second implementation
                that looks like them — `IdentityPortrait` for the circle and
                `IdentityChip` for the pills. RULING 103 is why: three separate
                copies of an initials function once rendered the same person
                three different ways, and the fix for that is to have one.
              */}
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <IdentityPortrait name={name} photoUrl={photoUrl} />

                <div className="min-w-0 flex-1">
                  <p className="popup-type" style={{ color: "var(--accent-local)" }}>
                    Candidate
                  </p>
                  <p className="truncate text-[1rem] font-semibold tracking-tight">
                    {name}
                  </p>

                  <div className="id-chip-row">
                    {partyLabel ? (
                      <IdentityChip fill={partyFillVar(partyLabel)}>{partyLabel}</IdentityChip>
                    ) : (
                      partyLine && <span className="text-[0.75rem] text-muted">{partyLine}</span>
                    )}
                    {/*
                      BAL-20: BOTH candidates carry a chip. A badge worn only by
                      the incumbent is a marker tracking incumbency rather than
                      anything about the people, which is exactly what RULING 42
                      deleted from these cards once already.
                    */}
                    {/*
                      The third state renders in the GAP'S OWN REGISTER, never
                      dressed as one of the first two. A recorded standing is a
                      fact about the person; "we haven't sourced this" is a fact
                      about us, and a colour is a claim too — so it carries the
                      `id-chip-unsourced` class rather than the neutral outline
                      the other two share.
                    */}
                    <IdentityChip
                      className={incumbency === "UNKNOWN" ? "id-chip-unsourced" : undefined}
                    >
                      {incumbencyLabel(incumbency, incumbencyGap ?? undefined)}
                    </IdentityChip>
                  </div>
                </div>
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
                **BAL-33 / BAL-35 (2026-08-30) — THE WAYS TO REACH THIS PERSON,
                FROM THE SAME RECORD THE MAP READS.**

                The owner opened Katie Hobbs on the ballot and on the map,
                side by side. The map card carried a phone number, Email,
                Contact form and Official page. The ballot card carried no
                contact route at all and, expanded, said we hold no office
                location for her. His words: *it says we have no way to
                contact her, but obviously we do.*

                This is `ContactPills` — the identical component the map
                battlecard renders, taking the identical `SeatHolder`. Not a
                second contact renderer: two surfaces answering one question
                from different code is how they came to disagree, and a copy
                here would drift the same way within a month.

                **On the equal-effort rule, which this card's header block is
                built around.** A contact row that only incumbents can fill IS
                an asymmetry — and it is an asymmetry in the DATA, which is the
                version this card already permits and already names in its
                standard line. A challenger has no officeholder record because
                nobody holds an office for them; that is a fact about the
                world, not a difference in how hard we looked. The asymmetry
                the rule forbids is the one made of COPY and LAYOUT, and this
                row renders nothing at all rather than an empty state, so a
                thin card does not grow a hollow section announcing what is
                missing.
              */}
              {contactHolder && (
                <div className="mb-3" data-ballot-contact-row>
                  <ContactPills holder={contactHolder} scope="primary" />
                  <OfficialTermNote holder={contactHolder} />
                </div>
              )}
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
                        <PositionsSection subjectId={subjectId} subjectName={name} contentOnly />
                      )}
                    </CardSection>
                  );
                })}
                {contactHolder && <PublicStatementsProfile subjectId={contactHolder.id} />}
                <OfficialActions subjectId={subjectId} />
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
              {/*
                **BAL-19 (2026-08-25) — Speak Your Mind is on the ballot card
                too.** Sean: *"the Speak Your Mind pill is absent from the
                ballot section. Add it."*

                It sits BELOW the seven sections and ABOVE the collection note,
                which is the same place it occupies on the map's person card:
                after the evidence, because it is the reader's turn once they
                have read what we hold, and before the note, because the note is
                the last word about the card as a whole.
              */}
              <div className="mt-5">
                <SpeakYourMind
                  subjectType="CANDIDATE"
                  subjectId={subjectId}
                  subject={name}
                  context={speakContext ?? undefined}
                />
              </div>

              {/*
                **OWN-Q6 (2026-08-31) — the reader asking us to go get it.**

                Directly under Speak Your Mind and above the collection note,
                on the same reasoning that placed the pill above it: after the
                evidence, because it is the reader's turn once they have read
                what we hold. It is the SAME component on the body card, with
                the same props, so the two surfaces cannot drift — a pill that
                appeared only where coverage is good would itself be a
                coverage claim.
              */}
              <DemandPill
                subjectType="CANDIDATE"
                subjectId={subjectId}
                className="mt-3"
              />

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
