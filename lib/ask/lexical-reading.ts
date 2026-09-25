import { normalizeName } from "../routing/exact-name.ts";
import {
  bindNamedEntity,
  GENERIC_CIVIC_TOKENS,
  type BindableEntity,
} from "../routing/named-entity.ts";
import { decideNamedBody } from "./body-confirmation.ts";
import { unavailableInterpretation, type AskInterpretation } from "./intent.ts";
import { interpretWithoutModel } from "./interpret.ts";
import { outcomeQuestionClass } from "./outcome-question.ts";
import { resolveInterpretation } from "./resolve.ts";
import type { AskSubjectRef } from "./subject.ts";

/**
 * **A QUESTION THE READER'S OWN WORDS ALREADY SETTLE NEEDS NO MODEL TO READ
 * IT.** (2026-09-25, the Ask latency repair.)
 *
 * Measured on production 2026-09-25: a new question on a warm instance spent
 * 2.4-3.3 s in the interpretation rung before any record was read. For
 * *"When does the Mesa City Council meet next?"* the model returned exactly
 * what the product's own binder and tense reader already knew — the body the
 * reader named (bound on the whole question, basis `WHOLE_QUESTION`), the
 * intent `MEETING_TIME` and the tense `NEXT`. Sean's bar is three seconds from
 * the question to a usable answer, and that call alone was most of it.
 *
 * So a small, closed set of question SHAPES is read here, in code, and the
 * model rung is skipped for them. The set is deliberately narrow — narrower
 * than what a model could read — because every question it admits must get
 * the same binding, the same tense and the same retrieval the model path would
 * have produced:
 *
 * 1. **The whole question matches one canonical shape** (below), anchored at
 *    both ends. Nothing may sit outside the shape's own words and the body's
 *    name: "when does the council meet next about the budget" does not match,
 *    so a qualifier the shape would ignore can never be silently dropped.
 * 2. **The name slot is only a name.** Every word in it is either a word of
 *    the bound body's own name or generic civic vocabulary ("city",
 *    "council", "board"...). Another government, a person or a topic in the
 *    slot fails the shape.
 * 3. **The slot, the whole question and the named-body decision all bind the
 *    SAME body**, each through the product's own binder. The named-body
 *    decision must bind on the reader's words alone — the branch that never
 *    consults a model mention — so what the route decides next is identical
 *    whatever a model would have said.
 *
 * Anything else — a pronoun, an unmatched phrasing, an ambiguous or unheld
 * name, a person, a ballot measure, a confirmation round-trip — returns null
 * and the model reads the question exactly as before. A null is never a
 * verdict about the question; it only means "not settled here".
 */

/** The closed set of question shapes this module reads. */
export type LexicalShape = "MEETING_TIME" | "BODY_AGENDA" | "MEETING_OUTCOME";

interface ShapePattern {
  readonly shape: LexicalShape;
  /** Anchored, over `normalizeName(question)`; the ONE capturing group is the body's name. */
  readonly pattern: RegExp;
}

/*
 * Written against `normalizeName`, which lowercases, turns punctuation into a
 * space ("what's" -> "what s") and drops ONE leading "the". The trailing words
 * are the tense words the deterministic reader already reads; nothing here
 * decides tense.
 */
/* No calendar windows ("next week", "this month"): the selection is the next or
   last sitting, and a window the answer would not honour stays with the model. */
const WHEN_TAIL = "(?: (?:next|again))?";
const RECENTLY = "(?: (?:recently|lately|last time|at (?:its|their|the) (?:last|latest|most recent|previous) meeting))?";

const SHAPES: readonly ShapePattern[] = [
  /* MEETING_TIME — when a named body sits. */
  { shape: "MEETING_TIME", pattern: new RegExp(`^when (?:does|do|will|did) (?:the )?(.+?) (?:(?:next|last|first) )?(?:meet|convene|sit)${WHEN_TAIL}$`) },
  { shape: "MEETING_TIME", pattern: new RegExp(`^when (?:does|do|will|did) (?:the )?(.+?) (?:hold|have) (?:its|their) (?:next|last|first) (?:meeting|session)$`) },
  { shape: "MEETING_TIME", pattern: /^when (?:is|s|was) (?:the )?(?:next|upcoming|last|latest|most recent|previous) (.+?) (?:meeting|session)$/ },
  { shape: "MEETING_TIME", pattern: /^when (?:is|s|was) (?:the )?(.+?)(?: s)? (?:next|upcoming|last|latest|most recent|previous) (?:meeting|session)$/ },
  { shape: "MEETING_TIME", pattern: new RegExp(`^what (?:time|day|date) (?:does|do|will|is) (?:the )?(.+?) (?:(?:next )?meet|meeting)${WHEN_TAIL}$`) },
  { shape: "MEETING_TIME", pattern: /^what (?:is|s) the (?:date|time|date and time|day) of the (?:next|upcoming|last|latest|most recent) (.+?) (?:meeting|session)$/ },
  /* BODY_AGENDA — what is on a named body's own docket. */
  { shape: "BODY_AGENDA", pattern: /^what (?:s|is|are|was|were) on (?:the )?(.+?)(?: s)? (?:(?:next|upcoming|last|latest|most recent|previous) )?(?:meeting )?(?:agenda|docket)$/ },
  { shape: "BODY_AGENDA", pattern: /^what (?:s|is|are|was|were) on the (?:(?:next|upcoming|last|latest|most recent|previous) )?(?:agenda|docket) (?:for|of|at) (?:the )?(.+?)(?: (?:next )?meeting)?$/ },
  /* MEETING_OUTCOME — what a named body decided, or how it voted. */
  { shape: "MEETING_OUTCOME", pattern: new RegExp(`^what did (?:the )?(.+?) (?:decide|decide on|vote on|approve|pass|adopt)${RECENTLY}$`) },
  { shape: "MEETING_OUTCOME", pattern: new RegExp(`^how did (?:the )?(.+?) vote${RECENTLY}$`) },
];

const SLOT_PRONOUNS: ReadonlySet<string> = new Set([
  "they", "them", "their", "it", "its", "this", "that", "these", "those", "he", "she", "his", "her", "my", "our", "your",
]);

/**
 * The shape of this question, and the words that name its body, or null.
 *
 * A pure reading of the words: no binding happens here. `MEETING_OUTCOME`
 * additionally requires the route's own outcome detector to agree, and
 * `BODY_AGENDA` requires that it does NOT — the route asks the same two
 * questions when it decides what to retrieve, so the shape can never disagree
 * with retrieval about which question was asked.
 */
export function lexicalQuestionShape(question: string): { shape: LexicalShape; slot: string } | null {
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 160) return null;
  const outcome = outcomeQuestionClass(question);
  for (const { shape, pattern } of SHAPES) {
    const match = pattern.exec(normalized);
    const slot = match?.[1]?.trim();
    if (!slot) continue;
    // A pronoun is not a name: "when do they meet" depends on something earlier.
    if (slot.split(" ").some((word) => SLOT_PRONOUNS.has(word))) return null;
    if (shape === "MEETING_OUTCOME" && !outcome) continue;
    if (shape !== "MEETING_OUTCOME" && outcome) continue;
    return { shape, slot };
  }
  return null;
}

/** Every word of the slot is the body's own name or generic civic vocabulary. */
function slotIsOnlyTheName(slot: string, entity: BindableEntity): boolean {
  const own = new Set(normalizeName(entity.name).split(" ").filter(Boolean));
  const words = normalizeName(slot).split(" ").filter(Boolean);
  return words.length > 0 && words.every((word) => own.has(word) || GENERIC_CIVIC_TOKENS.has(word) || word === "s");
}

/**
 * The shape of a question already bound to `bodyId`, when its name slot is
 * that body's name and nothing else. The composer (`lib/ask/sitting-answer.ts`)
 * asks this whichever rung read the question, so a composed answer is only
 * ever about the body the reader's own words named.
 */
export function shapeForBoundBody(
  question: string,
  inventory: readonly BindableEntity[],
  bodyId: string,
): LexicalShape | null {
  const found = lexicalQuestionShape(question);
  if (!found) return null;
  const slotBinding = bindNamedEntity(found.slot, inventory);
  if (slotBinding.kind !== "BOUND" || slotBinding.entity.id !== bodyId) return null;
  return slotIsOnlyTheName(found.slot, slotBinding.entity) ? found.shape : null;
}

export interface LexicalReadingInput {
  question: string;
  /** The same inventory the route hands the model and the resolver. */
  inventory: readonly BindableEntity[];
  /** The bodies the route's named-body decision reads (the national index for a class phrase). */
  namedBodies: readonly BindableEntity[];
  /** The ephemeral confirmation round-trip, if the client sent one. */
  confirmation?: unknown;
  activeSubjects?: readonly AskSubjectRef[];
  priorSubjects?: readonly AskSubjectRef[];
}

export interface LexicalReading {
  shape: LexicalShape;
  interpretation: AskInterpretation;
  /** The canonical body every binder agreed on. */
  bodyId: string;
}

/**
 * The reading the model rung would have produced for this question, read in
 * code — or null, in which case the caller asks the model exactly as before.
 */
export function lexicalReading(input: LexicalReadingInput): LexicalReading | null {
  const found = lexicalQuestionShape(input.question);
  if (!found) return null;

  /*
   * The tense is the deterministic reader's, unchanged: it is what the model
   * returned on every question of these shapes in the 2026-09-25 agreement
   * check (12 of 12 against `claude-opus-5`), including NONE for "when does
   * the Vail school board meet?" — the route's selection turns MEETING_TIME
   * into the next sitting either way. The one intent the model reads
   * differently from the shape is a past meeting-time question ("when did the
   * Mesa City Council last meet?"), which it calls PAST_MEETING; so does this.
   */
  const temporal = interpretWithoutModel(input.question).temporal;
  if (temporal.kind === "RANGE" || temporal.kind === "DATE") return null;
  if (found.shape === "MEETING_OUTCOME" && temporal.kind !== "LAST") return null;

  const interpretation: AskInterpretation = {
    ...unavailableInterpretation(),
    intent: found.shape === "BODY_AGENDA"
      ? "UPCOMING_AGENDA"
      : found.shape === "MEETING_OUTCOME" || temporal.kind === "LAST" ? "PAST_MEETING" : "MEETING_TIME",
    temporal,
  };

  // 1. The whole question binds one BODY on the reader's own words.
  const resolved = resolveInterpretation(interpretation, input.question, input.inventory, {
    activeSubjects: input.activeSubjects ?? [],
    priorSubjects: input.priorSubjects ?? [],
  });
  if (resolved.binding.kind !== "BOUND" || resolved.basis !== "WHOLE_QUESTION") return null;
  const entity = resolved.binding.entity;
  if (entity.level !== "BODY") return null;

  // 2. The slot is the name and nothing else, and it binds the same body.
  if (!slotIsOnlyTheName(found.slot, entity)) return null;
  const slotBinding = bindNamedEntity(found.slot, input.inventory);
  if (slotBinding.kind !== "BOUND" || slotBinding.entity.id !== entity.id) return null;

  // 3. The route's named-body decision binds the same body on the reader's
  //    words alone (the branch that never reads a model mention), unconfirmed.
  const decision = decideNamedBody(input.question, input.namedBodies, input.confirmation, []);
  if (decision.kind !== "BOUND" || decision.confirmed || decision.entity.id !== entity.id) return null;

  return { shape: found.shape, interpretation, bodyId: entity.id };
}
