import { createHash } from "node:crypto";

/**
 * **A-005 · IDENTITY FOR AN EVENT THE FEED DID NOT IDENTIFY.**
 * (External correctness audit of `336a3eb`, remediated 2026-08-24.)
 *
 * ## What was wrong
 *
 * `ical` built a meeting id as `ical:<slug>:<UID ?? start.iso>`. A feed that
 * publishes `UID` is fine. A feed that does not — and plenty do not — fell back
 * to **the start instant alone**, so any two events in one wiring row that
 * began at the same moment collapsed to one id. The second was swallowed by the
 * `seen` set with no drop counter, no duplicate counter, and no line anywhere
 * saying a meeting had been discarded.
 *
 * ## Why it is not an edge case
 *
 * Same-night, same-time sittings are the NORM in the towns this product exists
 * for. A Zoning Board at 7pm and a Conservation Commission at 7pm on alternate
 * Tuesdays in the same town hall is how small New England government schedules
 * itself, and where one calendar feed serves a whole town — which is exactly
 * the shape this adapter was written for, Newbury's 1,157-event feed — those
 * two events sit in the same row.
 *
 * So the class of body most likely to lose a meeting was the class of body
 * nobody else covers. That is the equal-effort failure arriving through a hash
 * function.
 *
 * ## What identity is instead
 *
 * Everything the feed DID publish about the event: the body slug, the start
 * instant, the summary, the location and the description. Two records agreeing
 * on all five are the same sitting published twice; two differing anywhere are
 * two sittings.
 *
 * **It is deliberately a HASH of the fields rather than the fields joined.**
 * A summary or a location carrying a colon would otherwise change how the id
 * splits, and `lib/meetings/*` splits meeting ids on `:` to recover the source
 * name. A fixed-width hex digest cannot do that.
 *
 * **And a collision judged here is COUNTED as a distinct kind.** An exact
 * duplicate is the feed publishing one UID twice — its statement. A weak-id
 * collision is this code deciding two records are the same sitting without the
 * feed saying so — our judgement. Pooling them would hide the one worth
 * watching inside the one that is routine.
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
