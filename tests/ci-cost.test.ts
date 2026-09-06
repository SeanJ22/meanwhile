/**
 * WORKFLOW COST FOLLOWS THE CANONICAL SHIPPING CLASSIFICATION. (RULING 278.)
 *
 * A commit positively proven NON_SHIPPING receives an explicit cheap
 * attestation; a SHIPPING, mixed or unclassifiable commit receives full proof.
 * No workflow may maintain a second independent path-classification truth
 * table.
 *
 * ## WHY THIS FILE IS THE PERMANENCE MECHANISM
 *
 * The fix it guards is a repository-level repair, not an instruction anybody
 * has to remember. A comment in a workflow is not law: the next session to edit
 * `build-check.yml` reads YAML, not prose, and the cheapest way to make a
 * stubborn gate pass has always been to widen the skip. So the assertions below
 * are anchored on the WORKFLOW FILES themselves (RULING 147 — no reconciliation
 * may compare a parser to itself) and they plant the four edits that would
 * actually happen:
 *
 *   - a `paths-ignore:` trigger filter, which is a second truth table wearing
 *     GitHub's own syntax;
 *   - an `if:` expression naming repository paths, which is the same table
 *     written by hand;
 *   - the cost condition quietly dropped from an expensive step;
 *   - a new ops-only entry that no scheduled pusher is actually granted.
 *
 * Each is shown being caught, against the SHIPPED text, so the guard cannot be
 * a sweep that reports green about nothing (RULING 110).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  CHEAP_PATH_PROOFS,
  OPS_ONLY_ARTIFACTS,
  classifyCommitCost,
  isNonShippingPath,
  opsOnlyArtifact,
  validateOpsArtifact,
} from "../lib/ops/deploy-paths.ts";
import { PUSHER_PROFILES, isAllowedFor, profileFor } from "../lib/ops/push-allowlist.ts";

const ROOT = join(import.meta.dirname, "..");
const BUILD_CHECK = ".github/workflows/build-check.yml";
const POST_DEPLOY = ".github/workflows/post-deploy-integrity.yml";

const workflow = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ══════════════════════════════════════════════════════════════════════════
 * ONE CANONICAL CLASSIFIER, AND THE CLASSES IT MUST GET RIGHT (CIF-1)
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * The class table, stated as the brief states it. Every row is a real path
 * shape from this repository, not a hypothetical one.
 */
const CLASS_TABLE: ReadonlyArray<{ what: string; changed: string[]; cost: "CHEAP" | "FULL" }> = [
  { what: "application / reader code", changed: ["components/ballot-card.tsx"], cost: "FULL" },
  { what: "an App Router route", changed: ["app/api/ballot/scope/route.ts"], cost: "FULL" },
  {
    what: "governed civic data",
    changed: ["data/states/nj/ballot/nj-morris-2026.json"],
    cost: "FULL",
  },
  { what: "schema / migration", changed: ["lib/db/migrations/0007_thing.sql"], cost: "FULL" },
  { what: "the schema contract itself", changed: ["lib/db/schema.ts"], cost: "FULL" },
  {
    what: "reader proof / generated input",
    changed: ["docs/evidence/reader-last-mile-final-closure-receipt.json"],
    cost: "FULL",
  },
  {
    what: "ops-only production reading",
    changed: ["data/ops/production-integrity.json", "docs/status-ledger.md"],
    cost: "CHEAP",
  },
  {
    what: "ops-only refresh debt / report",
    changed: ["data/ops/refresh-debt.json", "docs/refresh-run.json", "docs/refresh-run.md"],
    cost: "CHEAP",
  },
  {
    what: "mixed ops + application code",
    changed: ["data/ops/production-integrity.json", "app/page.tsx"],
    cost: "FULL",
  },
  {
    what: "unknown new top-level path",
    changed: ["some-new-directory/thing.json"],
    cost: "FULL",
  },
  { what: "the classifier's own source", changed: ["lib/ops/deploy-paths.ts"], cost: "FULL" },
  { what: "a workflow definition", changed: [".github/workflows/build-check.yml"], cost: "FULL" },
  { what: "a test file", changed: ["tests/ci-cost.test.ts"], cost: "FULL" },
  { what: "the constitution", changed: ["CLAUDE.md"], cost: "FULL" },
];

test("RULING 278 — the class table: only a positively proven ops-only commit is cheap", () => {
  for (const row of CLASS_TABLE) {
    const d = classifyCommitCost(row.changed);
    assert.equal(
      d.cost,
      row.cost,
      `${row.what} (${row.changed.join(", ")}) must be ${row.cost}, got ${d.cost} — ${d.reason}`,
    );
    assert.equal(d.klass === "NON_SHIPPING", row.cost === "CHEAP", `${row.what}: class and cost disagree`);
  }
});

test("RULING 278 — UNKNOWN is FULL, and an unreadable list is not an empty one", () => {
  const unreadable = classifyCommitCost(null);
  assert.equal(unreadable.klass, "UNKNOWN");
  assert.equal(unreadable.cost, "FULL");
  assert.match(unreadable.reason, /could not be computed/);

  // A merge commit's combined diff reads back as no paths at all.
  const empty = classifyCommitCost([]);
  assert.equal(empty.klass, "UNKNOWN");
  assert.equal(empty.cost, "FULL");
});

test("RULING 278 — no directory-wide skip may be resurrected", () => {
  /*
   * `data/**` and `docs/**` are the two skips somebody reaches for, and
   * `.github/workflows/build-check.yml` already records rejecting the first.
   * These prove the rejection is enforced rather than remembered.
   */
  for (const p of [
    "data/meetings-snapshot.json",
    "data/fec/fec-2026.json",
    "data/ops/gate-runs/2026-09-05-03.json",
    "docs/states/nj.md",
    "docs/rulings.md",
    "docs/governance/ledger.jsonl",
    "docs/tracker-working.csv",
  ]) {
    assert.equal(
      classifyCommitCost([p]).cost,
      "FULL",
      `${p} must take the full proof — it is not a named operational artifact`,
    );
  }
});

test("RULING 278 — the ops-only set is a STRICT SUBSET of the non-shipping set", () => {
  for (const a of OPS_ONLY_ARTIFACTS) {
    assert.equal(
      isNonShippingPath(a.path),
      true,
      `${a.path} is declared ops-only but is SHIPPING under isNonShippingPath — ` +
        "the two tables have come apart, and a file that reaches the deploy can never be cheap",
    );
  }
  assert.ok(
    OPS_ONLY_ARTIFACTS.length > 0 && OPS_ONLY_ARTIFACTS.length < 20,
    "the ops-only set is empty or has grown past anything a person reviews in one sitting",
  );
});

test("RULING 278 — every ops-only entry is an exact file, on disk, with its reason stated", () => {
  const seen = new Set<string>();
  for (const a of OPS_ONLY_ARTIFACTS) {
    assert.ok(!a.path.endsWith("/"), `${a.path} is a directory prefix — ops-only entries are exact files`);
    assert.ok(!/[*?[\]]/.test(a.path), `${a.path} is a glob — ops-only entries are exact files`);
    assert.ok(!seen.has(a.path), `${a.path} is declared twice`);
    seen.add(a.path);
    assert.ok(existsSync(join(ROOT, a.path)), `${a.path} is declared ops-only and does not exist`);
    assert.ok(a.why.length > 40, `${a.path} has no stated reason — a list with no reasons is extended by vibe`);
    assert.equal(opsOnlyArtifact(a.path)?.path, a.path);
  }
});

test("RULING 278 — every ops-only file is written to main by the scheduled pusher that declares it", () => {
  /*
   * This is what makes the skip a fact about the commit rather than a hope
   * about its author. These files reach `main` only through
   * `scripts/push-main.mjs` under a per-workflow grant, and `NEVER_PUSHABLE`
   * in the same file makes it impossible for such a grant to carry `app/`,
   * `lib/`, `scripts/`, `tests/` or `.github/`. A person or a session editing
   * one of them arrives through a pull request, which is never cheap.
   */
  for (const a of OPS_ONLY_ARTIFACTS) {
    const profile = profileFor(a.writtenBy);
    assert.ok(profile, `${a.path} names pusher "${a.writtenBy}", which is not in PUSHER_PROFILES`);
    assert.equal(
      isAllowedFor(profile, a.path),
      true,
      `${a.path} is declared ops-only but "${a.writtenBy}" is not granted it in lib/ops/push-allowlist.ts`,
    );
    assert.ok(
      PUSHER_PROFILES.some((p) => p.id === a.writtenBy && p.workflow.startsWith(".github/workflows/")),
      `${a.writtenBy} is not a scheduled workflow pusher`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE CHEAP PATH IS A PROOF, NOT AN ABSENCE
 * ═════════════════════════════════════════════════════════════════════════ */

test("RULING 278 — every ops-only artifact names guards the cheap path actually runs", () => {
  const union = new Set<string>();
  for (const a of OPS_ONLY_ARTIFACTS) {
    assert.ok(a.provenBy.length > 0, `${a.path} names no guard — then the cheap path proves nothing about it`);
    for (const p of a.provenBy) {
      assert.ok(
        CHEAP_PATH_PROOFS.includes(p),
        `${a.path} names ${p}, which is not in CHEAP_PATH_PROOFS and would therefore never run`,
      );
      assert.ok(existsSync(join(ROOT, p)), `${p} is named as a cheap-path proof and does not exist`);
      union.add(p);
    }
  }
  assert.deepEqual(
    [...CHEAP_PATH_PROOFS].sort(),
    [...union].sort(),
    "CHEAP_PATH_PROOFS and the union of every provenBy have come apart — a file in one and not " +
      "the other is either a guard that never runs or a cost nothing asked for",
  );
});

test("RULING 278 — the COMMITTED ops-only artifacts still hold their shape", () => {
  /*
   * The live half. These files are written unattended by scheduled jobs, and
   * this is the guard that the cheap path runs in place of the full suite —
   * so it reads what is actually on disk, at this head, every time.
   */
  const failures: string[] = [];
  for (const a of OPS_ONLY_ARTIFACTS) {
    const problem = validateOpsArtifact(a.path, readFileSync(join(ROOT, a.path), "utf8"));
    if (problem) failures.push(problem);
  }
  assert.deepEqual(failures, [], `committed operational artifacts no longer hold their shape:\n${failures.join("\n")}`);
});

test("RULING 278 — the shape check is shown catching a real malformation", () => {
  const json = OPS_ONLY_ARTIFACTS.find((a) => a.shape.kind === "json");
  assert.ok(json, "no JSON ops artifact to plant against");
  assert.match(String(validateOpsArtifact(json.path, "{ not json")), /not parseable JSON/);
  assert.match(String(validateOpsArtifact(json.path, "{}")), /missing required key/);
  assert.match(String(validateOpsArtifact(json.path, "[]")), /not an object/);
  assert.equal(validateOpsArtifact(json.path, readFileSync(join(ROOT, json.path), "utf8")), null);

  const md = OPS_ONLY_ARTIFACTS.find((a) => a.shape.kind === "markdown");
  assert.ok(md, "no Markdown ops artifact to plant against");
  assert.match(String(validateOpsArtifact(md.path, "# something else entirely")), /no longer contains/);

  assert.match(String(validateOpsArtifact("app/page.tsx", "{}")), /not an ops-only artifact/);
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE STRUCTURAL GUARD: NO WORKFLOW KEEPS A SECOND TRUTH TABLE (CIF-4)
 * ═════════════════════════════════════════════════════════════════════════ */

/** The steps in `build-check.yml` that cost real time and must be classified first. */
const EXPENSIVE_STEPS: readonly string[] = [
  "- name: Build (the command netlify.toml gives Netlify)",
  "- name: Bundle-scanning checks (need the build above)",
  "- name: Install the browser the suite needs",
  "- name: Prove the browser is actually there",
  "- name: Test",
  "- name: Lint",
  "- name: Types (fresh checkout, no build)",
  "- name: Governance ledger and its generated views",
  "- name: Orchestration plans (RULING 190)",
  "- name: Method knowledge store",
  "- name: Canonical state holdings and residual paths",
  "- name: Generated state manifests against committed observations",
  "- name: Schema shipping gate (only when the schema contract moved)",
  "- name: Release freeze (refuses a release on a DEGRADED production reading)",
];

/** The `if:` of the step whose `- name:` line is `header`, or null when it has none. */
function conditionOf(source: string, header: string): string | null {
  const at = source.indexOf(header);
  if (at < 0) return null;
  const block = source.slice(at, at + 600);
  const line = block.split("\n").slice(1).find((l) => l.trimStart().startsWith("if:"));
  // Stop at the next step rather than reading into it.
  const nextStep = block.indexOf("\n      - ", 1);
  if (line && nextStep > 0 && block.indexOf(line) > nextStep) return null;
  return line ? line.trim().slice(3).trim() : null;
}

test("RULING 278 — Build Check classifies before any expensive step, in every job", () => {
  const text = workflow(BUILD_CHECK);

  const classifiers = text.split("\n").filter((l) => l.includes("node scripts/ci-cost.mjs"));
  assert.equal(
    classifiers.length,
    5,
    `${BUILD_CHECK} must invoke the canonical classifier once per job (2), attest once per job (2) ` +
      `and run the cheap proof once (1); found ${classifiers.length}`,
  );

  // The classify step precedes every expensive step, textually and therefore in
  // execution order, in the job it belongs to.
  const firstClassify = text.indexOf("- name: Classify the commit (canonical shipping classifier)");
  assert.ok(firstClassify > 0, "the classify step is gone from build-check.yml");
  for (const step of EXPENSIVE_STEPS) {
    const at = text.indexOf(step);
    assert.ok(at > 0, `${step} has vanished from ${BUILD_CHECK} — update EXPENSIVE_STEPS in the same diff`);
    assert.ok(at > firstClassify, `${step} runs before the commit is classified`);
  }
});

test("RULING 278 — every expensive step in Build Check consumes the classifier's verdict", () => {
  const text = workflow(BUILD_CHECK);
  const naked: string[] = [];
  for (const step of EXPENSIVE_STEPS) {
    const cond = conditionOf(text, step);
    if (!cond || !cond.includes("steps.cost.outputs.cost != 'CHEAP'")) naked.push(`${step} → ${cond ?? "(no if:)"}`);
  }
  assert.deepEqual(
    naked,
    [],
    "these steps run regardless of the classification, which is the whole defect RULING 278 " +
      `repairs:\n${naked.join("\n")}`,
  );
});

test("RULING 278 — Build Check answers cheaply and EXPLICITLY rather than disappearing", () => {
  const text = workflow(BUILD_CHECK);
  const attestations = text.split("\n").filter((l) => l.includes("- name: Cheap attestation"));
  assert.equal(attestations.length, 2, "each job must report what it decided; a silent skip disarms a required check");
  assert.ok(
    text.includes("run: node scripts/ci-cost.mjs --prove"),
    "the cheap path must RUN the guards that read the changed artifacts, not merely announce a skip",
  );
});

test("RULING 278 — the post-deploy observer consumes the same classifier, before it installs", () => {
  const text = workflow(POST_DEPLOY);
  assert.ok(
    text.includes("node scripts/ci-cost.mjs"),
    `${POST_DEPLOY} no longer consumes the canonical classifier`,
  );
  const classifyAt = text.indexOf("node scripts/ci-cost.mjs");
  const installAt = text.indexOf("run: corepack pnpm install --frozen-lockfile");
  assert.ok(installAt > 0, "the observer's install step has moved — re-anchor this guard");
  assert.ok(
    classifyAt < installAt,
    "the observer classifies AFTER installing, which is the cost this repair removes",
  );

  const observe = conditionOf(text, "- name: Observe the deploy and take the post-deploy reading");
  assert.ok(
    observe && observe.includes("steps.cost.outputs.deploy != 'cancel'"),
    `the observer polls production regardless of the classification (if: ${observe ?? "none"})`,
  );
  assert.ok(
    text.includes("- name: Non-shipping commit — no deployment can result"),
    "the observer must SAY it classified the commit and exited, not vanish",
  );
});

test("RULING 278 — neither workflow keeps a second path-classification truth table", () => {
  for (const rel of [BUILD_CHECK, POST_DEPLOY]) {
    const text = workflow(rel);

    for (const filter of ["paths:", "paths-ignore:"]) {
      assert.ok(
        !text.split("\n").some((l) => l.trim().startsWith(filter)),
        `${rel} carries a \`${filter}\` trigger filter. That is a second path table in GitHub's own ` +
          "syntax, maintained separately from lib/ops/deploy-paths.ts and free to disagree with it.",
      );
    }

    /*
     * An `if:` that names repository paths is the same table written by hand.
     * Only expressions over the classifier's outputs, the matrix, the event and
     * the run's own steps are permitted.
     */
    const handRolled = text
      .split("\n")
      .filter((l) => l.trim().startsWith("if:"))
      .filter((l) => /\b(docs|data|lib|app|components|scripts|tests)\//.test(l));
    assert.deepEqual(
      handRolled.map((l) => l.trim()),
      [],
      `${rel} decides on repository paths inside an \`if:\`. The classification has ONE holder ` +
        "(lib/ops/deploy-paths.ts) and workflows consume its result.",
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE INSTRUMENT IS SHOWN CATCHING THE EDITS THAT WOULD ACTUALLY HAPPEN
 * ═════════════════════════════════════════════════════════════════════════ */

test("RULING 278 — dropping the condition from an expensive step is caught", () => {
  const text = workflow(BUILD_CHECK);
  const planted = text.replace(
    "      - name: Test\n        if: steps.cost.outputs.cost != 'CHEAP'\n",
    "      - name: Test\n",
  );
  assert.notEqual(planted, text, "the plant did not apply — the Test step has moved");
  const cond = conditionOf(planted, "- name: Test");
  assert.ok(
    !cond || !cond.includes("steps.cost.outputs.cost"),
    "the reader must see the Test step running unconditionally once the condition is removed",
  );
});

test("RULING 278 — a `paths-ignore:` filter added to Build Check is caught", () => {
  const planted = workflow(BUILD_CHECK).replace(
    "on:\n  push:\n    branches: [main]\n",
    "on:\n  push:\n    branches: [main]\n    paths-ignore:\n      - 'docs/**'\n",
  );
  assert.ok(
    planted.split("\n").some((l) => l.trim().startsWith("paths-ignore:")),
    "the plant did not apply — the trigger block has moved",
  );
});

test("RULING 278 — a hand-rolled path condition is caught", () => {
  const planted = workflow(BUILD_CHECK).replace(
    "      - name: Test\n        if: steps.cost.outputs.cost != 'CHEAP'\n",
    "      - name: Test\n        if: \"!contains(github.event.head_commit.message, 'docs/')\"\n",
  );
  const handRolled = planted
    .split("\n")
    .filter((l) => l.trim().startsWith("if:"))
    .filter((l) => /\b(docs|data|lib|app|components|scripts|tests)\//.test(l));
  assert.ok(handRolled.length > 0, "the sweep must see a path named inside an if:");
});

test("RULING 278 — an ops-only entry no pusher is granted is caught", () => {
  const invented = { path: "data/ops/invented-by-a-session.json", writtenBy: "post-deploy-integrity" };
  const profile = profileFor(invented.writtenBy);
  assert.ok(profile);
  assert.equal(
    isAllowedFor(profile, invented.path),
    false,
    "the grant check must refuse a path the pusher was never granted — otherwise the ops-only " +
      "table could name any file at all",
  );
});
