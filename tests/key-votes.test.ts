import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  APRIL_2024_SENATE_NOTE,
  KEY_VOTES,
  KEY_VOTES_CRITERIA,
  KEY_VOTES_LAWS,
  KEY_VOTES_PEOPLE,
} from "../lib/votes/key-votes.ts";

/**
 * Votes only; published criteria; never aggregated into a score; "no vote exists" and "the other chamber hasn't
 * acted" are first-class answers; and an entry is a question each chamber answered with its own roll calls.
 */

const ROOT = process.cwd();

test("the list is the author's: 20 law rows (April 2024 as four siblings) and 16 nominations", () => {
  assert.equal(KEY_VOTES_LAWS.length, 20);
  assert.equal(KEY_VOTES_PEOPLE.length, 16);
  assert.equal(KEY_VOTES.length, 36);
  // The April 2024 package is four siblings because the House voted four
  // separate bills and a member could vote differently on each.
  const april = KEY_VOTES_LAWS.filter((e) => e.siblingGroup === "april-2024");
  assert.equal(april.length, 4);
  // Current law/chamber status is mutable official truth, not reviewed
  // question input. It may appear only after an official status acquisition
  // is represented in the canonical data-plane receipt.
  assert.ok(KEY_VOTES.every((entry) => entry.pending === undefined));
  assert.equal(KEY_VOTES.find((entry) => entry.id === "stock-trading-ban")?.senateNote, undefined);
  // Ids are unique — they key the render and the snapshot join.
  assert.equal(new Set(KEY_VOTES.map((e) => e.id)).size, KEY_VOTES.length);
});

test("the criteria sentence is verbatim and renders ON the surface", () => {
  assert.equal(
    KEY_VOTES_CRITERIA,
    "Major legislation that became law (plus one additional selected proposal), and consequential Senate confirmations, since 2020 — chosen before looking at how anyone voted.",
  );
  const surface = readFileSync(
    join(ROOT, "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  assert.ok(
    surface.includes("{KEY_VOTES_CRITERIA}"),
    "the criteria must render on the surface, not merely exist",
  );
});

test("no entry carries a scoring key, and nothing aggregates them", () => {
  // The neutrality rule is stricter than the no-composite-score rule.
  const raw = JSON.stringify(KEY_VOTES);
  assert.ok(
    !/"(score|rank|rating|match|fit|grade|alignment|recommendation)"/i.test(raw),
    "a key vote entry grew a scoring key",
  );
  for (const file of ["key-votes.ts", "key-votes-rows.ts"]) {
    const source = readFileSync(join(ROOT, "lib", "votes", file), "utf8");
    assert.ok(
      !/\.(reduce|filter)\([^)]*position\s*===\s*["']YES/.test(source),
      `lib/votes/${file} counts YES votes — that is a score`,
    );
  }
  const surface = readFileSync(
    join(ROOT, "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  for (const banned of ["% agree", "score", "grade", "alignment", "rating"]) {
    assert.ok(
      !new RegExp(`>[^<]*${banned}`, "i").test(surface),
      `the key votes surface renders "${banned}"`,
    );
  }
});

test("every explainer is level register, one sentence's worth, and never the title again", () => {
  for (const entry of KEY_VOTES) {
    assert.ok(entry.explainer.length > 40, `${entry.id}: explainer too thin`);
    assert.ok(entry.explainerSource.length > 0, `${entry.id}: no source class`);
    assert.match(entry.explainerReadAt, /^\d{4}-\d{2}-\d{2}$/);
    // The title must not be doing the explaining. A bundle that names only
    // its branding tells the reader nothing.
    const titleWords = entry.title
      .toLowerCase()
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const explainer = entry.explainer.toLowerCase();
    const echoed = titleWords.filter((w) => explainer.includes(w));
    assert.ok(
      echoed.length < titleWords.length || titleWords.length === 0,
      `${entry.id}: the explainer is the title again`,
    );
    // Level register on a claim surface: never cute about real money or
    // real people.
    // Word boundaries, not substrings: "instead" contains "tea", and a
    // guard that fails on it is a guard nobody will keep.
    for (const banned of ["tea", "bet", "hang tight", "lol", "wild", "vibes"]) {
      assert.ok(
        !new RegExp(`\\b${banned}\\b`).test(explainer),
        `${entry.id}: playful register on a claim surface ("${banned}")`,
      );
    }
  }
});

/** Passage or concurrence only — a cloture vote is a different question. */
function assertPassageQuestion(id: string, chamber: string, question: string | null) {
  assert.match(
    question ?? "",
    // `agreed?` and bare `concur` deliberately: the chambers write "Senate
    // AGREED to the House amendment" and "Senate CONCURRED in", and a guard
    // that only knew the infinitives would call a real concurrence vote a
    // procedural one.
    /passed|on passage|concur|agreed? to the|suspend the rules/i,
    `${id} ${chamber}: not a passage-type question`,
  );
  assert.ok(
    !/cloture|motion to proceed|motion to table|recommit/i.test(question ?? ""),
    `${id} ${chamber}: a procedural vote is standing in for the law`,
  );
}

/**
 * Votes on laws and votes on people both start collapsed, with their count in the header, and the sub-groups
 * read as sub-groups.
 */
test("F01 5.3: the key-votes sub-groups ship collapsed, and say how many they hold", () => {
  const surface = readFileSync(
    join(ROOT, "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  const sections = surface.match(/<CardSection[\s\S]*?>/g) ?? [];
  assert.ok(sections.length >= 3, "the pane should render its sub-groups");
  for (const section of sections) {
    assert.ok(
      !/defaultOpen/.test(section),
      `a key-votes sub-group ships OPEN, which F01 5.3 reversed:\n${section}`,
    );
    assert.ok(
      /level="sub"/.test(section),
      `a key-votes sub-group is not marked as one:\n${section}`,
    );
    // The count in the header is what a closed bar answers with.
    assert.ok(
      /meta=/.test(section),
      `a collapsed sub-group with no count states nothing at all:\n${section}`,
    );
  }
});

/** `votedCount` counts only rows the member actually voted on. */
test("F01 5.1: only rows the member actually voted on are counted", async () => {
  const { votedCount } = await import("../lib/votes/participation.ts");
  const row = (positions: (string | null)[]) =>
    ({ positions, refs: [], breakdowns: [], note: null }) as never;

  // A recorded position of any kind counts — including a recorded absence
  // from a roll call the member was seated for.
  assert.equal(votedCount([row(["YES"]), row(["NO"]), row(["DID_NOT_VOTE"])]), 3);
  // Every position null means either "not in this chamber" or "we haven't
  // recorded it" — neither is a vote the member cast.
  assert.equal(votedCount([row([null]), row([null, null])]), 0);
  // A row with one held roll call and one gap still counts once, not twice.
  assert.equal(votedCount([row(["YES", null])]), 1);
  assert.equal(votedCount([]), 0);
});

test("a sub-group is visually a sub-group, and still a thing to click", () => {
  const component = readFileSync(
    join(ROOT, "components", "officials", "card-section.tsx"),
    "utf8",
  );
  assert.ok(
    /data-level=\{level === "sub" \? "sub" : undefined\}/.test(component),
    "the level must reach the DOM or the stylesheet cannot see it",
  );
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  // Indented behind a rule, stepped down in scale — hierarchy in the
  // committed grammar rather than a new affordance language.
  assert.ok(/\.card-section\[data-level="sub"\] \{[^}]*margin-left/.test(css));
  assert.ok(/\.card-section\[data-level="sub"\] \{[^}]*border-left/.test(css));
  assert.ok(
    /\.card-section\[data-level="sub"\] \.card-section-title \{[^}]*font-size/.test(css),
  );
  // The chevron rule stays scoped with `>` — the defect that rotated closed
  // sub-groups' arrows when the parent opened must not come back.
  assert.ok(
    /\.card-section\[data-open\] > \.card-section-header \.card-section-chevron/.test(
      css,
    ),
    "the chevron rotation must stay scoped to a section's own header",
  );
});

/** Every position the fetcher can write, including a seated member's `NOT_VOTING`, has a pill in both views. */
test("F01 5.2: every position the store can hold has a pill, in both views", () => {
  const keyVotes = readFileSync(
    join(ROOT, "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  const recent = readFileSync(
    join(ROOT, "components", "map", "popup", "official-popup.tsx"),
    "utf8",
  );

  // The vocabulary the fetcher can actually produce, read off the fetcher so
  // this cannot drift from what lands in the store.
  const fetcher = readFileSync(
    join(ROOT, "scripts", "fetch-key-vote-positions.mts"),
    "utf8",
  );
  const produced = [...fetcher.matchAll(/return "(YES|NO|PRESENT|NOT_VOTING)"/g)].map(
    (m) => m[1],
  );
  assert.ok(produced.length >= 4, "the fetcher's position vocabulary was not found");

  for (const position of new Set(produced)) {
    assert.ok(
      new RegExp(`^[ ]*${position}: [{]`, "m").test(keyVotes),
      `the key-votes pill map has no entry for ${position} — it will render the generic fallback`,
    );
    assert.ok(
      new RegExp(`^[ ]*${position}: [{]`, "m").test(recent),
      `the recent-votes pill map has no entry for ${position}`,
    );
  }

  // A recorded absence is neutral in both. It is not a position (never the
  // yes/no colour) and it is not a gap (never the outline) — three states,
  // three treatments.
  assert.match(keyVotes, /NOT_VOTING: \{ label: "Did not vote", tone: "neutral" \}/);
  assert.match(recent, /NOT_VOTING: \{ label: "Did not vote", tone: "neutral" \}/);
});

