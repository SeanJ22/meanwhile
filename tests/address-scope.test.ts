/**
 * Before a confirmed address the scope is the ZIP (every entity intersecting it); after, the scope
 * is the address (only entities that govern it). An entity that is not the reader's is out of
 * scope, never labelled "not yours".
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

test("a confirmed address removes the districts it excludes", () => {
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

test("without a confirmed address nothing is removed", () => {
  const rows = [{ ocdId: SLDL_17 }, { ocdId: SLDL_19 }];
  assert.equal(
    scopedToAddress(rows, zipOnlyLocation()).length,
    2,
    "the ZIP scope is complete and unpartitioned",
  );
  assert.equal(excludedByAddress(rows, zipOnlyLocation()).length, 0);
});

test("address scoping does NOT reach a row that was never ruled out", () => {
  // Only rows determined not to govern the reader are dropped; an overlapping school district was never ruled out.
  const kept = scopedToAddress([{ ocdId: SCHOOL_B }], atAddress());
  assert.equal(kept.length, 1);
  assert.equal(kept[0].standing, "OVERLAP_NOT_RULED_OUT");
});

/* ─────────────────────── the class sweep over the surfaces ─────────────── */

/** Every `.tsx` under the reader component tree, walked without git so untracked files are swept too. */
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

/** Comments are stripped before every copy assertion below, so code may discuss the banned strings. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ");
}

test("no reader surface renders a 'not yours' exclusion label", () => {
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
    "an entity that is not the reader's is out of scope, never annotated",
  );
});

test("no reader surface renders a row it knows is ELSEWHERE_IN_ZIP", () => {
  // `browsing-subject-line.tsx` is a browse surface: standing relative to a tapped district is its answer.
  const allowed = new Set([join("components", "map", "popup", "browsing-subject-line.tsx")]);
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

test("the who-governs card scopes its lists to the address", () => {
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
