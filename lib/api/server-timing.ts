/**
 * Named stage times for a `Server-Timing` header (`name;dur=ms`), plus `total`
 * from the timer's creation. A CDN hit replays the header of the response that
 * filled it; `Cache-Status` says whether the response was a hit.
 */
export interface StageTimer {
  /** Time one stage from this call until it settles, resolved or rejected. */
  time<T>(name: string, run: () => Promise<T>): Promise<T>;
  /** Start a stage by hand; the returned function ends it. */
  start(name: string): () => void;
  /** The header value: every finished stage, then `total`. */
  header(): string;
}

export function stageTimer(now: () => number = () => performance.now()): StageTimer {
  const began = now();
  const stages = new Map<string, number>();
  const start = (name: string) => {
    const at = now();
    return () => { stages.set(name, now() - at); };
  };
  return {
    time(name, run) {
      const end = start(name);
      return Promise.resolve().then(run).finally(end);
    },
    start,
    header() {
      return [...stages, ["total", now() - began] as const]
        .map(([name, ms]) => `${name};dur=${Math.round(ms)}`)
        .join(", ");
    },
  };
}
