import { askPlaybook } from "../ask/runtime-settings.ts";
/**
 * The unsourced fallback: when no held record answers, Ask may answer from the Claude API (the tier
 * named in `lib/models.ts`, resolved from `lib/ask/model.ts`). It is kept structurally separate from a
 * sourced civic answer:
 * 1. A different result type: `UNSOURCED`, never a `RoutingAnswer`.
 * 2. No sources field exists on it (no `sources`, `provenance` or `sourceUrl`).
 * 3. The plain-language mark leads, above the answer.
 * 4. It is last, never first: `shouldFallBack` refuses unless the sourced path has already declined.
 * Every answer states the source it used (`sourceLine`, on the record) and is one or two sentences. An
 * unsourced answer is not reader signal, not a position, and is not aggregated.
 */
import { scrubFreeText } from "../log/scrub.ts";
import { ASK_MODEL_ROLES, resolveAskRoleModel } from "../ask/model.ts";
import { MODELS, modelRequestFields, modelTierFor } from "../models.ts";

/**
 * The mark, in plain language: this did not come from a record the site holds.
 */
export const UNSOURCED_MARK =
  "This answer did not come from any public record, and we have not checked it. It is a general answer from an AI, not something this site sourced.";

/** The source an unsourced answer states, naming the model that wrote it. */
export function unsourcedSourceLine(model: string): string {
  const tier = modelTierFor(model);
  const name = tier ? MODELS[tier].name : "Claude";
  return `Source: ${name}, general knowledge — not a public record this site holds.`;
}

/** What an unsourced answer is. Deliberately not a `RoutingAnswer`. */
export interface UnsourcedAnswer {
  readonly kind: "UNSOURCED";
  /** The generated text, verbatim. */
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
const askModel = (): string => resolveAskRoleModel("UNSOURCED");

/**
 * The system prompt, and every line of it is a constraint rather than a style.
 *
 * The model is told what it is NOT for, because the failure that matters is a
 * general model answering a civic question confidently — the router already
 * refused to route it, and a model that decides to have a go anyway would put
 * an unsourced claim about a real government in front of a reader.
 */
function fallbackPrompt(): string {
  return askPlaybook("ASK_FALLBACK");
}

export interface FallbackOptions {
  /** Overridden in tests so the suite never touches the network. */
  fetchImpl?: typeof fetch;
  recordCost?: AskCostWriter;
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
  /* Thinking OFF where the model accepts it; on an always-thinking model (Opus
     5.5, where `{type: "disabled"}` is a 400) it is omitted and `max_tokens`
     leaves room for the thinking (lib/models.ts). */
  const model = askModel();
  const fields = modelRequestFields(model, { thinking: ASK_MODEL_ROLES.UNSOURCED.thinking, effort: ASK_MODEL_ROLES.UNSOURCED.effort });
  try {
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
        // The same scrub the refusal log and the classifier already run:
        // nothing shaped like a phone number, an email or a street address
        // leaves this origin.
        messages: [{ role: "user", content: scrubFreeText(question) }],
      }),
    });
    if (!response.ok) return { kind: "UNAVAILABLE", why: "error" };

    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (body.content?.find((b) => b.type === "text")?.text ?? "").trim();
    if (text === "" || /^DECLINE\b/i.test(text)) {
      // The model judged it civic. That verdict is honoured rather than
      // second-guessed: it is the same direction our own guard points, and
      // the cost of getting it wrong is asymmetric.
      return { kind: "UNAVAILABLE", why: "declined" };
    }
    return { kind: "UNSOURCED", answer: unsourcedAnswer(text, model) };
  } catch {
    return { kind: "UNAVAILABLE", why: "error" };
  }
}
import { meteredAskFetch, type AskCostWriter } from "../ask/cost.ts";
