import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emptyFieldManual,
  entryInSlice,
  fieldManualEntryId,
  fieldManualLine,
  fieldManualForSource,
  foldEntries,
  mergeEntry,
  newFieldManualEntry,
  normalizeEntry,
  projectFieldManual,
  readFieldManual,
  writeFieldManual,
  type FieldManualEntry,
  type FieldManualRepos,
} from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { FixMapRow } from "../lib/method/fix-map.ts";

function entry(over: Partial<FieldManualEntry> & Pick<FieldManualEntry, "id">): FieldManualEntry {
  return {
    role: "SCOUT",
    kind: "ROUTE_NOTE",
    title: "a route",
    summary: "does a thing",
    states: [],
    recordClasses: [],
    platforms: [],
    outcome: "YIELDED",
    url: null,
    source: "test",
    observedAt: null,
    tier: null,
    payload: {},
    ...over,
  };
}

const PIMA = "ocd-division/country:us/state:az/county:pima";
const TUCSON = "ocd-division/country:us/state:az/county:pima/place:tucson";
const MARICOPA = "ocd-division/country:us/state:az/county:maricopa";
const MORRIS = "ocd-division/country:us/state:nj/county:morris";
const CONCORD = "ocd-division/country:us/state:nh/place:concord";
const HARRIS = "ocd-division/country:us/state:tx/county:harris";
const store = (...entries: FieldManualEntry[]) => ({ entries: foldEntries(entries) });

test("source knowledge keeps every role's payload and takes only that source's entries", () => {
  const entries = [
    entry({ id: "failed", url: "https://state.gov/old", outcome: "FAILED", states: ["mo"], payload: { nextAction: "read new route" } }),
    entry({ id: "working", role: "DETECTIVE", url: "https://state.gov/new", states: ["mo"], payload: { learnedProcedure: "follow official directory" } }),
    entry({ id: "other-host", url: "https://state.gov.example.org/new" }),
  ];
  const read = { store: { entries }, projection: projectFieldManual({ entries }) };
  const selected = fieldManualForSource(read, "https://state.gov/");
  assert.deepEqual(selected.map((e) => e.id), ["failed", "working"]);
  assert.equal(selected[1]!.payload, entries[1]!.payload);
});

test("fieldManualEntryId is deterministic per (source,key) and namespaced", () => {
  assert.equal(fieldManualEntryId("knowledge.json", "az:meetings"), fieldManualEntryId("knowledge.json", "az:meetings"));
  assert.notEqual(fieldManualEntryId("knowledge.json", "az:meetings"), fieldManualEntryId("other-source", "az:meetings"));
  assert.match(fieldManualEntryId("a", "b"), /^fm-[0-9a-f]{24}$/);
});

test("a re-observation updates the entry in place: the fresher fields win and reach unions", () => {
  const first = mergeEntry(null, entry({ id: "fm-a", states: ["nh"], observedAt: "2026-09-18" }));
  const next = mergeEntry(first, entry({ id: "fm-a", states: ["nj"], observedAt: "2026-09-19", title: "updated" }));
  assert.deepEqual(next.states, ["nh", "nj"]);
  assert.deepEqual(next.reach!.states, ["nh", "nj"]);
  assert.equal(next.title, "updated");
  const stale = mergeEntry(next, entry({ id: "fm-a", title: "stale", observedAt: "2026-09-01" }));
  assert.equal(stale.title, "updated", "an older re-observation does not overwrite a newer fact");
});

test("a lesson without a state no longer applies everywhere; only one its writer marks portable does", () => {
  const unplaced = entry({ id: "unplaced", title: "learned somewhere" });
  const portable = entry({ id: "portable", title: "applies to every job", portable: true });
  const job = { role: "SCOUT" as const, state: "az", ocdIds: [PIMA] };
  const p = projectFieldManual(store(unplaced, portable), job);
  assert.deepEqual(p.entryIds, ["portable"]);
  assert.ok(!entryInSlice(normalizeEntry(unplaced), job));
  assert.ok(!entryInSlice(normalizeEntry(unplaced), { role: "SCOUT" }), "not even for a job with no place");
});

test("a lesson's own record places it: the subject it names", () => {
  const investigation = entry({ id: "investigation", kind: "INVESTIGATION_RESULT", payload: { subjectId: `${PIMA}#governing` } });
  const s = store(investigation);
  assert.deepEqual(s.entries[0]!.reach!.places, [PIMA]);
  assert.deepEqual(projectFieldManual(s, { ocdIds: [TUCSON] }).entryIds, ["investigation"], "a county lesson applies inside the county");
  assert.equal(projectFieldManual(s, { ocdIds: [MARICOPA], state: "az" }).matched, 0, "not in a sibling county of the same state");
});

test("merges never narrow where a lesson applies", () => {
  const portable = mergeEntry(mergeEntry(null, entry({ id: "p", portable: true })), entry({ id: "p", states: ["az"], observedAt: "2026-10-01" }));
  assert.equal(portable.reach!.everywhere, true, "a portable lesson re-seen in one state stays portable");
  assert.ok(entryInSlice(portable, { role: "SCOUT", state: "nh" }));

  const statewide = mergeEntry(mergeEntry(null, entry({ id: "s", states: ["az"] })), entry({ id: "s", ocdIds: [PIMA], observedAt: "2026-10-01" }));
  assert.deepEqual(statewide.reach!.states, ["az"]);
  assert.deepEqual(statewide.reach!.places, [PIMA]);
  assert.ok(entryInSlice(statewide, { state: "az", ocdIds: [MARICOPA] }), "a statewide lesson re-seen in one county still applies across the state");

  const anyClass = mergeEntry(mergeEntry(null, entry({ id: "c" })), entry({ id: "c", recordClasses: ["meetings"], observedAt: "2026-10-01" }));
  assert.deepEqual(anyClass.recordClasses, [], "a lesson for any record class stays for any");

  const places = mergeEntry(mergeEntry(null, entry({ id: "b", ocdIds: [PIMA], bodyIds: ["board-a"] })),
    entry({ id: "b", ocdIds: [MARICOPA], bodyIds: ["board-b"], observedAt: "2026-10-01" }));
  assert.deepEqual(places.reach!.places, ["body:board-a", "body:board-b", MARICOPA, PIMA]);
});

test("platform lessons apply by platform in any state; specific-source lessons stay with their place", () => {
  const platform = entry({ id: "platform", kind: "AUDIT_LESSON", platforms: ["legistar"], states: ["az"], title: "legistar lesson" });
  const door = entry({ id: "door", kind: "VENDOR_TENANT", platforms: ["legistar"], url: "https://webapi.legistar.com/v1/pima/events", ocdIds: [PIMA] });
  const s = store(platform, door);
  assert.deepEqual(projectFieldManual(s, { ocdIds: [MORRIS], platform: "legistar" }).entryIds, ["platform"], "a legistar lesson learned in AZ reaches a legistar job in NJ");
  assert.deepEqual(projectFieldManual(s, { ocdIds: [MORRIS], platform: "civicplus" }).entryIds, [], "not a job on another platform");
  assert.deepEqual([...projectFieldManual(s, { ocdIds: [TUCSON], platform: "legistar" }).entryIds].sort(), ["door", "platform"]);
  assert.deepEqual(projectFieldManual(s, { ocdIds: [MARICOPA], platform: "legistar" }).entryIds, ["platform"], "Pima's own door stays with Pima");
});

test("every worker sees every method, ranked: this place, its state, three or more states, elsewhere with where it worked", () => {
  const method = (id: string) => entry({ id, kind: "METHOD", role: "SHARED", platforms: [], title: id });
  const works = (methodId: string, placeId: string): FixMapRow => ({ methodId, placeId, state: "WORKS", triedAt: "2026-10-01T00:00:00.000Z", attemptId: "a", cause: null, updatedAt: "2026-10-01T00:00:00.000Z" });
  const s = store(method("here"), method("state"), method("national"), method("elsewhere"), method("never"), method("fails"));
  const rows = [works("here", PIMA), works("state", MARICOPA), works("national", MORRIS), works("national", CONCORD), works("national", HARRIS),
    works("elsewhere", MORRIS), { ...works("fails", PIMA), state: "FAILS" as const, cause: "the list moved" }, works("fails", MARICOPA)];
  const evidence = (place: string) => ({ here: rows.filter((r) => r.placeId === place), works: Object.fromEntries(
    ["here", "state", "national", "elsewhere", "never", "fails"].map((id) => [id, {
      places: rows.filter((r) => r.methodId === id && r.state === "WORKS").map((r) => r.placeId),
      states: [...new Set(rows.filter((r) => r.methodId === id && r.state === "WORKS").map((r) => /state:([a-z]{2})/.exec(r.placeId)![1]!))].sort(),
    }])) });
  const p = projectFieldManual(s, { ocdIds: [PIMA] }, evidence(PIMA));
  assert.deepEqual(p.entryIds, ["here", "state", "national", "elsewhere", "never"]);
  assert.deepEqual(p.tiers, [1, 2, 3, 4, 5]);
  assert.match(p.lines[0]!, /\[works here\]$/);
  assert.match(p.lines[1]!, /untried here.*worked in maricopa AZ/);
  assert.match(p.lines[2]!, /worked in 3 states: NH, NJ, TX/);
  assert.match(p.lines[3]!, /worked in morris NJ/);
  assert.equal(p.leftOutFailingHere, 1, "the method that fails here is left out here");
  const maricopa = projectFieldManual(s, { ocdIds: [MARICOPA] }, evidence(MARICOPA));
  assert.ok(maricopa.entryIds.includes("fails"), "and only here: it works in Maricopa");
});

test("fieldManualLine renders a compact one-liner with the door and jurisdiction", () => {
  const line = fieldManualLine(entry({ id: "fm-x", states: ["az"], recordClasses: ["meetings"], url: "https://x.gov", title: "AZ portal", summary: "GET the calendar", observedAt: "2026-09-19T00:00:00Z" }));
  assert.match(line, /SCOUT\/ROUTE_NOTE YIELDED \(AZ\) \[meetings\]: AZ portal <https:\/\/x\.gov> — GET the calendar seen 2026-09-19/);
});

test("the one write then the one read: what a role wrote is what the next role is shown", async () => {
  const repos = createMemoryRepositories();
  const empty = await readFieldManual(repos, { role: "PARSER" });
  assert.deepEqual(empty.projection.lines, []);

  const learned = newFieldManualEntry("parser-learning", "nh:minutes", {
    role: "PARSER", kind: "PARSE_RULE", title: "NH minutes", summary: "quote the vote line", outcome: "YIELDED", states: ["NH"],
  });
  assert.deepEqual(await writeFieldManual(repos, [learned], "2026-09-29"), { written: 1 });
  assert.deepEqual(await writeFieldManual(repos, [], "2026-09-29"), { written: 0 });

  const seen = await readFieldManual(repos, { role: "PARSER", state: "nh" });
  assert.deepEqual(seen.projection.entryIds, [learned.id]);
  assert.match(seen.projection.lines[0]!, /PARSER\/PARSE_RULE YIELDED \(NH\).*quote the vote line/);
  assert.equal((await readFieldManual(repos, { role: "PARSER", state: "az" })).projection.entryIds.length, 0);
  assert.equal((await readFieldManual(repos, { role: "AUDITOR", state: "nh" })).projection.entryIds.length, 0);
});

test("a write touches only its own rows: a second write keeps the first", async () => {
  const repos = createMemoryRepositories();
  await writeFieldManual(repos, [entry({ id: "fm-a", portable: true })], "2026-09-28");
  await writeFieldManual(repos, [entry({ id: "fm-b", role: "SHARED", portable: true })], "2026-09-29");
  const rows = await repos.fieldManual.list();
  assert.deepEqual(rows.map((r) => [r.id, r.revision]), [["fm-a", 1], ["fm-b", 1]]);
});

function interleaved(): { repos: FieldManualRepos; gate: () => void } {
  const base = createMemoryRepositories();
  let waiting: (() => void)[] = [];
  let reads = 0;
  const fieldManual = { ...base.fieldManual, readMany: async (ids: readonly string[]) => {
    const rows = await base.fieldManual.readMany(ids);
    reads += 1;
    if (reads <= 2) await new Promise<void>((resolve) => { waiting.push(resolve); if (waiting.length === 2) { waiting.forEach((go) => go()); waiting = []; } });
    return rows;
  } };
  return { repos: { fieldManual }, gate: () => waiting.forEach((go) => go()) };
}

test("concurrent saves lose nothing: two writers on the same lesson and on different lessons", async () => {
  const { repos } = interleaved();
  const a = entry({ id: "shared", ocdIds: [PIMA], outcome: "YIELDED", observedAt: "2026-10-01T00:00:00.000Z" });
  const b = entry({ id: "shared", ocdIds: [MORRIS], outcome: "FAILED", observedAt: "2026-10-01T00:00:01.000Z" });
  const [ra, rb] = await Promise.all([
    writeFieldManual(repos, [a, entry({ id: "only-a", portable: true })], "2026-10-01T00:00:00.000Z"),
    writeFieldManual(repos, [b, entry({ id: "only-b", portable: true })], "2026-10-01T00:00:01.000Z"),
  ]);
  assert.deepEqual([ra, rb], [{ written: 2 }, { written: 2 }]);
  const rows = new Map((await repos.fieldManual.list()).map((r) => [r.id, r] as const));
  assert.deepEqual([...rows.keys()].sort(), ["only-a", "only-b", "shared"]);
  const shared = rows.get("shared")!;
  assert.equal(shared.revision, 2, "the second save merged onto the first instead of replacing it");
  assert.deepEqual(shared.value.reach!.places, [PIMA, MORRIS]);
  assert.deepEqual(shared.value.placeResults!.map((r) => [r.place, r.outcome]), [[PIMA, "YIELDED"], [MORRIS, "FAILED"]]);
});

test("many concurrent writers each keep their own lesson and their reach", async () => {
  const repos = createMemoryRepositories();
  const states = ["az", "nj", "nh", "tx", "ca", "pa", "oh", "mi"];
  await Promise.all(states.map((state, i) => writeFieldManual(repos, [
    entry({ id: "common", states: [state], observedAt: `2026-10-01T00:00:0${i}.000Z` }),
    entry({ id: `own-${state}`, states: [state] }),
  ], "2026-10-01T00:00:00.000Z")));
  const rows = await repos.fieldManual.list();
  assert.equal(rows.length, states.length + 1, "every lesson saved, and no write gave up");
  assert.deepEqual(rows.find((r) => r.id === "common")!.value.reach!.states, [...states].sort());
});

test("a failed read is returned as an error with an empty projection, not thrown", async () => {
  const repos = createMemoryRepositories();
  const broken = { fieldManual: { ...repos.fieldManual, select: async () => { throw new Error("store down"); } } };
  const read = await readFieldManual(broken, { role: "SCOUT" });
  assert.equal(read.error, "store down");
  assert.equal(read.projection.entryIds.length, 0);
});

test("newFieldManualEntry derives its id from (source, key) so a rewrite refreshes one row", () => {
  const a = newFieldManualEntry("s", "k", { role: "SHARED", kind: "K", title: "t", summary: "x", outcome: "REFERENCE" });
  const b = newFieldManualEntry("s", "k", { role: "SHARED", kind: "K", title: "t", summary: "y", outcome: "REFERENCE" });
  assert.equal(a.id, b.id);
  assert.equal(a.id, fieldManualEntryId("s", "k"));
});

test("place scopes rank this place first and exclude sibling divisions without prefix collisions", () => {
  const county = "ocd-division/country:us/state:ca/county:example";
  const s = store(
    entry({ id: "portable", portable: true, observedAt: "2026-10-04" }),
    entry({ id: "state", states: ["ca"] }),
    entry({ id: "county", states: ["ca"], ocdIds: [county] }),
    entry({ id: "other", states: ["ca"], ocdIds: [county + "ton"] }),
    entry({ id: "body", states: ["ca"], bodyIds: ["board-1"] }),
  );
  const projected = projectFieldManual(s, { ocdIds: [county + "/place:town"], bodyIds: ["board-1"] });
  assert.deepEqual(projected.entryIds, ["body", "county", "state", "portable"]);
  assert.ok(!projectFieldManual(s, { state: "ca", bodyIds: ["board-2"] }).entryIds.includes("body"));
  assert.equal(emptyFieldManual().entries.length, 0);
});
