/**
 * Start-of-session check.
 *
 *   pnpm session:start            check, then start the dev server
 *   pnpm session:start --check    check only; do not start anything
 *
 * Checks that local `main` matches `origin/main` and that port 3000 is free
 * (killing a stale dev server only when the pid file attributes it to this
 * repo). Exits non-zero on any failure.
 */

import { execFileSync, spawn } from "node:child_process";

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

const results = [];
const ok = (label, detail) => results.push({ level: "ok", label, detail });
const warn = (label, detail) => results.push({ level: "warn", label, detail });
const fail = (label, detail) => results.push({ level: "fail", label, detail });

const notes = [];

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const tryRun = (cmd, args, opts = {}) => sharedTryRun(cmd, args, { cwd: ROOT, ...opts });

/* ------------------------------------------------------------- stale main --- */

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

/* ----------------------------------------------------------------- port --- */

// Kill a stale server only when the pid file attributes it to this repo.
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

// Through the package manager so `predev` regenerates public/maplibre-gl-worker.mjs.
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

// Confirm the server answering is the one just spawned. The GET also forces Next
// to compile the entry page, so "ready" means "serves the page".
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
