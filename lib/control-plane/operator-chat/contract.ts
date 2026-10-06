/**
 * **THE OPERATOR CHAT'S CONTRACT — what it may be asked, and the shape of every
 * answer it may give.** (ADM-C7, from the 9.6.26 Operator Control Room brief.)
 *
 * The brief's load-bearing sentence about this surface is a prohibition, not a
 * feature:
 *
 * > Deterministic status questions should use deterministic read models. **Do
 * > not invoke a model merely to answer an exact database/status question when
 * > a typed deterministic query exists.**
 *
 * So this is not a chatbot with database access. It is a CLOSED SET of typed
 * questions over the same published read models the console's pages render,
 * plus a proposal path into the one Action Gateway the buttons already use
 * (§3.5). The classifier is pure, the queries are pure, and both are unit
 * tested — which is possible precisely because no model is in the loop.
 *
 * ## The four things every answer carries
 *
 * ```
 *   says          the answer, as plain sentences, in reading order
 *   sources       what answered, in plain English, with the record behind it
 *   denominator   the number and what it is out of — or the named gap where a
 *                 number would have been
 *   needsYou      Yes with the action, or No
 * ```
 *
 * Plus `gaps`: what this answer could NOT cover, and whose gap that is. An
 * answer that quietly narrows its own question is worse than a refusal,
 * because the owner cannot see the narrowing.
 *
 * ## `usedModel` is on every answer and is false on every answer
 *
 * The brief requires that an answer which had to use a model says so. This
 * console never calls one from a request path — there is no budgeted seam from
 * a web request (the account is in the module header of `turn.ts`) — so the
 * field is present, always false, and the page states it positively rather
 * than leaving the reader to assume.
 *
 * PURE. No store, no clock, no environment. Every type here is shared by the
 * classifier, the read models, the route and the page.
 */

import type { Gap, Held, Measured } from "../owner-surface.ts";
import type { ActionDefinition, ActionOutcome, ActionRequest, CallerAuthority } from "../gateway/contract.ts";

/* ----------------------------------------------------------------- topics */

/**
 * The questions this console answers from records, without a model.
 *
 * A CLOSED list. Anything outside it is UNROUTED and says so, naming what it
 * can answer — never a guess dressed as an answer. The brief names seven
 * deterministic questions and every one of them is here.
 */
export const CHAT_TOPICS = [
  "YESTERDAY_SPEND",
  "PLACE_STUCK",
  /** "What is blocking the Fleet?" */
  "FLEET_BLOCKERS",
  /** "What changed since the last cycle?" */
  "SINCE_LAST_CYCLE",
  /** "Which sources are overdue?" */
  "OVERDUE_SOURCES",
  /** "Show me the latest failed acquisition." */
  "LATEST_FAILED_ACQUISITION",
  /** "What is waiting on me?" */
  "WAITING_ON_YOU",
  /** "Compare production, main, and staging." */
  "COMPARE_ENVIRONMENTS",
  /** "Why is this PR not integrated?" */
  "INTEGRATION_STATUS",
  /** "What did we spend yesterday and what did it get us?" */
  "SPEND_AND_FACTS",
] as const;
export type ChatTopic = (typeof CHAT_TOPICS)[number];

/** One topic, as the owner would ask it and as the console will explain it. */
export interface TopicDefinition {
  readonly topic: ChatTopic;
  /** The canonical phrasing, shown on the page as a thing he can click. */
  readonly asks: string;
  /** What answering it will read, in plain English. */
  readonly reads: string;
  /** The console path that shows the same thing on a page, when one does. */
  readonly readBackAt: string | null;
}

export const TOPIC_DEFINITIONS: readonly TopicDefinition[] = [
  { topic: "YESTERDAY_SPEND", asks: "What did we spend yesterday and what did it get us?", reads: "the runner's measured Eastern-day spending and reader deliveries", readBackAt: "/admin?view=scoreboard" },
  { topic: "PLACE_STUCK", asks: "Why is this place stuck?", reads: "the place’s stuck work and capture score", readBackAt: "/admin?view=work" },
  {
    topic: "FLEET_BLOCKERS",
    asks: "What is blocking the Fleet?",
    reads: "the runner's heartbeat, the safety record it wrote at the end of its last cycle, the work on record, and the incidents in the latest published snapshot",
    readBackAt: "/admin",
  },
  {
    topic: "SINCE_LAST_CYCLE",
    asks: "What changed since the last cycle?",
    reads: "the runner's heartbeat, the digest it wrote for that cycle, and every attempt started since the cycle began",
    readBackAt: "/admin",
  },
  {
    topic: "OVERDUE_SOURCES",
    asks: "Which sources are overdue?",
    reads: "the freshness debt, the obligations by provider and by state, and the incidents in the latest published snapshot",
    readBackAt: "/admin",
  },
  {
    topic: "LATEST_FAILED_ACQUISITION",
    asks: "Show me the latest failed acquisition.",
    reads: "every attempt on record, newest first, with the work item it was run for",
    readBackAt: "/admin",
  },
  {
    topic: "WAITING_ON_YOU",
    asks: "What is waiting on me?",
    reads: "the decision cards in the latest published snapshot, the decisions already recorded, and the intents the runner has not yet honoured",
    readBackAt: "/admin",
  },
  {
    topic: "COMPARE_ENVIRONMENTS",
    asks: "Compare production, main, and staging.",
    reads: "production's own build identity and the three code identities the runner recorded in its heartbeat",
    readBackAt: "/admin",
  },
  {
    topic: "INTEGRATION_STATUS",
    asks: "Why is this PR not integrated?",
    reads: "production's build identity, and the code identity the runner recorded",
    readBackAt: "/admin",
  },
  {
    topic: "SPEND_AND_FACTS",
    asks: "What did we spend yesterday and what did it get us?",
    reads: "the last day's settled spend and the new or changed reader records that went live in the same hours",
    readBackAt: "/admin?view=scoreboard",
  },
];

/** The topic definition for a topic. Total: the list is closed and complete. */
export function topicDefinition(topic: ChatTopic): TopicDefinition {
  const found = TOPIC_DEFINITIONS.find((t) => t.topic === topic);
  if (!found) throw new Error(`no topic definition for ${topic} — CHAT_TOPICS and TOPIC_DEFINITIONS have drifted`);
  return found;
}

/* ------------------------------------------------------------- prohibited */

/**
 * The four things the brief says chat may never do, as a closed vocabulary.
 *
 * These are refused BEFORE anything is classified or matched, so no phrasing
 * can route around them, and they are refused by SHAPE rather than by a word
 * list — "run this" plus a command-looking token, not the word `git`.
 *
 * Authority mismatches and unknown actions are deliberately NOT here: those
 * belong to the Action Gateway's own refusal vocabulary and are answered in
 * its words (`REFUSAL_WORDS`), because §3.5 requires one refusal behaviour and
 * not two.
 */
export const CHAT_PROHIBITIONS = [
  /** "Run `pnpm gates`", "ssh into the runner", "curl this". */
  "ARBITRARY_COMMAND",
  /** "Select * from cp_attempts", "run this SQL". */
  "ARBITRARY_QUERY",
  /** "Merge 293", "deploy to production", "push this to main". */
  "SHIP_BY_PROSE",
  // Promotion is not here any more: verified facts publish automatically (rulings section 3, Sean, 2026-09-29), so there is no switch for a sentence to refuse.
] as const;
export type ChatProhibition = (typeof CHAT_PROHIBITIONS)[number];

/** What each prohibition says to the owner, and what he can do instead. */
export const PROHIBITION_WORDS: Readonly<Record<ChatProhibition, string>> = {
  ARBITRARY_COMMAND:
    "This console does not run commands you type. Every control it has is a named action with a written authority class and a receipt; a free-text command would have neither.",
  ARBITRARY_QUERY:
    "This console does not run database statements you type. It answers from named read models so that every number it gives you can be traced to the record it came from.",
  SHIP_BY_PROSE:
    "Nothing merges, deploys or ships because it was asked for in a sentence. Shipping goes through the gates and the deploy proof, in the one place that does it.",
};

/* ---------------------------------------------------------------- answers */

/** Whether an answer needs the owner, and what he should do if it does. */
export interface ChatNeedsYou {
  readonly needed: boolean;
  /** When needed: what he should do, in his words. */
  readonly action?: string;
}

export const CHAT_NEEDS_NOTHING: ChatNeedsYou = { needed: false };

/** What answered a question, in plain English, with the record behind it. */
export interface AnswerSource {
  /** Plain English: "the safety record the runner wrote at the end of its last cycle". */
  readonly says: string;
  /** When that record was written. Null when the record carries no stamp. */
  readonly at: string | null;
  /** The exact record, for the disclosure: never on the face. */
  readonly raw: string;
}

/**
 * The number in an answer, and what it is out of.
 *
 * `measured` is the canonical {@link Measured} — value, denominator, the
 * interpretation contract and where the denominator came from — so a chat
 * answer carries exactly the same number discipline as a rendered panel.
 * `says` is that number as one sentence the owner reads.
 */
export interface AnswerDenominator {
  readonly says: string;
  readonly measured: Measured;
}

/**
 * One answer, ready to render. Nothing here is a machine constant; the page
 * renders `says` verbatim and puts `detail` behind a disclosure.
 */
export interface ChatAnswer {
  readonly topic: ChatTopic;
  /** What the console understood the question to be, so a misroute is visible. */
  readonly understoodAs: string;
  /** The answer, in reading order. */
  readonly says: readonly string[];
  /** The number and its denominator, or the named gap where a number would be. */
  readonly denominator: Held<AnswerDenominator>;
  readonly sources: readonly AnswerSource[];
  readonly needsYou: ChatNeedsYou;
  /** What this answer could not cover, and whose gap that is. */
  readonly gaps: readonly Gap[];
  /** False on every answer this console gives. Present so the page can say so. */
  readonly usedModel: boolean;
  /** Where the same thing is shown on a page. */
  readonly readBackAt: string | null;
  /** The instruments' own words, the ids and the codes. One disclosure away. */
  readonly detail: readonly string[];
}

/* ---------------------------------------------------------------- actions */

/**
 * An action the chat is offering to submit, and the EXACT request it would
 * submit.
 *
 * The request is built from the gateway's own {@link ActionDefinition} and is
 * handed to the gateway unchanged. The chat never carries an action out and
 * never writes a receipt: the gateway does both, which is what makes "the same
 * receipt semantics as the equivalent UI control" true by construction rather
 * than by agreement.
 */
export interface ActionProposal {
  readonly definition: ActionDefinition;
  readonly request: ActionRequest;
  /**
   * Echoed back on the confirm so the console can prove the owner confirmed
   * the proposal he was shown. It is the request's own idempotency key, so a
   * double-confirm is one action rather than two.
   */
  readonly confirmToken: string;
  /** One sentence: what this will do. */
  readonly willDo: string;
  /** One sentence: what this explicitly will not do. */
  readonly willNotDo: string;
}

/* ------------------------------------------------------------------ turns */

/**
 * One answer from the console to one message. A closed union: every branch the
 * page can receive is named here, so a branch the page forgets to render is a
 * type error rather than a blank panel.
 */
export type ChatTurn =
  /** A deterministic answer from a read model. */
  | { readonly kind: "ANSWER"; readonly answer: ChatAnswer }
  /** One of the four things chat may never do. */
  | { readonly kind: "PROHIBITED"; readonly code: ChatProhibition; readonly says: string }
  /** A typed action, proposed and awaiting the owner's confirmation. */
  | { readonly kind: "PROPOSED"; readonly proposal: ActionProposal }
  /** The gateway's answer to a confirmed action — success or refusal alike. */
  | { readonly kind: "SUBMITTED"; readonly proposal: ActionProposal; readonly outcome: ActionOutcome }
  /**
   * The console recognised an action by name but may not ask for it, or the
   * gateway does not carry it. The sentence is the gateway's own words.
   */
  | { readonly kind: "REFUSED"; readonly says: string; readonly actionType: string | null }
  /** Nothing in the closed set matched. Says what it can answer instead. */
  | { readonly kind: "UNROUTED"; readonly says: string; readonly canAnswer: readonly string[] };

/** What the owner sent, and whether this message is a confirmation. */
export interface ChatInput {
  readonly text: string;
  /** The console path he asked from, so an answer can be about what he sees. */
  readonly from: string;
  /**
   * Present only on a confirmation: the token the proposal carried, and the
   * instant the proposal was made. Both are re-derived server-side from the
   * same question text, so a tampered token refuses rather than submits.
   */
  readonly confirm?: { readonly token: string; readonly proposedAt: string };
}

/**
 * What the console sends back for one message.
 *
 * `asked` and `proposedAt` are echoed because the confirmation re-derives the
 * proposal from them: the browser hands back the QUESTION and the instant, and
 * the server rebuilds the action itself rather than trusting an action shape
 * that came from a page.
 */
export interface ChatResponse {
  readonly turn: ChatTurn;
  /** The message the console answered, as it read it. */
  readonly asked: string;
  /** The instant this turn was built, for a confirmation to quote back. */
  readonly at: string;
  /** Set when the control plane would not open; every answer is gaps in that case. */
  readonly storeRefusedBecause: string | null;
  /** Whether any control is connected in this build. */
  readonly controlsConnected: boolean;
}

/**
 * What the transcript says when a turn came back with no controls connected.
 *
 * Kept here rather than beside the binding because the transcript is a client
 * component, and importing the binding would drag the whole action registry —
 * a server module that reaches the repositories — into the browser bundle.
 */
export const NO_CONTROLS_CONNECTED =
  "This view is answering from the records and is not connected to the console's controls, so it is not offering any. " +
  "The controls it would offer come from the one place the buttons get theirs; it has none of its own to fall back on.";

/** The caller class every chat submission carries. Never widened. */
export const CHAT_CALLER: CallerAuthority = "OPERATOR_CHAT";

/** The longest message the console accepts. */
export const CHAT_MESSAGE_MAX_CHARS = 500;

/** Every canonical question, for the page's "what you can ask" list. */
export function everyQuestion(): readonly string[] {
  return TOPIC_DEFINITIONS.map((t) => t.asks);
}
