/**
 * Every piece of work names one of six closed questions (HAVE_IT, STILL_CORRECT, ANYTHING_MISSING, HAS_CHANGED,
 * READER_CAN_SEE, CONSISTENT). A standing clock's round takes it from the obligation's recorded state; the
 * owner's instruction carries the questions chosen; anything else carries none ("not recorded", never a
 * guess). Pure and client-safe.
 */

export const WORK_QUESTIONS = ["HAVE_IT", "STILL_CORRECT", "ANYTHING_MISSING", "HAS_CHANGED", "READER_CAN_SEE", "CONSISTENT"] as const;
export type WorkQuestion = (typeof WORK_QUESTIONS)[number];

/** The question as the owner reads it — the composer's own chip words. */
export const WORK_QUESTION_WORDS: Readonly<Record<WorkQuestion, string>> = {
  HAVE_IT: "Do we have this record at all?",
  STILL_CORRECT: "Is what we hold still correct?",
  ANYTHING_MISSING: "Is anything missing from it?",
  HAS_CHANGED: "Has it changed since we last looked?",
  READER_CAN_SEE: "Can a reader actually see it?",
  CONSISTENT: "Is it consistent with what we hold elsewhere?",
};

export function isWorkQuestion(value: unknown): value is WorkQuestion {
  return typeof value === "string" && (WORK_QUESTIONS as readonly string[]).includes(value);
}

/**
 * The owner's questions as a submission carries them: absent or empty is no
 * question; anything else must be a list of the six, and comes back once each,
 * in the canonical order. An unknown question is refused by name, never
 * dropped — a question the owner asked that silently vanished is the defect.
 */
export function validateWorkQuestions(
  raw: unknown,
): { readonly ok: true; readonly value: readonly WorkQuestion[] } | { readonly ok: false; readonly why: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, why: "the questions have to be a list" };
  const unknown = raw.filter((q) => !isWorkQuestion(q));
  if (unknown.length > 0) return { ok: false, why: `${unknown.map(String).join(", ")} is not one of the six questions` };
  return { ok: true, value: WORK_QUESTIONS.filter((q) => raw.includes(q)) };
}

/** The record class meetings discovery registers under (`MEETINGS_DISCOVERY_RECORD_CLASS`; a test holds them equal). */
const MEETINGS_DISCOVERY = "meetings-discovery";

/**
 * The question one round of a standing obligation asks, from the obligation's
 * own recorded state. Null when that state is not on the row — "not recorded",
 * never a default.
 */
export function questionOfObligation(o: {
  readonly recordClass: string;
  readonly lastWorkedAt?: string | null;
  readonly absentUntil?: string | null;
}): WorkQuestion | null {
  if (o.lastWorkedAt === undefined) return null;
  if (o.lastWorkedAt === null) return "HAVE_IT";
  if (typeof o.absentUntil === "string" && o.absentUntil !== "") return "STILL_CORRECT";
  if (o.recordClass === MEETINGS_DISCOVERY) return "ANYTHING_MISSING";
  return "HAS_CHANGED";
}
