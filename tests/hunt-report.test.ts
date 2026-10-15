import assert from "node:assert/strict";
import test from "node:test";

import { indexReportedFinding } from "../lib/control-plane/box.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import type { OpenOne, VaultPut } from "../lib/control-plane/scheduler/route-executor.ts";
import type { ScoutToolContext } from "../lib/control-plane/scheduler/scout-contract.ts";
import { buildScoutToolkit } from "../lib/control-plane/scheduler/scout-tools.ts";
import type { HuntSearch } from "../lib/hunt/search.ts";

const NOW = "2026-10-14T12:00:00.000Z";
const COUNTY = "ocd-division/country:us/state:az/county:pima";
const PAGE_URL = "https://pima.example.gov/board";
const PAGE = "<html><body><h1>Board of Supervisors</h1><p>The Board meets on the first Tuesday of each month at 9 a.m.</p>" +
  "<p>Chair: Rex Scott</p></body></html>";

function row() {
  const scheduled = scheduleObligation({ id: `hunt:packet:${COUNTY}`, recordClass: "HUNT_PACKET", subjectId: COUNTY, routeId: "hunter:packet",
    active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, Date.parse(NOW));
  assert.ok(isScheduled(scheduled));
  return scheduled;
}

function fixture(overrides: Partial<ScoutToolContext> = {}) {
  const repos = createMemoryRepositories();
  const opened: string[] = [];
  const vaulted: string[] = [];
  const vault: VaultPut = async artifact => { vaulted.push(artifact.id); return { stored: true, where: `mem/${artifact.id}`, why: "written" }; };
  const openOne: OpenOne = async ({ url }) => {
    opened.push(url);
    const body = url === PAGE_URL ? PAGE : url.endsWith("/robots.txt") ? "User-agent: *\nDisallow:\n" : "not found";
    return { status: url === PAGE_URL || url.endsWith("/robots.txt") ? 200 : 404, bytes: Buffer.byteLength(body), contentType: url.endsWith(".txt") ? "text/plain" : "text/html",
      body, durationMs: 1, transportError: null };
  };
  const kit = buildScoutToolkit({
    obligation: row(), route: null, providerId: null, attemptId: "at-hunt", workItemId: "wi-hunt", routeTaskId: "rt-hunt", holder: "hunter-test",
    vault, spaceOut: async () => {}, bound: RESEARCH_BOUNDS.perDispatch, now: () => NOW, handed: { artifactIds: [] }, openOne,
    reportFinding: {
      subjects: new Set([COUNTY, `${COUNTY}#body:board`]),
      write: async finding => ({ boxId: (await indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-hunt",
        obligationId: `hunt:packet:${COUNTY}`, missionPart: null, finding }, NOW)).id }),
    },
    ...overrides,
  });
  return { kit, repos, opened, vaulted };
}

const report = (field: string, value: string, sentence: string, subjectId = `${COUNTY}#body:board`) =>
  ({ subjectId, field, value, sourceUrl: PAGE_URL, sentence });

test("each reported fact is in the Box the moment it is reported, with its page and sentence", async () => {
  const { kit, repos } = fixture();
  const first = await kit.call("report_finding", report("meetingSchedule", "first Tuesday, 9 a.m.", "The Board meets on the first Tuesday of each month at 9 a.m."));
  assert.equal(first.ok, true, first.forModel);
  assert.match(first.forModel, /^IN THE BOX/);
  const box = await repos.boxFindings.list();
  assert.equal(box.length, 1);
  assert.equal(box[0]!.value.sourceUrl, PAGE_URL);
  assert.equal(box[0]!.value.exactQuote, "The Board meets on the first Tuesday of each month at 9 a.m.");
  assert.equal(box[0]!.value.origins[0]!.resultKey, `hunt:packet:${COUNTY}`);
  assert.equal(box[0]!.value.origins[0]!.reported?.field, "meetingSchedule");
  assert.equal(kit.reported.length, 1);
});

test("code fetches the cited page once and saves it; a second fact from it reuses the saved copy", async () => {
  const { kit, opened, vaulted } = fixture();
  const first = await kit.call("report_finding", report("meetingSchedule", "first Tuesday", "The Board meets on the first Tuesday of each month at 9 a.m."));
  const second = await kit.call("report_finding", report("chair", "Rex Scott", "Chair: Rex Scott"));
  assert.equal(opened.filter(url => url === PAGE_URL).length, 1, "the page is opened once for both facts");
  const page = first.artifacts.find(artifact => artifact.canonicalUrl === PAGE_URL);
  assert.ok(page, "the capture is returned with the first report so the job records it");
  assert.equal(second.artifacts.length, 0);
  assert.ok(vaulted.includes(page.artifactId));
  assert.deepEqual(kit.reported.map(f => f.artifactIds), [[page.artifactId], [page.artifactId]]);
});

test("the hunt never refuses a fact over its quote: checking happens once, on the Slide", async () => {
  const { kit, repos } = fixture();
  const call = await kit.call("report_finding", report("phone", "520-555-0100", "Call the clerk at 520-555-0100."));
  assert.equal(call.ok, true, call.forModel);
  assert.equal((await repos.boxFindings.list()).length, 1);
});

test("a fact for a subject outside the packet, or with a field missing, is refused and nothing is written", async () => {
  const { kit, repos } = fixture();
  const outside = await kit.call("report_finding", report("chair", "Someone", "Chair: Someone", "ocd-division/country:us/state:az/county:maricopa"));
  const missing = await kit.call("report_finding", { subjectId: COUNTY, field: "chair", value: "Rex Scott", sourceUrl: PAGE_URL });
  assert.equal(outside.ok, false);
  assert.equal(missing.ok, false);
  assert.equal((await repos.boxFindings.list()).length, 0);
});

test("the same fact reported twice is written once", async () => {
  const { kit, repos } = fixture();
  await kit.call("report_finding", report("chair", "Rex Scott", "Chair: Rex Scott"));
  const again = await kit.call("report_finding", report("chair", "Rex Scott", "Chair: Rex Scott"));
  assert.match(again.forModel, /^ALREADY IN THE BOX/);
  assert.equal((await repos.boxFindings.list()).length, 1);
});

test("search returns page text to the model only, charges every request, and stores no search text", async () => {
  const charged: number[] = [];
  const search: HuntSearch = async () => ({ provider: "brave", errors: [],
    hits: [{ url: PAGE_URL, title: "Board of Supervisors", provider: "brave", text: "The Board meets on the first Tuesday." }],
    charges: [{ provider: "brave", host: "api.search.brave.com", usd: 0.005, bytes: 900, deep: false }] });
  const { kit } = fixture({ search, chargeSearch: async charge => { charged.push(charge.usd ?? 0); } });
  const call = await kit.call("search", { query: "Pima County board of supervisors meeting schedule" });
  assert.equal(call.ok, true, call.forModel);
  assert.match(call.forModel, /first Tuesday/);
  assert.deepEqual(charged, [0.005]);
  assert.equal(call.artifacts.length, 0, "search text is never saved");
  assert.ok(!JSON.stringify(call.step ?? {}).includes("first Tuesday"), "the step record holds no search text");
});
