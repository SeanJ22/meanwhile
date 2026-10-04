import { GROUP_NAMES, PLACE_GROUPS } from "../../coverage/group-names.ts";

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

export { GROUP_NAMES, PLACE_GROUPS };
