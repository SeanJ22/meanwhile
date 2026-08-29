import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * **READ A MODULE'S CODE, COMMENTS STRIPPED.**
 * (Consolidated 2026-08-28 under RULING 103, from `could-govern-pill.test.ts`.)
 *
 * Several guards in this suite ask whether a module TOUCHES something — a
 * `localStorage`, a coordinate field, a `fetch`, a function call that must
 * exist on a surface. **A doc comment explaining why the module deliberately
 * does NOT touch that thing contains the token too**, and the first version of
 * `could-govern-pill.test.ts` failed on its own explanation.
 *
 * So a rule about what code DOES is measured against the code, never against
 * the prose beside it. `tests/no-suppression.test.ts` strips comments for
 * exactly the same reason.
 *
 * This lives here rather than in either test because WGH-15 needed the same
 * instrument and copying it created a byte-identical second implementation —
 * which is the class RULING 103 sweeps for, and the reason is not stylistic:
 * two copies of "what counts as code" are two places for the stripping rule to
 * drift, and a guard that strips differently from its sibling silently guards
 * something different.
 */
export function codeOf(...parts: string[]): string {
  const source = readFileSync(join(ROOT, ...parts), "utf8");
  const blockComments = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const lineComments = new RegExp("(^|[^:])//[^\\n]*", "gm");
  return source.replace(blockComments, " ").replace(lineComments, "$1 ");
}

/** The repository root, resolved from this file rather than from `cwd`. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
