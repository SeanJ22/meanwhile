import { squadOf } from "./checklist-map.ts";
import type { PlaceOwedItem } from "./place-owed.ts";

/**
 * **THE MISSION MAP'S OPEN BLANKS.** The rows of a place that apply, are due, are
 * not satisfied and are not already being worked, grouped by squad and then by
 * subject. This is what the coach hands to the squads and what the national job
 * reads to skip families with nothing open. A blank whose applicability or due
 * date is unresolved stays open: it is never dropped for being unclear. It only
 * reads the owed list; it creates no work and never gates publishing.
 *
 * PURE.
 */
export interface OpenBlanks {
  /** Every open blank, in the owed list's order. */
  readonly all: readonly PlaceOwedItem[];
  /** squad → subject id → blanks. A family no squad takes is grouped under "other". */
  readonly bySquad: ReadonlyMap<string, ReadonlyMap<string, readonly PlaceOwedItem[]>>;
}

export const OTHER_SQUAD = "other";

export function isOpenBlank(item: PlaceOwedItem): boolean {
  // Satisfied: captured fresh, published, or the government is verified not to publish it.
  if (item.state !== "missing" && item.state !== "stale") return false;
  if (item.statuses.due === "not-yet-due") return false;
  if (item.statuses.found === "in-progress") return false;
  return true;
}

export function openBlanksOf(items: readonly PlaceOwedItem[], squads?: Readonly<Record<string, string>>): OpenBlanks {
  const all = items.filter(isOpenBlank);
  const bySquad = new Map<string, Map<string, PlaceOwedItem[]>>();
  for (const item of all) {
    const squad = squadOf(item.checklistId, squads) ?? OTHER_SQUAD;
    const subjects = bySquad.get(squad) ?? new Map<string, PlaceOwedItem[]>();
    subjects.set(item.subject.id, [...(subjects.get(item.subject.id) ?? []), item]);
    bySquad.set(squad, subjects);
  }
  return { all, bySquad };
}
