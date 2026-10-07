import { squadOf } from "./checklist-map.ts";
import type { PlaceOwedItem } from "./place-owed.ts";

/**
 * A place's open blanks (apply, due, unsatisfied, not being worked), grouped by
 * squad then subject. A blank with unresolved applicability or due date stays
 * open. Reads the owed list only; creates no work and never gates publishing. Pure.
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
