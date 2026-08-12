// Bundles MapLibre's tile-parsing Web Worker into one self-contained file at
// public/maplibre-gl-worker.mjs.
//
// Why this exists
// ---------------
// maplibre-gl 6 ships `maplibre-gl-worker.mjs`, whose first statement is
// `import{...}from"./maplibre-gl-shared.mjs"` — a ~470 KB sibling. The library
// locates that worker at runtime:
//
//     function bi(){let e=import.meta.url; ...
//       return new URL(`./${t}`, e).href}
//
// That is a *dynamic* template, not the static `new URL("./w.mjs",
// import.meta.url)` form that bundlers rewrite. So no bundler emits the worker
// or its sibling as an addressable asset:
//
//   - Turbopack copies the worker byte-for-byte into /_next/static/media/
//     without rewriting the specifier, and content-hashes the sibling. The
//     worker then requests an unhashed ./maplibre-gl-shared.mjs that 404s.
//   - webpack (verified, not assumed) never emits the worker at all, so the
//     computed URL resolves against the chunk directory and 404s there.
//
// Either way the Worker's module evaluation fails and fires an `error` event
// with an empty message that MapLibre does not surface. Tiles are fetched and
// never parsed. Because MapLibre tiles GeoJSON sources *inside* the worker
// (geojson-vt runs there), this also silently kills the district overlay: the
// .geojson fetch succeeds, so nothing errors and the toggle stays enabled, but
// the source never tiles and the layers draw nothing.
//
// Bundling flattens the sibling in, so the file the browser loads has no
// imports left to resolve. `predev`/`prebuild` regenerate it, so a
// `maplibre-gl` upgrade can never leave a stale vendored copy behind.

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
