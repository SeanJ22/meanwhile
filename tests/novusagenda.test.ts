import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeNovusAgendaSource, nextNovusPage, novusPortalUrl, parseNovusMeetings } from "../lib/sources/novusagenda/index.ts";
import { dataDoorConfig } from "../lib/civic-data/derived-door-kinds.ts";
import { probeDoors } from "../lib/doors/probe.ts";
import { meetingSourceNamesForWiring, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { meetingEndpointCandidates, verifyEndpointBody } from "../lib/hunt/meetings-site-discovery.ts";
import { wiringShapeFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { buildCompositeSource } from "../lib/sources/composite/wiring.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { buildDerivedFamily } from "../lib/civic-data/derived-meeting-family.ts";
import { derivedAdapterConfig, type DerivedWiringRow } from "../lib/civic-data/derived-meeting-wiring.ts";
import { meetingAcquisitionFailureDomain } from "../lib/civic-data/meeting-partitions.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { reviewDiscoveryWalk, textSha256, type HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { recordedDiscoveryOpen } from "./helpers/recorded-discovery-open.ts";

const fixture = (file: string) => readFileSync(new URL(`./fixtures/novusagenda/${file}`, import.meta.url), "utf8");
const collectedAt = "2026-10-13T20:00:00Z";
const tenants = [
  { tenant: "coalinga", state: "CA", zone: "America/Los_Angeles", file: "coalinga-ca.html", body: "City Council Meeting", count: 9, path: "AgendaPublic/MeetingsResponsive.aspx" },
  { tenant: "plano", state: "TX", zone: "America/Chicago", file: "plano-tx.html", body: "City Council Regular Meeting|City Council POM Meeting", count: 2, path: "agendapublic/meetingsresponsive.aspx" },
  { tenant: "peoriaaz", state: "AZ", zone: "America/Phoenix", file: "peoria-az.html", body: "City Council Meetings", count: 5, path: "agendapublic/meetingsgeneral.aspx" },
];
function wiring(tenant = tenants[0], body = tenant.body): BodySourceWiring {
  const ocdId = `ocd-division/country:us/state:${tenant.state.toLowerCase()}/place:${tenant.tenant}`;
  return { bodyId: `${ocdId}#governing`, ocdId, agendaSourceType: "NOVUSAGENDA", jurisdiction: `${tenant.tenant}, ${tenant.state}`,
    publishingOrg: tenant.tenant, timeZone: tenant.zone, verifiedAt: collectedAt,
    config: dataDoorConfig({ kind: "NOVUSAGENDA", route: `https://${tenant.tenant}.novusagenda.com/${tenant.path}`, slug: tenant.tenant, bodyName: "City Council", filter: { bodyMatch: body } }) };
}

for (const tenant of tenants) test(`real ${tenant.state} tenant retains body attribution and its document links`, () => {
  const row = wiring(tenant);
  const html = fixture(tenant.file);
  const parsed = parseNovusMeetings(html, row.config.portalUrl);
  const result = makeNovusAgendaSource([row]).normalizeWithDrops([{ wiring: row, pages: [{ url: row.config.portalUrl, html }], collectedAt }], new Date(collectedAt));
  assert.equal(result.meetings.length, tenant.count);
  assert.equal(result.drops.notConfigured, parsed.length - tenant.count);
  assert.ok(result.meetings.every(meeting => meeting.bodyId === row.bodyId && meeting.agendaUrl && meeting.startPrecision === "DAY"));
  assert.ok(result.meetings.some(meeting => meeting.publishedLinks?.some(link => /DisplayAgendaPDF/.test(link.href))));
  assert.equal(verifyEndpointBody({ vendor: "novusagenda", url: row.config.portalUrl }, { status: 200, body: html, finalUrl: row.config.portalUrl }).verdict, "YIELDED");
  assert.deepEqual(wiringShapeFor({ vendor: "novusagenda", url: row.config.portalUrl }), { kind: "NOVUSAGENDA", endpoint: { portalUrl: row.config.portalUrl } });
  assert.deepEqual(meetingSourceNamesForWiring(row), ["novusagenda"]);
});

test("responsive and classic lists page through the published POST controls", () => {
  const first = nextNovusPage(fixture("coalinga-ca.html"), wiring().config.portalUrl)!;
  assert.equal(first.form?.__EVENTTARGET, "ctl00$ContentPlaceHolder1$btnNextMeeting");
  assert.ok(first.form?.__VIEWSTATE);
  assert.equal(nextNovusPage(fixture("coalinga-ca-page2.html"), first.url), null);
  const classic = nextNovusPage(fixture("peoria-az.html"), wiring(tenants[2]).config.portalUrl)!;
  assert.match(classic.form!.__EVENTTARGET, /\$radGridMeetings\$/);
  const firstClassic = parseNovusMeetings(fixture("peoria-az.html"), classic.url);
  const secondClassic = parseNovusMeetings(fixture("peoria-az-page2.html"), classic.url);
  assert.equal(secondClassic.length, 15);
  assert.ok(secondClassic.every(row => !firstClassic.some(first => first.id === row.id)));
  const page2 = parseNovusMeetings(fixture("coalinga-ca-page2.html"), first.url);
  assert.deepEqual(page2.map(row => row.id), ["713", "733", "697", "731"]);
});

test("commission cancellations and a council agenda time survive independent gaps", () => {
  const council = wiring();
  const commission = { ...wiring(tenants[0], "Planning Commission Meeting"), bodyId: `${council.ocdId}#planning`, config: { ...wiring(tenants[0], "Planning Commission Meeting").config, bodyName: "Planning Commission" } };
  const pages = [{ url: council.config.portalUrl, html: fixture("coalinga-ca.html") }, { url: council.config.portalUrl, html: fixture("coalinga-ca-page2.html") }];
  const result = makeNovusAgendaSource([council, commission]).normalizeWithDrops([
    { wiring: council, pages, details: { "718": fixture("coalinga-ca-agenda-718.html") }, collectedAt },
    { wiring: commission, pages, collectedAt },
  ], new Date(collectedAt));
  assert.equal(result.meetings.length, 19);
  assert.equal(result.meetings.find(row => row.id.endsWith(":718"))?.startsAt, "2026-10-15T18:00:00-07:00");
  assert.equal(result.meetings.find(row => row.id.endsWith(":739"))?.status, "CANCELED");
  assert.ok(result.meetings.filter(row => row.bodyId === commission.bodyId).every(row => row.bodyName === "Planning Commission"));
  assert.ok(result.meetings.some(row => row.location === null && row.venueGap));
});

test("composite acquisition covers the range and both pages before reading agenda details", async () => {
  const row = wiring();
  const calls: Array<{ url: URL; form: URLSearchParams | null }> = [];
  const fetchImpl = (async (request: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(request));
    const form = init?.body ? new URLSearchParams(String(init.body)) : null;
    calls.push({ url, form });
    if (/MeetingView\.aspx/i.test(url.pathname)) return new Response(url.searchParams.get("MeetingID") === "718" ? fixture("coalinga-ca-agenda-718.html") : "unavailable", { status: url.searchParams.get("MeetingID") === "718" ? 200 : 404 });
    return new Response(fixture(form?.get("__EVENTTARGET")?.endsWith("btnNextMeeting") ? "coalinga-ca-page2.html" : "coalinga-ca.html"));
  }) as typeof fetch;
  const source = buildCompositeSource({ derivedRows: [row], sourceNames: ["novusagenda"], captureAcquisitionEvidence: true, fetchImpl: meetingFetchPass({ fetchImpl }) });
  const raw = await source.fetch({ lat: 36, lng: -120, radiusKm: 30, startsAfter: "2026-06-15T00:00:00Z", startsBefore: "2027-02-10T00:00:00Z" });
  const result = source.normalize(raw, new Date(collectedAt));
  assert.equal(result.length, 11);
  assert.equal(calls[0].url.searchParams.get("From"), "06/15/2026");
  assert.equal(calls[1].form?.get("ctl00$ContentPlaceHolder1$txtCalendarTo"), "02/10/2027");
  assert.ok(calls[2].form?.get("__EVENTTARGET")?.endsWith("btnNextMeeting"));
  assert.ok(result.some(meeting => meeting.id.endsWith(":714")));
  assert.ok(result.some(meeting => meeting.startPrecision === "DAY" && meeting.agendaUrl));
  const derived: DerivedWiringRow = { bodyId: row.bodyId, ocdId: row.ocdId!, bodyName: "City Council", kind: "NOVUSAGENDA", route: row.config.portalUrl,
    officialHost: new URL(row.config.portalUrl).hostname, jurisdictionId: "ca:city:city-of-coalinga", state: "US-CA", publishingOrg: row.publishingOrg,
    timeZone: row.timeZone, config: derivedAdapterConfig({ kind: "NOVUSAGENDA", route: row.config.portalUrl, officialHost: new URL(row.config.portalUrl).hostname,
      bodyId: row.bodyId, bodyName: "City Council", filter: { bodyMatch: row.config.bodyMatch } }), crosswalkRowId: "fixture-crosswalk", reviewedAt: collectedAt, verifiedAt: collectedAt };
  const member = { id: `${row.bodyId}:novusagenda`, status: "ACTIVE" as const, row: derived };
  const family = buildDerivedFamily({ wiringInput: { kind: "PROMOTED_VERSION", recordClass: "SOURCE_WIRING", scope: "US:meeting-source-wiring:v1",
    versionId: "fixture-wiring", readModelSha256: "b".repeat(64), promotedAt: collectedAt }, members: [member],
    reads: [{ member, acquisitions: source.lastReport!.children[0].acquisitions!, ok: true, error: null, freshMeetings: result, freshAgendaDocuments: [], retrievedAt: collectedAt }],
    previous: null, generatedAt: collectedAt, reconcile: read => ({ meetings: read.freshMeetings, agendaDocuments: [], removalEvidence: [] }) });
  assert.equal(family.snapshot.meetings.length, 11);
  assert.equal(family.snapshot.derivedMembers?.[0].outcome, "FRESH");
  assert.equal(meetingAcquisitionFailureDomain("novusagenda", row), "meeting-upstream:coalinga.novusagenda.com");
});

test("source changes use the existing shared door probe before acquisition", async () => {
  const row = wiring();
  const door = { doorId: "novus-fixture", config: row.config, validators: null };
  const bytes = new TextEncoder().encode(fixture("coalinga-ca.html"));
  const first = await probeDoors([door] as never, async () => ({ status: 200, headers: new Headers({ ETag: '"novus"' }), bytes: async () => bytes }), collectedAt);
  assert.equal(first.get(door.doorId)?.verdict, "CHANGED");
  const second = await probeDoors([{ ...door, validators: first.get(door.doorId)?.validators }] as never, async (url, headers) => {
    assert.equal(url, row.config.portalUrl);
    assert.equal(headers["If-None-Match"], '"novus"');
    return { status: 304, headers: new Headers(), bytes: async () => { throw new Error("304 has no bytes"); } };
  }, collectedAt);
  assert.equal(second.get(door.doorId)?.verdict, "UNCHANGED");
});

test("saved discovery evidence automatically binds council and commission bodies", async () => {
  const row = wiring();
  const route = row.config.portalUrl;
  const home = "https://coalinga.example.gov/";
  const held = new Map<string, HeldBytes>();
  const attempt = await walkMeetingsDiscoveryNeed({ jurisdictionId: "ca:city:city-of-coalinga", stateCode: "CA", name: "CITY OF COALINGA", govClass: "CITY_OR_TOWN", ownWebAddress: new URL(home).host,
    basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "OPERATIONAL_REFERENCE", versionId: "fixture-reference" } }, {
    open: recordedDiscoveryOpen({
      [home]: { status: 200, body: `<a href="${route.replace("https:", "http:")}">Meetings and agendas</a>` },
      [`${home}robots.txt`]: { status: 200, body: "User-agent: *\nAllow: /" },
      ["https://coalinga.novusagenda.com/robots.txt"]: { status: 200, body: "User-agent: *\nAllow: /" },
      [route]: { status: 200, body: fixture("coalinga-ca.html") },
    }), spaceOut: async () => {}, budget: { spent: () => false }, now: () => collectedAt,
    vault: async (artifact, body) => { held.set(artifact.id, { text: body, sha256: textSha256(body), evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: "RAW", retrievedAt: collectedAt } }); return { stored: true, where: artifact.id, why: "fixture" }; },
  });
  assert.equal(attempt.found.find(find => find.vendor === "novusagenda")?.url, route);
  const result = reviewDiscoveryWalk({ walk: { attempt, recordId: "fixture-walk", recordedAt: collectedAt }, registered: {
    bodyId: row.bodyId, ocdId: row.ocdId!, publishingOrg: "City of Coalinga", countyFips: "06019",
    input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-CA:registration:v1", versionId: "fixture-registration", readModelSha256: "a".repeat(64), promotedAt: collectedAt },
  }, held: id => held.get(id) ?? null, handWired: () => false, reviewer: "auto-crosswalk-reviewer@0123456789ab", now: collectedAt });
  assert.equal(result.accepted.length, 2, JSON.stringify(result.held));
  assert.ok(result.accepted.some(accepted => accepted.row.filter.bodyMatch === "Planning Commission Meeting"));
  assert.ok(result.accepted.some(accepted => accepted.row.bodyId === row.bodyId && accepted.row.filter.bodyMatch === "City Council Meeting"));
  assert.equal(meetingEndpointCandidates(`<a href="${route}">Agendas</a>`, home).find(candidate => candidate.vendor === "novusagenda")?.verifiable, true);
});

test("a source shell and a repeated page cannot become a successful empty feed", async () => {
  assert.throws(() => parseNovusMeetings("<html>Unavailable</html>", wiring().config.portalUrl), /LIST_CHANGED/);
  assert.equal(novusPortalUrl("https://coalinga.novusagenda.com/AgendaPublic/MeetingView.aspx?MeetingID=718"), wiring().config.portalUrl);
  const source = makeNovusAgendaSource([wiring()], (async () => new Response(fixture("coalinga-ca.html"))) as typeof fetch);
  const raw = await source.fetch({ lat: 36, lng: -120, radiusKm: 10 });
  assert.equal(raw[0].refusedKind, "JOB");
  assert.match(raw[0].refusedReason!, /PAGING_REPEATED/);
  assert.deepEqual(source.normalizeWithDrops(raw).unreachableOcdIds, [wiring().ocdId]);
});

test("one inaccessible tenant does not suppress another tenant's verified meetings", async () => {
  const first = wiring(tenants[1]);
  const second = wiring(tenants[0]);
  let firstCalls = 0;
  const source = makeNovusAgendaSource([first, second], (async (request: string | URL | Request) => {
    const url = new URL(String(request));
    if (url.hostname === new URL(first.config.portalUrl).hostname) { firstCalls++; return new Response("Forbidden", { status: 403 }); }
    if (/MeetingView/i.test(url.pathname)) return new Response("Agenda unavailable", { status: 404 });
    return new Response(fixture("coalinga-ca-page2.html"));
  }) as typeof fetch);
  const raw = await source.fetch({ lat: 33, lng: -112, radiusKm: 50 });
  assert.equal(firstCalls, 1);
  assert.equal(raw[0].refusedKind, "WALL");
  const normalized = source.normalizeWithDrops(raw, new Date(collectedAt));
  assert.ok(normalized.meetings.length > 0);
  assert.ok(normalized.meetings.every(meeting => meeting.bodyId === second.bodyId));
  assert.deepEqual(normalized.unreachableOcdIds, [first.ocdId]);
});
