/**
 * MTG-9 — A MEETING CARD IS TITLED BY THE BODY, AND A SITTING IS NOT A BODY.
 * (2026-08-25, the author's `17-20-07`. Second pass on MTG-6, 2026-08-24.)
 *
 * **This is the test that would have caught it, and the reason it did not
 * exist is worth more than the fix.**
 *
 * MTG-6 shipped `venueBodyTitle`, a three-rung descent — shared `bodyName`,
 * else shared `jurisdiction`, else the building — and it was verified against
 * Tucson Unified, where the source publishes a DIFFERENT `bodyName` per
 * sitting. That case exercises rungs two and three and **never touches rung
 * one**. Rung one is the one that is wrong.
 *
 * Vail publishes `bodyName: "Governing Board Meeting"` on all eleven of its
 * sittings. `bodies.size === 1`, rung one fires, and the card headlines a
 * SITTING over the district's whole calendar with nothing naming the district.
 * **The first pass was measured on noisy bad data and shipped wrong on clean
 * bad data** — a constant wrong value reads as more authoritative than a
 * varying one (RULING 114).
 *
 * So the assertions below run over **every venue in the committed snapshot**
 * rather than over a fixture chosen to show the fix working (RULING 153 — a
 * verification states the reader's route and walks it; the reader's route here
 * is *open any venue card in the product*). The corpus is the anchor, and it is
 * data this repo did not author (RULING 147).
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

/** Every venue in the shipped snapshot, grouped the way `groupByVenue` groups. */
function venues(): Array<{ key: string; name: string; meetings: Row[] }> {
  const snapshot = JSON.parse(readFileSync("data/meetings-snapshot.json", "utf8")) as {
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
  assert.ok(all.length > 10, `only ${all.length} venue card(s) in the snapshot — the sweep read almost nothing`);
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

test("MTG-9: no venue card in the shipped snapshot is titled with a sitting", () => {
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
  const vail = venues().find((v) =>
    v.meetings.some((m) => /Vail Unified School District/i.test(m.jurisdiction ?? "")),
  );
  assert.ok(vail, "the Vail venue is no longer in the snapshot — this claim cannot be checked");
  assert.ok(vail.meetings.length > 1, "expected Vail's multi-sitting venue");
  /* The precondition: the source really does publish a sitting name here. If
     it stops, this test would pass for a reason unrelated to the fix. */
  const bodies = new Set(vail.meetings.map((m) => (m.bodyName ?? "").trim()));
  assert.equal(bodies.size, 1, "Vail's sittings no longer share one bodyName — the case has changed");
  assert.ok(
    namesASitting([...bodies][0]!),
    `Vail's shared bodyName is now "${[...bodies][0]}" — the source changed and this case no longer reproduces`,
  );

  const { title, basis } = venueBodyTitle(vail.meetings as never, vail.name);
  assert.equal(basis, "jurisdiction");
  assert.equal(title, "Vail Unified School District");
});

test("MTG-9: TUSD's single-sitting audit-committee venue — the instance nobody reported", () => {
  /*
   * The second of the two, found by sweeping rather than by being told. It sits
   * in Tucson Unified, the district MTG-6 was validated against, and it was
   * unreachable by that validation because a venue with ONE meeting always has
   * `bodies.size === 1`.
   */
  const tusd = venues().find(
    (v) =>
      v.meetings.length === 1 &&
      /AGENDA FOR AUDIT COMMITTEE MEETING/i.test(v.meetings[0]?.bodyName ?? ""),
  );
  if (!tusd) return; /* the sitting has aged out of the window — not a failure */
  const { title, basis } = venueBodyTitle(tusd.meetings as never, tusd.name);
  assert.equal(basis, "jurisdiction");
  assert.equal(title, "Tucson Unified School District");
});

test("MTG-9: the shape does not fire on a real body name", () => {
  /*
   * The other half of RULING 110: an instrument that flagged the honest cases
   * would become pressure to delete the rung rather than to keep it. These are
   * the 14 body-titled cards measured in the corpus on adoption, including the
   * author's own named reference pattern.
   */
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

  /* And it does fire on the two that are sittings. */
  for (const sitting of ["Governing Board Meeting", "AGENDA FOR AUDIT COMMITTEE MEETING"]) {
    assert.equal(namesASitting(sitting), true, `"${sitting}" names a sitting`);
  }
});

test("MTG-9: a body-titled card still wins over its jurisdiction", () => {
  /* MTG-6's rung one is narrowed, not removed. Tucson's Parks and Recreation
     Commission must not collapse to "Tucson". */
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
