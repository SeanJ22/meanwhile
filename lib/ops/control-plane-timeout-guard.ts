import { isControlPlaneRequestTimeout } from "../control-plane/repository/request-bounds.ts";

/** One line for a control-plane read that did not answer in time: the pass it belonged to ends, the next tick retries. */
export function controlPlaneTimeoutLine(error: { readonly message: string }): string {
  return `  ${error.message}; this pass ended and the next tick retries`;
}

/**
 * A standing process keeps running through a control-plane read that did not answer in
 * time, wherever the rejection surfaces. Any other unhandled rejection ends the process
 * as Node's default would.
 */
export function keepRunningThroughControlPlaneTimeouts(options: {
  readonly log?: (line: string) => void;
  readonly exit?: (code: number) => void;
} = {}): void {
  const log = options.log ?? (line => console.error(line));
  const exit = options.exit ?? (code => process.exit(code));
  process.on("unhandledRejection", reason => {
    if (isControlPlaneRequestTimeout(reason)) { log(controlPlaneTimeoutLine(reason)); return; }
    console.error(reason);
    exit(1);
  });
}
