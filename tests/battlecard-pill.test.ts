import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * F01-continued session 2, items 12 and 14 (2026-08-19) — the ballot stops
 * being a forever scroll, and the eleven-issue block is annotated and buried.
 *
 * Measured at 430×932 before and after, by `pnpm measure:ballot`:
 *
 * | zip | before | after |
 * |---|---|---|
 * | 07866 | 20,510 px (22.0 screens) | 9,574 px (10.3) |
 * | 85701 | 41,558 px (44.6 screens) | 31,298 px (33.6) |
 *
 * These are the structural properties behind those numbers. The numbers are
 * a measurement and can only be taken against a running server; the
 * properties are what stop the next change putting the sections back.
 */

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

test("12: the long sections render inside the battlecard, not on the row", () => {
  const page = read("app", "ballot", "page.tsx");

  // Both call sites — the certified lineup and the filed candidacies. A build
  // where one branch kept its inline sections would render two different
  // ballots and read as a ranking by layout.
  const battlecards = page.match(/<CandidateBattlecard/g) ?? [];
  assert.equal(battlecards.length, 2, "both candidate branches need the card");

  // Every moved section appears the same number of times as the card that
  // holds it — which is what says they are INSIDE it rather than beside it.
  // The trailing boundary matters: `<CandidatePositions` is a prefix of
  // `<CandidatePositionsAnnotation`, which is item 14's ROW annotation and
  // is supposed to appear twice MORE. A prefix match counted four and
  // reported the sections as duplicated.
  for (const section of ["CandidatePositions", "IncumbentRecord", "CandidateFunding"]) {
    const found = (page.match(new RegExp(`<${section}(?![A-Za-z])`, "g")) ?? []).length;
    assert.equal(
      found,
      2,
      `${section} should render exactly twice — once per branch, inside the battlecard`,
    );
  }

  // …and structurally inside: each card's children must contain them.
  for (const block of page.split("<CandidateBattlecard").slice(1)) {
    const inside = block.slice(0, block.indexOf("</CandidateBattlecard>"));
    assert.ok(inside.includes("<CandidatePositions"), "positions left the card");
    assert.ok(inside.includes("<IncumbentRecord"), "the record door left the card");
    assert.ok(inside.includes("<CandidateFunding"), "funding left the card");
  }
});

test("12: the pill is full width and reads as an invitation", () => {
  const card = read("components", "ballot", "candidate-battlecard.tsx");
  assert.match(card, /data-battlecard-pill/, "the pill needs its marker for the walk");
  assert.match(card, /className="[^"]*\bw-full\b/, "the pill must span the ballot column");
  assert.match(card, />\s*View Battlecard\s*</, "the pill's words are fixed by the brief");
});

/**
 * PEOPLE ONLY, and the distinction is structural.
 *
 * The pill is a slot on `CandidateCard`, which the ballot renders for a
 * person. A measure renders through the measure path — its provisions, its
 * own reaction targets — and never touches this component. So a measure
 * cannot grow a pill by being forgotten about.
 */
test("12: measures get no battlecard pill", () => {
  const page = read("app", "ballot", "page.tsx");

  // Every battlecard is a child of a CandidateCard's slot, never of a
  // measure block.
  const measureBlocks = page.split(/contest\.type === "MEASURE"/).slice(1);
  for (const block of measureBlocks) {
    const window = block.slice(0, 4000);
    assert.ok(
      !window.includes("<CandidateBattlecard"),
      "a measure branch is rendering a person's battlecard",
    );
  }

  // And the slot itself lives only on the candidate card.
  const cardSource = read("components", "ballot", "candidate-card.tsx");
  assert.match(cardSource, /battlecardSlot/, "the slot moved off the candidate card");
});

test("14: the ROW carries the count and never the enumeration", () => {
  const positions = read("components", "ballot", "candidate-positions.tsx");
  const lib = read("lib", "candidates", "positions.ts");

  // The annotation exists, states a count, and names no issues.
  assert.match(lib, /export function positionsAnnotation/);
  const annotation = lib.slice(lib.indexOf("export function positionsAnnotation"));
  assert.ok(
    !/housing costs|prescription costs|reproductive rights/i.test(annotation),
    "the row's annotation is enumerating issues again",
  );
  assert.match(annotation, /\$\{issuesWithPassages\} of the \$\{issuesSearched\}/);

  // The enumeration is behind a disclosure, and marked so a walk can find it.
  assert.match(positions, /<details[^>]*data-gap-enumeration/, "the list must be buried");
  assert.match(positions, /data-gap-annotation/, "the row's short form needs its marker");
});

/**
 * **The disclaimer travels with the list.** Item 14's second clause, and the
 * one worth guarding hardest: without it, twelve issue labels under a
 * person's name read as a finding about the person rather than as a report of
 * what our reading did and did not cover.
 */
test("14: the enumeration never renders without its disclaimer", () => {
  const positions = read("components", "ballot", "candidate-positions.tsx");

  const start = positions.indexOf("data-gap-enumeration");
  assert.ok(start > 0, "the enumeration disclosure is gone");
  const block = positions.slice(start, positions.indexOf("</details>", start));

  assert.match(
    block,
    /Nothing in the pages we hold from them mentions/,
    "the enumeration left the disclosure",
  );
  assert.match(
    block,
    /That is what\s+their own pages say, as we read them — not a statement about what\s+they think/,
    "the disclaimer must sit inside the same block as the list it qualifies",
  );
});

/**
 * Item 14 step 3, answered by MEASUREMENT rather than by assumption, and
 * recorded here because the brief asked the question.
 *
 * `CLAUDE.md` has no rule numbered 4g or 4h — those numbers appear in tracker
 * notes and code comments as references to author rulings of 2026-08-17, and
 * name no rule in that file. The F01 6.1 guard in `tests/wording.test.ts`
 * BANS "gap in our data/research"; it does not mandate the enumeration. The
 * 6.2 guard pins one sentence in `key-votes-section.tsx` and nothing here.
 *
 * So no amendment was owed, and this test is what stops a later session
 * assuming one was made.
 */
test("14: no guard mandated the enumeration's phrasing, and none was amended", () => {
  const claude = read("CLAUDE.md");
  assert.ok(
    !/^#+ .*\b4g\b/m.test(claude) && !/rule 4g:/i.test(claude),
    "CLAUDE.md grew a rule 4g — item 14's premise would need re-checking",
  );

  const wording = read("tests", "wording.test.ts");
  assert.match(wording, /gap in our \(data\|research\)/, "the 6.1 ban must survive");
  assert.ok(
    !/Nothing in the pages we hold/.test(wording),
    "the enumeration must not become a guarded literal — its wording is free to change; " +
      "what may not change is that the disclaimer travels with it",
  );
});
