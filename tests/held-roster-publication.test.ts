import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readRegistryRuntimePrior, type RegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { readHeldRoster } from "../lib/civic-data/worker-held-roster.ts";
import { heldRosterReading, pageIsAboutBody, publishBodyRoster, type RosterReading, type WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { withFactRegistry } from "../lib/facts/registry-overlay.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = join(import.meta.dirname, "..");
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
const clocks = factClocks(null);

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

async function setup() {
  const [base, facts] = await Promise.all([prior(), factDb()]);
  await ensureFactEntities(facts, ROOT, ["az"]);
  const body = base.payload.registry.bodies.find(row => row.id === BODY)!;
  const division = new Map(base.payload.registry.divisions.map(row => [row.ocdId, row])).get(body.ocdId!)!;
  const publish = (reading: RosterReading) => publishBodyRoster(facts, { body, division, state: "AZ", reading, clocks, now: new Date(NOW) });
  return { base, facts, body, publish };
}

const reading = (saved: WorkerPublicationCapture, complete = true, id = `held:${saved.evidence.artifactId}`): RosterReading => ({ id, capture: saved, linkingPage: null, complete, method: "fixture",
  members: readHeldRoster(saved.evidence.text, saved.evidence.canonicalUrl)!.rows.map((row, i) => ({ recordId: `r${i}`, fields: { ...row } })) });
const names = async (facts: Awaited<ReturnType<typeof factDb>>) => (await readFactRosters(facts.query, [BODY])).rosters[0]?.members.map(m => m.name).sort() ?? [];

test("plain code reads a CMS staff-directory roster once, with display names and relative bio links", () => {
  const roster = readHeldRoster(page("Contact the Mayor & Council"), URL_)!;
  assert.equal(roster.complete, true);
  assert.deepEqual(roster.rows.map(row => [row.name, row.office, row.phone]), [
    ["Clea McCaa II", "Mayor", "(520) 555-1000"], ["Carolyn Flowers", "Vice Mayor", "(520) 555-1000"], ["Faye Jackson", "Council Member", "(520) 555-1000"]]);
  assert.equal(roster.rows[0].websiteUrl, "https://www.bensonaz.gov/Home/Components/StaffDirectory/StaffDirectory/1/128");
  assert.equal(readHeldRoster("<table><tr><th>Name</th><th>Phone</th></tr><tr><td>A</td><td>1</td></tr></table>", URL_), null, "a table without a seat column is not a roster");
});

test("a saved official page puts an unnamed council live with its name, seats, office phone and source link (§3)", async () => {
  const { base, facts, publish } = await setup();
  assert.equal(base.payload.registry.bodies.find(body => body.id === BODY)?.name, null);
  const held = capture(page("Contact the Mayor & Council"));
  const found = await heldRosterReading({ bodyId: BODY, prior: base, now: NOW, readHeld: async () => held,
    artifacts: [{ artifactId: held.evidence.artifactId, workItemId: "wi-directory", routeTaskId: null, attemptId: "at-scout", tier: "RAW", contentHash: held.evidence.contentHash,
      byteLength: held.evidence.text.length, contentType: "text/html; charset=utf-8", canonicalUrl: URL_, partial: false, recordedAt: held.observedAt } as ArtifactRecord] });
  assert.ok(found);
  const tally = await publish(found);
  assert.deepEqual(await facts.query("SELECT entity_id, field, reason FROM blank"), []);
  const seen = await withFactRegistry(base.payload, facts.query);
  const council = seen.registry.bodies.find(body => body.id === BODY)!;
  assert.equal(council.name, "Benson City Council");
  assert.equal(council.bodyOrigin, "SOURCED");
  assert.equal(council.provenance.sourceUrl, URL_);
  const roster = seen.bodyRosters.find(row => row.bodyId === BODY)!;
  assert.equal(roster.sourceUrl, URL_);
  assert.deepEqual(roster.members.map(m => [m.name, m.officeTitle, m.phone, m.contactScope]).sort(), [
    ["Carolyn Flowers", "Vice Mayor", "(520) 555-1000", "SHARED_OFFICE"], ["Clea McCaa II", "Mayor", "(520) 555-1000", "SHARED_OFFICE"], ["Faye Jackson", "Council Member", "(520) 555-1000", "SHARED_OFFICE"]]);
  assert.ok(roster.members.every(m => m.websiteUrl?.startsWith("https://www.bensonaz.gov/Home/Components/StaffDirectory/")));
});

test("another body's page and a stale page never publish; each leaves a blank with its reason", async () => {
  const { facts, body, publish } = await setup();
  assert.equal(pageIsAboutBody(page("Boards"), body, "Benson"), false, "a boards page's members are not the council");
  await assert.rejects(publish(reading(capture(page("Boards")))), /ROSTER_PAGE_NOT_THIS_BODY/);
  const stale = await publish(reading(capture(page("Contact the Mayor & Council"), URL_, "2026-07-01T00:00:00.000Z")));
  assert.equal(stale.live, 0);
  assert.deepEqual(await names(facts), []);
  const reasons = new Set((await facts.query("SELECT reason FROM blank")).map(row => String(row.reason)));
  assert.deepEqual([...reasons].sort(), ["CHECK_FAILED:COPY_OUTSIDE_FRESHNESS_WINDOW", "ROSTER_PAGE_NOT_THIS_BODY"]);
});

test("a complete official roster retires who it no longer lists; a partial page or a single profile adds without retiring", async () => {
  const { facts, publish } = await setup();
  await publish(reading(capture(page("Contact the Mayor & Council"))));
  const smaller = capture(page("Contact the Mayor & Council", member(1, "McCaa II, Clea", "Mayor") + member(2, "Flowers, Carolyn", "Vice Mayor")), URL_, "2026-09-29T10:00:00.000Z");
  assert.equal((await publish(reading(smaller, false))).departed, 0);
  assert.deepEqual(await names(facts), ["Carolyn Flowers", "Clea McCaa II", "Faye Jackson"]);
  const profile = capture(page("Contact the Mayor & Council", member(9, "Rivera, Ana", "Council Member")), URL_.replace("contact-the-mayor-council", "ana-rivera"));
  await publish({ id: "held:profile", capture: profile, linkingPage: null, complete: false, method: "fixture profile page",
    members: [{ recordId: "p1", fields: { name: "Ana Rivera", nameAsWritten: "Rivera, Ana", office: "Council Member" } }] });
  assert.deepEqual(await names(facts), ["Ana Rivera", "Carolyn Flowers", "Clea McCaa II", "Faye Jackson"]);
  assert.equal((await publish(reading(smaller))).departed, 1);
  assert.deepEqual(await names(facts), ["Ana Rivera", "Carolyn Flowers", "Clea McCaa II"], "only the page that listed her retires her");
});

test("CP-08: a newer news phone cannot replace the official phone, and its losing value is kept", async () => {
  const { facts, publish } = await setup();
  await publish(reading(capture(page("Contact the Mayor & Council"))));
  const news = { ...capture(page("Contact the Mayor & Council").replaceAll("5205551000", "5205552000").replaceAll("555-1000", "555-2000"), "https://news.example/council", NOW),
    sourcePolicy: { hosts: { "news.example": "NEWS" as const }, enabled: { OFFICIAL: true, CAMPAIGN: true, FILING: true, VOTER_GUIDE: true, FORUM: true, NEWS: true, REFERENCE: true, OTHER: true } } };
  await publish(reading(news));
  const { rosters } = await readFactRosters(facts.query, [BODY]);
  assert.ok(rosters[0]!.members.every(m => m.phone === "(520) 555-1000"));
  assert.ok(rosters[0]!.members.every(m => m.fieldSources?.phone?.sourceUrl === URL_));
  const lost = await facts.query("SELECT value, held_reason FROM fact WHERE field = 'phone' AND status = 'held'");
  assert.ok(lost.length > 0 && lost.every(row => row.value === "(520) 555-2000" && row.held_reason === "LOSES_TO_CURRENT"));
});

test("a reused seat id on the page never renames the prior person or hands over their contact", async () => {
  const { facts, publish } = await setup();
  const row = (written: string) => member(1, written, "Mayor").replace("<tr>", `<tr data-person-id="seat-1">`);
  const one = (written: string, name: string, extra: Record<string, unknown>) => ({ id: `held:${name}`, linkingPage: null, complete: true, method: "fixture",
    capture: capture(page("Contact the Mayor & Council", row(written))), members: [{ recordId: name, fields: { name, nameAsWritten: written, office: "Mayor", id: "seat-1", ...extra } }] });
  await publish(one("McCaa II, Clea", "Clea McCaa II", { phone: "(520) 555-1000" }));
  const [clea] = (await readFactRosters(facts.query, [BODY])).rosters[0]!.members;
  await publish(one("Rivera, Ana", "Ana Rivera", {}));
  const members = (await readFactRosters(facts.query, [BODY])).rosters[0]!.members;
  const ana = members.find(m => m.name === "Ana Rivera")!;
  assert.notEqual(ana.personId, clea!.personId);
  assert.equal(ana.phone, null, "the predecessor's contact never crosses to the successor");
  assert.deepEqual(members.map(m => m.name), ["Ana Rivera"], "the complete page retires the predecessor");
});

test("CP-19/CP-05: another roster row's term cannot supply a date", async () => {
  const { facts, publish } = await setup();
  const held = capture(page("Contact the Mayor & Council", member(1, "McCaa II, Clea", "Mayor") + member(2, "Flowers, Carolyn", "Vice Mayor").replace("</tr>", "<td>2030-12-31</td></tr>")));
  const first = readHeldRoster(held.evidence.text, URL_)!.rows[0];
  await publish({ id: "held:wrong-term", capture: held, linkingPage: null, complete: false, method: "fixture",
    members: [{ recordId: "person", fields: { ...first, termEnd: "2030-12-31" }, fieldSources: { termEnd: { sourceUrl: URL_, sourceOrg: "Clerk", collectedAt: held.observedAt, verifiedAt: NOW, quote: "2030-12-31", kind: "OFFICIAL" } } }] });
  const { rosters } = await readFactRosters(facts.query, [BODY]);
  assert.equal(rosters[0]!.members[0]!.termEnd, null);
  assert.deepEqual(await facts.query("SELECT stage, reason FROM blank WHERE field LIKE 'term_end:%'"), [{ stage: "CHECK", reason: "TERM_QUOTE_NOT_ABOUT_MEMBER" }]);
});

test("CP-03: a labeled voter-guide roster is considered from held evidence and publishes as reference, never as official", async () => {
  const { base, facts, publish } = await setup();
  await facts.query("UPDATE entity SET name = 'Benson City Council' WHERE id = $1", [BODY]);
  const saved = { ...capture(page("Contact the Mayor & Council").replace("<h1>", "<p>Benson City Council, Arizona</p><h1>"), "https://vote411.org/council"), sourcePolicy: { hosts: { "vote411.org": "VOTER_GUIDE" as const }, enabled: { OFFICIAL: true, CAMPAIGN: true, FILING: true, VOTER_GUIDE: true, FORUM: true, NEWS: true, REFERENCE: true, OTHER: true } } };
  const artifacts = [{ artifactId: saved.evidence.artifactId, contentHash: saved.evidence.contentHash, contentType: "text/html", canonicalUrl: saved.evidence.canonicalUrl, recordedAt: saved.observedAt, partial: false } as ArtifactRecord];
  const found = await heldRosterReading({ bodyId: BODY, prior: base, now: NOW, artifacts, readHeld: async () => saved });
  assert.ok(found);
  await publish(found);
  assert.deepEqual([...new Set((await facts.query("SELECT provenance_kind FROM fact WHERE field LIKE 'member:%'")).map(row => row.provenance_kind))], ["REFERENCE"]);
  assert.equal((await readFactRosters(facts.query, [BODY])).rosters[0]!.members.length, 3);
  const disabled = { ...saved, sourcePolicy: { ...saved.sourcePolicy, enabled: { ...saved.sourcePolicy.enabled, VOTER_GUIDE: false } } };
  assert.equal(await heldRosterReading({ bodyId: BODY, prior: base, now: NOW, artifacts, readHeld: async () => disabled }), null);
});
