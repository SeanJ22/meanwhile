import { normalizeName, type NameableEntity } from "./exact-name.ts";

/**
 * **THE NAMED-ENTITY BINDING RUNG (2026-08-27, the ask-entity session).**
 *
 * A context default may never override an entity the reader named.
 *
 * ## The defect this exists to close
 *
 * A tester at a Tucson zip asked *"What's on the Vail school district
 * agenda?"* and the product answered about **Sunnyside Unified District** — a
 * different government, roughly thirty miles away, named nowhere in the
 * question — without saying that it had not found Vail, and without saying it
 * was using a default. The reader had no way to know the answer was about
 * somewhere else.
 *
 * The mechanism was not a bug in any one function. It was that **nothing in
 * the pipeline ever read the name**:
 *
 * - `matchTopic` matched `schools-policy` off the words "school district".
 * - `resolveRouting` asked `bodiesFor` for the school boards in the READER'S
 *   coverage, which at that point is Sunnyside.
 * - `matchExactName` compares the WHOLE input against a WHOLE name by design,
 *   so a name sitting inside a sentence never matched.
 * - The Level 1 classifier is asked for a topic id out of a closed list and
 *   nothing else, so the name never survived that call either.
 *
 * The proof is one line: with the word "Vail" DELETED, the question produced a
 * byte-identical answer. The name contributed nothing. A word the reader typed
 * to say *which government they meant* was inert, and the ZIP decided.
 *
 * ## What this rung does, and what it refuses to do
 *
 * It reads the question for a government the reader NAMED, reconciles that
 * name against entities this product actually holds, and returns one of four
 * verdicts. **It never picks a government.** Where the evidence does not
 * decide, it says so, and the caller renders that rather than an answer:
 *
 * | verdict      | what it means                          | what the caller owes the reader |
 * |--------------|----------------------------------------|---------------------------------|
 * | `NONE`       | no government named                    | the ZIP default may apply       |
 * | `BOUND`      | exactly one resolved                   | constrain retrieval to it       |
 * | `AMBIGUOUS`  | the name fits more than one            | ask which; never choose         |
 * | `UNRESOLVED` | a government was named, we hold no such | say the name did not resolve    |
 *
 * `UNRESOLVED` is the verdict the defect most needed and the one a matcher is
 * most tempted to skip, because it is the case where we have nothing helpful
 * to say. Saying nothing helpful is the correct outcome: the alternative is
 * the Sunnyside answer, which is not merely unhelpful but false.
 *
 * ## Why matching is on DISTINCTIVE tokens and never on the whole string
 *
 * Readers do not type canonical names. The registry calls it *Vail Unified
 * District*; a reader types *the Vail school district*, *Vail Unified*, *the
 * Vail school board*. Every one of those means the same government and none of
 * them is string-equal to it.
 *
 * What they share is the part that IDENTIFIES rather than CLASSIFIES. Strip
 * the civic vocabulary every district in the country shares — `district`,
 * `unified`, `school`, `board`, `county`, `city` — and *Vail Unified District*
 * reduces to `vail`. That token is the name. So an entity is a candidate when
 * **every one of its distinctive tokens appears in the question**, which is a
 * conservative test: it can fail to find a government the reader meant, and it
 * cannot find one the reader did not name.
 *
 * The generic tokens are then used for exactly one thing — **breaking ties
 * between candidates the distinctive tokens could not separate**. "Vail" alone
 * fits both `place:vail` and `school_district:vail_unified_district`, and the
 * words *school* and *district* in the reader's own question are evidence, not
 * inference, about which one they meant. Where that evidence does not separate
 * them, the answer is `AMBIGUOUS` and the reader is asked. Tie-or-zero, the
 * same discipline `matchExactName` and `matchDestination` already run on.
 *
 * Pure, deterministic and offline: same question plus same inventory, same
 * verdict. Nothing here generates a name, and nothing here reaches a model.
 */

/**
 * Civic vocabulary that CLASSIFIES a government rather than identifying one.
 *
 * Every token here is shared by many governments, so none of them can carry a
 * binding on its own — "district" identifies nothing. They are stripped to
 * find the distinctive part of a name, and then read back as tie-break
 * evidence.
 *
 * This list is deliberately about GOVERNMENT SHAPE and not about topics. A
 * word like "water" stays out: the Central Arizona Water Conservation District
 * is not distinguishable from other districts without it.
 */
export const GENERIC_CIVIC_TOKENS: ReadonlySet<string> = new Set([
  "the", "of", "and", "for", "a", "an", "at", "in", "on",
  "district", "districts", "unified", "elementary", "secondary", "regional",
  "school", "schools", "board", "boards", "governing", "trustees", "trustee",
  "county", "counties", "city", "cities", "town", "township", "borough",
  "village", "place", "municipal", "municipality", "council", "councils",
  "commission", "commissioners", "commissioner", "committee", "authority",
  "supervisors", "supervisor", "education", "select", "selectmen",
  /* Office-class words a body's OWN name carries once the sourced roster
   * names land (NH288). "Tucson Mayor & Council" and "Newbury Selectboard"
   * are the bodies' own names, and "mayor" and "selectboard" classify the
   * government's shape exactly as "council" and "select" + "board" already
   * do. Leaving them distinctive would demand them from a reader who types
   * "the tucson city council" — a partial name refused as no name at all —
   * which is the CAWCD "Board of Directors" lesson over again. */
  "mayor", "mayors", "selectboard",
  "department", "office", "bureau", "division", "public", "general",
  "body", "assembly", "court", "state", "united", "us",
  /* Membership words. A body's name often ends "... Board of Directors", and
   * no reader types that — "the Central Arizona Water Conservation District"
   * is the whole name as far as a person is concerned. Leaving these in as
   * distinctive made that body unbindable, because the reader's question could
   * never contain a token they would never say. */
  "directors", "director", "members", "member", "chair", "chairman",
]);

/**
 * Phrases that ANNOUNCE a government by class. Their job is to find the case
 * where a reader clearly named a government we do not hold — the `UNRESOLVED`
 * verdict — by giving us a place to look for the identifying word: whatever
 * sits immediately in front of the class phrase.
 *
 * Longest first, so "unified school district" is not claimed by "school
 * district" sitting inside it.
 */
export const CLASS_PHRASES: readonly string[] = [
  "unified school district",
  "board of supervisors",
  "board of education",
  "school district",
  "school board",
  "city council",
  "town council",
  "township committee",
  "borough council",
  "village board",
  "select board",
  "county board",
  "water district",
  "fire district",
  "library district",
  "planning commission",
  "governing board",
  "unified district",
];

/**
 * An entity this rung can bind, with the one extra fact that separates a
 * school district from a town of the same name: **what the government
 * actually is.**
 *
 * `divisionType` is optional because the caller may not know it, and a caller
 * that omits it loses only the class tie-break — it never changes a `BOUND`
 * into a wrong `BOUND`, only into an honest `AMBIGUOUS`.
 */
export interface BindableEntity extends NameableEntity {
  /** The registry's own division type — `school_district`, `place`, `county`. */
  divisionType?: string | null;
  /**
   * **WHICH LEVEL OF CIVIC IDENTITY THIS ROW'S `id` IS.** (2026-08-29.)
   *
   * `nameClass: "body"` was carrying this and could not: `lib/ask/inventory.ts`
   * stamped it onto rows whose `id` was a DIVISION, so the Ask pipeline called
   * a division a body and retrieval filtered meetings by geography. A reader
   * asking about the Pima County Board of Supervisors was given a Central
   * Arizona Water Conservation District event, because both are recorded
   * against the same county division.
   *
   * The distinction is TYPED rather than inferred, because inferring it is
   * exactly what failed. A caller that filters civic records on `id` must know
   * which id space it is in, and `"body"` answered a different question — what
   * KIND of thing a reader can name — which is why one field could not do both.
   *
   * Optional so that callers which genuinely bind at one level only
   * (`lib/ask/ballot-inventory.ts` mints contests, candidacies and measures;
   * `lib/routing/ask.ts` already binds on the registry's own `bodyId`) are
   * unchanged. A consumer that would substitute one level for the other must
   * check it and must fail honestly when it is absent — never fall back to the
   * division, which is the defect.
   */
  level?: "BODY" | "GOVERNMENT";
  /**
   * For a BODY, the division it SITS IN. An association, never an identity.
   *
   * Carried so a caller can report a body's geography and run the class
   * tie-break without ever having the division id to hand as `id`.
   */
  ocdId?: string | null;
}

/**
 * What class of government a reader's phrase is asking about.
 *
 * This is READING the reader's words, not inferring from them: someone who
 * types "school board" has said the government is a school district, and that
 * is why *"the Vail school board"* resolves to Vail Unified rather than to the
 * place called Vail. Where the question carries no class phrase, there is no
 * class evidence and the tie stands as `AMBIGUOUS`.
 */
export const CLASS_PHRASE_DIVISIONS: Readonly<Record<string, readonly string[]>> = {
  "unified school district": ["school_district"],
  "school district": ["school_district"],
  "school board": ["school_district"],
  "unified district": ["school_district"],
  "board of education": ["school_district"],
  "city council": ["place"],
  "town council": ["place"],
  "village board": ["place"],
  "borough council": ["place"],
  "township committee": ["place"],
  "select board": ["place"],
  "board of supervisors": ["county"],
  "county board": ["county"],
};

/** The class phrase this question uses, longest first, or null. */
export function classPhraseIn(text: string): string | null {
  const normalized = normalizeName(text);
  for (const phrase of CLASS_PHRASES) {
    if (normalized.includes(phrase)) return phrase;
  }
  return null;
}

/**
 * Ordinary words a reader uses to ASK, which can never on their own be the
 * name of the government they are asking about.
 *
 * This exists because of a body that is genuinely called **"Agenda
 * Committee"**. Strip its generic half and its whole identifying vocabulary is
 * the single word `agenda` — so the very first question this rung was built
 * for, *"What's on the Vail school district agenda?"*, bound to it. Not to
 * Vail, and not to Sunnyside: to a Tucson committee, because the reader had
 * used the word "agenda" to ask a question.
 *
 * That is the substitution defect all over again, arriving through the rung
 * built to stop it, and it is worth stating why: a matcher gets MORE dangerous
 * as it gets more capable, because a rung that can override the default can
 * override it wrongly. The general rule this encodes is that **a government
 * whose entire identifying vocabulary is ordinary question vocabulary cannot
 * be named unambiguously by a reader**, so this rung declines to bind it at
 * all rather than binding it on a coincidence.
 *
 * Declining is safe: such a body is still reachable by search, by its own
 * battlecard, and by the topic routing that was always going to answer. What
 * it may not do is capture a question by owning a common noun.
 */
export const COMMON_QUESTION_NOUNS: ReadonlySet<string> = new Set([
  // Contact/navigation labels do not name a person or government. A reader
  // asking how to contact an open official has not named "Contact Us".
  "contact", "contacts", "information",
  "agenda", "agendas", "docket", "calendar", "minutes", "record", "records",
  "document", "documents", "meeting", "meetings", "session", "hearing",
  "budget", "tax", "taxes", "vote", "votes", "voting", "election", "elections",
  "ballot", "policy", "policies", "ordinance", "resolution", "contract",
  "permit", "permits", "zoning", "rezoning", "housing", "development",
  "planning", "police", "fire", "water", "sewer", "trash", "recycling",
  "road", "roads", "street", "streets", "sidewalk", "park", "parks",
  "library", "libraries", "health", "transit", "transportation", "safety",
  "services", "service", "works", "utilities", "utility", "finance",
  "kid", "kids", "child", "children", "student", "students", "teacher",
  "house", "home", "neighborhood", "area", "district4", "news", "info",
]);

/**
 * **A NAME A READER COULD ACTUALLY HAVE TYPED.** (2026-08-29.)
 *
 * Nineteen of the seventy-eight bodies in the committed meetings corpus — very
 * nearly a quarter — carry a registry name that identifies NOTHING on its own:
 * seven called exactly *"Planning Board"*, four *"Budget Committee"*, three
 * *"Select Board"*, plus *"Zoning Board"*, *"Road Committee"*, *"Housing
 * Commission"* and Tucson's *"Planning Commission"*.
 *
 * `bindNamedEntity` declines those on purpose — that is the discipline
 * `COMMON_QUESTION_NOUNS` exists for, and it is what stopped a question about
 * Vail binding to a Tucson body called "Agenda Committee". The consequence was
 * that a reader typing *"the Warner Planning Board"* got AMBIGUOUS: honest, and
 * useless, about precisely the hyperlocal sitting this product exists to
 * surface.
 *
 * ## The rule, and why it is not "prefix everything"
 *
 * Qualify with the division's own SOURCED label, and only where the body's own
 * name carries no identifying token. Nothing is invented — "Warner" is the
 * registry's label for the division and the body genuinely is Warner's planning
 * board, so two sourced facts are stated together rather than a third one made
 * up.
 *
 * Prefixing unconditionally would be a REGRESSION, and the corpus holds the
 * case that proves it: the Central Arizona Water Conservation District is
 * recorded against the Pima County division and is a multi-county district that
 * is not Pima's. Qualifying it would demand the word "Pima" from a reader who
 * would never say it and make the body unreachable — one silent failure traded
 * for another. A body that already has its own name keeps it, untouched.
 *
 * **It lives here, beside the binder, because the test IS the binder's own skip
 * condition.** Both Ask paths need it — `lib/ask/inventory.ts` builds from the
 * meetings snapshot and `lib/routing/ask.ts` from the reader's covered bodies —
 * and two copies of a naming rule is how the two surfaces come to disagree
 * about which governments a reader can name (RULING 103).
 */
export function nameAReaderCanSay(
  name: string | null | undefined,
  divisionLabel: string | null | undefined,
): string {
  if (!name) return divisionLabel ?? "";
  if (!divisionLabel) return name;
  const distinctive = distinctiveTokens(name);
  const identifiesItself =
    distinctive.length > 0 && !distinctive.every((t) => COMMON_QUESTION_NOUNS.has(t));
  if (identifiesItself) return name;
  /* Already qualified — "Tucson Parks and Recreation Commission" must not
     become "Tucson Tucson Parks and Recreation Commission". */
  if (normalizeName(name).startsWith(normalizeName(divisionLabel))) return name;
  return `${divisionLabel} ${name}`;
}

export type NamedEntityBinding =
  /** No government was named. Context/ZIP default routing may apply. */
  | { kind: "NONE" }
  /** Exactly one government resolved. Retrieval binds to it. */
  | { kind: "BOUND"; entity: BindableEntity; matchedOn: string }
  /** The name fits more than one. The reader is asked; nothing is chosen. */
  | { kind: "AMBIGUOUS"; mention: string; candidates: BindableEntity[] }
  /** A government was named and we hold no such entity. Said, never swapped. */
  | { kind: "UNRESOLVED"; mention: string };

/** Words of a normalized string, empties dropped. */
function tokens(text: string): string[] {
  return normalizeName(text).split(" ").filter((t) => t.length > 0);
}

/**
 * The tokens of a name that IDENTIFY the government rather than classify it.
 *
 * Empty is a meaningful answer and not a failure: a body called "Governing
 * Board" or "Board of Supervisors" has no identifying token at all, and such a
 * body can never be bound by mention — a reader typing "the board of
 * supervisors" has not said WHICH one. Those entities are skipped rather than
 * matched loosely, which is the conservative direction.
 */
export function distinctiveTokens(name: string): string[] {
  return tokens(name).filter((t) => !GENERIC_CIVIC_TOKENS.has(t));
}

/**
 * The identifying word a reader put in front of a class phrase, if any.
 *
 * "what's on the vail school district agenda" -> "vail"
 * "what's on the school district agenda"      -> null   (only "the")
 * "who is on my school board"                 -> null   (only "my")
 *
 * Returning null for the second and third is the whole point: those questions
 * name no government, so the ZIP default is the correct and honest route for
 * them. Only a question that actually names one may block the default.
 */
export function mentionBeforeClassPhrase(text: string): string | null {
  const normalized = normalizeName(text);
  for (const phrase of CLASS_PHRASES) {
    const at = normalized.indexOf(phrase);
    if (at < 0) continue;
    const before = tokens(normalized.slice(0, at));
    /* Walk backwards over words that identify nothing — function words, the
     * civic vocabulary itself, and fragments — and take the first that does. */
    for (let i = before.length - 1; i >= 0; i--) {
      const token = before[i];
      if (GENERIC_CIVIC_TOKENS.has(token)) continue;
      if (NON_NAMING_WORDS.has(token)) continue;
      /*
       * A one- or two-character token is never a government's name. It is
       * overwhelmingly punctuation debris: `normalizeName` turns "what's" into
       * "what s", and that stray "s" sat directly in front of "school
       * district" in the commonest phrasing there is — so without this floor,
       * *"what's on the school district agenda?"* reported that a government
       * called "s" could not be resolved. The same floor `matchExactName`
       * already uses, for the same reason.
       */
      if (token.length < MIN_MENTION_CHARS) continue;
      return token;
    }
    return null;
  }
  return null;
}

/** The shortest token that could be a government's name. */
export const MIN_MENTION_CHARS = 3;

/**
 * Words that can sit in front of a class phrase without naming anything.
 *
 * Interrogatives and auxiliaries are the ones that matter, because a question
 * BEGINS with them: *"who is on my school board"* walks back past "my", "on"
 * and "is" to reach "who", and reporting that a government called "who" could
 * not be resolved is exactly the kind of confident nonsense this module exists
 * to prevent. A reader asking that named nobody, and the ZIP default is the
 * right answer for them.
 */
const NON_NAMING_WORDS: ReadonlySet<string> = new Set([
  /* reader-relative */
  "my", "our", "your", "their", "its", "this", "that", "these", "those",
  "local", "here", "nearby", "me", "we", "you", "they", "own",
  /* interrogative and relative */
  "who", "what", "whats", "when", "where", "which", "why", "how", "whose",
  /* auxiliary and copula */
  "is", "are", "was", "were", "be", "been", "am", "do", "does", "did",
  "can", "could", "will", "would", "should", "has", "have", "had", "may",
  /* common verbs and adverbs in these questions */
  "next", "upcoming", "any", "all", "some", "about", "regarding", "meet",
  "meets", "meeting", "happening", "going", "coming", "discussing", "run",
  "runs", "sits", "sit", "serve", "serves", "tell", "show", "find", "get",
]);

/**
 * Resolve the government the reader named, against what this product holds.
 *
 * `entities` is the inventory the caller can actually answer about. A smaller
 * inventory produces `UNRESOLVED` where a larger one would produce `BOUND` —
 * and that is the correct degradation, because `UNRESOLVED` says something
 * true about US ("we did not find that one") while the alternative the defect
 * shipped said something false about a GOVERNMENT.
 */
export function bindNamedEntity(
  text: string,
  entities: readonly BindableEntity[],
): NamedEntityBinding {
  const questionTokens = new Set(tokens(text));
  if (questionTokens.size === 0) return { kind: "NONE" };

  /* The class the reader named, if they named one. Evidence for the tie-break
   * below, and null for the many questions that carry no class phrase. */
  const phrase = classPhraseIn(text);
  const wantedDivisions = phrase ? CLASS_PHRASE_DIVISIONS[phrase] ?? [] : [];

  type Scored = {
    entity: BindableEntity;
    distinctive: number;
    classMatch: number;
    generic: number;
  };
  const scored: Scored[] = [];

  for (const entity of entities) {
    const distinctive = distinctiveTokens(entity.name);
    /* No identifying token — this entity cannot be named, only described. */
    if (distinctive.length === 0) continue;
    /*
     * At least one identifying token has to be a word a reader would only use
     * to NAME this government. "Agenda Committee" fails here and must: see
     * COMMON_QUESTION_NOUNS for the question that bound to it.
     */
    if (distinctive.every((t) => COMMON_QUESTION_NOUNS.has(t))) continue;
    /* EVERY identifying token must be present. A partial name is not a name. */
    if (!distinctive.every((t) => questionTokens.has(t))) continue;

    /* Generic overlap is TIE-BREAK EVIDENCE ONLY, read off the reader's own
     * words: "school" and "district" in the question are why a school district
     * beats a place of the same name. It never creates a candidate. */
    const generic = tokens(entity.name).filter(
      (t) => GENERIC_CIVIC_TOKENS.has(t) && questionTokens.has(t),
    ).length;

    /* The reader said what KIND of government this is, and this entity is that
     * kind. Read off their words and the registry's own division type — no
     * inference, and worth more than an incidental shared word like "district". */
    const classMatch =
      entity.divisionType && wantedDivisions.includes(entity.divisionType) ? 1 : 0;

    scored.push({ entity, distinctive: distinctive.length, classMatch, generic });
  }

  if (scored.length === 0) {
    /* Nothing matched. Did the reader nonetheless NAME a government? If so the
     * honest answer is that the name did not resolve — never the default. */
    const mention = mentionBeforeClassPhrase(text);
    return mention ? { kind: "UNRESOLVED", mention } : { kind: "NONE" };
  }

  /* More identifying tokens first — "Rockaway Township" beats "Rockaway" for a
   * question that said both. Generic overlap separates what remains. */
  const rank = (s: Scored) =>
    s.distinctive * 1000 + s.classMatch * 100 + s.generic;
  const best = Math.max(...scored.map(rank));
  const top = scored.filter((s) => rank(s) === best);

  /* The same government arriving twice (the index can carry a body under more
   * than one venue) is not a tie. Distinct ids are. */
  const distinctIds = new Set(top.map((t) => t.entity.id));
  if (distinctIds.size > 1) {
    return {
      kind: "AMBIGUOUS",
      mention: top[0].entity.name,
      candidates: top.map((t) => t.entity),
    };
  }

  return {
    kind: "BOUND",
    entity: top[0].entity,
    matchedOn: distinctiveTokens(top[0].entity.name).join(" "),
  };
}

/**
 * Did the reader name a government? True for every verdict except `NONE`.
 *
 * The single predicate callers use to decide whether a ZIP default is still
 * allowed to speak, so no surface can implement its own slightly different
 * version of the rule this module exists to enforce.
 */
export function namedAnEntity(binding: NamedEntityBinding): boolean {
  return binding.kind !== "NONE";
}

/**
 * **IS THIS READER ASKING WHAT A NAMED GOVERNMENT IS ABOUT TO DISCUSS?**
 * (2026-08-27.)
 *
 * The question that opened this whole session — *"What's on the Vail school
 * district agenda?"* — has never reached the agenda corpus at all, and the
 * entity binding did not change that. `/api/ask/agenda` answers a TOPIC within
 * a scope ("is there a data centre coming"), and `agendaTopicFor` returns null
 * for a question that names a body and asks what is on ITS agenda. So the
 * question fell through to topic routing, which names bodies rather than
 * agenda items — while the corpus held eleven Vail meetings and nine readable
 * agendas.
 *
 * Two independent things were wrong and only one of them was the substitution.
 * This is the other: **the product could not tell that the reader was asking
 * about a specific government's docket.**
 *
 * The detector is deliberately about the SHAPE of the asking rather than about
 * any subject. It carries no topic vocabulary, because the reader is not asking
 * about a topic — they are asking what this body has scheduled to talk about,
 * and the answer is the body's own item list rather than a keyword search.
 */
export const BODY_AGENDA_PHRASES: readonly string[] = [
  "on the agenda",
  "on their agenda",
  "on its agenda",
  "agenda for",
  "what is on the agenda",
  "whats on the agenda",
  "what are they discussing",
  "what is being discussed",
  "what will they discuss",
  "what did they discuss",
  "what are they talking about",
  "what is happening at the next meeting",
  "what happens at the next meeting",
  "next meeting about",
  "what is on the docket",
  "whats on the docket",
];

/**
 * True when the question asks what a body has scheduled to discuss.
 *
 * `agenda` and `docket` as bare nouns are enough on their own — a reader who
 * types either about a named government is asking this and nothing else — and
 * the phrase list carries the shapes that do not use either word.
 */
export function asksForBodyAgenda(text: string): boolean {
  const normalized = normalizeName(text);
  if (/\b(agenda|agendas|docket)\b/.test(normalized)) return true;
  /*
   * The bare verbs, which is what *"what is Vail discussing"* is made of.
   *
   * They can be generous because this detector is never consulted alone: the
   * body-agenda path runs only where a government is already BOUND, so a false
   * positive with no bound entity does nothing at all. The cost of missing a
   * phrasing is a reader who gets no agenda; the cost of an extra phrasing is
   * nothing.
   */
  if (/\b(discussing|discuss|discussed)\b/.test(normalized)) return true;
  return BODY_AGENDA_PHRASES.some((p) => normalized.includes(p));
}
