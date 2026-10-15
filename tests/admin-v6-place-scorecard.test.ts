import assert from "node:assert/strict";
import test from "node:test";
import { OWED_STATES, owedStatesOf, pageOwed, scorePlace, type OwedRowLike, type OwedState } from "../lib/control-plane/admin-view/place-scorecard.ts";
import { resolvePlaceKey, readPlaceOwed, type PlaceOwedDeps } from "../lib/control-plane/admin-view/place-owed-read.ts";
import { v6PlaceNotMeasured, v6PlaceSection } from "../lib/control-plane/admin-view/v6-place-section.ts";

const row = (id: string, checklistId: string, state: OwedState, subject = "Board A", sourceUrl?: string): OwedRowLike => ({
  id, checklistId, state, requirement: `${checklistId} — requirement`, subject: { id: subject, kind: "body", label: subject },
  held: sourceUrl ? [{ sourceUrl, checkedAt: "2026-09-29T00:00:00.000Z", state: "published" }] : [],
});
const NAMES = { GOV: "Governments", OFF: "Officeholders", MTG: "Meetings" };
const ORDER = ["GEO", "GOV", "OFF", "MTG"];

test("the score counts what is captured overall and by group, and floors the percentage", () => {
  const rows = [
    row("1", "GOV-01", "published", "A", "https://a.gov"), row("2", "GOV-01", "held"), row("3", "GOV-02", "missing"),
    row("4", "OFF-01", "stale"), row("5", "OFF-01", "unpublished"), row("6", "MTG-01", "missing"), row("7", "MTG-01", "missing"),
  ];
  const score = scorePlace(rows, NAMES, ORDER);
  assert.equal(score.overall.total, 7);
  assert.equal(score.overall.captured, 3);
  assert.equal(score.overall.percent, 42.8); // 3/7 = 42.857…, floored, never rounded up
  assert.deepEqual(score.groups.map((g) => g.group), ["GOV", "OFF", "MTG"]);
  const gov = score.groups[0];
  assert.deepEqual([gov.published, gov.held, gov.missing, gov.total, gov.percent], [1, 1, 1, 3, 66.6]);
  assert.equal(score.groups[1].stale, 1);
  assert.equal(score.groups[1].unpublished, 1);
  assert.equal(score.groups[2].percent, 0);
});

test("a place with nothing owed has no percentage, and all-captured is exactly 100", () => {
  assert.equal(scorePlace([], NAMES, ORDER).overall.percent, null);
  assert.equal(scorePlace([row("1", "GOV-01", "published")], NAMES, ORDER).overall.percent, 100);
  const nearly = Array.from({ length: 1000 }, (_, i) => row(String(i), "GOV-01", i === 0 ? "missing" : "published"));
  assert.equal(scorePlace(nearly, NAMES, ORDER).overall.percent, 99.9);
});

test("the owed list puts the work first, filters by group, status and words, and windows with a cursor", () => {
  const rows = [row("1", "GOV-01", "published", "Zed", "https://z.gov"), row("2", "GOV-02", "missing", "Beta"), row("3", "GOV-02", "missing", "Alpha"),
    row("4", "OFF-01", "stale", "Alpha"), row("5", "OFF-02", "held", "Alpha")];
  const all = pageOwed(rows, { group: null, states: null, q: null, offset: 0, limit: 10 });
  assert.deepEqual(all.items.map((i) => i.key), ["3", "2", "4", "5", "1"]);
  const gov = pageOwed(rows, { group: "GOV", states: null, q: null, offset: 0, limit: 1 });
  assert.equal(gov.total, 3);
  assert.equal(gov.nextOffset, 1);
  assert.equal(pageOwed(rows, { group: "GOV", states: null, q: null, offset: 1, limit: 1 }).items[0].key, "2");
  assert.deepEqual(pageOwed(rows, { group: null, states: ["stale"], q: null, offset: 0, limit: 5 }).items.map((i) => i.key), ["4"]);
  assert.deepEqual(pageOwed(rows, { group: null, states: null, q: "zed", offset: 0, limit: 5 }).items.map((i) => i.key), ["1"]);
  assert.equal(all.items.at(-1)?.sourceUrl, "https://z.gov");
  assert.equal(gov.prevOffset, null);
  assert.equal(pageOwed(rows, { group: "GOV", states: null, q: null, offset: 1, limit: 1 }).prevOffset, 0);
  assert.deepEqual(owedStatesOf("can-do"), ["missing", "stale"]);
  assert.equal(owedStatesOf("needs-fix"), null);
});

test("only a ZIP, a county, a congressional district or a state is a place", () => {
  assert.deepEqual(resolvePlaceKey("geo:az.zcta.85635"), { kind: "zip", zip: "85635", state: "az" });
  assert.deepEqual(resolvePlaceKey("geo:az.county.04019"), { kind: "county", geoid: "04019", state: "az" });
  assert.deepEqual(resolvePlaceKey("geo:az.congressional_district.0406"), { kind: "district", geoid: "0406", state: "az" });
  assert.deepEqual(resolvePlaceKey("st:az"), { kind: "state", state: "az" });
  for (const bad of ["us", "geo:az.congressional_district.06", "geo:az.cbsa.38060", "body:x", "geo:az.zcta.856"]) {
    const r = resolvePlaceKey(bad);
    assert.ok("says" in r && r.state === "REFUSED", bad);
  }
});

test("a failed read is a named refusal, never an empty place that looks finished", async () => {
  const good: PlaceOwedDeps = {
    now: () => "2026-09-30T18:00:00.000Z",
    resolveDivisions: async () => ({ label: "ZIP 85635", covers: "x", divisions: [{ id: "ocd-division/country:us/state:az/county:cochise", label: "Cochise County" }] }),
    readHeld: async () => ({ subjects: [], held: [] }),
  };
  const geography = await readPlaceOwed("geo:az.zcta.85635", { ...good, resolveDivisions: async () => { throw new Error("boom"); } }, { fresh: true });
  assert.equal(geography.state, "REFUSED");
  assert.match((geography as { says: string }).says, /Nothing is shown/);
  const held = await readPlaceOwed("geo:az.zcta.85635", { ...good, readHeld: async () => { throw new Error("db down"); } }, { fresh: true });
  assert.equal(held.state, "REFUSED");
  assert.match((held as { says: string }).says, /withheld rather than shown as zero/);
  const read = await readPlaceOwed("geo:az.zcta.85635", good, { fresh: true });
  assert.equal(read.state, "READ");
  if (read.state !== "READ") return;
  assert.ok(read.rows.length > 0, "an empty held set still owes the discovery items");
  assert.ok(read.rows.every((r) => r.state === "missing"));
});

test("the section carries the score on top, the status bars, one window of items and a send-agents action on open work", async () => {
  const rows = [row("1", "GOV-01", "published", "A", "https://a.gov"), row("2", "GOV-02", "missing", "B")];
  const read = { state: "READ" as const, placeKey: "geo:az.zcta.85635", label: "ZIP 85635", covers: "all", divisions: [{ id: "ocd-division/country:us/state:az/county:cochise", label: "Cochise County" }],
    rows: rows as never, observedAt: "2026-09-30T18:00:00.000Z", readMs: { geography: 1, held: 1 } };
  const section = v6PlaceSection(read, { group: "GOV", states: null, q: null, offset: 0, limit: 50 });
  assert.equal(section.contract, "admin-v6/checklist@1");
  assert.equal(section.scope, "geo:az.zcta.85635");
  assert.equal(section.data.score.overall.percent, 50);
  assert.equal(section.data.definitionCount, 327);
  assert.equal(section.data.items.length, 2);
  const missing = section.data.items.find((i) => i.key === "2")!;
  assert.deepEqual(missing.actions, [{ kind: "send-agents", target: "geo:az.zcta.85635", label: "Send agents", payload: { words: "Deploy fleet to Arizona Cochise" } }]);
  assert.deepEqual(section.data.items.find((i) => i.key === "1")!.actions, []);
  assert.equal(section.data.items.find((i) => i.key === "1")!.sourceUrl, "https://a.gov");
  const gov = section.data.placeGroups.find((g) => g.group === "GOV")!;
  assert.equal(gov.counts.reduce((a, b) => a + b, 0), 2);
  assert.equal(section.page.total, 2);
  const none = v6PlaceNotMeasured("us", "Choose a place.", "2026-09-30T18:00:00.000Z");
  assert.equal(none.data.score, null);
  assert.equal(none.data.definitions.length, 327);
  assert.deepEqual([...OWED_STATES].sort(), ["held", "missing", "published", "stale", "unpublished"]);
});

test("a Send for a ZIP names the county it sits in, never the whole state, and a county or state names itself", async () => {
  const { placeSendWords } = await import("../lib/control-plane/admin-view/v6-place-section.ts");
  const divisions = [{ id: "ocd-division/country:us/state:az", label: "Arizona" }, { id: "ocd-division/country:us/state:az/county:cochise", label: "Cochise County" }, { id: "ocd-division/country:us/state:az/place:sierra_vista", label: "Sierra Vista" }];
  assert.equal(placeSendWords("geo:az.zcta.85635", "ZIP 85635", divisions), "Deploy fleet to Arizona Cochise");
  assert.equal(placeSendWords("geo:az.zcta.85635", "ZIP 85635", []), null, "a ZIP whose county is unknown is not widened to the whole state");
  assert.equal(placeSendWords("geo:az.county.04019", "Pima County, AZ"), "Deploy fleet to Arizona Pima");
  assert.equal(placeSendWords("st:az", "Arizona"), "Deploy fleet to Arizona");
});
