/**
 * Resolves the repo's `@/` import alias for `node --test` runs, so tests
 * can exercise the API route handlers under app/api — the modules where
 * the T08 refusals actually live — instead of only the lib pieces under
 * them. Next resolves the alias in the app build; this hook is the same
 * mapping (tsconfig paths: at-slash to repo root) for the test runner,
 * nothing more.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = join(root, specifier.slice(2));
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
    ]) {
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
