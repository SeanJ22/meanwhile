import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { deriveWhoGoverns } from "../lib/registry/who-governs.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

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

  const entry = densityCode(["components", "map", "map-entry.tsx"]);
  assert.ok(
    /onOpenBody=\{\(body\) =>[\s\S]{0,160}openLarge\(\{[\s\S]{0,120}kind: "entity"/.test(entry),
    "the body row must open the large entity card, not a popup",
  );
  assert.ok(
    /label: "Official site"/.test(entry),
    "the body battlecard must carry the official site the row stopped linking to",
  );
});
