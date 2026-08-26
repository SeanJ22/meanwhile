/**
 * THE LOCAL GATE SET COVERS THE GATE SET CI REQUIRES.
 * (RO04, 2026-08-25. RULING 155.)
 *
 * **This test exists because the hole was invisible from inside the repo.**
 *
 * `pnpm handoff --ship` and `pnpm closeout` each ran one command — `pnpm run
 * build` — and CI required seven across three jobs. Lint was in CI's set and
 * not the local one. Nothing compared the two, so a session could run every
 * gate it knew about, report all of them green truthfully, and merge onto a
 * red `main` twice.
 *
 * **The anchor is the WORKFLOW FILE, which is not ours to write** (RULING
 * 147 — no reconciliation may compare a parser to itself). The gate list in
 * `scripts/gates.mjs` is checked against the commands `.github/workflows/
 * build-check.yml` actually runs. Re-deriving the expected set from the gate
 * list would prove the file equals itself and would have agreed with the hole
 * on every run, for as long as the hole lived.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GATES } from "../scripts/gates.mjs";

const WORKFLOW = ".github/workflows/build-check.yml";

/**
 * Every `run:` command in the workflow, with the setup steps set aside.
 *
 * The exclusions are NAMED rather than pattern-matched away, so adding a real
 * gate cannot be silently absorbed by a loose filter. Each is scaffolding —
 * it prepares the runner or reports on the run; none of them is a check whose
 * failure means the tree is wrong.
 */
const NOT_A_GATE = [
  "corepack enable",
  "corepack pnpm install --frozen-lockfile",
  "corepack pnpm exec playwright install --with-deps chromium",
  "echo \"path=$(corepack pnpm store path --silent)\" >> \"$GITHUB_OUTPUT\"",
  "node scripts/trace-census.mjs --files trace-files.txt",
];

function ciCommands(): string[] {
  const src = readFileSync(WORKFLOW, "utf8");
  const found: string[] = [];
  /* `run:` steps, both the inline and the block form. */
  const re = /^\s*run:\s*(?:\|\s*\n((?:\s+.*\n)+)|(.+))$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const block = m[1];
    const inline = m[2];
    const lines = block
      ? block.split("\n").map((l) => l.trim()).filter(Boolean)
      : [inline.trim()];
    for (const line of lines) found.push(line);
  }
  return found.filter((c) => !NOT_A_GATE.includes(c));
}

/** `corepack pnpm run build` and `pnpm run build` are the same gate. */
function normalise(command: string): string {
  return command
    .replace(/^corepack\s+/, "")
    .replace(/\bpnpm run\b/, "pnpm")
    .trim();
}

test("gate parity · every command CI runs as a gate is in the local gate set", () => {
  const ci = ciCommands().map(normalise);
  const local = GATES.map((g) => normalise(g.command));

  const missing = ci.filter((c) => !local.includes(c));
  assert.deepEqual(
    missing,
    [],
    `these commands run in CI and NOT in \`pnpm gates\`:\n  ${missing.join("\n  ")}\n\n` +
      "A gate CI requires and the local door does not run is the RO04 hole: a\n" +
      "session can report every gate it ran as green while a required check fails.\n" +
      "Add it to GATES in scripts/gates.mjs — do not add it to NOT_A_GATE unless\n" +
      "it is genuinely setup, in which case say why in this file.",
  );
});

test("gate parity · the instrument actually reads the workflow", () => {
  /*
   * RULING 110 — a sweep that cannot find what it was written for is a sweep
   * reporting green about nothing. If the `run:` parser ever stops matching,
   * `ciCommands()` returns [] and the test above passes vacuously against any
   * gate list at all, including an empty one. So: the parse is asserted to
   * have found the specific commands this workflow is known to carry.
   */
  const ci = ciCommands().map(normalise);
  assert.ok(ci.length >= 5, `parsed only ${ci.length} commands from ${WORKFLOW} — the parser is broken`);
  for (const required of ["pnpm lint", "pnpm test", "pnpm exec tsc --noEmit", "pnpm build"]) {
    assert.ok(ci.includes(required), `\`${required}\` not parsed out of ${WORKFLOW}`);
  }
});

test("gate parity · lint is in the local gate set, by name", () => {
  /*
   * The instance, pinned. RO04 was two lint errors that CI caught and the
   * local door did not run at all. A refactor that reorganises GATES may not
   * quietly drop the one gate this whole apparatus was built around.
   */
  assert.ok(
    GATES.some((g) => normalise(g.command) === "pnpm lint"),
    "`pnpm lint` is not in GATES — this is the exact gap that produced RO04",
  );
});

test("gate parity · every gate names the CI job it stands in for", () => {
  for (const gate of GATES) {
    assert.ok(gate.ciJob?.trim(), `gate "${gate.id}" names no CI job`);
    assert.ok(gate.why?.trim(), `gate "${gate.id}" states no reason`);
  }
});
