/**
 * **WHAT "DEPLOY FLEET HERE" ACTUALLY DOES, BEFORE IT DOES IT.** (§9A.16.)
 *
 * The owner has a button on every readiness row and on the console home, and he
 * has deliberately never pressed either one:
 *
 * > *"The owner has intentionally not used `Deploy fleet here` because the
 * > current UI does not explain what it will do. This control must not remain
 * > an unexplained black box."*
 *
 * So this module is the preview. It is PURE, and every sentence in it is either
 * a fact about the canonical action or a named gap — because the one thing a
 * confirmation panel may not do is describe a different action from the one the
 * button performs.
 *
 * ## What the canonical action is, exactly
 *
 * `fleet.deployHere` appends a `DISPATCH` intent carrying the owner's own
 * words. On its next look the standing runner parses them into a target
 * (`scheduler/dispatch-target.ts`), moves every REGISTERED unit that matches to
 * the front of that cycle's queue, and records what matched — including
 * nothing, by name. It does not mint work, does not open a record class, does
 * not publish, and does not turn promotion on. The preview says exactly that,
 * in those words, because §9A.16 requires the wording to match the action
 * actually performed.
 *
 * ## The number it will not invent
 *
 * "How many work items will this create?" has an honest answer and it is zero:
 * a dispatch creates none. "How many will it move to the front?" is a real
 * question with a real answer — and the answer lives in the registry the RUNNER
 * enumerates at the start of a cycle, not in anything the deployed console
 * holds. The console can count the standing obligations that match, which is
 * the closest true figure, and it says which figure it is.
 */
import { parseDispatchTarget, type DispatchTarget } from "./scheduler/dispatch-target.ts";
import { stateCodeOf } from "./unit-state.ts";
import { count, usdCents } from "./plain-words.ts";

/** One thing the preview asserts, in the owner's words. */
export interface PreviewLine {
  readonly says: string;
  /** True when the figure behind the sentence is a real measurement. */
  readonly measured: boolean;
}

export interface DeployPreview {
  /** The words the owner typed, parsed into what the runner will read. */
  readonly target: DispatchTarget;
  /** What this means, in one sentence. */
  readonly means: string;
  /** What work it creates, and the count with its denominator. */
  readonly creates: readonly PreviewLine[];
  /** What it explicitly will NOT do. Fixed, and true of every dispatch. */
  readonly willNot: readonly string[];
  /** What happens after, in owner language. */
  readonly after: readonly string[];
  /** The roles that could take part. */
  readonly roles: string;
  /** The spend ceilings this work runs under, to the cent. */
  readonly ceilings: string;
  /** True when the target names nothing the console can find. */
  readonly matchesNothing: boolean;
  readonly needsYou: boolean;
}

/** What a dispatch never does. Fixed, because it is a property of the action. */
export const DEPLOY_WILL_NOT: readonly string[] = [
  "It publishes nothing to readers. Promotion stays off.",
  "It opens no new class of record.",
  "It invents no work — it can only move work the fleet already owes.",
  "It runs no code and ships nothing.",
  "It spends nothing outside the limits already set on the runner.",
  "It looks for no new source outside the work it already has.",
];

/** The stages, in the owner's words rather than the pipeline's. */
export const DEPLOY_AFTER: readonly string[] = [
  "In the queue — the next cycle reads your instruction",
  "Finding the source",
  "Fetching the records",
  "Pulling the facts out of them",
  "Checking them against the source",
  "Trying to break them",
  "Ready — and held, because publishing to readers is a separate, governed step that is off",
];

export interface DeployPreviewInput {
  /** The owner's own words. */
  readonly note: string;
  /**
   * The standing obligations the console can see, as the id/subject pairs the
   * matcher reads. Empty when the console could not read them, which the
   * preview then says rather than reporting a zero.
   */
  readonly obligations: readonly { readonly id: string; readonly subjectId: string }[];
  readonly obligationsRead: boolean;
  /** The runner's own ceilings, so the preview quotes the real numbers. */
  /**
   * The runner's own ceilings, so the preview quotes the real numbers.
   *
   * ADM-62: `maxDispatchesPerCycle` is the FLEET-WIDE dispatch ceiling (10) and
   * it is not what binds this work. The research lane starts at most
   * `researchPerCycle` Scouts a cycle and runs at most `researchConcurrent` at
   * once, and those are the numbers that decide how fast a deployment here
   * actually moves. Quoting the looser ceiling overstated it by more than
   * threefold — the same class of defect as calling a job cap a budget
   * (ADM-51): a real number that is not the binding one.
   */
  readonly ceilings: {
    readonly cycleModelUsd: number;
    readonly rolling24HourModelUsd: number;
    readonly maxDispatchesPerCycle: number;
    readonly researchPerCycle: number;
    readonly researchConcurrent: number;
  };
}

export function deployPreview(input: DeployPreviewInput): DeployPreview {
  const target = parseDispatchTarget(input.note);
  const named = target.stateNames.length > 0 ? target.stateNames.join(" and ") : `"${target.text}"`;

  let matched = 0;
  for (const o of input.obligations) {
    const hay = `${o.id} ${o.subjectId}`.toLowerCase();
    const state = stateCodeOf(o.id, o.subjectId);
    const stateOk = target.states.length === 0 || (state !== null && target.states.includes(state));
    const termOk = target.terms.length === 0 || target.terms.some((t) => hay.includes(t));
    if (stateOk && termOk && (target.states.length > 0 || target.terms.length > 0)) matched += 1;
  }

  const creates: PreviewLine[] = [
    { says: "It creates no new work. A dispatch reorders what is already owed.", measured: true },
  ];
  if (!input.obligationsRead) {
    creates.push({
      says: "How many records this moves to the front could not be counted — the console could not read the standing obligations. That is a gap in this preview, not a statement that nothing matches.",
      measured: false,
    });
  } else if (input.obligations.length === 0) {
    creates.push({ says: "The console read the standing obligations and there are none, so there is nothing to move.", measured: true });
  } else {
    creates.push({
      says: `${count(matched)} of ${count(input.obligations.length)} records the system currently owes match ${named}. Those go to the front of the next cycle's queue.`,
      measured: true,
    });
    creates.push({
      says:
        `The runner starts at most ${count(input.ceilings.researchPerCycle)} of them per cycle and runs ` +
        `${count(input.ceilings.researchConcurrent)} at a time, so this is an ordering instruction rather ` +
        `than a batch — the rest keep their place behind them.`,
      measured: true,
    });
  }
  if (matched === 0 && input.obligationsRead && input.obligations.length > 0) {
    creates.push({
      says: `Nothing the system currently owes matches ${named}. The instruction is still recorded, and the cycle will say so by name rather than quietly doing nothing.`,
      measured: true,
    });
  }

  return {
    target,
    means: `Ask the research fleet to work ${named} next: it moves the records it already owes there to the front of the queue. This publishes nothing to readers and does not turn promotion on.`,
    creates,
    willNot: DEPLOY_WILL_NOT,
    after: DEPLOY_AFTER,
    roles: "Hunters find and fetch, Detectives and Parsers read what came back, Validators check it, Auditors try to break it.",
    ceilings: `Up to ${usdCents(input.ceilings.cycleModelUsd)} of paid model work in one cycle, inside a rolling ${usdCents(input.ceilings.rolling24HourModelUsd)} a day. Nothing here raises either.`,
    matchesNothing: input.obligationsRead && matched === 0,
    // A dispatch needs nothing from the owner beyond the instruction itself.
    needsYou: false,
  };
}
