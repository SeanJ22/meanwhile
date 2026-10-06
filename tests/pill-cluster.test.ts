import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ASK_PILL_EXAMPLES,
  ASK_PILL_LABELS,
} from "../lib/routing/ask-pill-labels.ts";

/**
 * G05 rules 4a / 4e and G07, held where a test can hold them.
 *
 * The DOM half of 4e — "COUNTS RENDERED INSTANCES ... and asserts exactly one,
 * in the expected place, in all four states, at four zips and both viewports"
 * — is deliberately NOT here. It cannot be: a function returning one answer
 * and a page painting one cluster are different claims, and only the second is
 * what a reader sees. That check lives in `scripts/walk-all.mts` section H and
 * runs against a real browser. What is here is everything a browser is not
 * needed for, so a failure lands in `pnpm test` in half a second instead of in
 * a nine-second page load.
 */

const ROOT = join(import.meta.dirname, "..");

// ── 4e: the placement rule, as a total function ───────────────────────────

test("4e: location is decided by exactly two booleans, and WGH wins", async () => {
  const { clusterPlacement } = await import(
    "../lib/map/cluster-placement.ts"
  );

  assert.equal(clusterPlacement({ wgh: true, sidebar: true }), "wgh");
  assert.equal(clusterPlacement({ wgh: true, sidebar: false }), "wgh");
  assert.equal(clusterPlacement({ wgh: false, sidebar: true }), "sidebar");
  assert.equal(clusterPlacement({ wgh: false, sidebar: false }), "map");

  // The function is TOTAL over its input: four states in, four answers out,
  // every one of them a real placement. There is no state in which the rule
  // has no answer, which is what stops a fifth condition being bolted on.
  const answers = new Set(
    [true, false].flatMap((wgh) =>
      [true, false].map((sidebar) => clusterPlacement({ wgh, sidebar })),
    ),
  );
  assert.deepEqual([...answers].sort(), ["map", "sidebar", "wgh"]);
});

test("4e: a battlecard is not a parameter, so it can never host the cluster", async () => {
  const source = readFileSync(
    join(ROOT, "lib", "map", "cluster-placement.ts"),
    "utf8",
  );
  // The rule's own words: "a large battlecard never hosts it, so with a
  // battlecard open the cluster is on the map." A rule that took the
  // battlecard as an input could be made to answer otherwise; this one cannot.
  assert.match(
    source,
    /export function clusterPlacement\(open: \{\s*wgh: boolean;\s*sidebar: boolean;\s*\}\)/,
    "clusterPlacement must take exactly the two booleans the rule names",
  );

  const entry = readFileSync(
    join(ROOT, "components", "map", "map-entry.tsx"),
    "utf8",
  );
  // ONE construction, three slots. Two of these in the tree is how a "single
  // instance" rule becomes two on screen. Matched at the start of a line so
  // the prose above the code, which names the element, is not counted as one.
  const constructions = entry.match(/^\s*<PillCluster$/gm) ?? [];
  assert.equal(
    constructions.length,
    1,
    `the cluster is constructed ${constructions.length} times; 4e allows one`,
  );
});

// ── 4a: Ask is standalone, and opens nothing else ─────────────────────────

test("4a: the Ask pill opens Ask and nothing else", async () => {
  const entry = readFileSync(
    join(ROOT, "components", "map", "map-entry.tsx"),
    "utf8",
  );
  /*
   * **MTG-11 (2026-08-25): the dependency array is matched loosely now, and
   * this rule is UNCHANGED.**
   *
   * It read `\}, \[\]\);` — an EMPTY deps array — so the guard went red the
   * moment the handler acquired a dependency, reporting "the Ask toggle is
   * missing" about a handler sitting right there. That is a guard pinned to an
   * incidental fact rather than to its own claim (RULING 116's shape).
   *
   * **4a and MTG-11 do not conflict, and the distinction is the point.** 4a is
   * about SURFACES — the who-governs card, the sidebar, the large card — and
   * its named defect is that tapping Ask used to un-collapse the who-governs
   * card. MTG-11 is about the SMALL CARDS, the venue and district selections,
   * and the author's `17-22-03` shows the eight-meeting Vail card still open
   * behind *Where can I vote?*. Ask dismisses those and still touches no
   * surface, which is what the forbidden list below asserts and what the test
   * beneath this one asserts positively.
   */
  /*
   * **Approved reader design (2026-09-28; Sean: "one active contextual
   * surface").** Ask is now one of the three small popups, so opening it DOES
   * close the large card — the design's one-view rule supersedes 4a's "Ask
   * closes nothing". What 4a named as the defect still may not happen: tapping
   * Ask may never OPEN another surface (it used to un-collapse the
   * who-governs card), and it never touches the sidebar.
   */
  const src = entry.replace(/\r/g, "");
  const start = src.indexOf("const openPopup = useCallback(");
  assert.ok(start >= 0, "the popup opener (which opens Ask) is missing");
  const body = src.slice(start, src.indexOf("\n    [pop, closePop, closeCard, takeForeground],", start));
  for (const forbidden of [
    "setNoticeCollapsed(false)",
    "setSidebarState",
    "openLarge",
    "pushLarge",
    "openSurface",
  ]) {
    assert.ok(
      !body.includes(forbidden),
      `opening Ask calls ${forbidden} — 4a: Ask may never open another surface`,
    );
  }
  const cluster = readFileSync(join(ROOT, "components", "shell", "pill-cluster.tsx"), "utf8");
  assert.ok(cluster.includes(`onClick={() => onOpenPop("ask")}`), "the Ask pill opens the Ask popup");
});

test("4c: one surface at a time is one function, and every opener goes through it", async () => {
  const entry = readFileSync(
    join(ROOT, "components", "map", "map-entry.tsx"),
    "utf8",
  );
  const rule = /const openSurface = useCallback\(\s*\(surface: "sidebar" \| "wgh" \| "large"\) => \{([\s\S]*?)\n    \},/.exec(
    entry,
  );
  assert.ok(rule, "openSurface is missing");
  // Mutual and symmetric: whichever surface opens, the other two are closed
  // in the same statement rather than in three call sites that can drift.
  assert.match(rule[1], /setSidebarState\(/);
  assert.match(rule[1], /setNoticeCollapsed\(/);
  assert.match(rule[1], /setLarge\(null\)/);
});

// ── G07: the label carries the teaching ───────────────────────────────────

test("G07: no placement's pill says a bare Ask, and every one names an example", () => {
  const placements = Object.keys(ASK_PILL_LABELS).sort();
  assert.deepEqual(
    placements,
    ["map", "sidebar", "wgh"],
    "a label is recorded for every placement 4e can produce, and no others",
  );

  for (const placement of placements) {
    const row = ASK_PILL_LABELS[placement as keyof typeof ASK_PILL_LABELS];
    assert.equal(row.placement, placement, "the row knows its own placement");

    // The rule: "Where the pill's width forbids the full example string, use
    // the shortest form that still names at least one concrete example." A
    // label that degrades to "Ask" has lost the entire point.
    assert.notEqual(row.label.trim().toLowerCase(), "ask");
    assert.ok(
      ASK_PILL_EXAMPLES.some((example) =>
        row.label.toLowerCase().includes(example),
      ),
      `the ${placement} pill reads ${JSON.stringify(row.label)} and names no example`,
    );

    // The accessible name may be longer than the visible one, and must be.
    assert.ok(row.ariaLabel.length >= row.label.length);

    // Each row records the width that forced it, and why. An unexplained
    // width is a number nobody can check against a later layout change.
    assert.ok(row.maxPx > 0);
    assert.ok(row.note.length > 40, `the ${placement} row does not say why`);
  }

  // The tightest placement really is the shortest label — that is the whole
  // shape of the rule, and getting it backwards would be invisible otherwise.
  assert.ok(
    ASK_PILL_LABELS.map.label.length < ASK_PILL_LABELS.sidebar.label.length,
    "the map pill has the least room and must carry the shortest form",
  );
  assert.ok(ASK_PILL_LABELS.map.maxPx < ASK_PILL_LABELS.sidebar.maxPx);
});

test("G07: DESIGN.md records the labels, and cites the file rather than copying it", () => {
  const design = readFileSync(join(ROOT, "docs", "DESIGN.md"), "utf8");
  assert.match(
    design,
    /lib\/routing\/ask-pill-labels\.ts/,
    "DESIGN.md must point at the committed labels rather than restating them",
  );
  for (const placement of ["map", "sidebar", "wgh"]) {
    assert.ok(
      design.includes(placement),
      `DESIGN.md does not record the ${placement} placement`,
    );
  }
});

// ── M119: one input, and the search box is gone rather than dark ──────────

test("M119: the rail renders no input of its own, and search-box.tsx is deleted", () => {
  const sidebar = readFileSync(
    join(ROOT, "components", "shell", "sidebar.tsx"),
    "utf8",
  );
  assert.ok(
    !/<input/.test(sidebar) && !/SearchBox/.test(sidebar),
    "the rail carries a second input again",
  );
  assert.throws(
    () => readFileSync(join(ROOT, "components", "shell", "search-box.tsx")),
    "search-box.tsx must be deleted, not left unrendered — a component that still renders an input is how 'one input' becomes two again",
  );

  // The ask panel is the only component in the shell that renders one.
  const panel = readFileSync(
    join(ROOT, "components", "ask", "ask-box.tsx"),
    "utf8",
  );
  assert.equal(
    (panel.match(/<input\b/g) ?? []).length,
    1,
    "the ask panel renders more than one input",
  );
});

test("M119: a question never narrows the map, and a name still does", () => {
  const panel = readFileSync(
    join(ROOT, "components", "ask", "ask-box.tsx"),
    "utf8",
  );
  /*
   * The defect this pins, caught in a 390px screenshot: the merged input
   * committed every keystroke to `search/input`, which is a FILTER. Typing
   * "whats going on where i live" matched no meeting, so the count badge read
   * 0 meetings and the map emptied mid-sentence — and an empty map is the one
   * thing this product may never render.
   */
  assert.match(
    panel,
    /const matches = value\.trim\(\) \? searchItems\(index, value\)\.length : 0;/,
    "the filter must commit only on text that matches the index",
  );
  assert.match(
    panel,
    /dispatch\(\{ type: "search\/input", query: matches > 0 \? value : "" \}\);/,
  );
  // And submitting an ask releases any filter still applied.
  assert.match(
    panel,
    /dispatch\(\{ type: "search\/input", query: "" \}\);/,
    "submitting an ask must release the map filter",
  );
});

// ── 4h, superseded by FE-14: the filing record lives in the contest's Sources ──

test("FE-14: the contest names whose list it is, and its link and read date sit only in Sources", () => {
  const page = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");
  // The summary still NAMES the source organisation on the face.
  assert.match(page, /Candidates as filed with \$\{contest\.provenance\.sourceOrg\}/);
  assert.match(page, /Nominees per the certified primary canvass/);
  // The record itself goes to the contest's Sources section.
  assert.match(page, /<CardSourcesContribution\s+id=\{`contest-record:\$\{contest\.id\}`\}/);
  assert.doesNotMatch(page, /<FilingNote/, "no in-place source panel on the card face");
});
