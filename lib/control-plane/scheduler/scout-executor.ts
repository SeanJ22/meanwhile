/**
 * **THE SCOUT — A BOUNDED MODEL WORKER THAT INVESTIGATES THROUGH TOOLS.**
 * (Level 1 activation, 2026-09-01. RULING 240, RULING 241. Machine-owned
 * provenance, 2026-09-02, RULING 243. Worker Efficiency Law, 2026-09-02,
 * RULING 244.)
 *
 * This is the model lane's `DeclaredExecutor`. It generalizes the proven
 * `pnpm model:proof` plumbing — one Attempt through `dispatchOne`, lane
 * declared before anything is persisted, provider-reported usage and a
 * computed cost on the Attempt — and adds the thing the proof deliberately
 * lacked: WORK. The model receives an obligation and a set of research tools;
 * it acts through the tools and through nothing else; its typed result is
 * validated against the artifacts those tools vaulted; and the Attempt is
 * disposed from the validated result, never from prose.
 *
 * ## What the model is and is not allowed to do, enforced here
 *
 * ```
 *   MAY   read robots.txt, fetch public URLs, drive a browser, read inherited
 *         evidence — each through a tool that vaults first and returns the
 *         sanitized representation second. robots.txt is read and recorded,
 *         never a refusal of a public page (owner decision 2026-09-25)
 *   MAY   annotate the rungs it walked and propose route/method candidates
 *   MAY NOT  see bytes no vault holds, cite an artifact no vault holds, return
 *         an absence before the ladder, promote its own proposal, end the
 *         Attempt without the typed result, re-read a URL this Attempt already
 *         vaulted, re-walk a rung a prior Attempt recorded as durably failed,
 *         or get past an access control (login, paywall, 403, challenge, 429)
 * ```
 *
 * The rung list is DERIVED from the tool calls that ran. The model annotates;
 * it does not invent. A candidate's provenance — observedOn, permission,
 * recordClass, evidenceArtifactIds — is DERIVED from the artifact, obligation
 * and permission records; the model's statements about them are recorded as
 * CLAIMS and checked, never written into durable provenance (RULING 243).
 *
 * ## The request shape, and why every byte of it is where it is (RULING 244;
 * the prompt-caching session of 2026-09-06)
 *
 * ```
 *   tools     stable per process   breakpoint on the LAST definition
 *   system    stable per process   breakpoint on the block — the pre-warm's
 *                                  target (`scoutPrewarmRequest`)
 *   brief     stable per Attempt   the first user block; nothing per-request
 *                                  sits before it
 *   turns     grow per turn        the MOVING breakpoint: top-level
 *                                  `cache_control` on the request, which the
 *                                  API places on the last cacheable block and
 *                                  moves forward every turn, so turn N reads
 *                                  turns 1..N-1 from the cache
 * ```
 *
 * Three breakpoints of the provider's four, five-minute TTL (turns are seconds
 * apart; `SCOUT_CACHE_POLICY` states the argument and the measured cycle gap
 * that rules the 1-hour TTL out). Nothing that varies per request — no
 * timestamp, Attempt id, obligation id or cycle id — appears before the last
 * breakpoint; the brief carries the obligation and it sits after the static
 * prefix.
 *
 * Every turn's usage is recorded as a STEP with the model, the effort, the
 * five billed token quantities (the cache-write split by TTL beside the
 * aggregate) and the cost at that model's rate from exactly those quantities.
 * Two cache-defect signatures are read over the steps at the end of the
 * Attempt (`lib/control-plane/cache-defects.ts`): a turn after the first that
 * paid for more uncached input than it appended — the STATIONARY breakpoint
 * the 2026-09-02 Attempts showed — and a turn that read ZERO cached tokens.
 * Either is a `cacheDefect`, a fact about our request assembly, never hidden
 * in a total. Effort is set per role and never varies inside an Attempt (a
 * change would invalidate the cache).
 *
 * ## Bounds, and every one is stated on the result
 *
 * Turns, tool calls, wall clock, tokens, requests per host. When one is
 * reached the executor tells the model so and asks for the typed result with
 * the rungs walked and the next rungs, so the next Attempt resumes rather than
 * restarts. A model that does not answer that request in the grace turns is
 * ABORTED with the reason named; its measured cost still reaches the ledger.
 *
 * ## The ladder — cheapest suitable class first (MW-031, MW-033, 2026-09-25)
 *
 * The loop's first attempt runs on the step registry's base class (currently Haiku 4.5;
 * `scoutLoopBase`, which the pre-warm reads too). When that attempt ends with
 * one of the closed `MODEL_ESCALATION_REASONS` observed — bound exhausted
 * without a result, a refused result never corrected, no typed result, or an
 * HTTP 400 on the cheaper model — the executor asks `reserveEscalation` to
 * hold the frontier attempt's worst case against the spend ceiling, and only
 * then continues THE SAME conversation on the frontier: every rung, artifact
 * and representation carries forward, the no-re-read set and the tool-call
 * and per-host bounds are shared, and the wall clock is the Attempt's. The
 * result records the class, why, the reason, a short evidence line and every
 * attempt's cost; `usd` is their sum. A refused escalation is recorded too.
 *
 * ## Preserved thinking — the conversation is append-only (Claude Opus 5.5, 2026-09-25)
 *
 * On Claude Opus 5.5 a thinking block is bound to the model and to the
 * conversation before it; replaying one after an edit of the system, the
 * tools or an earlier message is HTTP 400 on accounts created on or after
 * 2026-08-31. Nothing already sent is edited here: turns are appended, the
 * payload bound RESTARTS the conversation from the machine's record instead
 * of eliding old results in place (`scoutCarriedForward`), and the escalation
 * appends to the same conversation (why that is valid: the comment where it
 * happens). Every request states `drop_block` under the beta header
 * (`SCOUT_THINKING`) and every reported drop is recorded on the result.
 *
 * No secret is read here. The transport is injected; the runner builds it
 * from the workers' dedicated credential by NAME.
 */

import type { AttemptCost } from "../attempt.ts";
import { defaultPlaybookText, rolePlaybook, workerSystemPrompt, type WorkerPlaybook } from "../playbooks.ts";
import { MODELS } from '../../models.ts';
import { sanitizedErrorDiagnostic } from "../../ops/error-diagnostic.ts";
import { WORK_QUESTIONS, WORK_QUESTION_WORDS, type WorkQuestion } from "../work-question.ts";
import type { CostModelShare } from "../cost.ts";
import { describeCacheDefects, detectCacheDefects, type CacheDefectReading } from "../cache-defects.ts";
import {
  CACHE_RATE_MULTIPLIERS,
  meteredCostFields,
  minimumCacheablePrefixTokensFor,
  priceMeteredUsage,
  rateFor,
  readMeteredUsage,
  sumMeteredUsage,
  type MeteredUsage,
} from "../model-cost.ts";
import type { Disposition, PermissionState, TransportState } from "../../workstate/types.ts";
import type { DeclaredExecutor, ExecutorKind, WorkArtifact, WorkDisposition, WorkOutcome } from "./dispatch.ts";
import type { ScheduledObligation } from "./obligation.ts";
import type { RouteDescriptor } from "./registry.ts";
import { RESEARCH_BOUNDS, SCOUT_PREWARM_ROUTE_ID, type ScoutBound } from "./research-policy.ts";
export { SCOUT_PREWARM_ROUTE_ID };
import {
  MODEL_CLASSES,
  MODEL_FOR_CLASS,
  SCOUT_CACHE_POLICY,
  SCOUT_STEPS,
  assertStepMayEscalate,
  assertStepMayInvokeModel,
  escalationTargetFor,
  fitRepresentation,
  type ModelClass,
  type ModelEffort,
  type ModelEscalationReason,
  type ModelEscalationRefusal,
} from "./model-routing.ts";
import {
  SCOUT_RESEARCH_TOOLS,
  type ArtifactProvenance,
  type InheritedEvidence,
  type PriorRung,
  type ScoutToolContext,
  type ScoutToolSpec,
  type ScoutToolkit,
} from "./scout-contract.ts";
import {
  MIN_DISTINCT_RUNGS,
  REWALK_REFUSAL_DAYS,
  SCOUT_OUTCOMES,
  SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION,
  classifyPriorRung,
  distinctEvidenceRungs,
  scoutSourceDeadEnds,
  validateScoutFinishWithCandidates,
  type PriorFailureClass,
  type ScoutCacheDefect,
  type ScoutCandidate,
  type ScoutEscalationRefused,
  type ScoutFinding,
  type ScoutFinishInput,
  type ScoutGuardRefusal,
  type ScoutInputTransformation,
  type ScoutIssue,
  type ScoutModelAttempt,
  type ScoutOutcome,
  type ScoutRepresentationOverrun,
  type ScoutResult,
  type ScoutRung,
  type ScoutStep,
  type ScoutStop,
} from "./scout-result.ts";

/* ------------------------------------------------------------ the transport */

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

/**
 * One entry of the response's `input_transformations` (beta
 * `thinking-binding-controls-2026-08-01`): a thinking block the API dropped
 * before the model saw it. `reason` is `prefix_binding_mismatch` (our history
 * changed under the block — a defect of our request assembly) or
 * `model_binding_mismatch` (the conversation moved to a model that cannot read
 * it — expected after an escalation). Later checks add values, so both fields
 * are open strings.
 */
export interface InputTransformation {
  readonly type: string;
  readonly path?: string;
  readonly reason?: string;
}

export interface ModelResponse {
  readonly batch?: boolean;
  readonly model: string;
  readonly stop_reason: string | null;
  readonly content: readonly ContentBlock[];
  readonly usage: ModelUsage;
  /** Present when the request sent the thinking-binding beta header; empty when nothing was dropped. */
  readonly input_transformations?: readonly InputTransformation[];
}

export type CacheControl = { readonly type: "ephemeral"; readonly ttl?: "5m" | "1h" };

/**
 * **PRESERVED THINKING — THE SETTING EVERY SCOUT REQUEST STATES.** (2026-09-25;
 * claude-api skill, model-migration.md, "Migrating to Claude Opus 5.5",
 * breaking change 3, and "Migrating to Claude Fable 5.1 from Claude Fable 5",
 * breaking changes 2 and 3.)
 *
 * On Claude Opus 5.5 a thinking block is bound to the model that produced it
 * and to the conversation prefix before it (system, tools, every earlier
 * message). Accounts created on or after 2026-08-31 reject a replayed block
 * after an edit of that prefix with HTTP 400; older accounts only record it.
 * The Scout conversation is append-only (see `scoutCarriedForward`), so no
 * block is ever invalidated — and the skill's three-step check says to set the
 * production behaviour EXPLICITLY rather than rely on either default: with
 * `drop_block` a mismatch degrades (the block and every later one are dropped
 * for that request, reported in `input_transformations`) instead of failing
 * the Attempt, and the executor records every entry on the result. Models that
 * do not enforce the check (Sonnet 5) accept the field and report only
 * model-binding drops, so one request body serves both rungs of the ladder.
 * `adaptive` is what both models run when `thinking` is omitted — stating it
 * changes nothing but lets `block_binding` ride on it. The field requires the
 * beta header (`anthropicBetasFor`); without it the API answers 400.
 */
export const SCOUT_THINKING = {
  type: "adaptive",
  block_binding: { prefix_mismatch_behavior: "drop_block" },
} as const;

/** Haiku 4.5 rejects adaptive thinking and effort; do not pay for a known-invalid request. */
export function scoutThinkingOptions(model: string, effort: ModelEffort): Pick<ModelRequest, "thinking" | "output_config"> {
  return model === MODELS.haiku.model || model.startsWith(MODELS.haiku.model+'-') ? {} : { thinking: SCOUT_THINKING, output_config: { effort } };
}

/** The beta header value `thinking.block_binding` requires. */
export const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";

export interface ModelRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: readonly { readonly type: "text"; readonly text: string; readonly cache_control?: CacheControl }[];
  readonly tools: readonly ScoutToolSpec[];
  /**
   * `auto` only. A forced `{type:"tool"}` / `{type:"any"}` is HTTP 400 on
   * Claude Opus 5.5 (claude-api skill, model-migration.md, "Migrating to
   * Claude Opus 5.5", breaking change 2) and on `max_tokens: 0`; steer from the
   * prompt and use `strict: true` on the tool instead. Narrowed here so a
   * forced choice cannot compile.
   */
  readonly tool_choice?: { readonly type: "auto" };
  /** Adaptive thinking with the preserved-thinking behaviour stated (`SCOUT_THINKING`). */
  readonly thinking?: {
    readonly type: "adaptive";
    readonly block_binding?: { readonly prefix_mismatch_behavior: "error" | "drop_block" };
  };
  /** Effort per role (`ROLE_EFFORT`); the cap is economic, never a truth judgement. */
  readonly output_config?: { readonly effort: ModelEffort };
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: unknown }[];
  /**
   * The MOVING breakpoint (2026-09-06): the API places it on the last
   * cacheable block and moves it forward each turn. Sent when
   * `SCOUT_CACHE_POLICY.movingBreakpoint` is `TOP_LEVEL`.
   */
  readonly cache_control?: CacheControl;
}

export type ModelTransport = (request: ModelRequest) => Promise<ModelResponse>;

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

/**
 * The beta headers a request body needs, derived from the body itself so a
 * field that requires a beta can never be sent without it (2026-09-25).
 * `thinking.block_binding` without `thinking-binding-controls-2026-08-01` is
 * HTTP 400 ("block_binding: Extra inputs are not permitted").
 */
export function anthropicBetasFor(request: ModelRequest): string[] {
  return request.thinking?.block_binding !== undefined ? [THINKING_BINDING_BETA] : [];
}

export function cachedModelRequest(request: ModelRequest): ModelRequest {
  return request.cache_control || request.system.some(block => block.cache_control) ||
    request.tools.some(tool => tool.cache_control) || request.messages.some(message => Array.isArray(message.content) &&
      message.content.some(block => block && typeof block === "object" && "cache_control" in block))
    ? request : { ...request, cache_control: { type: "ephemeral" } };
}

/**
 * The real transport, against the Messages API. `apiKey` is passed in by the
 * runner, which read it by NAME; it is never logged and never placed in a
 * record. A non-2xx answer throws with the status and the first bytes of the
 * body so the Attempt aborts with a named reason.
 */
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

/* ----------------------------------------------------- the executor's own tools */

const RECORD_RUNG_SPEC: ScoutToolSpec = {
  name: "record_rung",
  description:
    "Annotate a rung you already walked (its index came back in the tool result) with what it returned, in one sentence.",
  input_schema: {
    type: "object",
    properties: {
      index: { type: "integer", description: "The rung index from the tool result." },
      note: { type: "string", description: "What this rung returned, one sentence." },
    },
    required: ["index", "note"],
    additionalProperties: false,
  },
};

const FINISH_SPEC: ScoutToolSpec = {
  name: "finish",
  description:
    "End the investigation with the TYPED RESULT. Call exactly once. Every rung index you walked must appear in rungsWalked. " +
    "Candidates and findings must cite artifact ids that tool results returned in THIS investigation (or inherited ids you were given). " +
    "A candidate's observedOn, permission and recordClass are CLAIMS: copy observedOn from the `retrieved` stamp and permission from the " +
    "`permission` verdict on the cited artifact's envelope, and recordClass from the obligation; the machine derives the values from the " +
    "vault record and refuses a finish whose claims disagree with it. permission is the robots.txt verdict as a RECORD: a DISALLOWED or " +
    "CANNOT_TELL verdict never disqualifies a public route (an owner decision). " +
    `Outcomes: ${SCOUT_OUTCOMES.join(", ")}.`,
  input_schema: {
    type: "object",
    properties: {
      outcome: { type: "string", enum: [...SCOUT_OUTCOMES] },
      rungsWalked: {
        type: "array",
        items: {
          type: "object",
          properties: { index: { type: "integer" }, note: { type: "string" } },
          required: ["index", "note"],
          additionalProperties: false,
        },
      },
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            routeId: { type: "string", description: "A stable kebab-case id for the route, e.g. wikimedia-rest-search" },
            title: { type: "string" },
            url: { type: "string" },
            procedure: { type: "string", description: "GET/POST and parameters, in words, replayable by code" },
            relevance: { type: "string" },
            permission: { type: "string", enum: ["ALLOWED", "DISALLOWED", "CANNOT_TELL", "NOT_APPLICABLE"], description: "CLAIM: the robots.txt verdict shown on the cited artifact's envelope, recorded as evidence and never a refusal." },
            permissionReading: { type: "string" },
            evidenceArtifactIds: { type: "array", items: { type: "string" } },
            observedOn: { type: "string", description: "CLAIM: the retrieval date (YYYY-MM-DD, UTC) from the cited artifact's `retrieved` stamp." },
            recordClass: { type: "string", description: "CLAIM: the source contract's record class, as briefed." },
            deterministic: { type: "boolean" },
            unverified: { type: "array", items: { type: "string" } },
            contractRepair: { type: "object", description: "Optional bounded source-contract proposal. Never a verification result. Use schemaVersion:1, sourceArtifactId, extraction (existing JSON_RECORDS/XML_RECORDS/HTML_TABLE/DELIMITED_TEXT/TEXT_BLOCKS mapping), and authorities (existing typed independent authority descriptors). All cited source/authority artifacts must be real vaulted evidence cited in evidenceArtifactIds. Do not change subject/class, invent authorities, or disable required verification.",
              properties: { schemaVersion: { type: "integer", enum: [1] }, sourceArtifactId: { type: "string" }, extraction: { type: "object" }, authorities: { type: "array", maxItems: 16, items: { type: "object" } } },
              required: ["schemaVersion", "sourceArtifactId", "extraction", "authorities"], additionalProperties: false },
          },
          required: [
            "routeId",
            "title",
            "url",
            "procedure",
            "relevance",
            "permission",
            "permissionReading",
            "evidenceArtifactIds",
            "observedOn",
            "recordClass",
            "deterministic",
            "unverified",
          ],
          additionalProperties: false,
        },
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string", description: "The civic field found, e.g. officeholder.name or meeting.start." },
            value: { type: ["string", "number", "boolean", "null"] },
            exactQuote: { type: "string", description: "Exact source passage containing this value, copied from the saved artifact." },
            sourceUrl: { type: "string" },
            summary: { type: "string" },
            artifactIds: { type: "array", items: { type: "string" } },
            kind: { type: "string", enum: ["RECORD", "POINTER"] },
          },
          required: ["field", "value", "exactQuote", "sourceUrl", "summary", "artifactIds", "kind"],
          additionalProperties: false,
        },
      },
      nextRungs: { type: "array", items: { type: "string" } },
      unverified: { type: "array", items: { type: "string" } },
      narrative: { type: "string", description: "One paragraph for the owner. Never evidence." },
    },
    required: ["outcome", "rungsWalked", "candidates", "findings", "nextRungs", "unverified", "narrative"],
    additionalProperties: false,
  },
};

/* ------------------------------------------------------------- the prompts */

/**
 * The system prompt. STABLE across Attempts so the provider's prompt cache
 * applies; nothing per-obligation is here. Volatile content is the first user
 * message.
 */
export function scoutSystemPrompt(bound: ScoutBound, minRungs: number, playbook?: string, role: "SCOUT" | "DETECTIVE" = "SCOUT"): string {
  return workerSystemPrompt(role, playbook ?? defaultPlaybookText(role)).replaceAll("{{minimum_rungs}}", String(minRungs));
}

/** How the brief labels one prior rung. A robots-only refusal (before 2026-09-25) is named as walkable, never as failed. */
function priorRungLabel(kind: PriorFailureClass): string {
  switch (kind) {
    case "DURABLE":
      return " — FAILED, durable";
    case "TRANSIENT":
      return " — failed, transient (may be retried)";
    case "ROBOTS_ONLY":
      return " — refused for robots.txt alone before 2026-09-25; not a wall, walk it (robots.txt is recorded, never a refusal)";
    default:
      return "";
  }
}

/**
 * The brief — the first user message. Stable for the whole Attempt, so it
 * sits under a breakpoint. A RESUMED Attempt starts from the recorded rung
 * list: the prior rungs come FIRST, with what each returned, then the next
 * rungs the prior Attempt named, then the obligation.
 */
export function scoutBrief(
  row: ScheduledObligation,
  route: RouteDescriptor | null,
  providerId: string | null,
  reason: string,
  inherited: InheritedEvidence,
  ownerQuestions: readonly WorkQuestion[] = (row.obligation.assignments ?? []).flatMap(a => a.questions ?? []),
): string {
  const o = row.obligation;
  const prior = inherited.priorRungs ?? [];
  const lines: string[] = [];
  if (prior.length > 0) {
    lines.push(
      `RUNGS ALREADY WALKED ON THIS OBLIGATION BY PRIOR INVESTIGATIONS (${prior.length}; do not re-walk a durably failed one — the executor refuses it)`,
      ...prior.map(
        (r) =>
          `- ${r.at.slice(0, 10)} ${r.tool} ${r.rung} -> ${r.target} [${r.observed.slice(0, 160)}]` +
          priorRungLabel(classifyPriorRung(r)),
      ),
      "",
    );
    const next = inherited.nextRungs ?? [];
    lines.push(
      "NEXT RUNGS THE PRIOR INVESTIGATION NAMED — continue from here",
      next.length > 0 ? next.map((n) => `- ${n}`).join("\n") : "(none named)",
      "",
    );
  }
  lines.push(
    "THE OBLIGATION",
    `obligation id: ${o.id}`,
    `subject: ${o.subjectId}`,
    `record class: ${o.recordClass}`,
    `provider: ${providerId ?? "(unknown)"}`,
    `route id: ${o.routeId ?? "(none)"}`,
    `route label: ${route?.label ?? "(no descriptor)"}`,
    `why a Scout: ${reason}`,
    route ? `provider's reason for the class: ${route.executorReason}` : "",
    route?.open.kind === "NOT_MACHINE_EXECUTABLE"
      ? `target: ${route.open.target}\nwhat stands in the way: ${route.open.reason}`
      : route
        ? `declared opening: ${route.open.kind} ${"url" in route.open ? route.open.url : ""}`
        : "",
    route?.awaitingAdapter ? `next move recorded by the provider: ${route.awaitingAdapter}` : "",
    route ? `citation: ${route.citation}` : "",
    ...WORK_QUESTIONS.filter(q => ownerQuestions.includes(q)).map(q => `OWNER'S QUESTION ${q}: ${WORK_QUESTION_WORDS[q]}`),
    ...(ownerQuestions.length ? ["Investigate these owner questions for this subject and record class. Compare current source evidence with inherited holdings, preserve independently verified fields, and name unresolved differences. READER_CAN_SEE requires a real reader link and public readback; a captured source or proposed route alone does not prove delivery. Questions never authorize changing identity, skipping validation, or claiming a missing record was not published."] : []),
    "",
    "INHERITED PROJECT CONTEXT (sanitized; artifact ids here may be cited as inherited evidence)",
    inherited.summary.trim() === "" ? "(none recorded)" : inherited.summary,
    inherited.artifactIds.length > 0 ? `inherited artifact ids: ${inherited.artifactIds.join(", ")}` : "",
    "",
    prior.length > 0
      ? "Continue the ladder from the next rungs above. Finish with the typed result."
      : "Begin at the primary authority's host (the tools read and record its robots.txt automatically), then walk the ladder. Finish with the typed result.",
  );
  return lines.filter((l) => l !== "").join("\n");
}

/* ------------------------------------------------------------- the executor */

export interface ScoutExecutorDeps {
  readonly role?: "SCOUT" | "DETECTIVE";
  /** A current Bank read at agent start. Shared fleet callers can supply their existing repository read. */
  readonly playbookFor?: (role: "SCOUT" | "DETECTIVE") => Promise<WorkerPlaybook>;
  readonly transport: ModelTransport;
  /** Trusted transport wrapper provenance only; message text never proves that
   * a provider request was refused before sending. Unknown errors stay held. */
  readonly refusedBeforeSending?: (error: unknown) => boolean;
  readonly model?: string;
  readonly bound?: ScoutBound;
  readonly minRungs?: number;
  readonly now?: () => string;
  readonly toolkitFor: (ctx: ScoutToolContext) => ScoutToolkit;
  /** Pure synchronous context assembly: no provider calls or acquisitions. Supplies
   * the descriptor, provider, inherited context and lazy vault seams. */
  readonly contextFor: (row: ScheduledObligation) => {
    readonly route: RouteDescriptor | null;
    readonly providerId: string | null;
    readonly reason: string;
    /** Exact active autonomous extraction class; the standing obligation may be a generic provider family. */
    readonly sourceRecordClass?: string;
    readonly inherited: InheritedEvidence;
    /** Current recorded Send questions, including marks saved during this cycle. */
    readonly ownerQuestions?: readonly WorkQuestion[];
    readonly tools: Pick<ScoutToolContext, "vault" | "vaultBytes" | "spaceOut" | "browse" | "openOne" | "timeoutMs" | "readHeldArtifact" | "readManualDocument">;
    /**
     * The canonical executor decision for this row (`decideExecutor`). A
     * DETERMINISTIC decision reaching this executor is refused before any
     * request (SCOUT_GRADUATED_ROUTE): a graduated route never spends a model.
     */
    readonly decision?: ExecutorKind;
  };
  readonly onStart?: (info: { readonly attemptId: string; readonly obligationId: string; readonly startedAt: string }) => Promise<void>;
  /**
   * Persist the typed result BEFORE the Attempt closes. May return an amended
   * result (method candidate ids, persistence notes) that the disposition then
   * names. Receives the artifacts so a candidate's URL can be matched to what
   * the Attempt actually opened.
   */
  readonly onResult?: (result: ScoutResult, artifacts: readonly WorkArtifact[]) => Promise<ScoutResult | void>;
  /**
   * **RESERVE THE ESCALATION BEFORE MAKING IT.** (MW-031, MW-033, 2026-09-25.)
   * When the cheaper attempt shows a recorded escalation reason, the executor
   * asks this seam to hold the second attempt's worst case against the spend
   * ceiling BEFORE a single frontier request is sent. The runner backs it with
   * `FleetSafetyController.holdModelBudget`, the same rolling ceiling every
   * per-request reservation reads. Absent, every escalation is refused
   * `NOT_RESERVED` — fail closed, never an unreserved second attempt.
   */
  readonly reserveEscalation?: (request: ScoutEscalationRequest) => ScoutEscalationAdmission | Promise<ScoutEscalationAdmission>;
}

/** What the executor asks the runner to reserve before a second, higher-class attempt (MW-031, MW-033). */
export interface ScoutEscalationRequest {
  readonly attemptId: string;
  readonly obligationId: string;
  readonly from: { readonly modelClass: ModelClass; readonly model: string };
  readonly to: { readonly modelClass: ModelClass; readonly model: string };
  readonly reason: ModelEscalationReason;
  readonly evidence: string;
  /** What the cheaper attempt already cost, settled through the per-request guard. */
  readonly spentUsd: number;
  /** The second attempt's worst case at the higher model's rate (`scoutAttemptWorstCaseUsd`). */
  readonly worstCaseUsd: number;
}

export type ScoutEscalationAdmission =
  | {
      readonly admit: true;
      readonly reservedUsd: number;
      /** Convert part of the hold into settled spend as each escalated turn is priced, so the hold and the spend are never counted twice. */
      readonly draw: (usd: number) => void;
      /** Release what remains of the hold when the escalated attempt ends. */
      readonly release: () => void;
    }
  | { readonly admit: false; readonly code: ModelEscalationRefusal; readonly why: string };

/** The escalation evidence line is short: a sentence an owner reads, never a transcript. */
export const SCOUT_ESCALATION_EVIDENCE_MAX_CHARS = 300;

/**
 * Initial response allowance at the model's dearest token rate. The attempt
 * has no cumulative token cap. This starts the existing job/escalation hold;
 * before sending, the request guard extends it for that request's full input
 * and maximum output. Later requests must reserve their own cost the same way.
 * Null for a model with no stated rate.
 */
export function scoutAttemptWorstCaseUsd(model: string, bound: ScoutBound): number | null {
  const rate = rateFor(model);
  if (rate === null) return null;
  const dearest = Math.max(rate.inputUsdPerMillion * CACHE_RATE_MULTIPLIERS.cacheCreation, rate.outputUsdPerMillion);
  return (bound.maxOutputTokensPerTurn / 1_000_000) * dearest;
}

/**
 * **WHAT ONE SCOUT JOB HOLDS AGAINST A SEND OR AREA BUDGET BEFORE IT STARTS.**
 * Initial response allowance at the starting tier. Every request, including
 * the first, must hold its full worst-case cost before sending (spend-holds.ts).
 * Null when the start model has no stated rate: no budget can be held,
 * and budgeted work waits.
 */
export function scoutJobWorstCaseUsd(bound: ScoutBound, modelOverride?: string): number | null {
  return scoutAttemptWorstCaseUsd(scoutLoopBase(modelOverride).model, bound);
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

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizedUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString();
  } catch {
    return raw.trim();
  }
}

/**
 * The conversation as sent, on a copy. Every user block is sent BARE — the
 * moving breakpoint is the request's top-level `cache_control`, placed by the
 * API on the last cacheable block — so no stale marker is ever left behind
 * and no message-level marker competes with it. Under the `LAST_BLOCK`
 * fallback the last block of the newest user turn carries the marker instead,
 * which is what this lane sent from 2026-09-02 to 2026-09-06. Assistant turns
 * are the provider's own content, echoed.
 */
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
 * **THE PER-ATTEMPT CONTEXT BOUND — WHAT MAY ACCUMULATE IN ONE SCOUT'S MESSAGES.**
 * (2026-09-17. The scout PAYLOAD_BYTE_CEILING fix.)
 *
 * Every turn re-sends the whole conversation, and `FleetSafetyController` counts
 * each re-send's bytes against the cycle's payload budget
 * (`FLEET_SAFETY_BOUNDS.maxPayloadBytesPerCycle`, 16 MiB). Left unbounded, a
 * scout that fetched a few large pages grew its conversation until one turn's
 * projected request crossed the ceiling and the Attempt ABORTED with
 * PAYLOAD_BYTE_CEILING — which is what stopped every scout that ran from
 * 2026-09-15 on. `fitRepresentation` bounds a SINGLE tool result; nothing
 * bounded their ACCUMULATION across turns.
 *
 * So the representations a conversation carries are held under a byte budget.
 * Until 2026-09-25 that was done by eliding the OLDEST tool results IN PLACE —
 * an edit of earlier messages. On Claude Opus 5.5 every thinking block is bound
 * to the conversation prefix before it, and an edit invalidates every later
 * block: HTTP 400 on accounts created on or after 2026-08-31 (claude-api
 * skill, model-migration.md, "Migrating to Claude Opus 5.5", breaking change
 * 3; the append-only replacements table under "Migrating to Claude Fable 5.1
 * from Claude Fable 5", breaking change 3).
 *
 * The budget is now kept WITHOUT an edit. The conversation only ever grows;
 * when its representations pass the budget the executor RESTARTS it — the
 * skill's "simple compaction": the next request is the brief plus one
 * carried-forward block written from the machine's own record (every rung with
 * what it returned, the model's note and its artifact ids; the newest results
 * whole), and nothing else is replayed — no earlier turn, no thinking block —
 * so nothing sent is tied to the old transcript. Server-side context editing
 * (`clear_tool_uses_20250919`) was not used: it clears what the MODEL reads,
 * but the request body — what the payload budget counts — still carries every
 * byte, and every clearing pass rewrites the cached conversation (skill,
 * cost-optimization.md §2.3).
 *
 * This is a NEW floor on context, never a raised cap: with representations
 * held under ~100 KB a scout request is ~150-200 KB, so both concurrent scouts
 * across the full turn bound stay well under the cycle's payload ceiling and
 * leave room for the deterministic lane.
 */
export const SCOUT_CONTEXT_TOOL_RESULT_BUDGET = 100_000;

/** The first words of a carried-forward block; how the byte count recognises it on later turns. */
export const SCOUT_CARRIED_FORWARD_MARK = "INVESTIGATION SO FAR — CARRIED FORWARD";

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

/**
 * **THE CARRIED-FORWARD BLOCK A RESTART STARTS FROM.** Built from the machine's
 * record and the conversation being retired, never from what the model said
 * about itself. Every rung walked is listed with what it returned, the model's
 * note and its artifact ids. The most recent turn's results are repeated whole —
 * a refused finish or an error included, so the model sees what it must fix —
 * and older representations follow newest-first while they fit in HALF the
 * budget, so the restarted conversation has room to grow for some turns before
 * the next restart. The newest representation is always whole. A result not
 * repeated is its rung line: the vaulted artifact holds it, and a re-read is
 * refused.
 */
export function scoutCarriedForward(input: {
  readonly messages: readonly Turn[];
  readonly rungs: readonly ScoutRung[];
  readonly artifactIdsByToolUse: ReadonlyMap<string, readonly string[]>;
  readonly budgetBytes: number;
  /** 1 for the Attempt's first restart. */
  readonly restart: number;
  /** Where the Attempt stands: bounds used, and a bound notice when one is in force. */
  readonly state: string;
}): string {
  const calls = new Map<string, string>();
  const results: { readonly id: string; readonly content: string; readonly isError: boolean; readonly turn: number }[] = [];
  input.messages.forEach((m, turn) => {
    if (!Array.isArray(m.content)) return;
    for (const b of m.content as Record<string, unknown>[]) {
      if (m.role === "assistant" && b?.type === "tool_use" && typeof b.id === "string") calls.set(b.id, String(b.name ?? "tool"));
      if (m.role === "user" && b?.type === "tool_result" && typeof b.tool_use_id === "string" && typeof b.content === "string") {
        results.push({ id: b.tool_use_id, content: b.content, isError: b.is_error === true, turn });
      }
    }
  });
  const newestTurn = results.at(-1)?.turn ?? -1;
  const half = Math.floor(input.budgetBytes / 2);
  const kept = new Set<string>();
  let keptBytes = 0;
  let newestRepresentationSeen = false;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const r = results[i];
    const isRepresentation = input.artifactIdsByToolUse.has(r.id);
    const size = Buffer.byteLength(r.content, "utf8");
    if (!isRepresentation) {
      /* A finish refusal, a record_rung answer, an error: only the most recent turn's are still news. */
      if (r.turn === newestTurn) kept.add(r.id);
      continue;
    }
    if (!newestRepresentationSeen || keptBytes + size <= half) {
      kept.add(r.id);
      keptBytes += size;
    }
    newestRepresentationSeen = true;
  }
  const omitted = results.filter((r) => !kept.has(r.id) && input.artifactIdsByToolUse.has(r.id)).length;
  const rungLines = input.rungs.map(
    (r) =>
      `- [${r.index}] ${r.tool} ${r.rung} → ${r.target} · ${r.observed}` +
      (r.note ? ` · your note: ${r.note}` : "") +
      ` · artifacts ${r.artifactIds.join(", ") || "(none)"}`,
  );
  const shown = results
    .filter((r) => kept.has(r.id))
    .map((r) => `--- ${calls.get(r.id) ?? "tool"} · call ${r.id}${r.isError ? " · error" : ""} ---\n${r.content}`);
  return [
    `${SCOUT_CARRIED_FORWARD_MARK} (restart ${input.restart} of this Attempt)`,
    "This conversation was restarted to keep every request under the cycle's payload budget. Nothing is lost: every artifact " +
      "is vaulted, and the executor still holds every rung, the no-re-read set and the bounds. Continue from here; do not " +
      "re-fetch a URL already walked (a re-read is refused and hands back the artifact id).",
    "",
    `RUNGS WALKED (${input.rungs.length}; index · tool · rung → target · what it returned · your note · artifact ids)`,
    ...(rungLines.length > 0 ? rungLines : ["(none yet)"]),
    "",
    `RESULTS OF YOUR MOST RECENT TOOL CALLS${omitted > 0 ? ` (${omitted} earlier result${omitted === 1 ? " is" : "s are"} not repeated; each is its rung above)` : ""}`,
    ...(shown.length > 0 ? shown : ["(none)"]),
    "",
    input.state,
  ].join("\n");
}

/** The tool list with the breakpoint on its LAST definition, so tools + system cache as one prefix. */
export function withToolBreakpoint(specs: readonly ScoutToolSpec[]): ScoutToolSpec[] {
  return specs.map((s, i) => {
    const { cache_control: _dropped, ...bare } = s;
    return i === specs.length - 1 ? { ...bare, cache_control: SCOUT_CACHE_POLICY.cacheControl } : bare;
  });
}

/**
 * **THE STATIC PREFIX — tools then system, exactly as every Attempt sends
 * them, built in one place.** (2026-09-06.) The executor and the pre-warm
 * request both call this, so the pre-warm's bytes cannot drift from the
 * Attempts' and the entry it writes is the entry they read.
 */
export function scoutStaticPrefix(input: {
  readonly toolkitSpecs: readonly ScoutToolSpec[];
  readonly bound: ScoutBound;
  readonly minRungs: number;
  readonly playbook?: string;
  readonly role?: "SCOUT" | "DETECTIVE";
}): { readonly tools: readonly ScoutToolSpec[]; readonly system: ModelRequest["system"] } {
  return {
    tools: withToolBreakpoint([...input.toolkitSpecs, RECORD_RUNG_SPEC, FINISH_SPEC]),
    system: [{ type: "text", text: scoutSystemPrompt(input.bound, input.minRungs, input.playbook, input.role), cache_control: SCOUT_CACHE_POLICY.cacheControl }],
  };
}

/**
 * **THE TTL ORDER THE API ENFORCES, CHECKED BEFORE A BYTE IS SENT.**
 * (2026-09-06.) Blocks are processed tools → system → messages, and a
 * 1-hour marker may never come after a 5-minute one. Measured that day with a
 * planted request: HTTP 400, `system.0.cache_control.ttl: a ttl='1h'
 * cache_control block must not come after a ttl='5m' cache_control block.
 * Note that blocks are processed in the following order: tools, system,
 * messages.` A request that would earn that answer is refused here by name
 * instead of costing a round trip; the executor and the pre-warm both call it.
 */
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


/**
 * **THE PRE-WARM REQUEST.** (2026-09-06.) `max_tokens: 0` runs prefill only:
 * the API writes the cache at the static prefix's breakpoint and returns
 * `content: []` with a usage block, billing the cache write and no output.
 * The same tools, system, `tool_choice: auto` and effort the Attempts' first
 * turns send; the breakpoint stays on the system block, never on the
 * placeholder. Measured 2026-09-06: HTTP 200, `cache_creation_input_tokens`
 * 4,586 on the first call and `cache_read_input_tokens` 4,586 on the second.
 * A forced `tool_choice` is refused with `max_tokens: 0` (HTTP 400,
 * "tool_choice: type \"tool\" or \"any\" cannot be used when max_tokens is 0"),
 * which is why the bound turn's forced finish never pre-warms.
 *
 * It sends the Attempts' `thinking` setting too (2026-09-25): thinking and
 * effort are rendered into the prompt, so a pre-warm with different settings
 * can write an entry real traffic never reads (claude-api skill,
 * prompt-caching.md, "Pre-warming the cache"). Adaptive thinking is accepted
 * with `max_tokens: 0`; only `thinking.type: "enabled"` is refused there.
 * `toolkitSpecs` must be the Attempts' own list — with the search tool when the
 * owner's paid-search switch is on (`scoutToolSpecsFor`) — or the entry
 * written is for a prefix no Attempt sends.
 */
export function scoutPrewarmRequest(input: {
  readonly model: string;
  readonly effort: ModelEffort;
  readonly toolkitSpecs: readonly ScoutToolSpec[];
  readonly bound: ScoutBound;
  readonly minRungs: number;
  readonly playbook?: string;
  readonly role?: "SCOUT" | "DETECTIVE";
}): ModelRequest {
  const prefix = scoutStaticPrefix(input);
  return {
    model: input.model,
    max_tokens: 0,
    system: prefix.system,
    tools: prefix.tools,
    tool_choice: { type: "auto" },
    ...scoutThinkingOptions(input.model, input.effort),
    messages: [{ role: "user", content: [{ type: "text", text: SCOUT_PREWARM_PLACEHOLDER }] }],
  };
}

/**
 * The bytes-per-token figure the pre-warm's cache-minimum check divides by
 * (2026-09-25; an engineering choice). No tokenizer runs offline and a
 * `count_tokens` call is a network round trip, so the check takes a LOWER BOUND
 * on the prefix's tokens from its UTF-8 bytes: JSON schema and English prose
 * run under four bytes a token (the static prefix, ~12.2 KB of JSON and text
 * today, was measured at 4,586 tokens on 2026-09-06). An undercount can only
 * SKIP a pre-warm that would have cached; it can never send one that cannot.
 */
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

/**
 * **WHETHER, AND FOR WHICH MODEL, TO PRE-WARM.** (MW-033, 2026-09-25.) The
 * pre-warm warms the model the loop STARTS on (`scoutLoopBase`, the same answer
 * the executor reads), never a model it might escalate to — a speculative write
 * for a model most Attempts never reach is pure cost. And it is sent only when
 * the prefix clears that model's minimum cacheable length: below it the
 * provider silently caches nothing, so the call would bill a prefill that warms
 * no entry. Such a pre-warm is SKIPPED with a named reason instead.
 */
export function scoutPrewarmPlan(input: {
  readonly toolkitSpecs: readonly ScoutToolSpec[];
  readonly bound: ScoutBound;
  readonly minRungs: number;
  readonly playbook?: string;
  readonly role?: "SCOUT" | "DETECTIVE";
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
  const request = scoutPrewarmRequest({ model: start.model, effort: start.effort, toolkitSpecs: input.toolkitSpecs, bound: input.bound, minRungs: input.minRungs, playbook: input.playbook, role: input.role });
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

/**
 * The robots.txt verdict the page rungs ran under (those that vaulted one of `ids`, or every page rung when `ids` is
 * null), as a RECORD — never a refusal (owner decision 2026-09-25). One verdict when they agree; when they differ, the
 * one that says the most about the host's rules (DISALLOWED, CANNOT_TELL, ALLOWED, NOT_APPLICABLE); `fallback` when no
 * rung carries a verdict (results recorded before rungs carried one, or inherited evidence only).
 */
function recordedVerdict(rungs: readonly ScoutRung[], ids: ReadonlySet<string> | null, fallback: PermissionState): PermissionState {
  const seen = new Set<PermissionState>();
  for (const r of rungs) {
    if (r.tool === "read_permission" || r.permission === undefined) continue;
    if (ids !== null && !r.artifactIds.some((id) => ids.has(id))) continue;
    seen.add(r.permission);
  }
  return (["DISALLOWED", "CANNOT_TELL", "ALLOWED", "NOT_APPLICABLE"] as const).find((v) => seen.has(v)) ?? fallback;
}

/**
 * Map a validated result onto the control plane's own disposition
 * vocabulary. Null means the Attempt ABORTS (nothing about the publisher is
 * concluded) and the obligation stays owed with its debt.
 */
export function dispositionForScout(result: {
  readonly outcome: ScoutOutcome;
  readonly candidates: readonly ScoutCandidate[];
  readonly findings: readonly ScoutFinding[];
  readonly rungs: readonly ScoutRung[];
  readonly narrative: string;
  readonly methodCandidateIds: readonly string[];
}): WorkDisposition | null {
  const artifactCount = result.rungs.reduce((n, r) => n + r.artifactIds.length, 0);
  const note = (head: string): string =>
    `${head} SCOUT: ${result.narrative.slice(0, 600)} · rungs walked ${result.rungs.length}, ` +
    `distinct evidence-backed ${distinctEvidenceRungs(result.rungs)}, artifacts ${artifactCount}. ` +
    "ACQUISITION AND DISCOVERY ONLY: nothing here is normalized and nothing is promoted to reader truth.";
  const observation = { rawCount: 0, normalizedCount: 0, routeOnlyCount: null, earliest: null, latest: null };
  switch (result.outcome) {
    case "ROUTE_CANDIDATE": {
      const first = result.candidates[0];
      /* The candidate's machine-derived robots.txt verdict, as a record; CANNOT_TELL only when nothing was derived. Never a refusal. */
      const permission: PermissionState = first?.permission ?? "CANNOT_TELL";
      return {
        disposition: "DISCOVERED" as Disposition,
        observation,
        permission,
        transport: "REACHABLE" as TransportState,
        note: note(
          `ROUTE CANDIDATE(S) ${result.candidates.map((c) => `${c.routeId} <${c.url}>`).join(", ")}` +
            (result.methodCandidateIds.length > 0 ? ` proposed as method candidate(s) ${result.methodCandidateIds.join(", ")}` : "") +
            ".",
        ),
      };
    }
    case "EVIDENCE_FOUND": {
      const record = result.findings.some((f) => f.kind === "RECORD");
      const cited = new Set(result.findings.flatMap((f) => f.artifactIds));
      return {
        disposition: (record ? "INGESTED" : "POINTER_ONLY") as Disposition,
        observation: { ...observation, rawCount: cited.size },
        permission: recordedVerdict(result.rungs, cited, "ALLOWED"),
        transport: "REACHABLE",
        note: note(`EVIDENCE ${record ? "OF THE RECORD" : "POINTING AT THE RECORD"}: ${result.findings.map((f) => f.summary).join(" | ").slice(0, 400)}.`),
      };
    }
    case "NEEDS_ADAPTER":
      return {
        disposition: "REQUIRES_NEW_ADAPTER",
        observation: null,
        permission: "CANNOT_TELL",
        transport: "OTHER_NAMED_FAILURE",
        note: note("A SPECIFIC ADAPTER IS ALL THAT REMAINS — our tooling, never the record."),
      };
    case "BLOCKED": {
      /*
       * BLOCKED means an ACCESS CONTROL (a login, a paywall, a 403 or bot challenge, a 429) walled every walked rung;
       * robots.txt is never one (owner decision 2026-09-25). `permission` is only the robots.txt verdict the walked
       * rungs recorded, never the reason for the block — an observed line mentioning DISALLOWED no longer decides it.
       */
      return {
        disposition: "BLOCKED_CURRENTLY",
        observation: null,
        permission: recordedVerdict(result.rungs, null, "CANNOT_TELL"),
        transport: "CHALLENGED",
        note: note("EVERY WALKED RUNG HIT AN ACCESS CONTROL — a fact about the routes, never about the record; never bypassed, and another public route is still owed."),
      };
    }
    case "HUMAN_REQUIRED":
      return {
        disposition: "BLOCKED_CURRENTLY",
        observation: null,
        permission: "NOT_APPLICABLE",
        transport: "OTHER_NAMED_FAILURE",
        note: note("PUBLIC RECORD STILL OWED — HUMAN/OFFLINE ACCESS REQUIRED. Every machine-executable public route walked; only a human or offline act remains, so the obligation stays live."),
      };
    case "NO_PROGRESS":
    default:
      return null;
  }
}

/** The step the research loop is registered under. Sonnet first since MW-033; asserted before every transport call. */
export const SCOUT_LOOP_STEP = "scout-research-loop";

/**
 * **WHERE THE LOOP STARTS — ONE ANSWER FOR THE EXECUTOR AND THE PRE-WARM.**
 * (MW-033, 2026-09-25.) The class, model and effort of the research loop's
 * first attempt, from the step registry, with the registry's reason for that
 * class. An injected model (a test, a proof) overrides the id only; its class
 * is the registry class that names that id, or the routed class when none does.
 */
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

function shortEvidence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= SCOUT_ESCALATION_EVIDENCE_MAX_CHARS ? flat : `${flat.slice(0, SCOUT_ESCALATION_EVIDENCE_MAX_CHARS - 1)}…`;
}

/** Several attempts' cache-defect readings as one record; each attempt was read against its own model's minimum. */
function mergedCacheDefects(readings: readonly CacheDefectReading[]): { readonly turns: number[]; readonly stationaryTurns: number[]; readonly zeroReadTurns: number[]; readonly detail: string } {
  const withDefects = readings.filter((r) => r.turns.length > 0);
  return {
    turns: [...new Set(withDefects.flatMap((r) => r.turns))].sort((a, b) => a - b),
    stationaryTurns: withDefects.flatMap((r) => r.stationaryTurns),
    zeroReadTurns: withDefects.flatMap((r) => r.zeroReadTurns),
    detail: withDefects.map(describeCacheDefects).join(" | "),
  };
}

export function scoutExecutor(deps: ScoutExecutorDeps): DeclaredExecutor {
  const bound = deps.bound ?? RESEARCH_BOUNDS.perDispatch;
  const minRungs = deps.minRungs ?? MIN_DISTINCT_RUNGS;
  const clock = deps.now ?? (() => new Date().toISOString());
  /*
   * The routing decides where the loop starts — the cheapest suitable class
   * (MW-033) — its model and its effort; an injected model (tests, a proof)
   * overrides the id only. The escalation target is the registry's, or none
   * when the start is already the top of the ladder.
   */
  const base = scoutLoopBase(deps.model);
  const model = base.model;
  const effort: ModelEffort = base.effort;

  return {
    lane: "BOUNDED_MODEL_WORKER",
    workerFor: ({ holder }) => ({ role: deps.role ?? "SCOUT", provider: "anthropic", version: model, instance: holder }),
    run: async ({ obligation: row, routeTaskId, workItemId, attemptId, holder, executor: decidedKind }): Promise<WorkOutcome> => {
      const startedMs = Date.now();
      const startedAt = clock();
      let ctx: ReturnType<ScoutExecutorDeps["contextFor"]>;
      try {
        ctx = deps.contextFor(row);
      } catch (error) {
        // This boundary precedes toolkit construction, onStart and every model
        // transport. Dispatch durably records this measured zero on the Attempt
        // before its ordinary hold settlement runs. Later/unknown failures retain
        // their existing accounting; this is never a historical hold reconciler.
        return {
          kind: "ABORTED", ranAs: "BOUNDED_MODEL_WORKER", endedAt: clock(), artifacts: [],
          cost: { inputTokens: 0, outputTokens: 0, usd: 0,
            durationMs: Math.max(0, Date.now() - startedMs), bytesFetched: 0, requestCount: 0,
            cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
            cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0,
            uncachedInputTokens: 0, batch: false },
          detail: `SCOUT_CONTEXT_FAILED_BEFORE_REQUEST: no toolkit or model request was opened; the obligation remains owed. ${sanitizedErrorDiagnostic(error)}`,
        };
      }
      const sourceRecordClass = ctx.sourceRecordClass ?? row.obligation.recordClass;
      const toolkit = deps.toolkitFor({
        obligation: row,
        route: ctx.route,
        providerId: ctx.providerId,
        attemptId,
        workItemId,
        routeTaskId,
        holder,
        bound,
        now: clock,
        inherited: ctx.inherited,
        ...ctx.tools,
      });
      const inherited = new Set(ctx.inherited.artifactIds);
      const provenance = new Map<string, ArtifactProvenance>();
      for (const p of ctx.inherited.provenance ?? []) provenance.set(p.artifactId, p);
      const priorRungs: readonly PriorRung[] = ctx.inherited.priorRungs ?? [];
      if (deps.onStart) await deps.onStart({ attemptId, obligationId: row.obligation.id, startedAt }).catch(() => undefined);

      /* The static prefix, from the one builder the pre-warm also calls. */
      const role = deps.role ?? "SCOUT";
      const playbook = deps.playbookFor ? await deps.playbookFor(role) : rolePlaybook(ctx.inherited.manualEntries ?? [], role);
      const prefix = scoutStaticPrefix({ toolkitSpecs: toolkit.specs, bound, minRungs, role, playbook: playbook.text });
      const rungs: ScoutRung[] = [];
      const artifacts: WorkArtifact[] = [];
      const knowledgeReads: NonNullable<ScoutResult["knowledgeReads"]>[number][] = [];
      const brief = scoutBrief(row, ctx.route, ctx.providerId, ctx.reason, ctx.inherited, ctx.ownerQuestions);
      /*
       * APPEND-ONLY (2026-09-25). Nothing already sent in this array is ever
       * changed: turns are pushed, and the only other move is a RESTART that
       * replaces the whole conversation with a fresh start
       * (`scoutCarriedForward`). An edit would invalidate every later thinking
       * block on Claude Opus 5.5 — see `SCOUT_THINKING`.
       */
      const messages: { role: "user" | "assistant"; content: unknown }[] = [
        { role: "user", content: [{ type: "text", text: brief }] satisfies UserContent },
      ];
      let contextRestarts = 0;
      /** Every thinking block the provider reported dropping, with the turn and model. */
      const inputTransformations: ScoutInputTransformation[] = [];
      const usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, reported: false };
      /** Every turn's metered usage, in order; the ledger fields are their sum. */
      const meteredTurns: MeteredUsage[] = [];
      const steps: ScoutStep[] = [];
      const deterministic = new Map<string, { count: number; bytes: number }>();
      const runDeterministic = (step: string, bytes: number): void => {
        const d = deterministic.get(step) ?? { count: 0, bytes: 0 };
        deterministic.set(step, { count: d.count + 1, bytes: d.bytes + bytes });
      };
      const defectTurns: number[] = [];
      const guardRefusals: ScoutGuardRefusal[] = [];
      const overruns: ScoutRepresentationOverrun[] = [];
      /** (tool | normalized url) -> artifact ids vaulted by it this Attempt. The no-re-read set. */
      const vaultedByCall = new Map<string, string[]>();
      /** tool_use id -> artifact ids it vaulted, so the context bound's stubs can point at the evidence (2026-09-17). */
      const artifactIdsByToolUse = new Map<string, string[]>();
      /** The API's cache TTL for the writes this lane asks for; the aggregate fallback prices at it. */
      const requestedTtl = SCOUT_CACHE_POLICY.ttl;
      let turns = 0;
      let transportInvocations = 0;
      const transportInvocationsByModel = new Map<string, number>();
      let unpricedTransport = false;
      /*
       * The loop state below is assigned inside `runModelAttempt` (a closure)
       * and read after it returns, so each is initialised through `as` with its
       * full type: a plain `= null` would leave the compiler's narrowing at the
       * initial value past the call that changed it.
       */
      let modelReported = null as string | null;
      let finish = null as ScoutFinishInput | null;
      let acceptedCandidates: ScoutCandidate[] = [];
      let lastRefusal = null as ScoutIssue[] | null;
      let stoppedBy = "MODEL" as ScoutStop;
      let boundNotice = null as string | null;
      let transportFailure = null as string | null;
      let policyRefusedBeforeSending = false;
      /** The provider's HTTP status on a transport failure; a 400 on the cheaper model is the CAPABILITY_ERROR signal. */
      let transportStatus = null as number | null;
      let lastStopReason = null as string | null;
      let nudges = 0;
      let earlyAbsenceRefusedAtRungs: number | null = null;
      let representationBytesThisTurn = 0;
      /*
       * Escalation changes the model, never the website request allowance.
       * Every model request still passes the existing budget reservation.
       */
      let attemptTurns = 0;
      /*
       * EARLY STOP (2026-09-19). A walk that has cleared the minRungs floor and
       * then adds no new distinct evidence-backed rung for STALL_TURNS turns is
       * spinning on walls: it has read what the openable routes hold and the rest
       * are known walls (access controls). ~83% of authored-site walks are correct
       * negatives (RULING 52), and paying the full turn bound to re-confirm one
       * is the waste being ended. At >= minRungs the model may legitimately
       * conclude an absence, so this converts a proven negative into a finished
       * result instead of a bound timeout.
       */
      const STALL_TURNS = 3;
      let evidenceHigh = 0;
      let stallTurns = 0;

      /*
       * RULING 244, SEEDED (v): a route the decision rule sent to the
       * DETERMINISTIC lane never spends a model. The dispatcher declares the
       * decided kind on the run input; if it says DETERMINISTIC and this
       * executor was reached anyway, no transport call is made and the
       * Attempt aborts by name with a measured zero.
       */
      if (decidedKind === "DETERMINISTIC" || ctx.decision === "DETERMINISTIC") {
        lastRefusal = [
          {
            code: "SCOUT_GRADUATED_ROUTE",
            detail:
              `the executor decision for ${row.obligation.id} is DETERMINISTIC (route ${row.obligation.routeId ?? "(none)"} is graduated or declared); ` +
              "a graduated route never dispatches to a model, so no request was made",
          },
        ];
      }


      /** The no-re-read / no-re-walk guard. A string is the refusal the model reads. */
      const guard = (tool: string, rawUrl: string): string | null => {
        if (tool !== "fetch_public" && tool !== "browse") return null;
        const url = normalizedUrl(rawUrl);
        const already = vaultedByCall.get(`${tool}|${url}`);
        if (already !== undefined) {
          const detail =
            `RE-READ REFUSED: ${tool} already opened ${url} in this investigation and vaulted it as ARTIFACT ${already.join(", ") || "(nothing stored)"}. ` +
            "That representation is in this conversation or carried forward as its rung; reason over it, or open a materially different representation (the page's own API, a linked document, another host).";
          guardRefusals.push({ kind: "RE_READ", tool, target: url, detail });
          return detail;
        }
        const nowMs = Date.parse(clock());
        /* Only a DURABLE failure (an access control, a not-found) is refused; a rung refused for robots.txt alone is ROBOTS_ONLY and walked. */
        const prior = priorRungs.find(
          (r) =>
            r.tool === tool &&
            normalizedUrl(r.target) === url &&
            classifyPriorRung(r) === "DURABLE" &&
            (!Number.isFinite(nowMs) || !Number.isFinite(Date.parse(r.at)) || nowMs - Date.parse(r.at) < REWALK_REFUSAL_DAYS * 86_400_000),
        );
        if (prior !== undefined) {
          const detail =
            `RE-WALK REFUSED: a prior investigation (${prior.attemptId}, ${prior.at.slice(0, 10)}) already walked ${tool} -> ${url} and recorded: "${prior.observed.slice(0, 200)}". ` +
            `A durably failed rung is not re-walked for ${REWALK_REFUSAL_DAYS} days, and an access control is never bypassed. Walk another public branch.`;
          guardRefusals.push({ kind: "RE_WALK", tool, target: url, detail });
          return detail;
        }
        return null;
      };

      /* Two grace turns past the bound exist ONLY for the typed result. */
      const GRACE_TURNS = 2;
      let graceUsed = 0;

      /**
       * ONE MODEL ATTEMPT: the loop below, on `current`'s model. The first runs
       * on the loop's base class; an escalated one continues the same
       * conversation — every rung, artifact and representation carried forward —
       * on the higher class. `consult` is the step registry, asked before EVERY
       * model call; `onPriced` converts an escalation hold into settled spend.
       */
      interface ModelAttemptRun {
        readonly escalation?: ScoutModelAttempt["escalation"];
        readonly model: string;
        readonly modelClass: ModelClass;
        readonly consult: () => { readonly effort: ModelEffort };
        readonly onPriced?: (usd: number) => void;
      }
      const runModelAttempt = async (current: ModelAttemptRun): Promise<void> => {
        while (finish === null && lastRefusal?.[0]?.code !== "SCOUT_GRADUATED_ROUTE") {
          if (boundNotice !== null && graceUsed >= GRACE_TURNS) break;
          if (boundNotice !== null) graceUsed += 1;

          /* RULING 244: the step registry is consulted before EVERY model call. A deterministic step here throws. */
          const step = current.consult();
          let response: ModelResponse;
          let enteredTransport = false;
          try {
            const request: ModelRequest = {
              model: current.model,
              max_tokens: bound.maxOutputTokensPerTurn,
              system: prefix.system,
              tools: prefix.tools,
              /*
               * Always `auto` — never a forced-tool bound turn. Forcing
               * `tool_choice` to `finish` invalidates the messages cache (measured
               * 2026-09-06), so the bound turn re-read only the static prefix and
               * re-wrote the whole conversation (~16-24K tokens, ~$0.10-0.15 an
               * Attempt). The BOUND-REACHED / EARLY-STOP instruction plus the
               * research-tool refusal below drive the finish under `auto` at no
               * cache cost.
               */
              tool_choice: { type: "auto" },
              /* Preserved thinking, stated on every turn of both models (`SCOUT_THINKING`); the pre-warm sends the same. */
              ...scoutThinkingOptions(current.model, step.effort),
              messages: withCacheBreakpoints(messages),
              ...(SCOUT_CACHE_POLICY.movingBreakpoint === "TOP_LEVEL" ? { cache_control: SCOUT_CACHE_POLICY.cacheControl } : {}),
            };
            const order = cacheTtlOrderProblems(request);
            if (order.length > 0) throw new ModelTransportError(`cache_control order refused before sending: ${order.join("; ")}`, null);
            enteredTransport = true;
            transportInvocations += 1;
            transportInvocationsByModel.set(current.model, (transportInvocationsByModel.get(current.model) ?? 0) + 1);
            response = await deps.transport(request);
          } catch (error) {
            transportFailure = error instanceof Error ? error.message : String(error);
            transportStatus = error instanceof ModelTransportError ? error.status : null;
            // Only documented pre-processing rejections establish zero. A
            // timeout, unrecognized status or lost response may follow billing.
            const rejectedRequest = error instanceof ModelTransportError && error.status !== null
              && [400, 401, 402, 403, 404, 413, 429].includes(error.status);
            const refusedBeforeSending = enteredTransport && deps.refusedBeforeSending?.(error) === true;
            if (refusedBeforeSending) {
              policyRefusedBeforeSending = true;
              stoppedBy = "BOUND";
              transportInvocations -= 1;
              transportInvocationsByModel.set(current.model, (transportInvocationsByModel.get(current.model) ?? 1) - 1);
            }
            if (enteredTransport && !rejectedRequest && !refusedBeforeSending) unpricedTransport = true;
            break;
          }
          turns += 1;
          attemptTurns += 1;
          modelReported = response.model ?? modelReported;
          lastStopReason = response.stop_reason ?? lastStopReason;
          for (const t of response.input_transformations ?? []) {
            inputTransformations.push({
              turn: turns,
              model: response.model ?? current.model,
              type: String(t.type),
              path: typeof t.path === "string" ? t.path : null,
              reason: typeof t.reason === "string" ? t.reason : null,
            });
          }
          /* The provider's usage block, through the one parser every lane reads it with. */
          const metered = readMeteredUsage(response.usage ?? {}, response.batch === true);
          if (metered.uncachedInputTokens !== null || metered.outputTokens !== null) usage.reported = true;
          meteredTurns.push(metered);
          const turnTokens = {
            uncachedInput: metered.uncachedInputTokens ?? 0,
            output: metered.outputTokens ?? 0,
            cacheRead: metered.cacheReadInputTokens ?? 0,
            cacheWrite: metered.cacheCreationInputTokens ?? 0,
          };
          usage.input += turnTokens.uncachedInput;
          usage.output += turnTokens.output;
          usage.cacheRead += turnTokens.cacheRead;
          usage.cacheCreate += turnTokens.cacheWrite;
          /* Each turn is priced at the rate of the model it was SENT to — the attempt's own. */
          const priced = usage.reported ? priceMeteredUsage(current.model, metered, requestedTtl) : null;
          if (priced !== null && priced.usd !== null) current.onPriced?.(priced.usd);
          steps.push({
            step: SCOUT_LOOP_STEP,
            kind: "MODEL",
            turn: turns,
            model: response.model ?? current.model,
            effort: current.modelClass === "haiku" ? null : step.effort,
            tokens: turnTokens,
            usd: priced?.usd ?? null,
            representationBytes: representationBytesThisTurn,
            count: 1,
            cacheWriteSplit: { ephemeral5m: metered.cacheCreation5mInputTokens, ephemeral1h: metered.cacheCreation1hInputTokens },
            cacheWritePricedFrom: priced?.cacheWritePricedFrom ?? "NONE",
          });
          representationBytesThisTurn = 0;

          messages.push({ role: "assistant", content: response.content });
          const uses = response.content.filter(isToolUse);
          if (uses.length === 0) {
            nudges += 1;
            if (nudges > 2) break;
            messages.push({
              role: "user",
              content: [
                { type: "text", text: "You ended without calling finish. Continue the ladder through the tools, or call finish with the typed result." },
              ] satisfies UserContent,
            });
            continue;
          }

          const results: ToolResultBlock[] = [];
          for (const use of uses) {
            const input = (use.input ?? {}) as Record<string, unknown>;
            if (use.name === "finish") {
              const candidate = input as unknown as ScoutFinishInput;
              const validated = validateScoutFinishWithCandidates({
                finish: candidate,
                rungs,
                toolCalls: toolkit.toolCalls,
                stoppedBy,
                vaulted: toolkit.vaultedArtifactIds,
                inherited,
                minRungs,
                machine: { provenance, recordClass: sourceRecordClass, factEvidence:toolkit.factEvidence,
                  freshness: { now: clock(), cadenceHours: row.cadenceHours } },
              });
              const issues = validated.issues;
              /*
               * THE BOUND DOES NOT LAUNDER A REFUSED ABSENCE. A model told its
               * absence was early, that then walks NO further rung and waits for
               * the bound, has not earned the bound's exemption: the rung count
               * at the refusal is remembered, and an unchanged count at the
               * bound keeps the refusal.
               */
              if (
                issues.length === 0 &&
                stoppedBy === "BOUND" &&
                earlyAbsenceRefusedAtRungs !== null &&
                earlyAbsenceRefusedAtRungs === rungs.length
              ) {
                issues.push({
                  code: "SCOUT_EARLY_ABSENCE",
                  detail:
                    `an early ${candidate.outcome} was refused at ${rungs.length} rung(s) and no further rung was walked ` +
                    "before the bound; the bound does not convert a refused absence into a legitimate one",
                });
              }
              if (issues.some((i) => i.code === "SCOUT_EARLY_ABSENCE") && stoppedBy === "MODEL") {
                earlyAbsenceRefusedAtRungs = rungs.length;
              }
              if (issues.length === 0) {
                finish = candidate;
                acceptedCandidates = validated.candidates;
                runDeterministic("date-parsing", 0);
                results.push({ type: "tool_result", tool_use_id: use.id, content: "ACCEPTED." });
              } else {
                lastRefusal = issues;
                results.push({
                  type: "tool_result",
                  tool_use_id: use.id,
                  is_error: true,
                  content:
                    "REFUSED — fix and call finish again:\n" + issues.map((i) => `- ${i.code}: ${i.detail}`).join("\n"),
                });
              }
              continue;
            }
            if (use.name === "record_rung") {
              const index = num(input.index);
              const rung = index === null ? undefined : rungs.find((r) => r.index === index);
              if (rung === undefined) {
                results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `no rung with index ${String(input.index)} was walked` });
              } else {
                rungs[rungs.indexOf(rung)] = { ...rung, note: String(input.note ?? "").slice(0, 400) };
                results.push({ type: "tool_result", tool_use_id: use.id, content: `rung ${index} annotated` });
              }
              continue;
            }
            if ((SCOUT_RESEARCH_TOOLS as readonly string[]).includes(use.name)) {
              if (boundNotice !== null) {
                results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `BOUND REACHED (${boundNotice}); no research tool runs now. Call finish.` });
                continue;
              }
              const rawUrl = typeof input.url === "string" ? input.url : "";
              const refused = guard(use.name, rawUrl);
              if (refused !== null) {
                results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: refused });
                continue;
              }
              const rungLabel = typeof input.rung === "string" ? input.rung : null;
              const call = await toolkit.call(use.name, input, rungLabel);
              artifacts.push(...call.artifacts);
              if (call.ok && call.knowledgeRead) knowledgeReads.push(call.knowledgeRead);
              for (const p of call.provenance ?? []) provenance.set(p.artifactId, p);
              if ((use.name === "fetch_public" || use.name === "browse") && rawUrl !== "") {
                vaultedByCall.set(`${use.name}|${normalizedUrl(rawUrl)}`, call.artifacts.map((a) => a.artifactId));
              }
              let header = "";
              if (call.rung !== null) {
                const index = rungs.length;
                rungs.push({ ...call.rung, index, note: null, at: clock() });
                header = `[rung ${index}: ${call.rung.rung} → ${call.rung.target} · ${call.rung.observed}]\n`;
              }
              /* RULING 244: the representation is sized to the step, never a raw document. */
              const ids = call.artifacts.map((a) => a.artifactId);
              artifactIdsByToolUse.set(use.id, ids);
              const fit = fitRepresentation(use.name, `${header}${call.forModel}`, ids);
              if (fit.truncated) overruns.push({ tool: use.name, target: rawUrl || use.name, bytes: fit.bytes, budget: fit.budget, artifactIds: ids });
              const shownBytes = Math.min(fit.bytes, fit.budget);
              representationBytesThisTurn += shownBytes;
              if (use.name === "fetch_public" || use.name === "browse") runDeterministic("page-to-representation", shownBytes);
              else if (use.name === "read_permission") runDeterministic("permission-reading", shownBytes);
              results.push({ type: "tool_result", tool_use_id: use.id, is_error: !call.ok, content: fit.text });
              continue;
            }
            results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `unknown tool ${use.name}` });
          }
          messages.push({ role: "user", content: results });
          /*
           * Bound the accumulated representations so the next re-sent
           * conversation cannot drive the cycle's PAYLOAD_BYTE_CEILING
           * (2026-09-17) — by a RESTART from the machine's record, never by
           * editing what was already sent (2026-09-25, `scoutCarriedForward`).
           * It happens here, after a whole tool round, so no tool call is left
           * waiting on its result.
           */
          if (representationBytesIn(messages) > SCOUT_CONTEXT_TOOL_RESULT_BUDGET) {
            contextRestarts += 1;
            const carried = scoutCarriedForward({
              messages,
              rungs,
              artifactIdsByToolUse,
              budgetBytes: SCOUT_CONTEXT_TOOL_RESULT_BUDGET,
              restart: contextRestarts,
              state:
                `WHERE THE ATTEMPT STANDS: ${attemptTurns} turns used by this model; ` +
                `${toolkit.toolCalls} research tool calls used. The owner's budget governs continuation.` +
                (boundNotice !== null ? ` BOUND REACHED: ${boundNotice}. Call finish NOW with the typed result; no research tool will run.` : ""),
            });
            messages.splice(0, messages.length, {
              role: "user",
              content: [
                { type: "text", text: brief },
                { type: "text", text: carried },
              ] satisfies UserContent,
            });
          }

          /*
           * EARLY STOP: once the minRungs floor is met, if STALL_TURNS consecutive
           * turns add no new distinct evidence-backed rung, the field is exhausted
           * — ask for the typed result now instead of paying to the bound. The
           * finish path (research tools refused, `auto` tool_choice, the message
           * below) runs exactly as it does for a real bound.
           */
          if (boundNotice === null) {
            const evidenceNow = distinctEvidenceRungs(rungs);
            if (evidenceNow > evidenceHigh) {
              evidenceHigh = evidenceNow;
              stallTurns = 0;
            } else {
              stallTurns += 1;
            }
            if (evidenceNow >= minRungs && stallTurns >= STALL_TURNS) {
              stoppedBy = "BOUND";
              boundNotice = `no new evidence-backed rung in ${STALL_TURNS} turns past ${evidenceNow} distinct evidence-backed rung(s); the remaining routes are known walls`;
              messages.push({
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      `EARLY STOP: ${boundNotice}. Call finish NOW with the outcome your evidence supports, ` +
                      "rungsWalked covering every rung index, and nextRungs naming what a later Attempt should try. No further research tools will run.",
                  },
                ] satisfies UserContent,
              });
            }
          }
        }
      };

      /* ------------------------------------------- the ladder (MW-033) */
      const graduated = lastRefusal?.[0]?.code === "SCOUT_GRADUATED_ROUTE";
      const modelAttempts: ScoutModelAttempt[] = [];
      /** The first provider turn of each model attempt that ran, parallel to `modelAttempts`. */
      const attemptFirstTurns: number[] = [];
      const closeAttempt = (ran: ModelAttemptRun, firstTurn: number): void => {
        const own = steps.filter((s) => s.kind === "MODEL" && s.turn !== null && s.turn >= firstTurn);
        modelAttempts.push({
          ...(ran.escalation ? { escalation: ran.escalation } : {}),
          modelClass: ran.modelClass,
          model: ran.model,
          turns: own.length,
          usd: unpricedTransport ? null : own.length === 0 ? 0 : own.some((s) => s.usd === null) ? null : own.reduce((n, s) => n + (s.usd ?? 0), 0),
          accepted: finish !== null,
        });
        attemptFirstTurns.push(firstTurn);
      };
      /**
       * What the cheaper attempt SHOWED, as one of the closed reasons, or null
       * when nothing it showed is a reason to move up: an accepted result, a
       * graduated route, or a transport failure that is not the model's (an
       * overload, a network fault, a ceiling refusal — none is fixed by a
       * dearer model, and a ceiling must never be escalated around).
       */
      const observedEscalation = (): { readonly reason: ModelEscalationReason; readonly evidence: string } | null => {
        if (finish !== null || graduated) return null;
        if (transportFailure !== null) {
          return transportStatus === 400
            ? { reason: "CAPABILITY_ERROR", evidence: shortEvidence(`the provider refused the ${model} request as invalid (HTTP 400): ${transportFailure}`) }
            : null;
        }
        if (attemptTurns === 0) return null;
        if (lastRefusal !== null) {
          return {
            reason: "RESULT_REFUSED",
            evidence: shortEvidence(
              `finish refused after ${attemptTurns} turn(s): ${lastRefusal.map((i) => i.code).join(", ")} — ${lastRefusal[0]?.detail ?? ""}`,
            ),
          };
        }
        if (boundNotice !== null) {
          return {
            reason: "BOUND_EXHAUSTED_WITHOUT_RESULT",
            evidence: shortEvidence(`${boundNotice}; no typed result in ${attemptTurns} turn(s) including ${GRACE_TURNS} grace turn(s)`),
          };
        }
        return {
          reason: "NO_TYPED_RESULT",
          evidence: shortEvidence(
            `${attemptTurns} turn(s) ended with no tool call and no finish, after ${Math.max(0, nudges - 1)} reminder(s)` +
              (lastStopReason !== null ? ` (last stop_reason ${lastStopReason})` : ""),
          ),
        };
      };

      let escalatedFrom: ModelClass | null = null;
      let escalationReason: ModelEscalationReason | null = null;
      let escalationEvidence: string | null = null;
      let escalationRefused: ScoutEscalationRefused | null = null;

      const first: ModelAttemptRun = { model, modelClass: base.modelClass, consult: () => assertStepMayInvokeModel(SCOUT_LOOP_STEP) };
      await runModelAttempt(first);
      if (!graduated) closeAttempt(first, 1);

      let previousAttempt = first;
      for (let rung = 1; rung < MODEL_CLASSES.length; rung++) {
        const escalationTarget = escalationTargetFor(SCOUT_LOOP_STEP, previousAttempt.modelClass);
        const observed = escalationTarget === null ? null : observedEscalation();
        if (escalationTarget === null || observed === null) break;
        escalationReason = observed.reason;
        escalationEvidence = observed.evidence;
        const spentUsd = modelAttempts.some(a => a.usd === null) ? null : modelAttempts.reduce((n,a) => n + (a.usd ?? 0),0);
        const worstCaseUsd = scoutAttemptWorstCaseUsd(escalationTarget.model, bound);
        let admission: ScoutEscalationAdmission;
        if (spentUsd === null || worstCaseUsd === null) {
          admission = {
            admit: false,
            code: "UNMEASURED_SPEND",
            why:
              spentUsd === null
                ? `the ${base.modelClass} attempt's cost is unmeasured, so the combined cost could not be known or reserved against`
                : `${escalationTarget.model} has no stated rate, so its worst case could not be reserved`,
          };
        } else if (deps.reserveEscalation === undefined) {
          admission = { admit: false, code: "NOT_RESERVED", why: "no escalation reservation was wired to this executor, so the second attempt could not be reserved first" };
        } else {
          try {
            admission = await deps.reserveEscalation({
              attemptId,
              obligationId: row.obligation.id,
              from: { modelClass: previousAttempt.modelClass, model: previousAttempt.model },
              to: { modelClass: escalationTarget.modelClass, model: escalationTarget.model },
              reason: observed.reason,
              evidence: observed.evidence,
              spentUsd,
              worstCaseUsd,
            });
          } catch (error) {
            admission = { admit: false, code: "NOT_RESERVED", why: `the reservation failed: ${error instanceof Error ? error.message : String(error)}` };
          }
        }

        if (admission.admit) {
          const reason = observed.reason;
          escalatedFrom = previousAttempt.modelClass;
          /*
           * A fresh turn and token bound for the second attempt; the wall,
           * tool-call and host bounds stay shared. The early-absence memory is
           * NOT reset: an escalation does not launder a refused absence either.
           */
          const resetForSecondAttempt = (): void => {
            attemptTurns = 0;
            stoppedBy = "MODEL";
            boundNotice = null;
            graceUsed = 0;
            nudges = 0;
            lastRefusal = null;
            transportFailure = null;
            transportStatus = null;
            evidenceHigh = distinctEvidenceRungs(rungs);
            stallTurns = 0;
          };
          resetForSecondAttempt();
          /*
           * THE FRONTIER CONTINUES THE SAME CONVERSATION, APPENDED TO — NOT A
           * FRESH ONE, AND NO SONNET BLOCK IS STRIPPED (2026-09-25). Why this is
           * valid on an enforced account (created on or after 2026-08-31) and on
           * an older one alike, from the claude-api skill, model-migration.md:
           *
           *   - model binding ("Migrating to Claude Opus 5.5", breaking change 3):
           *     Claude Opus 5.5 reads thinking blocks from earlier Opus, Sonnet and
           *     Haiku models — "a conversation that moves onto claude-opus-5-5
           *     keeps its reasoning"; a block a model cannot read is dropped
           *     before it sees it, unbilled, never a 400, and "keep passing blocks
           *     back unchanged when you switch models; don't strip them yourself"
           *     ("Migrating to Claude Fable 5.1 from Claude Fable 5", breaking
           *     change 2);
           *   - conversation binding (same section, breaking change 3): the check
           *     compares system, tools and every earlier message to when each
           *     block was produced. The escalation only APPENDS this message; the
           *     system and tools are the same `prefix`; history is never edited
           *     (`scoutCarriedForward`). So every Sonnet block is still valid.
           *
           * A fresh seeded conversation would forfeit the representations the
           * cheaper attempt paid for and the frontier's reading of Sonnet's
           * reasoning, for no validity gain; stripping blocks is the skill's
           * one-time recovery, not a steady state. The prompt cache is per model,
           * so the frontier's first turn writes this conversation once either
           * way, and every later frontier turn reads it. Every request states
           * `drop_block` (`SCOUT_THINKING`), so an assembly defect degrades and
           * is recorded in `inputTransformations` instead of failing the Attempt.
           */
          messages.push({
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `ESCALATED: this investigation moves from ${previousAttempt.model} to ${escalationTarget.model} because ${reason}: ${observed.evidence}. ` +
                  "Everything above carries forward — the rungs walked, the vaulted artifacts and their representations; do not re-walk or re-read them (a re-read is refused). " +
                  `The Attempt's public-host bounds are shared. Continue from what is established within the owner's budget and call finish with the typed result.`,
              },
            ] satisfies UserContent,
          });
          const second: ModelAttemptRun = {
            model: escalationTarget.model,
            modelClass: escalationTarget.modelClass,
            consult: () => assertStepMayEscalate(SCOUT_LOOP_STEP, reason, previousAttempt.modelClass),
            escalation: { from: previousAttempt.model, at: clock(), reason, evidence: observed.evidence },
            onPriced: admission.draw,
          };
          const secondFirstTurn = turns + 1;
          try {
            await runModelAttempt(second);
          } finally {
            admission.release();
          }
          closeAttempt(second, secondFirstTurn);
          previousAttempt = second;
        } else {
          escalationRefused = { code: admission.code, detail: admission.why, wouldEscalateTo: escalationTarget.modelClass };
          break;
        }
      }
      const last = modelAttempts.at(-1) ?? { modelClass: base.modelClass, model };

      /* ---------------------------------------------------- the result */
      const elapsedMs = Date.now() - startedMs;
      for (const [step, d] of deterministic) {
        steps.push({
          step,
          kind: "DETERMINISTIC",
          turn: null,
          model: null,
          effort: null,
          tokens: { cacheRead: 0, cacheWrite: 0, uncachedInput: 0, output: 0 },
          usd: 0,
          representationBytes: d.bytes,
          count: d.count,
        });
      }
      /*
       * Only a local pre-send refusal or recognized request rejection establishes zero.
       * A lost response or server failure leaves the request's charge unknown,
       * even after earlier metered turns. Their steps remain available, while
       * the aggregate is null so ordinary settlement retains the whole hold.
       */
      const refusedBeforeAnyUsage = !unpricedTransport && (transportFailure !== null || turns === 0) && !usage.reported;
      const inputTokens = unpricedTransport ? null : usage.reported ? usage.input + usage.cacheRead + usage.cacheCreate : refusedBeforeAnyUsage ? 0 : null;
      const outputTokens = unpricedTransport ? null : usage.reported ? usage.output : refusedBeforeAnyUsage ? 0 : null;
      /*
       * The cost is the sum of the steps, each priced at the rate of the model
       * it was sent to. With an escalation that is two models, and this sum is
       * the COMBINED cost of both attempts (MW-031); `modelAttempts` splits it.
       */
      const modelSteps = steps.filter((s) => s.kind === "MODEL");
      const usd = unpricedTransport ? null : usage.reported
        ? modelSteps.some((s) => s.usd === null)
          ? null
          : modelSteps.reduce((n, s) => n + (s.usd ?? 0), 0)
        : refusedBeforeAnyUsage
          ? 0
          : null;
      /*
       * The five billed quantities on the ledger row (2026-09-06): the turns'
       * metered usage summed. Unknown transport exposure makes aggregate
       * quantities unknown; the individual completed steps retain their usage.
       */
      const summed = sumMeteredUsage(meteredTurns);
      const metering = usage.reported && !unpricedTransport
        ? meteredCostFields(summed)
        : refusedBeforeAnyUsage
          ? { cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0, uncachedInputTokens: 0, batch: false }
          : { cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false };
      const cost: AttemptCost = {
        inputTokens,
        outputTokens,
        usd,
        durationMs: elapsedMs,
        bytesFetched: toolkit.bytesFetched,
        requestCount: unpricedTransport ? null : transportInvocations + toolkit.requestCount,
        ...metering,
      };
      /*
       * THE CHARGE BY MODEL (MW-031, 2026-09-25). `cost` is the Attempt's ONE
       * charge — both attempts combined — and the Attempt's worker is the model
       * it started on, so a by-model view gave Sonnet the frontier's dollars.
       * When more than one model ran, each attempt's part is carried to the
       * ledger (`WorkOutcome.costByModel` → `CostEntry.byModel`): its dollars
       * are the attempt's own (`modelAttempts`), its tokens the attempt's own
       * turns, and the parts sum to `cost`. Emit this complete split only when
       * no request has unknown transport exposure.
       */
      const costByModel: CostModelShare[] | null =
        modelAttempts.length > 1 && usage.reported && !unpricedTransport
          ? modelAttempts.map((a, i) => {
              const first = attemptFirstTurns[i] ?? 1;
              if (a.turns === 0) {
                return { model: a.model, requestCount: transportInvocationsByModel.get(a.model) ?? 0, usd: a.usd ?? 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0, uncachedInputTokens: 0 };
              }
              const own = sumMeteredUsage(meteredTurns.slice(first - 1, first - 1 + a.turns));
              const whole =
                own.uncachedInputTokens === null || own.cacheReadInputTokens === null || own.cacheCreationInputTokens === null
                  ? null
                  : own.uncachedInputTokens + own.cacheReadInputTokens + own.cacheCreationInputTokens;
              const { batch: _batch, ...fields } = meteredCostFields(own);
              return { model: a.model, requestCount: transportInvocationsByModel.get(a.model) ?? 0, usd: a.usd, inputTokens: whole, outputTokens: own.outputTokens, ...fields };
            })
          : null;
      /*
       * The two cache-defect signatures, read over the recorded turns
       * (`cache-defects.ts`): the stationary breakpoint the 2026-09-02
       * Attempts showed, and the zero read RULING 244 named.
       */
      /*
       * Read PER MODEL ATTEMPT (2026-09-25): the provider's cache is per model,
       * so an escalated attempt's first turn re-writes the conversation by
       * design and is that attempt's first turn, never a defect of the one
       * before it.
       */
      const defectReadings = usage.reported
        ? modelAttempts.map((a, i) =>
            detectCacheDefects(
              modelSteps
                .filter((s) => s.turn !== null && s.turn >= (attemptFirstTurns[i] ?? 1) && s.turn < (attemptFirstTurns[i] ?? 1) + a.turns)
                .map((s) => ({ turn: s.turn ?? 0, uncachedInput: s.tokens.uncachedInput, cacheRead: s.tokens.cacheRead, cacheWrite: s.tokens.cacheWrite })),
              /* Per the ATTEMPT's model, not one Opus-sized scalar: a cheaper class
                 has a HIGHER minimum, so 512 would read its legitimately-uncacheable
                 prefix increment as a stationary-breakpoint defect (model-cost.ts). */
              minimumCacheablePrefixTokensFor(a.model) ?? SCOUT_CACHE_POLICY.minimumCacheablePrefixTokens,
            ),
          )
        : null;
      const defectReading = defectReadings === null ? null : mergedCacheDefects(defectReadings);
      if (defectReading) defectTurns.push(...defectReading.turns);

      let refusal: ScoutIssue[] | null = null;
      if (finish === null) {
        refusal =
          transportFailure !== null
            ? [{ code: policyRefusedBeforeSending ? "SCOUT_POLICY_DENIED" : "SCOUT_TRANSPORT_FAILED",
                detail: policyRefusedBeforeSending ? `request refused before sending by the spending or execution policy: ${transportFailure}`
                  : `the provider did not answer or refused: ${transportFailure}` }]
            : (lastRefusal ?? [
                {
                  code: "SCOUT_NO_FINISH",
                  detail: `the model produced no accepted typed result in ${turns} turn(s)${boundNotice ? ` after ${boundNotice}` : ""}`,
                },
              ]);
        /* MW-033: a refused escalation is recorded as part of the outcome, AFTER the root cause. */
        if (escalationRefused !== null) {
          refusal = [
            ...refusal,
            {
              code: "SCOUT_ESCALATION_REFUSED",
              detail:
                `${escalationReason} called for ${escalationRefused.wouldEscalateTo} and the escalation was refused ` +
                `${escalationRefused.code}: ${escalationRefused.detail}`,
            },
          ];
        }
      }
      const accepted = finish;
      const rungsAnnotated = rungs.map((r) => {
        const note = accepted?.rungsWalked.find((w) => w.index === r.index)?.note ?? r.note;
        return note === undefined ? r : { ...r, note: note === null ? null : String(note).slice(0, 400) };
      });
      const cacheDefect: ScoutCacheDefect | null =
        defectReading === null || defectTurns.length === 0
          ? null
          : {
              turns: defectTurns,
              detail: defectReading.detail,
              stationaryTurns: defectReading.stationaryTurns,
              zeroReadTurns: defectReading.zeroReadTurns,
            };
      const result: ScoutResult = {
        formatVersion: 1,
        attemptId,
        obligationId: row.obligation.id,
        routeTaskId,
        workItemId,
        subjectId: row.obligation.subjectId,
        routeId: row.obligation.routeId,
        recordClass: sourceRecordClass,
        providerId: ctx.providerId,
        reason: ctx.reason,
        outcome: (accepted?.outcome as ScoutOutcome | undefined) ?? "NO_PROGRESS",
        stoppedBy,
        rungs: rungsAnnotated,
        distinctEvidenceRungs: distinctEvidenceRungs(rungsAnnotated),
        candidates: accepted ? acceptedCandidates : [],
        findings: accepted?.findings ?? [],
        nextRungs: accepted?.nextRungs ?? [],
        unverified: accepted?.unverified ?? [],
        narrative: accepted?.narrative ?? (refusal ? `REFUSED: ${refusal.map((i) => i.code).join(", ")}` : ""),
        /* The model whose attempt produced this result; `modelAttempts` names every model that ran. */
        worker: { provider: "anthropic", model: last.model, modelReported },
        usage: {
          inputTokens: usage.reported ? usage.input : null,
          outputTokens,
          cacheReadInputTokens: usage.reported ? usage.cacheRead : null,
          cacheCreationInputTokens: usage.reported ? usage.cacheCreate : null,
          turns,
          toolCalls: toolkit.toolCalls,
          cacheCreation5mInputTokens: usage.reported ? summed.cacheCreation5mInputTokens : null,
          cacheCreation1hInputTokens: usage.reported ? summed.cacheCreation1hInputTokens : null,
        },
        usd,
        elapsedMs,
        artifactIds: artifacts.map((a) => a.artifactId),
        ...(toolkit.heldEvidenceProtocolAvailable ? { recoveryCapabilityVersion: SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION } : {}),
        ...(knowledgeReads.length ? { knowledgeReads } : {}),
        ...(toolkit.factEvidence ? { sourceDeadEnds: scoutSourceDeadEnds(toolkit.factEvidence, clock(), row.cadenceHours) } : {}),
        methodCandidateIds: [],
        refusal,
        startedAt,
        recordedAt: clock(),
        effort: last.modelClass === "haiku" ? null : effort,
        steps,
        cacheDefect,
        guardRefusals,
        representationOverruns: overruns,
        resumedFromRungs: priorRungs.length,
        modelClass: last.modelClass,
        modelClassWhy: base.why,
        escalatedFrom,
        escalationReason,
        escalationEvidence,
        escalationRefused,
        modelAttempts,
        inputTransformations,
        contextRestarts,
      };

      /*
       * The runner persists the typed result and proposes method candidates
       * BEFORE the Attempt closes, so a disposition can name the candidate ids.
       * `onResult` may amend `methodCandidateIds` by returning nothing and
       * mutating nothing: it is handed a copy and the ids come back through
       * the toolkit-independent seam below.
       */
      let persisted: ScoutResult = result;
      if (deps.onResult) {
        try {
          const returned = await deps.onResult(result, artifacts);
          if (returned) persisted = returned;
        } catch (error) {
          /* A persistence failure is a fact about our store; the Attempt still closes honestly. */
          persisted = {
            ...result,
            unverified: [...result.unverified, `the typed result could not be persisted: ${error instanceof Error ? error.message : String(error)}`],
          };
        }
      }

      /* One artifact per content id: a body served identically by two hosts is one artifact. */
      const distinctArtifacts = artifacts.filter((a, i) => artifacts.findIndex((b) => b.artifactId === a.artifactId) === i);
      /* A drop because OUR history changed is a defect of request assembly, named like a cache defect; a model-binding drop after an escalation is not. */
      const prefixDrops = inputTransformations.filter((t) => t.reason === "prefix_binding_mismatch");
      const common = {
        ranAs: "BOUNDED_MODEL_WORKER" as const,
        artifacts: distinctArtifacts,
        cost,
        ...(persisted.spendHoldJobId === undefined ? {} : { spendHoldJobId: persisted.spendHoldJobId }),
        ...(costByModel !== null ? { costByModel } : {}),
        endedAt: clock(),
      };
      if (persisted.refusal !== null) {
        return {
          ...common,
          kind: "ABORTED",
          ...(policyRefusedBeforeSending ? { failureOutcome: "DENIED_BY_POLICY" as const } : {}),
          detail:
            `SCOUT_RESULT_REFUSED after ${turns} turn(s), ${toolkit.toolCalls} tool call(s), ${rungs.length} rung(s): ` +
            persisted.refusal.map((i) => `${i.code} — ${i.detail}`).join("; "),
        };
      }
      const disposition = dispositionForScout(persisted);
      if (disposition === null) {
        return {
          ...common,
          kind: "ABORTED",
          detail:
            `SCOUT_NO_PROGRESS (${stoppedBy}): ${rungs.length} rung(s) walked, ${persisted.distinctEvidenceRungs} distinct ` +
            `evidence-backed; next rungs: ${persisted.nextRungs.join("; ") || "(none named)"}. The obligation stays owed.`,
        };
      }
      return {
        ...common,
        kind: "DISPOSED",
        disposition,
        detail:
          `SCOUT ${persisted.outcome} (${stoppedBy}) in ${turns} turn(s), ${toolkit.toolCalls} tool call(s), ` +
          `${rungs.length} rung(s), ${artifacts.length} artifact(s), usd ${usd === null ? "UNMEASURED" : usd.toFixed(4)}` +
          (escalatedFrom !== null
            ? ` · ESCALATED ${escalatedFrom} → ${last.modelClass} (${escalationReason}); per attempt ` +
              modelAttempts.map((a) => `${a.modelClass} ${a.usd === null ? "UNMEASURED" : a.usd.toFixed(4)}`).join(" + ")
            : "") +
          (cacheDefect ? ` · CACHE DEFECT on turn(s) ${cacheDefect.turns.join(", ")}` : "") +
          (prefixDrops.length > 0
            ? ` · THINKING DROPPED (prefix_binding_mismatch: our history changed under a block) on turn(s) ${[...new Set(prefixDrops.map((t) => t.turn))].join(", ")}`
            : ""),
      };
    },
  };
}
