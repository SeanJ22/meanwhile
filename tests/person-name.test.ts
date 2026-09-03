import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  INCOMPLETE_NAME_LINE,
  displayPersonName,
  isIncompletePersonName,
  nameTokens,
} from "../lib/officials/person-name.ts";
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";

/**
 * F01-continued item 10a (2026-08-19).
 *
 * Vail Unified's superintendent was carried as "Carruth" — a surname with no
 * given name, which is not a partial answer but a confident wrong one. These
 * hold the detector AND the data, because the detector only matters if
 * something asks it about every person the product holds.
 */

// ── the detector ──────────────────────────────────────────────────────────

test("THE CONTROL: a bare surname is incomplete", () => {
  assert.equal(isIncompletePersonName("Carruth"), true);
  assert.equal(isIncompletePersonName("Superintendent Carruth"), true);
  assert.equal(isIncompletePersonName("Dr. Carruth"), true);
  assert.equal(isIncompletePersonName("Carruth Jr."), true);
});

test("a whole name is not", () => {
  assert.equal(isIncompletePersonName("John Carruth"), false);
  assert.equal(isIncompletePersonName("Dr. Gabriel Trujillo"), false);
  assert.equal(isIncompletePersonName("Linda Harriott-Gathright"), false);
  assert.equal(isIncompletePersonName("Mary-Kate O'Brien"), false);
});

test("REGRESSION: initials at the front are a name, not a credential", () => {
  /*
   * The first version filtered honorifics and suffixes across the WHOLE
   * string, so "J.D." matched the Juris Doctor pattern and came off — which
   * flagged J.D. Mesnard (AZ) and J.D. Bernardy (NH), two sitting state
   * legislators who publish themselves that way, as half-named. Position is
   * the fix: honorifics off the front, suffixes off the back.
   */
  assert.equal(isIncompletePersonName("J.D. Mesnard"), false);
  assert.equal(isIncompletePersonName("J.D. Bernardy"), false);
  assert.equal(isIncompletePersonName("J. Edgar Hoover"), false);
  // …and a real trailing credential still comes off.
  assert.deepEqual(nameTokens("Ann Lee J.D."), ["Ann", "Lee"]);
});

test("empty and missing are incomplete — a blank slot is the same defect wearing less", () => {
  assert.equal(isIncompletePersonName(""), true);
  assert.equal(isIncompletePersonName("   "), true);
  assert.equal(isIncompletePersonName(null), true);
  assert.equal(isIncompletePersonName(undefined), true);
});

test("the display helper renders the named gap, never the fragment", () => {
  assert.equal(displayPersonName("Carruth"), INCOMPLETE_NAME_LINE);
  assert.equal(displayPersonName("John Carruth"), "John Carruth");
  // It is a fact about US, in the gap's own register — never about the person.
  assert.match(INCOMPLETE_NAME_LINE, /^We haven/);
  assert.ok(!/they|their|unknown|missing/i.test(INCOMPLETE_NAME_LINE));
});

// ── the data boundary: no incomplete name may reach a reader ──────────────

const ROOT = process.cwd();
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

test("no person this product holds carries a name that cannot stand as one", () => {
  const offenders: string[] = [];
  let counted = 0;

  for (const file of [
    "lib/registry/officeholders-us.json",
    "data/states/az/officials/officeholders-04.json",
    "data/states/nh/officials/officeholders-33.json",
    "data/states/nj/officials/officeholders-34.json",
  ]) {
    if (!existsSync(join(ROOT, file))) continue;
    const parsed = readJson(file) as { officeholders?: { id: string; name: string }[] };
    for (const holder of parsed.officeholders ?? []) {
      counted += 1;
      if (isIncompletePersonName(holder.name)) {
        offenders.push(`${file} ${holder.id} ${JSON.stringify(holder.name)}`);
      }
    }
  }

  for (const roster of BODY_ROSTERS) {
    for (const member of roster.members) {
      counted += 1;
      if (isIncompletePersonName(member.name)) {
        offenders.push(`${roster.bodyName} ${member.id} ${JSON.stringify(member.name)}`);
      }
    }
  }

  for (const executive of STATEWIDE_EXECUTIVES) {
    counted += 1;
    if (isIncompletePersonName(executive.holder.name)) {
      offenders.push(`statewide ${executive.holder.id} ${JSON.stringify(executive.holder.name)}`);
    }
  }

  for (const file of [
    "data/states/az/ballot/az-pima-2026.json",
    "data/states/nh/ballot/nh-merrimack-2026.json",
    "data/states/nj/ballot/nj-morris-2026.json",
  ]) {
    if (!existsSync(join(ROOT, file))) continue;
    const parsed = readJson(file) as {
      candidacies?: { id: string; givenName?: string; familyName?: string }[];
    };
    for (const candidacy of parsed.candidacies ?? []) {
      counted += 1;
      const name = `${candidacy.givenName ?? ""} ${candidacy.familyName ?? ""}`.trim();
      if (isIncompletePersonName(name)) {
        offenders.push(`${file} ${candidacy.id} ${JSON.stringify(name)}`);
      }
    }
  }

  if (existsSync(join(ROOT, "data/states/az/ballot/az-general-lineup-2026.json"))) {
    const lineup = readJson("data/states/az/ballot/az-general-lineup-2026.json") as {
      contests?: { contestId: string; nominees?: { name: string }[] }[];
    };
    for (const contest of lineup.contests ?? []) {
      for (const nominee of contest.nominees ?? []) {
        counted += 1;
        if (isIncompletePersonName(nominee.name)) {
          offenders.push(`${contest.contestId} ${JSON.stringify(nominee.name)}`);
        }
      }
    }
  }

  // The DENOMINATOR is asserted too: an empty loop passing this test would be
  // the check reporting a comfortable zero for having examined nobody, which
  // is the failure shape this repo has recorded four times.
  assert.ok(counted > 1_000, `the census examined only ${counted} people — it did not run`);
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} person(s) of ${counted} carry an incomplete name:\n  ${offenders.join("\n  ")}`,
  );
});

test("Vail's superintendent is held under a whole name", () => {
  const vail = BODY_ROSTERS.find((r) => /vail_unified/.test(r.bodyId));
  assert.ok(vail, "the Vail roster is in the registry");
  const supt = vail.members.find((m) => /superintendent/i.test(m.officeTitle ?? ""));
  assert.ok(supt, "Vail carries a superintendent");
  assert.equal(supt.name, "John Carruth");
  assert.equal(isIncompletePersonName(supt.name), false);
  assert.match(supt.websiteUrl ?? "", /vailschooldistrict\.org\/page\/superintendent/);
});

test("the top-office slots render through the gap-aware helper", () => {
  // These are the two surfaces where "Carruth" would have appeared. Guarded at
  // the render as well as at the data, because a source we do not control
  // could put a fragment in front of a reader between one refresh and the
  // next.
  for (const file of [
    "components/map/popup/district-popup.tsx",
    "components/map/popup/entity-modal.tsx",
  ]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.ok(
      /displayPersonName\(office\.holder\.name\)/.test(source),
      `${file} prints a top-office holder's name without the gap-aware helper`,
    );
    assert.ok(
      !/\{office\.holder\.name\}/.test(source),
      `${file} still has a raw {office.holder.name}`,
    );
  }
});
