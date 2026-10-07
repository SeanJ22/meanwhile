/** No runtime-event → Git → hosted-cost hop. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { classifyDeploy } from "../lib/ops/deploy-paths.ts";

const ROOT = join(import.meta.dirname, "..");

test("PDC · the observer has no Git feedback hop", () => {
  const raw = readFileSync(join(ROOT, ".github", "workflows", "post-deploy-integrity.yml"), "utf8");
  const executable = raw.replace(/^\s*#.*$/gm, "");
  assert.match(executable, /^\s*contents:\s*read\s*$/m);
  assert.doesNotMatch(executable, /^\s*contents:\s*write\s*$/m);
  assert.doesNotMatch(executable, /push-main\.mjs|git\s+(?:add|commit|push)|status:ledger/);
});

test("PDC · Build Check has no runtime-path cost exception", () => {
  const build = readFileSync(join(ROOT, ".github", "workflows", "build-check.yml"), "utf8");
  assert.doesNotMatch(build, /ci-cost|OPS_ONLY|no-cheap|classifyCommitCost/);
  assert.match(readFileSync(join(ROOT, "scripts", "deploy-classify.mjs"), "utf8"), /observationScope/);
  assert.match(readFileSync(join(ROOT, "scripts", "deploy-observation-scope.mjs"), "utf8"), /classifyDeploy/);
  assert.equal(classifyDeploy(["app/page.tsx"]).verdict, "build");
});

test("data-only and proof-only changes do not trigger application builds", () => {
  assert.equal(classifyDeploy(["docs/rulings.md"]).verdict, "cancel");
  assert.equal(classifyDeploy(["data/fec/fec-2026.json"]).verdict, "cancel");
  assert.equal(
    classifyDeploy(["data/campaign-finance/filing-regimes.json", "data/fec/fec-2026.json"]).verdict,
    "cancel",
  );
});

test("no workflow keeps a second path-classification table", () => {
  for (const workflow of [
    "build-check.yml",
    "post-deploy-integrity.yml",
  ]) {
    const text = readFileSync(join(ROOT, ".github", "workflows", workflow), "utf8");
    assert.equal(
      /^\s*paths-ignore:/m.test(text),
      false,
      `${workflow} has a paths-ignore filter — an unaudited trigger-side path table`,
    );
    assert.equal(
      /^\s*paths:/m.test(text),
      false,
      `${workflow} has a paths filter — an unaudited trigger-side path table`,
    );
  }
});
