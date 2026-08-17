/**
 * Refuse a commit that would put a clobbered CLAUDE.md into history (R01).
 *
 * ## The failure this exists for
 *
 * Next's scaffolding once overwrote CLAUDE.md with the 12-byte line
 * `@AGENTS.md`. That is the most expensive way for this particular file to
 * fail, because a repo whose constraints file is gone does not LOOK broken —
 * it looks like a repo with no rules, and every session after it inherits no
 * rules while believing it has read them.
 *
 * `pnpm session:start` already checks the size, but it runs at session OPEN,
 * which is the wrong end: it tells the next session that the last one
 * committed a clobber. This runs at authorship, the only moment the file's
 * real content is still sitting in git's index next to the damage.
 *
 * ## Why it reads the STAGED blob
 *
 * Same reason `check-staged-dates.mjs` does: `git show :CLAUDE.md` is what is
 * about to be committed, and a hook that reads the working tree passes a
 * `git add -p` that staged only the bad hunk. The worktree is checked too, but
 * only as a WARNING — a clobbered worktree that is not staged is not entering
 * history yet, and failing on it would block unrelated commits while the
 * author is mid-repair.
 *
 * ## Why 1 KB and no ceiling
 *
 * The clobber signature is a TINY file. The floor is the whole guard. There is
 * deliberately no upper bound here: CLAUDE.md grows every time the author
 * adopts a rule, and a ceiling would turn every legitimate growth into a
 * refused commit — the noise that made the session-start ceiling worthless
 * (R19). Bypass is git's own `--no-verify`, not a flag invented here.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

/** Under this, the file cannot be holding the constraints. */
const FLOOR_BYTES = 1024;

/** The exact content the scaffolding left behind, kept so the message can name it. */
const KNOWN_CLOBBER = "@AGENTS.md";

function stagedPaths() {
  const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
    encoding: "utf8",
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

const problems = [];
const warnings = [];

if (stagedPaths().includes("CLAUDE.md")) {
  // Buffer, not utf8: the size that matters is bytes on disk, and decoding
  // first would let a multi-byte file report a different length than git
  // stored.
  const staged = execFileSync("git", ["show", ":CLAUDE.md"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  const body = staged.toString("utf8").trim();

  if (body === KNOWN_CLOBBER) {
    problems.push(
      `CLAUDE.md is staged containing only "${KNOWN_CLOBBER}" (${staged.length} bytes) — ` +
        `this is the Next scaffolding clobber, exactly as it happened before.`,
    );
  } else if (staged.length < FLOOR_BYTES) {
    problems.push(
      `CLAUDE.md is staged at ${staged.length} bytes, under the ${FLOOR_BYTES}-byte floor — ` +
        `it cannot be holding this project's constraints at that size.`,
    );
  }
} else if (existsSync("CLAUDE.md")) {
  const bytes = statSync("CLAUDE.md").size;
  const body = readFileSync("CLAUDE.md", "utf8").trim();
  if (body === KNOWN_CLOBBER || bytes < FLOOR_BYTES) {
    warnings.push(
      `CLAUDE.md in the working tree is ${bytes} bytes — it looks clobbered, though ` +
        `this commit does not stage it. Restore it before it reaches a commit that does.`,
    );
  }
} else {
  warnings.push("CLAUDE.md is missing from the working tree entirely.");
}

for (const w of warnings) console.error(`  warn  ${w}`);

if (problems.length > 0) {
  console.error("");
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.error("");
  console.error("  RESTORE IT, never reconstruct it from memory (tracker R01):");
  console.error("    git log --oneline -- CLAUDE.md      # find the last good commit");
  console.error("    git checkout <sha> -- CLAUDE.md");
  console.error('    cp "G:/My Drive/we-the-people/CLAUDE.md" CLAUDE.md   # or the mirror');
  console.error("");
  console.error("  Bypass with git commit --no-verify if you are certain.");
  process.exit(1);
}
