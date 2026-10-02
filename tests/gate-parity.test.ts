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
import { GATES, PRECONDITIONS } from "../scripts/gates.mjs";

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
  // These interpret upstream outcomes or explain routing; they do not replace
  // any local tree check. ci-verdict's refusal matrix is tested separately.
  "node scripts/ci-verdict.mjs",
  // Same-run retry identity is a live workflow/PR relation, not a local tree gate.
  "node scripts/ci-retry-identity.mjs",
  "node scripts/ci-selection-summary.mjs",
  'test "$ADMISSION_RESULT" = success',
  "corepack enable",
  "corepack pnpm install --frozen-lockfile",
  "corepack pnpm exec playwright install --with-deps chromium",
  // APT archive reuse is installation scaffolding; dependency validation stays.
  'mkdir -p "$RUNNER_TEMP/playwright-apt"',
  String.raw`printf 'Dir::Cache::archives "%s";\nBinary::apt-get::APT::Keep-Downloaded-Packages "true";\n' "$RUNNER_TEMP/playwright-apt" | sudo tee /etc/apt/apt.conf.d/99-playwright-cache > /dev/null`,
  "echo \"path=$(corepack pnpm store path --silent)\" >> \"$GITHUB_OUTPUT\"",
  "node scripts/trace-census.mjs --files trace-files.txt",
  "node scripts/netlify-ignore.mjs --ci",
  'echo "No application rebuild; tests, lint and types still run."',
  // Shallow-checkout preparation for exact equality with the frozen holdings base.
  `holdings_base=$(node --input-type=module -e "import{readFileSync}from'node:fs';console.log(JSON.parse(readFileSync('data/state-holdings/move-plan.json','utf8')).baseSha)")`,
  '[[ "$holdings_base" =~ ^[0-9a-f]{40}$ ]] || exit 1',
  'git cat-file -e "${holdings_base}^{commit}" 2>/dev/null || git fetch --no-tags --depth=1 origin "$holdings_base"',
  // The upstream summaries merged during migration have their own exact-source proof.
  `holdings_update=$(node --input-type=module -e "import{readFileSync}from'node:fs';console.log(JSON.parse(readFileSync('data/states/az/ballot/measure-summaries.json','utf8')).source.integratedUpdate.commit)")`,
  '[[ "$holdings_update" =~ ^[0-9a-f]{40}$ ]] || exit 1',
  'git cat-file -e "${holdings_update}^{commit}" 2>/dev/null || git fetch --no-tags --depth=1 origin "$holdings_update"',
  // Materialize the exact PDC import fixture; accounting assertions remain in the suite.
  "pdc_frozen_base=$(node --input-type=module -e 'import{readFileSync}from\"node:fs\";console.log(readFileSync(\"lib/civic-data/trusted-lkg-import.ts\",\"utf8\").match(/export const PDC_V2_FROZEN_BASE_SHA = \"([a-f0-9]{40})\";/)[1])')",
  "[[ \"$pdc_frozen_base\" =~ ^[0-9a-f]{40}$ ]] || exit 1",
  "git cat-file -e \"${pdc_frozen_base}:lib/funding/official-candidacies.json\" 2>/dev/null || git fetch --no-tags --depth=1 origin \"$pdc_frozen_base\"",
  "git cat-file -e \"${pdc_frozen_base}:lib/funding/official-candidacies.json\"",
  // Shallow-checkout setup for the committed reader receipt's ancestry proof.
  /*
   * RULING 279 — THE TIER DECISION IS NOT A CHECK, AND NEITHER IS SAYING SO.
   *
   * These lines are the shell of the one step that decides whether the
   * expensive tier runs, and of the step that explains the red path in the
   * job's own log. Neither can fail a tree on its own findings: the first
   * only reads two earlier outcomes, the second only prints and exits 1 on a
   * head the preflight has ALREADY failed. There is nothing here for a local
   * door to pre-run, which is the test for this list.
   *
   * The preflight itself is deliberately NOT here — it is a real check, and it
   * is declared in `PRECONDITIONS` so parity holds rather than being waived.
   */
  'if [ -n "${{ steps.pr_tier.outputs.tier }}" ] && [ "${{ steps.preflight.outcome }}" != "success" ]; then',
  'elif [ "${{ steps.preflight.outcome }}" != "success" ]; then',
  'echo "expensive=no-preflight" >> "$GITHUB_OUTPUT"',
  'elif [ "${{ steps.pr_tier.outputs.tier }}" = "draft" ]; then',
  'echo "expensive=draft" >> "$GITHUB_OUTPUT"',
  // A ready PR without auto-merge waits on lint and types.
  'elif [ "${{ steps.pr_tier.outputs.tier }}" = "waiting" ]; then',
  'echo "expensive=waiting" >> "$GITHUB_OUTPUT"',
  'echo "Lint and types ran. The standalone build and the tests run when auto-merge is turned on (or the run-full-ci label is added)."',
  // A push to main selects the main tier: the merged PR already ran its tests.
  'elif [ "${{ github.event_name }}" = "push" ]; then',
  'echo "expensive=main" >> "$GITHUB_OUTPUT"',
  'echo "Main runs the standalone build and the schema gate; lint, types, governance, the affected tests and the default build ran on the pull request, and the hourly scheduled run re-runs the whole suite."',
  'elif [ "${{ steps.pr_tier.outputs.tier }}" = "full" ]; then',
  "else",
  'echo "expensive=yes" >> "$GITHUB_OUTPUT"',
  "fi",
  'echo "The cheap preflight failed on this head, so the browser install, the" >&2',
  'echo "full suite and the builds were not run for it. Nothing is waived: fix" >&2',
  'echo "what preflight named, push again, and the corrected head runs the whole" >&2',
  'echo "verification before it may ship. Run it yourself with:" >&2',
  'echo "    node scripts/preflight.mjs" >&2',
  "exit 1",
  /*
   * Draft/full selection is workflow routing, not a gate. Its pure predicate is
   * covered by tests/draft-pr-ci.test.ts and every unreadable input answers full.
   */
  "node scripts/pr-ci-tier.mjs",
  /*
   * Affected-test selection is routing too: it chooses which files of
   * `pnpm test` a pull request runs (the full suite whenever it is in doubt),
   * and the tests it selects run under `node scripts/ci-tests.mjs`, the same
   * gate. Its decisions are covered by tests/ci-affected-tests.test.ts.
   */
  "node scripts/ci-affected-tests.mjs",
  'echo "Draft preflight passed. This required build context still reports, while"',
  'echo "the two production builds wait for the ready_for_review certification run."',
  'echo "Draft certification completed preflight, install, lint, types, governance,"',
  'echo "generated-state and state-holdings integrity. Browser and full-suite proof"',
  'echo "run when this exact head receives ready_for_review."',
  /*
   * RULING 281 — THE TREE-EQUIVALENCE ADAPTER IS NOT A GATE EITHER, and it is
   * here because workflow routing is not a local tree gate.
   *
   * `certified-tree.mjs` answers ONE question — is the tree on `main` the tree
   * that already passed? — and every path through it exits 0. It cannot fail a
   * commit: an unreadable ancestry, an unreachable API, a missing or red
   * required context and any tree difference all print `certified=no`, and the
   * full proof runs. There is nothing for a local door to pre-run, which is the
   * test this list applies.
   *
   * It could not be a local gate even in principle: the relation it evaluates is
   * defined only for a push to the integration ref, and a session's own head is
   * a pull request. `pnpm gates` would be invoking a command that answers "not
   * applicable" on every tree a session ever has.
   *
   * `--attest` prints the receipt of what was reused. The relation itself is
   * `lib/control-plane/shipping/tree-equivalence.ts`, and THAT is covered by a
   * gate: `tests/tree-equivalence.test.ts` runs inside `pnpm test`.
   */
  'elif [ "${{ steps.certified.outputs.certified }}" = "yes" ]; then',
  'echo "expensive=no-certified" >> "$GITHUB_OUTPUT"',
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
    // ci-tests partitions the entire pnpm test file universe; its disjoint and
    // exhaustive denominator is independently tested in ci-tests.test.ts.
    .replace(/^node scripts\/ci-tests\.mjs$/, "pnpm test")
    .replace(/^corepack\s+/, "")
    .replace(/\bpnpm run\b/, "pnpm")
    .trim();
}

test("gate parity · every command CI runs as a gate is in the local gate set", () => {
  const ci = ciCommands().map(normalise);
  /*
   * RULING 279: the local door runs the preflight BEFORE the gate loop, so it
   * belongs on this side of the comparison. It is declared in
   * `PRECONDITIONS` rather than exempted in `NOT_A_GATE`, because it is not
   * setup — it is a check that fails a head, and the property this test
   * defends is that CI never requires a check the door does not run.
   */
  const local = [...GATES, ...PRECONDITIONS].map((g) => normalise(g.command));

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

test("PDC hosted setup fetches the exact frozen bridge before the unchanged full suite", () => {
  const workflow = parse(readFileSync(WORKFLOW, "utf8"));
  const gates = workflow.jobs.test;
  const fixture = gates.steps.find((step: { name?: string }) => step.name === "Frozen holdings base for extraction proofs");
  const full = gates.steps.find((step: { name?: string }) => step.name === "Test");
  assert.ok(gates.steps.indexOf(fixture) < gates.steps.indexOf(full));
  assert.ok(fixture.run.includes('git fetch --no-tags --depth=1 origin "$pdc_frozen_base"'));
  assert.ok(fixture.run.trim().endsWith('git cat-file -e "${pdc_frozen_base}:lib/funding/official-candidacies.json"'));
  assert.equal(full.run, "node scripts/ci-tests.mjs");
  // Admission's plan: one `affected` leg, or the four shards of the whole suite.
  assert.equal(gates.strategy.matrix.shard, "${{ fromJSON(needs.admission.outputs.test_legs) }}");
  assert.equal(gates.strategy["fail-fast"], false);
  assert.equal(full["timeout-minutes"], 60);
  assert.deepEqual(full.env, {
    NODE_OPTIONS: "--max-old-space-size=4096",
    CI_TEST_SHARD: "${{ matrix.shard != 'affected' && matrix.shard || '' }}",
    CI_TEST_FILES: "${{ matrix.shard == 'affected' && needs.admission.outputs.test_files || '' }}",
  });
  assert.equal(gates["timeout-minutes"], 75);
});


/**
 * #853 moved an ancestry consumer into preflight while its history setup
 * remained in the expensive tier. A valid historical proof then appeared
 * unrelated in CI. Every job that runs preflight must supply complete history
 * before it; adding commits must not change whether a valid ancestor is visible.
 */
function assertPreflightHistory(src: string): void {
  const workflow = parse(src) as {
    jobs: Record<string, { steps?: {
      uses?: string; id?: string; if?: string;
      with?: Record<string, unknown>;
    }[] }>;
  };
  let consumers = 0;
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const steps = job.steps ?? [];
    const preflight = steps.findIndex((step) => step.id === "preflight");
    if (preflight < 0) continue;
    consumers++;
    const checkout = steps.findIndex((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    assert.ok(checkout >= 0 && checkout < preflight,
      `${name}: checkout must precede preflight`);
    assert.equal(steps[checkout].with?.["fetch-depth"], 0,
      `${name}: historical proofs require complete history before preflight`);
    assert.equal(steps[checkout].if, undefined,
      `${name}: history setup must not depend on expensive-tier admission`);
  }
  assert.ok(consumers > 0, "no preflight consumers found");
}

test("CI history contract covers every preflight consumer, including build matrix", () => {
  assertPreflightHistory(readFileSync(WORKFLOW, "utf8"));
});

test("CI history contract rejects shallow checkout and setup after preflight", () => {
  const fixture = (steps: string) => `jobs:\n  example:\n    steps:\n${steps}`;
  assert.throws(() => assertPreflightHistory(fixture(
    "      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 3\n      - id: preflight\n",
  )), /complete history/);
  assert.throws(() => assertPreflightHistory(fixture(
    "      - id: preflight\n      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0\n",
  )), /precede preflight/);
});

test("CI history contract accepts complete history and rejects absent consumers", () => {
  assertPreflightHistory(
    "jobs:\n  example:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0\n      - id: preflight\n",
  );
  assert.throws(() => assertPreflightHistory("jobs: {}"), /no preflight consumers/);
});
