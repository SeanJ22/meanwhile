import type { Meeting } from "../sources/types.ts";

import type { UiAction, UiState } from "./types.ts";

/**
 * A count opens the list it counts. The district card's "Upcoming N" door
 * focuses the list on exactly the rows the card counted, through the same
 * predicate:
 *
 * - `divisionUpcoming` is the card's count AND the list's rows;
 * - `showDivisionUpcoming` is the door's whole action;
 * - `focusList` is what the list overlay renders from.
 *
 * A focus is not a filter: it belongs to one opening, the reducer clears it
 * when the list closes, the overlay names it in a clearable chip, and a focus
 * that matches nothing falls back to every row.
 */

type Focusable = Pick<Meeting, "ocdId" | "status"> & { bodyId?: string };

/** The division's scheduled sittings — the district card's "Upcoming" count. */
export function divisionUpcoming<T extends Focusable>(meetings: readonly T[], ocdId: string): T[] {
  return meetings.filter((meeting) => meeting.ocdId === ocdId && meeting.status === "SCHEDULED");
}

/** Everything the "Upcoming N" door dispatches. */
export function showDivisionUpcoming(division: { ocdId: string; label: string }): UiAction[] {
  return [
    // The card minimizes …
    { type: "select/district", ocdId: null, districtType: null },
    // … and the list opens on exactly the rows the card counted.
    { type: "list/open", open: true, focusDivision: { ocdId: division.ocdId, name: division.label } },
  ];
}

export interface FocusedList<T> {
  /** The rows the overlay renders. */
  list: T[];
  /** A focus is narrowing the list right now. */
  applied: boolean;
  /** A focus was asked for, matched nothing, and the full list stands in its place. */
  unmatched: boolean;
  /** The chip's words, when a focus was asked for. */
  chip: string | null;
}

/**
 * The list overlay's rows under the current focus.
 *
 * A division focus (the district card's door) wins over a body focus (an Ask
 * answer's pill); both come from one opening and the reducer clears both when
 * the list closes.
 */
export function focusList<T extends Focusable>(
  meetings: readonly T[],
  ui: Pick<UiState, "listFocusDivision" | "listFocusBodyId" | "listFocusBodyName">,
): FocusedList<T> {
  if (ui.listFocusDivision) {
    const hit = divisionUpcoming(meetings, ui.listFocusDivision.ocdId);
    return hit.length > 0
      ? { list: hit, applied: true, unmatched: false, chip: `Only upcoming meetings for ${ui.listFocusDivision.name}` }
      : { list: [...meetings], applied: false, unmatched: true, chip: `No upcoming ${ui.listFocusDivision.name} meetings in this window — showing every meeting` };
  }
  if (ui.listFocusBodyId) {
    const hit = meetings.filter((meeting) => meeting.bodyId === ui.listFocusBodyId);
    const name = ui.listFocusBodyName;
    return hit.length > 0
      ? { list: hit, applied: true, unmatched: false, chip: name ? `Only ${name}` : null }
      : { list: [...meetings], applied: false, unmatched: true, chip: name ? `No ${name} sittings in this window — showing every meeting` : null };
  }
  return { list: [...meetings], applied: false, unmatched: false, chip: null };
}
