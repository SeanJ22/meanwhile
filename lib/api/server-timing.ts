/**
 * **NAMED STAGE TIMES FOR A `Server-Timing` HEADER.** (C21, 2026-09-25.)
 *
 * A production timing of a reader route used to be one number measured from
 * outside, which cannot say whether the seconds went to booting, to the edge
 * fetch, to geometry or to the coverage build. Each stage timed here is named
 * in the response's `Server-Timing` header (`name;dur=ms`, the W3C form the
 * funding route already sends), readable with curl or the browser's network
 * panel, plus `total` from the timer's creation.
 *
 * A CDN hit replays the header of the response that filled it, so a stage time
 * describes the request that computed the answer; Netlify's `Cache-Status`
 * header says whether the one in hand was a hit.
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
