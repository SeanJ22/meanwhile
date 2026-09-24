import { scrubFreeText } from "../log/scrub.ts";
import { resolveAskModel } from "./model.ts";
import { asksForBodyAgenda } from "../routing/named-entity.ts";

import {
  readInterpretation,
  unavailableInterpretation,
  ASK_INTENTS,
  type AskInterpretation,
} from "./intent.ts";

/**
 * **THE INTERPRETATION RUNG — Claude reading the question, with the civic
 * context it was never given before (2026-08-27).**
 *
 * ## What this replaces
 *
 * The Level 1 classifier (`lib/routing/classifier.ts`) has been the only place
 * a model ran in this product. Its entire contract is *"pick one of sixteen
 * topic ids, or NONE"*, and its system prompt contains the topic list and
 * nothing else. It has never been told what governments exist, where the
 * reader lives, what today's date is, or what records this product holds.
 *
 * That is worth stating precisely, because it was mis-diagnosed once already:
 * when *"What's on the Vail school district agenda?"* returned Sunnyside, the
 * paid model did not receive the wrong context and choose wrongly. **It
 * received essentially no civic context at all** and correctly answered the
 * only question it was asked — which drawer is this, out of sixteen. The
 * substitution happened downstream, in deterministic routing that asked for
 * boards in the reader's own coverage.
 *
 * So this rung is not "another model call". It is the first one that is given
 * the material a reading of the question actually requires:
 *
 * - **The governments that exist**, named the way a reader names them, with
 *   their division type — which is what separates a school district from a
 *   town of the same name.
 * - **Today's date**, so *"in the last 12 months"* is a computable window
 *   rather than a phrase. An agent does not know today's date and neither
 *   does a model; both are told.
 * - **The conversation so far**, bounded, so *"what has she vetoed"* has a
 *   referent.
 *
 * ## What it is still not allowed to do
 *
 * It answers with a READING of the question. It does not answer the question,
 * it is not shown any record, and every entity it names is a HYPOTHESIS that
 * `resolve.ts` reconciles against the registry before a single record is
 * fetched. A mention this rung invents that matches no government resolves to
 * `UNRESOLVED` and the reader is told so — it can never become a body.
 *
 * The inventory it is shown is a list of names this product already holds and
 * already renders. Showing it to the model discloses nothing about the reader.
 *
 * The question is scrubbed before it leaves, exactly as the classifier's is.
 */

/** The interpretation rung's whole budget, request to parsed reply. Measured median ~2.8-3.4 s. */
export const ASK_INTERPRET_TIMEOUT_MS = 6_000;

export interface InterpretContext {
  /**
   * What the reader could plausibly be naming — the search index and their own
   * covered bodies, already merged by the caller. Names and division types
   * only; no ids, because an id the model echoed back would look like a
   * resolution and it is not one.
   */
  inventory: readonly { name: string; divisionType?: string | null }[];
  /** `YYYY-MM-DD`. Supplied, never derived here — this module is not a clock. */
  today: string;
  /** The reader's own area, for orientation only. */
  approximateLocation?: string | null;
  /** Which surface asked. Ballot questions carry different default referents. */
  surface?: "MAP" | "BALLOT" | "UNKNOWN";
  /**
   * Bounded conversation context — the last few exchanges, and what is on
   * screen. This is what makes *"what has she done?"* answerable, and it is
   * capped because a growing transcript is a person-level record and this
   * product does not keep one.
   */
  priorTurns?: readonly { question: string; resolvedSubject: string | null }[];
  /** What the reader currently has open, when the surface can say. */
  activeSubjects?: readonly string[];
}

export type InterpretOutcome =
  | { kind: "READ"; interpretation: AskInterpretation; model: string; ms: number }
  | { kind: "UNAVAILABLE"; why: "ripcord" | "ceiling" | "no-key" | "error"; ms: number };

/** How much of the inventory the model is shown. Bounded for cost and latency. */
export const MAX_INVENTORY = 240;
const MAX_QUESTION_CHARS = 400;
const MAX_PRIOR_TURNS = 4;

/**
 * The model, READ FROM `lib/ask/model.ts`, with adaptive thinking at `low`
 * effort. (ITEM K, 2026-09-01 — the literal that used to sit below is gone so
 * *one model for all Ask traffic* is structural rather than four-way agreement.)
 *
 * Thinking is deliberately ON here where the topic classifier disables it.
 * The classifier's job is one label and thinking-off is defensible for it;
 * this rung has to decide a tense, an entity and a referent together, and a
 * disabled-thinking model of this generation has a documented failure mode
 * where reasoning
 * leaks into the visible output. Low effort with thinking on is both cheaper
 * to be wrong about and the shape the API is happiest with.
 */
/**
 * **RESOLVED AT CALL TIME, NOT BOUND AT MODULE LOAD.**
 * (Repaired 2026-09-01, found while attributing a walk regression.)
 *
 * This read `const MODEL = ASK_SYNTHESIS_MODEL`, which binds the CONSTANT
 * once when the module is first imported. `WTP_ASK_MODEL` is applied by
 * {@link resolveAskModel}, so this rung ignored the override entirely —
 * `lib/ask/synthesize.ts` honoured it and three other Ask call sites did not.
 *
 * ITEM K's brief permits the override on two conditions: it defaults to the
 * constant when unset, and **the RESOLVED value — not the default — is what
 * gets recorded and logged**. A rung that reads the constant satisfies the
 * first and silently breaks the second.
 *
 * The cost is not hypothetical. RULING 234 makes the measurement the
 * reversibility mechanism for the Sonnet 5 switch — *if it fails a required
 * question the incumbent held, revert the one constant and report the
 * question.* With three rungs bound at load, an experiment or an emergency
 * revert through the environment would have moved ONE of four call sites while
 * reporting that it had moved the model, and the run that proved it would have
 * been measuring a mixture.
 *
 * It was found exactly that way: an isolation walk with
 * `WTP_ASK_MODEL=claude-opus-5` reproduced the failure identically, which
 * looked like proof the model was innocent and was really proof that the
 * override never reached this code.
 */
const askModel = (): string => resolveAskModel();
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export function interpretSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      intent: { type: "string", enum: [...ASK_INTENTS] },
      entityMentions: {
        type: "array",
        items: { type: "string" },
        description: "Verbatim spans from the question that name a government, person or measure.",
      },
      normalizedMentions: {
        type: "array",
        items: { type: "string" },
        description:
          "For each mention, the full name from the inventory it most likely means, or the mention unchanged when nothing in the inventory matches.",
      },
      temporal: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["NEXT", "LAST", "RANGE", "NONE"] },
          trailingMonths: { type: "number" },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      referent: { type: ["string", "null"] },
    },
    required: ["intent", "entityMentions", "normalizedMentions", "temporal", "referent"],
    additionalProperties: false,
  };
}

/**
 * The instruction. About READING, never about answering — the words "answer",
 * "explain" and "advise" are absent on purpose, exactly as they are in the
 * topic classifier's prompt, because this rung is not doing any of those.
 */
export function interpretPrompt(context: InterpretContext): string {
  const inventory = context.inventory
    .slice(0, MAX_INVENTORY)
    .map((e) => (e.divisionType ? `${e.name} (${e.divisionType})` : e.name));

  return [
    "You are reading one question a resident asked about their government, and reporting what it MEANS. You are not answering it and you will not be shown any records.",
    "",
    `Today is ${context.today}.`,
    context.approximateLocation
      ? `The reader has told us they are in ${context.approximateLocation}.`
      : "The reader has not told us where they are.",
    context.surface === "BALLOT"
      ? "They are looking at their ballot."
      : context.surface === "MAP"
        ? "They are looking at the map of governments near them."
        : "",
    "",
    "Governments and people this product holds records for, as a reader would name them:",
    ...(inventory.length > 0 ? inventory.map((n) => `- ${n}`) : ["(none available)"]),
    "",
    "Report:",
    "- intent: which of the listed kinds of question this is.",
    "- entityMentions: the exact words in the question that name a government, a person or a ballot measure. Copy them from the question; do not invent one. An empty list is correct and common — most questions name nothing.",
    "- normalizedMentions: for each mention, in the same order, the full name from the list above that it most likely means. If nothing above plausibly matches, repeat the mention unchanged. Never invent a government that is not listed.",
    "- temporal: NEXT if they are asking about something upcoming, LAST if about the most recent past occurrence, RANGE with trailingMonths if they named a window such as 'in the last 12 months', NONE otherwise.",
    "- referent: if the question uses a pronoun that depends on something said earlier, the name it refers to; otherwise null.",
    "",
    "Be literal. 'What did they discuss last time' is LAST, not NEXT. 'What's on the agenda' with no other time words is NEXT.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export interface InterpretOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  /** Bounds spend the same way the classifier's ceiling does. */
  allowCall?: () => boolean;
}

export async function interpretQuestion(
  question: string,
  context: InterpretContext,
  options: InterpretOptions = {},
): Promise<InterpretOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { kind: "UNAVAILABLE", why: "no-key", ms: elapsed() };
  if (options.allowCall && !options.allowCall()) {
    return { kind: "UNAVAILABLE", why: "ceiling", ms: elapsed() };
  }

  const impl = options.fetchImpl ?? fetch;
  const priorTurns = (context.priorTurns ?? []).slice(-MAX_PRIOR_TURNS);

  /*
   * The conversation rides as real turns rather than as a blob inside the
   * system prompt, because that is what the referent question is actually
   * about: "she" points at the previous exchange, and flattening the exchange
   * into prose loses the very structure that makes it resolvable.
   *
   * Only the question and what it RESOLVED TO travel. The prior ANSWERS do
   * not: they are the largest thing here, they are reconstructible from the
   * resolved subject, and a growing transcript of a reader's political
   * questions is precisely the person-level record this product does not keep.
   */
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of priorTurns) {
    messages.push({ role: "user", content: scrubFreeText(turn.question).slice(0, 200) });
    messages.push({
      role: "assistant",
      content: turn.resolvedSubject
        ? `(that question was about: ${turn.resolvedSubject})`
        : "(that question resolved to no specific government)",
    });
  }
  if (context.activeSubjects?.length) {
    messages.push({
      role: "user",
      content: `(on screen right now: ${context.activeSubjects.slice(0, 6).join(", ")})`,
    });
    messages.push({ role: "assistant", content: "(noted)" });
  }
  messages.push({
    role: "user",
    content: scrubFreeText(question).slice(0, MAX_QUESTION_CHARS),
  });

  try {
    const response = await impl(MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      // A bounded wait (2026-09-24): an unbounded model call is how the first
      // live Pima request outlived the platform limit and reached the reader as
      // "that didn't reach us". Past the bound, the deterministic reading
      // stands in, exactly as it does for any other unavailable model.
      signal: AbortSignal.timeout(ASK_INTERPRET_TIMEOUT_MS),
      body: JSON.stringify({
        model: askModel(),
        max_tokens: 1024,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: interpretSchema() },
        },
        system: interpretPrompt(context),
        messages,
      }),
    });
    if (!response.ok) return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };

    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    if (!text) return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };
    return {
      kind: "READ",
      interpretation: readInterpretation(JSON.parse(text)),
      model: askModel(),
      ms: elapsed(),
    };
  } catch {
    return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };
  }
}

/**
 * The deterministic reading, used when the model rung did not run.
 *
 * **This is a FALLBACK and it is deliberately weaker than the rung above.**
 * It exists so an unavailable model degrades to a narrower answer rather than
 * to a wrong one: it reads tense, which is the thing whose absence produced a
 * confidently wrong meeting, and it reads nothing else. Entity mentions stay
 * empty, so the caller's own binder — which has always run on the raw
 * question — remains the only thing that names a government.
 */
export function interpretWithoutModel(question: string): AskInterpretation {
  const t = question.toLowerCase();
  const base = unavailableInterpretation();

  const pastWords = /\b(last|previous|prior|latest|most recent|did|was|were|happened)\b/.test(t);
  const nextWords = /\b(next|upcoming|coming up|will|going to|scheduled)\b/.test(t);
  const rangeMatch = t.match(/\b(?:last|past)\s+(\d{1,3})\s+(month|months|year|years)\b/);

  if (rangeMatch) {
    const n = Number(rangeMatch[1]);
    const months = rangeMatch[2].startsWith("year") ? n * 12 : n;
    return { ...base, temporal: { kind: "RANGE", trailingMonths: Math.min(120, months) } };
  }
  /*
   * Past beats future when both appear. "What did they decide about the next
   * budget" is a question about a meeting that already happened, and the cost
   * of the two errors is not symmetric: answering a past question with a
   * future agenda invents a discussion that has not occurred yet.
   */
  if (pastWords && !nextWords) return { ...base, temporal: { kind: "LAST" } };
  if (nextWords && !pastWords) return { ...base, temporal: { kind: "NEXT" } };
  if (pastWords && nextWords) return { ...base, temporal: { kind: "LAST" } };

  /*
   * **"WHAT'S ON THE AGENDA" IS A QUESTION ABOUT THE NEXT SITTING.**
   * (Found by the route-level red control, 2026-08-28.)
   *
   * The model rung is told this in as many words — *"'What's on the agenda'
   * with no other time words is NEXT"* — and this fallback did not know it. It
   * carried no time words, so it returned `NONE`, the route resolved `ANY`,
   * and `ANY` is `upcoming[0] ?? past[0]`: the exact ASK02 defect, still live
   * on the degraded path, waiting for a day with no key or a hit ceiling.
   *
   * The two rungs now read the same rule. `asksForBodyAgenda` is the detector
   * the deterministic route already used for this question shape, so this is
   * the product's existing answer rather than a second one written here.
   */
  if (asksForBodyAgenda(question)) return { ...base, temporal: { kind: "NEXT" } };

  return base;
}
