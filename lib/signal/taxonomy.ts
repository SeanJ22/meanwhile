/**
 * **WHAT EVERY LIVE COLLECTION POINT ACTUALLY MEANS.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * ## The invariant this file exists for
 *
 * ```
 *   ATTENTION  !=  SENTIMENT
 * ```
 *
 * Opening Katie Hobbs's card does not mean supporting Katie Hobbs. Reading a
 * measure does not imply a position on it. Asking what a school board is
 * discussing is not approval of the school board. Those are the three most
 * commercially tempting inferences this product could make and all three are
 * false — and the reason to state them mechanically rather than in prose is
 * that the collapse never happens deliberately. It happens when somebody writes
 * one aggregate over two stores because both rows have an `ocdIds` column.
 *
 * The stores are already separate and their value spaces already do not join
 * (`lib/db/identity-domains.ts` proves that per column). What was missing was
 * a statement of what each EVENT means, in a form an export path has to read
 * rather than remember. A store boundary stops a join; it does not stop a
 * sentence.
 *
 * ## The inventory, as of 2026-08-28
 *
 * Every live collection point in the product, and there are four stores:
 *
 * | store | what it holds | class |
 * | --- | --- | --- |
 * | `search_log` | SEARCH, BODY_OPENED, MEETING_OPENED, OFFICIAL_OPENED, DISTRICT_SELECTED, FILTER_APPLIED, QUESTION_ASKED | attention, demand, product failure |
 * | `reactions` | a reader's YES/NO on a vote, candidate, funding total, contributor or measure provision | EXPLICIT SENTIMENT |
 * | `speak_your_mind` | verbatim constituent text, moderated, its own PII posture | EXPLICIT SENTIMENT |
 * | `ask_interactions` | the grounded Ask row — **built, wired, NOT RUNNING** | information demand |
 *
 * ## What is NOT here, stated rather than implied
 *
 * There is **no engagement score** and this file is the reason there cannot
 * quietly be one: a score is a single number over classes that mean different
 * things, and producing it requires exactly the collapse `sameClass` refuses.
 *
 * There is no ACTION INTENT store. Contact links on a battlecard are ordinary
 * anchors and nothing records a click on them; a reader who emails their board
 * president does so with no row written anywhere. That is a real gap in the
 * taxonomy the author named, and it is recorded as a gap rather than as a
 * capability — the honest answer to "what does the product hold about action
 * intent" is *nothing*.
 */

/**
 * What a collected event MEANS. The classes are deliberately about the
 * reader's act rather than about the surface it happened on: two events on one
 * page can mean entirely different things, and the page is not the fact.
 */
export type SignalClass =
  /** They looked at something. It implies NOTHING about approval. */
  | "ATTENTION"
  /** They asked for information. Demand, and a map of what the product owes. */
  | "INFORMATION_DEMAND"
  /** They stated a position, deliberately, in a control built to take one. */
  | "EXPLICIT_SENTIMENT"
  /** They went to a primary source — a deeper read of the same attention. */
  | "SOURCE_DEPTH"
  /** They told us where they are, or where they are going. */
  | "DECLARED_LOCATION"
  /** We asked something and could not answer. The roadmap. */
  | "UNMET_DEMAND"
  /** How the product was narrowed — a preference about the tool, not the topic. */
  | "PRODUCT_PREFERENCE";

export interface SignalPoint {
  /** The store the row lands in. */
  store: "search_log" | "reactions" | "speak_your_mind" | "ask_interactions" | "none";
  /** The event, as the store names it. */
  event: string;
  signalClass: SignalClass;
  /** What a buyer-facing sentence may say this row means. */
  means: string;
  /** What it may NEVER be read as. The half that gets forgotten. */
  neverMeans: string;
  /** True where the product does not yet collect this at all. */
  notCollected?: boolean;
}

/**
 * The live inventory.
 *
 * Every entry is a collection point that EXISTS, except the ones marked
 * `notCollected`, which are named because the author's taxonomy asks about them
 * and the honest answer is that nothing is recorded. A taxonomy that silently
 * omitted them would read as coverage.
 */
export const SIGNAL_POINTS: readonly SignalPoint[] = [
  /* ── search_log ─────────────────────────────────────────────────────── */
  {
    store: "search_log",
    event: "SEARCH",
    signalClass: "ATTENTION",
    means: "a reader typed something into the unified input and picked a result",
    neverMeans: "an opinion about what they found",
  },
  {
    store: "search_log",
    event: "BODY_OPENED",
    signalClass: "ATTENTION",
    means: "a reader opened this government's card",
    neverMeans: "support for, trust in, or opposition to that government",
  },
  {
    store: "search_log",
    event: "MEETING_OPENED",
    signalClass: "ATTENTION",
    means: "a reader opened this sitting",
    neverMeans: "an intention to attend it, or a view about it",
  },
  {
    store: "search_log",
    event: "OFFICIAL_OPENED",
    signalClass: "ATTENTION",
    means: "a reader opened this person's card",
    neverMeans:
      "support for that person. This is the single most tempting false inference in the product and the one the author named by example.",
  },
  {
    store: "search_log",
    event: "DISTRICT_SELECTED",
    signalClass: "ATTENTION",
    means: "a reader clicked a district on the map",
    neverMeans: "that they live in it — the map is clickable anywhere",
  },
  {
    store: "search_log",
    event: "FILTER_APPLIED",
    signalClass: "PRODUCT_PREFERENCE",
    means: "a reader narrowed what the product showed them",
    neverMeans: "a civic preference. It is a fact about the tool, not the topic.",
  },
  {
    store: "search_log",
    event: "QUESTION_ASKED",
    signalClass: "INFORMATION_DEMAND",
    means: "a reader asked a question; a routed row carries the topic id, a refusal carries the capped text",
    neverMeans: "a position on the subject of the question",
  },
  {
    store: "search_log",
    event: "QUESTION_ASKED · NO_ROUTE",
    signalClass: "UNMET_DEMAND",
    means: "a reader asked something this product could not answer — the roadmap, in their own words",
    neverMeans: "that no answer exists. It is a fact about US.",
  },

  /* ── reactions ──────────────────────────────────────────────────────── */
  {
    store: "reactions",
    event: "REACTION",
    signalClass: "EXPLICIT_SENTIMENT",
    means:
      "a reader used a control built to take a position and took one, on a vote, a candidate, a funding total, a contributor or a measure provision",
    neverMeans:
      "anything about readers who did not react. A reaction store's denominator is the people who chose to speak.",
  },

  /* ── speak_your_mind ────────────────────────────────────────────────── */
  {
    store: "speak_your_mind",
    event: "SPEAK",
    signalClass: "EXPLICIT_SENTIMENT",
    means: "a constituent wrote something, deliberately, in their own words",
    neverMeans:
      "the same thing as a reaction. It is stronger, it is verbatim, and it carries its own PII posture, moderation queue, disclosure, continuity namespace and export rules (RULING 141). It is never folded into a reaction count.",
  },

  /* ── ask_interactions — BUILT, WIRED, NOT RUNNING ───────────────────── */
  {
    store: "ask_interactions",
    event: "ASK",
    signalClass: "INFORMATION_DEMAND",
    means:
      "what a constituent asked, what it resolved to, and the answer they received — with the evidence that supported it",
    neverMeans:
      "a position. A reader asking what a candidate has done has told us what they want to know and nothing about what they think.",
  },
  {
    store: "ask_interactions",
    event: "ASK · CLARIFY or UNRESOLVED or NO_EVIDENCE",
    signalClass: "UNMET_DEMAND",
    means: "a constituent asked something the corpus could not answer — commercially the most valuable row here",
    neverMeans: "that the government publishes nothing",
  },
  {
    store: "ask_interactions",
    event: "ASK · location stamp",
    signalClass: "DECLARED_LOCATION",
    means:
      "what the reader DID to give us a location, turned into what it proves by `stampResidency` — a typed ZIP is a self-declared home ZIP, a demonstration chip is browsing, a device fix is presence",
    neverMeans:
      "residency in any district that ZIP merely overlaps. `zipCohortOnly` is the mechanical gate.",
  },

  /* ── NOT COLLECTED, and named so the gap is visible ─────────────────── */
  {
    store: "none",
    event: "CONTACT_CLICKED",
    signalClass: "ATTENTION",
    means: "nothing — an email, phone or contact-form link is an ordinary anchor and no row is written",
    neverMeans: "that readers are not contacting anybody. We simply do not know.",
    notCollected: true,
  },
  {
    store: "none",
    event: "SOURCE_OPENED",
    signalClass: "SOURCE_DEPTH",
    means:
      "nothing — a reader following a citation to an agenda, a canvass or a filing leaves through a plain link and writes no row",
    neverMeans: "that citations go unread",
    notCollected: true,
  },
  {
    store: "none",
    event: "MEETING_JOIN",
    signalClass: "ATTENTION",
    means: "nothing — an online-meeting link is an ordinary anchor",
    neverMeans: "that nobody attends",
    notCollected: true,
  },
];

/**
 * **MAY THESE TWO EVENTS BE COUNTED IN ONE NUMBER?**
 *
 * Only when they mean the same kind of thing. This is the mechanical form of
 * the author's invariant, and it is a function rather than a convention because
 * a convention is re-derived by every export path and one of them gets it
 * wrong.
 *
 * The failure it prevents is not exotic. It is one `UNION ALL` between
 * `search_log` and `reactions` written by somebody who noticed that both tables
 * carry `ocd_ids` and `occurred_at`, producing a number that would be described
 * to a buyer as engagement and read by them as support.
 */
export function sameClass(a: string, b: string): boolean {
  const left = classOf(a);
  const right = classOf(b);
  return left !== null && left === right;
}

/** The class of one event, or null where the event is not in the inventory. */
export function classOf(event: string): SignalClass | null {
  return SIGNAL_POINTS.find((p) => p.event === event)?.signalClass ?? null;
}

/**
 * **IS THIS A POSITION A READER TOOK?**
 *
 * The one predicate a buyer-facing sentence about opinion may be built on. It
 * is true for exactly two events, both of which are controls a reader used
 * deliberately to say something — and false for every act of looking, however
 * many times they looked.
 */
export function isSentiment(event: string): boolean {
  return classOf(event) === "EXPLICIT_SENTIMENT";
}

/** Every collection point the product does NOT have. Named, never implied. */
export function notCollected(): readonly SignalPoint[] {
  return SIGNAL_POINTS.filter((p) => p.notCollected === true);
}
