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
import { parse } from "yaml";
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
/**
 * THE THREE CANONICAL AUTHORITIES WIRED ON 2026-08-29, pinned by name.
 *
 * They were enforced only INDIRECTLY before — by tests that assert things about
 * their subject matter — which is not the same as running them. Each was
 * classified by READING the script before it was wired, and all three are pure
 * checkers: they read canonical state, write nothing under the repository, and
 * exit non-zero on a violation. The mutating neighbours (`governance:compile`,
 * `method:ingest`, `orchestration:closeout`, the tracker and workstream
 * writers) are excluded by name in `scripts/gates.mjs` and in the workflow.
 */
const CANONICAL_AUTHORITY_GATES = ["governance:check", "orchestration:check", "method:check"];

const NOT_A_GATE = [
  "corepack enable",
  "corepack pnpm install --frozen-lockfile",
  "corepack pnpm exec playwright install --with-deps chromium",
  "echo \"path=$(corepack pnpm store path --silent)\" >> \"$GITHUB_OUTPUT\"",
  "node scripts/trace-census.mjs --files trace-files.txt",
  // Shallow-checkout preparation for exact equality with the frozen holdings base.
  `holdings_base=$(node -p "require('./data/state-holdings/move-plan.json').baseSha")`,
  '[[ "$holdings_base" =~ ^[0-9a-f]{40}$ ]] || exit 1',
  'git cat-file -e "${holdings_base}^{commit}" 2>/dev/null || git fetch --no-tags --depth=1 origin "$holdings_base"',
];

/*
 * THIS TEST READS EXACTLY ONE FILE — `build-check.yml`, the workflow carrying
 * the required contexts. `.github/workflows/post-deploy-integrity.yml`
 * (2026-08-29) is NOT read here and needs no `NOT_A_GATE` entries: it is not a
 * merge gate, it runs AFTER a push to main, and its commands are an observation
 * and a commit rather than checks a session could run locally before merging.
 * Adding its scaffolding to the exclusion list above would be adding exemptions
 * for a file nothing here parses.
 */

function ciCommands(src = readFileSync(WORKFLOW, "utf8")): string[] {
  // Parse YAML boundaries: a whitespace regex swallowed subsequent steps and
  // comments after the first block-form run, hiding the actual gates.
  const workflow = parse(src) as { jobs: Record<string, { steps?: { run?: string }[] }> };
  const found = Object.values(workflow.jobs).flatMap((job) =>
    (job.steps ?? []).flatMap((step) =>
      (step.run ?? "").split("\n").map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")),
    ),
  );
  return found.filter((c) => !NOT_A_GATE.includes(c));
}

test("gate parity · block commands cannot consume later steps or turn comments into gates", () => {
  const commands = ciCommands(`jobs:
  gates:
    steps:
      - run: |
          corepack enable
          pnpm test
      # governance:compile is forbidden, not executed here.
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: pnpm lint
      - run: pnpm governance:compile
`);
  assert.deepEqual(commands, ["pnpm test", "pnpm lint", "pnpm governance:compile"]);
});

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

test("gate parity · each canonical authority is in BOTH the local set and the required CI job", () => {
  /*
   * BY NAME, IN BOTH DIRECTIONS, and the CI half is read out of the WORKFLOW
   * FILE (RULING 147) rather than out of the gate list. The generic parity test
   * above already fails if CI runs something the local door does not — but it
   * would say nothing at all if a future edit dropped a step from BOTH files at
   * once, which is exactly how lint fell out of the local set and stayed out.
   *
   * The workflow's `gates` job is the anchor because it is the required context
   * branch protection names. A step added to the `build` job instead would pass
   * the generic test and leave these unrun on the job that gates a merge.
   */
  const src = readFileSync(WORKFLOW, "utf8");
  const gatesAt = src.indexOf("  gates:");
  assert.ok(gatesAt > 0, "the gates job is gone from the workflow");
  const gatesJob = src.slice(gatesAt);

  const local = GATES.map((g) => normalise(g.command));
  for (const id of CANONICAL_AUTHORITY_GATES) {
    assert.ok(
      GATES.some((g) => g.id === id),
      `"${id}" is not in GATES in scripts/gates.mjs — it would run in CI and not locally`,
    );
    assert.ok(
      local.includes(`pnpm ${id}`),
      `GATES carries no command \`pnpm ${id}\` — the id and the command must agree`,
    );
    assert.ok(
      gatesJob.includes(`run: corepack pnpm ${id}`),
      `\`${id}\` runs in \`pnpm gates\` and NOT in build-check.yml's gates job — a gate the ` +
        "local door runs and CI does not is a gate nothing enforces on a merge",
    );
  }
});

test("gate parity · every wired canonical authority names a bound and does not hide behind a failure", () => {
  /*
   * `if: always()` so one red gate does not hide the verdict of the others, and
   * `timeout-minutes` so a hung check fails naming itself rather than sitting
   * until the platform kills the job at six hours (F25).
   */
  const src = readFileSync(WORKFLOW, "utf8");
  const gatesJob = src.slice(src.indexOf("  gates:"));
  for (const id of CANONICAL_AUTHORITY_GATES) {
    const at = gatesJob.indexOf(`run: corepack pnpm ${id}`);
    assert.ok(at > 0, `\`${id}\` is not in the gates job`);
    // The step's own keys sit immediately above its `run:` line.
    const step = gatesJob.slice(Math.max(0, at - 300), at);
    assert.match(step, /if: always\(\)/, `\`${id}\` may not hide behind an earlier failure`);
    assert.match(step, /timeout-minutes:\s*\d+/, `\`${id}\` must bound itself`);
  }
});

test("gate parity · no MUTATING command was wired in to make a question look covered", () => {
  /*
   * The other half of the classification, asserted rather than left to a
   * comment. `governance:compile` regenerates the very views `governance:check`
   * compares against — running it as a gate would have CI repair the staleness
   * the gate exists to catch and go green having destroyed the evidence
   * (RULING 102). `method:ingest` once took the method store from 88 routes to
   * 62 while reporting success. The tracker and workstream commands write
   * canonical state. None of them may become a gate.
   */
  const forbidden = [
    "governance:compile",
    "governance:accept",
    "governance:import",
    "method:ingest",
    "orchestration:closeout",
    "workstream:close",
    "workstream:status",
    "tracker:move",
    "tracker:add",
  ];
  const local = GATES.map((g) => normalise(g.command));
  const ci = ciCommands().map(normalise);
  for (const command of forbidden) {
    assert.ok(
      !local.some((c) => c.includes(command)),
      `\`${command}\` is a WRITER and is in the local gate set — a gate that mutates what it measures cannot report a failure`,
    );
    assert.ok(
      !ci.some((c) => c.includes(command)),
      `\`${command}\` is a WRITER and runs in build-check.yml — CI may not mutate canonical state on a pull request`,
    );
  }
});

test("gate parity · every gate names the CI job it stands in for", () => {
  for (const gate of GATES) {
    assert.ok(gate.ciJob?.trim(), `gate "${gate.id}" names no CI job`);
    assert.ok(gate.why?.trim(), `gate "${gate.id}" states no reason`);
  }
});
