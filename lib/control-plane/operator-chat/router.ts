import type { ActionDefinition } from "../gateway/contract.ts";
import { CHAT_TOPICS, type ChatProhibition, type ChatTopic } from "./contract.ts";

export const SUBJECT_KINDS = ["COMMIT", "PULL_REQUEST", "WORK_ITEM", "ROUTE_TASK", "ATTEMPT"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export interface ChatSubject {
  readonly kind: SubjectKind;
  readonly value: string;
}

export type Routed =
  | { readonly kind: "PROHIBITED"; readonly code: ChatProhibition; readonly matched: string }
  | { readonly kind: "TOPIC"; readonly topic: ChatTopic; readonly subject: ChatSubject | null; readonly normalized: string }
  | { readonly kind: "ACTION"; readonly actionType: string; readonly subject: ChatSubject | null; readonly normalized: string }
  | { readonly kind: "NONE"; readonly normalized: string };

/** Hyphens and dots inside identifiers are preserved. */
export function normalizeQuestion(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\-.#\s]/g, " ")
      /* A `.` or `-` between two characters belongs to an identifier; one at an edge is punctuation. */
      .replace(/(?<![a-z0-9])\.|\.(?![a-z0-9])/g, " ")
      .replace(/(?<![a-z0-9])-|-(?![a-z0-9])/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const STOPWORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "for", "with", "and", "or", "it", "its", "my", "me", "i", "you",
  "please", "can", "could", "would", "should", "do", "does", "did", "have", "has", "had",
  "what", "which", "who", "when", "where", "how", "why", "s", "t", "exact", "exactly", "now",
]);

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeQuestion(text).split(" ")) {
    const word = raw.replace(/^[-.#]+|[-.#]+$/g, "");
    if (word === "" || STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return out;
}

/** Deliberately tiny and one-directional: widens the question's tokens, never narrows a label. */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  pr: ["pull", "request"],
  prs: ["pull", "request"],
  repo: ["repository"],
  ci: ["checks"],
  db: ["database"],
  rerun: ["retry", "run"],
  requeue: ["retry", "queue"],
};

function widened(source: Set<string>): Set<string> {
  const out = new Set(source);
  for (const word of source) for (const extra of SYNONYMS[word] ?? []) out.add(extra);
  return out;
}

const PREFIXED_ID = /\b(wi|rt|at)-[0-9a-f]{6,24}\b/;
const PR_NUMBER = /\b(?:pr|pull\s+request)\s*#?\s*(\d{1,6})\b|#(\d{1,6})\b/;
const COMMIT_SHA = /\b[0-9a-f]{7,40}\b/;

const PREFIX_KIND: Readonly<Record<string, SubjectKind>> = {
  wi: "WORK_ITEM",
  rt: "ROUTE_TASK",
  at: "ATTEMPT",
};

/** Order matters: prefixed control-plane ids are removed before a SHA is looked for, or a work item id reads as a commit. */
export function subjectOf(text: string): ChatSubject | null {
  const normalized = normalizeQuestion(text);

  const prefixed = PREFIXED_ID.exec(normalized);
  if (prefixed !== null) {
    return { kind: PREFIX_KIND[prefixed[1]], value: prefixed[0] };
  }

  const pr = PR_NUMBER.exec(normalized);
  if (pr !== null) return { kind: "PULL_REQUEST", value: pr[1] ?? pr[2] };

  const sha = COMMIT_SHA.exec(normalized);
  if (sha !== null) return { kind: "COMMIT", value: sha[0] };

  return null;
}

interface ProhibitionRule {
  readonly code: ChatProhibition;
  readonly pattern: RegExp;
  /** True when a question ASKING ABOUT this state is legitimate and must pass. */
  readonly interrogativeIsFine: boolean;
}

/** Matched by request shape, not by word list. */
const PROHIBITIONS: readonly ProhibitionRule[] = [
  {
    code: "ARBITRARY_COMMAND",
    // "run pnpm gates", "execute this shell command", and the bare-utility form
    pattern:
      /\b(?:run|execute|exec|spawn|invoke)\b[^.?!]{0,40}\b(?:command|shell|bash|sh|zsh|powershell|cmd|terminal|pnpm|npm|yarn|git|curl|wget|ssh|scp|psql|node|python|script)\b|(?:^|\s)(?:sudo|rm|chmod|chown|kill|killall|curl|wget|ssh|scp|psql|dropdb|createdb)\s+-?\S/,
    interrogativeIsFine: false,
  },
  {
    code: "ARBITRARY_QUERY",
    pattern:
      /\b(?:select|insert|update|delete|drop|alter|truncate|create)\b[^.?!]{0,60}\b(?:from|into|table|where|set|values|join)\b|\brun\b[^.?!]{0,20}\b(?:sql|query|statement)\b|\bquery\b[^.?!]{0,20}\bdatabase\b/,
    interrogativeIsFine: false,
  },
  {
    /* Anchored to the imperative: `\bmerge\b` cannot match `merged`. */
    code: "SHIP_BY_PROSE",
    pattern:
      /^(?:please\s+|now\s+|just\s+|go\s+ahead\s+and\s+|lets\s+|let\s+s\s+)?(?:merge|ship|push|land|integrate|cut|deploy(?!\s+(?:the\s+|a\s+)?fleet\b)|release(?!\s+(?:review|notes|manifest|state)))\b|\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:merge|ship|push|land|integrate|release|deploy(?!\s+(?:the\s+|a\s+)?fleet\b))\b|\b(?:you\s+should|we\s+should|go\s+ahead\s+and|i\s+want\s+you\s+to)\s+(?:merge|ship|push|land|integrate|release|deploy(?!\s+(?:the\s+|a\s+)?fleet\b))\b/,
    interrogativeIsFine: true,
  },
];

/** The test is the leading word, not the question mark; a second-person request frame is an instruction. */
export function asksAboutState(normalized: string): boolean {
  if (/\b(?:can|could|would|will)\s+you\b/.test(normalized)) return false;
  if (/\bplease\b/.test(normalized)) return false;
  return /^(?:what|why|which|who|when|where|how|is|are|was|were|did|does|do|has|have|show|list|compare|tell)\b/.test(normalized);
}

export function prohibitionOf(text: string): { readonly code: ChatProhibition; readonly matched: string } | null {
  const normalized = normalizeQuestion(text);
  const interrogative = asksAboutState(normalized);
  for (const rule of PROHIBITIONS) {
    if (rule.interrogativeIsFine && interrogative) continue;
    const hit = rule.pattern.exec(normalized);
    if (hit !== null) return { code: rule.code, matched: hit[0].trim() };
  }
  return null;
}

/** Every word of one phrasing must be present; the most specific match wins (most words, then declaration order). */
interface TopicRule {
  readonly topic: ChatTopic;
  readonly phrasings: readonly (readonly string[])[];
}

const TOPIC_RULES: readonly TopicRule[] = [
  {
    topic: "FLEET_BLOCKERS",
    phrasings: [
      ["blocking", "fleet"],
      ["fleet", "blocked"],
      ["fleet", "stuck"],
      ["fleet", "bottleneck"],
      ["blocking", "workers"],
      ["fleet", "stopped"],
      ["blocking", "work"],
    ],
  },
  {
    topic: "SINCE_LAST_CYCLE",
    phrasings: [
      ["changed", "last", "cycle"],
      ["changed", "since", "cycle"],
      ["since", "last", "cycle"],
      ["last", "cycle"],
      ["latest", "cycle"],
      ["changed", "cycle"],
    ],
  },
  {
    topic: "OVERDUE_SOURCES",
    phrasings: [
      ["sources", "overdue"],
      ["sources", "late"],
      ["sources", "owed"],
      ["overdue"],
      ["freshness", "debt"],
      ["stale", "sources"],
    ],
  },
  {
    topic: "LATEST_FAILED_ACQUISITION",
    phrasings: [
      ["latest", "failed", "acquisition"],
      ["last", "failed", "acquisition"],
      ["failed", "acquisition"],
      ["latest", "failure"],
      ["last", "failure"],
      ["latest", "failed", "attempt"],
      ["last", "failed", "attempt"],
      ["failed", "attempt"],
    ],
  },
  {
    topic: "WAITING_ON_YOU",
    phrasings: [
      ["waiting", "on", "me"],
      ["waiting", "for", "me"],
      ["needs", "me"],
      ["needs", "my", "attention"],
      ["needs", "my", "decision"],
      ["decisions", "waiting"],
      ["my", "queue"],
      ["waiting", "on", "you"],
    ],
  },
  {
    topic: "COMPARE_ENVIRONMENTS",
    phrasings: [
      ["compare", "production", "main"],
      ["production", "main", "staging"],
      ["compare", "environments"],
      ["production", "staging"],
      ["main", "staging"],
      ["which", "code", "running"],
      ["code", "identity"],
    ],
  },
  {
    topic: "INTEGRATION_STATUS",
    phrasings: [
      ["pr", "not", "integrated"],
      ["pr", "not", "merged"],
      ["not", "integrated"],
      ["integration", "status"],
      ["release", "review"],
      ["release", "safe"],
      ["safe", "release"],
    ],
  },
  {
    topic: "SPEND_AND_FACTS",
    phrasings: [
      ["spend", "yesterday"],
      ["spent", "yesterday"],
      ["spend", "get"],
      ["spent", "get"],
      ["spend", "facts"],
      ["cost", "per", "fact"],
      ["cost", "fact"],
      ["spend", "buy"],
    ],
  },
];

/** Every rule's topic is a declared topic, and every declared topic has a rule. */
export function topicRulesAreComplete(): boolean {
  const covered = new Set(TOPIC_RULES.map((r) => r.topic));
  return CHAT_TOPICS.every((t) => covered.has(t)) && covered.size === CHAT_TOPICS.length;
}

/** Matched against the raw normalised words, so stopwords and negations are kept. */
export function topicOf(text: string): ChatTopic | null {
  const words = new Set(normalizeQuestion(text).split(" "));
  let best: { topic: ChatTopic; size: number } | null = null;
  for (const rule of TOPIC_RULES) {
    for (const phrasing of rule.phrasings) {
      if (!phrasing.every((w) => words.has(w))) continue;
      if (best === null || phrasing.length > best.size) best = { topic: rule.topic, size: phrasing.length };
    }
  }
  return best?.topic ?? null;
}

export const ACTION_MIN_WORDS = 2;
export const ACTION_MIN_COVERAGE = 0.4;

/** The type is split on separators and camel case, so `fleet.retryWorkItem` matches "retry this work item". */
export function actionVocabulary(definition: ActionDefinition): Set<string> {
  const fromType = definition.type.replace(/[.\-_]/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return tokens(`${fromType} ${definition.label}`);
}

export interface ActionMatch {
  readonly actionType: string;
  readonly matched: number;
  readonly coverage: number;
}

/** A tie returns null: the console never guesses between two state-changing controls. */
export function actionMatch(text: string, registry: readonly ActionDefinition[]): ActionMatch | null {
  const asked = widened(tokens(text));
  if (asked.size === 0) return null;

  const scored: ActionMatch[] = [];
  for (const definition of registry) {
    const vocabulary = actionVocabulary(definition);
    if (vocabulary.size === 0) continue;
    let matched = 0;
    for (const word of vocabulary) if (asked.has(word)) matched += 1;
    const coverage = matched / vocabulary.size;
    if (matched < ACTION_MIN_WORDS || coverage < ACTION_MIN_COVERAGE) continue;
    scored.push({ actionType: definition.type, matched, coverage });
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.matched - a.matched || b.coverage - a.coverage || a.actionType.localeCompare(b.actionType));
  const [first, second] = scored;
  if (second && second.matched === first.matched && second.coverage === first.coverage) return null;
  return first;
}

/** Classify one message. Pure, total, and the same answer every time. */
export function classify(text: string, registry: readonly ActionDefinition[]): Routed {
  const normalized = normalizeQuestion(text);
  if (normalized === "") return { kind: "NONE", normalized };

  const prohibited = prohibitionOf(text);
  if (prohibited !== null) return { kind: "PROHIBITED", code: prohibited.code, matched: prohibited.matched };

  const subject = subjectOf(text);

  const topic = topicOf(text);
  if (topic !== null) return { kind: "TOPIC", topic, subject, normalized };

  const action = actionMatch(text, registry);
  if (action !== null) return { kind: "ACTION", actionType: action.actionType, subject, normalized };

  return { kind: "NONE", normalized };
}
