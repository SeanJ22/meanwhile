import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  meetingAcquisitionFailureDomain,
  meetingPartitionForRow,
  meetingPartitionId,
} from "../lib/civic-data/meeting-partitions.ts";
import { SOURCE_AUTHORITIES, isOfficialSource, type OfficialLinkingPage } from "../lib/civic-data/source-authority.ts";
import { isOnlineOnly } from "../lib/meetings/online.ts";
import { wiringForMeetingSource } from "../lib/registry/source-wiring.ts";
import {
  extractOfficialPageEvents,
  makeOfficialPageEventsSource,
  officialLinkingPageFrom,
  officialLinkingPageFromAsync,
  statedTime,
  verifyExtractedEvents,
  verifyOfficialPageEvents,
  type OfficialPageBody,
  type OfficialPageRaw,
  type LazyOfficialPage,
} from "../lib/sources/official-page-events/index.ts";

test('saved official chains reach external calendars without trusting an unlinked host',()=>{
 for(const government of ['https://county.gov','https://city.gov']) {
  const pages=[{canonicalUrl:government+'/education',text:'<a href="https://school.example.org">School</a>'},
    {canonicalUrl:'https://school.example.org',text:'<a href="https://calendar.example.edu/events">Meetings</a>'}];
  const chain=officialLinkingPageFrom('https://calendar.example.edu/events',pages);
  assert.ok(chain);assert.equal(isOfficialSource('https://calendar.example.edu/events',chain),true);
  assert.equal(officialLinkingPageFrom('https://unlinked.example.org',pages),null);
  assert.equal(officialLinkingPageFrom('https://calendar.example.edu/events',pages.slice(1)),null);
 }
});

/** Historical resolver retained only as the equivalence oracle. */
function previousLinkingPageFrom(url: string, pages: readonly { canonicalUrl: string; text: string }[]): OfficialLinkingPage | null {
  if (isOfficialSource(url)) return null;
  const chains = new Map<string, OfficialLinkingPage>();
  for (const page of pages) if (isOfficialSource(page.canonicalUrl)) chains.set(page.canonicalUrl, { url: page.canonicalUrl, html: page.text });
  for (let pass = 0; pass < pages.length; pass++) {
    for (const parent of chains.values()) if (isOfficialSource(url, parent)) return parent;
    let added = false;
    for (const page of pages) {
      if (chains.has(page.canonicalUrl)) continue;
      const parent = [...chains.values()].find(chain => isOfficialSource(page.canonicalUrl, chain));
      if (parent) { chains.set(page.canonicalUrl, { url: page.canonicalUrl, html: page.text, linkingPage: parent }); added = true; }
    }
    if (!added) break;
  }
  return [...chains.values()].find(chain => isOfficialSource(url, chain)) ?? null;
}

test("official linking index matches the previous resolver, including append order, aliases and repeated URLs", () => {
  let seed = 643;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 200; trial++) {
    const urls = ["https://first.gov/root", "http://www.second.gov/root", ...Array.from({ length: 8 }, (_, i) => `https://host${i}.example.org/page`)];
    if (trial >= 100) for (let i = urls.length - 1; i > 0; i--) {
      const other = Math.floor(random() * (i + 1));
      [urls[i], urls[other]] = [urls[other], urls[i]];
    }
    const pages: { canonicalUrl: string; text: string }[] = [];
    for (let i = 0; i < (trial < 100 ? 14 : urls.length); i++) {
      const canonicalUrl = trial < 100 ? urls[Math.floor(random() * urls.length)] : urls[i];
      const text = Array.from({ length: 3 }, () => {
        const target = urls[Math.floor(random() * urls.length)];
        const href = random() < 0.3 ? target.replace("https:", "") : target;
        return `<a href='${href}?x=1&amp;y=2'>link</a>`;
      }).join("") + '<img src="/relative"><a href=mailto:someone@example.org>mail</a><a href="https://gov.example.com/">unofficial</a>';
      pages.push({ canonicalUrl, text });
      for (const url of [...urls, "https://www.host2.example.org:443/other", "https://unlinked.example.org", "invalid"]) {
        assert.deepEqual(officialLinkingPageFrom(url, pages), previousLinkingPageFrom(url, pages), `trial ${trial}, prefix ${pages.length}, ${url}`);
      }
    }
  }
});

test("official linking index answers 500 lookups over 3,000 pages with three-deep chains in under two seconds", () => {
  const pages: { canonicalUrl: string; text: string }[] = [];
  for (let i = 0; i < 750; i++) {
    pages.push({ canonicalUrl: `https://root${i}.gov/`, text: `<a href="https://a${i}.example.org/">first</a>` });
    pages.push({ canonicalUrl: `https://c${i}.example.org/`, text: `<a href="https://calendar${i}.example.org/">calendar</a>` });
    pages.push({ canonicalUrl: `https://b${i}.example.org/`, text: `<a href="https://c${i}.example.org/">third</a>` });
    pages.push({ canonicalUrl: `https://a${i}.example.org/`, text: `<a href="https://b${i}.example.org/">second</a>` });
  }
  const start = performance.now();
  for (let i = 0; i < 500; i++) {
    const chain = officialLinkingPageFrom(`https://calendar${i}.example.org/events`, pages);
    assert.equal(chain?.url, `https://c${i}.example.org/`);
    assert.equal(chain?.linkingPage?.linkingPage?.linkingPage?.url, `https://root${i}.gov/`);
  }
  const elapsed = performance.now() - start;
  console.log(`official-linking-index: pages=3000 lookups=500 elapsedMs=${elapsed.toFixed(2)}`);
  assert.ok(elapsed < 2000, `${elapsed.toFixed(2)} ms`);
});

test("lazy linking preserves original capture HTML, duplicate editions and late roots after every append", async () => {
  const pages: { canonicalUrl: string; text: string }[] = [];
  const lazy: LazyOfficialPage[] = [];
  const captures = [
    { canonicalUrl: "https://school.example.org/", text: '<p>first school capture</p><a href="//calendar.example.org/events">calendar</a>' },
    { canonicalUrl: "https://school.example.org/", text: '<p>later school capture</p><a href="https://other.example.org">other</a>' },
    { canonicalUrl: "https://unrelated.example.org/", text: '<p>unrelated</p>' },
    { canonicalUrl: "https://county.gov/directory", text: '<p>first directory</p><a href="https://www.school.example.org:443/">school</a>' },
    { canonicalUrl: "https://county.gov/directory", text: '<p>latest directory</p><img src="https://school.example.org/">' },
    { canonicalUrl: "https://first.gov/", text: '<a href="https://other.example.org/">earlier root order</a>' },
  ];
  for (const capture of captures) {
    pages.push(capture);
    lazy.push({ canonicalUrl: capture.canonicalUrl, readText: async () => capture.text });
    for (const url of ["https://calendar.example.org/events", "https://school.example.org/", "https://other.example.org/", "https://unlinked.example.org", "https://county.gov/", "invalid"]) {
      assert.deepEqual(await officialLinkingPageFromAsync(url, lazy), previousLinkingPageFrom(url, pages));
    }
  }
});

test("lazy linking shares ingestion and reloads only selected chain captures, including appended pages", async () => {
  const reads = [0, 0, 0, 0];
  const captures = [
    { canonicalUrl: "https://county.gov/", text: '<p>original root</p><a href="https://school.example.org/">school</a>' },
    { canonicalUrl: "https://school.example.org/", text: '<p>original school</p><a href="https://calendar.example.org/">calendar</a>' },
    { canonicalUrl: "https://unrelated.gov/", text: '<p>unrelated capture</p>' },
    { canonicalUrl: "https://calendar.example.org/", text: '<p>original calendar</p><a href="https://events.example.org/">events</a>' },
  ];
  const descriptor = (i: number): LazyOfficialPage => ({ canonicalUrl: captures[i].canonicalUrl, readText: async () => { reads[i]++; return captures[i].text; } });
  const lazy = [descriptor(0), descriptor(1), descriptor(2)];
  const results = await Promise.all([officialLinkingPageFromAsync("https://calendar.example.org/", lazy), officialLinkingPageFromAsync("https://calendar.example.org/", lazy)]);
  for (const result of results) assert.deepEqual(result, previousLinkingPageFrom("https://calendar.example.org/", captures.slice(0, 3)));
  assert.deepEqual(reads, [3, 3, 1, 0], "one ingestion per capture; each lookup reloads only its selected two pages");
  assert.equal(await officialLinkingPageFromAsync("https://unlinked.example.org/", lazy), null);
  assert.deepEqual(reads, [3, 3, 1, 0], "unlinked lookup reads no bodies after ingestion");
  lazy.push(descriptor(3));
  assert.deepEqual(await officialLinkingPageFromAsync("https://events.example.org/", lazy), previousLinkingPageFrom("https://events.example.org/", captures));
  assert.deepEqual(reads, [4, 4, 1, 2], "only the new capture is ingested and the chosen three-page chain reloaded");
  console.log(`lazy-official-linking: captures=4 concurrentLookups=2 reads=${reads.join(",")} unrelatedCaptureReads=${reads[2]}`);
});

test("lazy linking propagates a source read failure and retries without re-ingesting earlier captures", async () => {
  const reads = [0, 0];
  const pages: LazyOfficialPage[] = [
    { canonicalUrl: "https://county.gov/", readText: async () => { reads[0]++; return '<a href="https://school.example.org/">school</a>'; } },
    { canonicalUrl: "https://school.example.org/", readText: async () => { if (++reads[1] === 1) throw new Error("capture unavailable"); return '<a href="https://calendar.example.org/">calendar</a>'; } },
  ];
  await assert.rejects(officialLinkingPageFromAsync("https://calendar.example.org/", pages), /capture unavailable/);
  assert.ok(isOfficialSource("https://calendar.example.org/", await officialLinkingPageFromAsync("https://calendar.example.org/", pages)));
  assert.deepEqual(reads, [2, 3]);
});

test("lazy ingestion runs sixteen reads at once while preserving source order despite out-of-order completion", async () => {
  let active = 0;
  let peak = 0;
  const readOrder: number[] = [];
  const captures = Array.from({ length: 40 }, (_, i) => ({ canonicalUrl: `https://root${i}.gov/`, text: `<p>capture ${i}</p><a href="https://calendar.example.org/">calendar</a>` }));
  const pages = captures.map((page, i): LazyOfficialPage => ({ canonicalUrl: page.canonicalUrl, readText: async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, i % 16 === 0 ? 15 : 1));
    active--;
    readOrder.push(i);
    return page.text;
  } }));
  const chain = await officialLinkingPageFromAsync("https://calendar.example.org/", pages);
  assert.deepEqual(chain, previousLinkingPageFrom("https://calendar.example.org/", captures));
  assert.equal(peak, 16);
  assert.equal(active, 0);
  assert.notEqual(readOrder[0], 0, "completion order differs from source order");
  console.log(`lazy-official-linking-pool: captures=40 peak=${peak} firstCompleted=${readOrder[0]} selected=${chain?.url}`);
});

test("lazy pool drains failed batches and reuses successful decodes beyond the failed capture", async () => {
  let active = 0;
  const reads = Array(20).fill(0) as number[];
  const pages = reads.map((_, i): LazyOfficialPage => ({ canonicalUrl: `https://root${i}.gov/`, readText: async () => {
    active++;
    reads[i]++;
    try {
      await new Promise(resolve => setTimeout(resolve, i === 0 ? 1 : 5));
      if (i === 0 && reads[i] === 1) throw new Error("first capture unavailable");
      return `<a href="https://calendar.example.org/">capture ${i}</a>`;
    } finally { active--; }
  } }));
  await assert.rejects(officialLinkingPageFromAsync("https://calendar.example.org/", pages), /first capture unavailable/);
  assert.equal(active, 0, "all in-flight readers drained before rejection");
  assert.deepEqual(reads, [...Array(16).fill(1), ...Array(4).fill(0)], "no later batch starts after a failure");
  assert.equal((await officialLinkingPageFromAsync("https://calendar.example.org/", pages))?.url, "https://root0.gov/");
  assert.deepEqual(reads, [3, ...Array(19).fill(1)], "only the failed capture retries, then the selected root hydrates");
});

// Recorded pages, no live calls. `NOW` is the first page's retrieval instant, while its session is under way.
const NOW = new Date("2026-09-23T23:25:27.424Z");
const FIXTURES = new URL("./fixtures/official-page-events/", import.meta.url);
const TUSD_HTML = readFileSync(new URL("tusd-reconfiguration.html", FIXTURES), "utf8");
const SFPS_HTML = readFileSync(new URL("sfps-board-of-education.html", FIXTURES), "utf8");
const TUSD_URL = "https://www.tusd1.org/Reconfiguration";
const SFPS_URL = "https://www.sfps.info/page/board-of-education-2";

const TUSD_BODY_ID = "ocd-division/country:us/state:az/school_district:tucson_unified_district#board";

/** Arizona identity: the registry body, its homepageUrl host and its committee's name. */
const TUSD: OfficialPageBody = {
  id: TUSD_BODY_ID,
  name: "Tucson Unified School District",
  officialDomain: "https://www.tusd1.org/",
  linkingPage: {url:"https://directory.example.gov/schools",html:'<a href="https://www.tusd1.org">District</a><a href="https://govboard.tusd1.org">Board</a>'},
  timeZone: "America/Phoenix",
  nameTerms: ["Tucson Unified", "TUSD", "Joint Committee"],
};

// Identity built only from the second page's own evidence; not a registry body, so the id is this test's label.
const SFPS: OfficialPageBody = {
  id: "test:nm:santa-fe-public-schools",
  name: "Santa Fe Public Schools",
  officialDomain: "http://www.sfps.info",
  linkingPage: {url:"https://directory.example.gov/schools",html:'<a href="https://www.sfps.info">District</a>'},
  timeZone: "America/Denver",
  nameTerms: ["SFPS", "Board of Education", "Audit Committee", "Community Review Committee"],
};

test("TUSD: the reconfiguration page yields the Oct 1 Joint Committee meeting and the 9/23 and 9/26 sessions with venues and times", () => {
  const result = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html: TUSD_HTML, now: NOW });
  assert.equal(result.verdict, "YIELDED");
  const brief = result.sampleEvents.map((e) => [e.startsAt, e.endsAt, e.precision, e.eventType, e.title, e.venue, e.status]);
  assert.deepEqual(brief, [
    // Imminent first: the session under way, then the one in three days, then next week's committee.
    ["2026-09-23T16:00:00-07:00", "2026-09-23T18:30:00-07:00", "MINUTE", "Community engagement session", "Tucson Unified Facility Plans Community Engagement", "Cholla High School South Gym", "SCHEDULED"],
    ["2026-09-26T09:00:00-07:00", "2026-09-26T11:30:00-07:00", "MINUTE", "Community engagement session", "Tucson Unified Facility Plans Community Engagement", "Tucson High Magnet School East Gym", "SCHEDULED"],
    ["2026-10-01T00:00:00-07:00", null, "DAY", "Joint Committee meeting", "Joint Committee Meeting", null, "SCHEDULED"],
    // Past events publish as concluded.
    ["2026-09-11T00:00:00-07:00", null, "DAY", "Joint Committee meeting", "Joint Committee Meeting", null, "CONCLUDED"],
    ["2026-08-29T09:00:00-07:00", "2026-08-29T16:00:00-07:00", "MINUTE", "Joint Committee meeting", "Joint Committee Meeting", null, "CONCLUDED"],
  ]);
  // Never inflated: nothing on this page is a Governing Board meeting.
  assert.ok(result.sampleEvents.every((e) => !/board/i.test(e.eventType) && !/governing board/i.test(e.title)));
  // Provenance: the page, and the page's own words.
  assert.ok(result.sampleEvents.every((e) => e.sourceUrl === TUSD_URL));
  assert.match(result.sampleEvents[2].evidence, /Next Meeting October 1, 2026/);
  assert.match(result.sampleEvents[4].evidence, /from 9AM to 4PM/);
  assert.equal(result.sampleEvents[0].links[0]?.label, "RSVP for Community Engagement");
  // "September 21st" states no year and no card dates it: held, named, never guessed.
  assert.deepEqual(result.held.map((h) => [h.printedDate, h.reasons]), [["September 21st", ["YEAR_NOT_STATED"]]]);
});

test("TUSD: the wired adapter publishes five partition rows with named gaps and district attribution", () => {
  const rows = wiringForMeetingSource("official-page-events");
  assert.equal(rows.length, 1);
  const [wiring] = rows;
  const source = makeOfficialPageEventsSource(rows,undefined,()=>TUSD.linkingPage);
  const raw: OfficialPageRaw[] = [{ wiring, html: TUSD_HTML, ics: [], icsRefused: [], collectedAt: "2026-09-23T23:25:27.424Z" }];
  const { meetings, drops } = source.normalizeWithDrops(raw, NOW);
  assert.equal(meetings.length, 5);
  assert.deepEqual(drops, { placeless: 0, unknownVenue: 0, unplaceableInTime: 1, notConfigured: 0 });
  for (const m of meetings) {
    assert.ok(m.id.startsWith("official-page-events:tusd1-reconfiguration:"), m.id);
    assert.equal(m.bodyId, TUSD_BODY_ID);
    assert.equal(m.bodyName, "Tucson Unified School District");
    assert.equal(m.agendaUrl, null);
    assert.equal(m.location, null);
    assert.equal(m.online, undefined);
    assert.equal(isOnlineOnly(m), false, "a venue gap is never labeled online");
    assert.equal(m.provenance.sourceUrl, TUSD_URL);
    assert.equal(m.provenance.sourceOrg, "Tucson Unified School District");
    assert.ok(m.provenance.evidenceExcerpt && m.provenance.evidenceExcerpt.length > 0);
    assert.ok(m.startPrecision === "DAY" || m.startPrecision === "MINUTE");
  }
  const byDate = new Map(meetings.map((m) => [m.startsAt.slice(0, 10), m]));
  assert.deepEqual(byDate.get("2026-09-23")?.venueGap, {
    kind: "STATED_NOT_PLACED",
    publishedText: "Cholla High School South Gym",
    publisher: "Tucson Unified School District",
  });
  assert.equal(byDate.get("2026-09-26")?.venueGap?.publishedText, "Tucson High Magnet School East Gym");
  assert.equal(byDate.get("2026-10-01")?.venueGap?.kind, "NOT_STATED_BY_PUBLISHER");
  assert.equal(byDate.get("2026-10-01")?.eventType, "Joint Committee meeting");
  assert.equal(byDate.get("2026-09-23")?.endsAt, "2026-09-23T18:30:00-07:00");
  assert.deepEqual(source.normalizeWithHolds(raw, NOW).held.map((h) => [h.bodyId, h.reasons]), [[TUSD_BODY_ID, ["YEAR_NOT_STATED"]]]);
});

test("TUSD wiring: official host is the registry body's homepageUrl, its own partition and failure domain, authorized route", () => {
  const [wiring] = wiringForMeetingSource("official-page-events");
  const registry = JSON.parse(readFileSync(new URL("../lib/registry/registry.json", import.meta.url), "utf8")) as
    | { bodies?: Array<{ id: string; homepageUrl?: string | null }> }
    | Array<{ id: string; homepageUrl?: string | null }>;
  const bodies = Array.isArray(registry) ? registry : registry.bodies ?? [];
  const body = bodies.find((b) => b.id === wiring.bodyId);
  assert.ok(body, "the wiring row keys on a registry body");
  assert.equal(new URL(body.homepageUrl ?? "").hostname, wiring.config.officialHost);
  assert.ok(isOfficialSource(wiring.config.pageUrl,TUSD.linkingPage));

  const partition = meetingPartitionForRow("official-page-events", wiring.bodyId);
  assert.equal(partition.id, meetingPartitionId("official-page-events", TUSD_BODY_ID));
  const diligent = meetingPartitionForRow("diligent", wiring.bodyId);
  assert.notEqual(partition.id, diligent.id);
  assert.notEqual(partition.scope, diligent.scope);
  assert.equal(meetingAcquisitionFailureDomain("official-page-events", wiring), "meeting-upstream:www.tusd1.org");
  assert.notEqual(partition.acquisitionFailureDomain, diligent.acquisitionFailureDomain);

  const authority = SOURCE_AUTHORITIES["meetings-public-bodies"];
  assert.ok(authority.routePrefixes.some((p) => wiring.config.pageUrl.startsWith(p)));
  assert.ok(authority.routePrefixes.some((p) => new URL(p).hostname === "www.tusd1.org"));
});

test("cross-state transfer: the same extractor reads Santa Fe Public Schools (NM) with NM identity only", () => {
  const result = verifyOfficialPageEvents({ body: SFPS, url: SFPS_URL, html: SFPS_HTML, now: NOW });
  assert.equal(result.verdict, "YIELDED");
  // The page carries its events as embedded state, not markup.
  assert.ok(result.sampleEvents.every((e) => e.shape === "embedded-json"));
  const board = result.sampleEvents.find((e) => e.startsAt === "2026-10-08T17:30:00-06:00");
  assert.deepEqual(
    board && [board.title, board.eventType, board.endsAt, board.precision, board.venue, board.status],
    ["Board of Education Regular Meeting", "Board meeting", "2026-10-08T20:00:00-06:00", "MINUTE", null, "SCHEDULED"],
  );
  // Past NM events publish as concluded; the Mountain offset changes at DST.
  const review = result.sampleEvents.find((e) => e.startsAt === "2026-09-16T18:00:00-06:00");
  assert.equal(review?.status, "CONCLUDED");
  assert.ok(result.sampleEvents.some((e) => e.startsAt === "2026-11-12T17:30:00-07:00"));
  // An end equal to the start is no end, not an inversion.
  const audit = result.sampleEvents.find((e) => e.startsAt === "2026-10-08T12:00:00-06:00");
  assert.equal(audit?.title, "Audit Committee Meeting");
  assert.equal(audit?.endsAt, null);
  assert.equal(result.sampleEvents.length, 13);
  // The page's venue fields are empty: a named gap, never the district office.
  assert.ok(result.sampleEvents.every((e) => e.venue === null));

  // Held, by name: a misspelled title does not name the body, and school
  // closures are not sittings of it.
  const held = new Map(result.held.map((h) => [h.title, h.reasons]));
  assert.deepEqual(held.get("Board of Educaiton Regular Meeting"), ["TITLE_DOES_NOT_NAME_BODY"]);
  assert.deepEqual(held.get("No school - Elections/School Sites Closed"), ["TITLE_DOES_NOT_NAME_BODY"]);
  assert.equal(result.held.length, 7);

  // Facts are the NM page's own: nothing from the Arizona fixture leaks.
  const az = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html: TUSD_HTML, now: NOW });
  const azStarts = new Set(az.sampleEvents.map((e) => e.startsAt));
  const azVenues = new Set(az.sampleEvents.map((e) => e.venue).filter(Boolean));
  const azTitles = new Set(az.sampleEvents.map((e) => e.title));
  for (const e of result.sampleEvents) {
    assert.ok(!azStarts.has(e.startsAt), `${e.startsAt} is an Arizona instant`);
    assert.ok(!azVenues.has(e.venue), `${e.venue} is an Arizona venue`);
    assert.ok(!azTitles.has(e.title), `${e.title} is an Arizona title`);
    assert.ok(/-0[67]:00$/.test(e.startsAt), "Mountain time, from the NM body's zone");
    assert.equal(e.sourceUrl, SFPS_URL);
  }
});

test("negative: an Arizona fact cannot satisfy a New Mexico verification, nor the reverse", () => {
  // The AZ page offered for the NM body: wrong host, and nothing names SFPS.
  const azForNm = verifyOfficialPageEvents({ body: SFPS, url: TUSD_URL, html: TUSD_HTML, now: NOW });
  assert.equal(azForNm.verdict, "NOT_CONFIRMED");
  assert.deepEqual(azForNm.sampleEvents, []);
  assert.ok(azForNm.held.every((h) => h.reasons.includes("HOST_NOT_OFFICIAL")));
  assert.ok(azForNm.held.filter((h) => h.shape !== "prose-date").every((h) => h.reasons.includes("TITLE_DOES_NOT_NAME_BODY")));

  // Even an AZ fact carried onto the NM page's own host fails the NM title rule.
  const azExtraction = extractOfficialPageEvents(TUSD_HTML, { pageUrl: TUSD_URL, timeZone: "America/Phoenix" });
  const nextJoint = azExtraction.events.find((e) => e.shape === "next-meeting");
  assert.ok(nextJoint);
  const smuggled = verifyExtractedEvents(
    { events: [nextJoint], yearless: [], icsLinks: [], pageLinks: [] },
    { pageUrl: SFPS_URL, linkingPage: SFPS.linkingPage, nameTerms: [SFPS.name, ...(SFPS.nameTerms ?? [])], timeZone: SFPS.timeZone, now: NOW },
  );
  assert.deepEqual(smuggled.published, []);
  assert.deepEqual(smuggled.held.map((h) => h.reasons), [["TITLE_DOES_NOT_NAME_BODY"]]);

  // And the NM page offered for the AZ body.
  const nmForAz = verifyOfficialPageEvents({ body: TUSD, url: SFPS_URL, html: SFPS_HTML, now: NOW });
  assert.equal(nmForAz.verdict, "NOT_CONFIRMED");
  assert.ok(nmForAz.held.every((h) => h.reasons.includes("HOST_NOT_OFFICIAL")));
  assert.match(nmForAz.reason ?? "", /HOST_NOT_OFFICIAL/);
});

test("a scheduled event with no agenda and no venue is still published, as a named gap", () => {
  const [wiring] = wiringForMeetingSource("official-page-events");
  const html = `<html><body><div class="ContentBlock"><div class="SectionTitle">Joint Committee Meeting Oct. 15, 2026</div>
    <div class="SectionContent">The committee will review community feedback.</div></div></body></html>`;
  const source = makeOfficialPageEventsSource([wiring],undefined,()=>TUSD.linkingPage);
  const [meeting] = source.normalize([{ wiring, html, ics: [], icsRefused: [], collectedAt: NOW.toISOString() }], NOW);
  assert.ok(meeting, "published without an agenda or a venue");
  assert.equal(meeting.status, "SCHEDULED");
  assert.equal(meeting.startsAt, "2026-10-15T00:00:00-07:00");
  assert.equal(meeting.startPrecision, "DAY", "no time stated, none invented");
  assert.equal(meeting.agendaUrl, null);
  assert.equal(meeting.location, null);
  assert.deepEqual(meeting.venueGap, { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: "Tucson Unified School District" });
  assert.equal(isOnlineOnly(meeting), false);
});

test("structured shapes: JSON-LD with an offset, cancellation only in the publisher's words, microdata, and a linked .ics", () => {
  const body = { ...TUSD, nameTerms: ["TUSD"] };
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Event", name: "TUSD Boundary Forum", startDate: "2026-10-06T01:00:00Z", endDate: "2026-10-06T02:30:00Z", location: { "@type": "Place", name: "Catalina High School Auditorium" } },
      { "@type": "EducationEvent", name: "TUSD Facilities Hearing", startDate: "2026-10-09", eventStatus: "https://schema.org/EventCancelled" },
    ],
  })}</script></head><body>
  <div itemscope itemtype="https://schema.org/Event"><span itemprop="name">TUSD Budget Listening Session</span>
    <time itemprop="startDate" datetime="2026-10-20T18:00">Oct 20</time>
    <div itemprop="location" itemscope itemtype="https://schema.org/Place"><span itemprop="name">Pueblo High School Library</span></div></div>
  <a href="/files/tusd-sessions.ics">Add sessions to calendar</a></body></html>`;
  const ics = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x1", "SUMMARY:TUSD Community Session", "DTSTART;TZID=America/Phoenix:20261103T173000",
    "DTEND;TZID=America/Phoenix:20261103T190000", "LOCATION:Palo Verde High School Cafeteria", "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const extraction = extractOfficialPageEvents(html, { pageUrl: TUSD_URL, timeZone: "America/Phoenix", ics: [{ url: "https://www.tusd1.org/files/tusd-sessions.ics", text: ics }] });
  assert.deepEqual(extraction.icsLinks, ["https://www.tusd1.org/files/tusd-sessions.ics"]);
  const { published } = verifyExtractedEvents(extraction, { pageUrl: TUSD_URL, linkingPage: TUSD.linkingPage, nameTerms: body.nameTerms, timeZone: body.timeZone, now: NOW });
  const brief = published.map((v) => [v.event.shape, v.startsAt, v.endsAt, v.precision, v.event.venue, v.event.canceled]);
  assert.deepEqual(brief, [
    // 01:00Z on Oct 6 is 6:00pm on Oct 5 locally: the publisher's instant, read back into local time.
    ["json-ld", "2026-10-05T18:00:00-07:00", "2026-10-05T19:30:00-07:00", "MINUTE", "Catalina High School Auditorium", false],
    ["json-ld", "2026-10-09T00:00:00-07:00", null, "DAY", null, true],
    ["microdata", "2026-10-20T18:00:00-07:00", null, "MINUTE", "Pueblo High School Library", false],
    ["ics", "2026-11-03T17:30:00-07:00", "2026-11-03T19:00:00-07:00", "MINUTE", "Palo Verde High School Cafeteria", false],
  ]);
});

test("verification holds, by name, what cannot be verified — and an empty page is EMPTY", () => {
  const html = `<div><h3>Joint Committee Meeting Jan. 5, 2027 at 5:00 pm</h3></div>
    <div><h3>Joint Committee Meeting 2/30/2026</h3></div>
    <div><h3>Joint Committee Meeting March 3, 2027</h3></div>
    <div><h3>Spring Concert April 10, 2027</h3></div>`;
  const result = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html, now: NOW });
  // January and March are beyond the 90-day horizon; 2/30 is no date at all.
  assert.deepEqual(result.sampleEvents.map((e) => e.startsAt), []);
  assert.equal(result.verdict, "NOT_CONFIRMED");
  assert.match(result.reason ?? "", /DATE_OUT_OF_WINDOW/);

  const dated = `<div><div class="SectionTitle">Joint Committee Meeting Dec. 5, 2026</div><div>Starts 4 - 6:30pm.</div></div>`;
  const timed = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html: dated, now: NOW });
  assert.equal(timed.verdict, "YIELDED");
  assert.equal(timed.sampleEvents[0].precision, "DAY", "a range whose start has no am/pm is not guessed");
  assert.deepEqual(statedTime("4 - 6:30pm"), { start: null, end: null, printed: null });

  const offHost = verifyOfficialPageEvents({ body: TUSD, url: "https://tusd1.thrillshare.com/Reconfiguration", html: dated, now: NOW });
  assert.equal(offHost.verdict, "NOT_CONFIRMED");
  assert.equal(offHost.reason, "HOST_NOT_OFFICIAL");
  assert.ok(isOfficialSource("https://govboard.tusd1.org",TUSD.linkingPage));
  assert.ok(!isOfficialSource("https://tusd1.org.example.com",TUSD.linkingPage));

  const empty = verifyOfficialPageEvents({ body: TUSD, url: TUSD_URL, html: "<p>Welcome to TUSD.</p>", now: NOW });
  assert.deepEqual([empty.verdict, empty.reason], ["EMPTY", "NO_DATED_EVENTS_ON_PAGE"]);
});
