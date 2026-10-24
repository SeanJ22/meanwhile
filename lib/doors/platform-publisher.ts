import { AsyncLocalStorage } from "node:async_hooks";
import type { BodySourceWiring } from "../registry/source-wiring.ts";

const publisher = new AsyncLocalStorage<{ website: string; origin: string }>();
const origin = (value: string) => { try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).origin; } catch { return null; } };

/** A verified tenant is this government's website; a shared national API remains its own publisher. */
export function withPlatformPublisher<T>(website: string | null | undefined, url: string, work: () => T): T {
  const target = origin(url);
  if (!website || !origin(website) || !target || new URL(target).hostname === "webapi.legistar.com") return work();
  return publisher.run({ website, origin: target }, work);
}

/** The size still comes from the held Census publisher record, never a guessed population. */
export function registeredPublisherWebsite(url: string): string | null {
  const context = publisher.getStore();
  return context && context.origin === origin(url) ? context.website : null;
}

/** Ordinary platform doors carry their registered website through the injected HTTP reader. */
export function platformPublisherFetch(rows: readonly BodySourceWiring[], fetchImpl?: typeof fetch): typeof fetch | undefined {
  const websites = new Map<string, Set<string>>();
  for (const row of rows) {
    const website = row.config.governmentWebsite, target = origin(row.config.platformPublisherUrl ?? row.config.route ?? "");
    if (!website || !target) continue;
    const own = websites.get(target) ?? new Set<string>(); own.add(website); websites.set(target, own);
  }
  if (!websites.size) return fetchImpl;
  return (input, init) => {
    const read = fetchImpl ?? globalThis.fetch;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const own = websites.get(origin(url) ?? "");
    return own?.size === 1 ? withPlatformPublisher([...own][0], url, () => read(input, init)) : read(input, init);
  };
}
