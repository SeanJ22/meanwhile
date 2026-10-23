"use client";

import { personInitials } from "@/lib/officials/person-name";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import { readerPartyLabel, readerText } from "@/lib/text/reader-names";
import { ageFrom, inSeatUntil } from "@/lib/officials/tenure";

/**
 * The identity header: a circle, a name and a row of chips. The portrait ring
 * is neutral for everyone. Initials occupy the identical circle. Party fills
 * in its colour; every other chip is an outlined neutral of the same height.
 * No party filed renders nothing.
 */

const initialsOf = personInitials;

export function IdentityChip({
  children,
  /** The party chip, and only the party chip, fills. */
  fill,
  /** An extra class for a chip about our sourcing rather than the person, so a gap never looks like "Incumbent". */
  className,
}: {
  children: React.ReactNode;
  fill?: string;
  className?: string;
}) {
  return (
    <span
      className={className ? `id-chip ${className}` : "id-chip"}
      data-fill={fill ? "true" : undefined}
      style={fill ? ({ "--chip-fill": fill } as React.CSSProperties) : undefined}
    >
      {children}
    </span>
  );
}

/**
 * The circle, one geometry whatever is behind it. `object-position: top
 * center` keeps heads in frame.
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
        // Served from our origin.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={`Portrait of ${readerText(name, "name")}`} loading="eager" />
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
  /** Extra outlined chips the surface knows (state, chamber, incumbent or challenger). */
  chips = [],
}: {
  holder: SeatHolder;
  seatLabel: string | null;
  large?: boolean;
  chips?: string[];
}) {
  const until = inSeatUntil(holder.termEnd);
  const age = large ? ageFrom(holder.birthDate, new Date()) : null;

  return (
    <div className={`id-header ${large ? "id-header--lg" : ""}`}>
      <IdentityPortrait name={readerText(holder.name, "name")} photoUrl={holder.photoUrl} large={large} />

      <div className="min-w-0 flex-1">
        {/* The dialog's h2 on the large card; an h3 inside a popup card. */}
        {large ? (
          <h2 className="id-name id-name--lg">{readerText(holder.name, "name")}</h2>
        ) : (
          <h3 className="id-name">{readerText(holder.name, "name")}</h3>
        )}

        <div className="id-chip-row">
          {/* No party filed renders nothing. */}
          {holder.partyLabel && (
            <IdentityChip fill={partyColorVar(holder.partyLabel)}>
              {readerPartyLabel(holder.partyLabel)}
            </IdentityChip>
          )}
          {chips.map((chip) => (
            <IdentityChip key={chip}>{readerText(chip, "address")}</IdentityChip>
          ))}
        </div>

        <p className="id-office">
            {readerOfficeTitle(holder.officeTitle)}
            {/* A seat label identical to the title is not repeated. */}
            {seatLabel && seatLabel !== holder.officeTitle ? ` · ${readerText(seatLabel)}` : ""}
        </p>

        {/* Term end and (large card) age only from sourced values; age computed at render. */}
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
