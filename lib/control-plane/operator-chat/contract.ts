import type { Gap, Held, Measured } from "../owner-surface.ts";
import type { ActionDefinition, ActionOutcome, ActionRequest, CallerAuthority } from "../gateway/contract.ts";

export const CHAT_TOPICS = [
  "FLEET_BLOCKERS",
  "SINCE_LAST_CYCLE",
  "OVERDUE_SOURCES",
  "LATEST_FAILED_ACQUISITION",
  "WAITING_ON_YOU",
  "COMPARE_ENVIRONMENTS",
  "INTEGRATION_STATUS",
  "SPEND_AND_FACTS",
] as const;
export type ChatTopic = (typeof CHAT_TOPICS)[number];

export interface TopicDefinition {
  readonly topic: ChatTopic;
  readonly asks: string;
  readonly reads: string;
  readonly readBackAt: string | null;
}

export const TOPIC_DEFINITIONS: readonly TopicDefinition[] = [
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

export function topicDefinition(topic: ChatTopic): TopicDefinition {
  const found = TOPIC_DEFINITIONS.find((t) => t.topic === topic);
  if (!found) throw new Error(`no topic definition for ${topic} — CHAT_TOPICS and TOPIC_DEFINITIONS have drifted`);
  return found;
}

/** Refused before classification, by shape ("run this" plus a command-looking token), not by word list. */
export const CHAT_PROHIBITIONS = [
  /** "Run `pnpm gates`", "ssh into the runner", "curl this". */
  "ARBITRARY_COMMAND",
  /** "Select * from cp_attempts", "run this SQL". */
  "ARBITRARY_QUERY",
  /** "Merge 293", "deploy to production", "push this to main". */
  "SHIP_BY_PROSE",
] as const;
export type ChatProhibition = (typeof CHAT_PROHIBITIONS)[number];

export const PROHIBITION_WORDS: Readonly<Record<ChatProhibition, string>> = {
  ARBITRARY_COMMAND:
    "This console does not run commands you type. Every control it has is a named action with a written authority class and a receipt; a free-text command would have neither.",
  ARBITRARY_QUERY:
    "This console does not run database statements you type. It answers from named read models so that every number it gives you can be traced to the record it came from.",
  SHIP_BY_PROSE:
    "Nothing merges, deploys or ships because it was asked for in a sentence. Shipping goes through the gates and the deploy proof, in the one place that does it.",
};

export interface ChatNeedsYou {
  readonly needed: boolean;
  readonly action?: string;
}

export const CHAT_NEEDS_NOTHING: ChatNeedsYou = { needed: false };

export interface AnswerSource {
  readonly says: string;
  readonly at: string | null;
  /** The exact record, for the disclosure: never on the face. */
  readonly raw: string;
}

export interface AnswerDenominator {
  readonly says: string;
  readonly measured: Measured;
}

export interface ChatAnswer {
  readonly topic: ChatTopic;
  readonly understoodAs: string;
  readonly says: readonly string[];
  readonly denominator: Held<AnswerDenominator>;
  readonly sources: readonly AnswerSource[];
  readonly needsYou: ChatNeedsYou;
  readonly gaps: readonly Gap[];
  /** False on every answer this console gives. Present so the page can say so. */
  readonly usedModel: boolean;
  readonly readBackAt: string | null;
  readonly detail: readonly string[];
}

export interface ActionProposal {
  readonly definition: ActionDefinition;
  readonly request: ActionRequest;
  /** The request's own idempotency key, so a double-confirm is one action. */
  readonly confirmToken: string;
  readonly willDo: string;
  readonly willNotDo: string;
}

export type ChatTurn =
  | { readonly kind: "ANSWER"; readonly answer: ChatAnswer }
  | { readonly kind: "PROHIBITED"; readonly code: ChatProhibition; readonly says: string }
  | { readonly kind: "PROPOSED"; readonly proposal: ActionProposal }
  | { readonly kind: "SUBMITTED"; readonly proposal: ActionProposal; readonly outcome: ActionOutcome }
  | { readonly kind: "REFUSED"; readonly says: string; readonly actionType: string | null }
  | { readonly kind: "UNROUTED"; readonly says: string; readonly canAnswer: readonly string[] };

export interface ChatInput {
  readonly text: string;
  readonly from: string;
  /** Present only on a confirmation. Re-derived server-side, so a tampered token refuses. */
  readonly confirm?: { readonly token: string; readonly proposedAt: string };
}

/** The server rebuilds the action from `asked` and `proposedAt` rather than trusting an action shape from the page. */
export interface ChatResponse {
  readonly turn: ChatTurn;
  readonly asked: string;
  readonly at: string;
  /** Set when the control plane would not open; every answer is gaps in that case. */
  readonly storeRefusedBecause: string | null;
  readonly controlsConnected: boolean;
}

/** Kept here, not beside the binding, so the client transcript does not pull the server-side registry into the browser bundle. */
export const NO_CONTROLS_CONNECTED =
  "This view is answering from the records and is not connected to the console's controls, so it is not offering any. " +
  "The controls it would offer come from the one place the buttons get theirs; it has none of its own to fall back on.";

/** The caller class every chat submission carries. Never widened. */
export const CHAT_CALLER: CallerAuthority = "OPERATOR_CHAT";

export const CHAT_MESSAGE_MAX_CHARS = 500;

export function everyQuestion(): readonly string[] {
  return TOPIC_DEFINITIONS.map((t) => t.asks);
}
