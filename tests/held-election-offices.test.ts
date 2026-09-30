import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { publishElectionFields } from "../lib/civic-data/election-field-publication.ts";
import { readElectionFieldsForDivisions } from "../lib/civic-data/curated-reader-read-model.ts";
import { heldElectionOfficeFields, readHeldElectionOffices } from "../lib/civic-data/worker-held-elections.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { section3Record } from "../lib/control-plane/promotion/section3.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

const NOW = "2026-09-30T21:00:00.000Z";
const CITY = "ocd-division/country:us/state:az/place:sierra_vista";
const URL_ = "https://www.sierravistaaz.gov/our-city/departments/city-clerk/elections/voting-and-polls";
// The shape of Sierra Vista's saved "Voting and Polls" page (captured 2026-09-28).
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
