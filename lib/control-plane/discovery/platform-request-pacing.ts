import { hostSpacer } from "../scheduler/http-executor.ts";
import { INSITE_SPACING_MS } from "../../sources/legistar-insite/http.ts";

/** Concurrent workers share one admission queue. Legistar's published delay applies across its tenants. */
export function platformRequestPacer(spaceOut = hostSpacer(0), legistarSpaceOut = hostSpacer(INSITE_SPACING_MS)) {
  const queues = new Map<string, Promise<void>>();
  return (url: string) => {
    const host = new URL(url).hostname;
    const legistar = /(?:^|\.)legistar\.com$/.test(host);
    const key = legistar ? "legistar.com" : host;
    const next = (queues.get(key) ?? Promise.resolve()).then(() => (legistar ? legistarSpaceOut : spaceOut)(key));
    queues.set(key, next);
    const remove = () => { if (queues.get(key) === next) queues.delete(key); };
    void next.then(remove, remove);
    return next;
  };
}
