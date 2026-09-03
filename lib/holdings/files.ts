import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
export { ballotPath, geometryPath, rosterPath, stateForFips } from "./runtime-paths.ts";

/** Sorted repository-relative files; holdings discovery does not use reader coverage. */
export function stateDomainFiles(root: string, domain: string, base: "data" | "public" = "data"): string[] {
  const dir = join(root, base, "states");
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (relative: string) => {
    if (!existsSync(join(root, relative))) return;
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  for (const state of readdirSync(dir, { withFileTypes: true })) {
    if (state.isDirectory() && /^[a-z]{2}$/.test(state.name)) walk(`${base}/states/${state.name}/${domain}`);
  }
  return files.sort();
}

export function geometryFiles(root: string): string[] {
  const national = join(root, "public", "geo");
  return [
    ...(existsSync(national) ? readdirSync(national).filter((file) => file.endsWith(".geojson")).map((file) => `public/geo/${file}`) : []),
    ...stateDomainFiles(root, "geo").filter((file) => file.endsWith(".geojson")),
  ].sort();
}

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
