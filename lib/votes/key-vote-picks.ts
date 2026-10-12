/**
 * Key votes picked by the owner in Admin. They sit beside the reviewed list of
 * questions and the person's full voting record; they never replace either.
 * The product never chooses one: the default is an empty list.
 *
 * A pick names one roll call (`house:119-2:283`, `senate:119-2:231`) and may
 * carry the picker's own one-line reason. Wording, date, result and the
 * member's position come from the held roll-call record, never from this
 * setting. A member's card shows only their own chamber's picks.
 *
 * Never a score: nothing here is counted, ranked or compared across people.
 */
import { registerSetting, type SettingValue } from "../control-plane/settings.ts";
import type { MemberVote, RollCallVote, VotePosition } from "./types.ts";

export const KEY_VOTE_PICKS_SETTING = "votes.keyVotePicks";

export interface KeyVotePick {
  /** `house:<congress>-<session>:<roll>` or `senate:...`, the roll-call id the votes store uses. */
  readonly rollId: string;
  /** The picker's own words for why it matters; shown as theirs, never as ours. */
  readonly why?: string;
}

const ROLL_ID = /^(house|senate):\d{1,3}-\d:\d{1,5}$/;
export const KEY_VOTE_PICKS_MAX = 100;

export function validKeyVotePicks(value: unknown): value is readonly KeyVotePick[] {
  if (!Array.isArray(value) || value.length > KEY_VOTE_PICKS_MAX) return false;
  const seen = new Set<string>();
  for (const pick of value) {
    if (typeof pick !== "object" || pick === null || Array.isArray(pick)) return false;
    const { rollId, why, ...rest } = pick as Record<string, unknown>;
    if (Object.keys(rest).length > 0 || typeof rollId !== "string" || !ROLL_ID.test(rollId) || seen.has(rollId)) return false;
    if (why !== undefined && (typeof why !== "string" || why.trim() === "" || why.length > 240)) return false;
    seen.add(rollId);
  }
  return true;
}

/** Empty on purpose: the product never chooses a key vote. */
export const DEFAULT_KEY_VOTE_PICKS: readonly KeyVotePick[] = [];

registerSetting({
  key: KEY_VOTE_PICKS_SETTING, label: "Key votes picked by Sean (roll calls shown on person cards)",
  defaultValue: DEFAULT_KEY_VOTE_PICKS as unknown as SettingValue,
  readerFacing: true, control: "json",
  validate: (value): value is SettingValue => validKeyVotePicks(value),
});

export interface PickedKeyVote {
  readonly rollId: string;
  readonly why: string | null;
  /** True when the roll call itself is in the held record. */
  readonly held: boolean;
  /** The roll call, as the chamber published it; null when not held. */
  readonly roll: RollCallVote | null;
  /** The member's recorded position; null when we hold none (never "did not vote"). */
  readonly position: VotePosition | null;
}

/**
 * One member's picks: only their own chamber's roll calls, in the picked order.
 * A pick whose roll call or position is not held says so rather than guessing.
 */
export function pickedKeyVotesFor(
  picks: readonly KeyVotePick[],
  chamber: "house" | "senate" | null,
  rolls: readonly RollCallVote[],
  positions: readonly MemberVote[],
  member: string,
): PickedKeyVote[] {
  if (!chamber) return [];
  const rollById = new Map(rolls.map((roll) => [roll.id, roll]));
  const positionByRoll = new Map(positions.filter((p) => p.officeholderId === member).map((p) => [p.voteId, p.position]));
  return picks
    .filter((pick) => pick.rollId.startsWith(`${chamber}:`))
    .map((pick) => {
      const roll = rollById.get(pick.rollId) ?? null;
      return { rollId: pick.rollId, why: pick.why ?? null, held: roll !== null, roll, position: positionByRoll.get(pick.rollId) ?? null };
    });
}
