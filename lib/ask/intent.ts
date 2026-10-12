/**
 * What a reader is asking for, as a closed set the interpretation rung answers
 * in and retrieval dispatches on. An unknown intent would select no records,
 * so the set is closed. The reader's tense is a retrieval instruction:
 * `UPCOMING_AGENDA` and `PAST_MEETING` select different sittings.
 */
export type AskIntent =
  /** "what's on the agenda", "what are they discussing next" */
  | "UPCOMING_AGENDA"
  /** "what did they discuss last time", "what happened at the last meeting" */
  | "PAST_MEETING"
  /** "when does the board meet", "when is the next meeting" */
  | "MEETING_TIME"
  /** "what has the governor done", "what did she veto" */
  | "PERSON_RECORD"
  /** "who fixes the streetlight", "who do I call about a pothole" */
  | "TOPIC_OWNER"
  /** "what does Prop 427 change" */
  | "MEASURE"
  /** "who should I contact about this" */
  | "CONTACT"
  /**
   * "is there a data centre coming?": a subject swept across every readable
   * agenda in scope, stating a denominator. Its records enter the one pack as
   * `AGENDA_MENTION`.
   */
  | "AGENDA_TOPIC"
  /** "what does a school board actually do" — no records needed */
  | "CIVICS"
  /** The rung could not decide. Never a licence to guess a default. */
  | "UNKNOWN";

export const ASK_INTENTS: AskIntent[] = [
  "UPCOMING_AGENDA",
  "PAST_MEETING",
  "MEETING_TIME",
  "PERSON_RECORD",
  "TOPIC_OWNER",
  "MEASURE",
  "CONTACT",
  "AGENDA_TOPIC",
  "CIVICS",
  "UNKNOWN",
];

/**
 * WHEN the reader means, separated from WHAT they are asking about.
 *
 * `NEXT` and `LAST` are not decorations on the intent — they are the
 * selection rule over a body's sittings, and `RANGE` carries the trailing
 * window a question like *"in the last 12 months"* asks for.
 */
export interface AskTemporal {
  kind: "NEXT" | "LAST" | "RANGE" | "NONE" | "DATE";
  /** A date copied from the reader's question, resolved in the body's own zone. */
  localDate?: string | null;
  /** For RANGE only: how many months back from now the reader asked about. */
  trailingMonths?: number;
}

/**
 * The model's reading of the question: a hypothesis, never an identity.
 * `lib/ask/resolve.ts` turns `entityMentions` into a canonical government and
 * may disagree with all of it. `entityMentions` keeps the reader's own words;
 * `normalizedMentions` the model's expansion, which often binds better.
 */
export interface AskInterpretation {
  intent: AskIntent;
  /** Verbatim spans the reader typed that name a government, person or measure. */
  entityMentions: string[];
  /** The model's expansion of each mention. Strictly a binding CANDIDATE. */
  normalizedMentions: string[];
  temporal: AskTemporal;
  /**
   * What a pronoun in the question points at, when the model could tell from
   * the conversation so far. Null is the common and correct answer.
   */
  referent: string | null;
}

/** The interpretation used when the rung did not run at all. */
export function unavailableInterpretation(): AskInterpretation {
  return {
    intent: "UNKNOWN",
    entityMentions: [],
    normalizedMentions: [],
    temporal: { kind: "NONE" },
    referent: null,
  };
}

/**
 * Read a model answer into an interpretation, discarding anything not on the
 * closed lists; a schema is a server's promise, not a guarantee.
 */
export function readInterpretation(raw: unknown): AskInterpretation {
  const fallback = unavailableInterpretation();
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Record<string, unknown>;

  const intent = ASK_INTENTS.includes(value.intent as AskIntent)
    ? (value.intent as AskIntent)
    : "UNKNOWN";

  const strings = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim())
          .slice(0, 8)
      : [];

  const temporalRaw = (value.temporal ?? {}) as Record<string, unknown>;
  const kind = ["NEXT", "LAST", "RANGE", "NONE"].includes(temporalRaw.kind as string)
    ? (temporalRaw.kind as AskTemporal["kind"])
    : "NONE";
  const months = Number(temporalRaw.trailingMonths);
  const temporal: AskTemporal =
    kind === "RANGE" && Number.isFinite(months) && months > 0
      ? { kind, trailingMonths: Math.min(120, Math.floor(months)) }
      : { kind: kind === "RANGE" ? "NONE" : kind };

  return {
    intent,
    entityMentions: strings(value.entityMentions),
    normalizedMentions: strings(value.normalizedMentions),
    temporal,
    referent:
      typeof value.referent === "string" && value.referent.trim().length > 0
        ? value.referent.trim().slice(0, 120)
        : null,
  };
}
