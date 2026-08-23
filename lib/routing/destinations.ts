/**
 * THE FOUR IN-APP DESTINATIONS THE ASK BOX CAN ROUTE TO (G05 rule 4d,
 * 2026-08-17).
 *
 * ## Why this module exists at all
 *
 * Rule 4d's gate is one sentence and it is the reason this is built before
 * any of the copy: *"the copy may only promise what the router can route, so
 * extend the classifier to cover ballot, meetings, districts and contact
 * BEFORE the copy claims them."* Today the router knows exactly one kind of
 * answer — a `TopicRoute`, which names the OFFICE that owns a problem. A
 * reader asking "what's on my ballot" is not asking who owns a problem; they
 * are asking to be taken somewhere this product already has.
 *
 * So there is a second kind of answer: a DESTINATION, an in-app surface the
 * reader is pointed at by name. Four of them, exactly the four rule 4d names,
 * and not a fifth — a category that cannot be routed is not named in the copy
 * and the gap is a row.
 *
 * ## What it is emphatically NOT
 *
 * It generates nothing. A destination is a fixed row in this file with a
 * curated label and a curated sentence, pointing at a surface that already
 * exists in the app. Matching is the same mechanical, reviewable, hit-count
 * method the topic matcher uses, so what matches is exactly what a reader of
 * this file can predict. A destination that named a surface the app does not
 * have would be the copy promising what the router cannot route, one layer
 * down — `tests/ask-destinations.test.ts` asserts every `surface` here is a
 * real route in `app/`.
 *
 * ## Why destinations are matched on PHRASES and topics on words
 *
 * The two vocabularies genuinely overlap: "ballot" is already a keyword of
 * `elections-voting`, whose answer — how to register, who runs elections — is
 * the RIGHT answer to "how do I vote" and the wrong one to "what's on my
 * ballot". A single word cannot separate them, so it is not asked to. A
 * destination matches only on a multi-word phrase that carries an intent to
 * BE somewhere ("what's on my ballot", "when is the next meeting"), and every
 * single-word case falls through to the topic matcher exactly as it does
 * today. That ordering is deliberate and is asserted: extending the router
 * must not silently re-route questions that already had a good answer.
 */

/** The in-app surfaces a destination may point at. Closed on purpose. */
export type DestinationSurface = "BALLOT" | "MEETINGS" | "DISTRICTS" | "CONTACT";

/**
 * **ASK-1 (2026-08-23): a destination that opens IN PLACE still has to be
 * tappable.**
 *
 * Three of the four destinations carried `href: null`, meaning "a surface that
 * opens in place" — and the ask box renders its link only when `href` is set.
 * So *"when is the next meeting?"* returned a heading, a label and a sentence
 * explaining that the map shows collected meetings, **with nothing for the
 * reader to click or tap.** The reader was told where to look and then left to
 * find it, which is the reader-friction rule's definition of a defect: an
 * unnecessary step between a reader and the answer they came for.
 *
 * An in-place destination now names the UI action that opens it, so the box can
 * render a real control. These are the SAME actions the map's own stats bar
 * dispatches (`components/shell/stats-bar.tsx`) — the ask box opens the door the
 * reader would otherwise have gone and found, rather than a second way in that
 * can drift from the first.
 */
export type DestinationAction =
  | { readonly kind: "LIST_OPEN" }
  | { readonly kind: "DOOR_OPEN"; readonly door: "bodies" | "districts" | "officials" };

export interface DestinationRoute {
  id: string;
  surface: DestinationSurface;
  /** What the reader is being offered, in their words, not ours. */
  label: string;
  /**
   * The level sentence rendered with the offer. It describes what is THERE,
   * and it never promises completeness — the coverage gaps each surface
   * already states stay that surface's job to state.
   */
  statement: string;
  /** The in-app route, or null for a surface that opens in place. */
  href: string | null;
  /**
   * The UI action that opens this surface in place. Exactly one of `href` and
   * `action` is set — a destination with neither is a heading with nothing to
   * tap, which is the ASK-1 defect, and `tests/ask-destinations.test.ts`
   * refuses one.
   */
  action: DestinationAction | null;
  /**
   * Phrases that route here. Multi-word ONLY — see the header. Each is
   * matched whole, against normalized text, exactly as the topic matcher
   * matches its examples.
   */
  phrases: readonly string[];
}

export const DESTINATION_ROUTES: readonly DestinationRoute[] = [
  {
    id: "ballot",
    surface: "BALLOT",
    label: "What's on your ballot",
    statement:
      // RULING 59 (2026-08-21). The second sentence used to read "Where we
      // have not found something, it says so rather than leaving it out." It
      // was banned twice: it characterises what has not been worked out, and
      // it had ALSO been false since RULING 28, which says a field with no
      // data renders nothing at all — no row, no label, no placeholder. The
      // page stopped saying so a day before this sentence stopped claiming it
      // did.
      "The ballot page lists the contests and measures we have found for the address you give it, each one sourced.",
    href: "/ballot",
    action: null,
    phrases: [
      "on my ballot",
      "on the ballot",
      "whats on my ballot",
      "what is on my ballot",
      "my ballot",
      "see my ballot",
      "sample ballot",
      "who is running",
      "whos running",
      "who is on the ballot",
      "candidates in my area",
      "what am i voting on",
      "what are we voting on",
    ],
  },
  {
    id: "meetings",
    surface: "MEETINGS",
    label: "Meetings near you",
    statement:
      "The map shows the upcoming meetings and hearings we have collected around you, with the date, the body and where it sits. Each one says when we last checked it.",
    href: null,
    action: { kind: "LIST_OPEN" },
    phrases: [
      "next meeting",
      "upcoming meetings",
      "when is the meeting",
      "when is the next meeting",
      "meetings near me",
      "meeting schedule",
      "public hearing",
      "public hearings",
      "when do they meet",
      "when does the council meet",
      "when does the board meet",
      "council meeting",
      "board meeting",
      "town meeting",
    ],
  },
  {
    id: "districts",
    surface: "DISTRICTS",
    label: "The districts you are in",
    statement:
      "A zip is not a district — it crosses them. The districts view draws the boundaries over your area and names the ones the map is currently showing.",
    href: null,
    action: { kind: "DOOR_OPEN", door: "districts" },
    phrases: [
      "what district am i in",
      "which district am i in",
      "what districts am i in",
      "my district",
      "my districts",
      "what district is this",
      "districts near me",
      "district boundaries",
      "who represents me",
      "who is my representative",
      "who are my representatives",
    ],
  },
  {
    id: "contact",
    surface: "CONTACT",
    label: "How to reach them",
    statement:
      "Open any official on the map to see the contact details their own office publishes — a phone number, an office address, or the form they ask you to use. We only list what they have published.",
    href: null,
    action: { kind: "DOOR_OPEN", door: "officials" },
    phrases: [
      "how do i contact",
      "how do i reach",
      "phone number for",
      "email address for",
      "contact information",
      "contact details",
      "get in touch with",
      "how to contact them",
      "how do i talk to",
    ],
  },
];

export interface DestinationMatch {
  destination: DestinationRoute;
  /** The phrase that carried it — mechanical evidence, same as a topic's. */
  matchedOn: string[];
}

function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize("NFD")
    // Combining marks, stripped so "qué" and "que" normalize alike.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * The best destination for a question, or null — a refusal, never a guess.
 *
 * The longest matching phrase wins, because a longer phrase is strictly more
 * evidence: "who is on the ballot" should not be decided by a tie between
 * itself and "on the ballot". A tie between DIFFERENT destinations at the
 * same length refuses, exactly as a topic tie does — two equally plausible
 * places to send someone means the question did not say which.
 */
export function matchDestination(text: string): DestinationMatch | null {
  const normalized = normalize(text);
  if (normalized.trim().length === 0) return null;

  let best: DestinationMatch | null = null;
  let bestLength = 0;
  let tied = false;

  for (const destination of DESTINATION_ROUTES) {
    const hits: string[] = [];
    for (const phrase of destination.phrases) {
      const needle = ` ${normalize(phrase).trim()} `;
      if (normalized.includes(needle)) hits.push(phrase);
    }
    if (hits.length === 0) continue;

    const longest = Math.max(...hits.map((h) => h.length));
    if (longest > bestLength) {
      best = { destination, matchedOn: [...new Set(hits)] };
      bestLength = longest;
      tied = false;
    } else if (longest === bestLength && best && best.destination.id !== destination.id) {
      tied = true;
    }
  }

  return tied ? null : best;
}

/**
 * The categories the ask copy is ALLOWED to name, derived from what actually
 * routes rather than written out beside it.
 *
 * This is rule 4d's gate expressed as code: the copy reads its promises from
 * here, so a category cannot appear in the placeholder or the explainer
 * unless a route for it exists in this file. Removing a destination removes
 * its promise in the same edit — which is the only way the two stay true to
 * each other.
 */
export const ROUTABLE_CATEGORIES: readonly string[] = DESTINATION_ROUTES.map(
  (d) => d.label,
);
