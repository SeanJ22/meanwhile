/**
 * **SLICES: parse one, and cut events or rows down to it.** Pure; no I/O. A slice is where (ZIP, district, county, state),
 * which topics, when (a day range at day or week grain), who (residents or outsiders by the residency stamp) and which card.
 */
import type { CapturedEvent, Grain, PlaceFilter, Slice } from "./types.ts";

export const MAX_SPAN_DAYS = 731;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOPIC = /^(?:free-form|[a-z0-9][a-z0-9_.-]{0,63})$/;
const CARD = /^[a-zA-Z0-9/_.:#=+-]{1,200}$/;
const OCD = /^ocd-division\/[a-z0-9_.:\/~-]{1,200}$/;

const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** The Monday on or before a day, matching the store's own week (`eventWeek` in `lib/db/reader-events.ts`). */
export function weekOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export const periodOf = (day: string, grain: Grain): string => (grain === "week" ? weekOf(day) : day);

/** Today in UTC, `YYYY-MM-DD`. */
export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);
/** The day `n` days before `day`. */
export function daysBefore(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

export type SliceParse = { readonly ok: true; readonly slice: Slice } | { readonly ok: false; readonly says: string };

/** A request's slice, checked. Anything malformed is refused with words, never repaired into something else. */
export function parseSlice(input: unknown): SliceParse {
  if (typeof input !== "object" || input === null) return { ok: false, says: "A slice needs a first and last day." };
  const raw = input as Record<string, unknown>;
  if (!isDay(raw.from) || !isDay(raw.to)) return { ok: false, says: "A slice needs a first and last day, written YYYY-MM-DD." };
  if (raw.from > raw.to) return { ok: false, says: "The first day of a slice cannot be after its last day." };
  if ((dayMs(raw.to) - dayMs(raw.from)) / 86_400_000 >= MAX_SPAN_DAYS) return { ok: false, says: `A slice covers at most ${MAX_SPAN_DAYS} days.` };
  const grain = raw.grain === undefined || raw.grain === null ? "day" : raw.grain;
  if (grain !== "day" && grain !== "week") return { ok: false, says: "A slice is by the day or by the week." };

  let place: PlaceFilter | null = null;
  if (raw.place !== undefined && raw.place !== null) {
    const p = raw.place as Record<string, unknown>;
    const id = typeof p?.id === "string" ? p.id.trim() : "";
    if (p?.kind === "zip" && /^\d{5}$/.test(id)) place = { kind: "zip", id };
    else if (p?.kind === "state" && /^[a-z]{2}$/i.test(id)) place = { kind: "state", id: id.toLowerCase() };
    else if ((p?.kind === "district" || p?.kind === "county") && OCD.test(id)) place = { kind: p.kind, id };
    else return { ok: false, says: "A place is a five-digit ZIP, a two-letter state, or a district or county division id." };
  }
  let topics: string[] | null = null;
  if (raw.topics !== undefined && raw.topics !== null) {
    if (!Array.isArray(raw.topics) || raw.topics.length === 0 || raw.topics.length > 50 || !raw.topics.every((t) => typeof t === "string" && TOPIC.test(t))) return { ok: false, says: "Topics are a short list of topic ids." };
    topics = [...new Set(raw.topics as string[])].sort();
  }
  let residency: "resident" | "outsider" | null = null;
  if (raw.residency !== undefined && raw.residency !== null) {
    if (raw.residency !== "resident" && raw.residency !== "outsider") return { ok: false, says: "Residency is residents or outsiders." };
    residency = raw.residency;
  }
  let card: string | null = null;
  if (raw.card !== undefined && raw.card !== null) {
    if (typeof raw.card !== "string" || !CARD.test(raw.card)) return { ok: false, says: "A card is its card id." };
    card = raw.card;
  }
  return { ok: true, slice: { from: raw.from, to: raw.to, grain, place, topics, residency, card } };
}

/** Where a ZIP is: its state (two lowercase letters) and the counties its territory reaches (OCD ids). */
export interface ZipPlaces {
  readonly state: string | null;
  readonly counties: readonly string[];
}

const STATE_IN_ID = /(?:^|\/)state:([a-z]{2})(?:\/|$)/;
/** The state inside an OCD division id, lowercase, or null. */
export const stateOfDivision = (id: string | null): string | null => (id === null ? null : STATE_IN_ID.exec(id)?.[1] ?? null);

/** Does an event's (zip, district) sit inside the place? A ZIP reaching two counties counts in both. */
export function inPlace(zip: string | null, district: string | null, place: PlaceFilter | null | undefined, zipPlaces: ReadonlyMap<string, ZipPlaces>): boolean {
  if (place === null || place === undefined) return true;
  switch (place.kind) {
    case "zip": return zip === place.id;
    case "district": return district === place.id;
    case "state": return (zip !== null ? (zipPlaces.get(zip)?.state ?? null) : stateOfDivision(district)) === place.id;
    case "county": return zip !== null && (zipPlaces.get(zip)?.counties ?? []).includes(place.id);
  }
}

/** A residency filter: residents are HOME; outsiders are BROWSING or MOVING; UNKNOWN is in neither. */
export const residencyMatches = (stamp: CapturedEvent["residency"], want: Slice["residency"]): boolean =>
  want === null || want === undefined || (want === "resident" ? stamp === "HOME" : stamp === "BROWSING" || stamp === "MOVING");

/** The events inside a slice (place, topics, days, residency, card). Grain does not cut events; recipes bucket by it. */
export function sliceEvents(events: readonly CapturedEvent[], slice: Slice, zipPlaces: ReadonlyMap<string, ZipPlaces>): CapturedEvent[] {
  return events.filter((e) =>
    e.day >= slice.from && e.day <= slice.to
    && inPlace(e.zip, e.district, slice.place, zipPlaces)
    && (slice.topics == null || slice.topics.includes(e.topic))
    && residencyMatches(e.residency, slice.residency)
    && (slice.card == null || e.cardId === slice.card));
}

/** "ocd-division/country:us/state:fl/cd:7" → "FL-7". Others keep their last segment in words. */
export function districtLabel(id: string): string {
  const state = stateOfDivision(id);
  const last = id.split("/").pop() ?? id;
  const [kind, value] = last.split(":");
  const st = state === null ? "" : state.toUpperCase();
  if (kind === "cd") return st === "" ? `District ${value}` : `${st}-${value}`;
  if (kind === "sldu") return `${st} Senate ${value}`.trim();
  if (kind === "sldl") return `${st} House ${value}`.trim();
  return `${st} ${kind === "county" ? `${value} County` : (value ?? last)}`.trim().replace(/_/g, " ");
}

/** "tax-and-fees" → "Tax and fees". A taxonomy id becomes words; free-form keeps its own name. */
export function topicLabel(topic: string): string {
  if (topic === "free-form") return "Free-form question";
  if (topic === "*") return "Everything";
  const words = topic.replace(/[_.-]+/g, " ").trim();
  return words === "" ? "Unnamed topic" : words.charAt(0).toUpperCase() + words.slice(1);
}
