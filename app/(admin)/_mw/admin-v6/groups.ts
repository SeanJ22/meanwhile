/**
 * Plain-English names for the checklist groups (v6 design wording). The
 * definitions themselves come from CHECKLIST_PROFILE.
 *
 * PURE.
 */
export const PLACE_GROUP_NAMES: Readonly<Record<string, string>> = {
  GEO: "Geography", GOV: "Governments", OFF: "Officeholders", MTG: "Meetings", DOC: "Agendas and documents", LEG: "Laws and votes",
  ELE: "Elections", CAN: "Candidates", CAM: "Campaign finance", FIN: "Government money", PAR: "Taking part", ASK: "Ask",
};

export const GROUP_NAMES: Readonly<Record<string, string>> = {
  ...PLACE_GROUP_NAMES,
  GATE: "Setup and safety checks", ACQ: "Finding sources", REC: "Recovery", PUB: "Publishing", SAFE: "Safety and privacy",
  REF: "Reference data", EXE: "Running work", PRL: "Working in parallel", ENG: "Engineering",
};
