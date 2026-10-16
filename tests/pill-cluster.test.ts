import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ASK_PILL_EXAMPLES,
  ASK_PILL_LABELS,
} from "../lib/routing/ask-pill-labels.ts";

// The DOM half (one rendered cluster per state) runs against a real browser in the walk harness; everything a
// browser is not needed for is here.

const ROOT = join(import.meta.dirname, "..");

test("4e: location is decided by exactly two booleans, and WGH wins", async () => {
  const { clusterPlacement } = await import(
    "../lib/map/cluster-placement.ts"
  );

  assert.equal(clusterPlacement({ wgh: true, sidebar: true }), "wgh");
  assert.equal(clusterPlacement({ wgh: true, sidebar: false }), "wgh");
  assert.equal(clusterPlacement({ wgh: false, sidebar: true }), "sidebar");
  assert.equal(clusterPlacement({ wgh: false, sidebar: false }), "map");

  // Total over its input: four states in, four real placements out.
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
  // A large battlecard never hosts the cluster, and the rule does not take the battlecard as an input.
  assert.match(
    source,
    /export function clusterPlacement\(open: \{\s*wgh: boolean;\s*sidebar: boolean;\s*\}\)/,
    "clusterPlacement must take exactly the two booleans the rule names",
  );

  const entry = readFileSync(
    join(ROOT, "components", "map", "map-entry.tsx"),
    "utf8",
  );
  // One construction, three slots. Matched at line start so prose naming the element is not counted.
  const constructions = entry.match(/^\s*<PillCluster$/gm) ?? [];
  assert.equal(
    constructions.length,
    1,
    `the cluster is constructed ${constructions.length} times; 4e allows one`,
  );
});

test("4a: the Ask pill opens Ask and nothing else", async () => {
  const entry = readFileSync(
    join(ROOT, "components", "map", "map-entry.tsx"),
    "utf8",
  );
  // Ask is one of the small popups, so opening it closes the large card, but it never opens another surface
  // and never touches the sidebar.
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
  // Mutual and symmetric, in one statement rather than three call sites that can drift.
  assert.match(rule[1], /setSidebarState\(/);
  assert.match(rule[1], /setNoticeCollapsed\(/);
  assert.match(rule[1], /setLarge\(null\)/);
});

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

    // The shortest form that still names at least one concrete example; a bare "Ask" has lost the point.
    assert.notEqual(row.label.trim().toLowerCase(), "ask");
    assert.ok(
      ASK_PILL_EXAMPLES.some((example) =>
        row.label.toLowerCase().includes(example),
      ),
      `the ${placement} pill reads ${JSON.stringify(row.label)} and names no example`,
    );

    // The accessible name may be longer than the visible one, and must be.
    assert.ok(row.ariaLabel.length >= row.label.length);

    // Each row records the width that forced it, and why.
    assert.ok(row.maxPx > 0);
    assert.ok(row.note.length > 40, `the ${placement} row does not say why`);
  }

  // The tightest placement is the shortest label.
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
  // Ask input must not commit keystrokes to the meeting filter: a sentence matches nothing and empties the map.
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

test("4h: the pointer is always visible, names its source, and opens in the app", () => {
  const note = readFileSync(
    join(ROOT, "components", "ballot", "filing-note.tsx"),
    "utf8",
  );
  // A real button with its state announced: not a link (which would leave) and not a div with a handler.
  assert.match(note, /<button\b/);
  assert.match(note, /aria-expanded=\{open\}/);
  assert.match(note, /aria-controls=\{panelId\}/);
  assert.ok(!/target="_blank"/.test(note), "the annotation must open in the app");

  const page = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");
  assert.match(page, /<FilingNote/, "the ballot page must use the annotation");
  // The summary names the source organisation.
  assert.match(page, /Candidates as filed with \$\{contest\.provenance\.sourceOrg\}/);
  assert.match(page, /Nominees per the certified primary canvass/);
});
