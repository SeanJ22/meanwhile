import type { Meeting } from "../sources/types.ts";

/**
 * Searching what governments have actually put on their agendas. Nothing here generates; it quotes:
 * topic search returns the agenda's own line containing the topic, verbatim, with its document; item
 * extraction returns the agenda's own items beside the raw link. A topic is a vocabulary entry in
 * `AGENDA_TOPICS`, not a branch. The radius filters on where the body meets, so the answer says
 * "meetings within N miles of you", never "projects near you".
 */

/** A topic a reader can ask about, and the words agendas actually use. */
export interface AgendaTopic {
  id: string;
  /** What the reader called it, for the answer's own sentence. */
  label: string;
  /**
   * Phrases to look for in agenda text, lowercased. Multi-word by
   * preference: "data center" is a thing, "center" is a community centre,
   * a senior centre and a recreation centre, and a single loose word turns
   * a search into noise the reader has to filter for us.
   */
  phrases: readonly string[];
}

export const AGENDA_TOPICS: readonly AgendaTopic[] = [
  {
    id: "data-center",
    label: "a data center",
    phrases: ["data center", "data centre", "data processing facility", "hyperscale"],
  },
  {
    id: "warehouse",
    label: "a warehouse or distribution centre",
    phrases: ["warehouse", "distribution center", "distribution centre", "fulfillment center"],
  },
  {
    id: "rezoning",
    label: "a rezoning",
    phrases: ["rezoning", "rezone", "zoning amendment", "zoning change", "map amendment", "special exception", "variance request"],
  },
  {
    id: "road-project",
    label: "a road project",
    phrases: ["road improvement", "roadway improvement", "street improvement", "traffic signal", "roundabout", "road widening", "pavement preservation"],
  },
  {
    id: "housing-development",
    label: "a housing development",
    phrases: ["subdivision", "planned unit development", "multifamily", "apartment complex", "affordable housing development"],
  },
  {
    id: "cell-tower",
    label: "a cell tower",
    phrases: ["wireless communication facility", "cell tower", "telecommunications tower", "monopole"],
  },
  {
    id: "solar-wind",
    label: "a solar or wind project",
    phrases: ["solar array", "solar farm", "solar facility", "wind turbine", "battery energy storage"],
  },
  {
    id: "school-closure",
    label: "a school closing or boundary change",
    phrases: ["school closure", "school consolidation", "boundary adjustment", "attendance boundary"],
  },
];

export function agendaTopicFor(text: string): AgendaTopic | null {
  const haystack = text.toLowerCase();
  // Longest phrase first, so "distribution center" is not claimed by a
  // shorter entry that happens to appear in the same question.
  let best: { topic: AgendaTopic; length: number } | null = null;
  for (const topic of AGENDA_TOPICS) {
    for (const phrase of topic.phrases) {
      if (haystack.includes(phrase) && (!best || phrase.length > best.length)) {
        best = { topic, length: phrase.length };
      }
    }
  }
  return best?.topic ?? null;
}

/** An agenda document, as the snapshot carries it. */
export interface AgendaDocumentLike {
  meetingId: string;
  documentUrl: string;
  sourceUrl: string;
  sourceOrg: string;
  retrievedAt: string;
  text: string | null;
  extraction: string;
}

export interface AgendaHit {
  meetingId: string;
  /** The agenda's own line, verbatim and trimmed. Never rewritten. */
  quote: string;
  /** Which phrase matched, so the reader can see why this line is here. */
  matchedPhrase: string;
  documentUrl: string;
  sourceOrg: string;
  retrievedAt: string;
}

const MAX_QUOTE_CHARS = 400;

/**
 * Split extracted agenda text into lines worth quoting.
 *
 * PDF extraction collapses layout, so a "line" here is a sentence-ish run
 * rather than a visual line. Splitting on hard breaks AND on the numbered
 * item markers agendas use gets close enough to one item per quote, which
 * is what makes a quote readable on its own.
 */
function agendaLines(text: string): string[] {
  return text
    // An item marker must follow a sentence end (or a line start); a mid-sentence number is not an item.
    .split(/\n+|(?<=[.:;)])(?=\s\d{1,2}\.\s+[A-Z])|(?<=[.:;)])(?=\s[A-Z]\.\s+[A-Z])/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 12);
}

/**
 * Every agenda line matching the topic, across the documents given.
 *
 * Returns hits, never a count with no rows behind it: the caller states the
 * number it renders and the two cannot disagree. A document whose text is
 * null (extraction failed) is SKIPPED and counted separately — a failed
 * extraction is not an agenda with nothing in it, and letting it read as one
 * would turn our parsing failure into a claim about a government.
 */
export function searchAgendas(
  documents: readonly AgendaDocumentLike[],
  topic: AgendaTopic,
): { hits: AgendaHit[]; searched: number; unreadable: number } {
  const hits: AgendaHit[] = [];
  let searched = 0;
  let unreadable = 0;

  for (const doc of documents) {
    if (!doc.text || doc.text.trim().length === 0) {
      unreadable++;
      continue;
    }
    searched++;
    const seen = new Set<string>();
    for (const line of agendaLines(doc.text)) {
      const lower = line.toLowerCase();
      const phrase = topic.phrases.find((p) => lower.includes(p));
      if (!phrase) continue;
      const quote =
        line.length > MAX_QUOTE_CHARS ? `${line.slice(0, MAX_QUOTE_CHARS).trimEnd()}…` : line;
      if (seen.has(quote)) continue;
      seen.add(quote);
      hits.push({
        meetingId: doc.meetingId,
        quote,
        matchedPhrase: phrase,
        documentUrl: doc.documentUrl,
        sourceOrg: doc.sourceOrg,
        retrievedAt: doc.retrievedAt,
      });
    }
  }

  return { hits, searched, unreadable };
}

/** Great-circle miles between two points. */
export function milesBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Meetings whose own place is within `radiusMiles` of the reader's view.
 *
 * A PLACELESS meeting (virtual-only, per D18) has no coordinates and cannot
 * be filtered by distance. It is returned in `placeless` rather than
 * dropped, so a caller can say "and N virtual meetings we could not place"
 * instead of silently narrowing the search — the same rule the meeting
 * adapters follow when they count their own drops.
 */
export function meetingsWithin(
  meetings: readonly Meeting[],
  centre: { lat: number; lng: number },
  radiusMiles: number,
): { within: Meeting[]; placeless: Meeting[]; outside: number } {
  const within: Meeting[] = [];
  const placeless: Meeting[] = [];
  let outside = 0;
  for (const meeting of meetings) {
    const lat = meeting.location?.lat;
    const lng = meeting.location?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") {
      placeless.push(meeting);
      continue;
    }
    if (milesBetween(centre, { lat, lng }) <= radiusMiles) within.push(meeting);
    else outside++;
  }
  return { within, placeless, outside };
}

/**
 * The agenda's own numbered or lettered items, verbatim; never a summary. Rendered beside the raw
 * agenda link, never instead of it. Empty when the document has no recognisable item structure.
 */
export function agendaItems(text: string | null): string[] {
  if (!text) return [];
  const items: string[] = [];
  const seen = new Set<string>();
  for (const line of agendaLines(text)) {
    // An item marker the clerk typed: "1.", "12.", "A.", "IV." at the start. N/S/E/W are refused as
    // markers: a compass direction at the head of a line is an address far more often than an item.
    if (!/^(\d{1,2}[.)]|[A-Z][.)]|[IVX]{1,4}\.)\s+\S/.test(line)) continue;
    if (/^[NSEW][.)]/.test(line)) continue;
    // An item says something. A marker with four characters after it is a
    // fragment the splitter made, not a line the clerk wrote.
    if (line.replace(/^\S+\s+/, "").length < 12) continue;
    const trimmed =
      line.length > MAX_QUOTE_CHARS ? `${line.slice(0, MAX_QUOTE_CHARS).trimEnd()}…` : line;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    items.push(trimmed);
  }
  return items;
}
