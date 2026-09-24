/**
 * **A FINISHED RESEARCH CYCLE EXITS; IT NEVER WAITS FOR THE WALL.**
 * (Runner bounded store calls, follow-up, 2026-09-24.)
 *
 * After its last awaited step (the canonical digest append, the local record,
 * the window-lease release, the stall worker stopped) the cycle has nothing
 * left to do, and the process ends when its event loop drains. Sometimes the
 * loop did not drain. On 2026-09-24 the 07:49Z cycle on a9cc2e13 appended its
 * digest and wrote its local record at 07:59:02, and it was still alive at the
 * 15-minute wall. So the supervisor SIGTERMed it, and the owner digest read
 * "Cycle process exit: NON-ZERO — the cycle did not finish". The same happened
 * at 17:48Z, 19:49Z and 21:50Z on 2026-09-23 and at 01:33Z, 04:05Z and 06:04Z
 * on 2026-09-24, before and after the bounded store calls. Something outside
 * the cycle's own awaits (a socket, a timer, a handle) held the loop open,
 * and nothing said what.
 *
 * So the script's last statement arms an unref'd timer. If the loop drains
 * first, the timer never fires and the process exits exactly as before. If the
 * process is still alive after the grace, it names on stderr the resource types
 * still keeping it alive, then exits with the code the cycle already chose.
 * The names are types only (`TCPSocketWrap`, `Timeout`, ...): no URL, no
 * payload, no credential. The recorded outcome is untouched, because it was
 * written before this point.
 *
 * PURE. The clock, the resource reading and the exit are injected.
 */

/** Seconds of loop drain a finished cycle is allowed before it exits by name. */
export const CYCLE_DRAIN_GRACE_MS = 15_000;

export interface CycleDrainGraceTimer {
  unref(): unknown;
}

export interface CycleDrainGraceInput {
  readonly graceMs: number;
  /** When the cycle's last awaited step finished (ISO instant). */
  readonly finishedAt: string;
  /** The exit code the cycle already chose; read when the grace ends. */
  readonly exitCode: () => number;
  /** The active resource types keeping the loop alive (`process.getActiveResourcesInfo`). */
  readonly activeResources: () => readonly string[];
  readonly log: (line: string) => void;
  readonly exit: (code: number) => void;
  readonly setTimer?: (fn: () => void, ms: number) => CycleDrainGraceTimer;
}

/** A tally of resource types, most common first, then by name. */
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
