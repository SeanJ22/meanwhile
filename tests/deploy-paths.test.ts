/**
 * A commit that cannot change what a reader sees does not cost a deploy.
 *
 * The predicate tests alone would pass on a wrong allowlist. The trace sweep reads the built `.nft.json` manifests
 * Next writes for each server bundle and fails if any traced file sits under a non-shipping prefix. It is skipped
 * with a named reason when `.next` has not been built, rather than silently passing.
 */
import test from "./helpers/playbooks.ts";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { BODY_TERRITORY_FILE } from "../lib/registry/body-territory.ts";

import {
  NON_SHIPPING_PREFIXES,
  classifyDeploy,
  isNonShippingPath,
} from "../lib/ops/deploy-paths.ts";

const ROOT = resolve(import.meta.dirname, "..");

test("built reader routes keep the body-territory manifest and exclude replaced ZIP shards", (context) => {
  if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    context.skip("No completed production build; canonical holdings trace proof requires pnpm build.");
    return;
  }
  const stateGeometryFile = "data/derived/state-geometry.json";
  const stateGeometry = JSON.parse(readFileSync(join(ROOT, stateGeometryFile), "utf8")) as { files: Record<string, { sha256: string }> };
  assert.match(stateGeometry.files[BODY_TERRITORY_FILE]?.sha256 ?? "", /^[a-f0-9]{64}$/,
    "the special-district territory remains available through the reader edge manifest");
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
    assert.ok(traced.has(resolve(ROOT,stateGeometryFile)),`${route}: body-territory manifest missing from production bundle`);
    assert.deepEqual([...traced].filter(file=>file.startsWith(resolve(ROOT,"data/derived/zip-divisions")+sep)),[],`${route}: replaced ZIP shards remain in the production bundle`);
  }
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
    "public/geo/zcta.json",
    "hooks/use-map.ts",
    "next.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "netlify.toml",
    "netlify/functions/x.ts",
    // `scripts/` type-checks under the build command, so a scripts-only commit can break the build.
    "scripts/walk-all.mts",
  ]) {
    assert.equal(isNonShippingPath(p), false, `${p} must be treated as SHIPPING`);
  }
});

test("the paperwork paths ARE on the allowlist", () => {
  for (const p of [
    "docs/DESIGN.md",
    "docs/look-standard.md",
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
  assert.equal(classifyDeploy(["docs/DESIGN.md"]).verdict, "cancel");
  assert.equal(classifyDeploy(["docs/DESIGN.md", "docs/look-standard.md"]).verdict, "cancel");
  assert.equal(classifyDeploy(["data/fec/fec-2026.json"]).verdict, "build");

  // A commit that carries any code builds.
  const mixed = classifyDeploy(["docs/DESIGN.md", "lib/funding/display.ts"]);
  assert.equal(mixed.verdict, "build");
  assert.deepEqual(mixed.shipping, ["lib/funding/display.ts"]);
  assert.deepEqual(mixed.nonShipping, ["docs/DESIGN.md"]);
});

test("an unknown path is SHIPPING — the allowlist direction is the rule", () => {
  assert.equal(isNonShippingPath("some-new-directory/thing.json"), false);
  assert.equal(classifyDeploy(["some-new-directory/thing.json"]).verdict, "build");
});

test("packaged geography and executable source code trigger shipping", () => {
  for (const path of [BODY_TERRITORY_FILE, "data/derived/resolver-geometry.json", "data/derived/zip-divisions/az.json", "scripts/fetch-census.mts", "lib/holdings/census.ts"]) {
    assert.equal(classifyDeploy([path]).verdict, "build", path);
  }
});

test("an uncomputable diff BUILDS and says so, and is never a cancel", () => {
  const cannot = classifyDeploy(null);
  assert.equal(cannot.verdict, "cannot-tell");
  assert.notEqual(cannot.verdict, "cancel");
  assert.match(cannot.reason, /could not be computed/);

  // An empty list is not a measurement either.
  assert.equal(classifyDeploy([]).verdict, "cannot-tell");
});

test("previews and branch deploys cancel without needing a diff", () => {
  for (const ctx of ["deploy-preview", "branch-deploy"]) {
    const d = classifyDeploy(null, ctx);
    assert.equal(d.verdict, "cancel", `${ctx} must not build`);
    assert.match(d.reason, /only production builds/);
  }
  assert.notEqual(classifyDeploy(["lib/x.ts"], "production").verdict, "cancel");
});

/** If any traced file sits under a non-shipping prefix, the allowlist is wrong and a commit touching it would be served stale. */
test("no file under a non-shipping prefix is traced into the deploy", () => {
  const next = join(ROOT, ".next");
  if (!existsSync(next)) {
    // Named, not silent: a check that could not run is reported separately from one that passed.
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

test("a shipping commit accumulated in the range builds, even under a data-only head", () => {
  // One shipping path anywhere in the range decides it; cancelling would strand the accumulated shipping change.
  const accumulated = classifyDeploy(["app/api/ask/grounded/route.ts", "data/fec/fec-2026.json"]);
  assert.equal(accumulated.verdict, "build", "cancelling would strand the accumulated shipping change");
  assert.deepEqual(accumulated.shipping, ["app/api/ask/grounded/route.ts", "data/fec/fec-2026.json"]);
});

test("positive control: historical operations evidence alone cancels", () => {
  const dataOnly = classifyDeploy(["data/ops/historical-receipt.json"]);
  assert.equal(dataOnly.verdict, "cancel");
});
