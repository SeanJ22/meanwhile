import type { AskContact } from "./contacts.ts";
import type { BodyConfirmation } from "./body-confirmation.ts";
import type { Meeting } from "../sources/types.ts";
import type { EvidenceGap, EvidencePack, EvidenceRecord, EvidenceSubject } from "./evidence.ts";
import { emptyTrace, type AnswerMode, type AskTrace } from "./trace.ts";

/**
 * The one reader-facing Ask contract, imported by the routes that produce it
 * and the clients that render it. Every field travels on every mode, so a
 * client always has arrays to read; only `mention` and `candidates` are
 * optional, being meaningful on two modes.
 */

/**
 * One sitting an answer resolved, structured for a control. Not `Meeting`:
 * `bodyId` is `string | null` here and `string | undefined` there, and the
 * client adapts explicitly.
 */
export interface AskSitting {
  id: string;
  bodyId: string | null;
  ocdId: string | null;
  title: string;
  bodyName: string;
  startsAt: string;
  timeZone?: string | null;
  /** `DAY`: a date-only posting; `startsAt`'s midnight is never a time. */
  startPrecision?: Meeting["startPrecision"];
  agendaUrl?: string | null;
  location: Meeting["location"];
  status: Meeting["status"];
  jurisdiction: string;
  online?: Meeting["online"];
}

export interface AskAnswerPayload {
  /** One canonical body suggestion to confirm before a substantive answer. */
  confirmation?: BodyConfirmation;
  clarification?: string;
  /** Held agenda records lead the reader answer, even when prose is available. */
  agendaLead?: boolean;
  /**
   * The sittings this answer is about, as the same `Meeting` objects the route
   * selected, so calendar controls and the sentence agree. Empty on modes that
   * resolved none; `meetings[0]` is the one the answer is about.
   */
  meetings: AskSitting[];
  /** Exact listing identities; a null unique count must never become array.length. */
  meetingListingIdentity?: import("../meetings/listing-identity.ts").MeetingListingIdentityReadback;
  /** How the reader's answer was produced. Never inferred — see `AnswerMode`. */
  mode: AnswerMode;
  /** What the question resolved to, or null. Never a substitute. */
  subject: EvidenceSubject | null;
  /** The displayed response, including clarification; null when no prose was produced. */
  answer: string | null;
  /** The evidence, whatever the mode; a rejected or unavailable synthesis still ships every record. */
  records: EvidenceRecord[];
  /** Named gaps, each saying WHOSE gap it is. Evidence, not error handling. */
  gaps: EvidenceGap[];
  /** Sourced civic relationships, with their basis and read date intact. */
  contacts: AskContact[];
  /** What was searched, so the answer can bound its own scope. */
  denominators: Record<string, number>;
  /** `CLARIFY` and `UNRESOLVED`: the words the reader used. */
  mention?: string;
  /** `CLARIFY`: what they could have meant. Offered, never chosen. */
  candidates?: string[];
  /** `OFF`: why, for an operator. The reader gets a sentence, not this. */
  why?: string;
  /** Which rungs ran, over how many records, and what came out. */
  trace: AskTrace;
}

/**
 * The destination router's reply (`/api/ask/classify`), declared here so a
 * client can import it without server code. Navigation, never a fact about a
 * government. `topic: null` is a normal outcome; `why` is for operators.
 */
export interface AskClassifyReply {
  /** A curated topic id, or null when nothing curated fits. */
  topic: string | null;
  /** `off`, `none`, or the rung's own unavailability reason. Operators only. */
  why?: string;
  /** The model id the classifier sent (lib/ask/model.ts, CLASSIFIER role). Operators only. */
  model?: string;
  /** The model the API says served the call. Operators only. */
  servedModel?: string | null;
}

/** The empty shape every producer starts from, so no field is forgotten. */
function base(mode: AnswerMode, trace: AskTrace): AskAnswerPayload {
  return {
    mode,
    subject: null,
    answer: null,
    records: [],
    gaps: [],
    contacts: [],
    denominators: {},
    meetings: [],
    trace,
  };
}

/**
 * The full answer, built from the pack that produced it, so the records, gaps
 * and denominators shown are the ones the validator checked.
 */
export function askAnswer(input: {
  mode: AnswerMode;
  pack: EvidencePack;
  answer: string | null;
  contacts: readonly AskContact[];
  /** The sittings this answer resolved. Same objects the route selected. */
  meetings?: readonly AskSitting[];
  trace: AskTrace;
}): AskAnswerPayload {
  return {
    ...base(input.mode, input.trace),
    subject: input.pack.subject,
    answer: input.answer,
    records: [...input.pack.records],
    gaps: [...input.pack.gaps],
    contacts: [...input.contacts],
    denominators: input.pack.denominators,
    meetings: [...(input.meetings ?? [])],
  };
}

/** A government was named and more than one thing fits. Asked, never chosen. */
export function clarifyAnswer(
  mention: string,
  candidates: readonly string[],
  trace: AskTrace,
): AskAnswerPayload {
  const payload = { ...base("CLARIFY", trace), mention, candidates: [...candidates] };
  payload.answer = askResponseText(payload);
  return payload;
}

/** A government was named and we hold no such thing. Said, never swapped. */
export function unresolvedAnswer(mention: string, trace: AskTrace): AskAnswerPayload {
  const payload = { ...base("UNRESOLVED", trace), mention };
  payload.answer = askResponseText(payload);
  return payload;
}

/** The missing information is ours; this never creates a government or claims its calendar is empty. */
export function unheldBodyAnswer(name: string, information: string, trace: AskTrace): AskAnswerPayload {
  const answer = `We don't have ${name}'s ${information} yet.`;
  return { ...base("NO_EVIDENCE", trace), answer, gaps: [{ whose: "OURS", statement: answer }] };
}

export function unresolvedReadLine(answer: { mention?: string; denominators?: Record<string, number> }): string {
  return answer.denominators?.identityUnresolved
    ? `We could not resolve the supplied identity for “${answer.mention ?? "this subject"}”.`
    : `We don't have anything recorded under “${answer.mention ?? "that name"}”.`;
}

/** The same response text is shown on both Ask surfaces and saved by the route. */
export function askResponseText(payload: Pick<AskAnswerPayload, "mode" | "answer" | "mention" | "candidates" | "confirmation" | "clarification" | "denominators">): string | null {
  if (payload.mode === "CLARIFY") {
    if (payload.confirmation) return `Did you mean ${payload.confirmation.name}?`;
    if (payload.clarification) return payload.clarification;
    return `More than one goes by “${payload.mention ?? ""}”${payload.candidates?.length ? `: ${payload.candidates.join(", ")}` : ""}. Which did you mean?`;
  }
  if (payload.mode === "UNRESOLVED") return unresolvedReadLine(payload);
  return payload.answer;
}

/** The engine is switched off: a named gap of ours, with `why` for operators. */
export function offAnswer(why: string): AskAnswerPayload {
  const out = base("OFF", emptyTrace());
  out.trace.answerMode = "OFF";
  out.why = why;
  out.gaps = [
    {
      whose: "OURS",
      statement:
        "We’re working on getting this info.",
    },
  ];
  return out;
}

/** The request never reached us. Constructed by a client, never by a server. */
export function transportFailure(): AskAnswerPayload {
  const out = base("TRANSPORT_FAILED", emptyTrace());
  out.trace.answerMode = "TRANSPORT_FAILED";
  out.gaps = [
    {
      whose: "OURS",
      statement: "That didn't reach us. Try again in a moment.",
    },
  ];
  return out;
}

/** Read an unknown wire body into the contract, or refuse it: a `mode` outside `AnswerMode` is refused. */
export const ANSWER_MODES: AnswerMode[] = [
  "GROUNDED_CLAUDE",
  "GROUNDED_COMPOSED",
  "STRUCTURED_GROUNDED",
  "CLARIFY",
  "UNRESOLVED",
  "NO_EVIDENCE",
  "REJECTED_FELL_BACK",
  "OFF",
  "TRANSPORT_FAILED",
];

export function readAskAnswer(raw: unknown): AskAnswerPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!ANSWER_MODES.includes(value.mode as AnswerMode)) return null;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    mode: value.mode as AnswerMode,
    subject: (value.subject as EvidenceSubject | null) ?? null,
    answer: typeof value.answer === "string" ? value.answer : null,
    records: arr<EvidenceRecord>(value.records),
    gaps: arr<EvidenceGap>(value.gaps),
    contacts: arr<AskContact>(value.contacts),
    /* Absent on an older reply is an empty list, never undefined. */
    meetings: arr<AskSitting>(value.meetings),
    denominators:
      value.denominators && typeof value.denominators === "object"
        ? (value.denominators as Record<string, number>)
        : {},
    mention: typeof value.mention === "string" ? value.mention : undefined,
    confirmation: value.confirmation && typeof value.confirmation === "object" &&
      typeof (value.confirmation as BodyConfirmation).bodyId === "string" &&
      typeof (value.confirmation as BodyConfirmation).name === "string" &&
      typeof (value.confirmation as BodyConfirmation).question === "string"
        ? value.confirmation as BodyConfirmation : undefined,
    clarification: typeof value.clarification === "string" ? value.clarification : undefined,
    agendaLead: value.agendaLead === true,
    candidates: Array.isArray(value.candidates)
      ? (value.candidates as string[])
      : undefined,
    why: typeof value.why === "string" ? value.why : undefined,
    trace: (value.trace as AskTrace) ?? emptyTrace(),
  };
}

/**
 * Did this answer put anything true in front of the reader? One definition for
 * the render and the log. A named gap counts.
 */
export function answerSaysSomething(payload: AskAnswerPayload | null): boolean {
  if (!payload) return false;
  /* A transport failure is neither an answer nor a refusal; callers that log on this skip the row. */
  if (payload.mode === "TRANSPORT_FAILED") return false;
  return Boolean(
    payload.answer ||
      payload.records.length > 0 ||
      payload.gaps.length > 0 ||
      payload.mode === "CLARIFY" ||
      payload.mode === "UNRESOLVED",
  );
}
