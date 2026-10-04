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

export type ChecklistUnit = "division" | "body" | "seat" | "meeting" | "contest" | "candidate" | "funding" | "deadline" | "system";
export type ChecklistTrigger = "always" | "when-present" | "when-published" | "when-due" | "when-in-scope" | "when-offered" | "unknown";
export type ChecklistDue = "now" | "per-meeting" | "per-election" | "per-session" | "per-filing-period" | "per-fiscal-year" | "on-change" | "unknown";
export type PredicateKind = "fact" | "identity" | "source" | "freshness" | "reconciliation" | "separation" | "delivery" | "process" | "privacy";
export type ScoreAs = "core" | "extension" | "answer" | "operations" | "delivery" | "gate";
export type CountsAs = "row" | "shared" | "summary" | "superseded";

export interface ChecklistItemRule {
  /** What one blank is counted per. */
  readonly unit: ChecklistUnit;
  /** When the item applies. An unknown trigger means applicability is unresolved; the item is never dropped. */
  readonly trigger: ChecklistTrigger;
  readonly due: ChecklistDue;
  readonly predicateKind: PredicateKind;
  readonly scoreAs: ScoreAs;
  readonly countsAs: CountsAs;
  /** For a shared predicate: the ID it is counted under. */
  readonly into?: string;
  readonly replacedBy?: "admin";
  /** A posting-deadline item: when it falls due is counted from its meeting. */
  readonly lifecycle?: "agenda" | "outcome";
  /** What the item is called when it is awaiting publication ("Agenda not published yet"). */
  readonly noun?: string;
}

export const CHECKLIST_ITEMS = map.items as unknown as Readonly<Record<string, ChecklistItemRule | undefined>>;
export const CHECKLIST_FAMILIES = map.families as unknown as Readonly<Record<string, { readonly name: string; readonly squad: string | null }>>;
/** The starting squad for each family. A setting: Admin can change it. */
export const SQUAD_START = map.settings.squads as Readonly<Record<string, string>>;
export const LIFECYCLE = map.lifecycle;
export const REPLACED_BY_ADMIN = map.replacedByAdmin as Readonly<Record<string, string>>;

export function checklistItem(id: string): ChecklistItemRule | undefined {
  return CHECKLIST_ITEMS[id];
}

/** The squad that takes this item's family, from the starting setting unless Admin has set another. */
export function squadOf(id: string, settings: Readonly<Record<string, string>> = SQUAD_START): string | null {
  const group = id.slice(0, id.indexOf("-"));
  return settings[group] ?? null;
}

export function isCoreItem(id: string): boolean {
  return CHECKLIST_ITEMS[id]?.scoreAs === "core";
}

/** Applies now, applies only where a condition holds, or cannot be told. An unknown or unlisted trigger is unresolved, never dropped. */
export function applicabilityOf(id: string): "applies" | "conditional" | "unresolved" {
  const trigger = CHECKLIST_ITEMS[id]?.trigger ?? "unknown";
  return trigger === "always" ? "applies" : trigger === "unknown" ? "unresolved" : "conditional";
}

/** The ID an item is counted under: a shared predicate counts once, under its canonical item. */
export function canonicalItemId(id: string): string {
  const item = CHECKLIST_ITEMS[id];
  return item?.countsAs === "shared" && item.into ? item.into : id;
}

/** The owed-list subject kind a unit puts an item on. */
const UNIT_SUBJECT_KIND: Readonly<Record<ChecklistUnit, string | null>> = {
  division: "division", body: "body", seat: "seat", meeting: "calendar", contest: "contest", candidate: "contest",
  funding: "funding", deadline: "deadline", system: null,
};
export function subjectKindOfUnit(id: string): string | null {
  const item = CHECKLIST_ITEMS[id];
  return item ? UNIT_SUBJECT_KIND[item.unit] : null;
}

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
