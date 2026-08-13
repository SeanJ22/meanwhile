/**
 * Start-of-session check.
 *
 *   pnpm session:start            check, then start the dev server
 *   pnpm session:start --check    check only; do not start anything
 *
 * The bookend to `pnpm handoff`. Three checks, and they share one property:
 * **the environment lies quietly if you do not look.**
 *
 *   1. local `main` vs `origin/main`   a stale main looks like an empty repo
 *   2. `CLAUDE.md` is ~10 KB           a clobbered one looks like no constraints
 *   3. port 3000 is free               a stale dev server looks like a build
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

import {
  PORT,
  ROOT,
  isSelfOrDescendantOf,
  killCommand,
  pidOnPort,
  portInUse,
  readPid,
} from "./dev-server.mjs";

const CHECK_ONLY = process.argv.includes("--check");

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

function tryRun(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

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
const EXPECTED_KB = 10;

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
  } else if (bytes < 1024) {
    fail("CLAUDE.md", `${bytes} bytes — under 1 KB, so it has been overwritten`);
    notes.push(...restoreNote());
  } else if (bytes < 8 * 1024 || bytes > 14 * 1024) {
    // Not fatal: the file legitimately grows. But a large swing from ~10 KB is
    // worth a look before trusting it.
    warn("CLAUDE.md", `${kb} KB — expected roughly ${EXPECTED_KB} KB, check it`);
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

/* ---------------------------------------------------------------- 3 port --- */

const busy = await portInUse();

if (!busy) {
  ok("port", `${PORT} is free`);
} else {
  const occupant = pidOnPort();
  const recorded = readPid();
  const ours =
    occupant !== null && recorded !== null && isSelfOrDescendantOf(occupant, recorded);

  fail(
    "port",
    occupant === null
      ? `${PORT} is in use, owner unidentified`
      : ours
        ? `${PORT} held by this repo's own dev server (pid ${recorded})`
        : `${PORT} held by pid ${occupant}, not started from this repo`,
  );

  notes.push(
    "  A server already on 3000 means Next would slide to 3001, and pnpm shoot",
    "  targets 3000 — every screenshot would be of the old build, served with the",
    "  old map worker. Stop it first:",
    "",
    `    ${killCommand(ours ? recorded : (occupant ?? recorded ?? 0))}`,
  );
  if (ours) notes.push("", "  Or:  pnpm handoff   (it stops the dev server for you)");
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
