#!/usr/bin/env node
/**
 * Postbuild check of the deployed artifact itself, not the source:
 *
 *   1. No file under `tests/` appears in any trace manifest.
 *   2. No traced repo file carries a credential-shaped VALUE.
 *   3. The server-trace and client-JS budgets in `scripts/bundle-budget.json`.
 *
 * Check 2 matches value shapes only; env-var NAMES appear legitimately in code
 * that reads configuration. `evaluate` is a pure read of a directory tree so
 * every refusal can be planted against a synthetic `.next`.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { attributeByProvenance } from "./attribute-client-bytes.mjs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A ceiling is AT MOST the measured baseline plus HEADROOM, rounded DOWN to a
 * readable unit. Tighter is always allowed; a ceiling moves only when its
 * baseline is re-measured, never on its own.
 */
export const HEADROOM = 0.15;

/** The largest ceiling the rule permits for a baseline, rounded down to `unit`. */
export function ceilingCap(baseline, unit) {
  return Math.floor((baseline * (1 + HEADROOM)) / unit) * unit;
}

/** Credential VALUE shapes. */
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
 * Documentation placeholders: `@neondatabase/serverless` ships a usage example
 * whose userinfo is a literal placeholder. The skipped count is printed on every
 * run so this list cannot quietly become a mask.
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

/** `standalone/.next/server/app/x.nft.json` and `server/app/x.nft.json` are one manifest. */
function manifestKey(next, m) {
  return relative(next, m).replace(/\\/g, "/").replace(/^standalone\/\.next\//, "");
}

/**
 * The reader's initial JavaScript for `/`, read off the emitted HTML. Null when
 * the page was not prerendered; unmeasured is a refusal, not a pass.
 */
function clientCost(next) {
  const html = join(next, "server", "app", "index.html");
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
    const file = join(next, src.replace(/^\/_next\//, ""));
    if (!existsSync(file)) {
      missing += 1;
      continue;
    }
    const bytes = readFileSync(file);
    const gz = gzipSync(bytes, { level: 9 }).length;
    raw += bytes.length;
    transfer += gz;
    // Turbopack chunk names are content hashes, so MapLibre is found by content.
    if (/maplibre|mapbox-gl/i.test(bytes.toString("utf8"))) {
      mapRaw += bytes.length;
      mapTransfer += gz;
    }
  }
  // Attributes within a chunk from source maps, so re-chunking cannot move it;
  // the substring figures above are only an estimate.
  const provenance = attributeByProvenance({ next, srcs });

  return {
    chunks: srcs.length,
    raw,
    transfer,
    mapRaw,
    mapTransfer,
    missing,
    provenance,
  };
}

/**
 * Reads a build output and says what is wrong with it. No process exit, no
 * environment read, nothing printed: `lines` is reported, `failures` refuse.
 */
export function evaluate({ root, budget }) {
  const next = join(root, ".next");
  const lines = [];
  const failures = [];

  const manifests = traceManifests(next);
  if (manifests.length === 0) {
    return {
      lines,
      failures: [
        "no trace manifests under .next — nothing was checked.\n" +
          "  This is a FAILURE, not a pass: an unverified artifact is the state R23 existed to end.",
      ],
      measurements: null,
    };
  }

  /** repoPath -> the manifests that traced it. */
  const traced = new Map();
  for (const m of manifests) {
    const base = dirname(m);
    const { files = [] } = JSON.parse(readFileSync(m, "utf8"));
    for (const f of files) {
      const abs = resolve(base, f);
      if (!abs.startsWith(root)) continue;
      const rel = relative(root, abs).replace(/\\/g, "/");
      if (rel.startsWith("node_modules/")) continue;
      if (!traced.has(rel)) traced.set(rel, []);
      traced.get(rel).push(relative(next, m).replace(/\\/g, "/"));
    }
  }

  /* -- 1: tests have no place in a deployed artifact ---------------------- */

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

  /* -- 2: nothing credential-shaped rides along --------------------------- */

  const leaks = [];
  let placeholders = 0;
  for (const rel of traced.keys()) {
    const abs = join(root, rel);
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

  /* -- 3: budgets --------------------------------------------------------- */

  /*
   * Budget 1 is two numbers. 1a is the largest APP route trace (a file count);
   * 1b is Next's own server runtime trace, which holds no file of ours and
   * differs between default and standalone mode, so it is budgeted per mode.
   * Standalone copies under `standalone/.next/` are folded onto their originals.
   * The mode is read off the output, not the environment.
   */
  const mode = existsSync(join(next, "standalone")) ? "standalone" : "default";

  const appManifests = [];
  const frameworkManifests = [];
  const seen = new Set();
  for (const m of manifests) {
    const key = manifestKey(next, m);
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = { key, files: JSON.parse(readFileSync(m, "utf8")).files.length };
    if (key.startsWith("server/app/")) appManifests.push(entry);
    else frameworkManifests.push(entry);
  }
  appManifests.sort((a, b) => b.files - a.files);
  frameworkManifests.sort((a, b) => b.files - a.files);

  const worstApp = appManifests[0] ?? null;
  const worstFramework = frameworkManifests[0] ?? null;
  const frameworkBudget = budget.serverTrace.frameworkRuntime[mode] ?? null;
  const client = clientCost(next);

  lines.push(
    `build-output · ${manifests.length} trace manifests · ${traced.size} repo files traced · ` +
      `tests/ traced ${testFiles.length} · credential shapes ${leaks.length} · ` +
      `named placeholders skipped ${placeholders}`,
  );
  lines.push(
    `budget 1a · largest APP trace: ${worstApp === null ? "NONE FOUND" : `${worstApp.files} files`} ` +
      `${worstApp === null ? "" : `(${worstApp.key}) `}` +
      `(baseline ${budget.serverTrace.appManifest.largestManifestFiles}, ` +
      `ceiling ${budget.serverTrace.appManifest.ceiling}) ` +
      `— a FILE COUNT, not bytes, and not the reader's JavaScript. This is the number R23 blew up.`,
  );
  lines.push(
    `budget 1b · framework runtime trace, ${mode} mode: ` +
      `${worstFramework === null ? "NONE FOUND" : `${worstFramework.files} files`} ` +
      `${worstFramework === null ? "" : `(${worstFramework.key}) `}` +
      (frameworkBudget === null
        ? "— NO BASELINE COMMITTED FOR THIS MODE"
        : `(baseline ${frameworkBudget.largestManifestFiles}, ceiling ${frameworkBudget.ceiling})`) +
      " — Next's own server runtime, containing no file of ours",
  );
  if (client === null) {
    lines.push(
      "budget 2 · client cost for /: NOT MEASURED — no prerendered index.html with scripts. " +
        "Reported as unmeasured, and unmeasured REFUSES.",
    );
  } else {
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    lines.push(
      `budget 2 · client cost for /: ${kb(client.raw)} initial JS, ${kb(client.transfer)} gzip, ` +
        `across ${client.chunks} chunks ` +
        `(baseline ${kb(budget.client.initialJsBytes)} / ${kb(budget.client.transferBytes)}, ` +
        `ceiling ${kb(budget.client.initialJsCeiling)} / ${kb(budget.client.transferCeiling)})`,
    );
    // Exact bytes beside the KB figures, which misread easily as byte counts.
    lines.push(
      `           exact ceilings · raw ${budget.client.initialJsCeiling} · gzip ${budget.client.transferCeiling}`,
    );
    // Gzip is not split: compression is not additive.
    if (client.provenance.available) {
      const p = client.provenance;
      lines.push(
        `           of which MapLibre ${kb(p.mapLibrary)}, application ${kb(p.application)}, ` +
          `unattributed ${kb(p.unmapped)} · BY MODULE PROVENANCE ` +
          `(${p.chunksWithMaps}/${p.chunksTotal} chunks mapped)` +
          (client.missing > 0 ? ` · ${client.missing} referenced chunk(s) MISSING from disk` : ""),
      );
      lines.push(
        `           exact bytes · maplibre raw ${p.mapLibrary} · application raw ${p.application} · ` +
          `unattributed raw ${p.unmapped} · gzip is NOT split (compression is not additive)`,
      );
    } else {
      lines.push(
        `           of which MapLibre ~${kb(client.mapRaw)}, application ~${kb(client.raw - client.mapRaw)} ` +
          `· ESTIMATE ONLY, NOT MEASUREMENT — whole chunks are attributed by a substring test, ` +
          `so this moves when chunks are reshuffled and it must not be compared across a ` +
          `chunking change. ${client.provenance.why}.` +
          (client.missing > 0 ? ` · ${client.missing} referenced chunk(s) MISSING from disk` : ""),
      );
    }
    lines.push(`           exact bytes · raw ${client.raw} · gzip ${client.transfer}`);
  }

  if (worstApp === null) {
    failures.push(
      "no app route trace manifest was found under .next/server/app — budget 1a measured\n" +
        "  nothing. Reported as a failure rather than as a pass: an unmeasured budget is the\n" +
        "  state this check exists to end.",
    );
  } else if (worstApp.files > budget.serverTrace.appManifest.ceiling) {
    failures.push(
      `app trace cardinality ${worstApp.files} files (${worstApp.key}) exceeds the committed\n` +
        `  ceiling of ${budget.serverTrace.appManifest.ceiling} ` +
        `(baseline ${budget.serverTrace.appManifest.largestManifestFiles}).\n` +
        "  Something is being traced into a route bundle that was not before — this is\n" +
        "  the shape R23 had, where a runtime-computed path made Turbopack trace the whole\n" +
        "  project. Diff this build's trace manifests against a clean build's to see WHICH\n" +
        "  files joined; fix the read at the source with the\n" +
        "  static-map pattern in lib/sources/ballot-curated/index.ts, or re-measure and\n" +
        "  re-commit the BASELINE in scripts/bundle-budget.json with the file list as its\n" +
        "  reason — the ceiling is then re-derived from it by the HEADROOM rule, never\n" +
        "  raised on its own.",
    );
  }
  if (frameworkBudget === null) {
    failures.push(
      `no framework-runtime baseline is committed for ${mode} mode, so budget 1b compared\n` +
        "  nothing. Add one to scripts/bundle-budget.json from a measured build. A budget with\n" +
        "  no baseline for the mode that deploys is exactly how a correct refusal became\n" +
        "  unactionable on 2026-08-18.",
    );
  } else if (worstFramework !== null && worstFramework.files > frameworkBudget.ceiling) {
    failures.push(
      `framework runtime trace ${worstFramework.files} files (${worstFramework.key}, ${mode} mode)\n` +
        `  exceeds the committed ceiling of ${frameworkBudget.ceiling} ` +
        `(baseline ${frameworkBudget.largestManifestFiles}).\n` +
        "  This trace holds no file of ours, so the cause is almost certainly a Next upgrade\n" +
        "  or a build-mode change rather than anything in this repo. Confirm that from the\n" +
        "  trace manifests before touching the number, then re-measure the baseline\n" +
        "  for THIS MODE with what joined recorded as its reason.",
    );
  }
  if (client === null) {
    failures.push(
      "budget 2 measured nothing: `.next/server/app/index.html` is absent, or it references\n" +
        "  no scripts. The reader's initial JavaScript for / is the one figure here that is\n" +
        "  about what a reader downloads, and an unmeasured budget refuses rather than passes —\n" +
        "  a missing file read as 0 bytes is a budget that looks its best when it has stopped\n" +
        "  working. If / genuinely stopped being prerendered, that is a finding about the app,\n" +
        "  not a reason to soften this.",
    );
  } else {
    if (client.raw > budget.client.initialJsCeiling) {
      failures.push(
        `initial JS for / is ${client.raw} bytes, over the committed ceiling of ` +
          `${budget.client.initialJsCeiling} (baseline ${budget.client.initialJsBytes}).\n` +
          "  Re-measure and re-commit the baseline with what joined recorded as its reason;\n" +
          "  the ceiling follows from it by the HEADROOM rule and is never raised on its own.",
      );
    }
    if (client.transfer > budget.client.transferCeiling) {
      failures.push(
        `compressed transfer for / is ${client.transfer} bytes, over the committed ceiling of ` +
          `${budget.client.transferCeiling} (baseline ${budget.client.transferBytes}).\n` +
          "  This is the figure closest to what a reader actually waits for. Same rule: the\n" +
          "  baseline moves on a measurement, the ceiling follows from the baseline.",
      );
    }
    if (client.missing > 0) {
      failures.push(
        `${client.missing} chunk(s) referenced by the prerendered / are absent from .next — ` +
          "the measurement is incomplete and the page would 404 them.",
      );
    }
  }

  return {
    lines,
    failures,
    measurements: { mode, worstApp, worstFramework, client, tracedRepoFiles: traced.size },
  };
}

/** Read the committed budget. Separate from `evaluate` so a test can pass its own. */
export function committedBudget(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "scripts", "bundle-budget.json"), "utf8"));
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsScript) {
  const { lines, failures } = evaluate({ root: ROOT, budget: committedBudget(ROOT) });
  for (const l of lines) console.log(l);
  if (failures.length > 0) {
    console.error("\nbuild-output · REFUSED\n");
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
  }
}
