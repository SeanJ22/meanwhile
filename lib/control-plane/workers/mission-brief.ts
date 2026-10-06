/**
 * **THE MISSION IN A SCOUT'S BRIEF (CH-20).**
 *
 * A hunter working one government sees the mission's open blanks for that
 * government and for the governments above and below it, so a page that also
 * answers a neighbour's blank is not wasted: the hunter drops that finding into
 * the Box with `report_finding`. The list comes from the owed list the round
 * already reads (`refreshPlaceOrder`); it adds no store read.
 *
 * "Above" and "below" follow the OCD division path: a state is above its
 * counties, a county above its places. A blank whose subject sits in no
 * division is related only to that exact subject.
 *
 * The Scout brief has one line budget (DP-21 owns it). The mission takes at most
 * `MISSION_BRIEF_LINE_CAP` of it and the field manual keeps the rest, so the two
 * never crowd each other out.
 *
 * PURE. No store, no clock, no environment.
 */
import { isOpenBlank } from "../../coverage/open-blanks.ts";
import type { PlaceOwedItem } from "../../coverage/place-owed.ts";
import { missionPartOf, type MissionPartsSetting } from "../expansion/mission-parts.ts";

/** The whole Scout brief's inherited-line budget: field-manual lines plus mission lines (DP-21). */
export const SCOUT_BRIEF_LINE_BUDGET = 30;
/** The mission's share of that budget, header included. */
export const MISSION_BRIEF_LINE_CAP = 8;
/** Blank labels named on one subject's line before "+N more". */
const LABELS_PER_LINE = 5;

/** One open blank, compact enough to cross a worker-process boundary. */
export interface MissionBlank {
  readonly subjectId: string;
  readonly subjectLabel: string;
  readonly divisionIds: readonly string[];
  readonly checklistId: string;
  readonly label: string;
  readonly missionPart: string | null;
}

export type MissionRelation = "same" | "above" | "below";

/** Every open blank of the mission's places, once each, in the owed lists' order. */
export function missionBlanksFrom(items: readonly PlaceOwedItem[], parts?: MissionPartsSetting): readonly MissionBlank[] {
  const seen = new Set<string>();
  const blanks: MissionBlank[] = [];
  for (const item of items) {
    if (!isOpenBlank(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    blanks.push({ subjectId: item.subject.id, subjectLabel: item.subject.label, divisionIds: item.subject.divisionIds,
      checklistId: item.checklistId, label: item.label, missionPart: missionPartOf({ checklistId: item.checklistId }, parts) });
  }
  return blanks;
}

const divisionOf = (subjectId: string): string | null => {
  const division = subjectId.split("#")[0]!;
  return division.startsWith("ocd-division/") ? division : null;
};

/** How a blank stands to the government a Scout is working, or null when it is unrelated. */
export function missionRelation(subjectId: string, blank: Pick<MissionBlank, "subjectId" | "divisionIds">): MissionRelation | null {
  if (blank.subjectId === subjectId) return "same";
  const working = divisionOf(subjectId);
  if (working === null) return null;
  const divisions = [...new Set([...blank.divisionIds, ...(divisionOf(blank.subjectId) ? [divisionOf(blank.subjectId)!] : [])])];
  let found: MissionRelation | null = null;
  for (const division of divisions) {
    if (division === working) return "same";
    if (working.startsWith(`${division}/`)) found ??= "above";
    else if (division.startsWith(`${working}/`)) found ??= "below";
  }
  return found;
}

/** The blanks a Scout on `subjectId` is shown and may report for: same first, then above, then below. */
export function relatedMissionBlanks(subjectId: string, blanks: readonly MissionBlank[]): readonly (MissionBlank & { readonly relation: MissionRelation })[] {
  const order: Record<MissionRelation, number> = { same: 0, above: 1, below: 2 };
  return blanks.flatMap(blank => { const relation = missionRelation(subjectId, blank); return relation ? [{ ...blank, relation }] : []; })
    .map((blank, index) => ({ blank, index }))
    .sort((a, b) => order[a.blank.relation] - order[b.blank.relation] || a.index - b.index)
    .map(row => row.blank);
}

export interface MissionBrief {
  /** Brief lines, header included; empty when the mission has no related open blank. */
  readonly lines: readonly string[];
  /** Subjects `report_finding` accepts: every related blank's subject, shown or not. */
  readonly subjects: ReadonlySet<string>;
  /** Related open blanks, and how many of them the lines name. */
  readonly related: number;
  readonly shown: number;
}

/** One line per subject, capped; the rest of the related blanks stay reportable. */
export function missionBriefLines(subjectId: string, blanks: readonly MissionBlank[], cap = MISSION_BRIEF_LINE_CAP): MissionBrief {
  const related = relatedMissionBlanks(subjectId, blanks);
  const subjects = new Set(related.map(blank => blank.subjectId));
  if (!related.length || cap < 2) return { lines: [], subjects, related: related.length, shown: 0 };
  const bySubject = new Map<string, (typeof related)[number][]>();
  for (const blank of related) bySubject.set(blank.subjectId, [...bySubject.get(blank.subjectId) ?? [], blank]);
  const rows = [...bySubject.values()].slice(0, cap - 1);
  const shown = rows.reduce((sum, row) => sum + row.length, 0);
  const lines = rows.map(row => {
    const first = row[0]!, labels = [...new Set(row.map(blank => blank.label))];
    const named = labels.slice(0, LABELS_PER_LINE).join("; ") + (labels.length > LABELS_PER_LINE ? `; +${labels.length - LABELS_PER_LINE} more` : "");
    return `  ${first.relation} · ${first.subjectLabel} [${first.subjectId}]: ${named}`;
  });
  const header = `MISSION — ${related.length} open blank(s) for this government and the governments above and below it` +
    (bySubject.size > rows.length ? ` (${rows.length} of ${bySubject.size} subjects listed)` : "") +
    ". When a page you open also answers one of them, call report_finding with that subject id, the field, the value and the exact quote; keep working your own target.";
  return { lines: [header, ...lines], subjects, related: related.length, shown };
}
