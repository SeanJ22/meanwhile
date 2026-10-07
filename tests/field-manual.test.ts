import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emptyFieldManual,
  fieldManualEntryId,
  fieldManualLine,
  fieldManualForSource,
  newFieldManualEntry,
  projectFieldManual,
  readFieldManual,
  upsertEntries,
  writeFieldManual,
  type FieldManualEntry,
} from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

function entry(over: Partial<FieldManualEntry> & Pick<FieldManualEntry, "id">): FieldManualEntry {
  return {
    role: "SCOUT",
    kind: "ROUTE",
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

test("source knowledge keeps every role's payload and scopes dead ends to their actual source", () => {
  const entries = [
    entry({ id: "failed", url: "https://state.gov/old", outcome: "FAILED", states: ["mo"], payload: { nextAction: "read new route" } }),
    entry({ id: "working", role: "DETECTIVE", url: "https://state.gov/new", states: ["mo"], payload: { learnedProcedure: "follow official directory" } }),
    entry({ id: "other-state", url: "https://state.gov/elsewhere", states: ["ut"] }),
    entry({ id: "other-host", url: "https://state.gov.example.org/new" }),
  ];
  const store = { ...emptyFieldManual(), entries };
  const selected = fieldManualForSource({ store, revision: 1, projection: projectFieldManual(store) }, "https://state.gov/", "mo");
  assert.deepEqual(selected, [entries[1], entries[0]]);
  assert.equal(selected[0].payload, entries[1].payload);
});

test("fieldManualEntryId is deterministic per (source,key) and namespaced", () => {
  assert.equal(fieldManualEntryId("knowledge.json", "az:meetings"), fieldManualEntryId("knowledge.json", "az:meetings"));
  assert.notEqual(fieldManualEntryId("knowledge.json", "az:meetings"), fieldManualEntryId("other-source", "az:meetings"));
  assert.match(fieldManualEntryId("a", "b"), /^fm-[0-9a-f]{24}$/);
});

test("upsertEntries only grows: a re-import updates in place and never removes", () => {
  let store = emptyFieldManual();
  store = upsertEntries(store, [entry({ id: "fm-a", states: ["nh"] }), entry({ id: "fm-b" })], "2026-09-19");
  assert.equal(store.entries.length, 2);
  store = upsertEntries(store, [entry({ id: "fm-a", states: ["nj"], observedAt: "2026-09-19", title: "updated" })], "2026-09-20");
  assert.equal(store.entries.length, 2, "the store grew or held, never shrank");
  const a = store.entries.find((e) => e.id === "fm-a")!;
  assert.deepEqual(a.states, ["nh", "nj"], "jurisdictions union (a route applies retroactively across states)");
  assert.equal(a.title, "updated", "the fresher observation wins the scalar fields");
  assert.equal(store.updatedOn, "2026-09-20");
});

test("upsertEntries keeps the prior scalar when the incoming observation is older", () => {
  let store = upsertEntries(emptyFieldManual(), [entry({ id: "fm-a", title: "new", observedAt: "2026-09-19" })], "t");
  store = upsertEntries(store, [entry({ id: "fm-a", title: "stale", observedAt: "2026-09-01" })], "t2");
  assert.equal(store.entries[0]!.title, "new", "an older re-observation does not overwrite a newer fact");
});

test("projectFieldManual narrows to role + jurisdiction and caps the count", () => {
  const store = upsertEntries(emptyFieldManual(), [
    entry({ id: "fm-portable", states: [], title: "portable hint" }),
    entry({ id: "fm-az", states: ["az"], title: "az door" }),
    entry({ id: "fm-nh", states: ["nh"], title: "nh door" }),
    entry({ id: "fm-parser", role: "PARSER", states: ["az"], title: "parser recipe" }),
    entry({ id: "fm-shared", role: "SHARED", states: ["az"], title: "shared fact" }),
  ], "t");

  const scoutAz = projectFieldManual(store, { role: "SCOUT", state: "az" });
  const ids = new Set(scoutAz.entryIds);
  assert.ok(ids.has("fm-az"), "the AZ scout door applies");
  assert.ok(ids.has("fm-portable"), "a portable ([]-state) entry always applies");
  assert.ok(ids.has("fm-shared"), "a SHARED-role entry reaches every role");
  assert.ok(!ids.has("fm-nh"), "another state's door is projected away");
  assert.ok(!ids.has("fm-parser"), "another role's entry is projected away");
  assert.equal(scoutAz.total, 5);

  const capped = projectFieldManual(store, { role: "SCOUT", state: "az", limit: 1 });
  assert.equal(capped.lines.length, 1, "the projection is capped so a walk never loads the whole store");
});

test("projectFieldManual ranks yielded, jurisdiction-specific, fresher first", () => {
  const store = upsertEntries(emptyFieldManual(), [
    entry({ id: "fm-dead", states: ["az"], outcome: "FAILED", title: "dead door", observedAt: "2026-09-18" }),
    entry({ id: "fm-live", states: ["az"], outcome: "YIELDED", title: "live door", observedAt: "2026-09-10" }),
    entry({ id: "fm-portable-live", states: [], outcome: "YIELDED", title: "portable", observedAt: "2026-09-19" }),
  ], "t");
  const p = projectFieldManual(store, { role: "SCOUT", state: "az" });
  assert.equal(p.entryIds[0], "fm-live", "a jurisdiction-specific YIELDED door outranks a portable one and a dead one");
  assert.equal(p.entryIds[2], "fm-dead", "a dead door is kept but ranked last");
});

test("fieldManualLine renders a compact one-liner with the door and jurisdiction", () => {
  const line = fieldManualLine(entry({ id: "fm-x", states: ["az"], recordClasses: ["meetings"], url: "https://x.gov", title: "AZ portal", summary: "GET the calendar", observedAt: "2026-09-19T00:00:00Z" }));
  assert.match(line, /SCOUT\/ROUTE YIELDED \(AZ\) \[meetings\]: AZ portal <https:\/\/x\.gov> — GET the calendar seen 2026-09-19/);
});

test("the one write then the one read: what a role wrote is what the next role is shown", async () => {
  const repos = createMemoryRepositories();
  const empty = await readFieldManual(repos, { role: "PARSER" });
  assert.equal(empty.revision, null);
  assert.deepEqual(empty.projection.lines, []);

  const learned = newFieldManualEntry("parser-learning", "nh:minutes", {
    role: "PARSER",
    kind: "PARSE_RULE",
    title: "NH minutes",
    summary: "quote the vote line",
    outcome: "YIELDED",
    states: ["NH"],
  });
  assert.deepEqual(await writeFieldManual(repos, [learned], "2026-09-29"), { written: 1 });
  assert.deepEqual(await writeFieldManual(repos, [], "2026-09-29"), { written: 0 });

  const seen = await readFieldManual(repos, { role: "PARSER", state: "nh" });
  assert.equal(seen.revision, 1);
  assert.deepEqual(seen.projection.entryIds, [learned.id]);
  assert.match(seen.projection.lines[0]!, /PARSER\/PARSE_RULE YIELDED \(NH\).*quote the vote line/);
  // A parser in another state does not inherit a state-specific rule, and a different role does not see a PARSER-only entry.
  assert.equal((await readFieldManual(repos, { role: "PARSER", state: "az" })).projection.entryIds.length, 0);
  assert.equal((await readFieldManual(repos, { role: "AUDITOR", state: "nh" })).projection.entryIds.length, 0);
});

test("a second write grows the store and keeps the first entry", async () => {
  const repos = createMemoryRepositories();
  await writeFieldManual(repos, [entry({ id: "fm-a" })], "2026-09-28");
  await writeFieldManual(repos, [entry({ id: "fm-b", role: "SHARED" })], "2026-09-29");
  const all = await readFieldManual(repos);
  assert.equal(all.store.entries.length, 2);
  assert.equal(all.revision, 2);
});

test("a failed read is returned as an error with an empty projection, not thrown", async () => {
  const repos = createMemoryRepositories();
  const broken = { fieldManual: { ...repos.fieldManual, read: async () => { throw new Error("store down"); } } };
  const read = await readFieldManual(broken as never, { role: "SCOUT" });
  assert.equal(read.error, "store down");
  assert.equal(read.projection.entryIds.length, 0);
});

test("newFieldManualEntry derives its id from (source, key) so a rewrite refreshes one row", () => {
  const a = newFieldManualEntry("s", "k", { role: "SHARED", kind: "K", title: "t", summary: "x", outcome: "REFERENCE" });
  const b = newFieldManualEntry("s", "k", { role: "SHARED", kind: "K", title: "t", summary: "y", outcome: "REFERENCE" });
  assert.equal(a.id, b.id);
  assert.equal(a.id, fieldManualEntryId("s", "k"));
});

test("place scopes rank county doors first and exclude sibling divisions without prefix collisions", () => {
  const county = "ocd-division/country:us/state:ca/county:example";
  const store = upsertEntries(emptyFieldManual(), [
    entry({ id: "portable", states: [], observedAt: "2026-10-04" }),
    entry({ id: "state", states: ["ca"] }),
    entry({ id: "county", states: ["ca"], ocdIds: [county] }),
    entry({ id: "other", states: ["ca"], ocdIds: [county + "ton"] }),
    entry({ id: "body", states: ["ca"], bodyIds: ["board-1"] }),
  ], "now");
  const projected = projectFieldManual(store, { state: "ca", ocdIds: [county + "/place:town"], bodyIds: ["board-1"] });
  assert.deepEqual(projected.entryIds.slice(0, 2), ["body", "county"]);
  assert.ok(!projected.entryIds.includes("other"));
  assert.ok(!projectFieldManual(store, { state: "ca", bodyIds: ["board-2"] }).entryIds.includes("body"));
});

test("legacy investigation and admitted route payloads retain their place without leaking as portable", () => {
  const subjectId = "ocd-division/country:us/state:ca/county:example#governing";
  const investigation = entry({ id: "investigation", kind: "INVESTIGATION_RESULT", states: [], payload: { subjectId } });
  const route = entry({ id: "route", kind: "ROUTE", states: [], payload: { outcomes: [{ jurisdiction: subjectId }] } });
  const store = { ...emptyFieldManual(), entries: [investigation, route] };
  assert.equal(projectFieldManual(store, { state: "nv" }).matched, 0);
  assert.equal(projectFieldManual(store, { state: "ca", ocdIds: ["ocd-division/country:us/state:ca/county:other"] }).matched, 0);
  const written = upsertEntries(store, [route], "now");
  assert.deepEqual(written.entries.find(e => e.id === "route")!.ocdIds, [subjectId.split("#")[0]]);
});

test("reobserving an entry unions place and body scope without dropping earlier reach", () => {
  const first = entry({ id: "scoped", ocdIds: ["ocd-division/country:us/state:ca/county:a"], bodyIds: ["board-a"] });
  const next = { ...first, ocdIds: ["ocd-division/country:us/state:ca/county:b"], bodyIds: ["board-b"] };
  const store = upsertEntries(upsertEntries(emptyFieldManual(), [first], "one"), [next], "two");
  assert.deepEqual(store.entries[0]!.bodyIds, ["board-a", "board-b"]);
  assert.equal(store.entries[0]!.ocdIds!.length, 2);
});
