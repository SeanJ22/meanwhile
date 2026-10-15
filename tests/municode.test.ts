import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeMunicodeSource, parseMunicodeMeetings, municodeNextPage, MUNICODE_MAX_PAGES } from "../lib/sources/municode/index.ts";
import { buildCompositeSource } from "../lib/sources/composite/wiring.ts";
import { meetingAcquisitionFailureDomain } from "../lib/civic-data/meeting-partitions.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { reviewDiscoveryWalk, type HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { dataDoorConfig } from "../lib/civic-data/derived-door-kinds.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { derivedFamilyReadGroups, readDerivedFamilyMembers } from "../lib/civic-data/derived-meeting-acquisition.ts";
import { derivedWiringKey, type DerivedWiringRecord } from "../lib/civic-data/derived-meeting-wiring.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { familyMemberReadIssue } from "../lib/civic-data/derived-meeting-family.ts";

const NOW = "2026-10-13T12:00:00Z";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/municode/${name}`, import.meta.url), "utf8");
function wiring(slug: string): BodySourceWiring {
  const meta = JSON.parse(fixture(`${slug}.meta.json`));
  const nameTerms = slug === "hideout" ? "Town Council" : "City Council";
  return { bodyId: `fixture:${slug}#governing`, ocdId: `ocd-division/country:us/state:${meta.state.toLowerCase()}/place:${slug}`,
    agendaSourceType: "MUNICODE", jurisdiction: `${slug}, ${meta.state}`, publishingOrg: slug, timeZone: meta.timeZone,
    config: { portalUrl: meta.sourceUrl, nameTerms, bodyName: nameTerms, slug }, verifiedAt: NOW };
}

for (const [slug, expected] of [["bremerton", 23], ["manor", 25], ["hideout", 185]] as const) test(`real ${slug} listing retains published dates, agendas and documents`, () => {
  const w = wiring(slug), text = fixture(`${slug}.html`);
  assert.equal(createHash("sha256").update(text).digest("hex"), JSON.parse(fixture(`${slug}.meta.json`)).sha256);
  const parsed = parseMunicodeMeetings(text, w.config.portalUrl);
  assert.equal(parsed.length, expected);
  const output = makeMunicodeSource([w]).normalizeWithDrops([{ wiring: w, meetings: parsed, outOfWindow: 0, notConfigured: 0, collectedAt: NOW }], new Date(NOW));
  assert.equal(output.accounting.outcome, "CONSERVED");
  assert.ok(output.meetings.length > 10);
  for (const meeting of output.meetings) {
    const row = parsed.find(r => meeting.id.endsWith(r.id))!;
    assert.equal(meeting.startsAt.slice(0, 10), row.date);
    assert.equal(meeting.publishedLinks?.length, row.links.length);
    assert.equal(meeting.agendaUrl, row.links.find(l => /agenda/.test(l.kind) && !/packet/.test(l.kind))?.href ?? null);
    assert.equal(meeting.bodyId, w.bodyId);
  }
});

test("Municode follows the real publisher's paging selector and shares each page across body rows", async () => {
  const w = wiring("manor"), first = fixture("manor.html"), second = fixture("manor-page2.html");
  const next = municodeNextPage(first, w.config.portalUrl)!;
  assert.equal(new URL(next).searchParams.get("p"), "2");
  const rows2 = parseMunicodeMeetings(second, next);
  const third = municodeNextPage(second, next)!;
  const seen: string[] = [];
  const source = makeMunicodeSource([w, { ...w, bodyId: "another-fixture-body", config: { ...w.config, slug: "another", nameTerms: "Planning Commission" } }], (async url => {
    seen.push(String(url)); assert.ok([w.config.portalUrl, next, third].includes(String(url)));
    return new Response(String(url) === third ? '<div class="view-empty">No meetings</div>' : String(url) === next ? second : first);
  }) as typeof fetch);
  const raw = await source.fetch({ lat: 30, lng: -97, radiusKm: 20, startsAfter: `${rows2[0].date}T00:00:00Z`, startsBefore: "2027-01-31T23:59:59Z" });
  assert.deepEqual(seen, [w.config.portalUrl, next, third]);
  assert.ok(raw[0].meetings.length > 0);
  assert.equal(raw[1].meetings.length, 0);
  assert.ok(raw.every(row => !("pages" in row)));
  const output = source.normalizeWithDrops(raw, new Date(NOW));
  assert.equal(output.accounting.outcome, "CONSERVED");
  assert.ok(output.meetings.some(m => m.id.endsWith(rows2[0].id)));
});

test("Municode composite binding attributes the shared vendor host's failures to its tenant", async () => {
  const w = wiring("bremerton");
  const source = buildCompositeSource({ derivedRows: [w], fetchImpl: (async () => new Response(fixture("bremerton.html"))) as typeof fetch });
  const meetings = source.normalize(await source.fetch({ lat: 47, lng: -122, radiusKm: 20, startsAfter: "2020-01-01T00:00:00Z", startsBefore: "2030-01-01T00:00:00Z" }), new Date(NOW));
  assert.equal(meetings.length, 23);
  assert.equal(meetingAcquisitionFailureDomain("municode", w), "meeting-upstream:meetings.municode.com/brem");
});

test("Municode preserves cancellations and unknown times, and refuses invalid dates and changed layouts", () => {
  const w = wiring("bremerton");
  const html = '<table class="mcm"><tr><th>Meeting</th><th>Date</th><th>Time</th><th>Agenda</th></tr><tr><td>City Council Meeting - CANCELLED</td><td>10/20/2026</td><td></td><td></td></tr><tr><td>Planning Commission</td><td>10/20/2026</td><td>4:00 PM</td><td></td></tr></table>';
  const output = makeMunicodeSource([w]).normalizeWithDrops([{ wiring: w, meetings: parseMunicodeMeetings(html, w.config.portalUrl), outOfWindow: 0, notConfigured: 0, collectedAt: NOW }], new Date(NOW));
  assert.equal(output.meetings.length, 1);
  assert.equal(output.meetings[0].status, "CANCELED");
  assert.equal(output.meetings[0].startPrecision, "DAY");
  assert.equal(output.meetings[0].agendaUrl, null);
  assert.equal(output.drops.notConfigured, 1);
  assert.throws(() => parseMunicodeMeetings(html.replaceAll("10/20/2026", "2/31/2026"), w.config.portalUrl));
  assert.throws(() => parseMunicodeMeetings("<h1>Unexpected page</h1>", w.config.portalUrl));
});

test("Drupal tables retain the published details link and follow the named next page", () => {
  const url = "https://fixture-wa.municodemeetings.com/";
  const html = '<table class="views-table"><tr><th>Date</th><th>Meeting</th><th>Agenda</th><th>View</th></tr><tr><td>10/20/2026 - 7:00pm</td><td>City Council</td><td><a href="/files/agenda.pdf">Agenda</a></td><td><a href="/bc-cc/page/city-council-100">View Details</a></td></tr></table><a title="Go to next page" href="/?page=1">next ›</a>';
  const [row] = parseMunicodeMeetings(html, url);
  assert.equal(row.sourceUrl, `${url}bc-cc/page/city-council-100`);
  assert.equal(row.hour, 19);
  assert.equal(municodeNextPage(html, url), `${url}?page=1`);
});

test("the census discovery walk reviews real Municode rows and binds the governing body", async () => {
  const w = wiring("manor"), bodies = new Map<string, HeldBytes>();
  const attempt = await walkMeetingsDiscoveryNeed({ jurisdictionId: "tx:city:manor", stateCode: "TX", name: "City of Manor", govClass: "CITY_OR_TOWN", ownWebAddress: "https://fixture.gov", basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "OPERATIONAL_REFERENCE", versionId: "ref-1" } }, {
    open: async input => {
      const body = input.url.endsWith("robots.txt") ? "User-agent: *\nDisallow: /\n" : input.url === "https://fixture.gov/" ? `<h1>City of Manor</h1><a href="${w.config.portalUrl}">Meetings</a>` : input.url === w.config.portalUrl ? fixture("manor.html") : input.url.includes("ppid=147ce166-1c8c-4d1e-b516-9b0d409c03e2") ? fixture("manor-adjustments.html") : "";
      return { status: body ? 200 : 404, body, bytes: body.length, contentType: "text/html", location: null, transportError: null };
    }, spaceOut: async () => {}, now: () => NOW, budget: { spent: () => false },
    vault: async (artifact, text) => { bodies.set(artifact.id, { text, sha256: artifact.contentHash.slice(7), evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: "RAW", retrievedAt: artifact.retrievedAt } }); return { stored: true, where: `vault/${artifact.id}`, why: "saved" }; },
  });
  assert.ok(attempt.found.some(f => f.vendor === "municode-meetings"));
  const review = reviewDiscoveryWalk({ walk: { attempt, recordId: "walk-1", recordedAt: NOW }, registered: { bodyId: `${w.ocdId}#governing`, ocdId: w.ocdId!, publishingOrg: "City of Manor", countyFips: "48453", input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-TX:registration:v1", versionId: "reg-1", readModelSha256: "a".repeat(64), promotedAt: NOW } }, held: id => bodies.get(id) ?? null, handWired: () => false, reviewer: "auto-crosswalk-reviewer@0123456789ab", now: NOW });
  assert.ok(review.accepted.some(r => r.row.bodyRole === "GOVERNING"), JSON.stringify(review.held));
  assert.ok(review.accepted.some(r => /Board of Adjustments/.test(r.row.bodyName)), JSON.stringify(review.held));
  const accepted = review.accepted.find(r => r.row.bodyRole === "GOVERNING")!.row;
  assert.equal(dataDoorConfig({ kind: "MUNICODE", route: accepted.route, slug: "manor", bodyName: accepted.bodyName, filter: accepted.filter }).portalUrl, w.config.portalUrl);
});

const table = (rows: string[], next = true) => `<table class="mcm"><tr><th>Meeting</th><th>Date</th><th>Agenda</th></tr>${rows.map((date, i) => `<tr><td>Body ${i} Board</td><td>${date}</td><td><a href="/agenda-${i}.pdf">Agenda</a></td></tr>`).join("")}</table>${next ? '<a href="?page=1" rel="next">next</a>' : ""}`;
const window = { lat: 30, lng: -97, radiusKm: 20, startsAfter: "2026-06-15T00:00:00Z", startsBefore: "2027-02-10T00:00:00Z" };

test("an unordered page with no held row stops paging and retains no HTML", async () => {
  const w = { ...wiring("bremerton"), config: { ...wiring("bremerton").config, portalUrl: "https://fixture-wa.municodemeetings.com/" } };
  let requests = 0;
  const source = makeMunicodeSource([w], (async () => { requests++; return new Response(table(["01/01/2020", "01/01/2028", "01/01/2019"])); }) as typeof fetch);
  const raw = await source.fetch(window);
  assert.equal(requests, 1);
  assert.deepEqual(raw[0].meetings, []);
  assert.equal(raw[0].outOfWindow, 3);
  assert.ok(!JSON.stringify(raw).includes("<table"));
  assert.equal(source.normalizeWithDrops(raw).accounting.outcome, "CONSERVED");
});

test("an unordered page with held rows continues, then stops at the first empty held page", async () => {
  const w = { ...wiring("bremerton"), config: { ...wiring("bremerton").config, portalUrl: "https://fixture-wa.municodemeetings.com/" } };
  let requests = 0;
  const source = makeMunicodeSource([w], (async () => new Response(++requests === 1 ? table(["01/01/2020", "10/20/2026", "01/01/2028"]) : table(["01/01/2020", "01/01/2028"]))) as typeof fetch);
  const raw = await source.fetch(window);
  assert.equal(requests, 2);
  assert.equal(raw[0].notConfigured, 1);
  assert.equal(raw[0].outOfWindow, 4);
  assert.equal(source.normalizeWithDrops(raw).accounting.outcome, "CONSERVED");
});

test("paging cannot exceed the tenant bound or cross into another tenant", async () => {
  const w = { ...wiring("bremerton"), config: { ...wiring("bremerton").config, portalUrl: "https://fixture-wa.municodemeetings.com/" } };
  let requests = 0;
  const source = makeMunicodeSource([w], (async input => {
    requests++;
    const page = Number(new URL(String(input)).searchParams.get("page") ?? 0);
    return new Response(table(["10/20/2026"]).replace('href="?page=1"', `href="?page=${page + 1}"`));
  }) as typeof fetch);
  await assert.rejects(source.fetch(window), /MUNICODE_PAGE_LIMIT/);
  assert.equal(requests, MUNICODE_MAX_PAGES);
  const crossed = makeMunicodeSource([w], (async () => new Response(table(["10/20/2026"]).replace('href="?page=1"', 'href="?cid=OTHER&ppid=other&page=1"'))) as typeof fetch);
  await assert.rejects(crossed.fetch(window), /MUNICODE_PAGING_PORTAL_CHANGED/);
});

test("eight family bodies share one portal acquisition and retain independent evidence", async () => {
  const w = wiring("bremerton");
  const members: DerivedWiringRecord[] = Array.from({ length: 8 }, (_, i) => {
    const bodyId = `${w.ocdId}#board-${i}`;
    return { id: derivedWiringKey("MUNICODE", bodyId, w.config.portalUrl), status: "ACTIVE", row: {
      bodyId, ocdId: w.ocdId!, bodyName: `Body ${i} Board`, kind: "MUNICODE", route: w.config.portalUrl,
      officialHost: new URL(w.config.portalUrl).hostname, jurisdictionId: "wa:city:bremerton", state: "US-WA", publishingOrg: w.publishingOrg,
      timeZone: w.timeZone, config: { ...w.config, slug: `bremerton-${i}`, nameTerms: `Body ${i} Board` },
      crosswalkRowId: `crosswalk-${i}`, reviewedAt: NOW, verifiedAt: NOW } };
  });
  const groups = [...derivedFamilyReadGroups([...members, { ...members[0], id: "suspended", status: "SUSPENDED" }])];
  assert.equal(groups.length, 1);
  let requests = 0;
  const transport = (async () => { requests++; return new Response(table(Array(8).fill("10/20/2026"), false)); }) as typeof fetch;
  const pass = meetingFetchPass({ fetchImpl: transport });
  const reads = await readDerivedFamilyMembers(groups[0], pass, undefined, new Date(NOW));
  assert.equal(requests, 1);
  assert.equal(reads.length, 8);
  for (const read of reads) {
    assert.equal(familyMemberReadIssue(read), null);
    assert.equal(read.acquisitions.length, 1);
    assert.equal(read.freshMeetings.length, 1);
    assert.equal(read.freshMeetings[0].bodyId, read.member.row.bodyId);
  }
  assert.equal(new Set(reads.map(read => read.acquisitions[0].rawHash)).size, 1);
  pass.forgetGet(reads[0].acquisitions.map(row => row.requestedUrl));
  const again = await readDerivedFamilyMembers(groups[0], pass, undefined, new Date(NOW));
  assert.equal(requests, 2);
  assert.ok(again.every(read => read.ok));
  const invalid = members.map((member, i) => i === 0 ? { ...member, row: { ...member.row, config: { ...member.row.config, nameTerms: "" } } } : member);
  pass.forgetGet(reads[0].acquisitions.map(row => row.requestedUrl));
  const independent = await readDerivedFamilyMembers(invalid, pass, undefined, new Date(NOW));
  assert.equal(requests, 3);
  assert.equal(independent[0].ok, false);
  assert.ok(independent.slice(1).every(read => read.ok && read.freshMeetings.length === 1));
});

test("an empty published listing is conserved and mixed portals cannot become one worker", async () => {
  const w = wiring("bremerton");
  const source = makeMunicodeSource([w], (async () => new Response('<div class="view-empty">No meetings</div>')) as typeof fetch);
  const output = source.normalizeWithDrops(await source.fetch(window));
  assert.equal(output.meetings.length, 0);
  assert.equal(output.accounting.outcome, "CONSERVED");
  assert.throws(() => parseMunicodeMeetings('<table class="mcm"><tr><th>Meeting</th><th>Date</th></tr></table>', w.config.portalUrl), /MUNICODE_MEETING_ROWS_MISSING/);
  let requests = 0;
  const mixed = makeMunicodeSource([w, wiring("manor")], (async () => { requests++; throw new Error("must reject before fetching"); }) as typeof fetch);
  await assert.rejects(mixed.fetch(window), /MUNICODE_PORTAL_SCOPE_MIXED/);
  assert.equal(requests, 0);
});
