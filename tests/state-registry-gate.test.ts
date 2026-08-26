/**
 * RULING 86, made enforceable — a hunt for a state with no source registry
 * fails loudly. (2026-08-26, Item 2's gate.)
 *
 * **The derived-case proof (RULING 157) is the point of the second half of this
 * file.** The gate was built against the three pilot states, all of which now
 * carry registries. Verifying only against those would prove that a gate which
 * always passes always passes. So a REGISTRY-LESS state is constructed, the
 * hunt is shown refusing it, and it is removed.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  MINIMUM_SOURCE_ROWS,
  checkStateRegistry,
  countSourceRows,
  requireStateRegistry,
} from "../lib/hunt/state-registry-gate.ts";

const ROOT = join(import.meta.dirname, "..");

test("the three pilot states are registered, and the gate says so with a count", () => {
  for (const state of ["nh", "az", "nj"]) {
    const check = checkStateRegistry(state, ROOT);
    assert.equal(check.verdict, "REGISTERED", `${state}: ${check.reason}`);
    assert.ok(
      check.sources >= MINIMUM_SOURCE_ROWS,
      `${state} holds ${check.sources} source row(s), which is below the floor`,
    );
  }
});

test("a state with NO folder is refused, and the refusal names what to create", () => {
  // Wyoming. Chosen because it is a real state this project has never touched,
  // so the assertion cannot quietly start passing for the wrong reason if
  // somebody adds a folder for a state we are working on.
  assert.ok(!existsSync(join(ROOT, "states", "wy")), "precondition: states/wy/ does not exist");
  const check = checkStateRegistry("wy", ROOT);
  assert.equal(check.verdict, "NO_FOLDER");
  assert.match(check.reason, /RULING 86/);
  assert.match(check.reason, /states\/wy\/sources\.md/);
});

test("a code that is not a state is refused rather than guessed at", () => {
  const check = checkStateRegistry("zz", ROOT);
  assert.equal(check.verdict, "NOT_A_STATE");
});

test("requireStateRegistry THROWS, so a caller that forgot to check still cannot hunt", () => {
  assert.throws(() => requireStateRegistry("wy", ROOT), /HUNT REFUSED/);
  assert.doesNotThrow(() => requireStateRegistry("nh", ROOT));
});

/* -------------------------------------------------------------------------- */
/* THE DERIVED-CASE PROOF (RULING 157)                                         */
/* -------------------------------------------------------------------------- */

test("DERIVED-CASE PROOF: a constructed registry-less state is refused, then removed", () => {
  // Vermont: a real state, not one this project has hunted, and NOT one of the
  // three the gate was built against.
  const dir = join(ROOT, "states", "vt");
  assert.ok(!existsSync(dir), "precondition: states/vt/ must not already exist");

  try {
    // 1. A folder with no registry at all.
    mkdirSync(dir, { recursive: true });
    let check = checkStateRegistry("vt", ROOT);
    assert.equal(check.verdict, "NO_REGISTRY", check.reason);
    assert.throws(() => requireStateRegistry("vt", ROOT), /HUNT REFUSED/);

    // 2. A registry that exists and says nothing — the case a `touch` creates,
    //    and the one that would make the gate a formality.
    writeFileSync(join(dir, "sources.md"), "# Vermont — the source registry\n\nTODO\n", "utf8");
    check = checkStateRegistry("vt", ROOT);
    assert.equal(check.verdict, "EMPTY_REGISTRY", check.reason);
    assert.equal(check.sources, 0);
    assert.throws(() => requireStateRegistry("vt", ROOT), /HUNT REFUSED/);

    // 3. A registry just under the floor is still refused — the floor is
    //    asserted BEFORE the count is reported (RULING 159).
    const row = (n: number) => `| **Source ${n}** | https://example.gov/${n} | PRIMARY | NONE STATED |`;
    writeFileSync(
      join(dir, "sources.md"),
      ["# Vermont", "", "| Name | URL | Class | Licence |", "|---|---|---|---|", ...Array.from({ length: MINIMUM_SOURCE_ROWS - 1 }, (_, i) => row(i))].join("\n"),
      "utf8",
    );
    check = checkStateRegistry("vt", ROOT);
    assert.equal(check.verdict, "EMPTY_REGISTRY");
    assert.equal(check.sources, MINIMUM_SOURCE_ROWS - 1);

    // 4. And it passes at the floor, so the gate is not simply always-refuse.
    writeFileSync(
      join(dir, "sources.md"),
      ["# Vermont", "", "| Name | URL | Class | Licence |", "|---|---|---|---|", ...Array.from({ length: MINIMUM_SOURCE_ROWS }, (_, i) => row(i))].join("\n"),
      "utf8",
    );
    check = checkStateRegistry("vt", ROOT);
    assert.equal(check.verdict, "REGISTERED", check.reason);
    assert.equal(check.sources, MINIMUM_SOURCE_ROWS);
  } finally {
    // Removed on every path, including a throw. A test that left states/vt/
    // behind would make the next run's precondition fail and would look like a
    // different defect entirely.
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(!existsSync(dir), "the constructed state is gone");
});

test("the row counter does not count headers or separators as sources", () => {
  const text = ["| Name | URL |", "|---|---|", "| **A thing** | https://a.gov |"].join("\n");
  assert.equal(countSourceRows(text), 1, "one real row among a header and a separator");
});
