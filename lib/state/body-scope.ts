import type { Meeting } from "../sources/types.ts";

/**
 * **THE BODY SCOPE'S KEY HAS ONE CONSTRUCTOR.** (2026-09-23.)
 *
 * `UiState.body` was typed `OcdId | null`, and that was false: the value the
 * Body dropdown dispatches, and the value `applyFilters` compares against, is
 * `<ocdId>|<bodyName>`. The district card's "Upcoming N" door (BC-8) believed
 * the type and dispatched a bare division OCD-ID. No meeting's key can ever
 * equal a bare OCD-ID, so the door opened "0 meetings — Nothing matches the
 * current filters" under a card that had just said "Upcoming 3", and the scope
 * then emptied every pin and list until "Reset all" — while the Body dropdown,
 * which had no option for that value, read "All bodies". Measured at 85701 on
 * Tucson Unified, 2026-09-23.
 *
 * A branded string closes the class rather than the instance: the only way to
 * make a `BodyScopeKey` is `bodyScopeKey`, from a meeting, so a division id,
 * a body id or a display name handed to `scope/body` is a type error.
 */
export type BodyScopeKey = string & { readonly __bodyScopeKey: never };

/** The one constructor, shared by the dropdown that offers it and the filter that matches it. */
export function bodyScopeKey(meeting: Pick<Meeting, "ocdId" | "bodyName">): BodyScopeKey {
  return `${meeting.ocdId}|${meeting.bodyName}` as BodyScopeKey;
}
