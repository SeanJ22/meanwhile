/**
 * Start-of-session check.
 *
 *   pnpm session:start            check, then start the dev server
 *   pnpm session:start --check    check only; do not start anything
 *
 * The bookend to `pnpm handoff`. Four checks, and they share one property:
 * **the environment lies quietly if you do not look.**
 *
 *   1. local `main` vs `origin/main`   a stale main looks like an empty repo
 *   2. `CLAUDE.md` is above 1 KB       a clobbered one looks like no constraints
 *   3. port 3000 is free               a stale dev server looks like a build
 *   4. `core.hooksPath` is set         an uninstalled guard looks like a passing
 *                                      one — it never fires and never says so
 *
 * Since 2026-08-13 check 3 *repairs* rather than reports when the stale server
 * is attributably this repo's own (pid file matches): it kills the tree and
 * proceeds. A foreign occupant still fails — we do not kill what we cannot
 * attribute. And after starting the dev server, the script waits for the entry
 * page to actually serve, then verifies the pid holding the port descends from
 * the child it spawned, printing the HEAD sha it is serving.
 *
 * None of the three announces itself. Each presents as a plausible, working
 * state that happens to be the wrong one, and each has cost this project a
 * session already. That is the whole argument for running them before work
 * rather than discovering them during it.
 *
 * Exits non-zero on any failure, so it can gate a hook later — same contract as
 * handoff. `--check` is the form a hook wants, since the plain form ends in a
 * dev server that never exits.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { tryRun as sharedTryRun } from "./try-run.mjs";

import {
  PORT,
  ROOT,
  isSelfOrDescendantOf,
  killCommand,
  pidOnPort,
  portInUse,
  readPid,
  stopDevServer,
} from "./dev-server.mjs";

const CHECK_ONLY = process.argv.includes("--check");

// R291: workspace creation uses the same startup bookend. It does not run the
// old preview checks against main or stop another session's preview.
const workspaceAt = process.argv.indexOf("--workspace");
if (workspaceAt !== -1) {
  const config = process.argv[workspaceAt + 1];
  if (!config) throw new Error("--workspace requires an explicit start-config JSON path");
  const { start } = await import("./session-workspace.mjs");
  console.log(JSON.stringify(start(JSON.parse(readFileSync(config, "utf8"))), null, 2));
  process.exit(0);
}

const MIRROR = process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";

const results = [];
const ok = (label, detail) => results.push({ level: "ok", label, detail });
const warn = (label, detail) => results.push({ level: "warn", label, detail });
const fail = (label, detail) => results.push({ level: "fail", label, detail });

/** Extra lines printed under the checklist — commands to run, mostly. */
const notes = [];

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/**
 * `tryRun`, bound to this repo's root.
 *
 * The IMPLEMENTATION is `scripts/try-run.mjs` — it was written twice and
 * `tests/duplicate-implementations.json` carried the pair (RULING 103). This is
 * a binding rather than a copy: it supplies `cwd` and nothing else.
 */
const tryRun = (cmd, args, opts = {}) => sharedTryRun(cmd, args, { cwd: ROOT, ...opts });

/* ----------------------------------------------------------- 1 stale main --- */

// R07. `handoff --ship` merges the PR through gh and leaves the session on the
// feature branch, so nothing ever fast-forwards local main. It falls a session
// behind every time, and the next checkout of main presents a project with
// nothing in it but CLAUDE.md. That is not a hypothetical: it happened, and the
// recovery was a plain ff because local main had never held anything unique.
if (tryRun("git", ["fetch", "origin", "--quiet"]) === null) {
  warn("fetch", "could not reach origin — the main check below may be stale");
}

const hasOriginMain = tryRun("git", ["rev-parse", "--verify", "origin/main"]) !== null;
const hasLocalMain = tryRun("git", ["rev-parse", "--verify", "main"]) !== null;

if (!hasOriginMain || !hasLocalMain) {
  warn("main", "cannot compare — one of local main / origin/main is missing");
} else {
  const behind = Number(git("rev-list", "--count", "main..origin/main"));
  const ahead = Number(git("rev-list", "--count", "origin/main..main"));

  if (behind === 0 && ahead === 0) {
    ok("main", "local main matches origin/main");
  } else if (behind > 0 && ahead === 0) {
    fail("main", `local main is ${behind} commit(s) behind origin/main`);
    notes.push(
      "  Local main is stale — this is R07, and it is why the repo once opened",
      "  looking empty. It holds nothing unique, so fast-forward it:",
      "",
      "    git merge --ff-only origin/main",
      "",
      "  (from main; if you are on a branch, git checkout main first)",
    );
  } else {
    // Ahead means local main has commits origin does not. A ff will not do it
    // and quietly suggesting one would be wrong.
    fail(
      "main",
      `local main has diverged — ${behind} behind, ${ahead} ahead of origin/main`,
    );
    notes.push(
      "  Local main holds commits origin/main does not, so --ff-only will refuse.",
      "  Look at them before doing anything:",
      "",
      "    git log --oneline origin/main..main",
    );
  }
}

/* -------------------------------------------------------------- 2 CLAUDE --- */

// The constraints file was found once containing only the 12-byte line
// `@AGENTS.md`, overwritten by Next's scaffolding. A repo whose CLAUDE.md is
// gone does not look broken, it looks like a repo with no rules — which is the
// most expensive way for this particular file to fail.
const CLAUDE = join(ROOT, "CLAUDE.md");
// Grown deliberately: the friction constitution (0a, 2026-08-14), the
// n-stores and plain-language non-negotiables (2026-08-15), the transparency
// mandate and the ladder (2026-08-16/17). The clobber signature is a *tiny*
// file, so only the floor really guards.
//
// R19, 2026-08-17: this was 17 while the file was 44.4 KB, against a hardcoded
// [8, 24] KB band — so the warning fired on EVERY session open for weeks. A
// warning that always fires is one nobody reads, which is how the real one
// gets missed, so the noise was itself the defect.
//
// The band now DERIVES from this number instead of being written beside it.
// That is the actual fix: the previous shape had two facts to keep in sync and
// they drifted the moment the file grew, and raising the constant alone would
// just restart the same clock. CLAUDE.md grows every time the author adopts a
// rule, so anything fixed here goes stale by design.
// THE CEILING IS GONE (Prompt C item 4.2, 2026-08-20). The rule:
// CLAUDE.md has NO SIZE CAP. The 40 KB cap belongs to `docs/context.md` alone,
// and an upper warning band here was that cap leaking into the one file it
// does not govern — it fires on exactly the change the project wants, which is
// the author adopting another rule. `scripts/check-claude-size.mjs` made the
// same call at authorship for the same reason and kept only a floor.
//
// THE FLOOR STAYS, and it is a different guard entirely: a CLOBBERED file is
// tiny, and a repo whose constraints file is gone does not look broken — it
// looks like a repo with no rules, and every session after it inherits none
// while believing it has read them.
const FLOOR_KB = 1;

if (!existsSync(CLAUDE)) {
  fail("CLAUDE.md", "missing entirely");
  notes.push(...restoreNote());
} else {
  const bytes = statSync(CLAUDE).size;
  const kb = (bytes / 1024).toFixed(1);
  const body = readFileSync(CLAUDE, "utf8").trim();

  if (body === "@AGENTS.md") {
    fail("CLAUDE.md", `clobbered — contains only @AGENTS.md (${bytes} bytes)`);
    notes.push(...restoreNote());
  } else if (bytes < FLOOR_KB * 1024) {
    fail(
      "CLAUDE.md",
      `${bytes} bytes — under the ${FLOOR_KB} KB floor, so it has been overwritten`,
    );
    notes.push(...restoreNote());
  } else {
    ok("CLAUDE.md", `${kb} KB, intact`);
  }
}

function restoreNote() {
  const from = join(MIRROR, "CLAUDE.md");
  const out = [
    "  CLAUDE.md holds this project's non-negotiable constraints and it has been",
    "  overwritten — most likely by Next scaffolding (see docs/state.md 3.5).",
    "",
    "  DO NOT reconstruct it from memory. Restore it:",
    "",
    `    cp "${from}" CLAUDE.md`,
  ];
  if (!existsSync(from)) {
    out.push(
      "",
      `  The mirror copy is NOT reachable at ${from}.`,
      "  Recover it from git history instead:  git log --oneline -- CLAUDE.md",
    );
  }
  return out;
}

/* --------------------------------------------------------------- 4 hook --- */

// The same family as the three above: a guard that is not installed does not
// announce itself, it just never fires. `core.hooksPath` is local git config,
// so it survives no clone and no fresh checkout — the pre-commit date check
// (R14) is present in the tree and inert until someone runs one command.
// Reported, not repaired: writing to a person's git config on their behalf is
// a different kind of act from killing a server this repo started.
{
  const hooksPath = tryRun("git", ["config", "core.hooksPath"]);
  const hook = join(ROOT, ".githooks", "pre-commit");

  if (!existsSync(hook)) {
    warn("pre-commit", ".githooks/pre-commit is missing from the tree");
  } else if (hooksPath === ".githooks") {
    ok("pre-commit", "installed — staged documents are checked for future dates");
  } else {
    warn(
      "pre-commit",
      `NOT installed${hooksPath ? ` (core.hooksPath is ${hooksPath})` : ""} — ` +
        "the date check will not run on commit",
    );
    notes.push(
      "  The pre-commit document-date check is in the tree but not installed.",
      "  It catches a fabricated date at authorship, while the context to fix it",
      "  still exists (R14, docs/state.md 23). Install it:",
      "",
      "    git config core.hooksPath .githooks",
    );
  }
}

/* ---------------------------------------------------------------- 3 port --- */

// A stale server here is always *last session's build* — the end-of-session
// kill missed, or the machine slept through it. It is this repo's own process
// (the pid file proves attribution), so killing it is the fix, not a decision
// for a person. A process we cannot attribute to this repo still fails the
// check: killing someone else's server on a guess is worse than asking.
const busy = await portInUse();

if (!busy) {
  ok("port", `${PORT} is free`);
} else {
  const occupant = pidOnPort();
  const recorded = readPid();
  const ours =
    occupant !== null && recorded !== null && isSelfOrDescendantOf(occupant, recorded);

  if (ours || (recorded !== null && occupant === null)) {
    const result = await stopDevServer();
    if (result.outcome === "stopped" || !(await portInUse())) {
      warn("port", `stale dev server (pid ${recorded}) killed — ${PORT} now free`);
    } else {
      fail("port", `stale dev server kill failed: ${result.detail}`);
    }
  } else {
    fail(
      "port",
      occupant === null
        ? `${PORT} is in use, owner unidentified — no pid file to attribute it`
        : `${PORT} held by pid ${occupant}, not started from this repo`,
    );
    notes.push(
      "  A server already on 3000 means Next would slide to 3001, and pnpm shoot",
      "  targets 3000 — every screenshot would be of the old build, served with the",
      "  old map worker. This one was not started from this repo, so decide and:",
      "",
      `    ${killCommand(occupant ?? 0)}`,
    );
  }
}

/* -------------------------------------------------------------- report --- */

const MARK = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };

console.log(`\nsession:start — ${tryRun("git", ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "?"}\n`);
for (const r of results) {
  console.log(`${MARK[r.level]} ${r.label.padEnd(12)} ${r.detail}`);
}
console.log("");

if (notes.length > 0) console.log(notes.join("\n") + "\n");

const failed = results.filter((r) => r.level === "fail");

if (failed.length > 0) {
  console.log(`${failed.length} item(s) to fix before starting work.\n`);
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log("Clear to start. (--check, so the dev server was not started.)\n");
  process.exit(0);
}

/* ----------------------------------------------------------- dev server --- */

console.log("Clear to start — bringing up the dev server.\n");

// Go through the package manager rather than calling Next directly, so `predev`
// runs: that is where public/maplibre-gl-worker.mjs is regenerated, and a dev
// server started around it serves a stale worker.
const execpath = process.env.npm_execpath;

const child = execpath
  ? spawn(process.execPath, [execpath, "run", "dev"], { cwd: ROOT, stdio: "inherit" })
  : spawn("pnpm", ["run", "dev"], { cwd: ROOT, stdio: "inherit", shell: true });

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error(`could not start the dev server: ${err.message}`);
  process.exit(1);
});

// Wait for ready, then confirm the thing answering on 3000 is the server we
// just spawned — not a survivor of the kill above, not a neighbour on 3001.
// The stale-server incident (R10) was exactly this: a green-looking page served
// by last session's process. Starting fresh is necessary; *verifying the
// occupant is ours* is what makes "the running build matches the working tree"
// a checked fact rather than an assumption. The GET also forces Next to compile
// the entry page, so "ready" means "serves the page", not "opened the socket".
(async () => {
  const deadline = Date.now() + 180_000;
  let served = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        served = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  if (!served) {
    console.error(`\ndev server did not serve / within 180s — check the log above.`);
    return;
  }

  const occupant = pidOnPort();
  const oursNow =
    occupant !== null && isSelfOrDescendantOf(occupant, child.pid);
  const head = tryRun("git", ["rev-parse", "--short", "HEAD"]) ?? "?";
  const dirty = (tryRun("git", ["status", "--porcelain"]) ?? "") !== "";

  if (oursNow) {
    console.log(
      `\ndev server ready on ${PORT} — serving the working tree at ${head}${dirty ? " (dirty)" : ""}, pid verified as this session's.\n`,
    );
  } else {
    console.error(
      `\nWARNING: port ${PORT} answers but is held by pid ${occupant ?? "?"}, which is NOT the server just started (pid ${child.pid}). Whatever it serves, it is not this working tree. Kill it: ${killCommand(occupant ?? 0)}\n`,
    );
  }
})();
