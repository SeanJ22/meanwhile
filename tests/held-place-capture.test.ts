import assert from "node:assert/strict";
import test from "node:test";
import { projectHeldPlaceCapture } from "../lib/civic-data/held-place-capture.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const neighbour = "ocd-division/country:us/state:az/county:pima";
const at = "2026-09-30T06:00:00.000Z";
const provenance = { sourceUrl: "https://cochise.az.gov/calendar", collectedAt: at };
const published = <T>(value: T) => ({ kind: "PROMOTED", value } as CivicDataReadResult<T>);
const registry = published({ registry: { bodies: [{ id: "shared-body", ocdId: county,
  alsoServesOcdIds: [neighbour], name: "Shared district board", bodyClass: "BOARD", provenance }] },
  bodyRosters: [{ bodyId: "shared-body", ...provenance, members: [{ id: "member", name: "Published Member",
    officeTitle: "Chair", websiteUrl: null }] }] } as unknown as RegistryRuntimeReadModel);
const meeting = { id: "meeting:one", bodyId: "shared-body", ocdId: county, title: "Board meeting",
  startsAt: "2026-10-01T02:00:00.000Z", timeZone: "America/Phoenix", startPrecision: "DAY",
  location: null, online: null, status: "SCHEDULED", provenance };
const meetings = published({ meetings: [meeting] } as unknown as MeetingsSnapshot);

test("held fields reach every served division without filling inventory or missing meeting fields", () => {
  const primary = projectHeldPlaceCapture([county], registry, [meetings], at);
  const secondary = projectHeldPlaceCapture([neighbour], registry, [meetings], at);
  assert.deepEqual(secondary, primary, "a shared body serves either place regardless of the original ZIP/job");
  const ids = primary.held.map(field => field.checklistId);
  assert.deepEqual(ids, ["GOV-01", "OFF-04", "OFF-08", "MTG-05", "MTG-06", "MTG-10", "MTG-12"]);
  assert.ok(!ids.includes("OFF-01") && !ids.includes("OFF-05"));
  assert.ok(!ids.includes("MTG-03") && !ids.includes("MTG-16") && !ids.includes("MTG-07") && !ids.includes("MTG-08"));
  assert.equal(primary.held.find(field => field.checklistId === "MTG-06")?.freshUntil, "2026-09-30T07:00:00.000Z");
  assert.equal(projectHeldPlaceCapture(["unrelated-division"], registry, [meetings], at).held.length, 0);
});

test("only published present fields count, and failed reads cannot look like empty holdings", () => {
  const timed = published({ meetings: [{ ...meeting, startPrecision: "MINUTE", online: { url: "https://cochise.az.gov/meeting" } }] } as unknown as MeetingsSnapshot);
  const result = projectHeldPlaceCapture([county], registry, [timed], at);
  assert.ok(result.held.some(field => field.checklistId === "MTG-07"));
  assert.ok(result.held.some(field => field.checklistId === "MTG-08"));
  const failure = { kind: "STORE_UNREACHABLE", metadata: { recordClass: "MEETING", scope: "held" } } as unknown as CivicDataReadResult<MeetingsSnapshot>;
  assert.throws(() => projectHeldPlaceCapture([county], registry, [failure], at), /HELD_PLACE_READ_FAILED/);
});
