import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * **BAL-25 (2026-08-28) — THE BALLOT HAD NO BREAKPOINT AT ALL.**
 *
 * Not one `sm:`, `md:`, `lg:` or `xl:` utility existed on this surface: not in
 * `app/ballot/page.tsx` and not in any of the thirteen `components/ballot/*`
 * files. The container was `max-w-2xl`, so a 2,000px desktop rendered a 672px
 * column of ballot and 1,328px of background.
 *
 * The composition these tests hold is deliberately narrow in what it changes:
 * the reading measure does not move, and the extra width buys a second column
 * of WHOLE CARDS. `docs/DESIGN.md`'s "two-column trap" is why — a row that puts
 * a `nowrap` label and a value in competition for a fixed width starves the
 * value, and a contest heading is an arbitrarily long office title. So the
 * columns divide cards, never fields.
 */

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
  /*
   * `app/ballot/loading.tsx` was `max-w-3xl px-5 py-10 sm:py-14` against the
   * page's `max-w-2xl px-4 py-8`, so the heading a reader was looking at jumped
   * narrower, sideways AND upward the moment the ballot arrived — a layout
   * shift on the one screen whose entire job is to say "this is working".
   */
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

test("BAL-25: the second column is a grid of CARDS, and it is one class", () => {
  const src = code(PAGE);
  const uses = src.split("ballot-card-grid").length - 1;
  assert.equal(
    uses,
    2,
    "the contests and the measure groups share one grid; a third use is a new pattern",
  );

  assert.match(CSS, /\.ballot-card-grid \{/, "the class is defined in the stylesheet");

  /*
   * Single column below the breakpoint, so the phone render is unchanged by
   * construction rather than by inspection. `1024px` is Tailwind's `lg`, which
   * is the breakpoint every utility above uses — two breakpoints for one
   * composition would tear at whichever width they disagreed on.
   *
   * **BAL-39 (2026-08-31) — THE MECHANISM CHANGED AND THE PROPERTY DID NOT.**
   *
   * This asserted a two-column GRID, which is what BAL-25 shipped and what
   * BAL-39 measured as the cause of the owner's holes: a grid places in ROWS,
   * a row's height is its tallest card, and every shorter card leaves a hole
   * whose size is set by its row-mate. Gaps ran 13px to 689px at 85701.
   *
   * Column FLOW lays each card under the previous one in its own column, so a
   * tall card pushes only what is below it. The properties this test actually
   * cares about are unchanged and are asserted below: one column on a phone,
   * two at `lg`, one class for both surfaces. What is gone is the assertion
   * that the mechanism is `grid-template-columns`, because pinning a mechanism
   * is how a test outlives the reason it was written.
   *
   * The GAPS themselves are measured on the rendered DOM by the SB0831 block
   * in `walk-all.mts`; a stylesheet reading cannot see a hole.
   */
  assert.match(CSS, /\.ballot-card-grid \{[^}]*display:\s*block/, "the base rule is one column");
  assert.doesNotMatch(
    CSS,
    /\.ballot-card-grid \{[^}]*grid-template-columns/,
    "a row-placing grid is what put the holes in it (BAL-39)",
  );
  assert.match(
    CSS,
    /@media \(min-width: 1024px\) \{\s*\.ballot-card-grid \{[^}]*columns:\s*2/,
    "and two columns arrive at lg, the same breakpoint the container widens at",
  );
  assert.match(
    CSS,
    /\.ballot-card-grid > \[data-contest-id\] \{[^}]*break-inside:\s*avoid/,
    "a card is never split across the column boundary — the one thing columns do wrong",
  );
});

test("BAL-25: no ballot surface answers the desktop with a label/value column pair", () => {
  /*
   * `docs/DESIGN.md` — "The two-column trap". A naive desktop grid on the
   * contest rows is refused: where a label can be arbitrarily long (an office
   * title, a body name) the answer is to STACK, not to tune the width. This
   * sweeps the whole ballot component directory for a responsive two-column
   * grid that is not the card grid.
   */
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
