import type { ControlPlaneRepositories } from "../repository/types.ts";

export interface CyclePhase {
  readonly name: string;
  readonly durationMs: number;
  readonly repositoryCalls: number;
}

/** Counts repository calls, not guessed SQL counts; contains no arguments or credentials. */
export function observeCyclePhases(repos: ControlPlaneRepositories, now: () => number = Date.now) {
  let calls = 0;
  let phaseCalls = 0;
  let since = now();
  const phases: CyclePhase[] = [];
  const observed = new Proxy(repos, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (!value || typeof value !== "object") return value;
      return new Proxy(value, {
        get(repository, method) {
          const operation = Reflect.get(repository, method);
          if (typeof operation !== "function") return operation;
          return (...args: unknown[]) => { calls += 1; return operation.apply(repository, args); };
        },
      });
    },
  });
  return {
    repos: observed,
    phases,
    /** A timed step that runs beside the sequential phases (for example the round's one vault index); it never moves the phase clock. */
    note(name: string, durationMs: number): CyclePhase {
      const phase = { name, durationMs: Math.max(0, durationMs), repositoryCalls: 0 };
      phases.push(phase);
      return phase;
    },
    finish(name: string): CyclePhase {
      const at = now();
      const phase = { name, durationMs: Math.max(0, at - since), repositoryCalls: calls - phaseCalls };
      phases.push(phase);
      since = at;
      phaseCalls = calls;
      return phase;
    },
  };
}
