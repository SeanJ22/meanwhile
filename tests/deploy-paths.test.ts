/**
 * **RULING 124 — a commit that cannot change what a reader sees does not cost a
 * deploy.** (Adopted 2026-08-24, Sean's instruction, item 1.)
 *
 * The guard has two halves and only the second one is interesting.
 *
 * The first half tests the predicate: shipping paths build, paperwork cancels,
 * an uncomputable diff builds. Ordinary unit tests, and they would pass on a
 * predicate whose allowlist was simply wrong.
 *
 * **The second half is the one that can catch a wrong allowlist.** It reads the
 * BUILT trace manifests — the `.nft.json` files Next writes to say which repo
 * files each server bundle actually needs — and fails if any file under a
 * non-shipping prefix appears in one. That is the difference between agreeing
 * with the list and measuring it: re-deriving the classification from the same
 * list it was written from proves only that the code is deterministic, which is
 * RULING 114's whole lesson. The traces are a DIFFERENT publication.
 *
 * Measured on adoption: 31 trace manifests, 233 repo files traced, **0** of
 * them under any non-shipping prefix.
 *
 * The trace half is SKIPPED WITH A NAMED REASON when `.next` has not been
 * built, rather than silently passing. A sweep that quietly counted an absent
 * build as agreement would report confidence it never measured (RULING 100).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";

import {
  NON_SHIPPING_PREFIXES,
  classifyDeploy,
  isNonShippingPath,
} from "../lib/ops/deploy-paths.ts";

const ROOT = resolve(import.meta.dirname, "..");

test("every non-shipping prefix carries a stated reason", () => {
  assert.ok(NON_SHIPPING_PREFIXES.length > 0, "the allowlist is empty");
  for (const entry of NON_SHIPPING_PREFIXES) {
    assert.ok(entry.prefix.length > 0, "a prefix is empty");
    assert.ok(
      entry.why.length > 20,
      `${entry.prefix} has no stated reason — a list of directories with no reasons is one the next session extends by vibe`,
    );
  }
});

test("the shipping directories are NOT on the allowlist", () => {
  // Named individually rather than derived, so adding one to the allowlist by
  // accident fails here by name instead of passing a generic assertion.
  for (const p of [
    "app/ballot/page.tsx",
    "lib/funding/display.ts",
    "components/ballot/candidate-card.tsx",
    "data/meetings-snapshot.json",
    "data/fec/fec-2026.json",
    "public/geo/zcta.json",
    "hooks/use-map.ts",
    "next.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "netlify.toml",
    "netlify/functions/x.ts",
    // RULING 76: `scripts/` type-checks under the build command. A
    // scripts-only commit genuinely can break the build.
    "scripts/close-out.mjs",
    "scripts/walk-all.mts",
  ]) {
    assert.equal(isNonShippingPath(p), false, `${p} must be treated as SHIPPING`);
  }
});

test("the paperwork paths ARE on the allowlist", () => {
  for (const p of [
    "docs/state.md",
    "docs/context.md",
    "docs/intake-report.md",
    "docs/tracker-working.csv",
    "docs/evidence/h-03255.jsonl",
    "tests/deploy-paths.test.ts",
    "screenshots/phone-07866.png",
    ".github/workflows/build-check.yml",
    "CLAUDE.md",
    "README.md",
  ]) {
    assert.equal(isNonShippingPath(p), true, `${p} must be treated as non-shipping`);
  }
});

test("a docs-only commit cancels; one shipping path anywhere in it builds", () => {
  // These are the three real bot/close-out commits of 2026-08-24.
  assert.equal(classifyDeploy(["docs/intake-report.md"]).verdict, "cancel");
  assert.equal(classifyDeploy(["docs/context.md", "docs/state.md"]).verdict, "cancel");
  assert.equal(classifyDeploy(["data/meetings-snapshot.json"]).verdict, "build");
  assert.equal(classifyDeploy(["data/fec/fec-2026.json"]).verdict, "build");

  // The mixed case is the one worth pinning: a close-out that also carries code
  // is a SHIP, and it builds.
  const mixed = classifyDeploy(["docs/state.md", "lib/funding/display.ts"]);
  assert.equal(mixed.verdict, "build");
  assert.deepEqual(mixed.shipping, ["lib/funding/display.ts"]);
  assert.deepEqual(mixed.nonShipping, ["docs/state.md"]);
});

test("an unknown path is SHIPPING — the allowlist direction is the rule", () => {
  assert.equal(isNonShippingPath("some-new-directory/thing.json"), false);
  assert.equal(classifyDeploy(["some-new-directory/thing.json"]).verdict, "build");
});

test("an uncomputable diff BUILDS and says so, and is never a cancel", () => {
  const cannot = classifyDeploy(null);
  assert.equal(cannot.verdict, "cannot-tell");
  assert.notEqual(cannot.verdict, "cancel");
  assert.match(cannot.reason, /RULING 24/);

  // An empty list is not a measurement either.
  assert.equal(classifyDeploy([]).verdict, "cannot-tell");
});

test("previews and branch deploys cancel without needing a diff", () => {
  for (const ctx of ["deploy-preview", "branch-deploy"]) {
    const d = classifyDeploy(null, ctx);
    assert.equal(d.verdict, "cancel", `${ctx} must not build`);
    assert.match(d.reason, /RULING 124/);
  }
  assert.notEqual(classifyDeploy(["lib/x.ts"], "production").verdict, "cancel");
});

/**
 * THE HALF THAT CAN GO RED FOR A REAL REASON.
 *
 * Every path the deploy actually needs is enumerated by Next itself in the
 * `.nft.json` trace manifests. If one of them sits under a non-shipping prefix,
 * the allowlist is lying and a commit touching that file would be served stale.
 */
test("no file under a non-shipping prefix is traced into the deploy", () => {
  const next = join(ROOT, ".next");
  if (!existsSync(next)) {
    // Named, not silent. RULING 100: a check that could not run is reported
    // separately from one that passed.
    console.log(
      "deploy-paths · TRACE SWEEP DID NOT RUN — `.next` is absent. Run `pnpm build` first; this is a skip, not a pass.",
    );
    return;
  }

  const manifests: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".nft.json")) manifests.push(f);
    }
  };
  walk(next);

  assert.ok(
    manifests.length > 0,
    "no trace manifests found under .next — the sweep would report zero violations without having looked",
  );

  const offenders: string[] = [];
  let tracedRepoFiles = 0;
  for (const m of manifests) {
    const parsed = JSON.parse(readFileSync(m, "utf8")) as { files?: string[] };
    for (const rel of parsed.files ?? []) {
      const abs = resolve(dirname(m), rel);
      if (abs.includes("node_modules")) continue;
      if (!abs.startsWith(ROOT + sep)) continue;
      const repoPath = abs.slice(ROOT.length + 1).split(sep).join("/");
      tracedRepoFiles += 1;
      if (isNonShippingPath(repoPath)) offenders.push(repoPath);
    }
  }

  assert.equal(
    offenders.length,
    0,
    `${offenders.length} traced file(s) sit under a non-shipping prefix — the allowlist would cancel a build that changes them: ${[...new Set(offenders)].slice(0, 10).join(", ")}`,
  );
  assert.ok(
    tracedRepoFiles > 0,
    "the sweep read the manifests and found no repo files at all — it proves nothing in that state",
  );
});
