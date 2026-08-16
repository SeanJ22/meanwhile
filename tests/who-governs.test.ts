import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * THE WHO-GOVERNS REGISTER (item 3, 2026-08-16, the author's ruling).
 *
 * The card was given the battlecards' full element grammar and came back
 * "way overcrowded... a forever scroll". It carries twenty-odd people at
 * 85701; twenty rows each wearing a filled party chip, an outbound link and
 * a source mark is a wall, not a list.
 *
 * Three rules, and they are about DENSITY and DOORS rather than about
 * sourcing, which is unchanged:
 *
 *  1. No pills in the list. Party is plain text in its party colour.
 *  2. No external links on a row. Every door out lives inside a card.
 *  3. The click grammar: a PERSON opens their small card, a BODY opens its
 *     large one.
 */

/**
 * The CODE, with the commentary stripped. The comments explain what was
 * removed and why, and a guard that reads them fails on its own explanation.
 */
function code(path: string[]): string {
  return readFileSync(join(process.cwd(), ...path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CARD = code(["components", "map", "coverage-notice.tsx"]);

test("no pills in the who-governs list — party renders as plain text", () => {
  assert.ok(
    !/id-chip/.test(CARD),
    "a filled chip is back on the who-governs list; the pill belongs on the battlecards",
  );
  assert.ok(
    /person-row-party/.test(CARD),
    "party must render in the plain-text party class",
  );
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
  // The source mark is NOT an external link in this sense — it is the
  // standing per-surface sourcing rule and it stays.
  assert.ok(
    /href=\{holder\.sourceUrl\}/.test(CARD),
    "the source mark must survive the density pass",
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
  assert.ok(
    /onOpenOfficial\(holder/.test(CARD),
    "a person's name must open their card",
  );

  // And the caller actually wires the body half to a LARGE surface.
  const entry = code(["components", "map", "map-entry.tsx"]);
  assert.ok(
    /onOpenBody=\{\(body\) =>\s*openLarge\(\{\s*kind: "entity",\s*subject: bodySubject\(/.test(
      entry,
    ),
    "the body row must open the large entity card, not a popup",
  );
  // The external site the row used to link to is a fact INSIDE that card.
  assert.ok(
    /label: "Official site"/.test(entry),
    "the body battlecard must carry the official site the row stopped linking to",
  );
});
