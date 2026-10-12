import type { Meeting, MeetingLocation } from "../sources/types.ts";

/**
 * Outbound links for a meeting, best-first. Every link is either observed (a URL a person or adapter
 * actually opened) or explicitly `DERIVED`, and the two are never presented as the same kind of thing.
 * There is no fallback rung that builds a plausible address; a meeting with nothing to offer renders as
 * having nothing.
 */

/** Which rung of the ladder produced this link. Ordered best-first. */
export type LinkRung =
  /** The agenda document itself. */
  | "AGENDA"
  /** The meeting's own page in the system the record came from. */
  | "MEETING_RECORD"
  /** Where all of this body's agendas live. */
  | "AGENDA_PORTAL"
  /** The body's own page. */
  | "BODY_HOMEPAGE"
  /** The venue, on a map. Derived from coordinates, never a citation. */
  | "VENUE_MAP";

/**
 * Whether this link is evidence or a convenience.
 *
 * `SOURCED` links were opened by somebody and can be cited. `DERIVED` links are
 * built from data we hold — currently only the venue's coordinates — and prove
 * nothing about the meeting. The UI must never render a `DERIVED` link under a
 * heading that implies provenance, which is why the distinction is in the type
 * rather than left to whoever writes the component.
 */
export type LinkKind = "SOURCED" | "DERIVED";

export interface OutboundLink {
  rung: LinkRung;
  /** What the reader sees. */
  label: string;
  url: string;
  kind: LinkKind;
  /** One line on what sits at the other end, for a title attribute. */
  hint: string;
}

/**
 * What the body half of the ladder needs to know.
 *
 * Deliberately a narrow structural type rather than `Body`, so this stays pure
 * and testable and so the coverage layer can pass a `CoveredBody` without a
 * conversion.
 */
export interface LinkableBody {
  divisionLabel: string;
  homepageUrl: string | null;
  agendaSourceRef: string | null;
}

/**
 * Google Maps directions at coordinates we already hold. The `maps/dir/?api=1` form opens the native app
 * where installed and the website elsewhere. Still `DERIVED`: the URL was constructed here.
 */
function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
}

/**
 * A district office's address, handed to Google Maps: a sanctioned exception to nothing-leaves-the-app,
 * because the reader's next action is physically going there. Uses the published address rather than
 * coordinates, which we do not hold for these rows; geocoding them ourselves would invent a point.
 */
export function officeDirectionsUrl(parts: {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string | null {
  // The street is the load-bearing part: a link to just a city would open a map of the city, which looks
  // like an answer and is not one.
  if (!parts.address?.trim()) return null;
  const destination = [parts.address, parts.city, parts.state, parts.zip]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/** Reject anything that is not an http(s) URL before it reaches an href. */
function usable(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The venue rung on its own, so the panel and the popup can offer directions
 * without assembling the whole ladder.
 */
export function venueLink(location: MeetingLocation): OutboundLink | null {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  return {
    rung: "VENUE_MAP",
    label: "Directions",
    url: directionsUrl(location.lat, location.lng),
    kind: "DERIVED",
    hint: `Directions to ${location.address ?? location.name} (Google Maps)`,
  };
}

/**
 * Build the ladder for one meeting. Rungs come back in order and every one that cannot be filled is
 * omitted, so an empty array means this meeting has nowhere to go. `body` is optional: a meeting whose
 * division has no registry body still gets its agenda and venue rungs.
 */
export function linksForMeeting(
  meeting: Meeting,
  body?: LinkableBody | null,
): OutboundLink[] {
  const links: OutboundLink[] = [];

  if (usable(meeting.agendaUrl)) {
    links.push({
      rung: "AGENDA",
      label: "Agenda",
      url: meeting.agendaUrl,
      kind: "SOURCED",
      hint: "The published agenda for this meeting",
    });
  }

  // The record's own permalink. Distinct from the agenda: Legistar returns an
  // InSiteURL for the meeting page and a separate file URL for the agenda PDF,
  // and a reader who wants the video, the packet or the minutes needs the page.
  if (
    usable(meeting.provenance.sourceUrl) &&
    meeting.provenance.sourceUrl !== meeting.agendaUrl
  ) {
    links.push({
      rung: "MEETING_RECORD",
      label: "Meeting record",
      url: meeting.provenance.sourceUrl,
      kind: "SOURCED",
      hint: `Where we read this from — ${meeting.provenance.sourceOrg}`,
    });
  }

  if (body && usable(body.agendaSourceRef)) {
    links.push({
      rung: "AGENDA_PORTAL",
      label: "All agendas",
      url: body.agendaSourceRef,
      kind: "SOURCED",
      hint: "Every agenda this body publishes",
    });
  }

  if (body && usable(body.homepageUrl)) {
    links.push({
      rung: "BODY_HOMEPAGE",
      // The division's label, which Census sourced. Never the body's own name —
      // Body.name is null on every derived row and minting one here would put a
      // fabricated government name in a link, read aloud by a screen reader.
      label: body.divisionLabel || "Body homepage",
      url: body.homepageUrl,
      kind: "SOURCED",
      hint: "The body's own website",
    });
  }

  // A meeting held online has no venue to map; the card renders its join link or the named gap.
  const venue = meeting.location ? venueLink(meeting.location) : null;
  if (venue) links.push(venue);

  return links;
}

/** Order used when rendering. Exported so a test can pin it. */
export const RUNG_ORDER: LinkRung[] = [
  "AGENDA",
  "MEETING_RECORD",
  "AGENDA_PORTAL",
  "BODY_HOMEPAGE",
  "VENUE_MAP",
];
