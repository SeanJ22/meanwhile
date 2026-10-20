/**
 * Weights the coordinator's round-robin over (Send, mission part): each part's
 * turns scale with its open blanks and recent difficulty; a part with no open
 * blanks gets no turn while another has work. A Send with no open-blank
 * reading is plain round-robin. Pure.
 */
import type { WorkItem } from "../work-item.ts";
import { DEFAULT_MISSION_PARTS, missionPartOfPlan, type MissionPartsSetting } from "../expansion/mission-parts.ts";

/** How far back "recent" detective turns are counted. */
export const SQUAD_DIFFICULTY_WINDOW_HOURS = 24;
/** The part a work item with no plan part is grouped under. */
export const NO_PART = "other";
/** The group a work item that no Send ordered is fairness-grouped under. */
export const STANDING_SEND = "standing";

export interface SquadReading {
  /** Send receipt → part → open blanks, from the owed lists read this wave. */
  readonly open: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** The mission parts in force. */
  readonly parts?: MissionPartsSetting;
}

export interface SquadWeight {
  readonly send: string;
  readonly part: string;
  readonly open: number | null;
  readonly detectiveTurns: number;
  readonly openDebts: number;
  readonly weight: number;
}

/** The Send a work item is fair-shared under: its highest-priority owner instruction, else standing. */
export function sendOf(item: WorkItem, priority: ReadonlyMap<string, number>): string {
  const refs = [...(item.autonomousPlan?.ownerInstructions ?? [])]
    .sort((a, b) => (priority.get(a) ?? Infinity) - (priority.get(b) ?? Infinity) || a.localeCompare(b));
  return refs[0] ?? STANDING_SEND;
}

export function partOfItem(item: WorkItem, parts: MissionPartsSetting = DEFAULT_MISSION_PARTS): string {
  return (item.autonomousPlan ? missionPartOfPlan(item.autonomousPlan, parts) : null) ?? NO_PART;
}

/** Identity of one coordinator (Send, part) weight. */
export function squadKey(send: string, part: string): string {
  return `${send}\u0000${part}`;
}
