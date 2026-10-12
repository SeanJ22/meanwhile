/**
 * Local government meets in local time, and half of it observes DST while
 * Arizona doesn't. Rather than take a date library dependency for this, resolve
 * zone offsets through Intl.
 */

/** Milliseconds `tz` is ahead of UTC at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  // Intl renders hour 24 for midnight under hour12: false in some engines.
  const hour = get("hour") % 24;

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );

  // Intl formats to whole seconds; drop the source ms before differencing.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function formatOffset(offsetMs: number): string {
  if (offsetMs === 0) return "Z";
  const sign = offsetMs > 0 ? "+" : "-";
  const total = Math.abs(offsetMs) / 60000;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(Math.round(total % 60)).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * Build an ISO 8601 string with offset from a wall-clock time in a zone.
 *
 * `toZonedIso(2026, 8, 18, 17, 30, "America/Phoenix")` — 5:30 pm on August
 * 18th, as the agenda prints it — becomes `2026-08-18T17:30:00-07:00`.
 *
 * Resolved in two passes: guess that local equals UTC, correct by the offset at
 * that guess, then re-check in case the correction crossed a DST boundary.
 */
export function toZonedIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  let offset = zoneOffsetMs(new Date(wallClockAsUtc), timeZone);
  const corrected = zoneOffsetMs(new Date(wallClockAsUtc - offset), timeZone);
  if (corrected !== offset) offset = corrected;

  // Read the wall clock back out of the resolved instant. Round-tripping keeps
  // out-of-range input (day 32, hour 25) normalized rather than echoed.
  const instant = wallClockAsUtc - offset;
  const local = new Date(instant + offset);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-` +
    `${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:` +
    `${pad(local.getUTCMinutes())}:00${formatOffset(offset)}`
  );
}

/**
 * Wall-clock date `dayOffset` days from now in `timeZone`, at `hour:minute`.
 *
 * Used by the mock source so fixtures stay perpetually plausible instead of
 * aging into the past.
 */
export function isoDaysFromNow(
  dayOffset: number,
  hour: number,
  minute: number,
  timeZone: string,
  now: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  // Shift the calendar date in UTC space, where days are always 24h, then read
  // the shifted wall-clock date back out.
  const shifted = new Date(
    Date.UTC(get("year"), get("month") - 1, get("day")) +
      dayOffset * 86_400_000,
  );

  return toZonedIso(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    hour,
    minute,
    timeZone,
  );
}
