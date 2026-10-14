import { FEDERAL_SOURCES } from "../../sources/congress/targets.ts";
import { registerSetting } from "../settings.ts";
import type { WebsitePacing } from "../website-pacing.ts";

/** How many requests to one website may be in flight at once, whatever it publishes. */
export const HOST_CONCURRENCY_SETTING = "fetch.hostConcurrency";
export const HOST_CONCURRENCY_DEFAULT = 8;
registerSetting({
  key: HOST_CONCURRENCY_SETTING, label: "Requests in flight at once to one website", defaultValue: HOST_CONCURRENCY_DEFAULT,
  unit: "requests", readerFacing: false, control: "number",
  validate: (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 200,
});

/** Requests an hour each provider documents (cited beside each source), by origin. */
const PUBLISHED_HOURLY_LIMITS: ReadonlyMap<string, number> = new Map(Object.values(FEDERAL_SOURCES)
  .filter(source => source.paceMs > 0).map(source => [new URL(source.url).origin, 3_600_000 / source.paceMs] as const));

export function publishedHourlyLimit(provider: string): number | null {
  return PUBLISHED_HOURLY_LIMITS.get(provider) ?? null;
}

export type ProviderState = "CLOSED" | "HALF_OPEN" | "OPEN";

/* One probe while half-open; an open provider's rows reach admission one at a time to be held there. */
export function providerConcurrency(state: ProviderState, hostConcurrency: number): number {
  return state === "CLOSED" ? Math.max(1, hostConcurrency) : 1;
}

/* Requests in flight per provider, for every caller in this process. */
const inFlight = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();
/* This process's own pace, when there is no shared store or it cannot answer. */
const localPacing = new Map<string, number>();

export interface HostGateInput {
  readonly provider: string;
  /** Read on every wait, so a breaker that opens or half-opens meanwhile applies to requests already queued. */
  readonly limit: () => number;
  /** The store every reader shares; when it cannot answer, this process paces alone. */
  readonly pacing: WebsitePacing;
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<unknown>;
}

/**
 * Take a place in flight for one request, then its turn at the provider's published rate: a bucket that refills at
 * limit/hour and holds one send, so no rolling hour carries more than the limit. Resolves to the release.
 */
export async function enterHostGate(input: HostGateInput): Promise<() => void> {
  const { provider } = input;
  await new Promise<void>(granted => {
    const queue = waiting.get(provider) ?? [];
    queue.push(granted);
    waiting.set(provider, queue);
    grant(provider, input.limit());
  });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlight.set(provider, (inFlight.get(provider) ?? 1) - 1);
    grant(provider, input.limit());
  };
  try {
    const hourly = publishedHourlyLimit(provider);
    if (hourly !== null) {
      const intervalMs = 3_600_000 / hourly, now = input.clock(), key = `pace:${provider}`;
      const at = await input.pacing.reserve(key, intervalMs, now).catch(() => reserveLocally(key, intervalMs, now));
      if (at > now) await input.sleep(at - now);
    }
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

/* Places hand straight to the longest waiting request, so a queue of thousands wakes one at a time. */
function grant(provider: string, limit: number): void {
  const queue = waiting.get(provider) ?? [];
  while (queue.length > 0 && (inFlight.get(provider) ?? 0) < limit) {
    inFlight.set(provider, (inFlight.get(provider) ?? 0) + 1);
    queue.shift()!();
  }
  if (queue.length === 0) waiting.delete(provider);
}

function reserveLocally(key: string, intervalMs: number, nowMs: number): number {
  const at = Math.max(nowMs, localPacing.get(key) ?? 0);
  localPacing.set(key, at + intervalMs);
  return at;
}
