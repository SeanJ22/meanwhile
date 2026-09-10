/**
 * **THE REQUIRED CONTEXTS, AS DATA A BARE NODE CAN READ.**
 * (Split out of `required-checks.ts` on 2026-09-07.)
 *
 * ## Why this file exists, measured
 *
 * `lib/ops/required-checks.ts` imports `yaml`, because deriving what the
 * workflow ACTUALLY reports means parsing the workflow (RULING 147 — no
 * reconciliation may compare a parser to itself). That import is correct and
 * stays.
 *
 * But the LIST is data, and one of its readers runs before `pnpm install`.
 * Run 34160631768, the first main-side run of the tree-equivalence check,
 * printed:
 *
 * ```
 *   certified-tree · the predicate would not load (Cannot find package 'yaml'
 *   imported from lib/ops/required-checks.ts) — answering FULL
 * ```
 *
 * It failed in the safe direction and said exactly why, which is the design
 * working. It also meant the attestation could never fire, on any head, for as
 * long as that import stood — a feature that is permanently inert while
 * reporting itself correctly.
 *
 * The dependency-free deploy and tree adapters keep the same boundary: no
 * package import may hide behind a pre-install step.
 *
 * ## There is still exactly one list
 *
 * `required-checks.ts` re-exports this and every existing importer is
 * unchanged. Splitting the constant from the parser is not a second table: the
 * data has one home, and the module that needs a YAML parser is the one that
 * parses YAML.
 *
 * **This file may import nothing.** Not `node:` builtins, not a local module.
 * `tests/ci-preflight.test.ts` walks the import closure of every script that
 * runs before the install and fails on any package it reaches.
 */

/**
 * The contexts branch protection on `main` actually requires.
 *
 * READ BACK FROM THE GITHUB API on 2026-08-25 —
 * `repos/SeanJ22/meanwhile/branches/main/protection`, whose
 * `required_status_checks.contexts` returned exactly these three. It is a
 * transcription of a server fact, not a wish: if the branch is changed, this is
 * updated to match what the branch says, and
 * `contextsProducedByWorkflow` in `required-checks.ts` then tells you whether
 * the workflow still produces it.
 */
export const REQUIRED_CONTEXTS: readonly string[] = [
  "build (default)",
  "build (standalone)",
  "gates (test · lint · tsc)",
];
