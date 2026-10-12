import { scrubFreeText } from "../log/scrub.ts";
import { resolveAskRoleModel, ASK_MODEL_ROLES } from "./model.ts";
import { modelRequestFields, servedModelOf } from "../models.ts";
import { asksForBodyAgenda } from "../routing/named-entity.ts";
import { askHedgeMs, hedgedFetch } from "./hedged-fetch.ts";
import { SYNTHESIS_CACHE_TTL } from "./prompt-cache.ts";

import {
  readInterpretation,
  unavailableInterpretation,
  ASK_INTENTS,
  type AskInterpretation,
} from "./intent.ts";

/**
 * The interpretation rung: a model reads the question with the civic context
 * a reading requires (the governments that exist, with their division types;
 * today's date; the bounded conversation so far). It returns a reading, not an
 * answer, and sees no record. Every entity it names is a hypothesis that
 * `resolve.ts` reconciles against the registry; an invented mention resolves to
 * `UNRESOLVED`. The inventory is names the product already renders, and the
 * question is scrubbed before it leaves.
 */

/** The interpretation rung's whole budget, request to parsed reply. Measured median ~2.8-3.4 s. */
export const ASK_INTERPRET_TIMEOUT_MS = 6_000;

export interface InterpretContext {
  /**
   * What the reader could be naming: names and division types only. No ids,
   * since an echoed id would look like a resolution.
   */
  inventory: readonly { name: string; divisionType?: string | null }[];
  /** `YYYY-MM-DD`. Supplied, never derived here — this module is not a clock. */
  today: string;
  /** The reader's own area, for orientation only. */
  approximateLocation?: string | null;
  /** Which surface asked. Ballot questions carry different default referents. */
  surface?: "MAP" | "BALLOT" | "UNKNOWN";
  /** The conversation context the reader's device supplied. */
  priorTurns?: readonly { question: string; resolvedSubject: string | null }[];
  /** What the reader currently has open, when the surface can say. */
  activeSubjects?: readonly string[];
}

export type InterpretOutcome =
  | { kind: "READ"; interpretation: AskInterpretation; model: string; servedModel?: string | null; ms: number }
  | { kind: "UNAVAILABLE"; why: "ripcord" | "ceiling" | "no-key" | "error"; ms: number };

/** How much of the inventory the model is shown. Bounded for cost and latency. */
export const MAX_INVENTORY = 240;

/**
 * The READER role from `lib/ask/model.ts`, resolved per call so overrides
 * apply. Thinking is on here (unlike the classifier): this rung decides a
 * tense, an entity and a referent together.
 */
const askModel = (): string => resolveAskRoleModel("READER");
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
 * The instruction, about reading, never answering. Two parts: the stable part
 * (instructions and the ZIP's governments and people) is byte-identical per
 * ZIP and is the cached prefix; the date, location and surface follow it.
 */
export function interpretSystem(context: InterpretContext): { stable: string; volatile: string } {
  const inventory = context.inventory
    .slice(0, MAX_INVENTORY)
    .map((e) => (e.divisionType ? `${e.name} (${e.divisionType})` : e.name));

  const stable = [
    "You are reading one question a resident asked about their government, and reporting what it MEANS. You are not answering it and you will not be shown any records.",
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
  ].join("\n");

  const volatile = [
    `Today is ${context.today}.`,
    context.approximateLocation
      ? `The reader has told us they are in ${context.approximateLocation}.`
      : "The reader has not told us where they are.",
    context.surface === "BALLOT"
      ? "They are looking at their ballot."
      : context.surface === "MAP"
        ? "They are looking at the map of governments near them."
        : "",
  ].filter((line) => line !== "").join("\n");
  return { stable, volatile };
}

/** The whole instruction as one string: the stable part, then the volatile one. */
export function interpretPrompt(context: InterpretContext): string {
  const { stable, volatile } = interpretSystem(context);
  return `${stable}\n\n${volatile}`;
}

export interface InterpretOptions {
  fetchImpl?: typeof fetch;
  recordCost?: AskCostWriter;
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

  const impl = meteredAskFetch(options.fetchImpl ?? fetch, "interpret", options.recordCost);
  /* Resolved once: the same id is sent and recorded. */
  const model = askModel();
  const fields = modelRequestFields(model, { thinking: ASK_MODEL_ROLES.READER.thinking, effort: ASK_MODEL_ROLES.READER.effort });
  const priorTurns = context.priorTurns ?? [];
  const system = interpretSystem(context);

  /*
   * Prior turns ride as real messages: only each question and what it resolved
   * to, never the prior answers.
   */
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of priorTurns) {
    messages.push({ role: "user", content: scrubFreeText(turn.question) });
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
    content: scrubFreeText(question),
  });

  try {
    // A bounded wait: past it the deterministic reading stands in. A slow
    // reading is asked again at the hedge time (lib/ask/hedged-fetch.ts).
    const response = await hedgedFetch(impl, MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.max(1024, fields.minMaxTokens),
        /* The READER role's thinking and effort, as the registry says the model accepts them. */
        ...(fields.thinking ? { thinking: fields.thinking } : {}),
        output_config: {
          ...(fields.effort ? { effort: fields.effort } : {}),
          format: { type: "json_schema", schema: interpretSchema() },
        },
        /* The ZIP's context is the cached prefix; the date and the surface follow it (interpretSystem). */
        system: [
          { type: "text", text: system.stable, cache_control: SYNTHESIS_CACHE_TTL.cacheControl },
          { type: "text", text: system.volatile },
        ],
        messages,
      }),
    }, { hedgeAfterMs: askHedgeMs(), timeoutMs: ASK_INTERPRET_TIMEOUT_MS });
    if (!response.ok) return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };

    const body = (await response.json()) as {
      model?: unknown;
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    if (!text) return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };
    return {
      kind: "READ",
      interpretation: readInterpretation(JSON.parse(text)),
      model,
      servedModel: servedModelOf(body),
      ms: elapsed(),
    };
  } catch {
    return { kind: "UNAVAILABLE", why: "error", ms: elapsed() };
  }
}

/**
 * The deterministic fallback when the model rung did not run. It reads tense
 * only; entity mentions stay empty, so the binder alone names a government.
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
  /* Past beats future when both appear: answering a past question with a future agenda invents a discussion. */
  if (pastWords && !nextWords) return { ...base, temporal: { kind: "LAST" } };
  if (nextWords && !pastWords) return { ...base, temporal: { kind: "NEXT" } };
  if (pastWords && nextWords) return { ...base, temporal: { kind: "LAST" } };

  /* "What's on the agenda" with no time words is the next sitting (`asksForBodyAgenda`). */
  if (asksForBodyAgenda(question)) return { ...base, temporal: { kind: "NEXT" } };

  return base;
}
import { meteredAskFetch, type AskCostWriter } from "./cost.ts";
