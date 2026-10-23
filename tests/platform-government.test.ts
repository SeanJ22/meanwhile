import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readPlatformGovernment } from "../lib/control-plane/discovery/platform-government.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordedDiscoveryOpen } from "./helpers/recorded-discovery-open.ts";
import { meetingDoorsProjection } from "../lib/doors/meeting-doors.ts";
import { wiringRowsFromDoors } from "../lib/doors/rows.ts";
import { meetingAcquisitionFailureDomain } from "../lib/civic-data/meeting-partitions.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";

const NOW = "2026-08-14T12:00:00.000Z";
const home = "https://www.amphi.com/", route = "https://meetings.boardbook.org/Public/Organization/2065";
const ocdId = "ocd-division/country:us/state:az/school_district:amphitheater_unified_district";
const bodyId = `${ocdId}#board`;
const need = { jurisdictionId: "az:school:amphitheater-unified-school-district", stateCode: "AZ", name: "Amphitheater Unified School District",
  govClass: "SCHOOL_DISTRICT", countyFips: "04019", ownWebAddress: home, basis: "SOURCE_DISCOVERY_OWED" as const, sources: [],
  addressSource: { source: "OPERATIONAL_REFERENCE" as const, versionId: "recorded-registration" } };
const registered = { bodyId, ocdId, publishingOrg: need.name, countyFips: need.countyFips,
  input: { kind: "PROMOTED_VERSION" as const, recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", versionId: "registration-fixture",
    readModelSha256: "c".repeat(64), promotedAt: NOW } };
const runtime = () => ({
  open: recordedDiscoveryOpen({
    [`${home}robots.txt`]: { status: 200, body: "User-agent: *\nAllow: /" },
    [home]: { status: 200, body: `<h1>Amphitheater Governing Board</h1><a href="${route}">Governing Board meetings</a>` },
    "https://meetings.boardbook.org/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" },
    [route]: { status: 200, body: readFileSync(new URL("./fixtures/boardbook-amphi-2065.html", import.meta.url), "utf8") },
  }),
  readOfficialPages: async () => [{ canonicalUrl: "https://fixture-directory.gov/governments", text: `<a href="${home}">${need.name}</a>` }],
  spaceOut: async () => {}, now: () => NOW, budget: { spent: () => false },
  vault: async () => ({ stored: true, where: "fixture", why: "saved" }),
});

test("saved government and portal evidence opens an ordinary scheduled door with its exact school body", async () => {
  const repos = createMemoryRepositories();
  const result = await readPlatformGovernment({ need, registered, runtime: runtime(), repos, reviewer: "auto-crosswalk-reviewer@0123456789ab" });
  assert.ok(result.review.accepted.length, JSON.stringify(result.review.held));
  const doors = (await repos.doors.list()).map(row => row.value);
  assert.ok(doors.length);
  assert.ok(doors.every(door => door.ocdId === ocdId && door.bodyIds[0] === bodyId && door.readNow));
  assert.equal(meetingDoorsProjection(doors).doors.length, doors.length, "the existing door publisher sees it immediately");
  const rows = wiringRowsFromDoors(doors);
  assert.equal(rows[0].config.orgId, "2065");
  assert.equal(meetingAcquisitionFailureDomain("boardbook", rows[0]), "meeting-upstream:meetings.boardbook.org");
});

test("production read-only measurement uses identical verification without writing doors or attempts", async () => {
  const repos = createMemoryRepositories();
  const result = await readPlatformGovernment({ need, registered, runtime: runtime(), repos, reviewer: "auto-crosswalk-reviewer@0123456789ab", readonly: true });
  assert.ok(result.doors.length);
  assert.equal((await repos.doors.list()).length, 0);
  assert.equal((await repos.discoveryAttempts.readAll()).length, 0);
  assert.equal((await repos.fieldManual.list()).length, 0);
});

test("the plain-code census never calls an inherited paid search seam", async () => {
  let paidCalls = 0;
  const result = await readPlatformGovernment({ need, registered, repos: createMemoryRepositories(), readonly: true,
    reviewer: "auto-crosswalk-reviewer@0123456789ab", runtime: { ...runtime(),
      open: recordedDiscoveryOpen({ [home]: { status: 200, body: "<h1>Amphitheater Unified School District</h1>" } }),
      search: async () => { paidCalls++; throw new Error("Paid search belongs to Admin's scoped work"); } } });
  assert.ok(result.attempt);
  assert.equal(paidCalls, 0);
});

test("a government is not marked checked before its verified doors have been saved", async () => {
  const repos = createMemoryRepositories();
  repos.doors.put = async () => { throw new Error("door write interrupted"); };
  await assert.rejects(readPlatformGovernment({ need, registered, runtime: runtime(), repos,
    reviewer: "auto-crosswalk-reviewer@0123456789ab" }), /door write interrupted/);
  assert.equal((await repos.fieldManual.list()).length, 0, "an interrupted door write leaves the standing check due");
});

test("a government-site link to the exact custom-domain Legistar tenant reaches its native API", async () => {
  const repos = createMemoryRepositories();
  const division = "ocd-division/country:us/state:or/place:example";
  const city = { ...need, jurisdictionId: "or:city:city-of-example", stateCode: "OR", countyFips: "41051", name: "City of Example",
    govClass: "CITY_OR_TOWN", ownWebAddress: "https://example.gov/" };
  const page = '<title>City of Example - Calendar</title><a href="https://example.gov/">City of Example</a>';
  const endpoint = new URL("https://webapi.legistar.com/v1/fixture/events");
  endpoint.searchParams.set("$filter", "EventDate ge datetime'2026-04-16' and EventDate le datetime'2026-12-12'");
  endpoint.searchParams.set("$orderby", "EventId");
  endpoint.searchParams.set("$top", "1000");
  endpoint.searchParams.set("$skip", "0");
  const open = recordedDiscoveryOpen({
    "https://example.gov/": { status: 200, body: '<a href="https://fixture.legistar.com/">Meetings</a>' },
    "https://fixture.legistar.com/": { status: 302, location: "https://meetings.example.gov/" },
    "https://meetings.example.gov/": { status: 200, body: page },
    "https://meetings.example.gov/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" },
    "https://webapi.legistar.com/robots.txt": { status: 404 },
    "https://webapi.legistar.com/v1/fixture/bodies": { status: 200, body: JSON.stringify([{ BodyId: 10, BodyName: "City Council" }]) },
    [endpoint.href]: { status: 200, body: JSON.stringify([{ EventId: 1, EventBodyId: 10, EventBodyName: "City Council", EventDate: "2026-08-18T00:00:00", EventTime: "6:00 PM" }]) },
  });
  const result = await readPlatformGovernment({ need: city, registered: { ...registered, bodyId: `${division}#governing`, ocdId: division, publishingOrg: city.name,
    countyFips: city.countyFips, input: { ...registered.input, scope: "US-OR:registration:v1" } },
    runtime: { ...runtime(), open }, repos, readonly: true, reviewer: "auto-crosswalk-reviewer@0123456789ab",
    tenant: { platform: "legistar", url: "https://fixture.legistar.com/", name: city.name, state: "OR", source: "public customer directory" } });
  assert.ok(result.doors.length, JSON.stringify({ held: result.review.held, attempt: result.attempt }));
  assert.equal(result.doors[0].config!.slug, "fixture");
  assert.equal(result.doors[0].config!.eventBodyId, "10");
  assert.deepEqual(result.doors[0].bodyIds, [`${division}#governing`]);
});

test("a public InSite grid opens the existing HTML adapter when the native API refuses access", async () => {
  const portal = "https://fixture.legistar.com/Calendar.aspx";
  const fixture = readFileSync(new URL("./fixtures/legistar-insite-pima-calendar-this-month.html", import.meta.url), "utf8");
  const city = { ...need, jurisdictionId: "az:county:county-of-pima", name: "County of Pima", govClass: "COUNTY", ownWebAddress: "https://pima.gov/" };
  const apiRequests: string[] = [];
  const opened = recordedDiscoveryOpen({
    "https://pima.gov/": { status: 200, body: `<a href="${portal}">Meetings</a>` },
    [portal]: { status: 200, body: '<title>Pima County - Calendar</title><a href="https://pima.gov/">County website</a>' + fixture },
    "https://fixture.legistar.com/": { status: 302, location: portal },
    "https://fixture.legistar.com/robots.txt": { status: 404 },
    "https://webapi.legistar.com/v1/fixture/events?$top=5": { status: 403 },
    "https://webapi.legistar.com/v1/fixture/bodies": { status: 403 },
  });
  const result = await readPlatformGovernment({ need: city, registered: { ...registered,
    bodyId: "ocd-division/country:us/state:az/county:pima#governing", ocdId: "ocd-division/country:us/state:az/county:pima", publishingOrg: city.name },
    runtime: { ...runtime(), open: async input => { if (input.url.includes("webapi.legistar.com") && !input.url.endsWith("robots.txt")) apiRequests.push(input.url); return opened(input); } },
    repos: createMemoryRepositories(), readonly: true, reviewer: "auto-crosswalk-reviewer@0123456789ab",
    tenant: { platform: "legistar", url: portal, name: city.name, state: "AZ", source: "public directory" } });
  const html = result.doors.find(door => door.kind === "legistar-insite");
  assert.ok(html, JSON.stringify(result.review.held));
  assert.equal(html.config!.insiteBodyName, "Board of Supervisors");
  assert.equal(html.bodyIds![0], "ocd-division/country:us/state:az/county:pima#governing");
  assert.equal(new Set(apiRequests).size, apiRequests.length, "an API access refusal is not retried by the native fallback");
});

test("different registered districts in one county keep their own governing and committee bodies", async () => {
  const division = "ocd-division/country:us/state:az/county:pima";
  const portal = "https://district.legistar.com/Calendar.aspx", website = "https://water.gov/";
  const endpoint = new URL("https://webapi.legistar.com/v1/district/events");
  endpoint.searchParams.set("$filter", "EventDate ge datetime'2026-04-16' and EventDate le datetime'2026-12-12'");
  endpoint.searchParams.set("$orderby", "EventId"); endpoint.searchParams.set("$top", "1000"); endpoint.searchParams.set("$skip", "0");
  const open = recordedDiscoveryOpen({
    [website]: { status: 200, body: `<a href="${portal}">Meetings</a>` },
    [portal]: { status: 200, body: `<title>Water District - Calendar</title><a href="${website}">District website</a>` },
    "https://district.legistar.com/robots.txt": { status: 404 }, "https://webapi.legistar.com/robots.txt": { status: 404 },
    "https://webapi.legistar.com/v1/district/bodies": { status: 200, body: JSON.stringify([{ BodyId: 10, BodyName: "Board of Directors" }, { BodyId: 11, BodyName: "Finance Committee" }]) },
    [endpoint.href]: { status: 200, body: JSON.stringify([
      { EventId: 1, EventBodyId: 10, EventBodyName: "Board of Directors", EventDate: "2026-08-18T00:00:00", EventTime: "6:00 PM" },
      { EventId: 2, EventBodyId: 11, EventBodyName: "Finance Committee", EventDate: "2026-08-19T00:00:00", EventTime: "6:00 PM" },
    ]) },
  });
  const ids: string[][] = [];
  for (const pid of [100, 200]) {
    const governmentId = `government:US-AZ:cog:${pid}`;
    const got = await readPlatformGovernment({ repos: createMemoryRepositories(), readonly: true, reviewer: "auto-crosswalk-reviewer@0123456789ab",
      need: { ...need, jurisdictionId: `az:special:water-${pid}`, name: "Water District", govClass: "SPECIAL_DISTRICT", ownWebAddress: website },
      registered: { ...registered, publishingOrg: "Water District", governmentId, governmentClass: "SPECIAL_DISTRICT", bodyId: `${governmentId}#governing`, ocdId: division },
      runtime: { ...runtime(), open }, tenant: { platform: "legistar", url: portal, name: "Water District", state: "AZ", source: "public directory" } });
    assert.equal(got.doors.length, 2, JSON.stringify(got.review.held));
    ids.push(got.doors.flatMap(door => door.bodyIds ?? []));
    assert.ok(ids.at(-1)!.every(id => id.startsWith(`${governmentId}#`)));
  }
  assert.ok(ids[0].every(id => !ids[1].includes(id)), "one county never collapses separate governments' boards");
});

test("a government's recorded CivicPlus website supplies its calendar", async () => {
  const host = "www.cochise.az.gov", portal = `https://${host}/AgendaCenter`, index = `https://${host}/iCalendar.aspx`;
  const feed = `https://${host}/common/modules/iCalendar/iCalendar.aspx?catID=31&feed=calendar`;
  const token = [{ alg: "RS256", typ: "at+jwt" }, { exp: 1792550000, iss: "https://fixture.example" }]
    .map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).concat("S1gn4tur3".repeat(4)).join(".");
  const page = '<title>Cochise County, AZ • CivicEngage</title><script src="/Common/Modules/Calendar/calendar.js"></script><a href="/iCalendar.aspx">Calendar</a>'
    + `<script>window.publicClientToken="Bearer ${token}"</script><a href="/AgendaCenter/PreviousVersions/1">Old agenda versions</a>`;
  const open = recordedDiscoveryOpen({
    [portal]: { status: 200, body: page }, [`https://${host}/`]: { status: 200, body: page },
    [`https://${host}/robots.txt`]: { status: 200, body: "User-agent: *\nAllow: /" },
    [index]: { status: 200, body: readFileSync(new URL("./fixtures/civicplus-cochise-icalendar.html", import.meta.url), "utf8") },
    [feed]: { status: 200, body: readFileSync(new URL("./fixtures/civicplus-cochise-board-of-supervisors.ics", import.meta.url), "utf8"), contentType: "text/calendar" },
  });
  const requests: string[] = [], root = await mkdtemp(join(tmpdir(), "mp01-platform-evidence-")), vault = cycleVault(root);
  const division = "ocd-division/country:us/state:az/county:cochise";
  try {
  const got = await readPlatformGovernment({ repos: createMemoryRepositories(), readonly: true, reviewer: "auto-crosswalk-reviewer@0123456789ab",
    need: { ...need, jurisdictionId: "az:county:county-of-cochise", name: "County of Cochise", govClass: "COUNTY", countyFips: "04003", ownWebAddress: `https://${host}/` },
    registered: { ...registered, publishingOrg: "County of Cochise", bodyId: `${division}#governing`, ocdId: division, countyFips: "04003" },
    runtime: { ...runtime(), open: input => { requests.push(input.url); return open(input); }, vault: vault.put }, tenant: { platform: "civicplus", url: portal, name: "Cochise County", state: "AZ", source: "public customer directory" } });
  assert.ok(got.doors.some(door => door.config?.feedUrl === feed), JSON.stringify(got.review.held));
  assert.ok(got.doors.every(door => !/\/AgendaCenter\/(?:ViewFile|PreviousVersions)\//i.test(String(door.config?.route ?? ""))));
  assert.ok(requests.every(url => !/\/AgendaCenter\/(?:ViewFile|PreviousVersions)\//i.test(url)), "calendar enumeration leaves individual agenda documents to their doors");
  assert.ok([...vault.ledger.values()].filter(row => row.canonicalUrl === portal).every(row => row.tier === "SANITIZED_DERIVED"), "a retained derivative never becomes raw evidence on the next parser call");
  assert.ok([...got.held.values()].every(bytes => !bytes.text.includes(token)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("matching titles and portal backlinks cannot attach an unrelated in-state tenant", async () => {
  for (const example of [
    { name: "Metro", state: "OR", website: "https://oregonmetro.gov/", portal: "https://metro.legistar.com/", kind: "SPECIAL_DISTRICT" },
    { name: "Russian River County Water District", state: "CA", website: "https://rrcountywater.gov/", portal: "https://ca-ventura.civicclerk.com/", kind: "SPECIAL_DISTRICT" },
    { name: "Lee County", state: "FL", website: "https://leegov.com/", portal: "https://pub-capecoral.escribemeetings.com/", kind: "COUNTY" },
  ]) {
    const repos = createMemoryRepositories(), requests: string[] = [];
    const open = recordedDiscoveryOpen({
      [example.website]: { status: 200, body: `<title>${example.name}</title><h1>Official website</h1><script src="/Common/Modules/Calendar/calendar.js"></script>` },
      [example.portal]: { status: 200, body: `<title>${example.name} - Calendar</title><a href="${example.website}">Government</a>` },
    });
    const got = await readPlatformGovernment({ need: { ...need, jurisdictionId: `${example.state.toLowerCase()}:special:fixture`, name: example.name,
      govClass: example.kind, stateCode: example.state, ownWebAddress: example.website }, registered, repos,
      runtime: { ...runtime(), open: request => { requests.push(request.url); return open(request); } },
      reviewer: "auto-crosswalk-reviewer@0123456789ab", tenant: { platform: "legistar", url: example.portal, name: example.name,
        state: example.state, source: "public directory" } });
    assert.deepEqual(got.doors, [], example.name);
    assert.deepEqual(await repos.doors.list(), [], example.name);
    assert.ok(!requests.some(url => url.includes("webapi.legistar.com")), "an unconfirmed portal never starts its member/body API reads");
  }
});
