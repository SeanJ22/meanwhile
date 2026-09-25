/**
 * **THE CLOSED VOCABULARY OF THE GAPS ASK STATES ABOUT A BODY.** (2026-09-25.)
 *
 * A leaf with no imports, so Ask (`held-gaps.ts`, which decides them), the
 * standing runner's `ask-gaps` provider (which turns each into tracked work)
 * and Admin (which counts them) all read ONE list. See `held-gaps.ts` for what
 * each code is decided from.
 */

export const ASK_GAP_CODES = ["OUTCOME_NOT_READ", "AGENDA_NOT_HELD", "CALENDAR_STALE", "OUTCOMES_UNREADABLE"] as const;
export type AskGapCode = (typeof ASK_GAP_CODES)[number];

/** The routine record class whose read closes each gap (`lib/civic-data/types.ts`). Agenda documents ride in MEETING partitions. */
export type AskGapRecordClass = "MEETING" | "MEETING_OUTCOME";

export const ASK_GAP_RECORD_CLASS: Readonly<Record<AskGapCode, AskGapRecordClass>> = {
  OUTCOME_NOT_READ: "MEETING_OUTCOME",
  AGENDA_NOT_HELD: "MEETING",
  CALENDAR_STALE: "MEETING",
  OUTCOMES_UNREADABLE: "MEETING_OUTCOME",
};

/** Each code as the owner reads it. */
export const ASK_GAP_CODE_WORDS: Readonly<Record<AskGapCode, string>> = {
  OUTCOME_NOT_READ: "Outcome not read",
  AGENDA_NOT_HELD: "Agenda not held",
  CALENDAR_STALE: "Calendar read is stale",
  OUTCOMES_UNREADABLE: "Recorded outcomes unreadable",
};

export function isAskGapCode(value: unknown): value is AskGapCode {
  return typeof value === "string" && (ASK_GAP_CODES as readonly string[]).includes(value);
}
