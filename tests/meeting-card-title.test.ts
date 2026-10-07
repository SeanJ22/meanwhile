/**
 * A meeting card is titled by the body, and a sitting is not a body. A source that publishes one sitting name as
 * `bodyName` on every sitting makes the shared-`bodyName` rung fire, so the descent must fall through to the
 * jurisdiction when that name is a sitting.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { venueBodyTitle, namesASitting, bodyFromJurisdiction } from "../lib/map/format.ts";

type Row = {
  bodyName?: string | null;
  jurisdiction?: string | null;
  location?: { name?: string | null; lat?: number | null; lng?: number | null } | null;
};

/** Every venue in the recorded fixture, grouped the way `groupByVenue` groups. */
function venues(): Array<{ key: string; name: string; meetings: Row[] }> {
  const snapshot = JSON.parse(readFileSync("tests/fixtures/reader-upcoming-meetings-85701.json", "utf8")) as {
    meetings?: Row[];
  };
  const grouped = new Map<string, { key: string; name: string; meetings: Row[] }>();
  for (const m of snapshot.meetings ?? []) {
    const loc = m.location;
    if (!loc || loc.lat == null || loc.lng == null) continue;
    const key = `${loc.lat},${loc.lng}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = { key, name: (loc.name ?? "").trim(), meetings: [] };
      grouped.set(key, entry);
    }
    entry.meetings.push(m);
  }
  return [...grouped.values()];
}

test("MTG-9: the sweep reaches the corpus it claims to", () => {
  const all = venues();
  assert.ok(all.length > 1, `only ${all.length} venue card(s) in the fixture — the sweep read almost nothing`);
  assert.ok(
    all.some((v) => v.meetings.length > 1),
    "no multi-sitting venue in the corpus — rung one is unexercised and every assertion below is vacuous",
  );
  assert.ok(
    all.some((v) => v.meetings.length === 1),
    "no single-sitting venue in the corpus — and a single sitting ALWAYS has bodies.size === 1, " +
      "which is how the second instance of this defect hid inside the district the first fix was built for",
  );
});

test("MTG-9: no venue card in the fixture is titled with a sitting", () => {
  const offenders: string[] = [];
  for (const v of venues()) {
    const { title, basis } = venueBodyTitle(v.meetings as never, v.name);
    if (namesASitting(title)) {
      offenders.push(`${v.name || v.key}: titled "${title}" (basis: ${basis})`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a venue card headlines a SITTING rather than the body meeting there. A reader " +
      "opening it cannot tell whose calendar they are looking at, which is the whole " +
      "of MTG-6 and MTG-9. The source is publishing an event name in `bodyName`; the " +
      "descent in lib/map/format.ts must fall through to the jurisdiction for it.",
  );
});

test("MTG-9: Vail — the reported instance — now names the district", () => {
  const vail = {
    name: "Vail District Office",
    meetings: [
      { bodyName: "Governing Board Meeting", jurisdiction: "Vail Unified School District, AZ" },
      { bodyName: "Governing Board Meeting", jurisdiction: "Vail Unified School District, AZ" },
    ],
  };
  assert.ok(namesASitting(vail.meetings[0].bodyName));
  const { title, basis } = venueBodyTitle(vail.meetings as never, vail.name);
  assert.equal(basis, "jurisdiction");
  assert.equal(title, "Vail Unified School District");
});

test("MTG-9: TUSD's single-sitting audit-committee venue — the instance nobody reported", () => {
  // A venue with one meeting always has one shared `bodyName`.
  const tusd = {
    name: "Tucson Unified Board Room",
    meetings: [{ bodyName: "AGENDA FOR AUDIT COMMITTEE MEETING", jurisdiction: "Tucson Unified School District, AZ" }],
  };
  const { title, basis } = venueBodyTitle(tusd.meetings as never, tusd.name);
  assert.equal(basis, "jurisdiction");
  assert.equal(title, "Tucson Unified School District");
});

test("MTG-9: the shape does not fire on a real body name", () => {
  // The body-titled cards a sitting check must leave alone.
  for (const real of [
    "Board of Supervisors",
    "Governing Board",
    "Tucson Parks and Recreation Commission",
    "Citizens' Water Advisory Committee",
    "Community Police Advisory Review Board",
    "Amphitheater Unified School District Governing Board",
    "Board of County Commissioners",
    "Merrimack County Board of Commissioners",
    "Board of Education",
    "Supervisors of the Checklist",
    "Conservation Commission",
    "Independence Day Committee",
    "Budget Committee",
    "School Board",
  ]) {
    assert.equal(namesASitting(real), false, `"${real}" is a body and must keep its title`);
  }

  /* It does fire on sittings. */
  for (const sitting of ["Governing Board Meeting", "AGENDA FOR AUDIT COMMITTEE MEETING"]) {
    assert.equal(namesASitting(sitting), true, `"${sitting}" names a sitting`);
  }
});

test("MTG-9: a body-titled card still wins over its jurisdiction", () => {
  /* The shared-`bodyName` rung is narrowed, not removed. */
  const { title, basis } = venueBodyTitle(
    [
      { bodyName: "Tucson Parks and Recreation Commission", jurisdiction: "Tucson, AZ" },
      { bodyName: "Tucson Parks and Recreation Commission", jurisdiction: "Tucson, AZ" },
    ] as never,
    "Randolph Recreation Center",
  );
  assert.equal(basis, "body");
  assert.equal(title, "Tucson Parks and Recreation Commission");
  assert.equal(bodyFromJurisdiction("Tucson, AZ"), "Tucson");
});

test("MTG-9: the building is still the last rung, and still says so", () => {
  const { title, basis } = venueBodyTitle(
    [
      { bodyName: "City Council", jurisdiction: "Tucson, AZ" },
      { bodyName: "School Board", jurisdiction: "Tucson Unified School District, AZ" },
    ] as never,
    "Duffy Community Center",
  );
  assert.equal(basis, "venue");
  assert.equal(title, "Duffy Community Center");
});
