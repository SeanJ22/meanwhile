import { storedKeyEnvironment } from "../lib/core/keys-values.ts";
/**
 * `pnpm dev` — `next dev`, with its pid recorded so a later step can stop it.
 *
 * The wrapper exists only for the pid file. Nothing else can write it: pnpm
 * knows the pid of the shell it spawned, not of Next, and `predev` runs in a
 * separate process that has not started anything yet.
 *
 * The recorded pid is this `next dev` process. Next spawns children and the
 * socket may be held by one of them, so anything acting on this file must kill
 * the tree (`taskkill /T`) and must match on descent rather than identity —
 * see dev-server.mjs.
 *
 * The file is removed on any exit this process lives to see. A -9 leaves it
 * behind, which is why readers verify the pid is alive rather than trusting it.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { PORT, ROOT, clearPid, writePid } from "./dev-server.mjs";

const require = createRequire(import.meta.url);

// Resolve Next's own entry and run it under this node, rather than shelling out
// to a .cmd shim: the shim would be the recorded pid and killing it on Windows
// can orphan the server it launched.
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, "dev"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...storedKeyEnvironment(), PORT: String(PORT) },
});

writePid(child.pid);

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  clearPid();
}

process.on("exit", cleanup);

// Ctrl-C reaches the whole console process group on Windows, so the child is
// already being told to stop. Do not kill it here — let it close down and
// report its own exit code, then clean up after it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  });
}

child.on("exit", (code, signal) => {
  cleanup();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on("error", (err) => {
  cleanup();
  console.error(`could not start next dev: ${err.message}`);
  process.exit(1);
});
