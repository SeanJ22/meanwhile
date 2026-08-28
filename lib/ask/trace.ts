import type { AskIntent, AskTemporal } from "./intent.ts";

/**
 * **THE TRACE — proof that the pipeline did what it says (2026-08-27).**
 *
 * This exists because of a specific, expensive misunderstanding: the product's
 * owner believed Claude was doing civic reasoning in Ask, and it was not. It
 * was picking one topic id out of sixteen, from a prompt containing no civic
 * context whatsoever. Nothing in the product could have told him otherwise —
 * there was no way, from outside, to see which rungs ran or what they were
 * given.
 *
 * A belief about your own system that the system cannot confirm or deny is a
 * defect in the system, not in the belief. So every rung reports.
 *
 * ## What may never be in here
 *
 * The trace is operator diagnostics and it is shaped by what it must NOT
 * carry. No API key. No raw question — the scrub runs before anything is
 * recorded, and even scrubbed the question does not belong in a durable
 * diagnostic. No reader identifier of any kind. What it carries is which rungs
 * ran, on which model, over how many records, and what came out — facts about
 * OUR machinery, not about a person.
 */

export interface RungTrace {
  ran: boolean;
  /** Why not, when it did not. */
  why?: string;
  model?: string;
  ms?: number;
}

export interface AskTrace {
  /** Did the model read the question, and what did it conclude? */
  interpretation: RungTrace & {
    intent?: AskIntent;
    temporal?: AskTemporal;
    /** COUNTS, never the mentions themselves — those are the reader's words. */
    mentionCount?: number;
    /**
     * Whether the rung proposed a referent for a pronoun — a BOOLEAN, never the
     * referent, which is a civic subject the reader may not have typed and
     * which belongs in `resolution.subjectName` once it has been VERIFIED.
     * An operator reading this can tell a follow-up was attempted; they cannot
     * read a subject out of it that no binder confirmed.
     */
    referentProposed?: boolean;
    /** Whether the deterministic reading stood in for the model's. */
    fellBackToDeterministic?: boolean;
  };
  /** What the hypothesis reconciled to, if anything. */
  resolution: {
    state: "BOUND" | "AMBIGUOUS" | "UNRESOLVED" | "NONE";
    /** The canonical id. A public government identifier, not a reader fact. */
    subjectId?: string | null;
    subjectName?: string | null;
    basis?: string;
  };
  /** What deterministic retrieval actually did. */
  retrieval: {
    /** NEXT / LAST / ANY — the tense that governed selection. */
    selection: string;
    recordCount: number;
    sourceCount: number;
    gapCount: number;
    denominators: Record<string, number>;
  };
  /**
   * ASK-14: the office-definition lookup, when a CIVICS question named an
   * office rather than an entity and nothing canonical was bound.
   *
   * The PHRASE the reader used is recorded because the vocabulary is the thing
   * that will need extending — an operator reading a run where a reader asked
   * about an office the product could not name needs to see what they called
   * it. It is a public job title, not a fact about the reader.
   */
  officeLookup?: { phrase: string; office: string };
  /** Did the model write the answer, and did the answer survive checking? */
  synthesis: RungTrace;
  validation: {
    ran: boolean;
    passed?: boolean;
    checked?: string[];
    failed?: string[];
  };
  /** What the reader actually got. The single most important line here. */
  answerMode: AnswerMode;
  totalMs: number;
}

/**
 * **HOW THE READER'S ANSWER WAS PRODUCED — and it is never guessed.**
 *
 * This is the field an operator reads to know whether they are looking at a
 * grounded answer or a fallback, and it is the field the signal record stores.
 * Saying `GROUNDED_CLAUDE` when only the deterministic path ran would make
 * every later measurement of the feature a fiction, so it is set at exactly
 * one place per outcome and never inferred from whether a key was present.
 */
export type AnswerMode =
  /** Claude wrote it from an evidence pack and validation passed. */
  | "GROUNDED_CLAUDE"
  /** The records are real and rendered; no generated prose. */
  | "STRUCTURED_GROUNDED"
  /** A government was named and more than one thing fits. Nothing chosen. */
  | "CLARIFY"
  /** A government was named and we hold no such thing. Said, never swapped. */
  | "UNRESOLVED"
  /** The subject resolved and we hold nothing that answers the question. */
  | "NO_EVIDENCE"
  /** Generated prose was produced and REJECTED by validation. */
  | "REJECTED_FELL_BACK";

export function emptyTrace(): AskTrace {
  return {
    interpretation: { ran: false },
    resolution: { state: "NONE" },
    retrieval: {
      selection: "ANY",
      recordCount: 0,
      sourceCount: 0,
      gapCount: 0,
      denominators: {},
    },
    synthesis: { ran: false },
    validation: { ran: false },
    answerMode: "NO_EVIDENCE",
    totalMs: 0,
  };
}
