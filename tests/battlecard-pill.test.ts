import assert from "node:assert/strict";
import { claimsInText } from "../lib/text/absence-claims.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  BATTLECARD_SECTIONS,
  votingRecordEmptyLine,
} from "../lib/ballot/battlecard-sections.ts";

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

  /*
   * **BC-1 (2026-08-22) CHANGED THE SHAPE THIS GUARD WAS WRITTEN AGAINST, and
   * the claim it defends is now enforced structurally rather than counted.**
   *
   * It used to assert that `<CandidateBattlecard` appeared twice — once per
   * contest branch — and that each occurrence had `CandidatePositions`,
   * `IncumbentRecord` and `CandidateFunding` among its children. The comment
   * beside it said the two branches "must carry the same sections in the same
   * order", and **nothing enforced that**: it was two hand-assembled lists that
   * happened to match, checked by counting to two.
   *
   * There is now ONE builder — `BallotBattlecard` — and both branches call it,
   * so they cannot diverge. That is the same guarantee the old test was
   * approximating, obtained by construction instead of by arithmetic.
   */
  const builders = page.match(/<BallotBattlecard(?![A-Za-z])/g) ?? [];
  assert.equal(builders.length, 2, "both candidate branches need the card");

  const defined = page.match(/async function BallotBattlecard\(/g) ?? [];
  assert.equal(
    defined.length,
    1,
    "there must be exactly ONE builder — two would be the divergence this replaced",
  );

  // The long sections live in the builder's `sections` map and nowhere else on
  // the row. A second render of any of them outside it would put the section
  // back beside the card, which is what item 12 moved it off.
  const builder = page.slice(page.indexOf("async function BallotBattlecard("));
  const body = builder.slice(0, builder.indexOf("\n}\n"));
  for (const section of ["CandidatePositions", "CandidateFunding", "RecentVotes"]) {
    assert.ok(
      body.includes(`<${section}`),
      `${section} must be one of the builder's sections`,
    );
    const onPage = (page.match(new RegExp(`<${section}(?![A-Za-z])`, "g")) ?? []).length;
    assert.equal(
      onPage,
      1,
      `${section} renders once, inside the one builder — a second render is the row getting it back`,
    );
  }
});

test("BC-1: every card carries the same seven sections, always", () => {
  /*
   * The author's complaint was that *"information is currently parsed onto
   * cards haphazardly because there is no standard."* This is the standard.
   *
   * The SET is fixed and the card renders every section whether or not it holds
   * content, because a card whose sections appear and disappear with what we
   * hold makes a well-covered person's card taller and more substantial than a
   * thin one's — a layout asymmetry tracking incumbency rather than anything
   * about the people.
   */
  const candidate = read("components", "ballot", "candidate-battlecard.tsx");
  assert.match(candidate, /<PersonCard/);
  const card = read("components", "ui", "person-card.tsx");
  assert.match(
    card,
    /PERSON_CARD_SECTIONS\.filter[\s\S]*?\.map/,
    "the card must render the fixed set, not whatever it was handed",
  );
  assert.equal(BATTLECARD_SECTIONS.length, 7, "the seven the author named");
  assert.deepEqual(
    BATTLECARD_SECTIONS.map((s) => s.title),
    [
      "What this office does",
      "Positions",
      "Committees",
      "Offices near you",
      "Campaign money",
      "Voting record",
      "Sources",
    ],
    "the titles and the order are his, verbatim",
  );
  // No branch may skip a section for want of content.
  assert.ok(
    !/sections\?\.\[spec\.id\][^\n]*&&/.test(card),
    "a section must never be conditional on having content",
  );
});

test("FE-30: all missing voting records use the same collection state", () => {
  for (const held of [true, false]) {
    const line = votingRecordEmptyLine(held);
    assert.equal(line, "We’re working on getting this info");
    assert.deepEqual(claimsInText(line), []);
  }
});

test("BC-2: an empty section is never a per-card completeness statement", () => {
  /*
   * RULING 44 is untouched. An empty drop-down saying why it is empty is not a
   * marker of how complete this card is relative to another — no count, no
   * digit, no sentence about what the card lacks.
   */
  const specs = BATTLECARD_SECTIONS.map((s) => s.emptyLine).concat([
    votingRecordEmptyLine(true),
    votingRecordEmptyLine(false),
  ]);
  for (const line of specs) {
    assert.doesNotMatch(line, /\d/, `an empty line carries a number: ${line}`);
    assert.doesNotMatch(
      line,
      /\b(less|fewer|thin|incomplete|compared|than other|other candidates)\b/i,
      `an empty line compares this card to another: ${line}`,
    );
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
