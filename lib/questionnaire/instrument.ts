/**
 * **THE FIRST-PARTY CANDIDATE QUESTIONNAIRE — THE INSTRUMENT.**
 * (Built 2026-08-23, the questionnaire-and-corpora brief, item 1.
 * Law: RULING 112, `CLAUDE.md`.)
 *
 * ## Why this exists, and it is not re-litigated here
 *
 * An incumbent always has more public material than a challenger. **Hunting
 * harder makes that gap WIDER, not narrower**, because there is more to find on
 * the incumbent — so the equal-effort rule, which is a discipline about how
 * hard we look, cannot fix an asymmetry that lives in the source material
 * itself. No amount of retrieval closes it.
 *
 * A first-party questionnaire is the only instrument this product can build
 * that is **symmetric by construction**: every candidate in a contest receives
 * the identical questions, the identical word limits, the identical deadline
 * and the identical number of reminders. The thin card and the thick card get
 * the same blank page. It is also original data owned outright, which is the
 * answer to the Ballotpedia licensing question (RULING 70) rather than a
 * workaround for it.
 *
 * ## The rules the instrument itself has to satisfy
 *
 * - **Five to seven questions maximum.** Response rate is the whole ballgame
 *   and long instruments do not get filled in. This one asks FIVE.
 * - **Every question is non-leading and presupposes no position.** No question
 *   that can only be answered from one side; no question that assumes the
 *   candidate wants to change anything, keep anything, spend anything or cut
 *   anything.
 * - **Every question passes the 15-year-old comprehension standard.** Plain
 *   language, no jargon, nothing needing a civics degree to parse. Guarded in
 *   `tests/questionnaire.test.ts` against the same banned-vocabulary shape the
 *   rest of the product's reader copy is held to.
 * - **No question asserts what the office does.** That would be a generated
 *   claim about a body wearing a question mark — the thing `CLAUDE.md` forbids
 *   everywhere else. Every class question ASKS rather than tells, which is why
 *   none of them carries a list of powers as a preamble.
 * - **Word limits are identical for every question and every candidate.** 150
 *   words, five times, for everybody. A per-question or per-class limit would
 *   be a second thing that has to be argued as symmetric; one number is not
 *   arguable.
 *
 * ## Versioning, and why the version travels with the answer
 *
 * Changing the question set mid-cycle across candidates who answered the old
 * version BREAKS SYMMETRY — two candidates in one contest would have answered
 * different instruments and their answers would render side by side as though
 * they had not. So the set is versioned, the version is recorded on every
 * response, and `docs/candidate-questionnaire.md` carries the same text as a
 * document the author can read without opening a source file.
 * `tests/questionnaire.test.ts` fails the build if the two diverge.
 */

/** The version every response records. Bumping it is a decision, never a tidy-up. */
export const INSTRUMENT_VERSION = "v1";

/** The day this version was fixed. From `pnpm stamp`, never a plausible date. */
export const INSTRUMENT_VERSION_ADOPTED = "2026-08-23";

/**
 * **THE WORD LIMIT, ONE NUMBER, EVERYWHERE.**
 *
 * Identical per question, per candidate, per contest and per office class.
 * Truncation must never quietly favour the terse or the verbose, so nothing is
 * ever cut: an over-limit answer is REFUSED at submit time with its own count
 * shown, and the candidate edits it themselves. See `checkWordLimit` below.
 */
export const WORD_LIMIT = 150;

/**
 * The office classes the class layer is keyed to.
 *
 * Deliberately coarse. A finer taxonomy would mean more class-specific
 * question text to keep symmetric, and the differences that matter to a
 * candidate answering are the ones between a school board, a town council, a
 * county board and a legislature — not between a borough council and a
 * township committee, which is a naming difference rather than a job
 * difference.
 *
 * `other` is a REAL class and not a failure state: an office this list does not
 * name still gets a complete five-question instrument, and the class questions
 * it gets are the ones that are true of any office at all.
 */
export type OfficeClass =
  | "school_board"
  | "municipal_governing"
  | "county_governing"
  | "county_row_office"
  | "state_legislative"
  | "state_executive"
  | "federal_legislative"
  | "special_district"
  | "other";

export const OFFICE_CLASSES: readonly OfficeClass[] = [
  "school_board",
  "municipal_governing",
  "county_governing",
  "county_row_office",
  "state_legislative",
  "state_executive",
  "federal_legislative",
  "special_district",
  "other",
] as const;

export interface Question {
  /** Stable across versions where the question is unchanged. Recorded per answer. */
  id: string;
  /** The question as the candidate reads it. Plain language, non-leading. */
  text: string;
  /** Identical for every question. Stated up front, never applied silently. */
  wordLimit: number;
  /** `core` is asked of everybody; `class` varies by office class only. */
  layer: "core" | "class";
}

/**
 * **THE CORE — asked of every candidate for every office at every level.**
 *
 * Three questions, in the author's own order: why they are running, their top
 * priorities, and what they would work on first.
 *
 * *One deliberate deviation from the brief's phrasing, recorded so it reads as
 * a decision rather than as drift.* The brief said *"what they would change
 * first"*. A question asking what someone would CHANGE first presupposes that
 * they want to change something, which a candidate running to keep a thing
 * going cannot answer from their own position — and that is precisely the
 * non-leading standard this instrument is held to. `q3` therefore asks what
 * they would WORK ON first, which admits both answers and loses nothing.
 */
export const CORE_QUESTIONS: readonly Question[] = [
  {
    id: "q1_why_running",
    text: "Why are you running for this office?",
    wordLimit: WORD_LIMIT,
    layer: "core",
  },
  {
    id: "q2_priorities",
    text: "What are your top priorities?",
    wordLimit: WORD_LIMIT,
    layer: "core",
  },
  {
    id: "q3_first_thing",
    text: "If you win, what is the first thing you would work on?",
    wordLimit: WORD_LIMIT,
    layer: "core",
  },
] as const;

/**
 * **THE CLASS LAYER — two questions, keyed to the office class.**
 *
 * Both ASK. Neither tells the candidate what the office does, and neither
 * contains a list of powers: a preamble reading *"county governments decide the
 * budget, the roads and the jail"* would be an unsourced claim about a class of
 * body, and this product does not make those even inside a question.
 *
 * `q4` differs only in the office noun, which is the honest amount of
 * difference there is: *what do you think this job is* is the same question
 * everywhere and the noun is what changes.
 *
 * `q5` is where the class layer earns its place. Every governing body sits
 * somewhere on a scale between the part it serves and the whole it belongs to,
 * and WHICH part and WHICH whole is genuinely different for a school board, a
 * council, a county board and a legislature. The question presupposes only that
 * both scales exist, which is definitionally true of each of them.
 */
export const CLASS_QUESTIONS: Readonly<Record<OfficeClass, readonly Question[]>> = {
  school_board: [
    {
      id: "q4_job_school_board",
      text: "What do you think a school board's most important job is?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
    {
      id: "q5_scale_school_board",
      text: "Some school board decisions affect one school and some affect the whole district. How would you weigh those against each other?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
  ],
  municipal_governing: [
    {
      id: "q4_job_municipal",
      text: "What do you think this council's most important job is?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
    {
      id: "q5_scale_municipal",
      text: "Some decisions here affect one neighbourhood and some affect the whole town. How would you weigh those against each other?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
  ],
  county_governing: [
    {
      id: "q4_job_county",
      text: "What do you think county government's most important job is?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
    {
      id: "q5_scale_county",
      text: "Some county decisions affect one town and some affect the whole county. How would you weigh those against each other?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
  ],
  county_row_office: [
    {
      id: "q4_job_county_row",
      text: "What do you think this office's most important job is?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
    {
      id: "q5_scale_county_row",
      text: "This office serves the whole county, one person at a time. How would you weigh what one person needs against what the office has to do for everyone?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
  ],
  state_legislative: [
    {
      id: "q4_job_state_legislative",
      text: "What do you think a state legislator's most important job is?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
    {
      id: "q5_scale_state_legislative",
      text: "Some decisions in the legislature affect the area you would represent and some affect the whole state. How would you weigh those against each other?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
  ],
  state_executive: [
    {
      id: "q4_job_state_executive",
      text: "What do you think this office's most important job is?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
    {
      id: "q5_scale_state_executive",
      text: "Some decisions in this office affect one part of the state and some affect the whole state. How would you weigh those against each other?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
  ],
  federal_legislative: [
    {
      id: "q4_job_federal_legislative",
      text: "What do you think a member of Congress's most important job is?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
    {
      id: "q5_scale_federal_legislative",
      text: "Some decisions in Congress affect the area you would represent and some affect the whole country. How would you weigh those against each other?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
  ],
  special_district: [
    {
      id: "q4_job_special_district",
      text: "What do you think this district's most important job is?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
    {
      id: "q5_scale_special_district",
      text: "Some decisions here affect one part of the area this district covers and some affect all of it. How would you weigh those against each other?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
  ],
  other: [
    {
      id: "q4_job_other",
      text: "What do you think this office's most important job is?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
    {
      id: "q5_scale_other",
      text: "Some decisions in this office affect one part of the area it serves and some affect all of it. How would you weigh those against each other?",
      wordLimit: WORD_LIMIT,
      layer: "class",
    },
  ],
} as const;

/**
 * The whole instrument one candidate is asked, in reading order.
 *
 * **Every candidate for the same office class gets the identical array.** There
 * is no per-candidate branch here and there never may be: a function that could
 * return a different question for two people in one contest is the asymmetry
 * this instrument exists to remove, wearing a helpful face.
 */
export function questionsFor(officeClass: OfficeClass): readonly Question[] {
  return [...CORE_QUESTIONS, ...CLASS_QUESTIONS[officeClass]];
}

/** Every question this instrument can ever ask, for tests and for the document. */
export function allQuestions(): readonly Question[] {
  return [...CORE_QUESTIONS, ...OFFICE_CLASSES.flatMap((c) => CLASS_QUESTIONS[c])];
}

/**
 * **THE WORD COUNT, ONE DEFINITION.**
 *
 * Whitespace-separated runs. Deliberately the simplest rule that a candidate
 * can check in their own word processor and get the same answer we do — a
 * cleverer tokenizer would be a limit they cannot verify, which is a limit they
 * cannot be held to fairly.
 */
export function countWords(answer: string): number {
  const trimmed = answer.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

export interface WordLimitVerdict {
  words: number;
  limit: number;
  withinLimit: boolean;
  /** Reader-facing, shown BEFORE submission. Never after a silent cut. */
  message: string | null;
}

/**
 * **NOTHING IS EVER TRUNCATED.** (RULING 112.)
 *
 * A truncating instrument quietly favours whoever writes short, and it does it
 * invisibly — the reader sees a complete-looking answer that stops. So an
 * over-limit answer is REFUSED with its own count and the limit both stated,
 * and the candidate decides what to cut. The verdict is computed as they type
 * and again at submit; there is no code path that shortens an answer.
 */
export function checkWordLimit(answer: string, limit: number = WORD_LIMIT): WordLimitVerdict {
  const words = countWords(answer);
  const withinLimit = words <= limit;
  return {
    words,
    limit,
    withinLimit,
    message: withinLimit
      ? null
      : `This answer is ${words} words. The limit is ${limit} for every question, and it is the same for everyone running. Please shorten it before sending — we won't cut it for you.`,
  };
}
