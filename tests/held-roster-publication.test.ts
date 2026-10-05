import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import test from "node:test";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate, type RegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { CENSUS_PLACEHOLDER_LABELS } from "../lib/registry/census-placeholders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { readHeldRoster } from "../lib/civic-data/worker-held-roster.ts";
import { heldRosterReading, pageIsAboutBody, publishRosterReading, workerRosterPublication, type WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";

const NOW = "2026-09-29T20:00:00.000Z";
const BODY = "ocd-division/country:us/state:az/place:benson#governing";
const URL_ = "https://www.bensonaz.gov/government/city-council/contact-the-mayor-council";
const member = (id: number, written: string, title: string) =>
  `<tr><td><a href="/Home/Components/StaffDirectory/StaffDirectory/${id}/128">${written}</a></td><td class="mobile_hide">${title}</td>` +
  `<td><a class='phone_link' href='tel:5205551000'>(520) 555-1000</a></td><td><a class="email_link" href="javascript:void(0);">Email</a></td></tr>`;
const table = (rows: string) => `<table class="listtable"><thead><tr><th><a>Staff</a></th><th>Title</th><th>Phone</th><th>Email</th></tr></thead><tbody>${rows}</tbody></table>`;
const ROWS = member(1, "McCaa II, Clea", "Mayor") + member(2, "Flowers, Carolyn", "Vice Mayor") + member(3, "Jackson, Faye", "Council Member");
const page = (title: string, rows = ROWS) => `<html><head><title>${title} | City of Benson, AZ</title></head><body>` +
  `<nav>Government City Council Council Meetings Boards Commissions</nav><h1>${title}</h1>` +
  // CMS pages often repeat the directory table (desktop and mobile).
  `${table(rows)}${table(rows)}<p>Email the entire council at MayorandCouncil@BensonAZ.gov.</p></body></html>`;

function capture(html: string, url = URL_, observedAt = "2026-09-28T22:06:04.940Z"): WorkerPublicationCapture {
  const contentHash = `sha256-${createHash("sha256").update(html).digest("hex")}`;
  return { evidence: { artifactId: `ar-${contentHash.slice(7, 31)}`, contentHash, text: html, acquiredByAttemptId: "at-scout", canonicalUrl: url,
    retrievedAt: observedAt, sourceId: new URL(url).hostname, methodRouteId: "scout:fetch_public" }, observedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
}

async function prior(): Promise<RegistryRuntimePrior> {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  return (await readRegistryRuntimePrior(store, NOW))!;
}

test("plain code reads a CMS staff-directory roster once, with display names and relative bio links", () => {
  const roster = readHeldRoster(page("Contact the Mayor & Council"), URL_)!;
  assert.equal(roster.complete, true);
  assert.deepEqual(roster.rows.map(row => [row.name, row.office, row.phone]), [
    ["Clea McCaa II", "Mayor", "(520) 555-1000"], ["Carolyn Flowers", "Vice Mayor", "(520) 555-1000"], ["Faye Jackson", "Council Member", "(520) 555-1000"]]);
  assert.equal(roster.rows[0].websiteUrl, "https://www.bensonaz.gov/Home/Components/StaffDirectory/StaffDirectory/1/128");
  assert.equal(readHeldRoster("<table><tr><th>Name</th><th>Phone</th></tr><tr><td>A</td><td>1</td></tr></table>", URL_), null, "a table without a seat column is not a roster");
});

test("a saved official page puts an unnamed council live with seat, name, office phone and source link (§3)", async () => {
  const base = await prior();
  assert.equal(base.payload.registry.bodies.find(body => body.id === BODY)?.name, null);
  const held = capture(page("Contact the Mayor & Council"));
  const reading = await heldRosterReading({ bodyId: BODY, prior: base, now: NOW, readHeld: async () => held,
    artifacts: [{ artifactId: held.evidence.artifactId, workItemId: "wi-directory", routeTaskId: null, attemptId: "at-scout", tier: "RAW", contentHash: held.evidence.contentHash,
      byteLength: held.evidence.text.length, contentType: "text/html; charset=utf-8", canonicalUrl: URL_, partial: false, recordedAt: held.observedAt } as ArtifactRecord] });
  assert.ok(reading);
  const published = workerRosterPublication({ bodyId: BODY, reading, prior: base, now: NOW });
  const roster = published.payload.bodyRosters[0];
  assert.equal(roster.bodyName, "Benson City Council");
  assert.equal(roster.sourceUrl, URL_);
  assert.deepEqual(roster.members.map(m => [m.name, m.officeTitle, m.phone, m.contactScope]), [
    ["Clea McCaa II", "Mayor", "(520) 555-1000", "SHARED_OFFICE"], ["Carolyn Flowers", "Vice Mayor", "(520) 555-1000", "SHARED_OFFICE"], ["Faye Jackson", "Council Member", "(520) 555-1000", "SHARED_OFFICE"]]);
  assert.ok(roster.members.every(m => m.websiteUrl?.startsWith("https://www.bensonaz.gov/Home/Components/StaffDirectory/")));
  assert.ok(published.payload.officialCandidacies.rows.every(row => row.status === "NOT_CHECKED"), "holding office never asserts a candidacy");
  assert.deepEqual(published.unresolved, []);
});

test("the wrong page, a stale page and an unlinked non-government page never publish", async () => {
  const base = await prior();
  const body = base.payload.registry.bodies.find(row => row.id === BODY)!;
  assert.equal(pageIsAboutBody(page("Boards"), body, "Benson"), false, "a boards page's members are not the council");
  const reading = (c: WorkerPublicationCapture) => ({ id: `held:${c.evidence.artifactId}`, capture: c, linkingPage: null, complete: true, method: "fixture",
    members: readHeldRoster(c.evidence.text, c.evidence.canonicalUrl)!.rows.map((row, i) => ({ recordId: `r${i}`, fields: { ...row } })) });
  assert.throws(() => workerRosterPublication({ bodyId: BODY, reading: reading(capture(page("Boards"))), prior: base, now: NOW }), /ROSTER_PAGE_NOT_THIS_BODY/);
  assert.throws(() => workerRosterPublication({ bodyId: BODY, reading: reading(capture(page("Contact the Mayor & Council"), URL_, "2026-07-01T00:00:00.000Z")), prior: base, now: NOW }), /OUTSIDE_FRESHNESS_WINDOW/);
  assert.throws(() => workerRosterPublication({ bodyId: BODY, reading: reading(capture(page("Contact the Mayor & Council"), "https://benson-az.example.com/council")), prior: base, now: NOW }), /LINKED_SOURCE_UNVERIFIED/);
});

test("a complete official roster records a departure; a partial one keeps the prior member on its own source", async () => {
  const base = await prior();
  const first = workerRosterPublication({ bodyId: BODY, prior: base, now: NOW, reading: { id: "held:a", capture: capture(page("Contact the Mayor & Council")), linkingPage: null, complete: true, method: "fixture",
    members: readHeldRoster(page("Contact the Mayor & Council"), URL_)!.rows.map((row, i) => ({ recordId: `r${i}`, fields: { ...row } })) } });
  const withRoster = { ...base, payload: { ...base.payload, bodyRosters: [...base.payload.bodyRosters, first.payload.bodyRosters[0]] } };
  const smaller = page("Contact the Mayor & Council", member(1, "McCaa II, Clea", "Mayor") + member(2, "Flowers, Carolyn", "Vice Mayor"));
  const rows = readHeldRoster(smaller, URL_)!.rows.map((row, i) => ({ recordId: `r${i}`, fields: { ...row } }));
  const complete = workerRosterPublication({ bodyId: BODY, prior: withRoster, now: NOW, reading: { id: "held:b", capture: capture(smaller), linkingPage: null, complete: true, method: "fixture", members: rows } });
  assert.deepEqual(complete.departed, ["Faye Jackson (Council Member)"]);
  assert.equal(complete.payload.bodyRosters[0].members.some(m => m.name === "Faye Jackson"), false, "a complete official roster removes who it no longer lists");
  const faye = first.payload.bodyRosters[0].members.find(m => m.name === "Faye Jackson")!;
  assert.deepEqual(complete.departures, [{ bodyId: BODY, holderId: faye.id, sourceUrl: URL_ }]);
  const partial = workerRosterPublication({ bodyId: BODY, prior: withRoster, now: NOW, reading: { id: "held:c", capture: capture(smaller), linkingPage: null, complete: false, method: "fixture", members: rows } });
  assert.deepEqual(partial.departed, []);
  assert.ok(partial.payload.bodyRosters[0].members.some(m => m.name === "Faye Jackson" && m.membershipSource), "retained on its earlier source");
});

test("a single official's profile page publishes through the same door without a work item, keeping the rest of the roster", async () => {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  // Replay the deployed Census placeholder correction the recorded fixture predates (as tests/worker-roster-publication.test.ts does).
  const imported = (await readRegistryRuntimePrior(store, NOW))!;
  const divisions = imported.payload.registry.divisions.filter(row => CENSUS_PLACEHOLDER_LABELS[row.label]).map(row => ({ ...row, label: CENSUS_PLACEHOLDER_LABELS[row.label] }));
  const corrected = registryRuntimeCandidate({ contractId: "registry-runtime-bindings", version: "fixture-census-correction", sourceThrough: NOW,
    sourceReceipt: { contractVersion: 1, reviewedAt: NOW, reviewedBy: "recorded-fixture-control", sources: [...new Set(divisions.map(row => row.provenance!.sourceUrl!))].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "U.S. Census Bureau", sourceClass: "OFFICIAL_PUBLISHER" as const, retrievedAt: NOW, httpStatus: 200, rawHash: createHash("sha256").update(JSON.stringify(divisions)).digest("hex"), reviewedEvidence: "Offline fixture: Census LEA 99997 means no school district." })) },
    payload: { ...imported.payload, registry: { ...imported.payload.registry, divisions, bodies: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { ...imported.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior: imported });
  assert.ok((await processRegisteredManualCandidate(store, "registry-runtime-bindings", corrected, NOW, imported.versionId)).promoted);
  const held = capture(page("Contact the Mayor & Council", member(9, "Rivera, Ana", "Council Member")));
  const published = await publishRosterReading({ store, bodyId: BODY, now: NOW, reading: { id: `held:${held.evidence.artifactId}`, capture: held, linkingPage: null, complete: false,
    method: "fixture profile page", members: [{ recordId: "p1", fields: { name: "Ana Rivera", nameAsWritten: "Rivera, Ana", office: "Council Member" } }] } });
  assert.ok(published.versionId);
  const after = (await readRegistryRuntimePrior(store, NOW))!;
  assert.deepEqual(after.payload.bodyRosters.find(r => r.bodyId === BODY)?.members.map(m => m.name), ["Ana Rivera"]);
});

test("a departure publishes through the registry door: the holder's rows leave with removal evidence the validator accepts", async () => {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  const imported = (await readRegistryRuntimePrior(store, NOW))!;
  const divisions = imported.payload.registry.divisions.filter(row => CENSUS_PLACEHOLDER_LABELS[row.label]).map(row => ({ ...row, label: CENSUS_PLACEHOLDER_LABELS[row.label] }));
  const corrected = registryRuntimeCandidate({ contractId: "registry-runtime-bindings", version: "fixture-census-correction", sourceThrough: NOW,
    sourceReceipt: { contractVersion: 1, reviewedAt: NOW, reviewedBy: "recorded-fixture-control", sources: [...new Set(divisions.map(row => row.provenance!.sourceUrl!))].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "U.S. Census Bureau", sourceClass: "OFFICIAL_PUBLISHER" as const, retrievedAt: NOW, httpStatus: 200, rawHash: createHash("sha256").update(JSON.stringify(divisions)).digest("hex"), reviewedEvidence: "Offline fixture: Census LEA 99997 means no school district." })) },
    payload: { ...imported.payload, registry: { ...imported.payload.registry, divisions, bodies: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { ...imported.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior: imported });
  assert.ok((await processRegisteredManualCandidate(store, "registry-runtime-bindings", corrected, NOW, imported.versionId)).promoted);
  const full = capture(page("Contact the Mayor & Council"));
  let carried = (await readRegistryRuntimePrior(store, NOW))!;
  await publishRosterReading({ store, bodyId: BODY, now: NOW, prior: carried, onPublished: next => { carried = next; }, reading: { id: "held:full", capture: full, linkingPage: null, complete: true, method: "fixture",
    members: readHeldRoster(full.evidence.text, URL_)!.rows.map((row, i) => ({ recordId: `r${i}`, fields: { ...row } })) } });
  const before = carried;
  assert.deepEqual(carried, await readRegistryRuntimePrior(store, NOW), "accepted snapshot exactly matches canonical readback without reloading between bodies");
  const faye = before.payload.bodyRosters.find(r => r.bodyId === BODY)!.members.find(m => m.name === "Faye Jackson")!;
  assert.ok(before.payload.officialCandidacies.rows.some(row => row.holder.id === faye.id));
  const smaller = capture(page("Contact the Mayor & Council", member(1, "McCaa II, Clea", "Mayor") + member(2, "Flowers, Carolyn", "Vice Mayor")));
  const published = await publishRosterReading({ store, bodyId: BODY, now: NOW, prior: carried, onPublished: next => { carried = next; }, reading: { id: "held:smaller", capture: smaller, linkingPage: null, complete: true, method: "fixture",
    members: readHeldRoster(smaller.evidence.text, URL_)!.rows.map((row, i) => ({ recordId: `r${i}`, fields: { ...row } })) } });
  assert.deepEqual(published.departed, ["Faye Jackson (Council Member)"]);
  const after = (await readRegistryRuntimePrior(store, NOW))!;
  assert.deepEqual(carried, after, "the next accepted successor preserves the carried source authority and digest");
  assert.deepEqual(after.payload.bodyRosters.find(r => r.bodyId === BODY)!.members.map(m => m.name).sort(), ["Carolyn Flowers", "Clea McCaa II"]);
  assert.equal(after.payload.officialCandidacies.rows.some(row => row.holder.id === faye.id), false);
  assert.equal(after.payload.rosterReaderDispositions.some(row => row.sourceId === faye.id), false);
});

test("CP-08: a newer news phone cannot replace the official phone, and its losing value is kept", async () => {
  const base = await prior();
  const first = capture(page("Contact the Mayor & Council"));
  const reading = (saved: WorkerPublicationCapture) => ({ id: `held:${saved.evidence.artifactId}`, capture: saved, linkingPage: null, complete: true, method: "fixture",
    members: readHeldRoster(saved.evidence.text, saved.evidence.canonicalUrl)!.rows.map((member, i) => ({ recordId: `r${i}`, fields: { ...member } })) });
  const official = workerRosterPublication({ bodyId: BODY, reading: reading(first), prior: base, now: NOW });
  const held = { ...base, sourceReceipt: { ...base.sourceReceipt, sources: [...base.sourceReceipt.sources, ...official.sourceReceipt.sources] },
    payload: { ...base.payload, bodyRosters: official.payload.bodyRosters, registry: { ...base.payload.registry,
      bodies: base.payload.registry.bodies.map(body => official.payload.registry.bodies.find(row => row.id === body.id) ?? body) } } };
  const news = { ...capture(page("Contact the Mayor & Council").replaceAll("5205551000", "5205552000").replaceAll("555-1000", "555-2000"), "https://news.example/council", NOW),
    sourcePolicy: { hosts: { "news.example": "NEWS" as const }, enabled: { OFFICIAL: true, CAMPAIGN: true, FILING: true, VOTER_GUIDE: true, FORUM: true, NEWS: true, REFERENCE: true, OTHER: true } } };
  const result = workerRosterPublication({ bodyId: BODY, reading: reading(news), prior: held, now: NOW });
  assert.ok(result.payload.bodyRosters[0].members.every(member => member.phone === "(520) 555-1000"));
  assert.ok(result.excludedFacts?.some(fact => fact.code === "CONFLICT_SUPERSEDED" && (fact.record as { value: string }).value === "(520) 555-2000"));
});
