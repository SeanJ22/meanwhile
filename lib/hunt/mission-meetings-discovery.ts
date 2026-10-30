/**
 * Meetings discovery follows the mission map. The owed list
 * (`lib/coverage/place-owed.ts`) owes every body in a mission's places a
 * calendar; where the body's own publisher route is not held, this turns that
 * blank into a discovery need (`MeetingsDiscoveryNeed`) for the free walk,
 * from the same registry derivation the owner's dispatch uses. A body with a
 * held calendar route on the owed rows (`heldCalendarRouteBodies`) is the
 * evidence an old jurisdiction meetings row retires on. Pure.
 */

import type { PlaceOwedItem } from "../coverage/place-owed.ts";

/** The calendar row that names the body's own publisher route. */
export const CALENDAR_ROUTE_ITEM = "MTG-01";
/** A captured meeting's source: a meeting held from a route shows the body's route is held. */
export const MEETING_SOURCE_ITEM = "MTG-12";

const CALENDAR_SUFFIX = "#calendar";

type OwedRow = Pick<PlaceOwedItem, "subject" | "checklistId" | "held">;

/**
 * The bodies whose calendar route is held on these owed rows: the body's
 * calendar row holds a captured route, or a meeting of the body was captured
 * from its source. A held route due a refresh is still held; a government's
 * statement that it publishes nothing is not a route.
 */
export function heldCalendarRouteBodies(rows: readonly OwedRow[]): ReadonlySet<string> {
  const bodies = new Set<string>();
  for (const row of rows) {
    if (!row.held.some((field) => field.state !== "unpublished" && field.sourceUrl !== "")) continue;
    const subject = row.subject;
    if (row.checklistId === CALENDAR_ROUTE_ITEM && subject.captureKind === "body-calendar" && subject.id.endsWith(CALENDAR_SUFFIX)) {
      bodies.add(subject.id.slice(0, -CALENDAR_SUFFIX.length));
    } else if (row.checklistId === MEETING_SOURCE_ITEM && subject.captureKind === "meeting" && subject.calendarBodyId) {
      bodies.add(subject.calendarBodyId);
    }
  }
  return bodies;
}

