import assert from "node:assert/strict";
import test from "node:test";

import { membersOfBody } from "../lib/registry/body-membership.ts";
import { CURATED_BODIES } from "../lib/registry/curated-bodies.ts";
import { coverageAt } from "../lib/registry/server.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

/** A body's members come from the body, never from its geography: a meeting resolves to the body it names or to nothing. */

const VAIL_AREA = { lat: 31.9557, lng: -110.7115 };
const PIMA = "ocd-division/country:us/state:az/county:pima";
const CAWCD = `${PIMA}#central-arizona-water-conservation-district`;
const COUNTY_BOARD = `${PIMA}#governing`;

/** The repaired rule, as the map shell now applies it. */
function bodyForMeeting(
  bodies: readonly CoveredBody[],
  meeting: { bodyId?: string },
): CoveredBody | null {
  if (!meeting.bodyId) return null;
  return bodies.find((b) => b.bodyId === meeting.bodyId) ?? null;
}

/** The defect, kept so the test can show what it prevents. */
function bodyByDivision(
  bodies: readonly CoveredBody[],
  meeting: { ocdId: string | null },
): CoveredBody | null {
  if (!meeting.ocdId) return null;
  return bodies.find((b) => b.ocdId === meeting.ocdId) ?? null;
}

interface FixtureMeeting {
  id: string;
  ocdId: string | null;
  bodyId?: string;
  bodyName: string;
  jurisdiction: string;
}

/** Sittings of three bodies that share the county's division. */
const MEETINGS: FixtureMeeting[] = [
  { id: "cawcd:1", ocdId: PIMA, bodyId: CAWCD, bodyName: "Central Arizona Water Conservation District Board", jurisdiction: "Pima County, AZ" },
  { id: "pima:1", ocdId: PIMA, bodyId: COUNTY_BOARD, bodyName: "Board of Supervisors", jurisdiction: "Pima County, AZ" },
  { id: "boa4:1", ocdId: PIMA, bodyId: `${PIMA}#board-of-adjustment-district-4`, bodyName: "Board of Adjustment District 4", jurisdiction: "Pima County, AZ" },
];

test("DATA-3: a CAWCD sitting renders the CAWCD board, not the county supervisors", async () => {
  const { bodies } = await coverageAt(VAIL_AREA.lat, VAIL_AREA.lng, 0);
  const meeting = MEETINGS.find((m) => m.bodyId === CAWCD)!;

  const resolved = bodyForMeeting(bodies, meeting);
  assert.equal(resolved?.bodyId, CAWCD);

  const names = membersOfBody(resolved?.bodyId ?? null).members.map((m) => m.name);
  assert.ok(names.includes("Terry Goddard"), "the board's own president");
  assert.equal(names.length, 15, "fifteen directly elected directors");
  for (const supervisor of ["Rex Scott", "Jennifer Allen", "Steve Christy"]) {
    assert.ok(!names.includes(supervisor), `${supervisor} is a county supervisor`);
  }
});

test("DATA-3 control: no meeting anywhere renders another body's members", async () => {
  /* A meeting resolves to the body it names or to nothing, never to a body it merely shares ground with. */
  const { bodies } = await coverageAt(VAIL_AREA.lat, VAIL_AREA.lng, 0);
  const offenders: string[] = [];

  for (const meeting of MEETINGS) {
    const resolved = bodyForMeeting(bodies, meeting);
    if (!resolved) continue;
    assert.equal(
      resolved.bodyId,
      meeting.bodyId,
      "resolution must return the named body or nothing",
    );
    const byDivision = bodyByDivision(bodies, meeting);
    if (
      byDivision &&
      byDivision.bodyId !== meeting.bodyId &&
      membersOfBody(byDivision.bodyId).members.length > 0
    ) {
      // Would have been wrong before the repair. Recorded, not tolerated.
      offenders.push(`${meeting.bodyName} — ${meeting.jurisdiction}`);
    }
  }

  assert.ok(
    offenders.length > 0,
    "the fixture must contain the shape this guard protects against",
  );
});

test("DATA-3 control: a second special district on county:pima keeps its own answer", async () => {
  /* Three bodies share one division with three different right answers; a division join cannot tell them apart. */
  const { bodies } = await coverageAt(VAIL_AREA.lat, VAIL_AREA.lng, 0);
  const sharing = bodies.filter((b) => b.ocdId === PIMA);
  assert.ok(sharing.length >= 3, "the division must actually be shared");

  const adjustment = sharing.find((b) =>
    b.bodyId.endsWith("#board-of-adjustment-district-4"),
  );
  assert.ok(adjustment, "the second special district must be in coverage");

  const resolved = membersOfBody(adjustment.bodyId);
  assert.equal(resolved.kind, "DIRECT_BODY_ROSTER");
  const names = resolved.members.map((m) => m.name);
  assert.ok(names.includes("Robert Fee"), "its own acting chair");

  // Neither of the other two answers on the same division leaks in.
  for (const supervisor of ["Rex Scott", "Jennifer Allen", "Steve Christy"]) {
    assert.ok(!names.includes(supervisor), `${supervisor} is a county supervisor`);
  }
  assert.ok(!names.includes("Terry Goddard"), "Goddard presides over CAWCD");
});

test("DATA-3 control: a statutory alias still inherits, because an authority says so", async () => {
  /* A recorded statutory alias still inherits; the difference is the recorded authority. */
  const flood = membersOfBody(`${PIMA}#regional-flood-control-district`);
  assert.equal(flood.kind, "EXPLICIT_LEGAL_ALIAS");
  assert.equal(flood.members.length, 5);
});

test("DATA-3 control: no body in the registry has members without an authority", () => {
  // The invariant, swept over every curated body rather than the four named.
  const offenders: string[] = [];
  for (const body of CURATED_BODIES as { id: string; name: string }[]) {
    const resolved = membersOfBody(body.id);
    if (resolved.members.length > 0 && resolved.kind === "UNKNOWN_COMPOSITION") {
      offenders.push(body.name);
    }
  }
  assert.deepEqual(offenders, []);
});
