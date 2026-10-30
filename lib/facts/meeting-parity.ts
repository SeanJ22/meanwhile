import type { Meeting } from "../sources/types.ts";

/** A meeting as the live meeting API shows it. */
export type Shown = Meeting;

const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) < 1e-5;
const words = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const where = (m: Shown) => m.location ?? m.mapPin ?? null;
const hrefs = (m: Shown) => new Set((m.publishedLinks ?? []).map(link => words(link.href)));
const actingKeys = (m: Shown) => new Set((m.actingBodies ?? []).map(body => JSON.stringify([body.bodyId ?? null, body.ocdId ?? null])));

/**
 * What a reader sees of `before` (the live API) that `after` (the fact store's reading) does not show, field by field.
 * Nothing a reader sees today may go away, so every field the API ships is compared, not only the ones that were first noticed.
 */
export function differences(before: Shown, after: Meeting): string[] {
  const out: string[] = [];
  if (Date.parse(before.startsAt) !== Date.parse(after.startsAt)) out.push("start");
  if (before.startPrecision !== after.startPrecision && (before.startPrecision === "DAY" || after.startPrecision === "DAY")) out.push("precision");
  if (words(before.title) !== words(after.title)) out.push("title");
  if (words(before.bodyName) !== words(after.bodyName)) out.push("body name");
  if (before.jurisdiction !== after.jurisdiction) out.push("jurisdiction");
  const b = where(before), a = where(after);
  if (b && !a) out.push("place lost");
  else if (b && a && (!same(b.lat, a.lat) || !same(b.lng, a.lng))) out.push("place moved");
  if (before.location && after.location && words(before.location.name) !== words(after.location.name)) out.push("place name");
  if (before.venueGap && !after.venueGap && !after.location) out.push("venue text lost");
  if (before.mapPin && !after.mapPin) out.push("pin lost");
  else if (before.mapPin && after.mapPin && (!same(before.mapPin.lat, after.mapPin.lat) || !same(before.mapPin.lng, after.mapPin.lng))) out.push("pin moved");
  if (before.online && !after.online) out.push("online lost");
  else if (before.online && after.online && before.online.joinUrl !== after.online.joinUrl) out.push("online changed");
  if (before.agendaUrl && !after.agendaUrl) out.push("agenda link lost");
  else if (before.agendaUrl && after.agendaUrl && words(before.agendaUrl) !== words(after.agendaUrl)) out.push("agenda link changed");
  if (before.videoUrl && !after.videoUrl) out.push("video lost");
  if (before.status === "CANCELED" && after.status !== "CANCELED") out.push("cancellation lost");
  if (before.eventType && !after.eventType) out.push("event type lost");
  if (before.endsAt && !after.endsAt) out.push("end lost");
  if (before.postedAt && !after.postedAt) out.push("posted time lost");
  if (before.agendaSlotObservedEmpty && !after.agendaSlotObservedEmpty) out.push("empty agenda slot lost");
  const links = hrefs(after);
  if ([...hrefs(before)].some(href => !links.has(href))) out.push("published link lost");
  const acting = actingKeys(after);
  if ([...actingKeys(before)].some(key => !acting.has(key))) out.push("acting body lost");
  const ids = new Set([after.id, ...(after.mergedMeetingIds ?? [])]);
  if ([before.id, ...(before.mergedMeetingIds ?? [])].some(id => !ids.has(id))) out.push("listing alias lost");
  if (before.carried && !after.carried) out.push("carried note lost");
  const sources = after.fieldSources ?? {};
  if (Object.keys(before.fieldSources ?? {}).some(field => !sources[field])) out.push("field source lost");
  return out;
}
