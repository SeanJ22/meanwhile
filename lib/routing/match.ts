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
    "crosswalk", "streetlight", "sidewalk", "traffic",
  ],
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
 * The best topic for a question, or null — a refusal, never a guess.
 * A tie between distinct topics refuses too: two equally plausible routes
 * mean the evidence did not decide.
 */
export function matchTopic(text: string): TopicMatch | null {
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
