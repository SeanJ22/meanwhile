/**
 * **THE TWO GIT FACTS EVERY RUN RECORD NEEDS.** (A.1, 2026-08-30. RULING 103.)
 *
 * `reader-suite.mts`, `visual-suite.mts`, `control-set.mts` and
 * `status-ledger.mts` all need the same two answers: which commit am I
 * measuring, and does this tree contain that one. Each had grown its own copy,
 * and `pnpm dupes` named them — correctly, because the interesting behaviour in
 * those lines is what they do when git CANNOT answer.
 *
 * That behaviour has to be identical everywhere, and it is the safe direction
 * in both cases:
 *
 * ```
 *   no HEAD resolvable      -> null, never a fabricated SHA
 *   ancestry unanswerable   -> false, so nothing closes on an unproven claim
 * ```
 *
 * A fabricated SHA would misattribute every reading derived from the record it
 * lands in, and an ancestry check that guessed `true` would let a green run on
 * an unrelated tree close an obligation about code it never executed. Refusing
 * to know is always safer than deciding to.
 */

import { execFileSync } from "node:child_process";

/**
 * The commit this process is running against, or null.
 *
 * Null when there is no git, no checkout, or no commit yet. All three are the
 * same fact for a caller — the tree cannot be named — and none of them is a
 * reason to invent one.
 */
export function headSha(cwd: string = process.cwd()): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Does `descendant`'s history contain `ancestor`?
 *
 * Ancestry rather than equality, deliberately: requiring an exact match would
 * mean a diagnostic could only ever be closed by a run on the very commit that
 * failed, which by construction is the red one. A later commit that contains
 * the failure is evidence about the fixed code.
 *
 * Returns FALSE when git cannot answer. Refusing to close is always the safe
 * direction; an optimistic `true` here would close obligations on runs that
 * never executed the code in question.
 */
export function containsCommit(
  ancestor: string,
  descendant: string,
  cwd: string = process.cwd(),
): boolean {
  if (ancestor === descendant) return true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}
