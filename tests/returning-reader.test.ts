import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * M07 — the returning reader (2026-08-18).
 *
 * Three clauses, and the third is the load-bearing one:
 *
 *   1. the zip is remembered,
 *   2. the reader CONFIRMS it or RE-ENTERS it on return,
 *   3. a district is NEVER assumed from it.
 *
 * Clause 1: the current location is remembered between visits (Sean, October
 * 1, 2026, replacing the August per-tab rule), so reopening the site opens on
 * the reader's own area; the recents list keeps their other places.
 *
 * Clause 2 was the gap this session closed. The re-ask landed on a card
 * offering four zips belonging to somebody else, while the reader's own recent
 * places sat in `wtp.recent_zips` reachable only from the zip switcher — which
 * cannot open until a location already exists. The list built so a second visit
 * costs one tap was unreachable on the second visit, so the only route back to
 * your own town was to retype it.
 *
 * Clause 3 has never had a guard of its own, which is why one is written here.
 * It is the clause with real consequences: a zip is a ZCTA, a statistical shape
 * built from mail routes that runs straight through city, county, school and
 * legislative lines, so a district resolved from one is a false claim about
 * what is on somebody's ballot. The storage key is literally named
 * `approximate_location` to keep that in front of whoever reads the code next.
 */

const WELCOME = join(process.cwd(), "components", "map", "welcome-overlay.tsx");
const STORED_ZIP = join(process.cwd(), "hooks", "use-stored-zip.ts");
const RECENTS = join(process.cwd(), "hooks", "use-recent-zips.ts");

test("the returning reader is offered their own recent places without a pilot showcase", () => {
  const source = readFileSync(WELCOME, "utf8");

  assert.match(
    source,
    /useRecentZips\(\)/,
    "the entry card reads the device's recents",
  );
  assert.match(
    source,
    /recents\.length > 0 &&/,
    "the recents block renders only when there is something to offer",
  );
  assert.match(
    source,
    /recents\.map\(/,
    "each recent zip is offered as its own one-tap button",
  );

  assert.doesNotMatch(source, /QUICK_ZIPS/, "FE-39 removes the pilot showcase");
});

test("the zip is remembered between visits, and a link still wins", () => {
  const stored = readFileSync(STORED_ZIP, "utf8");

  // Sean, October 1, 2026: reopening the site opens on the reader's own area.
  // This replaces the 6f rule (per-tab, asks on every fresh open). Asserted on
  // the CALL, never on the word: a guard that reads comments passes or fails on
  // someone's paragraph rather than on the code.
  assert.match(
    stored,
    /window\.localStorage\.(get|set)Item\(STORAGE_KEY/,
    "the current location is kept on the device between visits",
  );
  assert.ok(
    !/window\.sessionStorage/.test(stored),
    "the current location is no longer per-tab",
  );
  assert.match(
    stored,
    /linkZip !== null\) return JSON\.stringify\(\{ zip: linkZip \}\)/,
    "a link's ?zip= still names the place to open",
  );

  const recents = readFileSync(RECENTS, "utf8");
  assert.match(
    recents,
    /window\.localStorage\.(get|set)Item/,
    "the recents list is the one location thing that outlives the tab",
  );
});

test("a district is never assumed from a zip — the key says what the value is", () => {
  const stored = readFileSync(STORED_ZIP, "utf8");

  assert.match(
    stored,
    /wtp\.approximate_location/,
    "the stored key names the value as approximate, not as district truth",
  );

  /*
   * The entry card resolves a zip to a CENTROID and nothing else. If it ever
   * grew a district lookup, the reader would be handed districts derived from a
   * mail-route polygon — the exact inference CLAUDE.md's entry-experience rule
   * forbids, and the one this product cannot notice is wrong on its own.
   */
  const welcome = readFileSync(WELCOME, "utf8");
  const forbidden = [
    "divisionsAt",
    "coverageAt",
    "resolveDistrict",
    "districtsFor",
  ];
  const found = forbidden.filter((name) => welcome.includes(name));
  assert.deepEqual(
    found,
    [],
    `the entry card resolves a centroid only; it must not resolve districts: ${found.join(", ")}`,
  );

  // The one honest route to a real district is an address the reader chose to
  // give, and it is keyed separately so the two can never be confused.
  const mapEntry = readFileSync(
    join(process.cwd(), "components", "map", "map-entry.tsx"),
    "utf8",
  );
  assert.match(
    mapEntry,
    /startsWith\("street:"\)/,
    "an address-derived view is keyed apart from a zip-derived one",
  );
});
