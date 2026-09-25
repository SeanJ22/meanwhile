import { lengthRuleForPrompt } from "./length-contract.ts";
import { gapWords, packHasEvidence, type EvidencePack } from "./evidence.ts";
import { resolveAskEffort, resolveAskModel, type AskEffort } from "./model.ts";
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
 * **THE ASK MODEL LIVES IN `lib/ask/model.ts` AND IS RE-EXPORTED HERE.**
 * (ITEM K, 2026-09-01.)
 *
 * It used to be declared on this line. It moved because the brief that
 * switched the model required ONE exported constant in ONE module carrying the
 * measurement-integrity argument for why it is a constant rather than a
 * per-environment variable — and that argument is about the whole Ask surface,
 * not about this file. `model.ts` holds it, together with the bounded
 * `WTP_ASK_MODEL` override and the resolution functions.
 *
 * The re-export is kept so `lib/ask/model-economics.ts` and the comparison
 * tests still read the model the product actually runs from the module that
 * runs it, rather than from one a session remembered.
 */
export {
  ASK_SYNTHESIS_MODEL,
  ASK_SYNTHESIS_EFFORT,
  resolveAskModel,
  resolveAskEffort,
  type AskEffort,
} from "./model.ts";

/** The synthesis rung's whole budget, request to parsed reply. Measured cold 3.5-7.2 s at medium effort. */
export const ASK_SYNTHESIS_TIMEOUT_MS = 12_000;

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export type SynthesisOutcome =
  | {
      kind: "WROTE";
      answer: string;
      citedUrls: string[];
      /**
       * **THE RESOLVED MODEL, NEVER THE DEFAULT.** (ITEM K §5, 2026-09-01.)
       *
       * Carried on the outcome so the route can persist it with the answer.
       * An artifact that does not carry its own provenance cannot be checked —
       * the same reasoning that makes a rendered position without a source
       * record a defect. Without this, a bad answer six weeks from now cannot
       * be attributed to the model, the prompt or the data, and every stored
       * answer from before a model switch is incomparable to every one after.
       */
      model: string;
      /** The resolved effort. Recorded for the same reason as `model`. */
      effort: AskEffort;
      ms: number;
      /**
       * What the API reported about cache activity on THIS call. The only
       * ground truth that caching is working; everything else is a claim about
       * the request we sent rather than about what the server did.
       */
      usage: CacheUsage;
      callerKey: AskCallerKey;
    }
  | {
      kind: "UNAVAILABLE";
      why: "no-key" | "ceiling" | "no-evidence" | "error";
      ms: number;
      /**
       * **WHY IT FAILED, CARRIED RATHER THAN COLLAPSED.** (H1, 2026-09-01.)
       *
       * Every network failure used to arrive as the bare string `error`, and a
       * production reading on 2026-09-01 hit three of them across two probe
       * runs with nothing in the trace to say whether they were a 429, a 529, a
       * function timeout or a malformed body. "It failed" is not a measurement,
       * and an operator who cannot tell a rate limit from a broken prompt will
       * eventually attribute one to the other.
       *
       * Deliberately narrow: an HTTP STATUS and Anthropic's own `error.type`
       * token, or the name of the thrown error. Never a response body, never a
       * header, never anything a reader typed. The trace's standing rule is
       * facts about OUR machinery, and a status code is exactly that.
       */
      detail?: string;
    };

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
  const agenda = pack.subject?.kind === "BODY" && pack.intent === "UPCOMING_AGENDA";
  return [
    "You are answering one resident's question about their government, using ONLY the records supplied below.",
    "",
    "Rules, all of them absolute:",
    "- Use only the supplied records. You have no other source. If something is not in the records, you do not know it.",
    "- Never state a fact about a government that the records do not contain. Do not fill a gap with what is likely, typical, or what you may remember.",
    "- The named gaps are part of the evidence. Say them plainly when they matter to the answer.",
    ...(pack.records.some(record => record.meetingListingIdentity?.uniqueMeetingCount === null)
      ? ["- Calendar listings with uniqueMeetingCount:null have an unresolved distinct-meeting count. State their source-listing count and the identity gap; never call that number a count of meetings or merge their agendas, minutes or votes."] : []),
    "- A gap marked OURS is about us — say we have not recorded it. A gap marked THEIRS is about the government — say what they have not published. Never swap these.",
    "- Never tell the reader how to vote, never rank or score candidates, and never say who to support.",
    "- Never state a candidate's or official's position, stance or vote unless a supplied record states it.",
    "- Do not announce your own failure or apologise. State what is known, name what is missing, stop.",
    "- Plain language a twelve-year-old would understand. No identifiers, no codes, no internal state names.",
    /*
     * ASK-24, the owner's Prop 141 report: *"We want a 12-year-old's definition
     * of what this proposition actually means."* The answer led with detail and
     * buried the plain meaning, so the ordering is now a rule the model is given
     * and not a hope. The relevance gate has already removed everything that is
     * not about the asked subject, so "only about what was asked" is enforced
     * upstream of this line too — this restates it because a rule the model can
     * read is one more wall than a filter it cannot.
     */
    agenda
      ? "- LEAD WITH THE HELD AGENDA: answer what is on this body's selected meeting agenda using its held agenda item titles and documents. Keep each item attached to its own meeting. A publication index is not a meeting agenda. If no agenda is held, lead with the named holding gap; never infer an empty docket or publisher absence. A sourced body-purpose explanation may be brief fallback context only when no agenda is held."
      : "- LEAD WITH THE PLAIN DEFINITION: begin with one or two short sentences saying, in the simplest words, what the thing the reader asked about actually MEANS. Say what it is before you say anything else about it.",
    agenda
      ? "- After the agenda information, add only supporting facts that answer the agenda question. Do not replace held agenda information with generic civics education."
      : "- After the definition, add only the most important supporting facts, in DESCENDING order of relevance — most important first, and stop when the important part is said. Do not list everything in the records.",
    "- Everything you write is about the ONE thing the reader asked about. Nothing about any other race, office, measure or person on the ballot belongs in the answer, even if a record mentions it.",
    agenda
      ? "- Preserve the source's meeting date and the named scope of every holding gap. Never describe missing extraction as nothing on the agenda."
      : "- Any procedural caveat — wording not final, an analysis still pending, where a title came from — comes AFTER the definition, briefly, once, and only when a record states it. It is never the lead.",
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
    /* Whose and the sentence only: a gap's machine code is never part of what the model reads. */
    namedGaps: pack.gaps.map(gapWords),
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
 * **TODAY'S DATE, AS ITS OWN BLOCK AFTER THE LAST BREAKPOINT.** (Prompt-caching
 * session, 2026-09-06.)
 *
 * The sentence is the one the system prompt used to carry, word for word.
 * It moved because it is the one per-request value that sat in front of every
 * breakpoint: the system prefix could never be shared across a midnight, and
 * every cached entry died with the calendar. Nothing about what the model is
 * told changed — only where in the request the date is said.
 */
export function synthesisDateBlock(pack: EvidencePack): string {
  return `Today is ${pack.today}.`;
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

/**
 * **THE REQUEST, BUILT IN ONE PLACE — AND THE MODEL IS AN ARGUMENT HERE AND
 * NOWHERE ELSE.** (Session C, lane H2, 2026-08-31.)
 *
 * The Ask model comparison had to call THE SAME synthesis contract on a second
 * model, and there were only two ways to do that: copy the request into a
 * harness, or build it once and let exactly one caller name the model.
 *
 * A copy is refused by RULING 103 and by arithmetic — a duplicated prompt
 * drifts, and a comparison run against a drifted copy grades a contract the
 * product does not have. So the body is built here, and the model is a
 * parameter of THIS function only.
 *
 * **`synthesizeAnswer` — the one function the production route calls — passes
 * the module constant and reads nothing from its options.** `SynthesizeOptions`
 * carries no model field, so a route, a caller key, a reader or a request
 * header has no expression that could select one. That is the law *one model
 * for all Ask traffic* made structural rather than asserted, and
 * `tests/ask-model-comparison.test.ts` asserts it mechanically: the production
 * path emits `ASK_SYNTHESIS_MODEL` even when handed an options object carrying
 * a `model` key.
 *
 * `cached` exists for the same reason and answers a different question. The
 * breakpoint is what makes the production request cheap; it is also what makes
 * a COMPARISON incomparable, because a cache read prices one model's input
 * tokens at a tenth of the other's depending only on which ran first. The
 * comparison seam therefore builds the identical request with `cached: false`
 * — see `lib/ask/model-comparison.ts` for why that is isolation rather than a
 * missing feature.
 */
export function synthesisRequestBody(
  pack: EvidencePack,
  shape: { model: string; cached: boolean; effort?: AskEffort },
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    type: "text",
    text: synthesisContextPayload(pack),
  };
  /*
   * **THE TWO BREAKPOINTS, AND WHY THEY SIT WHERE THEY DO.** (Prompt-caching
   * session, 2026-09-06.)
   *
   * The cached prefix is `model` + `system` + this first content block:
   * the constitutional rules, then the ZIP civic context — the bound
   * subject, the retrieved records, the named gaps and the denominators.
   * The reader's QUESTION is the last block, AFTER both breakpoints, which
   * is the whole mechanism: it is what lets two questions about one
   * government share a prefix at all. Today's date rides with the question
   * (`synthesisDateBlock`), so the prefix no longer dies at midnight.
   *
   * The FIRST breakpoint is on the system block. On 2026-09-01 that would
   * have fired never: the prompt rendered 471 tokens at Anthropic's
   * `count_tokens` endpoint, under the 512-token minimum of `claude-opus-5`.
   * ASK-24 (2026-09-02) grew it, and on 2026-09-06 the same endpoint counted
   * **731 tokens** on `claude-opus-5` — above the floor with room to spare —
   * so the marker is real: a question that binds a DIFFERENT subject in the
   * same window still reads the rules from the cache instead of paying for
   * them. The SECOND breakpoint, at the end of the civic context, is the one
   * that has been here since H1 and is unchanged.
   *
   * ITEM K, 2026-09-01: the minimum is a property of the MODEL (1,024 on
   * `claude-sonnet-5`), which is why the marker on the context block does
   * not fire for the product's smallest packs on that model. The measurement
   * and its consequence are in `lib/ask/prompt-cache.ts`; it is a cost fact,
   * not a correctness one, and it is not fixed here.
   *
   * The markers are ADDED rather than set to a falsy value when caching is
   * off: `cache_control: undefined` would serialise away in JSON and read
   * the same on the wire, but it would leave a key in the object that a
   * later reader could believe was doing something. With caching off the
   * system field stays the plain string the comparison seam measures.
   */
  if (shape.cached) context.cache_control = SYNTHESIS_CACHE_TTL.cacheControl;
  const system: string | { type: "text"; text: string; cache_control: typeof SYNTHESIS_CACHE_TTL.cacheControl }[] = shape.cached
    ? [{ type: "text", text: synthesisPrompt(pack), cache_control: SYNTHESIS_CACHE_TTL.cacheControl }]
    : synthesisPrompt(pack);

  return {
    model: shape.model,
    /*
     * **THE OUTPUT CEILING, RE-COUNTED ON SONNET 5 AND LEFT WHERE IT WAS.**
     * (ITEM K, 2026-09-01.)
     *
     * 2048 is not a budget derived from the prompt; it is a ceiling on the one
     * unbounded term, and the term it bounds is small by contract — ASK-19
     * caps a rendered answer at 700 characters and five sentences. The
     * canonical corpus was re-measured against this model rather than assumed
     * — the per-question output token counts are in the ITEM K run record
     * under `data/health/ask-model-compare-runs/` — and every answer landed an
     * order of magnitude under the ceiling, so it did not need to move.
     *
     * It is deliberately NOT tightened toward the observed mean, and the
     * effort sweep showed exactly why. Adaptive thinking is on and thinking
     * tokens count against `max_tokens`: at `xhigh` and `max` the structured
     * answer is truncated mid-string and arrives as an unparseable body or no
     * text block at all — three of four canonical questions failed that way at
     * `max`. A ceiling that clips a thinking-heavy draw truncates an answer
     * mid-claim, which is the one failure mode this surface may not have.
     *
     * So this number and `ASK_SYNTHESIS_EFFORT` are COUPLED. Raising effort
     * above `high` requires raising this first, and a session that moves one
     * without the other will meet the truncation rather than a slower answer.
     *
     * **ASK-25 (2026-09-02) considered LOWERING this and did not.** The owner's
     * report was token burn — *"pumping out way more information than what is
     * asked."* But `max_tokens` only CAPS a draw; it does not shrink a
     * well-behaved answer, so lowering it saves nothing on the answers the
     * reader actually gets and only moves the truncation cliff closer to the
     * adaptive-thinking budget that already sits under it. The token burn is cut
     * where it is actually spent: the relevance gate (`lib/ask/relevance.ts`)
     * hands the model a pack with the off-subject records removed — fewer input
     * tokens, and fewer facts to write about — and the definition-first length
     * contract in `synthesisPrompt` stops the model enumerating the records. The
     * ceiling stays a safety ceiling.
     */
    max_tokens: 2048,
    /*
     * ADAPTIVE, and it is the only on-mode Sonnet 5 accepts. The manual form
     * — `{type: "enabled", budget_tokens: N}` — is REMOVED on this model
     * generation and answers 400. There is no thinking budget to tune here;
     * `effort` below is the whole of the depth control.
     */
    thinking: { type: "adaptive" },
    output_config: {
      /*
       * PINNED, never omitted. An omitted `effort` defaults to `high` on the
       * Claude API, and thinking tokens bill at the OUTPUT rate — so omitting
       * it is not a neutral default, it is the most expensive setting chosen
       * by accident. The value is `lib/ask/model.ts`'s resolved one so the
       * override and the recorded value cannot disagree.
       */
      effort: shape.effort ?? resolveAskEffort(),
      format: { type: "json_schema", schema: synthesisSchema() },
    },
    /*
     * **UNCHANGED, BYTE FOR BYTE, FROM ONE REQUEST TO THE NEXT.** The system
     * field is the front of the cached prefix and the one thing in this
     * request that must not move; since 2026-09-06 it carries nothing that
     * varies by the day. `thinking` and `output_config.effort` are likewise
     * pinned per route rather than varied per request — changing either
     * invalidates the messages cache on every model, and on some models the
     * system cache with it.
     */
    system,
    messages: [
      {
        role: "user",
        content: [context, { type: "text", text: synthesisDateBlock(pack) }, { type: "text", text: synthesisQuestionPayload(pack) }],
      },
    ],
  };
}

/** The Anthropic Messages endpoint, shared by the live path and the seam. */
export const SYNTHESIS_MESSAGES_URL = MESSAGES_URL;

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

  /*
   * **RESOLVED ONCE, HERE, AND USED FOR BOTH THE REQUEST AND THE RECORD.**
   *
   * Reading the environment twice — once to build the body and once to write
   * the outcome — is how a record comes to disagree with what was actually
   * sent. One read, one pair of values, one truth.
   */
  const model = resolveAskModel();
  const effort = resolveAskEffort();

  const impl = options.fetchImpl ?? fetch;
  try {
    const response = await impl(MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      /*
       * **THE MODEL IS RESOLVED FROM `lib/ask/model.ts` AND NOTHING ELSE
       * READS IT IN.**
       *
       * `options` is not consulted for a model here and carries no field that
       * could supply one. One model for all Ask traffic is not a convention
       * this line follows; it is the only expression this line can write. The
       * `WTP_ASK_MODEL` override is a DEPLOYMENT-wide value read once above —
       * it cannot vary by caller, by reader or by request, so it does not
       * fragment the model-scoped prompt cache.
       */
      body: JSON.stringify(synthesisRequestBody(pack, { model, cached: true, effort })),
      // A bounded wait (2026-09-24). Past the bound the records still ship as
      // the structured answer; an unbounded call could outlive the platform
      // limit and deliver the reader nothing at all.
      signal: AbortSignal.timeout(ASK_SYNTHESIS_TIMEOUT_MS),
    });
    if (!response.ok) {
      /* The status, and Anthropic's own error TYPE token if it sent one. The
         message is not read: the type is the diagnosable part and free text is
         how a body ends up somewhere it was never meant to be. */
      let kind = "";
      try {
        const failure = (await response.json()) as { error?: { type?: unknown } };
        if (typeof failure?.error?.type === "string") kind = ` ${failure.error.type}`;
      } catch {
        /* A non-JSON error body tells us nothing more than the status did. */
      }
      return {
        kind: "UNAVAILABLE",
        why: "error",
        ms: elapsed(),
        detail: `HTTP ${response.status}${kind}`,
      };
    }

    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    if (!text) {
      return { kind: "UNAVAILABLE", why: "error", ms: elapsed(), detail: "no text block" };
    }
    const parsed = JSON.parse(text) as { answer?: unknown; citedUrls?: unknown };
    if (typeof parsed.answer !== "string" || parsed.answer.trim().length === 0) {
      return { kind: "UNAVAILABLE", why: "error", ms: elapsed(), detail: "no answer string" };
    }
    return {
      kind: "WROTE",
      answer: parsed.answer.trim(),
      citedUrls: Array.isArray(parsed.citedUrls)
        ? parsed.citedUrls.filter((u): u is string => typeof u === "string")
        : [],
      model,
      effort,
      ms: elapsed(),
      /* Read off the response, never inferred from the request we sent. A
         missing usage block is zero MEASURED, never an assumed hit. */
      usage: readCacheUsage(body),
      callerKey,
    };
  } catch (error) {
    /* The error's NAME only — `TypeError`, `AbortError`. Enough to separate a
       transport failure from a timeout, and nothing a message could carry. */
    return {
      kind: "UNAVAILABLE",
      why: "error",
      ms: elapsed(),
      detail: error instanceof Error ? error.name : "threw a non-Error",
    };
  }
}
