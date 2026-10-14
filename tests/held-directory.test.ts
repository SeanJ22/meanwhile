import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import test from "node:test";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate, type RegistryRuntimePrior, type RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { readHeldDirectory } from "../lib/civic-data/worker-held-directory.ts";
import { heldDirectoryReading, workerBodyDirectoryPackage } from "../lib/civic-data/worker-body-directory.ts";
import { jurisdictionDiscoveryPlan, type AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { Jurisdiction } from "../lib/hunt/jurisdiction-universe.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { workerPublicationTasks } from "../lib/civic-data/worker-publication-tasks.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { CENSUS_PLACEHOLDER_LABELS } from "../lib/registry/census-placeholders.ts";

const NOW = "2026-09-29T20:00:00.000Z";
const DIVISION = "ocd-division/country:us/state:az/place:benson";
const URL_ = "https://www.bensonaz.gov/government/commissions-boards-committees/commissions";
const section = (name: string) => `<div class='accordion-item'><div class='accordion-heading' role='button'><div class='title'>${name}</div></div>` +
  `<div class='accordion-content'><p>Members are appointed by the City Council.</p><table><tr><th>Member</th><th>Term Expires</th></tr></table></div></div>`;
const page = (title: string, body: string) => `<html><head><title> ${title} | City of Benson, AZ </title></head><body>` +
  `<nav><a href="/government/city-council">City Council</a><a href="/boards">Boards</a><h3>Planning Commission</h3></nav>` +
  `<h1 class="titlewidget-title">${title}</h1><p>The City of Benson welcomes citizen involvement.</p>${body}<footer><h2>Quick Links</h2></footer></body></html>`;
const COMMISSIONS = page("Commissions", section("Planning &amp; Zoning Commission") + section("Commission on Disability Issues") + section("Tourism Commission") +
  "<h2>Agendas &amp; Minutes</h2><h2>Commissions</h2>");
const BOARDS = page("Boards", section("Fire Pension Board") + section("Employee Benefit Trust"));

function capture(html: string, url: string, observedAt = "2026-09-28T22:06:04.940Z"): WorkerPublicationCapture {
  const contentHash = `sha256-${createHash("sha256").update(html).digest("hex")}`;
  return { evidence: { artifactId: `ar-${contentHash.slice(7, 31)}`, contentHash, text: html, acquiredByAttemptId: "at-scout", canonicalUrl: url,
    retrievedAt: observedAt, sourceId: new URL(url).hostname, methodRouteId: "scout:fetch_public" }, observedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
}
const artifact = (c: WorkerPublicationCapture) => ({ artifactId: c.evidence.artifactId, workItemId: "wi-directory", routeTaskId: null, attemptId: "at-scout", tier: "RAW",
  contentHash: c.evidence.contentHash, byteLength: c.evidence.text.length, contentType: "text/html; charset=utf-8", canonicalUrl: c.evidence.canonicalUrl,
  partial: false, recordedAt: c.observedAt }) as ArtifactRecord;

async function prior(): Promise<RegistryRuntimePrior> {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  return (await readRegistryRuntimePrior(store, NOW))!;
}
const benson: Jurisdiction = { id: "az:city:city-of-benson", stateCode: "AZ", name: "City of Benson", govClass: "CITY", countyName: "Cochise",
  enumeratedFrom: "fixture", ownWebAddress: "https://www.bensonaz.gov/", sourceIds: [], ocdId: DIVISION } as unknown as Jurisdiction;
/** A body-directory work item's plan, in the shape such items carry. */
function directoryPlan(jurisdiction: Jurisdiction, bodyId: string): AutonomousWorkPlan {
  const routeId = "coverage-discovery:body-directory";
  const base = jurisdictionDiscoveryPlan(jurisdiction, { recordClass: "OFFICEHOLDERS", authority: jurisdiction.name,
    authorityBasis: "Discover governing and subordinate bodies from official directory and independent legal authority.",
    scope: "THIS_JURISDICTION", routeId, url: jurisdiction.ownWebAddress, state: "DISCOVERY_OWED",
    owed: "Identify every governing and subordinate body.", citation: `Registered government ${jurisdiction.id}.` }, routeId, bodyId)!;
  if (base.contract.schemaVersion !== 2) throw new Error("DIRECTORY_TEMPLATE_INVALID");
  return { ...base, capability: "governments/body-directory",
    directorySubject: { jurisdiction, divisionId: jurisdiction.ocdId ?? null },
    publication: { contractId: "registry-runtime-bindings", bodyId },
    contract: { ...base.contract, recordClass: "OFFICIAL_BOARD_DIRECTORY",
      requiredFields: ["bodyName", "bodyClass", "homepageUrl", "jurisdictionName", "coverage", "coverageEvidence"],
      identity: { namespace: `${jurisdiction.id}:body-directory`, keyFields: ["bodyName", "homepageUrl"] } } };
}
const plan = directoryPlan(benson, `${DIVISION}#governing`);

test("plain code reads each body a saved Boards or Commissions page lists, and nothing from its navigation", () => {
  assert.deepEqual(readHeldDirectory(COMMISSIONS), [
    { bodyName: "Planning & Zoning Commission", bodyClass: "Commission" },
    { bodyName: "Commission on Disability Issues", bodyClass: "Commission" },
    { bodyName: "Tourism Commission", bodyClass: "Commission" }]);
  assert.deepEqual(readHeldDirectory(BOARDS)?.map(row => [row.bodyName, row.bodyClass]), [["Fire Pension Board", "Advisory"], ["Employee Benefit Trust", "Advisory"]]);
  assert.equal(readHeldDirectory(page("Contact the Mayor & Council", section("Tourism Commission"))), null, "a page that is not a directory lists no bodies");
});

test("a government's saved directory pages put its boards and commissions on the reader path with their source page (§3)", async () => {
  const base = await prior();
  const pages = [capture(COMMISSIONS, URL_), capture(BOARDS, URL_.replace("commissions", "boards"))];
  const held = new Map(pages.map(c => [c.evidence.artifactId, c]));
  const reading = await heldDirectoryReading({ plan, prior: base, now: NOW, artifacts: pages.map(artifact), readHeld: async a => held.get(a.artifactId) ?? null });
  assert.ok(reading);
  const { prepared, unresolved } = workerBodyDirectoryPackage({ plan, held: reading, prior: base, now: NOW });
  assert.deepEqual(unresolved, []);
  const model = registryRuntimeCandidate(prepared, { prior: base }).readModel as RegistryRuntimeReadModel;
  const listed = model.registry.bodies.filter(body => body.sourceDataset === "GOV_DIRECTORY" && body.ocdId === DIVISION);
  assert.deepEqual(listed.map(body => [body.name, body.bodyClass, body.provenance.sourceUrl]).sort(), [
    ["Commission on Disability Issues", "COMMISSION", URL_], ["Employee Benefit Trust", "ADVISORY", URL_.replace("commissions", "boards")],
    ["Fire Pension Board", "ADVISORY", URL_.replace("commissions", "boards")], ["Planning & Zoning Commission", "COMMISSION", URL_], ["Tourism Commission", "COMMISSION", URL_]]);
});

test("a directory page outside its freshness window, from another government or off an official site stays owed", async () => {
  const base = await prior();
  const read = (c: WorkerPublicationCapture) => heldDirectoryReading({ plan, prior: base, now: NOW, artifacts: [artifact(c)], readHeld: async () => c });
  assert.equal(await read(capture(COMMISSIONS, URL_, "2026-07-01T00:00:00.000Z")), null);
  assert.equal(await read(capture(COMMISSIONS.replaceAll("Benson", "Bisbee"), URL_)), null);
  assert.equal(await read(capture(COMMISSIONS, "https://bensonaz.example.com/commissions")), null);
});

test("the runner offers a directory with no extraction yet, hourly, so its saved pages are read in code", () => {
  const item = { id: "wi-directory", autonomousPlan: plan } as unknown as WorkItem;
  const [task] = workerPublicationTasks([item], [], NOW);
  assert.equal(task?.id, "worker-publication:registry-runtime-bindings:wi-directory");
  assert.equal(task?.registeredContractId, "registry-runtime-bindings");
  assert.match(task.command.at(-1)!, /--worker-rosters=wi-directory$/);
  const siblings = workerPublicationTasks([item, { ...item, id: "wi-other-body" }], [], NOW);
  assert.equal(siblings.length, 2, "independent body work cannot share one publisher command");
  assert.equal(new Set(siblings.map(job => job.acquisitionFailureDomain)).size, 2);
  assert.deepEqual(siblings.map(job => job.command.at(-1)), ["--worker-rosters=wi-directory", "--worker-rosters=wi-other-body"]);
  assert.deepEqual(workerPublicationTasks([{ ...item, publicationOutcome: { at: "2026-09-29T19:30:00.000Z" } } as unknown as WorkItem], [], NOW), [], "not again within the hour");
});

test("each board's own section gives its regular schedule in the page's words; another board's schedule never crosses over", async () => {
  const scheduled = (name: string, schedule: string) => section(name).replace("<p>Members are appointed", `<p>${schedule}</p><p>Members are appointed`);
  const html = page("Commissions", scheduled("Neighborhoods Commission", "The commission meets on the second Monday of each month at 4:30 p.m. in City Hall.") +
    scheduled("Tourism Commission", "The commission meets quarterly.") + section("Planning &amp; Zoning Commission"));
  assert.deepEqual(readHeldDirectory(html)?.map(row => [row.bodyName, row.meetingCadence ?? null]), [
    ["Neighborhoods Commission", "The commission meets on the second Monday of each month at 4:30 p.m. in City Hall."],
    ["Tourism Commission", null], ["Planning & Zoning Commission", null]], "\"quarterly\" names no day or time, so it is not a schedule");
  const base = await prior();
  const saved = capture(html, URL_);
  const reading = await heldDirectoryReading({ plan, prior: base, now: NOW, artifacts: [artifact(saved)], readHeld: async () => saved });
  const model = registryRuntimeCandidate(workerBodyDirectoryPackage({ plan, held: reading!, prior: base, now: NOW }).prepared, { prior: base }).readModel as RegistryRuntimeReadModel;
  const neighborhoods = model.registry.bodies.find(body => body.name === "Neighborhoods Commission")!;
  assert.deepEqual([neighborhoods.meetingCadence, neighborhoods.provenance.sourceUrl], ["The commission meets on the second Monday of each month at 4:30 p.m. in City Hall.", URL_]);
  assert.equal(model.registry.bodies.find(body => body.name === "Tourism Commission")?.meetingCadence, null);
});

test("a board's schedule publishes through the registry door itself, not only into a candidate", async () => {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  // Replay the deployed Census placeholder correction the recorded fixture predates (as the roster tests do).
  const imported = (await readRegistryRuntimePrior(store, NOW))!;
  const divisions = imported.payload.registry.divisions.filter(row => CENSUS_PLACEHOLDER_LABELS[row.label]).map(row => ({ ...row, label: CENSUS_PLACEHOLDER_LABELS[row.label] }));
  const corrected = registryRuntimeCandidate({ contractId: "registry-runtime-bindings", version: "fixture-census-correction", sourceThrough: NOW,
    sourceReceipt: { contractVersion: 1, reviewedAt: NOW, reviewedBy: "recorded-fixture-control", sources: [...new Set(divisions.map(row => row.provenance!.sourceUrl!))].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "U.S. Census Bureau", sourceClass: "OFFICIAL_PUBLISHER" as const, retrievedAt: NOW, httpStatus: 200, rawHash: createHash("sha256").update(JSON.stringify(divisions)).digest("hex"), reviewedEvidence: "Offline fixture: Census LEA 99997 means no school district." })) },
    payload: { ...imported.payload, registry: { ...imported.payload.registry, divisions, bodies: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { ...imported.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior: imported });
  assert.ok((await processRegisteredManualCandidate(store, "registry-runtime-bindings", corrected, NOW, imported.versionId)).promoted);
  const base = (await readRegistryRuntimePrior(store, NOW))!;
  const html = page("Commissions", section("Neighborhoods Commission").replace("<p>Members are appointed",
    "<p>The commission meets on the second Monday of each month at 4:30 p.m. in City Hall.</p><p>Members are appointed"));
  const saved = capture(html, URL_);
  const reading = await heldDirectoryReading({ plan, prior: base, now: NOW, artifacts: [artifact(saved)], readHeld: async () => saved });
  const candidate = registryRuntimeCandidate(workerBodyDirectoryPackage({ plan, held: reading!, prior: base, now: NOW }).prepared, { prior: base });
  const published = await processRegisteredManualCandidate(store, "registry-runtime-bindings", candidate, NOW, base.versionId);
  assert.ok(published.promoted, published.candidate.failureDetail ?? "held at the door");
  const after = (await readRegistryRuntimePrior(store, NOW))!;
  assert.equal(after.payload.registry.bodies.find(body => body.name === "Neighborhoods Commission")?.meetingCadence,
    "The commission meets on the second Monday of each month at 4:30 p.m. in City Hall.");
});

test("a board's office address and phone attach from its own section, with the page as source; another board's never crosses over", async () => {
  const contact = (name: string, text: string) => section(name).replace("<p>Members are appointed", `<p>${text}</p><p>Members are appointed`);
  const html = page("Commissions", contact("Neighborhoods Commission", "Office: 120 W Main Street, Benson, AZ 85602. Phone: (520) 555-0142.") +
    section("Tourism Commission"));
  assert.deepEqual(readHeldDirectory(html)?.map(row => [row.bodyName, row.officeAddress ?? null, row.officePhone ?? null]), [
    ["Neighborhoods Commission", "120 W Main Street, Benson, AZ 85602", "(520) 555-0142"], ["Tourism Commission", null, null]]);
  const base = await prior();
  const saved = capture(html, URL_);
  const reading = await heldDirectoryReading({ plan, prior: base, now: NOW, artifacts: [artifact(saved)], readHeld: async () => saved });
  const model = registryRuntimeCandidate(workerBodyDirectoryPackage({ plan, held: reading!, prior: base, now: NOW }).prepared, { prior: base }).readModel as RegistryRuntimeReadModel;
  const neighborhoods = model.registry.bodies.find(body => body.name === "Neighborhoods Commission")!;
  assert.deepEqual([neighborhoods.officeAddress, neighborhoods.officePhone, neighborhoods.provenance.sourceUrl], ["120 W Main Street, Benson, AZ 85602", "(520) 555-0142", URL_]);
  const tourism = model.registry.bodies.find(body => body.name === "Tourism Commission")!;
  assert.equal(tourism.officeAddress, undefined);
  assert.equal(tourism.officePhone, undefined);
});
