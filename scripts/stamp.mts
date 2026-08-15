/**
 * `pnpm stamp` — print today's date, `YYYY-MM-DD`, in `America/Phoenix`.
 *
 * One line of output and nothing else, because the output is meant to be
 * read by whoever is about to type a date into a document.
 *
 * **Why this is a script and not a habit.** `CLAUDE.md` carried three rules
 * stamped "Adopted 2026-08-16", "2026-08-17" and "2026-08-19" — all three
 * later than the file's own last modification and later than every commit in
 * the repo. Nothing was mistyped. An agent wrote a *plausible* date because
 * it had none, which is the same failure as a generated candidate position:
 * a confident claim with no source behind it. An agent does not know what
 * day it is. This is where it finds out.
 *
 * **The timezone is not optional.** `new Date().toISOString().slice(0, 10)`
 * is the obvious one-liner and it is wrong for seven hours out of every
 * twenty-four here: after 5pm Phoenix time UTC has already rolled over, so
 * the obvious read returns tomorrow. That is this bug's smaller sibling and
 * it produces exactly the same artifact — a document claiming to know
 * something about a day that has not happened. `git-state.txt` generated at
 * `2026-08-15T04:01:34Z` was 9:01pm on the 14th, and reading the Z off it is
 * how a session dates its own work a day early.
 *
 *   pnpm stamp            2026-08-14
 *   pnpm stamp --iso      2026-08-14T21:01:34-07:00   (full local instant)
 *
 * `en-CA` is used purely because it formats as ISO. It is a formatting
 * trick, not a claim about where anybody is.
 *
 * The day itself is computed in `scripts/doc-dates.mjs` and re-exported here,
 * not reimplemented. Three callers need it — this command, the suite, and the
 * pre-commit hook — and a rule about dates enforced by three copies of a
 * timezone calculation would be exactly the joke it sounds like. That module
 * is plain JavaScript so the hook can load it with no type stripping in the
 * path; this file is the command around it.
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
