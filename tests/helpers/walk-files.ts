import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Every file under `dir` whose name passes `keep`, skipping directories `skip` names. */
export function walkFiles(
  dir: string,
  keep: (name: string) => boolean = () => true,
  skip: (name: string) => boolean = () => false,
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return skip(entry.name) ? [] : walkFiles(path, keep, skip);
    return keep(entry.name) ? [path] : [];
  });
}

/** Directories no source sweep should enter. */
export const hiddenOrVendored = (name: string): boolean => name === "node_modules" || name.startsWith(".");
