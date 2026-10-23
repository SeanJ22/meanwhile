import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { requiredRoutineContract, cadenceMsAt } from "../lib/civic-data/contracts.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { readLocalElectionOffices } from "../lib/reference/local-election-offices.ts";
import { extractLocalElectionOffices, localOfficeValueAppears, type LocalElectionOfficeCapture } from "../lib/sources/local-election-offices/extraction.ts";
import { localElectionOfficesCandidate } from "../lib/sources/local-election-offices/publication.ts";
import { refreshLocalElectionOffices } from "../lib/sources/local-election-offices/refresh.ts";
import { readLocalElectionOfficeRoutes, saveLocalElectionOfficeRoutes } from "../lib/sources/local-election-offices/doors.ts";
import { localElectionOfficeHours } from "../lib/sources/local-election-offices/enrichment.ts";
import { localElectionOfficesContractId, localElectionOfficesScope } from "../lib/sources/local-election-offices/targets.ts";
import type { LocalElectionOfficeFile } from "../lib/sources/local-election-offices/model.ts";
import type { LocalElectionOfficeRoute } from "../lib/sources/local-election-offices/routes.ts";
import { isPostalOnlyAddress } from "../lib/sources/local-election-offices/address.ts";

const AT = "2026-10-23T12:00:00.000Z";
const URL = "https://www.sos.ca.gov/elections/local-offices";
const html = `<h1>County Clerk</h1><table><tr><th>County</th><th>Address</th><th>Phone</th><th>Email</th><th>Website</th><th>Hours</th></tr>
<tr><td>Alameda</td><td>1225 Fallon Street</td><td>510-272-6973</td><td><a href="mailto:alameda@example.gov">Email</a></td><td><a href="https://alameda.example.gov/elections">Website</a></td><td>Monday-Friday 8:30 AM-5:00 PM</td></tr>
<tr><td>San Francisco</td><td>1 Dr Carlton B Goodlett Place</td><td>415-554-4375</td><td><a href="mailto:sf@example.gov">Email</a></td><td><a href="https://sf.example.gov/elections">Website</a></td><td>Monday-Friday 8:00 AM-5:00 PM</td></tr></table>`;
const route: LocalElectionOfficeRoute = { id: "ca-directory", state: "CA", url: URL, directoryUrl: URL, publisher: "California Secretary of State", format: "html",
  extraction: { fields: { countyName: { column: "County" }, office: { literal: "County Clerk", documentHeading: true }, address: { column: "Address" }, phone: { column: "Phone" },
    email: { pattern: 'href="mailto:([^"?]+)' }, website: { pattern: 'href="(https://[^\"]+)' }, hours: { column: "Hours" } } },
  identities: {
    "alameda||": { id: "ca:alameda", state: "CA", divisionId: "ocd-division/country:us/state:ca/county:alameda", countyName: "Alameda County", countyFips: "06001" },
    "san francisco||": { id: "ca:san-francisco", state: "CA", divisionId: "ocd-division/country:us/state:ca/county:san_francisco", countyName: "San Francisco County", countyFips: "06075" },
  } };
const capture = (text = html, at = AT): LocalElectionOfficeCapture => ({ url: URL, bytes: new TextEncoder().encode(text), contentType: "text/html", checkedAt: at });
const parsed = async (text = html, at = AT) => extractLocalElectionOffices(route, capture(text, at));
const file = async (text = html, at = AT): Promise<LocalElectionOfficeFile> => ({ formatVersion: 1, state: "CA", checkedAt: at, offices: (await parsed(text, at)).offices });

test("directory rows keep exact county joins, href contacts and missing jurisdiction work", async () => {
  const read = await parsed();
  assert.equal(read.offices.length, 2);
  assert.equal(read.offices[0].email, "alameda@example.gov");
  assert.equal(read.offices[1].countyFips, "06075");
  assert.equal(read.offices[0].website, "https://alameda.example.gov/elections");
  assert.ok(read.offices[0].directorySource?.quote.includes("Alameda"));
  const removed = await parsed(html.replace(/<tr><td>San Francisco[\s\S]*?<\/tr>/, ""));
  assert.equal(removed.offices.length, 1);
  assert.ok(removed.blanks.some(blank => blank.officeId === "ca:san-francisco" && blank.field === "directory"));
});

test("ordinary CSV rows are checked through a saved deterministic table transcription", async () => {
  const csvRoute: LocalElectionOfficeRoute = { ...route, format: "csv", extraction: { fields: { countyName: { column: "County" }, office: { column: "Office" }, phone: { column: "Phone" }, website: { column: "Website" } } } };
  const read = await extractLocalElectionOffices(csvRoute, capture("County,Office,Phone,Website\nAlameda,County Clerk,510-272-6973,www.alameda.example.gov"));
  assert.equal(read.offices[0].office, "County Clerk");
  assert.equal(read.offices[0].website, "https://www.alameda.example.gov/");
  assert.ok(read.offices[0].fields.phone);
});

test("URL evidence requires the exact native link rather than an empty anchor or URL prefix", () => {
  assert.equal(localOfficeValueAppears("https://example.gov/Town-Clerk", '<a href="/Town-Clerk-Other">Another office</a>', "https://example.gov/Town-Clerk"), false);
  assert.equal(localOfficeValueAppears("https://example.gov/Town-Clerk", '<a href="/"><img alt="Home"></a>', "https://example.gov/Town-Clerk"), false);
  assert.equal(localOfficeValueAppears("https://example.gov/Town-Clerk", '<a href="/Town-Clerk">Town Clerk</a>', "https://example.gov/"), true);
  assert.equal(localOfficeValueAppears("https://example.gov/department.asp?deptnum=90", '<a href="/department.asp?deptnum&#61;90">Elections</a>', "https://example.gov/"), true);
  assert.equal(localOfficeValueAppears("https://example.gov/clerk's_office/", '<a href="/clerk\'s_office/">Clerk</a>', "https://example.gov/"), true);
});

test("a value from a neighboring county row cannot publish under this county", async () => {
  const read = await parsed(), projection = await file();
  const wrong = { ...projection.offices[0], phone: projection.offices[1].phone, fields: { ...projection.offices[0].fields, phone: projection.offices[1].fields.phone } };
  await assert.rejects(localElectionOfficesCandidate({ vault: new MemoryEvidenceStore(), projection: { ...projection, offices: [wrong] }, documents: [read.document] }), /another directory row/);
});

test("mailing boxes stay open as missing street addresses, while mixed street addresses remain", async () => {
  for (const value of ["PO Box 6 Rawlins WY 82301", "Town Hall P.O. Box 226 Little Compton RI 02837", "PO Box 39 Sherman CT 06784", "PO Box 1 One Town CT 06331"]) assert.equal(isPostalOnlyAddress(value), true);
  for (const value of ["PO Box 250 21 South Tyler", "PO Drawer 968 206 S Fourth St", "PO Box 33 1000 10th Ave", "PO Box 123 301 3rd St", "One Municipal Drive Po Box 27 Canterbury, CT 06331"]) assert.equal(isPostalOnlyAddress(value), false);
  const read = await parsed(html.replace("1225 Fallon Street", "PO Box 6 Rawlins WY 82301"));
  assert.equal(read.offices[0].address, undefined);
  assert.ok(read.blanks.some(blank => blank.officeId === read.offices[0].id && blank.field === "address" && blank.reason.includes("mailing box")));
});

test("an unsaved state-directory URL cannot turn a local page into state-directory evidence", async () => {
  const read = await parsed(), projection = await file();
  const local = { ...projection.offices[0], directoryUrl: "https://www.sos.ca.gov/elections/a-directory-that-was-not-saved" };
  await assert.rejects(localElectionOfficesCandidate({ vault: new MemoryEvidenceStore(), projection: { ...projection, offices: [local] }, documents: [read.document] }), /landing page has not been saved/);
});

test("county office exclusions inherit through routes and require an explicit saved municipal exception", async () => {
  const excluded = { divisionId: "ocd-division/country:us/state:ca/place:oakland", name: "Oakland", municipalityType: "CITY" as const };
  const exclusionRoute: LocalElectionOfficeRoute = { ...route, identities: { ...route.identities,
    "alameda other than oakland||": { ...route.identities!["alameda||"], excludedMunicipalities: [excluded] } } };
  const read = await extractLocalElectionOffices(exclusionRoute, capture(html.replace("<td>Alameda</td>", "<td>Alameda other than Oakland</td>")));
  assert.deepEqual(read.offices[0].excludedMunicipalities, [excluded]);
  const projection: LocalElectionOfficeFile = { formatVersion: 1, state: "CA", checkedAt: AT, offices: [read.offices[0]] };
  await localElectionOfficesCandidate({ vault: new MemoryEvidenceStore(), projection, documents: [read.document] });
  const plain = await parsed(), original = plain.offices[0];
  await assert.rejects(localElectionOfficesCandidate({ vault: new MemoryEvidenceStore(), projection: { ...projection, offices: [{ ...original, excludedMunicipalities: [excluded] }] }, documents: [plain.document] }), /no explicit saved directory exception/);
  await assert.rejects(localElectionOfficesCandidate({ vault: new MemoryEvidenceStore(), projection: { ...projection, offices: [{ ...read.offices[0], excludedMunicipalities: [{ ...excluded, divisionId: "ocd-division/country:us/state:nv/place:oakland" }] }] }, documents: [read.document] }), /exclusion is invalid|another scope/);
});

test("new stale captures are refused; retained last-good facts keep their original source dates", async () => {
  const staleAt = "2026-09-01T12:00:00.000Z", read = await parsed(html, staleAt), old = await file(html, staleAt), projection = { ...old, checkedAt: AT };
  await assert.rejects(localElectionOfficesCandidate({ vault: new MemoryEvidenceStore(), projection, documents: [read.document] }), /freshness window/);
  const candidate = await localElectionOfficesCandidate({ vault: new MemoryEvidenceStore(), projection, documents: [read.document], previous: old });
  assert.equal(candidate.temporal.sourceThrough, staleAt);
  assert.equal((candidate.readModel as LocalElectionOfficeFile).offices[0].fields.phone?.checkedAt, staleAt);
});

test("registered source promotion reaches the canonical office reader and tomorrow's scheduled pass preserves it", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T12:00:00.000Z") });
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), read = await parsed();
  const candidate = await localElectionOfficesCandidate({ vault, projection: await file(), documents: [read.document] });
  const outcome = await processRegisteredRoutineCandidate(store, localElectionOfficesContractId("CA"), candidate, AT);
  assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
  const reader = await readLocalElectionOffices("CA", { store });
  assert.equal(reader.kind, "PROMOTED");
  assert.equal(reader.value?.offices[0].phone, "510-272-6973");
  const task = routineTaskFromContract(requiredRoutineContract(localElectionOfficesContractId("CA")));
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(routineTaskDue(task, clock, Date.parse("2026-10-24T12:00:00.000Z")), false);
  assert.equal(routineTaskDue(task, clock, Date.parse("2026-10-30T12:00:00.000Z")), true);
  assert.equal(cadenceMsAt(task.contract, Date.parse("2026-11-05T12:00:00.000Z")), 30 * 86_400_000);
  assert.equal(cadenceMsAt(task.contract, Date.parse("2026-11-04T06:59:59.999Z")), 7 * 86_400_000);
  assert.equal(cadenceMsAt(task.contract, Date.parse("2026-11-04T07:00:00.001Z")), 30 * 86_400_000);
  assert.equal((await readLocalElectionOffices("CA", { store })).value?.offices[0].fields.phone?.checkedAt, AT);
});

test("state route indexes load only their named state's records", async () => {
  const repos = createMemoryRepositories();
  await saveLocalElectionOfficeRoutes(repos.doors, "CA", [route], AT);
  assert.deepEqual(await readLocalElectionOfficeRoutes(repos.doors, "CA"), [route]);
  assert.deepEqual(await readLocalElectionOfficeRoutes(repos.doors, "TX"), []);
});

test("failed refresh preserves the published office and independent valid fields still publish", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T12:00:00.000Z") });
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), read = await parsed();
  const first = await refreshLocalElectionOffices({ state: "CA", store, vault, routes: [route], capture: async () => read.document, now: () => AT });
  assert.ok(first.outcome.promoted, JSON.stringify(first.outcome.candidate.receipt));
  const before = await store.readPromotion("CURATED_READER_RECORD", localElectionOfficesScope("CA"));
  const failed = await refreshLocalElectionOffices({ state: "CA", store, vault, routes: [route], capture: async () => { throw new Error("Public state directory returned HTTP 503"); }, now: () => "2026-10-30T12:00:00.000Z" });
  assert.equal(failed.outcome.promoted, null);
  assert.equal((await store.readPromotion("CURATED_READER_RECORD", localElectionOfficesScope("CA")))?.versionId, before?.versionId);
  assert.equal((await readLocalElectionOffices("CA", { store })).value?.offices[0].fields.phone?.checkedAt, AT);
  const changedAt = "2026-10-30T12:01:00.000Z", changedRoute = { ...route, extraction: { ...route.extraction, fields: { ...route.extraction.fields, address: { literal: "An address that is not on the source page" } } } };
  const changed = await extractLocalElectionOffices(changedRoute, capture(html.replace("510-272-6973", "510-272-6974"), changedAt));
  const partial = await refreshLocalElectionOffices({ state: "CA", store, vault, routes: [changedRoute], capture: async () => changed.document, now: () => changedAt });
  assert.ok(partial.outcome.promoted, JSON.stringify(partial.outcome.candidate.receipt));
  const after = (await readLocalElectionOffices("CA", { store })).value!.offices[0];
  assert.equal(after.phone, "510-272-6974");
  assert.equal(after.address, "1225 Fallon Street");
  assert.equal(after.fields.address?.checkedAt, AT);
  assert.ok(partial.projection.blanks?.some(blank => blank.officeId === after.id && blank.field === "address"));
});

test("official linking pages survive the next source refresh without retaining unrelated documents", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T12:00:00.000Z") });
  const sourceUrl = "https://elections.example.org/offices", orgRoute = { ...route, url: sourceUrl, directoryUrl: sourceUrl };
  const read = await extractLocalElectionOffices(orgRoute, { ...capture(), url: sourceUrl });
  const bridgeText = `<a href="${sourceUrl}">Published local election-office directory</a>`;
  const bridge = { ...capture(bridgeText), url: "https://elections.example.gov/directory", text: bridgeText, documentHash: "" };
  const { sha256 } = await import("../lib/civic-data/candidate-builders.ts");
  bridge.documentHash = sha256(bridge.bytes);
  const unrelatedBytes = new TextEncoder().encode("Unrelated government page");
  const unrelated = { ...bridge, url: "https://elections.example.gov/unrelated", text: "Unrelated government page", bytes: unrelatedBytes, documentHash: sha256(unrelatedBytes) };
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const projection: LocalElectionOfficeFile = { formatVersion: 1, state: "CA", checkedAt: AT, offices: read.offices };
  const candidate = await localElectionOfficesCandidate({ vault, projection, documents: [read.document, bridge, unrelated] });
  const manifest = candidate.normalizedPayload as { documents: { url: string }[] };
  assert.ok(manifest.documents.some(document => document.url === bridge.url));
  assert.ok(!manifest.documents.some(document => document.url === unrelated.url));
  await processRegisteredRoutineCandidate(store, localElectionOfficesContractId("CA"), candidate, AT);
  const nextAt = "2026-10-30T12:00:00.000Z";
  const nextRead = await extractLocalElectionOffices(orgRoute, { ...capture(html, nextAt), url: sourceUrl });
  const refreshed = await refreshLocalElectionOffices({ state: "CA", store, vault, routes: [orgRoute], capture: async () => nextRead.document, now: () => nextAt });
  assert.ok(refreshed.outcome.promoted, JSON.stringify(refreshed.outcome.candidate.receipt));
  assert.ok((refreshed.candidate.normalizedPayload as { documents: { url: string }[] }).documents.some(document => document.url === bridge.url));
});

test("generic office-hours extraction declines ambiguous seasonal and branch schedules", () => {
  assert.equal(localElectionOfficeHours("<section><h2>Office Hours</h2><p>Monday-Friday 8:00 AM-5:00 PM</p><p>Phone: 555-555-5555</p></section>")?.value, "Monday-Friday 8:00 AM-5:00 PM");
  for (const label of ["Summer Office Hours", "County Office Hours", "Branch Office Hours", "Court Hours"]) assert.equal(localElectionOfficeHours(`<section><h2>${label}</h2><p>Monday-Friday 8:00 AM-5:00 PM</p></section>`), null);
  assert.equal(localElectionOfficeHours("<main><section><h2>Regular Office Hours</h2><p>Monday-Friday 9:00 AM-5:00 PM</p></section><section><h2>Summer Branch Office Hours</h2><p>Monday-Friday 8:00 AM-4:00 PM</p></section></main>")?.value, "Monday-Friday 9:00 AM-5:00 PM");
});
