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

/**
 * **IDENTITY FOR A SITTING TWO ROUTES NUMBER DIFFERENTLY.** (2026-08-28.)
 *
 * ## Why the publisher's own id cannot be the key here
 *
 * Granicus publishes the same Legistar meeting through two routes that do not
 * share an id space. `webapi.legistar.com/v1/pima/events` calls the Board of
 * Supervisors' 25 August sitting **1825**; the portal's own calendar grid calls
 * the same sitting **1381574**, and the WebAPI item endpoint 404s on the
 * portal's number. Measured 2026-08-28 across the seven August sittings both
 * routes carry: **7 of 7 agree on the body, the date and the time, and 0 of 7
 * agree on the id.**
 *
 * So keying identity on the vendor's identifier would publish every one of
 * those meetings twice, and the fix is not to prefer one route — it is to key
 * on what the two routes actually agree about.
 *
 * ## The key
 *
 * `body | local date | local wall-clock time`. WHICH BODY sat, on WHAT DAY, at
 * WHAT TIME, in the body's own zone.
 *
 * - **The body, not the division.** Six bodies share `county:pima`; a division
 *   key would merge two different bodies meeting at nine o'clock.
 * - **Local date and local TIME, not a bare instant.** They are the same thing
 *   for a fixed zone, and they are what a clerk publishes and a reader reads.
 * - **The kind is NOT in the key.** Pima's 8 September sittings are a 1:00 PM
 *   study session and a 5:00 PM regular meeting: the TIME already separates
 *   them. Putting "Study Session" in the key would split one sitting into two
 *   the moment one route wrote the kind and the other left it blank — which is
 *   exactly what these two routes do.
 *
 * ## What it deliberately does not collapse
 *
 * Two bodies at one time stay two sittings. One body twice in a day stays two
 * sittings. **Two routes disagreeing about the TIME stay two sittings**, which
 * is a finding rather than a merge: a published disagreement about when a
 * public meeting starts is something a reader should see, not something we
 * should average.
 */
export interface SittingKeyFields {
  /** The registry body id — the strongest thing available. */
  bodyId?: string | null;
  /** WHERE, used only when there is no body id. */
  ocdId?: string | null;
  /** Display geography, the last resort so two division-less bodies cannot collide. */
  jurisdiction?: string | null;
  /** ISO 8601 WITH OFFSET, as every adapter writes it. */
  startsAt: string;
  /** The IANA zone the body meets in. */
  timeZone: string;
}

/** The separator, chosen because it cannot occur in an id, a date or a clock. */
const UNIT_SEPARATOR = "";

/**
 * The local calendar date and wall-clock time an instant lands on in a zone.
 *
 * `Intl` rather than string surgery on `startsAt`, because two adapters write
 * the same moment differently — `2026-09-08T13:00:00-07:00` from one and
 * `2026-09-08T20:00:00.000Z` from another — and a comparison that cannot see
 * through an offset is not a comparison of times.
 */
export function localWallClock(
  startsAt: string,
  timeZone: string,
): { date: string; time: string } | null {
  const at = Date.parse(startsAt);
  if (!Number.isFinite(at)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // Some ICU builds render midnight as "24"; normalize so two spellings of one
  // minute cannot key differently.
  const hour = get("hour") === "24" ? "00" : get("hour");
  if (!get("year") || !hour) return null;
  return { date, time: `${hour}:${get("minute")}` };
}

/**
 * The cross-route identity of one sitting, or null when the record cannot be
 * placed in time.
 *
 * Null rather than a fallback key: a record with an unparseable start has no
 * sitting identity, and giving it one would let two unrelated unparseable
 * records merge into one meeting.
 */
export function sittingKey(fields: SittingKeyFields): string | null {
  const local = localWallClock(fields.startsAt, fields.timeZone);
  if (!local) return null;
  const who =
    fields.bodyId ??
    (fields.ocdId ? `division:${fields.ocdId}` : null) ??
    (fields.jurisdiction ? `jurisdiction:${fields.jurisdiction}` : null);
  if (!who) return null;
  return [who, local.date, local.time].join(UNIT_SEPARATOR);
}

/**
 * **WHICH ROUTE SUPPLIED THIS FIELD.**
 *
 * `Provenance` on a `Meeting` names the record's source — one URL, one
 * organisation, one collection time. That is right while a record comes from
 * one place, and these records do not: the grid supplies the location and the
 * meeting kind, the RSS supplies the instant InSite first published the
 * sitting, the per-meeting iCalendar export confirms the wall clock, and the
 * WebAPI supplies the agenda file once the clerk finalises it. A merged record
 * naming a single source would be citing one route for a field another route
 * is the authority on.
 */
export type SittingRoute =
  | "INSITE_CALENDAR_GRID"
  | "INSITE_CALENDAR_RSS"
  | "INSITE_ICAL_EXPORT"
  | "LEGISTAR_WEBAPI_EVENTS";

export interface SittingFieldProvenance {
  /** The meeting id this describes. */
  meetingId: string;
  /** Its cross-route identity — see `sittingKey`. */
  key: string;
  /** Field name to the route that supplied its value. */
  fields: Record<string, SittingRoute>;
  /** The portal's own meeting id, when a portal route supplied the record. */
  insiteId?: string | null;
  /** Mandatory alongside the id on `View.ashx`; carried so a later run can re-read. */
  insiteGuid?: string | null;
  /** The WebAPI's `EventId`, when that route supplied the record. */
  legistarEventId?: number | null;
  /**
   * When the publisher itself first published this sitting, from the RSS
   * `pubDate`. Null when no feed item was read — never a stand-in date.
   */
  firstPublishedAt?: string | null;
}

/** The part of `Meeting` supersession actually reads. */
export interface MeetingLike {
  id: string;
  bodyId?: string;
  ocdId?: string | null;
  jurisdiction?: string;
  bodyName?: string;
  title?: string;
  startsAt: string;
  timeZone: string;
  status?: string;
  agendaUrl?: string | null;
}

/**
 * How a sitting changed between two readings of the public record.
 *
 * Keyed on the SOURCE's own stable identifier (the namespaced meeting id, which
 * carries the portal's number) rather than on `sittingKey`, because the thing
 * most worth catching — a sitting moved to another time — is precisely a change
 * of the sitting key.
 */
export type SittingChange =
  | { kind: "NEW"; meeting: MeetingLike }
  | { kind: "UNCHANGED"; meeting: MeetingLike }
  | { kind: "RESCHEDULED"; meeting: MeetingLike; from: string; to: string }
  | { kind: "CANCELED"; meeting: MeetingLike }
  | { kind: "UPDATED"; meeting: MeetingLike; changed: string[] }
  /**
   * The row was in the earlier reading and is not in the later one.
   *
   * **This is NOT a cancellation and may never be rendered as one.** A row can
   * leave a grid because the range filter moved past it, because the portal was
   * partially served, or because the clerk re-filed it — and "the calendar no
   * longer lists it" is a fact about our reading, not about the body. The
   * earlier record is carried with its own provenance and the state is named,
   * so a surface can say what is true instead of asserting an absence.
   */
  | { kind: "ABSENT_FROM_LATEST"; meeting: MeetingLike };

/**
 * Reconcile an earlier reading of a body's calendar against a later one.
 *
 * Both arrays are readings of the SAME source. This only says what the public
 * record now says, in terms that keep a body's decision distinct from our own
 * retrieval; the caller decides what to do with it.
 */
export function reconcileSittings(
  previous: MeetingLike[],
  current: MeetingLike[],
): SittingChange[] {
  const before = new Map(previous.map((m) => [m.id, m]));
  const changes: SittingChange[] = [];

  for (const meeting of current) {
    const was = before.get(meeting.id);
    before.delete(meeting.id);

    if (!was) {
      changes.push({ kind: "NEW", meeting });
      continue;
    }
    // A cancellation the body itself declared outranks every other difference:
    // a sitting that moved AND was called off is called off.
    if (meeting.status === "CANCELED" && was.status !== "CANCELED") {
      changes.push({ kind: "CANCELED", meeting });
      continue;
    }
    if (Date.parse(meeting.startsAt) !== Date.parse(was.startsAt)) {
      changes.push({
        kind: "RESCHEDULED",
        meeting,
        from: was.startsAt,
        to: meeting.startsAt,
      });
      continue;
    }
    const changed = (["title", "bodyName", "agendaUrl", "status"] as const).filter(
      (field) => (meeting[field] ?? null) !== (was[field] ?? null),
    );
    changes.push(
      changed.length > 0
        ? { kind: "UPDATED", meeting, changed }
        : { kind: "UNCHANGED", meeting },
    );
  }

  for (const meeting of before.values()) {
    changes.push({ kind: "ABSENT_FROM_LATEST", meeting });
  }

  return changes;
}
