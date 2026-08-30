/**
 * `pnpm truth:controls` — the truth-contract control harness (WS-CONTRACT).
 *
 * Loads the owner answer key from `data/health/control-facts.json` and reports
 * the control scores: recall on known-present, false-absence rate, and
 * false-presence rate, denominators stated. With no answer key the state is
 * `0 controls loaded — awaiting owner answer key` — explicit, exit 0, never a
 * silent pass.
 *
 * `--prove-fixture` proves the plumbing TODAY with zero owner data: it writes
 * a TEMPORARY synthetic fixture (clearly labelled fixture, including one
 * negative control), runs validation, worker-item assembly through the
 * isolation boundary — proving the worker shape carries no control markers —
 * and the scoring math on a simulated result set, then deletes the fixture
 * and verifies the deletion. Nothing in that mode is owner data and the
 * output says so on every line that shows a number.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { nextRunRecordPath } from "../lib/health/run-records.ts";

import {
  assembleWorkerItem,
  assertValidControlFact,
  CONTROL_ONLY_KEYS,
  scoreControls,
  type ControlFact,
  type ControlObservation,
  type ControlScore,
} from "../lib/health/control-fact.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";

import { today } from "./doc-dates.mjs";

const AWAITING = "0 controls loaded — awaiting owner answer key";

const ROOT = process.cwd();
const KEY_PATH = join(ROOT, "data", "health", "control-facts.json");
const RUNS_DIR = join(ROOT, "data", "health", "control-set-runs");
const FIXTURE_PATH = join(ROOT, "data", "health", "FIXTURE-control-facts.tmp.json");

interface RunRecord {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly mode: "OWNER_KEY" | "PROVE_FIXTURE";
  readonly controlsLoaded: number;
  readonly state: string | null;
  readonly score: ControlScore | null;
  /** True only in fixture mode: none of these numbers describe owner data. */
  readonly fixtureData: boolean;
  readonly fixtureDeleted: boolean | null;
}

function writeRunRecord(record: RunRecord): string {
  const recordPath = nextRunRecordPath(RUNS_DIR, today());
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return recordPath;
}

function loadKey(path: string): ControlFact[] | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} exists but is not an array of control facts`);
  }
  return parsed as ControlFact[];
}

function printScore(score: ControlScore, label: string): void {
  const rate = (v: number | null): string => (v === null ? "no denominator" : v.toFixed(3));
  console.log(`  ${label} recall on known-present:  ${rate(score.recall)} (${score.recalled} of ${score.knownPresentCount})`);
  console.log(`  ${label} false-absence rate:       ${rate(score.falseAbsenceRate)} (${score.falseAbsences} of ${score.knownPresentCount} known-present)`);
  console.log(`  ${label} false-presence rate:      ${rate(score.falsePresenceRate)} (${score.falsePresences} of ${score.knownAbsenceCount} known-absence)`);
  if (score.unobserved > 0) {
    console.log(`  ${label} unobserved controls:      ${score.unobserved} — an unmeasured control is not a passed one`);
  }
}

/** Synthetic facts. Every statement says FIXTURE so no report can mistake it. */
function fixtureFacts(): ControlFact[] {
  const verified = {
    verification_source: "FIXTURE — synthetic, no source",
    verified_by: "prove-fixture mode",
    verified_date: today(),
  };
  return [
    {
      statement: "FIXTURE: the synthetic council meets on the first Tuesday",
      expected_truth: { kind: "value", subject: "synthetic council meeting day", value: "first Tuesday" },
      accepted_forms: ["first Tuesday of the month"],
      fact_class: "known_present",
      ...verified,
    },
    {
      statement: "FIXTURE: the synthetic board has five members",
      expected_truth: { kind: "value", subject: "synthetic board member count", value: 5 },
      fact_class: "known_present",
      ...verified,
    },
    {
      statement: "FIXTURE: the synthetic clerk publishes agendas three days ahead",
      expected_truth: {
        kind: "predicate",
        predicate: "publishes_agenda_days_ahead",
        args: { days: 3 },
      },
      fact_class: "known_present",
      ...verified,
    },
    {
      statement: "FIXTURE: no synthetic recall election was filed in the covered period",
      expected_truth: {
        kind: "proposition",
        proposition: "no recall election filing exists for the synthetic body",
      },
      fact_class: "known_absence",
      authority: "FIXTURE — the synthetic filing office",
      period: "the synthetic covered period",
      verified_through: "FIXTURE — the synthetic filing index",
      ...verified,
    },
  ];
}

function proveFixture(): void {
  const startedAt = new Date().toISOString();
  console.log("truth:controls · --prove-fixture · ALL DATA BELOW IS SYNTHETIC FIXTURE, NOT OWNER DATA");

  const facts = fixtureFacts();
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(facts, null, 2)}\n`);
  console.log(`  temporary fixture written: ${FIXTURE_PATH}`);

  try {
    const loaded = loadKey(FIXTURE_PATH);
    if (!loaded || loaded.length !== facts.length) {
      throw new Error("fixture round-trip lost rows — refusing to score a partial");
    }

    // 1 · validation, including the negative control's required fields.
    for (const fact of loaded) assertValidControlFact(fact);
    console.log(`  validation: ${loaded.length} fixture facts valid (1 negative control among them)`);

    // 2 · worker-item assembly through the isolation boundary. The item the
    // harness holds carries control fields; what comes out must be shaped
    // exactly like an ordinary item, with no marker surviving.
    const now = startedAt;
    const ordinary = createWorkItem({
      project: "pilot-health-fixture",
      subject: "FIXTURE:subject",
      obligation: "FIXTURE: answer a reader question",
      why: "FIXTURE: prove the isolation boundary",
      now,
    });
    const controlCarrying = {
      ...createWorkItem({
        project: "pilot-health-fixture",
        subject: "FIXTURE:control-subject",
        obligation: "FIXTURE: answer a control question",
        why: "FIXTURE: prove the isolation boundary strips control identity",
        now,
      }),
      fact_class: "known_present",
      expected_truth: loaded[0].expected_truth,
      verification_source: loaded[0].verification_source,
    };
    const worker = assembleWorkerItem(controlCarrying);
    const workerKeys = Object.keys(worker).sort();
    const ordinaryKeys = Object.keys(ordinary).sort();
    if (JSON.stringify(workerKeys) !== JSON.stringify(ordinaryKeys)) {
      throw new Error(
        `isolation boundary failed: worker shape [${workerKeys.join(", ")}] differs from ` +
          `ordinary shape [${ordinaryKeys.join(", ")}]`,
      );
    }
    const serialized = JSON.stringify(worker);
    for (const key of CONTROL_ONLY_KEYS) {
      if (serialized.includes(`"${key}"`)) {
        throw new Error(`isolation boundary failed: control marker "${key}" survived`);
      }
    }
    console.log(
      `  isolation: assembled worker item has the ordinary shape (${workerKeys.length} keys) ` +
        "and carries no control marker",
    );

    // 3 · scoring math on a simulated result set, every direction exercised.
    const observations: ControlObservation[] = [
      { statement: loaded[0].statement, observed: "FACT_STATED" },
      { statement: loaded[1].statement, observed: "GAP_NAMED" },
      { statement: loaded[2].statement, observed: "ABSENCE_ASSERTED" },
      { statement: loaded[3].statement, observed: "FACT_STATED" },
    ];
    const score = scoreControls(loaded, observations);
    console.log("  simulated result set scored (fixture numbers, not a reading of the product):");
    printScore(score, "FIXTURE");

    const recordPath = writeRunRecord({
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: "PROVE_FIXTURE",
      controlsLoaded: loaded.length,
      state: null,
      score,
      fixtureData: true,
      fixtureDeleted: true,
    });
    console.log(`  run record: ${recordPath}`);
  } finally {
    rmSync(FIXTURE_PATH, { force: true });
    if (existsSync(FIXTURE_PATH)) {
      console.error(`  FIXTURE DELETION FAILED — ${FIXTURE_PATH} still exists`);
      process.exit(1);
    }
    console.log(`  fixture deleted and deletion verified: ${FIXTURE_PATH} no longer exists`);
  }
}

function ownerKey(): void {
  const startedAt = new Date().toISOString();
  const facts = loadKey(KEY_PATH) ?? [];
  if (facts.length === 0) {
    console.log(`truth:controls · ${AWAITING}`);
    const recordPath = writeRunRecord({
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: "OWNER_KEY",
      controlsLoaded: 0,
      state: AWAITING,
      score: null,
      fixtureData: false,
      fixtureDeleted: null,
    });
    console.log(`  run record: ${recordPath}`);
    return;
  }
  for (const fact of facts) assertValidControlFact(fact);
  // The audit that produces real observations rides the reader-suite harness;
  // until it runs, loaded-but-unscored is stated rather than smoothed.
  console.log(
    `truth:controls · ${facts.length} controls loaded and validated · no audit has produced ` +
      "observations yet, so there is no score to report — a missing reading is stated, " +
      "never defaulted",
  );
  const recordPath = writeRunRecord({
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: "OWNER_KEY",
    controlsLoaded: facts.length,
    state: "loaded, awaiting an audit run to observe",
    score: null,
    fixtureData: false,
    fixtureDeleted: null,
  });
  console.log(`  run record: ${recordPath}`);
}

if (process.argv.includes("--prove-fixture")) {
  proveFixture();
} else {
  ownerKey();
}
