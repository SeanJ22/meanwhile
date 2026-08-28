/**
 * **What a reader is ASKING FOR, as a closed set.**
 *
 * This is the vocabulary the interpretation rung answers in and the retrieval
 * rung dispatches on. It is deliberately a small closed enum rather than free
 * text: an intent decides WHICH RECORDS ARE FETCHED, so an intent the
 * retrieval layer has never heard of would be a silent no-op — the reader
 * would get the default, which is the substitution class this whole pipeline
 * exists to close.
 *
 * The two agenda intents are separate and that separation is the point. Before
 * this module the corpus answered *"what did Vail discuss at its LAST
 * meeting?"* with the NEXT meeting's agenda, because `bodyAgendaAnswer` read
 * `upcoming[0] ?? past[0]` and nothing in the pipeline had ever been told that
 * the reader's tense was a retrieval instruction. The answer was well-sourced,
 * correctly attributed, about the right government — and about the wrong
 * meeting. A temporal defect wearing a provenance record.
 */
export type AskIntent =
  /** "what's on the agenda", "what are they discussing next" */
  | "UPCOMING_AGENDA"
  /** "what did they discuss last time", "what happened at the last meeting" */
  | "PAST_MEETING"
  /** "when does the board meet", "when is the next meeting" */
  | "MEETING_TIME"
  /** "what has Katie Hobbs done", "what did she veto" */
  | "PERSON_RECORD"
  /** "who fixes the streetlight", "who do I call about a pothole" */
  | "TOPIC_OWNER"
  /** "what does Prop 427 change" */
  | "MEASURE"
  /** "who should I contact about this" */
  | "CONTACT"
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
  kind: "NEXT" | "LAST" | "RANGE" | "NONE";
  /** For RANGE only: how many months back from now the reader asked about. */
  trailingMonths?: number;
}

/**
 * **The model's reading of the question. A HYPOTHESIS, never an identity.**
 *
 * Every field here is something a language model proposed. Nothing in this
 * object has been checked against the registry, and nothing in it may reach a
 * reader as a claim. `lib/ask/resolve.ts` is what turns the `entityMentions`
 * into a canonical government, and it is allowed to disagree with all of it.
 *
 * `entityMentions` carries the reader's OWN WORDS wherever possible rather
 * than the model's tidied-up version of them. Both are kept — see
 * `normalizedMentions` — because the tidy form is often what actually binds
 * ("vail school district" → "Vail Unified School District") while the verbatim
 * form is the only one we can honestly quote back when nothing resolves.
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
 * closed lists.
 *
 * Belt and braces over the response schema, for the same reason the topic
 * classifier re-checks its enum: a schema is a promise made by a server, and
 * an intent that reached the retrieval switch without being on this list would
 * select no records and read to the reader as an absence.
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
