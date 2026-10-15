import assert from "node:assert/strict";
import test from "node:test";

import { indexReportedFinding } from "../lib/control-plane/box.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import type { OpenOne } from "../lib/control-plane/scheduler/route-executor.ts";
import { hunterExecutor, type ModelRequest, type ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { buildScoutToolkit } from "../lib/control-plane/scheduler/scout-tools.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { huntBrief } from "../lib/hunt/brief.ts";
import { blankDigest, packetDue, triedSteps } from "../lib/hunt/packet-due.ts";
import { blankFingerprint, type HuntPacket } from "../lib/hunt/packet.ts";

const NOW = "2026-10-14T12:00:00.000Z";
const COUNTY = "ocd-division/country:us/state:az/county:pima";
const BOARD = `${COUNTY}#board`;
const PAGE_URL = "https://pima.example.gov/board";
const PAGE = "<html><body><p>The Board meets on the first Tuesday of each month at 9 a.m.</p></body></html>";

const packet: HuntPacket = {
  governmentId: COUNTY, label: "Pima County",
  held: [{ subjectId: BOARD, subjectLabel: "Board of Supervisors", checklistId: "GOV-02", family: "GOV", requirement: "Body's official website",
    value: "https://pima.example.gov", sourceUrl: "https://pima.example.gov", checkedAt: "2026-10-01T00:00:00.000Z" }],
  blanks: [
    { subjectId: BOARD, subjectLabel: "Board of Supervisors", checklistId: "MTG-01", family: "MTG", requirement: "Regular meeting schedule" },
    { subjectId: BOARD, subjectLabel: "Board of Supervisors", checklistId: "MTG-02", family: "MTG", requirement: "Meeting location" },
  ],
};

function row() {
  const scheduled = scheduleObligation({ id: `hunt:packet:${COUNTY}`, recordClass: "HUNT_PACKET", subjectId: COUNTY, routeId: "hunter:packet",
    active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, Date.parse(NOW));
  assert.ok(isScheduled(scheduled));
  return scheduled;
}

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const turn = (content: ModelResponse["content"]): ModelResponse => ({ id: "msg", model: "claude-haiku-5-5", content, usage, stop_reason: "tool_use" } as ModelResponse);

function scripted(turns: readonly ModelResponse[]) {
  const requests: ModelRequest[] = [];
  return { requests, transport: async (request: ModelRequest) => { requests.push(request); const next = turns[requests.length - 1]; if (!next) throw new Error("no more turns"); return next; } };
}

function harness(turns: readonly ModelResponse[], packetNow: HuntPacket | null = packet) {
  const repos = createMemoryRepositories();
  const results: ScoutResult[] = [];
  const openOne: OpenOne = async ({ url }) => {
    const body = url === PAGE_URL ? PAGE : url.endsWith("/robots.txt") ? "User-agent: *\nDisallow:\n" : "missing";
    return { status: url === PAGE_URL || url.endsWith("/robots.txt") ? 200 : 404, bytes: Buffer.byteLength(body), contentType: "text/html", body, durationMs: 1, transportError: null };
  };
  const { requests, transport } = scripted(turns);
  const executor = hunterExecutor({
    role: "HUNTER", transport, now: () => NOW,
    playbookFor: async () => ({ text: "Fill the blanks; report each fact as found.", version: "v1", entryIds: ["fm-hunter"] }),
    toolkitFor: ctx => buildScoutToolkit(ctx),
    contextFor: async () => packetNow === null ? null : ({
      brief: huntBrief(packetNow, { role: "HUNTER", tried: [] }), reason: "test", blanks: packetNow.blanks.length, handed: { artifactIds: [] },
      tools: { vault: async artifact => ({ stored: true, where: `mem/${artifact.id}`, why: "written" }), spaceOut: async () => {}, openOne, held: packetNow.held,
        reportFinding: { subjects: new Set([COUNTY, BOARD]), write: async finding => ({ boxId: (await indexReportedFinding(repos.boxFindings,
          { workItemId: "wi", attemptId: "at", obligationId: `hunt:packet:${COUNTY}`, missionPart: null, finding }, NOW)).id }) } },
    }),
    onResult: async result => { results.push(result); },
  });
  const run = () => executor.run({ obligation: row(), routeTaskId: "rt", workItemId: "wi", attemptId: "at", executor: "BOUNDED_MODEL_WORKER",
    bound: { maxAttempts: 1, maxWallMs: 0 }, holder: "test" });
  return { run, repos, results, requests };
}

test("the brief lists what we hold as never-look-again and only the open blanks", () => {
  const brief = huntBrief(packet, { role: "HUNTER", tried: [] });
  assert.match(brief, /WHAT WE ALREADY HOLD/);
  assert.match(brief, /https:\/\/pima\.example\.gov/);
  assert.match(brief, /Regular meeting schedule/);
  assert.ok(!/Body's official website/.test(brief.split("BLANKS TO FILL")[1] ?? ""), "a held fact is not listed as a blank");
});

test("a hunter reports facts as found; the Box holds them before finish and the job records one-line summary", async () => {
  const h = harness([
    turn([{ type: "tool_use", id: "t1", name: "report_finding", input: { subjectId: BOARD, field: "MTG-01", value: "first Tuesday, 9 a.m.",
      sourceUrl: PAGE_URL, sentence: "The Board meets on the first Tuesday of each month at 9 a.m." } }]),
    turn([{ type: "tool_use", id: "t2", name: "finish", input: { summary: "Found the meeting schedule.",
      unfilled: [{ subjectId: BOARD, field: "MTG-02", tried: "the board page", unlock: "the clerk's agenda page" }] } }]),
  ]);
  const outcome = await h.run();
  assert.equal(outcome.kind, "DISPOSED", outcome.detail);
  assert.equal(outcome.disposition?.disposition, "INGESTED");
  assert.equal((await h.repos.boxFindings.list()).length, 1);
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0]!.narrative, "Found the meeting schedule.");
  assert.deepEqual(h.results[0]!.unfilled?.map(u => u.field), ["MTG-02"]);
  assert.ok(outcome.artifacts?.some(artifact => artifact.canonicalUrl === PAGE_URL), "the cited page's capture is recorded with the job");
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1]!.system, h.requests[0]!.system, "the static prefix is identical on every turn");
});

test("nothing is sent when the packet has no open blank when the job starts", async () => {
  const h = harness([], null);
  const none = await h.run();
  assert.equal(none.kind, "DISPOSED");
  assert.match(none.detail ?? "", /HUNT_NOTHING_OPEN/);
  assert.equal(h.requests.length, 0);
});

test("a job that ends early keeps every fact it reported", async () => {
  const h = harness([
    turn([{ type: "tool_use", id: "t1", name: "report_finding", input: { subjectId: BOARD, field: "MTG-01", value: "first Tuesday",
      sourceUrl: PAGE_URL, sentence: "The Board meets on the first Tuesday of each month at 9 a.m." } }]),
  ]);
  const outcome = await h.run();
  assert.equal(outcome.kind, "DISPOSED", outcome.detail);
  assert.equal((await h.repos.boxFindings.list()).length, 1);
  assert.equal(h.results[0]!.findings.length, 1);
});

test("a packet is sent only while a blank is open and something changed", () => {
  const last = { recordedAt: "2026-10-13T00:00:00.000Z", blankFingerprint: blankFingerprint(packet), blankDigests: packet.blanks.map(blankDigest) };
  const base = { packet, orderedAt: null, shutDoors: [], now: NOW, maxWaitMs: 5 * 86_400_000 };
  assert.deepEqual(packetDue({ ...base, last: null }), { due: true, role: "HUNTER", why: "first hunt: 2 open blank(s)" });
  assert.equal(packetDue({ ...base, packet: { ...packet, blanks: [] }, last: null }).due, false);
  assert.equal(packetDue({ ...base, last }).due, false, "nothing changed since the last hunt");
  const ordered = packetDue({ ...base, last, orderedAt: "2026-10-14T00:00:00.000Z" });
  assert.equal(ordered.due, true);
  assert.equal(ordered.due && ordered.role, "DETECTIVE", "the same blanks again go to a detective");
  const shut = packetDue({ ...base, last, shutDoors: [{ doorId: "door-1", shutSince: "2026-10-13T06:00:00.000Z", evidence: "HTTP 403" }] });
  assert.deepEqual(shut, { due: true, role: "DETECTIVE", why: "door door-1 shut since the last hunt" });
  const changed = packetDue({ ...base, last, packet: { ...packet, blanks: [...packet.blanks,
    { subjectId: BOARD, subjectLabel: "Board of Supervisors", checklistId: "MTG-03", family: "MTG", requirement: "Agenda" }] } });
  assert.equal(changed.due, true);
  assert.equal(packetDue({ ...base, last, now: "2026-10-19T00:00:00.000Z" }).due, true, "a dead end waits no longer than Admin's limit");
});

test("a detective is told what was tried and what shut", () => {
  const tried = triedSteps({ steps: [{ tool: "fetch_public", target: PAGE_URL, observed: "HTTP 200" }],
    unfilled: [{ subjectId: BOARD, field: "MTG-02", tried: "the board page", unlock: "the agenda page" }],
    shutDoors: [{ doorId: "door-1", shutSince: null, evidence: "HTTP 403" }] });
  const brief = huntBrief(packet, { role: "DETECTIVE", tried });
  assert.match(brief, /WHAT WAS TRIED BEFORE/);
  assert.match(brief, /door door-1/);
  assert.match(brief, /would unlock: the agenda page/);
});
