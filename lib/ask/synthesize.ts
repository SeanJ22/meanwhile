import { lengthRuleForPrompt } from "./length-contract.ts";
import { packHasEvidence, type EvidencePack } from "./evidence.ts";

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

const MODEL = "claude-opus-5";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export type SynthesisOutcome =
  | { kind: "WROTE"; answer: string; citedUrls: string[]; model: string; ms: number }
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

/** The pack, as the model sees it. JSON so nothing is lost in prose framing. */
export function synthesisPayload(pack: EvidencePack): string {
  return JSON.stringify(
    {
      question: pack.question,
      whatTheyAreAskingFor: pack.intent,
      timeframe: pack.temporal,
      subject: pack.subject,
      records: pack.records,
      namedGaps: pack.gaps,
      whatWasSearched: pack.denominators,
    },
    null,
    1,
  );
}

export interface SynthesizeOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  allowCall?: () => boolean;
}

export async function synthesizeAnswer(
  pack: EvidencePack,
  options: SynthesizeOptions = {},
): Promise<SynthesisOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;

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
        system: synthesisPrompt(pack),
        messages: [{ role: "user", content: synthesisPayload(pack) }],
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
    };
  } catch {
    return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };
  }
}
