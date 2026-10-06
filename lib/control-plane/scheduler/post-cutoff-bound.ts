/**
 * **WORK AFTER THE DISPATCH CUTOFF ENDS AS A DEFERRAL, NOT A KILL.**
 * (Returned live failure, River 2026-10-06 ~01:10Z.)
 *
 * The runner ends the research child after `RUNTIME_NO_PROGRESS_MS` with no
 * changed output (scripts/pilot-runtime-child.mts). After the dispatch cutoff
 * the round still joins its discovery lanes and reads held bytes for the
 * promotion tail; on the 23:13:58Z production cycle the child printed nothing
 * for ten minutes there and was killed, so every finished task of that round
 * went unrecorded. Each such wait now races a quiet limit measured from the
 * child's own last output line: if nothing has been printed for `quietMs`
 * the wait ends, the caller names what was still running as deferred (its
 * work stays owed), and that line is itself the next output. The limit sits
 * below the runner's, so a slow lane is a named deferral and a genuine hang
 * elsewhere is still ended by the unchanged watchdog. Nothing here prints on
 * a timer: a wait that ends prints once, because it ended.
 */
import { STALL_REPORT_PREFIX } from "./round-progress.ts";

/** How far inside the runner's no-progress limit a post-cutoff wait ends: before the runner's stall probe (one minute inside). */
export const POST_CUTOFF_QUIET_LEAD_MS = 3 * 60_000;

export interface OutputClock {
  /** Epoch ms of the last line the runner would count as progress. */
  lastOutputAt(): number;
}

type Writable = { write: (chunk: unknown, ...rest: unknown[]) => boolean };

/**
 * Track the child's last progress output by watching its own stdout and
 * stderr. Stall-report answers are not progress to the runner, so they are not
 * progress here either.
 */
export function watchOutputClock(options: {
  readonly streams?: readonly Writable[];
  readonly now?: () => number;
} = {}): OutputClock {
  const now = options.now ?? Date.now;
  const streams = options.streams ?? [process.stdout as unknown as Writable, process.stderr as unknown as Writable];
  let last = now();
  for (const stream of streams) {
    const write = stream.write.bind(stream);
    stream.write = (chunk: unknown, ...rest: unknown[]) => {
      const text = typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : "";
      if (text.trim() !== "" && !text.includes(STALL_REPORT_PREFIX)) last = now();
      return write(chunk, ...rest);
    };
  }
  return { lastOutputAt: () => last };
}

export type QuietBounded<T> =
  | { readonly done: true; readonly value: T }
  | { readonly done: false; readonly quietMs: number };

/**
 * `work`, or `{ done: false }` once the child has printed nothing for
 * `quietMs`. Output during the wait moves the limit forward; a rejection of an
 * abandoned `work` is swallowed so it cannot surface later as unhandled.
 */
export async function untilQuietLimit<T>(work: Promise<T>, input: {
  readonly clock: OutputClock;
  readonly quietMs: number;
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => { clear(): void };
}): Promise<QuietBounded<T>> {
  work.catch(() => undefined);
  const now = input.now ?? Date.now;
  const setTimer = input.setTimer ?? ((run, ms) => { const t = setTimeout(run, ms); return { clear: () => clearTimeout(t) }; });
  let timer: { clear(): void } | undefined;
  const quiet = new Promise<{ readonly done: false; readonly quietMs: number }>(resolve => {
    const check = () => {
      const remaining = input.clock.lastOutputAt() + input.quietMs - now();
      if (remaining <= 0) { resolve({ done: false, quietMs: now() - input.clock.lastOutputAt() }); return; }
      timer = setTimer(check, remaining);
    };
    check();
  });
  try {
    return await Promise.race([work.then(value => ({ done: true as const, value })), quiet]);
  } finally {
    timer?.clear();
  }
}
