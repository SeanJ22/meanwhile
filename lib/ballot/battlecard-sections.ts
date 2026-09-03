/**
 * **THE BATTLECARD SCHEMA — the same seven, on every card, always.**
 * (BC-1, BC-2, BC-5, BC-6, 2026-08-22, the author's 8/22 walkthrough, item 14.)
 *
 * *"Information is currently parsed onto cards haphazardly because there is no
 * standard."* This is the standard. Mark Kelly's card is the reference for
 * completeness; local candidates will be thin, and that is expected. **The
 * pills exist regardless.**
 *
 * ## Why the SET is fixed and never varies
 *
 * A card whose sections appear and disappear with what we hold makes a
 * well-covered person's card taller and more substantial than a thin one's.
 * That is a layout asymmetry, and a layout asymmetry tracks incumbency and
 * campaign professionalism rather than anything about the people — the exact
 * information asymmetry the equal-effort rule exists to catch. So the SET is
 * identical for everyone and only what is inside differs.
 *
 * This does not reopen SHOW EVERYTHING WE FIND (RULING 26). Everything held
 * renders; collection state never governs display. An empty drop-down is not a
 * completeness statement about the card — it is a section with nothing in it,
 * saying why.
 *
 * ## The two empty states, and why one was not enough (BC-2)
 *
 * An empty Voting record on someone who **has never held the office** and an
 * empty Voting record on an **incumbent whose record we have not collected**
 * are different facts, and rendering them as the same sentence would be the
 * render-default rule broken: a null becoming an assertion.
 *
 * It is also the equal-effort rule at its most sensitive point. Without the
 * distinction, a challenger's card reads as thinner than an incumbent's
 * **because of copy rather than data** — the app appearing to know less about
 * the challenger, when in fact there is nothing to know because they have not
 * held the seat. That is the thumb on the scale this product exists to keep
 * off.
 *
 * There is deliberately no per-card completeness statement in any wording — no
 * sentence, no count, no marker, no digit saying what a card lacks (RULING 44).
 * One page-level line only, and it appears once in the ballot section and once
 * on the battlecard (RULING 51).
 */

/** The stable id of each section. Internal — never rendered. */
export type BattlecardSectionId =
  | "office"
  | "positions"
  | "committees"
  | "offices"
  | "money"
  | "record"
  | "sources";

export interface BattlecardSectionSpec {
  id: BattlecardSectionId;
  /** Reader-facing. Plain language, 15-year-old test. */
  title: string;
  /**
   * What the section says when it holds nothing, in the ordinary case.
   *
   * Describes OUR research or the person's situation — never the person as
   * lacking something. Level register: a battlecard is a claim surface.
   */
  emptyLine: string;
}

/**
 * The order is the reading order the author gave, verbatim:
 * *"What this office does · Positions · Committees · Offices near you ·
 * Campaign money · Voting record · Sources"*.
 *
 * "What this office does" is FIRST and is mandatory for every candidate and
 * every elected official (BC-6): someone voting for governor needs to know what
 * a governor does, and the same is true of every office on the ballot.
 */
export const BATTLECARD_SECTIONS: readonly BattlecardSectionSpec[] = [
  {
    id: "office",
    title: "What this office does",
    /*
     * **The refusal clause is gone** (2026-08-23, item 4). This read *"...so we
     * can't describe it here"*, which is the sentence the two-layer definition
     * ruling deleted from the body cards on 2026-08-22 and which survived here
     * because this file was never swept with them — a named instance whose
     * sibling nobody looked for.
     *
     * It is the worst place in the product for it. This section is FIRST and is
     * mandatory for every candidate and every elected official, so the refusal
     * was the first thing a reader met on the card of a person asking for their
     * vote.
     *
     * What replaces it names OUR gap and then points at what IS there, which is
     * the shape `NO_BODY_BLURB_LINE` already uses in `lib/officials/body-description.ts`.
     * A card may say it has not read the law. It may not say it will therefore
     * tell the reader nothing.
     */
    emptyLine:
      "We haven't yet read the law that says what this office decides. What we do hold about it is below.",
  },
  {
    id: "positions",
    title: "Positions",
    emptyLine:
      "We haven't found anything this person has published about where they stand.",
  },
  {
    id: "committees",
    title: "Committees",
    emptyLine: "We don't hold a committee assignment for this person.",
  },
  {
    id: "offices",
    title: "Offices near you",
    emptyLine: "We don't hold an office location for this person.",
  },
  {
    id: "money",
    title: "Campaign money",
    emptyLine: "We don't hold a campaign finance filing for this person.",
  },
  {
    id: "record",
    title: "Voting record",
    // Overridden per candidate — see `votingRecordEmptyLine`.
    emptyLine: "We haven't collected this person's voting record yet.",
  },
  {
    id: "sources",
    title: "Sources",
    emptyLine: "Nothing on this card has a source record yet.",
  },
] as const;

/**
 * Which of the two empty states the Voting record section shows.
 *
 * `holdsOrHeldTheOffice` is a fact about the PERSON, established from whether
 * an officeholder record joins to them — never from how much we happen to hold
 * about them. That distinction is the whole point: the first sentence is about
 * their situation and the second is about our research, and only one of them is
 * ours to make.
 */
export function votingRecordEmptyLine(holdsOrHeldTheOffice: boolean): string {
  /*
   * ITEM 13 (2026-08-26) — AN ABSENCE MAY DESCRIBE OUR SOURCING AND MAY NEVER
   * ASSERT A FACT ABOUT A PERSON.
   *
   * The second branch used to read "People who have not held this office don't
   * have a voting record to show." That is a claim about the reader's
   * candidate, it is not an empty state, and on 2026-08-26 the product was
   * making it on the card of Karen Ebel, the sitting Deputy Speaker of the New
   * Hampshire House — because the flag behind it came from a lookup that is
   * federal-only by construction.
   *
   * BOTH BRANCHES NOW DESCRIBE US. The distinction BC-2 was built for survives
   * in what is named — a record IN THIS OFFICE versus a record at all — and
   * neither sentence says anything about what the person has or has not done.
   */
  return holdsOrHeldTheOffice
    ? "We haven't sourced this person's voting record in this office yet."
    : "We haven't sourced a voting record for this person yet.";
}

/** Reader-facing title for a section id. Never an enum value on a surface. */
export function battlecardSectionTitle(id: BattlecardSectionId): string {
  return BATTLECARD_SECTIONS.find((s) => s.id === id)?.title ?? "";
}
