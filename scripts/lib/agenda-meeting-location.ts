/**
 * **A SITTING'S PLACE, AS ITS OWN AGENDA STATES IT.**
 *
 * Some listings name no place a map can pin while the agenda prints a street
 * address in its header. When a sitting
 * is unplaced and its held agenda (the official meeting document) states a
 * street address, that address is matched to a PROMOTED reviewed venue in the
 * sitting's own division by normalized street address. The sitting is then
 * placed: the location's name and address are the agenda's own words, and the
 * coordinates are the reviewed venue's.
 *
 * What this never does:
 * - geocode, or read any new source;
 * - overwrite a location an adapter already placed, or relabel an online
 *   sitting;
 * - match across divisions ("20 E Main St" exists in many cities);
 * - pick between two reviewed venues at one street address whose coordinates
 *   disagree.
 * With no match, the sitting keeps its named gap.
 *
 * Reached only by the ingest (scripts/ingest.ts), never by a reader surface.
 */

import { statedAgendaAddress, streetKeyOf, type StatedAgendaAddress } from "../../lib/meetings/agenda-address.ts";
export { statedAgendaAddress, streetKeyOf, type StatedAgendaAddress } from "../../lib/meetings/agenda-address.ts";

export interface PlaceableVenue {
  readonly bodyOcdId: string | null;
  readonly name: string;
  readonly address: string | null;
  readonly lat: number;
  readonly lng: number;
}

export interface PlaceableMeeting {
  readonly id: string;
  readonly ocdId: string | null;
  readonly location: { readonly name: string; readonly address: string | null; readonly lat: number; readonly lng: number } | null;
  readonly online?: unknown;
  readonly venueGap?: unknown;
}

export type AgendaPlacement =
  | { readonly kind: "PLACED"; readonly stated: StatedAgendaAddress; readonly venue: PlaceableVenue }
  | { readonly kind: "NO_ADDRESS" }
  | { readonly kind: "NO_REVIEWED_VENUE"; readonly stated: StatedAgendaAddress }
  | { readonly kind: "AMBIGUOUS"; readonly stated: StatedAgendaAddress; readonly venues: readonly PlaceableVenue[] };

/**
 * Match one sitting's stated agenda address to the reviewed venues of its own
 * division. City and ZIP, when both sides state them, must agree.
 */
export function placementFor(
  meeting: PlaceableMeeting,
  agendaText: string,
  venues: readonly PlaceableVenue[],
): AgendaPlacement {
  const stated = statedAgendaAddress(agendaText);
  if (!stated) return { kind: "NO_ADDRESS" };
  const matches = venues.filter((venue) => {
    if (!venue.address || !meeting.ocdId || venue.bodyOcdId !== meeting.ocdId) return false;
    const street = streetKeyOf(venue.address);
    if (!street || street.key !== stated.key) return false;
    const venueZip = /\b(\d{5})\b(?!.*\b\d{5}\b)/.exec(venue.address)?.[1] ?? null;
    if (stated.zip && venueZip && stated.zip !== venueZip) return false;
    return true;
  });
  if (matches.length === 0) return { kind: "NO_REVIEWED_VENUE", stated };
  const points = new Set(matches.map((venue) => `${venue.lat.toFixed(5)},${venue.lng.toFixed(5)}`));
  if (points.size > 1) return { kind: "AMBIGUOUS", stated, venues: matches };
  return { kind: "PLACED", stated, venue: matches[0]! };
}

export interface PlacementReport {
  readonly placed: number;
  readonly noReviewedVenue: number;
  readonly ambiguous: number;
  readonly lines: readonly string[];
}

/**
 * Place every unplaced sitting whose own held agenda states an address that a
 * reviewed venue of its division carries. Returns new rows; rows that are
 * placed already, online, or unmatched are returned unchanged.
 */
export function placeUnplacedFromAgendas<M extends PlaceableMeeting>(
  rows: readonly M[],
  agendaTextFor: (meetingId: string) => string | null,
  venues: readonly PlaceableVenue[],
): { readonly rows: M[]; readonly report: PlacementReport } {
  let placed = 0;
  let noReviewedVenue = 0;
  let ambiguous = 0;
  const lines: string[] = [];
  const out = rows.map((meeting) => {
    if (meeting.location || meeting.online || /^legistar(?:-insite)?:/.test(meeting.id)) return meeting;
    const text = agendaTextFor(meeting.id);
    if (!text) return meeting;
    const placement = placementFor(meeting, text, venues);
    if (placement.kind === "NO_ADDRESS") return meeting;
    if (placement.kind === "NO_REVIEWED_VENUE") {
      noReviewedVenue += 1;
      lines.push(`  ${meeting.id}: its agenda states "${placement.stated.street}"; no reviewed venue of its division carries that address`);
      return meeting;
    }
    if (placement.kind === "AMBIGUOUS") {
      ambiguous += 1;
      lines.push(`  ${meeting.id}: its agenda states "${placement.stated.street}"; ${placement.venues.length} reviewed venues carry it at different coordinates, so none is chosen`);
      return meeting;
    }
    placed += 1;
    const { stated, venue } = placement;
    const address = [stated.street, stated.city && stated.state ? `${stated.city}, ${stated.state}${stated.zip ? ` ${stated.zip}` : ""}` : null]
      .filter(Boolean).join(", ");
    const { venueGap: _gap, ...rest } = meeting as M & { venueGap?: unknown };
    return {
      ...rest,
      location: { name: stated.place ?? stated.street, address, lat: venue.lat, lng: venue.lng },
    } as M;
  });
  return { rows: out, report: { placed, noReviewedVenue, ambiguous, lines } };
}
