import type { Meeting } from "../sources/types.ts";

/** A meeting as the live meeting API shows it. */
export type Shown = Pick<Meeting, "provenance" | "title" | "timeZone" | "id" | "startsAt" | "bodyId" | "bodyName" | "ocdId" | "jurisdiction" | "location" | "mapPin" | "agendaUrl" | "mergedMeetingIds" | "status" | "videoUrl">;

const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) < 1e-5;
const words = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const where = (m: Shown) => m.location ?? m.mapPin ?? null;

export function differences(before: Shown, after: Meeting): string[] {
  const out: string[] = [];
  if (Date.parse(before.startsAt) !== Date.parse(after.startsAt)) out.push("start");
  const b = where(before), a = where(after);
  if (b && !a) out.push("place lost");
  else if (b && a && (!same(b.lat, a.lat) || !same(b.lng, a.lng))) out.push("place moved");
  if (before.mapPin && !after.mapPin) out.push("pin lost");
  else if (before.mapPin && after.mapPin && (!same(before.mapPin.lat, after.mapPin.lat) || !same(before.mapPin.lng, after.mapPin.lng))) out.push("pin moved");
  if (before.agendaUrl && !after.agendaUrl) out.push("agenda link lost");
  else if (before.agendaUrl && after.agendaUrl && words(before.agendaUrl) !== words(after.agendaUrl)) out.push("agenda link changed");
  if (before.status === "CANCELED" && after.status !== "CANCELED") out.push("cancellation lost");
  return out;
}
