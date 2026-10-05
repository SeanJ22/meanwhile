import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { outOfScope, type RepairScope } from "./adapter-repair-scope.ts";
import type { AdapterFile, AdapterCheck } from "./engineering-adapter.ts";

const exec = promisify(execFile);
/** Run this kind's fixture tests and composite contract in a local checkout without production credentials. */
export async function checkAdapterRepair(files: readonly AdapterFile[], scope: RepairScope, root = process.cwd()): Promise<AdapterCheck> {
  const forbidden = outOfScope(scope, files.map(f => f.path));
  if (forbidden.length) return { ok: false, summary: "repair proposed changes outside its adapter" };
  const sandbox = await mkdtemp(join(tmpdir(), "meanwhile-adapter-repair-"));
  const checkout = join(sandbox, "code");
  try {
    await exec("git", ["clone", "--shared", "--no-hardlinks", "--quiet", root, checkout]);
    await symlink(resolve(root, "node_modules"), join(checkout, "node_modules"), "dir");
    for (const file of files) {
      const path = join(checkout, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
    }
    const env: NodeJS.ProcessEnv = { CI_TEST_FILES: scope.testFiles.join("\n"), NODE_ENV: "test", NEXT_TELEMETRY_DISABLED: "1" };
    for (const key of ["PATH", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "COMSPEC", "PATHEXT", "NODE_OPTIONS"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    await exec(process.execPath, ["scripts/ci-tests.mjs"], { cwd: checkout, env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, summary: `${scope.kind}: ${scope.testFiles.length} fixture and composite test files passed` };
  } catch {
    return { ok: false, summary: `${scope.kind}: isolated fixture and composite checks failed` };
  } finally { await rm(sandbox, { recursive: true, force: true }); }
}
