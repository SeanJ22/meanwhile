import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { operationalStatePath } from "../lib/ops/operational-state-path.ts";

// Production, release 95: 47 of 78 state planners died with exactly this stack while another runner process
// released the shared lock between the planner's existence check and its path resolution.
test("a shared lock or temporary file removed by another process mid-check leaves the path valid", () => {
  const directory = mkdtempSync(join(tmpdir(), "operational-state-race-"));
  const real = fs.realpathSync;
  try {
    for (const name of ["meanwhile-worker-memory.json.lock", "meanwhile-worker-memory.json.tmp"]) {
      const path = join(directory, name);
      writeFileSync(path, "123");
      let removed = false;
      fs.realpathSync = Object.assign((target: fs.PathLike, options?: fs.EncodingOption) => {
        if (String(target) === path && !removed) {
          removed = true;
          unlinkSync(path);
          throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: "ENOENT" });
        }
        return real(target, options);
      }, { native: real.native }) as typeof fs.realpathSync;
      syncBuiltinESMExports();
      assert.equal(operationalStatePath(path), path);
      assert.equal(removed, true, "the race was exercised");
    }
  } finally {
    fs.realpathSync = real;
    syncBuiltinESMExports();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("paths outside host state and other resolution errors still refuse", () => {
  assert.throws(() => operationalStatePath(join(process.cwd(), "meanwhile-worker-memory.json")), /WORKER_MEMORY_PATH_(?:OUTSIDE_HOST_STATE|INSIDE_REPOSITORY)/);
  const directory = mkdtempSync(join(tmpdir(), "operational-state-refuse-"));
  const real = fs.realpathSync;
  try {
    const path = join(directory, "meanwhile-worker-memory.json");
    fs.realpathSync = Object.assign((target: fs.PathLike, options?: fs.EncodingOption) => {
      if (String(target) === directory) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return real(target, options);
    }, { native: real.native }) as typeof fs.realpathSync;
    syncBuiltinESMExports();
    assert.throws(() => operationalStatePath(path), /EACCES/);
  } finally {
    fs.realpathSync = real;
    syncBuiltinESMExports();
    rmSync(directory, { recursive: true, force: true });
  }
});
