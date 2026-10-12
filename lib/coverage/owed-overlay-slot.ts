/**
 * The slot holding Admin's additions to and declines from what a place is owed.
 * Separate so the checklist loader can read it without importing the writer.
 * Set it before building an owed list; the default is nothing added or declined.
 */
import type { ChecklistItemRule } from "./checklist-map.ts";

export interface ActiveOwedOverlay {
  readonly definitions: readonly { readonly id: string; readonly group: string; readonly requirement: string; readonly owner: string; readonly label: string; readonly addedAt: string }[];
  readonly rules: Readonly<Record<string, ChecklistItemRule>>;
  readonly declinedRows: ReadonlySet<string>;
  /** Changes with the record; part of any memo key. */
  readonly revision: string;
}

export const NO_OWED_OVERLAY: ActiveOwedOverlay = { definitions: [], rules: {}, declinedRows: new Set(), revision: "none" };

let active: ActiveOwedOverlay = NO_OWED_OVERLAY;

export function activeOwedOverlay(): ActiveOwedOverlay { return active; }
export function installOwedOverlay(next: ActiveOwedOverlay): ActiveOwedOverlay { active = next; return active; }
