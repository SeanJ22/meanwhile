import { randomUUID } from "node:crypto";
import { ZERO_COST } from "../control-plane/attempt.ts";
import { costEntryWithModel, modelRequestBoundFor, type CostEntry } from "../control-plane/cost.ts";
import { listPriceUsdForUsage, meteredCostFields, priceMeteredUsage, readMeteredUsage } from "../control-plane/model-cost.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { recordCost } from "../control-plane/repository/coordinator.ts";
import { canonicalModelId } from "../models.ts";
import { afterResponse } from "../log/after-response.ts";
import { askJobId } from "./runtime-settings.ts";

export type AskCostWriter = (entry: CostEntry) => Promise<void>;
let repositories: ReturnType<typeof createPgRepositories> | undefined;
const appendAskCost: AskCostWriter = async entry => {
  const url = controlPlaneUrlFromEnv();
  if (!url) return;
  const repos = await (repositories ??= createPgRepositories(url, entry.recordedAt, { skipBootstrap: true }));
  await recordCost(repos, entry, entry.recordedAt);
};

/** Meter each send, including hedge losers and failures. No question, answer,
 * prompt hash, reader identity or provider error message is retained. */
export function meteredAskFetch(impl: typeof fetch, lane: string, write: AskCostWriter = appendAskCost): typeof fetch {
  return async (url, init) => {
    const id = `ask-${randomUUID()}`, started = performance.now();
    const params = JSON.parse(String(init?.body ?? "{}")) as { model?: string; max_tokens?: number; system?: unknown; cache_control?: unknown };
    const ttl = (JSON.stringify(params.system) ?? "").includes('"ttl":"1h"') ? "1h" : "5m";
    const requestBody = JSON.stringify({ ...params,
      cache_control: params.cache_control ?? { type: "ephemeral" } });
    const requestBound = typeof params.model === "string" && typeof params.max_tokens === "number"
      ? modelRequestBoundFor(params.model, Buffer.byteLength(requestBody), params.max_tokens) : null;
    let body: { model?: string; usage?: unknown } | null = null;
    let status: number | null = null;
    try {
      const response = await impl(url, { ...init, body: requestBody });
      status = response.status;
      try { body = await response.clone().json(); } catch { /* An unreadable response has unknown usage. */ }
      return response;
    } finally {
      const metering = readMeteredUsage(body?.usage);
      const model = typeof body?.model === "string" ? body.model : params.model ?? null;
      const usd = model === null ? null : priceMeteredUsage(canonicalModelId(model), metering, ttl).usd;
      const entry = costEntryWithModel({ attemptId: id, workItemId: askJobId() ?? id, routeTaskId: null,
        costPolicy: "R7",
        requestedModel: params.model ?? null, servedModel: typeof body?.model === "string" ? body.model : null,
        ...(requestBound && usd === null ? { modelRequestBound: requestBound } : {}),
        routeId: `ask:${lane}`, source: "api.anthropic.com", jurisdiction: null, project: "ask", role: "ASK",
        resultKind: status === null ? "TRANSPORT_UNMEASURED" : `HTTP_${status}`, recordedAt: new Date().toISOString(),
        cost: { ...ZERO_COST, ...meteredCostFields(metering), inputTokens: metering.uncachedInputTokens === null ? null
          : metering.uncachedInputTokens + (metering.cacheReadInputTokens ?? 0) + (metering.cacheCreationInputTokens ?? 0),
          outputTokens: metering.outputTokens, usd,
          durationMs: Math.round(performance.now() - started), requestCount: 1,
          listPriceUsd: model === null ? null : listPriceUsdForUsage(model, metering),
          modelRequestCount: 1, batchEligibleRequestCount: 0, batchRequestCount: 0 } }, model);
      await afterResponse(async () => {
        try { await write(entry); }
        catch (error) { repositories = undefined; console.error(`Ask cost recording unavailable: ${id}; ${error instanceof Error ? error.name : "Error"}`); }
      });
    }
  };
}
