import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import {
  globalIntegrityLine,
  globalIntegrityStatus,
  unqualifiedGlobalClaims,
} from "../lib/ops/integrity-claim.ts";

/**
 * **A MEASURED ZERO MAY NOT BECOME A PRODUCT-WIDE ZERO.** (2026-08-27.)
 *
 * `pnpm coverage` reports three numbers and refuses to add them:
 * `INTEGRITY DEFECTS 0 · COVERAGE GAPS 8 · SURFACES NOT MEASURABLE 16`. The
 * instrument's own prose says, on every run, that the zero describes the
 * surfaces it measures "and about nothing else".
 *
 * A session report then compressed it to "0 integrity defects" — and within a
 * day a tester found a reader-visible integrity defect on Ask, which was one of
 * the sixteen surfaces the instrument could not see. The compression was not a
 * wording slip; it was the difference between a true statement and a false one.
 *
 * These tests are the guard against it happening again, and they run over the
 * repository's own prose rather than over a fixture.
 */

const ROOT = process.cwd();

/* ------------------------------------------------------------- the verdict */

test("an unmeasured surface makes the global question OPEN, whatever the count is", () => {
  /* The order matters: unmeasured decides FIRST. A clean measured run with one
     blind spot is not "clean with a caveat" — the caveat is the whole answer. */
  assert.equal(
    globalIntegrityStatus({ measured: 20, unmeasured: 16, defects: 0 }),
    "NOT_ESTABLISHED",
  );
  assert.equal(
    globalIntegrityStatus({ measured: 20, unmeasured: 1, defects: 0 }),
    "NOT_ESTABLISHED",
    "one blind spot is enough — this is the exact shape Ask was in",
  );
  assert.equal(
    globalIntegrityStatus({ measured: 20, unmeasured: 0, defects: 0 }),
    "NO_DEFECTS_OVER_FULL_SCOPE",
  );
  assert.equal(
    globalIntegrityStatus({ measured: 20, unmeasured: 0, defects: 3 }),
    "DEFECTS_FOUND",
  );
});

test("the printed line always carries its denominator", () => {
  const line = globalIntegrityLine({ measured: 20, unmeasured: 16, defects: 0 });
  assert.match(line, /MEASURED_INTEGRITY_DEFECTS 0 of 20 measured surface\(s\)/);
  assert.match(line, /UNMEASURED_SURFACES 16/);
  assert.match(line, /GLOBAL_INTEGRITY_STATUS NOT_ESTABLISHED/);

  /* And the line the instrument prints must itself survive the guard. */
  assert.deepEqual(unqualifiedGlobalClaims(line), []);
});

/* --------------------------------------------------------- the guard itself */

test("PLANTED: the compressed claim is caught", () => {
  /*
   * The literal sentence that was written, and the shapes closest to it. If
   * this guard cannot catch these, it is decoration.
   */
  for (const planted of [
    "The session found 0 integrity defects.",
    "Result: zero integrity defects across the product.",
    "integrity defects: 0",
    "We shipped with no integrity defects.",
  ]) {
    const hits = unqualifiedGlobalClaims(planted);
    assert.equal(
      hits.length,
      1,
      `the guard did not catch an unqualified claim: ${JSON.stringify(planted)}`,
    );
  }
});

test("a claim that STATES its denominator is not flagged", () => {
  /*
   * The other half, and the half that decides whether this guard is usable: it
   * has to be safe over prose that legitimately discusses defect counts, or it
   * would simply be switched off.
   */
  for (const honest of [
    "0 integrity defects over 20 measured surfaces, with 16 surfaces not measurable.",
    "MEASURED_INTEGRITY_DEFECTS 0 of 20 measured surface(s) · UNMEASURED_SURFACES 16 · GLOBAL_INTEGRITY_STATUS NOT_ESTABLISHED",
    "The instrument reported 0 integrity defects. 16 surfaces remain unmeasured, each named.",
  ]) {
    assert.deepEqual(
      unqualifiedGlobalClaims(honest),
      [],
      `a qualified claim was flagged: ${JSON.stringify(honest)}`,
    );
  }
});

/* ------------------------------------------------- the sweep over real prose */

test("no document in this repository states a global zero-defect claim", () => {
  /*
   * The standing sweep, over every document that WOULD BE COMMITTED — tracked
   * files plus new ones git does not ignore.
   *
   * The first version asked `git ls-files` for TRACKED files only, and
   * `tests/gate-ordering.test.ts` caught it immediately: a session record
   * written but not yet staged is exactly the document most likely to carry a
   * fresh compressed claim, and it would have been invisible to this sweep on
   * the one run that mattered.
   */
  const listed = filesThatWouldBeCommitted({
    cwd: ROOT,
    paths: ["docs/*.md", "docs/**/*.md"],
  });

  assert.ok(
    listed.length >= 5,
    `only ${listed.length} document(s) swept — the sweep found nothing to read and would pass vacuously`,
  );

  const offenders: string[] = [];
  for (const rel of listed) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    for (const hit of unqualifiedGlobalClaims(text)) {
      offenders.push(`${rel}: …${hit}…`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} document(s) state a zero-defect result with no denominator. ` +
      "A defect count describes the surfaces that were MEASURED. Say how many were measured " +
      "and how many were not, or say GLOBAL_INTEGRITY_STATUS NOT_ESTABLISHED:\n" +
      offenders.join("\n"),
  );
});

test("the coverage instrument prints the verdict it is required to print", () => {
  /*
   * Pinned against the SOURCE rather than by running the instrument, which
   * takes minutes and reads several large stores. The coupling being asserted
   * is that the summary block calls the shared line-builder at all — if someone
   * hand-rolls the summary again, the guard above stops applying to it.
   */
  const src = readFileSync(join(ROOT, "scripts/coverage-four-layer.mts"), "utf8");
  assert.match(
    src,
    /globalIntegrityLine\(/,
    "the coverage summary no longer prints the shared global-integrity verdict",
  );
  assert.match(
    src,
    /These are three different things and are never summed\./,
    "the three-counts rule left the summary",
  );
});
