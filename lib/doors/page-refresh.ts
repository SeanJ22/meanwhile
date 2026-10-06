/**
 * **A FACT PAST ITS REFRESH DATE IS RE-READ, WITH NO SEND NEEDED** (DB-29).
 *
 * A page door (roster, contact, comment rule, directory) is due when its last good read is older than its refresh
 * date: its own `checkEvery`, which is its fact class's freshness window. `pageDoorsDue` lists them, most late first,
 * capped so one pass never reads the whole registry at once. Feed doors are not here: a feed door is a partition read
 * and the ordinary pass already schedules it.
 *
 * A due page gets a plain re-fetch and the existing value-on-page check (`valueOnPage`, section 3), with no AI:
 * `recheckPage` compares each published value with the fresh page text and says one of three things.
 *
 * - CONFIRMED: every published value is still on the page. The fact's "checked" date moves to `readAt`.
 * - CHANGED: at least one value is no longer on the page. The fact is not restamped; the page goes back to its worker
 *   as ordinary work, named with the fields that moved.
 * - UNREADABLE: the page gave no text. Nothing is confirmed and nothing is called changed; the door's failure path
 *   (DB-32) handles it.
 *
 * PURE: no store, no fetch, no clock. The restamp itself goes through the worker publication path (slide's
 * `worker-publication-evidence.ts`), which this file does not write.
 */
import { valueOnPage, pageWords } from "../control-plane/promotion/section3.ts";
import { PAGE_DOOR_KIND } from "./page-doors.ts";
import { overdueDoors, type OverdueDoor } from "./overdue.ts";
import type { DoorRecord } from "./registry.ts";

/** One pass reads at most this many due pages, so a backlog drains over passes instead of in one burst. */
export const PAGE_REFRESH_PER_PASS = 25;

/** Open page doors past their refresh date, most late first, at most `limit`. */
export function pageDoorsDue(doors: readonly DoorRecord[], now: string, limit: number = PAGE_REFRESH_PER_PASS): OverdueDoor[] {
  const pages = doors.filter((door) => door.kind === PAGE_DOOR_KIND);
  return overdueDoors(pages, new Map(), now).slice(0, Math.max(0, limit));
}

/** The address a page door re-fetches: the one it was keyed on, or null when the record lost it. */
export function pageDoorUrl(door: Pick<DoorRecord, "config">): string | null {
  const url = door.config.url;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

/** A value a live fact published from this page. */
export interface PublishedValue {
  readonly field: string;
  readonly value: unknown;
}

export type PageRecheck =
  | { readonly kind: "CONFIRMED"; readonly confirmedAt: string }
  | { readonly kind: "CHANGED"; readonly changedFields: readonly string[] }
  | { readonly kind: "UNREADABLE" };

/** Re-run the value-on-page check against a fresh read. Nothing published means nothing to confirm, which is UNREADABLE. */
export function recheckPage(text: string, published: readonly PublishedValue[], readAt: string): PageRecheck {
  if (text.trim() === "" || published.length === 0) return { kind: "UNREADABLE" };
  const words = pageWords(text);
  const changedFields = published.filter((fact) => !valueOnPage(fact.value, text, words)).map((fact) => fact.field);
  return changedFields.length === 0 ? { kind: "CONFIRMED", confirmedAt: readAt } : { kind: "CHANGED", changedFields };
}
