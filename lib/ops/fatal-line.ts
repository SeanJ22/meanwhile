import { writeSync } from "node:fs";

import { redactDiagnosticText, sanitizedErrorDiagnostic } from "./error-diagnostic.ts";

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

/** How much of a child's own fatal line a parent's digest quotes. */
export const FATAL_QUOTE_MAX_CHARS = 600;

/**
 * The last `RCD_FATAL` line in a child's output, without its prefix, redacted
 * again and clipped. Null when the child left none. A parent quotes this line
 * and still never a child's raw stderr.
 */
export function childFatalLine(output: string, maxChars: number = FATAL_QUOTE_MAX_CHARS): string | null {
  const fatal = output.split(/\r?\n/)
    .flatMap((line) => line.startsWith(FATAL_LINE_PREFIX) ? [line.slice(FATAL_LINE_PREFIX.length).trim()] : [])
    .filter(Boolean)
    .at(-1);
  return fatal ? redactDiagnosticText(fatal).slice(0, maxChars) : null;
}

/**
 * The line of a dead child's stderr that says why, for a parent that prints
 * one. Node ends an uncaught error with a stack and then "Node.js v22…", so
 * the last line alone named the Node version and never the cause; an import
 * that could not resolve hid that way for two days. Prefer the last line that
 * names an error, else the last line that is not a stack frame, brace or the
 * version banner. Redacted and clipped like a fatal line.
 */
export function childStderrCause(stderr: string, maxChars: number = FATAL_QUOTE_MAX_CHARS): string | null {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const named = lines.filter((line) => /^(?:[A-Za-z]*Error\b|Error\b|\[?[A-Z][A-Z0-9_]{3,}\]?:)/.test(line)).at(-1);
  const plain = lines.filter((line) => !/^(?:at |Node\.js v\d|[{}\[\]()]+$|\^+$)/.test(line)).at(-1);
  const pick = named ?? plain;
  return pick ? redactDiagnosticText(pick).slice(0, maxChars) : null;
}
