/** After a finished cycle, an unref'd timer exits the process if the event loop has not drained within the grace, naming the resource types still holding it (types only). Pure. */

/** Seconds of loop drain a finished cycle is allowed before it exits by name. */
export const CYCLE_DRAIN_GRACE_MS = 15_000;

export interface CycleDrainGraceTimer {
  unref(): unknown;
}

export interface CycleDrainGraceInput {
  readonly graceMs: number;
  readonly finishedAt: string;
  readonly exitCode: () => number;
  readonly activeResources: () => readonly string[];
  readonly log: (line: string) => void;
  readonly exit: (code: number) => void;
  readonly setTimer?: (fn: () => void, ms: number) => CycleDrainGraceTimer;
}

export function describeActiveResources(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return rows.length === 0 ? "nothing the runtime reports" : rows.map(([type, n]) => `${type} x${n}`).join(", ");
}

/** The exit code Node would use, as a number: a string or unset code is 0. */
export function chosenExitCode(code: number | string | null | undefined): number {
  if (typeof code === "number" && Number.isInteger(code)) return code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  return 0;
}

export function exitAfterDrainGrace(input: CycleDrainGraceInput): CycleDrainGraceTimer {
  const setTimer = input.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const timer = setTimer(() => {
    const code = input.exitCode();
    input.log(
      `freshness:shadow · the cycle finished at ${input.finishedAt}, and ${Math.round(input.graceMs / 1000)} s later ` +
        `the process was still alive, held open by: ${describeActiveResources(input.activeResources())}. ` +
        `Exiting ${code}; the recorded outcome stands.`,
    );
    input.exit(code);
  }, input.graceMs);
  // Never the reason the process stays alive: a drained loop exits before this fires.
  timer.unref();
  return timer;
}
