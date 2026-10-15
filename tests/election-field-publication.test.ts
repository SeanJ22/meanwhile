import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { publishElectionFields, type ElectionFieldVerifier } from "../lib/civic-data/election-field-publication.ts";
import { electionFieldState, type ElectionFieldInput } from "../lib/civic-data/election-fields.ts";
import { readElectionFieldsForDivisions } from "../lib/civic-data/curated-reader-read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { section3Record } from "../lib/control-plane/promotion/section3.ts";

const now = "2026-09-30T12:00:00.000Z";
const division = "ocd-division/country:us/state:oh";
const source = "https://elections.example.gov/2026";
const make = (text: string, kind: ElectionFieldInput["kind"] = "registration_deadline", value = text, quote = text): ElectionFieldInput => ({
  divisionId: division, kind, sourceUrl: source, value, quote, dates: kind === "registration_deadline" ? ["2026-10-05"] : [],
  document: { url: source, text, collectedAt: now, capture: { observedAt: now, httpStatus: 200,
    transport: "REACHABLE", partial: false, evidence: { canonicalUrl: source, text, retrievedAt: now,
      contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`, sourceId: "Official election authority",
      artifactId: "saved-election-page", acquiredByAttemptId: "official-page-acquisition", methodRouteId: "official-page" } } },
});

const verify: ElectionFieldVerifier = section3Record;

test("official calendar shorthand and relative statutory rules resolve to the held election date", async () => {
  for (const [text, dates] of [
    ["5-Oct First day; 2-Nov Last day", ["2026-10-05", "2026-11-02"]],
    ["October 19, 2026, to November 1, 2026; October 27 & 29, 2026", ["2026-10-19", "2026-11-01", "2026-10-27", "2026-10-29"]],
    ["Mail registration closes on the 3rd Wednesday preceding the election.", ["2026-10-14"]],
    ["Applications must arrive by the fifth day immediately preceding the election.", ["2026-10-29"]],
    ["Voting begins fourteen days preceding the election and ends on the Sunday preceding the election.", ["2026-10-20", "2026-11-01"]],
    ["Registration closes fifteen days before each election.", ["2026-10-19"]],
    ["Online applications close at 5 p.m. the Friday before Election Day.", ["2026-10-30"]],
    ["In-person applications close at 4 p.m. the day before Election Day.", ["2026-11-02"]],
    ["30 days prior to election day for absentee voting in person;", ["2026-10-04"]],
    ["Online registration closes eight days before Election Day; in-person registration continues through Election Day.", ["2026-10-26", "2026-11-03"]],
  ] as const) {
    const store = new MemoryRoutineDataStore();
    const field = { ...make(text), electionDate: "2026-11-03", dates: [] };
    const result = await publishElectionFields({ store, now, fields: [field], verify });
    assert.ok(result.promotedVersionId, JSON.stringify(result.gaps));
    const read = await readElectionFieldsForDivisions([division], { store, now, bypassCache: true });
    assert.deepEqual(read.fields[0].value.dates, [...dates].sort());
  }
});

test("a changed abbreviated calendar deadline replaces its existing contextual field", async () => {
  const store = new MemoryRoutineDataStore();
  const first = await publishElectionFields({ store, now, fields: [{ ...make("26-October Registration closes"), electionDate: "2026-11-03", dates: ["2026-10-26"] }], verify });
  const next = await publishElectionFields({ store, now, fields: [{ ...make("27-October Registration closes"), electionDate: "2026-11-03", dates: ["2026-10-27"] }], verify });
  assert.equal(first.fields[0], next.fields[0]);
  const read = await readElectionFieldsForDivisions([division], { store, now, bypassCache: true });
  assert.equal(read.fields.length, 1);
  assert.deepEqual(read.fields[0].value.dates, ["2026-10-27"]);
});

test("the same election-field publication and Reader path accepts every national jurisdiction class", async () => {
  for (const [prefix, state] of [["state", "WI"], ["district", "DC"], ["territory", "PR"], ["territory", "GU"]]) {
    const divisionId = `ocd-division/country:us/${prefix}:${state.toLowerCase()}`;
    const store = new MemoryRoutineDataStore();
    const field = { ...make("Registration deadline October 5, 2026"), divisionId };
    const result = await publishElectionFields({ store, now, fields: [field], verify });
    assert.ok(result.promotedVersionId, `${state}: ${JSON.stringify(result.gaps)}`);
    const read = await readElectionFieldsForDivisions([divisionId], { store, now, bypassCache: true });
    assert.equal(read.fields.length, 1);
    assert.equal(read.fields[0].value.state, state);
  }
  for (const id of ["ocd-division/country:us/state:dc", "ocd-division/country:us/district:wi",
    "ocd-division/country:us/state:xx", "ocd-division/country:ca/state:wi"]) assert.equal(electionFieldState(id), null);
});

test("one verified election field publishes while an unrelated unconfirmed field stays open", async () => {
  const store = new MemoryRoutineDataStore();
  const supported = make("2026 General Election Registration deadline October 5, 2026");
  const missing = { ...supported, value: "not on the official page" };
  const result = await publishElectionFields({ store, now, fields: [supported, missing], verify });
  assert.ok(result.promotedVersionId);
  assert.equal(result.fields.length, 1);
  assert.equal(result.gaps.length, 1);
  const read = await readElectionFieldsForDivisions([division], { store, now, bypassCache: true });
  assert.equal(read.reads[0].kind, "PROMOTED");
  assert.equal(read.fields[0].value.collectedAt, now);
  assert.deepEqual(read.fields[0].value.dates, ["2026-10-05"]);
  assert.equal((await readElectionFieldsForDivisions(["ocd-division/country:us/state:az"], { store, now })).fields.length, 0);
});

test("saved-page lookup evidence publishes navigation without an assigned voting place", async () => {
  const store = new MemoryRoutineDataStore();
  const target = "https://voter.example.gov/lookup";
  const page = `Find your polling place ${target}`;
  const result = await publishElectionFields({ store, now, fields: [make(page, "polling_lookup", target, "Find your polling place")], verify });
  assert.ok(result.promotedVersionId);
  const read = await readElectionFieldsForDivisions([division], { store, now });
  assert.equal(read.fields[0].value.navigationUrl, target);
  assert.equal(read.fields[0].value.url, source);
  assert.ok(!("sites" in read.fields[0].value) && !("assignedPollingPlace" in read.fields[0].value));
});

test("missing/corrupt captures and invented calendar dates never replace the current fields", async () => {
  const store = new MemoryRoutineDataStore();
  const field = make("Registration deadline October 5, 2026");
  const prior = await publishElectionFields({ store, now, fields: [field], verify });
  const corrupt = { ...field, document: { ...field.document, text: "different unsaved bytes" } };
  const absent = { ...field, document: { ...field.document, capture: undefined } };
  const invented = { ...field, dates: ["2026-12-05"] };
  const held = await publishElectionFields({ store, now, fields: [corrupt, absent, invented], verify });
  assert.equal(held.promotedVersionId, null);
  assert.equal(held.gaps.length, 3);
  const read = await readElectionFieldsForDivisions([division], { store, now, bypassCache: true });
  assert.equal(read.reads[0].metadata.versionId, prior.promotedVersionId);
  assert.equal(read.fields[0].value.text, field.value);
});

test("a changed deadline replaces its contextual field and preserves unrelated source fields", async () => {
  const store = new MemoryRoutineDataStore();
  const old = make("Registration deadline October 5, 2026");
  const early = make("Early voting starts October 7, 2026", "early_voting");
  const first = await publishElectionFields({ store, now, fields: [old, { ...early, dates: ["2026-10-07"] }], verify });
  const replacement = make("Registration deadline October 6, 2026");
  const next = await publishElectionFields({ store, now, fields: [{ ...replacement, dates: ["2026-10-06"] }], verify });
  assert.equal(next.fields[0], first.fields[0]);
  const read = await readElectionFieldsForDivisions([division], { store, now, bypassCache: true });
  assert.equal(read.fields.length, 2);
  assert.ok(!read.fields.some(row => row.value.dates.includes("2026-10-05")));
  assert.ok(read.fields.some(row => row.value.fieldKind === "early_voting"));
});

test("an unchanged later source capture confirms the prior version without another candidate", async () => {
  const store = new MemoryRoutineDataStore();
  const field = make("Registration deadline October 5, 2026");
  const first = await publishElectionFields({ store, now, fields: [field], verify });
  const later = "2026-09-30T13:00:00.000Z";
  const refreshed = { ...field, document: { ...field.document, collectedAt: later,
    capture: { ...field.document.capture!, observedAt: later,
      evidence: { ...field.document.capture!.evidence, retrievedAt: later } } } };
  const second = await publishElectionFields({ store, now: later, fields: [refreshed], verify });
  assert.equal(second.promotedVersionId, first.promotedVersionId);
  assert.equal(second.candidateId, first.candidateId);
});

test("the actual section3 verifier holds stale captures without holding fresh sibling fields", async () => {
  const store = new MemoryRoutineDataStore();
  const field = make("Registration deadline October 5, 2026");
  const staleAt = "2026-09-01T00:00:00.000Z";
  const stale = { ...field, document: { ...field.document, collectedAt: staleAt,
    capture: { ...field.document.capture!, observedAt: staleAt,
      evidence: { ...field.document.capture!.evidence, retrievedAt: staleAt } } } };
  const result = await publishElectionFields({ store, now, fields: [stale, field], verify });
  assert.equal(result.fields.length, 1);
  assert.equal(result.gaps.length, 1);
  assert.match(result.gaps[0].detail, /OUTSIDE_FRESHNESS_WINDOW/);
});
