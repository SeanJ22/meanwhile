import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate } from "../lib/registry/runtime-data-plane.ts";
import { CENSUS_PLACEHOLDER_LABELS } from "../lib/registry/census-placeholders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { readHeldRoster } from "../lib/civic-data/worker-held-roster.ts";
import { heldBodySchedule, readHeldMeetingSchedule } from "../lib/civic-data/worker-held-meetings.ts";
import { publishBodyRoster, type WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { withFactRegistry } from "../lib/facts/registry-overlay.ts";
import { factDb } from "./helpers/fact-db.ts";
import { directoryMeetingHints } from "../lib/civic-data/worker-body-directory.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";

const ROOT = join(import.meta.dirname, "..");
const NOW = "2026-09-29T20:00:00.000Z";
const BODY = "ocd-division/country:us/state:az/place:benson#governing";
const ROSTER_URL = "https://www.bensonaz.gov/government/city-council/contact-the-mayor-council";
const MEETINGS_URL = "https://www.bensonaz.gov/government/city-council/council-meetings";
const shell = (title: string, main: string) => `<html><head><title>${title} | City of Benson, AZ</title></head><body>` +
  `<header><a href="/our-city/calendar">Calendar</a> <a href="/agendas">Agendas</a></header><main>${main}</main><footer>City of Benson</footer></body></html>`;
// The shape of a city's saved council-meetings page.
const MEETINGS = shell("Council Meetings", `<h1>Council Meetings</h1><p>The City Council generally meets four times a month for:</p>
  <p><strong>Work Sessions</strong> &ndash; Generally held on the second and fourth Tuesday of the month. Meetings are held in Council Chambers on the second floor of City Hall at 3:00 p.m.</p>
  <p><strong>Council Meetings</strong> &ndash; Regular City Council meetings are held on the second and fourth Thursday of the month. Meetings are held in Council Chambers on the second floor of City Hall at 5:00 p.m.</p>
  <p>Special Council Meetings are occasionally scheduled and are posted on the <a href="https://www.bensonaz.gov/our-city/calendar">Public Meeting calendar</a>.</p>
  <p>View agendas for <a href="https://www.bensonaz.gov/council-documents/-folder-155">work sessions</a> and <a href="https://www.bensonaz.gov/council-documents/-folder-121">council meetings</a>, as well as <a href="/council-documents/-folder-108">meeting minutes</a>.</p>`);
const member = (written: string, title: string) => `<tr><td>${written}</td><td>${title}</td><td>(520) 555-1000</td></tr>`;
const ROSTER = shell("Contact the Mayor & Council", `<h1>City Council</h1><table><tr><th>Name</th><th>Title</th><th>Phone</th></tr>` +
  member("McCaa II, Clea", "Mayor") + member("Flowers, Carolyn", "Vice Mayor") + `</table>`);

function capture(html: string, url: string, observedAt = "2026-09-28T22:06:04.940Z"): WorkerPublicationCapture {
  const contentHash = `sha256-${createHash("sha256").update(html).digest("hex")}`;
  return { evidence: { artifactId: `ar-${contentHash.slice(7, 31)}`, contentHash, text: html, acquiredByAttemptId: "at-scout", canonicalUrl: url,
    retrievedAt: observedAt, sourceId: new URL(url).hostname, methodRouteId: "scout:fetch_public" }, observedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
}
const artifact = (c: WorkerPublicationCapture) => ({ artifactId: c.evidence.artifactId, workItemId: "wi-any-job", routeTaskId: null, attemptId: "at-scout", tier: "RAW",
  contentHash: c.evidence.contentHash, byteLength: c.evidence.text.length, contentType: "text/html; charset=utf-8", canonicalUrl: c.evidence.canonicalUrl,
  partial: false, recordedAt: c.observedAt }) as ArtifactRecord;

async function fixtureStore() {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  const imported = (await readRegistryRuntimePrior(store, NOW))!;
  const divisions = imported.payload.registry.divisions.filter(row => CENSUS_PLACEHOLDER_LABELS[row.label]).map(row => ({ ...row, label: CENSUS_PLACEHOLDER_LABELS[row.label] }));
  const corrected = registryRuntimeCandidate({ contractId: "registry-runtime-bindings", version: "fixture-census-correction", sourceThrough: NOW,
    sourceReceipt: { contractVersion: 1, reviewedAt: NOW, reviewedBy: "recorded-fixture-control", sources: [...new Set(divisions.map(row => row.provenance!.sourceUrl!))].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "U.S. Census Bureau", sourceClass: "OFFICIAL_PUBLISHER" as const, retrievedAt: NOW, httpStatus: 200, rawHash: createHash("sha256").update(JSON.stringify(divisions)).digest("hex"), reviewedEvidence: "Offline fixture: Census LEA 99997 means no school district." })) },
    payload: { ...imported.payload, registry: { ...imported.payload.registry, divisions, bodies: [] }, statewideExecutives: [], officialCandidacies: { ...imported.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior: imported });
  const outcome = await processRegisteredManualCandidate(store, "registry-runtime-bindings", corrected, NOW, imported.versionId);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? "Census correction was not promoted");
  return store;
}

test("plain code reads a saved meeting page's regular schedule in its own words, with its agendas and calendar links", () => {
  const read = readHeldMeetingSchedule(MEETINGS, MEETINGS_URL)!;
  assert.equal(read.cadence, "Work Sessions – Generally held on the second and fourth Tuesday of the month. Meetings are held in Council Chambers on the second floor of City Hall at 3:00 p.m. " +
    "Council Meetings – Regular City Council meetings are held on the second and fourth Thursday of the month. Meetings are held in Council Chambers on the second floor of City Hall at 5:00 p.m.");
  assert.equal(read.agendaUrl, "https://www.bensonaz.gov/council-documents/-folder-121", "the council meetings' agendas, never the minutes or the site chrome");
  assert.equal(read.calendarUrl, "https://www.bensonaz.gov/our-city/calendar");
  assert.equal(readHeldMeetingSchedule(ROSTER, ROSTER_URL), null, "a roster page states no schedule");
  assert.equal(readHeldMeetingSchedule(shell("Council Meetings", "<p>The council meets on the second Tuesday.</p>"), MEETINGS_URL), null, "a day with no time is not a schedule, and no link was given");
});

test("a saved meeting page from any job names the council's schedule and agenda link as facts beside its roster (§3)", async (t) => {
  const facts = await factDb();
  installFactReader(facts.query);
  t.after(async () => { installFactReader(undefined); await facts.pg.close(); });
  const store = await fixtureStore();
  const base = (await readRegistryRuntimePrior(store, NOW))!;
  assert.equal(base.payload.registry.bodies.find(body => body.id === BODY)?.name, null, "the fixture council is Census-derived and unnamed");
  const meetings = capture(MEETINGS, MEETINGS_URL), roster = capture(ROSTER, ROSTER_URL);
  const other = capture(shell("Planning Commission Meetings", "<p>The Planning Commission meets the first Monday of each month at 6:00 p.m.</p>"), "https://www.bensonaz.gov/planning");
  // A later capture of the same page is the host's "Access Denied" wall.
  const wall = { ...capture("<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1></body></html>", MEETINGS_URL, "2026-09-29T06:00:00.000Z"), httpStatus: 403 };
  const pages = new Map([meetings, roster, other, wall].map(c => [c.evidence.artifactId, c]));
  const schedule = await heldBodySchedule({ body: { id: BODY, name: "Benson City Council" }, divisionLabel: "Benson", now: NOW,
    artifacts: [artifact(wall), artifact(other), artifact(meetings), artifact(roster)], readHeld: async record => pages.get(record.artifactId) ?? null });
  assert.equal(schedule?.capture.evidence.canonicalUrl, MEETINGS_URL, "another body's schedule never attaches to the council");
  const stale = await heldBodySchedule({ body: { id: BODY, name: "Benson City Council" }, divisionLabel: "Benson", now: NOW,
    artifacts: [artifact(capture(MEETINGS, MEETINGS_URL, "2026-07-01T00:00:00.000Z"))], readHeld: async () => capture(MEETINGS, MEETINGS_URL, "2026-07-01T00:00:00.000Z") });
  assert.equal(stale, null, "a capture outside its freshness window attaches nothing");
  const plain = capture(MEETINGS, MEETINGS_URL.replace("https://", "http://"));
  assert.equal(await heldBodySchedule({ body: { id: BODY, name: "Benson City Council" }, divisionLabel: "Benson", now: NOW,
    artifacts: [artifact(plain)], readHeld: async () => plain }), null, "the door accepts only HTTPS sources, so an http copy never holds the roster beside it");

  await ensureFactEntities(facts, ROOT, ["az"]);
  const body = base.payload.registry.bodies.find(row => row.id === BODY)!;
  await publishBodyRoster(facts, { body, division: new Map(base.payload.registry.divisions.map(row => [row.ocdId, row])).get(body.ocdId!)!, state: "AZ", schedule, clocks: factClocks(null), now: new Date(NOW),
    reading: { id: `held:${roster.evidence.artifactId}`, capture: roster, linkingPage: null, complete: true, method: "fixture",
      members: readHeldRoster(ROSTER, ROSTER_URL)!.rows.map((row, i) => ({ recordId: `r${i}`, fields: { ...row } })) } });
  const after = await withFactRegistry(base.payload, facts.query);
  const council = after.registry.bodies.find(body => body.id === BODY)!;
  assert.equal(council.name, "Benson City Council");
  assert.equal(council.bodyOrigin, "SOURCED");
  assert.equal(council.provenance.sourceUrl, ROSTER_URL);
  assert.match(council.meetingCadence ?? "", /second and fourth Thursday of the month\. .* at 5:00 p\.m\.$/);
  assert.equal(council.meetingCadenceSource?.sourceUrl, MEETINGS_URL, "the schedule carries its own source");
  assert.equal(council.agendaSourceRef, "https://www.bensonaz.gov/council-documents/-folder-121");
  assert.deepEqual(after.bodyRosters.find(r => r.bodyId === BODY)?.members.map(m => m.name).sort(), ["Carolyn Flowers", "Clea McCaa II"]);

  // The published agenda link leads the existing meeting walk for that government.
  const item = { id: "wi-roster", autonomousPlan: { contract: { subjectId: "az:benson" }, publication: { contractId: "registry-runtime-bindings", bodyId: BODY } },
    publicationOutcome: { status: "PUBLISHED", at: NOW, versionId: "cv-x", workerResultId: "held:x" } } as unknown as WorkItem;
  const hints = directoryMeetingHints([item], after, []);
  assert.deepEqual(hints.flatMap(h => h.routes.map(r => [h.jurisdictionId, r.url, r.verifyAs])), [["az:benson", "https://www.bensonaz.gov/council-documents/-folder-121", "official-page-events"]]);
});
