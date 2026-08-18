import type { StoredPick } from "./picks.ts";

/**
 * M134 — A YES BECOMES THE PICK, AND THE RACE STOPS ASKING TWICE.
 *
 * The author answered "Would you vote for them?" **Yes** for Kris Mayes, and
 * the race underneath still asked "Your pick for this race." Two controls, one
 * answer already given, and the second one behaving as though it had not been.
 *
 * ## The rules, exactly as the row states them
 *
 * 1. A Yes on one candidate in a contest RECORDS that candidate as the pick.
 *    The section renders it chosen, with a change/clear affordance, and does
 *    NOT ask again.
 * 2. It ASKS only when the reader has said Yes to nobody, or to more than the
 *    seat allows.
 * 3. A recorded pick is never silently overwritten. A reader who has a pick —
 *    derived or explicit — and then says Yes to somebody else does not have
 *    their pick flipped underneath them: the section surfaces the CONFLICT and
 *    asks which one. **An explicit pick always outranks a derived one.**
 * 4. Changing the pick alters no reaction. The two records stay separate.
 * 5. The same rule for measures: a Yes or No on the measure IS the pick.
 *
 * ## Why this is safe, which is the part that could have gone wrong
 *
 * A DERIVED pick writes NOTHING anywhere. It is computed here, at render, from
 * two things the device already holds: `wtp.ballot_picks` (the explicit picks,
 * device-local, never transmitted) and `wtp.reactions` (the device's own
 * record of what it answered, which exists so an answer can be changed). No
 * reaction is created, no reaction is read from the server, and the sold
 * per-candidate count remains explicit answers only — deriving a pick from an
 * answer the reader already gave cannot add a row to anything.
 *
 * The two stores still never join. This module reads both and writes NEITHER;
 * it returns a rendering decision and nothing else. That is deliberate — the
 * moment a derived pick were WRITTEN into the picks file it would become
 * indistinguishable from one the reader made, and rule 3's "explicit outranks
 * derived" would have nothing left to compare.
 *
 * Pure, and free of both storages, so the whole rule set is testable without a
 * browser.
 */

export interface PickResolution {
  /** What the section renders as chosen. Empty when there is no pick. */
  chosen: string[];
  /**
   * How the pick was arrived at. `DERIVED` is a Yes the reader gave on the
   * reaction control; `EXPLICIT` is a tap on the pick control itself.
   */
  basis: "EXPLICIT" | "DERIVED" | "NONE";
  /**
   * Choices the reader has said Yes to that are NOT the recorded pick. Rule 3:
   * this is a conflict to surface, never a reason to flip anything.
   */
  conflicting: string[];
  /**
   * True when the section must ASK. False when it has an answer and should
   * state it — rule 1's "does NOT ask again".
   */
  asks: boolean;
}

/**
 * Resolve what the pick section should do, from the explicit pick file and the
 * device's own Yes answers in this contest.
 *
 * `yesChoiceIds` are pick-option ids, already mapped from reaction targets by
 * the caller — this module never knows how a reaction is keyed, which is what
 * keeps it free of the reaction store's shape.
 */
export function resolvePick(
  explicit: StoredPick | null,
  yesChoiceIds: readonly string[],
  voteFor: number,
): PickResolution {
  const yes = [...new Set(yesChoiceIds)];
  const picked = explicit?.choiceIds ?? [];

  // Rule 3, first half: an explicit pick outranks everything. It is stated,
  // not re-asked, and a Yes elsewhere becomes a conflict to surface rather
  // than a silent overwrite.
  if (picked.length > 0) {
    return {
      chosen: picked,
      basis: "EXPLICIT",
      conflicting: yes.filter((id) => !picked.includes(id)),
      asks: false,
    };
  }

  // Rule 1: a Yes within the seat count IS the pick, and the race stops
  // asking. A multi-seat race derives the same way — up to what it allows.
  if (yes.length >= 1 && yes.length <= Math.max(1, voteFor)) {
    return { chosen: yes, basis: "DERIVED", conflicting: [], asks: false };
  }

  // Rule 2, second half: Yes to more than the seat allows is not a pick. The
  // section surfaces every one of them and asks which — it never picks the
  // first, the newest, or the alphabetically luckiest.
  if (yes.length > Math.max(1, voteFor)) {
    return { chosen: [], basis: "NONE", conflicting: yes, asks: true };
  }

  // Rule 2, first half: nobody said Yes to anybody. The ordinary ask.
  return { chosen: [], basis: "NONE", conflicting: [], asks: true };
}

/**
 * The line the section shows when a pick was derived rather than tapped.
 *
 * It says WHERE the pick came from, because a checkmark the reader does not
 * remember making is worse than no checkmark: they would not know whether the
 * product had guessed. It is one sentence, level register, and it names the
 * other control by what the reader actually did there.
 */
export const DERIVED_PICK_LINE =
  "You said you'd vote for them, so we've marked this as your pick. Change it any time — it stays on this phone.";

/** The conflict line. It states the disagreement and asks; it never resolves
 *  one on the reader's behalf, and it never says which is more likely. */
export function conflictLine(
  chosenLabels: readonly string[],
  otherLabels: readonly string[],
): string {
  if (chosenLabels.length === 0) {
    return `You said you'd vote for ${list(otherLabels)}. That's more than this race elects — pick the one you want on your ballot.`;
  }
  return `Your pick here is ${list(chosenLabels)}, and you also said you'd vote for ${list(otherLabels)}. We haven't changed anything — pick the one you want.`;
}

function list(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
