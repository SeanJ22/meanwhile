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
import { readElectionFieldsForDivisions } from "../lib/civic-data/curated-reader-read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { projectCampaignSiteChains, type CampaignSiteSubject } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import { officeNameOn, publishBoxFindings, remedyFor, seatIn } from "../lib/facts/box-publication.ts";
import { factClocks, FRESHNESS_HOURS_DEFAULT } from "../lib/facts/clocks.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { ensureEntity, ensureFactEntities, ensureGoverningBody } from "../lib/facts/entities.ts";
import { FINDING_SLOTS_VERSION, slotFor, slotsVersionOf } from "../lib/facts/finding-slots.ts";
import { withFactRegistry } from "../lib/facts/registry-overlay.ts";
import type { RegistryRuntimeCarton } from "../lib/registry/runtime-data-plane.ts";
import { fetchCapture } from "../lib/facts/capture.ts";
import { publishRosterFacts } from "../lib/facts/roster-facts.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = join(import.meta.dirname, "..");
const NOW = "2026-09-08T12:00:00.000Z";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const TCCC = `${TUCSON}#tucson-convention-center-commission`;
const AGENDA = `${TUCSON}#agenda-committee`;
const TCCC_URL = "https://clerksboards.tucsonaz.gov/boards/15";
const AGENDA_URL = "https://clerksboards.tucsonaz.gov/boards/?board=136";

/** Arizona's fact entities, memory repositories and a vault holding each page a hunter cited, as `wi-hunt` saved it. */
async function setup() {
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
  return { facts, repos, vault, hold };
}

const B15 = readFileSync(join(ROOT, "tests", "fixtures", "clerksboards", "b15.html"), "utf8");

test("hunter field names map to fact-store slots; a field with no slot names the class it waits for", () => {
  const slot = (field: string, value: unknown = "x", recordClass: string | null = null, quote = "") => slotFor(field, value, recordClass, quote);
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
  assert.deepEqual(slot("body.name"), { class: "other", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("recorder.phone", "(928) 865-2632"), { class: "other offices", slot: "office_phone", office: "recorder" });
  assert.deepEqual(slot("contact.phone", "(520) 724-4330", null, "Contact Pima County Recorder Voter Services at (520) 724-4330"), { class: "other offices", slot: "office_phone", office: "recorder" });
  assert.deepEqual(slot("office.phone", "520-225-4800", null, "You can also call Transportation at 520-225-4800."), { class: "other offices", slot: "office_phone", office: "transportation" });
  assert.deepEqual(slotFor("office.email", "bnavarro@coolidgeaz.com", null, "Email: bnavarro@coolidgeaz.com", "https://www.coolidgeaz.com/publicworks"), { class: "other offices", slot: "office_email", office: "public works" });
  // Names, addresses, schedules and comment rules sort by what they are.
  assert.deepEqual(slot("bodyName", "Board of Adjustment"), { class: "bodies", slot: "body_name" });
  assert.deepEqual(slot("subordinateBody.name", "4-Day School Week Committee"), { class: "bodies", slot: "body_name" });
  assert.deepEqual(slot("district.name", "Elfrida Elementary District (4185)"), { class: "other", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("townClerk.name", "Cecilia Jernigan", null, "Cecilia Jernigan, Town Clerk"), { class: "other", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("trustee.name", "Dana Example", null, "Dana Example, Board Member"), { class: "rosters", slot: "member_name" });
  assert.deepEqual(slot("townHall.address", "110 W. Center"), { class: "office contacts", slot: "office_address" });
  assert.deepEqual(slot("clerk.office.address", "1011 N. Coronado Drive Sierra Vista, AZ 85635"), { class: "office contacts", slot: "office_address" });
  assert.deepEqual(slot("officeholder.address", "701 W. Wetmore Road Tucson, AZ 85705"), { class: "other", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("elections.address", "1415 Melody Lane Bisbee AZ 85603"), { class: "other offices", slot: "office_address", office: "election" });
  assert.deepEqual(slot("governingBoard.meetingSchedule", "first Wednesday, following the first Monday, of each month"), { class: "schedules", slot: "meeting_cadence" });
  assert.deepEqual(slot("governingBoard.meetingLocation", "360 S. Patagonia St., Benson, AZ 85602"), { class: "other", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("publicComment.signupRule", "Any individual desiring to address the Board shall complete a request to speak form"), { class: "comment rules", slot: "comment:signup" });
  assert.deepEqual(slot("publicComment.actionLimit", "three minutes per speaker"), { class: "comment rules", slot: "comment:time_limit" });
  assert.deepEqual(slot("publicComment.policyAdopted", "Adopted: September 27, 2021"), { class: "other", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("office.email", "CityClerk@SierraVistaAZ.gov"), { class: "office contacts", slot: "office_email" });
  assert.deepEqual(slot("townHall.phone", "(520) 487-2331"), { class: "office contacts", slot: "office_phone" });
  assert.deepEqual(slot("office.fax", "(520) 487-2331"), { class: "other", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("policy.adopted", "2023-08-24"), { class: "other", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("meeting.location"), { class: "meetings", waiting: "FINDING_NAMES_NO_SITTING" });
  assert.deepEqual(slot("officeholder.name", "x", "candidate-enrichment"), { class: "candidates", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("candidate.bio", "x", "candidate-enrichment"), { class: "candidates", lead: "candidate-profile" });
  assert.deepEqual(slot("candidate.contact.email", "jane@example.com", "candidate-enrichment"), { class: "candidates", lead: "candidate-profile" });
  assert.deepEqual(slot("candidate.campaignSite", "https://janedoe.example.com", "candidate-enrichment"), { class: "campaign sites", lead: "campaign-site" });
  assert.deepEqual(slot("candidate.position.education", "x", "candidate-enrichment"), { class: "candidates", waiting: "TAKES_WHOLE_RECORDS_ONLY" });
  assert.deepEqual(slot("population"), { class: "other", waiting: "NO_FACT_SLOT" });
  assert.deepEqual(slot("OFF-04", "Rex Scott"), { class: "rosters", slot: "member_name" });
  assert.deepEqual(slot("OFF-09", "clerk@tucsonaz.gov"), { class: "contacts", slot: "email" });
  assert.deepEqual(slot("OFF-09", "(520) 791-4213"), { class: "contacts", slot: "phone" });
  assert.deepEqual(slot("GOV-08", "520-791-4213"), { class: "office contacts", slot: "office_phone" });
  assert.deepEqual(slot("GOV-08", "255 W. Alameda St., Tucson, AZ 85701"), { class: "office contacts", slot: "office_address" });
  assert.deepEqual(slot("GOV-08", "https://www.tucsonaz.gov"), { class: "body links", slot: "homepage" });
  assert.deepEqual(slot("GOV-08", "clerk@tucsonaz.gov"), { class: "office contacts", slot: "office_email" });
  assert.deepEqual(slot("OFF-06", "January 2027", null, "Term expires January 2027"), { class: "rosters", slot: "term_end" });
  assert.deepEqual(slot("OFF-06", "2023", null, "Appointed in 2023"), { class: "rosters", slot: "term_start" });
  assert.deepEqual(slot("OFF-08", "https://tucsonaz.gov/ward2"), { class: "contacts", slot: "website" });
  // A link a hunter found is a page to go read: the next walk of the government's own site reads it first.
  for (const id of ["MTG-01", "DOC-02", "GOV-03", "FIN-01", "ELE-01"]) assert.deepEqual(slot(id, "https://tucsonaz.hylandcloud.com/221agendaonline"), { class: "site walk", handoff: "site-walk" }, id);
  assert.deepEqual(slot("MTG-01", "tenant 221"), { class: "meeting routes", waiting: "ROUTE_IS_NOT_AN_ADDRESS" });
  assert.deepEqual(slot("DOC-02", "June 2026 minutes"), { class: "agendas and documents", waiting: "TAKES_WHOLE_RECORDS_ONLY" });
  assert.deepEqual(slot("MTG-02", "tenant 221"), { class: "meeting routes", waiting: "ROUTE_IS_NOT_AN_ADDRESS" });
  assert.deepEqual(slot("DOC-07", "https://youtube.com/watch?v=x"), { class: "sittings", slot: "video_url" });
  assert.deepEqual(slot("ELE-20", "https://my.arizona.vote", null, "Check your voter registration status"), { class: "ballot navigation", election: "registration_lookup" });
  assert.deepEqual(slot("ELE-20", "https://my.arizona.vote", null, "Visit the state's site"), { class: "ballot navigation", waiting: "LOOKUP_KIND_NOT_STATED" });
  assert.deepEqual(slot("ELE-08", "October 5, 2026", null, "The deadline to register is October 5, 2026."), { class: "ballot navigation", election: "registration_deadline" });
  assert.deepEqual(slot("CAN-04", "https://example-campaign.com"), { class: "campaign sites", lead: "campaign-site" });
  assert.deepEqual(slot("CAN-16", "x"), { class: "candidates", lead: "candidate-profile" });
  assert.deepEqual(slot("CAN-06", "(614) 555-0100"), { class: "candidates", lead: "candidate-profile" });
  assert.deepEqual(slot("CAN-17", "https://upload.wikimedia.org/x.jpg"), { class: "candidates", lead: "candidate-profile" });
  assert.deepEqual(slot("GOV-13", "x"), { class: "governments", waiting: "NO_PUBLICATION_PATH_YET" });
  assert.deepEqual(slot("MTG-08", "x"), { class: "meetings", waiting: "SITTING_FIELDS_COME_FROM_ITS_DOOR" });
  assert.deepEqual(slot("PAR-04", "x"), { class: "taking part", waiting: "NO_READER_FIELD" });
  assert.deepEqual(slot("FIN-03", "x"), { class: "government money", waiting: "TAKES_WHOLE_RECORDS_ONLY" });
  assert.deepEqual(slot("ELE-10", "x"), { class: "elections", waiting: "HELD_IN_CODE_NOT_ON_A_PAGE" });
  assert.deepEqual(slot("MTG-04", "first Tuesday"), { class: "schedules", slot: "meeting_cadence" });
  assert.deepEqual(slot("PAR-03", "3 minutes"), { class: "comment rules", slot: "comment:time_limit" });
  assert.deepEqual(slot("ELE-04", "x"), { class: "elections", waiting: "TAKES_WHOLE_RECORDS_ONLY" });
});

test("Box findings publish on their own page with no model turn: a held copy inside the clock, otherwise one fetch; the rest wait or refuse with reasons, once", async () => {
  const { facts, repos, vault, hold } = await setup();
  const agendaPage = "<html><head><title>Agenda Committee | City of Tucson</title></head><body><h1>Agenda Committee</h1><table><tr><td>Dana Example</td><td>Chair</td></tr></table></body></html>";
  const tccc = await hold(TCCC_URL, B15, "2026-09-01T15:00:00.000Z");
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
    spans: [{ artifactId: tccc, contentHash: "h", start: 0, end: 9, quote: "Ned Beman", offsetUnit: "UTF16_CODE_UNITS" }], question: { subjectId: TCCC } } }, repos.artifacts, NOW);

  const input = { repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 };
  const report = await publishBoxFindings(input);
  assert.deepEqual({ ...report, byPlace: undefined }, { looked: 9, published: 5, refused: 1, byPlace: undefined, handed: 1, seats: { flagged: 0 }, labels: { flagged: 0, moved: 0, cut: 0, renamed: 0 },
    publishedByRoute: { "office contacts": 1, rosters: 3, bodies: 1 },
    waitingByClass: { rosters: 1, detective: 1 }, failuresByReason: { "SOURCE_BLOCKED:FETCH_FAILED:connect ECONNREFUSED": 1 } }, JSON.stringify(report));
  assert.deepEqual(report.byPlace[TCCC], { published: 4, refused: 0, waiting: 1 });
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
  assert.deepEqual(waiting, ["CAMPAIGN_SITE_CHAIN_TAKES_IT", "DETECTIVE_SPAN_NAMES_NO_FIELD", "SUBJECT_HAS_NO_BODY_IN_THE_FACT_STORE"]);
  assert.equal((await publishBoxFindings(input)).looked, 0, "a held finding is looked at again only when the slot map moves");
});

test("a packet hunter's findings publish for the subject each names, not the job's government, and count toward that government", async () => {
  const { facts, repos, vault, hold } = await setup();
  const page = await hold(TCCC_URL, B15, "2026-09-01T15:00:00.000Z");
  const fetch: ProbeFetch = async () => { throw new Error("every cited page is held inside its clock"); };
  let index = 0;
  // As H-01's report_finding writes them: the brief's subject id, a checklist id as the field, the page's own sentence.
  const report = (subjectId: string, field: string, value: string, sentence: string) =>
    indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-packet", obligationId: `hunt:packet:${TUCSON}`, missionPart: null,
      finding: { subjectId, field, value, exactQuote: sentence, sourceUrl: TCCC_URL, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
  await report(TCCC, "OFF-04", "Ned Beman", "Ned Beman Chairperson Ward 2");
  await report(`${TCCC}#calendar`, "MTG-04", "January 22, April 16, 2026 and July and October 2026 TBD @ 9:30 a.m.",
    "Meeting Time January 22, April 16, 2026 and July and October 2026 TBD @ 9:30 a.m.");
  await report(TUCSON, "GOV-08", "(520)791-4213", "For further information please contact the City Clerk's Office at (520)791-4213.");
  await report(TUCSON, "ELE-04", "November 3, 2026", "The general election is November 3, 2026.");
  await report(`${TUCSON}#inventory:body`, "OFF-04", "Jose Jimenez", "Jose Jimenez Vice Chairperson Mayor");
  await report(TCCC, "OFF-04", "Pat Nobody", "Pat Nobody Chairperson");

  const input = { repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 };
  const first = await publishBoxFindings(input);
  assert.deepEqual(Object.keys(first.byPlace), [TUCSON], "every finding counts toward the packet's government");
  assert.deepEqual({ published: first.published, refused: first.refused, waitingByClass: first.waitingByClass, failuresByReason: first.failuresByReason },
    { published: 3, refused: 1, waitingByClass: { elections: 1, rosters: 1 }, failuresByReason: { QUOTE_NOT_ON_SAVED_COPY: 1 } }, JSON.stringify(first));
  const live = async (entityId: string, field: string) => (await facts.query("SELECT value FROM fact WHERE entity_id = $1 AND field = $2 AND status = 'live'", [entityId, field]))
    .map(row => row.value);
  assert.deepEqual(await live(TCCC, "meeting_cadence"), ["January 22, April 16, 2026 and July and October 2026 TBD @ 9:30 a.m."]);
  assert.deepEqual(await live(`${TUCSON}#governing`, "office_phone"), ["(520)791-4213"], "a place's finding lands on its governing body");

  const ned = (await readFactRosters(facts.query, [TCCC])).rosters[0]!.members.find(member => member.name === "Ned Beman")!;
  await report(ned.id, "OFF-09", "(520)791-4213", "please contact the City Clerk's Office at (520)791-4213");
  const second = await publishBoxFindings(input);
  assert.equal(second.published, 1, JSON.stringify(second));
  assert.equal((await readFactRosters(facts.query, [TCCC])).rosters[0]!.members.find(member => member.name === "Ned Beman")!.phone, "(520)791-4213",
    "a seat's contact joins its holder without the sentence naming them");
  const waiting = (await repos.boxFindings.listWhere(["state"], "waiting")).map(row => row.value.waitingFor?.reason).sort();
  assert.deepEqual(waiting, ["SUBJECT_HAS_NO_BODY_IN_THE_FACT_STORE", "TAKES_WHOLE_RECORDS_ONLY"]);
});

test("each checklist id goes where its record publishes: body links, the agenda route, an official host, a sitting, ballot navigation and campaign-site leads", async () => {
  const { facts, repos, vault, hold } = await setup();
  const commission = await hold(TCCC_URL, B15, "2026-09-01T15:00:00.000Z");
  const RECORDER = "https://recorder.pima.gov/voter-registration";
  const recorder = await hold(RECORDER, "<html><body><h1>Tucson, Arizona voters</h1><p>Check your voter registration status: https://my.arizona.vote/</p></body></html>",
    "2026-09-01T15:00:00.000Z");
  const CAMPAIGN = "https://hobbs-for-governor.example.com/";
  const campaign = await hold(CAMPAIGN, "<html><body><h1>Katie Hobbs for Governor</h1><p>Katie Hobbs is running for Governor of Arizona. Visit https://hobbs-for-governor.example.com/</p></body></html>",
    "2026-09-01T15:00:00.000Z");
  await ensureEntity(facts.query, { id: "meeting:tccc-2026-10-01", kind: "meeting", name: "Tucson Convention Center Commission", state: "AZ", parentId: TCCC });
  const fetch: ProbeFetch = async () => { throw new Error("every cited page is held inside its clock"); };
  let index = 0;
  const report = (subjectId: string, field: string, value: string, sentence: string, page = commission, sourceUrl = TCCC_URL) =>
    indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-packet", obligationId: `hunt:packet:${TUCSON}`, missionPart: null,
      finding: { subjectId, field, value, exactQuote: sentence, sourceUrl, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
  const agenda = "https://clerksboards.tucsonaz.gov/boards/15?run=currentagenda&board=15";
  await report(TCCC, "GOV-01", "Tucson Convention Center Commission", "Tucson Convention Center Commission (TCCC)");
  await report(TCCC, "GOV-08", "https://www.tucsonaz.gov/", "City of Tucson");
  await report(`${TCCC}#calendar`, "MTG-01", agenda, "Current Agenda");
  await report(TUCSON, "REF-07", "https://clerksboards.tucsonaz.gov", "Boards and Commissions City of Tucson");
  await report("tccc-2026-10-01", "DOC-07", "https://www.youtube.com/user/CityofTucson", "Watch our YouTube Channel");
  await report(TUCSON, "ELE-20", "https://public.govdelivery.com/accounts/AZTUCSON/subscriber/topics", "Sign up for Email Updates");
  await report(TUCSON, "ELE-20", "https://my.arizona.vote/", "Check your voter registration status: https://my.arizona.vote/", recorder, RECORDER);
  await report("ballot-az-pima:governor:hobbs-katie", "CAN-04", CAMPAIGN, "Visit https://hobbs-for-governor.example.com/", campaign, CAMPAIGN);
  await report(TCCC, "GOV-05", "Advisory", "May recommend to Mayor and Council");

  const store = new MemoryRoutineDataStore();
  const first = await publishBoxFindings({ repos, facts, vault, fetch, store, clocks: factClocks(null), now: NOW, limit: 100 });
  assert.deepEqual({ published: first.publishedByRoute, handed: first.handed, waiting: first.waitingByClass, failures: first.failuresByReason },
    { published: { "body links": 2, "official hosts": 1, sittings: 1, "ballot navigation": 1 }, handed: 2,
      waiting: { "ballot navigation": 1, governments: 1 }, failures: {} }, JSON.stringify(first));
  const live = async (entityId: string, field: string) => (await facts.query("SELECT value FROM fact WHERE entity_id = $1 AND field = $2 AND status = 'live'", [entityId, field]))
    .map(row => row.value);
  assert.deepEqual(await live(TCCC, "name"), ["Tucson Convention Center Commission"]);
  assert.deepEqual(await live(TCCC, "homepage"), ["https://www.tucsonaz.gov/"]);
  assert.deepEqual(await live(TCCC, "agenda_url"), [], "an agenda link is a page to read, not a record to publish");
  const carton = { formatVersion: 1, registry: { bodies: [{ id: TCCC, name: null, homepageUrl: null, agendaSourceRef: null, fieldSources: {} }] } } as unknown as RegistryRuntimeCarton;
  const [seen] = (await withFactRegistry(carton, facts.query)).registry.bodies;
  assert.deepEqual([seen!.name, seen!.homepageUrl, seen!.fieldSources?.homepageUrl?.sourceUrl],
    ["Tucson Convention Center Commission", "https://www.tucsonaz.gov/", TCCC_URL], "readers see the body's sourced name and home page");
  assert.deepEqual(await live("meeting:tccc-2026-10-01", "video_url"), ["https://www.youtube.com/user/CityofTucson"]);
  assert.ok((await facts.query("SELECT host FROM entity_host WHERE host LIKE 'clerksboards.tucsonaz.gov%'")).length > 0, "the government's official host is learned");
  const navigation = await readElectionFieldsForDivisions([TUCSON], { store, now: NOW, bypassCache: true });
  assert.deepEqual(navigation.fields.map(field => [field.value.fieldKind, field.value.navigationUrl]), [["registration_lookup", "https://my.arizona.vote/"]]);
  const reasons = (await repos.boxFindings.listWhere(["state"], "waiting")).map(row => row.value.waitingFor?.reason).sort();
  assert.deepEqual(reasons, ["CAMPAIGN_SITE_CHAIN_TAKES_IT", "LOOKUP_KIND_NOT_STATED", "SITE_WALK_TAKES_IT", "TAKES_WHOLE_RECORDS_ONLY"]);

  const hobbs: CampaignSiteSubject = { candidacyId: "ballot-az-pima:governor:hobbs-katie", givenName: "Katie", familyName: "Hobbs", officeTitle: "Governor",
    ocdId: "ocd-division/country:us/state:az", stateCode: "AZ", cycle: 2026, readerKeys: [], filingDomains: [] };
  const unread = async (): Promise<never> => { throw new Error("no lead is read in this pass"); };
  const page = (artifact: { readonly canonicalUrl: string }) => ({ requestedUrl: artifact.canonicalUrl, finalUrl: artifact.canonicalUrl, httpStatus: 200, contentType: "text/html",
    body: "<html><body><h1>Katie Hobbs for Governor</h1><p>Katie Hobbs is running for Governor of Arizona. Visit https://hobbs-for-governor.example.com/</p></body></html>",
    sha256: "0".repeat(64), retrievedAt: "2026-09-01T15:00:00.000Z", permissions: [], redirects: [] });
  const chain = await projectCampaignSiteChains(repos, { subjects: new Map([[hobbs.candidacyId, hobbs]]), readLead: unread, recordRead: unread,
    heldPage: async artifact => page(artifact), now: NOW, maxReads: 0 });
  assert.ok(chain.offers.some(offer => offer.stage === "SCOUTED" && offer.accepted), JSON.stringify(chain.offers));
  const lead = (await repos.boxFindings.list()).find(row => row.value.subjectId === hobbs.candidacyId)!.value;
  assert.equal(lead.state, "built", "the campaign-site chain took the checked lead");
});

test("the campaign-site check holds a hunter's lead to the freshness clock Admin sets", async () => {
  const { facts, repos, vault, hold } = await setup();
  const CAMPAIGN = "https://hobbs-for-governor.example.com/";
  const html = "<html><body><h1>Katie Hobbs for Governor</h1><p>Visit https://hobbs-for-governor.example.com/</p></body></html>";
  const campaign = await hold(CAMPAIGN, html, "2026-09-01T15:00:00.000Z");
  await indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-packet", obligationId: `hunt:packet:${TUCSON}`, missionPart: null,
    finding: { subjectId: "ballot-az-pima:governor:hobbs-katie", field: "CAN-04", value: CAMPAIGN, exactQuote: "Visit https://hobbs-for-governor.example.com/",
      sourceUrl: CAMPAIGN, artifactIds: [campaign], subjectHint: null, index: 0 } }, NOW);
  await publishBoxFindings({ repos, facts, vault, fetch: async () => { throw new Error("held"); }, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 10 });
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { ...defaultAdminConfig(NOW), settings: { "facts.freshnessHours": { ...FRESHNESS_HOURS_DEFAULT, ballot: 1 } } }, NOW);
  const hobbs: CampaignSiteSubject = { candidacyId: "ballot-az-pima:governor:hobbs-katie", givenName: "Katie", familyName: "Hobbs", officeTitle: "Governor",
    ocdId: "ocd-division/country:us/state:az", stateCode: "AZ", cycle: 2026, readerKeys: [], filingDomains: [] };
  const unread = async (): Promise<never> => { throw new Error("no lead is read in this pass"); };
  await projectCampaignSiteChains(repos, { subjects: new Map([[hobbs.candidacyId, hobbs]]), readLead: unread, recordRead: unread, now: NOW, maxReads: 0,
    heldPage: async artifact => ({ requestedUrl: artifact.canonicalUrl, finalUrl: artifact.canonicalUrl, httpStatus: 200, contentType: "text/html", body: html,
      sha256: "0".repeat(64), retrievedAt: "2026-09-01T15:00:00.000Z", permissions: [], redirects: [] }) });
  const lead = (await repos.boxFindings.list())[0]!.value;
  assert.deepEqual([lead.state, lead.refusal], ["refused", "COPY_OUTSIDE_FRESHNESS_WINDOW"], "a week-old page is past Admin's one-hour clock");
});

test("a name joins a council only when its own words name the seat: staff and bare names wait, two holders of one ward go to Sean, an older seat with no title is flagged", async () => {
  const { facts, repos, vault, hold } = await setup();
  const COUNCIL = "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager";
  const html = "<html><head><title>Mayor and Council | City of Tucson</title></head><body><h1>Mayor and Council</h1><p>Ward 5 Council Member Selina Barajas</p>" +
    "<p>Ward 5 Council Member Richard Fimbres</p><p>Ward 1 Council Member Lane Santa Cruz</p><p>Office of the City Manager - Tim Thomure</p><p>Mr. Tim Kinney</p><p>Steve Kozachik</p></body></html>";
  const page = await hold(COUNCIL, html, "2026-09-01T15:00:00.000Z");
  const [row] = await facts.query("SELECT id, name, state, parent_id FROM entity WHERE id = $1", [`${TUCSON}#governing`]);
  const body = { id: String(row!.id), name: String(row!.name), state: row!.state as string | null, parentId: row!.parent_id as string | null };
  const capture = { evidence: { artifactId: page, contentHash: `sha256-${"c".repeat(64)}`, text: html, acquiredByAttemptId: "at-hunt", canonicalUrl: COUNCIL,
    retrievedAt: "2026-09-01T15:00:00.000Z", sourceId: "www.tucsonaz.gov", methodRouteId: "held" }, observedAt: "2026-09-01T15:00:00.000Z", httpStatus: 200,
  transport: "REACHABLE" as const, partial: false };
  const quote = { quote: "Steve Kozachik", sourceUrl: COUNCIL, sourceOrg: "", collectedAt: "2026-09-01T15:00:00.000Z", verifiedAt: null };
  await publishRosterFacts(facts, { body, capture, members: [{ recordId: "earlier", fields: { name: "Steve Kozachik" }, fieldSources: { name: quote } }],
    complete: false, producedBy: "box" }, factClocks(null), new Date(NOW));

  let index = 0;
  const report = (value: string, sentence: string) => indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-packet", obligationId: `hunt:packet:${TUCSON}`,
    missionPart: null, finding: { subjectId: TUCSON, field: "OFF-04", value, exactQuote: sentence, sourceUrl: COUNCIL, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
  await report("Selina Barajas", "Ward 5 Council Member Selina Barajas");
  await report("Richard Fimbres", "Ward 5 Council Member Richard Fimbres");
  await report("Lane Santa Cruz", "Ward 1 Council Member Lane Santa Cruz");
  await report("Tim Thomure", "Office of the City Manager - Tim Thomure");
  await report("Tim Kinney", "Mr. Tim Kinney");
  const input = { repos, facts, vault, fetch: async () => { throw new Error("held"); }, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 };
  const first = await publishBoxFindings(input);
  assert.deepEqual({ seats: first.seats, published: first.published, failuresByReason: first.failuresByReason },
    { seats: { flagged: 1 }, published: 3, failuresByReason: { SEAT_NOT_IN_QUOTE: 2 } }, JSON.stringify(first));
  const members = (await readFactRosters(facts.query, [body.id])).rosters[0]!.members.map(member => member.name).sort();
  assert.deepEqual(members, ["Lane Santa Cruz", "Richard Fimbres", "Selina Barajas", "Steve Kozachik"]);
  assert.deepEqual((await publishBoxFindings(input)).seats, { flagged: 2 }, "both members named for Ward 5 go to Sean");
  assert.deepEqual((await publishBoxFindings(input)).seats, { flagged: 0 }, "an open flag is raised once");
});

test("a finding's first artifact may be another page: select the cited page before checking its quote",async()=>{
 const {facts,repos,vault,hold}=await setup();
 const wrong=await hold(AGENDA_URL,'<h1>Agenda Committee</h1><p>A different board</p>',NOW);
 const right=await hold(TCCC_URL,B15,NOW);
 await indexReportedFinding(repos.boxFindings,{workItemId:'wi-hunt',attemptId:'at-hunt',missionPart:null,
 finding:{subjectId:TCCC,field:'officeholder.name',value:'Ned Beman',exactQuote:'Ned Beman Chairperson Ward 2',sourceUrl:TCCC_URL,artifactIds:[wrong,right],subjectHint:null,index:0}},NOW);
 const report=await publishBoxFindings({repos,facts,vault,fetch:async()=>{throw Error('The saved cited page is held.');},store:new MemoryRoutineDataStore(),clocks:factClocks(null),now:NOW,limit:10});
 assert.equal(report.published,1);assert.equal(report.refused,0);
});

test("a government with no governing board gets one; a phone or email with no person named goes on the office; a refused finding is looked at again when the slot map moves, however old", async () => {
  const { facts, repos, vault, hold } = await setup();
  const CLIFTON = "az:city:town-of-clifton", URL = "https://www.townofclifton.example.gov/clerk";
  assert.deepEqual(await facts.query("SELECT id FROM entity WHERE kind = 'body' AND parent_id = $1", [CLIFTON]), [], "the town starts with no board");
  const page = await hold(URL, "<html><body><h1>Clifton, AZ</h1><p>Town offices: (928) 865-4146. Email the clerk at clerk@cliftonaz.gov.</p><p>Mayor Pat Doe</p></body></html>", "2026-09-01T15:00:00.000Z");
  const OLD = "2026-01-01T00:00:00.000Z";
  let index = 0;
  const drop = (field: string, value: string, quote: string) => indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-clifton",
    missionPart: null, finding: { subjectId: CLIFTON, field, value, exactQuote: quote, sourceUrl: URL, artifactIds: [page], subjectHint: null, index: index++ } }, OLD);
  await drop("officeholder.phone", "(928) 865-4146", "Town offices: (928) 865-4146");
  await drop("office.email", "clerk@cliftonaz.gov", "Email the clerk at clerk@cliftonaz.gov");
  const fetch: ProbeFetch = async () => { throw new Error("the cited page is held inside its clock"); };
  const input = { repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 };
  const first = await publishBoxFindings(input);
  assert.equal(first.published, 2, JSON.stringify(first));
  const [board] = await facts.query("SELECT id FROM entity WHERE kind = 'body' AND parent_id = $1", [CLIFTON]);
  assert.equal(board!.id, `${CLIFTON}#governing`, "the board is named by its government");
  assert.deepEqual(await facts.query("SELECT field, value FROM fact WHERE entity_id = $1 AND status = 'live' ORDER BY field", [board!.id]),
    [{ field: "office_email", value: "clerk@cliftonaz.gov" }, { field: "office_phone", value: "(928) 865-4146" }]);

  const [refused] = await repos.boxFindings.list();
  await repos.boxFindings.compareAndSet(refused!.value.id, refused!.revision, { ...refused!.value, state: "refused", refusal: "PAGE_NOT_ABOUT_ENTITY", publicationId: null,
    waitingFor: undefined, attempts: [{ builder: "fact-publisher", token: "t", generation: 1, takenAt: OLD, expiresAt: OLD, outcome: "refused", endedAt: OLD, detail: "PAGE_NOT_ABOUT_ENTITY" }] }, NOW);
  const due = await repos.boxFindings.due({ slots: FINDING_SLOTS_VERSION, now: NOW, limit: 10 });
  assert.deepEqual(due.map(row => row.state), ["refused"], "a refusal from the older slot map is due again, with no age limit");
  assert.equal((await publishBoxFindings(input)).looked, 1);
  assert.equal((await publishBoxFindings(input)).looked, 0, "once looked at under this slot map, it is not looked at again");
});

test("two addresses that serve the same bytes in one pass are both saved", async () => {
  const repos = createMemoryRepositories(), vault = new MemoryEvidenceStore();
  const fetch: ProbeFetch = async () => ({ status: 200, headers: new Headers({ "content-type": "text/html" }), bytes: async () => new TextEncoder().encode("<html><body>Clifton, AZ</body></html>") });
  for (const url of ["https://www.cliftonaz.gov/board", "https://www.cliftonaz.gov/board/"]) {
    assert.ok("capture" in await fetchCapture({ url, repos, vault, fetch, now: NOW }), url);
  }
});

test("a board name with no board is added and named; a recorder's phone goes on a recorder office that is added", async () => {
  const { facts, repos, vault, hold } = await setup();
  const CLIFTON = "az:city:town-of-clifton", URL = "https://www.cliftonaz.gov/boards";
  const page = await hold(URL, "<html><body><h1>Clifton, AZ</h1><p>Board of Adjustment meets as needed.</p><p>Greenlee County Recorder: (928) 865-2632</p><p>Mayor Pat Doe (928) 865-4146</p></body></html>", "2026-09-01T15:00:00.000Z");
  let index = 0;
  const drop = (field: string, value: string, quote: string) => indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-clifton",
    missionPart: null, finding: { subjectId: CLIFTON, field, value, exactQuote: quote, sourceUrl: URL, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
  await drop("subordinateBody.name", "Board of Adjustment", "Board of Adjustment meets as needed.");
  await drop("recorder.phone", "(928) 865-2632", "Greenlee County Recorder: (928) 865-2632");
  await drop("officeholder.phone", "(928) 865-4146", "Mayor Pat Doe (928) 865-4146");
  const fetch: ProbeFetch = async () => { throw new Error("the cited page is held inside its clock"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 });
  assert.equal(report.published, 3, JSON.stringify(report));
  assert.deepEqual(await facts.query(`SELECT e.id, e.name, f.field, f.value_text FROM fact f JOIN entity e ON e.id = f.entity_id
    WHERE e.parent_id = $1 AND f.status = 'live' ORDER BY e.id, f.field`, [CLIFTON]), [
    { id: `${CLIFTON}#body:board-of-adjustment`, name: "Board of Adjustment", field: "name", value_text: "Board of Adjustment" },
    { id: `${CLIFTON}#governing`, name: "Clifton town governing", field: "office_phone", value_text: "(928) 865-4146" },
    { id: `${CLIFTON}#office-recorder`, name: "Greenlee County Recorder", field: "name", value_text: "Greenlee County Recorder" },
    { id: `${CLIFTON}#office-recorder`, name: "Greenlee County Recorder", field: "office_phone", value_text: "(928) 865-2632" }]);
  assert.equal((await facts.query("SELECT 1 FROM entity_place WHERE entity_id = $1", [`${CLIFTON}#body:board-of-adjustment`])).length, 1);
});

test("a dependent school system the fact store lacks is added on its district's place, with its board", async () => {
  const { facts } = await setup();
  const place = "ocd-division/country:us/state:az/school_district:fort_example_school_district";
  await ensureEntity(facts.query, { id: place, kind: "place", name: "Fort Example School District", state: "AZ", parentId: "ocd-division/country:us/state:az" });
  await ensureGoverningBody(facts.query, "az:depschool:fort-example-school-district#board");
  assert.deepEqual(await facts.query("SELECT id, kind, parent_id FROM entity WHERE id = 'az:depschool:fort-example-school-district'"), [{ id: "az:depschool:fort-example-school-district", kind: "government", parent_id: place }]);
  assert.deepEqual(await facts.query("SELECT id, parent_id FROM entity WHERE kind = 'body' AND parent_id = 'az:depschool:fort-example-school-district'"), [{ id: "az:depschool:fort-example-school-district#board", parent_id: "az:depschool:fort-example-school-district" }]);
  await ensureGoverningBody(facts.query, "az:depschool:not-a-held-district#board");
  assert.deepEqual(await facts.query("SELECT id FROM entity WHERE id = 'az:depschool:not-a-held-district'"), [], "no place, no government");
});

test("a state's boards are added under the state even though the state has no governing board", async () => {
  const { facts, repos, vault, hold } = await setup();
  const STATE = "az:state:arizona", URL = "https://boards.az.gov/list";
  const page = await hold(URL, "<html><body><h1>Arizona Boards and Commissions</h1><ul><li>Accountancy, State Board of</li></ul></body></html>", "2026-09-01T15:00:00.000Z");
  await indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-state", missionPart: null, finding: { subjectId: STATE, field: "bodyName",
    value: "Accountancy, State Board of", exactQuote: "Accountancy, State Board of", sourceUrl: URL, artifactIds: [page], subjectHint: null, index: 0 } }, NOW);
  const fetch: ProbeFetch = async () => { throw new Error("held"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 10 });
  assert.equal(report.published, 1, JSON.stringify(report));
  assert.deepEqual(await facts.query("SELECT e.id, f.value_text FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.parent_id = $1 AND f.field = 'name' AND f.status = 'live'", [STATE]),
    [{ id: `${STATE}#body:accountancy-state-board-of`, value_text: "Accountancy, State Board of" }]);
});

test("an office is named from the saved page when the finding's own sentence is only its number", async () => {
  const { facts, repos, vault, hold } = await setup();
  const CLIFTON = "az:city:town-of-clifton", URL = "https://www.cliftonaz.gov/contact";
  const page = await hold(URL, "<html><body><h1>Clifton, AZ</h1><h2>Greenlee County Recorder</h2><p>Voter registration</p><p>(928) 865-2632</p></body></html>", "2026-09-01T15:00:00.000Z");
  await indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-clifton", missionPart: null, finding: { subjectId: CLIFTON, field: "recorder.phone",
    value: "(928) 865-2632", exactQuote: "(928) 865-2632", sourceUrl: URL, artifactIds: [page], subjectHint: null, index: 0 } }, NOW);
  const fetch: ProbeFetch = async () => { throw new Error("held"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 10 });
  assert.equal(report.published, 1, JSON.stringify(report));
  assert.equal(officeNameOn("Contact Duderstadt Graham County Elections at 928-792-5037", "", "928-792-5037")?.name, "Graham County Elections");
  assert.equal(officeNameOn("Scotty Davis Food Service Manager 520-384-8665", "", "520-384-8665")?.name, "Food Service");
  assert.deepEqual(await facts.query("SELECT e.id, e.name, f.field, f.value_text FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.id = $1 AND f.status = 'live' ORDER BY f.field", [`${CLIFTON}#office-recorder`]),
    [{ id: `${CLIFTON}#office-recorder`, name: "Greenlee County Recorder", field: "name", value_text: "Greenlee County Recorder" },
      { id: `${CLIFTON}#office-recorder`, name: "Greenlee County Recorder", field: "office_phone", value_text: "(928) 865-2632" }]);
});

test("a finding about a city's #governing council makes one council and is built; a finding about a #body: committee does not land on it", async () => {
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const HUNTSVILLE = "al:city:city-of-huntsville", URL = "https://www.huntsvilleal.gov/contact";
  const page = await hold(URL, "<html><body><h1>Huntsville, AL</h1><p>City offices: (256) 427-5000.</p></body></html>", "2026-09-01T15:00:00.000Z");
  const drop = (subjectId: string, index: number) => indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-huntsville",
    missionPart: null, finding: { subjectId, field: "officeholder.phone", value: "(256) 427-5000", exactQuote: "City offices: (256) 427-5000", sourceUrl: URL, artifactIds: [page], subjectHint: null, index } }, NOW);
  const fetch: ProbeFetch = async () => { throw new Error("the cited page is held inside its clock"); };
  const input = { repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 };
  const states = async () => (await repos.boxFindings.list()).map(row => row.value.state);
  const councils = () => facts.query("SELECT id FROM entity WHERE kind = 'body' AND parent_id = $1", [HUNTSVILLE]);

  await drop(`${HUNTSVILLE}#body:planning-commission`, 0);
  const committee = await publishBoxFindings(input);
  assert.equal(committee.published, 0, JSON.stringify(committee));
  assert.deepEqual(await states(), ["waiting"], "a committee's finding is not built on the council");
  assert.deepEqual(await facts.query("SELECT 1 FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.parent_id = $1 AND f.status = 'live'", [HUNTSVILLE]), [], "no fact lands on the council");

  await drop(`${HUNTSVILLE}#governing`, 1);
  const governing = await publishBoxFindings(input);
  assert.equal(governing.published, 1, JSON.stringify(governing));
  assert.deepEqual(await councils(), [{ id: `${HUNTSVILLE}#governing` }], "one council, named by its government");
  assert.deepEqual((await states()).sort(), ["built", "waiting"]);
  assert.deepEqual(await facts.query("SELECT e.id, f.field, f.value FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.parent_id = $1 AND f.status = 'live'", [HUNTSVILLE]),
    [{ id: `${HUNTSVILLE}#governing`, field: "office_phone", value: "(256) 427-5000" }]);
});

test("the slot version is a hash of the sorting and publishing code, so any edit to that code makes parked findings look again", () => {
  assert.match(FINDING_SLOTS_VERSION, /^[0-9a-f]{16}$/);
  assert.equal(slotsVersionOf(["a", "b"]), slotsVersionOf(["a", "b"]));
  assert.notEqual(slotsVersionOf(["a", "b"]), slotsVersionOf(["a", "b "]));
  assert.notEqual(slotsVersionOf(["a", "b"]), slotsVersionOf(["b", "a"]));
});

test("a fact two pages said is one row that builds from whichever page holds it, in any state", async () => {
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const HUNTSVILLE = "al:city:city-of-huntsville", GOOD = "https://www.huntsvilleal.gov/contact", MOVED = "https://www.huntsvilleal.gov/old-contact";
  const good = await hold(GOOD, "<html><body><h1>Huntsville, AL</h1><p>City offices: (256) 427-5000.</p></body></html>", "2026-09-01T15:00:00.000Z");
  const moved = await hold(MOVED, "<html><body><h1>Huntsville, AL</h1><p>This page has moved.</p></body></html>", "2026-09-01T15:00:00.000Z");
  const drop = (attemptId: string, sourceUrl: string, artifactId: string, exactQuote: string) => indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId,
    missionPart: null, finding: { subjectId: `${HUNTSVILLE}#governing`, field: "officeholder.phone", value: "(256) 427-5000", exactQuote, sourceUrl, artifactIds: [artifactId], subjectHint: null, index: 0 } }, NOW);
  await drop("at-moved", MOVED, moved, "City offices: (256) 427-5000");
  await drop("at-good", GOOD, good, "City offices: (256) 427-5000");
  const rows = await repos.boxFindings.list();
  assert.equal(rows.length, 1, "one row for the subject, field and value");
  assert.equal(rows[0]!.value.origins.length, 2, "and both pages are on it");
  const fetch: ProbeFetch = async () => { throw new Error("both pages are held inside their clock"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 });
  assert.equal(report.published, 1, JSON.stringify(report));
  assert.equal(report.refused, 0, "the page that moved does not refuse a fact the other page holds");
  assert.deepEqual((await repos.boxFindings.list()).map(row => row.value.state), ["built"]);
  assert.deepEqual(await facts.query("SELECT f.field, f.value FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.parent_id = $1 AND f.status = 'live'", [HUNTSVILLE]),
    [{ field: "office_phone", value: "(256) 427-5000" }]);
});

test("every kind of government gets one board named by its government id: a city, a county, a special district, and a school district named by its NCES id", async () => {
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const cases = [
    { subject: "al:city:city-of-huntsville#governing", government: "al:city:city-of-huntsville", page: "https://www.huntsvilleal.gov/contact", phone: "(256) 427-5000", name: "City of Huntsville, AL" },
    { subject: "al:county:county-of-madison#governing", government: "al:county:county-of-madison", page: "https://www.madisoncountyal.gov/contact", phone: "(256) 222-1000", name: "Madison County, AL" },
    { subject: "al:special:community-west-fire-and-rescue-district#governing", government: "al:special:community-west-fire-and-rescue-district", page: "https://www.communitywestfire.gov/contact", phone: "(205) 555-0142", name: "Community West Fire and Rescue District, AL" },
    { subject: "government:US-AL:nces:0101800#board", government: "al:school:huntsville-city-school-district", page: "https://www.hsv.k12.al.gov/contact", phone: "(256) 428-6800", name: "Huntsville City School District, AL" },
  ];
  let index = 0;
  for (const one of cases) {
    const page = await hold(one.page, `<html><body><h1>${one.name}</h1><p>Main office: ${one.phone}.</p></body></html>`, "2026-09-01T15:00:00.000Z");
    await indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: `at-${index}`, missionPart: null, finding: { subjectId: one.subject, field: "officeholder.phone",
      value: one.phone, exactQuote: `Main office: ${one.phone}`, sourceUrl: one.page, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
  }
  const fetch: ProbeFetch = async () => { throw new Error("every page is held inside its clock"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 });
  assert.equal(report.published, 4, JSON.stringify(report));
  for (const one of cases) {
    const tail = one.subject.slice(one.subject.indexOf("#"));
    assert.deepEqual(await facts.query(`SELECT e.id, f.field, f.value FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.parent_id = $1 AND f.status = 'live'`, [one.government]),
      [{ id: `${one.government}${tail}`, field: "office_phone", value: one.phone }], one.subject);
  }
});

test("a subject is looked up once in a pass, however many findings are about it", async () => {
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const HUNTSVILLE = "al:city:city-of-huntsville", URL = "https://www.huntsvilleal.gov/contact";
  const page = await hold(URL, "<html><body><h1>Huntsville, AL</h1><p>City offices: (256) 427-5000. Clerk: clerk@huntsvilleal.gov</p></body></html>", "2026-09-01T15:00:00.000Z");
  const drop = (field: string, value: string, index: number) => indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-huntsville", missionPart: null,
    finding: { subjectId: `${HUNTSVILLE}#governing`, field, value, exactQuote: `City offices: (256) 427-5000. Clerk: clerk@huntsvilleal.gov`, sourceUrl: URL, artifactIds: [page], subjectHint: null, index } }, NOW);
  await drop("officeholder.phone", "(256) 427-5000", 0);
  await drop("office.email", "clerk@huntsvilleal.gov", 1);
  let boardLookups = 0;
  const counted = { ...facts, query: (text: string, params?: unknown[]) => { if (text.includes("ORDER BY parent_id = $1 DESC")) boardLookups++; return facts.query(text, params); } };
  const fetch: ProbeFetch = async () => { throw new Error("held"); };
  const report = await publishBoxFindings({ repos, facts: counted as typeof facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 });
  assert.equal(report.published, 2, JSON.stringify(report));
  assert.equal(boardLookups, 1, "one lookup for the subject, then the board is remembered");
});

test("a committee's name on a #body: subject makes the committee under its own government, in any kind of government, before the findings about it are read", async () => {
  assert.deepEqual(slotFor("GOV-02", "Planning Commission", null, "Planning Commission", "", "al:city:city-of-huntsville#body:planning-commission"), { class: "bodies", slot: "body_name" });
  assert.deepEqual(slotFor("GOV-02", "City Council", null, "City Council", "", "al:city:city-of-huntsville#governing"), { class: "body links", slot: "name" });
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const cases = [
    { government: "al:city:city-of-huntsville", subject: "al:city:city-of-huntsville#body:planning-commission", name: "Planning Commission", page: "https://www.huntsvilleal.gov/planning", place: "City of Huntsville, AL", phone: "(256) 427-5100" },
    { government: "al:county:county-of-madison", subject: "al:county:county-of-madison#body:board-of-equalization", name: "Board of Equalization", page: "https://www.madisoncountyal.gov/boe", place: "Madison County, AL", phone: "(256) 532-3300" },
    { government: "al:school:huntsville-city-school-district", subject: "government:US-AL:nces:0101800#body:policy-committee", name: "Policy Committee", page: "https://www.hsv.k12.al.gov/policy", place: "Huntsville City School District, AL", phone: "(256) 428-6810" },
  ];
  let index = 0;
  for (const one of cases) {
    const page = await hold(one.page, `<html><body><h1>${one.place}</h1><h2>${one.name}</h2><p>Office: ${one.phone}.</p></body></html>`, "2026-09-01T15:00:00.000Z");
    const drop = (field: string, value: string, quote: string) => indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: `at-${index}`, missionPart: null,
      finding: { subjectId: one.subject, field, value, exactQuote: quote, sourceUrl: one.page, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
    // The committee's phone is read first on purpose: it waits for the committee, which its name makes in the same pass.
    await drop("officeholder.phone", one.phone, `Office: ${one.phone}`);
    await drop("GOV-02", one.name, one.name);
  }
  const fetch: ProbeFetch = async () => { throw new Error("held"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 });
  assert.equal(report.published, 6, JSON.stringify(report));
  for (const one of cases) {
    const id = `${one.government}${one.subject.slice(one.subject.indexOf("#"))}`;
    assert.deepEqual(await facts.query("SELECT id, name, parent_id FROM entity WHERE kind = 'body' AND parent_id = $1", [one.government]), [{ id, name: one.name, parent_id: one.government }], "one committee, hung on its own government");
    assert.deepEqual((await facts.query("SELECT field, value_text FROM fact WHERE entity_id = $1 AND status = 'live' ORDER BY field", [id])).map(row => [row.field, row.value_text]),
      [["name", one.name], ["office_phone", one.phone]]);
  }
});

test("a supervisor of a kind of work is staff and never seated; a supervisor who sits on the board is", () => {
  const governing = "al:county:county-of-madison#governing", board = "az:school:example-school-district#board";
  for (const words of ["Maintenance Supervisor Dan Fox", "Road Supervisor Pat Lee, (256) 555-0100", "County Road Supervisor", "Supervisor of Roads Pat Lee", "Public Works Supervisor Ann Hill", "Water Supervisor", "Transportation Supervisor, Example Schools"]) {
    assert.equal(seatIn(words, governing), null, words);
    assert.equal(seatIn(words, board), null, words);
  }
  assert.deepEqual(seatIn("Supervisor Rex Scott, District 1", governing), { ward: "1" });
  // A seat held outranks the other office its holder fills; staff in a district are still staff.
  assert.notEqual(seatIn("Chrissie Greene\nSeat E - Secretary/Treasurer\nTerm Expires: 10/3/2027", board), null);
  assert.notEqual(seatIn("Sarah Berry\nMember\nsarah.berry@foukepanthers.org", board), null, "a school board's plain Member is a member");
  assert.equal(seatIn("Superintendent, District 5 Schools", board), null);
  assert.equal(seatIn("Pat Lee\nCity Clerk", governing), null);
  assert.notEqual(seatIn("Thor Christianson\n907-738-2491\nassemblychristianson@cityofsitka.org\nTerm:\nOctober 2019 - October 2022", governing), null, "a term served is a seat held");
  assert.notEqual(seatIn("Aaron Hansen\nTerm Expires 3/28\nE-Mail", governing), null);
  assert.equal(seatIn("Pat Lee\nCity Clerk\nTerm Expires 3/28", governing), null, "but a staff title is still staff");
  assert.notEqual(seatIn("David Gomez\nChairman\ndgomez@greenlee.az.gov", governing), null, "a county board's chairman");
  assert.equal(seatIn("Pat Lee, Chair, Parks Committee", governing), null, "a committee's chair is not a seat on the council");
  assert.deepEqual(seatIn("Town Supervisor", "az:city:town-of-example#governing"), { ward: null });
  assert.deepEqual(seatIn("Supervisor Rex Scott\nChair, Board of Supervisors", governing), { ward: null });
  assert.notEqual(seatIn("Supervisor Dana Cruz, District 4", governing), null);
});

test("a label, a notice or a bare link the Box published is flagged for Sean, never taken down by the system; a paragraph is cut to its schedule; a real schedule, comment rule and member stay unflagged", async () => {
  const { facts, repos, vault } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const body = async (id: string, government: string) => { await ensureEntity(facts.query, { id, kind: "body", name: "City Council", state: "AL", parentId: government }); return id; };
  const BREWTON = await body("ocd-division/country:us/state:al/place:brewton#governing", "al:city:city-of-brewton");
  const CHATOM = await body("ocd-division/country:us/state:al/place:chatom#governing", "al:city:town-of-chatom");
  const PRICHARD = await body("ocd-division/country:us/state:al/place:prichard#governing", "al:city:city-of-prichard");
  const SAFFORD = await body("ocd-division/country:us/state:al/place:safford#governing", "al:city:city-of-safford");
  const [copy] = await facts.query(`INSERT INTO source_copy (url, final_url, fetched_at, sha256, blob_key) VALUES ('http://x', 'http://x', now(), $1, 'k') RETURNING id`, ["0".repeat(64)]);
  const put = (entity: string, field: string, valueText: string, quote = valueText, value: unknown = valueText) => facts.query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote, checked_at, live_at, produced_by)
    VALUES ($1, $2, $3::jsonb, $4, 'live', 'OFFICIAL', $5, $6, now(), now(), 'box')`, [entity, field, JSON.stringify(value), valueText, copy!.id, quote]);
  // As they stand on the live site today.
  await put(BREWTON, "meeting_cadence", "The City Council is the financial arm of the City, with the Mayor as CEO. Council members have no authority as individuals; their authority is asserted during the Regular Meetings held each 2nd and 4th Monday of each month at 6:00 p.m. in the Council Chambers.");
  await put(BREWTON, "agenda_url", "http://www.cityofbrewton.org/Living-in-Brewton/Calendar");
  await put(CHATOM, "comment:detail", "There are three primary purposes for this notice.  First, people who may be affected by activities in a 100 Year Floodplain and those who have an interest in the floodplain are given a chance to comment.");
  await put(CHATOM, "comment:period", "There are three primary purposes for this notice.  First, people who may be affected by activities in a 100 Year Floodplain");
  await put(PRICHARD, "agenda_url", "http://thecityofprichard.org/request-a-business-meeting-with-the-mayor/");
  await put(PRICHARD, "member:ocd-person/junk", "AJ Cooper Municipal Complex", "AJ Cooper Municipal Complex", { name: "AJ Cooper Municipal Complex" });
  await put(SAFFORD, "comment:period", "Each speaker is given three minutes to speak.");
  // What should stay.
  await put(PRICHARD, "meeting_cadence", "first and third Tuesdays at 6 p.m.");
  await put(PRICHARD, "comment:detail", "Residents may address the Council during public comment at each regular meeting and are limited to three minutes.");
  await put(PRICHARD, "comment:period", "YES");
  await put(PRICHARD, "member:ocd-person/annie", "Annie Williams", "Annie Williams\nDistrict 1", { name: "Annie Williams" });
  const fetch: ProbeFetch = async () => { throw new Error("nothing to read"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 10 });
  // Four labels are flagged by the label pass; the member who is a place is flagged by the seat pass, which got to it first: five facts for Sean, none taken down.
  assert.deepEqual({ seats: report.seats, labels: report.labels }, { seats: { flagged: 1 }, labels: { flagged: 4, moved: 1, cut: 1, renamed: 0 } }, JSON.stringify(report));
  assert.deepEqual((await facts.query("SELECT f.field, f.status FROM owner_flag o JOIN fact f ON f.id = o.fact_id WHERE o.resolved IS NULL ORDER BY f.entity_id, f.field")).map(row => `${row.field}=${row.status}`),
    ["agenda_url=live", "comment:detail=live", "comment:period=live", "agenda_url=live", "member:ocd-person/junk=live"]);
  const state = async (entity: string) => (await facts.query("SELECT f.field, f.status, (SELECT o.reason FROM owner_flag o WHERE o.fact_id = f.id AND o.resolved IS NULL) AS flag FROM fact f WHERE f.entity_id = $1 ORDER BY f.field", [entity])).map(row => `${row.field}=${row.status}${row.flag ? `:flagged ${row.flag}` : ""}`);
  assert.deepEqual(await state(BREWTON), ["agenda_url=live:flagged BARE_LINK", "meeting_cadence=live"]);
  assert.deepEqual(await facts.query("SELECT value_text FROM fact WHERE entity_id = $1 AND field = 'meeting_cadence'", [BREWTON]), [{ value_text: "each 2nd and 4th Monday of each month at 6:00 p.m." }], "a paragraph is cut to the schedule it states");
  assert.deepEqual(await facts.query("SELECT field, value_text FROM fact WHERE entity_id = $1 AND status = 'live' ORDER BY field", [SAFFORD]),
    [{ field: "comment:detail", value_text: "Each speaker is given three minutes to speak." }, { field: "comment:period", value_text: "YES" }], "a rule filed as the period moves to the rule, and the period reads yes");
  assert.deepEqual(await state(CHATOM), ["comment:detail=live:flagged NOT_A_COMMENT_RULE", "comment:period=live:flagged NOT_YES_OR_NO"]);
  assert.deepEqual(await state(PRICHARD), ["agenda_url=live:flagged BARE_LINK", "comment:detail=live", "comment:period=live", "meeting_cadence=live", "member:ocd-person/annie=live", "member:ocd-person/junk=live"]);
  assert.equal((await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 10 })).labels.flagged, 0, "a fact is read once, and a flag is raised once");
});

test("a school district the registration never paired with a government gets its board on its place, named by the NCES id the hunter used", async () => {
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  // Pelham City (NCES 0100194) is a school district place in the registration with no government attached.
  const PLACE = "ocd-division/country:us/state:al/school_district:pelham_city_school_district", URL = "https://www.pelhamcityschools.org/board";
  assert.deepEqual(await facts.query("SELECT 1 FROM entity WHERE kind = 'government' AND parent_id = $1", [PLACE]), []);
  const page = await hold(URL, "<html><body><h1>Pelham City Schools, Alabama</h1><p>Board office: (205) 620-6400.</p></body></html>", "2026-09-01T15:00:00.000Z");
  await indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: "at-pelham", missionPart: null, finding: { subjectId: "government:US-AL:nces:0100194#board",
    field: "officeholder.phone", value: "(205) 620-6400", exactQuote: "Board office: (205) 620-6400", sourceUrl: URL, artifactIds: [page], subjectHint: null, index: 0 } }, NOW);
  const fetch: ProbeFetch = async () => { throw new Error("held"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 10 });
  assert.equal(report.published, 1, JSON.stringify(report));
  assert.deepEqual(await facts.query("SELECT e.id, e.parent_id, f.field, f.value_text FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.kind = 'body' AND f.status = 'live'"),
    [{ id: `${PLACE}#board`, parent_id: PLACE, field: "office_phone", value_text: "(205) 620-6400" }]);
});

// Values as they stand live in Arizona, Alaska and Alabama today.
test("what is live today: labels, fragments, bare links and junk names come down or are cut; real schedules, rules and members stay", () => {
  const stays = (field: string, value: string, quote = value, kind = "body") => assert.equal(remedyFor(field, kind, value, quote, null), null, `${field}: ${value}`);
  const goes = (field: string, value: string, reason: string, quote = value) => assert.deepEqual(remedyFor(field, "body", value, quote, null), { pull: reason }, `${field}: ${value}`);
  for (const value of ["Request to speak at a City Council meeting - deadline is 10 days before the Monday meeting", "Request to Speak form before the beginning of the board meeting",
    "Time is allotted during a Call to the Public for members of the public to address the town council regarding any issue within the jurisdiction of the Town Council",
    "NOTE: WORKSHOP MEETINGS ARE FOR COUNCIL DISCUSSIONS AND DELIBERATIONS AND DO NOT OFFER OPPORTUNITIES FOR PUBLIC COMMENT AND/OR INTERACTION."]) stays("comment:detail", value);
  for (const value of ["Accreditation Public Comment Portal", "Call to the Public", "agenda and non-agenda items", "beginning of each meeting", "commentary only", "open call to the public", "brought to any public meeting",
    "City of Mobile Community Development Block Grant - Disaster Recovery Local Recovery Plan Public Comment Period pdf",
    "There are three primary purposes for this notice.  First, people who may be affected by activities in a 100 Year Floodplain are given a chance to comment."]) goes("comment:detail", value, "NOT_A_COMMENT_RULE");
  for (const value of ["YES", "NO"]) stays("comment:period", value);
  for (const value of ["Each speaker is given three minutes to speak.", "Comments will be limited to three minutes.", "Visitors are welcome to speak at board meetings during the Call to the Public."])
    assert.deepEqual(remedyFor("comment:period", "body", value, value, null), { move: "comment:detail" }, value);
  for (const value of ["4. Call to the Public", "Accreditation Public Comment Portal"]) goes("comment:period", value, "NOT_YES_OR_NO");
  for (const value of ["second Tuesday at 6:00 p.m.", "2nd & 4th Mondays, 6:00 p.m.", "first Wednesday of every month at 5:30 pm", "TOWN COUNCIL MEETS EVERY SECOND TUESDAY OF THE MONTH AT 7:00PM",
    "Meets 1st and 3rd Monday of every month at 6 p.m.", "last Tuesday of each month at 5:30 PM"]) stays("meeting_cadence", value, "quote");
  goes("meeting_cadence", "6:00 p.m.", "NOT_A_SCHEDULE");
  assert.deepEqual(remedyFor("meeting_cadence", "body", "The City Council meets on the 2nd and 4th Tuesday of each month. Pre-Council begins at 5:00 pm and Council at 5:30 pm in the conference room of City Hall, 100 Main Street, for all regular sessions.", "q", null),
    { value: "2nd and 4th Tuesday of each month" });
  goes("meeting_cadence", "The objectives of the Planning Commission are to assist the Mayor and Town Council in the preparation, maintenance and implementation of plans, regulations and ordinances for the town and its growth over many years.", "NOT_A_SCHEDULE");
  for (const url of ["https://amc.matsuk12.us/calendar.html", "http://www.cityofbrewton.org/Living-in-Brewton/Calendar", "https://rental.indianspringsvillage.org/events/"]) goes("agenda_url", url, "BARE_LINK");
  assert.equal(remedyFor("agenda_url", "meeting", "https://example.gov/agenda.pdf", "https://example.gov/agenda.pdf", null), null, "a sitting's own agenda document is that meeting's record");
  const member = (name: string) => remedyFor("member:ocd-person/x", "body", name, name, name);
  for (const name of ["Priscilla Alderete - President", "Anicleto (Nick) Maldonado", "DEANNA M. DAY, M.Ed.", "Mr. Mario Ramos, Sr", "Vaché Brooks", "Frank M. Nalty JR.", "Ms. Cynthia Butterworth"]) assert.equal(member(name), null, name);
  assert.deepEqual(member("Election Announcement"), { pull: "NOT_A_PERSON" });
});

test("a name a page gives its own governing board, with the place in front, is that board and not a second body", async () => {
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const CHATOM = "al:city:town-of-chatom", PRICHARD = "al:city:city-of-prichard";
  const names = [[CHATOM, "Chatom Town Council", "http://www.chatom.org/dept/", "Town of Chatom, Alabama"], [PRICHARD, "Prichard City Council", "http://thecityofprichard.org/government/", "City of Prichard, Alabama"],
    [PRICHARD, "Finance Committee", "http://thecityofprichard.org/finance/", "City of Prichard, Alabama"]] as const;
  let index = 0;
  for (const [government, name, url, place] of names) {
    const page = await hold(url, `<html><body><h1>${place}</h1><h2>${name}</h2></body></html>`, "2026-09-01T15:00:00.000Z");
    await indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: `at-${index}`, missionPart: null, finding: { subjectId: `${government}#body:${name.toLowerCase().replace(/\W+/g, "-")}`,
      field: "GOV-02", value: name, exactQuote: name, sourceUrl: url, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
  }
  const fetch: ProbeFetch = async () => { throw new Error("held"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 10 });
  assert.equal(report.published, 3, JSON.stringify(report));
  assert.deepEqual(await facts.query("SELECT e.id, f.value_text FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.kind = 'body' AND f.field = 'name' AND f.status = 'live' ORDER BY e.id"), [
    { id: `${CHATOM}#governing`, value_text: "Chatom Town Council" }, { id: `${PRICHARD}#body:finance-committee`, value_text: "Finance Committee" },
    { id: `${PRICHARD}#governing`, value_text: "Prichard City Council" }].sort((a, b) => a.id.localeCompare(b.id)));
});

test("a name a page dresses the board in, or a menu item taken for a person, never makes a second board or a member", async () => {
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const SCHOOLS = "al:school:huntsville-city-school-district", URL = "https://www.hsv.k12.al.gov/board";
  const page = await hold(URL, `<html><body><h1>Huntsville City School District, Alabama</h1><h2>Our Governing Board</h2><p>Brian Brooks, Board Member, District 3</p><p>Date Elected</p><p>Board Member</p></body></html>`, "2026-09-01T15:00:00.000Z");
  let index = 0;
  const drop = (subjectId: string, field: string, value: string, quote: string) => indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: `at-${index}`, missionPart: null,
    finding: { subjectId, field, value, exactQuote: quote, sourceUrl: URL, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
  await drop("government:US-AL:nces:0101800#body:our-governing-board", "OFF-04", "Brian Brooks", "Brian Brooks, Board Member, District 3");
  await drop("government:US-AL:nces:0101800#body:our-governing-board", "GOV-02", "Our Governing Board", "Our Governing Board");
  await drop(`${SCHOOLS}#board`, "OFF-04", "Date Elected", "Date Elected");
  const fetch: ProbeFetch = async () => { throw new Error("held"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 10 });
  assert.equal(report.published, 2, JSON.stringify(report));
  assert.deepEqual(report.failuresByReason, { NOT_A_PERSON: 1 });
  assert.deepEqual(await facts.query("SELECT value_text FROM fact WHERE entity_id = $1 AND field = 'name' AND status = 'live'", [`${SCHOOLS}#board`]), [{ value_text: "Governing Board" }], "named as the page names it, without what the page hangs on it");
  assert.deepEqual(await facts.query("SELECT id FROM entity WHERE kind = 'body' AND parent_id = $1", [SCHOOLS]), [{ id: `${SCHOOLS}#board` }], "one board for the district");
  assert.deepEqual((await facts.query("SELECT f.field, f.value->>'name' AS name, f.value_text FROM fact f WHERE f.entity_id = $1 AND f.status = 'live' ORDER BY f.field", [`${SCHOOLS}#board`])).map(row => [row.field, row.name ?? row.value_text]),
    [["member:" + (await facts.query("SELECT substr(field, 8) AS id FROM fact WHERE entity_id = $1 AND field LIKE 'member:%'", [`${SCHOOLS}#board`]))[0]!.id, "Brian Brooks"], ["name", "Governing Board"]]);
});

// Names as production Box rows carry them today, in four states.
const COUNCILS: readonly (readonly [government: string, name: string, state: string])[] = [
  ["al:county:county-of-autauga", "Autauga County Commission", "Alabama"],
  ["al:county:county-of-dale", "Dale County Commission", "Alabama"],
  ["al:city:city-of-fayette", "Mayor and Council", "Alabama"],
  ["al:city:city-of-decatur", "Mayor and City Council", "Alabama"],
  ["al:city:city-of-weaver", "Weaver City Council", "Alabama"],
  ["ak:city:city-and-borough-of-sitka", "Assembly", "Alaska"],
  ["ak:city:city-and-borough-of-juneau", "Juneau Assembly", "Alaska"],
  ["ak:county:borough-of-lake-and-peninsula", "Borough Assembly", "Alaska"],
  ["ar:city:city-of-fort-smith", "The Fort Smith Board of Directors", "Arkansas"],
  ["al:city:city-of-daleville", "Board of Aldermen", "Alabama"],
  ["ar:school:bismarck-sch-dist", "Bismarck School District School Board", "Arkansas"],
  ["al:school:conecuh-county-school-district", "Conecuh County Board of Education", "Alabama"],
  ["al:county:county-of-lauderdale", "Board of County Commissioners", "Alabama"],
];

test("a governing board by any common name is the government's council: its facts land on it, and no second body is made", async () => {
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al", "ak", "ar"]);
  let index = 0;
  for (const [government, name, state] of COUNCILS) {
    const [row] = await facts.query("SELECT name FROM entity WHERE id = $1", [government]);
    assert.ok(row, government);
    const url = `https://www.${government.split(":")[2]!.replace(/-/g, "")}.gov/government`;
    const page = await hold(url, `<html><body><h1>${String(row!.name)}, ${state}</h1><h2>${name}</h2><p>Office: (205) 555-01${String(index).padStart(2, "0")}.</p></body></html>`, "2026-09-01T15:00:00.000Z");
    const subject = `${government}#body:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    const drop = (field: string, value: string, quote: string) => indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: `at-${index}`, missionPart: null,
      finding: { subjectId: subject, field, value, exactQuote: quote, sourceUrl: url, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
    const phone = `(205) 555-01${String(index).padStart(2, "0")}`;
    await drop("officeholder.phone", phone, `Office: ${phone}`);
    await drop("GOV-02", name, name);
  }
  const fetch: ProbeFetch = async () => { throw new Error("held"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 });
  assert.equal(report.published, COUNCILS.length * 2, JSON.stringify(report));
  for (const [government, name] of COUNCILS) {
    const bodies = await facts.query("SELECT id FROM entity WHERE kind = 'body' AND parent_id = $1 ORDER BY id", [government]);
    const board = /:(?:school|depschool):/.test(government) ? "#board" : "#governing";
    assert.deepEqual(bodies, [{ id: `${government}${board}` }], `${name}: one board, the government's own`);
    assert.equal((await facts.query("SELECT 1 FROM fact WHERE entity_id = $1 AND field = 'office_phone' AND status = 'live'", [`${government}${board}`])).length, 1, `${name}: its phone is on it`);
  }
});

test("a member's name is just the name: the title written after it is the seat, and honorifics and suffixes stay, in any kind of government", async () => {
  const { facts, repos, vault, hold } = await setup();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const cases = [
    { subject: "government:US-AL:nces:0101800#board", body: "al:school:huntsville-city-school-district#board", page: "https://www.hsv.k12.al.gov/board", name: "Huntsville City School District, AL",
      written: ["Priscilla Alderete - President", "Mr. Mario Ramos, Sr - Board Member"], names: ["Priscilla Alderete", "Mr. Mario Ramos, Sr"], offices: ["President", "Board Member"] },
    { subject: "al:city:city-of-brewton#governing", body: "al:city:city-of-brewton#governing", page: "https://www.cityofbrewton.org/council", name: "City of Brewton, AL",
      written: ["Jane Roe – Council President", "Cornelius \"CC\" Calhoun, Councilmember"], names: ["Jane Roe", "Cornelius \"CC\" Calhoun"], offices: ["Council President", "Councilmember"] },
    { subject: "al:county:county-of-autauga#governing", body: "al:county:county-of-autauga#governing", page: "https://www.autaugaal.gov/commission", name: "Autauga County, AL",
      written: ["Rusty Jacksland, Jr., Commissioner District 1", "Dr. Ann Lee, Ph.D. (Commissioner, District 2)"], names: ["Rusty Jacksland, Jr.", "Dr. Ann Lee, Ph.D."], offices: ["Commissioner District 1", "Commissioner, District 2"] },
  ];
  let index = 0;
  for (const one of cases) {
    const page = await hold(one.page, `<html><body><h1>${one.name}</h1><ul>${one.written.map(line => `<li>${line}</li>`).join("")}</ul></body></html>`, "2026-09-01T15:00:00.000Z");
    for (const line of one.written) await indexReportedFinding(repos.boxFindings, { workItemId: "wi-hunt", attemptId: `at-${index}`, missionPart: null, finding: { subjectId: one.subject, field: "OFF-04",
      value: line, exactQuote: line, sourceUrl: one.page, artifactIds: [page], subjectHint: null, index: index++ } }, NOW);
  }
  const fetch: ProbeFetch = async () => { throw new Error("every page is held inside its clock"); };
  const report = await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 100 });
  for (const one of cases) {
    const live = await facts.query("SELECT value->>'name' AS name, value->>'office' AS office FROM fact WHERE entity_id = $1 AND field LIKE 'member:%' AND status = 'live' ORDER BY id", [one.body]);
    const seats = (rows: readonly Record<string, unknown>[]) => rows.map(row => `${row.name} = ${row.office}`).sort();
    assert.deepEqual(seats(live), one.names.map((name, at) => `${name} = ${one.offices[at]}`).sort(), `${one.body}: ${JSON.stringify(report)}`);
    const people = await facts.query("SELECT e.name FROM entity e JOIN fact f ON f.field = 'member:' || e.id WHERE f.entity_id = $1 AND f.status = 'live' ORDER BY f.id", [one.body]);
    assert.deepEqual(people.map(row => row.name).sort(), [...one.names].sort(), "the person is named by the name alone");
  }
});

test("a member already live with a title inside the name is renamed to the name, and the title becomes the seat, once", async () => {
  const { facts, repos, vault } = await setup();
  await ensureFactEntities(facts, ROOT, ["az"]);
  const BOARD = "ocd-division/country:us/state:az/school_district:picacho_elementary_district#board";
  await ensureEntity(facts.query, { id: BOARD, kind: "body", name: "Board", state: "AZ", parentId: null });
  const PERSON = "ocd-person/cc5b7aaf-f54c-49a0-957c-8f566872bbca";
  await ensureEntity(facts.query, { id: PERSON, kind: "person", name: "Priscilla Alderete - President", state: "AZ", parentId: null });
  const [copy] = await facts.query(`INSERT INTO source_copy (url, final_url, fetched_at, sha256, blob_key) VALUES ('http://x', 'http://x', now(), $1, 'k') RETURNING id`, ["0".repeat(64)]);
  const put = (entity: string, field: string, value: unknown, valueText: string) => facts.query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote, checked_at, live_at, produced_by)
    VALUES ($1, $2, $3::jsonb, $4, 'live', 'OFFICIAL', $5, 'Priscilla Alderete - President', now(), now(), 'box')`, [entity, field, JSON.stringify(value), valueText, copy!.id]);
  await put(BOARD, `member:${PERSON}`, { name: "Priscilla Alderete - President", office: null }, "Priscilla Alderete - President");
  await put(PERSON, "name", "Priscilla Alderete - President", "Priscilla Alderete - President");
  const fetch: ProbeFetch = async () => { throw new Error("nothing to read"); };
  const run = () => publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null), now: NOW, limit: 10 });
  assert.equal((await run()).labels.renamed, 1);
  assert.deepEqual(await facts.query("SELECT value, value_text FROM fact WHERE entity_id = $1 AND field LIKE 'member:%' AND status = 'live'", [BOARD]), [{ value: { name: "Priscilla Alderete", office: "President" }, value_text: "Priscilla Alderete" }]);
  assert.deepEqual(await facts.query("SELECT name FROM entity WHERE id = $1", [PERSON]), [{ name: "Priscilla Alderete" }]);
  assert.deepEqual(await facts.query("SELECT field, value_text FROM fact WHERE entity_id = $1 AND status = 'live' ORDER BY field", [PERSON]),
    [{ field: "name", value_text: "Priscilla Alderete" }, { field: `office:${BOARD}`, value_text: "President" }]);
  assert.equal((await run()).labels.renamed, 0, "a member is read once");
});
