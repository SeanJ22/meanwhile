import { resolvePick, type PickResolution } from "./derived-picks.ts";
import type { StoredPick } from "./picks.ts";

/**
 * **The one place a pick is resolved, and the one place picks are counted.**
 * (F01-continued items 8 and 9, 2026-08-19.)
 *
 * ## Why this module exists
 *
 * A pick could be arrived at two ways and only one of them was ever counted.
 * `wtp.ballot_picks` holds EXPLICIT picks — a tap on the pick control — and
 * `resolvePick` derives a pick from a Yes the reader gave on the reaction
 * control above (M134). The per-contest control resolved both; **the "My
 * picks" list read the explicit file alone.**
 *
 * The consequence was not cosmetic, and it fell along a line that matters:
 * a MEASURE has no measure-level reaction — reactions attach to provisions
 * (`CLAUDE.md`, reaction capture) — so a measure pick can only ever be
 * explicit, and it was always counted. A CANDIDATE carries a reaction target,
 * so answering "yes, I'd vote for them" produced a pick the race stated and
 * the reader's own ballot never listed. The author found it from the outside:
 * *"the tally counts state ballot measures only. Candidate picks are not
 * counted."* The undercount was structural, and it was on the surface that
 * carries this product's whole promise.
 *
 * ## And the second half — clearing
 *
 * "Clear my picks" called `clearAllPicks`, which empties the explicit file.
 * Every derived pick survived it, so the card vanished and the picks stayed
 * on the page underneath. A control that reads as a delete and is not one is
 * a trust defect on a privacy-adjacent surface, not a display bug.
 *
 * **The clear may not reach into the reaction record**, and that is not
 * timidity: `wtp.reactions` is the device's own copy of answers it has
 * already sent, and it exists so a reader can CHANGE one. Deleting it would
 * take away that ability while removing nothing from the anonymous totals —
 * the totals cannot be un-joined, which the capture notice already says. So
 * the suppression lives in the PICKS file, where the reader's instruction
 * actually belongs: they asked for no picks, and no pick renders.
 *
 * A suppression is per contest and records WHICH derived choices were
 * cleared. Say Yes to somebody else afterwards and the derived set no longer
 * matches, so the pick comes back — which is right, because that is a new
 * answer rather than the one they cleared.
 */

/** One contest a reader can make a pick in, as the page actually renders it. */
export interface PickableContest {
  contestId: string;
  contestTitle: string;
  voteFor: number;
  options: { id: string; label: string; reactionTargetId?: string }[];
}

export interface TalliedPick {
  contestId: string;
  contestTitle: string;
  /** Display labels, resolved through the contest's own options. */
  chosen: string[];
  basis: "EXPLICIT" | "DERIVED";
}

export interface PickTally {
  /** Contests on THIS ballot with a resolved pick. */
  picked: number;
  /** Contests on THIS ballot a reader can pick in — the rendered rows. */
  pickable: number;
  /** The picks themselves, in the page's own contest order. */
  rows: TalliedPick[];
  /** Explicit picks stored from a DIFFERENT ballot. Listed, never counted. */
  foreign: StoredPick[];
}

/** Map newest-first reaction targets to this contest's choice ids. */
function yesChoiceIdsFor(
  contest: PickableContest,
  yesTargetIds: ReadonlySet<string>,
): string[] {
  const choiceByTarget = new Map(
    contest.options.flatMap((option) =>
      option.reactionTargetId
        ? [[option.reactionTargetId, option.id] as const]
        : [],
    ),
  );
  return [...yesTargetIds].flatMap((targetId) => {
    const choiceId = choiceByTarget.get(targetId);
    return choiceId ? [choiceId] : [];
  });
}

/**
 * Resolve one contest's pick, honouring a clear.
 *
 * Used by the per-contest control AND by the tally, so the two can never
 * disagree about what a pick is — which is the defect this replaces.
 */
export function resolveWithSuppression(
  explicit: StoredPick | null,
  yesChoiceIds: readonly string[],
  voteFor: number,
  suppressedDerived: readonly string[] | undefined,
): PickResolution {
  const explicitResolution = resolvePick(explicit, yesChoiceIds, voteFor);
  if (explicitResolution.basis === "EXPLICIT") return explicitResolution;
  if (!suppressedDerived || suppressedDerived.length === 0) {
    return explicitResolution;
  }
  const cleared = new Set(suppressedDerived);
  return resolvePick(
    null,
    yesChoiceIds.filter((choiceId) => !cleared.has(choiceId)),
    voteFor,
  );
}

/**
 * Count the reader's ballot.
 *
 * `pickable` is the manifest the page builds from the SAME option builders it
 * renders the controls with, so the denominator is the rendered row count by
 * construction rather than by a second query that could disagree with it.
 */
export function tallyPicks(
  pickable: readonly PickableContest[],
  explicitPicks: readonly StoredPick[],
  yesTargetIds: ReadonlySet<string>,
  suppressedDerived: Readonly<Record<string, string[]>>,
): PickTally {
  const byId = new Map(explicitPicks.map((p) => [p.contestId, p]));
  const onThisBallot = new Set(pickable.map((c) => c.contestId));
  const rows: TalliedPick[] = [];

  for (const contest of pickable) {
    const yes = yesChoiceIdsFor(contest, yesTargetIds);
    const resolution = resolveWithSuppression(
      byId.get(contest.contestId) ?? null,
      yes,
      contest.voteFor,
      suppressedDerived[contest.contestId],
    );
    if (resolution.basis === "NONE" || resolution.chosen.length === 0) continue;
    const explicit = byId.get(contest.contestId);
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
    // A pick stored against a contest this ballot does not carry. Kept and
    // labelled (4c) — deliberate work is never deleted for looking at another
    // state — and deliberately OUTSIDE the count, because the denominator is
    // this ballot's rows and a numerator drawn from elsewhere would not
    // reconcile against it.
    foreign: explicitPicks.filter((p) => !onThisBallot.has(p.contestId)),
  };
}

/**
 * The derived picks a clear has to suppress, keyed by contest.
 *
 * **It resolves against NO explicit picks, and that is the whole correctness
 * of it.** The first version passed the reader's stored picks in, which meant
 * a contest holding both an explicit pick and a Yes resolved as EXPLICIT and
 * was not suppressed — and then `clearAllPicks` emptied the explicit file and
 * the Yes surfaced as a derived pick in the very same render. The walk caught
 * it on all four pilot zips: the box came back with "Your pick for this race:
 * Katie Hobbs" still standing after a clear.
 *
 * A clear removes the explicit picks, so the state to suppress is the state
 * that will exist AFTER they are gone. It is still specific — the choices the
 * device's current answers would derive, not "derive nothing here ever" — so
 * a Yes given later still becomes a pick.
 */
export function derivedToSuppress(
  pickable: readonly PickableContest[],
  yesTargetIds: ReadonlySet<string>,
  suppressedDerived: Readonly<Record<string, string[]>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...suppressedDerived };
  for (const contest of pickable) {
    const yes = yesChoiceIdsFor(contest, yesTargetIds);
    // No explicit pick, deliberately: see above.
    const resolution = resolvePick(null, yes, contest.voteFor);
    if (resolution.basis === "DERIVED" && resolution.chosen.length > 0) {
      out[contest.contestId] = [...resolution.chosen];
    }
  }
  return out;
}

/**
 * The count line. Level register — it is a statement of fact about the
 * reader's own ballot, and it names both kinds so the number is checkable
 * against what they can see.
 */
export function tallyLine(tally: PickTally): string {
  const races = tally.pickable === 1 ? "race or measure" : "races and measures";
  return `${tally.picked} of ${tally.pickable} ${races} on this ballot`;
}
