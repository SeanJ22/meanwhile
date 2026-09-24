/**
 * **A KILLED CHILD SAYS WHERE IT STOPPED.** (2026-09-24.)
 *
 * The standing runner bounds each Reader-repair child at two minutes. When it
 * kills one, it records the child's last output lines as the failure detail
 * (`boundedExecutionFailure` in scripts/routine-civic-data-runner.mts). A child
 * that printed nothing leaves only "TIMED_OUT: Command failed: <command>".
 * 36 readback repairs timed out that way on 2026-09-24, in four supervisor
 * passes. Not one said whether it was still loading modules, was waiting on a
 * store request, or was running the typed Reader.
 *
 * A stage line names the elapsed process time and the step started or
 * settled, so the last line a killed child printed is where it stopped. A
 * store call started with no settled line after it was the one in flight.
 */

/** One stage line: `<label> +<seconds since the process started>s <what>`. */
export function stageLine(label: string, what: string, uptimeSeconds: number = process.uptime()): string {
  return `${label} +${uptimeSeconds.toFixed(1)}s ${what}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The same object, with a stage line written when each method call starts and
 * when its promise settles or fails. The method runs on the original object,
 * and arguments, results and errors pass through unchanged. Arguments are
 * never written.
 */
export function traceMethodCalls<T extends object>(
  target: T,
  name: string,
  log: (what: string) => void,
  now: () => number = () => performance.now(),
): T {
  return new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property, object);
      if (typeof value !== "function" || typeof property === "symbol") return value;
      return (...args: unknown[]) => {
        const call = `${name}.${property}`;
        const started = now();
        log(call);
        const result: unknown = (value as (...parameters: unknown[]) => unknown).apply(object, args);
        if (!(result instanceof Promise)) return result;
        return result.then(
          (settled) => {
            log(`${call} settled in ${seconds(now() - started)}`);
            return settled;
          },
          (error: unknown) => {
            log(`${call} failed in ${seconds(now() - started)}`);
            throw error;
          },
        );
      };
    },
  });
}
