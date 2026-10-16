import type { AdminConfig } from "../gateway/admin-config.ts";
import { readSetting, registerSetting, type SettingValue } from "../settings.ts";
import { SQUAD_START } from "../../coverage/checklist-map.ts";
import type { PlaceOwedItem } from "../../coverage/place-owed.ts";
import { isOpenBlank, OTHER_SQUAD } from "../../coverage/open-blanks.ts";

export const MISSION_PARTS_SETTING = "expansion.missionParts";

export interface MissionPart {
  /** Stable id, e.g. `governments-meetings`. Never shown in Admin. */
  readonly id: string;
  /** What Admin calls it. */
  readonly label: string;
}

export interface MissionPartsSetting {
  readonly parts: readonly MissionPart[];
  /** Checklist family (`GEO`, `OFF`, …) → part id. Families left out keep the overlay's squad. */
  readonly families: Readonly<Record<string, string>>;
  /** Record class (`MEETING`, `BALLOT_CANDIDACY`, …) → part id, for work that names a record class and no checklist item. */
  readonly recordClasses: Readonly<Record<string, string>>;
  /** Parts whose squad is weighted by government class (county, city, school district, …). One part, still; the split only weights it. */
  readonly weightByGovernmentClass: readonly string[];
}

const GOVERNMENTS = "governments-meetings";
const PEOPLE = "people-money";
const BALLOT = "ballot";

/** The starting value: the three default parts, the overlay's families, and every record class the factory writes. */
export const DEFAULT_MISSION_PARTS: MissionPartsSetting = {
  parts: [
    { id: GOVERNMENTS, label: "Governments and meetings" },
    { id: PEOPLE, label: "People and money" },
    { id: BALLOT, label: "Ballot" },
  ],
  families: { ...SQUAD_START },
  recordClasses: {
    // Governments, their meetings and documents, geography and reference definitions.
    MEETING: GOVERNMENTS, MEETING_OUTCOME: GOVERNMENTS, MEETING_NOTICE: GOVERNMENTS, AGENDA: GOVERNMENTS, AGENDA_PACKET: GOVERNMENTS,
    MINUTES: GOVERNMENTS, ACTION_SUMMARY: GOVERNMENTS, RECORDING_OR_TRANSCRIPT: GOVERNMENTS,
    CENSUS_GEOGRAPHY: GOVERNMENTS, CENSUS_REFERENCE: GOVERNMENTS, DOTGOV_REFERENCE: GOVERNMENTS, REGISTRATION: GOVERNMENTS,
    REGISTRY_RUNTIME_BINDING: GOVERNMENTS, OPERATIONAL_REFERENCE: GOVERNMENTS, FEDERAL_MONEY: GOVERNMENTS,
    MEETINGS: GOVERNMENTS, LEGISTAR_EVENTS: GOVERNMENTS, CIVICCLERK_EVENTS: GOVERNMENTS, OFFICIAL_BOARD_DIRECTORY: GOVERNMENTS,
    PUBLIC_SERVICES: GOVERNMENTS, SERVICE_CONTACT: GOVERNMENTS, PUBLIC_COMMENT: GOVERNMENTS, PUBLIC_COMMENT_RULE: GOVERNMENTS,
    // Officeholders, votes, executive actions, statements, candidates and campaign money.
    ROSTER: PEOPLE, ROLL_CALL: PEOPLE, STATE_ROLL_CALL: PEOPLE, STATE_LEGISLATOR: PEOPLE, STATE_LEGISLATOR_VOTES: PEOPLE, STATE_BILL: PEOPLE,
    FEDERAL_ROLL_CALL: PEOPLE, FEDERAL_KEY_VOTE: PEOPLE, FEDERAL_DIRECTORY: PEOPLE, FEDERAL_CIVIC_RECORD: PEOPLE, STATE_EXECUTIVE_ACTION: PEOPLE,
    OFFICEHOLDER_STATEMENT: PEOPLE, PRL_PROFILE: PEOPLE, PRL_ARCHIVE: PEOPLE, CANDIDATE_PROFILE: PEOPLE, CANDIDATE_PUBLICATION: PEOPLE,
    BALLOT_CANDIDACY: PEOPLE, FEC_FUNDING: PEOPLE, STATE_CAMPAIGN_FINANCE: PEOPLE, LOCAL_CAMPAIGN_FINANCE: PEOPLE,
    OFFICEHOLDERS: PEOPLE, OFFICIAL_ROSTER: PEOPLE, CAMPAIGN_FINANCE: PEOPLE, CAMPAIGN_FINANCE_FILING: PEOPLE, CANDIDATE_FILING_DOCUMENT: PEOPLE,
    // Elections, the ballot itself (contests and measures) and where to vote.
    VOTING_SITE: BALLOT, GOOGLE_CIVIC_VOTERINFO: BALLOT, BALLOT_AND_CANDIDATES: BALLOT, BALLOT_CONTEST: BALLOT, BALLOT_MEASURE: BALLOT, VOTER_ACCESS: BALLOT, VOTER_ACCESS_ROUTE: BALLOT,
  },
  weightByGovernmentClass: [GOVERNMENTS],
};

const PART_ID = /^[a-z][a-z0-9-]*$/;
const FAMILY = /^[A-Z]+$/;
const RECORD_CLASS = /^[A-Z][A-Z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validMissionParts(value: unknown): value is MissionPartsSetting & SettingValue {
  if (!isRecord(value) || !Array.isArray(value.parts) || value.parts.length === 0) return false;
  const ids = new Set<string>();
  for (const part of value.parts) {
    if (!isRecord(part) || typeof part.id !== "string" || !PART_ID.test(part.id) || ids.has(part.id)
      || typeof part.label !== "string" || !part.label.trim()) return false;
    ids.add(part.id);
  }
  const mapsToParts = (map: unknown, key: RegExp) => isRecord(map)
    && Object.entries(map).every(([k, v]) => key.test(k) && typeof v === "string" && ids.has(v));
  return mapsToParts(value.families, FAMILY) && mapsToParts(value.recordClasses, RECORD_CLASS)
    && Array.isArray(value.weightByGovernmentClass)
    && value.weightByGovernmentClass.every((id) => typeof id === "string" && ids.has(id));
}

registerSetting({
  key: MISSION_PARTS_SETTING, label: "Mission parts and which squad takes each family",
  defaultValue: DEFAULT_MISSION_PARTS as MissionPartsSetting & SettingValue,
  readerFacing: false, control: "json", validate: validMissionParts,
});

/** The parts in force: the setting when one is set, else the starting value. Families the setting leaves out keep the overlay's squad. */
export function missionPartsOf(config: AdminConfig | null): MissionPartsSetting {
  const set: MissionPartsSetting = readSetting(config, MISSION_PARTS_SETTING, DEFAULT_MISSION_PARTS as MissionPartsSetting & SettingValue);
  const ids = new Set(set.parts.map((part) => part.id));
  const overlay = Object.fromEntries(Object.entries(SQUAD_START).filter(([, part]) => ids.has(part)));
  return { ...set, families: { ...overlay, ...set.families } };
}

/** The family of a checklist item id (`MTG-07` → `MTG`). */
export function familyOf(checklistId: string): string {
  const dash = checklistId.indexOf("-");
  return dash < 0 ? checklistId : checklistId.slice(0, dash);
}

/** The part that takes a piece of work: by its checklist item when it names one, else by its record class. Null when no part takes it. */
export function missionPartOf(work: { readonly checklistId?: string | null; readonly family?: string | null; readonly recordClass?: string | null },
  parts: MissionPartsSetting = DEFAULT_MISSION_PARTS): string | null {
  const family = work.family ?? (work.checklistId ? familyOf(work.checklistId) : null);
  if (family && parts.families[family]) return parts.families[family]!;
  if (work.recordClass && parts.recordClasses[work.recordClass]) return parts.recordClasses[work.recordClass]!;
  return null;
}

export function missionPartOfPlan(plan: { readonly missionPart?: string; readonly contract: { readonly recordClass: string } },
  parts: MissionPartsSetting = DEFAULT_MISSION_PARTS): string | null {
  return missionPartOf({ recordClass: plan.contract.recordClass }, parts) ?? plan.missionPart ?? null;
}

/** The family → part map, in the shape the open-blanks grouping takes as its squads. */
export function squadsOf(parts: MissionPartsSetting): Readonly<Record<string, string>> {
  return parts.families;
}

export interface MissionPartCount {
  /** A part id, or "other" for families no part takes. */
  readonly part: string;
  /** What Admin calls it. */
  readonly label: string;
  /** Rows of the owed list this part owes. */
  readonly owed: number;
  /** Of those, due, unsatisfied and not being worked. */
  readonly open: number;
  /** Of those, being worked now. */
  readonly inProgress: number;
}

export const OTHER_PART_LABEL = "Not in a mission part";

/** The owed list grouped by part, with counts, in the setting's part order; "other" last and only when it has rows. */
export function missionPartCounts(items: readonly PlaceOwedItem[], parts: MissionPartsSetting = DEFAULT_MISSION_PARTS): readonly MissionPartCount[] {
  const tally = new Map<string, { owed: number; open: number; inProgress: number }>(parts.parts.map((part) => [part.id, { owed: 0, open: 0, inProgress: 0 }]));
  for (const item of items) {
    const part = missionPartOf({ checklistId: item.checklistId }, parts) ?? OTHER_SQUAD;
    const row = tally.get(part) ?? { owed: 0, open: 0, inProgress: 0 };
    row.owed += 1;
    if (isOpenBlank(item)) row.open += 1;
    if (item.statuses.found === "in-progress") row.inProgress += 1;
    tally.set(part, row);
  }
  const labels = new Map(parts.parts.map((part) => [part.id, part.label]));
  return [...tally].filter(([part, row]) => part !== OTHER_SQUAD || row.owed > 0)
    .map(([part, row]) => ({ part, label: labels.get(part) ?? OTHER_PART_LABEL, ...row }));
}

/** A mission's work counted by part: every work item once, under its plan's part; work with no plan or no part under "other". */
export function missionWorkCounts(items: readonly { readonly autonomousPlan?: { readonly missionPart?: string; readonly contract: { readonly recordClass: string } } }[],
  parts: MissionPartsSetting = DEFAULT_MISSION_PARTS): readonly { readonly part: string; readonly label: string; readonly work: number }[] {
  const tally = new Map<string, number>(parts.parts.map((part) => [part.id, 0]));
  for (const item of items) {
    const part = (item.autonomousPlan ? missionPartOfPlan(item.autonomousPlan, parts) : null) ?? OTHER_SQUAD;
    tally.set(part, (tally.get(part) ?? 0) + 1);
  }
  const labels = new Map(parts.parts.map((part) => [part.id, part.label]));
  return [...tally].filter(([part, work]) => part !== OTHER_SQUAD || work > 0)
    .map(([part, work]) => ({ part, label: labels.get(part) ?? OTHER_PART_LABEL, work }));
}
