/**
 * `pnpm stamp` — print today's date, `YYYY-MM-DD`, in `America/Phoenix`.
 *
 * Not `new Date().toISOString().slice(0, 10)`: after 5pm Phoenix time UTC has
 * already rolled over, so that returns tomorrow.
 *
 *   pnpm stamp            2026-08-14
 *   pnpm stamp --iso      2026-08-14T21:01:34-07:00   (full local instant)
 *
 * `en-CA` is used only because it formats as ISO. The day itself is computed in
 * `scripts/doc-dates.mjs` (plain JavaScript) and re-exported here.
 */

import { today } from "./doc-dates.mjs";

const ZONE = "America/Phoenix";

export function stamp(now: Date = new Date()): string {
  return today(now);
}

/** The same instant with wall-clock time and offset, for logs that want one. */
export function stampIso(now: Date = new Date(), zone: string = ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // "GMT-07:00" → "-07:00"; Intl emits a bare "GMT" at zero offset.
  const offset = get("timeZoneName").replace(/^GMT/, "") || "+00:00";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/stamp.mts");

if (isMain) {
  console.log(process.argv.includes("--iso") ? stampIso() : stamp());
}
