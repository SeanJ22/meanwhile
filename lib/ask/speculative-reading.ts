import { normalizeName } from "../routing/exact-name.ts";
import { asksForBodyAgenda, type BindableEntity } from "../routing/named-entity.ts";
import { unavailableInterpretation, type AskIntent, type AskInterpretation, type AskTemporal } from "./intent.ts";
import { interpretWithoutModel } from "./interpret.ts";
import { shapeIntentFor, subjectKindOf } from "./lexical-reading.ts";
import { outcomeQuestionClass } from "./outcome-question.ts";
import { isReferential, resolveInterpretation } from "./resolve.ts";
import type { AskSubjectRef } from "./subject.ts";

/**
 * **READ THE QUESTION AND START THE ANSWER AT THE SAME TIME.**
 * (2026-09-25, the Ask three-second repair.)
 *
 * Measured warm, locally, that day: a question the code cannot read on its own
 * — a pronoun follow-up, an alias, wording no shape in
 * `lib/ask/lexical-reading.ts` admits ("Who can I talk to at the Tucson City
 * Council?") — took ~5.8 s, because two model calls ran one after the other:
 * the frontier model reading the question (~1.5 s and up), then the fast
 * writer answering from the records that reading selected (~1.9 s and up).
 * Sean's bar is three seconds.
 *
 * The writer needs a reading, but it does not need to wait for the model's.
 * The code already has a best guess — the subject its binders bind on the
 * reader's words, the page or the earlier turn; the tense its own reader
 * reads; an intent from the question's wording — and retrieval from a reading
 * takes tens of milliseconds. So the route builds the evidence pack from the
 * code's guess and starts the writer on it while the model is still reading.
 * When the model's reading arrives, the route builds the pack from THAT
 * reading, exactly as before, and keeps the speculative answer only when the
 * two agree on everything the answer depends on:
 *
 * 1. the same subject,
 * 2. the same body (the sittings read belong to the same governments),
 * 3. the same question kind (intent, tense and the sitting selection), and
 * 4. byte-identical writer input — the synthesis cache key over the whole pack
 *    (records, gaps, denominators, subject, intent, tense, today).
 *
 * The fourth makes the first three a report rather than the guarantee: a kept
 * answer was written from exactly the pack the model's reading produced, so it
 * is the answer the sequential path would have asked for, and it still faces
 * the same validator over that pack. Anything else — a different subject, a
 * guessed intent the model did not share, a model reading that never came, a
 * reading that asks for clarification or composes in code — discards the
 * speculative answer (its call is aborted if still running) and the route
 * continues from the model's reading as it always has. The model still reads
 * every such question; nothing here replaces it or decides what the question
 * means.
 *
 * A discarded guess costs one fast-writer call and nothing a reader sees. The
 * trace records which path delivered and why (`AskTrace.speculation`).
 * `WTP_ASK_SPECULATION=off` turns speculation off without a deploy; with no
 * model key nothing is started, because no model reading is awaited.
 */

/** Wording that asks who to contact at a government. Only a GUESS here: the model's reading decides. */
const CONTACT_WORDING: readonly RegExp[] = [
  /^(?:who|whom) (?:can|could|should|do|would|might) (?:i|we) (?:talk|speak|write|reach out|turn|complain|go|contact|call|email|ask)\b/,
  /^how (?:do|can|could|would|should) (?:i|we) (?:contact|reach|call|email|get in touch with|write to|talk to|speak to|speak with|talk with)\b/,
  /\b(?:contact information|contact info|phone number|email address)\b/,
];

/** Wording that asks when a body sits, without a shape's anchoring. */
const MEETING_TIME_WORDING = /^(?:when|what time|what day|what date)\b.*\b(?:meet|meets|meeting|session|convene)\b/;

export interface CodeReadingInput {
  question: string;
  /** The same inventory the route hands the model and the resolver. */
  inventory: readonly BindableEntity[];
  activeSubjects?: readonly AskSubjectRef[];
  priorSubjects?: readonly AskSubjectRef[];
}

export interface CodeReading {
  /**
   * The reading the answer path starts from: intent and tense, no mentions (the
   * binders bind on the reader's own words and context), and — for a pronoun
   * nothing else binds — the one subject in front of the reader as referent.
   */
  interpretation: AskInterpretation;
  /** SHAPE: a canonical shape of the subject's kind; WORDING: a looser wording rule. */
  basis: "SHAPE" | "WORDING";
  subjectId: string;
}

/**
 * The code's best reading of a question the lexical reading could not settle,
 * or null when it has no guess worth a call: nothing binds, or no wording rule
 * names an intent. A null only means the model reads first, as before.
 */
export function codeBestReading(input: CodeReadingInput): CodeReading | null {
  const temporal = interpretWithoutModel(input.question).temporal;
  const context = { activeSubjects: input.activeSubjects ?? [], priorSubjects: input.priorSubjects ?? [] };
  let referent: string | null = null;
  let resolved = resolveInterpretation({ ...unavailableInterpretation(), temporal }, input.question, input.inventory, context);
  if (resolved.binding.kind === "NONE" && isReferential(input.question)) {
    /*
     * "When do they meet next?" after a question about a council: the binders
     * read "they" as people, and it is the model that proposes the council as
     * the referent. The guess proposes the one subject in front of the reader
     * — the focused card, else the last turn's subject — through the same
     * corroboration a model referent passes, and the model's own referent
     * still decides whether the guess is kept.
     */
    const focused = context.activeSubjects.filter((ref) => ref.focused);
    const candidate = focused.length === 1 ? focused[0] : context.activeSubjects.length === 0 ? context.priorSubjects.at(-1) : undefined;
    if (candidate?.name) {
      referent = candidate.name;
      resolved = resolveInterpretation({ ...unavailableInterpretation(), temporal, referent }, input.question, input.inventory, context);
    }
  }
  if (resolved.binding.kind !== "BOUND") return null;
  const entity = resolved.binding.entity;
  const kind = subjectKindOf(entity);
  const shaped = shapeIntentFor(input.question, kind, temporal);
  const intent = shaped?.intent ?? wordingIntent(input.question, temporal, kind);
  if (!intent) return null;
  return { interpretation: { ...unavailableInterpretation(), intent, temporal, referent }, basis: shaped ? "SHAPE" : "WORDING", subjectId: entity.id };
}

function wordingIntent(question: string, temporal: AskTemporal, kind: ReturnType<typeof subjectKindOf>): AskIntent | null {
  const normalized = normalizeName(question);
  if (CONTACT_WORDING.some((pattern) => pattern.test(normalized))) return "CONTACT";
  if (kind !== "BODY") return null;
  // The same readings the lexical shapes carry, and the route's own agenda rule.
  if (outcomeQuestionClass(question)) return "PAST_MEETING";
  if (asksForBodyAgenda(question)) return "UPCOMING_AGENDA";
  if (MEETING_TIME_WORDING.test(normalized)) return temporal.kind === "LAST" ? "PAST_MEETING" : "MEETING_TIME";
  return null;
}

/** What one reading led the route to: the facts a speculative answer must share with the model's. */
export interface ReadingOutcome {
  subjectId: string | null;
  /** The governments whose sittings were read, and the subject when it is one. */
  bodyIds: readonly string[];
  intent: AskIntent;
  temporal: AskTemporal;
  /** NEXT / LAST / DATE / ANY — the sitting selection the reading produced. */
  selection: string;
  /** The synthesis cache key of the pack the writer is sent (`synthesisCacheKey`). */
  writerInput: string;
}

export type SpeculationVerdict =
  | { keep: true; why: "same-subject-body-kind-and-writer-input" }
  | { keep: false; why: "model-reading-unavailable" | "model-reading-needs-no-writer" | "different-subject" | "different-body" | "different-question-kind" | "different-writer-input" };

/**
 * Keep the speculative answer, or discard it — and why. Checked in order, so
 * the reason named is the first difference.
 */
export function speculationVerdict(
  code: ReadingOutcome,
  model: ReadingOutcome | "MODEL_READING_UNAVAILABLE" | "MODEL_READING_NEEDS_NO_WRITER",
): SpeculationVerdict {
  if (model === "MODEL_READING_UNAVAILABLE") return { keep: false, why: "model-reading-unavailable" };
  if (model === "MODEL_READING_NEEDS_NO_WRITER") return { keep: false, why: "model-reading-needs-no-writer" };
  if (code.subjectId !== model.subjectId) return { keep: false, why: "different-subject" };
  const bodies = (ids: readonly string[]) => JSON.stringify([...new Set(ids)].sort());
  if (bodies(code.bodyIds) !== bodies(model.bodyIds)) return { keep: false, why: "different-body" };
  if (code.intent !== model.intent || code.selection !== model.selection || JSON.stringify(sortedKeys(code.temporal)) !== JSON.stringify(sortedKeys(model.temporal))) {
    return { keep: false, why: "different-question-kind" };
  }
  if (code.writerInput !== model.writerInput) return { keep: false, why: "different-writer-input" };
  return { keep: true, why: "same-subject-body-kind-and-writer-input" };
}

function sortedKeys(value: AskTemporal): [string, unknown][] {
  return Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b));
}
