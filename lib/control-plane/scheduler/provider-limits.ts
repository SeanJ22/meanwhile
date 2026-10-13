import { FEDERAL_SOURCES } from "../../sources/congress/targets.ts";
import { registerSetting } from "../settings.ts";

/** How many requests to one website may be in flight at once when the publisher states no limit. */
export const HOST_CONCURRENCY_SETTING = "fetch.hostConcurrency";
export const HOST_CONCURRENCY_DEFAULT = 8;
registerSetting({
  key: HOST_CONCURRENCY_SETTING, label: "Requests at once to one website that publishes no limit", defaultValue: HOST_CONCURRENCY_DEFAULT,
  unit: "requests", readerFacing: false, control: "number",
  validate: (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 200,
});

/** Requests an hour each provider documents (cited beside each source), by origin. */
const PUBLISHED_HOURLY_LIMITS: ReadonlyMap<string, number> = new Map(Object.values(FEDERAL_SOURCES)
  .filter(source => source.paceMs > 0).map(source => [new URL(source.url).origin, 3_600_000 / source.paceMs] as const));

export type ProviderState = "CLOSED" | "HALF_OPEN" | "OPEN";

/* One probe while half-open; an open provider's rows reach admission one at a time to be held there. A request is in
   flight well under a minute, so a published hourly limit allows its per-minute share at once. */
export function providerConcurrency(provider: string, state: ProviderState, hostConcurrency: number): number {
  if (state !== "CLOSED") return 1;
  const hourly = PUBLISHED_HOURLY_LIMITS.get(provider);
  return hourly === undefined ? hostConcurrency : Math.max(1, Math.floor(hourly / 60));
}
