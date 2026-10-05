import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { outOfScope, type RepairScope } from "./adapter-repair-scope.ts";
import type { AdapterFile, AdapterCheck } from "./engineering-adapter.ts";

const exec = promisify(execFile);
/** Run this kind's fixture tests and composite contract in an isolated local checkout. No network or production writes. */
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
    const env: NodeJS.ProcessEnv = { ...process.env, CI_TEST_FILES: scope.testFiles.join("\n") };
    delete env.DATABASE_URL; delete env.WTP_ASSET_STORE;
    await exec(process.execPath, ["scripts/ci-tests.mjs"], { cwd: checkout, env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, summary: `${scope.kind}: ${scope.testFiles.length} fixture and composite test files passed` };
  } catch {
    return { ok: false, summary: `${scope.kind}: isolated fixture and composite checks failed` };
  } finally { await rm(sandbox, { recursive: true, force: true }); }
}
