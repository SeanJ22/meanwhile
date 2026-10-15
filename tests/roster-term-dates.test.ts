import assert from "node:assert/strict";
import test from "node:test";

import { isoTermDate, isoTermDateOnPage } from "../lib/civic-data/term-dates.ts";
import { pageWords } from "../lib/control-plane/promotion/section3.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

const { rosterHoldersForBody, currentBodyRosters } = await import("../lib/registry/body-rosters.ts");

const words = (html: string) => pageWords(html);

test("a term date counts only in ISO form", () => {
  assert.equal(isoTermDate("2028-12-31"), "2028-12-31");
  assert.equal(isoTermDate("2028-12"), "2028-12");
  for (const bad of ["December 31, 2028", "2028-13-01", "2028-02-30", "2028", null, 5]) assert.equal(isoTermDate(bad), null);
});

test("a date is verified only when the saved page writes it", () => {
  const page = words("<p>Council Member Ward 3 — Term ends December 31, 2028. Also 1/5/2027 and Jan. 2nd, 2030.</p>");
  assert.ok(isoTermDateOnPage("2028-12-31", page));
  assert.ok(isoTermDateOnPage("2028-12", words("Term expires December 2028")));
  assert.ok(!isoTermDateOnPage("2028-11", words("Term expires December 2028")));
  assert.ok(isoTermDateOnPage("2027-01-05", page));
  assert.ok(isoTermDateOnPage("2030-01-02", page));
  assert.ok(!isoTermDateOnPage("2028-12-30", page), "a different day is not on the page");
  assert.ok(!isoTermDateOnPage("2029-12-31", page), "a different year is not on the page");
});

test("roster holders carry term dates when a roster member holds them, and null otherwise", () => {
  const roster = currentBodyRosters()[0]!;
  const holders = rosterHoldersForBody(roster.bodyId);
  assert.ok(holders.length > 0);
  for (const holder of holders) assert.equal(holder.termEnd, null, "no curated roster states a term end as a date yet");
});
