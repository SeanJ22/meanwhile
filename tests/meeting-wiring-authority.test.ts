/**
 * Every https URL a meeting wiring row configures passes `authorityFor` for the meetings source. A `…Base` key is a
 * base the adapter composes routes under, never fetched as written, so only its host must inherit authority.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { authorityFor } from "../lib/civic-data/source-authority.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";

function configuredUrls(value: unknown, key = "", out: { key: string; url: string }[] = []) {
  if (typeof value === "string" && value.startsWith("https://")) out.push({ key, url: value });
  else if (Array.isArray(value)) for (const item of value) configuredUrls(item, key, out);
  else if (value && typeof value === "object") for (const [k, item] of Object.entries(value)) configuredUrls(item, k, out);
  return out;
}

test("every https route a meeting wiring row configures inherits meetings-public-bodies authority", () => {
  const refused: string[] = [];
  let checked = 0;
  for (const row of SOURCE_WIRING) {
    for (const { key, url } of configuredUrls(row.config)) {
      checked += 1;
      const verdict = authorityFor("meetings-public-bodies", "MEETING", url);
      if (verdict.ok) continue;
      if (key.endsWith("Base") && verdict.code === "FINAL_ROUTE_NOT_REGISTERED") continue;
      refused.push(`${row.bodyId} ${key} ${url}: ${verdict.code}`);
    }
  }
  assert.ok(checked > 100, `the wiring registry configures more than 100 routes (read ${checked})`);
  assert.deepEqual(refused, []);
});

test("the two Newbury publications C9 wired are authorized routes", () => {
  for (const url of ["https://newburynhlibrary.net/feed/", "https://www.newburyenergynh.org/"]) {
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", url).ok, true, url);
  }
  assert.equal(authorityFor("meetings-public-bodies", "MEETING", "https://newburynhlibrary.net/wp-admin/").ok, false,
    "authority is scoped to the one route wired, not the whole host");
});
