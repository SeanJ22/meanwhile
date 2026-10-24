import profile from "../control-plane/readiness/checklist-profile.json" with { type: "json" };
import { DEFAULT_KINDS } from "../registry/kinds.ts";
import { FIELD_KINDS, type FieldKind } from "../facts/check.ts";
import { readSetting, registerSetting, type SettingValue } from "../control-plane/settings.ts";
import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { stateEntry } from "../control-plane/readiness/catalog.ts";

export type OwedRule = {
  readonly kind: string;
  readonly field: string;
  readonly label: string;
  readonly clock: FieldKind;
  readonly checklist: readonly string[];
  readonly placeKind?: string;
};
export type OwedTable = {
  readonly base: readonly OwedRule[];
  readonly states: { readonly [state: string]: readonly OwedRule[] };
};
export const OWED_TABLE_SETTING = "coverage.owedTable";
const kinds = new Set(["place", "government", "body", "seat", "person", "meeting", "agenda_item", "bill", "vote_event",
  "election", "contest", "candidacy", "measure", "committee", "statement", "law_question", "news_item"]);
const checklistIds = new Set(profile.definitions.map(row => row.id));
const rule = (kind: string, field: string, label: string, clock: FieldKind, checklist: string[]): OwedRule =>
  ({ kind, field, label, clock, checklist: checklist.filter(id => checklistIds.has(id)) });

/** Seeded from the place planner's subject families, packet fields, registered geography kinds and State Run Checklist. */
export const DEFAULT_OWED_TABLE: OwedTable = {
  base: [
    ...DEFAULT_KINDS.division.map(kind => ({ ...rule("place", "governments", "Every government serving this place", "officeholder", ["GOV-01"]), placeKind: kind.key })),
    rule("place", "boundaries", "Government boundaries", "officeholder", ["GEO-01"]),
    rule("government", "bodies", "Every board and commission", "officeholder", ["GOV-02"]),
    rule("government", "seats", "Every seat and officeholder", "officeholder", ["OFF-01"]),
    rule("government", "budget", "Government budget and spending", "money", ["FIN-01"]),
    rule("government", "elections", "Elections, contests and deadlines", "ballot", ["ELE-01"]),
    rule("body", "name", "Board or commission name", "officeholder", ["GOV-02"]),
    rule("body", "member", "Every member and seat", "officeholder", ["OFF-01"]),
    rule("body", "office_phone", "Office phone", "contact", ["GOV-03"]),
    rule("body", "office_email", "Office email", "contact", ["GOV-03"]),
    rule("body", "office_address", "Office address", "contact", ["GOV-03"]),
    rule("body", "homepage", "Government website", "contact", ["GOV-03"]),
    rule("body", "meeting_cadence", "Meeting calendar", "meeting", ["MTG-01"]),
    rule("body", "agenda_url", "Agenda page", "agenda", ["DOC-01"]),
    rule("body", "comment:period", "How to attend and comment", "comment_rule", ["PAR-01"]),
    rule("seat", "holder", "Current officeholder", "officeholder", ["OFF-01"]),
    rule("person", "name", "Officeholder name", "officeholder", ["OFF-04"]),
    rule("person", "office", "Office and role", "officeholder", ["OFF-01"]),
    rule("person", "office_phone", "Office phone", "contact", ["OFF-09"]),
    rule("person", "office_email", "Office email", "contact", ["OFF-09"]),
    rule("person", "office_address", "Office address", "contact", ["OFF-09"]),
    rule("person", "website", "Official website", "contact", ["OFF-09"]),
    rule("person", "portrait", "Portrait", "portrait", ["OFF-06"]),
    rule("person", "background", "Background", "officeholder", ["OFF-07"]),
    rule("person", "statements", "Public statements and positions", "statement", ["OFF-14"]),
    rule("person", "votes", "Voting record", "vote", ["LEG-01"]),
    rule("person", "campaign-money", "Campaign funding and filings", "money", ["CAM-01"]),
    rule("meeting", "starts_at", "Meeting date and time", "meeting", ["MTG-06"]),
    rule("meeting", "location", "Where to attend", "meeting", ["MTG-07"]),
    rule("meeting", "agenda_url", "Agenda", "agenda", ["DOC-01"]),
    rule("meeting", "minutes_url", "Minutes", "outcome", ["DOC-08"]),
    rule("meeting", "outcomes", "Decisions and votes", "outcome", ["DOC-08"]),
    rule("meeting", "video_url", "Meeting recording", "outcome", ["DOC-09"]),
    rule("contest", "candidates", "Every listed candidate", "ballot", ["CAN-01"]),
    rule("contest", "election", "Election date and office", "ballot", ["ELE-01"]),
    rule("candidacy", "name", "Candidate name", "ballot", ["CAN-01"]),
    rule("candidacy", "website", "Campaign website", "contact", ["CAN-04"]),
    rule("candidacy", "statements", "Candidate positions", "statement", ["CAN-06"]),
    rule("election", "deadlines", "Registration and voting deadlines", "ballot", ["ELE-01"]),
    rule("election", "voting_sites", "Voting places", "ballot", ["ELE-01"]),
    rule("measure", "text", "Ballot measure text", "ballot", ["ELE-01"]),
    rule("committee", "campaign-money", "Campaign funding and filings", "money", ["CAM-01"]),
    rule("bill", "text", "Bill text", "law", ["LEG-01"]),
    rule("vote_event", "votes", "Who voted and how", "vote", ["LEG-01"]),
    rule("agenda_item", "outcome", "Decision and votes", "outcome", ["DOC-08"]),
    rule("statement", "quote", "Public statement and source", "statement", ["OFF-14"]),
    rule("law_question", "answer", "Law and sources", "law", ["LEG-01"]),
    rule("news_item", "text", "Government news and sources", "news", []),
  ],
  states: {},
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function validRows(value: unknown): value is readonly OwedRule[] {
  if (!Array.isArray(value) || value.length > 2000) return false;
  const keys = new Set<string>();
  return value.every(row => {
    if (!object(row) || Object.keys(row).some(key => !["kind", "field", "label", "clock", "checklist", "placeKind"].includes(key)) ||
      typeof row.kind !== "string" || !kinds.has(row.kind) || typeof row.field !== "string" || !/^[a-z][a-zA-Z0-9_:.-]{0,99}$/.test(row.field) ||
      typeof row.label !== "string" || !row.label.trim() || row.label.length > 200 || !FIELD_KINDS.includes(row.clock as FieldKind) ||
      !Array.isArray(row.checklist) || !row.checklist.every(id => typeof id === "string" && checklistIds.has(id)) ||
      row.placeKind !== undefined && (row.kind !== "place" || typeof row.placeKind !== "string" || !/^[a-z][a-z_]{0,99}$/.test(row.placeKind))) return false;
    const key = JSON.stringify([row.kind, row.placeKind ?? null, row.field]);
    if (keys.has(key)) return false;
    keys.add(key); return true;
  });
}
export function owedTableValid(value: unknown): value is OwedTable {
  return object(value) && Object.keys(value).length === 2 && validRows(value.base) && object(value.states) &&
    Object.entries(value.states).every(([state, rows]) => /^[A-Z]{2}$/.test(state) && stateEntry(state) !== null && validRows(rows) &&
      rows.every(row => !(value.base as readonly OwedRule[]).some(base => base.kind === row.kind && base.field === row.field && base.placeKind === row.placeKind)));
}
registerSetting({ key: OWED_TABLE_SETTING, label: "What readers are owed by kind of place", readerFacing: false, control: "json",
  defaultValue: DEFAULT_OWED_TABLE as unknown as SettingValue, validate: (value): value is SettingValue => owedTableValid(value) });

/** Read again for each request/pass, so Admin edits and undo take effect without a restart. */
export function owedTable(config: AdminConfig | null): OwedTable {
  return readSetting(config, OWED_TABLE_SETTING, DEFAULT_OWED_TABLE as unknown as SettingValue) as unknown as OwedTable;
}
