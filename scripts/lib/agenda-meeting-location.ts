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

/** Only the agenda's header is read: the place a sitting is held is stated first. */
const HEADER_CHARS = 700;

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20",
};
const DIRECTIONALS: Readonly<Record<string, string>> = {
  north: "n", south: "s", east: "e", west: "w", n: "n", s: "s", e: "e", w: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw", ne: "ne", nw: "nw", se: "se", sw: "sw",
};
const SUFFIXES: Readonly<Record<string, string>> = {
  street: "st", st: "st", avenue: "ave", ave: "ave", boulevard: "blvd", blvd: "blvd", road: "rd", rd: "rd",
  drive: "dr", dr: "dr", place: "pl", pl: "pl", way: "way", lane: "ln", ln: "ln", court: "ct", ct: "ct",
  parkway: "pkwy", pkwy: "pkwy", circle: "cir", cir: "cir", highway: "hwy", hwy: "hwy", plaza: "plz", plz: "plz",
};

const NUMBER = `(\\d{1,6}|${Object.keys(NUMBER_WORDS).join("|")})`;
const DIRECTIONAL = `(?:(${Object.keys(DIRECTIONALS).join("|")})\\.?\\s+)?`;
const NAME = "((?:[A-Za-z0-9][A-Za-z0-9'-]*\\s+){0,3}?[A-Za-z0-9][A-Za-z0-9'-]*)";
const SUFFIX = `(${Object.keys(SUFFIXES).join("|")})\\b\\.?`;
/** A street address: a number, an optional directional, one to four name words, a suffix. */
const STREET = new RegExp(`\\b${NUMBER}\\s+${DIRECTIONAL}${NAME}\\s+${SUFFIX}`, "i");
/** "Broadway" and its kin are whole street names with no suffix. */
const SUFFIXLESS = new RegExp(`\\b${NUMBER}\\s+${DIRECTIONAL}(Broadway)\\b`, "i");
const CITY_STATE_ZIP = /^[\s,]*(?:(?:\d+(?:st|nd|rd|th)\s+Floor|Suite\s+\w+|Room\s+\w+|lower level)[\s,]*)*([A-Z][A-Za-z .'-]{1,40}?),\s*([A-Z]{2})\s+(\d{5})\b/;
/** The words a header prints before the place; everything up to them is the body's and the document's name. */
const HEADER_NOISE = /\b(?:MEETING LOCATION|Meeting Agenda\s*-\s*Final|Agenda\s*-\s*Final|Meeting Agenda|Final|Revised|Amended)\b/g;

export interface StatedAgendaAddress {
  /** The place words the agenda prints before the address ("City Hall"), or null. */
  readonly place: string | null;
  /** The street address exactly as printed ("20 East Main Street"). */
  readonly street: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  /** The street reduced to what two spellings of one building agree on ("20 e main st"). */
  readonly key: string;
}

function normalizedStreet(number: string, directional: string | undefined, name: string, suffix: string | undefined): string {
  const digits = NUMBER_WORDS[number.toLowerCase()] ?? number;
  const direction = directional ? DIRECTIONALS[directional.toLowerCase()] ?? directional.toLowerCase() : "";
  const words = name.toLowerCase().replace(/[.']/g, "").split(/\s+/).filter(Boolean)
    .map((word) => NUMBER_WORDS[word] ?? word);
  const ending = suffix ? SUFFIXES[suffix.toLowerCase().replace(/\.$/, "")] ?? suffix.toLowerCase() : "";
  // "Broadway" is printed with and without "Blvd"; both are one street.
  if (words.length === 1 && words[0] === "broadway") return [digits, direction, "broadway"].filter(Boolean).join(" ");
  return [digits, direction, ...words, ending].filter(Boolean).join(" ");
}

/** The first street address in `text`, reduced to its building-level key. */
export function streetKeyOf(text: string): { readonly key: string; readonly index: number; readonly length: number } | null {
  const full = STREET.exec(text);
  const bare = SUFFIXLESS.exec(text);
  const hit = full && (!bare || full.index <= bare.index) ? { match: full, suffix: full[4] } : bare ? { match: bare, suffix: undefined } : null;
  if (!hit) return null;
  const [, number, directional, name] = hit.match;
  return {
    key: normalizedStreet(number!, directional, name!, hit.suffix),
    index: hit.match.index,
    length: hit.match[0].length,
  };
}

/**
 * The place the agenda states in its header, or null when it states no street
 * address there.
 */
export function statedAgendaAddress(agendaText: string): StatedAgendaAddress | null {
  const header = agendaText.replace(/\s+/g, " ").trim().slice(0, HEADER_CHARS);
  const street = streetKeyOf(header);
  if (!street) return null;
  const printed = header.slice(street.index, street.index + street.length).trim();
  const after = CITY_STATE_ZIP.exec(header.slice(street.index + street.length));
  let place: string | null = null;
  const before = header.slice(0, street.index);
  let cut = 0;
  for (const noise of before.matchAll(HEADER_NOISE)) cut = noise.index + noise[0].length;
  const words = before.slice(cut).replace(/^[\s,:-]+|[\s,:-]+$/g, "");
  if (words && words.length <= 80) place = words;
  return {
    place,
    street: printed,
    city: after?.[1]?.trim() ?? null,
    state: after?.[2] ?? null,
    zip: after?.[3] ?? null,
    key: street.key,
  };
}

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
