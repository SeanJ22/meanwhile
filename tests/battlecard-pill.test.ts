import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  BATTLECARD_SECTIONS,
} from "../lib/ballot/battlecard-sections.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

test("12: the long sections render inside the battlecard, not on the row", () => {
  const page = read("app", "ballot", "page.tsx");

  /* Current candidates and earlier filings share the same sections. */
  const builders = page.match(/<BallotBattlecard(?![A-Za-z])/g) ?? [];
  assert.equal(builders.length, 3, "nominees, current candidacies and earlier filings each receive the shared card");
  assert.match(page, /data-earlier-filings=\{contest.id\}>[\s\S]*?battlecardSlot=\{<BallotBattlecard/);

  const defined = page.match(/async function BallotBattlecard\(/g) ?? [];
  assert.equal(
    defined.length,
    1,
    "there must be exactly ONE builder — two would be the divergence this replaced",
  );

  // The long sections live in the builder's sections map and nowhere else on the row.
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

test("person cards use one reading order for the sections they hold", () => {
  const candidate = read("components", "ballot", "candidate-battlecard.tsx");
  assert.match(candidate, /<PersonCard/);
  const card = read("components", "ui", "person-card.tsx");
  assert.match(
    card,
    /PERSON_CARD_SECTIONS\.filter[\s\S]*?\.map/,
    "the card must preserve the shared reading order",
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
});

test("12: the pill is full width and reads as an invitation", () => {
  const card = read("components", "ballot", "candidate-battlecard.tsx");
  assert.match(card, /data-battlecard-pill/, "the pill needs its marker for the walk");
  assert.match(card, /className="[^"]*\bw-full\b/, "the pill must span the ballot column");
  assert.match(card, />\s*View Battlecard\s*</, "the pill's words are fixed by the brief");
});

/** People only: the pill is a slot on CandidateCard, and a measure never touches it. */
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

/** The per-card issue count and its enumeration are both gone, and neither may come back. */
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

/** A candidate we hold nothing published for renders no section: no placeholder, no greyed line, no sentence about our research. */
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
