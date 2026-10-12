/**
 * The closed vocabulary of the gaps Ask states about a body. A leaf with no
 * imports, so Ask (`held-gaps.ts`, which decides them), the runner's `ask-gaps`
 * provider and Admin all read one list. `MEETINGS_NOT_HELD` (a body we hold no
 * meeting of) becomes work only when a reader was told it
 * (`lib/control-plane/ask-gap-observations.ts`).
 */
export const ASK_GAP_CODES = ["OUTCOME_NOT_READ", "AGENDA_NOT_HELD", "CALENDAR_STALE", "OUTCOMES_UNREADABLE", "MEETINGS_NOT_HELD"] as const;
export type AskGapCode = (typeof ASK_GAP_CODES)[number];

/** The routine record class whose read closes each gap (`lib/civic-data/types.ts`). Agenda documents ride in MEETING partitions. */
export type AskGapRecordClass = "MEETING" | "MEETING_OUTCOME";

export const ASK_GAP_RECORD_CLASS: Readonly<Record<AskGapCode, AskGapRecordClass>> = {
  OUTCOME_NOT_READ: "MEETING_OUTCOME",
  AGENDA_NOT_HELD: "MEETING",
  CALENDAR_STALE: "MEETING",
  OUTCOMES_UNREADABLE: "MEETING_OUTCOME",
  MEETINGS_NOT_HELD: "MEETING",
};

/** Each code as the owner reads it. */
export const ASK_GAP_CODE_WORDS: Readonly<Record<AskGapCode, string>> = {
  OUTCOME_NOT_READ: "Outcome not read",
  AGENDA_NOT_HELD: "Agenda not held",
  CALENDAR_STALE: "Calendar read is stale",
  OUTCOMES_UNREADABLE: "Recorded outcomes unreadable",
  MEETINGS_NOT_HELD: "Meetings not held",
};

export function isAskGapCode(value: unknown): value is AskGapCode {
  return typeof value === "string" && (ASK_GAP_CODES as readonly string[]).includes(value);
}
