/**
 * **THE POSITIONS DROP-DOWN'S THREE EMPTY STATES — one pill, each attributing
 * the gap to its actual cause.**
 * (Built 2026-08-23, the questionnaire-and-corpora brief, item 1.)
 *
 * ## Why a third state, and what it is distinct FROM
 *
 * BC-2 already ruled two empty states, and they live on the Voting record
 * section: *this person has never held the office* (a fact about THEM) and *we
 * have not collected their record* (a fact about US). The distinction exists
 * because rendering them as one sentence would be the render-default rule
 * broken — a null becoming an assertion.
 *
 * The questionnaire creates a third cause on the Positions section that neither
 * of those covers. **We asked this person directly and have not heard back.**
 * That is a fact about the PROCESS, it is neither our research gap nor their
 * situation, and it is the only one of the three that says something a reader
 * can check: everyone in the contest got the same questions on the same day.
 *
 * ## The three, and the rule they all obey
 *
 * 1. `NOT_YET_ASKED` — we have found nothing published and have not sent them
 *    our questions. **Ours.**
 * 2. `ASKED_AWAITING_ANSWER` — sent on this date, reminded on these dates, no
 *    answer yet. **The process**, and identical for everyone in the contest.
 * 3. `NO_FILED_CONTACT` — the public filing carries no way to reach this
 *    person, so they could not be asked. **A fact about the RECORD**, not about
 *    them and not about how hard we looked.
 *
 * **None of the three may read as evasion, avoidance, refusal or declining.** A
 * candidate owes us nothing, and a sentence implying otherwise would be this
 * product scoring somebody for silence. `tests/questionnaire.test.ts` holds the
 * banned shapes (RULING 110 — shapes, not one string) and asserts the shipped
 * sentences against them.
 *
 * ## What this is NOT
 *
 * It is not a completeness marker (RULING 42 and RULING 44 forbid those, and
 * this is not one — it is a section saying why it is empty, which RULING 28
 * permits and BC-2 already established). It is not a gate: `SHOW EVERYTHING WE
 * FIND` governs, and every answer we hold renders regardless of what any other
 * candidate did. And it is never derived from `hunt-state.ts`, which RULING 23
 * keeps out of every render path.
 */

export type PositionsEmptyState =
  | "NOT_YET_ASKED"
  | "ASKED_AWAITING_ANSWER"
  | "NO_FILED_CONTACT";

export interface PositionsEmptyStateInput {
  /** Whether an invitation was actually sent to this candidate. */
  invitedOn: string | null;
  /** Reminder dates, oldest first. */
  remindedOn: readonly string[];
  /**
   * Whether the public filing carries a way to reach them.
   *
   * **`null` means NOBODY HAS ESTABLISHED THIS, and it is the default.** A
   * default of `true` would assert we hold a contact for every candidate on
   * every surface that has not been wired yet — a placeholder becoming a
   * finding, which is the render-default rule. A default of `false` would
   * assert the opposite about the same people. `null` asserts neither and
   * falls to the state that only describes OUR gap.
   */
  hasFiledContact: boolean | null;
}

export function positionsEmptyState(input: PositionsEmptyStateInput): PositionsEmptyState {
  if (input.invitedOn !== null) return "ASKED_AWAITING_ANSWER";
  if (input.hasFiledContact === false) return "NO_FILED_CONTACT";
  return "NOT_YET_ASKED";
}

/** Dates as a reader reads them, not as a database stores them. */
function readable(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** A list a person reads, with an Oxford-free "and". */
function joinDates(dates: readonly string[]): string {
  const parts = dates.map(readable);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The sentence the section shows.
 *
 * Level register — this is a claim surface. Every one of the three states our
 * own gap or the record's gap to itself, and the middle one carries the
 * symmetry claim in the reader's own words rather than as a badge.
 */
export function positionsEmptyLine(input: PositionsEmptyStateInput): string {
  switch (positionsEmptyState(input)) {
    case "ASKED_AWAITING_ANSWER": {
      const sent = `We sent this person our questions on ${readable(input.invitedOn as string)}`;
      const reminded =
        input.remindedOn.length > 0
          ? ` and followed up on ${joinDates(input.remindedOn)}`
          : "";
      return `${sent}${reminded}. We haven't had an answer yet. Everyone running in this contest got the same questions on the same day.`;
    }
    case "NO_FILED_CONTACT":
      return "The public filing for this contest doesn't give us a way to reach this person, so we haven't been able to send them our questions.";
    case "NOT_YET_ASKED":
      return "We haven't found anything this person has published about where they stand, and we haven't sent them our questions yet.";
  }
}

/**
 * The state to assume where nothing has been established.
 *
 * Exported as a named constant rather than written inline at each call site, so
 * that a surface cannot quietly pick a different default and so the default
 * itself is one thing a test can assert about.
 */
export const UNESTABLISHED: PositionsEmptyStateInput = {
  invitedOn: null,
  remindedOn: [],
  hasFiledContact: null,
};
