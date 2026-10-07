import { TOPIC_ROUTES } from "./topics.ts";

/**
 * Keyword → topic matching for the ask box. No generation: a question lands in a curated topic by
 * keyword evidence or is refused. Mechanical and deterministic: the highest hit count wins; a tie or zero
 * refuses. Keywords are listed out per topic rather than stemmed by code, so what matches is exactly
 * what a reviewer can read here.
 */

const TOPIC_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "schools-operations": [
    "teacher", "teachers", "principal", "bus", "buses", "superintendent",
    "classroom", "grades", "bullying",
    // The possessive marks the reader's own child: a running-the-school question, not a policy one.
    "kid", "kids",
  ],
  "schools-policy": [
    "curriculum", "closing", "boundaries", "build", "building", "built",
    "construction", "opening", "calendar",
    // Phrases, not the bare word "start", which would route other questions to the school board. Each
    // already contains the anchor, so a hit here is a second distinct hit. Routes to policy because the
    // school calendar is adopted by the board.
    "school start", "school starts", "school starting",
    "school year", "school calendar", "first day of school",
    "school begin", "school begins",
  ],
  libraries: ["library", "libraries", "librarian"],
  "zoning-development": [
    "zoning", "rezoning", "rezone", "development", "developer", "warehouse",
    "apartments", "subdivision", "permit",
  ],
  "roads-local": [
    "pothole", "potholes", "road", "roads", "street", "streets", "speeding",
    "crosswalk", "streetlight", "streetlights", "sidewalk", "traffic",
    "bike", "bike lane", "bicycle",
  ],
  "trash-recycling": [
    "trash", "garbage", "recycling", "recycle", "pickup", "dumpster",
    "litter", "dumping", "bulk",
  ],
  "water-sewer": [
    "water", "sewer", "sewage", "leak", "hydrant", "drain", "drainage",
    "flooding", "septic",
  ],
  noise: ["noise", "noisy", "loud", "music", "party", "quiet"],
  animals: [
    "animal", "animals", "dog", "dogs", "cat", "cats", "stray", "leash",
    "barking", "pet", "pets",
  ],
  parks: [
    "park", "parks", "playground", "trail", "trails", "pool", "pavilion",
    "ballfield",
  ],
  "snow-removal": ["snow", "plow", "plowed", "plowing", "ice", "salt"],
  "property-taxes": ["tax", "taxes", "assessment", "assessor", "levy"],
  "elections-voting": [
    "vote", "voting", "voter", "ballot", "polling", "election", "elections",
    "register", "registration",
  ],
  "state-law": ["law", "statute", "statewide", "legislature"],
  federal: [
    "social security", "veterans", "immigration", "medicare", "passport",
    "irs", "federal",
  ],
};

/** Words that anchor a topic family — counted like any hit, listed apart
 *  so the school topics' shared anchor is visible: "school" alone cannot
 *  pick between running and policy, and the modifier decides. */
const TOPIC_ANCHORS: Readonly<Record<string, readonly string[]>> = {
  "schools-operations": ["school", "schools"],
  "schools-policy": ["school", "schools", "district"],
};

export interface TopicMatch {
  topicId: string;
  /** The words that carried the match — the mechanical evidence. */
  matchedOn: string[];
  /**
   * Which rung found this topic (6d, 2026-08-15). Absent means the keyword
   * matcher, which is the only rung that carries `matchedOn` evidence — a
   * classifier match has none to carry, and saying so is what keeps the two
   * distinguishable in the log and in a later audit.
   */
  via?: "classifier";
}

function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function hitsFor(normalized: string, topicId: string): string[] {
  const hits: string[] = [];
  const keywords = [
    ...(TOPIC_ANCHORS[topicId] ?? []),
    ...(TOPIC_KEYWORDS[topicId] ?? []),
    // The route's own example phrases count as evidence too.
    ...(TOPIC_ROUTES.find((t) => t.id === topicId)?.examples ?? []),
  ];
  for (const keyword of keywords) {
    const needle = ` ${normalize(keyword).trim()} `;
    if (normalized.includes(needle)) hits.push(keyword.trim());
  }
  return [...new Set(hits)];
}

/**
 * The strong-match threshold: the keyword layer routes only on two or more distinct keyword hits for
 * the winning topic. One hit is evidence a word appeared, not of what was asked. Weak matches fall
 * through to the Level 1 classifier (`classifier.ts`); where it is unavailable, a weak match gets the
 * refusal with destinations offered, never a low-confidence route. Exact names and destination phrases
 * are the other strong class (`exact-name.ts`, `destinations.ts`).
 */
export const STRONG_MATCH_MIN_HITS = 2;

/**
 * The winning topic by hit count, at ANY strength, or null. A tie between
 * distinct topics refuses: two equally plausible routes mean the evidence did
 * not decide, and that is true at one hit and at five.
 *
 * Exported because the strength of a rejected match is a fact worth having —
 * the tests assert what the threshold turned away, and a later audit can tell
 * "no keyword at all" from "one keyword, below the bar".
 */
export function weakTopicMatch(text: string): TopicMatch | null {
  const normalized = normalize(text);
  if (normalized.trim().length === 0) return null;

  let best: TopicMatch | null = null;
  let bestCount = 0;
  let tied = false;
  for (const route of TOPIC_ROUTES) {
    const hits = hitsFor(normalized, route.id);
    if (hits.length === 0) continue;
    if (hits.length > bestCount) {
      best = { topicId: route.id, matchedOn: hits };
      bestCount = hits.length;
      tied = false;
    } else if (hits.length === bestCount) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  return best;
}

/**
 * The best topic for a question, or null — a refusal, never a guess, and now
 * a refusal at anything below `STRONG_MATCH_MIN_HITS` as well.
 */
export function matchTopic(text: string): TopicMatch | null {
  const best = weakTopicMatch(text);
  if (!best) return null;
  return best.matchedOn.length >= STRONG_MATCH_MIN_HITS ? best : null;
}
