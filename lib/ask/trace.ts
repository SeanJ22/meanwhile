import type { AskIntent, AskTemporal } from "./intent.ts";

/**
 * **THE TRACE — proof that the pipeline did what it says (2026-08-27).**
 *
 * This exists because of a specific, expensive misunderstanding: the product's
 * owner believed Claude was doing civic reasoning in Ask, and it was not. It
 * was picking one topic id out of sixteen, from a prompt containing no civic
 * context whatsoever. Nothing in the product could have told him otherwise —
 * there was no way, from outside, to see which rungs ran or what they were
 * given.
 *
 * A belief about your own system that the system cannot confirm or deny is a
 * defect in the system, not in the belief. So every rung reports.
 *
 * ## What may never be in here
 *
 * The trace is operator diagnostics and it is shaped by what it must NOT
 * carry. No API key. No raw question — the scrub runs before anything is
 * recorded, and even scrubbed the question does not belong in a durable
 * diagnostic. No reader identifier of any kind. What it carries is which rungs
 * ran, on which model, over how many records, and what came out — facts about
 * OUR machinery, not about a person.
 */

export interface RungTrace {
  ran: boolean;
  /** Why not, when it did not. */
  why?: string;
  /** The model id we sent (the resolved role model, lib/ask/model.ts). */
  model?: string;
  /**
   * The model the API says served the call (the response's own `model`
   * field), so the model actually used can be checked, not only the one asked
   * for (2026-09-25). Null when the reply carried none.
   */
  servedModel?: string | null;
  ms?: number;
  /**
   * The model's result was reused from byte-identical inputs on this server
   * instance (lib/ask/model-result-cache.ts): no call was made for this request.
   */
  cached?: boolean;
}

export interface AskTrace {
  /** Did the model read the question, and what did it conclude? */
  interpretation: RungTrace & {
    intent?: AskIntent;
    temporal?: AskTemporal;
    /** COUNTS, never the mentions themselves — those are the reader's words. */
    mentionCount?: number;
    /**
     * Whether the rung proposed a referent for a pronoun — a BOOLEAN, never the
     * referent, which is a civic subject the reader may not have typed and
     * which belongs in `resolution.subjectName` once it has been VERIFIED.
     * An operator reading this can tell a follow-up was attempted; they cannot
     * read a subject out of it that no binder confirmed.
     */
    referentProposed?: boolean;
    /** Whether the deterministic reading stood in for the model's. */
    fellBackToDeterministic?: boolean;
  };
  /** What the hypothesis reconciled to, if anything. */
  resolution: {
    state: "BOUND" | "AMBIGUOUS" | "UNRESOLVED" | "NONE";
    /** The canonical id. A public government identifier, not a reader fact. */
    subjectId?: string | null;
    subjectName?: string | null;
    basis?: string;
  };
  /** What deterministic retrieval actually did. */
  retrieval: {
    /** NEXT / LAST / ANY — the tense that governed selection. */
    selection: string;
    recordCount: number;
    sourceCount: number;
    gapCount: number;
    denominators: Record<string, number>;
  };
  /**
   * ASK-14: the office-definition lookup, when a CIVICS question named an
   * office rather than an entity and nothing canonical was bound.
   *
   * The PHRASE the reader used is recorded because the vocabulary is the thing
   * that will need extending — an operator reading a run where a reader asked
   * about an office the product could not name needs to see what they called
   * it. It is a public job title, not a fact about the reader.
   */
  officeLookup?: { phrase: string; office: string };
  /** Did the model write the answer, and did the answer survive checking? */
  synthesis: RungTrace & {
    /**
     * **THE RESOLVED EFFORT LEVEL.** (ITEM K §5, 2026-09-01.)
     *
     * `RungTrace` already carries the resolved `model`. Effort belongs beside
     * it for the identical reason: effort changes what the model produces and
     * what it costs, so an answer recorded with its model but without its
     * effort is only half-attributed. Two answers from one model at two effort
     * levels are not the same measurement, and nothing in the record would
     * say which one this was.
     *
     * Absent when the rung did not run. Never defaulted — a written-in default
     * would claim a setting that was never sent.
     */
    effort?: string;
    /**
     * **WHAT THE PROMPT CACHE ACTUALLY DID ON THIS CALL.** (Lane W6, H1.)
     *
     * Read off the API's own `usage` block and never inferred from the request
     * we sent — the usage fields are the only ground truth that caching is
     * working, and the costliest caching failure is the silent one where every
     * request still succeeds and the bill is simply higher.
     *
     * `callerKey` names a DEPLOYMENT, never a reader, so this stays inside the
     * trace's standing rule: facts about our machinery, no reader identifier of
     * any kind. `uncachedInputTokens` is the REMAINDER — the whole prompt is
     * the sum of the three token counts, and reading it alone as "the prompt
     * size" once caching is on is reading a different number than it looks.
     */
    cache?: {
      callerKey: string;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      uncachedInputTokens: number;
    };
    /**
     * **EVERY WRITER THAT RAN, IN ORDER.** (2026-09-25, the writing ladder,
     * `lib/ask/synthesize.ts`.) The fast writer first; the frontier writer
     * only after the fast answer failed validation or could not be had. Each
     * entry is the model, its role, its time and its verdict — a failed
     * check's names, or an unavailable call's status. `model` above is the
     * writer whose answer was settled.
     */
    writers?: { model: string; servedModel?: string | null; role: "FAST" | "FRONTIER"; ms: number; result: "PASSED" | "FAILED" | "UNAVAILABLE"; failed?: string[]; detail?: string }[];
    /** Why the frontier writer ran: the fast writer's failed checks, or why it could not answer. */
    escalation?: string;
    /**
     * What the writer was NOT sent (`lib/ask/writer-selection.ts`): per-member
     * vote rows beyond the bound, by whole roll call. The reader's records and
     * the pack's denominators still carry every row.
     */
    writerSelection?: { memberVoteRowsShown: number; memberVoteRowsWithheld: number; rollCallsWithheld: number };
  };
  validation: {
    ran: boolean;
    passed?: boolean;
    checked?: string[];
    failed?: string[];
  };
  /**
   * An answer composed in code from a named body's sitting
   * (`lib/ask/sitting-answer.ts`, 2026-09-25): which question shape was
   * recognised, whether the records allowed composition, and whether the
   * composed prose passed the validator. A composition that failed a check is
   * named here and was never shown; the model wrote the answer instead.
   */
  composition?: {
    kind: "SITTING";
    shape: string;
    /** Which records it was read from: recorded actions, roll calls, or the sitting and its named gaps. */
    basis?: "RECORDED_ACTIONS" | "ROLL_CALLS" | "SITTING_AND_GAPS";
    composed: boolean;
    passed?: boolean;
    failed?: string[];
  };
  /**
   * **WHICH READING THE DELIVERED ANSWER CAME FROM, AND WHY.** (2026-09-25,
   * `lib/ask/speculative-reading.ts`.) For a question the code cannot settle,
   * the answer path starts from the code's own best reading while the model
   * reads the question; its answer is kept only when the model's reading
   * agrees — same subject, same body, same question kind and byte-identical
   * writer input — and is discarded otherwise. Facts about our machinery only:
   * intents, tense kinds and times, never the question.
   */
  speculation?: {
    /** Whether a speculative writer started. */
    ran: boolean;
    /** Why it did not start; or why its answer was kept or discarded. */
    why: string;
    /** SPECULATIVE_ANSWER: the writer started on the code's reading delivered. MODEL_READING: the answer path ran on the model's reading, as before. */
    delivered: "SPECULATIVE_ANSWER" | "MODEL_READING";
    codeIntent?: AskIntent;
    codeTemporal?: AskTemporal;
    /** Milliseconds from the request's start to the speculative writer's start. */
    writerStartedAtMs?: number;
    /** A discarded writer still running was stopped. */
    aborted?: boolean;
  };
  /**
   * Wall-clock milliseconds per stage of the request, in order (2026-09-24):
   * source preloads, the meetings projection, officeholders and ballot,
   * interpretation, resolution and retrieval, then composition or synthesis.
   * Absent on an early return. Facts about our machinery, never about a reader.
   */
  stages?: Record<string, number>;
  /**
   * Wall-clock milliseconds per read inside the `sourcePreloads` stage
   * (2026-09-24, C20: a cold request spent 2.5 s there with no breakdown): the
   * edge manifest and authority edge, each named source preload (these run in
   * parallel, so they overlap rather than sum), any retry, and the
   * comment-access read. Present from the moment the preloads settle, early
   * returns included. Facts about our machinery, never about a reader.
   */
  preloads?: Record<string, number>;
  /**
   * Source reads that succeeded only on a second attempt. Sean (2026-09-24):
   * a second-attempt success is not a win, so it is named, never hidden.
   */
  preloadRetries?: string[];
  /**
   * Where each essential source was read from on this request: the reader edge
   * or the database (C20, 2026-09-24). A family the manifest carries is read
   * from the edge; "DATABASE" names a family the edge did not carry, or one
   * whose edge fetch failed.
   */
  preloadSources?: Record<string, "EDGE" | "DATABASE">;
  /**
   * Which promoted sources this request loaded (2026-09-24): ESSENTIAL (the
   * registry, the federal directory and the recorded outcomes) on a topic
   * route, ALL otherwise. A fact about our machinery, never about a reader.
   */
  sourcesLoaded?: "ESSENTIAL" | "ALL";
  /** What the reader actually got. The single most important line here. */
  answerMode: AnswerMode;
  totalMs: number;
}

/**
 * **HOW THE READER'S ANSWER WAS PRODUCED — and it is never guessed.**
 *
 * This is the field an operator reads to know whether they are looking at a
 * grounded answer or a fallback, and it is the field the signal record stores.
 * Saying `GROUNDED_CLAUDE` when only the deterministic path ran would make
 * every later measurement of the feature a fiction, so it is set at exactly
 * one place per outcome and never inferred from whether a key was present.
 */
export type AnswerMode =
  /** Claude wrote it from an evidence pack and validation passed. */
  | "GROUNDED_CLAUDE"
  /**
   * Deterministic code composed the prose from structured, dated records (a
   * topic timeline: quoted items, recorded actions, dates held) and the same
   * validator a model answer faces passed it. No model wrote it, and saying so
   * is the point: a measurement of model answers must never count these.
   */
  | "GROUNDED_COMPOSED"
  /** The records are real and rendered; no generated prose. */
  | "STRUCTURED_GROUNDED"
  /** A government was named and more than one thing fits. Nothing chosen. */
  | "CLARIFY"
  /** A government was named and we hold no such thing. Said, never swapped. */
  | "UNRESOLVED"
  /** The subject resolved and we hold nothing that answers the question. */
  | "NO_EVIDENCE"
  /** Generated prose was produced and REJECTED by validation. */
  | "REJECTED_FELL_BACK"
  /**
   * **THE ENGINE IS SWITCHED OFF BY RIPCORD.** (ASK-05, 2026-08-28.)
   *
   * This member exists because the value was already on the wire and was not
   * in this union. `app/api/ask/grounded/route.ts` answered `{ mode: "OFF" }`
   * when `ripcord.askGrounded` was pulled; both clients typed `mode` as a bare
   * `string`, so it typechecked, matched no render branch, and painted an
   * EMPTY PANEL back at a reader who had just typed a question.
   *
   * That is the silence rule broken by a type hole. A switched-off capability
   * is a fact about US and it gets said, so the mode is real, the payload is
   * the same shape as every other, and the clients carry a branch for it.
   */
  | "OFF"
  /**
   * **THE REQUEST NEVER REACHED US.** (ASK-05, 2026-08-28.)
   *
   * Set by a CLIENT, never by the server — a server that can answer is by
   * definition not in this state. It is in this union rather than in a private
   * boolean because the ballot surface had it (`data-ask-state="TRANSPORT_FAILED"`)
   * and the map surface did not: `askGrounded` caught, returned null, and the
   * panel rendered nothing at all. One surface said "that didn't reach us" and
   * the other silently degraded, from the same failure, on the same engine.
   *
   * "That didn't reach us" is a fact about us. It is deliberately not "we
   * found nothing", which would be a claim about a government made out of a
   * failed fetch. `transportFailure()` in `lib/ask/answer.ts` is the one
   * constructor.
   */
  | "TRANSPORT_FAILED";

export function emptyTrace(): AskTrace {
  return {
    interpretation: { ran: false },
    resolution: { state: "NONE" },
    retrieval: {
      selection: "ANY",
      recordCount: 0,
      sourceCount: 0,
      gapCount: 0,
      denominators: {},
    },
    synthesis: { ran: false },
    validation: { ran: false },
    answerMode: "NO_EVIDENCE",
    totalMs: 0,
  };
}
