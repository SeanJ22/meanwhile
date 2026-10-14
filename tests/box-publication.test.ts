import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { indexDetectiveFindings, indexReportedFinding, indexScoutFindings } from "../lib/control-plane/box.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { ProbeFetch } from "../lib/doors/probe.ts";
import { publishBoxFindings } from "../lib/facts/box-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { slotFor } from "../lib/facts/finding-slots.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = join(import.meta.dirname, "..");
const NOW = "2026-09-08T12:00:00.000Z";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const TCCC = `${TUCSON}#tucson-convention-center-commission`;
const AGENDA = `${TUCSON}#agenda-committee`;
const TCCC_URL = "https://clerksboards.tucsonaz.gov/boards/15";
const AGENDA_URL = "https://clerksboards.tucsonaz.gov/boards/?board=136";

test("hunter field names map to fact-store slots; a field with no slot names the class it waits for", () => {
  const slot = (field: string, value: unknown = "x", recordClass: string | null = null) => slotFor(field, value, recordClass);
  assert.deepEqual(slot("officeholder.name"), { class: "rosters", slot: "member_name" });
  assert.deepEqual(slot("boardMember.title"), { class: "rosters", slot: "member_office" });
  assert.deepEqual(slot("name"), { class: "rosters", slot: "member_name" });
  assert.deepEqual(slot("officeholder.name (Board Member)"), { class: "rosters", slot: "member_name" });
  assert.deepEqual(slot("officeholder.name/office (board member)"), { class: "rosters", slot: "member_name" });
  assert.deepEqual(slot("officeholder.councilMember.name"), { class: "rosters", slot: "member_name" });
  assert.deepEqual(slot("governingBoard.member"), { class: "rosters", slot: "member_name" });
  assert.deepEqual(slot("officeholder.term_expires"), { class: "rosters", slot: "term_end" });
  assert.deepEqual(slot("officeholder.term"), { class: "rosters", slot: "term_note" });
  assert.deepEqual(slot("officeholder.email"), { class: "contacts", slot: "email" });
  assert.deepEqual(slot("phone"), { class: "contacts", slot: "phone" });
  assert.deepEqual(slot("district.phone"), { class: "office contacts", slot: "office_phone" });
  assert.deepEqual(slot("district.address"), { class: "office contacts", slot: "office_address" });
  assert.deepEqual(slot("meeting.schedule"), { class: "schedules", slot: "meeting_cadence" });
  assert.deepEqual(slot("commentPeriod", "Yes"), { class: "comment rules", slot: "comment:period" });
  assert.deepEqual(slot("publicComment.timeLimit"), { class: "comment rules", slot: "comment:time_limit" });
  assert.deepEqual(slot("body.name"), { class: "directory", waiting: "DIRECTORY_CLASS_NOT_MOVED" });
  assert.deepEqual(slot("recorder.phone"), { class: "services", waiting: "SERVICES_CLASS_NOT_MOVED" });
  assert.deepEqual(slot("meeting.location"), { class: "meetings", waiting: "FINDING_NAMES_NO_SITTING" });
  assert.deepEqual(slot("officeholder.name", "x", "candidate-enrichment"), { class: "candidates", waiting: "CANDIDATE_CLASS_NOT_MOVED" });
  assert.deepEqual(slot("population"), { class: "other", waiting: "NO_FACT_SLOT" });
});

test("Box findings publish on their own page with no model turn: a held copy inside the clock, otherwise one fetch; the rest wait or refuse with reasons, once", async () => {
  const facts = await factDb();
  await ensureFactEntities(facts, ROOT, ["az"]);
  const repos = createMemoryRepositories();
  const vault = new MemoryEvidenceStore();
  const hold = async (url: string, html: string, savedAt: string) => {
    const { artifact } = recordAcquisition({ canonicalUrl: url, retrievedAt: savedAt, httpStatus: 200, contentType: "text/html", sourceId: new URL(url).hostname,
      methodRouteId: "scout:fetch_public", workItemId: "wi-hunt", attemptId: "at-hunt", permission: "ALLOWED", transport: "REACHABLE" }, html);
    await putArtifact(vault, "freshness", artifact, Buffer.from(html));
    await repos.artifacts.append("wi-hunt", artifact.id, { artifactId: artifact.id, workItemId: "wi-hunt", routeTaskId: null, attemptId: artifact.attemptId,
      tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: url, partial: false, recordedAt: savedAt }, savedAt);
    return artifact.id;
  };
  const agendaPage = "<html><head><title>Agenda Committee | City of Tucson</title></head><body><h1>Agenda Committee</h1><table><tr><td>Dana Example</td><td>Chair</td></tr></table></body></html>";
  const tccc = await hold(TCCC_URL, readFileSync(join(ROOT, "tests", "fixtures", "clerksboards", "b15.html"), "utf8"), "2026-09-01T15:00:00.000Z");
  const staleAgenda = await hold(AGENDA_URL, agendaPage.replace("Dana Example", "Former Member"), "2026-06-01T15:00:00.000Z");
  const fetched: string[] = [];
  const fetch: ProbeFetch = async url => {
    fetched.push(url);
    if (url.includes("unreachable")) throw new Error("connect ECONNREFUSED");
    return { status: 200, headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null },
      bytes: async () => new TextEncoder().encode(agendaPage) };
  };

  let index = 0;
  const drop = (subjectId: string, field: string, value: string, exactQuote: string, sourceUrl: string, artifactIds: readonly string[]) =>
    indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-hunt", missionPart: null,
      finding: { subjectId, field, value, exactQuote, sourceUrl, artifactIds, subjectHint: null, index: index++ } }, NOW);
  await drop(TCCC, "officeholder.name", "Ned Beman", "Ned Beman Chairperson Ward 2", TCCC_URL, [tccc]);
  await drop(TCCC, "officeholder.title", "Chairperson", "Ned Beman Chairperson", TCCC_URL, [tccc]);
  await drop(TCCC, "office.phone", "(520)791-4213", "please contact the City Clerk's Office at (520)791-4213", TCCC_URL, [tccc]);
  await drop(TCCC, "body.name", "Tucson Convention Center Commission", "Tucson Convention Center Commission", TCCC_URL, [tccc]);
  await drop(AGENDA, "officeholder.name", "Dana Example", "Dana Example Chair", AGENDA_URL, [staleAgenda]);
  await drop(AGENDA, "officeholder.name", "Rosa Sample", "Rosa Sample Member", "https://unreachable.tucsonaz.gov/agenda", []);
  await drop("az:city:nowhere", "officeholder.name", "Pat Doe", "Mayor Pat Doe", "https://nowhere.example.gov/", []);
  const candidates: ScoutResult = { formatVersion: 1, attemptId: "at-candidates", obligationId: "ob-candidates", routeTaskId: "rt", workItemId: "wi-hunt",
    subjectId: TCCC, routeId: "candidates", recordClass: "candidate-enrichment", providerId: "fixture", reason: "Recorded hunter findings", outcome: "EVIDENCE_FOUND",
    stoppedBy: "MODEL", rungs: [], distinctEvidenceRungs: 1, candidates: [], nextRungs: [], unverified: [], narrative: "Saved fields",
    findings: [{ subjectId: TCCC, field: "website", value: "https://ned.example.com", exactQuote: "ned.example.com", sourceUrl: TCCC_URL, artifactIds: [tccc], kind: "RECORD", summary: "site" }],
    worker: { provider: "fixture", model: "fixture", modelReported: "fixture" }, usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 1, toolCalls: 1 },
    usd: 0.01, elapsedMs: 1, artifactIds: [tccc], methodCandidateIds: [], refusal: null, startedAt: NOW, recordedAt: NOW };
  await repos.scoutResults.append(candidates.obligationId, candidates.attemptId, candidates, NOW);
  await indexScoutFindings(repos.boxFindings, candidates, NOW);
  await indexDetectiveFindings(repos.boxFindings, { id: "dr-1", workItemId: "wi-hunt", endedAt: NOW, result: { role: "DETECTIVE", findings: [], artifactIds: [tccc],
    spans: [{ artifactId: tccc, contentHash: "h", start: 0, end: 9, quote: "Ned Beman", offsetUnit: "UTF16_CODE_UNITS" }], question: { subjectId: TCCC } } }, new Map(), NOW);

  const input = { repos, facts, vault, fetch, clocks: factClocks(null), now: NOW, limit: 100 };
  const report = await publishBoxFindings(input);
  assert.deepEqual({ ...report, byPlace: undefined }, { looked: 9, published: 4, refused: 1, byPlace: undefined,
    waitingByClass: { directory: 1, rosters: 1, candidates: 1, detective: 1 }, failuresByReason: { "SOURCE_BLOCKED:FETCH_FAILED:connect ECONNREFUSED": 1 } }, JSON.stringify(report));
  assert.deepEqual(report.byPlace[TCCC], { published: 3, refused: 0, waiting: 3 });
  assert.deepEqual(report.byPlace[AGENDA], { published: 1, refused: 1, waiting: 0 });
  assert.deepEqual(fetched.sort(), [AGENDA_URL, "https://unreachable.tucsonaz.gov/agenda"], "the held TCCC copy is inside its clock; the stale agenda copy is read again once");

  const rosters = (await readFactRosters(facts.query, [TCCC, AGENDA])).rosters;
  const ned = rosters.find(roster => roster.bodyId === TCCC)!.members.find(member => member.name === "Ned Beman")!;
  assert.equal(ned.officeTitle, "Chairperson");
  assert.equal(ned.fieldSources?.name?.sourceUrl, TCCC_URL);
  assert.ok(rosters.find(roster => roster.bodyId === AGENDA)!.members.some(member => member.name === "Dana Example"));
  assert.deepEqual(await facts.query("SELECT entity_id, field, value FROM fact WHERE field = 'office_phone' AND status = 'live'"), [{ entity_id: TCCC, field: "office_phone", value: "(520)791-4213" }]);
  assert.deepEqual(await facts.query("SELECT stage, reason FROM blank WHERE entity_id = $1 AND field = 'member_name'", [AGENDA]), [{ stage: "ACQUIRE", reason: "SOURCE_BLOCKED" }]);

  const waiting = (await repos.boxFindings.listWhere(["state"], "waiting")).map(row => row.value.waitingFor?.reason).sort();
  assert.deepEqual(waiting, ["CANDIDATE_CLASS_NOT_MOVED", "DETECTIVE_SPAN_NAMES_NO_FIELD", "DIRECTORY_CLASS_NOT_MOVED", "SUBJECT_HAS_NO_BODY_IN_THE_FACT_STORE"]);
  assert.equal((await publishBoxFindings(input)).looked, 0, "a held finding is looked at again only when the slot map moves");
});
