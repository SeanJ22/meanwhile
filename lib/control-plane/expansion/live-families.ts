/**
 * Which information families a government already has live: every owed row
 * published and fresh, or shown as not published by the government, in the
 * held place capture. Such a family needs no discovery Scout; its refresh
 * stays scheduled. A family with no held row is never live.
 *
 * Pure.
 */
import { buildPlaceOwedList } from "../../coverage/place-owed.ts";
import type { HeldPlaceCapture } from "../../civic-data/held-place-capture.ts";

/** Discovery family (record class) -> the checklist groups whose rows it owes for a government. */
export const FAMILY_CHECKLIST_GROUPS: Readonly<Record<string, readonly string[]>> = {
  OFFICEHOLDERS: ["GOV", "OFF"],
};

export function liveFamiliesByGovernment(input: {
  readonly governments: readonly { readonly id: string; readonly ocdId?: string | null }[];
  readonly capture: HeldPlaceCapture;
  readonly now: string;
}): ReadonlyMap<string, ReadonlySet<string>> {
  const divisionIds = [...new Set(input.governments.map(g => g.ocdId).filter((id): id is string => !!id))];
  const result = new Map<string, ReadonlySet<string>>();
  if (divisionIds.length === 0) return result;
  const items = buildPlaceOwedList({ divisions: divisionIds.map(id => ({ id, label: id })),
    subjects: input.capture.subjects, held: input.capture.held, now: input.now })
    .filter(item => !item.subject.id.includes("#inventory:"));
  for (const government of input.governments) {
    if (!government.ocdId) continue;
    const mine = items.filter(item => item.subject.divisionIds.includes(government.ocdId!));
    const live = new Set<string>();
    for (const [family, groups] of Object.entries(FAMILY_CHECKLIST_GROUPS)) {
      const rows = mine.filter(item => groups.includes(item.checklistId.slice(0, item.checklistId.indexOf("-"))));
      const held = rows.filter(item => item.held.length > 0);
      if (held.length > 0 && rows.every(item => item.state === "published" || item.state === "unpublished")) live.add(family);
    }
    if (live.size > 0) result.set(government.id, live);
  }
  return result;
}
