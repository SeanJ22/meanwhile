import { createHash } from "node:crypto";

/**
 * Identity for an event the feed did not identify. Two events in one wiring row starting at the same
 * instant (common where one feed serves a whole town) must not collapse to one id.
 *
 * Identity is everything the feed did publish about the event: the body slug, the start instant, the
 * summary, the location and the description. Records agreeing on all five are the same sitting published
 * twice; records differing anywhere are two sittings. A hash of the fields, not the fields joined, so a
 * colon in a field cannot change how `lib/meetings/*` splits meeting ids on `:`. A weak-id collision (our
 * judgement) is counted separately from an exact duplicate (the feed repeating a UID).
 */
export interface WeakEventIdentityFields {
  /** The wiring row's slug — a body, not a town. */
  slug: string;
  /** The resolved start instant, ISO 8601. */
  startIso: string;
  summary: string | null;
  location: string | null;
  description: string | null;
}

/**
 * A stable identity for an event with no `UID`.
 *
 * The prefix `w-` marks it as WEAK in the id itself, so a meeting id read out
 * of a snapshot says whether its identity came from the publisher or from us.
 * That is the same discipline `carried` uses on a carried row: a value that was
 * inferred should say so where somebody will see it.
 */
export function weakEventIdentity(fields: WeakEventIdentityFields): string {
  const parts = [
    fields.slug,
    fields.startIso,
    (fields.summary ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    (fields.location ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    (fields.description ?? "").trim().toLowerCase().replace(/\s+/g, " "),
  ];
  // A unit separator, because it cannot appear in any of these fields and so
  // cannot let two different tuples produce one joined string.
  const digest = createHash("sha256").update(parts.join("")).digest("hex");
  return `w-${digest.slice(0, 16)}`;
}
