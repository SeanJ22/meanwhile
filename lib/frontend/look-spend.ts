/**
 * The look reviewer's model call and spend reservation, for the runner.
 *
 *   reserve   refuses when Admin's settings cannot be read, when research or
 *             the runner is paused, when rolling model spend cannot be
 *             measured, or when this review would cross the rolling ceiling
 *             Admin sets. Nothing here raises or bypasses that dial.
 *   call      one metered model request with the screenshots, counted against
 *             the same ceiling; through the Message Batches API when that lane
 *             is on, else one Messages request.
 */
import { randomUUID } from "node:crypto";

import { ZERO_COST } from "../control-plane/attempt.ts";
import { costEntryWithModel, modelRequestBoundFor } from "../control-plane/cost.ts";
import { resolveRollingCeiling } from "../control-plane/fleet-safety.ts";
import { ADMIN_CONFIG_ID, adminConfigForPaidWork, fleetSpendCeilingOverrideUsd } from "../control-plane/gateway/admin-config.ts";
import { batchEnabledForJob, MESSAGE_BATCHES_ENDPOINT, readMessageBatchResults, retrieveMessageBatch, submitMessageBatch, type MessageBatch } from "../control-plane/model-batch.ts";
import { meteredCostFields, priceMeteredUsage, readMeteredUsage } from "../control-plane/model-cost.ts";
import { recordCost } from "../control-plane/repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { ceilingPermits, readIntents, RESEARCH_INTENT_LOG_KEY, researchSpendInWindow } from "../control-plane/scheduler/research-policy.ts";
import { readSpendWindow } from "../control-plane/spend-window.ts";
import { canonicalModelId, MODELS } from "../models.ts";
import type { LookReviewDeps, LookScreenshot } from "./look-review.ts";

export const LOOK_MODEL = MODELS.sonnet.model;
export const LOOK_MAX_TOKENS = 6_000;
/** About what one screenshot costs to read, for the reservation only; the ledger keeps the measured bill. */
const TOKENS_PER_SCREEN = 1_600;
const PROMPT_TOKENS = 3_000;

/** A worst-case price for one review of `screens` screenshots, before it is sent. */
export function lookReviewBoundUsd(screens: number): number {
  const m = MODELS.sonnet;
  return ((screens * TOKENS_PER_SCREEN + PROMPT_TOKENS) * m.inputUsdPerMillion + LOOK_MAX_TOKENS * m.outputUsdPerMillion) / 1_000_000;
}

export interface LookSpendFacts {
  readonly adminConfigRow: { value: unknown } | null | { unreadable: string };
  readonly intentLog: readonly unknown[] | null;
  readonly windowUsd: number | null;
}

/** The decision itself, plain code over what was read. */
export function lookSpendDecision(facts: LookSpendFacts, screens: number): { readonly ok: boolean; readonly why: string } {
  const read = facts.adminConfigRow !== null && "unreadable" in facts.adminConfigRow ? facts.adminConfigRow : { row: facts.adminConfigRow as { value: unknown } | null };
  const paid = adminConfigForPaidWork(read);
  if (paid.holdPaidWork) return { ok: false, why: paid.holdPaidWork };
  if (facts.intentLog === null) return { ok: false, why: "the owner's pause switches could not be read" };
  const intents = readIntents(facts.intentLog as Parameters<typeof readIntents>[0]);
  if (intents.paused) return { ok: false, why: "the owner has paused research" };
  if (intents.runnerPause.paused) return { ok: false, why: "the owner has paused the runner" };
  const ceiling = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(paid.config)).rollingCeilingUsd;
  const admit = ceilingPermits(facts.windowUsd === null ? null : facts.windowUsd + lookReviewBoundUsd(screens), ceiling);
  return { ok: admit.permits, why: admit.why };
}

type Repos = Pick<ControlPlaneRepositories, "adminConfig" | "researchIntents" | "costs">;

export async function reserveLookSpend(repos: Repos, now: string, screens: number): Promise<{ readonly ok: boolean; readonly why: string }> {
  const adminConfigRow = await repos.adminConfig.read(ADMIN_CONFIG_ID).then((row) => row ?? null, (error: unknown) => ({ unreadable: error instanceof Error ? error.name : "unreadable" }));
  const intentLog = await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY).then((rows) => [...rows], () => null);
  const windowUsd = await readSpendWindow(repos as ControlPlaneRepositories, now)
    .then((charges) => researchSpendInWindow(charges, now).windowUsd, () => null);
  return lookSpendDecision({ adminConfigRow, intentLog, windowUsd }, screens);
}

/** Length bounds are left to readLookReview, which checks every answer again; structured output is sent only the shape. */
function plainSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plainSchema);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "minLength" && k !== "maxLength").map(([k, v]) => [k, plainSchema(v)]));
}

export interface LookCallOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** How often to ask whether the batch ended. */
  readonly pollIntervalMs?: number;
  /** How long a batched review may wait before it is canceled and the screens stay "not judged". */
  readonly batchWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const LOOK_BATCH_WAIT_MS = 60 * 60_000;

type LookMessage = { model?: string; usage?: unknown; content?: { type: string; text?: string }[] };

/** One request through the Batches API. A batch that outlasts its wait is canceled, so an unread review is not left running. */
async function lookBatchRequest(apiKey: string, customId: string, params: Record<string, unknown>, fetchImpl: typeof fetch,
  options: LookCallOptions): Promise<LookMessage> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  let batch: MessageBatch = await submitMessageBatch(apiKey, [{ custom_id: customId, params }], fetchImpl);
  while (batch.processing_status !== "ended") {
    if (Date.now() - started > (options.batchWaitMs ?? LOOK_BATCH_WAIT_MS)) {
      await fetchImpl(`${MESSAGE_BATCHES_ENDPOINT}/${encodeURIComponent(batch.id)}/cancel`, {
        method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      }).catch(() => undefined);
      throw new Error(`LOOK_REVIEW_BATCH_TIMEOUT ${batch.id}`);
    }
    await sleep(options.pollIntervalMs ?? 30_000);
    batch = await retrieveMessageBatch(apiKey, batch.id, fetchImpl);
  }
  if (!batch.results_url) throw new Error(`LOOK_REVIEW_BATCH_NO_RESULTS ${batch.id}`);
  const mine = (await readMessageBatchResults(apiKey, batch.results_url, fetchImpl)).find((r) => r.custom_id === customId);
  if (mine?.result.type !== "succeeded") throw new Error(`LOOK_REVIEW_BATCH_${(mine?.result.type ?? "missing").toUpperCase()} ${batch.id}`);
  return mine.result.message as LookMessage;
}

/** The model call the reviewer is handed: screenshots and prompt in, the model's JSON text out, the bill in the ledger. */
export function lookModelCall(repos: ControlPlaneRepositories, apiKey: string, fetchImpl: typeof fetch = fetch,
  options: LookCallOptions = {}): NonNullable<LookReviewDeps["callModel"]> {
  const batched = batchEnabledForJob("background-worker-audit", "AUDIT_SAMPLE", options.env ?? process.env);
  return async ({ prompt, schema, images }) => {
    const attemptId = `look-review-${randomUUID()}`;
    const started = performance.now();
    const content = [
      ...images.flatMap((img: LookScreenshot) => [
        { type: "text", text: `Screen: ${img.label}` },
        { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } },
      ]),
      { type: "text", text: "Judge the screens above, in the order shown, using the label given before each." },
    ];
    const params = {
      model: LOOK_MODEL, max_tokens: LOOK_MAX_TOKENS, system: prompt,
      output_config: { format: { type: "json_schema", schema: plainSchema(schema) } },
      messages: [{ role: "user", content }],
    };
    let status: number | null = null;
    let resultKind: string | null = null;
    let parsed: LookMessage | null = null;
    try {
      if (batched) {
        try { parsed = await lookBatchRequest(apiKey, attemptId, params, fetchImpl, options); resultKind = "BATCH_SUCCEEDED"; }
        catch (error) { resultKind = "BATCH_FAILED"; throw error; }
      } else {
        const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST", signal: AbortSignal.timeout(180_000),
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify(params),
        });
        status = response.status;
        parsed = await response.json().catch(() => null);
        if (!response.ok) throw new Error(`LOOK_REVIEW_HTTP_${response.status}`);
      }
      const text = parsed?.content?.find((b) => b.type === "text")?.text;
      if (typeof text !== "string") throw new Error("LOOK_REVIEW_NO_TEXT");
      return text;
    } finally {
      const metering = readMeteredUsage(parsed?.usage, batched);
      const served = typeof parsed?.model === "string" ? parsed.model : null;
      const model = served ?? LOOK_MODEL;
      const recordedAt = new Date().toISOString();
      const bound = modelRequestBoundFor(LOOK_MODEL, images.length * TOKENS_PER_SCREEN + PROMPT_TOKENS, LOOK_MAX_TOKENS);
      const usd = priceMeteredUsage(canonicalModelId(model), metering, "5m").usd;
      const entry = costEntryWithModel({
        attemptId, workItemId: "look-review", routeTaskId: null, routeId: "look-review", source: "api.anthropic.com",
        jurisdiction: null, project: "pilot-health", role: "VALIDATOR", requestedModel: LOOK_MODEL, servedModel: served,
        ...(bound && usd === null ? { modelRequestBound: bound } : {}),
        resultKind: resultKind ?? (status === null ? "TRANSPORT_UNMEASURED" : `HTTP_${status}`), recordedAt,
        cost: { ...ZERO_COST, ...meteredCostFields(metering),
          inputTokens: metering.uncachedInputTokens === null ? null
            : metering.uncachedInputTokens + (metering.cacheReadInputTokens ?? 0) + (metering.cacheCreationInputTokens ?? 0),
          outputTokens: metering.outputTokens, usd,
          durationMs: Math.round(performance.now() - started), requestCount: 1 },
      }, model);
      try { await recordCost(repos, entry, recordedAt); }
      catch (error) { console.error(`look review: the cost could not be recorded (${error instanceof Error ? error.name : "error"}); attempt ${attemptId}`); }
    }
  };
}
