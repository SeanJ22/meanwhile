// MapLibre resolves its worker through a dynamic URL that Next cannot rewrite.
// Flatten its shared module, and build the reader's early map entry and worker
// alongside it. predev/prebuild regenerate these files on every build.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(join(root, "public"), { recursive: true });
for (const [entry, file, format] of [
  [join(dirname(require.resolve("maplibre-gl/package.json")), "dist/maplibre-gl-worker.mjs"), "maplibre-gl-worker.mjs", "esm"],
  [join(root, "lib/map/boundary-worker.ts"), "map-boundary-worker.mjs", "esm"],
  [join(root, "lib/map/first-view.ts"), "map-first-view.mjs", "iife"],
]) {
  const outfile = join(root, "public", file);
  const result = await build({ entryPoints: [entry], outfile, bundle: true, format,
    platform: "browser", target: "es2020", minify: true, legalComments: "inline", logLevel: "warning", metafile: true });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports ?? []).filter(value => value.external);
  if (imports.length) throw new Error(`${file} still has unresolved imports: ${imports.map(value => value.path).join(", ")}`);
  console.log(`map → public/${file} (${Math.round((await stat(outfile)).size / 1024)} KB, self-contained)`);
}
