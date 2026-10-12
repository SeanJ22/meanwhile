import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A module's source with comments stripped, so guards measure code rather than prose about it. */
export function codeOf(...parts: string[]): string {
  const source = readFileSync(join(ROOT, ...parts), "utf8");
  const blockComments = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const lineComments = new RegExp("(^|[^:])//[^\\n]*", "gm");
  return source.replace(blockComments, " ").replace(lineComments, "$1 ");
}

/** The repository root, resolved from this file rather than from `cwd`. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `.ts` file under a directory relative to `ROOT`, recursively. Returns absolute paths. */
export function tsFilesUnder(...parts: string[]): string[] {
  return sourceFilesUnder([".ts"], ...parts);
}

/** Every file under a directory relative to `ROOT` whose name ends in one of `extensions`. */
export function sourceFilesUnder(extensions: string[], ...parts: string[]): string[] {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...walk(path));
      else if (extensions.some((ext) => name.endsWith(ext))) out.push(path);
    }
    return out;
  };
  return walk(join(ROOT, ...parts));
}
