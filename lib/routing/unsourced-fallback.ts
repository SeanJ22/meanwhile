import { askPlaybook } from "../ask/runtime-settings.ts";
/**
 * The unsourced fallback: when no held record answers, Ask may answer from the Claude API (the tier
 * named in `lib/models.ts`, resolved from `lib/ask/model.ts`). It is kept structurally separate from a
 * sourced civic answer:
 * 1. A different result type: `UNSOURCED`, never a `RoutingAnswer`.
 * 2. No sources field exists on it (no `sources`, `provenance` or `sourceUrl`).
 * 3. The plain-language mark leads, above the answer.
 * 4. It is displayed only after the sourced path declines. A missing recent vote may prepare it while
 * retained votes are checked; a held answer wins and cancels the unused call.
 * Every answer states the source it used (`sourceLine`, on the record) and is one or two sentences. An
 * unsourced answer is not reader signal, not a position, and is not aggregated.
 */
import { scrubFreeText } from "../log/scrub.ts";
import { askModelLadder } from "../ask/model-ladder.ts";
import { ASK_MODEL_ROLES } from "../ask/model.ts";
import { MODELS, modelRequestFields, modelTierFor } from "../models.ts";

/**
 * The mark, in plain language: this did not come from a record the site holds.
 */
export const UNSOURCED_MARK =
  "AI answer";

/** The source an unsourced answer states, naming the model that wrote it. */
export function unsourcedSourceLine(model: string): string {
  const tier = modelTierFor(model);
  const name = tier ? MODELS[tier].name : "Claude";
  return `Source: ${name}, general knowledge — not a public record this site holds.`;
}

/** What an unsourced answer is. Deliberately not a `RoutingAnswer`. */
export interface UnsourcedAnswer {
  readonly kind: "UNSOURCED";
  /** The generated answer, or the model's explicit unknown response. */
  readonly text: string;
  /** Always the mark. Present on the record so it cannot be rendered without. */
  readonly mark: typeof UNSOURCED_MARK;
  /** The source stated with the answer: which model wrote it, and that no record backs it. */
  readonly sourceLine: string;
  /** Every record the feature produces carries its tag. */
  readonly provenanceTag: "UNSOURCED_GENERAL";
}

export function unsourcedAnswer(text: string, model: string = MODELS.haiku.model): UnsourcedAnswer {
  return {
    kind: "UNSOURCED",
    text,
    mark: UNSOURCED_MARK,
    sourceLine: unsourcedSourceLine(model),
    provenanceTag: "UNSOURCED_GENERAL",
  };
}

/**
 * May this question go to the fallback?
 *
 * **The sourced path must have declined first.** That is the "last, never
 * first" clause made checkable: a caller that has not tried the router cannot
 * satisfy `routerDeclined`, and one that got an answer must render that.
 */
export function shouldFallBack(input: {
  /** Did the sourced router produce an answer? */
  routerAnswered: boolean;
  /** Did the sourced router explicitly decline — `NO_ROUTE`? */
  routerDeclined: boolean;
}): boolean {
  if (input.routerAnswered) return false;
  if (!input.routerDeclined) return false;
  return true;
}

/* ------------------------------------------------------------------------- */
/* The call itself                                                           */
/* ------------------------------------------------------------------------- */

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
/**
 * The model comes from `lib/ask/model.ts`'s role table, resolved per call so the published Admin choice
 * reaches this rung and the resolved value is what gets recorded.
 */

/** The same published instructions used by every general AI answer. */
function fallbackPrompt(): string {
  return askPlaybook("ASK_FALLBACK");
}

export interface FallbackOptions {
  /** Overridden in tests so the suite never touches the network. */
  fetchImpl?: typeof fetch;
  recordCost?: AskCostWriter;
  place?: string | null;
  signal?: AbortSignal;
  deadlineMs?: number;
}

export type FallbackOutcome =
  | { kind: "UNSOURCED"; answer: UnsourcedAnswer }
  | { kind: "UNAVAILABLE"; why: "no-key" | "error" | "declined" };

/**
 * Ask the general model, or say why not. Every failure returns `UNAVAILABLE`, and every caller renders
 * the sourced refusal for it.
 */
export async function askUnsourced(
  question: string,
  options: FallbackOptions = {},
): Promise<FallbackOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { kind: "UNAVAILABLE", why: "no-key" };

  const impl = meteredAskFetch(options.fetchImpl ?? fetch, "unsourced-fallback", options.recordCost);
  const today = new Date();
  const year = today.getUTCFullYear();
  // A new Congress starts at noon Eastern on January 3 (17:00 UTC in January).
  const congressionalYear = year % 2 === 1 && today.getTime() < Date.UTC(year, 0, 3, 17) ? year - 1 : year;
  const congress = Math.floor((congressionalYear - 1789) / 2) + 1;
  const firstYear = 1789 + (congress - 1) * 2;
  const billQuestion = /\b(?:h\s*\.?\s*r\s*\.?|s\s*\.?)\s*\d+\b/i.test(question);
  try {
    return await askModelLadder<FallbackOutcome>(async (model, signal) => {
      const fields = modelRequestFields(model, { thinking: ASK_MODEL_ROLES.UNSOURCED.thinking, effort: ASK_MODEL_ROLES.UNSOURCED.effort });
      const response = await impl(MESSAGES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: Math.max(300, fields.minMaxTokens),
          ...(fields.thinking ? { thinking: fields.thinking } : {}),
          ...(fields.effort ? { output_config: { effort: fields.effort } } : {}),
          system: [{ type: "text", text: fallbackPrompt(), cache_control: { type: "ephemeral", ttl: "1h" } }],
          tools: [{ name: "answer_reader", description: "Answer only what was asked. If you do not know the requested fact, return known=false and an empty answer; do not narrate uncertainty or suggest a lookup.",
              input_schema: { type: "object", properties: { known: { type: "boolean" }, answer: { type: "string",
                description: "The fewest words that fully answer the question, normally 5–20 words for a simple question. No background, caveats, extra figures, or repeated place/date. Empty if unknown; never substitute an approximate number for an unknown exact one." } },
                required: ["known", "answer"], additionalProperties: false } }],
          tool_choice: fields.thinking?.type === "disabled" ? { type: "tool", name: "answer_reader" } : { type: "auto" },
          // The same scrub the refusal log and the classifier already run:
          // nothing shaped like a phone number, an email or a street address
          // leaves this origin.
          messages: [{ role: "user", content: `Today: ${today.toISOString().slice(0, 10)}.${options.place ? ` Reader's ZIP or place: ${scrubFreeText(options.place)}.` : ""}${billQuestion ? ` Current Congress: ${congress} (${firstYear}–${firstYear + 1}). Unless the question gives another Congress or year, its bill number refers to this Congress.` : ""}\n\n${scrubFreeText(question)}\n\nGive only the answer; for a simple question, one short sentence. Return it with answer_reader.` }],
        }),
        signal,
      });
      if (!response.ok) throw new Error(`Ask answer HTTP ${response.status}`);

      const body = (await response.json()) as {
        stop_reason?: string;
        content?: Array<{ type?: string; text?: string; name?: string; input?: { known?: boolean; answer?: unknown } }>;
      };
      const general = body.content?.find(b => b.type === "tool_use" && b.name === "answer_reader")?.input;
      const text = general?.known === false ? "I don't know."
        : general?.known && typeof general.answer === "string" ? general.answer.trim()
        : (body.content?.find(b => b.type === "text")?.text ?? "").trim();
      if (text === "" || body.stop_reason === "max_tokens") throw new Error("Incomplete general answer");
      if (/^DECLINE\b/i.test(text)) {
        // The model judged it civic. That verdict is honoured rather than
        // second-guessed: it is the same direction our own guard points, and
        // the cost of getting it wrong is asymmetric.
        return { kind: "UNAVAILABLE", why: "declined" };
      }
      return { kind: "UNSOURCED", answer: unsourcedAnswer(text, model) };
    }, { ...options, deadlineMs: options.deadlineMs ?? Date.now() + 2_500 });
  } catch {
    return { kind: "UNAVAILABLE", why: "error" };
  }
}
import { meteredAskFetch, type AskCostWriter } from "../ask/cost.ts";
