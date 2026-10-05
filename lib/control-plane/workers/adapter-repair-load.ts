import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { repairScope, type FailingExample, type RepairScopeResult } from "./adapter-repair-scope.ts";

/** Only the identified adapter and test filenames are read; no unrelated source is sent to the engineer. */
export function loadAdapterRepairScope(kind: string, example: FailingExample, root = process.cwd()): RepairScopeResult | null {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(kind)) return null;
  const directory = resolve(root, "lib/sources", kind);
  if (!existsSync(directory)) return null; // New kinds still use the existing new-adapter path.
  const paths: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) paths.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  walk(directory);
  if (existsSync(join(root, "tests"))) paths.push(...readdirSync(join(root, "tests")).filter(path => /\.test\.(?:ts|mts|mjs)$/.test(path)).map(path => "tests/" + path));
  return repairScope({ kind, example, paths, readText: path => readFileSync(resolve(root, path), "utf8") });
}
