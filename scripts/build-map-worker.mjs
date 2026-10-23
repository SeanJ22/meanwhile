// Bundles MapLibre's tile-parsing Web Worker into one self-contained file at
// public/maplibre-gl-worker.mjs.
//
// maplibre-gl ships `maplibre-gl-worker.mjs`, which imports a sibling
// `./maplibre-gl-shared.mjs` and is located at runtime through a DYNAMIC
// `new URL(...)` template that no bundler rewrites. Neither Turbopack nor
// webpack emits a working worker, and the failure is silent: tiles (including
// the GeoJSON district overlay, tiled inside the worker) are never parsed.
//
// Bundling flattens the sibling in, so the loaded file has no imports left.
// `predev`/`prebuild` regenerate it, so an upgrade never leaves a stale copy.

import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Resolve through the package rather than hardcoding node_modules, so this
// keeps working under pnpm's symlinked store and in a hoisted install alike.
const entry = join(
  dirname(require.resolve("maplibre-gl/package.json")),
  "dist",
  "maplibre-gl-worker.mjs",
);

const outfile = join(root, "public", "maplibre-gl-worker.mjs");

await mkdir(dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  // MapLibre spawns this with `new Worker(url, { type: "module" })`.
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "inline",
  logLevel: "warning",
  metafile: true,
});

// The whole point is a file with no imports left. If esbuild ever leaves one
// unresolved, fail loudly here rather than shipping a worker that 404s at
// runtime and reports nothing.
const outputs = Object.values(result.metafile.outputs);
const imports = outputs.flatMap((o) => o.imports ?? []).filter((i) => i.external);
if (imports.length > 0) {
  throw new Error(
    `Worker bundle still has unresolved imports: ${imports
      .map((i) => i.path)
      .join(", ")}`,
  );
}

const { size } = await stat(outfile);
console.log(
  `map worker → ${relative(root, outfile).replace(/\\/g, "/")} (${(
    size / 1024
  ).toFixed(0)} KB, self-contained)`,
);

await build({ entryPoints: [join(root,"lib/map/boundary-worker.ts")], outfile: join(root,"public/map-boundary-worker.mjs"),
  bundle:true,format:"esm",platform:"browser",target:"es2020",minify:true,legalComments:"inline",logLevel:"warning" });
