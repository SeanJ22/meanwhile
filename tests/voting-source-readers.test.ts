import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyVotingChangeNotices, arcgisVotingRows, fingerprintVotingPlatform, parseVotingCapture, readVotingSource, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { votingFetchSession } from "../lib/ballot/voting-source-fetch.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/voting-sources/${name}`));
const primaryDoor = JSON.parse(readFileSync("tests/fixtures/voting-sources/nc-primary-door.json", "utf8")) as VotingSourceDoor;
const NC: VotingSourceDoor = { id: "nc-early", publisher: "North Carolina State Board of Elections", url: "https://vt.ncsbe.gov/OSSite?handler=StatewideList", shape: "file", covers: ["EARLY_VOTING"], scope: { state: "NC", ocdId: "ocd-division/country:us/state:nc", name: "North Carolina" }, electionDate: "2026-11-03", electionPageUrl: "https://vt.ncsbe.gov/EVSite/", extraction: { format: "tsv", headers: ["election", "county", "flag", "name", "street", "cityStateZip", "day", "hours"], columns: { name: "name", address: ["street", "cityStateZip"], days: "day", hours: "hours", election: "election" } } };
const source = { publisher: NC.publisher, url: NC.url };

test("real statewide early-voting file retains every site's published day and hours", async () => {
  const rows = await parseVotingCapture({ url: NC.url, contentType: "text/tab-separated-values", bytes: fixture("nc-early-voting-2026-excerpt.tsv") }, NC);
  assert.equal(rows.length, 136);
  const { sites } = votingRowsToSites(rows, NC, source);
  assert.equal(sites.length, 8);
  const elmira = sites.find(s => s.name === "ELMIRA COMMUNITY CENTER")!;
  assert.equal(elmira.address, "810 WICKER ST, BURLINGTON, NC 27217");
  assert.ok(elmira.schedules?.some(schedule => schedule.days === "10/15/2026" && schedule.hours === "8:00AM - 7:30PM"));
  assert.ok(elmira.schedules?.some(schedule => schedule.days === "10/18/2026" && schedule.hours === "Closed"));
  assert.ok(elmira.schedules?.some(schedule => schedule.days === "10/31/2026"));
  assert.ok(sites.every(s => s.kind === "EARLY_VOTING" && s.electionDate === "2026-11-03"));
});

test("official rendered HTML tables retain early voting, drop boxes and publisher return rules", async () => {
  const door: VotingSourceDoor = { ...NC, id: "nd-tables", url: "https://vip.sos.nd.gov/Precincts.aspx?eid=348", shape: "list-page", covers: ["ELECTION_DAY", "EARLY_VOTING", "DROP_BOX"], extraction: { format: "html", columns: { address: ["Address", "City", "State", "Zip Code", "ZipCode"] } } };
  const rows = await parseVotingCapture({ url: door.url, contentType: "text/html", bytes: fixture("nd-2026-official-tables.html") }, door);
  const { sites } = votingRowsToSites(rows, door, { publisher: "North Dakota Secretary of State", url: door.url });
  assert.ok(sites.some(s => s.kind === "EARLY_VOTING"));
  const drop = sites.find(s => s.kinds?.includes("DROP_BOX") && s.countyName === "Barnes")!;
  assert.ok(drop.kinds?.includes("DROP_BOX"));
  assert.match(drop.schedules!.find(schedule => schedule.kind === "DROP_BOX")!.hours!, /north side of Courthouse entry available 24\/7/);
  assert.match(drop.schedules!.find(schedule => schedule.kind === "DROP_BOX")!.hours!, /7:00 pm on Tuesday, November 3, 2026/);
  assert.equal(drop.office?.phone, "(701) 845-8500 Ext. 6666");
});

test("one voterfocus fingerprint parses saved official facts from multiple counties", async () => {
  for (const county of ["bradford", "okaloosa"]) {
    const door = { ...NC, id: county, shape: "vendor-platform" as const, url: `https://www.voterfocus.com/PrecinctFinder/precinctDirectory?county=${county}`, extraction: { format: "json" as const, jsonPath: "sites" }, covers: ["ELECTION_DAY" as const] };
    assert.equal(fingerprintVotingPlatform(door.url), "voterfocus");
    const rows = await parseVotingCapture({ url: door.url, contentType: "application/json", bytes: fixture(`voterfocus-${county}-normalized.json`) }, door);
    const sites = votingRowsToSites(rows, door, source).sites;
    assert.ok(sites.length > 5); assert.ok(sites.every(s => s.name && s.address && s.precinct));
  }
});

test("identity-locked and unrequested address routes send no request", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("No request is permitted"); };
  const identity = await readVotingSource({ ...NC, shape: "identity-locked-lookup" }, { fetch: fetcher });
  assert.equal(identity.blanks[0]?.reason, "access");
  await readVotingSource({ ...NC, shape: "address-lookup" }, { fetch: fetcher });
  assert.equal(calls, 0);
});

const ncPage = () => new Response(fixture("nc-early-voting-2026-excerpt.tsv"), { headers: { "content-type": "text/tab-separated-values" } });
const plain = { headers: { "content-type": "text/plain" } };

test("rulings §2: a robots.txt that disallows the page is recorded as evidence and the public page is still read", async () => {
  const requests: string[] = [];
  const result = await readVotingSource(NC, { fetch: async input => {
    requests.push(String(input));
    return String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /OSSite", plain) : ncPage();
  } });
  assert.deepEqual(requests, ["https://vt.ncsbe.gov/robots.txt", NC.url], "robots.txt is read, then the page itself");
  assert.ok(result.sites.length > 0, "the sites on the disallowed page are published");
  assert.ok(result.attempts.some(attempt => attempt.url === "https://vt.ncsbe.gov/robots.txt" && /DISALLOWED/.test(attempt.outcome) && /recorded as evidence/.test(attempt.outcome)), "what robots.txt said is kept with the read");
  assert.ok(result.rawBodies.some(body => body.url.endsWith("/robots.txt") && /Disallow: \/OSSite/.test(new TextDecoder().decode(body.bytes))), "the robots.txt bytes are saved as evidence");
  assert.ok(!result.blanks.some(blank => blank.reason === "access"), "robots.txt does not open a blank");
});

test("rulings §2: a robots.txt that cannot be read, and a long crawl delay, change nothing about the read", async () => {
  const unreadable = await readVotingSource(NC, { fetch: async input => String(input).endsWith("/robots.txt") ? new Response("Invalid URL", { status: 403, ...plain }) : ncPage() });
  assert.ok(unreadable.sites.length > 0);
  assert.ok(unreadable.attempts.some(attempt => /robots\.txt/.test(attempt.outcome) && /recorded as evidence/.test(attempt.outcome)));
  const started = Date.now();
  const delayed = await readVotingSource(NC, { fetch: async input => String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nCrawl-delay: 3600\nAllow: /", plain) : ncPage() });
  assert.ok(delayed.sites.length > 0, "a crawl delay is evidence, not a reason to skip the source");
  assert.ok(Date.now() - started < 5_000, "the read does not wait out the crawl delay");
});

test("rulings §2 still never logs in, solves a CAPTCHA or sends credentials, whatever robots.txt says", async () => {
  const wall = votingFetchSession({ fetch: async input => String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /", plain)
    : new Response("<html><title>Just a moment...</title><div class=\"g-recaptcha\"></div></html>", { headers: { "content-type": "text/html" } }) });
  await assert.rejects(wall.get(NC.url), /CAPTCHA, login, or bot wall/);
  const sent = votingFetchSession({ fetch: async () => new Response("ok", plain) });
  await assert.rejects(sent.get(NC.url, { headers: { cookie: "session=1" } }), /Authenticated election source requests are forbidden/);
});

test("all ArcGIS object-ID batches are acquired without transfer-limit truncation", async () => {
  // Protocol envelope uses actual rows from the committed official statewide file.
  const factualRows = await parseVotingCapture({ url: NC.url, contentType: "text/tab-separated-values", bytes: fixture("nc-early-voting-2026-excerpt.tsv") }, NC);
  const calls: URL[] = [];
  const runtime = { fetch: (async input => {
    const url = new URL(String(input)); calls.push(url);
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    if (url.searchParams.has("returnIdsOnly")) return Response.json({ objectIds: factualRows.map((_, i) => i + 1) });
    const ids = url.searchParams.get("objectIds")!.split(",").map(Number);
    if (ids.length > 50) return Response.json({ exceededTransferLimit: true, features: [] });
    return Response.json({ features: ids.map(id => ({ attributes: factualRows[id - 1] })) });
  }) as typeof fetch };
  const rows = await arcgisVotingRows("https://vt.ncsbe.gov/arcgis/rest/services/locations/FeatureServer/0", votingFetchSession(runtime));
  const withoutCapture = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "__captureHash" && key !== "__captureUrl"));
  assert.deepEqual(rows.map(withoutCapture), factualRows.map(withoutCapture));
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(String(row.__captureHash)) && String(row.__captureUrl).includes("objectIds=")));
  assert.ok(calls.filter(url => url.searchParams.has("objectIds")).length > 2);
});

test("newest notice wins per field while every notice remains cited", async () => {
  const rows = await parseVotingCapture({ url: NC.url, contentType: "text/tab-separated-values", bytes: fixture("nc-early-voting-2026-excerpt.tsv") }, NC);
  const sites = votingRowsToSites(rows, NC, source).sites;
  const changed = applyVotingChangeNotices(sites, [
    { publishedAt: "2026-10-12", source: { ...source, url: `${NC.url}&notice=2` }, match: { id: sites[0]!.id }, changes: { hours: "Published replacement hours" } },
    { publishedAt: "2026-10-11", source: { ...source, url: `${NC.url}&notice=1` }, match: { id: sites[0]!.id }, changes: { hours: "Earlier replacement hours", room: "Published replacement room" } },
  ]);
  assert.equal(changed[0]!.hours, "Published replacement hours"); assert.equal(changed[0]!.room, "Published replacement room"); assert.equal(changed[0]!.sources?.length, 3);
});


test("the shared voterfocus card reader reads real precinct directory text, not just normalized JSON", async () => {
  for (const [county, count] of [["okaloosa", 52], ["bradford", 13]] as const) {
    const door: VotingSourceDoor = { ...NC, id: county, url: `https://www.voterfocus.com/PrecinctFinder/precinctDirectory?county=${county}`, shape: "vendor-platform", platform: "voterfocus", extraction: { format: "html" }, covers: ["ELECTION_DAY"] };
    const rows = await parseVotingCapture({ url: door.url, contentType: "text/html", bytes: fixture(`voterfocus-${county}-official-extract.txt`) }, door);
    assert.equal(rows.length, count);
    assert.ok(votingRowsToSites(rows, door, source).sites.every(site => site.precinct && site.name && site.address));
  }
});

test("address-only portals remain bulk acquisition work and never receive a reader input", async () => {
  const requests: string[] = [];
  const door: VotingSourceDoor = { ...NC, shape: "address-lookup", extraction: { addressFields: { street: "streetName" } } };
  const read = await readVotingSource(door, { fetch: async input => {
    requests.push(String(input)); throw new Error("Address-only lookup must not be requested");
  } });
  assert.deepEqual(requests, []);
  assert.equal(read.blanks[0]!.reason, "missing-sites");
  assert.deepEqual(read.blanks[0]!.tried, [door.url]);
  assert.match(read.blanks[0]!.owed, /bulk location lists and precinct boundaries/);
});

test("native statewide workbook returns Dillon precinct 1 and each tribal satellite schedule", async () => {
  const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
  const bytes = fixture("mt-2026-polling-satellite.xlsx");
  const polling = doors.find(door => door.id === "mt-statewide-polling-2026")!;
  const satellite = doors.find(door => door.id === "mt-statewide-satellite-2026")!;
  const rows = await parseVotingCapture({ url: polling.url, contentType: "application/octet-stream", bytes }, polling);
  const sites = votingRowsToSites(rows, polling, { publisher: polling.publisher, url: polling.url }).sites;
  assert.equal(sites.length, 304);
  assert.equal(sites.reduce((sum, site) => sum + (site.precincts?.length ?? 0), 0), 730);
  const dillon = sites.find(site => site.countyName === "Beaverhead" && site.precincts?.includes("1"))!;
  assert.equal(dillon.name, "LUTHERAN CHURCH - CENTRAL");
  assert.equal(dillon.address, "715 E BANNACK, DILLON, 59725");
  assert.equal(dillon.hours, "7:00 am - 8:00 pm");
  const satelliteRows = await parseVotingCapture({ url: satellite.url, contentType: "application/octet-stream", bytes }, satellite);
  const parsed = votingRowsToSites(satelliteRows, satellite, { publisher: satellite.publisher, url: satellite.url });
  assert.equal(parsed.sites.length, 31); assert.deepEqual(parsed.missingRows, []);
  const crow = parsed.sites.find(site => site.tribalNation === "Crow Nation")!;
  assert.equal(crow.name, "Student Union Building of the Little Big Horn College");
  assert.equal(crow.address, "8645 S. Weaver Dr., Crow Agency, MT");
  assert.equal(crow.days, "Oct. 7th, 8th, 14th, 15th, 21st, 22nd, 28th, & 29th");
  assert.equal(crow.hours, "10 a.m. to 5 p.m., Closed for lunch from 1-2 p.m.");
  assert.equal(satelliteRows[0]?.__fileUpdatedAt, "October, 1, 2026");
  assert.equal(parsed.sites.find(site => site.name === "Enemy Killer Center")?.days, "Oct. 8th, Oct. 16th, & Oct. 30th");
});

test("native government HTML keeps nested pager tables out of the voting records", async () => {
  const door: VotingSourceDoor = { ...NC, id: "nd-native", url: "https://vip.sos.nd.gov/Precincts.aspx?eid=348", shape: "list-page", covers: ["ELECTION_DAY", "EARLY_VOTING", "DROP_BOX"], extraction: { format: "html", columns: { address: ["Address", "City", "State", "Zip Code", "ZipCode"] } } };
  const rows = await parseVotingCapture({ url: door.url, contentType: "text/html", bytes: fixture("nd-2026-native.html") }, door);
  const sites = votingRowsToSites(rows, door, source).sites;
  assert.equal(sites.flatMap(site => site.schedules ?? []).filter(schedule => schedule.kind === "EARLY_VOTING" && (schedule.days || schedule.hours)).length, 8);
  assert.equal(sites.filter(site => site.kinds?.includes("DROP_BOX")).length, 10);
  assert.ok(sites.every(site => !site.address.includes("Data pager")));
  assert.match(sites.find(site => site.countyName === "Barnes" && site.kinds?.includes("DROP_BOX"))!.schedules!.find(schedule => schedule.kind === "DROP_BOX")!.hours!, /north side of Courthouse entry/);
});

test("native vendor HTML shares one precinct-card reader across both counties", async () => {
  for (const [county, count] of [["okaloosa", 52], ["bradford", 13]] as const) {
    const door: VotingSourceDoor = { ...NC, id: county, url: `https://www.voterfocus.com/PrecinctFinder/precinctDirectory?county=${county}`, shape: "vendor-platform", platform: "voterfocus", extraction: { format: "html" }, covers: ["ELECTION_DAY"] };
    const rows = await parseVotingCapture({ url: door.url, contentType: "text/html", bytes: fixture(`voterfocus-${county}-native.html`) }, door);
    assert.equal(rows.length, count);
    assert.ok(votingRowsToSites(rows, door, source).sites.every(site => site.precinct && /\bFL \d{5}/.test(site.address)));
  }
});

test("native statewide polling CSV decodes UTF-16 tab fields and retains earlier-election work", async () => {
  const door = primaryDoor;
  assert.ok(door);
  const bytes = fixture("nc-polling-place-20260303-native.csv.bin");
  const rows = await parseVotingCapture({ url: door.url, contentType: "application/octet-stream", bytes }, door);
  assert.equal(rows.length, 2632);
  assert.ok(rows.every(row => row.polling_place_name && row.street_address && row.county_name));
  const read = await readVotingSource(door, { fetch: async input => new URL(String(input)).pathname === "/robots.txt" ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } }) : new Response(bytes, { headers: { "content-type": "application/octet-stream" } }) });
  assert.ok(read.sites.length > 2000);
  assert.ok(read.blanks.some(blank => blank.reason === "earlier-election"));
  assert.ok(read.sites.every(site => site.electionDate !== "2026-11-03"));
});

test("the published next-page form acquires the remaining native early-vote sites", async () => {
  const { votingPageRequests, readVotingPages } = await import("../lib/ballot/voting-source-pages.ts");
  const first = { url: "https://vip.sos.nd.gov/Precincts.aspx?eid=348", contentType: "text/html", bytes: fixture("nd-2026-native.html") };
  const next = { ...first, bytes: fixture("nd-2026-early-page2-native.html") };
  const requests = votingPageRequests(new TextDecoder().decode(first.bytes), first.url);
  const early = requests.find(request => request.grid.includes("EarlyVoting"))!;
  assert.equal(early.pageCount, 2);
  const form = new URLSearchParams(early.body);
  assert.equal(form.get("__EVENTTARGET"), early.target);
  assert.ok(form.has("__VIEWSTATE"));
  const session = votingFetchSession({ fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    const params = new URLSearchParams(String(init?.body));
    if (params.get("__EVENTTARGET") === early.target) return new Response(next.bytes, { headers: { "content-type": "text/html" } });
    throw new Error("Other grids remain separate fixture work");
  } });
  const read = await readVotingPages(first, session);
  assert.equal(read.captures.length, 1);
  const door: VotingSourceDoor = { ...NC, shape: "list-page", extraction: { format: "html" }, covers: ["ELECTION_DAY", "EARLY_VOTING", "DROP_BOX"] };
  const rows = (await Promise.all([first, ...read.captures].map(capture => parseVotingCapture(capture, door)))).flat();
  const sites = votingRowsToSites(rows, door, source).sites.filter(site => site.kind === "EARLY_VOTING");
  assert.equal(sites.length, 16);
  assert.equal(sites.find(site => site.name === "Sitting Bull College")?.locationNotes, "Absentee Voting Day - October 27th, 2026 3pm-5pm");
});

test("an identity-locked state is answered from the native county list without voter identity", async () => {
  const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
  const door = doors.find(item => item.id === "tx-el-paso-vote-centers-2026")!;
  const urls: string[] = [];
  const read = await readVotingSource(door, { fetch: async input => {
    const url = String(input); urls.push(url);
    return url.endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } }) : new Response(fixture("tx-el-paso-vote-centers-native.html"), { headers: { "content-type": "text/html" } });
  } });
  assert.equal(read.sites.length, 123);
  assert.equal(read.sites.find(site => site.name === "Agua Dulce Community Center")?.address, "15371 Kentwood Ave. 79928");
  assert.ok(read.sites.every(site => site.hours === "7:00 a.m. to 7:00 p.m."));
  assert.ok(urls.every(url => !/birth|dob|ssn|ivis|votername/i.test(url)));
  assert.equal(urls.filter(url => !url.endsWith("/robots.txt")).length, 1);
});

test("an earlier election named only in the official file title stays an open blank in the same year", async () => {
  const original = primaryDoor;
  const door = structuredClone(original);
  delete door.extraction!.columns!.election;
  const bytes = fixture("nc-polling-place-20260303-native.csv.bin");
  const read = await readVotingSource(door, { fetch: async input => new URL(String(input)).pathname === "/robots.txt" ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } }) : new Response(bytes, { headers: { "content-type": "application/octet-stream" } }) });
  assert.equal(read.fileTitle, "March 3, 2026 polling places");
  assert.ok(read.sites.length > 2000, "The current official file remains visible");
  const earlier = read.blanks.filter(blank => blank.reason === "earlier-election");
  assert.equal(earlier.length, 1, "The title, not a mapped row date, creates the blank");
  assert.ok(earlier[0]!.tried.includes("2026-03-03"));
  assert.ok(earlier[0]!.tried.includes(original.title!));
});

test("native statewide site debts stay with their exact registered county", async () => {
  const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
  const polling = { ...doors.find(item => item.id === "mt-statewide-polling-2026")!, electionAssociationVerified: false };
  const beaverhead = { state: "MT", ocdId: "ocd-division/country:us/state:mt/county:beaverhead", name: "Beaverhead County", countyFips: "30001" };
  const bigHorn = { state: "MT", ocdId: "ocd-division/country:us/state:mt/county:big_horn", name: "Big Horn County", countyFips: "30003" };
  const bytes = fixture("mt-2026-polling-satellite.xlsx");
  const runtime = {
    fetch: (async input => new URL(String(input)).pathname === "/robots.txt" ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } }) : new Response(bytes, { headers: { "content-type": "application/octet-stream" } })) as typeof fetch,
    resolveScope: (label: string) => label === "Beaverhead" ? beaverhead : label === "Big Horn" ? bigHorn : null,
    geocode: async () => null,
  };
  const read = await readVotingSource(polling, runtime);
  const dillonPin = read.blanks.filter(blank => blank.reason === "geocode" && blank.owed.includes("LUTHERAN CHURCH - CENTRAL"));
  assert.ok(dillonPin.length > 0);
  assert.ok(dillonPin.every(blank => blank.scope.ocdId === beaverhead.ocdId && blank.scope.countyFips === "30001"));
  assert.ok(dillonPin.every(blank => blank.scope.ocdId !== bigHorn.ocdId));
  const missingAddress = structuredClone(polling);
  missingAddress.extraction!.columns!.address = "unread-address-column";
  const extraction = await readVotingSource(missingAddress, runtime);
  const beaverheadRows = extraction.blanks.filter(blank => blank.owed.startsWith("Published Beaverhead:"));
  assert.ok(beaverheadRows.length > 0);
  assert.ok(beaverheadRows.every(blank => blank.scope.ocdId === beaverhead.ocdId));
  const satellite = { ...doors.find(item => item.id === "mt-statewide-satellite-2026")!, electionAssociationVerified: false };
  const tribalRead = await readVotingSource(satellite, runtime);
  const crowArea = tribalRead.blanks.find(blank => blank.owed === "Census tribal area for Crow Nation satellite office")!;
  assert.equal(crowArea.scope.ocdId, bigHorn.ocdId);
});
