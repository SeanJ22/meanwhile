/**
 * **SQUADS SIZED TO THEIR PARTS (CH-17).**
 *
 * The coordinator's fairness is round-robin over (Send, mission part). Within
 * a Send, each part's turns are weighted by its count of open blanks and by
 * how hard it has been: its share of the Send's recent detective turns and of
 * its open failure debts. Bigger and harder parts get more hunters; a part
 * whose open blanks reach zero stops getting turns while any other part has
 * work. Read again every wave, so hunters move to the gaps as they open.
 *
 * A Send with no open-blank reading (standing work, or a read that failed) is
 * plain round-robin over its parts: no information never stops a part.
 *
 * PURE. No store, no clock, no environment.
 */
import type { WorkItem } from "../work-item.ts";
import type { RouteTask } from "../route-task.ts";
import type { FreshnessDebt } from "../scheduler/debt.ts";
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

/**
 * Each (Send, part)'s weight: open × (1 + detective share + debt share). The shares are this part's
 * fraction of its Send's recent detective turns and open failure debts, each between 0 and 1.
 */
export function squadWeights(input: {
  readonly items: readonly WorkItem[];
  readonly priority: ReadonlyMap<string, number>;
  readonly reading: SquadReading | null;
  readonly routeTasks: readonly RouteTask[];
  /** Open failure debts, each with the work item its obligation's occurrence opened. */
  readonly debts: readonly { readonly debt: FreshnessDebt; readonly workItemId: string | null }[];
  readonly now: string;
}): ReadonlyMap<string, SquadWeight> {
  const parts = input.reading?.parts ?? DEFAULT_MISSION_PARTS;
  const byItem = new Map(input.items.map((item) => [item.id, item] as const));
  const keyOf = (workItemId: string): string | null => {
    const item = byItem.get(workItemId);
    return item ? `${sendOf(item, input.priority)}\u0000${partOfItem(item, parts)}` : null;
  };
  const since = Date.parse(input.now) - SQUAD_DIFFICULTY_WINDOW_HOURS * 3_600_000;
  const turns = new Map<string, number>();
  for (const task of input.routeTasks) {
    if (task.workerTask?.role !== "DETECTIVE" || !(Date.parse(task.createdAt) >= since)) continue;
    const key = keyOf(task.workItemId);
    if (key) turns.set(key, (turns.get(key) ?? 0) + 1);
  }
  const debts = new Map<string, number>();
  for (const row of input.debts) {
    const key = row.workItemId ? keyOf(row.workItemId) : null;
    if (key) debts.set(key, (debts.get(key) ?? 0) + 1);
  }
  const keys = new Set([...input.items.map((item) => keyOf(item.id)!), ...turns.keys(), ...debts.keys()]);
  const sendTotal = (counts: ReadonlyMap<string, number>, send: string) =>
    [...counts].reduce((sum, [key, n]) => (key.startsWith(`${send}\u0000`) ? sum + n : sum), 0);
  const out = new Map<string, SquadWeight>();
  for (const key of keys) {
    const [send, part] = key.split("\u0000") as [string, string];
    const sendOpen = input.reading?.open.get(send);
    const open = sendOpen ? sendOpen.get(part) ?? 0 : null;
    const detectiveTurns = turns.get(key) ?? 0;
    const openDebts = debts.get(key) ?? 0;
    const share = (n: number, counts: ReadonlyMap<string, number>) => { const total = sendTotal(counts, send); return total > 0 ? n / total : 0; };
    const difficulty = 1 + share(detectiveTurns, turns) + share(openDebts, debts);
    out.set(key, { send, part, open, detectiveTurns, openDebts, weight: open === null ? difficulty : open * difficulty });
  }
  return out;
}

/** The key `squadWeights` returns a (Send, part) under. */
export function squadKey(send: string, part: string): string {
  return `${send}\u0000${part}`;
}

/**
 * Interleave one Send's parts by weight (smooth weighted round-robin). Each part's own items keep their order.
 * Parts weighted zero follow, round-robin among themselves: they get no turn while another part has work.
 */
export function interleaveByWeight<T>(lanes: readonly { readonly weight: number; readonly items: readonly T[] }[]): T[] {
  const out: T[] = [];
  const active = lanes.filter((lane) => lane.weight > 0 && lane.items.length > 0)
    .map((lane) => ({ weight: lane.weight, items: lane.items, next: 0, current: 0 }));
  while (active.length > 0) {
    const total = active.reduce((sum, lane) => sum + lane.weight, 0);
    let best = active[0]!;
    for (const lane of active) { lane.current += lane.weight; if (lane.current > best.current) best = lane; }
    best.current -= total;
    out.push(best.items[best.next++]!);
    if (best.next >= best.items.length) active.splice(active.indexOf(best), 1);
  }
  const idle = lanes.filter((lane) => !(lane.weight > 0));
  for (let round = 0; idle.some((lane) => lane.items[round] !== undefined); round++) {
    for (const lane of idle) if (lane.items[round] !== undefined) out.push(lane.items[round]!);
  }
  return out;
}
