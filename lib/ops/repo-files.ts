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
  const normalize = (out: string) =>
    out
      .split("\0")
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, "/"));
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", ...(options.paths ?? [])],
    { encoding: "utf8", cwd: options.cwd, maxBuffer: 1e9 },
  );
  // `--cached` names paths whose index entry is about to be deleted too. Such
  // a path is not in the tree `git add -A` would commit and, more importantly,
  // cannot be read from the working tree. Subtract Git's deleted set before a
  // caller opens the denominator; this keeps a deletion visible as an absence
  // instead of turning every read-based gate into ENOENT.
  const deleted = new Set(
    normalize(
      execFileSync("git", ["ls-files", "-z", "--deleted", ...(options.paths ?? [])], {
        encoding: "utf8",
        cwd: options.cwd,
        maxBuffer: 1e9,
      }),
    ),
  );
  return normalize(out)
    .filter((p) => !deleted.has(p))
    // `--cached` and `--others` can each name the same path in some states;
    // a gate counting its input must not count one file twice.
    .filter((p, i, all) => all.indexOf(p) === i);
}

/**
 * **THE TYPESCRIPT SOURCES UNDER GIVEN DIRECTORIES, AS ONE SHARED PATH.**
 * (RULING 103, 2026-08-23. Extracted from four copies the duplicate sweep
 * caught the same day it was written — see below, because the way it was
 * caught is the more useful half.)
 *
 * `pnpm sweep:refusal`, `pnpm sweep:absence-defaults` and their two test files
 * each grew their own `readdirSync` recursion with its own `node_modules` and
 * `.next` exclusions. Four copies of a directory walker is precisely the
 * duplicated-implementation class RULING 103 governs, and the fix is the
 * shared path rather than four baseline entries.
 *
 * **It is also strictly better than what it replaces**, and for the reason
 * this module already exists: a hand-rolled walk sees the filesystem, and a
 * gate must see WHAT WOULD BE COMMITTED. The hand-rolled version would happily
 * sweep a file `.gitignore` excludes and miss nothing that mattered — until it
 * did.
 *
 * *How this was caught, recorded because it is a fact about the instrument.*
 * The full suite ran clean twice while the four copies sat in the working
 * tree UNTRACKED, and failed on the first run after they were committed —
 * because `pnpm dupes` reads `filesThatWouldBeCommitted`, and until `git add`
 * the sweep genuinely could not see them. That is the NH Hunt 3 ordering
 * defect this module was built over, seen from the other side: the gate was
 * right both times, and the earlier green was a measurement of a tree that did
 * not yet contain the defect.
 */
export function sourceFilesUnder(
  cwd: string,
  dirs: readonly string[],
  extensions: readonly string[] = [".ts", ".tsx"],
): string[] {
  return filesThatWouldBeCommitted({ cwd, paths: dirs }).filter((p) =>
    extensions.some((ext) => p.endsWith(ext)),
  );
}
