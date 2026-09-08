/**
 * **RULING 124 items 3 and 4 — one daily refresh, each source on the cadence it
 * earns.** (Adopted 2026-08-24, Sean's instruction.)
 *
 * The guard that matters most here is the LAST one: every scheduled workflow
 * that can cost a production build is enumerated by reading the workflow files
 * themselves. A cadence table that agreed with itself while a sixth cron sat in
 * `.github/workflows/` would be exactly the shape RULING 114 names — a stamp
 * checked against the thing it was stamped from.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  REFRESH_SOURCES,
  cadenceOn,
  dueSources,
  isDue,
} from "../lib/ops/refresh-cadence.ts";

const ROOT = resolve(import.meta.dirname, "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("every source states a cadence reason and what it governs", () => {
  assert.ok(REFRESH_SOURCES.length > 0);
  for (const s of REFRESH_SOURCES) {
    assert.ok(s.commands.length > 0, `${s.id} runs nothing`);
    assert.ok(s.governs.length > 0, `${s.id} governs nothing — its diff can never be measured`);
    assert.ok(
      s.why.length > 40,
      `${s.id} has no stated reason for its cadence — "refresh everything daily" is the default that burns a build to learn nothing`,
    );
  }
});

test("weekly runs on Monday only; monthly on the 1st only", () => {
  const meetings = REFRESH_SOURCES.find((s) => s.id === "meetings")!;
  assert.equal(isDue(meetings, day("2026-11-09")), true, "2026-11-09 is a post-election Monday");
  for (const d of ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]) {
    assert.equal(isDue(meetings, day(d)), false, `${d} is not a Monday after elevation ended`);
  }

  const dotgov = REFRESH_SOURCES.find((s) => s.id === "dotgov")!;
  assert.equal(isDue(dotgov, day("2026-09-01")), true);
  assert.equal(isDue(dotgov, day("2026-09-02")), false);
  assert.equal(isDue(dotgov, day("2026-08-31")), false, "a Monday is not the 1st");
});

test("the election elevation expires ON its stated date, not around it", () => {
  const meetings = REFRESH_SOURCES.find((s) => s.id === "meetings")!;
  // expected-future-date: 2026-11-03 is the general election, the last day of
  // the elevated daily window.
  assert.equal(cadenceOn(meetings, day("2026-11-03")), "daily", "the election day itself is still daily");
  assert.equal(cadenceOn(meetings, day("2026-11-04")), "weekly", "the day after falls back");
  assert.equal(cadenceOn(meetings, day("2026-08-24")), "daily");

  // A Wednesday after the election is a genuinely empty run — no source is due,
  // and that is the cadence working rather than a defect.
  assert.equal(dueSources(day("2026-11-04")).length, 0);
  assert.equal(dueSources(day("2026-11-09")).length, 2, "the Monday after picks up both remaining legacy weeklies");
});

test("a source with no elevation is unaffected by the election date", () => {
  const dotgov = REFRESH_SOURCES.find((s) => s.id === "dotgov")!;
  assert.equal(cadenceOn(dotgov, day("2026-08-24")), "monthly");
  assert.equal(cadenceOn(dotgov, day("2026-12-24")), "monthly");
});

/**
 * THE ONE THAT CAN CATCH A REGRESSION NOBODY MEANT.
 *
 * Read the workflow files and enumerate every cron. Only THREE workflows may
 * hold one, and only ONE of those three can produce a commit that a reader can
 * see — the other two commit to `docs/`, which `lib/ops/deploy-paths.ts`
 * classifies as non-shipping and which therefore cost zero builds.
 */
test("exactly three workflows are scheduled, and only one can cost a build", () => {
  const scheduled: { file: string; crons: string[] }[] = [];
  for (const file of readdirSync(WORKFLOWS)) {
    if (!file.endsWith(".yml")) continue;
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    const crons = [...text.matchAll(/^\s*- cron:\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    if (crons.length > 0) scheduled.push({ file, crons });
  }

  assert.deepEqual(
    scheduled.map((s) => s.file).sort(),
    ["intake-tripwire.yml", "job-watch.yml", "refresh-daily.yml"],
    "a scheduled workflow was added or a cron came back — RULING 124 put every data source on refresh-daily.yml, and the two survivors commit only to docs/",
  );

  for (const s of scheduled) {
    assert.equal(
      s.crons.length,
      1,
      `${s.file} holds ${s.crons.length} crons — more than one schedule on one workflow is the duplicate-run shape RULING 78 removed`,
    );
    assert.doesNotMatch(
      s.crons[0],
      /^(\*|0)\s/,
      `${s.file} fires at minute 0 or on every minute — every cron in the world lands on the top of the hour`,
    );
  }
});

test("the five decronned refreshers keep workflow_dispatch and lost their schedule", () => {
  for (const file of [
    "refresh-meetings-snapshot.yml",
    "refresh-fec-snapshot.yml",
    "refresh-legiscan-snapshot.yml",
    "refresh-dotgov-snapshot.yml",
    "refresh-nj-filing.yml",
  ]) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    assert.doesNotMatch(
      text,
      /^\s*- cron:/m,
      `${file} still has a cron — this shell must remain manual-only`,
    );
    assert.match(
      text,
      /workflow_dispatch/,
      `${file} lost its manual trigger — a source must stay runnable by hand`,
    );
    assert.match(
      text,
      /RULING 124/,
      `${file} lost the note saying why its cron went — a removal with no reason is one the next session reverses`,
    );
  }
});

test("FEC and state-roll routines are absent from the scheduled commit-and-build orchestrator", () => {
  assert.equal(REFRESH_SOURCES.some((source) => source.id === "fec" || source.id === "legiscan"), false);
  const daily = readFileSync(join(WORKFLOWS, "refresh-daily.yml"), "utf8");
  assert.doesNotMatch(daily, /\b(?:fec:fetch|legiscan:fetch)\b/);
  for (const file of ["refresh-fec-snapshot.yml", "refresh-legiscan-snapshot.yml"]) {
    const retired = readFileSync(join(WORKFLOWS, file), "utf8");
    assert.doesNotMatch(retired, /pnpm (?:fec:fetch|legiscan:fetch)|git\s+(?:add|commit|push)|next\s+build|netlify/i);
  }
});

test("every source the orchestrator knows about governs a path under data/", () => {
  // If a source governed something outside data/, the workflow's single
  // `git diff -- data/` would miss it and the run would commit nothing while
  // reporting success — RULING 100's partial, in a workflow.
  for (const s of REFRESH_SOURCES) {
    for (const g of s.governs) {
      assert.match(g, /^data\//, `${s.id} governs ${g}, which the workflow's diff does not watch`);
    }
  }
});
