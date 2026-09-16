/**
 * **THE DECISION QUEUE: COLLAPSED, GROUPED, AND HONEST ABOUT HOW FAR EACH
 * DECISION HAS ACTUALLY TRAVELLED.** (ADM-31, ADM-32; §9A.8 and §9A.18.)
 *
 * ADM-32 is the third pass on the same complaint and the spreadsheet marks it
 * Critical. The owner recorded three decisions on 2026-09-06 and reported:
 *
 * > *"When I click on one it doesn't look like anything happens. Nothing
 * > disappears. It doesn't say 'decided.' It doesn't move. It just looks like
 * > I'm clicking on nothing."*
 *
 * And, having found the receipt afterwards:
 *
 * > *"Now it sits in 'decided' and it just says 'recorded,' 'closed' in the
 * > tracker, and 'work' opened. What does that mean? … I don't know. Are we
 * > done? I don't know what the next steps are after that."*
 *
 * The plumbing was right — the sync really does close the tracker row — and
 * that is exactly why it kept coming back: a correct backend with no visible
 * result is indistinguishable from a dead button.
 *
 * ADM-31 is the other half: seventy-eight full cards in one endless scroll.
 *
 * ## What this module owns
 *
 * The PURE half: grouping, ordering, the owner-facing type of a card, and the
 * lifecycle stage a recorded decision has actually reached. The visible
 * acknowledgement is the client island's job (`admin/decisions.tsx`); this
 * module is what both it and the server render from, so they cannot disagree
 * about what "decided" means.
 *
 * ## The lifecycle (§9A.18)
 *
 * A decision record is NOT an implementation, and the console said so in code
 * words. The seven stages, and what evidence each one requires:
 *
 * ```
 *   NEEDS_ME      no decision recorded against this row
 *   DECIDED       an intent exists; the sync has not applied it yet
 *   QUEUED        the sync applied it and opened work, or the choice implied none
 *   IMPLEMENTED   a work item the decision opened has been reported done
 *   ON_MAIN       that work reached the main branch
 *   LIVE          it is deployed
 *   VERIFIED      a post-deploy proof exists for it
 * ```
 *
 * **Only the first three are derivable from the decision log today.** The
 * decision intent carries `openedWork` and `canonicalRef`; nothing in it says
 * whether that work was finished, merged, deployed or proved. So this module
 * computes the first three and reports the rest as NOT KNOWN FROM HERE, with
 * the exact record that would supply them. §15 of the brief: a green status
 * must have a provenance, unknown stays unknown, and no data is never rendered
 * as zero success. Inventing an `IMPLEMENTED` badge out of a closed tracker row
 * would be exactly the false green the owner has been burned by.
 *
 * PURE. Cards and a collapsed decision log in, groups out.
 */
import { decisionCardKind, type OwnerDecisionCard, type OwnerDecisionIntent } from "./owner-surface.ts";
import { impliesNoWork } from "./decision-receipt.ts";

/* ---------------------------------------------------------------- types */

/**
 * The owner-facing type of a waiting card — the second grouping level ADM-31
 * asks for, after priority.
 *
 * The words are the owner's own: *"What type is it? Is it an engineering
 * situation, is something broken, or is this something for me to act on at some
 * point?"*
 */
export const OWNER_TYPES = ["MY_CALL", "ENGINEERING_WAITING", "SOMETHING_BROKEN", "JUST_READ"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const OWNER_TYPE_WORDS: Readonly<Record<OwnerType, { title: string; means: string }>> = {
  MY_CALL: { title: "Needs my call", means: "A judgement only you can make. Nothing moves until you make it." },
  ENGINEERING_WAITING: { title: "Engineering is waiting", means: "A work session is blocked until this is answered." },
  SOMETHING_BROKEN: { title: "Something is broken", means: "A machine-checked wall. It clears itself the moment the blocker stops being true." },
  JUST_READ: { title: "Just read it", means: "For your information. Acknowledge it and it leaves the queue." },
};

/**
 * Which type a card is.
 *
 * `BLOCKED_WHILE` is a machine-checked predicate that clears itself, so it is
 * "something is broken" rather than a decision. `ACKNOWLEDGE` is a read.
 * Among real decisions, one whose options name a work session or a blocked
 * route is engineering waiting; the rest are the owner's call.
 */
export function ownerTypeOf(card: OwnerDecisionCard): OwnerType {
  const kind = decisionCardKind(card);
  if (kind === "BLOCKED_WHILE") return "SOMETHING_BROKEN";
  if (kind === "ACKNOWLEDGE") return "JUST_READ";
  const text = `${card.whatIsNeeded} ${card.options.map((o) => o.consequence).join(" ")}`.toLowerCase();
  return /\b(blocked|unblocks|route|session|engineering|implementation|ship|merge|gate)\b/.test(text)
    ? "ENGINEERING_WAITING"
    : "MY_CALL";
}

/* ----------------------------------------------------------- lifecycle */

export const LIFECYCLE_STAGES = ["NEEDS_ME", "DECIDED", "QUEUED", "IMPLEMENTED", "ON_MAIN", "LIVE", "VERIFIED"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export interface LifecycleReading {
  /** The farthest stage the evidence actually supports. */
  readonly stage: LifecycleStage;
  /** One plain sentence: what has happened. */
  readonly says: string;
  /** One plain sentence: what happens next, or that nothing does. */
  readonly next: string;
  /** True when the record cannot say whether it went further than this. */
  readonly furtherUnknown: boolean;
  /** What record would tell us, when we cannot tell. */
  readonly wouldTell: string | null;
}

/**
 * How far a recorded decision has travelled, from the decision log alone.
 *
 * Deliberately conservative. The log knows three things: that an intent exists,
 * whether the sync applied it, and what it opened. Everything past that is a
 * fact about a work item, a branch and a deploy, and this record does not carry
 * it — so the reading says so by name rather than guessing.
 */
export function lifecycleOf(decision: OwnerDecisionIntent): LifecycleReading {
  const opened = decision.openedWork ?? [];
  const noWork = impliesNoWork(decision);

  if (decision.state === "REJECTED_BY_GATES") {
    return {
      stage: "DECIDED",
      says: `Your answer is on record, but the sync refused to close the row: ${decision.refusedReason ?? "no reason was recorded"}.`,
      next: "The row stays open and a work session picks up the refusal.",
      furtherUnknown: false,
      wouldTell: null,
    };
  }

  if (decision.state !== "CANONICALIZED") {
    return {
      stage: "DECIDED",
      says: "Recorded. The runner has not applied it to the tracker yet.",
      next: "The next runner cycle closes the row in your name — usually within about twenty minutes while it is running.",
      furtherUnknown: false,
      wouldTell: null,
    };
  }

  if (noWork && opened.length === 0) {
    return {
      stage: "QUEUED",
      says: "Recorded, and the row is closed. This choice implied no follow-up work.",
      next: "Nothing else is needed from you.",
      furtherUnknown: false,
      wouldTell: null,
    };
  }

  if (opened.length === 0) {
    return {
      stage: "QUEUED",
      says: "Recorded, and the row is closed. No follow-up row was opened.",
      next: "If this choice implied work, it has not been minted yet; the runner's console line names any refusal.",
      furtherUnknown: false,
      wouldTell: null,
    };
  }

  return {
    stage: "QUEUED",
    says: `Recorded, the row is closed, and ${opened.length === 1 ? "a work item was" : `${opened.length} work items were`} opened: ${opened.map((w) => w.title).join("; ")}.`,
    next: "A work session picks this up. You will see it move on the work queue.",
    furtherUnknown: true,
    wouldTell:
      "Whether that work is finished, merged into main, deployed and proved is a fact about the work item and the deploy, not about your decision — the decision record does not carry it, so this page will not claim it.",
  };
}

/** The stage words the console shows. */
export const STAGE_WORDS: Readonly<Record<LifecycleStage, string>> = {
  NEEDS_ME: "Needs me",
  DECIDED: "Decided",
  QUEUED: "Work queued",
  IMPLEMENTED: "Implemented",
  ON_MAIN: "On main",
  LIVE: "Live",
  VERIFIED: "Verified live",
};

/* ------------------------------------------------------------ grouping */

export interface TypeGroup {
  readonly type: OwnerType;
  readonly title: string;
  readonly means: string;
  readonly cards: readonly OwnerDecisionCard[];
}

export interface PriorityGroup {
  /** `P1`, `P2`, … or whatever the tracker actually carries. */
  readonly priority: string;
  readonly count: number;
  readonly types: readonly TypeGroup[];
}

/**
 * Group the waiting cards by priority, then by owner type, both in a stable
 * order, with oldest first inside a type.
 *
 * The priorities are read from the cards rather than hard-coded: the tracker
 * owns them, and a console that pins `P1`/`P2` would silently drop a `P0` the
 * day one existed. Anything that does not look like `P<n>` sorts last under its
 * own name.
 */
export function groupWaiting(cards: readonly OwnerDecisionCard[]): readonly PriorityGroup[] {
  const byPriority = new Map<string, OwnerDecisionCard[]>();
  for (const card of cards) {
    const key = (card.priority ?? "").trim() === "" ? "No priority set" : card.priority.trim();
    const list = byPriority.get(key);
    if (list) list.push(card);
    else byPriority.set(key, [card]);
  }
  const rank = (p: string): number => {
    const m = /^P(\d+)$/i.exec(p);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  return [...byPriority.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([priority, list]) => ({
      priority,
      count: list.length,
      types: OWNER_TYPES.map((type) => ({
        type,
        title: OWNER_TYPE_WORDS[type].title,
        means: OWNER_TYPE_WORDS[type].means,
        cards: list
          .filter((c) => ownerTypeOf(c) === type)
          .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0)),
      })).filter((g) => g.cards.length > 0),
    }));
}

/**
 * Flatten a published card into what the decision island renders.
 *
 * Extracted here so both the control centre and the fleet page use the same
 * projection. `WaitingCardView` is defined in `admin/decisions.tsx`.
 */
export function waitingCardView(card: OwnerDecisionCard): {
  readonly rowId: string;
  readonly title: string;
  readonly whatIsNeeded: string;
  readonly whyNoMachineCanDecide: string;
  readonly options: readonly { readonly option: string; readonly consequence: string }[];
  readonly meta: string;
  readonly priority: string;
  readonly type: OwnerType;
  readonly blocker: string | null;
  readonly checkedThisRun: string | null;
  readonly ownWords: boolean;
} {
  const kind = decisionCardKind(card);
  const meta = [
    card.priority,
    card.openedOn ? `opened ${card.openedOn}` : "opened on a date the ledger could not recover",
    card.ageDays === null ? "age unknown" : `${card.ageDays} day${card.ageDays === 1 ? "" : "s"} waiting`,
    card.blockedDescendants === null ? null : `${card.blockedDescendants} waiting behind it`,
  ].filter((s): s is string => s !== null);
  return {
    rowId: card.rowId,
    title: card.title,
    whatIsNeeded: card.whatIsNeeded,
    whyNoMachineCanDecide: card.whyNoMachineCanDecide,
    options: card.options,
    meta: meta.join(" · "),
    priority: card.priority,
    type: ownerTypeOf(card),
    blocker: kind === "BLOCKED_WHILE" ? (card.blocker ?? card.whatIsNeeded) : null,
    checkedThisRun: card.checkedThisRun ?? null,
    ownWords: kind === "DECISION",
  };
}

/**
 * The one-line summary the collapsed header carries, so the owner knows what is
 * inside before he opens it.
 */
export function waitingSummary(groups: readonly PriorityGroup[]): string {
  if (groups.length === 0) return "Nothing is waiting on you.";
  const parts = groups.map((g) => `${g.count} at ${g.priority}`);
  const total = groups.reduce((n, g) => n + g.count, 0);
  return `${total} waiting — ${parts.join(", ")}.`;
}

/** The counts the collapsed `Decided` header shows (§9A.18). */
export interface DecidedCounts {
  readonly decided: number;
  readonly awaitingImplementation: number;
  readonly implemented: number;
  readonly integrated: number;
  readonly live: number;
  /** Decisions whose later stages this record cannot see. Never rendered as zero. */
  readonly furtherUnknown: number;
}

export function decidedCounts(decisions: readonly OwnerDecisionIntent[]): DecidedCounts {
  let awaiting = 0;
  let unknown = 0;
  for (const d of decisions) {
    const reading = lifecycleOf(d);
    if (reading.stage === "DECIDED" || reading.stage === "QUEUED") awaiting += 1;
    if (reading.furtherUnknown) unknown += 1;
  }
  return {
    decided: decisions.length,
    awaitingImplementation: awaiting,
    // Not derivable from the decision log; see the module header. Zero here
    // would be a claim, so the page renders these as "not tracked from here".
    implemented: 0,
    integrated: 0,
    live: 0,
    furtherUnknown: unknown,
  };
}

/**
 * What the console says beneath the `Decided` header about the stages it cannot
 * see. Written once so no component invents a cheerier version.
 */
export const LATER_STAGES_UNKNOWN =
  "Whether the work a decision opened has been finished, merged and deployed is not recorded on the decision itself. Those rows live on the work queue and the integration surface, and this page will not claim a stage it cannot read.";
