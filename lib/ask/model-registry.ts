import {
  cacheReadMultiplierFor,
  MODEL_ID_ALIASES,
  minimumCacheablePrefixTokensFor,
  rateFor,
  type ModelRate,
} from "../control-plane/model-cost.ts";

/**
 * **THE ASK MODEL REGISTRY — every model Ask may send a request to, and what
 * each one accepts.** (2026-09-25, the Ask model-routing test.)
 *
 * Sean, 2026-09-25 7:50 PM MST: *"Models release fairly consistently — and we
 * may at some point use multiple LLMs to source answers. Changing a model
 * should be easy."* So a model is DATA here, not a literal at a call site:
 *
 * - its id and provider (only `anthropic` today; the field exists so a second
 *   provider is an entry, not a rewrite);
 * - the request fields it accepts — adaptive thinking, `output_config.effort`,
 *   `thinking: {type: "disabled"}`, JSON-schema output, assistant prefill;
 * - its minimum cacheable prefix and its price, READ from the control-plane
 *   rate table (`lib/control-plane/model-cost.ts`) so Ask and the fleet price
 *   a model from one row.
 *
 * Every Ask request (reading, both writers, the topic classifier, the
 * unsourced fallback) builds its thinking and effort fields through
 * `askRequestFields`, so no role can send a field its model rejects. The
 * roles and their defaults are `lib/ask/model.ts`; this module only says what
 * a model IS.
 *
 * **`claude-opus-5` is RETIRED** (Sean, 2026-09-25 7:25 PM MST: *"Opus 5 must
 * not be used any more, not as a test subject, default or fallback"*, and
 * 7:50 PM: *"out of the rotation completely"*). It is not an entry, so nothing
 * can select it: an override naming it is refused by name. Its control-plane
 * rate row stays, for billing history only.
 */

export type AskModelProvider = "anthropic";

export interface AskModelCapabilities {
  /** Accepts `thinking: {type: "adaptive"}`. */
  readonly adaptiveThinking: boolean;
  /** Accepts `output_config.effort`. */
  readonly effort: boolean;
  /**
   * Accepts `thinking: {type: "disabled"}`. False on Claude Opus 5.5, where
   * thinking is always on and the field is HTTP 400 at every effort level
   * (claude-api reference, "Migrating to Claude Opus 5.5", breaking change 1).
   */
  readonly thinkingDisabled: boolean;
  /** Accepts `output_config.format` with a JSON schema. */
  readonly jsonSchemaOutput: boolean;
  /** Accepts a last-assistant-turn prefill. Ask sends none; recorded so a future rung cannot assume it. */
  readonly prefill: boolean;
  /**
   * Thinking always runs (it cannot be disabled), and thinking tokens count
   * against `max_tokens` — so a rung sized for a no-thinking reply (the
   * classifier's 64 tokens) must leave room.
   */
  readonly alwaysThinks: boolean;
}

export interface AskModelEntry {
  readonly id: string;
  readonly provider: AskModelProvider;
  readonly displayName: string;
  readonly capabilities: AskModelCapabilities;
  /** Where the capabilities were read, and when. */
  readonly statedOn: string;
  readonly source: string;
}

/**
 * The supported models. Order carries no meaning; roles pick by id.
 * Capabilities read from the claude-api reference's thinking/effort table
 * (cached 2026-06-24) and its Opus 5.5 migration section, and CHECKED against
 * live requests in the 2026-09-25 routing test (evidence under
 * meanwhile-evidence/admin-completion/2026-09-25/ask-model-test/): Haiku 4.5
 * answered `thinking: {type: "disabled"}` with no effort field HTTP 200 on 17
 * classifier calls, and a JSON schema with neither field on every reading and
 * writing call; Opus 5.5 and Sonnet 5 answered adaptive thinking with an
 * effort field and a JSON schema HTTP 200 on every reading and writing call.
 */
export const ASK_MODEL_REGISTRY: readonly AskModelEntry[] = [
  {
    id: "claude-opus-5-5",
    provider: "anthropic",
    displayName: "Claude Opus 5.5",
    capabilities: { adaptiveThinking: true, effort: true, thinkingDisabled: false, jsonSchemaOutput: true, prefill: false, alwaysThinks: true },
    statedOn: "2026-09-25",
    source: "claude-api reference, Migrating to Claude Opus 5.5 (thinking cannot be disabled; forced tool_choice 400; effort default medium)",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 5",
    capabilities: { adaptiveThinking: true, effort: true, thinkingDisabled: true, jsonSchemaOutput: true, prefill: false, alwaysThinks: false },
    statedOn: "2026-09-25",
    source: "claude-api reference, thinking & effort table (Sonnet 5: adaptive is the only on-mode; disabled accepted)",
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    capabilities: { adaptiveThinking: false, effort: false, thinkingDisabled: true, jsonSchemaOutput: true, prefill: true, alwaysThinks: false },
    statedOn: "2026-09-25",
    source: "claude-api reference, thinking & effort table (Haiku 4.5: budget_tokens only; effort errors)",
  },
];

/**
 * Models Ask must never select, each with the reason an override naming it is
 * refused. A retired model is not an entry, so no resolver can return it.
 */
export const ASK_RETIRED_MODELS: Readonly<Record<string, string>> = {
  "claude-opus-5": "retired from Ask on 2026-09-25 (Sean: out of the rotation completely); use claude-opus-5-5",
};

/** The id a request is sent with, aliases resolved (`claude-haiku-4-5-20251001` is `claude-haiku-4-5`). */
export function canonicalAskModelId(model: string): string {
  const trimmed = model.trim();
  return MODEL_ID_ALIASES[trimmed] ?? trimmed;
}

export function askModelEntry(model: string): AskModelEntry | null {
  const id = canonicalAskModelId(model);
  return ASK_MODEL_REGISTRY.find((entry) => entry.id === id) ?? null;
}

/** Why this id may not be sent, or null when it may. A retired or unknown id is refused, never guessed at. */
export function askModelRefusal(model: string): string | null {
  const id = canonicalAskModelId(model);
  if (ASK_RETIRED_MODELS[id]) return `${id} ${ASK_RETIRED_MODELS[id]}`;
  if (!askModelEntry(id)) return `${id} is not in the Ask model registry (lib/ask/model-registry.ts)`;
  return null;
}

/** The price of a model, from the control-plane rate table; null when no row is stated. */
export function askModelPrice(model: string): { rate: ModelRate; cacheReadMultiplier: number; cacheMinimumTokens: number | null } | null {
  const rate = rateFor(canonicalAskModelId(model));
  if (!rate) return null;
  return {
    rate,
    cacheReadMultiplier: cacheReadMultiplierFor(canonicalAskModelId(model)),
    cacheMinimumTokens: minimumCacheablePrefixTokensFor(canonicalAskModelId(model)),
  };
}

/** How a rung wants the model to think: ADAPTIVE (reading, writing) or OFF where the model allows (classifier, fallback). */
export type AskThinkingMode = "ADAPTIVE" | "OFF";

export interface AskRequestFields {
  /** The `thinking` field to send, or absent when the model must not be sent one. */
  readonly thinking?: { readonly type: "adaptive" } | { readonly type: "disabled" };
  /** `output_config.effort` to send, or absent when the model takes none. */
  readonly effort?: string;
  /** The smallest `max_tokens` this rung may send this model (thinking counts against it). */
  readonly minMaxTokens: number;
}

/**
 * **THE ONE PLACE A REQUEST'S THINKING AND EFFORT FIELDS ARE DECIDED.**
 *
 * - ADAPTIVE: `{type: "adaptive"}` where the model takes it; omitted on a
 *   model that does not (Haiku 4.5, which then writes without thinking).
 * - OFF: `{type: "disabled"}` where the model accepts it; otherwise omitted,
 *   which on an always-thinking model (Opus 5.5) runs adaptive at the given
 *   effort — the only control it has.
 * - effort: sent only to a model that takes it.
 * - An always-thinking model gets `max_tokens` room for its thinking.
 *
 * An unregistered id gets the most conservative fields — no thinking field,
 * no effort — which every Anthropic model accepts; the resolvers in
 * `lib/ask/model.ts` refuse such an id before it gets here.
 */
export function askRequestFields(model: string, want: { thinking: AskThinkingMode; effort: string | null }): AskRequestFields {
  const entry = askModelEntry(model);
  if (!entry) return { minMaxTokens: 0 };
  const caps = entry.capabilities;
  const thinking = want.thinking === "ADAPTIVE"
    ? (caps.adaptiveThinking ? { type: "adaptive" as const } : undefined)
    : (caps.thinkingDisabled ? { type: "disabled" as const } : undefined);
  return {
    ...(thinking ? { thinking } : {}),
    ...(caps.effort && want.effort ? { effort: want.effort } : {}),
    minMaxTokens: caps.alwaysThinks ? ALWAYS_THINKS_MIN_MAX_TOKENS : 0,
  };
}

/**
 * Room for an always-thinking model's thinking on a rung whose reply is tiny
 * (the classifier's one id). Measured 2026-09-25: Opus 5.5 at `low` effort
 * with the classifier's old `max_tokens: 64` spent all 64 tokens thinking and
 * returned NO text on both draws of "My neighbor's dog barks all night. Who do
 * I call?" (HTTP 200, output 64) — the rung would have failed. This is a
 * ceiling, not a spend: most calls use a small fraction of it.
 */
export const ALWAYS_THINKS_MIN_MAX_TOKENS = 1024;

/** The `model` the API says served a response — recorded beside the id we asked for. */
export function servedModelOf(body: unknown): string | null {
  const model = (body as { model?: unknown } | null)?.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}
