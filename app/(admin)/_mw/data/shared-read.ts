/**
 * **ONE READ AT A TIME, AND NEVER PAST THE PAGE'S DEADLINE.** (Admin
 * redesign, 2026-09-23.)
 *
 * The Admin pages run as a Netlify function with a ten-second limit, and a
 * page cut off at the limit reaches the owner as "This page didn't load" —
 * measured on the deployed site the first time Work was opened on a cold
 * instance. The heavy reads behind the pages are the registry projection
 * (3.6 MB, ~4.5 s cold), the Census lookup (~5.6 s cold) and the watched
 * bodies (~4 s cold). Three rules keep a page inside the limit:
 *
 * ```
 *   shared     callers that arrive while a read is in flight wait for that
 *              read rather than starting their own (All states read the
 *              lookup three times over, in parallel, before this)
 *   recent     a read younger than `staleMs` is served while a fresh one is
 *              fetched behind it; every page names the time its figures were
 *              read, so a recent read is never passed off as a new one
 *   deadline   a read that has not answered by `deadlineMs` is returned as
 *              not read this time, with its reason, and keeps running so the
 *              next page view has it — never a blank that reads as none
 * ```
 *
 * A read older than `staleMs` is never served: the page waits for a fresh
 * one, up to the deadline.
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
  /** What the page shows when the read has not answered by the deadline. */
  readonly late: (deadlineMs: number) => T;
}

export interface SharedRead<T> {
  /** The read, shared, recent or fresh, or `late` when it misses the deadline. */
  read(load: () => Promise<T>): Promise<T>;
  /** For tests: forget what is held. */
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

/** The sentence a read that missed the page's deadline carries. */
export function lateWords(what: string, deadlineMs: number): string {
  return `${what} did not answer within ${Math.round(deadlineMs / 1000)} seconds, so it is not shown this time. It is still being read; opening the page again shows it. That is not the same as there being none.`;
}
