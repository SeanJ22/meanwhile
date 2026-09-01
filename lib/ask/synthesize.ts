import { lengthRuleForPrompt } from "./length-contract.ts";
import { packHasEvidence, type EvidencePack } from "./evidence.ts";
import {
  SYNTHESIS_CACHE_TTL,
  askCallerKey,
  readCacheUsage,
  type AskCallerKey,
  type CacheUsage,
} from "./prompt-cache.ts";

/**
 * **THE SYNTHESIS RUNG — Claude explaining evidence it was handed
 * (2026-08-27).**
 *
 * ## The reconciliation this rung required, stated rather than assumed
 *
 * `app/api/ask/agenda/route.ts` carries a design note from an earlier session:
 * *"Nothing is summarised, because a summary of a zoning agenda is a claim
 * about what a government is about to do, made by us."* That note is a prior
 * implementation decision, and under RULING 185 it sits at precedence 7 — an
 * implementation comment explaining a past choice.
 *
 * The root constitution, at precedence 2, does not forbid summary. It says:
 *
 * > This binds LLM-written summaries too: **a summary paraphrases a cited
 * > source, never fills a gap.**
 *
 * — which contemplates LLM summaries and states the condition they must meet.
 * And the author's current directive, at precedence 1, asks for this rung by
 * name: *"give Claude those records → Claude explains what is on the agenda"*.
 *
 * So the earlier note is superseded on its own terms rather than ignored, and
 * the condition it was protecting is enforced mechanically instead of by
 * abstention: this rung paraphrases records it was given and `validate.ts`
 * rejects an answer that reaches past them.
 *
 * ## What the model is and is not doing
 *
 * It is given the evidence pack and nothing else — no corpus, no tools, no
 * network, no second question. It has no way to look anything up, so "do not
 * use your own knowledge" is enforced by what it can reach rather than only
 * asked for in a prompt. It writes plain language about records that are in
 * front of it.
 *
 * It never runs on an empty pack. An empty pack's honest structured statement
 * IS the answer; handing "nothing" to a fluent model and asking for prose is
 * the single most reliable way to manufacture a plausible falsehood.
 */

/**
 * **THE ASK MODEL. ONE DECLARATION, AND IT IS THIS ONE.**
 *
 * Exported so `lib/ask/model-economics.ts` can compare against the model the
 * product actually runs rather than against one a session remembered, and so
 * the "one model for all Ask traffic" rule is checkable instead of asserted:
 * a per-caller or per-question model would also fragment the prompt cache,
 * which is model-scoped, and forfeit every hit H1 exists to earn.
 */
export const ASK_SYNTHESIS_MODEL = "claude-opus-5";

const MODEL = ASK_SYNTHESIS_MODEL;
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export type SynthesisOutcome =
  | {
      kind: "WROTE";
      answer: string;
      citedUrls: string[];
      model: string;
      ms: number;
      /**
       * What the API reported about cache activity on THIS call. The only
       * ground truth that caching is working; everything else is a claim about
       * the request we sent rather than about what the server did.
       */
      usage: CacheUsage;
      callerKey: AskCallerKey;
    }
  | { kind: "UNAVAILABLE"; why: "no-key" | "ceiling" | "no-evidence" | "error"; ms: number };

export function synthesisSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description:
          "The answer to the reader's question, in plain language, using only the supplied records.",
      },
      citedUrls: {
        type: "array",
        items: { type: "string" },
        description: "The sourceUrl of every record the answer actually relied on.",
      },
    },
    required: ["answer", "citedUrls"],
    additionalProperties: false,
  };
}

/**
 * The instruction.
 *
 * The prohibitions here are the product's own rules restated at the point they
 * would be broken. They are not decoration: this is the one rung in the
 * pipeline whose output is prose a reader reads, so every constitutional line
 * about what may never be said has to be true of THIS call.
 */
export function synthesisPrompt(pack: EvidencePack): string {
  return [
    "You are answering one resident's question about their government, using ONLY the records supplied below.",
    "",
    `Today is ${pack.today}.`,
    "",
    "Rules, all of them absolute:",
    "- Use only the supplied records. You have no other source. If something is not in the records, you do not know it.",
    "- Never state a fact about a government that the records do not contain. Do not fill a gap with what is likely, typical, or what you may remember.",
    "- The named gaps are part of the evidence. Say them plainly when they matter to the answer.",
    "- A gap marked OURS is about us — say we have not recorded it. A gap marked THEIRS is about the government — say what they have not published. Never swap these.",
    "- Never tell the reader how to vote, never rank or score candidates, and never say who to support.",
    "- Never state a candidate's or official's position, stance or vote unless a supplied record states it.",
    "- Do not announce your own failure or apologise. State what is known, name what is missing, stop.",
    "- Plain language. No identifiers, no codes, no internal state names.",
    /*
     * ASK-19: the budget, generated from `lib/ask/length-contract.ts`, so the
     * rule the model is given and the rule the validator enforces are one
     * number. The old line said "two to five sentences unless the records
     * genuinely need more" — advice, with an escape hatch the model could
     * always satisfy by deciding the records needed more, and nothing
     * measuring either half. That hatch is what the owner met.
     */
    lengthRuleForPrompt(),
    "",
    "Also report citedUrls: the sourceUrl of every record you actually relied on. Use the URLs exactly as given. Do not invent one.",
  ].join("\n");
}

/**
 * **EVERY FIELD THE MODEL IS GIVEN. ONE DECLARATION.**
 *
 * The two payloads below are a PARTITION of this object — every key lands in
 * exactly one of them, and `tests/ask-prompt-cache.test.ts` asserts that
 * mechanically. Declaring the fields once is what makes the caching split
 * provably information-preserving: a field cannot be silently dropped from the
 * prompt by the partition, and a field added here without being assigned to a
 * side fails the partition test rather than vanishing from the model's view.
 */
function synthesisFields(pack: EvidencePack): Record<string, unknown> {
  return {
    question: pack.question,
    whatTheyAreAskingFor: pack.intent,
    timeframe: pack.temporal,
    subject: pack.subject,
    records: pack.records,
    namedGaps: pack.gaps,
    whatWasSearched: pack.denominators,
  };
}

/**
 * The STABLE side: the ZIP civic context. This is what the cache breakpoint
 * covers, together with the system rules that render ahead of it.
 */
export const SYNTHESIS_CONTEXT_FIELDS = [
  "subject",
  "records",
  "namedGaps",
  "whatWasSearched",
] as const;

/**
 * The VOLATILE side: the reader's question and the two values read off it.
 *
 * `whatTheyAreAskingFor` and `timeframe` are derived from the question by
 * `interpret.ts`, so they change whenever it does. Leaving either on the
 * stable side would put a question-shaped value inside the cached prefix and
 * quietly cost every hit the split exists to earn.
 */
export const SYNTHESIS_QUESTION_FIELDS = [
  "question",
  "whatTheyAreAskingFor",
  "timeframe",
] as const;

function pick(fields: readonly string[], pack: EvidencePack): string {
  const all = synthesisFields(pack);
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = all[field];
  return JSON.stringify(out, null, 1);
}

/**
 * The ZIP civic context, as the model sees it — the cached prefix's tail.
 *
 * JSON so nothing is lost in prose framing, and key order is fixed by the
 * declaration above rather than by object iteration, because a reordered key
 * is a different prefix and therefore a silent cache miss.
 */
export function synthesisContextPayload(pack: EvidencePack): string {
  return pick(SYNTHESIS_CONTEXT_FIELDS, pack);
}

/** The reader's question. Deliberately the last thing in the request. */
export function synthesisQuestionPayload(pack: EvidencePack): string {
  return pick(SYNTHESIS_QUESTION_FIELDS, pack);
}

/**
 * The pre-caching single blob, kept as the EQUIVALENCE REFERENCE and called by
 * nothing on the live path.
 *
 * It is what the model was given before the split, and the partition test
 * diffs the two payloads against it field by field. Deleting it would leave
 * "the split changed no information" as an assertion nobody can check, which
 * is the class of claim this repository does not accept.
 */
export function synthesisPayload(pack: EvidencePack): string {
  return JSON.stringify(synthesisFields(pack), null, 1);
}

export interface SynthesizeOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  allowCall?: () => boolean;
  /**
   * Which deployment is calling. Defaults to the environment. Cache hit rates
   * are reported per caller key and NEVER pooled: production traffic and a
   * local build have different prefixes and different arrival rates, and one
   * blended rate describes neither.
   */
  callerKey?: AskCallerKey;
}

export async function synthesizeAnswer(
  pack: EvidencePack,
  options: SynthesizeOptions = {},
): Promise<SynthesisOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const callerKey = options.callerKey ?? askCallerKey();

  /*
   * **THE EMPTY-PACK REFUSAL IS A FEATURE AND IT COMES FIRST.**
   * A model asked to answer a civic question with no records will write
   * something. It will be fluent, it will be shaped like an answer, and it
   * will be sourced to nothing.
   */
  if (!packHasEvidence(pack)) {
    return { kind: "UNAVAILABLE", why: "no-evidence", ms: elapsed() };
  }

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { kind: "UNAVAILABLE", why: "no-key", ms: elapsed() };
  if (options.allowCall && !options.allowCall()) {
    return { kind: "UNAVAILABLE", why: "ceiling", ms: elapsed() };
  }

  const impl = options.fetchImpl ?? fetch;
  try {
    const response = await impl(MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: synthesisSchema() },
        },
        /*
         * **UNCHANGED, BYTE FOR BYTE.** The system field is the front of the
         * cached prefix and the one thing in this request that must not move.
         * `thinking` and `output_config.effort` are likewise pinned per route
         * rather than varied per request — changing either invalidates the
         * messages cache on every model, and on some models the system cache
         * with it.
         */
        system: synthesisPrompt(pack),
        /*
         * **THE BREAKPOINT, AND WHY IT SITS HERE.**
         *
         * The cached prefix is `model` + `system` + this first content block:
         * the constitutional rules, today's date, and the ZIP civic context —
         * the bound subject, the retrieved records, the named gaps and the
         * denominators. The reader's QUESTION is the second block, AFTER the
         * breakpoint, which is the whole mechanism: it is what lets two
         * questions about one government share a prefix at all.
         *
         * There is exactly ONE breakpoint. A second one on the system block
         * would never fire — the system prompt renders 1,503 characters ≈ 418
         * tokens, below Claude Opus 5's 512-token minimum cacheable prefix, and
         * a prefix under the minimum caches silently and reports nothing. A
         * marker that cannot fire reads to the next session as a guarantee.
         */
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: synthesisContextPayload(pack),
                cache_control: SYNTHESIS_CACHE_TTL.cacheControl,
              },
              { type: "text", text: synthesisQuestionPayload(pack) },
            ],
          },
        ],
      }),
    });
    if (!response.ok) return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };

    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    if (!text) return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };
    const parsed = JSON.parse(text) as { answer?: unknown; citedUrls?: unknown };
    if (typeof parsed.answer !== "string" || parsed.answer.trim().length === 0) {
      return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };
    }
    return {
      kind: "WROTE",
      answer: parsed.answer.trim(),
      citedUrls: Array.isArray(parsed.citedUrls)
        ? parsed.citedUrls.filter((u): u is string => typeof u === "string")
        : [],
      model: MODEL,
      ms: elapsed(),
      /* Read off the response, never inferred from the request we sent. A
         missing usage block is zero MEASURED, never an assumed hit. */
      usage: readCacheUsage(body),
      callerKey,
    };
  } catch {
    return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };
  }
}
