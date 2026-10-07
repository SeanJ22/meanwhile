import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The extra width buys a second column of whole candidates within an office; columns divide cards, never fields. */

const ROOT = process.cwd();
const PAGE = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");
const LOADING = readFileSync(join(ROOT, "app", "ballot", "loading.tsx"), "utf8");
const CSS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function mainClasses(src: string): string[] {
  const found = /<main className="([^"]+)"/.exec(code(src));
  assert.ok(found, "the route renders a <main> with a class list");
  return found![1]!.split(/\s+/).filter(Boolean);
}

test("BAL-25: the ballot surface has responsive utilities at all", () => {
  const responsive = [...code(PAGE).matchAll(/\b(?:sm|md|lg|xl):[a-z[]/g)];
  assert.ok(
    responsive.length > 0,
    "the page carried zero breakpoint utilities across 2,282 lines",
  );
});

test("BAL-25: the container widens on desktop and the reading measure does not", () => {
  const classes = mainClasses(PAGE);
  assert.ok(classes.includes("max-w-2xl"), "the phone width is unchanged");
  assert.ok(
    classes.some((c) => /^lg:max-w-/.test(c)),
    "and the desktop is given a wider envelope to compose in",
  );

  /*
   * The point of the rule: prose is capped back to the phone's measure at the
   * same breakpoint the container widens at. Without these the change would be
   * "widen the paragraphs", which is the thing it must not be.
   */
  const capped = [...code(PAGE).matchAll(/lg:max-w-2xl/g)];
  assert.ok(
    capped.length >= 8,
    `only ${capped.length} block(s) cap their measure — the prose would run the full width`,
  );
});

test("BAL-25: the loading skeleton hands over without moving the heading", () => {
  /* The loading skeleton matches the page container, so nothing shifts when the ballot arrives. */
  const page = mainClasses(PAGE);
  const loading = mainClasses(LOADING).filter((c) => c !== "min-h-dvh");
  assert.deepEqual(
    loading.slice().sort(),
    page.slice().sort(),
    "the skeleton's container must be the page's container, breakpoint for breakpoint",
  );

  /* And the chrome row above the eyebrow, or the heading still starts higher
     on the skeleton than on the page by the height of that row. */
  assert.match(code(LOADING), /<ThemeToggle/, "the skeleton renders the page's own row");
  assert.match(code(LOADING), /Back to the map/);
});

test("BAL-43: offices read top to bottom; both candidate paths share the desktop columns", () => {
  const src = code(PAGE);
  assert.equal(src.split('className="ballot-office-list"').length - 1, 1);
  assert.equal(src.split('className="ballot-candidate-grid mt-3.5"').length - 1, 2,
    "certified nominees and filed candidacies use the same layout");
  assert.match(src, /className="ballot-office-list">\s*\{candidacyContests\.map\(/,
    "office order remains the existing contest order");
  assert.match(CSS, /\.ballot-office-list \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*gap:\s*var\(--space-3\)/);
  assert.match(CSS, /\.ballot-candidate-grid \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    "phone and tablet candidates remain one column");
  assert.match(CSS, /@media \(min-width: 1024px\) \{\s*\.ballot-candidate-grid \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    "only desktop uses two candidate columns");
  assert.doesNotMatch(CSS, /\.ballot-office-list \{[^}]*[;{]\s*columns:/,
    "offices cannot flow into a second column");
  assert.match(src, /data-office-tier-start=/);
  assert.match(CSS, /\.ballot-office-card\[data-office-tier-start="true"\] \{[^}]*border-top-width:\s*3px/,
    "tier transitions have a clear divider without reordering offices");
});

test("BAL-43: measure cards keep their prior independent two-column flow", () => {
  assert.equal(code(PAGE).split("ballot-card-grid").length - 1, 1,
    "only measure groups retain the card-column layout");
  assert.match(CSS, /\.ballot-card-grid \{[^}]*display:\s*block/, "the base rule is one column");
  assert.doesNotMatch(
    CSS,
    /\.ballot-card-grid \{[^}]*grid-template-columns/,
    "a row-placing grid is what put the holes in it (BAL-39)",
  );
  assert.match(
    CSS,
    /@media \(min-width: 1024px\) \{[\s\S]*?\.ballot-card-grid \{[^}]*columns:\s*2/,
    "and two columns arrive at lg, the same breakpoint the container widens at",
  );
  assert.match(
    CSS,
    /\.ballot-card-grid > \[data-contest-id\] \{[^}]*break-inside:\s*avoid/,
    "a card is never split across the column boundary — the one thing columns do wrong",
  );
});

test("BAL-25: no ballot surface answers the desktop with a label/value column pair", () => {
  /* No responsive two-column grid other than the card grid: long labels stack. */
  const dir = join(ROOT, "components", "ballot");
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => [f, code(readFileSync(join(dir, f), "utf8"))] as const);

  const offenders: string[] = [];
  for (const [name, src] of [...sources, ["page.tsx", code(PAGE)] as const]) {
    for (const m of src.matchAll(/\b(?:sm|md|lg|xl):grid-cols-\d/g)) {
      offenders.push(`${name}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a responsive column pair on a ballot row is the two-column trap — put whole " +
      `cards in .ballot-card-grid instead. Found: ${offenders.join(", ")}`,
  );
});
