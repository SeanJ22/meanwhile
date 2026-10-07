/**
 * Execution tiers, cheapest first. Prices are USD per million tokens. `capabilities` says what each model accepts in a
 * request; Ask builds every request's thinking and effort fields from these.
 */
export const MODELS = {
  haiku: {
    model: "claude-haiku-4-5", name: "Claude Haiku 4.5",
    inputUsdPerMillion: 1, outputUsdPerMillion: 5,
    minimumCacheablePrefixTokens: 4096, cacheReadMultiplier: 0.1,
    contextWindowTokens: 200_000, maxOutputTokens: 64_000,
    capabilities: { adaptiveThinking: false, effort: false, thinkingDisabled: true, betweenToolsThinking: false, jsonSchemaOutput: true, prefill: true, alwaysThinks: false },
  },
  sonnet: {
    model: "claude-sonnet-5-5", name: "Claude Sonnet 5.5",
    inputUsdPerMillion: 2, outputUsdPerMillion: 10,
    minimumCacheablePrefixTokens: 512, cacheReadMultiplier: 0.1,
    contextWindowTokens: 1_000_000, maxOutputTokens: 128_000,
    capabilities: { adaptiveThinking: true, effort: true, thinkingDisabled: false, betweenToolsThinking: true, jsonSchemaOutput: true, prefill: false, alwaysThinks: true },
  },
  opus: {
    model: "claude-opus-5-5", name: "Claude Opus 5.5",
    inputUsdPerMillion: 4, outputUsdPerMillion: 20,
    minimumCacheablePrefixTokens: 512, cacheReadMultiplier: 0.05,
    contextWindowTokens: 1_000_000, maxOutputTokens: 128_000,
    capabilities: { adaptiveThinking: true, effort: true, thinkingDisabled: false, betweenToolsThinking: false, jsonSchemaOutput: true, prefill: false, alwaysThinks: true },
  },
} as const;

export type ModelTier = keyof typeof MODELS;
export const MODEL_TIERS = ["haiku", "sonnet", "opus"] as const;
/** Provider protocol maxima used to bound historical unmetered sends, not new application caps. */
export const MODEL_LIMIT_SOURCE = "https://platform.claude.com/docs/en/models/overview";
export const MODEL_PRICE_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
export const MODEL_PRICES_STATED_ON = "2026-09-29";

export function modelTierFor(model: string): ModelTier | null {
  return MODEL_TIERS.find((tier) => tier === model || MODELS[tier].model === model) ?? null;
}

/** What a model accepts in a request. Read from `MODELS[tier].capabilities`. */
export interface ModelCapabilities {
  /** Accepts `thinking: {type: "adaptive"}`. */
  readonly adaptiveThinking: boolean;
  /** Accepts `output_config.effort`. */
  readonly effort: boolean;
  /** Accepts `thinking: {type: "disabled"}` (false where thinking is always on: Opus 5.5, Sonnet 5.5). */
  readonly thinkingDisabled: boolean;
  /** Accepts the lowest-thinking `between_tools` mode instead of `disabled`. */
  readonly betweenToolsThinking: boolean;
  /** Accepts `output_config.format` with a JSON schema. */
  readonly jsonSchemaOutput: boolean;
  /** Accepts a last-assistant-turn prefill. */
  readonly prefill: boolean;
  /** Thinking always runs and counts against `max_tokens`, so a rung sized for a no-thinking reply must leave room. */
  readonly alwaysThinks: boolean;
}

/** The provider's dated alias of a tier's model ("claude-haiku-4-5-20251001") is the same model. */
export function canonicalModelId(model: string): string {
  return model.trim().replace(/-\d{8}$/, "");
}

/** The tier a model id (dated alias included) belongs to, or null. */
export function activeModelTierFor(model: string): ModelTier | null {
  return modelTierFor(canonicalModelId(model));
}

/** Models that may never be sent, each with the reason an override naming one is refused. */
export const RETIRED_MODELS: Readonly<Record<string, string>> = {
  "claude-opus-5": `retired on 2026-09-25 (Sean: out of the rotation completely); use ${MODELS.opus.model}`,
  "claude-sonnet-5": `replaced for active use by ${MODELS.sonnet.model}; kept only for historical pricing and receipts`,
};

/** A saved override naming the retired Sonnet keeps selecting the active Sonnet tier. */
export function activeModelOverrideId(model: string): string {
  return canonicalModelId(model) === "claude-sonnet-5" ? MODELS.sonnet.model : model;
}

/** Why this id may not be sent, or null when it may. A retired or unknown id is refused, never guessed at. */
export function modelRefusal(model: string): string | null {
  const id = canonicalModelId(model);
  if (RETIRED_MODELS[id]) return `${id} ${RETIRED_MODELS[id]}`;
  if (!activeModelTierFor(id)) return `${id} is not one of the model tiers (lib/models.ts)`;
  return null;
}

/** How a rung wants the model to think: ADAPTIVE (reading, writing) or OFF where the model allows (classifier, fallback). */
export type ModelThinkingMode = "ADAPTIVE" | "OFF";

export interface ModelRequestFields {
  /** The `thinking` field to send, or absent when the model must not be sent one. */
  readonly thinking?: { readonly type: "adaptive" } | { readonly type: "disabled" } | { readonly type: "between_tools" };
  /** `output_config.effort` to send, or absent when the model takes none. */
  readonly effort?: string;
  /** The smallest `max_tokens` this rung may send this model (thinking counts against it). */
  readonly minMaxTokens: number;
}

/** Room for an always-thinking model's thinking on a rung whose reply is tiny. A ceiling, not a spend. */
export const ALWAYS_THINKS_MIN_MAX_TOKENS = 1024;

/**
 * The one place a request's thinking and effort fields are decided. ADAPTIVE: `adaptive` where accepted. OFF: `disabled`
 * where accepted, else `between_tools`, else omitted. An id that is not a tier gets the most conservative fields.
 */
export function modelRequestFields(model: string, want: { thinking: ModelThinkingMode; effort: string | null }): ModelRequestFields {
  const tier = activeModelTierFor(model);
  if (!tier) return { minMaxTokens: 0 };
  const caps: ModelCapabilities = MODELS[tier].capabilities;
  const thinking = want.thinking === "ADAPTIVE"
    ? (caps.adaptiveThinking ? { type: "adaptive" as const } : undefined)
    : (caps.thinkingDisabled ? { type: "disabled" as const } : caps.betweenToolsThinking ? { type: "between_tools" as const } : undefined);
  return {
    ...(thinking ? { thinking } : {}),
    ...(caps.effort && want.effort ? { effort: want.effort } : {}),
    minMaxTokens: caps.alwaysThinks ? ALWAYS_THINKS_MIN_MAX_TOKENS : 0,
  };
}

/** The `model` the API says served a response, recorded beside the id we asked for. */
export function servedModelOf(body: unknown): string | null {
  const model = (body as { model?: unknown } | null)?.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}
