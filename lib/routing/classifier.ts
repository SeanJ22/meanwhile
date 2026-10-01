import { scrubFreeText } from "../log/scrub.ts";
import { ASK_MODEL_ROLES, resolveAskRoleModel } from "../ask/model.ts";
import { modelRequestFields, servedModelOf } from "../models.ts";

import { TOPIC_ROUTES } from "./topics.ts";

/**
 * **The Level 1 classifier — 6d, built 2026-08-15.**
 *
 * The ask box matches a question against curated keyword lists (`match.ts`)
 * and refuses when the evidence does not decide. That refusal is honest and
 * it is also the product's biggest gap: the refusal log is full of questions
 * a person could route in a second — "who fixes the light outside my house",
 * "the field behind the school is flooded" — that share no keyword with any
 * curated list.
 *
 * This is the second rung, and it is deliberately the *smallest* thing that
 * closes that gap:
 *
 * - **Keyword-first, always.** The classifier is only consulted when
 *   `matchTopic` returns null. A question the deterministic matcher can route
 *   never leaves the device, and the classifier can never overrule it.
 * - **A closed enum, twice.** The model is given the curated topic ids and
 *   told to answer with exactly one of them or `NONE`, through a JSON schema
 *   that constrains the response — and the answer is then checked against the
 *   same list here, because a schema is a contract with a server and this is
 *   a claim about a government.
 * - **It picks a topic. It never writes one.** The reader-facing answer is
 *   the same curated route the keyword path produces, assembled from the same
 *   registry and the same sourced people. **No sentence a reader sees is ever
 *   generated** — the model's entire output is one identifier out of a fixed
 *   list, and nothing else it says is read. That is what keeps this inside
 *   CLAUDE.md's no-generation rule rather than beside it.
 * - **The question is scrubbed before it leaves.** The same scrub the refusal
 *   log runs — phone-, email- and address-shaped text blanked — applies here
 *   too, so nothing shaped like a personal detail is sent anywhere.
 * - **A cache and a ceiling.** Identical questions are answered from memory;
 *   a daily call ceiling bounds spend, and the ceiling REFUSES rather than
 *   degrading — an over-ceiling ask gets the honest keyword refusal it would
 *   have had, never a worse answer dressed as an answer.
 * - **`ripcord.askClassifier`.** One flag turns the rung off entirely and the
 *   box returns to keyword-only, which is a complete product on its own.
 *
 * Nothing here is client-reachable: the route is the only caller, the key
 * never leaves the server, and the question is not stored by this module.
 */

/** The answer this rung is allowed to give: one curated topic, or nothing. */
export const NO_TOPIC = "NONE";

export type ClassifierOutcome =
  | { kind: "TOPIC"; topicId: string; model?: string; servedModel?: string | null }
  | { kind: "NONE"; model?: string; servedModel?: string | null }
  /** The rung did not run. The caller falls back to the keyword refusal. */
  | { kind: "UNAVAILABLE"; why: "ripcord" | "ceiling" | "no-key" | "error" };

/** Every id the model may answer with. Read off the curated routes. */
export function classifiableTopicIds(): string[] {
  return TOPIC_ROUTES.map((route) => route.id);
}

/**
 * The model's whole instruction. Deliberately short and deliberately about
 * *choosing*, not about writing: the words "answer", "explain" and "advise"
 * do not appear, because the model is not doing any of those things.
 */
export function classifierPrompt(): string {
  const lines = TOPIC_ROUTES.map((route) => `${route.id}: ${route.label}`);
  return [
    "You are labelling one question with one topic from a fixed list.",
    "The question comes from a resident of a US town asking who in local, state, or federal government handles a problem.",
    "",
    "The topics:",
    ...lines,
    "",
    `Answer with exactly one id from that list, or ${NO_TOPIC} if the question does not clearly belong to any of them.`,
    `${NO_TOPIC} is a correct and expected answer. Do not stretch a question to fit a topic.`,
    "Do not explain, do not add anything, and do not answer the question itself.",
  ].join("\n");
}

/** The JSON schema the response is constrained to — the enum, on the wire. */
export function classifierSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      topic: { type: "string", enum: [...classifiableTopicIds(), NO_TOPIC] },
    },
    required: ["topic"],
    additionalProperties: false,
  };
}

/**
 * Validate the model's answer against the closed list.
 *
 * Belt and braces over the schema: the schema is a promise made by a server,
 * and an id that reached the routing map without being on this list would be
 * a route this product never curated. Anything unrecognised is `NONE`.
 */
export function readClassifierAnswer(raw: unknown): ClassifierOutcome {
  if (typeof raw !== "string") return { kind: "NONE" };
  const value = raw.trim();
  if (value === NO_TOPIC) return { kind: "NONE" };
  return classifiableTopicIds().includes(value)
    ? { kind: "TOPIC", topicId: value }
    : { kind: "NONE" };
}

/** Normalized cache key — the same question asked twice costs once. */
export function cacheKey(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The in-process cache and the daily ceiling.
 *
 * Both are per-instance and deliberately so: this is a cost bound and a
 * repeat-question saver, not a store. Nothing here is keyed to a person —
 * the cache key is the question's own words, the counter is a bare integer,
 * and neither is written anywhere or joined to anything. The reaction store's
 * n-stores rule is not in play because there is no store.
 */
const CACHE_MAX = 500;
const cache = new Map<string, ClassifierOutcome>();
let spentOn = "";
let spent = 0;

export function classifierCeiling(): number {
  const raw = Number(process.env.WTP_ASK_CLASSIFIER_DAILY_MAX);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 500;
}

/** Today in UTC — the counter's own day, not the reader's. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function classifierSpendToday(): { day: string; calls: number; ceiling: number } {
  if (spentOn !== today()) return { day: today(), calls: 0, ceiling: classifierCeiling() };
  return { day: spentOn, calls: spent, ceiling: classifierCeiling() };
}

/** Test seam — the suite must never inherit another test's counter. */
export function resetClassifierState(): void {
  cache.clear();
  spentOn = "";
  spent = 0;
}

function noteCall(): boolean {
  const day = today();
  if (spentOn !== day) {
    spentOn = day;
    spent = 0;
  }
  if (spent >= classifierCeiling()) return false;
  spent += 1;
  return true;
}

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

/**
 * The model, READ FROM `lib/ask/model.ts` rather than declared here.
 * (ITEM K, 2026-09-01.)
 *
 * This rung is an Ask call site — the ask box's second rung — so *one model
 * for all Ask traffic* binds it. It used to declare its own `claude-opus-5`
 * literal, and a rule enforced by four literals being equal is a rule that
 * survives only as long as everyone remembers to change all four. Importing
 * the shared constant makes it structural: there is no expression here that
 * could name a different model.
 *
 * `low` effort with thinking off is unchanged and is still this rung's own
 * choice — the task is one label out of sixteen. The cost lever remains effort
 * and the ceiling. Verified against `claude-sonnet-5` by an actual request:
 * thinking-disabled at `low` effort answers HTTP 200 on this model.
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
/* 2026-09-25: the CLASSIFIER role of `lib/ask/model.ts`'s one table, resolved per call. */
const askModel = (): string => resolveAskRoleModel("CLASSIFIER");

export interface ClassifyOptions {
  /** Overridden in tests so the suite never touches the network. */
  fetchImpl?: typeof fetch;
  recordCost?: AskCostWriter;
}

/**
 * Classify one question. Returns `UNAVAILABLE` for every reason the rung did
 * not run, and the caller renders the honest keyword refusal in each case —
 * a classifier that quietly guesses when it is switched off would be worse
 * than one that never existed.
 */
export async function classifyQuestion(
  question: string,
  options: ClassifyOptions = {},
): Promise<ClassifierOutcome> {
  const key = cacheKey(question);
  if (!key) return { kind: "NONE" };
  const hit = cache.get(key);
  if (hit) return hit;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { kind: "UNAVAILABLE", why: "no-key" };
  if (!noteCall()) return { kind: "UNAVAILABLE", why: "ceiling" };

  const impl = meteredAskFetch(options.fetchImpl ?? fetch, "classifier", options.recordCost);
  /* Resolved once: the same id is sent and recorded. Thinking OFF where the
     model accepts `{type: "disabled"}`; on a model that always thinks (Opus
     5.5, where the field is a 400) it is omitted, effort stays low and
     `max_tokens` leaves room for the thinking (lib/models.ts). */
  const model = askModel();
  const fields = modelRequestFields(model, { thinking: ASK_MODEL_ROLES.CLASSIFIER.thinking, effort: ASK_MODEL_ROLES.CLASSIFIER.effort });
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
        max_tokens: Math.max(64, fields.minMaxTokens),
        ...(fields.thinking ? { thinking: fields.thinking } : {}),
        output_config: {
          ...(fields.effort ? { effort: fields.effort } : {}),
          format: { type: "json_schema", schema: classifierSchema() },
        },
        system: classifierPrompt(),
        // The scrub the refusal log already runs. Nothing shaped like a
        // phone number, an email address or a street address leaves here.
        messages: [{ role: "user", content: scrubFreeText(question) }],
      }),
    });
    if (!response.ok) return { kind: "UNAVAILABLE", why: "error" };

    const body = (await response.json()) as {
      model?: unknown;
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as { topic?: unknown };
    /* The label, plus the model asked and the model the API says served it. */
    const label = readClassifierAnswer(parsed.topic);
    const outcome: ClassifierOutcome = label.kind === "UNAVAILABLE" ? label : { ...label, model, servedModel: servedModelOf(body) };
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, outcome);
    return outcome;
  } catch {
    // Every failure is the same answer to the reader: the keyword refusal.
    return { kind: "UNAVAILABLE", why: "error" };
  }
}
import { meteredAskFetch, type AskCostWriter } from "../ask/cost.ts";
