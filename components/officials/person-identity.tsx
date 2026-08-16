"use client";

import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import { ageFrom, inSeatUntil } from "@/lib/officials/tenure";

/**
 * **The identity header** — item 3, 2026-08-16, the author's ruling.
 *
 * The test is one second to "who is this person", and the whole design serves
 * it: a circle, a name, and a row of chips where fill-versus-outline carries
 * the emphasis.
 *
 * ## The four rules, each of which is a defect if broken
 *
 * 1. **The ring is NEUTRAL.** The reference screenshot rings the portrait in
 *    the party's red; that is the one thing not adopted. A ring in a party
 *    colour makes the photograph itself a partisan mark, and a nonpartisan
 *    office would then have to wear either a colour it has no claim to or a
 *    visibly lesser frame. One ring, `--panel-border`, for every person.
 * 2. **The initials avatar occupies the IDENTICAL circle.** This extends
 *    6b3's uniform geometry: same diameter, same ring, same ground. A
 *    photo-less candidate must not be a smaller shape on the page — layout
 *    weight tracks our research, not the person.
 * 3. **Party FILLS in its assigned colour; everything else is an OUTLINED
 *    neutral.** State, chamber, incumbent-or-challenger. Fill versus outline
 *    carries the emphasis and the chips stay one height — a bigger chip would
 *    make the same claim by size, which is the thing that creeps.
 * 4. **No party filed renders as absence, per M62.** Never a "Nonpartisan"
 *    pill dressed as an affiliation, and absence never wears a colour. A
 *    nonpartisan office has no party to state; a partisan seat with no
 *    certified result is our gap and says so in the card's body, not as a
 *    chip.
 *
 * "Incumbent" and "Challenger" render in the identical chip. Equal effort is
 * a geometric claim here as much as an editorial one.
 */

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function IdentityChip({
  children,
  /** The party chip, and only the party chip, fills. */
  fill,
}: {
  children: React.ReactNode;
  fill?: string;
}) {
  return (
    <span
      className="id-chip"
      data-fill={fill ? "true" : undefined}
      style={fill ? ({ "--chip-fill": fill } as React.CSSProperties) : undefined}
    >
      {children}
    </span>
  );
}

/**
 * The circle. One geometry, whatever is behind it.
 *
 * `object-position: top center` because a portrait cropped to a circle from
 * the middle decapitates people; the head is at the top of every portrait
 * this product ships.
 */
export function IdentityPortrait({
  name,
  photoUrl,
  large = false,
}: {
  name: string;
  photoUrl: string | null;
  large?: boolean;
}) {
  return (
    <div className={`id-portrait ${large ? "id-portrait--lg" : "id-portrait--sm"}`}>
      {photoUrl ? (
        // Served from our origin; the door it shipped through and its source
        // are recorded per row in docs/photo-report.md.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={`Portrait of ${name}`} loading="eager" />
      ) : (
        <span className="id-portrait-initials" aria-hidden="true">
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
}

export function PersonIdentity({
  holder,
  seatLabel,
  large = false,
  /**
   * Extra outlined chips the surface knows and the roster does not — the
   * state, the chamber, incumbent-or-challenger. Passed rather than derived
   * so a ballot card and a map card can each say what they actually know
   * instead of one of them guessing.
   */
  chips = [],
  /**
   * **The small popup's form** (item 4, 2026-08-16, the author's ruling).
   *
   * Exactly three things on that card and nothing else: the circle, the name,
   * the party pill — then the contact column. The author's words for what was
   * there before were "ugly and scattered, too much info", and what made it
   * scattered was five competing facts at four type sizes inside 300px.
   *
   * So `identityOnly` drops the office line, the in-seat line, and every
   * outlined chip (the state, the chamber, incumbent-or-challenger). **None
   * of it is deleted** — all of it renders on the large battlecard, which is
   * one tap below and is where a reader goes for the record. The PARTY pill
   * stays, on both card sizes: it is banned from the who-governs LIST, never
   * from a battlecard.
   */
  identityOnly = false,
}: {
  holder: SeatHolder;
  seatLabel: string | null;
  large?: boolean;
  chips?: string[];
  identityOnly?: boolean;
}) {
  const until = identityOnly ? null : inSeatUntil(holder.termEnd);
  const age = large ? ageFrom(holder.birthDate, new Date()) : null;
  const outlined = identityOnly ? [] : chips;

  return (
    <div className={`id-header ${large ? "id-header--lg" : ""}`}>
      <IdentityPortrait name={holder.name} photoUrl={holder.photoUrl} large={large} />

      <div className="min-w-0 flex-1">
        {/* The card's heading, at the level the surface it sits on needs:
            on the large battlecard this IS the dialog's h2 (the header above
            no longer repeats it), and inside a popup card it is an h3 under
            the card's own label. */}
        {large ? (
          <h2 className="id-name id-name--lg">{holder.name}</h2>
        ) : (
          <h3 className="id-name">{holder.name}</h3>
        )}

        <div className="id-chip-row">
          {/*
            Rule 4: no party filed renders NOTHING. The absence is honest and
            the card's body carries which kind of nothing it is.
          */}
          {holder.partyLabel && (
            <IdentityChip fill={partyColorVar(holder.partyLabel)}>
              {holder.partyLabel}
            </IdentityChip>
          )}
          {outlined.map((chip) => (
            <IdentityChip key={chip}>{chip}</IdentityChip>
          ))}
        </div>

        {!identityOnly && (
          <p className="id-office">
            {holder.officeTitle}
            {/* A seat label identical to the title ("Mayor · Mayor") is noise,
                not information. */}
            {seatLabel && seatLabel !== holder.officeTitle ? ` · ${seatLabel}` : ""}
          </p>
        )}

        {/*
          6d: "In seat until", and — on the large card — age. Both render ONLY
          from a sourced value; a holder with no sourced term end renders no
          line at all rather than an em dash, because a visible blank invites
          a reader to conclude something. The age is computed from the birth
          date AT RENDER so it cannot drift the way a stored number would.
        */}
        {(until || age !== null) && (
          <p className="id-tenure">
            {until && (
              <span>
                In seat until <span className="font-mono text-paper">{until}</span>
              </span>
            )}
            {age !== null && (
              <span>
                Age <span className="font-mono text-paper">{age}</span>
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
