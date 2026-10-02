import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
export { ballotPath, geometryPath, rosterPath, stateForFips } from "./runtime-paths.ts";

import { stateDomainFiles } from "./discovery.ts";
export { stateDomainFiles, geometryFiles } from "./discovery.ts";

export function streetPath(root: string, zip: string): string | undefined {
  const matches = stateDomainFiles(root, "streets").filter((file) => basename(file) === `${zip}.json`);
  if (matches.length > 1) throw new Error(`${zip}: multiple state street holdings require explicit state selection`);
  return matches[0];
}

export interface ProjectionResult { files: number; issues: string[] }

/** Offline byte projection. Check mode never creates, changes, or deletes anything. */
export function projectStateHoldings(root: string, check = false): ProjectionResult {
  const inputs = ["geo", "streets"].flatMap((domain) => stateDomainFiles(root, domain));
  const expected = new Set(inputs.map((file) => file.replace(/^data\//, "public/")));
  const issues: string[] = [];
  for (const source of inputs) {
    const target = source.replace(/^data\//, "public/");
    if (existsSync(join(root, target)) && readFileSync(join(root, source)).equals(readFileSync(join(root, target)))) continue;
    if (check) issues.push(`${target}: missing or differs from ${source}`);
    else {
      mkdirSync(dirname(join(root, target)), { recursive: true });
      copyFileSync(join(root, source), join(root, target));
    }
  }
  for (const target of ["geo", "streets"].flatMap((domain) => stateDomainFiles(root, domain, "public"))) {
    if (expected.has(target)) continue;
    if (check) issues.push(`${target}: no canonical holding`);
    else unlinkSync(join(root, target));
  }
  return { files: inputs.length, issues };
}
