/**
 * P-002 · WHICH MODULES ARE THE LANDING PAGE'S JAVASCRIPT.
 *
 * Session: audit-remediation-0824. Claim served: the brief's Item 8 P-002 —
 * "run the attribution build first, identify the modules responsible for the
 * growth by provenance".
 *
 * `scripts/attribute-client-bytes.mjs` answers the question the budget asks —
 * map library, application, unattributed — and reconciles to the byte. It does
 * not say WHICH application modules, because the budget does not need that and
 * a per-module baseline would move on every refactor.
 *
 * A remediation session does need it: "application grew 238 KB" names a
 * bucket, and you cannot put a bucket behind an async boundary. So this reuses
 * the same primitives — the same source maps, the same VLQ decoder, the same
 * reconciliation — and groups by module instead of by owner.
 *
 * It is a READ of an existing build. Run the attribution build first:
 *
 *   rm -rf .next
 *   WTP_ATTRIBUTION_BUILD=1 NEXT_PRIVATE_STANDALONE=true pnpm build
 *   pnpm tsx scripts/p002-module-table.mts [--top 40] [--json <path>]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { attributeChunk } from "./attribute-client-bytes.mjs";

const NEXT = join(process.cwd(), ".next");
const argAt = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const TOP = Number(argAt("--top") ?? 40);
const JSON_OUT = argAt("--json");

/** The scripts the prerendered `/` actually references. */
function initialScripts(): string[] {
  const html = join(NEXT, "server", "app", "index.html");
  if (!existsSync(html)) {
    console.error(
      "p002: no prerendered / in .next/server/app/index.html — build first, in standalone mode",
    );
    process.exit(2);
  }
  const body = readFileSync(html, "utf8");
  const found = new Set<string>();
  for (const m of body.matchAll(/"(\/_next\/static\/[^"]+\.js)"/g)) found.add(m[1]);
  for (const m of body.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)) found.add(m[1]);
  return [...found].sort();
}

function mapFor(file: string, code: string): string | null {
  const m = /\/\/# sourceMappingURL=(.+)\s*$/.exec(code.trimEnd());
  if (!m) return null;
  const path = join(file, "..", m[1].trim());
  return existsSync(path) ? path : null;
}

/**
 * A module path collapsed to the thing a decision can be made about.
 *
 * `node_modules/.pnpm/maplibre-gl@5.0.0/node_modules/maplibre-gl/dist/x.js`
 * becomes `node_modules/maplibre-gl`, because "should maplibre be async" is a
 * question and "should that one dist file be async" is not.
 */
function group(path: string): string {
  const clean = path.replace(/^(\.\.\/)+/, "").replace(/^webpack:\/\/\/?/, "");
  const pnpm = /node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(clean);
  if (pnpm) return `node_modules/${pnpm[1]}`;
  const plain = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(clean);
  if (plain) return `node_modules/${plain[1]}`;
  const ours = /^(app|components|lib|data)\/([^/]+)\/?/.exec(clean);
  if (ours) return `${ours[1]}/${ours[2]}`;
  return clean.split("?")[0];
}

const scripts = initialScripts();
const byGroup = new Map<string, number>();
let mapped = 0;
let unmapped = 0;
let total = 0;
let chunksWithMaps = 0;

for (const src of scripts) {
  const file = join(NEXT, src.replace(/^\/_next\//, ""));
  if (!existsSync(file)) continue;
  const code = readFileSync(file, "utf8");
  total += Buffer.byteLength(code);

  const mapPath = mapFor(file, code);
  if (!mapPath) {
    unmapped += Buffer.byteLength(code);
    continue;
  }
  chunksWithMaps += 1;
  const map = JSON.parse(readFileSync(mapPath, "utf8")) as {
    sources?: string[];
    mappings?: string;
  };
  const sources = map.sources ?? [];
  const { bySource, unmapped: chunkUnmapped } = attributeChunk(code, map.mappings ?? "") as {
    bySource: Map<number, number>;
    unmapped: number;
  };
  unmapped += chunkUnmapped;
  for (const [index, bytes] of bySource) {
    const key = group(sources[index] ?? "(no source)");
    byGroup.set(key, (byGroup.get(key) ?? 0) + bytes);
    mapped += bytes;
  }
}

if (chunksWithMaps === 0) {
  console.error(
    "p002: no chunk carries a sourceMappingURL — rebuild with WTP_ATTRIBUTION_BUILD=1",
  );
  process.exit(2);
}

// The same reconciliation the owner-level split asserts. A per-module table
// that quietly loses bytes is a plausible figure, not a measurement.
if (mapped + unmapped !== total) {
  throw new Error(
    `p002 attribution does not reconcile: ${mapped} + ${unmapped} = ${mapped + unmapped}, ` +
      `chunks are ${total}`,
  );
}

const rows = [...byGroup].sort((a, b) => b[1] - a[1]);

console.log(`\nP-002 · initial JavaScript for / by module, ${scripts.length} script(s)\n`);
console.log(`  total        ${total.toLocaleString()} raw bytes`);
console.log(`  attributed   ${mapped.toLocaleString()}`);
console.log(`  unattributed ${unmapped.toLocaleString()}  (chunk wrappers and unmapped spans)`);
console.log(`  chunks with a source map  ${chunksWithMaps} of ${scripts.length}\n`);
console.log(`  ${"module".padEnd(52)} ${"raw".padStart(11)}  ${"share".padStart(6)}`);
for (const [name, bytes] of rows.slice(0, TOP)) {
  const share = ((bytes / total) * 100).toFixed(2);
  console.log(`  ${name.slice(0, 52).padEnd(52)} ${bytes.toLocaleString().padStart(11)}  ${share.padStart(5)}%`);
}
if (rows.length > TOP) {
  const rest = rows.slice(TOP).reduce((n, [, b]) => n + b, 0);
  console.log(`  ${`… ${rows.length - TOP} more`.padEnd(52)} ${rest.toLocaleString().padStart(11)}`);
}
console.log("");

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    `${JSON.stringify({ total, mapped, unmapped, scripts, modules: rows }, null, 2)}\n`,
    "utf8",
  );
  console.log(`  written ${JSON_OUT}\n`);
}
