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
import { ROSTER_FILES } from "../lib/coverage/artifacts.ts";
import { projectStateHoldings, rosterPath } from "../lib/holdings/files.ts";
import { BODY_TERRITORY_FILE } from "../lib/registry/body-territory.ts";

import {
  NON_SHIPPING_PREFIXES,
  classifyDeploy,
  isNonShippingPath,
} from "../lib/ops/deploy-paths.ts";

const ROOT = resolve(import.meta.dirname, "..");

test("built registry routes contain their canonical geometry and roster inputs", (context) => {
  if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    context.skip("No completed production build; canonical holdings trace proof requires pnpm build.");
    return;
  }
  const resolver = "data/derived/resolver-geometry.json";
  const manifest = JSON.parse(readFileSync(join(ROOT, resolver), "utf8")) as { files: string[] };
  assert.ok(manifest.files.length >= 20, "resolver input denominator unexpectedly empty or partial");
  const expected = [resolver, ...manifest.files, BODY_TERRITORY_FILE, ...ROSTER_FILES.map(rosterPath)];
  const routes = [
    "api/address/resolve/route", "api/ballot/scope/route", "api/demand-signal/route",
    "api/meetings/route", "api/reactions/route", "api/representation/[...division]/route",
    "api/speak/route", "api/votes/route", "api/voting-sites/route", "api/ask/grounded/route",
    "ballot/page", "about-area/page",
  ];
  for (const route of routes) {
    const traceFile = join(ROOT, ".next", "server", "app", `${route}.js.nft.json`);
    assert.ok(existsSync(traceFile), `${route}: production trace is absent`);
    const trace = JSON.parse(readFileSync(traceFile, "utf8")) as { files: string[] };
    const traced = new Set(trace.files.map((file) => resolve(dirname(traceFile), file)));
    const missing = expected.filter((file) => !traced.has(resolve(ROOT, file)));
    assert.deepEqual(missing, [], `${route}: canonical holdings missing from production bundle`);
  }
});

test("a completed production build has current state serving projections", (context) => {
  if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    context.skip("No completed production build; serving projection proof requires pnpm build.");
    return;
  }
  const projection = projectStateHoldings(ROOT, true);
  assert.ok(projection.files > 0, "no canonical state geo/street inputs were examined");
  assert.deepEqual(projection.issues, [], "production serving copies differ from their canonical holdings");
});

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
    "data/states/az/geo/sldl-04.geojson",
    "data/states/nh/officials/officeholders-33.json",
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

/*
 * NH289, THE DEPLOY-FILTER HALF — MEASURED 2026-08-30 FROM NETLIFY'S OWN
 * DEPLOY LIST, and recorded here so the 'why does the observer commit deploy'
 * question is never re-litigated from guesses. Five observer-only children
 * (589676ae, 097fca30, 2be8e854, ed0c253d, 5169fa32) each BUILT; every
 * observer commit that arrived a few seconds later than those (e5d5a27c,
 * fb0c623b, and six more) shows Netlify's 'checking build content for
 * changes: Canceled' — the ignore script working. The discriminator is the
 * gap between the parent's publish and the child's enqueue: at ~15 seconds
 * or less, CACHED_COMMIT_REF still names the GRANDPARENT (the last-successful
 * -deploy pointer lags publish), so the diff spans the parent's shipping
 * changes and the filter builds — CORRECTLY, because cancelling there would
 * strand the shipping change if the parent's own build had failed. The waste
 * is the safe direction; the identity consequence is repaired in
 * lib/ops/production-integrity.ts (application-release equivalence), not by
 * making this filter guess.
 */
test('SEEDED (NH289): a shipping commit accumulated in the range BUILDS, even under a data-only head', () => {
  // The exact shape of the 07:38 deploy: cached = grandparent, head = the
  // observer commit, and the range carries BOTH the parent's app change and
  // the observer's record file. One shipping path anywhere decides it.
  const accumulated = classifyDeploy(['app/api/ask/grounded/route.ts', 'data/ops/production-integrity.json']);
  assert.equal(accumulated.verdict, 'build', 'cancelling would strand the accumulated shipping change');
  assert.deepEqual(accumulated.shipping, ['app/api/ask/grounded/route.ts']);
});

test('POSITIVE CONTROL (NH289): the observer commit alone cancels — the filter was never the defect', () => {
  const observerOnly = classifyDeploy(['data/ops/production-integrity.json']);
  assert.equal(observerOnly.verdict, 'cancel');
});
