export const ADMIN_V6_CHECKLIST_CONTRACT = "admin-v6/checklist@1" as const;

/** Structurally matches Admin v6 model.ts without importing the UI bundle. */
export interface AdminV6ChecklistView {
  readonly profileVersion: string;
  readonly definitionCount: number;
  readonly definitions: readonly { readonly id: string; readonly group: string; readonly requirement: string;
    readonly owner: string; readonly label: string }[];
  readonly groupNames: Readonly<Record<string, string>>;
  readonly placeGroups: null;
  readonly items: null | readonly {
    readonly key: string; readonly definitionId: string; readonly name: string; readonly subject: string;
    readonly period: string; readonly status: "unsure"; readonly missing: string;
    readonly appliesBecause: string; readonly owner: string; readonly next: string;
    readonly parts: readonly { readonly text: string; readonly status: string; readonly proof: string;
      readonly tone: "muted" }[];
    readonly actions: readonly [];
  }[];
  readonly systemGroups: readonly { readonly group: string; readonly name: string;
    readonly counts: null; readonly audit: null }[];
}

export interface AdminV6ChecklistEnvelope {
  readonly contract: typeof ADMIN_V6_CHECKLIST_CONTRACT;
  /** An exact canonical instruction scope key. Mapping a UI place key is not inferred here. */
  readonly scope: string;
  readonly revision: string;
  readonly asOf: string;
  readonly data: AdminV6ChecklistView;
  readonly missingParts: readonly string[];
  readonly page: { readonly total: number | null; readonly nextCursor: string | null;
    readonly prevCursor: null };
}

export const GROUP_NAMES: Readonly<Record<string, string>> = {
  GEO: "Geography", GOV: "Governments", OFF: "Officeholders", MTG: "Meetings", DOC: "Agendas and documents",
  LEG: "Laws and votes", ELE: "Elections", CAN: "Candidates", CAM: "Campaign finance", FIN: "Government money",
  PAR: "Taking part", ASK: "Ask", GATE: "Setup and safety checks", ACQ: "Finding sources", REC: "Recovery",
  PUB: "Publishing", SAFE: "Safety and privacy", REF: "Reference data", EXE: "Running work",
  PRL: "Working in parallel", ENG: "Engineering",
};
export const PLACE_GROUPS = new Set(["GEO", "GOV", "OFF", "MTG", "DOC", "LEG", "ELE", "CAN", "CAM", "FIN", "PAR", "ASK"]);
