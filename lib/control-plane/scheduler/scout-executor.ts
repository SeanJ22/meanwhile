/**
 * The hunter: one government's packet, worked by one bounded model through its research tools. Each fact goes into
 * the Box the moment it is reported, so a job that ends early loses nothing; finish is a one-line summary. The request
 * is tools, system and brief as a static cached prefix, then append-only turns under a moving breakpoint.
 */

import type { AttemptCost } from "../attempt.ts";
import { workerSystemPrompt, type WorkerPlaybook } from "../playbooks.ts";
import { sanitizedErrorDiagnostic } from "../../ops/error-diagnostic.ts";
import { modelRequestBoundFor, type ModelRequestBound } from "../cost.ts";
import { describeCacheDefects, detectCacheDefects } from "../cache-defects.ts";
import {
  CACHE_RATE_MULTIPLIERS,
  highestRates,
  listPriceUsdForUsage,
  meteredCostFields,
  minimumCacheablePrefixTokensFor,
  priceMeteredUsage,
  rateFor,
  readMeteredUsage,
  sumMeteredUsage,
  type MeteredUsage,
} from "../model-cost.ts";
import type { DeclaredExecutor, WorkArtifact, WorkDisposition, WorkOutcome } from "./dispatch.ts";
import type { ScheduledObligation } from "./obligation.ts";
import { RESEARCH_BOUNDS, type ScoutBound } from "./research-policy.ts";
import {
  MODEL_CLASSES,
  MODEL_FOR_CLASS,
  SCOUT_CACHE_POLICY,
  SCOUT_STEPS,
  assertStepMayInvokeModel,
  fitRepresentation,
  type ModelClass,
  type ModelEffort,
} from "./model-routing.ts";
import {
  SCOUT_RESEARCH_TOOLS,
  type HandedPages,
  type ScoutToolContext,
  type ScoutToolSpec,
  type ScoutToolkit,
} from "./scout-contract.ts";
import { distinctEvidenceRungs, type ScoutResult, type ScoutRung, type ScoutStep, type ScoutStop, type UnfilledBlank } from "./scout-result.ts";
import type { HuntRole } from "../../hunt/brief.ts";

export interface ModelUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

export type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: string; readonly [key: string]: unknown };

/** One dropped thinking block from `input_transformations`. `prefix_binding_mismatch` is our assembly defect; `model_binding_mismatch` is expected after an escalation. Open strings. */
export interface InputTransformation {
  readonly type: string;
  readonly path?: string;
  readonly reason?: string;
}

export interface ModelResponse {
  readonly batch?: boolean;
  readonly batchWaitedMs?: number;
  /** The deadline decision made before sending; independent of the batch switch. */
  readonly batchEligible?: boolean;
  readonly model: string;
  readonly stop_reason: string | null;
  readonly content: readonly ContentBlock[];
  readonly usage: ModelUsage;
  /** Present when the request sent the thinking-binding beta header; empty when nothing was dropped. */
  readonly input_transformations?: readonly InputTransformation[];
}

export type CacheControl = { readonly type: "ephemeral"; readonly ttl?: "5m" | "1h" };

/** Preserved thinking: `drop_block` is stated explicitly so a binding mismatch degrades (and is recorded) instead of failing. Requires the beta header (`anthropicBetasFor`). */
export const SCOUT_THINKING = {
  type: "adaptive",
  block_binding: { prefix_mismatch_behavior: "drop_block" },
} as const;

/** Every model class takes adaptive thinking and effort; a worker request states both. */
export function scoutThinkingOptions(effort: ModelEffort): Pick<ModelRequest, "thinking" | "output_config"> {
  return { thinking: SCOUT_THINKING, output_config: { effort } };
}

/** The beta header value `thinking.block_binding` requires. */
export const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";

export interface ModelRequest {
  /** Parent-process hook for an actual Batch API wait; never part of the provider body. */
  readonly onBatchWait?: (waiting: boolean) => void;
  /** Scheduling metadata is removed before constructing the provider's Messages body. */
  readonly batchContext?: { readonly job: import("../model-batch.ts").BatchJob; readonly priority?: import("../model-batch.ts").BatchPriority };
  readonly model: string;
  readonly max_tokens: number;
  readonly system: readonly { readonly type: "text"; readonly text: string; readonly cache_control?: CacheControl }[];
  readonly tools: readonly ScoutToolSpec[];
  /** `auto` only: a forced tool choice is HTTP 400 on Opus 5.5 and with `max_tokens: 0`. */
  readonly tool_choice?: { readonly type: "auto" };
  /** Adaptive thinking with the preserved-thinking behaviour stated (`SCOUT_THINKING`). */
  readonly thinking?: {
    readonly type: "adaptive";
    readonly block_binding?: { readonly prefix_mismatch_behavior: "error" | "drop_block" };
  };
  /** Effort per role (`ROLE_EFFORT`); the cap is economic, never a truth judgement. */
  readonly output_config?: { readonly effort: ModelEffort };
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: unknown }[];
  /** The moving breakpoint, placed and advanced by the API. Sent when `SCOUT_CACHE_POLICY.movingBreakpoint` is `TOP_LEVEL`. */
  readonly cache_control?: CacheControl;
}

export type ModelTransport = (request: ModelRequest) => Promise<ModelResponse>;

/** The transport never handed the request to the provider, so it cost nothing. */
export class ModelRequestNotSent extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRequestNotSent";
  }
}

export function modelRequestAccounting(response: ModelResponse) {
  return { modelRequestCount: 1, batchRequestCount: response.batch === true ? 1 : 0,
    listPriceUsd: listPriceUsdForUsage(response.model, readMeteredUsage(response.usage, response.batch === true)),
    batchEligibleRequestCount: response.batchEligible === undefined ? null : response.batchEligible ? 1 : 0 };
}

export class ModelTransportError extends Error {
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  constructor(message: string, status: number | null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ModelTransportError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface AnthropicRateLimits {
  readonly requestsPerMinute: number | null;
  readonly inputTokensPerMinute: number | null;
  readonly outputTokensPerMinute: number | null;
  readonly retryAfterMs: number | null;
  readonly remaining?: {
    readonly requests: number | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly requestsResetAt: number | null;
    readonly inputResetAt: number | null;
    readonly outputResetAt: number | null;
  };
}

export function anthropicRateLimits(headers: Headers): AnthropicRateLimits {
  const number = (name: string): number | null => {
    const raw = headers.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const retry = headers.get("retry-after");
  const seconds = number("retry-after");
  const retryDate = retry === null ? NaN : Date.parse(retry);
  const reset = (name: string): number | null => {
    const value = Date.parse(headers.get(name) ?? "");
    return Number.isFinite(value) ? value : null;
  };
  return {
    requestsPerMinute: number("anthropic-ratelimit-requests-limit"),
    inputTokensPerMinute: number("anthropic-ratelimit-input-tokens-limit"),
    outputTokensPerMinute: number("anthropic-ratelimit-output-tokens-limit"),
    retryAfterMs: seconds !== null ? seconds * 1000 : Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : null,
    remaining: {
      requests: number("anthropic-ratelimit-requests-remaining"),
      inputTokens: number("anthropic-ratelimit-input-tokens-remaining"),
      outputTokens: number("anthropic-ratelimit-output-tokens-remaining"),
      requestsResetAt: reset("anthropic-ratelimit-requests-reset"),
      inputResetAt: reset("anthropic-ratelimit-input-tokens-reset"),
      outputResetAt: reset("anthropic-ratelimit-output-tokens-reset"),
    },
  };
}

/** The beta headers a body needs, derived from the body so a beta field is never sent without its header. */
export function anthropicBetasFor(request: ModelRequest): string[] {
  return request.thinking?.block_binding !== undefined ? [THINKING_BINDING_BETA] : [];
}

export function cachedModelRequest(request: ModelRequest): ModelRequest {
  const { batchContext: _context, onBatchWait: _waiting, ...body } = request;
  request = body;
  return request.cache_control || request.system.some(block => block.cache_control) ||
    request.tools.some(tool => tool.cache_control) || request.messages.some(message => Array.isArray(message.content) &&
      message.content.some(block => block && typeof block === "object" && "cache_control" in block))
    ? request : { ...request, cache_control: { type: "ephemeral" } };
}

/** The real transport. `apiKey` is never logged or recorded; a non-2xx answer throws with the status and the first bytes of the body. */
export function anthropicTransport(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  endpoint = "https://api.anthropic.com/v1/messages",
  options: { readonly onRateLimits?: (limits: AnthropicRateLimits, request: ModelRequest) => void } = {},
): ModelTransport {
  return async (request) => {
    const betas = anthropicBetasFor(request);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...(betas.length > 0 ? { "anthropic-beta": betas.join(",") } : {}),
      },
      body: JSON.stringify(cachedModelRequest(request)),
    });
    const limits = anthropicRateLimits(response.headers);
    options.onRateLimits?.(limits, request);
    if (!response.ok) {
      const body = await response.text();
      throw new ModelTransportError(`HTTP ${response.status}: ${body.slice(0, 300)}`, response.status, limits.retryAfterMs);
    }
    return (await response.json()) as ModelResponse;
  };
}

const FINISH_SPEC: ScoutToolSpec = {
  name: "finish",
  description: "End the job. Every fact you reported is already in the Box. Give a one-line summary, and list any blank you could not fill with what you tried and what would unlock it.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One line." },
      unfilled: {
        type: "array",
        items: {
          type: "object",
          properties: {
            subjectId: { type: "string" },
            field: { type: "string" },
            tried: { type: "string" },
            unlock: { type: "string", description: "What would let someone fill it: a page that is not posted yet, a records request, a person to ask." },
          },
          required: ["subjectId", "field", "tried", "unlock"],
        },
      },
    },
    required: ["summary"],
  },
};

/** What a job is handed: the packet's brief and the tools bound to its government. */
export interface HunterContext {
  readonly brief: string;
  readonly reason: string;
  /** How many blanks the packet holds. */
  readonly blanks: number;
  readonly handed: HandedPages;
  readonly tools: Pick<ScoutToolContext, "vault" | "vaultBytes" | "spaceOut" | "browse" | "openOne" | "openBytes" | "timeoutMs"
    | "readHeldArtifact" | "search" | "chargeSearch" | "sourceApi" | "reportFinding" | "held">;
}

export interface HunterExecutorDeps {
  readonly role: HuntRole;
  readonly playbookFor: (role: HuntRole) => Promise<WorkerPlaybook>;
  readonly transport: ModelTransport;
  readonly transportFor?: (routeTaskId: string) => ModelTransport;
  /** Trusted transport wrapper provenance only; message text never proves a request was refused before sending. */
  readonly refusedBeforeSending?: (error: unknown) => boolean;
  readonly model?: string;
  readonly bound?: ScoutBound;
  readonly now?: () => string;
  readonly toolkitFor: (ctx: ScoutToolContext) => ScoutToolkit;
  /** Recomputes the packet when the job starts; null means no blank is open and nothing is sent. */
  readonly contextFor: (row: ScheduledObligation, job: { readonly attemptId: string; readonly workItemId: string; readonly routeTaskId: string }) => Promise<HunterContext | null>;
  readonly onStart?: (info: { readonly attemptId: string; readonly obligationId: string; readonly startedAt: string }) => Promise<void>;
  /** Persist the job's record before the Attempt closes. */
  readonly onResult?: (result: ScoutResult, artifacts: readonly WorkArtifact[]) => Promise<ScoutResult | void>;
}

/** The most turns one job takes before it is asked to finish. */
export const HUNTER_MAX_TURNS = 80;

/**
 * Initial response allowance at the model's dearest token rate, held against a Send or area budget before the job
 * starts. Null for a model with no stated rate, so budgeted work waits.
 */
export function scoutJobWorstCaseUsd(bound: ScoutBound, modelOverride?: string): number | null {
  const rate = rateFor(scoutLoopBase(modelOverride).model);
  if (rate === null) return null;
  const card = highestRates(rate);
  const dearest = Math.max(card.inputUsdPerMillion * CACHE_RATE_MULTIPLIERS.cacheCreation, card.outputUsdPerMillion);
  return (bound.maxOutputTokensPerTurn / 1_000_000) * dearest;
}

interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
  readonly cache_control?: CacheControl;
}

interface TextBlock {
  readonly type: "text";
  readonly text: string;
  readonly cache_control?: CacheControl;
}

type UserContent = readonly (ToolResultBlock | TextBlock)[];

function isToolUse(b: ContentBlock): b is { type: "tool_use"; id: string; name: string; input: unknown } {
  return b.type === "tool_use" && typeof (b as { id?: unknown }).id === "string";
}

/** The conversation as sent, on a copy. User blocks are sent bare under the top-level breakpoint; under `LAST_BLOCK` the newest user turn's last block carries the marker. */
/** The conversation as sent, on a copy. User blocks are sent bare under the top-level breakpoint; under `LAST_BLOCK` the newest user turn's last block carries the marker. */
export function withCacheBreakpoints(
  messages: readonly { readonly role: "user" | "assistant"; readonly content: unknown }[],
  movingBreakpoint: "TOP_LEVEL" | "LAST_BLOCK" = SCOUT_CACHE_POLICY.movingBreakpoint,
): { readonly role: "user" | "assistant"; readonly content: unknown }[] {
  const cc = SCOUT_CACHE_POLICY.cacheControl;
  const lastUser = messages.reduce((at, m, i) => (m.role === "user" ? i : at), -1);
  return messages.map((m, i) => {
    if (m.role !== "user" || !Array.isArray(m.content)) return m;
    const blocks = (m.content as UserContent).map((b) => {
      const { cache_control: _dropped, ...bare } = b as TextBlock & { cache_control?: CacheControl };
      return bare as TextBlock | ToolResultBlock;
    });
    if (movingBreakpoint === "LAST_BLOCK" && i === lastUser && blocks.length > 0) {
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: cc };
    }
    return { role: m.role, content: blocks };
  });
}

/**
 * The per-Attempt context bound. Representations carried in the conversation are held under a byte budget so a
 * re-sent turn cannot cross the cycle's payload ceiling. Past it the conversation is restarted from the brief
 * plus a carried-forward block, never edited in place, because an edit invalidates later thinking blocks.
 */
export const SCOUT_CONTEXT_TOOL_RESULT_BUDGET = 60_000;

type Turn = { readonly role: "user" | "assistant"; readonly content: unknown };

/** The representation bytes a conversation carries: every tool result's text, plus a carried-forward block. */
export function representationBytesIn(messages: readonly Turn[]): number {
  let bytes = 0;
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content as Record<string, unknown>[]) {
      if (b?.type === "tool_result" && typeof b.content === "string") bytes += Buffer.byteLength(b.content, "utf8");
      else if (b?.type === "text" && typeof b.text === "string" && b.text.startsWith(SCOUT_CARRIED_FORWARD_MARK)) bytes += Buffer.byteLength(b.text, "utf8");
    }
  }
  return bytes;
}

/** The first words of a carried-forward block; how the byte count recognises it on later turns. */
export const SCOUT_CARRIED_FORWARD_MARK = "THE JOB SO FAR — CARRIED FORWARD";

/** The carried-forward block a restart starts from: every step with what it returned, every finding reported, and the newest results whole. */
export function scoutCarriedForward(input: {
  readonly messages: readonly Turn[];
  readonly steps: readonly ScoutRung[];
  readonly reported: readonly string[];
  readonly budgetBytes: number;
  readonly restart: number;
}): string {
  const results: string[] = [];
  let bytes = 0;
  for (const m of [...input.messages].reverse()) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of [...(m.content as Record<string, unknown>[])].reverse()) {
      if (b?.type !== "tool_result" || typeof b.content !== "string") continue;
      const size = Buffer.byteLength(b.content, "utf8");
      if (bytes + size > input.budgetBytes / 2) continue;
      results.unshift(b.content);
      bytes += size;
    }
  }
  return [
    `${SCOUT_CARRIED_FORWARD_MARK} (restart ${input.restart})`,
    "The conversation was restarted to keep each request small. Nothing is lost: every page is saved and every reported fact is in the Box.",
    "",
    `STEPS TAKEN (${input.steps.length}):`,
    ...(input.steps.length ? input.steps.map(s => `- ${s.tool} ${s.target} · ${s.observed}`) : ["(none yet)"]),
    "",
    `FACTS ALREADY IN THE BOX (${input.reported.length}) — do not report them again:`,
    ...(input.reported.length ? input.reported.map(line => `- ${line}`) : ["(none yet)"]),
    "",
    "MOST RECENT TOOL RESULTS:",
    ...(results.length ? results : ["(none)"]),
  ].join("\n");
}


/** The tool list with the breakpoint on its LAST definition, so tools + system cache as one prefix. */
export function withToolBreakpoint(specs: readonly ScoutToolSpec[]): ScoutToolSpec[] {
  return specs.map((s, i) => {
    const { cache_control: _dropped, ...bare } = s;
    return i === specs.length - 1 ? { ...bare, cache_control: SCOUT_CACHE_POLICY.stableCacheControl } : bare;
  });
}

/** The static prefix (tools then system), built in one place so the pre-warm writes exactly the entry Attempts read. */
export function scoutStaticPrefix(input: {
  readonly toolkitSpecs: readonly ScoutToolSpec[];
  readonly playbook: string;
  readonly role: HuntRole;
}): { readonly tools: readonly ScoutToolSpec[]; readonly system: ModelRequest["system"] } {
  return {
    tools: withToolBreakpoint([...input.toolkitSpecs, FINISH_SPEC]),
    system: [{ type: "text", text: workerSystemPrompt(input.role, input.playbook), cache_control: SCOUT_CACHE_POLICY.stableCacheControl }],
  };
}

/** The API's TTL order (tools, system, messages; no 1-hour marker after a 5-minute one), checked before sending. */
export function cacheTtlOrderProblems(request: Pick<ModelRequest, "tools" | "system" | "messages"> & { readonly cache_control?: CacheControl }): string[] {
  const markers: { readonly where: string; readonly ttl: "5m" | "1h" }[] = [];
  request.tools.forEach((t, i) => { if (t.cache_control) markers.push({ where: `tools[${i}]`, ttl: (t.cache_control as CacheControl).ttl ?? "5m" }); });
  request.system.forEach((s, i) => { if (s.cache_control) markers.push({ where: `system[${i}]`, ttl: s.cache_control.ttl ?? "5m" }); });
  request.messages.forEach((m, i) => {
    if (!Array.isArray(m.content)) return;
    (m.content as { cache_control?: CacheControl }[]).forEach((b, j) => { if (b.cache_control) markers.push({ where: `messages[${i}].content[${j}]`, ttl: b.cache_control.ttl ?? "5m" }); });
  });
  if (request.cache_control) markers.push({ where: "top-level", ttl: request.cache_control.ttl ?? "5m" });
  const problems: string[] = [];
  let seen5m: string | null = null;
  for (const m of markers) {
    if (m.ttl === "5m" && seen5m === null) seen5m = m.where;
    if (m.ttl === "1h" && seen5m !== null) problems.push(`${m.where}: a ttl='1h' cache_control block must not come after the ttl='5m' block at ${seen5m} (blocks are processed tools, system, messages)`);
  }
  if (markers.length > 4) problems.push(`${markers.length} cache_control markers exceed the provider's limit of 4`);
  return problems;
}

/** The one-word placeholder a pre-warm sends. Read during prefill, never answered, never marked. */
export const SCOUT_PREWARM_PLACEHOLDER = "warmup";


/** The pre-warm request: `max_tokens: 0` runs prefill only and writes the static prefix's cache entry. It sends the Attempts' own tools, thinking and effort so the entry matches real traffic. */
export function scoutPrewarmRequest(input: {
  readonly model: string;
  readonly effort: ModelEffort;
  readonly toolkitSpecs: readonly ScoutToolSpec[];
  readonly playbook: string;
  readonly role: HuntRole;
}): ModelRequest {
  const prefix = scoutStaticPrefix(input);
  return {
    model: input.model,
    max_tokens: 0,
    system: prefix.system,
    tools: prefix.tools,
    tool_choice: { type: "auto" },
    ...scoutThinkingOptions(input.effort),
    messages: [{ role: "user", content: [{ type: "text", text: SCOUT_PREWARM_PLACEHOLDER }] }],
  };
}

/** Bytes per token for a lower bound on prefix tokens; an undercount can only skip a pre-warm that would have cached. */
export const PREFIX_BYTES_PER_TOKEN_CEILING = 4;

/** A lower bound on the tokens in a static prefix (tools + system), from its bytes. */
export function prefixTokensAtLeast(prefix: Pick<ModelRequest, "tools" | "system">): number {
  const bytes = Buffer.byteLength(JSON.stringify(prefix.tools), "utf8") + prefix.system.reduce((n, s) => n + Buffer.byteLength(s.text, "utf8"), 0);
  return Math.floor(bytes / PREFIX_BYTES_PER_TOKEN_CEILING);
}

export type ScoutPrewarmPlan =
  | {
      readonly kind: "SEND";
      readonly model: string;
      readonly request: ModelRequest;
      readonly prefixTokensAtLeast: number;
      readonly minimumCacheablePrefixTokens: number;
    }
  | {
      readonly kind: "SKIP";
      readonly model: string;
      /** BELOW_CACHE_MINIMUM: the prefix may not reach the model's cacheable minimum. CACHE_MINIMUM_UNKNOWN: the model states none. */
      readonly code: "BELOW_CACHE_MINIMUM" | "CACHE_MINIMUM_UNKNOWN";
      readonly detail: string;
    };

/** Whether, and for which model, to pre-warm: only the loop's start model, and only when the prefix clears its minimum cacheable length. */
export function scoutPrewarmPlan(input: {
  readonly toolkitSpecs: readonly ScoutToolSpec[];
  readonly playbook: string;
  readonly role: HuntRole;
  /** An injected model id (a test); the loop's base model otherwise. */
  readonly model?: string;
}): ScoutPrewarmPlan {
  const start = scoutLoopBase(input.model);
  const minimum = minimumCacheablePrefixTokensFor(start.model);
  if (minimum === null) {
    return {
      kind: "SKIP",
      model: start.model,
      code: "CACHE_MINIMUM_UNKNOWN",
      detail: `${start.model} states no minimum cacheable prefix (model-cost.ts), so a pre-warm cannot be shown to cache; none was sent`,
    };
  }
  const request = scoutPrewarmRequest({ model: start.model, effort: start.effort, toolkitSpecs: input.toolkitSpecs, playbook: input.playbook, role: input.role });
  const atLeast = prefixTokensAtLeast(request);
  if (atLeast < minimum) {
    return {
      kind: "SKIP",
      model: start.model,
      code: "BELOW_CACHE_MINIMUM",
      detail:
        `the static prefix is at least ${atLeast} tokens by its bytes, which does not prove it clears ${start.model}'s ` +
        `${minimum}-token cacheable minimum; a pre-warm could bill a write that never caches, so none was sent`,
    };
  }
  return { kind: "SEND", model: start.model, request, prefixTokensAtLeast: atLeast, minimumCacheablePrefixTokens: minimum };
}

/** The step the research loop is registered under; asserted before every transport call. */
export const SCOUT_LOOP_STEP = "scout-research-loop";

/** Where the loop starts (class, model and effort), one answer for the executor and the pre-warm. An injected model overrides the id only. */
export function scoutLoopBase(modelOverride?: string): {
  readonly model: string;
  readonly modelClass: ModelClass;
  readonly effort: ModelEffort;
  readonly why: string;
} {
  const routed = assertStepMayInvokeModel(SCOUT_LOOP_STEP);
  const model = modelOverride ?? routed.model;
  const named = MODEL_CLASSES.find((c) => MODEL_FOR_CLASS[c] === model);
  return { model, modelClass: named ?? routed.modelClass, effort: routed.effort, why: SCOUT_STEPS[SCOUT_LOOP_STEP].why };
}


/** A finish's unfilled list, kept only where it names a subject and field. */
function unfilledOf(input: unknown): UnfilledBlank[] {
  const rows = Array.isArray((input as { unfilled?: unknown } | null)?.unfilled) ? (input as { unfilled: unknown[] }).unfilled : [];
  return rows.flatMap(row => {
    const r = (row ?? {}) as Record<string, unknown>;
    const text = (key: string) => typeof r[key] === "string" ? (r[key] as string).slice(0, 400) : "";
    return text("subjectId") && text("field") ? [{ subjectId: text("subjectId"), field: text("field"), tried: text("tried"), unlock: text("unlock") }] : [];
  });
}

/** The disposition a finished job commits: facts reported are an ingested reading; none is a walk with no yield. */
export function dispositionForHunt(result: Pick<ScoutResult, "findings" | "narrative" | "rungs">): WorkDisposition {
  const found = result.findings.length;
  return {
    disposition: found > 0 ? "INGESTED" : "WALKED_NO_YIELD",
    observation: { rawCount: found, normalizedCount: 0, routeOnlyCount: null, earliest: null, latest: null },
    permission: "NOT_APPLICABLE",
    transport: "REACHABLE",
    note: `HUNT: ${found} fact(s) put into the Box for checking, ${result.rungs.length} step(s). ${result.narrative.slice(0, 600)}`,
  };
}

export function hunterExecutor(deps: HunterExecutorDeps): DeclaredExecutor {
  const bound = deps.bound ?? RESEARCH_BOUNDS.perDispatch;
  const clock = deps.now ?? (() => new Date().toISOString());
  const base = scoutLoopBase(deps.model);
  const role: HuntRole = deps.role;
  const workerRole = role === "DETECTIVE" ? "DETECTIVE" : "SCOUT";

  return {
    lane: "BOUNDED_MODEL_WORKER",
    workerFor: ({ holder }) => ({ role: workerRole, provider: "anthropic", version: base.model, instance: holder }),
    run: async ({ obligation: row, routeTaskId, workItemId, attemptId, holder, bound: workerBound }): Promise<WorkOutcome> => {
      const startedMs = Date.now();
      const startedAt = clock();
      const send = deps.transportFor?.(routeTaskId) ?? deps.transport;
      const wallLimitMs = workerBound?.maxWallMs ?? 0;
      const zeroCost = (durationMs: number): AttemptCost => ({ inputTokens: 0, outputTokens: 0, usd: 0, durationMs, bytesFetched: 0, requestCount: 0,
        cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0, uncachedInputTokens: 0, batch: false });
      let ctx: HunterContext | null;
      try {
        ctx = await deps.contextFor(row, { attemptId, workItemId, routeTaskId });
      } catch (error) {
        return { kind: "ABORTED", ranAs: "BOUNDED_MODEL_WORKER", endedAt: clock(), artifacts: [], cost: zeroCost(Date.now() - startedMs),
          detail: `HUNT_CONTEXT_FAILED_BEFORE_REQUEST: nothing was sent; the blanks stay open. ${sanitizedErrorDiagnostic(error)}` };
      }
      if (ctx === null) {
        return { kind: "DISPOSED", ranAs: "BOUNDED_MODEL_WORKER", endedAt: clock(), artifacts: [], cost: zeroCost(Date.now() - startedMs),
          disposition: { disposition: "WALKED_NO_YIELD", observation: null, permission: "NOT_APPLICABLE", transport: "NOT_ATTEMPTED",
            note: "HUNT: no blank is open for this government, so nothing was sent." },
          detail: "HUNT_NOTHING_OPEN: every blank is held or not owed; no model request was made" };
      }
      const toolkit = deps.toolkitFor({ obligation: row, route: null, providerId: null, attemptId, workItemId, routeTaskId, holder,
        bound, now: clock, handed: ctx.handed, ...ctx.tools });
      if (deps.onStart) await deps.onStart({ attemptId, obligationId: row.obligation.id, startedAt }).catch(() => undefined);
      const playbook = await deps.playbookFor(role);
      const prefix = scoutStaticPrefix({ toolkitSpecs: toolkit.specs, role, playbook: playbook.text });
      const messages: { role: "user" | "assistant"; content: unknown }[] = [
        { role: "user", content: [{ type: "text", text: ctx.brief }] satisfies UserContent },
      ];
      const steps: ScoutRung[] = [];
      const artifacts: WorkArtifact[] = [];
      const meteredTurns: MeteredUsage[] = [];
      const modelSteps: ScoutStep[] = [];
      const overruns: NonNullable<ScoutResult["representationOverruns"]>[number][] = [];
      const inputTransformations: NonNullable<ScoutResult["inputTransformations"]>[number][] = [];
      const listPrices: (number | null)[] = [];
      let turns = 0;
      let transportInvocations = 0;
      let batchWaitedMs = 0;
      let contextRestarts = 0;
      let nudges = 0;
      let representationBytesThisTurn = 0;
      let modelReported = null as string | null;
      let finished = null as { readonly summary: string; readonly unfilled: UnfilledBlank[] } | null;
      let stoppedBy: ScoutStop = "MODEL";
      let transportFailure = null as string | null;
      let policyRefused = false;
      let unanswered = null as { readonly bound: ModelRequestBound | null } | null;

      while (finished === null) {
        if (wallLimitMs > 0 && Date.now() - startedMs - batchWaitedMs >= wallLimitMs) { stoppedBy = "TIMEOUT"; break; }
        if (turns >= HUNTER_MAX_TURNS) { stoppedBy = "BOUND"; break; }
        const step = assertStepMayInvokeModel(SCOUT_LOOP_STEP);
        let response: ModelResponse;
        let sentBound: ModelRequestBound | null = null;
        try {
          const request: ModelRequest = {
            batchContext: { job: "MISSION_CORE", priority: { now: clock(), subjectId: row.obligation.subjectId } },
            model: base.model,
            max_tokens: bound.maxOutputTokensPerTurn,
            system: prefix.system,
            tools: prefix.tools,
            tool_choice: { type: "auto" },
            ...scoutThinkingOptions(step.effort),
            messages: withCacheBreakpoints(messages),
            ...(SCOUT_CACHE_POLICY.movingBreakpoint === "TOP_LEVEL" ? { cache_control: SCOUT_CACHE_POLICY.cacheControl } : {}),
          };
          const order = cacheTtlOrderProblems(request);
          if (order.length > 0) throw new ModelRequestNotSent(`cache_control order refused before sending: ${order.join("; ")}`);
          transportInvocations += 1;
          sentBound = modelRequestBoundFor(base.model, Buffer.byteLength(JSON.stringify(request)), request.max_tokens);
          response = await send(request);
        } catch (error) {
          transportFailure = error instanceof Error ? error.message : String(error);
          const rejected = error instanceof ModelTransportError && error.status !== null && [400, 401, 402, 403, 404, 413, 429].includes(error.status);
          const notSent = error instanceof ModelRequestNotSent;
          policyRefused = !notSent && deps.refusedBeforeSending?.(error) === true;
          if (notSent || policyRefused) transportInvocations -= 1;
          else if (!rejected) unanswered = { bound: sentBound };
          break;
        }
        turns += 1;
        batchWaitedMs += Math.max(0, response.batchWaitedMs ?? 0);
        modelReported = response.model ?? modelReported;
        for (const t of response.input_transformations ?? []) {
          inputTransformations.push({ turn: turns, model: response.model ?? base.model, type: String(t.type),
            path: typeof t.path === "string" ? t.path : null, reason: typeof t.reason === "string" ? t.reason : null });
        }
        const metered = readMeteredUsage(response.usage ?? {}, response.batch === true);
        meteredTurns.push(metered);
        listPrices.push(modelRequestAccounting(response).listPriceUsd);
        const priced = priceMeteredUsage(base.model, metered, "1h");
        modelSteps.push({ step: SCOUT_LOOP_STEP, kind: "MODEL", turn: turns, model: response.model ?? base.model, effort: step.effort,
          tokens: { uncachedInput: metered.uncachedInputTokens ?? 0, output: metered.outputTokens ?? 0,
            cacheRead: metered.cacheReadInputTokens ?? 0, cacheWrite: metered.cacheCreationInputTokens ?? 0 },
          usd: priced.usd, representationBytes: representationBytesThisTurn, count: 1,
          cacheWriteSplit: { ephemeral5m: metered.cacheCreation5mInputTokens, ephemeral1h: metered.cacheCreation1hInputTokens },
          cacheWritePricedFrom: priced.cacheWritePricedFrom });
        representationBytesThisTurn = 0;
        messages.push({ role: "assistant", content: response.content });
        const uses = response.content.filter(isToolUse);
        if (uses.length === 0) {
          nudges += 1;
          if (nudges > 2) break;
          messages.push({ role: "user", content: [{ type: "text", text: "Keep working through the tools, reporting each fact as you find it, or call finish." }] satisfies UserContent });
          continue;
        }
        const results: ToolResultBlock[] = [];
        for (const use of uses) {
          if (use.name === "finish") {
            const input = (use.input ?? {}) as { summary?: unknown };
            finished = { summary: typeof input.summary === "string" ? input.summary.slice(0, 600) : "", unfilled: unfilledOf(use.input) };
            results.push({ type: "tool_result", tool_use_id: use.id, content: "Done." });
            continue;
          }
          if (!(SCOUT_RESEARCH_TOOLS as readonly string[]).includes(use.name)) {
            results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `unknown tool ${use.name}` });
            continue;
          }
          const call = await toolkit.call(use.name, use.input ?? {});
          artifacts.push(...call.artifacts);
          if (call.step !== null) steps.push({ ...call.step, index: steps.length, rung: call.step.tool, note: null, at: clock() });
          const fit = fitRepresentation(use.name, call.forModel, call.artifacts.map(a => a.artifactId));
          if (fit.truncated) overruns.push({ tool: use.name, target: call.step?.target ?? use.name, bytes: fit.bytes, budget: fit.budget, artifactIds: call.artifacts.map(a => a.artifactId) });
          representationBytesThisTurn += Math.min(fit.bytes, fit.budget);
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: !call.ok, content: fit.text });
        }
        messages.push({ role: "user", content: results });
        if (finished === null && representationBytesIn(messages) > SCOUT_CONTEXT_TOOL_RESULT_BUDGET) {
          contextRestarts += 1;
          const carried = scoutCarriedForward({ messages, steps, budgetBytes: SCOUT_CONTEXT_TOOL_RESULT_BUDGET, restart: contextRestarts,
            reported: toolkit.reported.map(f => `${f.subjectId} ${f.field} = ${String(f.value)}`) });
          messages.splice(0, messages.length, { role: "user", content: [{ type: "text", text: ctx.brief }, { type: "text", text: carried }] satisfies UserContent });
        }
      }

      const elapsedMs = Date.now() - startedMs;
      const reported = !unanswered && meteredTurns.length > 0;
      const summed = sumMeteredUsage(meteredTurns);
      const unknown = unanswered !== null;
      const noUsage = !unknown && meteredTurns.length === 0;
      const usd = unknown ? null : modelSteps.some(s => s.usd === null) ? null : modelSteps.reduce((n, s) => n + (s.usd ?? 0), 0);
      const metering = reported ? meteredCostFields(summed) : noUsage
        ? { cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0, uncachedInputTokens: 0, batch: false }
        : { cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false };
      const inputTokens = reported && summed.uncachedInputTokens !== null && summed.cacheReadInputTokens !== null && summed.cacheCreationInputTokens !== null
        ? summed.uncachedInputTokens + summed.cacheReadInputTokens + summed.cacheCreationInputTokens : noUsage ? 0 : null;
      const cost: AttemptCost = {
        listPriceUsd: unknown || listPrices.some(p => p === null) ? null : listPrices.reduce<number>((n, p) => n + (p ?? 0), 0),
        modelRequestCount: transportInvocations,
        batchRequestCount: unknown ? null : 0,
        batchEligibleRequestCount: unknown ? null : 0,
        inputTokens,
        outputTokens: reported ? summed.outputTokens : noUsage ? 0 : null,
        usd,
        durationMs: elapsedMs,
        bytesFetched: toolkit.bytesFetched,
        requestCount: transportInvocations + toolkit.requestCount,
        ...metering,
      };
      const defects = reported ? detectCacheDefects(modelSteps.map(s => ({ turn: s.turn ?? 0, uncachedInput: s.tokens.uncachedInput,
        cacheRead: s.tokens.cacheRead, cacheWrite: s.tokens.cacheWrite })), minimumCacheablePrefixTokensFor(base.model) ?? SCOUT_CACHE_POLICY.minimumCacheablePrefixTokens) : null;
      const findings = toolkit.reported.map(f => ({ subjectId: f.subjectId, field: f.field, value: f.value, exactQuote: f.exactQuote,
        sourceUrl: f.sourceUrl, summary: `${f.field} = ${String(f.value)}`, artifactIds: f.artifactIds, kind: "RECORD" as const }));
            const refusal = transportFailure !== null && findings.length === 0
        ? [{ code: policyRefused ? "SCOUT_POLICY_DENIED" as const : "SCOUT_TRANSPORT_FAILED" as const,
          detail: policyRefused ? `refused before sending by Admin's spending or execution limits: ${transportFailure}` : `the AI service did not answer: ${transportFailure}` }]
        : null;
      const narrative = finished?.summary || (stoppedBy === "TIMEOUT" ? `Stopped at the time limit after ${turns} turn(s); every fact reported is in the Box.`
        : transportFailure !== null ? `Ended when the AI service stopped answering after ${turns} turn(s); every fact reported is in the Box.`
        : `Ended after ${turns} turn(s) without a summary; every fact reported is in the Box.`);
      const result: ScoutResult = {
        instructions: { role, version: playbook.version, entryIds: playbook.entryIds, systemPrompt: prefix.system[0]!.text },
        researchRole: workerRole,
        formatVersion: 1,
        attemptId, obligationId: row.obligation.id, routeTaskId, workItemId, subjectId: row.obligation.subjectId,
        routeId: row.obligation.routeId, recordClass: row.obligation.recordClass, providerId: null, reason: ctx.reason,
        outcome: findings.length > 0 ? "EVIDENCE_FOUND" : "NO_PROGRESS",
        stoppedBy,
        rungs: steps,
        distinctEvidenceRungs: distinctEvidenceRungs(steps),
        candidates: [],
        findings,
        nextRungs: [],
        unverified: [],
        narrative,
        worker: { provider: "anthropic", model: base.model, modelReported },
        usage: { inputTokens: reported ? summed.uncachedInputTokens : null, outputTokens: cost.outputTokens,
          cacheReadInputTokens: reported ? summed.cacheReadInputTokens : null, cacheCreationInputTokens: reported ? summed.cacheCreationInputTokens : null,
          turns, toolCalls: toolkit.toolCalls, cacheCreation5mInputTokens: reported ? summed.cacheCreation5mInputTokens : null,
          cacheCreation1hInputTokens: reported ? summed.cacheCreation1hInputTokens : null },
        usd,
        elapsedMs,
        artifactIds: artifacts.map(a => a.artifactId),
        methodCandidateIds: [],
        refusal,
        startedAt,
        recordedAt: clock(),
        blanks: ctx.blanks,
        unfilled: finished?.unfilled ?? [],
        effort: base.effort,
        steps: modelSteps,
        cacheDefect: defects && defects.turns.length > 0 ? { turns: defects.turns, detail: describeCacheDefects(defects),
          stationaryTurns: defects.stationaryTurns, zeroReadTurns: defects.zeroReadTurns } : null,
        representationOverruns: overruns,
        modelClass: base.modelClass,
        modelClassWhy: base.why,
        inputTransformations,
        contextRestarts,
      };
      let persisted = result;
      if (deps.onResult) {
        try { persisted = (await deps.onResult(result, artifacts)) ?? result; }
        catch (error) { persisted = { ...result, unverified: [`the job's record could not be saved: ${error instanceof Error ? error.message : String(error)}`] }; }
      }
      const distinct = artifacts.filter((a, i) => artifacts.findIndex(b => b.artifactId === a.artifactId) === i);
      const common = { ranAs: "BOUNDED_MODEL_WORKER" as const, artifacts: distinct, cost, endedAt: clock(),
        ...(persisted.spendHoldJobId === undefined ? {} : { spendHoldJobId: persisted.spendHoldJobId }),
        ...(unanswered?.bound ? { unansweredRequest: unanswered.bound } : {}) };
      if (persisted.refusal !== null) {
        return { ...common, kind: "ABORTED", ...(policyRefused ? { failureOutcome: "DENIED_BY_POLICY" as const } : {}),
          detail: `HUNT ended with nothing reported after ${turns} turn(s): ${persisted.refusal.map(i => `${i.code} — ${i.detail}`).join("; ")}` };
      }
      return { ...common, kind: "DISPOSED", disposition: dispositionForHunt(persisted),
        detail: `HUNT ${role} (${stoppedBy}) in ${turns} turn(s), ${toolkit.toolCalls} tool call(s), ${findings.length} fact(s) into the Box, usd ${usd === null ? "UNMEASURED" : usd.toFixed(4)}` };
    },
  };
}
