/**
 * **RULING 62 — A TEST FILE MAY NOT LOSE GUARDS SILENTLY** (2026-08-21, NH Hunt
 * 6 item 1).
 *
 * The mechanism and the reasoning live in `scripts/guard-census.mjs`. This is
 * the half that runs in the suite: recompute the census from what is on disk,
 * and fail — by NAME — when a guard that was recorded is no longer there.
 *
 * The one thing worth repeating here, because a reader lands on this file when
 * it goes red: **the census is not a lock.** A guard is allowed to leave. It
 * has to leave the census in the same commit, which turns a silent deletion
 * into a diff carrying the removed names. Run:
 *
 * ```
 * corepack pnpm guard:census --write --allow-removals
 * ```
 *
 * and the names below land in `tests/guard-census.json` as deleted lines, where
 * a reader sees them. If you did NOT mean to remove them, you have just found
 * an overwrite — restore the file rather than the census.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCensus,
  guardsIn,
  lostGuards,
  readCensus,
  totals,
} from "../scripts/guard-census.mjs";

const recorded = readCensus();
const computed = computeCensus();

test("RULING 62 — the guard census is committed", () => {
  assert.ok(
    recorded !== null,
    "tests/guard-census.json is missing. Run: corepack pnpm guard:census --write",
  );
  assert.ok(
    recorded.files && Object.keys(recorded.files).length > 0,
    "the census records no files, which cannot be true of this repo",
  );
});

test("RULING 62 — no recorded guard has stopped existing", () => {
  const losses = lostGuards(recorded ?? { files: {} }, computed);
  const lines: string[] = [];
  for (const loss of losses) {
    lines.push(`${loss.file} (${loss.kind})`);
    for (const n of loss.names) lines.push(`    ${n}`);
    if (loss.dynamic > 0) lines.push(`    + ${loss.dynamic} dynamically-named`);
  }
  assert.equal(
    losses.length,
    0,
    "guards that stopped existing since the census was written:\n" +
      `${lines.join("\n")}\n\n` +
      "If this was an accident — an overwrite, a bad merge — restore the file.\n" +
      "If it was deliberate, run: corepack pnpm guard:census --write --allow-removals",
  );
});

test("RULING 62 — the census totals agree with the census body", () => {
  // A hand-edited census would show up here first, and the file says it is
  // written by the script and never by hand.
  const t = totals(recorded?.files ?? {});
  assert.deepEqual(
    t,
    recorded?.totals,
    "tests/guard-census.json's totals block disagrees with its own files block — " +
      "it was hand-edited. Run: corepack pnpm guard:census --write",
  );
});

/* ========================================================================== */
/* The extractor itself, because a census built by a broken reader is worse    */
/* than no census — it reports clean while seeing nothing.                     */
/* ========================================================================== */

test("RULING 62 — the extractor finds named guards and ignores prose", () => {
  const source = [
    'import test from "node:test";',
    "// test(\"this is a comment\") — indented calls still count, commented ones",
    'test("a plain guard", () => {});',
    "  it.skip('an indented skipped guard', () => {});",
    'describe("a suite", () => {',
    '  test("a nested guard", () => {});',
    "});",
    "const notATest = latest(\"nope\");",
  ].join("\n");
  const { names } = guardsIn(source);
  assert.ok(names.includes("a plain guard"));
  assert.ok(names.includes("an indented skipped guard"));
  assert.ok(names.includes("a nested guard"));
  assert.ok(names.includes("a suite"));
  assert.ok(
    !names.some((n) => n === "nope"),
    "`latest(...)` is not a test call and must not be counted as one",
  );
});

test("RULING 62 — a dynamically-named guard is counted, not named", () => {
  const source = ["const zip = '03255';", "test(`walks ${zip}`, () => {});"].join("\n");
  const { names, dynamic } = guardsIn(source);
  assert.deepEqual(names, []);
  assert.equal(dynamic, 1, "an interpolated name has no stable identity, so it is counted");
});

test("RULING 62 — a removal is detected by NAME, not by count", () => {
  // The failure this ruling exists for: eight guards deleted, guards added in
  // the same write, the total unchanged. A count sees nothing. Names see it.
  const before = {
    "tests/x.test.ts": { names: ["alpha", "beta", "gamma"], dynamic: 0 },
  };
  const after = {
    "tests/x.test.ts": { names: ["alpha", "delta", "epsilon"], dynamic: 0 },
  };
  assert.equal(
    Object.values(before)[0].names.length,
    Object.values(after)[0].names.length,
    "the fixture must hold the count constant, or it is not testing this",
  );
  const losses = lostGuards({ files: before }, after);
  assert.equal(losses.length, 1);
  assert.deepEqual(losses[0].names, ["beta", "gamma"]);
});

test("RULING 62 — a whole file disappearing is reported with its guards", () => {
  const losses = lostGuards(
    { files: { "tests/gone.test.ts": { names: ["one", "two"], dynamic: 1 } } },
    {},
  );
  assert.equal(losses.length, 1);
  assert.equal(losses[0].kind, "file-gone");
  assert.deepEqual(losses[0].names, ["one", "two"]);
});

test("RULING 62 — adding a guard is never a loss", () => {
  const losses = lostGuards(
    { files: { "tests/x.test.ts": { names: ["alpha"], dynamic: 0 } } },
    { "tests/x.test.ts": { names: ["alpha", "beta"], dynamic: 3 } },
  );
  assert.deepEqual(losses, [], "a rule that blocked new tests would be a rule against testing");
});
