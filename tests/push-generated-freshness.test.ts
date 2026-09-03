/**
 * THE PUSH-DOOR GENERATED-ARTIFACT STALENESS GUARD. (2026-09-03, Daily Refresh
 * reliability mechanism.)
 *
 * Permanent regression control: a bot must not be able to advance `main` to a
 * revision whose registered PURE generators are stale. Planted here so a future
 * change that lets a stale dependent through the push door goes red.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { GeneratedArtifact } from "../lib/ops/generated-register.ts";
import {
  checkGeneratedFreshness,
  guardGeneratedFreshness,
  regenerateStaleDependents,
  verifiableCheckCommands,
  type CheckRunner,
} from "../lib/ops/generated-freshness.ts";
import { GENERATED } from "../lib/ops/generated-register.ts";

const SAMPLE: GeneratedArtifact[] = [
  { path: "docs/states/nj.md", command: "corepack pnpm state-manifest", checkCommand: "corepack pnpm state-manifest --check", pure: true },
  { path: "docs/states/az.md", command: "corepack pnpm state-manifest", checkCommand: "corepack pnpm state-manifest --check", pure: true },
  { path: "data/questionnaire/invitations-nj-morris-2026.json", command: "corepack pnpm questionnaire:invitations --write", checkCommand: "corepack pnpm questionnaire:invitations --check", pure: true },
  // No checkCommand: cannot be verified read-only, so it is not run here.
  { path: "docs/branch-manifest.md", command: "corepack pnpm manifest:doc", pure: true },
  // Impure: reads the network/clock, never re-run at the push door.
  { path: "data/fec/fec-2026.json", command: "corepack pnpm fec:fetch", pure: false, impurity: "reads the FEC API" },
];

test("verifiableCheckCommands dedupes by command — one state-manifest check covers many docs", () => {
  const cmds = verifiableCheckCommands(SAMPLE);
  // state-manifest (2 docs, 1 command) + questionnaire (1) = 2 commands.
  assert.equal(cmds.length, 2);
  const sm = cmds.find((c) => c.command.includes("state-manifest"))!;
  assert.deepEqual(sm.paths.sort(), ["docs/states/az.md", "docs/states/nj.md"]);
  // The no-checkCommand and impure generators are not verifiable here.
  assert.ok(!cmds.some((c) => c.command.includes("manifest:doc")));
  assert.ok(!cmds.some((c) => c.command.includes("fec:fetch")));
});

test("all checks green → the guard is fresh", () => {
  const runCheck: CheckRunner = () => ({ ok: true, output: "CURRENT" });
  const report = checkGeneratedFreshness({ generated: SAMPLE, runCheck });
  assert.equal(report.checked, 2);
  assert.equal(report.stale.length, 0);
});

test("a planted stale generator → the guard refuses and names it", () => {
  // state-manifest reports stale; questionnaire is fine.
  const runCheck: CheckRunner = (command) =>
    command.includes("state-manifest")
      ? { ok: false, output: "state-manifest: STALE docs/states/nj.md\nSTALE docs/states/az.md" }
      : { ok: true, output: "CURRENT" };
  const lines: string[] = [];
  const decision = guardGeneratedFreshness({ runCheck, log: (l) => lines.push(l) });
  assert.equal(decision.verdict, "stale");
  assert.equal(decision.report.stale.length, 0 + 1);
  // The refusal names the stale check command.
  assert.ok(lines.join("\n").includes("state-manifest --check"));
});

test("the guard runs over the REAL register too, not just the sample", () => {
  // With everything green the real register is fresh; this proves the guard is
  // wired to the actual GENERATED list and finds its verifiable commands.
  const cmds = verifiableCheckCommands(GENERATED);
  assert.ok(cmds.length >= 2, "the real register should have at least state-manifest and questionnaire checks");
  assert.ok(cmds.some((c) => c.command.includes("state-manifest --check")));
  assert.ok(cmds.some((c) => c.command.includes("questionnaire:invitations --check")));
  const report = checkGeneratedFreshness({ runCheck: () => ({ ok: true, output: "ok" }) });
  assert.equal(report.stale.length, 0);
});

test("a single stale artifact is enough to refuse — one red invariant stops the push", () => {
  const runCheck: CheckRunner = (command) =>
    command.includes("questionnaire") ? { ok: false, output: "STALE data/questionnaire/invitations-nj-morris-2026.json" } : { ok: true, output: "ok" };
  const decision = guardGeneratedFreshness({ runCheck, log: () => {} });
  assert.equal(decision.verdict, "stale");
});

test("owner deliverable 1: a stale generator input causes its dependent to REGENERATE before commit", () => {
  // Model the world: state-manifest is stale (its input moved). After the
  // generator command runs, it is current. The regenerator must run exactly the
  // generator whose checkCommand reported stale, and report the paths it fixed.
  let stateManifestFresh = false;
  const runCheck: CheckRunner = (command) =>
    command.includes("state-manifest") && !stateManifestFresh
      ? { ok: false, output: "state-manifest: STALE docs/states/nj.md" }
      : { ok: true, output: "CURRENT" };
  const ran: string[] = [];
  const runGen = (command: string) => {
    ran.push(command);
    if (command.includes("state-manifest")) stateManifestFresh = true; // regeneration makes it current
    return { ok: true, output: "wrote" };
  };
  const result = regenerateStaleDependents({ generated: SAMPLE, runCheck, runGen, log: () => {} });
  // It regenerated via the state-manifest generator command (not the check command).
  assert.deepEqual(ran, ["corepack pnpm state-manifest"]);
  assert.ok(result.regenerated.includes("docs/states/nj.md"));
  assert.equal(result.failed.length, 0);
  // And now the guard is fresh — the dependent would commit current.
  const after = checkGeneratedFreshness({ generated: SAMPLE, runCheck });
  assert.equal(after.stale.length, 0);
});

test("a dependent that FAILS to regenerate is reported, never silently passed", () => {
  const runCheck: CheckRunner = (command) =>
    command.includes("state-manifest") ? { ok: false, output: "STALE docs/states/nj.md" } : { ok: true, output: "ok" };
  const runGen = () => ({ ok: false, output: "generator crashed" });
  const result = regenerateStaleDependents({ generated: SAMPLE, runCheck, runGen, log: () => {} });
  assert.equal(result.regenerated.length, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].command, /state-manifest/);
});
