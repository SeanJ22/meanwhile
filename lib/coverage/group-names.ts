import { CHECKLIST_GROUPS } from "./checklist-map.ts";

/**
 * The one set of plain-English names for the checklist's families, shared by
 * Admin's checklist view and the Admin screens. The place families are exactly
 * the groups the overlay says a place owes, so the family rows can add up to
 * the headline score.
 *
 * PURE.
 */
export const PLACE_GROUP_NAMES: Readonly<Record<string, string>> = {
  GEO: "Geography", GOV: "Governments", OFF: "Officeholders", MTG: "Meetings", DOC: "Agendas and documents", LEG: "Laws and votes",
  ELE: "Elections", CAN: "Candidates", CAM: "Campaign finance", FIN: "Government money", PAR: "Taking part",
  EXE: "Executive actions", PRL: "Public statement profiles",
};

export const GROUP_NAMES: Readonly<Record<string, string>> = {
  ...PLACE_GROUP_NAMES,
  ASK: "Ask", GATE: "Setup and safety checks", ACQ: "Finding sources", REC: "Recovery", PUB: "Publishing", SAFE: "Safety and privacy",
  REF: "Reference data", ENG: "Reader participation",
};

/** The families a place is scored on, taken from the overlay rather than listed a second time. */
export const PLACE_GROUPS: ReadonlySet<string> = new Set(Object.values(CHECKLIST_GROUPS).flat());
