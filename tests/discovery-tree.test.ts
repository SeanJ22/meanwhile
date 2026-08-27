import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  type Branch,
  RECALL_WINDOW_DAYS,
  daysBetween,
  independentBranchCount,
  isEvidencedByBranches,
  isValidBranch,
  staleness,
  verdictOf,
} from "../lib/hunt/discovery.ts";
import { isEvidencedAbsence } from "../lib/ballot/hunt-state.ts";
import { currentLawText } from "../lib/governance/current-law.ts";

/**
 * **RULING 52 — discovery is a tree, not a ladder.**
 * **RULING 53 — recorded absences expire.**
 * (Both adopted 2026-08-21, NH Hunt 3, and both are law in `CLAUDE.md`.)
 *
 * The rulings were adopted because three walls this repo had written down as
 * permanent fell in a single session, and two of them were recorded as OURS:
 *
 * - `gc.nh.gov`, recorded as refusing every client this project has, browsers
 *   included, answers rung 2 at HTTP 200.
 * - `sos.nh.gov` stayed walled host-wide from 2026-08-13 until rung 5.
 * - Kearsarge's nine board emails sat in the page's own `href`s after two
 *   separate sessions recorded them as honest absences.
 *
 * Each of those had a defensible RUNG history. That is the point: rungs prove
 * the retrieval discipline was followed on one route, and none of them proves
 * a second route was ever tried.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const branch = (over: Partial<Branch> = {}): Branch => ({
  branch: "a route",
  attemptedAt: "2026-08-21",
  result: "nothing",
  found: false,
  ...over,
});

/* ─────────────────────────── the tree ──────────────────────────────────── */

test("branches through the same host are ONE branch", () => {
  // Three fetches of one host with different headers are not three routes.
  // They are one route walked at three rungs, and counting them as three is
  // exactly how `gc.nh.gov` came to be recorded as refusing everything.
  const same = [
    branch({ branch: "plain fetch", through: "gc.nh.gov", rung: "2" }),
    branch({ branch: "browser headers", through: "gc.nh.gov", rung: "3" }),
    branch({ branch: "curl", through: "GC.NH.GOV", rung: "4" }),
  ];
  assert.equal(independentBranchCount(same), 1);
});

test("branches through different publishers count separately", () => {
  assert.equal(
    independentBranchCount([
      branch({ through: "sos.nh.gov" }),
      branch({ through: "kearsarge.org" }),
      branch({ through: "archive.org" }),
    ]),
    3,
  );
});

test("a branch with no declared dependency counts for itself", () => {
  assert.equal(
    independentBranchCount([branch({ branch: "a records request" }), branch({ through: "x.gov" })]),
    2,
  );
});

test("an empty branch is a measurement, never a verdict", () => {
  assert.equal(verdictOf([branch({ found: false })]), "not-found-yet");
});

test("two branches producing different values is DIVERGENT, not resolved", () => {
  // Where the two do not reconcile, that is the finding and it renders as one.
  // Quietly preferring one branch would be the product picking a winner between
  // two sourced claims, which is not a thing it is allowed to do.
  const values = new Map<Branch, string>();
  const a = branch({ branch: "state filing", found: true });
  const b = branch({ branch: "town clerk", found: true });
  values.set(a, "603-555-0100");
  values.set(b, "603-555-0199");
  assert.equal(verdictOf([a, b], (x) => values.get(x) ?? null), "divergent");
});

test("two branches agreeing is simply found", () => {
  const a = branch({ found: true });
  const b = branch({ found: true });
  assert.equal(verdictOf([a, b], () => "same"), "found");
});

/* ──────────────────────── the absence record ───────────────────────────── */

test("an absence needs two INDEPENDENT branches, not two attempts at one door", () => {
  const oneDoor = {
    checkedAt: "2026-08-21",
    branches: [
      branch({ branch: "plain fetch", through: "town.gov" }),
      branch({ branch: "browser headers", through: "town.gov" }),
    ],
  };
  assert.equal(isEvidencedByBranches(oneDoor), false, "one host is one branch");

  const twoDoors = {
    checkedAt: "2026-08-21",
    branches: [
      branch({ branch: "the town's own page", through: "town.gov" }),
      branch({ branch: "the county's roster", through: "county.gov" }),
    ],
  };
  assert.equal(isEvidencedByBranches(twoDoors), true);
});

test("a branch that FOUND the thing is not evidence the thing is absent", () => {
  assert.equal(
    isEvidencedByBranches({
      checkedAt: "2026-08-21",
      branches: [
        branch({ through: "a.gov", found: true }),
        branch({ through: "b.gov", found: false }),
      ],
    }),
    false,
  );
});

test("no branches and no date are each fatal on their own", () => {
  const two = [branch({ through: "a.gov" }), branch({ through: "b.gov" })];
  assert.equal(isEvidencedByBranches({ checkedAt: "2026-08-21", branches: [] }), false);
  assert.equal(isEvidencedByBranches({ branches: two }), false);
  assert.equal(isEvidencedByBranches({ checkedAt: "August 21st", branches: two }), false);
  // "Not found" without branches and a date is not a valid record. RULING 52.
  assert.equal(isEvidencedByBranches({}), false);
});

test("a branch missing any of its four required fields is invalid", () => {
  assert.equal(isValidBranch(branch()), true);
  assert.equal(isValidBranch({ ...branch(), branch: "" }), false);
  assert.equal(isValidBranch({ ...branch(), result: "  " }), false);
  assert.equal(isValidBranch({ ...branch(), attemptedAt: "yesterday" }), false);
  const { found: _f, ...noFound } = branch();
  assert.equal(isValidBranch(noFound), false);
});

test("the candidate absence record now REQUIRES branches, not only rungs", () => {
  // The shape that was valid before RULING 52: rungs, a date, and no second
  // route. It is the shape every wrong verdict had.
  assert.equal(
    isEvidencedAbsence({
      state: "VERIFIED_ABSENT",
      checkedAt: "2026-08-21",
      rungs: [{ rung: "2", attemptedAt: "2026-08-21", result: "404" }],
    } as never, "campaignSite"),
    false,
    "rungs alone can no longer earn an absence",
  );
});

/* ────────────────────────── RULING 53, staleness ───────────────────────── */

test("the windows are RULING 53's, exactly", () => {
  assert.equal(RECALL_WINDOW_DAYS.candidateField, 7);
  assert.equal(RECALL_WINDOW_DAYS.bodyOrRoster, 14);
  assert.equal(RECALL_WINDOW_DAYS.walledSource, 14);
});

test("a candidate field goes stale after seven days", () => {
  assert.equal(staleness("candidateField", "2026-08-21", "2026-08-27").stale, false);
  assert.equal(staleness("candidateField", "2026-08-21", "2026-08-28").stale, false, "day 7 is in");
  assert.equal(staleness("candidateField", "2026-08-21", "2026-08-29").stale, true);
});

test("a wall expires on the same clock however emphatically it was recorded", () => {
  // The clause exists because `gc.nh.gov` and `sos.nh.gov` were both recorded
  // emphatically and both were wrong.
  assert.equal(staleness("walledSource", "2026-08-01", "2026-08-21").stale, true);
  assert.equal(staleness("walledSource", "2026-08-15", "2026-08-21").stale, false);
});

test("a record that cannot say when it was measured reads as STALE", () => {
  // Defaulting the other way is how a bad date buys permanent trust.
  assert.equal(staleness("bodyOrRoster", null, "2026-08-21").stale, true);
  assert.equal(staleness("bodyOrRoster", "not a date", "2026-08-21").stale, true);
  assert.equal(staleness("bodyOrRoster", undefined, "2026-08-21").ageDays, null);
});

test("day arithmetic does not drift across a month or a DST boundary", () => {
  assert.equal(daysBetween("2026-08-21", "2026-09-04"), 14);
  assert.equal(daysBetween("2026-10-25", "2026-11-08"), 14, "Eastern DST ends inside this window");
  assert.equal(daysBetween("2026-08-21", "2026-08-21"), 0);
});

/* ─────────────────────────── the law itself ────────────────────────────── */

test("RULING 52 and RULING 53 are law in CLAUDE.md, with their rationale", () => {
  /*
   * A stripped rule reads as guidance. `CLAUDE.md` says so about its own
   * rulings repeatedly, so the rationale is asserted rather than assumed —
   * including the locked-building passage, which is the part that makes the
   * difference between "try harder" and "a ladder has one direction".
   */
  const law = currentLawText(ROOT);
  assert.match(law, /RULING 52/, "RULING 52 is written into the constitution");
  assert.match(law, /RULING 53/, "RULING 53 is written into the constitution");
  assert.match(law, /front door is locked/i, "the locked-building rationale is attached");
  assert.match(
    law,
    /no branch result is permanent/i,
    "the second half is stated, and it is not separable from the first",
  );
  assert.match(law, /Persistence, not circumvention/i, "the two prohibitions survive");
});

test("the staleness instrument reads every dated wiring row, and states what it cannot", () => {
  /*
   * Stated N equals rendered rows, applied to the instrument itself. `pnpm
   * stale` parses `source-wiring.ts` as source rather than importing it (the
   * registry graph reaches node:fs), so the shape it depends on is pinned here
   * — a wiring row that stopped matching would silently shrink the denominator
   * and the report would read healthier for having looked at less.
   */
  const wiring = readFileSync(join(ROOT, "lib", "registry", "source-wiring.ts"), "utf8");
  const dated = wiring.match(/verifiedAt:\s*"\d{4}-\d{2}-\d{2}"/g) ?? [];
  const declarations = wiring.match(/verifiedAt:\s*string;/g) ?? [];
  const all = wiring.match(/verifiedAt:/g) ?? [];
  assert.ok(dated.length > 30, `expected the wiring rows' dates, found ${dated.length}`);
  assert.equal(
    dated.length + declarations.length,
    all.length,
    "every `verifiedAt` is either a dated row or the type declaration; a third " +
      "shape means the stale reporter is walking past rows without counting them",
  );

  // And the instrument must NAME what it does not cover, because a coverage
  // gap that is not stated reads as coverage.
  const reporter = readFileSync(join(ROOT, "scripts", "stale.mts"), "utf8");
  assert.match(reporter, /NOT_COVERED/, "the reporter enumerates its own blind spots");
  assert.match(reporter, /so the number above is a floor/, "and says the total is a floor");
});

test("no wall in CLAUDE.md is stated as a standing property", () => {
  /*
   * RULING 52: a source recorded as walled is recorded with the date it was
   * last tested, never as a standing property. `gc.nh.gov` was in this file as
   * refusing every client this project has — a permanent-sounding sentence
   * about a host that answers a plain fetch at 200.
   *
   * The check is narrow on purpose: it looks for the specific host strings this
   * session corrected, and fails if any of them reappears without a date near
   * it. A broader "no wall language anywhere" rule would fire on the ladder's
   * own description of what a wall IS.
   */
  const law = currentLawText(ROOT);
  const HOSTS = ["gc.nh.gov", "sos.nh.gov", "kearsarge.org"];
  const undated: string[] = [];
  /*
   * By PARAGRAPH, not by line. The first version of this check read one line at
   * a time and failed against correct prose: `CLAUDE.md` is hard-wrapped, so a
   * host and the date it was last tested routinely sit on adjacent lines. A
   * guard whose granularity is finer than the unit of meaning reports the right
   * rule against the wrong text, and the fix is the granularity rather than the
   * paragraph.
   */
  /*
   * By RECORD, not by paragraph — the same reasoning one level up, applied
   * again after the 2026-08-26 governance migration.
   *
   * Current law is now generated per record, and each record opens with a
   * metadata line carrying its adopted date. RULING 166 writes its measurements
   * as "on the day it was adopted" and names `gc.nh.gov` three paragraphs
   * later, so a paragraph-granular check reports a standing-property violation
   * against text that is dated — by its own record, one paragraph up.
   *
   * The rule is unchanged and still binding: a wall is recorded with the date
   * it was last tested, never as a standing property. What moved is the unit
   * the date attaches to.
   */
  for (const record of law.split(/\n(?=## )/)) {
    for (const host of HOSTS) {
      if (!record.includes(host)) continue;
      if (!/\d{4}-\d{2}-\d{2}/.test(record)) {
        undated.push(`${host}: ${record.replace(/\s+/g, " ").trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(
    undated,
    [],
    `these name a host without the date it was last tested: ${undated.join(" | ")}`,
  );
});
