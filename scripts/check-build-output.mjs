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
 *
 * ---------------------------------------------------------------------------
 * WHY THE BODY OF THIS FILE IS A FUNCTION (g17, 2026-08-18).
 *
 * Every refusal below used to exist only as a branch nobody had ever taken. A
 * budget that has never refused is not known to work — it is a green light
 * whose bulb has never been tested, and this repo has already shipped one of
 * those (the source-level synthetic-run guard that was green through two live
 * leaks). So the whole evaluation is `evaluate({ root, budget })`, a pure read
 * of a directory tree, and `tests/build-budget.test.ts` plants EVERY refusal
 * direction against a synthetic `.next` and proves it refuses — each one with
 * a green control built from the same fixture with the plant removed, so a
 * check that refuses everything is caught as fast as one that refuses nothing.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { attributeByProvenance } from "./attribute-client-bytes.mjs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * THE CEILING RULE, stated once and applied to every budget in the file
 * (g17, 2026-08-18, AUD-02 1b).
 *
 * A ceiling is AT MOST the measured baseline plus 15%, rounded DOWN to a
 * readable unit. Rounding down, always, so that rounding can never quietly buy
 * headroom the rule did not grant.
 *
 * It is a CAP on headroom, not a formula for it. A tighter ceiling is always
 * allowed and needs no reason. A looser one is not permitted at all: a ceiling
 * above the cap can only have come from moving a number to make a red check
 * green, which is the one thing the author's standing rule forbids —
 * ceilings move only on proof.
 *
 * When a baseline legitimately moves — a Next upgrade, a new state's boundary
 * files entering `outputFileTracingIncludes` — the BASELINE is re-measured and
 * re-committed with what joined recorded as its reason, and the ceiling is
 * re-derived from it by this same rule. The headroom is not where a real
 * change is absorbed; it is only there so an ordinary dependency bump does not
 * fail a build and teach people to raise ceilings.
 *
 * `tests/build-budget.test.ts` asserts every committed ceiling against this
 * constant, so the rule is enforced rather than merely described.
 */
export const HEADROOM = 0.15;

/** The largest ceiling the rule permits for a baseline, rounded down to `unit`. */
export function ceilingCap(baseline, unit) {
  return Math.floor((baseline * (1 + HEADROOM)) / unit) * unit;
}

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

/** `standalone/.next/server/app/x.nft.json` and `server/app/x.nft.json` are one manifest. */
function manifestKey(next, m) {
  return relative(next, m).replace(/\\/g, "/").replace(/^standalone\/\.next\//, "");
}

/**
 * The reader's initial JavaScript for `/`, read off the EMITTED HTML.
 *
 * The prerendered page names the scripts it loads, so this is what is served
 * rather than what a manifest planned to serve. Returns null when the page was
 * not prerendered — reported as UNMEASURED, and unmeasured is a refusal, not a
 * pass. A budget that reads a missing file as 0 bytes passes loudest exactly
 * when it has stopped working.
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
    // MapLibre identifies itself in its own source. Read from the buffer rather
    // than guessed from a filename: Turbopack's chunk names are content hashes
    // and carry no library name at all.
    if (/maplibre|mapbox-gl/i.test(bytes.toString("utf8"))) {
      mapRaw += bytes.length;
      mapTransfer += gz;
    }
  }
  // R53 (g18): the split by MODULE PROVENANCE, when the build emitted source
  // maps. It attributes WITHIN a chunk, so re-chunking cannot move it. The
  // substring figures above are kept and reported as the ESTIMATE they are.
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
 * Read a build output and say what is wrong with it.
 *
 * Pure with respect to everything except the filesystem under `root`: no
 * process exit, no environment read, nothing printed. `lines` is what a run
 * prints on the way past; `failures` is what refuses the build.
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

  /* -- two budgets, not one number (AUD-02) -------------------------------- */

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

  /*
   * BUDGET 1 IS TWO NUMBERS, AND IT IS MEASURED IN THE MODE THAT DEPLOYS
   * (R51 remainder, 2026-08-18, g16).
   *
   * The first form of this budget took `Math.max` over every manifest and
   * compared it to one ceiling. That maximum is always `next-server.js` — the
   * FRAMEWORK's own server runtime trace, which contains zero files of ours —
   * so the number the budget refused on was a number this repo does not write.
   * Two consequences, and both bit:
   *
   * 1. IT REFUSED A DEPLOY FOR A REASON UNRELATED TO WHAT IT GUARDS. Netlify's
   *    Next runtime plugin builds in STANDALONE mode, which makes Next trace its
   *    own server runtime for a self-contained deployment. Measured here rather
   *    than argued: default mode 927 files, standalone 1130, and the 203 that
   *    joined are ALL under `node_modules/next/dist` — with zero repo files and
   *    every app route manifest byte-identical across the two modes. On Linux the
   *    same build is +8 (`@img/sharp-linux*` in place of `sharp-win32`), which is
   *    the 1138 Netlify refused. The baseline of 927 had been measured on Windows
   *    in a mode Netlify never builds in: the budget had never once run under the
   *    conditions it gates.
   * 2. IT COULD PASS WHILE WRONG, WHICH IS WORSE. R23's defect lived in APP
   *    manifests — two of them went to 2554 and 2567 files. Under one maximum,
   *    an app route could grow from 195 files to 900 and still sit far below a
   *    ceiling pinned to the framework's 927. The guard would have been green
   *    for the very shape it exists to catch.
   *
   * Standalone mode duplicates every manifest under `standalone/.next/`. Those
   * copies are folded onto their originals rather than counted twice — a budget
   * that doubles its own population when the deploy mode changes is measuring
   * the mode, not the build.
   */

  /**
   * The build mode, read off the output rather than off the environment.
   *
   * `NEXT_PRIVATE_STANDALONE` is set by Netlify's plugin in ITS process, and this
   * script is a child of the build command; asking the artifact what it is
   * survives that and any other way the mode gets set.
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
    /*
     * THE CEILINGS IN EXACT BYTES, and this line exists because the KB one
     * above misled a session (g20 correction 9.2, 2026-08-19).
     *
     * g19's report stated the client ceilings as "3,027,315 / 940,032",
     * which reads as ceilings that had been moved off the committed
     * 3,100,000 / 940,000 — and the raw figure looked precisely like
     * measured-plus-300,000, which is not the ceiling rule and would have
     * been a real violation of the author's standing order.
     *
     * Nothing had moved. `scripts/bundle-budget.json` has not been touched
     * since g18. 3,100,000 / 1024 prints as "3027.3 KB" and 940,000 / 1024
     * prints as "918.0 KB", and both were read back out of the display as
     * byte figures — one multiplied by 1000, one by 1024.
     *
     * A whole session-brief correction came out of a rounded display, so the
     * exact numbers are now printed beside it. The measurement already
     * printed its own exact bytes on the next line; the CEILINGS did not,
     * which is the asymmetry that made the trap.
     */
    lines.push(
      `           exact ceilings · raw ${budget.client.initialJsCeiling} · gzip ${budget.client.transferCeiling}`,
    );
    /*
     * R53 (g18): the split, by MODULE PROVENANCE where the build emitted
     * source maps and LABELLED AS AN ESTIMATE where it did not.
     *
     * The substring form attributes a WHOLE chunk to MapLibre if the chunk
     * mentions it, so it moves when chunks are reshuffled and it moved by
     * this session own application-only change. It is not deleted - the
     * auditor asked for the two tracked apart and deleting the split would
     * discard the requirement - it is named for what it is.
     *
     * Gzip is deliberately NOT split either way. Compression is not additive,
     * so a per-module gzip figure is arithmetic on a number with no per-module
     * meaning.
     */
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
        "  project. Run `node scripts/trace-census.mjs --files after.txt` and diff it against\n" +
        "  a clean build's to see WHICH files joined; fix the read at the source with the\n" +
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
        "  or a build-mode change rather than anything in this repo. Confirm that with\n" +
        "  scripts/trace-census.mjs before touching the number, then re-measure the baseline\n" +
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
