/**
 * The in-app destinations the ask box can route to. A destination is a fixed row with a curated label
 * and sentence pointing at a surface that already exists (`tests/ask-destinations.test.ts` asserts each
 * is a real route); nothing is generated. The ask copy may only promise what the router can route.
 *
 * Destinations match only on multi-word phrases that carry an intent to be somewhere ("what's on my
 * ballot"); single words fall through to the topic matcher, so extending the router never re-routes
 * questions that already had a good answer.
 */

/** The in-app surfaces a destination may point at. Closed on purpose. */
export type DestinationSurface = "BALLOT" | "MEETINGS" | "DISTRICTS" | "CONTACT";

/**
 * An in-place destination names the UI action that opens it, so the box can render a real control.
 * These are the same actions the map's stats bar dispatches (`components/shell/stats-bar.tsx`).
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
   * The UI action that opens this surface in place. Exactly one of `href` and `action` is set;
   * `tests/ask-destinations.test.ts` refuses a destination with neither.
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
 * The categories the ask copy is allowed to name, derived from what actually routes, so removing a
 * destination removes its promise in the same edit.
 */
export const ROUTABLE_CATEGORIES: readonly string[] = DESTINATION_ROUTES.map(
  (d) => d.label,
);
