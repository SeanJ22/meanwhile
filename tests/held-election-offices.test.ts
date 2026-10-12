import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { readRegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { publishElectionFields } from "../lib/civic-data/election-field-publication.ts";
import { readElectionFieldsForDivisions } from "../lib/civic-data/curated-reader-read-model.ts";
import { heldElectionOfficeFields, heldNationalElectionOfficeFields, NATIONAL_ELECTION_OFFICES_URL, publishHeldElectionOffices, readHeldElectionOffices } from "../lib/civic-data/worker-held-elections.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { section3Record } from "../lib/control-plane/promotion/section3.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

const NOW = "2026-09-30T21:00:00.000Z";
const CITY = "ocd-division/country:us/state:az/place:sierra_vista";
const URL_ = "https://www.sierravistaaz.gov/our-city/departments/city-clerk/elections/voting-and-polls";
// The shape of a city's saved "Voting and Polls" page.
const PAGE = `<html><head><title>Voting and Polls | City of Sierra Vista, AZ</title></head><body>
<header><a href="/our-city/departments/city-clerk">City Clerk</a> (520) 458-3315</header><main><h1>Voting and Polls</h1>
<h2>Register to Vote</h2><p>Voter registration is managed by the Cochise County <a href="https://www.cochise.az.gov/509/Voter-Information">Recorder&#39;s Office</a>, (520) 432-8354.</p>
<p>Early ballots can be requested through the <a href="https://www.cochise.az.gov/292/Elections">Cochise County Elections Office</a>, (520) 432-8970.</p>
<p>Soliciten balotas para votar antes por medio de la oficina del Cochise County Recorder, (520) 432-8354.</p></main>
<footer>City Hall 1011 N. Coronado Drive (520) 458-3315</footer></body></html>`;

function capture(text: string, url = URL_, observedAt = "2026-09-28T23:15:10.058Z"): WorkerPublicationCapture {
  const contentHash = `sha256-${createHash("sha256").update(text).digest("hex")}`;
  return { evidence: { artifactId: `ar-${contentHash.slice(7, 31)}`, contentHash, text, acquiredByAttemptId: "at-scout", canonicalUrl: url,
    retrievedAt: observedAt, sourceId: new URL(url).hostname, methodRouteId: "scout:fetch_public" }, observedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
}

test("plain code reads each election office on a saved voting page once, with its phone line", () => {
  assert.deepEqual(readHeldElectionOffices(PAGE).map(row => [row.office, row.phone]), [
    ["Cochise County Recorder's Office", "(520) 432-8354"],
    ["Cochise County Elections Office", "(520) 432-8970"],
  ], "the site chrome's City Hall line is not an election office, and the Spanish repeat of the Recorder is the same office");
  assert.deepEqual(readHeldElectionOffices(PAGE.replace(/Voting and Polls/g, "Parks and Recreation")), [], "a page that is not about voting names no election office");
});

test("one national directory publishes state, DC and territory offices without per-place parsers", async () => {
  const page = `<table><tr><th>State</th><th>Office</th><th>Website</th><th>Telephone</th></tr>
    <tr><td>Wisconsin</td><td>Wisconsin Elections Commission, Madison, WI</td><td><a href="http://elections.wi.gov/">office website</a></td><td>866/868-3947 608/266-8005</td></tr>
    <tr><td>District of Columbia</td><td>Board of Elections, Washington, DC</td><td>office website</td><td>202/727-2525</td></tr>
    <tr><td>Kentucky (Election Results)</td><td>State Board of Elections, Frankfort, KY</td><td>office website</td><td>502/573-7100</td></tr>
    <tr><td>Puerto Rico</td><td>State Elections Commission, San Juan, PR</td><td>office website</td><td>787/777-8682</td></tr>
    <tr><td>U.S. Virgin Islands</td><td>Office of the Supervisor of Elections, St. Croix, USVI</td><td>office website</td><td>340/773-1021</td></tr></table>`;
  const saved = capture(page, NATIONAL_ELECTION_OFFICES_URL, NOW);
  const fields = heldNationalElectionOfficeFields(saved);
  assert.equal(fields.length, 5);
  assert.equal(fields[0].phone, "866/868-3947", "multiple source phones do not become one invalid telephone URI");
  assert.equal(heldElectionOfficeFields({ divisionId: "ocd-division/country:us/state:wi/county:dane", capture: saved }).length, 1);
  assert.equal(heldElectionOfficeFields({ divisionId: CITY, capture: saved }).length, 0);
  assert.deepEqual(heldNationalElectionOfficeFields(capture(page, "https://other.example.gov/")), []);
  const store = new MemoryRoutineDataStore();
  const result = await publishElectionFields({ store, now: NOW, fields, verify: section3Record });
  assert.equal(result.fields.length, 5, JSON.stringify(result.gaps));
  const read = await readElectionFieldsForDivisions(fields.map(field => field.divisionId), { store, now: NOW, bypassCache: true });
  assert.equal(read.fields.length, 5);
  assert.ok(read.fields.every(row => row.value.navigationUrl === null && row.value.url === NATIONAL_ELECTION_OFFICES_URL));
  const newer = capture(page.replace("866/868-3947", "866/868-3948"), NATIONAL_ELECTION_OFFICES_URL, NOW);
  const updated = await publishElectionFields({ store, now: NOW, fields: heldNationalElectionOfficeFields(newer), verify: section3Record });
  assert.deepEqual(updated.fields, result.fields, "a changed phone updates the sourced office rather than accumulating old lines");
});

test("a city's saved voting page puts its county election offices on the ballot page for that city (§3)", async () => {
  const store = new MemoryRoutineDataStore();
  const fields = heldElectionOfficeFields({ divisionId: CITY, capture: capture(PAGE) });
  const stale = heldElectionOfficeFields({ divisionId: CITY, capture: capture(PAGE, URL_, "2026-07-01T00:00:00.000Z") });
  const result = await publishElectionFields({ store, now: NOW, fields: [...fields, ...stale], verify: section3Record });
  assert.equal(result.fields.length, 2);
  assert.equal(result.gaps.length, 2, "a capture outside the contact window publishes nothing");
  const read = await readElectionFieldsForDivisions([CITY], { store, now: NOW, bypassCache: true });
  const elections = read.fields.find(row => row.value.text === "Cochise County Elections Office")!;
  assert.deepEqual([elections.value.fieldKind, elections.value.phone, elections.value.navigationUrl, elections.value.url],
    ["election_office", "(520) 432-8970", null, URL_], "the office's own page is a link nobody read, so it is not published");
  // A later page publishes over the live projection: every published link must be one a saved page was reviewed for.
  const countyUrl = "https://www.cochise.az.gov/292/Elections";
  const county = heldElectionOfficeFields({ divisionId: "ocd-division/country:us/state:az/county:cochise",
    capture: capture(`<html><head><title>Elections | Cochise County, AZ</title></head><body><main><p>Questions about early ballots? Call the Cochise County Elections Department at (520) 432-8970.</p></main></body></html>`, countyUrl) });
  const successor = await publishElectionFields({ store, now: NOW, fields: county, verify: section3Record });
  assert.equal(successor.fields.length, 1);
  assert.ok(successor.promotedVersionId);
  const invented = heldElectionOfficeFields({ divisionId: CITY, capture: capture(PAGE) }).map(row => ({ ...row, phone: "(520) 555-0100" }));
  const refused = await publishElectionFields({ store, now: NOW, fields: invented, verify: section3Record });
  assert.equal(refused.fields.length, 0, "a phone line that is not on the saved page never publishes");
});

test("owed jobs reuse a national capture from an unrelated job and pass over a newer denied page", async () => {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  const prior = (await readRegistryRuntimePrior(store, NOW))!;
  const repos = createMemoryRepositories();
  const states = ["az", "nj"];
  const ids: string[] = [];
  for (const state of states) {
    const body = prior.payload.registry.bodies.find(body => body.ocdId?.startsWith("ocd-division/country:us/state:" + state + "/"))!;
    assert.ok(body);
    const id = "owed-" + state; ids.push(id);
    const item = { id, autonomousPlan: { contract: { subjectId: "unrelated-place-" + state }, publication: { bodyId: body.id } } } as unknown as WorkItem;
    await repos.workItems.put(id, item, NOW);
  }
  const page = '<table><tr><th>State</th><th>Office</th><th>Website</th><th>Phone</th></tr>' +
    '<tr><td>Arizona</td><td>Secretary of State</td><td>office website</td><td>602-542-8683</td></tr>' +
    '<tr><td>New Jersey</td><td>Division of Elections</td><td>office website</td><td>609-292-3760</td></tr></table>';
  const saved = capture(page, NATIONAL_ELECTION_OFFICES_URL, "2026-09-29T00:00:00Z");
  assert.equal(heldNationalElectionOfficeFields(saved).length, 2);
  const denied = capture('<html><p>Access denied</p></html>', NATIONAL_ELECTION_OFFICES_URL, NOW);
  const copies = new Map<string, WorkerPublicationCapture>();
  for (const c of [saved, denied]) {
    copies.set(c.evidence.artifactId, c);
    const artifact: ArtifactRecord = { artifactId: c.evidence.artifactId, workItemId: "national-source-other-job", routeTaskId: null,
      attemptId: c.evidence.acquiredByAttemptId, tier: "RAW", contentHash: c.evidence.contentHash, byteLength: c.evidence.text.length,
      contentType: "text/html", canonicalUrl: c.evidence.canonicalUrl, partial: false, recordedAt: c.observedAt };
    await repos.artifacts.append(artifact.workItemId, artifact.artifactId, artifact, NOW);
  }
  const outcomes = await publishHeldElectionOffices({ repos, store, workItemIds: ids, now: NOW, readHeld: async record => copies.get(record.artifactId) ?? null });
  assert.ok(outcomes.every(row => row.outcome.status === "PARTIALLY_PUBLISHED"), JSON.stringify(outcomes));
  const read = await readElectionFieldsForDivisions(states.map(state => "ocd-division/country:us/state:" + state), { store, now: NOW, bypassCache: true });
  assert.equal(read.fields.length, 2);
  assert.ok(read.fields.every(row => row.value.url === NATIONAL_ELECTION_OFFICES_URL));
});
