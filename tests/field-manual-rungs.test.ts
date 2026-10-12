/**
 * A ZIP-playbook step that names no place is sorted by its own words: a step
 * that names a state, or a website that belongs to one state, applies to that
 * state; a generic search method is offered anywhere it fits; the rest wait on
 * the review list for the state profiles. The same sorting applies to a step
 * written later.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { entryInSlice, newFieldManualEntry, normalizeEntry, readFieldManual, writeFieldManual, type FieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { copiedReach } from "../lib/control-plane/field-manual-copy.ts";
import { isGenericSearchMethod, rungStates, sortRung } from "../lib/control-plane/field-manual-rungs.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

const NOW = "2026-10-08T12:00:00.000Z";
const rung = (title: string, lead = "", over: Partial<FieldManualEntry> = {}): FieldManualEntry => newFieldManualEntry("docs/zip-playbook.md", title, {
  role: "SHARED", kind: "PLAYBOOK_RUNG", title, summary: lead, outcome: "REFERENCE", observedAt: null, payload: { doc: "docs/zip-playbook.md", lead, heading: title }, ...over,
});

test("a step names a state by its name, by a website of that state, or by its code beside a ZIP code", () => {
  assert.deepEqual(rungStates("Four inherited NEW HAMPSHIRE branches failed here"), ["nh"]);
  assert.deepEqual(rungStates("the filing PDF on sos.nh.gov"), ["nh"]);
  assert.deepEqual(rungStates("the same `suttonnh.gov` board pages answered 403"), ["nh"]);
  assert.deepEqual(rungStates("azsos.gov publishes the canvass"), ["az"]);
  assert.deepEqual(rungStates("a school at district.k12.nj.us"), ["nj"]);
  assert.deepEqual(rungStates("AZ 85641 hyperfocus"), ["az"]);
  assert.deepEqual(rungStates("NJ2 4. THE CENSUS AND TIGER DISAGREE"), ["nj"]);
  assert.deepEqual(rungStates("West Virginia's portal"), ["wv"]);
  assert.deepEqual(rungStates("New Jersey has five Washington Townships"), ["nj"], "a town named Washington is not the state");
  assert.deepEqual(rungStates("the VA at va.gov, the Census at census.gov, interior.gov"), [], "federal websites belong to no state");
  assert.deepEqual(rungStates("`<district>.k12.<st>.us`, then the Board page"), [], "a placeholder names no state");
});

test("a generic search method is a search pattern or a national source", () => {
  for (const text of ["query `site:gov inurl:agenda`", "A web search reported the wrong commissioner", "The Census of Governments individual-units listing", "The .gov registry is a rung"]) {
    assert.equal(isGenericSearchMethod(text), true, text);
  }
  assert.equal(isGenericSearchMethod("A CSS state class must beat the base class"), false);
});

test("sorting: a state first, then a generic search method, then the review list; a step that already applies somewhere is left alone", () => {
  assert.deepEqual(sortRung(rung("Which of New Hampshire's branches fail elsewhere", "a web search"))!.entry.states, ["nh"], "a state wins over search words");
  assert.equal(sortRung(rung("Q: Bing gave me a shoe brand", "two traps"))!.sort, "METHOD");
  assert.equal(sortRung(rung("Playwright page.evaluate: no inner functions"))!.sort, "REVIEW");
  assert.equal(sortRung(rung("A step", "", { states: ["az"] })), null);
  assert.equal(sortRung({ ...rung("Not a step"), kind: "LESSON" }), null);
});

test("a sorted step applies where it was sorted to, in the copy and when written later", async () => {
  const stated = normalizeEntry(rung("4. FOUR INHERITED NEW HAMPSHIRE BRANCHES FAILED HERE"));
  const offered = normalizeEntry(rung("A search summary is not a source", "A web search reported"));
  const review = normalizeEntry(rung("Reading a CMS page: strip the navigation"));
  assert.deepEqual([copiedReach(stated), copiedReach(offered), copiedReach(review)], ["STATE", "METHOD", "NOWHERE"]);
  const job = { role: "SCOUT" as const, ocdIds: ["ocd-division/country:us/state:az/county:pima"] };
  assert.deepEqual([entryInSlice(stated, job), entryInSlice(offered, job), entryInSlice(review, job)], [false, true, false]);
  assert.equal(entryInSlice(stated, { role: "SCOUT", ocdIds: ["ocd-division/country:us/state:nh/place:concord"] }), true);

  const repos = createMemoryRepositories();
  await writeFieldManual(repos, [rung("A later step about New Jersey's county clerks"), rung("A later search step", "use site: queries")], NOW);
  const page = await readFieldManual(repos, { role: "SCOUT", ocdIds: ["ocd-division/country:us/state:nj/county:morris"] });
  assert.equal(page.store.entries.length, 2, "both reach a New Jersey job: one for its state, one offered anywhere");
  const elsewhere = await readFieldManual(repos, { role: "SCOUT", ocdIds: ["ocd-division/country:us/state:tx/county:harris"] });
  assert.deepEqual(elsewhere.store.entries.map((e) => e.title), ["A later search step"]);
});
