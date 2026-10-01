import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

