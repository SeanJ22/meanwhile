import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { makeGranicusSource, granicusRows, granicusFeedUrls, parseGranicusFeed, parseGranicusPublisher, granicusPublisherUrl, granicusArchiveSearchUrl } from "../lib/sources/granicus/index.ts";
import { CAPABILITIES } from "../lib/sources/composite/wiring.ts";
import { derivedWiringProjectionIssue, derivedWiringKey, bodySourceWiringFor } from "../lib/civic-data/derived-meeting-wiring.ts";
import { wiringRowFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { meetingAcquisitionFailureDomain } from "../lib/civic-data/meeting-partitions.ts";
import { dataDoorConfig } from "../lib/civic-data/derived-door-kinds.ts";
import { meetingSourceNamesForWiring, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { meetingEndpointCandidates } from "../lib/hunt/meetings-site-discovery.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { reviewDiscoveryWalk, autoCrosswalkReviewerId, type HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { recordedDiscoveryOpen } from "./helpers/recorded-discovery-open.ts";

const NOW = "2026-10-13T12:00:00.000Z";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/granicus/${name}`, import.meta.url), "utf8");
const tenants = [
  { tenant: "sanfrancisco", state: "CA", view: 10, zone: "America/Los_Angeles", label: "Board of Supervisors Regular Meeting" },
  { tenant: "alexandria", state: "VA", view: 57, zone: "America/New_York", label: "City Council Legislative Meeting" },
  { tenant: "miamidade", state: "FL", view: 2, zone: "America/New_York", label: "Safety and Health Committee" },
];
function wiring(t = tenants[1], label = t.label): BodySourceWiring {
  return { bodyId: `${t.state}:${label}`, ocdId: `ocd-division/country:us/state:${t.state.toLowerCase()}/place:${t.tenant}`, agendaSourceType: "GRANICUS", jurisdiction: `${t.tenant}, ${t.state}`, publishingOrg: t.tenant, timeZone: t.zone,
    config: dataDoorConfig({ kind: "GRANICUS", route: `https://${t.tenant}.granicus.com/ViewPublisher.php?view_id=${t.view}`, slug: t.tenant, bodyName: label, filter: { bodyMatch: label } }), verifiedAt: NOW };
}
function raw(t = tenants[1]) {
  const w = wiring(t);
  return { wiring: w, html: fixture(`${t.tenant}.html`), collectedAt: NOW,
    feeds: ["rss", "agenda"].map(mode => ({ url: `https://${t.tenant}.granicus.com/ViewPublisherRSS.php?view_id=${t.view}${mode === "agenda" ? "&mode=agendas" : ""}`, text: fixture(`${t.tenant}-${mode}.xml`), collectedAt: NOW })) };
}
for (const t of tenants) test(`real ${t.state} tenant retains meetings, agendas and documents with body isolation`, () => {
  const input = raw(t);
  const source = makeGranicusSource([input.wiring]);
  const result = source.normalizeWithDrops([input], new Date(NOW));
  assert.ok(result.meetings.length > 0);
  assert.ok(result.meetings.every(row => row.bodyId === input.wiring.bodyId && row.bodyName === t.label));
  assert.ok(result.meetings.some(row => row.agendaUrl));
  assert.ok(result.meetings.some(row => row.publishedLinks?.length));
  assert.deepEqual(meetingSourceNamesForWiring(input.wiring), ["granicus"]);
  assert.ok(CAPABILITIES.find(row => row.name === "granicus")?.types.includes("GRANICUS"));
});
test("real agenda publication timestamps never become upcoming meeting times", () => {
  const input = raw();
  const upcomingFeed = parseGranicusFeed(input.feeds[1].text, input.feeds[1].url)[0];
  assert.equal(upcomingFeed.date, "2026-10-21");
  assert.equal(upcomingFeed.hour, null);
  const rows = granicusRows(input);
  const hearing = rows.find(row => row.id === "event:1732")!;
  assert.equal(hearing.hour, 19);
  assert.equal(hearing.date, "2026-10-21");
  assert.equal(rows.find(row => row.id === "event:1735")!.agendaUrl, "https://alexandria.granicus.com/AgendaViewer.php?view_id=57&event_id=1735");
  const clip = rows.find(row => row.id === "clip:6984")!;
  assert.equal(clip.hour, null);
  assert.equal(clip.minute, null);
});
test("archive rows beyond 200 remain available and minutes keep their publisher labels", () => {
  const input = raw();
  assert.equal(parseGranicusPublisher(input.html, input.wiring.config.publisherUrl).length, 224);
  assert.ok(granicusRows(input).some(row => row.links.some(link => link.label === "Action Docket")));
  const miami = raw(tenants[2]);
  assert.ok(granicusRows(miami).some(row => row.links.some(link => link.label === "Minutes")));
});
test("the publisher's public search expands busy archives beyond the finite RSS listing", async () => {
  const input = raw(tenants[2]);
  const searchUrl = granicusArchiveSearchUrl(input.html, input.wiring.config.publisherUrl);
  assert.equal(searchUrl, "https://miamidade.granicus.com/ViewSearchResults.php?keywords=&view_id=2");
  const archive = fixture("miamidade-search.html");
  assert.equal(parseGranicusPublisher(archive, searchUrl!).length, 220);
  const source = makeGranicusSource([input.wiring], (async request => {
    const url = String(request);
    return new Response(url.includes("ViewSearchResults") ? archive : url.includes("RSS") ? fixture("miamidade-agenda.xml") : input.html);
  }) as typeof fetch, { store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks });
  const fetched = await source.fetch({ lat: 0, lng: 0, radiusKm: 0 });
  assert.equal(fetched[0].archives?.length, 1);
  assert.ok(granicusRows(fetched[0]).length >= 220);
  assert.ok(source.normalize(fetched, new Date(NOW)).length > 0);
  assert.deepEqual(parseGranicusPublisher('<html>No video clips matched the Keyword Search</html>', searchUrl!), []);
});
test("cancellations and date-only archive rows remain meetings; invalid source shape refuses", () => {
  const input = raw();
  input.html = input.html.replaceAll("City Council Legislative Meeting", "City Council Legislative Meeting - CANCELLED");
  const meetings = makeGranicusSource([input.wiring]).normalize([input], new Date(NOW));
  assert.ok(meetings.some(row => row.status === "CANCELED"));
  const special = { ...raw(), html: raw().html.replaceAll("City Council Legislative Meeting", "City Council Special Meeting") };
  assert.ok(makeGranicusSource([special.wiring]).normalize([special], new Date(NOW)).some(row => row.title === "City Council Special Meeting"));
  assert.ok(meetings.some(row => row.startPrecision === "DAY"));
  assert.throws(() => parseGranicusPublisher("<html>maintenance</html>", input.wiring.config.publisherUrl), /SHAPE_CHANGED/);
  assert.equal(granicusPublisherUrl("http://alexandria.granicus.com/ViewPublisher.php?view_id=57"), "https://alexandria.granicus.com/ViewPublisher.php?view_id=57");
  assert.throws(() => granicusPublisherUrl("https://legistar.granicus.com/not-a-calendar"), /INVALID/);
});
test("conditional checks precede extraction, tenant reads are shared, and retained bytes keep their original capture date", async () => {
  const input = raw();
  const feeds = granicusFeedUrls(input.html, input.wiring.config.publisherUrl);
  const replies = new Map<string, string>([[input.wiring.config.publisherUrl, input.html], ...feeds.map(url => [url, fixture(`alexandria-${new URL(url).searchParams.get("mode") === "agendas" ? "agenda" : new URL(url).searchParams.get("mode") === "minutes" ? "minutes" : "rss"}.xml`)] as const)]);
  const requests: Array<{ url: string; conditional: string | null }> = [];
  let at = NOW;
  const fetchImpl = (async (request, init) => {
    const url = String(request); const conditional = new Headers(init?.headers).get("if-none-match"); requests.push({ url, conditional });
    assert.ok(replies.has(url));
    return conditional ? new Response(null, { status: 304 }) : new Response(replies.get(url), { headers: { etag: '"fixture"', "content-type": "text/html" } });
  }) as typeof fetch;
  const source = makeGranicusSource([input.wiring, { ...input.wiring, bodyId: "other", config: { ...input.wiring.config, bodyMatch: "Planning Commission Public Hearing" } }], fetchImpl,
    { store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks, now: () => at });
  const first = await source.fetch({ lat: 0, lng: 0, radiusKm: 0 });
  assert.equal(first.length, 2);
  assert.equal(requests.length, 1 + feeds.length);
  at = "2026-10-13T13:00:00.000Z";
  const second = await source.fetch({ lat: 0, lng: 0, radiusKm: 0 });
  assert.ok(requests.slice(1 + feeds.length).every(row => row.conditional === '"fixture"'));
  assert.equal(second[0].collectedAt, NOW);
  assert.equal(second[0].sourceCheck?.checkedAt, at);
  assert.equal(second[0].sourceCheck?.httpStatus, 304);
  assert.deepEqual(source.normalize(first, new Date(NOW)), source.normalize(second, new Date(NOW)));
});
test("a feed outage preserves independently published schedules and names archive uncertainty", async () => {
  const input = raw();
  const source = makeGranicusSource([input.wiring], (async request => String(request).includes("RSS") ? new Response("refused", { status: 403 }) : new Response(input.html)) as typeof fetch,
    { store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks });
  const result = source.normalizeWithDrops(await source.fetch({ lat: 0, lng: 0, radiusKm: 0 }), new Date(NOW));
  assert.ok(result.meetings.some(row => row.id.endsWith("event:1735")));
  assert.ok(result.partialScopes?.every(row => row.scope === "ARCHIVE"));
});
test("a census government link becomes verified wiring for its council and boards without tenant-specific code", async () => {
  const input = raw(); const route = input.wiring.config.publisherUrl;
  assert.ok(meetingEndpointCandidates(`<a href="${route}">Meetings</a>`, "https://alexandriava.gov/", NOW).some(row => row.vendor === "granicus" && row.verifiable));
  const held = new Map<string, HeldBytes>();
  const attempt = await walkMeetingsDiscoveryNeed({ jurisdictionId: "va:city:alexandria", stateCode: "VA", name: "Alexandria city", govClass: "CITY_OR_TOWN", ownWebAddress: "https://alexandriava.gov/", basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "REGISTRATION", versionId: "reg-va" } }, {
    now: () => NOW, budget: { spent: () => false }, spaceOut: async () => {},
    open: recordedDiscoveryOpen({ "https://alexandriava.gov/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" }, "https://alexandriava.gov/": { status: 200, body: `<a href="${route}">City Council and boards meetings</a>` }, "https://alexandria.granicus.com/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" }, [route]: { status: 200, body: input.html } }),
    vault: async (artifact, body) => { held.set(artifact.id, { text: body, sha256: artifact.contentHash.slice(7), evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: "RAW", retrievedAt: artifact.retrievedAt } }); return { stored: true, where: artifact.id, why: "stored" }; },
  });
  assert.ok(attempt.found.some(row => row.vendor === "granicus"));
  const review = reviewDiscoveryWalk({ walk: { attempt, recordId: "walk", recordedAt: NOW }, registered: { bodyId: `${input.wiring.ocdId}#governing`, ocdId: input.wiring.ocdId!, publishingOrg: "Alexandria city", input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-VA:registration:v1", versionId: "reg-va", readModelSha256: "a".repeat(64), promotedAt: NOW } }, held: id => held.get(id) ?? null, handWired: () => false, reviewer: autoCrosswalkReviewerId("a".repeat(64)), now: NOW });
  assert.ok(review.accepted.some(row => row.row.bodyRole === "GOVERNING"), JSON.stringify(review.held));
  assert.ok(review.accepted.some(row => row.row.bodyName.includes("Board of Architectural Review")), JSON.stringify(review.held));
  const records = review.accepted.map(accepted => { const row = wiringRowFor(accepted.row); return { id: derivedWiringKey(row.kind, row.bodyId, row.route), status: "ACTIVE" as const, row }; });
  assert.equal(derivedWiringProjectionIssue({ kind: "meeting-source-wiring", formatVersion: 1, records }), null);
  for (const record of records) {
    const wired = bodySourceWiringFor(record.row);
    assert.equal(meetingAcquisitionFailureDomain("granicus", wired), "meeting-upstream:alexandria.granicus.com");
    const meetings = makeGranicusSource([wired]).normalize([{ ...input, wiring: wired }], new Date(NOW));
    assert.ok(meetings.length > 0);
    assert.ok(meetings.every(meeting => meeting.bodyId === wired.bodyId));
  }
});
