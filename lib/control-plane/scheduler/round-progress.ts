import { createHash } from "node:crypto";

/**
 * Progress lines for long phases of the research round: each finished task is counted and the counts printed
 * at most every `ROUND_PROGRESS_EVERY_MS`, so finished work renews the runner's no-progress limit while a real
 * hang still prints nothing. The stall-probe answer names what the round waits on and never counts as progress.
 */
export const ROUND_PROGRESS_EVERY_MS = 30_000;
export const RESEARCH_STALL_PROBE = "RESEARCH_STALL_PROBE";
/** The round supervisor prints a line with this prefix before it starts each state's planner. */
export const PLANNER_SCOPE_PREFIX = "planning scope:";
/** The runner never counts a line with this prefix as progress. */
export const STALL_REPORT_PREFIX = "research stall report:";
/** Beats, release notices and vital-signs report lines (transfer-by-caller.ts) are not the round's own progress either. */
const NOT_PROGRESS = /^vital-signs-bytes |heartbeat|\bbeatAt\b|runtime release|release (?:drain|handoff)|RUNTIME_RELEASE_DRAIN/i;

/**
 * Whether the runner can count `line` as progress at all: not blank, not a stall
 * answer, not a beat or release notice. The runner also counts a line only the
 * first time it sees it on that stream (`progressLines`).
 */
export function mayCountAsProgress(line: string): boolean {
  return line.trim() !== "" && !line.includes(STALL_REPORT_PREFIX) && !NOT_PROGRESS.test(line);
}

/** The runner's progress rule over one output stream: the complete lines in `chunk` that renew its limit (counted, first seen on this stream). The child reads its own output the same way. */
export function progressLines(scope: ProgressScope = {}): (chunk: string) => number {
  const seen = (scope.seen ??= new Set<string>());
  let partial = "";
  return chunk => {
    const lines = (partial + chunk).split(/\r?\n/);
    partial = lines.pop() ?? "";
    let renewed = 0;
    for (const line of lines) {
      if (!mayCountAsProgress(line)) continue;
      const key = createHash("sha256").update(line).digest("hex");
      if (seen.has(key)) continue;
      // A planner marker opens a new scope: the lines before it no longer make later lines repeats.
      if (line.startsWith(PLANNER_SCOPE_PREFIX)) seen.clear();
      seen.add(key);
      renewed += 1;
    }
    return renewed;
  };
}

/**
 * The lines already seen, shared by the streams one reader watches. The round runs one planner process per state on
 * the runner's own pipe, and each planner's own clock starts empty; the planner marker lets the runner's list start
 * over at the same point, so both count the same lines as progress.
 */
export interface ProgressScope { seen?: Set<string> }

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
