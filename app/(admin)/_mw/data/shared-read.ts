/**
 * Admin pages run under a ten-second function limit. Three rules keep a page inside it:
 *
 *   shared     callers that arrive while a read is in flight wait for that read
 *   recent     a read younger than `staleMs` is served while a fresh one is fetched behind it
 *   deadline   a read that misses `deadlineMs` is returned as not read, with its reason, and keeps running
 *
 * A read older than `staleMs` is never served.
 */

export interface SharedReadOptions<T> {
  /** Served without a fetch while younger than this. */
  readonly freshMs: number;
  /** Served while a fresh read runs behind it, while younger than this. */
  readonly staleMs: number;
  /** How long a page waits for a read before saying it was not read. */
  readonly deadlineMs: number;
  /** Whether a result may be kept: a failed read is never cached. */
  readonly keep: (value: T) => boolean;
  readonly late: (deadlineMs: number) => T;
}

export interface SharedRead<T> {
  read(load: () => Promise<T>): Promise<T>;
  reset(): void;
}

/**
 * How long a page waits for any one read. The reads run in parallel, the
 * function's limit is ten seconds, and the control-plane reads and the render
 * itself need the rest.
 */
export const ADMIN_READ_DEADLINE_MS = 6_000;

/** A read in flight is abandoned after this long, so a hung socket cannot hold every later caller. */
const ABANDON_AFTER_MS = 60_000;

export function sharedRead<T>(options: SharedReadOptions<T>, now: () => number = Date.now): SharedRead<T> {
  let held: { readonly at: number; readonly value: T } | null = null;
  let inFlight: { readonly since: number; readonly promise: Promise<T> } | null = null;

  const start = (load: () => Promise<T>): Promise<T> => {
    if (inFlight && now() - inFlight.since < ABANDON_AFTER_MS) return inFlight.promise;
    const since = now();
    const promise = load()
      .then((value) => {
        if (options.keep(value)) held = { at: now(), value };
        return value;
      })
      .finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
      });
    inFlight = { since, promise };
    return promise;
  };

  return {
    async read(load) {
      const age = held === null ? Infinity : now() - held.at;
      if (held !== null && age < options.freshMs) return held.value;
      if (held !== null && age < options.staleMs) {
        // Refreshed behind the page; a failure there leaves the recent read in place.
        start(load).catch(() => undefined);
        return held.value;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(options.late(options.deadlineMs)), options.deadlineMs);
      });
      try {
        return await Promise.race([start(load), late]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    reset() {
      held = null;
      inFlight = null;
    },
  };
}

export function lateWords(what: string, deadlineMs: number): string {
  return `${what} did not answer within ${Math.round(deadlineMs / 1000)} seconds, so it is not shown this time. It is still being read; opening the page again shows it. That is not the same as there being none.`;
}
