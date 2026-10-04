import map from "./checklist-map.json" with { type: "json" };

/** The rules of the State Run Checklist v1.1 as data. The loader only reads
 * the overlay; it holds no rule of its own and never gates publication. */
export interface AppliesRule {
  readonly groups?: readonly string[];
  readonly ids?: readonly string[];
  readonly excludeIds?: readonly string[];
  readonly calendarItems?: "only" | "unless-body-calendar";
}

export const CHECKLIST_GROUPS: Readonly<Record<string, readonly string[]>> = map.groups;
export const DEADLINE_ITEMS: ReadonlySet<string> = new Set(map.deadlineItems);
export const CALENDAR_ITEMS: ReadonlySet<string> = new Set(map.calendarItems);
export const FRESHNESS_HOURS = map.freshnessHours;
export const MEETING_NEAR_WINDOW_MS = FRESHNESS_HOURS.meetingNearWindowDays * 24 * 3_600_000;

const RULES = map.appliesTo as unknown as Readonly<Record<string, AppliesRule | undefined>>;

/** Hours of freshness for a meeting-family field: tighter near the sitting. */
export function meetingFreshnessHours(startsAt: string, now: string): number {
  return Math.abs(Date.parse(startsAt) - Date.parse(now)) <= MEETING_NEAR_WINDOW_MS
    ? FRESHNESS_HOURS.meetingNear : FRESHNESS_HOURS.meetingFar;
}

/** Whether a captured record of this kind owes the checklist item. */
export function checklistItemApplies(captureKind: string | undefined, calendarBodyId: string | undefined,
  item: { readonly id: string; readonly group: string }): boolean {
  const rule = captureKind === undefined || captureKind === "note" ? undefined : RULES[captureKind];
  if (!rule) return true;
  if (rule.calendarItems === "only") return CALENDAR_ITEMS.has(item.id);
  if (rule.calendarItems === "unless-body-calendar") return !calendarBodyId || !CALENDAR_ITEMS.has(item.id);
  return (rule.groups?.includes(item.group) === true || rule.ids?.includes(item.id) === true)
    && !rule.excludeIds?.includes(item.id);
}
