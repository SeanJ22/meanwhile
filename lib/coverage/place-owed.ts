import checklist from "../control-plane/readiness/checklist-profile.json" with { type: "json" };
import { divisionOwesGatedItem } from "./checklist-map.ts";
import { rowStatuses, type HuntEvidence, type RowStatuses } from "./place-statuses.ts";
import { CHECKLIST_GROUPS, DEADLINE_ITEMS, canonicalItemId, checklistItem, checklistItemApplies, subjectKindOfUnit } from "./checklist-map.ts";

/** A derived capture view, never a publication decision or a second store. */
export type PlaceSubjectKind = "zip" | "division" | "body" | "seat" | "legislature" | "rollcall" | "calendar" | "funding" | "contest" | "deadline";
/** The canonical reader supplies this from the record's schema, never its label. */
export type PlaceCaptureKind = "federal-legislator" | "state-legislator" | "executive" | "local-officeholder"
  | "campaign-finance" | "federal-campaign-finance" | "state-campaign-finance" | "public-finance" | "filing-deadline" | "voting-deadline"
  | "voting-sites" | "election-navigation" | "candidate" | "election-result" | "meeting" | "body-calendar" | "registry-body"
  | "federal-legislature" | "state-legislature";
export interface PlaceSubject {
  readonly id: string;
  readonly kind: PlaceSubjectKind;
  readonly divisionIds: readonly string[];
  readonly label: string;
  readonly captureKind?: PlaceCaptureKind;
  readonly calendarBodyId?: string;
  /** Census functional status from the held division, not its name or shape. */
  readonly funcstat?: string;
  /** A meeting's start, so a posting-deadline item can be dated from it. */
  readonly startsAt?: string;
}
export interface HeldPlaceField {
  readonly subjectId: string;
  readonly checklistId: string;
  readonly state: "published" | "held" | "unpublished";
  readonly sourceUrl: string;
  readonly checkedAt: string;
  readonly freshUntil: string;
  readonly value?: unknown;
  readonly workItemId?: string;
}
export interface PlaceOwedItem {
  readonly id: string;
  readonly subject: PlaceSubject;
  readonly checklistId: string;
  readonly requirement: string;
  readonly state: HeldPlaceField["state"] | "missing" | "stale";
  readonly held: readonly HeldPlaceField[];
  readonly label: string;
  /** The six statuses of this blank. `state` is the old blended state, kept for compatibility. */
  readonly statuses: RowStatuses;
}

const GROUPS = CHECKLIST_GROUPS as Readonly<Record<PlaceSubjectKind, readonly string[]>>;
const GROUPED = new Set(Object.values(GROUPS).flat());

/** A kind owes its families' items. A family no kind lists (reference data) is placed by each item's unit. */
function owedByKind(kind: PlaceSubjectKind, definition: { id: string; group: string }): boolean {
  return (GROUPS[kind] ?? []).includes(definition.group) || !GROUPED.has(definition.group) && subjectKindOfUnit(definition.id) === kind;
}

/** Broad kinds preserve unresolved work; a known record only owes its own facts.
 * The rules live in checklist-map.json. */
function appliesToRecord(subject: PlaceSubject, definition: { id: string; group: string }): boolean {
  return checklistItemApplies(subject.captureKind, subject.calendarBodyId, definition);
}

/** Canonical identities make a county fact reusable by every ZIP and every job.
 * Unknown inventories remain explicit discovery work; an empty input cannot
 * look like a place with no governments, seats, elections or funding. */
export function buildPlaceOwedList(input: {
  readonly divisions: readonly { readonly id: string; readonly label: string; readonly funcstat?: string }[];
  readonly subjects: readonly PlaceSubject[];
  readonly held: readonly HeldPlaceField[];
  readonly now: string;
  /** The ZIPs in the place, so ZIP-scope items are owed once per ZIP. Absent means the place's ZIPs are not known, not that it has none. */
  readonly zips?: readonly string[];
  /** What the hunt is doing about a blank, when known. Absent means not read, not "nothing to do". */
  readonly hunt?: (subjectId: string, checklistId: string) => HuntEvidence | null;
  /** The latest served-reader witness for a held work item. */
  readonly witness?: (workItemId: string) => "CONFIRMED" | "NOT_OBSERVED" | null;
}): PlaceOwedItem[] {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new Error("Invalid place capture time");
  const divisionIds = new Set(input.divisions.map(d => d.id));
  const subjects = new Map<string, PlaceSubject>();
  for (const subject of input.subjects) {
    if (!subject.divisionIds.some(id => divisionIds.has(id))) continue;
    const prior = subjects.get(subject.id);
    subjects.set(subject.id, { ...prior, ...subject,
      divisionIds: [...new Set([...(prior?.divisionIds ?? []), ...subject.divisionIds])] });
  }
  // The source route, enumeration and recurring schedule belong to one body's
  // calendar, not to every sitting. Start that work as soon as the body is
  // known, including bodies with no captured meeting; share it across places.
  for (const subject of [...subjects.values()]) {
    const bodyId = subject.kind === "body" ? subject.id
      : subject.captureKind === "meeting" ? subject.calendarBodyId : undefined;
    if (!bodyId || subject.id.includes("#inventory:")) continue;
    const id = `${bodyId}#calendar`, prior = subjects.get(id);
    subjects.set(id, { id, kind: "calendar", captureKind: "body-calendar",
      label: prior?.label ?? `${subject.label}: calendar`,
      divisionIds: [...new Set([...(prior?.divisionIds ?? []), ...subject.divisionIds])] });
  }
  for (const division of input.divisions) {
    const prior = subjects.get(division.id);
    const funcstat = division.funcstat ?? (prior?.kind === "division" ? prior.funcstat : undefined);
    subjects.set(division.id, { id: division.id, label: division.label, kind: "division", divisionIds: [division.id],
      ...(funcstat ? { funcstat } : {}) });
    // Retain Census geography, but its explicit statistical, inactive and
    // fictitious duplicate rows do not imply another government to discover.
    if (["F", "N", "S", "I"].includes(funcstat ?? "")) continue;
    // Discovery is owed even after the first member of a family is found.
    for (const kind of Object.keys(GROUPS).filter(k => k !== "division") as PlaceSubjectKind[]) {
      const id = `${division.id}#inventory:${kind}`;
      subjects.set(id, { id, kind, divisionIds: [division.id], label: `${division.label}: ${kind} inventory` });
    }
  }
  // One legislature per level of government the place sits under: Congress and each state's legislature. Its session
  // and roll calls are captured on it; roll calls get their own rows only where they are held.
  for (const division of input.divisions) {
    if (["F", "N", "S", "I"].includes(subjects.get(division.id)?.funcstat ?? "")) continue;
    const federal = division.id === "ocd-division/country:us";
    if (!federal && !/^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(division.id)) continue;
    const id = `${division.id}#legislature`;
    subjects.set(id, { id, kind: "legislature", captureKind: federal ? "federal-legislature" : "state-legislature",
      divisionIds: [division.id], label: `${division.label}: legislature` });
  }
  // ZIP identity, resolution method and split-ZIP handling belong to each ZIP, not to every division it touches.
  for (const zip of new Set(input.zips ?? [])) {
    const id = `zip:${zip}`;
    subjects.set(id, { id, kind: "zip", divisionIds: input.divisions.map(division => division.id), label: `ZIP ${zip}` });
  }
  const heldByKey = new Map<string, HeldPlaceField[]>();
  for (const field of input.held) {
    if (!field.sourceUrl || Date.parse(field.checkedAt) > now || !Number.isFinite(Date.parse(field.checkedAt))) continue;
    // A shared predicate is one fact: a field kept under MTG-20 counts once, under MTG-17.
    const key = JSON.stringify([field.subjectId, canonicalItemId(field.checklistId)]);
    heldByKey.set(key, [...(heldByKey.get(key) ?? []), field]);
  }
  return [...subjects.values()].sort((a, b) => a.id.localeCompare(b.id)).flatMap(subject => {
    const inventory = subject.id.includes("#inventory:");
    const heldHere = (d: { id: string }): boolean => heldByKey.has(JSON.stringify([subject.id, d.id]));
    const gated = (d: { id: string }): boolean => {
      const only = checklistItem(d.id)?.onlyFor;
      if (!only || subject.kind !== "division") return true;
      const owes = divisionOwesGatedItem(subject.id, only);
      return owes === "held-only" ? heldHere(d) : owes;
    };
    // Held evidence always keeps its row, even for an item the subject's unit would not owe. Shared items count once, under their own ID.
    const definitions = checklist.definitions.filter(d => checklistItem(d.id)?.countsAs !== "shared" && (!inventory && heldHere(d) ||
      owedByKind(subject.kind, d) && gated(d) && (subject.kind !== "deadline" || DEADLINE_ITEMS.has(d.id)) && (inventory || appliesToRecord(subject, d))));
    // The inventory is one discovery item, not a fictitious seat or contest.
    const wanted = inventory ? definitions.slice(0, 1) : definitions;
    return wanted.map(definition => {
      const id = JSON.stringify([subject.id, definition.id]);
      const held = heldByKey.get(id) ?? [];
      const current = held.filter(field => Date.parse(field.freshUntil) >= now);
      const state = current.some(f => f.state === "published") ? "published"
        : current.some(f => f.state === "held") ? "held"
        : current.some(f => f.state === "unpublished") ? "unpublished" : held.length ? "stale" : "missing";
      const requirement = inventory ? `Discover every ${subject.kind} for ${subject.label.split(": ")[0]}` : definition.requirement;
      const statuses = rowStatuses({ checklistId: definition.id, subject, held }, { now: input.now, hunt: input.hunt, witness: input.witness });
      return { id, subject, checklistId: definition.id, requirement, state, held, statuses,
        label: state === "missing" ? `${requirement} — not covered yet`
          : state === "stale" ? `${requirement} — captured; source refresh due`
          : state === "held" ? `${requirement} — captured, not published yet`
          : state === "unpublished" ? `${requirement} — not published by the government` : requirement };
    });
  });
}

/** Fresh captured fields await their existing verification/publication work.
 * Stale fields retain their sources so the worker refreshes a known route. */
export function missingPlaceWork(items: readonly PlaceOwedItem[]): PlaceOwedItem[] {
  return items.filter(item => item.state === "missing" || item.state === "stale");
}

/** Recompute after each field publishes; never wait for the rest of a body. */
export function openPlaceWork(items: readonly PlaceOwedItem[]): PlaceOwedItem[] {
  return items.filter(item => item.state !== "published" && item.state !== "unpublished");
}
