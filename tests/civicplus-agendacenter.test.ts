import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dataDoorConfig } from "../lib/civic-data/derived-door-kinds.ts";
import { bodySourceWiringFor, derivedWiringKey, derivedWiringProjectionIssue, type DerivedWiringRow } from "../lib/civic-data/derived-meeting-wiring.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { agendaCenterPages, parseAgendaCenterUpdates } from "../lib/sources/civicplus/agenda-center.ts";
import { makeCivicPlusSource, parseAgendaCenter, parseAgendaCenterCategories } from "../lib/sources/civicplus/index.ts";
import { CAPABILITIES } from "../lib/sources/composite/wiring.ts";
import { CompositeSource } from "../lib/sources/composite/index.ts";

const NOW = new Date("2026-08-13T19:00:00.000Z");
const QUERY = { lat: 0, lng: 0, radiusKm: 1 };
const fixture = (file: string) => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
const NJ = fixture("civicplus-rockaway-agendacenter.html");
const CA = fixture("civicplus-alameda-water-agendacenter.html");
const AZ = fixture("civicplus-cochise-board-of-supervisors.ics");
const rss = (tenant: string) => fixture(`civicplus/${tenant}-rss.xml`);
function wiring(state: string, name: string, host: string, categoryId: string, timeZone: string): BodySourceWiring {
  return { bodyId: `ocd-division/country:us/state:${state.toLowerCase()}/place:fixture#${categoryId}`, ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/place:fixture`,
    agendaSourceType: "CIVICPLUS", jurisdiction: name, publishingOrg: name, timeZone, verifiedAt: NOW.toISOString(),
    config: dataDoorConfig({ kind: "CIVICPLUS", route: `https://${host}/AgendaCenter`, slug: `${host}-${categoryId}`, bodyName: name,
      filter: { agendaCenterCategoryId: categoryId } }),
  };
}

test("real NJ and CA pages retain every category and separate same-day publisher meeting IDs", () => {
  assert.deepEqual(parseAgendaCenterCategories(NJ).map(row => row.id), ["3", "7", "5", "4", "2"]);
  assert.deepEqual(parseAgendaCenterCategories(CA).map(row => row.id), ["3", "5"]);
  const boa = parseAgendaCenter(NJ, "3");
  assert.deepEqual(boa.filter(row => row.date === "2026-01-13").map(row => row.id).sort(), ["993", "994"]);
  assert.ok(boa.every(row => row.hour === null));
  assert.ok(boa.find(row => row.id === "993")?.links.some(link => link.label === "Minutes"));
  const water = parseAgendaCenter(CA, "5");
  assert.equal(water[0].id, "1448");
  assert.equal(water[0].date, "2024-09-03");
  assert.equal(water[0].hour, null, "the 1:30 PM posting stamp is not a meeting time");
  assert.ok(water[0].links.some(link => /PreviousVersions/.test(link.href)));
});

test("three real tenants in NJ, CA and AZ normalize through the registered CivicPlus capability", () => {
  const njRows = parseAgendaCenterCategories(NJ).map(category => wiring("NJ", category.name, "www.rockawaytownship.org", category.id, "America/New_York"));
  const caRows = parseAgendaCenterCategories(CA).map(category => wiring("CA", category.name, "www.acwd.org", category.id, "America/Los_Angeles"));
  const az = wiring("AZ", "Jail District", "www.cochise.az.gov", "31", "America/Phoenix");
  az.config = { ...az.config, icalUrl: "https://www.cochise.az.gov/common/modules/iCalendar/iCalendar.aspx?catID=31&feed=calendar", summaryMatch: "Jail District" };
  const rows = [...njRows, ...caRows, az];
  const source = CAPABILITIES.find(capability => capability.name === "civicplus")!.make(rows);
  const result = source.normalizeWithDrops([
    ...njRows.map(wiring => ({ wiring, ical: "", agendaPages: [{ url: wiring.config.agendaCenterUrl, text: NJ, collectedAt: NOW.toISOString() }], collectedAt: NOW.toISOString() })),
    ...caRows.map(wiring => ({ wiring, ical: "", agendaPages: [{ url: wiring.config.agendaCenterUrl, text: CA, collectedAt: NOW.toISOString() }], collectedAt: NOW.toISOString() })),
    { wiring: az, ical: AZ, collectedAt: NOW.toISOString() },
  ], NOW);
  assert.equal(result.accounting.outcome, "CONSERVED");
  for (const row of rows) assert.ok(result.meetings.some(meeting => meeting.bodyId === row.bodyId), row.bodyId);
  assert.equal(new Set(result.meetings.map(meeting => meeting.id)).size, result.meetings.length);
  const azMeetings = result.meetings.filter(meeting => meeting.bodyId === az.bodyId);
  assert.equal(azMeetings.length, 1);
  assert.ok(azMeetings.every(meeting => meeting.startsAt.endsWith("-07:00")));
  assert.ok(result.meetings.some(meeting => meeting.publishedLinks?.some(link => link.label === "Minutes")));
  for (const meeting of result.meetings) {
    assert.equal(meeting.bodyName, rows.find(row => row.bodyId === meeting.bodyId)!.config.bodyName);
    if (meeting.startPrecision === "DAY") assert.equal(meeting.venueGap?.kind, "NOT_STATED_BY_PUBLISHER");
  }
});

test("all categories from three freshly captured AgendaCenter tenants keep meetings and document links", () => {
  const tenants = [
    { tenant: "cochise", state: "AZ", host: "www.cochise.az.gov", zone: "America/Phoenix", categories: 13, meetings: 35 },
    { tenant: "rockaway", state: "NJ", host: "www.rockawaytownship.org", zone: "America/New_York", categories: 5, meetings: 46 },
    { tenant: "alameda", state: "CA", host: "www.acwd.org", zone: "America/Los_Angeles", categories: 6, meetings: 97 },
  ];
  for (const tenant of tenants) {
    const html = fixture(`civicplus/${tenant.tenant}-agendacenter.html`);
    const categories = parseAgendaCenterCategories(html);
    assert.equal(categories.length, tenant.categories);
    const rows = categories.map(category => wiring(tenant.state, category.name, tenant.host, category.id, tenant.zone));
    const source = makeCivicPlusSource(rows);
    const result = source.normalizeWithDrops(rows.map(wiring => ({ wiring, ical: "", agendaPages: [{ url: wiring.config.agendaCenterUrl, text: html, collectedAt: NOW.toISOString() }], collectedAt: NOW.toISOString() })), NOW);
    assert.equal(result.meetings.length, tenant.meetings, tenant.tenant);
    assert.equal(result.accounting.outcome, "CONSERVED");
    assert.ok(result.meetings.every(meeting => meeting.publishedLinks?.length));
    assert.equal(new Set(result.meetings.map(meeting => meeting.id)).size, tenant.meetings);
  }
});

test("a data door can select multiple categories of its own body and passes promoted wiring validation", () => {
  const row = wiring("NJ", "Planning Board", "www.rockawaytownship.org", "3,4", "America/New_York");
  const derived: DerivedWiringRow = { ...row, ocdId: row.ocdId!, kind: "CIVICPLUS", route: row.config.agendaCenterUrl,
    officialHost: "www.rockawaytownship.org", jurisdictionId: "nj:fixture", state: "US-NJ", bodyName: "Planning Board",
    crosswalkRowId: "crosswalk-fixture", reviewedAt: NOW.toISOString(), verifiedAt: NOW.toISOString() };
  assert.equal(derivedWiringProjectionIssue({ kind: "meeting-source-wiring", formatVersion: 1,
    records: [{ id: derivedWiringKey("CIVICPLUS", row.bodyId, derived.route), status: "ACTIVE", row: derived }] }), null);
  assert.equal(bodySourceWiringFor(derived).config.agendaCenterCategoryId, "3,4");
  assert.throws(() => dataDoorConfig({ kind: "CIVICPLUS", route: derived.route, slug: "fixture", bodyName: "Board", filter: { agendaCenterCategoryId: "All" } }), /CATEGORY_INVALID/);
});

test("conditional checks reuse exact bytes across reader instances and body rows", async () => {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const rows = parseAgendaCenterCategories(CA).map(category => wiring("CA", category.name, "www.acwd.org", category.id, "America/Los_Angeles"));
  const calls: string[] = [];
  let checkedAt = NOW.toISOString();
  const fetchImpl = (async (url, init) => {
    calls.push(String(url));
    assert.equal(new URL(String(url)).hostname, "www.acwd.org");
    const headers = new Headers(init?.headers);
    return headers.get("if-none-match") === '"real-page"' ? new Response(null, { status: 304 })
      : new Response(String(url).includes("RSSFeed") ? rss("alameda") : CA, { headers: { etag: '"real-page"' } });
  }) as typeof fetch;
  const cache = { store, locks, now: () => checkedAt };
  const first = makeCivicPlusSource(rows, fetchImpl, cache);
  const initial = first.normalize(await first.fetch(QUERY), NOW);
  assert.equal(calls.length, 2, "one RSS check and one tenant page serve both category bodies");
  assert.ok(calls[0].includes("RSSFeed"), "the cheap feed check comes first");
  checkedAt = "2026-08-13T20:00:00.000Z";
  const second = makeCivicPlusSource(rows, fetchImpl, cache);
  const current = second.normalize(await second.fetch(QUERY), NOW);
  assert.equal(calls.length, 4, "the next reader sends conditional checks");
  assert.deepEqual(current.map(row => [row.id, row.agendaUrl, row.publishedLinks]), initial.map(row => [row.id, row.agendaUrl, row.publishedLinks]));
  assert.ok(current.every(row => row.provenance.collectedAt === checkedAt));
});

test("publisher archive years and paging are followed on the same tenant without cycles", () => {
  const url = "https://www.rockawaytownship.org/AgendaCenter";
  const pages = agendaCenterPages(NJ, url, "4");
  assert.equal(pages.length, 14);
  assert.ok(pages.every(page => new URL(page).searchParams.get("CIDs") === "4"));
  assert.ok(pages.some(page => new URL(page).searchParams.get("startDate") === "01/01/2025"));
  const links = `${NJ}<a href="/AgendaCenter/Search/?page=2">Next</a><a href="https://other.gov/AgendaCenter/Search/?page=3">Next</a>`;
  assert.ok(agendaCenterPages(links, url, "4").includes(`${url}/Search/?page=2`));
  assert.ok(!agendaCenterPages(links, url, "4").some(page => page.includes("other.gov")));
});

test("a failed archive page keeps the acquired meeting rows and reports its scope", async () => {
  const row = wiring("NJ", "Planning Board", "www.rockawaytownship.org", "4", "America/New_York");
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const fetched: string[] = [];
  const fetchImpl = (async (url) => {
    fetched.push(String(url));
    return String(url).includes("RSSFeed") ? new Response(rss("rockaway"))
      : String(url) === row.config.agendaCenterUrl ? new Response(NJ) : new Response("Source unavailable", { status: 404 });
  }) as typeof fetch;
  const source = makeCivicPlusSource([row], fetchImpl, { store, locks });
  const raw = await source.fetch(QUERY);
  const result = source.normalizeWithDrops(raw, NOW);
  assert.equal(result.meetings.length, 8);
  assert.equal(result.partialScopes?.length, 14);
  assert.ok(result.partialScopes?.every(scope => scope.scope === "ARCHIVE"));
  assert.equal(fetched.length, 16);
  assert.equal(new Set(fetched).size, fetched.length);
});

test("fresh and unchanged tenant reads carry acquisition evidence through the composite", async () => {
  const row = wiring("CA", "Operations and Water Quality Committee", "www.acwd.org", "5", "America/Los_Angeles");
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  let reads = 0;
  const fetchImpl = (async (url, init) => {
    reads++;
    return new Headers(init?.headers).has("if-none-match") ? new Response(null, { status: 304 })
      : new Response(String(url).includes("RSSFeed") ? rss("alameda") : CA, { headers: { etag: '"water"' } });
  }) as typeof fetch;
  for (let pass = 0; pass < 2; pass++) {
    const composite = new CompositeSource([makeCivicPlusSource([row], fetchImpl, { store, locks })], { captureAcquisitionEvidence: true });
    const raw = await composite.fetch(QUERY);
    assert.equal(composite.normalize(raw, NOW).length, 1);
    const evidence = composite.lastReport?.children[0].acquisitions;
    assert.equal(evidence?.length, 2);
    assert.ok((evidence?.[0].byteCount ?? 0) > 0);
  }
  assert.equal(reads, 4);
});

test("a real prior-year category page joins the current listing without losing its separate sittings", () => {
  const row = wiring("NJ", "Planning Board", "www.rockawaytownship.org", "4", "America/New_York");
  const old = fixture("civicplus/rockaway-planning-2025.html");
  const result = makeCivicPlusSource([row]).normalizeWithDrops([{ wiring: row, ical: "", collectedAt: NOW.toISOString(), agendaPages: [
    { url: row.config.agendaCenterUrl, text: NJ, collectedAt: NOW.toISOString() },
    { url: "https://www.rockawaytownship.org/AgendaCenter/Search/?CIDs=4&startDate=01%2F01%2F2025&endDate=12%2F31%2F2025", text: old, collectedAt: NOW.toISOString() },
  ] }], NOW);
  assert.ok(result.meetings.some(meeting => meeting.startsAt.startsWith("2025-01-13")));
  assert.equal(result.meetings.filter(meeting => meeting.startsAt.startsWith("2025-01-13")).length, 2);
  assert.ok(result.meetings.some(meeting => meeting.startsAt.startsWith("2026-01-12")));
});

test("module RSS timestamps attach to exact publisher IDs with the feed as their source", () => {
  const html = fixture("civicplus/cochise-agendacenter.html");
  const row = wiring("AZ", "SEACOM Board", "www.cochise.az.gov", "11", "America/Phoenix");
  const feed = { url: "https://www.cochise.az.gov/RSSFeed.aspx?CID=All-0&ModID=65", text: rss("cochise"), collectedAt: NOW.toISOString() };
  const updates = parseAgendaCenterUpdates(feed.text);
  assert.equal(updates.length, 3);
  assert.equal(updates.find(update => update.id === "333")?.postedAt, "2026-10-05T20:03:28.000Z");
  const meetings = makeCivicPlusSource([row]).normalize([{ wiring: row, ical: "", agendaPages: [{ url: row.config.agendaCenterUrl, text: html, collectedAt: NOW.toISOString() }], rss: feed, collectedAt: NOW.toISOString() }], NOW);
  const meeting = meetings.find(meeting => meeting.id.endsWith(":333"));
  assert.equal(meeting?.postedAt, "2026-10-05T20:03:28.000Z");
  assert.equal(meeting?.fieldSources?.postedAt.sourceUrl, feed.url);
  assert.equal(meetings.find(meeting => meeting.id.endsWith(":335"))?.postedAt, undefined);
});

test("a date-only council meeting stays upcoming through its local day without inventing a start time", () => {
  const row = wiring("NJ", "Township Council", "www.rockawaytownship.org", "2", "America/New_York");
  const raw = [{ wiring: row, ical: "", collectedAt: NOW.toISOString(), agendaPages: [{
    url: row.config.agendaCenterUrl, text: fixture("civicplus/rockaway-agendacenter.html"), collectedAt: NOW.toISOString(),
  }] }];
  const source = makeCivicPlusSource([row]);
  const today = source.normalize(raw, new Date("2026-10-13T23:30:00-04:00")).find(meeting => meeting.startsAt.startsWith("2026-10-13"));
  assert.equal(today?.status, "SCHEDULED");
  assert.equal(today?.startPrecision, "DAY");
  const tomorrow = source.normalize(raw, new Date("2026-10-14T00:01:00-04:00")).find(meeting => meeting.id === today?.id);
  assert.equal(tomorrow?.status, "CONCLUDED");
});

test("cancellations and minutes-only rows remain distinct; impossible iCal dates are dropped", () => {
  const row = wiring("NJ", "Board of Adjustment", "www.rockawaytownship.org", "3", "America/New_York");
  const altered = NJ.replace("BOA Agenda 8/4/26", "BOA Meeting Cancelled 8/4/26")
    .replaceAll("/AgendaCenter/ViewFile/Agenda/_01132026-993", "/AgendaCenter/ViewFile/Minutes/_01132026-993");
  const { meetings } = makeCivicPlusSource([row]).normalizeWithDrops([{ wiring: row, ical: "", agendaPages: [{ url: row.config.agendaCenterUrl, text: altered, collectedAt: NOW.toISOString() }], collectedAt: NOW.toISOString() }], NOW);
  assert.equal(meetings.find(meeting => meeting.id.endsWith(":1022"))?.status, "CANCELED");
  assert.equal(meetings.find(meeting => meeting.id.endsWith(":993"))?.agendaUrl, null);
  assert.ok(meetings.find(meeting => meeting.id.endsWith(":993"))?.publishedLinks?.some(link => link.label === "Minutes"));
  const ical = AZ.replace(/DTSTART;TZID=America\/Phoenix:20260929T100000/, "DTSTART;TZID=America/Phoenix:20260230T100000");
  const result = makeCivicPlusSource([row]).normalizeWithDrops([{ wiring: row, ical, collectedAt: NOW.toISOString() }], NOW);
  assert.equal(result.drops.unplaceableInTime, 1);
  assert.equal(result.accounting.outcome, "CONSERVED");
});
