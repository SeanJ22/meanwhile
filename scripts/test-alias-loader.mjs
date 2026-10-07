/**
 * Resolves the repo's `@/` import alias for `node --test` runs (tsconfig paths:
 * at-slash to repo root), so tests can import the app/api route handlers.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();
// Ordinary TS uses Node's native stripping. Load this same compiler only when
// the module graph actually reaches TSX, including transitive component imports.
let typescript;

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = join(root, specifier.slice(2));
    // A FILE, never a directory: Node refuses a directory import, so a directory match could only fail.
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
    ]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  /*
   * Extensionless bare specifiers the bundler resolves and Node does not (e.g.
   * `next/server` has no `exports` map). Node resolves them and then fails to
   * load, so this runs before `nextResolve`: bare specifiers only, and only when
   * the extensionless path is absent and the `.js` beside it exists.
   */
  if (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("node:") &&
    !specifier.startsWith("file:")
  ) {
    const bare = join(root, "node_modules", specifier);
    if (!existsSync(bare) && existsSync(`${bare}.js`)) {
      return nextResolve(pathToFileURL(`${bare}.js`).href, context);
    }
  }

  /*
   * Extensionless relative imports the bundler resolves (e.g. `./x` naming
   * `x.tsx`). Tried only when the specifier as written names no file, so nothing
   * that resolves today resolves differently.
   */
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    if (!(existsSync(base) && statSync(base).isFile())) {
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
  }

  return nextResolve(specifier, context);
}

/** Node SSR tests read real component content but cannot execute CSS. Export
 * only class keys actually declared by the imported module; paint remains a
 * browser assertion and an unknown class key still resolves to undefined. */
export async function load(url, context, nextLoad) {
  /* Node's type stripping refuses TSX; transpile it only for this test loader. */
  if (url.endsWith(".tsx")) {
    const ts = typescript ??= (await import("typescript")).default;
    const source = readFileSync(fileURLToPath(url), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: fileURLToPath(url),
      reportDiagnostics: false,
    });
    return { format: "module", shortCircuit: true, source: compiled.outputText };
  }
  /*
   * JSON the bundler imports by default but Node's ESM loader refuses without an
   * explicit `with { type: "json" }` attribute: return the same default export.
   */
  if (url.endsWith(".json")) {
    const json = readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", shortCircuit: true, source: `export default ${json};` };
  }
  if (!url.endsWith(".module.css")) return nextLoad(url, context);
  const css = readFileSync(fileURLToPath(url), "utf8");
  const classKeys = [...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(match => match[1]);
  const exports = Object.fromEntries(classKeys.map(key => [key, key]));
  return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(exports)};` };
}
