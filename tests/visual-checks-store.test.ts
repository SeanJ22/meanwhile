/**
 * **THE COMMITTED VISUAL ACCEPTANCE STORE, AND THE SWEEP ROWS THAT REST ON IT.**
 * (Part C, 2026-08-31.)
 *
 * On 2026-08-31 `data/health/visual-checks.json` DID NOT EXIST. The visual
 * suite's last recorded run said `checksLoaded: 0`, and thirteen rows of the
 * 8.30.26 owner sweep were recorded FIXED_VERIFIED against `vac:` ids that
 * named nothing on disk. `lib/feedback/sweep.ts` had already found that and
 * carried them as CHECK DEBT rather than counting them fixed.
 *
 * These tests are the standing floor under that repair. They read the
 * COMMITTED store and the COMMITTED sweep record and ask three things nothing
 * else asks:
 *
 *   1. Every check in the store is well formed by the OWNER's own validator,
 *      and by the harness's binding rules — a DOM-certifiable property with no
 *      assertion is a check that cannot fail, which is not a check.
 *   2. Every `vac:` id any sweep cites RESOLVES against the store. This is the
 *      class that let one defect be marked fixed three times.
 *   3. The store is not empty. A denominator of zero is an error (RULING 159),
 *      and `checksLoaded: 0` is what the whole class looked like from outside.
 *
 * They do NOT assert that the checks pass — only a run against a rendered
 * surface can say that, and it is `pnpm visual:suite`, whose record is
 * `data/health/visual-suite-runs/`.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assertionFits, type DomAssertion } from "../lib/health/dom-evaluation.ts";
import {
  requiredEvidenceKind,
  validateVisualAcceptanceCheck,
  type VisualAcceptanceCheck,
} from "../lib/health/visual-acceptance.ts";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "health", "visual-checks.json");
const SWEEPS = join(ROOT, "data", "feedback", "sweeps");

interface Binding {
  check: VisualAcceptanceCheck;
  selector: string;
  assertion?: DomAssertion;
  setup?: { kind: string; selector: string; text?: string; key?: string }[];
}

function store(): Binding[] {
  assert.ok(
    existsSync(STORE),
    `${STORE} does not exist. Every \`vac:\` id in every sweep resolves against this file, ` +
      "and without it the visual suite loads zero checks — which is the state that put " +
      "thirteen rows into check debt.",
  );
  const parsed: unknown = JSON.parse(readFileSync(STORE, "utf8"));
  assert.ok(Array.isArray(parsed), "the store is an array of check bindings");
  return parsed as Binding[];
}

test("the visual acceptance store is not empty", () => {
  const bindings = store();
  assert.ok(
    bindings.length > 0,
    "a store with no checks makes every run a measurement of nothing, and RULING 159 " +
      "makes a denominator of zero an error rather than a pass",
  );
});

test("every check in the store is valid by the owner's own validator", () => {
  for (const { check } of store()) {
    const problems = validateVisualAcceptanceCheck(check);
    assert.deepEqual(problems, [], `${check.id}: ${problems.join("; ")}`);
  }
});

test("check ids are unique — two checks sharing an id make one of them unreachable", () => {
  const ids = store().map((b) => b.check.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id(s) in ${ids.join(", ")}`);
});

test("every check id is namespaced `vac:`, which is how a sweep cites one", () => {
  for (const { check } of store()) {
    assert.ok(check.id.startsWith("vac:"), `${check.id} is not in the \`vac:\` namespace`);
  }
});

test("every check id is safe as a filename — a colon on Windows is not a filename", () => {
  /*
   * Measured on the first real run: `${check.id}-${today()}.png` wrote thirteen
   * NTFS ALTERNATE DATA STREAMS on one zero-byte file called `vac`, and the run
   * record cited thirteen capture paths that could not be opened. The harness
   * sanitises the name now; this asserts the sanitisation actually changes
   * something for every id in the store, so the two cannot drift apart.
   */
  for (const { check } of store()) {
    const sanitised = check.id.replace(/[^A-Za-z0-9._-]+/g, "-");
    assert.ok(sanitised.length > 0, `${check.id} sanitises to nothing`);
    assert.doesNotMatch(sanitised, /[:*?"<>|\\/]/, `${check.id} sanitises to an unsafe name`);
  }
});

test("a DOM-certifiable check carries an assertion, and it is one that can certify it", () => {
  for (const binding of store()) {
    const { check } = binding;
    if (requiredEvidenceKind(check.property) !== "DOM_EVALUATED") continue;
    assert.ok(
      binding.assertion,
      `${check.id} has property "${check.property}" and no assertion. A check that names a ` +
        "selector and states no claim about what it finds cannot fail.",
    );
    const misfit = assertionFits(check.property, binding.assertion);
    assert.equal(misfit, null, `${check.id}: ${misfit}`);
  }
});

test("an image-only check carries NO DOM assertion — two evidence paths is the shortcut", () => {
  for (const binding of store()) {
    if (requiredEvidenceKind(binding.check.property) === "DOM_EVALUATED") continue;
    assert.equal(
      binding.assertion,
      undefined,
      `${binding.check.id} requires IMAGE_EVALUATED evidence and also carries a DOM assertion`,
    );
  }
});

test("every binding names a selector and a surface path", () => {
  for (const binding of store()) {
    assert.ok(binding.selector && binding.selector.trim().length > 0, `${binding.check.id}`);
    assert.ok(
      binding.check.surface.startsWith("/"),
      `${binding.check.id}: surface is appended to the base URL, so it must be a path`,
    );
  }
});

test("every setup step names a kind the harness implements and a selector", () => {
  const KINDS = ["CLICK", "FILL", "PRESS", "WAIT_FOR"];
  for (const binding of store()) {
    for (const step of binding.setup ?? []) {
      assert.ok(KINDS.includes(step.kind), `${binding.check.id}: unknown setup kind ${step.kind}`);
      assert.ok(step.selector, `${binding.check.id}: a setup step with no selector`);
      if (step.kind === "FILL") assert.ok(step.text, `${binding.check.id}: FILL with no text`);
      if (step.kind === "PRESS") assert.ok(step.key, `${binding.check.id}: PRESS with no key`);
    }
  }
});

test("every `vac:` id cited by any committed sweep resolves to a check in the store", () => {
  const ids = new Set(store().map((b) => b.check.id));
  const cited: string[] = [];
  for (const name of existsSync(SWEEPS) ? readdirSync(SWEEPS) : []) {
    if (!name.endsWith(".json")) continue;
    const sweep = JSON.parse(readFileSync(join(SWEEPS, name), "utf8")) as {
      items?: { id: string; checkId?: string | null }[];
    };
    for (const item of sweep.items ?? []) {
      if (item.checkId?.startsWith("vac:")) cited.push(`${item.id} → ${item.checkId}`);
    }
  }
  const unresolved = cited.filter((c) => !ids.has(c.split(" → ")[1]));
  assert.deepEqual(
    unresolved,
    [],
    `${unresolved.length} sweep row(s) cite a visual acceptance check that is not in the ` +
      "store. A check that cannot be run is not a check — this is the gap that let one " +
      "defect be marked fixed three times.",
  );
  assert.ok(cited.length > 0, "no sweep cites a vac: id, so this test proved nothing");
});
