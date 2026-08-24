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
