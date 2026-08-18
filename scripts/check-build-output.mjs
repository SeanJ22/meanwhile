#!/usr/bin/env node
/**
 * The deployed artifact is asked what is in it — R23, closed 2026-08-17.
 *
 * Netlify refused `main@a8f7ff2` with two "likely secret" hits, and both were
 * planted test fixtures: the credential-shaped strings `tests/mirror-code.test.ts`
 * feeds its matcher to prove the code mirror refuses credential-shaped files.
 * No secret leaked. But the fixtures had no business being in a deployed
 * bundle at all, and the reason they were is R23's own diagnosis: a
 * `readFileSync` over a runtime-computed path in the curated ballot source, so
 * Turbopack could not know which files were needed and traced the WHOLE
 * PROJECT — `tests/` included — into the two bundles that reach it.
 *
 * Measured before the fix, 2026-08-17: `/api/ballot/scope` traced 2554 files
 * and `/ballot` traced 2567, each carrying 122 files from `tests/`, against
 * 104-195 traced for every other route.
 *
 * Two checks run here, and they are checks on the OUTPUT, not on the source —
 * the source fix can be undone by any future dynamic read, and the artifact is
 * what actually ships:
 *
 *   1. No file under `tests/` appears in any trace manifest.
 *   2. No traced repo file carries a credential-shaped VALUE.
 *
 * Check 2 deliberately uses the value-shaped subset of the mirror's patterns.
 * The mirror also matches env-var NAMES (`ANTHROPIC_API_KEY`, a `DATABASE_URL`
 * assignment), which are not secrets and appear legitimately in code that
 * reads configuration; asserting on those would make this check cry wolf, and
 * a check that cries wolf gets muted. A scanner flags shapes that look like
 * live credentials, so that is what is asserted here.
 *
 * Wired as `postbuild`, so it runs on every `pnpm build` — locally and on
 * Netlify, before the secrets scan ever sees the output. A failure here is
 * loud and fails the build, which is the whole point: the alternative was
 * finding out from a refused deploy while production served a stale build.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT = join(ROOT, ".next");

/** Credential VALUE shapes. See the header for why names are not included. */
const VALUE_SHAPES = [
  { name: "Anthropic-style key", re: /\bsk-ant-[A-Za-z0-9_-]{8,}/g },
  { name: "sk- style key", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: "GitHub token (ghp_)", re: /\bghp_[A-Za-z0-9]{16,}/g },
  { name: "GitHub token (github_pat_)", re: /\bgithub_pat_[A-Za-z0-9_]{16,}/g },
  { name: "AWS access key id", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    name: "Postgres connection string",
    // Userinfo made only of characters a real password can hold: `$`, `{`, `<`
    // and a backslash mean an unfilled template, not a credential.
    re: /postgres(ql)?:\/\/[^\s"'`{}$<>\\/@]+:[^\s"'`{}$<>\\/@]+@/gi,
  },
  { name: "PEM private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

/**
 * Documentation placeholders, named rather than silently tolerated.
 *
 * `@neondatabase/serverless` ships its own usage example as a string — a
 * `postgresql` URL whose userinfo is the literal `user` and `password` — and
 * Turbopack compiles it into three server chunks. (Written out here it would
 * be a literal credential shape in a source file, which is the exact class of
 * thing this session removed; the entry below carries the shape instead.)
 * It is a shape, not a secret, and the
 * count of skipped placeholders is printed on every run so this list can
 * never quietly grow into a mask. Netlify's own scan agrees: it reported zero
 * real instances against this artifact.
 */
const PLACEHOLDER_USERINFO = new Set([
  "user:password",
  "username:password",
  "user:pass",
  "user:pw",
  "USER:PASSWORD",
]);

/** A placeholder is a match whose userinfo is a known documentation stand-in. */
function isPlaceholder(match) {
  const userinfo = match.replace(/^postgres(ql)?:\/\//i, "").replace(/@$/, "");
  return PLACEHOLDER_USERINFO.has(userinfo);
}

/** Every `*.nft.json` trace manifest Next emitted. */
function traceManifests(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) traceManifests(p, out);
    else if (e.name.endsWith(".nft.json")) out.push(p);
  }
  return out;
}

const manifests = traceManifests(NEXT);
if (manifests.length === 0) {
  console.error(
    "build-output · no trace manifests under .next — nothing was checked.\n" +
      "  This is a FAILURE, not a pass: an unverified artifact is the state R23 existed to end.",
  );
  process.exit(1);
}

/** repoPath -> the manifests that traced it. */
const traced = new Map();
for (const m of manifests) {
  const base = dirname(m);
  const { files = [] } = JSON.parse(readFileSync(m, "utf8"));
  for (const f of files) {
    const abs = resolve(base, f);
    if (!abs.startsWith(ROOT)) continue;
    const rel = relative(ROOT, abs).replace(/\\/g, "/");
    if (rel.startsWith("node_modules/")) continue;
    if (!traced.has(rel)) traced.set(rel, []);
    traced.get(rel).push(relative(NEXT, m).replace(/\\/g, "/"));
  }
}

const failures = [];

/* -- 1: tests have no place in a deployed artifact ------------------------ */

const testFiles = [...traced.keys()].filter(
  (p) => p === "tests" || p.startsWith("tests/"),
);
if (testFiles.length > 0) {
  const bundles = [...new Set(testFiles.flatMap((p) => traced.get(p)))];
  failures.push(
    `${testFiles.length} file(s) under tests/ are traced into the deployed artifact.\n` +
      `  Bundles: ${bundles.join(", ")}\n` +
      `  First few: ${testFiles.slice(0, 5).join(", ")}\n` +
      `  Cause is almost always a filesystem read over a path the bundler cannot see.\n` +
      `  See lib/sources/ballot-curated/index.ts for the shape that fixes it.`,
  );
}

/* -- 2: nothing credential-shaped rides along ----------------------------- */

const leaks = [];
let placeholders = 0;
for (const rel of traced.keys()) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue; // a directory entry or an unreadable binary — nothing to scan
  }
  if (text.includes("\u0000")) continue; // binary
  for (const shape of VALUE_SHAPES) {
    for (const match of text.match(shape.re) ?? []) {
      if (isPlaceholder(match)) placeholders += 1;
      else leaks.push(`${rel} — ${shape.name}`);
    }
  }
}
if (leaks.length > 0) {
  failures.push(
    `${leaks.length} traced file(s) carry a credential-shaped value:\n  ` +
      leaks.join("\n  "),
  );
}

/* -- two budgets, not one number (AUD-02) ---------------------------------- */

/*
 * This block used to print `largest bundle ${worst} files` and every standing
 * report read it as a bundle SIZE. It is neither a size nor a bundle: it is the
 * cardinality of a Next server trace manifest, and it says nothing about the
 * JavaScript a reader downloads. One ambiguous number was standing in for two
 * questions, so neither was being answered.
 *
 * Both are answered now, both against committed baselines with stated ceilings,
 * and a ceiling breach REFUSES rather than warns.
 */
const budget = JSON.parse(readFileSync(join(ROOT, "scripts", "bundle-budget.json"), "utf8"));

const worst = Math.max(...manifests.map((m) => JSON.parse(readFileSync(m, "utf8")).files.length));

/**
 * The reader's initial JavaScript for `/`, read off the EMITTED HTML.
 *
 * The prerendered page names the scripts it loads, so this is what is served
 * rather than what a manifest planned to serve. Returns null when the page was
 * not prerendered — reported as unmeasured rather than as zero, because a
 * budget that reads a missing file as 0 bytes passes loudest exactly when it
 * has stopped working.
 */
function clientCost() {
  const html = join(NEXT, "server", "app", "index.html");
  if (!existsSync(html)) return null;
  const text = readFileSync(html, "utf8");
  const srcs = [
    ...new Set([...text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])),
  ];
  if (srcs.length === 0) return null;

  let raw = 0;
  let transfer = 0;
  let mapRaw = 0;
  let mapTransfer = 0;
  let missing = 0;
  for (const src of srcs) {
    const file = join(NEXT, src.replace(/^\/_next\//, ""));
    if (!existsSync(file)) {
      missing += 1;
      continue;
    }
    const bytes = readFileSync(file);
    const gz = gzipSync(bytes, { level: 9 }).length;
    raw += bytes.length;
    transfer += gz;
    // MapLibre identifies itself in its own source. Read from the buffer rather
    // than guessed from a filename: Turbopack's chunk names are content hashes
    // and carry no library name at all.
    if (/maplibre|mapbox-gl/i.test(bytes.toString("utf8"))) {
      mapRaw += bytes.length;
      mapTransfer += gz;
    }
  }
  return { chunks: srcs.length, raw, transfer, mapRaw, mapTransfer, missing };
}

const client = clientCost();

console.log(
  `build-output · ${manifests.length} trace manifests · ${traced.size} repo files traced · ` +
    `tests/ traced ${testFiles.length} · credential shapes ${leaks.length} · ` +
    `named placeholders skipped ${placeholders}`,
);
console.log(
  `budget 1 · server trace cardinality: largest manifest ${worst} files ` +
    `(baseline ${budget.serverTrace.largestManifestFiles}, ceiling ${budget.serverTrace.ceiling}) ` +
    `— a FILE COUNT, not bytes, and not the reader's JavaScript`,
);
if (client === null) {
  console.log(
    "budget 2 · client cost for /: NOT MEASURED — no prerendered index.html with scripts. " +
      "Reported as unmeasured rather than as zero.",
  );
} else {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(
    `budget 2 · client cost for /: ${kb(client.raw)} initial JS, ${kb(client.transfer)} gzip, ` +
      `across ${client.chunks} chunks ` +
      `(baseline ${kb(budget.client.initialJsBytes)} / ${kb(budget.client.transferBytes)}, ` +
      `ceiling ${kb(budget.client.initialJsCeiling)} / ${kb(budget.client.transferCeiling)})`,
  );
  console.log(
    `           of which MapLibre ${kb(client.mapRaw)} / ${kb(client.mapTransfer)} gzip, ` +
      `application ${kb(client.raw - client.mapRaw)} / ${kb(client.transfer - client.mapTransfer)} gzip` +
      (client.missing > 0 ? ` · ${client.missing} referenced chunk(s) MISSING from disk` : ""),
  );
}

if (worst > budget.serverTrace.ceiling) {
  failures.push(
    `server trace cardinality ${worst} files exceeds the committed ceiling of ` +
      `${budget.serverTrace.ceiling} (baseline ${budget.serverTrace.largestManifestFiles}).\n` +
      "  Something is being traced into the server bundle that was not before — this is\n" +
      "  the shape R23 had, where a runtime-computed path made Turbopack trace the whole\n" +
      "  project. Find what joined, or raise the ceiling deliberately in\n" +
      "  scripts/bundle-budget.json with a reason.",
  );
}
if (client !== null) {
  if (client.raw > budget.client.initialJsCeiling) {
    failures.push(
      `initial JS for / is ${client.raw} bytes, over the committed ceiling of ` +
        `${budget.client.initialJsCeiling}.`,
    );
  }
  if (client.transfer > budget.client.transferCeiling) {
    failures.push(
      `compressed transfer for / is ${client.transfer} bytes, over the committed ceiling of ` +
        `${budget.client.transferCeiling}.`,
    );
  }
  if (client.missing > 0) {
    failures.push(
      `${client.missing} chunk(s) referenced by the prerendered / are absent from .next — ` +
        "the measurement is incomplete and the page would 404 them.",
    );
  }
}

if (failures.length > 0) {
  console.error("\nbuild-output · REFUSED\n");
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}
