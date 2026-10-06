import { normalizeName } from "../routing/exact-name.ts";
import {
  bindNamedEntity,
  CLASS_PHRASE_DIVISIONS,
  classPhraseIn,
  COMMON_QUESTION_NOUNS,
  distinctiveTokens,
  GENERIC_CIVIC_TOKENS,
  type BindableEntity,
} from "../routing/named-entity.ts";
import { decideNamedBody } from "./body-confirmation.ts";
import { unavailableInterpretation, type AskIntent, type AskInterpretation } from "./intent.ts";
import { interpretWithoutModel } from "./interpret.ts";
import { meetingDateInQuestion } from "./meeting-date.ts";
import { groupMoneyQuestionShape, moneyQuestionShape, raceWordsFitOffice, type GroupMoneyAsk, type MoneyAsk } from "./money-answer.ts";
import { outcomeQuestionClass } from "./outcome-question.ts";
import { personVotesQuestionShape, type PersonVotesQuestion } from "./person-votes.ts";
import { resolveInterpretation } from "./resolve.ts";
import type { AskSubjectRef } from "./subject.ts";

/**
 * **A QUESTION THE READER'S OWN WORDS ALREADY SETTLE NEEDS NO MODEL TO READ
 * IT.** (2026-09-25, the Ask latency repair.)
 *
 * Measured on production 2026-09-25: a new question on a warm instance spent
 * 2.0-3.3 s in the interpretation rung before any record was read. For
 * *"When does the Mesa City Council meet next?"* the model returned exactly
 * what the product's own binder and tense reader already knew — the body the
 * reader named (bound on the whole question), the intent `MEETING_TIME` and
 * the tense `NEXT`. Sean's bar is three seconds from the question to a usable
 * answer, and that call alone was most of it.
 *
 * So a closed set of question SHAPES is read here, in code, and the model rung
 * is skipped for them. The set is deliberately narrow — narrower than what a
 * model could read — because every question it admits must get the same
 * binding, the same tense and the same retrieval the model path would have
 * produced:
 *
 * 1. **The whole question matches one canonical shape** (below), anchored at
 *    both ends. Nothing may sit outside the shape's own words and the name:
 *    "when does the council meet next about the budget" does not match, so a
 *    qualifier the shape would ignore can never be silently dropped.
 * 2. **The name slot is only a name.** Every word in it is either a word of
 *    the bound subject's own name or generic civic vocabulary ("city",
 *    "council", "board"...), and it binds the SAME subject the whole question
 *    binds. No second subject is named anywhere in the question — so no model
 *    mention could bind something else first.
 * 3. **The subject is the kind the shape asks about** (a body for "when does
 *    X meet", a ballot measure for "explain X", a person for "who is X"), and
 *    for a body the route's named-body decision binds the same body on the
 *    reader's words alone — the branch that never consults a model mention.
 * 4. **The tense is one the retrieval reads identically either way.** The
 *    sitting shapes use the deterministic tense (it matched the model on
 *    every question of the 2026-09-25 agreement check); the named-subject
 *    shapes admit only a question with no tense word at all, whose selection
 *    is the same `ANY` whatever intent a model would name.
 *
 * Anything else — a pronoun, an unmatched phrasing, an ambiguous, unheld or
 * second name, a class phrase on a non-body, a tense word on a named-subject
 * shape — returns null and the model reads the question exactly as before. A
 * null is never a verdict about the question; it only means "not settled here".
 */

/** The shapes about one body's sittings — the ones `lib/ask/sitting-answer.ts` can compose. */
export type SittingShape = "MEETING_TIME" | "BODY_AGENDA" | "MEETING_OUTCOME" | "PUBLIC_COMMENT";
/**
 * The closed set of question shapes this module reads. `MONEY` (2026-09-25)
 * is a named person's campaign money — how much, who gave, or a comparison of
 * two named people — read by `moneyQuestionShape` in `lib/ask/money-answer.ts`,
 * the module that composes its answer. `CONTACT` is how to reach a named
 * person or body.
 */
export type LexicalShape = SittingShape | "BODY_ROSTER" | "BODY_CIVICS" | "GOVERNMENT_MONEY" | "MEASURE_EXPLAIN" | "PERSON_RECORD" | "CONTEST_FIELD" | "CONTACT" | "MONEY" | "GROUP_MONEY" | "PERSON_VOTES";

export type SubjectKind = "BODY" | "MEASURE" | "CONTEST" | "PERSON";

interface ShapePattern {
  readonly shape: LexicalShape;
  /** The kind of subject the shape asks about; any other binding refuses it. */
  readonly kind: SubjectKind;
  /** Anchored, over `normalizeName(question)`; the ONE capturing group is the name. */
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
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^when (?:is|s) (?:the )?(.+?) meeting next(?: and where)?$/ },
  { shape: "MEETING_TIME", kind: "BODY", pattern: new RegExp(`^when (?:does|do|will|did) (?:the )?(.+?) (?:(?:next|last|first) )?(?:meet|convene|sit)${WHEN_TAIL}$`) },
  { shape: "MEETING_TIME", kind: "BODY", pattern: new RegExp(`^when (?:does|do|will|did) (?:the )?(.+?) (?:hold|have) (?:its|their) (?:next|last|first) (?:meeting|session)$`) },
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^when (?:is|s|was) (?:the )?(?:next|upcoming|last|latest|most recent|previous) (.+?) (?:meeting|session)$/ },
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^when (?:is|s|was) (?:the )?(.+?)(?: s)? (?:next|upcoming|last|latest|most recent|previous) (?:meeting|session)$/ },
  { shape: "MEETING_TIME", kind: "BODY", pattern: new RegExp(`^what (?:time|day|date) (?:does|do|will|is) (?:the )?(.+?) (?:(?:next )?meet|meeting)${WHEN_TAIL}$`) },
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^what (?:is|s) the (?:date|time|date and time|day) of the (?:next|upcoming|last|latest|most recent) (.+?) (?:meeting|session)$/ },
  /* "Is there a meeting soon?" (2026-09-25): the answer is the next sitting, stated with its date, so the reader judges "soon". */
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^is there (?:a|an) (?:upcoming |next )?(.+?) (?:meeting|session)(?: coming up)?(?: soon)?$/ },
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^is there (?:a|an) (?:upcoming |next )?(?:meeting|session) of (?:the )?(.+?)(?: coming up)?(?: soon)?$/ },
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^does (?:the )?(.+?) have (?:a|an) (?:upcoming |next )?(?:meeting|session)(?: coming up)?(?: soon)?$/ },
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^is (?:the )?(.+?) meeting (?:soon|any ?time soon)$/ },
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^when (?:is|s) (?:the )?(.+?) (?:meeting|session)$/ },
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^(?:when|what) (?:is|s) the (?:next|upcoming) (?:meeting|session) of (?:the )?(.+?)$/ },
  { shape: "MEETING_TIME", kind: "BODY", pattern: /^what (?:is|s) the (?:next|upcoming) (.+?) (?:meeting|session)$/ },
  /* BODY_AGENDA — what is on a named body's own docket. */
  { shape: "BODY_AGENDA", kind: "BODY", pattern: /^what (?:s|is|are|was|were) on (?:the )?(.+?)(?: s)? (?:(?:next|upcoming|last|latest|most recent|previous) )?(?:meeting )?(?:agenda|docket)$/ },
  /* "...for the next Pima County Board of Supervisors meeting": the tense word is the deterministic reader's, never part of the name (2026-09-29). */
  { shape: "BODY_AGENDA", kind: "BODY", pattern: /^what (?:s|is|are|was|were) on the (?:(?:next|upcoming|last|latest|most recent|previous) )?(?:agenda|docket) (?:for|of|at) (?:the )?(?:(?:next|upcoming|last|latest|most recent|previous) )?(.+?)(?: s)?(?: (?:(?:next|upcoming) )?(?:meeting|session))?$/ },
  /* MEETING_OUTCOME — what a named body decided, or how it voted. */
  { shape: "MEETING_OUTCOME", kind: "BODY", pattern: /^what did (?:the )?(.+?) (?:decide|approve|pass|adopt) at (?:its|their|the) (?:\d{4} \d{1,2} \d{1,2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?) \d{1,2}(?:st|nd|rd|th)? \d{4}) meeting$/ },
  { shape: "MEETING_OUTCOME", kind: "BODY", pattern: new RegExp(`^what did (?:the )?(.+?) (?:decide|decide on|vote on|approve|pass|adopt)${RECENTLY}$`) },
  { shape: "MEETING_OUTCOME", kind: "BODY", pattern: new RegExp(`^how did (?:the )?(.+?) vote${RECENTLY}$`) },
  /* PUBLIC_COMMENT — how to take part in a named body's meeting: comment, speak, attend (2026-09-29). */
  { shape: "PUBLIC_COMMENT", kind: "BODY", pattern: /^(?:how|where) (?:can|do|could|would|should) (?:i|we) (?:comment|speak|give (?:public )?comment|make (?:a )?(?:public )?comment|participate|attend|sign up to speak|say something|give input|weigh in) (?:at|in|for|during|to) (?:the )?(?:(?:next|upcoming) )?(.+?)(?: (?:(?:next|upcoming) )?(?:meeting|session))?$/ },
  { shape: "PUBLIC_COMMENT", kind: "BODY", pattern: /^can (?:i|we) (?:comment|speak|attend|participate|give (?:public )?comment|make (?:a )?(?:public )?comment)(?: at| in| for| during| to)? (?:the )?(?:(?:next|upcoming) )?(.+?)(?: (?:(?:next|upcoming) )?(?:meeting|session))?$/ },
  { shape: "PUBLIC_COMMENT", kind: "BODY", pattern: /^(?:does|do) (?:the )?(.+?) (?:take|allow|have|accept|hold|offer) (?:public )?(?:comments?|public comment)$/ },
  /* BODY_ROSTER — who sits on a named body. Before PERSON_RECORD: "who is on X" is not "who is X". */
  { shape: "BODY_ROSTER", kind: "BODY", pattern: /^who (?:sits|serves) on (?:the )?(.+?)$/ },
  { shape: "BODY_ROSTER", kind: "BODY", pattern: /^who (?:is|s|are) on (?:the )?(.+?)$/ },
  { shape: "BODY_ROSTER", kind: "BODY", pattern: /^who are the members of (?:the )?(.+?)$/ },
  { shape: "GOVERNMENT_MONEY", kind: "BODY", pattern: /^(?:what is|what s|show) (?:the )?(.+?)(?: s)? (?:adopted )?budget$/ },
  { shape: "GOVERNMENT_MONEY", kind: "BODY", pattern: /^what is (?:the )?(?:adopted )?budget (?:of|for) (?:the )?(.+?)$/ },
  /* BODY_CIVICS — what a named body does. */
  { shape: "BODY_CIVICS", kind: "BODY", pattern: /^what does (?:the )?(.+?) do$/ },
  /* MEASURE_EXPLAIN — what a named ballot measure means. */
  { shape: "MEASURE_EXPLAIN", kind: "MEASURE", pattern: /^explain (?:the )?(.+?)(?: to me)?$/ },
  { shape: "MEASURE_EXPLAIN", kind: "MEASURE", pattern: /^what (?:is|s) (?:the )?(.+?)$/ },
  { shape: "MEASURE_EXPLAIN", kind: "MEASURE", pattern: /^what (?:does|would) (?:the )?(.+?) (?:do|mean|change)$/ },
  { shape: "MEASURE_EXPLAIN", kind: "MEASURE", pattern: /^tell me about (?:the )?(.+?)$/ },
  /* CONTEST_FIELD — who is on the ballot for a named contest. */
  { shape: "CONTEST_FIELD", kind: "CONTEST", pattern: /^who (?:is|s|are) running for (?:the )?(.+?)$/ },
  /* PERSON_RECORD — who a named person is, what they have done, how they have voted. */
  { shape: "PERSON_RECORD", kind: "PERSON", pattern: /^who (?:is|s) (.+?)$/ },
  { shape: "PERSON_RECORD", kind: "PERSON", pattern: /^what has (.+?) done$/ },
  { shape: "PERSON_RECORD", kind: "PERSON", pattern: /^how has (.+?) voted$/ },
  { shape: "PERSON_RECORD", kind: "PERSON", pattern: /^tell me about (.+?)$/ },
  /* More of what a reader asks about one named person (2026-09-25); each reads PERSON_RECORD, as the models read them. */
  { shape: "PERSON_RECORD", kind: "PERSON", pattern: /^what (?:office|seat|position) is (.+?) running for$/ },
  { shape: "PERSON_RECORD", kind: "PERSON", pattern: /^what party is (.+?)(?: in| with| running as| registered with)?$/ },
  { shape: "PERSON_RECORD", kind: "PERSON", pattern: /^is (.+?) (?:the |an )?incumbent$/ },
  { shape: "PERSON_RECORD", kind: "PERSON", pattern: /^what (?:does|do) (.+?) stand for$/ },
  { shape: "PERSON_RECORD", kind: "PERSON", pattern: /^what (?:is|s|are) (.+?) s (?:background|record|voting record|platform|biography|bio)$/ },
  /* CONTACT — how to reach a named person or body; the models read CONTACT (2026-09-25, "How do I contact Katie Hobbs?"). */
  { shape: "CONTACT", kind: "PERSON", pattern: /^how (?:do|can|could|would|should) (?:i|we) (?:contact|reach|get in touch with|email|call|write to|talk to|speak to|speak with) (.+?)$/ },
  { shape: "CONTACT", kind: "BODY", pattern: /^how (?:do|can|could|would|should) (?:i|we) (?:contact|reach|get in touch with|email|call|write to|talk to|speak to|speak with) (?:the )?(.+?)$/ },
  { shape: "CONTACT", kind: "PERSON", pattern: /^what (?:is|s|are) (.+?) s (?:contact information|contact info|phone number|email address)$/ },
];

const SITTING_SHAPES: ReadonlySet<LexicalShape> = new Set<LexicalShape>(["MEETING_TIME", "BODY_AGENDA", "MEETING_OUTCOME", "PUBLIC_COMMENT"]);

/**
 * The intent each named-subject shape carries: what `claude-opus-5` returned
 * for the same question in the 2026-09-25 agreement checks — PERSON_RECORD
 * for a roster question (all three models measured), for "who is running for
 * governor?", "what has Katie Hobbs done?" and "who is Juan Ciscomani?";
 * MEASURE for "explain Prop 141"; all with no tense. BODY_CIVICS's CIVICS is
 * the prompt's own definition (its one live check errored). For a body, any
 * of these selects the same `ANY` sitting; for the others no sitting is
 * selected — the intent reaches only the writer's `whatTheyAreAskingFor`.
 */
const SHAPE_INTENT: Readonly<Record<Exclude<LexicalShape, SittingShape>, AskIntent>> = {
  BODY_ROSTER: "PERSON_RECORD",
  BODY_CIVICS: "CIVICS",
  GOVERNMENT_MONEY: "CIVICS",
  MEASURE_EXPLAIN: "MEASURE",
  CONTEST_FIELD: "PERSON_RECORD",
  PERSON_RECORD: "PERSON_RECORD",
  /* "How do I contact Katie Hobbs?": CONTACT on all four models, 2026-09-25. */
  CONTACT: "CONTACT",
  /* A named person's campaign-money question, 2026-09-25 comparison: PERSON_RECORD in 25 of the 29
     distinct readings logged (UNKNOWN twice, MEASURE, CIVICS), and no tense in all 29. */
  MONEY: "PERSON_RECORD",
  /* A race's candidates' money (2026-09-25): the same reading as one person's; no sitting is selected for it. */
  GROUP_MONEY: "PERSON_RECORD",
  /* How a named person voted (2026-09-29): a person's record, with no tense — it selects no sitting. */
  PERSON_VOTES: "PERSON_RECORD",
};

const SLOT_PRONOUNS: ReadonlySet<string> = new Set([
  "they", "them", "their", "it", "its", "this", "that", "these", "those", "he", "she", "his", "her", "my", "our", "your",
  "i", "me", "we", "you", "him", "there",
]);

/**
 * Every shape this question matches, in declaration order, with the words in
 * its name slot. A pure reading of the words: no binding happens here. The
 * sitting shapes also keep the route's own outcome detector's reading —
 * `MEETING_OUTCOME` requires it, `BODY_AGENDA` / `MEETING_TIME` require its
 * absence — so a shape can never disagree with retrieval about which question
 * was asked.
 */
function shapeMatches(question: string, options: { pronouns?: boolean } = {}): { shape: LexicalShape; kind: SubjectKind; slot: string }[] {
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 160) return [];
  const outcome = outcomeQuestionClass(question);
  const out: { shape: LexicalShape; kind: SubjectKind; slot: string }[] = [];
  for (const { shape, kind, pattern } of SHAPES) {
    const slot = pattern.exec(normalized)?.[1]?.trim();
    if (!slot) continue;
    // A pronoun is not a name: "when do they meet" depends on something earlier.
    if (!options.pronouns && slot.split(" ").some((word) => SLOT_PRONOUNS.has(word))) continue;
    if (SITTING_SHAPES.has(shape) && (shape === "MEETING_OUTCOME") !== Boolean(outcome)) continue;
    if (!SITTING_SHAPES.has(shape) && outcome) continue;
    out.push({ shape, kind, slot });
  }
  return out;
}

/** The first shape this question matches, and the words in its name slot, or null. */
export function lexicalQuestionShape(question: string): { shape: LexicalShape; slot: string } | null {
  const found = shapeMatches(question)[0];
  return found ? { shape: found.shape, slot: found.slot } : null;
}

/** A named council or board with no match in our records needs a gap, not a model or a clarification. */
export function unheldNamedBodyQuestion(question: string, bodies: readonly BindableEntity[]): { shape: LexicalShape; name: string } | null {
  const match = shapeMatches(question).find((entry) => entry.kind === "BODY");
  if (!match || !classPhraseIn(match.slot) ||
    !distinctiveTokens(match.slot).some((word) => !COMMON_QUESTION_NOUNS.has(word))) return null;
  // Keep suggestions and ambiguous held names on their existing confirmation path.
  if (decideNamedBody(question, bodies).kind !== "CLARIFY") return null;
  return { shape: match.shape, name: match.slot };
}

/** Keep the reader's body name when it binds to the resolved body; a pronoun or another name cannot rename it. */
export function bodyNameFromQuestion(question: string, inventory: readonly BindableEntity[], bodyId: string): string | null {
  const match = shapeMatches(question).find((entry) => entry.kind === "BODY");
  return match && slotNames(match.slot, inventory, bodyId) ? match.slot : null;
}

/**
 * The intent a shape carries for a subject of the kind it asks about — the one
 * rule `lexicalReading` applies below, for a caller that reads the question
 * more loosely (`lib/ask/speculative-reading.ts`): a pronoun may fill the name
 * slot, and the subject may be bound by the page or an earlier turn. Null when
 * no shape of that kind matches. It is only ever a GUESS there: the model still
 * reads the question, and a guess it does not confirm is discarded.
 */
export function shapeIntentFor(question: string, kind: SubjectKind | null, temporal: AskInterpretation["temporal"]): { shape: LexicalShape; intent: AskIntent } | null {
  const found = shapeMatches(question, { pronouns: true }).find((match) => match.kind === kind);
  if (!found) return null;
  return { shape: found.shape, intent: shapeIntent(found.shape, temporal) };
}

/** A subject's kind, as the shapes read it. */
export function subjectKindOf(entity: BindableEntity): SubjectKind | null {
  return kindOf(entity);
}

function shapeIntent(shape: LexicalShape, temporal: AskInterpretation["temporal"]): AskIntent {
  if (!SITTING_SHAPES.has(shape)) return SHAPE_INTENT[shape as Exclude<LexicalShape, SittingShape>];
  return shape === "BODY_AGENDA"
    ? "UPCOMING_AGENDA"
    : shape === "MEETING_OUTCOME" || temporal.kind === "LAST" ? "PAST_MEETING" : "MEETING_TIME";
}

function kindOf(entity: BindableEntity): SubjectKind | null {
  if (entity.level === "BODY") return "BODY";
  if (entity.divisionType === "measure") return "MEASURE";
  if (entity.divisionType === "contest") return "CONTEST";
  if (entity.divisionType === "person" || entity.nameClass === "person") return "PERSON";
  return null;
}

/** Every word of the slot is the subject's own name or generic civic vocabulary. */
function slotIsOnlyTheName(slot: string, entity: BindableEntity): boolean {
  const own = new Set(normalizeName(entity.name).split(" ").filter(Boolean));
  const words = normalizeName(slot).split(" ").filter(Boolean);
  return words.length > 0 && words.every((word) => own.has(word) || GENERIC_CIVIC_TOKENS.has(word) || word === "s");
}

/**
 * Does the question also name a DIFFERENT subject — one whose identifying words
 * all appear in it and are not simply the bound subject's own words? "Mesa"
 * the city and "Mesa Unified" share the one identifying word the reader typed,
 * and the binder's class tie-break already chose between them; "Katie Hobbs"
 * and "Prop 141" are two subjects, and a model's first mention could bind
 * either, so such a question is left to the model.
 */
function namesAnotherSubject(question: string, inventory: readonly BindableEntity[], id: string | ReadonlySet<string>): boolean {
  const ids = typeof id === "string" ? new Set([id]) : id;
  const words = new Set(normalizeName(question).split(" ").filter(Boolean));
  const own = new Set(inventory.filter((entity) => ids.has(entity.id)).flatMap((entity) => distinctiveTokens(entity.name)));
  return inventory.some((entity) => {
    if (ids.has(entity.id)) return false;
    const identifying = distinctiveTokens(entity.name);
    if (identifying.length === 0 || identifying.every((token) => COMMON_QUESTION_NOUNS.has(token))) return false;
    return identifying.every((token) => words.has(token)) && identifying.some((token) => !own.has(token));
  });
}

/** The slot binds `id` in the inventory, through a name variant that is the slot and nothing else. */
function slotNames(slot: string, inventory: readonly BindableEntity[], id: string): boolean {
  const binding = bindNamedEntity(slot, inventory);
  if (binding.kind !== "BOUND" || binding.entity.id !== id) return false;
  return inventory.some((entity) => entity.id === id && slotIsOnlyTheName(slot, entity));
}

/**
 * The SITTING shape of a question already bound to `bodyId`, when its name slot
 * is that body's name and nothing else. The composer (`lib/ask/sitting-answer.ts`)
 * asks this whichever rung read the question, so a composed answer is only
 * ever about the body the reader's own words named.
 */
export function shapeForBoundBody(
  question: string,
  inventory: readonly BindableEntity[],
  bodyId: string,
): SittingShape | null {
  const found = shapeMatches(question).find((match) => SITTING_SHAPES.has(match.shape));
  if (!found) return null;
  return slotNames(found.slot, inventory, bodyId) ? found.shape as SittingShape : null;
}

/** A person the words bind to, through a name variant that is the words and nothing else. */
function boundPersonFor(words: string | undefined, inventory: readonly BindableEntity[]): BindableEntity | null {
  if (!words || words.split(" ").some((word) => SLOT_PRONOUNS.has(word))) return null;
  const binding = bindNamedEntity(words, inventory);
  if (binding.kind !== "BOUND" || kindOf(binding.entity) !== "PERSON") return null;
  return slotNames(words, inventory, binding.entity.id) ? binding.entity : null;
}

/**
 * **THE MONEY SHAPE OF A QUESTION ALREADY BOUND TO `personId`.** (2026-09-25.)
 * The composer (`lib/ask/money-answer.ts`) asks this whichever rung read the
 * question, exactly as the sitting composer asks `shapeForBoundBody`: the name
 * slot must be that person's name and nothing else; a race the reader named
 * must be that person's own office; and for a comparison the second slot must
 * name one other held person. Null means the model writes the answer.
 */
export function moneyShapeForBoundPerson(
  question: string,
  inventory: readonly BindableEntity[],
  personId: string,
  officeOf: (id: string) => string | null | undefined = () => null,
): { ask: MoneyAsk; otherId: string | null } | null {
  const money = moneyQuestionShape(question);
  if (!money || !slotNames(money.slot, inventory, personId)) return null;
  if (money.raceWords && !raceWordsFitOffice(money.raceWords, officeOf(personId))) return null;
  if (money.ask.kind !== "COMPARE") return { ask: money.ask, otherId: null };
  const other = boundPersonFor(money.otherSlot, inventory);
  return other && other.id !== personId ? { ask: money.ask, otherId: other.id } : null;
}

/**
 * **THE RACE MONEY SHAPE OF A QUESTION ALREADY BOUND TO `subjectId`.**
 * (2026-09-25.) "Who funded the Vail school board candidates?", "How much have
 * the candidates for governor raised?": the race words must name that contest
 * or body and nothing else, and nothing in the question names a person. The
 * composer asks this whichever rung read the question. Null means the model
 * writes the answer.
 */
export function groupMoneyShapeForBoundSubject(
  question: string,
  inventory: readonly BindableEntity[],
  subjectId: string,
): GroupMoneyAsk | null {
  const group = groupMoneyQuestionShape(question);
  if (!group || !slotNames(group.group, inventory, subjectId)) return null;
  const bound = bindNamedEntity(group.group, inventory);
  if (bound.kind !== "BOUND" || bound.entity.id !== subjectId) return null;
  const kind = kindOf(bound.entity);
  if (kind !== "CONTEST" && kind !== "BODY") return null;
  return namesAnotherSubject(question, inventory, subjectId) ? null : group.ask;
}

/**
 * **HOW A NAMED PERSON VOTED, FOR THE COMPOSER.** (2026-09-29.) The name slot must
 * be that person's name and nothing else, exactly as for their money.
 */
export function personVotesShapeForBoundPerson(
  question: string,
  inventory: readonly BindableEntity[],
  personId: string,
): PersonVotesQuestion | null {
  const votes = personVotesQuestionShape(question);
  return votes && slotNames(votes.slot, inventory, personId) ? votes : null;
}

/**
 * **HOW A NAMED PERSON VOTED, READ IN CODE.** (2026-09-29.) The same conditions as
 * every other shape: the slot is the person's name and nothing else, the route's
 * own resolver binds that person on the reader's words, no other subject is named,
 * and no tense is read — a person's votes select no sitting. Null means "not
 * settled here" and the general shapes and then the model read it as before.
 */
function personVotesReading(input: LexicalReadingInput): LexicalReading | null {
  const votes = personVotesQuestionShape(input.question);
  if (!votes) return null;
  const person = boundPersonFor(votes.slot, input.inventory);
  if (!person) return null;
  const temporal = { kind: "NONE" as const };
  const resolved = resolveInterpretation({ ...unavailableInterpretation(), temporal }, input.question, input.inventory, {
    activeSubjects: input.activeSubjects ?? [], priorSubjects: input.priorSubjects ?? [],
  });
  if (resolved.binding.kind !== "BOUND" || resolved.basis !== "WHOLE_QUESTION" || resolved.binding.entity.id !== person.id) return null;
  if (namesAnotherSubject(input.question, input.inventory, person.id) || classPhraseIn(input.question)) return null;
  return { shape: "PERSON_VOTES", interpretation: { ...unavailableInterpretation(), intent: SHAPE_INTENT.PERSON_VOTES, temporal }, subjectId: person.id };
}

/**
 * **A RACE'S CANDIDATES' MONEY, READ IN CODE.** (2026-09-25.) Undefined when
 * the question is not a race money shape; null when it is and cannot be
 * settled here. The same conditions as every other shape: the race words bind
 * one contest or body and are its name and nothing else; the route's own
 * resolver binds the same subject on the whole question; nothing else is named;
 * and for a body, the route's named-body decision binds the same body on the
 * reader's words alone. No tense is read.
 */
function groupMoneyReading(input: LexicalReadingInput): LexicalReading | null | undefined {
  const group = groupMoneyQuestionShape(input.question);
  if (!group) return undefined;
  if (outcomeQuestionClass(input.question)) return null;
  const bound = bindNamedEntity(group.group, input.inventory);
  if (bound.kind !== "BOUND") return null;
  const kind = kindOf(bound.entity);
  if (kind !== "CONTEST" && kind !== "BODY") return null;
  if (!groupMoneyShapeForBoundSubject(input.question, input.inventory, bound.entity.id)) return null;
  const temporal = { kind: "NONE" as const };
  const resolved = resolveInterpretation({ ...unavailableInterpretation(), temporal }, input.question, input.inventory, {
    activeSubjects: input.activeSubjects ?? [],
    priorSubjects: input.priorSubjects ?? [],
  });
  if (resolved.binding.kind !== "BOUND" || resolved.basis !== "WHOLE_QUESTION" || resolved.binding.entity.id !== bound.entity.id) return null;
  if (kind === "BODY") {
    const decision = decideNamedBody(input.question, input.namedBodies, input.confirmation, []);
    if (decision.kind !== "BOUND" || decision.confirmed || decision.entity.id !== bound.entity.id) return null;
  } else if (classPhraseIn(input.question)) {
    return null;
  }
  return { shape: "GROUP_MONEY", interpretation: { ...unavailableInterpretation(), intent: SHAPE_INTENT.GROUP_MONEY, temporal }, subjectId: bound.entity.id };
}

/**
 * The one OTHER held person a money question names beside its subject —
 * "...raised more money than Kelly Ayotte" — or null. Every identifying word of
 * that person's name is in the question and at least one is not the subject's
 * own; more than one such person is null (never a guess). The route retrieves
 * that person's money too, so no writer is handed a comparison with half of it.
 */
export function otherNamedPerson(question: string, inventory: readonly BindableEntity[], subjectId: string): BindableEntity | null {
  const words = new Set(normalizeName(question).split(" ").filter(Boolean));
  const own = new Set(inventory.filter((entity) => entity.id === subjectId).flatMap((entity) => distinctiveTokens(entity.name)));
  /* The binder's own rule: more identifying words first. "Joseph M. MURPHY" in
     full outranks another candidate's bare surname alias "Murphy". */
  let best = 0;
  const named = new Map<string, BindableEntity>();
  for (const entity of inventory) {
    if (entity.id === subjectId || kindOf(entity) !== "PERSON") continue;
    const identifying = distinctiveTokens(entity.name);
    if (identifying.length === 0 || identifying.every((token) => COMMON_QUESTION_NOUNS.has(token))) continue;
    if (!identifying.every((token) => words.has(token)) || !identifying.some((token) => !own.has(token))) continue;
    if (identifying.length > best) { best = identifying.length; named.clear(); }
    if (identifying.length === best) named.set(entity.id, entity);
  }
  return named.size === 1 ? [...named.values()][0] : null;
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
  /** The office a held person is on the ballot for, so a race the reader names can be checked against it. */
  officeOf?: (id: string) => string | null | undefined;
  /**
   * The governing bodies of the divisions the reader's ZIP reaches (each division's own
   * council, board or supervisors), for a question that names only the class of body.
   */
  readerGoverning?: readonly BindableEntity[];
}

export interface LexicalReading {
  shape: LexicalShape;
  interpretation: AskInterpretation;
  /** The canonical subject every binder agreed on. */
  subjectId: string;
  /** A kind of body was named and the reader's ZIP reaches several of that kind: the reader is asked which, from these. */
  areaChoices?: { readonly mention: string; readonly bodies: readonly BindableEntity[] };
}

/**
 * The intent a sitting or other body shape carries for this tense, or null when the tense is one
 * the model must read.
 */
function tenseIntent(shape: LexicalShape, temporal: AskInterpretation["temporal"]): AskIntent | null {
  let intent: AskIntent;
  if (SITTING_SHAPES.has(shape)) {
    /*
     * The deterministic tense, unchanged: it is what the model returned on
     * every question of these shapes in the 2026-09-25 agreement check (12 of
     * 12 against the model then in use), including NONE for "when does the Vail
     * school board meet?" — the route's selection turns MEETING_TIME into the
     * next sitting either way. The one intent the model reads differently
     * from the shape is a past meeting-time question ("when did the Mesa City
     * Council last meet?"), which it calls PAST_MEETING; so does this.
     */
    if (temporal.kind === "RANGE" || (temporal.kind === "DATE" && shape !== "MEETING_OUTCOME")) return null;
    /* How to take part is asked of the next sitting: a tense that says otherwise is the model's. */
    if (shape === "PUBLIC_COMMENT" && temporal.kind !== "NONE" && temporal.kind !== "NEXT") return null;
    if (shape === "MEETING_OUTCOME" && temporal.kind !== "LAST" && temporal.kind !== "DATE") return null;
    intent = shapeIntent(shape, temporal);
  } else {
    if (temporal.kind !== "NONE") return null;
    intent = shapeIntent(shape, temporal);
  }
  return intent;
}

/** The words a reader uses for a kind of governing body, by the kind of division it governs. */
const AREA_CLASS_DIVISIONS: Readonly<Record<string, readonly string[]>> = {
  ...CLASS_PHRASE_DIVISIONS,
  "county board of supervisors": ["county"],
  "county supervisors": ["county"],
  "county commission": ["county"],
  "governing board": ["school_district"],
  "school district board": ["school_district"],
  "town board": ["place"],
  "city commission": ["place"],
};

/**
 * **"WHEN IS THE NEXT SCHOOL BOARD MEETING?" NAMES A KIND OF BODY, NOT ONE.**
 * (2026-09-30.) With no name in the question, the body is the one governing body
 * of that kind among the divisions the reader's ZIP reaches: their school board, their
 * city council. Exactly one settles it; several ask which of them (a handful, named); none
 * leaves the model to read it.
 */
function areaBodyOfClass(matches: readonly { shape: LexicalShape; kind: SubjectKind; slot: string }[], governing: readonly BindableEntity[]): { entity: BindableEntity | null; choices: readonly BindableEntity[]; mention: string; match: { shape: LexicalShape; kind: SubjectKind; slot: string } } | null {
  for (const match of matches) {
    if (match.kind !== "BODY") continue;
    const words = match.slot.replace(/^(?:(?:my|our|the|local|city s|town s) )+/, "").trim();
    const wanted = AREA_CLASS_DIVISIONS[words];
    if (!wanted) continue;
    const candidates = governing.filter((entity) => entity.level === "BODY" && wanted.includes(entity.divisionType ?? ""));
    if (candidates.length === 1) return { entity: candidates[0]!, choices: candidates, mention: words, match };
    if (candidates.length > 1 && candidates.length <= 6) return { entity: null, choices: candidates, mention: words, match };
  }
  return null;
}

/**
 * The reading the model rung would have produced for this question, read in
 * code — or null, in which case the caller asks the model exactly as before.
 */
export function lexicalReading(input: LexicalReadingInput): LexicalReading | null {
  const money = moneyReading(input);
  if (money !== undefined) return money;
  const group = groupMoneyReading(input);
  if (group !== undefined) return group;
  const votes = personVotesReading(input);
  if (votes) return votes;
  // The body's open card supplies context only for this fully referential shape.
  if (/^(?:what is|what s|show) (?:this|that) government s (?:adopted )?budget$/.test(normalizeName(input.question))) {
    const temporal = { kind: "NONE" as const };
    const resolved = resolveInterpretation({ ...unavailableInterpretation(), temporal }, input.question, input.inventory, {
      activeSubjects: input.activeSubjects ?? [], priorSubjects: input.priorSubjects ?? [],
    });
    if (resolved.binding.kind === "BOUND" && kindOf(resolved.binding.entity) === "BODY" &&
        (resolved.basis === "PAGE_CONTEXT" || resolved.basis === "PRIOR_TURN")) {
      return { shape: "GOVERNMENT_MONEY", interpretation: { ...unavailableInterpretation(), intent: "CIVICS", temporal }, subjectId: resolved.binding.entity.id };
    }
    return null;
  }
  const matches = shapeMatches(input.question);
  if (matches.length === 0) return null;

  // 1. The whole question binds one subject on the reader's own words, and names no other.
  const explicitDate = meetingDateInQuestion(input.question);
  if (explicitDate && !explicitDate.date) return null;
  const temporal: AskInterpretation["temporal"] = explicitDate?.date
    ? { kind: "DATE", localDate: explicitDate.date }
    : interpretWithoutModel(input.question).temporal;
  const area = areaBodyOfClass(matches, input.readerGoverning ?? []);
  if (area && !area.choices.some((choice) => namesAnotherSubject(input.question, input.inventory, choice.id))) {
    const areaIntent = tenseIntent(area.match.shape, temporal);
    if (!areaIntent) return null;
    if (!area.entity) return { shape: area.match.shape, interpretation: { ...unavailableInterpretation(), intent: areaIntent, temporal }, subjectId: "", areaChoices: { mention: area.mention, bodies: area.choices } };
    return { shape: area.match.shape, interpretation: { ...unavailableInterpretation(), intent: areaIntent, temporal, entityMentions: [area.entity.name] }, subjectId: area.entity.id };
  }
  const resolved = resolveInterpretation({ ...unavailableInterpretation(), temporal }, input.question, input.inventory, {
    activeSubjects: input.activeSubjects ?? [],
    priorSubjects: input.priorSubjects ?? [],
  });
  if (resolved.binding.kind !== "BOUND" || resolved.basis !== "WHOLE_QUESTION") return null;
  const entity = resolved.binding.entity;
  if (namesAnotherSubject(input.question, input.inventory, entity.id)) return null;
  const kind = kindOf(entity);
  const found = matches.find((match) => match.kind === kind);
  if (!found || !kind) return null;

  // 2. The slot is the name and nothing else, and it binds the same subject.
  if (!slotNames(found.slot, input.inventory, entity.id)) return null;

  // 3. For a body, the route's named-body decision binds the same body on the
  //    reader's words alone (never a model mention), unconfirmed. A class phrase
  //    on anything else sends the route down that decision too, so it is refused.
  if (kind === "BODY") {
    const decision = decideNamedBody(input.question, input.namedBodies, input.confirmation, []);
    if (decision.kind !== "BOUND" || decision.confirmed || decision.entity.id !== entity.id) return null;
  } else if (classPhraseIn(input.question)) {
    return null;
  }

  // 4. The tense, read identically either way.
  const intent = tenseIntent(found.shape, temporal);
  if (!intent) return null;

  return { shape: found.shape, interpretation: { ...unavailableInterpretation(), intent, temporal }, subjectId: entity.id };
}

/**
 * **A NAMED PERSON'S CAMPAIGN MONEY, READ IN CODE.** (2026-09-25.) Undefined
 * when the question is not a money shape; null when it is and cannot be
 * settled here (the model reads it, as before). The same four conditions as
 * every other shape: the slot is the person's name and nothing else; the
 * route's own resolver binds that person on the reader's words; no other
 * subject is named (a comparison names exactly the second person, in its
 * second slot); and no tense is read — the anchored shapes admit no window
 * words, and a money question selects no sitting.
 *
 * A comparison carries its first slot as the reader's own mention, so the
 * resolver binds the first person rather than asking which of the two was
 * meant — the model's reading of the same question names both and binds the
 * first the same way.
 */
function moneyReading(input: LexicalReadingInput): LexicalReading | null | undefined {
  const money = moneyQuestionShape(input.question);
  if (!money) return undefined;
  if (classPhraseIn(input.question) || outcomeQuestionClass(input.question)) return null;
  const first = boundPersonFor(money.slot, input.inventory);
  if (!first) return null;
  if (money.raceWords && !raceWordsFitOffice(money.raceWords, input.officeOf?.(first.id))) return null;
  const context = { activeSubjects: input.activeSubjects ?? [], priorSubjects: input.priorSubjects ?? [] };
  const temporal = { kind: "NONE" as const };
  if (money.ask.kind === "COMPARE") {
    const second = boundPersonFor(money.otherSlot, input.inventory);
    if (!second || second.id === first.id) return null;
    if (namesAnotherSubject(input.question, input.inventory, new Set([first.id, second.id]))) return null;
    const interpretation: AskInterpretation = { ...unavailableInterpretation(), intent: SHAPE_INTENT.MONEY, temporal, entityMentions: [money.slot] };
    const resolved = resolveInterpretation(interpretation, input.question, input.inventory, context);
    if (resolved.binding.kind !== "BOUND" || resolved.binding.entity.id !== first.id) return null;
    return { shape: "MONEY", interpretation, subjectId: first.id };
  }
  const resolved = resolveInterpretation({ ...unavailableInterpretation(), temporal }, input.question, input.inventory, context);
  if (resolved.binding.kind !== "BOUND" || resolved.basis !== "WHOLE_QUESTION" || resolved.binding.entity.id !== first.id) return null;
  if (namesAnotherSubject(input.question, input.inventory, first.id)) return null;
  return { shape: "MONEY", interpretation: { ...unavailableInterpretation(), intent: SHAPE_INTENT.MONEY, temporal }, subjectId: first.id };
}
