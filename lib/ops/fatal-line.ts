import { writeSync } from "node:fs";

import { redactDiagnosticText, sanitizedErrorDiagnostic } from "./error-diagnostic.ts";

/** A child that dies says why, in one redacted `RCD_FATAL` line its parent may quote; raw stderr is never quoted. */
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

/** The line of a dead child's stderr that says why: the last line naming an error, else the last that is not a stack frame, brace or version banner. Redacted and clipped. */
export function childStderrCause(stderr: string, maxChars: number = FATAL_QUOTE_MAX_CHARS): string | null {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const named = lines.filter((line) => /^(?:[A-Za-z]*Error\b|Error\b|\[?[A-Z][A-Z0-9_]{3,}\]?:)/.test(line)).at(-1);
  const plain = lines.filter((line) => !/^(?:at |Node\.js v\d|[{}\[\]()]+$|\^+$)/.test(line)).at(-1);
  const pick = named ?? plain;
  return pick ? redactDiagnosticText(pick).slice(0, maxChars) : null;
}
