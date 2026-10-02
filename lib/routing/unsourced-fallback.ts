/**
 * **ASK-12 (2026-08-25) — THE UNSOURCED FALLBACK, AND THE WALL AROUND IT.**
 *
 * Sean's ruling: *"try it while it's in testing. Route out-of-scope questions —
 * the 'Why is it raining?' class — to the Claude API."*
 *
 * ## The constraint is not optional and it is the whole reason this is allowed
 *
 * **A sourced civic answer and an unsourced general answer must never be
 * visually or structurally confusable.** The product's entire trust posture
 * rests on it not answering what it cannot source — the never-generate-a-
 * position rule, the transparency mandate's evidence standard, and every
 * "says who?" affordance on every card are all one commitment, and a general
 * answer that borrowed their chrome would spend it.
 *
 * So the separation is STRUCTURAL rather than stylistic, in four ways, and
 * none of them is a rendering choice a later session could tidy away:
 *
 * 1. **A different RESULT TYPE.** An unsourced answer is `UNSOURCED`, never a
 *    `RoutingAnswer`. A caller cannot render one where the other goes without
 *    the type system objecting.
 * 2. **No sources field EXISTS on it.** Enforced by absence, the RULING 112
 *    pattern: there is no `sources`, no `provenance`, no `sourceUrl` on this
 *    shape, so a Sources section cannot be populated from it even by accident.
 * 3. **The mark is PLAIN LANGUAGE and it leads.** Not a footnote, not an
 *    asterisk, not a superscript. `UNSOURCED_MARK` is a sentence a
 *    fifteen-year-old reads correctly, and it renders ABOVE the answer — a
 *    disclosure a reader meets after the claim is a disclosure they have
 *    already been misled by.
 * 4. **It is LAST, never first.** `shouldFallBack` refuses unless the sourced
 *    path has already declined. If a question can be answered from sources, it
 *    is.
 *
 * ## October 1, 2026 — Sean: Ask without a source we hold is allowed
 *
 * The switch (`ripcord.unsourcedFallback`) and the rule that a civic question
 * we have not sourced is never handed to a general model are both gone. When no
 * held record answers, Ask may answer from the Claude API (the tier named in
 * `lib/models.ts`, resolved from `lib/ask/model.ts`), on two conditions that
 * stay structural: every answer STATES THE SOURCE IT USED (`sourceLine`, on the
 * record so it cannot be rendered without) and is ULTRA SHORT, one or two
 * sentences. It still never carries a sources field, and it still comes last.
 *
 *  An unsourced answer is a generated string;
 * it is not reader signal, it is not a position, and it is not aggregated.
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
  /** RULING doctrine: every record the feature produces carries its tag. */
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
 * The model, READ FROM `lib/ask/model.ts` rather than declared here.
 * (ITEM K, 2026-09-01.)
 *
 * An Ask call site, so its model comes from the Ask role table. The literal
 * that used to sit on this line made a model change a matter of four files
 * agreeing; the import makes it one edit. Thinking off at `low` effort is unchanged
 * and was verified against `claude-sonnet-5` by an actual request.
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
/* 2026-09-25: the UNSOURCED role of `lib/ask/model.ts`'s one table, resolved per call. */
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
  return [
    "You are answering a question that a civic-information site could not answer from the public records it holds.",
    "",
    "Answer plainly, in ONE or TWO sentences at most, at a level a fifteen-year-old reads comfortably.",
    "",
    "HARD RULES:",
    "- If you are not sure, say so in one sentence. Never invent a name, a date, a number, a phone number, an address or a quote.",
    "- Never cite a source, a URL, or a document. The site states your source itself.",
    "- Never say what the site holds, covers, or has looked for.",
    "- No preamble, no sign-off, no offer to help further.",
  ].join("\n");
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
 * Ask the general model, or say why not.
 *
 * **Every failure returns `UNAVAILABLE`, and every caller renders the sourced
 * refusal for it.** A fallback that quietly produced something when it was
 * switched off, out of credit, or refused by the model would be worse than one
 * that never existed — that is the classifier's own rule, and this is the same
 * rung with more at stake.
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
        system: fallbackPrompt(),
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
