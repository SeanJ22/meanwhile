import { formatMeetingDate } from "@/lib/map/format";
import { tierForOcdId, type Tier } from "@/lib/ocd/tiers";
import { tierForMeeting } from "@/lib/state/derive";
import type { Meeting } from "@/lib/sources/types";
import type { Venue } from "@/lib/meetings/venues";

/**
 * The search index behind the sidebar autocomplete.
 *
 * Ports the shape of EdiaStratMap's `precomputeSearchFields` and
 * `getAutocompleteCache`: lowercase the searchable text once when the data
 * arrives rather than on every keystroke, and cache the built index until the
 * data actually changes. At 34 fixtures neither matters; both are the
 * difference between an autocomplete that keeps up with typing and one that
 * does not, once real ingestion lands.
 */

export type SearchKind = "meeting" | "body" | "district" | "place" | "officeholder";

export interface SearchItem {
  id: string;
  kind: SearchKind;
  /** What the row shows. */
  label: string;
  /** Right-aligned detail: a date, a district number, a count. */
  meta: string;
  tier: Tier | null;
  /** Where selecting this should take the map. Null for things with no
   *  geometry yet — the row still shows, it just does not fly. */
  lat: number | null;
  lng: number | null;
  /** The join key. Display names are never used for this. */
  ocdId: string | null;
  /** Venue key, when selecting should also open a pin's popup. */
  venueKey: string | null;
  /** Precomputed lowercase haystack. Never rebuilt per keystroke. */
  haystack: string;
}

export const KIND_LABEL: Readonly<Record<SearchKind, string>> = {
  meeting: "Meet",
  body: "Body",
  district: "Dist",
  place: "Place",
  officeholder: "Person",
};

/** Group ordering in the dropdown: the things a reader is most likely to be
 *  looking for on a map of meetings come first. */
const KIND_ORDER: readonly SearchKind[] = [
  "meeting",
  "body",
  "district",
  "place",
  "officeholder",
];

export interface DistrictFeatureLike {
  ocdId: string;
  label: string;
  state: string;
  district: string;
}


/**
 * Build the index.
 *
 * Bodies and places are derived from the meetings themselves rather than from
 * a separate table, because there is no bodies table yet — Phase 5 adds one and
 * this function grows a parameter. Officeholders are deliberately absent: there
 * are no officeholder records, and CLAUDE.md forbids rendering a person without
 * a source behind them. The kind exists so the grouping does not have to be
 * rebuilt when they arrive.
 */
export function buildSearchIndex(
  venues: Venue[],
  districts: DistrictFeatureLike[] = [],
  /**
   * Meetings held online (D18).
   *
   * They arrive separately because they are not in any venue — a meeting with
   * no place cannot be grouped by one. Everything else about them is
   * searchable exactly as a physical meeting is; only `lat`/`lng` are null,
   * which `SearchItem` already describes as "the row still shows, it just
   * does not fly". Leaving them out would hide a real public meeting behind a
   * data-structure decision, which is the whole of what D18 is about.
   */
  onlineMeetings: Meeting[] = [],
): SearchItem[] {
  const items: SearchItem[] = [];
  const bodies = new Map<string, { meeting: Meeting; count: number }>();
  const places = new Map<string, { meeting: Meeting; count: number }>();

  const venueMeetings = venues.flatMap((venue) =>
    venue.meetings.map((meeting) => ({ meeting, venueKey: venue.key as string | null })),
  );
  const onlineRows = onlineMeetings.map((meeting) => ({ meeting, venueKey: null }));

  {
    for (const { meeting, venueKey } of [...venueMeetings, ...onlineRows]) {
      items.push({
        id: `meeting:${meeting.id}`,
        kind: "meeting",
        // Body first, then the sitting. Half a dozen "Regular Meeting" rows are
        // indistinguishable otherwise, and the term a reader typed is usually
        // the body's name — so leading with it also puts the bold match where
        // they can see why the row came back.
        label: `${meeting.bodyName} — ${meeting.title}`,
        meta: formatMeetingDate(meeting),
        tier: tierForMeeting(meeting),
        lat: meeting.location?.lat ?? null,
        lng: meeting.location?.lng ?? null,
        ocdId: meeting.ocdId,
        venueKey,
        haystack: [
          meeting.title,
          meeting.bodyName,
          meeting.jurisdiction,
          // The published location string either way: a room name for a
          // physical sitting, "Virtual Meeting" for an online one. A reader
          // searching either term should find the meeting they mean.
          meeting.location?.name ?? meeting.online?.label ?? "",
        ]
          .join(" ")
          .toLowerCase(),
      });

      // Bodies are keyed on OCD-ID plus body name, not name alone: "Board of
      // Supervisors" exists in every county in the state.
      const bodyKey = `${meeting.ocdId}|${meeting.bodyName}`;
      const body = bodies.get(bodyKey);
      if (body) body.count++;
      else bodies.set(bodyKey, { meeting, count: 1 });

      // A division-less body (null ocdId) is findable as a body and as its
      // meetings; there is no place identifier to offer.
      if (meeting.ocdId !== null) {
        const place = places.get(meeting.ocdId);
        if (place) place.count++;
        else places.set(meeting.ocdId, { meeting, count: 1 });
      }
    }
  }

  for (const [key, { meeting, count }] of bodies) {
    items.push({
      id: `body:${key}`,
      kind: "body",
      label: meeting.bodyName,
      meta: `${count}`,
      tier: tierForMeeting(meeting),
      lat: meeting.location?.lat ?? null,
      lng: meeting.location?.lng ?? null,
      ocdId: meeting.ocdId,
      venueKey: null,
      haystack: `${meeting.bodyName} ${meeting.jurisdiction}`.toLowerCase(),
    });
  }

  for (const [ocdId, { meeting, count }] of places) {
    items.push({
      id: `place:${ocdId}`,
      kind: "place",
      label: meeting.jurisdiction,
      meta: `${count}`,
      tier: tierForOcdId(ocdId),
      lat: meeting.location?.lat ?? null,
      lng: meeting.location?.lng ?? null,
      ocdId,
      venueKey: null,
      haystack: meeting.jurisdiction.toLowerCase(),
    });
  }

  for (const feature of districts) {
    items.push({
      id: `district:${feature.ocdId}`,
      kind: "district",
      label: feature.label,
      meta: feature.state,
      tier: tierForOcdId(feature.ocdId),
      lat: null,
      lng: null,
      ocdId: feature.ocdId,
      venueKey: null,
      haystack: `${feature.label} ${feature.state} ${feature.ocdId}`.toLowerCase(),
    });
  }

  return items;
}

/**
 * Cached index, invalidated when the inputs change.
 *
 * Edia calls this `getAutocompleteCache` / `invalidateCaches`. The token stands
 * in for its dirty flag: any caller that changes the underlying data passes a
 * different token and the index rebuilds.
 */
let cachedToken: string | null = null;
let cachedIndex: SearchItem[] = [];

export function getSearchIndex(
  token: string,
  build: () => SearchItem[],
): SearchItem[] {
  if (token !== cachedToken) {
    cachedToken = token;
    cachedIndex = build();
  }
  return cachedIndex;
}

export function invalidateSearchIndex(): void {
  cachedToken = null;
  cachedIndex = [];
}

export interface SearchGroup {
  kind: SearchKind;
  items: SearchItem[];
}

/**
 * Query the index.
 *
 * Prefix matches rank above interior matches, so typing "tuc" puts Tucson above
 * "South Tucson". Beyond that the input order is preserved, which keeps results
 * stable as a reader types rather than reshuffling under the cursor.
 */
export function searchItems(
  index: SearchItem[],
  rawQuery: string,
  limit = 24,
): SearchItem[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return [];

  const prefix: SearchItem[] = [];
  const interior: SearchItem[] = [];

  for (const item of index) {
    const at = item.haystack.indexOf(query);
    if (at === 0) prefix.push(item);
    else if (at > 0) interior.push(item);
    if (prefix.length >= limit) break;
  }

  return [...prefix, ...interior].slice(0, limit);
}

/** Group results for display, in a stable order. */
export function groupResults(items: SearchItem[]): SearchGroup[] {
  const byKind = new Map<SearchKind, SearchItem[]>();

  for (const item of items) {
    const list = byKind.get(item.kind);
    if (list) list.push(item);
    else byKind.set(item.kind, [item]);
  }

  return KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
    kind,
    items: byKind.get(kind) as SearchItem[],
  }));
}

/** Flatten groups back to the keyboard-navigable order shown on screen. */
export function flattenGroups(groups: SearchGroup[]): SearchItem[] {
  return groups.flatMap((g) => g.items);
}

/**
 * Split a label around the matched span, for the `<b>` highlight.
 *
 * Returns the three pieces rather than HTML: Edia builds a string with
 * `escapeHtml`, which React makes unnecessary and unsafe to imitate.
 */
export function highlightParts(
  label: string,
  rawQuery: string,
): [string, string, string] {
  const query = rawQuery.trim();
  if (query.length === 0) return [label, "", ""];

  const at = label.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return [label, "", ""];

  return [
    label.slice(0, at),
    label.slice(at, at + query.length),
    label.slice(at + query.length),
  ];
}
