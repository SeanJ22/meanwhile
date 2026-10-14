import assert from "node:assert/strict";
import test from "node:test";
import { boxCountsByWorkItem, indexReportedFinding } from "../lib/control-plane/box.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import { buildScoutToolkit } from "../lib/control-plane/scheduler/scout-tools.ts";
import type { ReportedFinding, ScoutToolContext } from "../lib/control-plane/scheduler/scout-contract.ts";
import { contentHash } from "../lib/control-plane/ids.ts";

const NOW = "2026-10-06T17:00:00.000Z";
const STATE = "ocd-division/country:us/state:zz";
const COUNTY = `${STATE}/county:alpha`;
const CITY = `${COUNTY}/place:beta`;
const OTHER = `${STATE}/county:gamma`;

const PAGE = "https://county.example.gov/board";
const TEXT = "<p>Board chair: Dana Rivers. The city of Beta's mayor is Lee Park.</p>";

function obligation() {
  const row = scheduleObligation({ id: "freshness:test:county#route", recordClass: "OFFICIAL_ROSTER", subjectId: COUNTY, routeId: null, active: true,
    readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, Date.parse(NOW));
  assert.ok(isScheduled(row));
  return row;
}

function toolkit(report?: ScoutToolContext["reportFinding"]) {
  const id = "held-page";
  return buildScoutToolkit({ obligation: obligation(), route: null, providerId: "test", attemptId: "at-mission", workItemId: "wi-county", routeTaskId: "rt-county",
    holder: "scout-test", vault: async () => ({ stored: true, where: "mem", why: "written" }), spaceOut: async () => {},
    bound: RESEARCH_BOUNDS.perDispatch, now: () => NOW, openOne: async () => { throw new Error("must not fetch"); },
    handed: { artifactIds: [id] },
    readHeldArtifact: async () => ({ artifactId: id, contentHash: contentHash(TEXT), text: TEXT, canonicalUrl: PAGE, retrievedAt: NOW, acquiredByAttemptId: "earlier",
      sourceId: "county.example.gov", methodRouteId: "held-page",
      provenance: { artifactId: id, canonicalUrl: PAGE, retrievedAt: NOW, permission: "ALLOWED", methodRouteId: "held-page", httpStatus: 200 } }),
    ...(report ? { reportFinding: report } : {}) });
}

test("a hunter reports a finding for a subject in its brief from a page it saved, and nothing for a subject it was not sent for", async () => {
  const written: ReportedFinding[] = [];
  const kit = toolkit({ subjects: new Set([COUNTY, CITY]), write: async finding => { written.push(finding); return { boxId: `box-${written.length}` }; } });
  const drop = { subjectId: CITY, field: "name", value: "Lee Park", sentence: "The city of Beta's mayor is Lee Park.", sourceUrl: PAGE };

  const read = await kit.call("read_held", { artifactId: "held-page", offset: 0 });
  assert.equal(read.ok, true, read.forModel);
  const dropped = await kit.call("report_finding", drop);
  assert.equal(dropped.ok, true, dropped.forModel);
  assert.match(dropped.forModel, /IN THE BOX/);
  assert.equal(dropped.step, null, "a report is not a research step");
  assert.deepEqual(written, [{ subjectId: CITY, field: "name", value: "Lee Park", exactQuote: drop.sentence, sourceUrl: PAGE, artifactIds: ["held-page"], subjectHint: null, index: 0 }]);
  assert.deepEqual(kit.reported, written);

  assert.match((await kit.call("report_finding", drop)).forModel, /ALREADY IN THE BOX \(box-1\)/);
  assert.equal(written.length, 1);

  const elsewhere = await kit.call("report_finding", { ...drop, subjectId: OTHER });
  assert.equal(elsewhere.ok, false);
  assert.match(elsewhere.forModel, /is not a subject in this brief/);
  const incomplete = await kit.call("report_finding", { ...drop, value: "" });
  assert.equal(incomplete.ok, false);

  const broken = toolkit({ subjects: new Set([CITY]), write: async () => { throw new Error("store unavailable"); } });
  await broken.call("read_held", { artifactId: "held-page", offset: 0 });
  assert.match((await broken.call("report_finding", drop)).forModel, /the finding was not saved: store unavailable/);
});

test("a dropped finding lands in the Box under the reporting work item, once", async () => {
  const repos = createMemoryRepositories();
  const finding = { subjectId: CITY, field: "name", value: "Lee Park", exactQuote: "The city of Beta's mayor is Lee Park.", sourceUrl: PAGE,
    artifactIds: ["held-page"], subjectHint: "Beta's mayor", index: 0 };
  const row = await indexReportedFinding(repos.boxFindings, { workItemId: "wi-county", attemptId: "at-mission", missionPart: "people-money", finding }, NOW);
  assert.equal(row.state, "waiting");
  assert.equal(row.subjectId, CITY);
  assert.deepEqual(row.origins[0]!.reported, { field: "name", value: "Lee Park", subjectHint: "Beta's mayor" });
  assert.equal(row.origins[0]!.missionPart, "people-money");
  assert.equal((await indexReportedFinding(repos.boxFindings, { workItemId: "wi-county", attemptId: "at-mission", missionPart: null, finding }, NOW)).id, row.id);
  assert.deepEqual((await boxCountsByWorkItem(repos.boxFindings))["wi-county"], { waiting: 1, taken: 0, built: 0, refused: 0 });

});
