import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * **THE WORKING-TREE LOCK — the one seam two test files genuinely share.**
 * (Autonomy-recovery session, 2026-09-01.)
 *
 * `node --test` runs every test file in its own process, sixteen at a time on
 * this host. Two of them touch the committed tree itself: the RULING 92 check
 * regenerates every pure artifact IN PLACE and compares, and the governance
 * atomicity check snapshots `docs/` with a recursive copy to compile out of
 * place. On Windows a file held open by that copy refuses the compiler's
 * write, so the compile exits non-zero under the RULING 92 test — measured
 * 3 of 5 compiles failing with a concurrent copier, 0 of 5 without one, and
 * never once standalone. The ship door's gates went red on it twice in one
 * evening; Session C carried it as "the generated-artifact race".
 *
 * A directory is the mutex: `mkdirSync` on an existing path throws EEXIST
 * atomically, across processes. The holder removes it when done. A lock older
 * than five minutes belongs to a run that was killed and is taken over, so a
 * dead suite cannot poison the next one.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_DIR = join(ROOT, ".scratch", "working-tree.lock");
const STALE_AFTER_MS = 5 * 60_000;
const WAIT_LIMIT_MS = 4 * 60_000;
const POLL_MS = 50;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withTreeLock<T>(why: string, fn: () => T): T {
  mkdirSync(join(ROOT, ".scratch"), { recursive: true });
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let heldSinceMs = 0;
      try {
        heldSinceMs = Date.now() - statSync(LOCK_DIR).mtimeMs;
      } catch {
        continue; // released between the failed mkdir and the stat — try again
      }
      if (heldSinceMs > STALE_AFTER_MS) {
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `working-tree lock held for longer than ${WAIT_LIMIT_MS / 1000}s while waiting to: ${why}. ` +
            `Another test file that touches the tree is still running, or ${LOCK_DIR} is orphaned.`,
        );
      }
      sleep(POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}
