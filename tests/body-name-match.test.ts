import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  bodyAccountingFor,
  looseName,
} from "../lib/registry/body-name-match.ts";
import { CURATED_BODIES } from "../lib/registry/curated-bodies.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

/**
 * **TWO INSTRUMENTS, ONE ANSWER.** (NH Hunt 5, 2026-08-21.)
 *
 * On 2026-08-21 `pnpm twig:pair` reported LAKE TODD VILLAGE DISTRICT as HELD,
 * matched by curated name, one body. `docs/gap-ledger.md`, generated from the
 * same registry minutes later, printed *"2 of these govern part of this zip
 * and are not in the registry"* — Lake Todd being one of the two.
 *
 * The ledger had not got the lookup wrong. It never did one: the sentence was
 * a constant, true the day it was written and false from the moment NH Hunt 4
 * wired the district. That is the coverage-note failure RULING 59 deleted,
 * reappearing one layer down in the document RULING 59 makes load-bearing —
 * the gap ledger is now the ONLY place the known-but-not-reached enumeration
 * lives, so a false absence there sends the next session to hunt something
 * already caught, and tells the author a body is dark when it is lit.
 *
 * The fix is a shared matcher rather than a corrected sentence, because a
 * corrected sentence would have been a second implementation of the same
 * question and free to disagree with the first all over again.
 */

const BODY_NAMES = [...CURATED_BODIES, ...registry.bodies].map(
  (b) => b.name ?? "",
);

test("a shouting Census name matches its quiet registry spelling", () => {
  assert.equal(
    bodyAccountingFor("LAKE TODD VILLAGE DISTRICT", BODY_NAMES),
    "Lake Todd Village District",
  );
});

test("a Census GOVERNMENT matches the BODY inside it (RULING 9)", () => {
  // The Census names the government; this product renders the body. Without
  // suffix-stripping these are two different strings and the district reads
  // as dark.
  assert.equal(
    bodyAccountingFor("MERRIMACK COUNTY CONSERVATION DISTRICT", BODY_NAMES),
    "Merrimack County Conservation District Board of Supervisors",
  );
});

test("a government this registry genuinely does not hold reports absent", () => {
  // Both are real New Hampshire governments in the state's own village-district
  // register, both far from any covered zip, and neither is in this registry.
  // (The two this test used to name — Eastman Village District and the Sullivan
  // County Conservation District — were entered by NH Hunt 5, which is the
  // whole point of the hunt and not a reason to loosen the check.)
  for (const dark of [
    "REDSTONE FIRE DISTRICT",
    "BARTLETT VILLAGE WATER DISTRICT",
  ]) {
    assert.equal(
      bodyAccountingFor(dark, BODY_NAMES),
      undefined,
      `${dark} is not held here and must not be matched into looking held — ` +
        "a false POSITIVE is worse than the false negative this fixed, " +
        "because it removes a body from the hunt queue silently",
    );
  }
});

/**
 * **THE PREFIX FALSE POSITIVE, HELD SHUT.** (NH Hunt 5, 2026-08-21.)
 *
 * The matcher's first version compared prefixes in both directions, and its
 * own doc block called the second direction theoretical. It fired the same
 * afternoon: stripping ` BOARD OF COMMISSIONERS` off `Sullivan County Board of
 * Commissioners` leaves `SULLIVAN COUNTY`, which `SULLIVAN COUNTY
 * CONSERVATION DISTRICT` starts with — so a county's conservation district
 * matched its board of commissioners.
 *
 * Every county in the United States has both, so this was a rule that would
 * bind two unrelated governments wherever it was pointed, and it would have
 * reported the conservation district as covered while nobody had hunted it.
 */
test("a shared leading name never binds two different governments", () => {
  const names = [
    "Sullivan County Board of Commissioners",
    "Sullivan County Conservation District Board of Supervisors",
  ];
  assert.equal(
    bodyAccountingFor("SULLIVAN COUNTY CONSERVATION DISTRICT", names),
    "Sullivan County Conservation District Board of Supervisors",
    "the conservation district must match ITS OWN board",
  );
  assert.equal(
    bodyAccountingFor("SULLIVAN COUNTY CONSERVATION DISTRICT", [names[0]]),
    undefined,
    "with only the commissioners present, the conservation district is ABSENT",
  );
  // The general form: a unit whose name merely begins with another's.
  assert.equal(
    bodyAccountingFor("WARNER RIVER LOCAL ADVISORY COMMITTEE", [
      "Warner Board of Selectmen",
    ]),
    undefined,
    "sharing the word Warner is not sharing a government",
  );
});

test("an empty or missing name never matches anything", () => {
  // The failure mode of a loose matcher: "" prefix-matches every string.
  for (const nothing of [null, undefined, "", "   ", "!!!"]) {
    assert.equal(
      bodyAccountingFor(nothing, BODY_NAMES),
      undefined,
      `${JSON.stringify(nothing)} must not match — an empty key would mark ` +
        "every unresolved government as held",
    );
  }
});

test("looseName survives punctuation, case and doubled spaces", () => {
  assert.equal(looseName("Lake  Todd Village-District, Inc."), "LAKE TODD VILLAGE DISTRICT INC");
  assert.equal(looseName(null), "");
});

test("twig:pair calls the shared matcher and does not roll its own (the gap ledger retired with CH-21)", () => {
  const src = readFileSync("scripts/twig-pair.mts", "utf8");
  assert.ok(src.includes("bodyAccountingFor"), "scripts/twig-pair.mts must ask the shared matcher");
  assert.ok(
    !/BOARD OF SUPERVISORS\|BOARD OF DIRECTORS/.test(src),
    "scripts/twig-pair.mts has its own copy of the suffix list again. Two copies is how " +
      "twig:pair and the gap ledger came to disagree about Lake Todd.",
  );
});
