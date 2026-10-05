/**
 * **A LONG PHASE OF THE RESEARCH ROUND SAYS IT IS STILL MOVING.**
 * (Returned live failure, 2026-10-05.)
 *
 * The runner ends the research child after ten minutes with no changed output
 * (`RESEARCH_CHILD_NO_PROGRESS`, scripts/pilot-runtime-child.mts). From
 * 2026-10-04 every round on the production runner ended that way: the worker
 * wave, the dispatch phase and the meetings-discovery lane each finish many
 * tasks but printed nothing until the whole phase ended, and the wave alone
 * runs up to its 15-minute slice. Finished work is progress, so each finished
 * task is counted here and the counts are printed at most every
 * `ROUND_PROGRESS_EVERY_MS`. A phase where nothing finishes still prints
 * nothing, so a real hang is still ended at the same limit.
 *
 * Shortly before that limit the runner asks the child what it is waiting on
 * (`RESEARCH_STALL_PROBE`). The child answers with one line naming its
 * labelled await, its store calls in flight and its last phase. That line does
 * not count as progress, and it stays in the stderr tail the failed round's
 * digest carries, so the next stall names its phase. No answer means the
 * child's event loop was blocked.
 */
export const ROUND_PROGRESS_EVERY_MS = 30_000;
export const RESEARCH_STALL_PROBE = "RESEARCH_STALL_PROBE";
/** The runner never counts a line with this prefix as progress. */
export const STALL_REPORT_PREFIX = "research stall report:";

export interface RoundProgress {
  /** One finished unit of work under `label` (e.g. "worker wave"). */
  note(label: string): void;
  /** Print what is counted but not yet printed. */
  flush(): void;
}

export function roundProgressReporter(options: {
  readonly write?: (line: string) => void;
  readonly everyMs?: number;
  readonly now?: () => number;
} = {}): RoundProgress {
  const write = options.write ?? (line => console.log(line));
  const everyMs = options.everyMs ?? ROUND_PROGRESS_EVERY_MS;
  const now = options.now ?? Date.now;
  const counts = new Map<string, number>();
  let printedAt = Number.NEGATIVE_INFINITY;
  let unprinted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!unprinted) return;
    unprinted = false;
    printedAt = now();
    write(`  round progress: ${[...counts].map(([label, n]) => `${label} ${n} finished`).join(" · ")}`);
  };
  return {
    note(label) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
      unprinted = true;
      if (timer !== undefined) return;
      const wait = printedAt + everyMs - now();
      if (wait <= 0) { flush(); return; }
      timer = setTimeout(flush, wait);
      timer.unref?.();
    },
    flush,
  };
}

/** Answer the runner's probe with what the round is waiting on. The answer never renews the runner's limit. */
export function answerStallProbes(input: {
  /** What the round is waiting on, e.g. `describePending(pending.snapshot())` (cycle-stall.ts). */
  readonly describe: () => string;
  readonly on?: (listener: (message: unknown) => void) => void;
  readonly write?: (line: string) => void;
}): void {
  const write = input.write ?? (line => console.error(line));
  const on = input.on ?? (listener => { process.on("message", listener); });
  on(message => {
    if (message === null || typeof message !== "object" || (message as { kind?: unknown }).kind !== RESEARCH_STALL_PROBE) return;
    write(`  ${STALL_REPORT_PREFIX} ${input.describe()}`);
  });
}
