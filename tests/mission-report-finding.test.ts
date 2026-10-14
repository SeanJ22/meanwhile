import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { boxCountsByWorkItem, indexReportedFinding } from "../lib/control-plane/box.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import { REPORT_FINDING_TOOL_SPEC, buildScoutToolkit, scoutToolSpecsFor } from "../lib/control-plane/scheduler/scout-tools.ts";
import type { ReportedFinding, ScoutToolContext } from "../lib/control-plane/scheduler/scout-contract.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { MISSION_BRIEF_LINE_CAP, SCOUT_BRIEF_LINE_BUDGET, missionBlanksFrom, missionBriefLines, missionRelation, type MissionBlank } from "../lib/control-plane/workers/mission-brief.ts";
import { buildBoxFindings } from "../lib/control-plane/workers/scout-extraction.ts";
import type { PlaceOwedItem } from "../lib/coverage/place-owed.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";

const NOW = "2026-10-06T17:00:00.000Z";
const STATE = "ocd-division/country:us/state:zz";
const COUNTY = `${STATE}/county:alpha`;
const CITY = `${COUNTY}/place:beta`;
const OTHER = `${STATE}/county:gamma`;

const blank = (subjectId: string, label: string, divisionIds: readonly string[] = [subjectId], checklistId = "OFF-01"): MissionBlank =>
  ({ subjectId, subjectLabel: subjectId.split("/").at(-1)!, divisionIds, checklistId, label, missionPart: null });

test("a Scout's brief lists the mission's open blanks for its government and those above and below it, never an unrelated one", () => {
  assert.equal(missionRelation(COUNTY, blank(COUNTY, "x")), "same");
  assert.equal(missionRelation(COUNTY, blank(STATE, "x")), "above");
  assert.equal(missionRelation(COUNTY, blank(CITY, "x")), "below");
  assert.equal(missionRelation(COUNTY, blank(OTHER, "x")), null);
  // A body or seat sits in its division: related through divisionIds, and its own id is reportable.
  assert.equal(missionRelation(COUNTY, blank("body:alpha-board", "x", [COUNTY])), "same");
  assert.equal(missionRelation("body:alpha-board", blank(COUNTY, "x")), null);

  const blanks = [blank(CITY, "Mayor"), blank(OTHER, "Clerk"), blank(STATE, "Governor"), blank(COUNTY, "Board chair"), blank(COUNTY, "Clerk email")];
  const brief = missionBriefLines(COUNTY, blanks);
  assert.match(brief.lines[0]!, /^MISSION — 4 open blank\(s\).*report_finding/);
  assert.deepEqual(brief.lines.slice(1).map(line => line.trim().split(" · ")[0]), ["same", "above", "below"]);
  assert.match(brief.lines[1]!, /\[ocd-division\/country:us\/state:zz\/county:alpha\]: Board chair; Clerk email$/);
  assert.deepEqual([...brief.subjects].sort(), [CITY, COUNTY, STATE].sort());
  assert.ok(!brief.lines.join("\n").includes("gamma"));
});

test("the mission's lines stay inside their share of the brief and the rest stays reportable", () => {
  const many = Array.from({ length: 20 }, (_, i) => blank(`${COUNTY}/place:p${i}`, `Seat ${i}`));
  const brief = missionBriefLines(COUNTY, many);
  assert.equal(brief.lines.length, MISSION_BRIEF_LINE_CAP);
  assert.match(brief.lines[0]!, /\(7 of 20 subjects listed\)/);
  assert.equal(brief.subjects.size, 20, "a subject the lines leave out can still be reported");
  assert.ok(SCOUT_BRIEF_LINE_BUDGET - brief.lines.length >= 20, "the field manual keeps most of the budget");
  assert.deepEqual(missionBriefLines(COUNTY, [blank(OTHER, "x")]).lines, []);
});

test("only open, due blanks not already being worked reach the brief, once each", () => {
  const item = (id: string, state: PlaceOwedItem["state"], found: string, due = "due"): PlaceOwedItem => ({
    id, subject: { id: COUNTY, kind: "division", divisionIds: [COUNTY], label: "Alpha County" }, checklistId: "OFF-01", requirement: "", state,
    held: [], label: id, statuses: { due, found } as unknown as PlaceOwedItem["statuses"], owedSince: null });
  const blanks = missionBlanksFrom([item("open", "missing", "not-found"), item("open", "missing", "not-found"), item("working", "missing", "in-progress"),
    item("later", "missing", "not-found", "not-yet-due"), item("held", "published" as PlaceOwedItem["state"], "found")]);
  assert.deepEqual(blanks.map(row => row.label), ["open"]);
});

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
    inherited: { artifactIds: [id], summary: "" },
    readHeldArtifact: async () => ({ artifactId: id, contentHash: contentHash(TEXT), text: TEXT, canonicalUrl: PAGE, retrievedAt: NOW, acquiredByAttemptId: "earlier",
      sourceId: "county.example.gov", methodRouteId: "held-page",
      provenance: { artifactId: id, canonicalUrl: PAGE, retrievedAt: NOW, permission: "ALLOWED", methodRouteId: "held-page", httpStatus: 200 } }),
    ...(report ? { reportFinding: report } : {}) });
}

test("report_finding is offered only when the Box can take it, and the pre-warm list follows the same switch", () => {
  assert.ok(toolkit().specs.some(spec => spec.name === "report_finding"));
  const written: ReportedFinding[] = [];
  const kit = toolkit({ subjects: new Set([COUNTY, CITY]), write: async finding => { written.push(finding); return { boxId: "box-1" }; } });
  assert.equal(kit.specs.at(-1), REPORT_FINDING_TOOL_SPEC);
  assert.deepEqual(scoutToolSpecsFor(false, true).map(spec => spec.name), kit.specs.map(spec => spec.name));
  assert.deepEqual(scoutToolSpecsFor(false), scoutToolSpecsFor(true, true), "tool availability does not change cached prefix bytes");
});

test("a Scout drops a finding for another mission subject from a page it saved, and nothing it did not see or was not sent for", async () => {
  const written: ReportedFinding[] = [];
  const kit = toolkit({ subjects: new Set([COUNTY, CITY]), write: async finding => { written.push(finding); return { boxId: `box-${written.length}` }; } });
  const drop = { subjectId: CITY, subjectHint: "Beta's mayor", field: "name", value: "Lee Park", exactQuote: "The city of Beta's mayor is Lee Park.", sourceUrl: PAGE };

  const unseen = await kit.call("report_finding", drop, null);
  assert.equal(unseen.ok, false, "the page is not saved in this walk yet");
  assert.match(unseen.forModel, /REPORT_QUOTE_NOT_IN_SAVED_PAGE/);

  const read = await kit.call("read_held", { artifactId: "held-page", offset: 0, rung: "primary-site-navigation", why: "read the roster" }, null);
  assert.equal(read.ok, true, read.forModel);
  const before = kit.toolCalls;
  const dropped = await kit.call("report_finding", drop, null);
  assert.equal(dropped.ok, true, dropped.forModel);
  assert.match(dropped.forModel, /IN THE BOX/);
  assert.equal(dropped.rung, null, "a drop is not a research rung");
  assert.equal(kit.toolCalls, before, "a drop does not spend the walk's tool budget");
  assert.deepEqual(written, [{ subjectId: CITY, field: "name", value: "Lee Park", exactQuote: drop.exactQuote, sourceUrl: PAGE, artifactIds: ["held-page"], subjectHint: "Beta's mayor", index: 0 }]);

  assert.match((await kit.call("report_finding", drop, null)).forModel, /ALREADY IN THE BOX: box-1/);
  assert.equal(written.length, 1);

  const elsewhere = await kit.call("report_finding", { ...drop, subjectId: OTHER }, null);
  assert.match(elsewhere.forModel, /REPORT_SUBJECT_NOT_IN_MISSION/);
  const invented = await kit.call("report_finding", { ...drop, exactQuote: "The mayor is Pat Doe." }, null);
  assert.match(invented.forModel, /REPORT_QUOTE_NOT_IN_SAVED_PAGE/);
  const incomplete = await kit.call("report_finding", { ...drop, value: "" }, null);
  assert.equal(incomplete.ok, false);

  const broken = toolkit({ subjects: new Set([CITY]), write: async () => { throw new Error("store unavailable"); } });
  await broken.call("read_held", { artifactId: "held-page", offset: 0, rung: "primary-site-navigation", why: "read" }, null);
  assert.match((await broken.call("report_finding", drop, null)).forModel, /REPORT_NOT_SAVED: store unavailable/);
});

const item = (subject: string): WorkItem => ({ id: "wi-county", subject, project: "freshness",
  autonomousPlan: { publication: { contractId: "fixture" }, contract: { schemaVersion: 2, recordClass: "OFFICIAL_ROSTER", subjectId: subject, methodVersion: 3,
    sourceScope: { routeIds: ["r"], canonicalUrls: [PAGE], observationArtifactIds: ["held-page"] } } } } as unknown as WorkItem);

test("a dropped finding lands in the Box under the reporting work item; one for another subject waits for its own door", async () => {
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

  const report = await buildBoxFindings({ repos, items: [item(COUNTY)], now: () => NOW, leaseMs: 60_000,
    readCapture: async () => { throw new Error("no capture is read for another subject's finding"); } });
  assert.deepEqual(report, { built: [], waiting: [{ findingId: row.id, reason: "Dropped for another subject; it waits for that subject's own door." }] });

  // A drop for the item's own subject is built from the fact it carries: the builder goes on to read the saved page.
  const own = createMemoryRepositories();
  await indexReportedFinding(own.boxFindings, { workItemId: "wi-county", attemptId: "at-mission", missionPart: null,
    finding: { ...finding, subjectId: COUNTY, field: "name", value: "Dana Rivers", exactQuote: "Board chair: Dana Rivers." } }, NOW);
  await assert.rejects(buildBoxFindings({ repos: own, items: [item(COUNTY)], now: () => NOW, leaseMs: 60_000,
    readCapture: async () => { throw new Error("own-subject drop reached the saved page"); } }), /own-subject drop reached the saved page/);
});

test("the round hands its mission blanks to both Scout paths; the lease worker asks its parent as each task begins", () => {
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /missionBlanks = missionBlanksFrom\(places\.flatMap\(place => place\.items\), parts\);/);
  assert.match(round, /lifetimeHuntSubject: subject => lifetimeHuntSubjects\.has\(subject\), missionBlanksFor \}\);/);
  assert.match(round, /reserveEscalation: scoutEscalationReservation\(fleetSafety\),\n    missionBlanksFor,/);
  const worker = readFileSync(new URL("../lib/control-plane/workers/lease-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /broker\.call<readonly MissionBlank\[\]>\("mission-blanks", subject\)/);
  assert.match(worker, /runtime\.beginTask\?\.\(task, item\)/);
  const pool = readFileSync(new URL("../lib/control-plane/workers/process-pool.ts", import.meta.url), "utf8");
  assert.match(pool, /message\.kind === "mission-blanks"\) \{\n\s+body = input\.missionBlanksFor\?\.\(String\(message\.body\)\) \?\? \[\];/);
});
