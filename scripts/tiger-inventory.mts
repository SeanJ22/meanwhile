/**
 * What the seven national TIGER boundary files actually hold (Prompt B item
 * 5.1, 2026-08-20). Vintage and row count for each, read from the file rather
 * than from the URL it came from.
 *
 * Run:  corepack pnpm tiger:inventory
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readBoundaryZip } from "../lib/geo/shapefile.ts";

const CACHE = join(process.cwd(), ".cache", "tiger");

const files = readdirSync(CACHE).filter((f) => f.endsWith(".zip")).sort();
console.log(`TIGER CACHE: ${files.length} files in .cache/tiger\n`);

for (const file of files) {
  const vintage = /cb_(\d{4})_/.exec(file)?.[1] ?? "unknown";
  const { features, counts } = readBoundaryZip(readFileSync(join(CACHE, file)));
  const sample = features[0]?.properties ?? {};
  console.log(`${file}`);
  console.log(`  vintage ${vintage} — ${counts}`);
  console.log(`  columns: ${Object.keys(sample).join(", ")}`);
  console.log(
    `  first row: ${Object.entries(sample)
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
  const rings = features.reduce((a, f) => a + f.rings.length, 0);
  const points = features.reduce((a, f) => a + f.rings.reduce((b, r) => b + r.length, 0), 0);
  console.log(`  ${rings} rings, ${points} vertices\n`);
}
