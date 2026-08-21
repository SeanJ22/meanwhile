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

/**
 * **RULING 47 AND RULING 44 (2026-08-20) — THE COUNT AND THE ENUMERATION ARE
 * BOTH GONE, AND NEITHER MAY COME BACK.**
 *
 * Item 14 (2026-08-19) split one ninety-word list into a COUNT on the ballot
 * row and the LIST buried in the battlecard. The author has since ruled the
 * whole measurement out: *"the per-card issue count is removed"*, and
 * `CLAUDE.md`'s fourth friction exception — honesty about coverage gaps — is
 * retired with it. A digit is RULING 44's banned statement compressed, and a
 * `<details>` reading "Which 9 we found nothing on" is the digit with a door
 * on it.
 *
 * This test replaces the two item-14 guards that asserted the opposite. That
 * is the only circumstance in which a walk or a guard is retired: the author
 * retiring the claim behind it.
 */
test("47: no per-card issue count, and no per-card gap enumeration", () => {
  const positions = read("components", "ballot", "candidate-positions.tsx");
  const card = read("components", "ballot", "candidate-card.tsx");
  const page = read("app", "ballot", "page.tsx");
  const lib = read("lib", "candidates", "positions.ts");

  assert.ok(
    !/positionsAnnotation/.test(lib),
    "the row's count function is back in lib/candidates/positions.ts",
  );
  for (const [name, src] of [
    ["candidate-positions.tsx", positions],
    ["candidate-card.tsx", card],
    ["ballot/page.tsx", page],
  ] as const) {
    assert.ok(
      !/data-gap-annotation|data-gap-enumeration|annotationSlot|CandidatePositionsAnnotation/.test(
        src,
      ),
      `${name} carries a per-card completeness marker again`,
    );
  }

  // The headline that replaced it is provenance, and provenance has no digits.
  const headline = lib.slice(lib.indexOf("export function positionsHeadline"));
  assert.ok(
    !/issuesWithPassages|issuesSearched|\$\{summary\./.test(headline),
    "the headline is interpolating a count again",
  );
});

/**
 * RULING 28's half of it: a candidate we hold nothing published for renders
 * NO section — not a placeholder, not a greyed line, not a sentence about our
 * research. This is the shape `PE01` reported and the author answered.
 */
test("44: nothing held renders nothing, not a sentence about our research", () => {
  const positions = read("components", "ballot", "candidate-positions.tsx");
  assert.match(
    positions,
    /if \(nothingCollected[^)]*\) return null;/,
    "the empty case must render nothing at all",
  );
  assert.ok(
    !/haven't collected anything|haven’t collected anything/i.test(positions),
    "the no-published-words sentence is back on the card",
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
