import { writeSync } from "node:fs";

import { sanitizedErrorDiagnostic } from "./error-diagnostic.ts";

/**
 * **A CHILD THAT DIES SAYS WHY, IN A LINE ITS PARENT MAY QUOTE.** (2026-09-24.)
 *
 * The routine civic-data child died at startup three times on 2026-09-24
 * (03:54Z, 06:56Z and 11:34Z): exit 1, no protocol line. The parent never
 * quotes a child's raw stderr, which can carry connection strings, so its
 * digest could say only "terminated=EXITED; exit=1" and nothing about why.
 *
 * An error nothing caught now ends the process through one protocol line,
 * `RCD_FATAL <child>: <step> — <sanitized cause chain>`, written
 * synchronously to stdout before the exit. The step names what the process
 * was doing; the cause chain passes through `sanitizedErrorDiagnostic`, which
 * redacts credentials and hosts.
 */
export const FATAL_LINE_PREFIX = "RCD_FATAL ";

export function fatalLine(child: string, step: string, error: unknown): string {
  return `${FATAL_LINE_PREFIX}${child}: ${step} — ${sanitizedErrorDiagnostic(error)}`;
}

/**
 * Route an uncaught exception or unhandled rejection through `fatalLine`,
 * then exit 1, the code Node would have used. Install it before the first
 * await: in Node 24 a rejected top-level await arrives as an uncaught
 * exception.
 */
export function installFatalLine(
  child: string,
  step: () => string,
  options: { readonly write?: (line: string) => void; readonly exit?: (code: number) => void } = {},
): void {
  const write = options.write ?? ((line: string) => {
    writeSync(1, `${line}\n`);
  });
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let fired = false;
  const die = (error: unknown): void => {
    if (fired) return;
    fired = true;
    try {
      write(fatalLine(child, step(), error));
    } finally {
      exit(1);
    }
  };
  process.on("uncaughtException", die);
  process.on("unhandledRejection", die);
}
