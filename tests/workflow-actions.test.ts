import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, ".github", "workflows");

/**
 * R45 (2026-08-18) — the scheduled jobs ran on a runtime their actions were
 * not built for.
 *
 * Every run printed: "Node.js 20 is deprecated. The following actions target
 * Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4,
 * actions/setup-node@v4." The jobs worked, on a borrowed runtime. Both are
 * pinned at v7 now, which targets Node 24 natively.
 *
 * A source scan, like `handoff-gate.test.ts`: what rots here is the PIN, and
 * a pin is exactly what a scan can see. The runtime each major targets was
 * read off the actions' own `action.yml` at the time of the bump —
 * checkout@v4 and setup-node@v4 declare `using: node20`, v5 through v7
 * declare `using: node24` — so "major >= 5" is the checkable form of "does
 * not target Node 20".
 *
 * The `package-manager-cache: false` assertion is not tidiness. setup-node
 * v5 introduced automatic caching whenever `package.json` names a
 * `packageManager`, and this repo names `pnpm@10.33.0` — but pnpm does not
 * exist on the runner until the `corepack enable` step that runs AFTER
 * setup-node. v5 would have failed looking for it. v6 narrowed auto-caching
 * to npm only, so v7 is safe today; pinning it off keeps that true if a
 * later major widens the default again.
 */

const FIRST_NODE24_MAJOR = 5;

// Matches the step's own `uses:` line. Written as a literal so it cannot be
// broken by string escaping, and anchored on `- uses:` so prose in a comment
// that names a version can never be counted as a pin.
const ACTION_PIN = /-\s*uses:\s*actions\/(checkout|setup-node)@v(\d+)/g;

// The STEP, not the word. The R45 comment above each setup-node step explains
// why corepack's position matters, so a bare /corepack enable/ finds the
// explanation rather than the step — which is how the first draft of this test
// failed against a correct tree.
const COREPACK_STEP = /run:\s*corepack enable/;

const SETUP_NODE_STEP = /-\s*uses:\s*actions\/setup-node@/;

const workflows = readdirSync(DIR).filter((f) => f.endsWith(".yml"));

test("the workflow set is still the six this rule was audited against", () => {
  assert.equal(
    workflows.length,
    6,
    `the workflow set changed: ${workflows.join(", ")} — audit the new one's action pins too`,
  );
});

test("R45: no workflow pins an action major that targets Node 20", () => {
  const stale: string[] = [];
  let pins = 0;

  for (const file of workflows) {
    const source = readFileSync(join(DIR, file), "utf8");
    for (const match of source.matchAll(ACTION_PIN)) {
      pins += 1;
      if (Number(match[2]) < FIRST_NODE24_MAJOR) {
        stale.push(`${file}: actions/${match[1]}@v${match[2]}`);
      }
    }
  }

  assert.equal(
    pins,
    12,
    `expected two Node-runtime action pins in each of six workflows, found ${pins}`,
  );
  assert.deepEqual(
    stale,
    [],
    "these pins target Node 20 and will be forced onto a runtime they were not " +
      `built for: ${stale.join(", ")}`,
  );
});

test("R45: setup-node never tries to restore a cache before pnpm exists", () => {
  const unguarded: string[] = [];

  for (const file of workflows) {
    const source = readFileSync(join(DIR, file), "utf8");
    if (!SETUP_NODE_STEP.test(source)) continue;

    const setupNodeAt = source.search(SETUP_NODE_STEP);
    const corepackAt = source.search(COREPACK_STEP);

    // The ordering is the whole reason the pin matters. If corepack ever moves
    // ahead of setup-node, auto-caching stops being a hazard and this can be
    // revisited — but it has to be revisited deliberately, not discovered.
    assert.ok(
      corepackAt > setupNodeAt,
      `${file}: corepack enable no longer follows setup-node — re-rule on package-manager-cache`,
    );

    if (!/package-manager-cache:\s*false/.test(source)) unguarded.push(file);
  }

  assert.deepEqual(
    unguarded,
    [],
    `setup-node may auto-cache pnpm before corepack installs it in: ${unguarded.join(", ")}`,
  );
});

/**
 * AUD-07 (2026-08-18) — a refresh that changed nothing skips the suite it
 * would prove nothing with.
 *
 * Both scheduled refresh workflows used to run the full gate on EVERY run and
 * only then ask whether the governed artifact had moved. The overwhelmingly
 * common outcome of a refresh is that it did not move, so the suite was
 * executing against a snapshot byte-identical to the one already committed and
 * already validated — four times a day for meetings, weekly for dotgov.
 *
 * The order is now diff, then branch. This guards the order, because the
 * failure mode is silent: putting the gate back in front of the diff costs
 * nothing visible and simply resumes burning runner minutes proving a
 * tautology. It also guards the thing that must NOT change — the gate still
 * stands between changed data and the commit.
 */
test("AUD-07: both refresh workflows diff before they gate, and still gate before they commit", () => {
  const refreshers = [
    { file: "refresh-meetings-snapshot.yml", artifact: "data/meetings-snapshot.json" },
    { file: "refresh-dotgov-snapshot.yml", artifact: "data/dotgov/snapshot.json" },
  ];

  for (const { file, artifact } of refreshers) {
    const source = readFileSync(join(DIR, file), "utf8");

    const diffAt = source.indexOf("id: diff");
    const gateAt = source.indexOf("run: corepack pnpm test");
    const commitAt = source.indexOf("git push origin main");

    assert.ok(diffAt > 0, `${file}: the diff step is still there`);
    assert.ok(gateAt > 0, `${file}: the gate is still there`);
    assert.ok(commitAt > 0, `${file}: the commit is still there`);

    assert.ok(
      diffAt < gateAt,
      `${file}: the artifact must be diffed BEFORE the suite runs — otherwise every ` +
        "no-op refresh validates data that did not move",
    );
    assert.ok(
      gateAt < commitAt,
      `${file}: the suite must still run BEFORE the commit — the changed-data path ` +
        "does not weaken",
    );

    // The gate runs only on the changed branch, and the commit only when the
    // change is real rather than simulated.
    assert.match(
      source,
      /if: steps\.diff\.outputs\.changed == 'true'\s*\n\s*run: corepack pnpm test/,
      `${file}: the gate is conditioned on the artifact having changed`,
    );
    assert.match(
      source,
      /steps\.diff\.outputs\.simulated != 'true'/,
      `${file}: a simulated run reaches the gate and can never commit`,
    );
    assert.ok(
      source.includes(artifact),
      `${file}: still diffing its own governed artifact (${artifact})`,
    );

    // The early exit STATES itself. A silent skip is indistinguishable from a
    // gate that passed, which is the thing this whole change must not become.
    assert.match(
      source,
      /SKIPPED: corepack pnpm test/,
      `${file}: the skipped run says what it skipped and why`,
    );
  }
});
