/** A killed child says where it stopped: stage lines written as each call starts and settles. */

/** One stage line: `<label> +<seconds since the process started>s <what>`. */
export function stageLine(label: string, what: string, uptimeSeconds: number = process.uptime()): string {
  return `${label} +${uptimeSeconds.toFixed(1)}s ${what}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** The same object, with a stage line when each method call starts and settles; arguments are never written. */
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
