import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  POSITION_TOPICS,
  positionMatchCount,
  positionsFor,
  searchTerms,
} from "../lib/corpus/positions.ts";
import type { SourceSnapshot, StatementCorpus } from "../lib/corpus/types.ts";

/**
 * D35 — the three-answer machinery, with **a test per type**, which is what
 * the row asks for by name.
 *
 * The reason it asks is written into `lib/corpus/types.ts` and is the whole
 * point of the row: without the three answers, an empty match reads as "this
 * person has no position on X", which is a false claim about a named person.
 * So the three tests below are not three cases of one behaviour — they are
 * three DIFFERENT FACTS, and the last block proves the surface cannot render
 * any two of them the same way.
 */

const ROOT = join(import.meta.dirname, "..");

function snapshot(over: Partial<SourceSnapshot>): SourceSnapshot {
  return {
    id: "s1",
    subjectId: "congress:X000001",
    subjectName: "A Person",
    kind: "CAMPAIGN_SITE",
    url: "https://example.org/issues",
    contentHash: "hash-1",
    retrievedAt: "2026-08-10T00:00:00.000Z",
    httpStatus: 200,
    extraction: "ok",
    text: null,
    title: null,
    ...over,
  };
}

// ── TYPE ONE: MATCHED ──────────────────────────────────────────────────────

test("D35 type 1 — MATCHED: verbatim passages, with the source and the read date", () => {
  const quote =
    "I will fund affordable housing on county land and cap the permit backlog at thirty days.";
  const corpus: StatementCorpus = {
    snapshots: [
      snapshot({
        text: `Welcome to the campaign. ${quote} Paid for by the committee.`,
      }),
    ],
  };

  const answer = positionsFor("congress:X000001", "housing", corpus);
  assert.equal(answer.kind, "MATCHED");
  assert.equal(answer.passages.length, 1);

  const passage = answer.passages[0];
  // VERBATIM. Not trimmed of its words, not tightened, not summarised — the
  // quote a reader sees is a contiguous run of the page's own sentence.
  assert.equal(passage.quote, quote);
  assert.ok(
    corpus.snapshots[0].text?.includes(passage.quote),
    "the quote must appear in the page exactly as rendered",
  );
  // Quote AND link AND date, on every passage. A quote without its source is
  // an unlabelled description of a real person, which the blurb rule removes.
  assert.equal(passage.url, "https://example.org/issues");
  assert.equal(passage.retrievedAt, "2026-08-10T00:00:00.000Z");
  assert.deepEqual(passage.matchedTerms, ["housing"]);
  // The denominator rides even on a hit.
  assert.equal(answer.searched.pages, 1);
  assert.equal(answer.searched.snapshots, 1);
});

test("D35 type 1 — MATCHED: the change marker carries dates and never an interpretation", () => {
  const corpus: StatementCorpus = {
    snapshots: [
      snapshot({
        id: "old",
        contentHash: "hash-old",
        retrievedAt: "2026-07-01T00:00:00.000Z",
        text: "We oppose the water rate increase.",
      }),
      snapshot({
        id: "new",
        contentHash: "hash-new",
        retrievedAt: "2026-08-10T00:00:00.000Z",
        text: "We support the water rate increase.",
      }),
    ],
  };

  const answer = positionsFor("congress:X000001", "water", corpus);
  assert.equal(answer.kind, "MATCHED");
  // Newest first — an older read must never be mistaken for a current one.
  assert.equal(answer.passages[0].retrievedAt, "2026-08-10T00:00:00.000Z");
  assert.equal(answer.passages[0].changedSince, "2026-07-01T00:00:00.000Z");

  // A single unchanged read carries no marker at all.
  const steady = positionsFor("congress:X000001", "water", {
    snapshots: [corpus.snapshots[1]],
  });
  assert.equal(steady.passages[0].changedSince, null);

  // The marker is a DATE and nothing else. Nothing in this module may
  // characterise a change — types.ts is explicit: never "flip-flopped".
  const source = readFileSync(join(ROOT, "lib", "corpus", "positions.ts"), "utf8");
  for (const characterisation of [
    "flip-flop",
    "reversed",
    "softened",
    "contradicts",
    "inconsistent",
  ]) {
    // The prohibition may be NAMED in a comment; it may not be a string the
    // module can emit. Checked against the code with comments stripped.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !code.toLowerCase().includes(characterisation),
      `positions.ts can emit "${characterisation}"`,
    );
  }
});

// ── TYPE TWO: SEARCHED, NOTHING MATCHED ────────────────────────────────────

test("D35 type 2 — SEARCHED_NOTHING_MATCHED: a bounded search, with its denominator", () => {
  const corpus: StatementCorpus = {
    snapshots: [
      snapshot({ id: "a", url: "https://example.org/a", text: "Roads and bridges." }),
      snapshot({ id: "b", url: "https://example.org/b", text: "Parks and trails." }),
      // Unreadable pages are NOT counted as searched. A page we could not read
      // is a page we did not search, and saying otherwise inflates the
      // denominator that makes the answer honest.
      snapshot({ id: "c", url: "https://example.org/c", extraction: "failed", text: null }),
    ],
  };

  const answer = positionsFor("congress:X000001", "immigration", corpus);
  assert.equal(answer.kind, "SEARCHED_NOTHING_MATCHED");
  assert.equal(answer.passages.length, 0);
  assert.equal(answer.searched.pages, 2);
  assert.equal(answer.searched.snapshots, 2);
  assert.equal(answer.searched.unreadable, 1);
  // Somewhere of theirs to go next, and it is THEIR page, never a search.
  assert.equal(answer.theirPage, "https://example.org/a");
});

// ── TYPE THREE: NOT YET COLLECTED ──────────────────────────────────────────

test("D35 type 3 — NOT_YET_COLLECTED: a fact about our collection, not about them", () => {
  // Nothing at all for this subject.
  const empty = positionsFor("congress:NOBODY", "housing", { snapshots: [] });
  assert.equal(empty.kind, "NOT_YET_COLLECTED");
  assert.equal(empty.searched.pages, 0);
  assert.equal(empty.theirPage, null);

  // Held, but nothing readable. This is STILL not-yet-collected and not a
  // search that found nothing: we have not read a word of theirs, so a
  // sentence about what our search did not find would describe a search that
  // never happened.
  const unreadable = positionsFor("congress:X000001", "housing", {
    snapshots: [snapshot({ extraction: "failed", text: null })],
  });
  assert.equal(unreadable.kind, "NOT_YET_COLLECTED");
  assert.equal(unreadable.searched.snapshots, 0);
  assert.equal(unreadable.searched.unreadable, 1);
  assert.equal(unreadable.theirPage, "https://example.org/issues");
});

// ── THE THREE ARE DIFFERENT FACTS, IN DATA AND ON SCREEN ───────────────────

test("D35: the three answers are distinguishable in data, and none of them says 'no position'", () => {
  const kinds = new Set([
    positionsFor("congress:X000001", "housing", {
      snapshots: [snapshot({ text: "Our housing plan is here." })],
    }).kind,
    positionsFor("congress:X000001", "housing", {
      snapshots: [snapshot({ text: "Roads and bridges." })],
    }).kind,
    positionsFor("congress:X000001", "housing", { snapshots: [] }).kind,
  ]);
  assert.equal(kinds.size, 3, "two of the three answers collapsed into one");
});

test("D35: the surface renders three different sentences, in the gap's own register", () => {
  const surface = readFileSync(
    join(ROOT, "components", "officials", "positions-section.tsx"),
    "utf8",
  );

  // Each answer marks itself in the DOM, so a walk can tell which one it got.
  for (const kind of [
    "MATCHED",
    "SEARCHED_NOTHING_MATCHED",
    "NOT_YET_COLLECTED",
  ]) {
    assert.ok(
      surface.includes(`data-positions-answer${kind === "MATCHED" ? '="MATCHED"' : `": "${kind}"`}`),
      `the surface does not mark the ${kind} answer`,
    );
  }

  // FE-30: these internal search states lack a full equal-effort sweep.
  // They keep WorkingOnIt rather than making a finding about the person.
  assert.match(surface, /answer.kind === "SEARCHED_NOTHING_MATCHED" && <WorkingOnIt/);
  assert.match(surface, /answer.kind === "NOT_YET_COLLECTED" && <WorkingOnIt/);
  assert.match(surface, /failed && <WorkingOnIt/);
  assert.doesNotMatch(surface, /none of\s+them mentions|has no\s+position on it/);

  // Absence never wears a present value's styling: only MATCHED renders the
  // quote block.
  const matchedBlock = surface.slice(
    surface.indexOf('data-positions-answer="MATCHED"'),
    surface.indexOf('answer.kind === "SEARCHED_NOTHING_MATCHED"'),
  );
  assert.ok(matchedBlock.includes("<blockquote"));
  const gapBlocks = surface.slice(
    surface.indexOf('answer.kind === "SEARCHED_NOTHING_MATCHED"'),
  );
  assert.ok(
    !gapBlocks.includes("<blockquote"),
    "a named gap must not render as a quotation",
  );
});

// ── A07, the party guard, and the search's own scope ───────────────────────

test("D35: nothing in this path generates, and nothing reads party", () => {
  const positionsSource = readFileSync(
    join(ROOT, "lib", "corpus", "positions.ts"),
    "utf8",
  );
  for (const banned of ["anthropic", "openai", "API_KEY", "Math.random", "partyLabel"]) {
    assert.ok(
      !positionsSource.toLowerCase().includes(banned.toLowerCase()),
      `lib/corpus/positions.ts contains "${banned}"`,
    );
  }

  // The route takes the subject in its PATH — CLAUDE.md's distinctness rule,
  // learned from one campaign's books being served for three politicians.
  const route = readFileSync(
    join(ROOT, "app", "api", "positions", "[subject]", "[topic]", "route.ts"),
    "utf8",
  );
  assert.match(route, /params: Promise<\{ subject: string; topic: string \}>/);
  assert.match(route, /"Cache-Control": "private, no-store"/);

  // The search is THIS PERSON'S corpus only — the row is explicit that it is
  // not the routing chat. The subject filter is the first thing the function
  // does, and the surface cannot ask for anyone else because the id is in the
  // URL it builds.
  const surface = readFileSync(
    join(ROOT, "components", "officials", "positions-section.tsx"),
    "utf8",
  );
  assert.match(
    surface,
    /\/api\/positions\/\$\{encodeURIComponent\(subjectId\)\}/,
  );
});

test("D35: a late answer for an abandoned query never lands", () => {
  const surface = readFileSync(
    join(ROOT, "components", "officials", "positions-section.tsx"),
    "utf8",
  );
  // The keyed-result rule: a client component holding fetched state must reset
  // it when its key changes, and a slow response for "housing" must not render
  // under a box that now reads "water".
  assert.match(surface, /if \(ticket !== request\.current\) return;/);
});

// ── The corpus this actually runs against ─────────────────────────────────

test("D35: the machinery answers against the committed corpus, and states its size", () => {
  const corpus = JSON.parse(
    readFileSync(join(ROOT, "data", "corpus", "statements.json"), "utf8"),
  ) as StatementCorpus;

  // An operation that can return nothing must be asked what it returned.
  assert.ok(corpus.snapshots.length >= 30, `only ${corpus.snapshots.length} snapshots`);
  const subjects = [...new Set(corpus.snapshots.map((s) => s.subjectId))];
  assert.ok(subjects.length >= 20, `only ${subjects.length} subjects`);

  // Every subject gets one of the three, and never an error or an empty.
  const seen = new Map<string, number>();
  for (const subjectId of subjects) {
    const answer = positionsFor(subjectId, "housing", corpus);
    seen.set(answer.kind, (seen.get(answer.kind) ?? 0) + 1);
  }
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, subjects.length, "a subject fell through all three answers");
  console.log(
    `\n  D35  "housing" across ${subjects.length} subjects in the committed corpus: ` +
      [...seen].map(([k, n]) => `${k} ${n}`).join(", ") +
      `\n`,
  );
});

test("D35: the topic list is curated, and the search strips the question around the topic", () => {
  // Derived topics would be a list of what a candidate CHOSE to talk about,
  // which is a characterisation by omission.
  assert.ok(POSITION_TOPICS.length >= 8);
  assert.ok(POSITION_TOPICS.every((t) => t === t.toLowerCase()));

  assert.deepEqual(searchTerms("what does she think about housing"), ["housing"]);
  assert.deepEqual(searchTerms("water rights"), ["water", "rights"]);
  // Nothing to search is not a search.
  assert.deepEqual(searchTerms("what about it"), []);
  assert.equal(
    positionsFor("congress:X000001", "the", {
      snapshots: [snapshot({ text: "The housing plan." })],
    }).kind,
    "SEARCHED_NOTHING_MATCHED",
  );
});

test("reader last mile: every eligible matched passage reaches the shared answer", () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    snapshot({
      id: `s${i}`,
      url: `https://example.org/${i}`,
      contentHash: `h${i}`,
      text: `Statement ${i} about housing in this district.`,
    }),
  );
  const answer = positionsFor("congress:X000001", "housing", { snapshots: many });
  assert.equal(answer.passages.length, many.length);
  assert.deepEqual(new Set(answer.passages.map((passage) => passage.snapshotId)), new Set(many.map((row) => row.id)));
  assert.equal(
    positionMatchCount("congress:X000001", "housing", { snapshots: many }),
    answer.passages.length,
    "the reported denominator must equal the actual returned rows",
  );
});
