import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { censusCheckEntry, exactDomainFor, officialWebsiteQuery, runCensusState, websiteNamesGovernment } from "../lib/control-plane/discovery/census-lane.ts";
import { dotgovDomainLeads, heldCensusWebsiteNeeds } from "../lib/control-plane/discovery/platform-census.ts";
import { newFieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordedDiscoveryOpen } from "./helpers/recorded-discovery-open.ts";
import type { DiscoveryRuntime } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { runPageDoorChecks, recheckShutDoors } from "../lib/doors/page-check.ts";
import { pageDoorDraft, recordPublishedPages } from "../lib/doors/page-doors.ts";
import { upsertDerivedDoor } from "../lib/doors/registry.ts";
import { meetingEndpointCandidates } from "../lib/hunt/meetings-site-discovery.ts";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { CENSUS_LANE_INTERVAL_MS } from "../lib/control-plane/discovery/census-lane.ts";
import { routeHintsDoorId, seedRouteHintDoors } from "../lib/doors/route-hints.ts";
import { indexReportedFinding, indexScoutFindings } from "../lib/control-plane/box.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const NOW = "2026-10-13T12:00:00.000Z";
const source = "https://meetings.boardbook.org/Public/Organization/2065";
const home = "https://www.amphi.com/";
const need = { jurisdictionId: "az:school:amphitheater-unified-school-district", name: "Amphitheater Unified School District", stateCode: "AZ", govClass: "SCHOOL_DISTRICT", countyFips: "04019", ownWebAddress: home, basis: "SOURCE_DISCOVERY_OWED" as const, sources: [] };
const runtime = (over: Partial<DiscoveryRuntime> = {}): DiscoveryRuntime => ({ now: () => NOW, spaceOut: async () => {}, budget: { spent: () => false },
  vault: async () => ({ stored: true, where: "fixture", why: "saved" }),
  open: recordedDiscoveryOpen({ [home]: { status: 200, body: `<a href="${source}">Governing Board meetings</a>` },
    [source]: { status: 200, body: fixture("boardbook-amphi-2065.html") },
    [`${home}robots.txt`]: { status: 200, body: "User-agent: *\nDisallow: /\n" } }), ...over });

const hint = { url: source, body: "Amphitheater Governing Board", kind: "PAGE" as const, platform: "boardbook",
  verifyAs: "boardbook" as const, evidence: "Recorded official board calendar", observed: { at: NOW, by: "hunter" } };
const calendar = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:amphi-board\nDTSTART:20261015T190000Z\nSUMMARY:Amphitheater Governing Board\nEND:VEVENT\nEND:VCALENDAR";
const hiddenRuntime = (trail: string[], pages: Record<string, { status: number; body: string }> = {}) => {
  const open = recordedDiscoveryOpen({ [home]: { status: 200, body: "<h1>Amphitheater Unified School District</h1>" },
    [source]: { status: 200, body: fixture("boardbook-amphi-2065.html") }, ...pages });
  return runtime({ open: async input => { trail.push(input.url); return open(input); },
    search: async () => { trail.push("SEARCH"); return { hits: [], requests: [] }; } });
};

test("the production census reads a seeded hidden route before searches, reports its meetings, and observes a live door edit immediately", async () => {
  const repos = createMemoryRepositories();
  await seedRouteHintDoors({ repo: repos.doors, hints: [{ jurisdictionId: need.jurisdictionId, officialSite: null, routes: [hint] }], deriveInputAt: NOW, at: NOW });
  const trail: string[] = [];
  const run = hiddenRuntime(trail);
  const report = await runCensusState({ repos, state: "AZ", needs: [need], runtime: run });
  assert.equal(report.walked, 1, JSON.stringify(report));
  assert.equal(report.hintMeetings.length, 1);
  assert.equal(report.hintMeetings[0].body, hint.body);
  assert.ok(report.hintMeetings[0].count > 0);
  assert.ok(trail.indexOf(source) < trail.indexOf("SEARCH"), JSON.stringify(trail));
  assert.equal(trail.filter(url => url === source).length, 1, "the evidence read is reused by the content check");
  assert.deepEqual((await repos.discoveryAttempts.read(need.jurisdictionId))[0].routeHints?.routes, [source]);
  assert.equal((await runCensusState({ repos, state: "AZ", needs: [need], runtime: run })).notDue, 1);
  const row = await repos.doors.mustRead(routeHintsDoorId(need.jurisdictionId));
  const revised = `${source}?current=1`;
  await repos.doors.compareAndSet(row.id, row.revision, { ...row.value, config: { ...row.value.config,
    "route:00": JSON.stringify({ ...hint, url: revised }) } }, NOW);
  const changed = await runCensusState({ repos, state: "AZ", needs: [need], runtime: { ...hiddenRuntime([], { [revised]: { status: 200, body: fixture("boardbook-amphi-2065.html") } }),
    now: () => "2026-10-13T12:00:00.001Z" } });
  assert.equal(changed.walked, 1, JSON.stringify(changed));
  assert.equal(changed.notDue, 0);
  assert.equal(changed.hintMeetings[0].url, revised);
});

test("a current official-site hint supplies the homepage before searching and keeps its actual source", async () => {
  const repos = createMemoryRepositories();
  const current = "https://current-amphi.example.gov";
  await seedRouteHintDoors({ repo: repos.doors, hints: [{ jurisdictionId: need.jurisdictionId, routes: [],
    officialSite: { origin: current, selfName: need.name, replaces: home, recordedState: "retired address",
      evidence: ["Recorded official domain registration"], observed: { at: NOW, by: "hunter" } } }], deriveInputAt: NOW, at: NOW });
  const trail: string[] = [];
  const report = await runCensusState({ repos, state: "AZ", needs: [need], runtime: hiddenRuntime(trail, {
    [`${current}/`]: { status: 200, body: `<h1>${need.name}</h1><a href="/board.ics">Board meetings</a>` },
    [`${current}/board.ics`]: { status: 200, body: calendar } }) });
  assert.equal(report.hintMeetings.length, 1, JSON.stringify(report));
  assert.equal(report.hintMeetings[0].url, `${current}/board.ics`);
  assert.ok(trail.indexOf(`${current}/`) < trail.indexOf("SEARCH"));
  assert.ok(!trail.includes(home));
  const hosts = await repos.fieldManual.slice({ kinds: ["ENTITY_HOST"], state: "az" });
  assert.equal((hosts[0].value.payload as { source: string }).source, "ROUTE_HINT");
});

test("MTG-01/02 hunter findings are reused only for their exact registered body, including cross-subject and mid-walk drops", async () => {
  const repos = createMemoryRepositories();
  const bodyId = "ocd-division/country:us/state:az/school_district:amphitheater#board";
  await repos.workItems.put("directory-source", { id: "directory-source", subject: "directory-job",
    autonomousPlan: { directorySubject: { jurisdiction: { id: need.jurisdictionId } } },
    publicationOutcome: { status: "PUBLISHED", bodyIds: [bodyId], at: NOW } } as unknown as WorkItem, NOW);
  const unverifiedBody = `${bodyId}-unverified`;
  await repos.workItems.put("held-directory", { id: "held-directory", subject: need.jurisdictionId,
    publicationOutcome: { status: "HELD", bodyIds: [unverifiedBody], at: NOW } } as unknown as WorkItem, NOW);
  const urls = [source, `${source}?agenda=1`, `${source}?dropped=1`];
  const result = { attemptId: "hunter-calendar", obligationId: "hunter-county", subjectId: "az:county:pima", workItemId: "wi-hunter", recordedAt: NOW,
    findings: [
      { kind: "POINTER", subjectId: bodyId, field: "MTG-01", value: urls[0], sourceUrl: home, summary: "Board calendar", artifactIds: ["ar-calendar"] },
      { kind: "RECORD", subjectId: `${bodyId}#calendar`, missionPart: "MTG-02", sourceUrl: urls[1], exactQuote: "Published governing board agendas", summary: "Agendas", artifactIds: ["ar-agenda"] },
      { kind: "POINTER", subjectId: "az:city:another-city", field: "MTG-01", value: "https://another-city.gov/calendar.ics", summary: "Other body", artifactIds: ["ar-other"] },
      { kind: "RECORD", subjectId: bodyId, field: "meeting.agendaPosting", value: "Outside on the marquee", sourceUrl: "https://amphi.com/posting-rule", summary: "Posting rule", artifactIds: ["ar-rule"] },
      { kind: "POINTER", subjectId: unverifiedBody, field: "MTG-01", value: "https://unverified-body.gov/calendar.ics", summary: "Unpublished body", artifactIds: ["ar-unverified"] },
    ] } as unknown as ScoutResult;
  await repos.scoutResults.append(result.obligationId, result.attemptId, result, NOW);
  await indexScoutFindings(repos.boxFindings, result, NOW);
  await indexReportedFinding(repos.boxFindings, { workItemId: "wi-drop", attemptId: "hunter-drop", missionPart: "MTG-01",
    finding: { subjectId: bodyId, field: "calendarSourceUrl", value: urls[2], exactQuote: "Governing Board meeting calendar", sourceUrl: home,
      artifactIds: ["ar-drop"], subjectHint: null, index: 0 } }, NOW);
  repos.scoutResults.readAll = async () => { throw new Error("countrywide hunter read"); };
  repos.boxFindings.list = async () => { throw new Error("countrywide finding read"); };
  repos.workItems.list = async () => { throw new Error("countrywide body-publication read"); };
  const trail: string[] = [];
  const report = await runCensusState({ repos, state: "AZ", needs: [need],
    runtime: hiddenRuntime(trail, Object.fromEntries(urls.map(url => [url, { status: 200, body: fixture("boardbook-amphi-2065.html") }]))) });
  assert.equal(report.walked, 1, JSON.stringify(report));
  assert.deepEqual(new Set(report.hintMeetings.map(row => row.url)), new Set(urls));
  for (const url of urls) assert.ok(trail.indexOf(url) < trail.indexOf("SEARCH"));
  assert.ok(!trail.some(url => /another-city|posting-rule|unverified-body/.test(url)));
  const attempt = (await repos.discoveryAttempts.read(need.jurisdictionId))[0];
  assert.ok(attempt.found.every(row => row.hintUrl && urls.includes(row.hintUrl)));
});

test("saved meeting-discovery routes are inherited before a website search and remain usable without a recorded homepage", async () => {
  const repos = createMemoryRepositories();
  const url = "https://calendar.example.gov/council.ics";
  const entry = newFieldManualEntry("hunter", "calendar", { kind: "SCOUT_DISCOVERY", role: "SCOUT", title: "Board calendar", summary: "Read the council calendar",
    states: ["az"], recordClasses: ["meetings-discovery"], observedAt: NOW, outcome: "YIELDED", url,
    payload: { obligationId: `freshness:meetings-discovery:${need.jurisdictionId}#own-site`, evidenceArtifactIds: ["ar-calendar"] } });
  const trail: string[] = [];
  const open = recordedDiscoveryOpen({ [url]: { status: 200, body: calendar } });
  const report = await runCensusState({ repos, state: "AZ", needs: [{ ...need, ownWebAddress: null }], entries: [entry],
    runtime: runtime({ open: async input => { trail.push(input.url); return open(input); }, search: async () => { trail.push("SEARCH"); return { hits: [], requests: [] }; } }) });
  assert.equal(report.walked, 1, JSON.stringify(report));
  assert.ok(trail.indexOf(url) < trail.indexOf("SEARCH"));
  assert.equal(report.hintMeetings.length, 1);
  assert.equal((await repos.discoveryAttempts.read(need.jurisdictionId))[0].outcome, "FOUND");
});

test("suspended hints, empty calendars, witnesses, and ordinary homepage finds never become hint-meeting wins", async () => {
  for (const mode of ["SUSPENDED", "EMPTY", "WITNESS", "ORDINARY"] as const) {
    const repos = createMemoryRepositories();
    const url = mode === "EMPTY" ? "https://calendar.example.gov/empty.ics" : source;
    await seedRouteHintDoors({ repo: repos.doors, hints: [{ jurisdictionId: need.jurisdictionId, officialSite: null,
      routes: [{ ...hint, url, ...(mode === "EMPTY" ? { verifyAs: "ical" as const } : {}),
        ...(mode === "WITNESS" ? { kind: "WITNESS" as const, verifyAs: null } : {}) }] }], deriveInputAt: NOW, at: NOW });
    if (mode === "SUSPENDED") {
      const row = await repos.doors.mustRead(routeHintsDoorId(need.jurisdictionId));
      await repos.doors.compareAndSet(row.id, row.revision, { ...row.value, status: "SUSPENDED" }, NOW);
    }
    const trail: string[] = [];
    const report = await runCensusState({ repos, state: "AZ", needs: [need], runtime: mode === "ORDINARY" ? runtime({
      open: recordedDiscoveryOpen({ [home]: { status: 200, body: `<a href="${home}normal.ics">Meetings</a>` },
        [source]: { status: 404, body: "missing" }, [`${home}normal.ics`]: { status: 200, body: calendar } }) })
      : hiddenRuntime(trail, mode === "EMPTY" ? { [url]: { status: 200, body: "BEGIN:VCALENDAR\nEND:VCALENDAR" } } : {}) });
    assert.equal(report.hintMeetings.length, 0, JSON.stringify({ mode, report }));
    if (mode === "SUSPENDED") assert.ok(!trail.includes(url));
    if (mode === "ORDINARY") assert.ok((await repos.discoveryAttempts.read(need.jurisdictionId))[0].found.some(row => (row.count ?? 0) > 0));
  }
});

test("a hinted vendor inventory reports the named body with meetings, excluding notices and empty body calendars", async () => {
  const repos = createMemoryRepositories();
  const url = "https://aster.api.civicclerk.com/v1/Events?$top=20";
  const city = { ...need, jurisdictionId: "az:city:city-of-aster", name: "City of Aster", govClass: "CITY_OR_TOWN" };
  await seedRouteHintDoors({ repo: repos.doors, hints: [{ jurisdictionId: city.jurisdictionId, officialSite: null,
    routes: [{ ...hint, url, body: "City Council", verifyAs: "civicclerk-api" }] }], deriveInputAt: NOW, at: NOW });
  const open = recordedDiscoveryOpen({ [home]: { status: 200, body: "<h1>City of Aster</h1>" } });
  const report = await runCensusState({ repos, state: "AZ", needs: [city], runtime: runtime({ open: async input => {
    const target = new URL(input.url);
    let value: unknown;
    if (target.pathname === "/v1/EventCategories") value = [{ id: 1, categoryDesc: "City Council" }, { id: 2, categoryDesc: "Public Notice" },
      { id: 3, categoryDesc: "Planning & Zoning Commission" }, { id: 4, categoryDesc: "Parks, Recreation and Library Advisory Board" }];
    else if (target.pathname === "/v1/Events") {
      const category = /categoryId eq (\d+)/.exec(target.searchParams.get("$filter") ?? "")?.[1];
      value = category === "3" ? [] : category ? [{ id: Number(category), categoryId: Number(category) }] : [{ id: 1, categoryId: 1 }, { id: 2, categoryId: 2 }];
    } else return open(input);
    const body = JSON.stringify({ value });
    return { status: 200, body, bytes: body.length, contentType: "application/json", location: null, transportError: null };
  } }) });
  assert.equal(report.walked, 1, JSON.stringify(report));
  assert.deepEqual(report.hintMeetings.map(row => [row.body, row.count]), [["City Council", 1], ["Parks, Recreation and Library Advisory Board", 1]]);
  const council = (await repos.discoveryAttempts.read(city.jurisdictionId))[0].found.find(row => row.bodyName === "City Council");
  assert.equal(council?.hintUrl, url);
});

test("the census walks changed sources, keeps robots as evidence, and an unchanged later clock makes no second walk", async () => {
  const repos = createMemoryRepositories();
  let at = NOW;
  const run = runtime({ now: () => at });
  const first = await runCensusState({ repos, state: "AZ", needs: [need], runtime: run });
  assert.equal(first.walked, 1, JSON.stringify(first));
  const walk = (await repos.discoveryAttempts.read(need.jurisdictionId))[0];
  assert.ok(walk.found.some(row => row.vendor === "boardbook"));
  assert.ok(walk.steps.some(step => step.permission === "DISALLOWED" && step.purpose === "homepage"));
  assert.equal(walk.site?.address?.source, "WEBSITE_EVIDENCE");
  assert.equal((await runCensusState({ repos, state: "AZ", needs: [need], runtime: run })).notDue, 1);
  at = "2026-10-14T01:00:00.000Z";
  assert.equal((await runCensusState({ repos, state: "AZ", needs: [need], runtime: run })).unchanged, 1);
  assert.equal((await repos.discoveryAttempts.read(need.jurisdictionId)).length, 1);
  at = "2026-10-15T01:00:00.000Z";
  const changed = runtime({ now: () => at, open: recordedDiscoveryOpen({ [home]: { status: 200, body: `<h1>Governing Board</h1><a href="${source}">Meetings</a>` }, [source]: { status: 200, body: fixture("boardbook-amphi-2065.html") } }) });
  assert.equal((await runCensusState({ repos, state: "AZ", needs: [need], runtime: changed })).walked, 1);
});

test("every due government is checked beyond twelve; unreachable source fixtures leave recorded retry clocks", async () => {
  const repos = createMemoryRepositories();
  const needs = heldCensusWebsiteNeeds("AL").slice(0, 16);
  const report = await runCensusState({ repos, state: "AL", needs, runtime: runtime({ open: recordedDiscoveryOpen({}) }) });
  assert.equal(report.checked, 16);
  assert.equal(report.failures.length, 16);
  for (const row of needs) assert.ok((await repos.fieldManual.readMany([censusCheckEntry(row, null, NOW).id])).length);
});

test("CISA exact identity includes city and state; same-name cities never stand in", () => {
  const csv = fixture("platform-census/dotgov.csv");
  const entries = [ ...dotgovDomainLeads(csv, "ID"), ...dotgovDomainLeads(csv, "MD") ];
  const city = { ...need, name: "City of Aberdeen", city: "Aberdeen", stateCode: "ID" };
  assert.equal(exactDomainFor(city, entries)?.url, "https://aberdeenidaho.gov/");
  assert.equal(exactDomainFor({ ...city, city: "Other" }, entries), null);
  assert.equal(exactDomainFor(city, [...entries, entries[0]]), null);
  assert.equal(officialWebsiteQuery({ ...city, countyName: "Bingham County" }), '"City of Aberdeen" Bingham County ID official website');
  assert.equal(websiteNamesGovernment("<h1>City of Aberdeen</h1><p>Idaho</p>", city), true);
  assert.equal(websiteNamesGovernment("<h1>City of Aberdeen</h1><p>Maryland</p>", city), false);
});

test("a Bank markup override reaches ordinary meeting-site discovery on recorded publisher HTML", () => {
  const html = fixture("civicplus-alameda-water-agendacenter.html");
  const entry = newFieldManualEntry("test", "civicplus", { role: "SHARED", kind: "PLATFORM_FINGERPRINT", title: "CivicPlus", summary: "Saved source fingerprint", outcome: "REFERENCE",
    payload: { id: "civicplus", label: "CivicPlus", hostPattern: "civicplus\\.com$", markup: [{ pattern: "data-cp-toggle", why: "CivicEngage category controls" }] } });
  assert.ok(meetingEndpointCandidates(html, "https://www.acwd.org/", NOW, [entry]).some(row => row.vendor === "civicplus-agendacenter"));
});

test("a SHUT iCal door is reopened from recorded publisher bytes using the runner transport", async () => {
  const repos = createMemoryRepositories();
  const url = "https://www.cochise.az.gov/Calendar.aspx?CID=70";
  const draft = { ...pageDoorDraft({ url, recordClass: "MEETING", retrievedAt: NOW, foundBy: null })!, kind: "ical", config: { feedUrl: url }, status: "OPEN" as const };
  await upsertDerivedDoor(repos.doors, draft, NOW, NOW);
  const row = await repos.doors.mustRead(draft.doorId);
  await repos.doors.compareAndSet(row.id, row.revision, { ...row.value, status: "SHUT", shutSince: NOW, shutReason: "runner transport failure" }, NOW);
  const report = await recheckShutDoors(repos, runtime({ open: recordedDiscoveryOpen({ [url]: { status: 200, body: fixture("civicplus-cochise-board-of-supervisors.ics") } }) }), [(await repos.doors.mustRead(row.id)).value]);
  assert.equal(report.reopened, 1, JSON.stringify(report));
  assert.equal((await repos.doors.mustRead(row.id)).value.status, "OPEN");
});

test("a page carries its government and its own plain reread clock", async () => {
  const repos = createMemoryRepositories();
  const ocdId = "ocd-division/country:us/state:vt/place:bennington";
  const url = "https://www.benningtonvt.org/services/town_clerk/elections___voter_information/index.php";
  await recordPublishedPages(repos.doors, [{ url, retrievedAt: NOW, recordClass: "OFFICIAL_ROSTER", bodyId: `${ocdId}#board`, ocdId, foundBy: "SCOUT", content: { text: readFileSync("tests/fixtures/voting-sources/vt-bennington-elections-original.html", "utf8"), contentType: "text/html", names: ["Bennington"] } }], NOW);
  const [row] = await repos.doors.list();
  assert.equal(row.value.ocdId, ocdId);
  const body = readFileSync("tests/fixtures/voting-sources/vt-bennington-elections-original.html", "utf8");
  const hash = (await import("node:crypto")).createHash("sha256").update(body).digest("hex");
  await repos.doors.compareAndSet(row.id, row.revision, { ...row.value, validators: { contentHash: hash, checkedAt: "2026-09-01T00:00:00.000Z", changedAt: null, etag: null, lastModified: null } }, NOW);
  const report = await runPageDoorChecks(repos, runtime({ open: recordedDiscoveryOpen({ [url]: { status: 200, body } }) }), [(await repos.doors.mustRead(row.id)).value]);
  assert.equal(report.read, 1, JSON.stringify(report));
  assert.equal((await repos.doors.mustRead(row.id)).value.validators?.checkedAt, NOW);
});

test("an unchanged single notice leaves the page clock while its saved evidence remains available", async () => {
  const repos = createMemoryRepositories();
  const url = "https://www.benningtonvt.org/_T8_R868.php";
  const body = readFileSync("tests/fixtures/voting-sources/vt-bennington-nov3-original.html", "utf8");
  const draft = pageDoorDraft({ url, retrievedAt: NOW, recordClass: "VOTING_SITE", ocdId: "ocd-division/country:us/state:vt/place:bennington", foundBy: "SCOUT" })!;
  const { upsertDerivedDoor } = await import("../lib/doors/registry.ts");
  await upsertDerivedDoor(repos.doors, draft, NOW, NOW);
  const row = await repos.doors.mustRead(draft.doorId);
  const hash = (await import("node:crypto")).createHash("sha256").update(body).digest("hex");
  await repos.doors.compareAndSet(row.id, row.revision, { ...row.value, lastSuccessAt: NOW,
    validators: { contentHash: hash, checkedAt: "2026-09-01T00:00:00Z", changedAt: null, etag: null, lastModified: null } }, NOW);
  const report = await runPageDoorChecks(repos, runtime({ open: recordedDiscoveryOpen({ [url]: { status: 200, body } }) }), [(await repos.doors.mustRead(row.id)).value]);
  assert.equal(report.read, 1, JSON.stringify(report));
  assert.equal(report.changed, 0);
  assert.equal((await repos.doors.mustRead(row.id)).value.status, "SUSPENDED");
});

test("a slow research run cannot delay the census admission clock", async () => {
  let finish!: () => void;
  const research = new Promise<void>(resolve => { finish = resolve; });
  let passes = 0;
  const clocks = new IndependentRuntimeLaneScheduler([{ id: "research", everyMs: 60_000, run: () => research },
    { id: "census", everyMs: CENSUS_LANE_INTERVAL_MS, run: async () => { passes++; } }]);
  clocks.tick(0);
  await new Promise(resolve => setImmediate(resolve));
  clocks.tick(CENSUS_LANE_INTERVAL_MS);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(passes, 2);
  finish();
  await clocks.waitForIdle();
});

test("published Legistar native body IDs each become one derived door, including a listed body with no meetings", async () => {
  const { walkMeetingsDiscoveryNeed } = await import("../lib/control-plane/discovery/meetings-discovery-executor.ts");
  const { reviewDiscoveryWalk, textSha256 } = await import("../lib/control-plane/discovery/auto-crosswalk.ts");
  const { wiringRowFor } = await import("../lib/control-plane/discovery/derived-wiring.ts");
  const { doorFromDerivedRecord } = await import("../lib/doors/seed-meetings.ts");
  const { derivedWiringKey } = await import("../lib/civic-data/derived-meeting-wiring.ts");
  const events = JSON.parse(fixture("legistar-mesa-events-future.json"));
  const bodies = [...new Map<number, string>(events.map((event: { EventBodyId: number; EventBodyName: string }) => [event.EventBodyId, event.EventBodyName] as const))]
    .map(([BodyId, BodyName]) => ({ BodyId, BodyName }));
  const captures = new Map<string, import("../lib/control-plane/discovery/auto-crosswalk.ts").HeldBytes>();
  const homepage = "https://www.mesaaz.gov/";
  const original = recordedDiscoveryOpen({ [homepage]: { status: 200, body: '<h1>City of Mesa, Arizona</h1><a href="https://mesa.legistar.com/Calendar.aspx">Meetings</a>' },
    "https://webapi.legistar.com/v1/mesa/events?$top=5": { status: 200, body: JSON.stringify(events) },
    "https://webapi.legistar.com/v1/mesa/bodies": { status: 200, body: JSON.stringify(bodies) } });
  const open: DiscoveryRuntime["open"] = async input => {
    const filter = new URL(input.url).searchParams.get("$filter");
    const id = filter ? /^EventBodyId eq (\d+)/.exec(filter)?.[1] : null;
    if (!id) return original(input);
    const rows = Number(id) === bodies[0].BodyId ? [] : events.filter((event: { EventBodyId: number }) => event.EventBodyId === Number(id));
    const body = JSON.stringify(rows);
    return { status: 200, body, bytes: body.length, contentType: "application/json", location: null, transportError: null };
  };
  const ocdId = "ocd-division/country:us/state:az/place:mesa";
  const attempt = await walkMeetingsDiscoveryNeed({ ...need, jurisdictionId: "az:city:city-of-mesa", name: "City of Mesa", govClass: "CITY_OR_TOWN", countyFips: "04013", ownWebAddress: homepage,
    addressSource: { source: "REGISTRATION", versionId: "recorded-registration" } }, runtime({ open, vault: async (artifact, body) => {
      captures.set(artifact.id, { text: body, sha256: textSha256(body), evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: "RAW", retrievedAt: artifact.retrievedAt } });
      return { stored: true, where: "fixture", why: "saved" };
    } }));
  const result = reviewDiscoveryWalk({ walk: { attempt, recordId: "recorded-walk", recordedAt: NOW },
    registered: { bodyId: `${ocdId}#governing`, ocdId, publishingOrg: "City of Mesa", countyFips: "04013", input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", versionId: "recorded-registration", readModelSha256: "a".repeat(64), promotedAt: NOW } },
    held: id => captures.get(id) ?? null, handWired: () => false, reviewer: "auto-crosswalk-reviewer@0123456789ab", now: NOW });
  const rows = result.accepted.map(record => wiringRowFor(record.row));
  assert.deepEqual(new Set(rows.map(row => row.config.eventBodyId)), new Set(bodies.map(body => String(body.BodyId))), JSON.stringify(result.held));
  assert.equal(new Set(rows.map(row => derivedWiringKey(row.kind, row.bodyId, row.route))).size, bodies.length);
  for (const row of rows) {
    const door = doorFromDerivedRecord({ id: derivedWiringKey(row.kind, row.bodyId, row.route), status: "ACTIVE", row });
    assert.deepEqual(door.bodyIds, [row.bodyId]);
    assert.equal(door.ocdId, ocdId);
  }
});

test("NCES supplies the school website even when its directory row has no city field", async () => {
  const { resolveCensusWebsite, censusReader } = await import("../lib/control-plane/discovery/census-lane.ts");
  const repos = createMemoryRepositories();
  const run = runtime({ open: recordedDiscoveryOpen({ "https://www.amphi.com/": { status: 200, body: fixture("boardbook-amphi-2065.html") } }) });
  const site = newFieldManualEntry("nces", "0400680", { role: "SHARED", kind: "NCES_WEBSITE", title: need.name, summary: "NCES school directory", states: ["az"], outcome: "REFERENCE", url: "https://www.amphi.com/", payload: { name: need.name } });
  const resolved = await resolveCensusWebsite({ repos, need: { ...need, ownWebAddress: null, city: "Tucson" }, runtime: run, entries: [site], reader: censusReader(run, need.jurisdictionId) });
  assert.equal(resolved.ownWebAddress, "https://www.amphi.com");
});
