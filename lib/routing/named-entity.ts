import { normalizeName, type NameableEntity } from "./exact-name.ts";

/**
 * The named-entity binding rung: a context default may never override an entity the reader named.
 *
 * It reads the question for a government the reader named, reconciles that name against entities this
 * product holds, and returns one of four verdicts. It never picks a government:
 *
 * | verdict      | what it means                          | what the caller owes the reader |
 * |--------------|----------------------------------------|---------------------------------|
 * | `NONE`       | no government named                    | the ZIP default may apply       |
 * | `BOUND`      | exactly one resolved                   | constrain retrieval to it       |
 * | `AMBIGUOUS`  | the name fits more than one            | ask which; never choose         |
 * | `UNRESOLVED` | a government was named, we hold no such | say the name did not resolve    |
 *
 * Matching is on distinctive tokens: strip the civic vocabulary every government shares and an entity is
 * a candidate when every remaining token appears in the question. Generic tokens only break ties
 * between candidates; where they cannot, the answer is `AMBIGUOUS`. Pure, deterministic and offline.
 */

/**
 * Civic vocabulary that classifies a government rather than identifying one. Stripped to find the
 * distinctive part of a name, then read back as tie-break evidence. About government shape, not topics.
 */
export const GENERIC_CIVIC_TOKENS: ReadonlySet<string> = new Set([
  "the", "of", "and", "for", "a", "an", "at", "in", "on",
  "district", "districts", "unified", "elementary", "secondary", "regional",
  "school", "schools", "board", "boards", "governing", "trustees", "trustee",
  "county", "counties", "city", "cities", "town", "township", "borough",
  "village", "place", "municipal", "municipality", "council", "councils",
  "commission", "commissioners", "commissioner", "committee", "authority",
  "supervisors", "supervisor", "education", "select", "selectmen",
  // Office-class words a body's own name carries ("Mayor & Council", "Selectboard"); a reader typing
  // "the city council" should not be required to say them.
  "mayor", "mayors", "selectboard",
  "department", "office", "bureau", "division", "public", "general",
  "body", "assembly", "court", "state", "united", "us",
  // Membership words: no reader types a body's "... Board of Directors" suffix.
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
  /** Previously published identifiers of this same entity, for explicit context references. */
  aliases?: readonly string[];
  /** The registry's own division type — `school_district`, `place`, `county`. */
  divisionType?: string | null;
  /**
   * Which level of civic identity this row's `id` is, typed rather than inferred. A caller that filters
   * civic records on `id` must know which id space it is in, and must fail honestly when this is absent,
   * never fall back to the division.
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
 * What class of government a reader's phrase is asking about, read from their words ("school board"
 * means a school district). With no class phrase, the tie stands as `AMBIGUOUS`.
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
 * Ordinary words a reader uses to ask, which can never on their own name a government. A government
 * whose entire identifying vocabulary is ordinary question vocabulary cannot be named unambiguously, so
 * this rung declines to bind it. Such a body is still reachable by search, its own card and topic
 * routing.
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
 * A name a reader could actually have typed. A body whose own name identifies nothing ("Planning
 * Board") is qualified with its division's sourced label; a body with its own identifying name keeps it
 * untouched. Shared by both Ask paths so they agree on which governments a reader can name.
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
  // Already qualified: never repeat the division label.
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
      // A one- or two-character token is never a government's name (e.g. the stray "s" from "what's").
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
 * A topic word is not a body's name. True for a name whose only identification besides common question
 * nouns is a leading place qualifier; such a body binds only when the reader also used one of its own
 * class words (`bodyClassWords`).
 */
function namedOnlyByPlaceAndTopic(name: string): boolean {
  const all = tokens(name);
  const firstTopic = all.findIndex((t) => !GENERIC_CIVIC_TOKENS.has(t) && COMMON_QUESTION_NOUNS.has(t));
  if (firstTopic <= 0) return false;
  return all.every((t, i) => i < firstTopic || GENERIC_CIVIC_TOKENS.has(t) || COMMON_QUESTION_NOUNS.has(t));
}

/** Generic words that say nothing about what KIND of body this is. */
const NOT_A_BODY_CLASS_WORD: ReadonlySet<string> = new Set([
  "the", "of", "and", "for", "a", "an", "at", "in", "on",
  "public", "general", "state", "united", "us",
  /* place classes belong to the qualifier, not to the body */
  "county", "counties", "city", "cities", "town", "township", "borough",
  "village", "place", "municipal", "municipality",
]);

/** The words in a body's own name that say what kind of body it is: "authority", "board", "commission". */
function bodyClassWords(name: string): string[] {
  return tokens(name).filter((t) => GENERIC_CIVIC_TOKENS.has(t) && !NOT_A_BODY_CLASS_WORD.has(t));
}

/**
 * Resolve the government the reader named, against what this product holds. A smaller inventory
 * produces `UNRESOLVED` where a larger one would produce `BOUND`: a true statement about our record.
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
    // At least one identifying token must be a word a reader would only use to name this government (see
    // COMMON_QUESTION_NOUNS).
    if (distinctive.every((t) => COMMON_QUESTION_NOUNS.has(t))) continue;
    /* EVERY identifying token must be present. A partial name is not a name. */
    if (!distinctive.every((t) => questionTokens.has(t))) continue;
    /* A place word and a topic word are not this body's name unless the reader
     * also said what kind of body it is. See `namedOnlyByPlaceAndTopic`. */
    if (entity.nameClass !== "person" && namedOnlyByPlaceAndTopic(entity.name)) {
      const classWords = bodyClassWords(entity.name);
      if (classWords.length > 0 && !classWords.some((t) => questionTokens.has(t))) continue;
    }

    /* Generic overlap is TIE-BREAK EVIDENCE ONLY, read off the reader's own
     * words: "school" and "district" in the question are why a school district
     * beats a place of the same name. It never creates a candidate. */
    const generic = tokens(entity.name).filter(
      (t) => GENERIC_CIVIC_TOKENS.has(t) && questionTokens.has(t),
    ).length;

    // The reader said what kind of government this is, and this entity is that kind: read off their words
    // and the registry's own division type.
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

  // More identifying tokens first; generic overlap separates what remains.
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
 * Is this reader asking what a named government is about to discuss? About the shape of the asking,
 * not a subject: the answer is the body's own item list, not a keyword search.
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
  // The bare verbs. Generous because this detector runs only where a government is already BOUND.
  if (/\b(discussing|discuss|discussed)\b/.test(normalized)) return true;
  return BODY_AGENDA_PHRASES.some((p) => normalized.includes(p));
}
