import { execFileSync } from "node:child_process";

/**
 * **WHAT A GATE MUST LOOK AT: WHAT WOULD BE COMMITTED, NOT WHAT ALREADY WAS.**
 * (NH Hunt 3, 2026-08-21. The fix for the NH Hunt 2 gate-ordering defect.)
 *
 * ## The failure, exactly
 *
 * NH Hunt 2 shipped a second code merge it had to report as a deviation.
 * RULING 20's photo guard — `tests/asset-store.test.ts` — asked
 * `git ls-files`, which lists **tracked** files. The session ran the suite
 * while ten portraits sat in the working tree, unstaged: the guard looked,
 * saw nothing, and passed. `git add` then staged them and the commit carried
 * ten binaries the guard exists to refuse. The guard was correct, the binaries
 * were caught on the NEXT run, and the cost was an unplanned merge.
 *
 * Nothing was out of order in the session's own steps. The gate was reading a
 * view of the repository that had not caught up with the change it was
 * guarding — so the ordering was the defect, and it was a defect in the gate.
 *
 * ## Why a shared function rather than a fixed argument list
 *
 * Seven call sites across `tests/` and `scripts/` asked `git ls-files` for
 * tracked files, and exactly one — `tests/generated-doc-dates.test.ts` — asked
 * the right question, with `--cached --others --exclude-standard`. So the repo
 * already knew the correct idiom and six other places had not been told. That
 * is a class defect and it gets a shared code path, so the next gate that
 * needs a file list inherits the answer instead of guessing at it again.
 *
 * ## What `--exclude-standard` buys, and why it is not a hole
 *
 * `--others` alone would list every ignored artifact — `node_modules`,
 * `.next`, build output — and drown the caller. `--exclude-standard` applies
 * the repo's own ignore rules, so what comes back is precisely **the set of
 * files a `git add -A` would put in a commit**: tracked files plus new files
 * that are not ignored. A gate reading this list sees the change before it is
 * staged, which is the whole point.
 *
 * A file the repo deliberately ignores is genuinely not going to be committed,
 * so leaving it out is correct rather than a gap. A gate that needs to see
 * ignored files is asking a different question and should say so.
 */

/** Where `git` is asked from. Callers pass the repository root. */
export interface RepoFilesOptions {
  cwd: string;
  /** Limit to these pathspecs, exactly as `git ls-files` takes them. */
  paths?: readonly string[];
}

/**
 * Every file that a commit made right now would contain, repo-relative.
 *
 * Paths are normalized to POSIX separators (RULING 14: a repo-relative path is
 * POSIX everywhere it is compared), and `-z` is used so a filename containing
 * a newline cannot split one entry into two — a gate that can be walked past
 * by naming a file oddly is not a gate.
 */
export function filesThatWouldBeCommitted(options: RepoFilesOptions): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", ...(options.paths ?? [])],
    { encoding: "utf8", cwd: options.cwd, maxBuffer: 1e9 },
  );
  return (
    out
      .split("\0")
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, "/"))
      // `--cached` and `--others` can each name the same path in some states;
      // a gate counting its input must not count one file twice.
      .filter((p, i, all) => all.indexOf(p) === i)
  );
}
