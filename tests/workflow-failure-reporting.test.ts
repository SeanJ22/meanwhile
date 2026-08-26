/**
 * A WORKFLOW REPORTS EVERY FAILURE, NOT JUST THE FIRST.
 * (2026-08-26, the unblock-pushers session. RULING 164.)
 *
 * Three failures were once stacked in run order in this repo, each invisible
 * until the one before it was fixed. A workflow that reports only its first
 * failure makes the number of REMAINING defects unbounded: nobody can know how
 * many lie between the current failure and the end, so every fix is followed by
 * another round trip through CI to find out.
 *
 * It is the same family as every instrument defect this repo has named — a
 * mechanism reporting less than it knows.
 *
 * TWO CLASSES ARE GUARDED HERE, and the second is the general one:
 *
 *   1. Named independent steps carry a non-cancelling guard, so a failure in
 *      one does not hide the verdict of the others.
 *   2. **Any step marked `continue-on-error` must have its outcome READ.** That
 *      flag converts a failure into a silent pass — the step goes amber, the
 *      job goes green, and unless something downstream reads
 *      `steps.<id>.outcome`, the failure is swallowed whole. This is the
 *      class-wide rule; `refresh-nj-filing`'s clerk-count check was the
 *      instance that exposed it (RULING 136 — a fix closes the class).
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parse } from "yaml";

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");

interface Step {
  name?: string;
  id?: string;
  if?: string | boolean;
  run?: string;
  "continue-on-error"?: boolean | string;
}

function workflows(): { file: string; text: string; doc: Record<string, unknown> }[] {
  const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  assert.ok(files.length > 0, "no workflow files found — this reader matched nothing (RULING 159)");
  return files.map((f) => {
    const text = readFileSync(join(WORKFLOW_DIR, f), "utf8");
    return { file: f, text, doc: parse(text) as Record<string, unknown> };
  });
}

function stepsOf(doc: Record<string, unknown>): { job: string; step: Step }[] {
  const jobs = (doc.jobs ?? {}) as Record<string, { steps?: Step[] }>;
  return Object.entries(jobs).flatMap(([job, body]) => (body?.steps ?? []).map((step) => ({ job, step })));
}

/** A guard that keeps running after an earlier step failed. */
function survivesFailure(cond: string | boolean | undefined): boolean {
  if (typeof cond !== "string") return false;
  return /always\s*\(\s*\)/.test(cond) || /!\s*cancelled\s*\(\s*\)/.test(cond);
}

/* ---- 1. the named independent steps ---------------------------------------- */

test("RULING 164: intake-tripwire asks all three of its independent questions", () => {
  const wf = workflows().find((w) => w.file === "intake-tripwire.yml")!;
  const steps = stepsOf(wf.doc).map((s) => s.step);

  // The schema gate runs first and needs no guard — nothing precedes it that
  // could suppress it. The two AFTER it must survive its failure.
  for (const id of ["alarms", "tripwire"]) {
    const step = steps.find((s) => s.id === id);
    assert.ok(step, `intake-tripwire must keep a step with id "${id}"`);
    assert.ok(
      survivesFailure(step.if),
      `"${id}" must run even when an earlier independent check failed — otherwise the ` +
        "first failure hides it, which is the defect this ruling was adopted over",
    );
  }

  const summary = steps.find((s) => s.name === "What every check said");
  assert.ok(summary, "a step must state every check's outcome together");
  for (const id of ["schema", "alarms", "tripwire"]) {
    assert.match(String(summary.run ?? ""), new RegExp(`steps\\.${id}\\.outcome`), `the summary must name ${id}`);
  }
});

test("RULING 164: a failed SOURCE is reported even when validation also fails", () => {
  // refresh-daily's go-red step had no `always()`, so a failure in the
  // validate-or-commit chain skipped it and the failed sources went unnamed.
  // Its sibling in refresh-meetings-snapshot already carried the guard — an
  // independent case, and the one that proves the correct form (RULING 157).
  for (const file of ["refresh-daily.yml", "refresh-meetings-snapshot.yml"]) {
    const wf = workflows().find((w) => w.file === file)!;
    const goRed = stepsOf(wf.doc)
      .map((s) => s.step)
      .find((s) => /this run is red|Go red/i.test(s.name ?? ""));
    assert.ok(goRed, `${file} must keep the step that goes red for a failed source`);
    assert.ok(
      survivesFailure(goRed.if),
      `${file}: a source failure must be reported even when a later step also failed`,
    );
  }
});

/* ---- 2. the class-wide rule ------------------------------------------------ */

test("RULING 164: a continue-on-error step must have its outcome READ somewhere", () => {
  const offenders: string[] = [];
  let swallowable = 0;

  for (const wf of workflows()) {
    for (const { job, step } of stepsOf(wf.doc)) {
      const flag = step["continue-on-error"];
      if (flag !== true && flag !== "true") continue;
      swallowable += 1;

      if (!step.id) {
        offenders.push(`${wf.file} · ${job} · "${step.name ?? "(unnamed)"}" — continue-on-error with no id, so its outcome cannot be read at all`);
        continue;
      }
      if (!new RegExp(`steps\\.${step.id}\\.(outcome|conclusion)`).test(wf.text)) {
        offenders.push(`${wf.file} · ${job} · "${step.name ?? step.id}" — nothing reads steps.${step.id}.outcome, so a failure here is swallowed whole`);
      }
    }
  }

  // The floor: this reader must actually have found the flag somewhere, or it
  // is reporting green about nothing (RULING 159).
  assert.ok(
    swallowable >= 1,
    "no continue-on-error step was found in any workflow. Either they are all gone — " +
      "in which case move this floor in the same diff — or this reader is matching nothing.",
  );

  assert.deepEqual(offenders, [], "every continue-on-error failure must be reported by something downstream");
});

/* ---- 3. the instrument is shown catching the real thing (RULING 110) ------- */

test("RULING 164: the swallowed-failure reader catches a planted one", () => {
  // A workflow that did not exist when the rule was written, so the instrument
  // is proved against a case it was not derived from (RULING 157).
  const planted = parse(
    [
      "name: Planted",
      "jobs:",
      "  go:",
      "    steps:",
      "      - name: A check nobody reads",
      "        id: quiet",
      "        continue-on-error: true",
      "        run: exit 1",
      "      - name: Something else",
      "        run: echo ok",
    ].join("\n"),
  ) as Record<string, unknown>;

  const text = "id: quiet\ncontinue-on-error: true"; // deliberately never mentions steps.quiet.outcome
  const found = stepsOf(planted).filter(({ step }) => {
    if (step["continue-on-error"] !== true) return false;
    return !new RegExp(`steps\\.${step.id}\\.(outcome|conclusion)`).test(text);
  });

  assert.equal(found.length, 1, "the reader must catch a continue-on-error step whose outcome nobody reads");
  assert.equal(found[0].step.id, "quiet");
});
