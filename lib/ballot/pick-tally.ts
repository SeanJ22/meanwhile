import { resolvePick, type PickResolution } from "./derived-picks.ts";
import type { StoredPick } from "./picks.ts";

export interface PickOption {
  id: string;
  label: string;
  aliases?: readonly string[];
  reactionTargetId?: string;
  reactionTargetAliases?: readonly string[];
}

export interface PickableContest {
  contestId: string;
  aliases?: readonly string[];
  contestTitle: string;
  contestOcdId?: string;
  voteFor: number;
  options: PickOption[];
}

export interface TalliedPick {
  contestId: string;
  contestTitle: string;
  chosen: string[];
  basis: "EXPLICIT" | "DERIVED";
}

export interface PickTally {
  picked: number;
  pickable: number;
  rows: TalliedPick[];
  foreign: StoredPick[];
}

export function resolveWithSuppression(
  explicit: StoredPick | null,
  yesChoiceIds: readonly string[],
  voteFor: number,
  suppressedDerived: readonly string[] | undefined,
  options: readonly PickOption[] = [],
): PickResolution {
  const canonical = (id: string) => {
    const matches = options.filter(option => option.id === id || option.aliases?.includes(id));
    return matches.length === 1 ? matches[0].id : id;
  };
  const picked = explicit ? { ...explicit, choiceIds: [...new Set(explicit.choiceIds.map(canonical))] } : null;
  const resolution = resolvePick(picked, yesChoiceIds.map(canonical), voteFor);
  if (resolution.basis !== "DERIVED") return resolution;
  if (!suppressedDerived || suppressedDerived.length === 0) return resolution;
  const cleared = new Set(suppressedDerived.map(canonical));
  const same = cleared.size === resolution.chosen.length && resolution.chosen.every(id => cleared.has(id));
  if (!same) return resolution;
  return { chosen: [], basis: "NONE", conflicting: [], asks: true };
}

export function tallyPicks(
  pickable: readonly PickableContest[],
  explicitPicks: readonly StoredPick[],
  yesTargetIds: ReadonlySet<string>,
  suppressedDerived: Readonly<Record<string, string[]>>,
): PickTally {
  const byId = new Map(explicitPicks.map((p) => [p.contestId, p]));
  const onThisBallot = new Set(pickable.flatMap(contest => [contest.contestId, ...contest.aliases ?? []]));
  const rows: TalliedPick[] = [];

  for (const contest of pickable) {
    const yes = contest.options
      .filter((o) => [o.reactionTargetId, ...o.reactionTargetAliases ?? []].some(id => id && yesTargetIds.has(id)))
      .map((o) => o.id);
    const resolution = resolveWithSuppression(
      byId.get(contest.contestId) ?? (contest.aliases ?? []).map(id => byId.get(id)).find(Boolean) ?? null,
      yes,
      contest.voteFor,
      [contest.contestId, ...contest.aliases ?? []].map(id => suppressedDerived[id]).find(Boolean),
      contest.options,
    );
    if (resolution.basis === "NONE" || resolution.chosen.length === 0) continue;
    const explicit = byId.get(contest.contestId) ?? (contest.aliases ?? []).map(id => byId.get(id)).find(Boolean);
    rows.push({
      contestId: contest.contestId,
      contestTitle: contest.contestTitle,
      chosen: resolution.chosen.map(
        (id) =>
          contest.options.find((o) => o.id === id)?.label ??
          explicit?.labels?.[id] ??
          id,
      ),
      basis: resolution.basis,
    });
  }

  return {
    picked: rows.length,
    pickable: pickable.length,
    rows,
    foreign: explicitPicks.filter((p) => !onThisBallot.has(p.contestId)),
  };
}

/** Resolved against no explicit picks: a clear empties them, so this is the state that will exist after it. */
export function derivedToSuppress(
  pickable: readonly PickableContest[],
  yesTargetIds: ReadonlySet<string>,
  suppressedDerived: Readonly<Record<string, string[]>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...suppressedDerived };
  for (const contest of pickable) {
    const yes = contest.options
      .filter((o) => [o.reactionTargetId, ...o.reactionTargetAliases ?? []].some(id => id && yesTargetIds.has(id)))
      .map((o) => o.id);
    const resolution = resolveWithSuppression(null, yes, contest.voteFor, undefined, contest.options);
    if (resolution.basis === "DERIVED" && resolution.chosen.length > 0) {
      out[contest.contestId] = [...resolution.chosen];
    }
  }
  return out;
}

export function tallyLine(tally: PickTally): string {
  const races = tally.pickable === 1 ? "race or measure" : "races and measures";
  return `${tally.picked} of ${tally.pickable} ${races} on this ballot`;
}
