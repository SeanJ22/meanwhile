import { readFileSync, readdirSync, statSync } from "node:fs";
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

/**
 * **EVERY `.ts` FILE UNDER A REPO DIRECTORY, RECURSIVELY.**
 * (Consolidated 2026-08-28 under RULING 103, from `neutrality-guards.test.ts`.)
 *
 * The instrument behind every guard in this suite that sweeps a tree rather
 * than a list — the shape that lets a new file walk into a rule instead of
 * waiting for somebody to remember to extend it. `neutrality-guards` sweeps
 * `lib/` for ranking keys; `tenant-body-binding` sweeps `lib/sources/` for
 * body-id literals outside the serving-tenant denominator.
 *
 * Shared rather than copied for the reason `codeOf` above is: two copies of
 * "which files does this rule apply to" are two places for a denominator to
 * drift, and a guard whose denominator has quietly shrunk reads green without
 * having looked — which is the exact failure the tenant-binding guard was
 * written because of.
 *
 * Takes path parts relative to `ROOT`, never `cwd`, so a guard's denominator
 * does not depend on where the runner was invoked. Returns absolute paths.
 */
export function tsFilesUnder(...parts: string[]): string[] {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...walk(path));
      else if (name.endsWith(".ts")) out.push(path);
    }
    return out;
  };
  return walk(join(ROOT, ...parts));
}
