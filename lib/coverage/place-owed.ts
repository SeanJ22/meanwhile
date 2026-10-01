import checklist from "../control-plane/readiness/checklist-profile.json" with { type: "json" };

/** A derived capture view, never a publication decision or a second store. */
export type PlaceSubjectKind = "division" | "body" | "seat" | "calendar" | "funding" | "contest" | "deadline";
export interface PlaceSubject {
  readonly id: string;
  readonly kind: PlaceSubjectKind;
  readonly divisionIds: readonly string[];
  readonly label: string;
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
}

const GROUPS: Readonly<Record<PlaceSubjectKind, readonly string[]>> = {
  division: ["GEO"], body: ["GOV", "PAR", "ENG"], seat: ["OFF", "LEG", "EXE", "PRL"],
  calendar: ["MTG", "DOC"], funding: ["CAM", "FIN"], contest: ["ELE", "CAN"], deadline: ["ELE"],
};
const DEADLINE_ITEMS = new Set(["ELE-06", "ELE-08", "ELE-09", "ELE-20", "ELE-21", "ELE-22", "ELE-23", "ELE-24"]);

/** Canonical identities make a county fact reusable by every ZIP and every job.
 * Unknown inventories remain explicit discovery work; an empty input cannot
 * look like a place with no governments, seats, elections or funding. */
export function buildPlaceOwedList(input: {
  readonly divisions: readonly { readonly id: string; readonly label: string; readonly funcstat?: string }[];
  readonly subjects: readonly PlaceSubject[];
  readonly held: readonly HeldPlaceField[];
  readonly now: string;
}): PlaceOwedItem[] {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new Error("Invalid place capture time");
  const divisionIds = new Set(input.divisions.map(d => d.id));
  const subjects = new Map<string, PlaceSubject>();
  for (const subject of input.subjects) {
    if (!subject.divisionIds.some(id => divisionIds.has(id))) continue;
    const prior = subjects.get(subject.id);
    subjects.set(subject.id, { ...subject, divisionIds: [...new Set([...(prior?.divisionIds ?? []), ...subject.divisionIds])] });
  }
  for (const division of input.divisions) {
    subjects.set(division.id, { id: division.id, label: division.label, kind: "division", divisionIds: [division.id] });
    // Retain Census geography, but its explicit statistical, inactive and
    // fictitious duplicate rows do not imply another government to discover.
    if (["F", "N", "S", "I"].includes(division.funcstat ?? "")) continue;
    // Discovery is owed even after the first member of a family is found.
    for (const kind of Object.keys(GROUPS).filter(k => k !== "division") as PlaceSubjectKind[]) {
      const id = `${division.id}#inventory:${kind}`;
      subjects.set(id, { id, kind, divisionIds: [division.id], label: `${division.label}: ${kind} inventory` });
    }
  }
  const heldByKey = new Map<string, HeldPlaceField[]>();
  for (const field of input.held) {
    if (!field.sourceUrl || Date.parse(field.checkedAt) > now || !Number.isFinite(Date.parse(field.checkedAt))) continue;
    const key = JSON.stringify([field.subjectId, field.checklistId]);
    heldByKey.set(key, [...(heldByKey.get(key) ?? []), field]);
  }
  return [...subjects.values()].sort((a, b) => a.id.localeCompare(b.id)).flatMap(subject => {
    const inventory = subject.id.includes("#inventory:");
    const definitions = checklist.definitions.filter(d => GROUPS[subject.kind].includes(d.group) &&
      (subject.kind !== "deadline" || DEADLINE_ITEMS.has(d.id)));
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
      return { id, subject, checklistId: definition.id, requirement, state, held,
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
