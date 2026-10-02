/**
 * The generated-at stamp for GENERATED DOCUMENTS, in Eastern time (R18).
 *
 * ## The ruling and its exact scope
 *
 * Since 2026-08-17, generated-at lines carry Eastern as the standard. That
 * rule is about the "this file was written at ..." header
 * line on documents a script generates, and nothing else.
 *
 * It does NOT touch `pnpm stamp`, which stays America/Phoenix. Those are
 * different jobs and collapsing them would be a defect: `stamp` answers "what
 * DAY is it for the author", which is what dates a rule, a tracker note or a
 * reader-facing line — and CLAUDE.md's whole date doctrine is built on that
 * one wall clock. This answers "at what INSTANT did this file get written",
 * which is provenance on a machine-written artifact. A document can carry both,
 * and `context.md` deliberately does.
 *
 * It also does not touch `generatedAt` fields inside JSON DATA artifacts
 * (fetch-votes, intake-tripwire, build-street-index and friends). Those are
 * machine fields consumed by other code, where ISO-8601 UTC is the correct and
 * unambiguous form. Changing them would be reformatting data to satisfy a
 * ruling about prose.
 *
 * ## Why the abbreviation is not hardcoded to "EST"
 *
 * The ruling says EST, and in August Eastern is on daylight time — EDT, UTC-4,
 * not EST, UTC-5. Printing the letters "EST" beside an EDT instant would be a
 * stamp that misstates its own zone for two-thirds of the year, which is the
 * failure this repo's date doctrine exists to prevent, wearing a smaller hat.
 *
 * So the zone is `America/New_York` — Eastern, which is what "EST" means when
 * a person says it — and the abbreviation is whatever that zone is actually in
 * at the instant being stamped. The letters read EST in January and EDT in
 * August, and both are true.
 */

/** The zone the ruling names. Not a fixed offset — Eastern observes DST. */
export const GENERATED_AT_ZONE = "America/New_York";

/**
 * Format an instant as `2026-08-17 11:53:22 EDT`.
 *
 * Intl supplies both the wall clock and the zone's own abbreviation for that
 * instant, so the two can never disagree — deriving the label separately is
 * how a stamp ends up claiming a zone it is not in.
 */
export function generatedAtEastern(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GENERATED_AT_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl renders midnight as hour "24" in some ICU versions; normalize it.
  const hour = get("hour") === "24" ? "00" : get("hour");

  return (
    `${get("year")}-${get("month")}-${get("day")} ` +
    `${hour}:${get("minute")}:${get("second")} ${get("timeZoneName")}`
  );
}
