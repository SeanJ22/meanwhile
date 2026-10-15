import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { reviewDiscoveryWalk, textSha256, type HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { derivedAdapterConfig, bodySourceWiringFor, derivedWiringKey, derivedWiringProjectionIssue } from "../lib/civic-data/derived-meeting-wiring.ts";
import { crosswalkRowIssue } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { meetingEndpointCandidates, verifyEndpointBody } from "../lib/hunt/meetings-site-discovery.ts";
import { meetingSourceNamesForWiring, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { CAPABILITIES } from "../lib/sources/composite/wiring.ts";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { makePrimeGovSource, parsePrimeGovMeetings, primeGovDocumentUrl } from "../lib/sources/primegov/index.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/primegov/${name}`, import.meta.url), "utf8");
const NOW = "2026-10-13T19:30:00.000Z";
const tenants = [
  { tenant: "okc", state: "ok", city: "oklahoma_city", name: "Oklahoma City", countyFips: "40109", zone: "America/Chicago", committee: "1", governing: "1" },
  { tenant: "sanantonio", state: "tx", city: "san_antonio", name: "San Antonio", countyFips: "48029", zone: "America/Chicago", committee: "1", governing: "1" },
  { tenant: "lasvegas", state: "nv", city: "las_vegas", name: "Las Vegas", countyFips: "32003", zone: "America/Los_Angeles", committee: "16", governing: "1" },
];
const wiringFor = (tenant = tenants[0], committeeId = tenant.committee): BodySourceWiring => ({
  bodyId: `ocd-division/country:us/state:${tenant.state}/place:${tenant.city}#${committeeId}`,
  ocdId: `ocd-division/country:us/state:${tenant.state}/place:${tenant.city}`,
  agendaSourceType: "PRIMEGOV", jurisdiction: `${tenant.name}, ${tenant.state.toUpperCase()}`, publishingOrg: tenant.name,
  timeZone: tenant.zone, verifiedAt: NOW,
  config: { portalUrl: `https://${tenant.tenant}.primegov.com`, committeeId, bodyName: committeeId === "1" ? "City Council" : "Planning Commission" },
});
const rawFor = (wiring: BodySourceWiring, text: string) => ({ wiring, text, sourceUrl: `${wiring.config.portalUrl}/api/v2/PublicPortal/ListUpcomingMeetings`, collectedAt: NOW });

for (const tenant of tenants) test(`${tenant.name} ${tenant.state.toUpperCase()} public samples retain every meeting and document, with committee isolation`, () => {
  const text = fixture(`${tenant.tenant}-${tenant.state}-upcoming.json`);
  const events = parsePrimeGovMeetings(text);
  const wiring = wiringFor(tenant);
  const output = makePrimeGovSource([wiring]).normalizeWithDrops([rawFor(wiring, text)], new Date(NOW));
  assert.equal(output.meetings.length, events.filter(row => String(row.committeeId) === tenant.committee).length);
  assert.ok(output.meetings.length > 0);
  for (const meeting of output.meetings) {
    const event = events.find(row => meeting.id.endsWith(`:${row.id}`))!;
    assert.equal(meeting.bodyId, wiring.bodyId);
    assert.equal(meeting.timeZone, tenant.zone);
    assert.equal(meeting.startsAt.slice(0, 16), event.dateTime.slice(0, 16));
    assert.ok(meeting.agendaUrl?.includes("/Portal/Meeting?meetingTemplateId="));
    assert.equal(meeting.publishedLinks?.filter(link => link.label !== "Video").length, event.documentList?.length);
    assert.equal(meeting.provenance.sourceUrl, rawFor(wiring, text).sourceUrl);
  }
  assert.equal(output.accounting.outcome, "CONSERVED");
  assert.deepEqual(meetingSourceNamesForWiring(wiring), ["primegov"]);
});

test("complete yearly lists include meetings beyond 200 and preserve published cancellations and minutes", () => {
  const text = fixture("sanantonio-tx-archived.json");
  const rows = parsePrimeGovMeetings(text);
  assert.ok(rows.length > 600);
  const cancelled = rows.find(row => /cancell?ed/i.test(row.title))!;
  const wiring = wiringFor(tenants[1], String(cancelled.committeeId));
  const output = makePrimeGovSource([wiring]).normalizeWithDrops([rawFor(wiring, text)], new Date(NOW));
  assert.equal(output.meetings.find(row => row.id.endsWith(`:${cancelled.id}`))?.status, "CANCELED");
  const late = rows.slice(200).find(row => String(row.committeeId) === wiring.config.committeeId)!;
  assert.ok(output.meetings.some(row => row.id.endsWith(`:${late.id}`)));
  const minutesText = fixture("lasvegas-nv-archived.json");
  const minutesEvent = parsePrimeGovMeetings(minutesText).find(row => row.documentList?.some(doc => /minutes/i.test(doc.templateName)))!;
  const minutesWiring = wiringFor(tenants[2], String(minutesEvent.committeeId));
  assert.ok(makePrimeGovSource([minutesWiring]).normalize([rawFor(minutesWiring, minutesText)], new Date(NOW)).some(row => row.publishedLinks?.some(link => /minutes/i.test(link.label))));
});

test("one tenant list fetch serves all its bodies and 304 reuses bytes with their original retrieval date", async () => {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const wires = [wiringFor(), wiringFor(tenants[0], "2")];
  const seen: string[] = [];
  let at = NOW, second = false;
  const impl = (async (url, init) => {
    seen.push(String(url));
    const headers = new Headers(init?.headers);
    if (second) { assert.equal(headers.get("if-none-match"), '"public-list"'); return new Response(null, { status: 304 }); }
    return new Response(fixture(`okc-ok-${String(url).includes("Archived") ? "archived" : "upcoming"}.json`), { headers: { etag: '"public-list"', "content-type": "application/json" } });
  }) as typeof fetch;
  const source = makePrimeGovSource(wires, impl, { store, locks, now: () => at });
  const capture = await captureSourceAcquisitions(run => run("primegov", () => source.fetch({ lat: 0, lng: 0, radiusKm: 0 })));
  assert.equal(seen.length, 2);
  assert.equal(capture.evidence.length, 2);
  assert.equal(capture.value.length, 4);
  const first = source.normalizeWithDrops(capture.value, new Date(at));
  assert.ok(first.meetings.some(row => row.bodyId === wires[0].bodyId));
  assert.ok(first.meetings.some(row => row.bodyId === wires[1].bodyId));
  second = true; at = "2026-10-13T20:30:00.000Z";
  const checked = await source.fetch({ lat: 0, lng: 0, radiusKm: 0 });
  assert.equal(seen.length, 4);
  assert.ok(checked.every(row => row.collectedAt === NOW && row.sourceCheck?.checkedAt === at && row.sourceCheck.httpStatus === 304));
  assert.ok(source.normalize(checked, new Date(at)).every(row => row.provenance.collectedAt === NOW));
});

test("an archive failure retains upcoming meetings and names only the unavailable scope", async () => {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const wiring = wiringFor();
  const impl = (async url => String(url).includes("Archived") ? new Response("unavailable", { status: 503 }) : new Response(fixture("okc-ok-upcoming.json"))) as typeof fetch;
  const source = makePrimeGovSource([wiring], impl, { store, locks, now: () => NOW });
  const output = source.normalizeWithDrops(await source.fetch({ lat: 0, lng: 0, radiusKm: 0 }), new Date(NOW));
  assert.ok(output.meetings.length);
  assert.equal(output.partialScopes?.[0].scope, "ARCHIVE");
  assert.match(output.partialScopes?.[0].cause ?? "", /503/);
  assert.equal(output.accounting.outcome, "CONSERVED");
});

test("the held window crosses year boundaries without missing an archive and clips meetings by exact local instant", async () => {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const seen: string[] = [];
  const wiring = wiringFor();
  const text = fixture("okc-ok-upcoming.json");
  const source = makePrimeGovSource([wiring], (async url => { seen.push(String(url)); return new Response(text); }) as typeof fetch,
    { store, locks, now: () => "2026-01-05T12:00:00.000Z" });
  const raw = await source.fetch({ lat: 0, lng: 0, radiusKm: 0 });
  assert.ok(seen.some(url => url.endsWith("year=2025")));
  assert.ok(seen.some(url => url.endsWith("year=2026")));
  const output = source.normalizeWithDrops(raw, new Date("2026-01-05T12:00:00Z"));
  assert.equal(output.meetings.length, 0);
  assert.ok(output.accounting.outOfWindow > 0);
});

test("published document routes match the portal's HTML, compiled, external and vote-summary links", () => {
  const base = wiringFor().config.portalUrl;
  assert.equal(primeGovDocumentUrl({ id: 8, templateId: 10, templateName: "Agenda", compileOutputType: 1 }, base), `${base}/Public/CompiledDocument?meetingTemplateId=10&compileOutputType=1`);
  assert.equal(primeGovDocumentUrl({ id: 8, templateId: 0, templateName: "Votes", compileOutputType: 1 }, base), `${base}/Public/CompiledDocument?compiledMeetingDocumentFileId=8&compileOutputType=1`);
  assert.equal(primeGovDocumentUrl({ id: 8, templateId: 10, templateName: "Agenda", compileOutputType: 3, link: "https://official.gov/agenda.pdf" }, base), "https://official.gov/agenda.pdf");
  assert.equal(primeGovDocumentUrl({ id: 8, templateName: "Agenda", compileOutputType: 3, link: "javascript:void(0)" }, base), null);
  assert.throws(() => parsePrimeGovMeetings("<html>PrimeGov</html>"));
  assert.throws(() => parsePrimeGovMeetings('[{"id":1,"committeeId":1,"title":"Meeting"}]'), /SHAPE_CHANGED/);
});

test("date-only omissions retain a meeting without claiming a start time or unpublished agenda", () => {
  const event = { ...parsePrimeGovMeetings(fixture("okc-ok-upcoming.json"))[0], time: "", documentList: [] };
  const wiring = wiringFor();
  const meeting = makePrimeGovSource([wiring]).normalize([rawFor(wiring, JSON.stringify([event]))], new Date(NOW))[0];
  assert.equal(meeting.startPrecision, "DAY");
  assert.equal(meeting.agendaUrl, null);
});

test("official legacy HTTP portal links select the tenant's HTTPS public feeds", () => {
  const candidates = meetingEndpointCandidates('<a href="http://okc.primegov.com/Public/Portal">Council meetings</a>', "https://fixture-ok.gov/", NOW);
  assert.equal(candidates.filter(candidate => candidate.vendor === "primegov").length, 2);
  assert.ok(candidates.filter(candidate => candidate.vendor === "primegov").every(candidate => candidate.url.startsWith("https://okc.primegov.com/")));
});

for (const tenant of tenants) test(`${tenant.state.toUpperCase()} discovery binds real public lists through the automatic census crosswalk`, async () => {
  const wiring = wiringFor(tenant, tenant.governing);
  const base = wiring.config.portalUrl;
  const home = `https://fixture-${tenant.state}.gov/`;
  const upcoming = `${base}/api/v2/PublicPortal/ListUpcomingMeetings`;
  const archived = `${base}/api/v2/PublicPortal/ListArchivedMeetings?year=2026`;
  const text = fixture(`${tenant.tenant}-${tenant.state}-upcoming.json`);
  const candidates = meetingEndpointCandidates(`<a href="${base}/Public/Portal">City Council meetings</a>`, home, NOW);
  assert.ok(candidates.some(candidate => candidate.vendor === "primegov" && candidate.verifiable));
  assert.equal(verifyEndpointBody({ vendor: "primegov", url: upcoming }, { status: 200, body: text, finalUrl: upcoming }).verdict, "YIELDED");
  const allow: RecordedReply = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" };
  const held = new Map<string, HeldBytes>();
  const attempt = await walkMeetingsDiscoveryNeed({ jurisdictionId: `${tenant.state}:city:${tenant.city.replaceAll("_", "-")}`, stateCode: tenant.state.toUpperCase(), countyFips: tenant.countyFips,
    name: tenant.name, govClass: "CITY_OR_TOWN", ownWebAddress: home, basis: "SOURCE_DISCOVERY_OWED", sources: [],
    addressSource: { source: "OPERATIONAL_REFERENCE", versionId: "fixture-registration" } }, {
    open: recordedDiscoveryOpen({ [`${home}robots.txt`]: allow, [`${base}/robots.txt`]: allow,
      [home]: { status: 200, body: `<h1>City Council</h1><a href="${base}/Public/Portal">City Council meetings</a>` },
      [upcoming]: { status: 200, body: text, contentType: "application/json" },
      [`${base}/api/committee/GetCommitteeesListByShowInPublicPortal`]: { status: 200, body: fixture(`${tenant.tenant}-${tenant.state}-committees.json`), contentType: "application/json" },
      [archived]: { status: 200, body: fixture(`${tenant.tenant}-${tenant.state}-archived.json`), contentType: "application/json" } }),
    readOfficialPages: async () => [{ canonicalUrl: "https://fixture-directory.gov/governments", text: `<a href="${home}">${tenant.name}</a>` }],
    spaceOut: async () => {}, now: () => NOW, budget: { spent: () => false },
    vault: async (artifact, body) => {
      held.set(artifact.id, { text: body, sha256: textSha256(body), evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: "RAW", retrievedAt: artifact.retrievedAt } });
      return { stored: true, where: "fixture", why: "held" };
    },
  });
  const bodyId = `${wiring.ocdId}#governing`;
  const review = reviewDiscoveryWalk({ walk: { attempt, recordId: "fixture-walk", recordedAt: NOW },
    registered: { bodyId, ocdId: wiring.ocdId!, publishingOrg: tenant.name, countyFips: tenant.countyFips,
      input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: `US-${tenant.state.toUpperCase()}:registration:v1`, versionId: "fixture-registration", readModelSha256: "c".repeat(64), promotedAt: NOW } },
    held: id => held.get(id) ?? null, handWired: () => false, reviewer: "auto-crosswalk-reviewer@0123456789ab", now: NOW });
  const row = review.accepted.find(entry => entry.row.kind === "PRIMEGOV" && entry.row.bodyId === bodyId)?.row;
  assert.ok(row, JSON.stringify({ held: review.held.filter(hold => hold.bodyId === bodyId).map(hold => hold.detail), routes: attempt.found.map(find => find.url) }));
  assert.equal(row.filter.committeeId, tenant.governing);
  assert.equal(crosswalkRowIssue(row), null);
  const derived = { ...row, state: `US-${tenant.state.toUpperCase()}`, config: derivedAdapterConfig(row), crosswalkRowId: row.id, verifiedAt: NOW };
  assert.deepEqual(meetingSourceNamesForWiring(bodySourceWiringFor(derived)), ["primegov"]);
  assert.equal(derivedWiringProjectionIssue({ kind: "meeting-source-wiring", formatVersion: 1, records: [{ id: derivedWiringKey("PRIMEGOV", bodyId, row.route), status: "ACTIVE", row: derived }] }), null);
  assert.ok(CAPABILITIES.some(capability => capability.name === "primegov" && capability.types.includes("PRIMEGOV")));
});
