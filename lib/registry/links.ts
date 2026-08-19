import type { Meeting, MeetingLocation } from "../sources/types.ts";

/**
 * Somewhere to click.
 *
 * **The gap this closes.** "Select Board — Regular Meeting, Fri Aug 14" was
 * plain text. A reader who wanted the Town of Newbury — the agenda, the board,
 * anything — had no route out of the card, and the venue address sat there
 * inert beside it. The app knew things it never offered: the body's own page,
 * the system the record was read from, coordinates precise enough to navigate
 * to. All of it was in the data and none of it was reachable.
 *
 * **The rule that shapes it.** Every link here is either something observed —
 * a URL a person or an adapter actually opened — or something explicitly
 * marked `DERIVED`, and the two may never be presented as the same kind of
 * thing. A constructed URL that looks like a citation is the exact failure
 * 4.5.3 nulled 34 fixtures over: invisible until a reader clicks it. So there
 * is no fallback rung that builds a plausible address, and a meeting with
 * nothing to offer renders as having nothing rather than as having a guess.
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
 * Google Maps directions, at the coordinates we already hold.
 *
 * The author's direction (2026-08-14, friction pass): directions default to
 * Google Maps on every venue link. The earlier OpenStreetMap choice read
 * `CLAUDE.md`'s "Not Google Maps" too broadly — that rule is about the
 * basemap, not about where a reader gets driving directions. The
 * `maps/dir/?api=1` form is Google's documented universal link: it opens the
 * native app where one is installed (iOS and Android alike) and the website
 * everywhere else, which is the platform-appropriate fallback in one URL.
 * The coordinates are already sourced — the Census geocoder, cited per venue
 * in `lib/sources/legistar/clients.ts` — so this renders data we hold rather
 * than fetching anything new.
 *
 * It is still `DERIVED`. The URL was constructed here; nobody opened it.
 */
function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
}

/**
 * **A district office's address, handed to Google Maps** — F01 4.3, 2026-08-19.
 *
 * The author: *"When I look at 'Offices near you' the address for these I would
 * like to be hyperlinked out to Google Maps. If I click on 2201 East Camelback
 * Road, it should take that address and put it into Google Maps and pop up 'hey,
 * you want to go here?'"*
 *
 * ## A DECLARED EXCEPTION to nothing-leaves-the-app
 *
 * `CLAUDE.md`'s standing rule is that every row opens a card and nothing leaves
 * the product. This is the second sanctioned exception, in the same class as
 * B19's directions handoff from a polling-place pin, and for the same reason:
 * the reader's next action is physically going there, and no card this product
 * could build is a substitute for turn-by-turn navigation on the device they
 * are holding. Recording it as an exception rather than quietly making one.
 *
 * ## Why the ADDRESS and not coordinates
 *
 * `directionsUrl` above is the coordinate form, used where we hold a geocoded
 * point. A congressional district office in the directory carries a street
 * address, a city, a state and a zip and NO coordinates that we have sourced —
 * `lat`/`lng` are present in the schema and null for these rows. Geocoding them
 * ourselves to build a coordinate link would be inventing a point; passing the
 * published address straight through hands Google the same string the member
 * publishes, and lets their geocoder be the one that resolves it.
 *
 * The `?api=1&destination=` form is Google's documented universal link: it opens
 * the native app where one is installed and the website everywhere else.
 */
export function officeDirectionsUrl(parts: {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string | null {
  // The street is the load-bearing part. A link to "Tucson, AZ" would open a
  // map of the city, which looks like an answer and is not one.
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
 * Build the ladder for one meeting.
 *
 * Returns rungs in order and **omits every one it cannot fill**, so an empty
 * array is a true statement that this meeting has nowhere to go rather than a
 * signal to invent something. The caller renders "nothing to link to yet",
 * which is the same honesty `meeting-panel.tsx` already applies to a null
 * agenda URL.
 *
 * `body` is optional because the meeting sources and the registry are joined at
 * the read layer, and a meeting whose division has no registry body still gets
 * its agenda and venue rungs.
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

  // A venue link is a map link, and a meeting held online has no venue to
  // map (D18). The reader's way in is the join link, which the card renders
  // from `online` — or the named gap, when the body published none.
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
