/**
 * The fixtures the expansion end-to-end tests share (`tests/auto-crosswalk-expansion.test.ts`,
 * `tests/expansion-any-state.test.ts`): a calendar's bytes, a wall-clock start, and the reviewed registry's ids
 * that registration derives against.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOUR = 3_600_000;

/** `DTSTART;TZID=America/New_York` a whole number of days after `base` (ms), at a wall-clock hour. */
export function localStart(base: number, days: number, hour: number): string {
  const d = new Date(base + days * 24 * HOUR);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${ymd}T${String(hour).padStart(2, "0")}0000`;
}

/** An iCal feed in America/New_York with these events. */
export function ics(events: readonly { uid: string; summary: string; start: string }[]): string {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-TIMEZONE:America/New_York",
    ...events.flatMap((e) => ["BEGIN:VEVENT", `UID:${e.uid}`, `SUMMARY:${e.summary}`, `DTSTART;TZID=America/New_York:${e.start}`, "END:VEVENT"]),
    "END:VCALENDAR", "",
  ].join("\r\n");
}

/** The reviewed registry's ids, from its committed first seed, as registration derives against them. */
export function reviewedIds(root: string) {
  const registry = JSON.parse(readFileSync(join(root, "lib", "registry", "registry.json"), "utf8")) as { divisions: { ocdId: string }[]; bodies: { id: string; ocdId: string | null }[] };
  return {
    versionId: "cv-reviewed-first-seed",
    divisionIds: new Set(registry.divisions.map((d) => d.ocdId)),
    bodyIds: new Set(registry.bodies.map((b) => b.id)),
    bodyDivisionIds: new Set(registry.bodies.map((b) => b.ocdId).filter((id): id is string => typeof id === "string")),
  };
}
