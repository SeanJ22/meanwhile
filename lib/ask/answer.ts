import type { AskContact } from "./contacts.ts";
import type { Meeting } from "../sources/types.ts";
import type { EvidenceGap, EvidencePack, EvidenceRecord, EvidenceSubject } from "./evidence.ts";
import { emptyTrace, type AnswerMode, type AskTrace } from "./trace.ts";

/**
 * **ONE READER ANSWER SHAPE.** (ASK-05, 2026-08-28.)
 *
 * ## What was wrong, and it was not a tidiness problem
 *
 * Three routes answered readers and **not one of them declared a response
 * type.** Every reply was an untyped inline object literal, so the contract
 * existed nowhere except as hand-copied interfaces duplicated inside the two
 * client components — and the duplicates had already drifted:
 *
 * * `/api/ask/grounded` emitted `mode: "OFF"` when its ripcord was pulled.
 *   `"OFF"` was not a member of `AnswerMode`; both clients typed `mode` as a
 *   bare `string`, so it typechecked, matched no branch, and rendered an EMPTY
 *   PANEL. A switched-off engine looked exactly like a working one with
 *   nothing to say.
 * * `AskContact` carries `basis` and `retrievedAt`. Both client copies dropped
 *   them, so the provenance of a sourced civic relationship travelled on the
 *   wire and was **unrenderable by declaration**.
 * * `AskTrace` rides on every response and appeared in neither client copy.
 * * `EvidenceRecord.kind` is a 16-member union; both copies flattened it to
 *   `string`, so a client could branch on a kind the server can never send and
 *   nothing would say so.
 * * `/api/ask/agenda` had FIVE distinct response shapes out of one handler,
 *   one of which re-spelled `NamedEntityBinding`'s discriminant from `kind` to
 *   `state` and dropped its `NONE` member in transit.
 *
 * And underneath the type problem was a **product** problem: the map surface
 * ran the grounded engine and the topic sweep CONCURRENTLY and rendered both,
 * each with its own eyebrow, its own denominator sentence and its own hit
 * list. Two competing civic authorities on one screen, and the reader picked
 * which one to believe.
 *
 * ## What this is
 *
 * The single reader-facing contract, declared once, imported by the routes
 * that produce it and by the clients that render it. The topic sweep is not
 * deleted — it is DEMOTED, from a second answer to supplemental evidence
 * inside the one pack, as `AGENDA_MENTION` records with its denominator folded
 * into `denominators`.
 *
 * ## Every field travels on every mode
 *
 * `CLARIFY`, `UNRESOLVED` and `OFF` used to answer with two or three keys and
 * nothing else, which is what made a client's `?? []` the load-bearing part of
 * the render. Every payload now carries the whole shape. A client that reads
 * `records` gets an array on every path, and a client that forgets a mode
 * still has something true to render.
 *
 * **Nothing here is optional to make it easier to build.** `mention` and
 * `candidates` are optional because they are meaningful on exactly two modes;
 * everything else is required precisely so a producer cannot omit it.
 */
/**
 * One sitting an answer resolved, structured for a CONTROL rather than prose.
 *
 * Declared here rather than reusing `Meeting` because the two differ on
 * `bodyId` — `Meeting` has `string | undefined`, the Ask pipeline's own shape
 * has `string | null` — and reconciling that with a cast at the boundary is
 * how a null reaches something that declared it could not be one. The client
 * adapts explicitly, in one place, where the difference is visible.
 */
export interface AskSitting {
  id: string;
  bodyId: string | null;
  ocdId: string | null;
  title: string;
  bodyName: string;
  startsAt: string;
  timeZone?: string | null;
  agendaUrl?: string | null;
  location: Meeting["location"];
  status: Meeting["status"];
  jurisdiction: string;
  online?: Meeting["online"];
}

export interface AskAnswerPayload {
  /**
   * **THE SITTINGS THIS ANSWER IS ABOUT, STRUCTURED.**
   * (Session B closure, ASK-20 / ASK-23 / ASK-24, 2026-08-31.)
   *
   * The evidence `records` carry a MEETING as prose plus an id and a start
   * time, which is everything a READER needs and not enough for a CONTROL. An
   * Add-to-calendar entry needs the title, the venue or the join line, the
   * body's own time zone and the status; a card that leads with "this body's
   * next meeting" needs to know which sitting that is. Both were absent, so
   * the Ask answer could describe a meeting and offer nothing to do with it
   * while the map card beside it offered both.
   *
   * These are the SAME `Meeting` objects the route selected, not a reshaped
   * copy — a second shape would be a second place for the calendar entry and
   * the sentence to disagree about a start time.
   *
   * Empty on every mode that resolved no sitting, which is most of them. A
   * client reads `meetings[0]` for "the one this answer is about" and the
   * whole array for a day that holds more than one (ASK-24).
   */
  meetings: AskSitting[];
  /** How the reader's answer was produced. Never inferred — see `AnswerMode`. */
  mode: AnswerMode;
  /** What the question resolved to, or null. Never a substitute. */
  subject: EvidenceSubject | null;
  /** Validated generated prose, or null. Null is a normal, honest outcome. */
  answer: string | null;
  /**
   * The evidence, WHATEVER the mode.
   *
   * A rejected or unavailable synthesis still ships every record, because the
   * structured answer is a true answer and discarding a useful reply over one
   * null field is the defect class this repository has found repeatedly.
   */
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
 * **THE DESTINATION ROUTER'S SHAPE — declared here, deliberately.**
 *
 * `/api/ask/classify` is the third Ask route and it had no response type
 * either: an inline literal on the server read by an inline literal in a
 * component. It lives beside `AskAnswerPayload` rather than inside the route
 * because a type declared in `app/api/**` cannot be imported by a client
 * component without dragging server code into the browser graph — which is
 * exactly why the hand-copied duplicates existed in the first place.
 *
 * It is a short type because what this route returns is short, and saying so
 * out loud is the point: **this is NAVIGATION, not an answer.** It selects
 * among curated in-app destinations and can never carry a fact about a
 * government, which is why it may coexist with the one reader answer instead
 * of competing with it.
 *
 * `topic: null` is a first-class outcome and never an error. `why` is operator
 * diagnostics and no reader sentence is built from it.
 */
export interface AskClassifyReply {
  /** A curated topic id, or null when nothing curated fits. */
  topic: string | null;
  /** `off`, `none`, or the rung's own unavailability reason. Operators only. */
  why?: string;
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
 * The full answer, built from the pack that produced it.
 *
 * Taking the pack rather than loose arguments is deliberate: the records, the
 * gaps and the denominators the reader sees are then BY CONSTRUCTION the ones
 * the synthesis rung was given and the validator checked against. A route that
 * assembled its reply separately could ship a record the validator never saw.
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
  return { ...base("CLARIFY", trace), mention, candidates: [...candidates] };
}

/** A government was named and we hold no such thing. Said, never swapped. */
export function unresolvedAnswer(mention: string, trace: AskTrace): AskAnswerPayload {
  return { ...base("UNRESOLVED", trace), mention };
}

/**
 * The engine is switched off.
 *
 * It carries a NAMED GAP rather than an empty body, because the reader is
 * owed a sentence and `why` is operator diagnostics. The attribution is OURS —
 * a switched-off capability is a fact about this product and never about a
 * government — and there is no verdict on ourselves in it (RULING 139).
 */
export function offAnswer(why: string): AskAnswerPayload {
  const out = base("OFF", emptyTrace());
  out.trace.answerMode = "OFF";
  out.why = why;
  out.gaps = [
    {
      whose: "OURS",
      statement:
        "Answering from our records is switched off right now, so we have nothing to show for that question yet.",
    },
  ];
  return out;
}

/**
 * The request never reached us. **Constructed by a CLIENT, never by a server.**
 *
 * The map surface had no such state: its fetch caught, returned null, and the
 * panel rendered nothing — the same failure the ballot surface reported
 * honestly. One engine may not degrade two ways.
 */
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

/**
 * Read an unknown wire body into the contract, or refuse it.
 *
 * A client parses JSON and gets `any`; the duplicated interfaces existed
 * because nothing turned that `any` into the contract. This does, and it is
 * deliberately narrow: a reply whose `mode` is not a member of `AnswerMode` is
 * refused rather than rendered, because the empty-panel defect was exactly a
 * mode nothing branched on reaching the render.
 */
export const ANSWER_MODES: AnswerMode[] = [
  "GROUNDED_CLAUDE",
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
    /* ASK-20: absent on an older reply is an EMPTY list, never undefined — the
       client reads meetings[0] and a missing array would be a runtime throw on
       a payload that is otherwise perfectly renderable. */
    meetings: arr<AskSitting>(value.meetings),
    denominators:
      value.denominators && typeof value.denominators === "object"
        ? (value.denominators as Record<string, number>)
        : {},
    mention: typeof value.mention === "string" ? value.mention : undefined,
    candidates: Array.isArray(value.candidates)
      ? (value.candidates as string[])
      : undefined,
    why: typeof value.why === "string" ? value.why : undefined,
    trace: (value.trace as AskTrace) ?? emptyTrace(),
  };
}

/**
 * Did this answer put anything true in front of the reader?
 *
 * One definition, read by the render and by the log, for the reason
 * `askWasAnswered` exists one layer up: a private copy in a component learns
 * about prose and records and then has to learn about gaps separately, and the
 * two disagree the first time one of them is extended.
 *
 * **A named gap counts.** "We have not recorded any roll-call votes for this
 * person" is an answer — it is the honest one — and treating it as nothing
 * would file a question this product answered correctly into the roadmap of
 * things it cannot do.
 */
export function answerSaysSomething(payload: AskAnswerPayload | null): boolean {
  if (!payload) return false;
  /*
   * **A TRANSPORT FAILURE IS NOT AN ANSWER, AND IT IS NOT A REFUSAL EITHER.**
   * Its gap is about us reaching our own server; nothing was asked of the
   * records, so nothing may be concluded about them in either direction. A
   * caller that logs on this boolean must skip the row entirely — see
   * `components/ask/ask-box.tsx`, which does.
   */
  if (payload.mode === "TRANSPORT_FAILED") return false;
  return Boolean(
    payload.answer ||
      payload.records.length > 0 ||
      payload.gaps.length > 0 ||
      payload.mode === "CLARIFY" ||
      payload.mode === "UNRESOLVED",
  );
}
