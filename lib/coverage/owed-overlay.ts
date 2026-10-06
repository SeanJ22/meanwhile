/**
 * **WHAT SEAN ADDED TO, OR DECLINED FROM, WHAT A PLACE IS OWED (SC-14, BR-33).**
 *
 * The State Run Checklist is data (`checklist-map.json`). On top of it sits this one record on the Admin config row: items Sean
 * added to what is owed, and rows Sean declined, each with its reason, who (the admin session, never a name) and when, and a log
 * with undo, as settings have. Reading it needs no release: the next read of a place builds its owed list with it.
 *
 * - An **addition** is a new checklist item in a family that exists. Wherever that family applies, the item is owed and counts in
 *   the core score, so completeness honestly drops until it is filled.
 * - A **decline** removes one row (this subject, this item) from what is owed. Additions stay automatic; declines are Sean's.
 *
 * Nothing here gates publishing: it changes what is counted as owed, never what may be shown to a reader.
 * PURE except for the one active-overlay slot, which a reader of the config row sets before it builds an owed list.
 */
import { CHECKLIST_FAMILIES, CHECKLIST_ITEMS, type ChecklistItemRule } from "./checklist-map.ts";
import { installOwedOverlay, NO_OWED_OVERLAY, type ActiveOwedOverlay } from "./owed-overlay-slot.ts";

export interface OwedAddition {
  /** The receipt that added it; stable. */
  readonly changeId: string;
  /** The checklist id it carries, e.g. `MTG-X1`. Never shown in Admin outside Technical details. */
  readonly id: string;
  readonly group: string;
  readonly requirement: string;
  readonly label: string;
  readonly addedAt: string;
  /** The admin session; a person is never named. */
  readonly addedBy: string;
  readonly reason: string;
  readonly undone: { readonly changeId: string; readonly at: string } | null;
}

export interface OwedDecline {
  readonly changeId: string;
  /** The owed-list row identity: `[subjectId, checklistId]` as JSON. */
  readonly rowId: string;
  readonly placeKey: string;
  readonly subjectLabel: string;
  readonly requirement: string;
  readonly declinedAt: string;
  readonly declinedBy: string;
  readonly reason: string;
  readonly undone: { readonly changeId: string; readonly at: string } | null;
}

export interface OwedOverlayLogEntry {
  readonly changeId: string;
  readonly kind: "add" | "decline" | "undo";
  readonly at: string;
  readonly says: string;
  readonly undoOf?: string;
}

export interface OwedOverlayRecord {
  readonly additions: readonly OwedAddition[];
  readonly declines: readonly OwedDecline[];
  readonly log: readonly OwedOverlayLogEntry[];
  readonly updatedAt: string;
}

export const OWED_LOG_MAX = 500;
export const OWED_ADDITIONS_MAX = 200;
export const OWED_DECLINES_MAX = 2000;
export const EMPTY_OWED_OVERLAY: OwedOverlayRecord = { additions: [], declines: [], log: [], updatedAt: "" };

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The families a new item can be added to: the place families the checklist already has, by their first-letter code. */
export function addableFamilies(): readonly { readonly group: string; readonly name: string }[] {
  return Object.entries(CHECKLIST_FAMILIES)
    .filter(([, family]) => family.squad !== null)
    .map(([group, family]) => ({ group, name: family.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type OwedChangeRefusal = { readonly ok: false; readonly says: string };

function activeAdditions(record: OwedOverlayRecord): readonly OwedAddition[] {
  return record.additions.filter((a) => a.undone === null);
}
function activeDeclines(record: OwedOverlayRecord): readonly OwedDecline[] {
  return record.declines.filter((d) => d.undone === null);
}

const keepLog = (log: readonly OwedOverlayLogEntry[], entry: OwedOverlayLogEntry): readonly OwedOverlayLogEntry[] => {
  const next = [...log, entry];
  return next.length > OWED_LOG_MAX ? next.slice(next.length - OWED_LOG_MAX) : next;
};

/** The id a new item gets in its family: `<FAMILY>-X<n>`, n counting every item ever added there so an undone id is never reused. */
export function nextAdditionId(record: OwedOverlayRecord, group: string): string {
  const used = record.additions.filter((a) => a.group === group).length;
  return `${group}-X${used + 1}`;
}

export function withOwedAddition(record: OwedOverlayRecord, input: { readonly changeId: string; readonly group: string; readonly requirement: string; readonly reason: string; readonly at: string; readonly addedBy: string }): OwedOverlayRecord | OwedChangeRefusal {
  if (record.log.some((e) => e.changeId === input.changeId)) return record;
  if (!CHECKLIST_FAMILIES[input.group] || CHECKLIST_FAMILIES[input.group]?.squad === null) return { ok: false, says: "Choose a family the checklist already has." };
  const requirement = collapse(input.requirement);
  if (requirement.length < 4 || requirement.length > 200) return { ok: false, says: "Say what is owed in 4 to 200 characters." };
  const reason = collapse(input.reason);
  if (reason === "") return { ok: false, says: "Give the reason it is owed." };
  if (reason.length > 2000) return { ok: false, says: "Keep the reason to 2,000 characters." };
  if (activeAdditions(record).some((a) => a.group === input.group && a.requirement.toLowerCase() === requirement.toLowerCase())) return { ok: false, says: "That is already owed in this family." };
  if (activeAdditions(record).length >= OWED_ADDITIONS_MAX) return { ok: false, says: "Too many added items; undo one first." };
  const id = nextAdditionId(record, input.group);
  const addition: OwedAddition = { changeId: input.changeId, id, group: input.group, requirement, label: requirement, addedAt: input.at, addedBy: input.addedBy, reason, undone: null };
  return { ...record, additions: [...record.additions, addition], log: keepLog(record.log, { changeId: input.changeId, kind: "add", at: input.at, says: `Added to what is owed: ${requirement}` }), updatedAt: input.at };
}

export function withOwedDecline(record: OwedOverlayRecord, input: { readonly changeId: string; readonly declines: readonly Omit<OwedDecline, "changeId" | "declinedAt" | "declinedBy" | "reason" | "undone">[]; readonly reason: string; readonly at: string; readonly declinedBy: string }): OwedOverlayRecord | OwedChangeRefusal {
  if (record.log.some((e) => e.changeId === input.changeId)) return record;
  const reason = collapse(input.reason);
  if (reason === "") return { ok: false, says: "Give the reason it is declined." };
  if (reason.length > 2000) return { ok: false, says: "Keep the reason to 2,000 characters." };
  const already = new Set(activeDeclines(record).map((d) => `${d.placeKey}|${d.rowId}`));
  const fresh = input.declines.filter((d) => !already.has(`${d.placeKey}|${d.rowId}`));
  if (fresh.length === 0) return { ok: false, says: "Those items are already declined." };
  if (activeDeclines(record).length + fresh.length > OWED_DECLINES_MAX) return { ok: false, says: "Too many declined items; undo some first." };
  const made = fresh.map((d, n): OwedDecline => ({ ...d, changeId: n === 0 ? input.changeId : `${input.changeId}#${n + 1}`, declinedAt: input.at, declinedBy: input.declinedBy, reason, undone: null }));
  return { ...record, declines: [...record.declines, ...made],
    log: keepLog(record.log, { changeId: input.changeId, kind: "decline", at: input.at, says: `Declined ${made.length} ${made.length === 1 ? "item" : "items"}: ${reason}` }), updatedAt: input.at };
}

/** Undo a change by its id (an add, or a decline with all the rows it declined). A change already undone is refused. */
export function withOwedUndo(record: OwedOverlayRecord, input: { readonly undoChangeId: string; readonly changeId: string; readonly at: string }): OwedOverlayRecord | OwedChangeRefusal {
  if (record.log.some((e) => e.changeId === input.changeId)) return record;
  const base = input.undoChangeId.replace(/#\d+$/, "");
  const entry = record.log.find((e) => e.changeId === base && e.kind !== "undo");
  if (!entry) return { ok: false, says: "That change is not in the log." };
  if (record.log.some((e) => e.kind === "undo" && e.undoOf === base)) return { ok: false, says: "That change was already undone." };
  const mark = { changeId: input.changeId, at: input.at };
  const additions = record.additions.map((a) => (a.changeId === base ? { ...a, undone: mark } : a));
  const declines = record.declines.map((d) => (d.changeId.replace(/#\d+$/, "") === base ? { ...d, undone: mark } : d));
  return { ...record, additions, declines, log: keepLog(record.log, { changeId: input.changeId, kind: "undo", at: input.at, says: `Undid: ${entry.says}`, undoOf: base }), updatedAt: input.at };
}

/* ------------------------------------------------------ the active overlay */

/** The rule a family's new item gets: owed wherever the family applies, counted in the core score, placed by the family's own unit. */
function ruleFor(group: string): ChecklistItemRule {
  const first = Object.entries(CHECKLIST_ITEMS).find(([id, rule]) => id.startsWith(`${group}-`) && rule?.scoreAs === "core");
  return { unit: first?.[1]?.unit ?? "division", trigger: "always", due: "now", predicateKind: "fact", scoreAs: "core", countsAs: "row" };
}

export function overlayFrom(record: OwedOverlayRecord | null | undefined): ActiveOwedOverlay {
  if (!record || (record.additions.length === 0 && record.declines.length === 0)) return NO_OWED_OVERLAY;
  const additions = activeAdditions(record);
  return {
    definitions: additions.map((a) => ({ id: a.id, group: a.group, requirement: a.requirement, owner: "Agents", label: a.label, addedAt: a.addedAt })),
    rules: Object.fromEntries(additions.map((a) => [a.id, ruleFor(a.group)])),
    declinedRows: new Set(activeDeclines(record).map((d) => d.rowId)),
    revision: `${record.updatedAt}:${additions.length}:${activeDeclines(record).length}`,
  };
}

/** Make this record the one every owed list built from now on uses. A missing or empty record clears it. */
export function setActiveOwedOverlay(record: OwedOverlayRecord | null | undefined): ActiveOwedOverlay {
  return installOwedOverlay(overlayFrom(record));
}
