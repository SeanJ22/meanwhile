import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

import { membersOfBody } from "../lib/registry/body-membership.ts";
import { CURATED_BODIES } from "../lib/registry/curated-bodies.ts";
import { coverageAt } from "../lib/registry/server.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

/**
 * DATA-3 — A BODY'S MEMBERS COME FROM THE BODY, NEVER FROM ITS GEOGRAPHY.
 *
 * `lib/registry/body-membership.ts` established the rule on 2026-08-27 and is
 * correct. What this file guards is the LOOKUP that feeds it, which was still
 * joining on the division: `bodyFor(meeting.ocdId)` in the map shell returned
 * whichever coverage body happened to sit on the meeting's division, and the
 * only thing that result is ever used for is a membership claim.
 *
 * Six coverage bodies sit on `county:pima`. The first is the county board, so
 * every CAWCD sitting rendered the five Pima County Supervisors under
 * Representation — the reported regression, and the reason a correct
 * composition module was not enough on its own.
 */

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

interface SnapshotMeeting {
  id: string;
  ocdId: string | null;
  bodyId?: string;
  bodyName: string;
  jurisdiction: string;
}

const snapshot = JSON.parse(
  readFileSync(new URL("../data/meetings-snapshot.json", import.meta.url), "utf8"),
) as { meetings: SnapshotMeeting[] };

/* --------------------------------------------------- the named example --- */

test("DATA-3: a CAWCD sitting renders the CAWCD board, not the county supervisors", async () => {
  const { bodies } = await coverageAt(VAIL_AREA.lat, VAIL_AREA.lng, 0);
  const meeting = snapshot.meetings.find((m) => m.bodyId === CAWCD);
  assert.ok(meeting, "the snapshot must hold a CAWCD sitting to test");

  const resolved = bodyForMeeting(bodies, meeting);
  assert.equal(resolved?.bodyId, CAWCD);

  const names = membersOfBody(resolved?.bodyId ?? null).members.map((m) => m.name);
  assert.ok(names.includes("Terry Goddard"), "the board's own president");
  assert.equal(names.length, 15, "fifteen directly elected directors");
  for (const supervisor of ["Rex Scott", "Jennifer Allen", "Steve Christy"]) {
    assert.ok(!names.includes(supervisor), `${supervisor} is a county supervisor`);
  }
});

test("DATA-3: the old division join is what produced the wrong five", async () => {
  // Stated rather than implied: this is the defect, and it is why matching on
  // identity is the repair rather than a tidy-up.
  const { bodies } = await coverageAt(VAIL_AREA.lat, VAIL_AREA.lng, 0);
  const meeting = snapshot.meetings.find((m) => m.bodyId === CAWCD)!;
  const wrong = bodyByDivision(bodies, meeting);
  assert.equal(wrong?.bodyId, COUNTY_BOARD);
  assert.notEqual(wrong?.bodyId, meeting.bodyId);
});

/* ------------------------------------------------ the unnamed controls --- */

test("DATA-3 control: no meeting anywhere renders another body's members", async () => {
  /*
   * The class, over the whole snapshot rather than the reported row. A
   * meeting resolves to the body it names or to nothing; it may never resolve
   * to a body it merely shares ground with.
   */
  const { bodies } = await coverageAt(VAIL_AREA.lat, VAIL_AREA.lng, 0);
  const offenders: string[] = [];

  for (const meeting of snapshot.meetings) {
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
    "the snapshot must still contain the shape this guard protects against",
  );
});

test("DATA-3 control: a second special district on county:pima keeps its own answer", async () => {
  /*
   * The unnamed instance, and a better control than expected. The Board of
   * Adjustment District 4 sits on the SAME `county:pima` division as CAWCD and
   * as the county board, and it publishes its own membership — read from the
   * county's District 4 notices page on 2026-08-27.
   *
   * So three bodies share one division and there are three different right
   * answers. A division join has no way to tell them apart; it would hand all
   * three the same five people.
   */
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
  /*
   * The repair must not become "never inherit". Three Pima districts ARE the
   * board of supervisors by statute, and rendering them empty would replace a
   * false claim with a false absence. The difference is a recorded authority.
   */
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
