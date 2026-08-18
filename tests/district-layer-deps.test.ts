import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANVAS = readFileSync(
  join(ROOT, "components", "map", "map-canvas.tsx"),
  "utf8",
);

/**
 * M139 sub-item 1 — the half-load, and the one dependency that caused it.
 *
 * ## What was reported, across three sessions, never diagnosed
 *
 * "Arriving from an NH zip, or returning from the ballot page, the sidebar
 * sometimes renders BLANK and WGH sometimes half."
 *
 * ## What it actually was
 *
 * `ensureDistricts()` reads the active state off `focusAbbrRef` — a REF. A
 * ref changing re-renders nothing and re-runs no effect. The effect that
 * CALLS it depended only on `districtTypes` and `ensureDistricts`, neither of
 * which changes when a state activates. So a pass that ran before the state
 * had resolved saw `abbr === null`, emptied `wanted`, took every district
 * layer off the map — and nothing ever called it again.
 *
 * A cold arrival usually recovered by luck, because `ensureDistricts` is also
 * subscribed to `styledata` and that tends to fire after the state activates.
 * Coming back from the ballot page the style is already parsed, so the second
 * chance fires early or not at all. That is the "sometimes", and it is why
 * the ballot-page return was the entrance people noticed.
 *
 * ## Measured, both sides
 *
 * `pnpm probe:m139` at 03255, sampling the stat tiles every 100 ms through
 * both reported entrances. BEFORE: the districts tile read 0 for the whole
 * ten-second window on 1 of 3 returns, recovered after about 2s on another,
 * and was fine on the third. AFTER: 8 of 8 returns reached the full 54 within
 * about 1.6s and none stuck.
 *
 * ## Why a source scan
 *
 * `react-hooks/exhaustive-deps` cannot catch this. The value the effect
 * really depends on is read through a ref, and a ref is invisible to that
 * rule by design — which is exactly why the dependency went missing and
 * stayed missing. A human reading the deps list cannot see it either. So the
 * requirement is written down where it can fail.
 */

test("M139: the district pass re-runs when the active state resolves", () => {
  /*
    Anchored on the call rather than on line numbers: find the effect whose
    body is `ensureDistricts();` and read its dependency array.
  */
  const match = CANVAS.match(
    /useEffect\(\(\) => \{\s*ensureDistricts\(\);\s*\},\s*\[([^\]]*)\]\)/,
  );

  assert.ok(
    match,
    "could not find the effect that calls ensureDistricts() — if it was " +
      "restructured, re-establish that the active state still re-triggers the pass",
  );

  const deps = match[1]
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  assert.ok(
    deps.includes("focusStateOcdId"),
    "the effect that calls ensureDistricts() no longer depends on " +
      "focusStateOcdId. ensureDistricts reads the active state through " +
      "focusAbbrRef, and a REF changing re-runs nothing — so a pass that runs " +
      "before the state resolves removes every district layer and is never " +
      `called again. That is the half-load. Deps found: ${deps.join(", ")}`,
  );
});

const DOOR = readFileSync(
  join(ROOT, "components", "map", "door-overlay.tsx"),
  "utf8",
);

test("M139: the districts door renders two sections, never one wearing both names", () => {
  /*
    Sub-item 3. The door used to be either/or — the governing set at an
    address, the drawn set everywhere else — so two different claims shared
    one heading depending on where the reader stood. They are now two
    sections with a rule between them and a count each.
  */
  assert.match(DOOR, /heading="Districts you're in"/, "the governing section is gone");
  assert.match(DOOR, /heading="Districts in view"/, "the drawn section is gone");
  assert.match(
    DOOR,
    /border-t border-\[var\(--panel-border\)\]/,
    "the dividing line between the two sections is gone",
  );
});

test("M139: a zip never claims to know which districts the reader is in", () => {
  /*
    The row's own wording for the first section was "Districts in this zip",
    and that is the one thing deliberately not built. A ZCTA crosses city,
    county and school lines, so a centroid can sit in a different town than
    the reader — `deriveStatsView` already settles this and CLAUDE.md's entry
    rule settles it above that. The section is gated on a resolved ADDRESS and
    renders a named gap otherwise.
  */
  /*
    Scanned with COMMENTS STRIPPED. The component explains at length why this
    phrasing was not built, quoting the row's own wording to do it — so a scan
    of the raw file finds the phrase in the very paragraph forbidding it, and
    the first run of this test failed against a correct file for exactly that
    reason. What must not exist is the rendered string, not the discussion.
  */
  const code = DOOR.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  assert.ok(
    !/Districts in this zip/i.test(code),
    "a heading claims the districts of a zip — a ZCTA crosses city, county and " +
      "school lines, so that is a district claim a zip cannot support",
  );
  assert.match(
    DOOR,
    /atAddress && coverage/,
    "the governing rows are no longer gated on a resolved address",
  );
  assert.match(
    DOOR,
    /A zip code crosses city, county and school district lines/,
    "the honest gap line for the no-address case is gone — absence must be " +
      "named as ours, never rendered as an empty list that reads as a finding",
  );
});

test("M139: a section with no answer shows no number, rather than a zero", () => {
  /*
    "We can't tell you from a zip" and "the answer is none" are different
    sentences, and a 0 beside a heading says the second one.
  */
  assert.match(
    DOOR,
    /\{count !== null && \(/,
    "the door section renders its count unconditionally — a null count must " +
      "render no number at all, not 0",
  );
});

test("M139: the active state is still read through a ref, which is why the dep is needed", () => {
  /*
    The other half of the argument. If `ensureDistricts` were ever changed to
    take the state as an argument or read it from a state variable, the
    dependency above would stop being load-bearing and this reasoning would
    need revisiting rather than silently persisting.
  */
  assert.match(
    CANVAS,
    /const abbr = focusAbbrRef\.current;/,
    "ensureDistricts no longer reads the active state from focusAbbrRef — " +
      "the dependency asserted above was justified BY that ref, so re-rule on " +
      "it rather than leaving a rule whose reason has gone",
  );

  assert.match(
    CANVAS,
    /focusAbbrRef\.current = stateAbbrFromOcdId\(focusStateOcdId\);/,
    "the ref is no longer synced from focusStateOcdId, so naming that value in " +
      "the deps above would no longer make the pass see the new state",
  );
});
