/**
 * Resolves the repo's `@/` import alias for `node --test` runs, so tests
 * can exercise the API route handlers under app/api — the modules where
 * the T08 refusals actually live — instead of only the lib pieces under
 * them. Next resolves the alias in the app build; this hook is the same
 * mapping (tsconfig paths: at-slash to repo root) for the test runner,
 * nothing more.
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
    // A FILE, never a directory: `@/lib/sources/ballot-nj-morris` names a
    // folder whose module is its index.ts, as the bundler resolves it. Node
    // refuses a directory import outright, so a directory match here could
    // only fail (it did, the first time a test imported app/ballot/page.tsx).
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
   * **EXTENSIONLESS BARE SPECIFIERS THE BUNDLER RESOLVES AND NODE DOES NOT**
   * (Prompt D item 6.5, 2026-08-20).
   *
   * `next/server` is a real file — `node_modules/next/server.js` — and Next's
   * package.json declares no `exports` map, so a bundler finds it by appending
   * the extension and plain node ESM does not. `app/api/meetings/route.ts`
   * imports `after` from it; the route builds and deploys, and every test that
   * imports that route died with ERR_MODULE_NOT_FOUND.
   *
   * The alternative was to stop importing it, which would mean shipping the
   * alarm as an unawaited promise the runtime drops — the exact defect the live
   * probe had just caught. So the LOADER learns what the bundler already knows.
   *
   * Node RESOLVES this specifier happily and then fails to LOAD it, so the fix
   * has to run BEFORE `nextResolve` rather than in a catch around it. Narrow on
   * purpose: bare specifiers only, and only when the extensionless path is
   * absent and the `.js` beside it is really there.
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
   * **EXTENSIONLESS RELATIVE IMPORTS, THE SAME WAY** (R30, 2026-09-25).
   * `components/ask/ballot-ask.tsx` imports `./body-confirmation`, which the
   * bundler finds as `body-confirmation.tsx` and Node does not, so no test
   * could import `app/ballot/page.tsx` to render it. Tried only when the
   * specifier as written names no file, so nothing that resolves today
   * resolves differently.
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
  /*
   * Node's built-in type stripping intentionally refuses TSX. Admin's
   * canonical runtime-outcome projection has a server-rendered component
   * contract, so silently omitting its TSX test from the certified suite
   * would leave the owner-facing PDC evidence outside certification.
   * Transpile TSX only for this test loader; the app still uses Next.
   */
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
   * JSON the bundler imports by default but Node's ESM loader refuses without
   * an explicit `with { type: "json" }` attribute (Node 24). Next and tsx both
   * resolve a bare `import data from "x.json"` to the parsed value as the
   * default export; the reader body-render proof reaches one such import
   * (data/derived/school-district-dependency.json via lib/officials/school-
   * dependency.ts). Return the same default export so the certified test loader
   * matches the bundler rather than diverging from it. JSON exposes only a
   * default binding either way, so this cannot mask a named-import mistake.
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
