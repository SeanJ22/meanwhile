import { TOPIC_ROUTES } from "./topics.ts";

/**
 * Keyword → topic matching for the ask box (5, 2026-08-19). NO generation:
 * a question either lands in a curated topic domain by keyword evidence or
 * it is refused honestly. Matching is mechanical — normalized word hits
 * against curated keyword lists — and deterministic: the highest hit count
 * wins, a tie or zero refuses. Nothing here reads party, and nothing here
 * invents a route (A07: no source, no answer).
 *
 * Keywords are curated per topic ON TOP of the route's own examples —
 * variants and stems listed out rather than stemmed by code, so what
 * matches is exactly what a reviewer can read here.
 */

const TOPIC_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "schools-operations": [
    "teacher", "teachers", "principal", "bus", "buses", "superintendent",
    "classroom", "grades", "bullying",
    // From the refusal log (wall clock 2026-08-14): "my kids school"
    // refused on the school-anchor tie. The possessive marks the reader's
    // own child — a running-the-school question, not a policy one.
    "kid", "kids",
  ],
  "schools-policy": [
    "curriculum", "closing", "boundaries", "build", "building", "built",
    "construction", "opening", "calendar",
  ],
  libraries: ["library", "libraries", "librarian"],
  "zoning-development": [
    "zoning", "rezoning", "rezone", "development", "developer", "warehouse",
    "apartments", "subdivision", "permit",
  ],
  "roads-local": [
    "pothole", "potholes", "road", "roads", "street", "streets", "speeding",
    "crosswalk", "streetlight", "streetlights", "sidewalk", "traffic",
    // From the refusal log (wall clock 2026-08-14): "I want a bike lane".
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
 * THE STRONG-MATCH THRESHOLD (the author's matcher ruling, 2026-08-17).
 *
 * The keyword layer routes on a STRONG match and on nothing else: **two or
 * more distinct keyword hits for the winning topic**. One hit is evidence
 * that a word appeared, not evidence of what was asked.
 *
 * The proving case is in `tests/ask-matcher.test.ts` and it is permanent:
 * *"what will the weather be like on election day"* hits `election` once,
 * and one hit used to be enough to route it to `elections-voting` and answer,
 * at length, about who runs elections. Nothing was fabricated and every
 * sentence was sourced — so A07's contract held — but the reader was answered
 * a question nobody asked, which is its own kind of wrong. A single word
 * carries a topic's vocabulary; it does not carry a topic's intent.
 *
 * Weak matches are not refused here. They FALL THROUGH to the Level 1
 * classifier (`classifier.ts`), which reads the whole question rather than
 * counting words and either picks the right curated drawer or says nothing
 * routes. The classifier generates nothing and selects only among curated
 * destinations; where it is switched off or unreachable, a weak match gets
 * the honest refusal with the destinations offered, never a low-confidence
 * route. That is the whole of the ruling, and it is why this threshold can be
 * raised without losing the questions it stops answering by reflex.
 *
 * The OTHER strong class — an exact name (a body, a person, a district, a
 * place, or a meeting named as such, or a destination phrase) — is not
 * counted here, because a name is not a keyword. It lives in `exact-name.ts`
 * and in `destinations.ts`, and it routes without needing a second hit:
 * naming a thing IS the intent to be taken to it.
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
