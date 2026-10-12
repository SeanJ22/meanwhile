/**
 * What a record can and cannot be asked. An agenda proves what was noticed,
 * not what was heard or decided. A positive allow-list: a record class answers
 * a question class only if the pair is written here, so anything new or
 * unknown answers nothing.
 *
 * Pure, total, offline. No clock, no disk, no network.
 */

/** Classes of record, by the act of government that produced them, not by file type. */
export const RECORD_CLASSES = [
  /** A meeting exists, with a body, a time and a place. Nothing about content. */
  "MEETING_NOTICE",
  /** The published agenda for one sitting: what was NOTICED. */
  "AGENDA",
  /** Agenda plus the backing material. Still notice-class: still pre-meeting. */
  "AGENDA_PACKET",
  /** The body's approved record of what actually happened at the sitting. */
  "MINUTES",
  /** A clerk's post-meeting list of actions taken. Results without discussion. */
  "ACTION_SUMMARY",
  /** A recorded roll call: how each named member voted on one named question. */
  "ROLL_CALL",
  /** Audio, video or a transcript of the sitting itself. */
  "RECORDING_OR_TRANSCRIPT",
  /** Who sits on the body, sourced. */
  "ROSTER",
] as const;
export type RecordClass = (typeof RECORD_CLASSES)[number];

/**
 * Classes of question, by the evidentiary claim an answer would make. Not
 * `AskIntent` (lib/ask/intent.ts), which describes what a reader wants;
 * `ASK_INTENT_READING` records the correspondence.
 */
export const QUESTION_CLASSES = [
  /** "When does the board meet?" A claim about the calendar. */
  "WHEN_DO_THEY_MEET",
  /** "What is on the agenda?" A claim about what was NOTICED. */
  "WHAT_WAS_NOTICED",
  /** "What did they say about X?" A claim about deliberation. */
  "WHAT_WAS_DISCUSSED",
  /** "What did they decide?" / "Did it pass?" A claim about an OUTCOME. */
  "WHAT_WAS_DECIDED",
  /** "How did Supervisor X vote?" A claim about one member's recorded position. */
  "HOW_DID_THEY_VOTE",
  /** "Who is on this board?" A claim about membership. */
  "WHO_SITS_ON_IT",
] as const;
export type QuestionClass = (typeof QUESTION_CLASSES)[number];

/**
 * How `AskIntent` reads against this vocabulary. `PAST_MEETING` maps to
 * nothing: it is ambiguous between what was noticed and what was decided, and
 * the interpretation rung must resolve that.
 */
export const ASK_INTENT_READING: Readonly<Record<string, QuestionClass | null>> = {
  UPCOMING_AGENDA: "WHAT_WAS_NOTICED",
  AGENDA_TOPIC: "WHAT_WAS_NOTICED",
  MEETING_TIME: "WHEN_DO_THEY_MEET",
  PAST_MEETING: null,
  PERSON_RECORD: null,
  TOPIC_OWNER: null,
  MEASURE: null,
  CONTACT: null,
  CIVICS: null,
  UNKNOWN: null,
};

/**
 * The allow-list. `MINUTES` does not answer `WHAT_WAS_NOTICED` (continued items
 * are absent from minutes). `MINUTES` and `ACTION_SUMMARY` do not answer
 * `HOW_DID_THEY_VOTE`: a tally is not a member's recorded position.
 */
const ANSWERS: Readonly<Record<RecordClass, readonly QuestionClass[]>> = {
  MEETING_NOTICE: ["WHEN_DO_THEY_MEET"],
  AGENDA: ["WHEN_DO_THEY_MEET", "WHAT_WAS_NOTICED"],
  AGENDA_PACKET: ["WHEN_DO_THEY_MEET", "WHAT_WAS_NOTICED"],
  MINUTES: ["WHAT_WAS_DISCUSSED", "WHAT_WAS_DECIDED"],
  ACTION_SUMMARY: ["WHAT_WAS_DECIDED"],
  ROLL_CALL: ["WHAT_WAS_DECIDED", "HOW_DID_THEY_VOTE"],
  RECORDING_OR_TRANSCRIPT: ["WHAT_WAS_DISCUSSED"],
  ROSTER: ["WHO_SITS_ON_IT"],
};

/** Record classes that would satisfy a question class. Any ONE of them. */
export function recordClassesAnswering(
  questionClass: QuestionClass,
): readonly RecordClass[] {
  return RECORD_CLASSES.filter((rc) => ANSWERS[rc].includes(questionClass));
}

/** Does this record class answer this question class? Unknown strings answer nothing. */
export function answers(
  recordClass: RecordClass | string,
  questionClass: QuestionClass | string,
): boolean {
  const allowed = (ANSWERS as Record<string, readonly string[] | undefined>)[recordClass];
  if (!allowed) return false;
  return allowed.includes(questionClass);
}

/** Sentences for the tempting substitutions; everything else gets the generic form. */
const REFUSAL_SENTENCES: Readonly<Record<string, string>> = {
  "AGENDA->WHAT_WAS_DECIDED":
    "An agenda proves what was NOTICED, not what was decided. Items are continued, " +
    "withdrawn, tabled and pulled from consent, and none of that changes the agenda.",
  "AGENDA->HOW_DID_THEY_VOTE":
    "An agenda proves an item was scheduled, not that a vote was taken on it, and it " +
    "carries no member's position. A roll call is the only record of how one member voted.",
  "AGENDA->WHAT_WAS_DISCUSSED":
    "An agenda proves an item was noticed for discussion, not that it was reached or that " +
    "anything was said about it.",
  "AGENDA_PACKET->WHAT_WAS_DECIDED":
    "A packet is the material prepared BEFORE the sitting. Staff's recommendation is not " +
    "the body's decision.",
  "AGENDA_PACKET->HOW_DID_THEY_VOTE":
    "A packet is pre-meeting material and carries no member's recorded position.",
  "AGENDA_PACKET->WHAT_WAS_DISCUSSED":
    "A packet is what was circulated, not what was said.",
  "MEETING_NOTICE->WHAT_WAS_NOTICED":
    "A meeting notice proves a sitting was called. The agenda is the record of what was " +
    "noticed FOR it, and we do not hold it.",
  "MEETING_NOTICE->WHAT_WAS_DECIDED":
    "A meeting notice proves a sitting was called and nothing whatever about its outcome.",
  "MINUTES->WHAT_WAS_NOTICED":
    "Minutes record what the body reached, not what it noticed. An item continued to the " +
    "next sitting is on the agenda and absent from the minutes.",
  "MINUTES->HOW_DID_THEY_VOTE":
    "Minutes routinely carry a TALLY. A tally is not a member's recorded position, and " +
    "deriving one member's vote from a tally is inference.",
  "ACTION_SUMMARY->HOW_DID_THEY_VOTE":
    "An action summary carries the result, not each member's recorded position.",
  "ACTION_SUMMARY->WHAT_WAS_DISCUSSED":
    "An action summary lists actions taken. It is not a record of deliberation.",
  "ROLL_CALL->WHAT_WAS_NOTICED":
    "A roll call is one question put to the body. It is not the docket.",
  "RECORDING_OR_TRANSCRIPT->WHAT_WAS_DECIDED":
    "A recording is what was said. An outcome is what the body's own record says it " +
    "resolved; reading a decision off speech is our inference, not their record.",
};

/** Why this record class may not answer this question class. Always a sentence. */
export function refusalFor(
  recordClass: RecordClass | string,
  questionClass: QuestionClass | string,
): string {
  const keyed = REFUSAL_SENTENCES[`${recordClass}->${questionClass}`];
  if (keyed) return keyed;
  if (!(RECORD_CLASSES as readonly string[]).includes(String(recordClass))) {
    return (
      `${String(recordClass)} is not a record class this rule knows. An unclassified record ` +
      "answers nothing — a class we cannot name is a class whose limits we cannot state."
    );
  }
  return (
    `A ${String(recordClass)} record is not evidence for ${String(questionClass)}. ` +
    "The classes that are: " +
    (recordClassesAnswering(questionClass as QuestionClass).join(", ") || "(none defined)") +
    "."
  );
}

/** One held record class that was offered for a question it cannot answer. */
export interface RefusedSubstitution {
  readonly held: RecordClass | string;
  readonly reason: string;
}

export interface ClassRuling {
  readonly questionClass: QuestionClass;
  /** True only when a held class is on the allow-list for this question. */
  readonly answerable: boolean;
  /** The held classes that DO answer it. */
  readonly satisfiedBy: readonly RecordClass[];
  /** Any ONE of these would make the question answerable. */
  readonly requires: readonly RecordClass[];
  /** Held classes that do not answer it, each with the sentence saying why. */
  readonly refusedSubstitutions: readonly RefusedSubstitution[];
}

/** Rule on a question against the record classes held; answerable only by an allow-listed class. */
export function ruleOnQuestion(
  questionClass: QuestionClass,
  heldClasses: readonly (RecordClass | string)[],
): ClassRuling {
  const seen = new Set<string>();
  const satisfiedBy: RecordClass[] = [];
  const refusedSubstitutions: RefusedSubstitution[] = [];

  for (const held of heldClasses) {
    if (seen.has(String(held))) continue;
    seen.add(String(held));
    if (answers(held, questionClass)) satisfiedBy.push(held as RecordClass);
    else refusedSubstitutions.push({ held, reason: refusalFor(held, questionClass) });
  }

  return {
    questionClass,
    answerable: satisfiedBy.length > 0,
    satisfiedBy,
    requires: recordClassesAnswering(questionClass),
    refusedSubstitutions,
  };
}

export class RecordClassRefused extends Error {
  readonly ruling: ClassRuling;
  constructor(ruling: ClassRuling, message: string) {
    super(message);
    this.name = "RecordClassRefused";
    this.ruling = ruling;
  }
}

/** Throw unless a held class answers the question; the message names the attempted substitution. */
export function assertAnswerable(
  questionClass: QuestionClass,
  heldClasses: readonly (RecordClass | string)[],
): ClassRuling {
  const ruling = ruleOnQuestion(questionClass, heldClasses);
  if (ruling.answerable) return ruling;
  const attempted = ruling.refusedSubstitutions
    .map((r) => `${String(r.held)}: ${r.reason}`)
    .join(" ");
  throw new RecordClassRefused(
    ruling,
    `${questionClass} needs one of [${ruling.requires.join(", ")}]. ` +
      (ruling.refusedSubstitutions.length > 0
        ? `Held instead: ${attempted}`
        : "No records are held at all."),
  );
}

/** Anything carrying a record class — the structural shape this rule needs. */
export interface ClassedRecord {
  readonly recordClass: RecordClass | string;
}

/**
 * Keep only the records whose class answers the question; `refused` carries
 * the rest back with their sentences.
 */
export function evidenceRecordsFor<T extends ClassedRecord>(
  questionClass: QuestionClass,
  records: readonly T[],
): { admitted: T[]; refused: { record: T; reason: string }[] } {
  const admitted: T[] = [];
  const refused: { record: T; reason: string }[] = [];
  for (const record of records) {
    if (answers(record.recordClass, questionClass)) admitted.push(record);
    else refused.push({ record, reason: refusalFor(record.recordClass, questionClass) });
  }
  return { admitted, refused };
}
