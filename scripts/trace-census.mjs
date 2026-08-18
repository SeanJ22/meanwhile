#!/usr/bin/env node
/**
 * WHAT IS ACTUALLY IN THE TRACES — the instrument the budget refusal needed
 * and did not have (R51 remainder, 2026-08-18, g16).
 *
 * `scripts/check-build-output.mjs` reports ONE number for server trace
 * cardinality: `Math.max` over every `*.nft.json` Next emitted. When that
 * number moved 927 → 1138 on Netlify and refused the deploy, the refusal was
 * correct and completely unactionable — a maximum over 24 manifests names
 * neither the manifest that grew nor the files that joined it.
 *
 * This prints both, on any machine, from an existing `.next`:
 *
 *   node scripts/trace-census.mjs                  # census to stdout
 *   node scripts/trace-census.mjs --files out.txt  # every traced path, sorted
 *
 * It reads the build output and changes nothing. Two builds on two platforms
 * produce two `--files` dumps, and `diff` then answers the question that
 * matters — WHICH files joined — rather than by how much a maximum moved.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT = join(ROOT, ".next");

const filesFlag = process.argv.indexOf("--files");
const filesOut = filesFlag >= 0 ? process.argv[filesFlag + 1] : null;

const norm = (p) => p.split(sep).join("/");

function manifests(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) manifests(p, out);
    else if (e.name.endsWith(".nft.json")) out.push(p);
  }
  return out;
}

const all = manifests(NEXT);
if (all.length === 0) {
  console.error(
    "trace-census · no trace manifests under .next — build first.\n" +
      "  Reported as a failure rather than as an empty census: nothing was measured.",
  );
  process.exit(1);
}

/**
 * The package a traced path belongs to, or null for a file of ours.
 *
 * pnpm's virtual store means the real directory is
 * `node_modules/.pnpm/<name>@<version>_<hash>/node_modules/<name>/…`, so the
 * segment after `.pnpm/` is the identity — the version and peer hash included,
 * which is what makes a version bump visible in a diff instead of invisible.
 */
function packageOf(rel) {
  const i = rel.indexOf("node_modules/");
  if (i < 0) return null;
  const rest = rel.slice(i + "node_modules/".length);
  if (rest.startsWith(".pnpm/")) {
    return rest.slice(".pnpm/".length).split("/")[0];
  }
  return rest.startsWith("@") ? rest.split("/").slice(0, 2).join("/") : rest.split("/")[0];
}

const rows = [];
const everyFile = new Set();
for (const m of all) {
  const base = dirname(m);
  const { files = [] } = JSON.parse(readFileSync(m, "utf8"));
  const rels = files.map((f) => norm(relative(ROOT, resolve(base, f))));
  for (const r of rels) everyFile.add(r);
  rows.push({ manifest: norm(relative(NEXT, m)), files: rels });
}
rows.sort((a, b) => b.files.length - a.files.length);

console.log(
  `trace-census · ${rows.length} manifests · ${everyFile.size} distinct paths · ` +
    `platform ${process.platform}-${process.arch} · node ${process.version}`,
);
console.log("");
console.log("  files  repo  manifest");
for (const r of rows) {
  const repo = r.files.filter((f) => packageOf(f) === null).length;
  console.log(
    `  ${String(r.files.length).padStart(5)}  ${String(repo).padStart(4)}  ${r.manifest}`,
  );
}

const worst = rows[0];
const byPackage = new Map();
for (const f of worst.files) {
  const p = packageOf(f) ?? "(repo)";
  byPackage.set(p, (byPackage.get(p) ?? 0) + 1);
}
console.log("");
console.log(`largest manifest · ${worst.manifest} · ${worst.files.length} files, by package:`);
for (const [p, n] of [...byPackage].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${p}`);
}

if (filesOut) {
  const lines = rows.flatMap((r) => r.files.map((f) => `${r.manifest}\t${f}`)).sort();
  writeFileSync(filesOut, lines.join("\n") + "\n");
  console.log("");
  console.log(`wrote ${lines.length} manifest/file pairs to ${filesOut}`);
}
