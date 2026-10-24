import assert from "node:assert/strict";
import test from "node:test";

import { snapshotInView } from "../lib/meetings/freshness.ts";
import { bodyScopeKey } from "../lib/state/body-scope.ts";
import {
  bodyDisplayName,
  readerBodyName,
  readerGovernmentName,
  readerPartyLabel,
  withReaderNames,
} from "../lib/text/reader-names.ts";

test("a portal's sitting words are not part of the body's name", () => {
  // The Body filter must not list meeting titles as bodies.
  assert.equal(readerBodyName("GOVERNING BOARD AGENDA REGULAR MEETING"), "Governing Board");
  assert.equal(readerBodyName("GOVERNING BOARD AGENDA SPECIAL EXECUTIVE SESSION MEETING"), "Governing Board");
  assert.equal(readerBodyName("Governing Board Meeting 10/20/2026"), "Governing Board");
  assert.equal(readerBodyName("Governing Board Meeting (Virtual Only)"), "Governing Board");
  assert.equal(readerBodyName("Virtual Governing Board"), "Governing Board");
  assert.equal(readerBodyName("Audit Committee Meeting Agenda"), "Audit Committee");
  assert.equal(readerBodyName("Bond Oversight Committee Meeting Agenda - Aug 20 2026"), "Bond Oversight Committee");
  // A name that merely contains such a word keeps it.
  assert.equal(readerBodyName("Public Housing Authority Board of Commissioners"), "Public Housing Authority Board of Commissioners");
  assert.equal(readerBodyName("Public Art and Community Design Committee"), "Public Art and Community Design Committee");
  // A name that is nothing but sitting words is not emptied.
  assert.equal(readerBodyName("Regular Public Meeting"), "Regular Public Meeting");
});

test("the shared formatter fixes case, small words and abbreviations", () => {
  assert.equal(readerBodyName("Board Of Supervisors"), "Board of Supervisors");
  assert.equal(readerBodyName("New York City Department Of Education"), "New York City Department of Education");
  assert.equal(readerBodyName("Redistricting Advisory Committee (RAC)"), "Redistricting Advisory Committee");
  assert.equal(readerBodyName("Board of Adjustment (BAJ)"), "Board of Adjustment");
  assert.equal(readerBodyName("Tucson-Pima County Historical Commission"), "Tucson-Pima County Historical Commission");
  assert.equal(readerBodyName("CAP University"), "CAP University");
  assert.equal(readerBodyName("Planning Board (Downtown)"), "Planning Board (Downtown)");
});

test("a derived body is named for the government it is", () => {
  assert.equal(readerGovernmentName("COUNTY OF WAKE", "county"), "County of Wake");
  const stored = {meetings:[{id:"same",bodyName:"BOARD OF COMMISSIONERS",jurisdiction:"COUNTY OF WAKE"}],coverage:{bodies:[],governments:[{id:"same-government",name:"COUNTY OF WAKE"}]}};
  assert.equal(withReaderNames(stored).meetings[0].jurisdiction,"County of Wake");
  assert.equal(withReaderNames(stored).coverage?.governments[0].name,"County of Wake");
  assert.equal(stored.meetings[0].jurisdiction,"COUNTY OF WAKE");
  assert.equal(readerGovernmentName("Pima", "county"), "Pima County");
  assert.equal(readerGovernmentName("Cochise County", "county"), "Cochise County");
  assert.equal(readerGovernmentName("New York city", "place"), "New York City");
  assert.equal(readerGovernmentName("Tucson", "place"), "Tucson");
  assert.equal(readerGovernmentName("Tucson Unified District", "school_district"), "Tucson Unified School District");
  assert.equal(bodyDisplayName({ name: null, divisionLabel: "Pima", divisionType: "county" }), "Pima County");
  assert.equal(
    bodyDisplayName({ name: "Board Of Supervisors", divisionLabel: "Pima", divisionType: "county" }),
    "Board of Supervisors",
  );
});

test("one party, one label", () => {
  for (const raw of ["Democrat", "Democratic", "DEMOCRATIC", "Democratic Party", "DEM", "D"]) {
    assert.equal(readerPartyLabel(raw), "Democratic", raw);
  }
  for (const raw of ["Republican", "REP", "GOP", "Republican Party", "R"]) {
    assert.equal(readerPartyLabel(raw), "Republican", raw);
  }
  assert.equal(readerPartyLabel("Libertarian Party"), "Libertarian");
  // A party we have no family for is shown as filed, never guessed.
  assert.equal(readerPartyLabel("Working Families Party"), "Working Families Party");
  assert.equal(readerPartyLabel("Arizona Independent Party"), "Arizona Independent Party");
  // Nothing filed renders nothing.
  assert.equal(readerPartyLabel(null), null);
  assert.equal(readerPartyLabel("  "), null);
});

test("the Body filter makes one option per body, not per sitting title", () => {
  const tusd = "ocd-division/country:us/state:az/school_district:tucson_unified_district";
  const keys = new Set(
    [
      "GOVERNING BOARD AGENDA REGULAR MEETING",
      "GOVERNING BOARD AGENDA SPECIAL MEETING",
      "Governing Board Meeting 10/20/2026",
      "Governing Board",
    ].map((bodyName) => bodyScopeKey({ ocdId: tusd, bodyName })),
  );
  assert.equal(keys.size, 1);
  // The same name in another jurisdiction stays its own body.
  const vail = "ocd-division/country:us/state:az/school_district:vail_unified_district";
  assert.notEqual(bodyScopeKey({ ocdId: vail, bodyName: "Governing Board" }), [...keys][0]);
});

test("a search answer is formatted once, names only", () => {
  const answer = withReaderNames({
    meetings: [{ id: "a", bodyName: "BOARD OF SUPERVISORS REGULAR MEETING" }],
    coverage: { bodies: [{ name: "Redistricting Advisory Committee (RAC)", bodyId: "x" }, { name: null, bodyId: "y" }] },
  });
  assert.equal(answer.meetings[0].bodyName, "Board of Supervisors");
  assert.equal(answer.meetings[0].id, "a");
  assert.deepEqual(answer.coverage?.bodies.map((b) => [b.name, b.bodyId]), [["Redistricting Advisory Committee", "x"], [null, "y"]]);
  assert.equal(withReaderNames({ meetings: [], coverage: null }).coverage, null);
});

test("the carried-listings note describes what is in view", () => {
  const snapshot = {
    generatedAt: "2026-10-01T10:00:00.000Z",
    failed: [],
    carried: { count: 2, lastFreshAt: "2026-09-26T10:00:00.000Z" },
  };
  // Two carried rows somewhere else, none on screen — the note goes.
  assert.equal(snapshotInView(snapshot, [{}, {}])?.carried, undefined);
  assert.equal(snapshotInView(snapshot, [])?.carried, undefined);
  // One carried row in view: the note is about that row.
  const one = snapshotInView(snapshot, [{}, { carried: { lastFreshAt: "2026-09-27T01:00:00.000Z" } }]);
  assert.deepEqual(one?.carried, { count: 1, lastFreshAt: "2026-09-27T01:00:00.000Z" });
  // Rows reached on different days state no single date.
  const mixed = snapshotInView(snapshot, [
    { carried: { lastFreshAt: "2026-09-25T01:00:00.000Z" } },
    { carried: { lastFreshAt: "2026-09-27T01:00:00.000Z" } },
  ]);
  assert.deepEqual(mixed?.carried, { count: 2, lastFreshAt: null });
  // No snapshot, or a snapshot with nothing carried, passes straight through.
  assert.equal(snapshotInView(null, []), null);
  const clean = { generatedAt: snapshot.generatedAt, failed: [] };
  assert.equal(snapshotInView(clean, [{}]), clean);
});
