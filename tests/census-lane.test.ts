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
