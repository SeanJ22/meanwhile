import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { deriveWhoGoverns } from "../lib/registry/who-governs.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

/**
 * ITEM 1a (2026-08-17): the Who Governs Here card stated three different
 * numbers for one list — prose 4, disclosure link "Why these 5?", rows 5.
 *
 * This file proves the invariant STRUCTURALLY rather than against today's
 * data. At the four pilot zips the governing set is 4, 2, 4 and 3 bodies, all
 * of them under the old five-row cut, so a test built from production would
 * pass on a build where the cut still bit — and would go on passing right up
 * until the first zip with six governments.
 *
 * So the inputs below are synthetic and deliberately larger than anything the
 * registry holds.
 */

let seq = 0;
function body(
  bodyClass: CoveredBody["bodyClass"],
  over: Partial<CoveredBody> = {},
): CoveredBody {
  seq += 1;
  return {
    bodyId: `body-${seq}`,
    ocdId: `ocd-division/country:us/state:zz/thing:${seq}`,
    name: `Body ${seq}`,
    divisionLabel: `Division ${seq}`,
    divisionType: "place",
    bodyClass,
    coverageStatus: "LIVE",
    lookedAt: true,
    ...over,
  } as CoveredBody;
}

test("the stated count and the rendered rows are the same expression, at any size", () => {
  // Twelve governments and forty-eight boards — three times the largest
  // governing set the product has ever rendered, and far past the old cut.
  for (const governing of [0, 1, 2, 3, 4, 5, 6, 12, 40]) {
    const bodies = [
      ...Array.from({ length: governing }, () => body("GOVERNING")),
      ...Array.from({ length: 48 }, () => body("COMMISSION")),
    ];
    const d = deriveWhoGoverns(bodies, new Set());
    assert.equal(
      d.rows.length,
      d.governingCount,
      `stated ${d.governingCount} against ${d.rows.length} rendered rows at size ${governing}`,
    );
    assert.equal(d.others, 48, "the boards are counted, not dropped");
    assert.ok(
      d.rows.every((b) => b.bodyClass === "GOVERNING"),
      "no non-government may sit in the governments list",
    );
  }
});

test("the 85701 shape: the Board of Adjustment is the row that moved, not the PHA", () => {
  // The real classes, reproduced. The brief's named suspect was the Public
  // Housing Authority board; the evidence says otherwise, and this pins which
  // row it actually was so the diagnosis survives the fix.
  const pima = body("GOVERNING", { name: "Pima" });
  const tucson = body("GOVERNING", { name: "Tucson" });
  const pha = body("GOVERNING", {
    name: "Public Housing Authority Board of Commissioners",
  });
  const tusd = body("GOVERNING", { name: "Tucson Unified District" });
  const baj = body("COMMISSION", { name: "Board of Adjustment (BAJ)" });

  const d = deriveWhoGoverns([pima, tucson, pha, tusd, baj], new Set());

  assert.equal(d.governingCount, 4, "four governments, as the prose always said");
  assert.equal(d.rows.length, 4, "and four rows, which is what changed");
  assert.ok(
    d.rows.some((b) => b.name?.startsWith("Public Housing")),
    "the PHA board IS a government and stays in the list",
  );
  assert.ok(
    !d.rows.some((b) => b.name?.startsWith("Board of Adjustment")),
    "the Board of Adjustment is a commission and leaves the governments list",
  );
  assert.equal(d.others, 1);
});

test("narrowing cannot re-open the gap — the count follows the reader's own list", () => {
  /*
   * The second instance, and the one a server-side fix would have left live.
   * `counts.governing` is computed on the server; the M26 narrowing happens on
   * the device. A reader narrowing to one school district used to shrink the
   * rows while the prose kept quoting the server's number.
   */
  const county = body("GOVERNING", { divisionType: "county" });
  const districtA = body("GOVERNING", { divisionType: "school_district" });
  const districtB = body("GOVERNING", { divisionType: "school_district" });
  const districtC = body("GOVERNING", { divisionType: "school_district" });

  const wide = deriveWhoGoverns([county, districtA, districtB, districtC], new Set());
  assert.equal(wide.governingCount, 4);
  assert.equal(wide.rows.length, 4);

  const narrowed = deriveWhoGoverns(
    [county, districtA, districtB, districtC],
    new Set([districtB.ocdId as string]),
  );
  assert.equal(narrowed.rows.length, 2, "the county plus the chosen district");
  assert.equal(
    narrowed.governingCount,
    narrowed.rows.length,
    "the stated number followed the narrowing — this is the assertion that fails on the old code",
  );
  assert.equal(narrowed.others, 0);
});

test("wired counts are partitioned, never double-counted across the two sets", () => {
  const bodies = [
    body("GOVERNING", { coverageStatus: "LIVE" }),
    body("GOVERNING", { coverageStatus: "KNOWN_UNCOVERED" }),
    body("COMMISSION", { coverageStatus: "MANUAL" }),
    body("COMMISSION", { coverageStatus: "KNOWN_UNCOVERED" }),
    body("ADVISORY", { coverageStatus: "KNOWN_UNCOVERED" }),
  ];
  const d = deriveWhoGoverns(bodies, new Set());
  assert.equal(d.governingCount, 2);
  assert.equal(d.governingWithSource, 1);
  assert.equal(d.others, 3);
  assert.equal(d.othersWithSource, 1);
  assert.ok(d.governingWithSource <= d.governingCount);
  assert.ok(d.othersWithSource <= d.others);
});

/* ========================================================================== */
/* RESTORED 2026-08-21, NH Hunt 6 item 1.2 — RULING 62's history sweep.       */
/*                                                                            */
/* These three guards shipped in b16eec5 ("The list goes back to clean, and   */
/* the popup to three things") for the author's density ruling of 2026-08-16. */
/* They stopped existing in af766f5, a commit about count reconciliation and  */
/* run markers that rewrote this file wholesale — 111 insertions, 75          */
/* deletions — and whose message never mentions them. That is the RULING 62   */
/* shape one turn subtler than the overwrite that produced the ruling: not a  */
/* file replaced, but a file REWRITTEN for one purpose, carrying off guards   */
/* that belonged to another. `pnpm test` stayed green, because a deleted test */
/* is not a failing test.                                                     */
/*                                                                            */
/* Every assertion below was re-run against the code as it stands on          */
/* 2026-08-21 before being restored: all twelve still hold. So this is a      */
/* guard coming back, not a rule being re-litigated — the density ruling was  */
/* never reversed, it simply stopped being checked for four days.             */
/*                                                                            */
/* The author's three rules, unchanged:                                       */
/*   1. No pills in the list. Party is plain text in its party colour.        */
/*   2. No external links on a row. Every door out lives inside a card.       */
/*   3. The click grammar: a PERSON opens their small card, a BODY opens its  */
/*      large one.                                                            */
/* ========================================================================== */

/**
 * The CODE, with the commentary stripped. The comments explain what was
 * removed and why, and a guard that reads them fails on its own explanation.
 */
function densityCode(path: string[]): string {
  return readFileSync(join(process.cwd(), ...path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CARD = densityCode(["components", "map", "coverage-notice.tsx"]);

test("no pills in the who-governs list — party renders as plain text", () => {
  assert.ok(
    !/id-chip/.test(CARD),
    "a filled chip is back on the who-governs list; the pill belongs on the battlecards",
  );
  assert.ok(/person-row-party/.test(CARD), "party must render in the plain-text party class");
  // Still coloured, and still display-only — the colour is the party's, and
  // nothing infers a position from it.
  assert.ok(/partyColorVar\(holder\.partyLabel\)/.test(CARD));
});

test("no external links on a row — the doors live inside the cards", () => {
  assert.ok(
    !/Their site/.test(CARD),
    '"Their site" is back on a who-governs row; external links do not live in the list',
  );
  assert.ok(
    !/href=\{body\.homepageUrl\}/.test(CARD),
    "a body row links straight out again; a body row opens its battlecard",
  );
  assert.ok(
    !/href=\{holder\.websiteUrl\}/.test(CARD),
    "a person row links straight out again; a person row opens their card",
  );
  /*
   * **THE SOURCE MARK IS GONE FROM THIS ROW (BC-14, 2026-08-25), and this
   * assertion is INVERTED rather than deleted.**
   *
   * It read "the source mark must survive the density pass", which was right
   * when the density pass was the only thing threatening it. The author's
   * instruction is now explicit and is the opposite: *sources live in the
   * large battlecard; the small card lists names and nothing else.* Three of
   * the four `.source-tag` render sites came out.
   *
   * Asserting the ABSENCE rather than removing the assertion is what keeps
   * this a guard: the mark cannot quietly come back, and the reason it left is
   * attached to the line that would catch it.
   *
   * **What must never be confused with it, and what the guard above still
   * holds:** the RECORD is untouched. `holder.sourceUrl` still travels on the
   * row and still renders in the large card. RULING 138 says display
   * consolidates and the record is never deleted, and
   * `tests/source-consolidation.test.ts` asserts the provenance fields are
   * identical before and after. "Remove the source annotations" and "remove
   * the sources" are one careless edit apart.
   */
  assert.ok(
    !/href=\{holder\.sourceUrl\}/.test(CARD),
    "the per-row source mark is back on the who-governs card — BC-14 puts sources in the large card",
  );
});

test("the click grammar: a person opens a small card, a body opens a large one", () => {
  assert.ok(
    /onOpenBody\?: \(body: CoveredBody\) => void/.test(CARD),
    "the card must accept a body-opening callback",
  );
  assert.ok(
    /onClick=\{\(\) => onOpenBody\(body\)\}/.test(CARD),
    "a body row must open its battlecard",
  );
  assert.ok(/onOpenOfficial\(holder/.test(CARD), "a person's name must open their card");

  // And the caller actually wires the body half to a LARGE surface.
  const entry = densityCode(["components", "map", "map-entry.tsx"]);
  assert.ok(
    /onOpenBody=\{\(body\) =>[\s\S]{0,160}openLarge\(\{[\s\S]{0,120}kind: "entity"/.test(entry),
    "the body row must open the large entity card, not a popup",
  );
  // The external site the row used to link to is a fact INSIDE that card.
  assert.ok(
    /label: "Official site"/.test(entry),
    "the body battlecard must carry the official site the row stopped linking to",
  );
});
