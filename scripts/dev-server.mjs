/**
 * Dev-server lifecycle: the PID file, the port, and killing the tree. Shared so
 * every caller agrees on what "the dev server" is. Importing this has no side
 * effects.
 *
 * A stale dev server answers 200 on port 3000 with an old build (and an old
 * maplibre worker, which `predev` regenerates), so `predev` refuses a taken
 * port instead of letting Next slide to 3001. Next spawns children, so a kill
 * takes the tree (`taskkill /T /F` on Windows).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const PORT = Number(process.env.PORT ?? 3000);

/** Gitignored, written on `pnpm dev`, removed on clean exit. */
export const PID_FILE = join(ROOT, ".dev-server.pid");

const IS_WIN = process.platform === "win32";

/* ------------------------------------------------------------- pid file --- */

/**
 * The recorded PID, or null.
 *
 * Returns null for a PID that is no longer alive rather than the stale number:
 * every caller wants "is there a dev server" and a dead PID is a no. A process
 * killed with -9 never gets to remove its own file, so stale files are normal
 * and are not worth reporting as a problem.
 */
export function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, "utf8").trim();
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return isAlive(pid) ? pid : null;
}

export function writePid(pid) {
  writeFileSync(PID_FILE, `${pid}\n`, "utf8");
}

export function clearPid() {
  try {
    rmSync(PID_FILE, { force: true });
  } catch {
    /* nothing useful to do about it during shutdown */
  }
}

export function isAlive(pid) {
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to someone else, which still counts.
    return err?.code === "EPERM";
  }
}

/* ----------------------------------------------------------------- port --- */

/**
 * Whether anything is listening on `port`.
 *
 * Connect rather than bind: a bind test on 0.0.0.0 can miss a server bound only
 * to a loopback address, and the question here is whether a browser pointed at
 * localhost:3000 would reach something, which is exactly what a connect answers.
 */
export function portInUse(port = PORT, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

/** Poll until the port is free. Returns false if it never came free. */
export async function waitForPortFree(port = PORT, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portInUse(port))) return true;
    await sleep(250);
  }
  return !(await portInUse(port));
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * PID of whatever is listening on `port`, or null if it cannot be determined.
 *
 * Best effort by design — null means "could not tell", never "nothing there".
 * Callers must treat the two differently or they will report a port as free
 * because a lookup tool was missing.
 */
export function pidOnPort(port = PORT) {
  if (IS_WIN) {
    const out = run("netstat", ["-ano", "-p", "tcp"]);
    if (out === null) return null;
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      const [, local, , state, pid] = cols;
      // Endpoints are 0.0.0.0:3000, 127.0.0.1:3000 or [::]:3000.
      if (state !== "LISTENING") continue;
      if (!local.endsWith(`:${port}`)) continue;
      const n = Number(pid);
      if (Number.isInteger(n) && n > 0) return n;
    }
    return null;
  }

  const out = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (out === null) return null;
  const n = Number(out.trim().split(/\s+/)[0]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* -------------------------------------------------------------- kinship --- */

function parentOf(pid) {
  if (IS_WIN) {
    const out = run("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`,
    ]);
    const n = Number((out ?? "").trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const out = run("ps", ["-o", "ppid=", "-p", String(pid)]);
  const n = Number((out ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Whether `pid` is `ancestor`, or descends from it.
 *
 * The recorded PID is the `next dev` process this repo spawned, but the process
 * actually holding port 3000 may be a child of it — Next runs the server in a
 * worker. So "does the PID file match the occupant" cannot be `===`, or every
 * check would report a mismatch and refuse to offer the kill that would work.
 */
export function isSelfOrDescendantOf(pid, ancestor, maxDepth = 8) {
  let current = pid;
  for (let i = 0; i <= maxDepth && current; i++) {
    if (current === ancestor) return true;
    current = parentOf(current);
  }
  return false;
}

/* ----------------------------------------------------------------- kill --- */

export function killCommand(pid) {
  return IS_WIN ? `taskkill /T /F /PID ${pid}` : `kill -9 ${pid}`;
}

/** Kill the process tree rooted at `pid`. Returns whether the kill ran. */
export function killTree(pid) {
  if (IS_WIN) {
    // /T takes the children Next spawned; without it the socket holder lives on.
    return run("taskkill", ["/T", "/F", "/PID", String(pid)]) !== null;
  }
  try {
    // Negative pid targets the process group, which is the posix equivalent
    // of /T for a child that was spawned detached into its own group.
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop the dev server, whatever state it is in.
 *
 * Returns `{ outcome, detail }`. Outcomes:
 *   `none`       nothing recorded and nothing on the port
 *   `stopped`    killed and the port came free
 *   `occupied`   the port is still held — the caller should treat this as fatal
 *   `foreign`    something is on the port that this repo did not start
 */
export async function stopDevServer({ dryRun = false } = {}) {
  const recorded = readPid();
  const occupant = pidOnPort();
  const busy = await portInUse();

  if (recorded === null && !busy) {
    clearPid(); // may be a stale file from a -9'd server
    return { outcome: "none", detail: "none running" };
  }

  if (recorded === null && busy) {
    const who = occupant === null ? "unknown pid" : `pid ${occupant}`;
    if (dryRun) {
      return {
        outcome: "foreign",
        detail: `port ${PORT} held by ${who}, not started from this repo`,
      };
    }
    // No PID file means this repo did not start it, or the file was lost. Do
    // not kill someone else's process on a guess — say what holds the port and
    // let a person decide.
    return {
      outcome: "foreign",
      detail:
        occupant === null
          ? `port ${PORT} is in use but the owner could not be identified — no .dev-server.pid to match it against`
          : `port ${PORT} held by pid ${occupant}, which this repo did not start — ${killCommand(occupant)}`,
    };
  }

  if (dryRun) {
    return { outcome: "stopped", detail: `pid ${recorded} running (not stopped, --check)` };
  }

  killTree(recorded);
  clearPid();

  if (await waitForPortFree()) {
    return { outcome: "stopped", detail: `pid ${recorded} stopped, port ${PORT} free` };
  }

  const after = pidOnPort();
  return {
    outcome: "occupied",
    detail:
      after === null
        ? `killed pid ${recorded} but port ${PORT} is still in use`
        : `killed pid ${recorded} but port ${PORT} is still held by pid ${after} — ${killCommand(after)}`,
  };
}
