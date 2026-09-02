/**
 * Declared source stamps — and the CI failure that produced this file.
 *
 * A generator over committed inputs must not read the clock (RULING 107), and
 * its artifact must be reproducible (RULING 92). The first fix for that asked
 * git for each source's last commit date, which is correct on a full clone.
 *
 * **`actions/checkout` clones with `fetch-depth: 1`.** On a shallow clone there
 * is exactly one commit, so `git log -1 -- <any file>` returns the TIP's date
 * for every file — with no error and no warning. `main` went red at `a6c72a7`
 * with the artifact stamped `2026-08-20` locally and regenerated as
 * `2026-08-24` on the runner.
 *
 * So the value is DECLARED now, and these guards hold the two halves that
 * matter: a declaration cannot be malformed, and where git CAN answer it must
 * agree — which is the check that would have caught a wrong constant before it
 * shipped, on the machine that had the history.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  declaredSourceStamp,
  isShallowClone,
  verifyAgainstGit,
  judgeStamp,
} from "../lib/ops/source-stamp.ts";

const ROOT = process.cwd();

describe("a declared stamp cannot be wrong by accident", () => {
  it("accepts a well-formed declaration", () => {
    assert.equal(
      declaredSourceStamp({ readOn: "2026-08-20", sources: ["data/reference/x.csv"] }),
      "2026-08-20",
    );
  });

  it("REFUSES a malformed date rather than coercing it", () => {
    // A malformed date silently becoming a valid-looking one is how this whole
    // class of defect works.
    for (const bad of ["2026-8-20", "20 August 2026", "", "today", "2026/08/20"]) {
      assert.throws(
        () => declaredSourceStamp({ readOn: bad, sources: ["a.csv"] }),
        /not a YYYY-MM-DD date/,
        `"${bad}" was accepted`,
      );
    }
  });

  it("REFUSES a stamp that describes no sources", () => {
    assert.throws(() => declaredSourceStamp({ readOn: "2026-08-20", sources: [] }), /no source/);
  });
});

describe("git verification reports rather than guesses", () => {
  it("says UNVERIFIABLE on a shallow clone instead of returning the tip's date", () => {
    // The failure this whole file exists for. On CI `isShallowClone` is true,
    // and the verdict must be a could-not-tell — never an agreement, and never
    // a disagreement either, because neither is knowable there.
    const verdict = verifyAgainstGit({
      readOn: "2026-08-20",
      sources: ["data/reference/census_govt_units_2022.csv"],
    });
    if (isShallowClone()) {
      assert.equal(verdict.kind, "UNVERIFIABLE");
      assert.match((verdict as { why: string }).why, /shallow/);
    } else {
      assert.notEqual(verdict.kind, "UNVERIFIABLE", "full history but nothing could be read");
    }
  });

  it("every declared stamp in the tree AGREES with git, where git can answer", () => {
    /*
     * This is the guard that would have caught the wrong constant before it
     * shipped. It runs for real on a developer machine with full history and
     * reports UNVERIFIABLE on CI — which is honest rather than useless: the
     * value is declared, so CI does not need git to reproduce the artifact, and
     * the person who edits the constant has the history to check it against.
     *
     * **TWO GATES, TWO CLONE DEPTHS, TWO ANSWERS** (2026-09-02). "CI" above is
     * not one place. `build-check.yml` — the gate every PR passes — checks out
     * at depth 1, so this test SKIPS there. `refresh-daily.yml` checks out with
     * `fetch-depth: 0` because `push-main.mjs` has to rebase, so this test RUNS
     * there, on whatever `main` carries. Commit 7514e68e (2026-09-01) moved
     * `data/hunt/wikipedia-nj-morris.json` without moving
     * `build-nj-rosters.mts`'s declaration: the PR gate could not see it, the
     * next two scheduled refreshes could, and both went red on a defect that
     * was already on `main` — with every governed artifact's data thrown away
     * behind it.
     *
     * They cannot be made to ask the SAME question cheaply: the full answer
     * needs every commit that ever touched each source, and the PR gate
     * deliberately does not fetch a 311 MiB pack per run (see the merge-base
     * note in build-check.yml). What the PR gate CAN ask is narrower and
     * sufficient for its purpose — "did THIS change move a source without
     * moving its declaration" — from the PR's own base..head diff, which needs
     * no history. Until it does, this asymmetry is the stated reason a
     * scheduled refresh can go red on a stamp a merged PR never saw.
     */
    if (isShallowClone()) {
      assert.ok(true, "shallow clone — verification is not available here, and says so");
      return;
    }

    const declarations: { file: string; readOn: string; sources: string[] }[] = [];
    for (const name of readdirSync(join(ROOT, "scripts"))) {
      if (!/\.mts$/.test(name)) continue;
      const src = readFileSync(join(ROOT, "scripts", name), "utf8");
      if (!src.includes("declaredSourceStamp(")) continue;
      const readOn = /readOn:\s*"(\d{4}-\d{2}-\d{2})"/.exec(src)?.[1];
      const list = /const SOURCE_FILES = \[([\s\S]*?)\] as const;/.exec(src)?.[1] ?? "";
      const sources = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      assert.ok(readOn, `${name} calls declaredSourceStamp with no literal readOn to check`);
      assert.ok(sources.length > 0, `${name} declares no SOURCE_FILES this guard can read`);
      declarations.push({ file: name, readOn: readOn!, sources });
    }

    assert.ok(
      declarations.length >= 2,
      `expected the sweep to find the declaring generators, saw ${declarations.length}`,
    );

    const wrong: string[] = [];
    for (const d of declarations) {
      const verdict = verifyAgainstGit({ readOn: d.readOn, sources: d.sources });
      if (verdict.kind === "DISAGREES") {
        wrong.push(`${d.file}: declares ${verdict.declared}, git says ${verdict.newest}`);
      }
    }
    assert.deepEqual(
      wrong,
      [],
      "a declared source stamp disagrees with its sources' own history. Either the sources moved " +
        "and the declaration was not updated in the same commit, or the declaration is a typo.",
    );
  });
});

describe("the midnight tolerance, in both directions", () => {
  /*
   * Written from the failure rather than from the fix. On 2026-08-25 the whole
   * local suite went red on
   * `build-nj-rosters.mts: declares 2026-08-24, git says 2026-08-25` — an
   * artifact whose own body carries `walkedAt: "2026-08-24"`, committed at
   * 00:38 America/Phoenix by a session that had been running since the evening
   * before. Nothing had drifted; the guard was measuring the distance to
   * midnight, and CI could not see it because CI is a shallow clone.
   */
  it("a declaration ONE DAY BEHIND the newest commit agrees, and says it was tolerated", () => {
    const v = judgeStamp("2026-08-24", "2026-08-25");
    assert.equal(v.kind, "AGREES");
    assert.equal((v as { oneDayBehind?: true }).oneDayBehind, true);
  });

  it("an exact match agrees WITHOUT the tolerance flag, so the two are distinguishable", () => {
    const v = judgeStamp("2026-08-25", "2026-08-25");
    assert.equal(v.kind, "AGREES");
    assert.equal((v as { oneDayBehind?: true }).oneDayBehind, undefined);
  });

  it("TWO days behind is drift and still fails — the tolerance is a clock boundary, not a grace period", () => {
    assert.equal(judgeStamp("2026-08-23", "2026-08-25").kind, "DISAGREES");
  });

  it("a declaration NEWER than any commit fails, because that is the fabrication direction", () => {
    /*
     * RULING 107. A read stamp claiming a day for which no commit exists is a
     * claim about a read whose evidence is not in the tree, and a confident
     * wrong date suppresses the re-walk that would have caught the staleness.
     * One day is not tolerated here even though one day IS tolerated the other
     * way, and the asymmetry is the rule rather than an oversight.
     */
    assert.equal(judgeStamp("2026-08-26", "2026-08-25").kind, "DISAGREES");
  });

  it("crosses a month boundary correctly — 08-31 is the day before 09-01", () => {
    assert.equal(judgeStamp("2026-08-31", "2026-09-01").kind, "AGREES");
    assert.equal(judgeStamp("2026-12-31", "2027-01-01").kind, "AGREES");
  });
});
