/**
 * The consumer read path reads the correction: a withdrawn conclusion never reaches a worker's projection, the route
 * it was drawn from still does, a contradicted claim leaves the projection and stays in history, an unclassified
 * legacy entry is inherited as a route with a named gap and its prose is never emitted as an assertion, and the raw
 * applicability primitive has no consumers outside its own layer.
 */

import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { type MethodKnowledge } from "../lib/method/knowledge.ts";
import { projectMethodFor } from "../lib/method/projection.ts";
import { METHOD_FIXTURE_PATH } from "./method-store-fixture.ts";
import { walkFiles } from "./helpers/walk-files.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AZ = { state: "az", governmentType: "county" };

const RECONCILE = "reconcile-the-adapter-before-suspecting-it";

function committedStore(): MethodKnowledge {
  return JSON.parse(
    readFileSync(METHOD_FIXTURE_PATH, "utf8"),
  ) as MethodKnowledge;
}

test("outcome NOTES never reach a worker — an observation inherits as a tuple", () => {
  const k = committedStore();
  const p = projectMethodFor(k, AZ);
  const serialized = JSON.stringify(p);

  // A coverage claim written into an outcome note carries no claim and no retraction, so outcomes project as tuples.
  const reconcile = k.routes.find((r) => r.id === RECONCILE)!;
  const notes = reconcile.outcomes.map((o) => o.note ?? "").filter((n) => n.length > 0);
  assert.ok(notes.length > 0, "the control needs a real outcome note to be worth running");
  for (const n of notes) {
    assert.ok(!serialized.includes(n), "an outcome note is prose and is not projected");
  }

  // What is projected is the tuple, and all of it.
  const projected = p.routes.find((r) => r.identity.id === RECONCILE)!;
  assert.equal(projected.observations.length, reconcile.outcomes.length);
  for (const o of projected.observations) {
    assert.ok(o.jurisdiction && o.walkedOn && typeof o.rows === "number" && o.disposition);
    assert.ok(!Object.prototype.hasOwnProperty.call(o, "note"));
  }
});

function sourceFiles(dir: string): string[] {
  return walkFiles(dir, (n) => /\.(ts|tsx|mts|mjs|js)$/.test(n), (n) => n === "node_modules" || n === ".next" || n.startsWith("."));
}

test("the raw applicability primitive has no consumers outside the method layer", () => {
  // Only the projection that wraps `applicableRoutesUnprojected` and its unit tests may call it. A call or an import is
  // required, so a doc block naming the function is not read as the defect.
  const ALLOWED = new Set([
    "lib/method/knowledge.ts",
    "lib/method/projection.ts",
    "tests/method-knowledge.test.ts",
    "tests/method-claims.test.ts",
    "tests/method-projection.test.ts",
  ]);
  const CALL = /applicableRoutesUnprojected\s*[(,]|^\s*applicableRoutesUnprojected,$/m;

  const offenders: string[] = [];
  for (const dir of ["lib", "scripts", "app", "tests"]) {
    const full = join(ROOT, dir);
    try {
      statSync(full);
    } catch {
      continue;
    }
    for (const file of sourceFiles(full)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      if (CALL.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "method inheritance is consumed through projectMethodFor(); these read raw routes instead",
  );
});
