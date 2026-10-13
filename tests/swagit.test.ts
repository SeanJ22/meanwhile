import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSwagitMeetings, makeSwagitSource } from "../lib/sources/swagit/index.ts";
import { buildCompositeSource } from "../lib/sources/composite/wiring.ts";
import { bodySourceWiringFor } from "../lib/civic-data/derived-meeting-wiring.ts";
import { buildDerivedFamily } from "../lib/civic-data/derived-meeting-family.ts";
import { meetingAcquisitionFailureDomain } from "../lib/civic-data/meeting-partitions.ts";
import { crosswalkRowIssue } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { reviewDiscoveryWalk, type HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { wiringRowFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { firstLook, probeUrlFor } from "../lib/doors/probe.ts";
import { fixtureDoorRecords } from "./helpers/meeting-doors-fixture.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/swagit/${name}.html`, import.meta.url), "utf8");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const ALLOW: RecordedReply = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" };
const TENANTS = [
  { name: "chandler", host: "chandleraz.new.swagit.com", view: "155/", state: "AZ", county: "04013", body: "City Council", bodyMatch: "Chandler City Council Meetings", timeZone: "America/Phoenix", at: "2020-10-17T00:00:00Z", expected: 8 },
  { name: "tamarac", host: "tamaracfl.new.swagit.com", view: "12", state: "FL", county: "12011", body: "City Commission", bodyMatch: "City Commission", timeZone: "America/New_York", at: "2019-10-19T00:00:00Z", expected: 2 },
  { name: "houston", host: "houstontx.new.swagit.com", view: "408", state: "TX", county: "48201", body: "City Council", bodyMatch: "City Council Meetings", timeZone: "America/Chicago", at: "2022-05-18T00:00:00Z", expected: 6 },
] as const;

function wiring(tenant: typeof TENANTS[number], bodyMatch: string = tenant.bodyMatch): BodySourceWiring {
  const ocdId = `ocd-division/country:us/state:${tenant.state.toLowerCase()}/place:${tenant.name}`;
  return { bodyId: `${ocdId}#governing`, ocdId, agendaSourceType: "SWAGIT", timeZone: tenant.timeZone,
    jurisdiction: `${tenant.name}, ${tenant.state}`, publishingOrg: `City of ${tenant.name}`, verifiedAt: tenant.at,
    config: { portalUrl: `https://${tenant.host}/views/${tenant.view}`, bodyMatch, bodyName: tenant.body, slug: tenant.name } };
}

async function reviewCalendar(tenant: typeof TENANTS[number], calendar: string, names: readonly string[] = [tenant.body]) {
  const route = wiring(tenant).config.portalUrl;
  const home = `https://${tenant.name}.example.gov/`;
  const held = new Map<string, HeldBytes>();
  const ocdId = wiring(tenant).ocdId!;
  const attempt = await walkMeetingsDiscoveryNeed({ jurisdictionId: `${tenant.state.toLowerCase()}:city:city-of-${tenant.name}`,
    stateCode: tenant.state, countyFips: tenant.county, name: `City of ${tenant.name}`, govClass: "CITY_OR_TOWN",
    ownWebAddress: home, basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "OPERATIONAL_REFERENCE", versionId: "fixture" } }, {
    open: recordedDiscoveryOpen({ [home]: { status: 200, body: `<h1>${names.join("; ")}</h1><a href="${route}">${tenant.body} meetings</a>` },
      [`${home}robots.txt`]: ALLOW, [`https://${tenant.host}/robots.txt`]: ALLOW, [route]: { status: 200, body: calendar } }),
    readOfficialPages: async () => [{ canonicalUrl: "https://fixture-directory.gov/governments", text: `<a href="${home}">City of ${tenant.name}</a>` }],
    spaceOut: async () => {}, now: () => tenant.at, budget: { spent: () => false },
    vault: async (artifact, bytes) => {
      held.set(artifact.id, { text: bytes, sha256: sha(bytes), evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id,
        contentHash: artifact.contentHash, tier: "RAW", retrievedAt: artifact.retrievedAt } });
      return { stored: true, where: "source fixture", why: "held" };
    },
  });
  assert.ok(attempt.found.some(find => find.vendor === "swagit" && find.url === route));
  const review = reviewDiscoveryWalk({ walk: { attempt, recordId: "walk", recordedAt: tenant.at },
    registered: { bodyId: `${ocdId}#governing`, ocdId, publishingOrg: `City of ${tenant.name}`, countyFips: tenant.county,
      input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: `US-${tenant.state}:registration:v1`,
        versionId: "registration", readModelSha256: "a".repeat(64), promotedAt: tenant.at } },
    held: id => held.get(id) ?? null, handWired: () => false, reviewer: "auto-crosswalk-reviewer@0123456789ab", now: tenant.at });
  return { review, route, ocdId };
}

for (const tenant of TENANTS) test(`${tenant.state} real Swagit list binds its governing body and reaches the Reader family`, async () => {
  const calendar = fixture(tenant.name);
  const { review, route, ocdId } = await reviewCalendar(tenant, calendar);
  const reviewed = review.accepted.find(entry => entry.row.bodyId === `${ocdId}#governing`);
  assert.ok(reviewed, JSON.stringify(review.held));
  assert.equal(crosswalkRowIssue(reviewed.row), null);
  const row = wiringRowFor(reviewed.row);
  assert.equal(row.kind, "SWAGIT");
  assert.equal(row.config.bodyMatch, tenant.bodyMatch);
  assert.equal(row.timeZone, tenant.timeZone);
  const source = buildCompositeSource({ sourceNames: ["swagit"], derivedRows: [bodySourceWiringFor(row)], captureAcquisitionEvidence: true,
    fetchImpl: meetingFetchPass({ fetchImpl: (async () => new Response(calendar, { headers: { "content-type": "text/html" } })) as typeof fetch }) });
  const raw = await source.fetch({ lat: 39, lng: -98, radiusKm: 5000 });
  const meetings = source.normalize(raw, new Date(tenant.at));
  assert.equal(meetings.length, tenant.expected);
  assert.ok(meetings.every(meeting => meeting.bodyId === row.bodyId && meeting.provenance.sourceUrl === route));
  assert.equal(source.lastReport?.children[0].ok, true);
  const acquisitions = source.lastReport!.children[0].acquisitions!;
  assert.ok(acquisitions.length > 0);
  const member = { id: `${row.bodyId}:swagit`, status: "ACTIVE" as const, row };
  const family = buildDerivedFamily({ wiringInput: { kind: "PROMOTED_VERSION", recordClass: "SOURCE_WIRING",
    scope: "US:meeting-source-wiring:v1", versionId: "wiring", readModelSha256: "b".repeat(64), promotedAt: tenant.at },
    members: [member], reads: [{ member, acquisitions, ok: true, error: null, freshMeetings: meetings, freshAgendaDocuments: [], retrievedAt: tenant.at }],
    previous: null, generatedAt: tenant.at, reconcile: read => ({ meetings: read.freshMeetings, agendaDocuments: [], removalEvidence: [] }) });
  assert.equal(family.snapshot.meetings.length, tenant.expected);
  assert.equal(family.snapshot.derivedMembers?.[0].outcome, "FRESH");
  assert.ok(family.snapshot.meetings.every(meeting => meeting.publishedLinks?.some(link => link.label === "Video")));
  assert.equal(meetingAcquisitionFailureDomain("swagit", bodySourceWiringFor(row)), `meeting-upstream:${tenant.host}`);
});

test("a real commission inside Chandler's council section binds and publishes separately", async () => {
  const tenant = TENANTS[0];
  const calendar = fixture(tenant.name);
  const { review } = await reviewCalendar(tenant, calendar);
  const council = review.accepted.find(entry => entry.row.bodyRole === "GOVERNING");
  const commission = review.accepted.find(entry => entry.row.bodyName === "Housing Authority Commission");
  assert.ok(council && commission, JSON.stringify(review.held));
  assert.equal(council.row.evidence.calendar.selected, 8);
  assert.equal(commission.row.evidence.calendar.selected, 4);
  assert.notEqual(council.row.bodyId, commission.row.bodyId);
  const rows = [council, commission].map(entry => wiringRowFor(entry.row));
  let reads = 0;
  const source = buildCompositeSource({ sourceNames: ["swagit"], derivedRows: rows.map(bodySourceWiringFor), captureAcquisitionEvidence: true,
    fetchImpl: meetingFetchPass({ fetchImpl: (async () => { reads++; return new Response(calendar); }) as typeof fetch }) });
  const meetings = source.normalize(await source.fetch({ lat: 33, lng: -111, radiusKm: 20 }), new Date(tenant.at));
  assert.equal(reads, 1);
  assert.equal(meetings.filter(meeting => meeting.bodyId === council.row.bodyId).length, 8);
  assert.deepEqual(meetings.filter(meeting => meeting.bodyId === commission.row.bodyId).map(meeting => meeting.id.split("/").at(-1)).sort(),
    ["70828", "73733", "74511", "75000"]);
  assert.ok(meetings.filter(meeting => meeting.bodyId === council.row.bodyId).every(meeting => !/Authority/.test(meeting.title)));
  const members = rows.map(row => ({ id: `${row.bodyId}:swagit`, status: "ACTIVE" as const, row }));
  const family = buildDerivedFamily({ wiringInput: { kind: "PROMOTED_VERSION", recordClass: "SOURCE_WIRING", scope: "US:meeting-source-wiring:v1",
    versionId: "wiring", readModelSha256: "b".repeat(64), promotedAt: tenant.at }, members,
    reads: members.map(member => ({ member, acquisitions: source.lastReport!.children[0].acquisitions!, ok: true, error: null,
      freshMeetings: meetings.filter(meeting => meeting.bodyId === member.row.bodyId), freshAgendaDocuments: [], retrievedAt: tenant.at })),
    previous: null, generatedAt: tenant.at, reconcile: read => ({ meetings: read.freshMeetings, agendaDocuments: [], removalEvidence: [] }) });
  assert.equal(family.snapshot.meetings.length, 12);
  assert.ok(family.snapshot.derivedMembers?.every(member => member.outcome === "FRESH"));
});

test("Swagit preserves the publisher's date column and minute precision only where a start time is printed", () => {
  const houston = parseSwagitMeetings(fixture("houston"), wiring(TENANTS[2]).config.portalUrl);
  assert.equal(houston[0].title, "Council Meeting (May 17 & May 18, 2022)");
  assert.equal(houston[0].date, "2022-05-17");
  const own = wiring(TENANTS[0]);
  const source = makeSwagitSource([own]);
  const output = source.normalizeWithDrops([{ wiring: own, pages: [{ url: own.config.portalUrl, text: fixture("chandler") }], collectedAt: TENANTS[0].at }], new Date(TENANTS[0].at));
  const future = output.meetings.find(meeting => meeting.id.endsWith("events/5754"))!;
  assert.equal(future.startsAt, "2020-11-02T18:00:00-07:00");
  assert.equal(future.startPrecision, "MINUTE");
  assert.equal(future.agendaUrl, null);
  const past = output.meetings.find(meeting => meeting.id.endsWith("videos/87288"))!;
  assert.equal(past.startPrecision, "DAY");
  assert.equal(past.agendaUrl, "https://chandleraz.new.swagit.com/videos/87288/agenda");
  assert.equal(past.videoUrl, "https://chandleraz.new.swagit.com/videos/87288");
  assert.equal(future.videoUrl, undefined);
  assert.equal(output.accounting.outcome, "CONSERVED");
  assert.equal(output.drops.notConfigured, 11);
});

test("one Swagit portal read serves multiple bodies and the standing probe recognizes its page", async () => {
  const first = wiring(TENANTS[1]);
  const second = { ...first, bodyId: `${first.ocdId}#planning`, config: { ...first.config, bodyName: "Planning Board", bodyMatch: "Planning Board" } };
  let reads = 0;
  const source = makeSwagitSource([first, second], (async () => { reads++; return new Response(fixture("tamarac")); }) as typeof fetch);
  const raw = await source.fetch({ lat: 26, lng: -80, radiusKm: 20 });
  const output = source.normalizeWithDrops(raw, new Date(TENANTS[1].at));
  assert.equal(reads, 1);
  assert.equal(output.meetings.filter(meeting => meeting.bodyId === second.bodyId).length, 1);
  const door = fixtureDoorRecords([first])[0];
  assert.equal(probeUrlFor(door), first.config.portalUrl);
  const changed = await firstLook(first.config.portalUrl, null, async () => ({ status: 200, headers: new Headers({ etag: '"source-v1"' }), bytes: async () => Buffer.from(fixture("tamarac")) }), TENANTS[1].at);
  assert.equal(changed.verdict, "CHANGED");
  const unchanged = await firstLook(first.config.portalUrl, changed.validators, async (_url, headers) => {
    assert.equal(headers["If-None-Match"], '"source-v1"');
    return { status: 304, headers: new Headers(), bytes: async () => { throw new Error("304 body must never be read"); } };
  }, TENANTS[1].at);
  assert.equal(unchanged.verdict, "UNCHANGED");
});

test("Swagit traverses every published next page and retains useful rows when a later page fails", async () => {
  const own = wiring(TENANTS[0]);
  const html = fixture("chandler");
  const calls: string[] = [];
  const source = makeSwagitSource([own], (async url => {
    calls.push(String(url));
    const page = new URL(String(url)).searchParams.get("page");
    if (page === "3") return new Response("not found", { status: 404 });
    return new Response(`${html}<a rel="next" href="?page=${page ? 3 : 2}">Next</a>`);
  }) as typeof fetch);
  const output = source.normalizeWithDrops(await source.fetch({ lat: 33, lng: -111, radiusKm: 20 }), new Date(TENANTS[0].at));
  assert.equal(calls.length, 3);
  assert.equal(output.meetings.length, 8);
  assert.equal(output.accounting.duplicates, 8);
  assert.equal(output.partialScopes?.[0].scope, "ARCHIVE");
  assert.match(output.partialScopes?.[0].cause ?? "", /404/);
});

test("cancellations, documents and bad dates retain independent publisher facts", () => {
  const own = wiring(TENANTS[0]);
  const text = fixture("chandler").replace("City Council Meeting - 10/15/2020", "City Council Meeting CANCELLED - 10/15/2020")
    .replace('href="/videos/87288/agenda">Agenda</a>', 'href="/videos/87288/agenda">Agenda</a><a href="/documents/minutes.pdf">Minutes</a>')
    .replace("Oct 12, 2020", "Feb 31, 2020");
  const result = makeSwagitSource([own]).normalizeWithDrops([{ wiring: own, pages: [{ url: own.config.portalUrl, text }], collectedAt: TENANTS[0].at }], new Date(TENANTS[0].at));
  const canceled = result.meetings.find(meeting => meeting.id.endsWith("videos/87288"))!;
  assert.equal(canceled.status, "CANCELED");
  assert.ok(canceled.publishedLinks?.some(link => link.label === "Minutes" && link.href.endsWith("/documents/minutes.pdf")));
  assert.equal(result.drops.unplaceableInTime, 1);
  assert.throws(() => parseSwagitMeetings('<html>Swagit login</html>', own.config.portalUrl), /SHAPE_CHANGED/);
});

test("every published Swagit body binds past ten while City Council stays distinct from Youth City Council", async () => {
  const tenant = TENANTS[0];
  const names = ["City Council", "Youth City Council", "City Council Finance Committee", "Airport Commission", "Arts Commission", "Housing Commission", "Parks Commission",
    "Library Board", "Historic Preservation Commission", "Human Rights Commission", "Civil Service Commission", "Police Commission", "Water Board"];
  const calendar = names.map((name, index) => `<h4>${name} Meetings</h4><table id="video-table"><tr><td><a href="/videos/${index + 1}">${name} Meeting</a></td><td>Oct 15, 2020</td></tr></table>`).join("");
  const { review } = await reviewCalendar(tenant, calendar, names);
  assert.equal(review.accepted.length, names.length, JSON.stringify(review.held));
  const council = review.accepted.find(entry => entry.row.bodyRole === "GOVERNING")!;
  assert.equal(council.row.filter.bodyMatch, "City Council Meetings");
  const own = bodySourceWiringFor(wiringRowFor(council.row));
  const result = makeSwagitSource([own]).normalizeWithDrops([{ wiring: own, pages: [{ url: own.config.portalUrl, text: calendar }], collectedAt: tenant.at }], new Date(tenant.at));
  assert.equal(result.meetings.length, 1);
  assert.equal(result.meetings[0].title, "City Council Meeting");
  const youth = review.accepted.find(entry => entry.row.bodyName === "Youth City Council");
  assert.ok(youth);
  assert.notEqual(youth.row.bodyId, council.row.bodyId);
});

test("a Swagit pagination cycle records a partial archive and a refused first read cannot become an empty calendar", async () => {
  const own = wiring(TENANTS[0]);
  const source = makeSwagitSource([own], (async () => new Response(`${fixture("chandler")}<a rel="next" href="${own.config.portalUrl}">Next</a>`)) as typeof fetch);
  const output = source.normalizeWithDrops(await source.fetch({ lat: 33, lng: -111, radiusKm: 20 }), new Date(TENANTS[0].at));
  assert.equal(output.meetings.length, 8);
  assert.match(output.partialScopes?.[0].cause ?? "", /SWAGIT_PAGING_CYCLE/);
  const refused = buildCompositeSource({ sourceNames: ["swagit"], derivedRows: [own], fetchImpl: (async () => new Response("forbidden", { status: 403 })) as typeof fetch });
  const raw = await refused.fetch({ lat: 33, lng: -111, radiusKm: 20 });
  assert.equal(refused.normalize(raw, new Date(TENANTS[0].at)).length, 0);
  assert.equal(refused.lastReport?.children[0].ok, false);
  assert.equal(refused.lastReport?.children[0].failure, "WALL");
});
