import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The returning reader: the ZIP is remembered between visits, the reader confirms or re-enters it with their
 * own recent places in reach, and a district is never assumed from it. A ZIP is a ZCTA that crosses city,
 * county, school and legislative lines, so a district resolved from one would be a false claim.
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

  assert.doesNotMatch(source, /QUICK_ZIPS/, "the pilot showcase is removed");
});

test("the zip is remembered between visits, and a link still wins", () => {
  const stored = readFileSync(STORED_ZIP, "utf8");

  // Reopening the site opens on the reader's own area. Asserted on the call, not on comments.
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

  // The entry card resolves a ZIP to a centroid and nothing else, never to districts.
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
