import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import { stripComments } from "../lib/ops/duplicate-implementations.ts";

/**
 * **A GATE READS WHAT WOULD BE COMMITTED, NEVER ONLY WHAT ALREADY WAS.**
 * (NH Hunt 3, 2026-08-21 — item 1d.)
 *
 * ## The defect this closes
 *
 * NH Hunt 2 shipped a second code merge and had to report it as a deviation.
 * RULING 20's photo guard asked `git ls-files`, which lists TRACKED files. The
 * suite ran while ten portraits sat unstaged in the working tree, so the guard
 * looked, saw nothing, and passed; `git add` then staged them and the commit
 * carried exactly the binaries the guard exists to refuse.
 *
 * Nothing was out of order in the session's own steps. **The gate was reading
 * a view of the repository that had not caught up with the change it was
 * guarding**, and that is a defect in the gate rather than in the session.
 *
 * ## The class, and the count
 *
 * Seven call sites across `tests/` and `scripts/` asked for tracked files.
 * Exactly one — `tests/generated-doc-dates.test.ts` — already asked the right
 * question with `--cached --others --exclude-standard`. So the repo knew the
 * correct idiom and seven other places had not been told. All seven now route
 * through `lib/ops/repo-files.ts`, and this stops an eighth appearing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/**
 * `git ls-files` with no `--others` lists only what is already committed. A
 * gate built on it cannot see the change it is being run to judge.
 *
 * **THE PATTERN WIDENED, BECAUSE IT MISSED ONE (CIE-2, 2026-09-07).** It used
 * to require a quote character IMMEDIATELY on both sides of `ls-files`, which
 * recognises the ARGV form — `["ls-files", "-z", …]` — and nothing else. The
 * SHELL-STRING form puts the quotes at the ends of the whole command:
 *
 * ```
 *   execSync("git ls-files -z", …)     ← not flagged, because the character
 *                                        before `ls-files` is a space
 * ```
 *
 * `scripts/duplicate-implementations.mts` was written that way, so the guard
 * that exists to stop an eighth tracked-only sweep watched the eighth one land
 * and said nothing — and PR #294 shipped a local "16 of 16 green" that had not
 * seen the files it was judging.
 *
 * So the pattern now matches `ls-files` wherever it appears in CODE, and the
 * `--others` lookahead is what decides. A guard keyed on the shape of the
 * quoting was keyed on the wrong thing: the defect is asking git for tracked
 * files, and it is the same defect in either syntax.
 *
 * **Comments are stripped before the scan**, using the same length- and
 * newline-preserving stripper the duplicate census uses. Widening the pattern
 * without that turned every doc block that DISCUSSES this defect — including
 * the one you are reading — into an offender, which is how a guard teaches
 * people to stop explaining themselves.
 */
const TRACKED_ONLY = /\bls-files\b(?![\s\S]{0,200}?--others)/;

test("no gate reads tracked-only repository state", () => {
  const offenders: string[] = [];
  let read = 0;
  let asking = 0;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|mts|mjs|js)$/.test(entry)) continue;
      /*
       * Two files must contain the shape in order to talk about it, and
       * neither is a gate reading repository state:
       *
       * - `lib/ops/repo-files.ts` is where the correct flags are SPELLED.
       * - this file, whose `TRACKED_ONLY` pattern is literally the offending
       *   string. It flagged itself on the first run, which is the guard
       *   working and the exemption being earned rather than assumed.
       *
       * Both are exempted by exact path, never by a pattern that could grow to
       * cover a real offender.
       */
      if (full.endsWith(join("lib", "ops", "repo-files.ts"))) continue;
      if (full.endsWith(join("tests", "gate-ordering.test.ts"))) continue;
      /*
       * - `scripts/preflight.mjs` asks for the TRACKED set on purpose: its whole
       *   job is to compare it against what would be committed and refuse when
       *   the two differ. It is the check, not an instance of the defect.
       */
      if (full.endsWith(join("scripts", "preflight.mjs"))) continue;
      read++;
      // Prose about the defect is not the defect. Strip comments first.
      const body = stripComments(readFileSync(full, "utf8"));
      if (!body.includes("ls-files")) continue;
      asking++;
      if (TRACKED_ONLY.test(body)) offenders.push(relative(ROOT, full).replace(/\\/g, "/"));
    }
  };
  walk(join(ROOT, "tests"));
  walk(join(ROOT, "scripts"));

  assert.ok(read > 50, `the sweep must actually read the tree — read ${read} file(s)`);
  // A sweep that found none of the shape it guards is a sweep that stopped
  // looking, and reports the same thing as a clean tree.
  assert.ok(asking > 0, "the sweep found nothing asking git for a file list at all");
  assert.deepEqual(
    offenders,
    [],
    "these ask git for TRACKED files and so cannot see an unstaged change: " +
      `${offenders.join(", ")}. Use filesThatWouldBeCommitted() from lib/ops/repo-files.ts.`,
  );
});

test("the shared path sees a file that is present but not yet tracked", () => {
  /*
   * The behavioural half. The assertion above is a grep and would pass against
   * a helper that had the right flags and the wrong behaviour.
   *
   * This test file is itself the specimen on the session that creates it: it
   * exists on disk, it is not ignored, and until the commit lands it is not
   * tracked. Either way — before the commit or after — it must appear, which
   * is exactly the property the photo guard needed and did not have.
   */
  const files = filesThatWouldBeCommitted({ cwd: ROOT, paths: ["tests"] });
  assert.ok(
    files.includes("tests/gate-ordering.test.ts"),
    "the helper cannot see this very file, so it cannot see a new portrait either",
  );
});

test("the shared path excludes what git ignores, and returns no duplicates", () => {
  const files = filesThatWouldBeCommitted({ cwd: ROOT });
  assert.ok(files.length > 100, `expected the repo's files, got ${files.length}`);
  assert.ok(
    !files.some((f) => f.startsWith("node_modules/") || f.startsWith(".next/")),
    "ignored build artifacts must not drown the caller",
  );
  assert.equal(
    new Set(files).size,
    files.length,
    "a gate counting its input must not count one file twice",
  );
});
