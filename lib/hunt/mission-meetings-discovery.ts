/**
 * **MEETINGS DISCOVERY FOLLOWS THE MISSION MAP.** (CH-21, 2026-10-05.)
 *
 * A Send's mission map (the owed list, `lib/coverage/place-owed.ts`) owes every
 * body in its places a calendar: the body's own publisher route (MTG-01) and
 * the rest of the calendar items. Where that route is not held, the body's
 * meetings are still to be found, and the free discovery walk is the first
 * hunter on it. This module turns those calendar blanks into discovery needs
 * in the shape the walk already takes (`MeetingsDiscoveryNeed`), from the same
 * registry derivation the owner's dispatch uses (`meetingsDiscoveryNeeds`).
 *
 * It replaces the committed gap ledger in both of its jobs:
 *
 * - **what the walk walks:** every government in a mission place whose body has
 *   no held calendar route, in any state, with no dispatch needed;
 * - **the evidence an old jurisdiction meetings row retires on:** the body has a
 *   held calendar route on the owed rows (`heldCalendarRouteBodies`).
 *
 * PURE: the caller reads the owed list, the registries and the body join.
 */

import type { PlaceOwedItem } from "../coverage/place-owed.ts";
import type { JurisdictionRegistry } from "./jurisdiction-universe.ts";
import { meetingsDiscoveryNeeds, withWebsiteCorrection, type MeetingsDiscoveryNeed } from "./meetings-discovery.ts";

/** The calendar row that names the body's own publisher route. */
export const CALENDAR_ROUTE_ITEM = "MTG-01";
/** A captured meeting's source: a meeting held from a route shows the body's route is held. */
export const MEETING_SOURCE_ITEM = "MTG-12";

const CALENDAR_SUFFIX = "#calendar";

type OwedRow = Pick<PlaceOwedItem, "subject" | "checklistId" | "held">;

/**
 * The bodies whose calendar route is held on these owed rows: the body's calendar
 * row (MTG-01) holds a captured route, or a meeting of the body was captured from
 * its source (MTG-12). A held route that is due a refresh is still held; a
 * government's statement that it publishes nothing is not a route.
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

/** A registry government id (`az:city:tucson`), never a division or another subject. */
function isGovernmentId(id: string): boolean {
  return /^[a-z]{2}:[a-z]+:[^#]+$/.test(id);
}

/**
 * The discovery needs for the governments in a mission's places whose body has no
 * held calendar route. A government is skipped only on evidence: its exact body
 * holds a route on the owed rows (`heldRoute`). A government with no exact body
 * join has no calendar row to read, so its blank stays open and it is walked.
 * A government whose registry records a wired meetings source has no need, by
 * the registry's own derivation. A state whose registry cannot be read is named,
 * and none of its governments are guessed at.
 */
export function missionMeetingsDiscoveryNeeds(input: {
  readonly jurisdictionIds: Iterable<string>;
  readonly registryFor: (stateCode: string) => JurisdictionRegistry;
  readonly bodyIdFor: (jurisdictionId: string) => string | null;
  readonly heldRoutes: ReadonlySet<string>;
}): {
  readonly entries: readonly { readonly need: MeetingsDiscoveryNeed; readonly reg: JurisdictionRegistry }[];
  /** Governments skipped because their body holds a calendar route. */
  readonly heldRoute: readonly string[];
  readonly failures: readonly string[];
} {
  const entries: { need: MeetingsDiscoveryNeed; reg: JurisdictionRegistry }[] = [];
  const heldRoute: string[] = [];
  const failures: string[] = [];
  const byState = new Map<string, { readonly reg: JurisdictionRegistry; readonly needs: ReadonlyMap<string, MeetingsDiscoveryNeed> } | null>();
  for (const id of [...new Set(input.jurisdictionIds)].filter(isGovernmentId).sort()) {
    const state = id.slice(0, 2);
    let held = byState.get(state);
    if (held === undefined) {
      try {
        const reg = input.registryFor(state);
        held = { reg, needs: new Map(meetingsDiscoveryNeeds([reg]).map((n) => [n.jurisdictionId, n])) };
      } catch (error) {
        failures.push(
          `the ${state.toUpperCase()} jurisdiction registry could not be read for its mission's meetings discovery ` +
            `(${error instanceof Error ? error.message : String(error)})`,
        );
        held = null;
      }
      byState.set(state, held);
    }
    if (held === null) continue;
    const need = held.needs.get(id);
    if (need === undefined) continue;
    const body = input.bodyIdFor(id);
    if (body !== null && input.heldRoutes.has(body)) {
      heldRoute.push(id);
      continue;
    }
    /* A reviewed website correction the registry does not carry yet is walked as reviewed (C15), as the ledger did. */
    entries.push({ need: withWebsiteCorrection(need), reg: held.reg });
  }
  return { entries, heldRoute, failures };
}
