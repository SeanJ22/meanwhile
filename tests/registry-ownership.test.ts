import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PROMOTED_BODIES_FILE,
  REGISTRY_FILE,
  isPromotedOrigin,
  loadPromotedBodies,
  validatePromotedBodies,
} from "../lib/registry/promoted-bodies.ts";
import { GENERATED } from "../lib/ops/generated-register.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import type { Body, Registry } from "../lib/registry/types.ts";

/**
 * **NH232 — one generated artifact, one writer.**
 * (2026-08-27. Opened by the 85641 detective session, repaired here.)
 *
 * ## The defect these guards exist over
 *
 * `lib/registry/registry.json` had FOUR writers. `scripts/build-registry.ts`
 * regenerates it whole; `scripts/adjudicate-leads.mts` and
 * `scripts/census-gap-walk.mts` appended promoted bodies to it in place; and
 * `scripts/normalize-census-placeholders.mts` rewrote labels inside it. So a
 * generated output was simultaneously three other scripts' canonical store, and
 * **the generator doing exactly what it says it does destroyed their data.**
 *
 * Measured on `main` at `9e75bea`: the committed registry held 2,000 bodies and
 * a no-source-change `pnpm registry:build` wrote 1,269 — silently dropping 731
 * rows, all of them the promoted population the governance snapshot reports as
 * the coverage numerator. **Nothing failed.** There was no test comparing body
 * counts across a build, and the diff read as a normal regeneration.
 *
 * The previous session avoided shipping the deletion by hand-merging its rows
 * into the committed registry. That was a safety maneuver to avoid destroying
 * valid data. It is recorded as one, and these tests are what make it
 * unnecessary — RULING 92 says a generated artifact is never hand-edited, and a
 * file that is both generated AND accumulated forces exactly that violation.
 *
 * ## What is proven here, and why each half is needed
 *
 * - **Completeness.** Every promoted input id appears in the generated
 *   registry. This is the direct 731-row regression.
 * - **Ownership.** No path but the generator writes the artifact. Without this,
 *   completeness can be restored today and re-broken by the next script that
 *   finds it convenient to append.
 * - **Idempotence.** A second rebuild against unchanged inputs is identical.
 *   Without this, the completeness diff is unreadable and a real deletion hides
 *   inside timestamp churn — which is precisely how 731 rows went unnoticed.
 *
 * The guards stand OUTSIDE the generator they police: nothing here imports
 * `scripts/build-registry.ts`, so a defect in the generator cannot also disable
 * its own check.
 */

const ROOT = process.cwd();

function readRegistry(): Registry {
  return JSON.parse(readFileSync(join(ROOT, REGISTRY_FILE), "utf8")) as Registry;
}

/**
 * Every file this commit would contain — tracked AND not-yet-staged.
 *
 * `git ls-files` alone is the wrong instrument and `tests/gate-ordering.test.ts`
 * enforces that: a sweep that asks only for TRACKED files cannot see a new
 * appender until somebody `git add`s it, so the author who just wrote one gets
 * a green run and CI gets a red one. `filesThatWouldBeCommitted` is the shared
 * path for this, and it also handles the 1 MB `execFileSync` buffer that would
 * otherwise turn a truncated listing into a false "no violations found".
 */
function repoFiles(): string[] {
  return filesThatWouldBeCommitted({ cwd: ROOT });
}

/* ------------------------------------------------------------ completeness */

test("NH232: every promoted input body reaches the generated registry", () => {
  const store = loadPromotedBodies();
  const registry = readRegistry();
  const inRegistry = new Set(registry.bodies.map((b) => b.id));

  const stranded = store.bodies.filter((b) => !inRegistry.has(b.id)).map((b) => b.id);
  assert.deepEqual(
    stranded,
    [],
    `${stranded.length} promoted body/bodies are in ${PROMOTED_BODIES_FILE} and NOT in the generated ` +
      `registry. This is the NH232 deletion. Run \`pnpm registry:build\`; if that does not fix it, the ` +
      `generator has stopped merging the promoted overlay.\n  ${stranded.slice(0, 20).join("\n  ")}`,
  );
});

test("NH232: every promoted row in the registry came from the input store", () => {
  const store = loadPromotedBodies();
  const registry = readRegistry();
  const inStore = new Set(store.bodies.map((b) => b.id));

  /*
   * The other direction, and it is the one that catches a NEW appender. A row
   * carrying a promoted origin that the input store does not hold got into the
   * generated file by some path that is not the generator — which is the whole
   * defect class, arriving again under a different script's name.
   */
  const orphans = registry.bodies
    .filter((b) => isPromotedOrigin(b.bodyOrigin))
    .filter((b) => !inStore.has(b.id))
    .map((b) => b.id);

  assert.deepEqual(
    orphans,
    [],
    `${orphans.length} promoted row(s) are in the generated registry with no entry in ` +
      `${PROMOTED_BODIES_FILE}. Something wrote the generated artifact directly. The next ` +
      `\`pnpm registry:build\` will delete them.\n  ${orphans.slice(0, 20).join("\n  ")}`,
  );
});

test("NH232: the full expected body set equals the generated body set", () => {
  /*
   * THE WHOLE SET, ASSEMBLED INDEPENDENTLY OF THE GENERATOR.
   *
   * The two tests above compare one class each. This one states the complete
   * expectation: the generated registry's bodies are exactly the derived rows
   * plus the curated overlay plus the promoted store, with nothing else and
   * nothing missing. The derived count is not re-derived here — re-implementing
   * `bodiesFor` in a test produces a second derivation that can agree with a
   * broken first one — so the derived rows are identified by origin, and the
   * two SOURCED classes are checked against their actual input files.
   */
  const registry = readRegistry();
  const store = loadPromotedBodies();
  const curated = registry.bodies.filter((b) => b.bodyOrigin === "CURATED");
  const derived = registry.bodies.filter((b) => b.bodyOrigin === "DERIVED_FROM_DIVISION_TYPE");
  const promoted = registry.bodies.filter((b) => isPromotedOrigin(b.bodyOrigin));

  assert.equal(
    derived.length + curated.length + promoted.length,
    registry.bodies.length,
    "the registry holds a body whose origin is none of derived, curated or promoted — a fourth " +
      "class exists and nothing owns it",
  );
  assert.equal(
    promoted.length,
    store.bodies.length,
    `the registry holds ${promoted.length} promoted bodies and the input store holds ` +
      `${store.bodies.length}. They must be the same set.`,
  );

  const ids = registry.bodies.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "the generated registry holds a duplicate body id");
});

/* ------------------------------------------------------------- input store */

test("NH232: the promoted input store is sound on its own terms", () => {
  const store = loadPromotedBodies();
  const problems = validatePromotedBodies(store.bodies);
  assert.deepEqual(problems, [], problems.join("\n  "));

  assert.ok(
    store.bodies.length > 0,
    "the promoted store is EMPTY. It held 731 bodies on 2026-08-27, and an empty store is how " +
      "the deletion this file guards against would look after the fact.",
  );
});

test("NH232: every promoted body is reconciled to a workstream promotion or a census gap walk", () => {
  /*
   * **The store does not get to prove itself.** A canonical input store that is
   * only checked against the artifact it feeds is one store validating itself —
   * both could be wrong together. So the descent promotions are reconciled
   * against `data/workstate/<state>.json`, which is written by a different
   * mechanism (`promoteCandidate`, which refuses to promote anything that did
   * not reach ENTITY_VERIFIED through a fetch) and is the canonical record of
   * what discovery actually promoted.
   *
   * Measured 2026-08-27: 674 distinct `BODY_PROMOTED` bodyIds across az/nh/nj,
   * and 674 `PROMOTED_FROM_DESCENT_CANDIDATE` rows. Exactly equal, both ways.
   */
  const store = loadPromotedBodies();
  const descent = store.bodies.filter((b) => b.bodyOrigin === "PROMOTED_FROM_DESCENT_CANDIDATE");

  const workstatePromoted = new Set<string>();
  for (const state of ["az", "nh", "nj"]) {
    const path = join(ROOT, "data", "workstate", `${state}.json`);
    const w = JSON.parse(readFileSync(path, "utf8")) as {
      candidates: { state: string; bodyId?: string }[];
    };
    for (const c of w.candidates) {
      if (c.state === "BODY_PROMOTED" && c.bodyId) workstatePromoted.add(c.bodyId);
    }
  }

  const notInWorkstate = descent.filter((b) => !workstatePromoted.has(b.id)).map((b) => b.id);
  assert.deepEqual(
    notInWorkstate,
    [],
    `${notInWorkstate.length} descent-promoted body/bodies have no BODY_PROMOTED candidate in ` +
      `canonical work state. A promoted body with no promotion is a row nobody can trace.\n  ` +
      notInWorkstate.slice(0, 20).join("\n  "),
  );

  const heldIds = new Set(descent.map((b) => b.id));
  const strandedPromotions = [...workstatePromoted].filter((id) => !heldIds.has(id));
  assert.deepEqual(
    strandedPromotions,
    [],
    `${strandedPromotions.length} workstream promotion(s) reached no body in the input store. ` +
      `These are verified bodies stranded from the product.\n  ` +
      strandedPromotions.slice(0, 20).join("\n  "),
  );
});

/* ---------------------------------------------------------------ownership */

test("NH232: exactly one path writes the generated registry", () => {
  /*
   * **The ownership rule, enforced mechanically rather than documented.**
   *
   * A path "writes" the registry when it names the file AND performs a write in
   * the same module. Naming it is fine and common — thirty-odd scripts READ it.
   * The pairing is what makes an appender.
   *
   * `git ls-files` and not a directory walk: an untracked file is invisible to
   * a repo sweep, and a new appender that has not been `git add`ed yet would
   * pass this guard while breaking the build for everyone else. Staging first
   * is the discipline; this comment is why.
   */
  const OWNER = "scripts/build-registry.ts";
  const WRITE = String.raw`(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|renameSync)`;
  /* `"registry.json"` reached through join(...) or as one path string. */
  const NAMES_REGISTRY = /["'`][^"'`]*registry\.json["'`]|["'`]registry["'`]\s*,\s*["'`]registry\.json["'`]/;

  const violations: string[] = [];
  for (const file of repoFiles()) {
    if (file === OWNER) continue;
    if (!/\.(ts|mts|mjs|js|tsx)$/.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    if (!/registry\.json/.test(text)) continue;

    /*
     * Comments are stripped before anything else. The sweeps in this repository
     * grep raw text, and a file that DOCUMENTS the defect — this one, and the
     * header of `lib/registry/promoted-bodies.ts` — quotes the line it removed.
     * A guard that reads its own explanation as the violation is a guard that
     * punishes writing the explanation down.
     */
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (!/registry\.json/.test(code)) continue;

    /*
     * **The TARGET of the write, not the presence of a write.**
     *
     * The first version of this guard flagged any module that named the
     * registry and called a write function anywhere in the file. That is
     * sixteen scripts, and every one of them was innocent: they READ the
     * registry — which thirty-odd scripts legitimately do — and write some
     * other artifact entirely. A guard with a 100% false-positive rate gets
     * loosened or deleted, and then the real defect walks back in.
     *
     * So the identifiers bound to a registry path are collected first, and a
     * write is a violation only when its FIRST ARGUMENT is one of those
     * identifiers or a registry path literal. `lib/registry/promoted-bodies.ts`
     * exports `REGISTRY_FILE` and calls `writeFileSync(path, ...)` on the input
     * store; that is the exact case this distinction has to get right.
     */
    const bound = new Set<string>();
    for (const m of code.matchAll(
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^;\n]*registry\.json[^;\n]*)/g,
    )) {
      /* Only when the initialiser is a PATH, not a parsed value read from one. */
      if (/\b(?:readFileSync|readFile|JSON\.parse|require|import)\b/.test(m[2])) continue;
      bound.add(m[1]);
    }

    const targets = [...bound].map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const patterns = [
      new RegExp(`\\b${WRITE}\\s*\\(\\s*(?:${NAMES_REGISTRY.source})`),
      ...targets.map((t) => new RegExp(`\\b${WRITE}\\s*\\(\\s*${t}\\s*[,)]`)),
    ];
    if (patterns.some((p) => p.test(code))) violations.push(file);
  }

  assert.deepEqual(
    violations,
    [],
    `${violations.length} path(s) other than ${OWNER} appear to write ${REGISTRY_FILE}.\n  ` +
      violations.join("\n  ") +
      `\n\nA generated artifact has one owner. Promoted bodies go to ${PROMOTED_BODIES_FILE} ` +
      `via appendPromotedBodies(); the generator merges them. See lib/registry/promoted-bodies.ts.`,
  );
});

test("NH232: the registry is registered as a generated artifact", () => {
  const entry = GENERATED.find((a) => a.path === REGISTRY_FILE);
  assert.ok(
    entry,
    `${REGISTRY_FILE} is not in the GENERATED register. It was generated for its whole life and ` +
      `unregistered for its whole life, and that is how three other scripts came to write it.`,
  );
  assert.match(entry.command, /registry:build/, "the registered command must be the generator");
});

test("NH232: the promoted store is an INPUT, and is not registered as generated", () => {
  assert.equal(
    GENERATED.find((a) => a.path === PROMOTED_BODIES_FILE),
    undefined,
    `${PROMOTED_BODIES_FILE} is a canonical INPUT. Registering it as generated would say some ` +
      `command reproduces it, and nothing does — its rows exist because sessions fetched pages.`,
  );
});

/* -------------------------------------------------- the deletion, replayed */

test("NH232 CONTROL: a generator that skips the promoted overlay is caught", () => {
  /*
   * **The original failure shape, reproduced and now caught.**
   *
   * On 2026-08-27 the generator produced exactly this: the derived rows plus
   * the curated overlay, and nothing else. 1,269 bodies where the repository
   * held 2,000. This control builds that same body set from the committed
   * registry and asserts that the completeness check refuses it — so if the
   * merge is ever removed from the generator again, the failure is a red test
   * with the count in its message rather than a quiet diff.
   *
   * It is a CONTROL, not a mock of the guard: the assertion below is the same
   * comparison the completeness test makes, run against the broken set instead
   * of the real one.
   */
  const registry = readRegistry();
  const store = loadPromotedBodies();

  const withoutPromotedOverlay: Body[] = registry.bodies.filter((b) => !isPromotedOrigin(b.bodyOrigin));
  const ids = new Set(withoutPromotedOverlay.map((b) => b.id));
  const stranded = store.bodies.filter((b) => !ids.has(b.id));

  assert.equal(
    stranded.length,
    store.bodies.length,
    "the replay must strand the entire promoted population — if it strands fewer, promoted rows " +
      "are reaching the registry by some path other than the overlay",
  );
  assert.ok(
    stranded.length >= 731,
    `the deletion shape stranded ${stranded.length} bodies; it was 731 when NH232 was opened, and ` +
      `the promoted population only grows`,
  );
  assert.equal(
    registry.bodies.length - withoutPromotedOverlay.length,
    store.bodies.length,
    "the registry's promoted population and the store must be the same size",
  );
});
