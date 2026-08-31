/**
 * **RULING 222 — THE SCOPE GUARD.** (WGH-22, adopted 2026-08-31.)
 *
 * ```
 *   BEFORE a confirmed address   the scope is the ZIP: every governing entity
 *                                intersecting it
 *   AFTER  a confirmed address   the scope IS the address: only entities that
 *                                govern that address
 * ```
 *
 * The show-everything rule guarantees completeness WITHIN the correct scope.
 * It never licensed displaying entities the system has determined do not
 * govern the reader. **A "not yours" label on a governing-entities surface is
 * prohibited** — an entity that is not theirs is out of scope, not annotated.
 *
 * ## Why this is a repo sweep and not only a unit test
 *
 * Because the class has now recurred three times (WGH-12, WGH-15, WGH-22) and
 * each repair improved the ANNOTATION. A unit test over the splitter cannot
 * stop a fourth surface from growing its own label; a sweep over the reader
 * components can. Every guard here names the artefact it refuses, so a session
 * reintroducing one has to delete a test that says why.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  excludedByAddress,
  scopedToAddress,
  type ResolvedLocation,
} from "../lib/state/resolved-location.ts";

const SLDL_17 = "ocd-division/country:us/state:az/sldl:17";
const SLDL_19 = "ocd-division/country:us/state:az/sldl:19";
const SCHOOL_A = "ocd-division/country:us/state:az/school_district:vail_unified_district";
const SCHOOL_B = "ocd-division/country:us/state:az/school_district:empire_elementary_district";

function atAddress(): ResolvedLocation {
  return {
    certainty: "ADDRESS_RESOLVED",
    zip: "85641",
    confirmedDivisionIds: [SLDL_17, SCHOOL_A],
    splitLevels: [],
  };
}

function zipOnlyLocation(): ResolvedLocation {
  return {
    certainty: "SELF_DECLARED_ZIP",
    zip: "85641",
    confirmedDivisionIds: [],
    splitLevels: [],
  };
}

test("RULING 222: a confirmed address removes the districts it excludes", () => {
  const rows = [{ ocdId: SLDL_17 }, { ocdId: SLDL_19 }];
  assert.deepEqual(
    scopedToAddress(rows, atAddress()).map((r) => r.ocdId),
    [SLDL_17],
    "the district the address ruled out is out of scope",
  );
  assert.deepEqual(
    excludedByAddress(rows, atAddress()).map((r) => r.ocdId),
    [SLDL_19],
    "and it was found and set aside, not never found",
  );
});

test("RULING 222: without a confirmed address nothing is removed", () => {
  const rows = [{ ocdId: SLDL_17 }, { ocdId: SLDL_19 }];
  assert.equal(
    scopedToAddress(rows, zipOnlyLocation()).length,
    2,
    "the ZIP scope is complete and unpartitioned",
  );
  assert.equal(excludedByAddress(rows, zipOnlyLocation()).length, 0);
});

test("RULING 222 does NOT reach a row that was never ruled out", () => {
  /*
   * The ruling drops what the system DETERMINED does not govern the reader.
   * A school district at an overlapping level has been determined nothing
   * about — a reader is routinely inside an elementary district and a regional
   * high school district at once — so dropping it would be the manufactured
   * claim `CLAUDE.md` forbids, made in the other direction.
   */
  const kept = scopedToAddress([{ ocdId: SCHOOL_B }], atAddress());
  assert.equal(kept.length, 1);
  assert.equal(kept[0].standing, "OVERLAP_NOT_RULED_OUT");
});

/* ─────────────────────── the class sweep over the surfaces ─────────────── */

/**
 * Every `.tsx` under the reader component tree. Read with `git`-independent
 * traversal so an UNTRACKED new surface is swept too — an untracked file is
 * invisible to a repo guard that asks git for its file list, which is how a
 * new component gets a free pass on every rule until someone stages it.
 */
function readerComponents(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".tsx")) continue;
      out.push({ path: full, source: readFileSync(full, "utf8") });
    }
  };
  walk("components");
  walk("app");
  return out;
}

/**
 * Comments are stripped before every copy assertion below.
 *
 * The guards in this file refuse strings that the code they guard must be able
 * to DISCUSS — this file itself quotes the banned sentence in its own header,
 * and so does the component that deleted it. A sweep that reads raw text marks
 * the explanation as the defect, which is how a guard teaches the next session
 * to delete the explanation instead of the code.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ");
}

test("RULING 222: no reader surface renders a 'not yours' exclusion label", () => {
  const offenders: string[] = [];
  for (const { path, source } of readerComponents()) {
    const code = withoutComments(source);
    if (/not yours/i.test(code) || /covers another part of/i.test(code)) {
      offenders.push(path);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "an entity that is not the reader's is out of scope, never annotated (RULING 222)",
  );
});

test("RULING 222: no reader surface renders a row it knows is ELSEWHERE_IN_ZIP", () => {
  /*
   * The structural half. A surface may COMPUTE the standing — that is how the
   * scope filter works — but a component that puts `ELSEWHERE_IN_ZIP` in a
   * `data-` attribute or branches on it to render markup is displaying the row
   * it was supposed to drop.
   *
   * `district-popup.tsx` is the deliberate exception and it is named rather
   * than pattern-matched: it is a BROWSE surface answering "what is this thing
   * I tapped?", where the reader's standing relative to a clicked district is
   * the answer rather than a scope decision.
   */
  const allowed = new Set([join("components", "map", "popup", "district-popup.tsx")]);
  const offenders: string[] = [];
  for (const { path, source } of readerComponents()) {
    if (allowed.has(path)) continue;
    const code = withoutComments(source);
    if (/["']ELSEWHERE_IN_ZIP["']/.test(code)) offenders.push(path);
  }
  assert.deepEqual(
    offenders,
    [],
    "after a confirmed address an excluded row is not on the surface to be marked",
  );
});

test("RULING 222: the who-governs card scopes its lists to the address", () => {
  /*
   * The wiring, pinned by the FUNCTION rather than by a line number. The 8/28
   * repair failed because one list on this card called the annotator and
   * another called nothing at all; the guard follows the call so a new list
   * cannot quietly skip it.
   */
  const source = readFileSync(join("components", "map", "coverage-notice.tsx"), "utf8");
  const code = withoutComments(source);
  assert.ok(
    /scopedToAddress\(bodies,/.test(code),
    "the LOCAL list is scoped to the address, not merely annotated",
  );
  assert.ok(
    !/applyResolvedLocation\(/.test(code),
    "no list on this card annotates without scoping",
  );
  assert.ok(
    /useConfirmedDivisions\(/.test(code),
    "and the reader's own districts are asked for by key",
  );
});
