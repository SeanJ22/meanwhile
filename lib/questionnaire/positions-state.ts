/**
 * The Positions section's three empty states, each attributing the gap to its actual cause:
 * 1. `NOT_YET_ASKED`: we found nothing published and have not sent our questions (our gap).
 * 2. `ASKED_AWAITING_ANSWER`: sent and reminded on these dates, no answer yet (the process, identical
 *    for everyone in the contest).
 * 3. `NO_FILED_CONTACT`: the public filing carries no way to reach them (a fact about the record).
 *
 * None of the three may read as evasion, refusal or declining. This is not a gate: every answer we hold
 * renders regardless of other candidates.
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
   * Whether the public filing carries a way to reach them. `null` (the default) means nobody has
   * established this, and falls to the state that describes only our gap.
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

/** The sentence the section shows. */
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
 * The state to assume where nothing has been established, as one constant so no surface picks a
 * different default.
 */
export const UNESTABLISHED: PositionsEmptyStateInput = {
  invitedOn: null,
  remindedOn: [],
  hasFiledContact: null,
};
