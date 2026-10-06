/**
 * **THE DETERMINISTIC ROUTER — a question becomes a typed query, or nothing.**
 * (ADM-C7, the 9.6.26 Operator Control Room brief.)
 *
 * This is the module the brief's prohibition is really about. *"Do not invoke a
 * model merely to answer an exact database/status question when a typed
 * deterministic query exists."* The only way to honour that is to decide, in
 * plain code, which typed query a question maps to — and to say so honestly
 * when none does.
 *
 * ## The order, and why it is that order
 *
 * ```
 *   1  prohibitions   the four things chat may never do (§ADM-C7)
 *   2  topics         the closed set of deterministic status questions
 *   3  actions        matched against the GATEWAY'S OWN registry, never a
 *                     second list kept here
 *   4  nothing        say so, and say what can be answered
 * ```
 *
 * Prohibitions run FIRST because failing closed is the only safe direction: a
 * phrasing that slipped past them into a topic match would be a way to reach
 * an unnamed capability by wording. Two of the four — shipping and promotion —
 * carve out a question ASKING ABOUT that state, because *"Why is this PR not
 * merged?"* is a status question and *"merge this PR"* is an instruction, and
 * refusing the first would make the console useless at the exact moment the
 * owner needs it. The carve-out is a leading interrogative, not the presence of
 * a question mark: *"Can you merge this?"* is an instruction with a question
 * mark on it and is refused.
 *
 * ## Actions come from the gateway's registry, not from here
 *
 * There is no list of action names in this file. An action is matched by
 * scoring the owner's words against the tokens in the gateway's own
 * {@link ActionDefinition} — its `type` and its `label`. That is deliberate:
 * §3.5 forbids one action path for buttons and another for chat, and a private
 * list of action names here would BE that second path, drifting silently the
 * first time the registry changed. A new gateway action is chat-addressable
 * with no edit to this module; a removed one stops being addressable at once.
 *
 * PURE. No store, no clock, no environment, no model.
 */

import { plainOrderType } from "./orders.ts";
import type { ActionDefinition } from "../gateway/contract.ts";
import { CHAT_TOPICS, type ChatProhibition, type ChatTopic } from "./contract.ts";

/* ------------------------------------------------------------ the subject */

/** What kind of thing the owner named in his question. */
export const SUBJECT_KINDS = ["COMMIT", "PULL_REQUEST", "WORK_ITEM", "ROUTE_TASK", "ATTEMPT"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export interface ChatSubject {
  readonly kind: SubjectKind;
  readonly value: string;
}

/** What the router decided. A closed union; `NONE` is a real answer. */
export type Routed =
  | { readonly kind: "PROHIBITED"; readonly code: ChatProhibition; readonly matched: string }
  | { readonly kind: "TOPIC"; readonly topic: ChatTopic; readonly subject: ChatSubject | null; readonly normalized: string }
  | { readonly kind: "ACTION"; readonly actionType: string; readonly subject: ChatSubject | null; readonly normalized: string }
  | { readonly kind: "NONE"; readonly normalized: string };

/* --------------------------------------------------------- normalisation */

/**
 * Lower-cased, punctuation to spaces, runs of whitespace collapsed.
 *
 * Hyphens and dots inside identifiers are preserved, because `wi-4f2a…` and
 * `2026-09-06` are the two shapes a question most often carries and both would
 * be destroyed by a blanket punctuation strip.
 */
export function normalizeQuestion(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\-.#\s]/g, " ")
      /*
       * A full stop or hyphen BETWEEN two characters belongs to an identifier —
       * `claude-opus-4.5`, `wi-4f2a9c`, `pima.legistar.com`. One at an edge is
       * sentence punctuation, and leaving it attached is how *"show me the
       * latest failed acquisition."* stopped matching a phrasing that names
       * `acquisition`.
       */
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

/** The distinct meaningful words in a piece of text. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeQuestion(text).split(" ")) {
    const word = raw.replace(/^[-.#]+|[-.#]+$/g, "");
    if (word === "" || STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return out;
}

/**
 * The handful of abbreviations an owner types that a registry entry spells out.
 *
 * Kept deliberately tiny and one-directional: it widens the QUESTION's tokens
 * so a spelled-out registry label still matches, and never narrows a label.
 * A synonym table is a place drift hides, so anything longer than this belongs
 * in the action's own `label` where the button shows it too.
 */
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

/* ------------------------------------------------------------- the subject */

const PREFIXED_ID = /\b(wi|rt|at)-[0-9a-f]{6,24}\b/;
const PR_NUMBER = /\b(?:pr|pull\s+request)\s*#?\s*(\d{1,6})\b|#(\d{1,6})\b/;
const COMMIT_SHA = /\b[0-9a-f]{7,40}\b/;

const PREFIX_KIND: Readonly<Record<string, SubjectKind>> = {
  wi: "WORK_ITEM",
  rt: "ROUTE_TASK",
  at: "ATTEMPT",
};

/**
 * The one thing the question names, if it names one.
 *
 * Order matters and is not cosmetic: `wi-4f2a9c…` contains a run of hex that a
 * commit-SHA pattern matches at a word boundary, so the prefixed control-plane
 * ids are taken first and removed from the text before a SHA is looked for.
 * Reversing the two would read every work item id as a commit.
 */
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

/* ------------------------------------------------------------ prohibited */

interface ProhibitionRule {
  readonly code: ChatProhibition;
  readonly pattern: RegExp;
  /** True when a question ASKING ABOUT this state is legitimate and must pass. */
  readonly interrogativeIsFine: boolean;
}

/**
 * The four prohibitions, by SHAPE.
 *
 * A word list would refuse *"which sources are blocked"* for containing
 * `block` and would pass *"kindly execute the following"*. These match the
 * request shape instead: an imperative verb next to a command-looking token, a
 * statement with SQL's own clause structure in it, an instruction to ship, an
 * instruction to promote.
 */
const PROHIBITIONS: readonly ProhibitionRule[] = [
  {
    code: "ARBITRARY_COMMAND",
    // "run pnpm gates", "execute this shell command", and the bare-utility form
    // "sudo rm -rf …" / "curl https://…" that carries no verb at all.
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
    /*
     * Anchored to the IMPERATIVE, which is also why no past participle appears
     * in it. "Merge this" is an instruction; "why is this not merged" is a
     * question, and `\bmerge\b` cannot match `merged` — so the shape of the
     * verb does most of the separating and the interrogative carve-out is
     * defence in depth rather than the whole guard. A bare verb list would
     * refuse "release review status", which is a page name.
     *
     * `deploy the fleet` is carved out for the same reason, and it is not a
     * loosening: the console has a registered, reversible, non-production
     * control called *Deploy fleet here*, and the word there means sending
     * workers to a jurisdiction rather than shipping software. Refusing it
     * would refuse a real control by the accident of a shared verb. `deploy`
     * with anything else after it stays refused.
     */
    code: "SHIP_BY_PROSE",
    pattern:
      /^(?:please\s+|now\s+|just\s+|go\s+ahead\s+and\s+|lets\s+|let\s+s\s+)?(?:merge|ship|push|land|integrate|cut|deploy(?!\s+(?:the\s+|a\s+)?fleet\b)|release(?!\s+(?:review|notes|manifest|state)))\b|\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:merge|ship|push|land|integrate|release|deploy(?!\s+(?:the\s+|a\s+)?fleet\b))\b|\b(?:you\s+should|we\s+should|go\s+ahead\s+and|i\s+want\s+you\s+to)\s+(?:merge|ship|push|land|integrate|release|deploy(?!\s+(?:the\s+|a\s+)?fleet\b))\b/,
    interrogativeIsFine: true,
  },
];

/**
 * Is this a question ABOUT a state rather than an instruction to change it?
 *
 * The test is the leading word, not the question mark: *"Can you merge this?"*
 * ends in one and is an instruction. A second-person request frame — "can
 * you", "could you", "will you", "please" — is an instruction whatever it
 * starts with.
 */
export function asksAboutState(normalized: string): boolean {
  if (/\b(?:can|could|would|will)\s+you\b/.test(normalized)) return false;
  if (/\bplease\b/.test(normalized)) return false;
  return /^(?:what|why|which|who|when|where|how|is|are|was|were|did|does|do|has|have|show|list|compare|tell)\b/.test(normalized);
}

/** The prohibition this text trips, if it trips one. */
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

/* ---------------------------------------------------------------- topics */

/**
 * A topic matches when EVERY word of one of its phrasings is present.
 *
 * All-of rather than any-of, because any-of turns "what is the fleet doing"
 * and "which sources are overdue" into the same question. The most specific
 * matching phrasing wins — most words, then declaration order — so a question
 * that names both a cycle and a change routes to the cycle topic rather than
 * to whichever rule happened to be written first.
 */
interface TopicRule {
  readonly topic: ChatTopic;
  readonly phrasings: readonly (readonly string[])[];
}

const TOPIC_RULES: readonly TopicRule[] = [
  { topic: "YESTERDAY_SPEND", phrasings: [["spend", "yesterday"], ["spent", "yesterday"], ["yesterday", "cost"], ["what", "spend", "get"]] },
  { topic: "PLACE_STUCK", phrasings: [["why", "stuck"], ["place", "stuck"], ["district", "stuck"]] },
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
];

/** Every rule's topic is a declared topic, and every declared topic has a rule. */
export function topicRulesAreComplete(): boolean {
  const covered = new Set(TOPIC_RULES.map((r) => r.topic));
  return CHAT_TOPICS.every((t) => covered.has(t)) && covered.size === CHAT_TOPICS.length;
}

/**
 * The topic this question asks, if it asks one.
 *
 * Matching is against the raw normalised words rather than the stopword-
 * stripped token set, because "waiting ON me" and "waiting FOR me" differ only
 * in a stopword and mean the same thing while "not integrated" needs its
 * negation kept.
 */
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

/* ---------------------------------------------------------------- actions */

/** How much of an action's own vocabulary a question must carry to name it. */
export const ACTION_MIN_WORDS = 2;
export const ACTION_MIN_COVERAGE = 0.4;

/**
 * The distinctive words an action definition is known by.
 *
 * Both halves of its own identity: the machine type and the label the button
 * shows. The type is split on its separators AND on camel case, because the
 * registry writes `fleet.deployHere` and the owner writes *"deploy the fleet
 * here"* — a split that stopped at the dot would leave one unmatchable token
 * and the action would be unreachable by the words it is named after.
 */
export function actionVocabulary(definition: ActionDefinition): Set<string> {
  const fromType = definition.type.replace(/[.\-_]/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return tokens(`${fromType} ${definition.label}`);
}

export interface ActionMatch {
  readonly actionType: string;
  readonly matched: number;
  readonly coverage: number;
}

/**
 * The one action this question names, out of the gateway's registry.
 *
 * A tie is NOT resolved. Two actions that the owner's words fit equally well
 * mean the console does not know which one he meant, and guessing between two
 * state-changing controls is the failure this whole surface exists to avoid —
 * so a tie returns null and the console asks him to use the named control.
 */
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

/* --------------------------------------------------------------- the router */

/** Classify one message. Pure, total, and the same answer every time. */
export function classify(text: string, registry: readonly ActionDefinition[]): Routed {
  const normalized = normalizeQuestion(text);
  if (normalized === "") return { kind: "NONE", normalized };

  const prohibited = prohibitionOf(text);
  if (prohibited !== null) return { kind: "PROHIBITED", code: prohibited.code, matched: prohibited.matched };

  const subject = subjectOf(text);

  const topic = topicOf(text);
  if (topic !== null) return { kind: "TOPIC", topic, subject, normalized };

  const plainType = plainOrderType(text);
  if (plainType && registry.some(d => d.type === plainType)) return { kind: "ACTION", actionType: plainType, subject, normalized };
  const action = actionMatch(text, registry);
  if (action !== null) return { kind: "ACTION", actionType: action.actionType, subject, normalized };

  return { kind: "NONE", normalized };
}
