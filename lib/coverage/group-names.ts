import { CHECKLIST_FAMILIES, CHECKLIST_ITEMS } from "./checklist-map.ts";

/** Plain-English names for the checklist's families; a place family owes items to a place. Pure. */
const names = (keep: (group: string) => boolean): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(CHECKLIST_FAMILIES).filter(([group]) => keep(group)).map(([group, family]) => [group, family.name]));

/** The groups with at least one item a place owes: those whose items are not system-level. */
export const PLACE_GROUPS: ReadonlySet<string> = new Set(Object.entries(CHECKLIST_ITEMS)
  .filter(([, item]) => item?.unit !== "system").map(([id]) => id.slice(0, id.indexOf("-"))));

export const PLACE_GROUP_NAMES: Readonly<Record<string, string>> = names((group) => PLACE_GROUPS.has(group));
export const GROUP_NAMES: Readonly<Record<string, string>> = names(() => true);
