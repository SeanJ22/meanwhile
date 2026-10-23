/**
 * The first-party candidate questionnaire. Symmetric by construction: every candidate in a contest gets
 * the identical questions, word limit, deadline and reminders. Questions are non-leading, presuppose no
 * position, never assert what the office does, and use plain language.
 */

/**
 * The version every response records. Changing the question set means a new version, so answers to
 * different instruments never render side by side as though they were the same.
 */
export const INSTRUMENT_VERSION = "v2";

/**
 * One word limit for every question, candidate, contest and office class. Nothing is ever cut: an
 * over-limit answer is refused with its count shown (see `checkWordLimit`).
 */
export const WORD_LIMIT = 200;

/**
 * The office classes the class layer is keyed to. Deliberately coarse. `other` is a real class: any
 * office still gets a complete five-question instrument.
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

/** The core, asked of every candidate for every office. */
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
 * The class layer: two questions keyed to the office class. Both ask; neither tells the candidate what
 * the office does.
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
 * The whole instrument one candidate is asked, in reading order. Every candidate for the same office
 * class gets the identical array; there is no per-candidate branch.
 */
export function questionsFor(officeClass: OfficeClass): readonly Question[] {
  return [...CORE_QUESTIONS, ...CLASS_QUESTIONS[officeClass]];
}

/** Every question this instrument can ever ask, for tests and for the document. */
export function allQuestions(): readonly Question[] {
  return [...CORE_QUESTIONS, ...OFFICE_CLASSES.flatMap((c) => CLASS_QUESTIONS[c])];
}

/** Whitespace-separated runs, so a candidate can check the count in their own word processor. */
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

/** Nothing is ever truncated: an over-limit answer is refused with its count and the limit both stated. */
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

/**
 * The closing note. Kept outside the instrument: `questionsFor()` and `allQuestions()` never return it.
 * The text is verbatim and makes no timing promise. The list it offers is stored business-side and
 * shares no joinable column with the search log or reactions store.
 */
export const CLOSING_NOTE =
  "One more thing, separate from the questionnaire: Meanwhile offers campaigns " +
  "and organizations anonymized, aggregate insight into what constituents in a " +
  "race care about — available to everyone, at the same published rates. If " +
  "you'd like to hear when insights for your race are available, sign up here.";
