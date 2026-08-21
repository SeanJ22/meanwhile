#!/usr/bin/env node
/**
 * **RULING 48 — A SESSION MAY NOT USE GIT TO REVERT SEAN'S FILES.**
 * (Adopted 2026-08-20. This is the half that actually blocks.)
 *
 * Prompt E built collision safety on the tracker stores — the workbook is
 * digested when it is read and again immediately before it is written, and a
 * mid-run save refuses and writes nothing. A session reaching for
 * `git checkout` routes around all of it, because git does not go through the
 * script. That happened on 2026-08-20: both CSVs were reverted mid-fix, his
 * edits were destroyed, and it was recovered only because somebody noticed.
 *
 * ## What this is
 *
 * A Claude Code **PreToolUse hook**. It reads a tool call off stdin, and if the
 * command is a git operation that would overwrite a working-tree file from the
 * object database, and it names a protected path, it exits 2 — which the
 * harness turns into a refusal before the command runs.
 *
 * ## Why the hook and not a git hook
 *
 * Git has no hook that fires on `git checkout -- <path>`, `git restore` or
 * `git reset --hard`. There is no `pre-checkout`, and `post-checkout` does not
 * fire for a pathspec checkout. So a committed `core.hooksPath` cannot stop
 * this; the only layer that sees the command before it runs is the agent
 * harness, which is where this sits.
 *
 * ## Its honest limits, because a guard that overstates itself is worse
 *
 * - **It covers this harness's shell tools and nothing else.** A `node` script
 *   that calls `child_process.execSync("git checkout …")`, a git GUI, an IDE's
 *   "discard changes", or a different agent runtime all bypass it. The static
 *   sweep in `tests/tracker-stores.test.ts` is what covers the committed-script
 *   case; nothing covers a human with a mouse, and nothing should.
 * - **It matches command text.** A command assembled from variables, or one
 *   that reaches these files through a path this list does not spell (a
 *   `git checkout <sha> -- docs/`, which IS caught, versus `cd docs && git
 *   checkout -- tracker.csv`, which is caught only because the basenames are
 *   listed too), is a hole. Both forms above are handled; a genuinely novel
 *   spelling is not.
 * - **It cannot tell a revert from a legitimate one.** There is no legitimate
 *   one for these four paths, which is the whole ruling, so this is not a
 *   trade-off — but a session that genuinely needs an old version must read it
 *   with `git show` and apply the change forward, which is what the refusal
 *   message says.
 * - **It is a repo-local setting.** A checkout with `.claude/settings.json`
 *   removed has no guard. The test asserts the file exists and wires this
 *   script, so removing it fails the build.
 */

import { readFileSync } from "node:fs";

/** The four paths RULING 48 names, plus their basenames for a `cd`-ed form. */
const PROTECTED = [
  "docs/tracker.csv",
  "docs/tracker.xlsx",
  "docs/tracker-working.csv",
  "docs/tracker-resolved.csv",
  "docs/tracker-deletions.json",
  "docs/state.md",
  "tracker.csv",
  "tracker.xlsx",
  "tracker-working.csv",
  "tracker-resolved.csv",
  "state.md",
];

/**
 * Git operations that overwrite a working-tree file from the object database.
 *
 * `git checkout` and `git restore` with a pathspec, `git reset --hard`,
 * `git clean -f`, and `git stash` in the forms that discard. A `git checkout
 * <branch>` with no pathspec is NOT one of these — it is how a session moves
 * between branches — so the pathspec test below is what separates them.
 */
/*
 * Up to four tokens may sit between `git` and the verb, so `git -C . checkout`
 * and `git --no-pager restore` are caught. None of those tokens may be a shell
 * separator, which is what keeps `git status; echo checkout` out of it.
 */
const GIT = "\\bgit\\s+(?:[^\\s;&|]+\\s+){0,4}?";
const RESET_HARD = new RegExp(GIT + "reset\\b[^\\n|;&]*--hard");
const CLEAN_FORCE = new RegExp(GIT + "clean\\b[^\\n|;&]*-[a-z]*f");
const DESTRUCTIVE = [
  new RegExp(GIT + "checkout\\b"),
  new RegExp(GIT + "restore\\b"),
  RESET_HARD,
  CLEAN_FORCE,
  new RegExp(GIT + "stash\\b[^\\n|;&]*\\b(?:drop|clear)\\b"),
];

/**
 * Does this command line revert a protected path?
 *
 * Exported so the guard test can assert it catches the exact command that
 * destroyed his edits, rather than asserting the file merely exists.
 */
/**
 * Everything a shell would treat as TEXT rather than as a command, removed.
 *
 * Heredoc bodies first, then quoted strings. Without this the guard reads its
 * own commit message: the first commit it ever guarded was refused because the
 * message described the guard, and "git checkout" and
 * "docs/tracker-deletions.json" both appeared in the prose. A false positive
 * on a commit is not harmless — it is the failure that gets a guard disabled.
 *
 * **What this still cannot do**, stated rather than left to be found: it does
 * not parse the shell. A command assembled from a variable, or one whose
 * quoting this simplification gets wrong, is judged on whatever text survives.
 * The bias is deliberate — over-stripping risks missing a real revert, so the
 * stripping is limited to the two forms that actually caused the false
 * positive, and everything else is still read as a command.
 */
function withoutInlineText(command) {
  let text = String(command ?? "");
  // Heredocs: `<<'EOF' … EOF`, `<<EOF … EOF`, `<<-EOF … EOF`.
  text = text.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\2\s*$/gm,
    " <<HEREDOC ",
  );
  // An unterminated heredoc (the whole rest of the input is the body).
  text = text.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*/, " <<HEREDOC ");
  // Quoted strings, single and double, non-greedy and newline-tolerant.
  text = text.replace(/'[^']*'/g, " '' ").replace(/"[^"]*"/g, ' "" ');
  return text;
}

export function revertsProtectedFile(command) {
  const text = withoutInlineText(command);
  if (!DESTRUCTIVE.some((re) => re.test(text))) return null;
  // `git reset --hard` and `git clean -fd` name no path and take everything.
  const wholeTree = RESET_HARD.test(text) || CLEAN_FORCE.test(text);
  if (wholeTree) return "the whole working tree, which includes every protected file";
  const hit = PROTECTED.find((p) => text.includes(p));
  if (hit) return hit;
  // A directory pathspec that contains them.
  if (/\bdocs\/?(?:\s|$|")/.test(text) && /checkout|restore/.test(text)) {
    return "docs/, which contains every protected file";
  }
  return null;
}

const REFUSAL = (target) =>
  `RULING 48 — refused. This command would overwrite ${target} from git.\n\n` +
  "A session may not use git to revert Sean's files. Prompt E built collision\n" +
  "safety on the tracker stores — digest before, digest after, a mid-run save\n" +
  "refuses and writes nothing — and git routes around all of it. On 2026-08-20\n" +
  "a session did exactly this and destroyed his hand edits to both CSVs.\n\n" +
  "If you need an older version, READ it (`git show <ref>:<path>`) and apply the\n" +
  "change forward. The tracker stores are written by `pnpm tracker:move` and by\n" +
  "nothing else; `docs/state.md` is edited by inserting, never by replacing.";

function main() {
  let payload = "";
  try {
    payload = readFileSync(0, "utf8");
  } catch {
    process.exit(0);
  }
  let input;
  try {
    input = JSON.parse(payload);
  } catch {
    process.exit(0);
  }
  const command =
    input?.tool_input?.command ?? input?.toolInput?.command ?? "";
  const target = revertsProtectedFile(command);
  if (target) {
    process.stderr.write(REFUSAL(target) + "\n");
    process.exit(2);
  }
  process.exit(0);
}

// Only run the hook when invoked as a script; the test imports the predicate.
if (process.argv[1] && process.argv[1].endsWith("guard-protected-files.mjs")) {
  main();
}
