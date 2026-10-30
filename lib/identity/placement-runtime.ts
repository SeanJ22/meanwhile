import { randomUUID } from "node:crypto";
import { ZERO_COST } from "../control-plane/attempt.ts";
import { costEntryWithModel } from "../control-plane/cost.ts";
import { meteredCostFields, priceMeteredUsage, readMeteredUsage } from "../control-plane/model-cost.ts";
import { recordCost } from "../control-plane/repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { modelRequestAccounting, type ModelTransport } from "../control-plane/scheduler/scout-executor.ts";
import { visibleText } from "../extract/visible-text.ts";
import { memoryInProcess, nodeResearchGet, researchFetch } from "../hunt/robots-first-fetch.ts";
import type { PlacementPage } from "./placement-agent.ts";

const memory = memoryInProcess();
const hostOf = (value: string): string => value.split("/")[0]!.toLowerCase().replace(/^www\./, "");

/** The government's own pages: its registered sites and the pages its facts already came from, read with the same manners as every other reader. */
export async function placementPages(hosts: readonly string[], sources: readonly string[]): Promise<readonly PlacementPage[]> {
  const own = new Set(hosts.map(hostOf));
  const urls = [...new Set([...sources, ...[...own].map(host => `https://${host}/`)])]
    .filter(url => URL.canParse(url) && [...own].some(host => { const at = hostOf(new URL(url).host); return at === host || at.endsWith(`.${host}`); })).slice(0, 4);
  const pages: PlacementPage[] = [];
  for (const url of urls) {
    const got = await researchFetch(url, { get: nodeResearchGet, memory, now: Date.now, sleep: ms => new Promise(done => setTimeout(done, ms)) });
    if (got.outcome === "FETCHED" && got.status === 200 && /html|text/i.test(got.contentType)) pages.push({ url: got.finalUrl, text: visibleText(new TextDecoder().decode(got.body)).slice(0, 80_000) });
  }
  return pages;
}

/** Each placement request is written to the cost ledger as it is paid for. */
export function meteredPlacement(repos: Pick<ControlPlaneRepositories, "costs" | "spend">, send: ModelTransport, subjectId: string): ModelTransport {
  return async request => {
    const started = performance.now(), response = await send(request);
    const usage = readMeteredUsage(response.usage, response.batch === true), at = new Date().toISOString();
    await recordCost(repos, costEntryWithModel({ attemptId: `placement:${randomUUID()}`, workItemId: subjectId, routeTaskId: null, routeId: "placement-agent",
      source: "api.anthropic.com", jurisdiction: null, project: "freshness", role: "DETECTIVE", costPolicy: "R7", recordedAt: at, requestedModel: request.model, servedModel: response.model,
      cost: { ...ZERO_COST, ...meteredCostFields(usage), ...modelRequestAccounting(response), requestCount: 1,
        inputTokens: usage.uncachedInputTokens === null ? null : usage.uncachedInputTokens + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0),
        outputTokens: usage.outputTokens, usd: priceMeteredUsage(response.model, usage, "5m").usd, durationMs: Math.round(performance.now() - started) } }, response.model), at);
    return response;
  };
}
