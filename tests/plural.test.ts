import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bulkUrl,
  CHAMBER_TITLE,
  designationFromLabel,
  designationKey,
  GRAPHQL_DAILY_QUOTA,
  GRAPHQL_MIN_INTERVAL_MS,
  indexDivisions,
  normalize,
  parseCsv,
  pluralRosterIssue,
  requestCount,
  resetRequestCount,
  rowsToPeople,
  type PluralPerson,
} from "../lib/sources/plural/index.ts";
import { coverageAt } from "../lib/registry/server.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };
import { collectNationalPlaceSources, electionDirectorySelection } from "../lib/sources/plural/place.ts";
import { electionPageFields } from "../lib/hunt/election-page.ts";
import { placeSourceReader, PlaceSourceDeferred } from "../lib/hunt/place-source-reader.ts";
import { nationalPlaceJobs } from "../lib/hunt/place-source-admission.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { dueNationalPlaceZips, runNationalPlaceTask, scheduleNationalPlace, placeMadeProgress } from "../lib/hunt/place-source-task.ts";
import { standing, openOccurrence, closeOccurrence } from "../lib/control-plane/scheduler/durable.ts";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { beginAttemptFor, claimRouteTask, registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import { emptyFieldManual, newFieldManualEntry, projectFieldManual } from "../lib/control-plane/field-manual.ts";

test("a 20-place Send offers independent jobs instead of one joined ZIP command", () => {
  const zips = Array.from({ length: 20 }, (_, index) => String(3000 + index).padStart(5, "0"));
  const requestedAt = "2026-10-01T00:00:00.000Z";
  const jobs = nationalPlaceJobs([...zips, zips[0]], { requestedAt, instructions: ["send", "send"] });
  assert.equal(jobs.length, 20);
  assert.equal(new Set(jobs.map(job => job.acquisitionFailureDomain)).size, 20);
  for (const [index, job] of jobs.entries()) {
    assert.equal(job.id, `national-place:${zips[index]}`);
    assert.equal(job.registeredContractId, "registry-runtime-bindings");
    assert.deepEqual(job.command.filter(arg => arg.startsWith("--national-zips=")), [`--national-zips=${zips[index]}`]);
    assert.deepEqual(job.ownerInvocation?.instructions, ["send"]);
    assert.equal(routineTaskDue(job, { lastAttemptedAt: requestedAt, lastSucceededAt: requestedAt }, Date.parse(requestedAt)), true,
      "another body's publication cannot suppress the admitted place job");
  }
  assert.throws(() => nationalPlaceJobs(["bad"], { requestedAt, instructions: [] }), /five-digit ZIPs/);
});

test("below-target places continue every pass until a settled hunt makes no progress", async () => {
  const repos = createMemoryRepositories();
  const now = "2026-10-01T00:00:00.000Z";
  const row = standing({ id: "national-place:03060", subjectId: "zip:03060", recordClass: "OFFICIAL_ROSTER",
    routeId: "national-place-sources", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: now }, now);
  await repos.obligations.put(row.id, row, now);
  const due = await scheduleNationalPlace(repos, row, now, true);
  assert.equal("nextDueAt" in due && due.nextDueAt, now, "a legacy hunt has no explicit no-progress result");
  const occurrence = await openOccurrence(repos, { obligation: row, dueAt: now, now });
  assert.ok(occurrence);
  const task = await repos.routeTasks.mustRead(occurrence.routeTask.id);
  await repos.routeTasks.compareAndSet(task.id, task.revision, { ...task.value, disposition: {
    disposition: "INGESTED", attemptId: "test", at: now, artifactIds: [], observation: null,
    permission: "ALLOWED", transport: "REACHABLE", note: JSON.stringify({ placeProgress: true }) } }, now);
  await closeOccurrence(repos, { occurrenceId: occurrence.occurrence.id, disposition: "INGESTED", unresolvedReason: null, now, workedAt: now });
  const settled = (await repos.obligations.mustRead(row.id)).value;
  assert.equal((await scheduleNationalPlace(repos, settled, now, true) as { nextDueAt: string }).nextDueAt, now);
  const closed = await repos.occurrences.mustRead(occurrence.occurrence.id);
  await repos.occurrences.compareAndSet(closed.id, closed.revision, { ...closed.value, unresolvedReason: "DEFERRED: per-website bound" }, now);
  assert.equal((await scheduleNationalPlace(repos, settled, now, true) as { nextDueAt: string }).nextDueAt, now,
    "a bounded partial hunt that published new facts continues");
  const legacy = await repos.routeTasks.mustRead(task.id);
  await repos.routeTasks.compareAndSet(legacy.id, legacy.revision, { ...legacy.value,
    disposition: { ...legacy.value.disposition!, disposition: "BLOCKED_CURRENTLY", note: "DEFERRED: website request bound; saved responses remain" } }, now);
  assert.equal((await scheduleNationalPlace(repos, settled, now, true) as { nextDueAt: string }).nextDueAt, now,
    "a legacy partial hunt without a progress marker does not establish no progress");
  assert.equal((await scheduleNationalPlace(repos, settled, now, false) as { nextDueAt: string }).nextDueAt, "2026-10-02T00:00:00.000Z", "reaching the target restores cadence");
  const changed = await repos.routeTasks.mustRead(task.id);
  await repos.routeTasks.compareAndSet(task.id, changed.revision, { ...changed.value,
    disposition: { ...changed.value.disposition!, note: JSON.stringify({ placeProgress: false }) } }, now);
  assert.equal((await scheduleNationalPlace(repos, settled, now, true) as { nextDueAt: string }).nextDueAt, "2026-10-02T00:00:00.000Z");
  assert.equal((await scheduleNationalPlace(repos, { ...settled, lastWorkedAt: null }, now, true) as { nextDueAt: string }).nextDueAt,
    "2026-10-02T00:00:00.000Z", "an unfinished no-progress hunt also backs off");
  assert.equal((await scheduleNationalPlace(repos, settled, "2026-10-02T00:00:00.000Z", true) as { nextDueAt: string }).nextDueAt,
    "2026-10-02T00:00:00.000Z", "cadence eventually makes a no-progress place due again");
});

test("hunt progress uses new reader facts and official unpublished findings, ignoring timestamp churn", () => {
  const now = "2026-10-01T00:00:00.000Z";
  const divisions = [{ id: "ocd-division/country:us", label: "US" }];
  const blank = buildPlaceOwedList({ divisions, subjects: [], held: [], now });
  const field = { subjectId: blank[0].subject.id, checklistId: blank[0].checklistId, state: "published" as const,
    sourceUrl: "https://census.gov", checkedAt: now, freshUntil: "2026-10-03T00:00:00.000Z", value: "US" };
  const items = (value = "US", checkedAt = now) => buildPlaceOwedList({ divisions, subjects: [], held: [{ ...field, value, checkedAt }], now });
  assert.equal(placeMadeProgress(blank, items()), true);
  assert.equal(placeMadeProgress(items(), items("US", "2026-09-30T23:59:00.000Z")), false);
  assert.equal(placeMadeProgress(items(), items("United States")), true);
  assert.equal(placeMadeProgress(blank, buildPlaceOwedList({ divisions, subjects: [], held: [{ ...field, state: "unpublished" }], now })), true);
  assert.equal(placeMadeProgress(items(), blank), false);

});

test("a national host bound saves admitted responses and defers all remaining ZIPs without abandoning Attempts", async t => {
  const repos = createMemoryRepositories();
  const store = new MemoryEvidenceStore();
  // Cross renewal boundaries during acquisition, with stale reads held long
  // enough for two competing heartbeat writers to expose their CAS race.
  const interval = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (callback: () => void, delay?: number) => interval(callback, Math.min(delay ?? 1, 2)));
  const leaseRead = repos.leases.mustRead.bind(repos.leases);
  t.mock.method(repos.leases, "mustRead", async (id: string) => {
    const held = await leaseRead(id);
    await new Promise(resolve => setTimeout(resolve, 1));
    return held;
  });
  let heartbeatWrites = 0;
  const leaseWrite = repos.leases.compareAndSet.bind(repos.leases);
  t.mock.method(repos.leases, "compareAndSet", async (...args: Parameters<typeof leaseWrite>) => {
    if (!args[2].released && args[1] > 0) heartbeatWrites++;
    return leaseWrite(...args);
  });
  let requests = 0;
  const year = new Date().getUTCFullYear();
  const names = ["2020 Census ZIP Code Tabulation Areas", `${Math.floor((year - 1789) / 2) + 1}th Congressional Districts`,
    `${Math.floor((year - 1) / 2) * 2} State Legislative Districts - Upper`,
    `${Math.floor((year - 1) / 2) * 2} State Legislative Districts - Lower`, "States", "Counties", "Incorporated Places",
    "County Subdivisions", "Unified School Districts", "Elementary School Districts", "Secondary School Districts"];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requests++;
    // Siblings still in flight when another request is refused must be vaulted.
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json(url.endsWith("/query")
      ? { url, features: [{ attributes: {}, geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] }
      : { url, layers: names.map((name, id) => ({ id, name, type: "Feature Layer" })) });
  });
  const tools = { repos, store, now: () => "2026-09-30T00:00:00.000Z", spaceOut: async () => {} };
  const input = { tools, store: new MemoryRoutineDataStore(), zips: ["03060", "03101", "03301"],
    publish: async () => { assert.fail("incomplete geography cannot publish"); } };
  const result = await runNationalPlaceTask(input);
  assert.ok(heartbeatWrites > 0, "the national acquisition exercised its canonical lease heartbeat");
  assert.deepEqual(result.map(row => row.zip), input.zips);
  assert.ok(result.every(row => "deferred" in row && row.deferred.includes("next pass")));
  assert.equal(requests, RESEARCH_BOUNDS.perDispatch.maxRequestsPerHost);
  assert.ok((await repos.attempts.list()).every(row => row.value.outcome === "COMPLETED"));
  assert.ok((await repos.routeTasks.list()).every(row => row.value.disposition?.disposition === "BLOCKED_CURRENTLY"));
  assert.ok((await repos.occurrences.list()).every(row => row.value.closedAt && row.value.unresolvedReason?.includes("DEFERRED") && row.value.disposition === null));
  assert.ok((await repos.obligations.list()).every(row => row.value.lastWorkedAt === null));
  const saved = await repos.artifacts.readAll();
  assert.ok(saved.some(row => row.canonicalUrl.includes("Places_CouSub_ConCity_SubMCD")), "parallel responses saved before completion");
  const before = requests;
  await runNationalPlaceTask(input);
  assert.equal(requests - before, RESEARCH_BOUNDS.perDispatch.maxRequestsPerHost);
  const next = await repos.artifacts.readAll();
  assert.ok(next.some(row => row.canonicalUrl.includes("School")), "the next pass advances using held responses");
  assert.ok(saved.every(row => next.some(other => other.artifactId === row.artifactId)), "all earlier evidence remains held");
  // A cut-off pass must leave the recently worked head behind the older tail.
  const worked = ["2026-09-30T00:00:00.000Z", "2026-09-28T00:00:00.000Z", "2026-09-27T00:00:00.000Z"];
  for (const [index, zip] of input.zips.entries()) {
    const row = await repos.obligations.mustRead(`national-place:${zip}`);
    await repos.obligations.compareAndSet(row.id, row.revision, { ...row.value, lastWorkedAt: worked[index] }, tools.now());
  }
  assert.deepEqual(await dueNationalPlaceZips(repos, ["03060", "03101", "03301", "03401", "03401"], tools.now()),
    ["03401", "03301", "03101"]);
  // Actual acquisition must also recheck cadence after process admission.
  const beforeFresh = requests;
  assert.deepEqual(await runNationalPlaceTask({ ...input, zips: ["03060"] }), []);
  assert.equal(requests, beforeFresh, "a fresh place opens no occurrence and fetches no source");
});

test("a national walk reuses another role's working source route after a directory's dead landing page", async () => {
  const now = "2026-09-30T00:00:00Z";
  const entries = [newFieldManualEntry("detective", "working", { role: "DETECTIVE", kind: "ROUTE", title: "Officials",
    summary: "Replacement landing page", outcome: "YIELDED", states: ["mo"], url: "https://state.example.gov/leaders", payload: { procedure: "open leaders" } })];
  const store = { ...emptyFieldManual(), entries };
  const opened: string[] = [];
  const pages: Record<string, string> = {
    "https://www.usa.gov/state-governments": '<a id="mo" href="/states/missouri">Missouri</a>',
    "https://www.usa.gov/states/missouri": '<h1>Missouri</h1><div class="field--name-field-website"><a href="https://state.example.gov/old">State</a></div>',
    "https://state.example.gov/leaders": '<a href="/governor">Governor Jane Doe</a>',
  };
  const result = await collectNationalPlaceSources({ now, knowledge: { store, revision: 1, projection: projectFieldManual(store) },
    divisions: [{ id: "ocd-division/country:us/state:mo", label: "Missouri", divisionType: "state", geoid: "29", sourceUrl: "https://census.gov" }],
    read: async url => { opened.push(url); if (!(url in pages)) throw Error("Source unavailable"); return { url, text: pages[url], collectedAt: now }; } });
  assert.ok(opened.includes("https://state.example.gov/leaders"));
  assert.deepEqual(result.officials.map(row => row.name), ["Jane Doe"]);
  assert.equal(result.officials[0].document.text, pages["https://state.example.gov/leaders"], "the newly saved official page supplies the fact, not the manual");
});
import type { ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";

test("national collector binds saved CSV to its real Attempt and reuses another job without renewing its age", async () => {
  const repos = createMemoryRepositories();
  const store = new MemoryEvidenceStore();
  const url = "https://legislature.gov/members.csv";
  const body = "id,name\n1,Ada Smith\n";
  let fetched = 0;
  const reader = async (now: string, subject: string) => {
    const work = createWorkItem({ project: "freshness", subject, obligation: "Read national sources", why: "Capture", now });
    const task = createRouteTask({ workItemId: work.id, routeId: "national-place-sources", routeLabel: "National sources", target: subject, inherited: false, now });
    await registerWorkItem(repos, work, now);
    await registerRouteTask(repos, task, now);
    const claimed = await claimRouteTask(repos, { routeTaskId: task.id, holder: subject, now, ttlMs: 300_000 });
    const attempt = await beginAttemptFor(repos, { routeTaskId: task.id, workItemId: work.id,
      worker: { role: "ACQUIRER", provider: "test", version: "1", instance: subject }, lease: claimed.lease.value,
      now, methodVersion: 1, policyVersion: "test" });
    const obligation: ScheduledObligation = { obligation: { id: subject, subjectId: subject, recordClass: "OFFICIAL_ROSTER",
      routeId: "national-place-sources", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null },
      nextDueAt: now, cadenceHours: 24, cadenceSource: "DEFAULT_NO_SIGNAL", basis: "test" };
    return placeSourceReader({ project: "freshness", context: { obligation, route: null, providerId: null,
      attemptId: attempt.id, workItemId: work.id, routeTaskId: task.id, holder: subject,
      now: () => now, bound: RESEARCH_BOUNDS.perDispatch }, tools: {
      repos, store, now: () => now, spaceOut: async () => {}, openBytes: async request => {
        const robots = request.url.endsWith("/robots.txt");
        if (!robots) fetched++;
        return { status: 200, bytes: Buffer.from(robots ? "User-agent: *\nAllow: /" : request.url === url ? body : request.url),
          contentType: robots ? "text/plain" : "text/csv", finalUrl: request.url, durationMs: 1, transportError: null };
      },
    } });
  };
  const first = await reader("2026-09-30T00:00:00.000Z", "job:first");
  const acquired = await first.read(url);
  assert.equal(acquired.text, body);
  assert.equal(acquired.capture?.evidence.acquiredByAttemptId, (await repos.attempts.list())[0].id);
  assert.equal(fetched, 1);
  const geographyUrl = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1/query?where=STATE%3D39";
  const geography = '{"features":[{"attributes":{"GEOID":"39007"}}]}';
  await first.captureGeography(geographyUrl, geography);
  const second = await reader("2026-09-30T01:00:00.000Z", "job:other-place");
  const reused = await second.read(url);
  assert.equal(fetched, 1);
  assert.equal(reused.capture?.evidence.artifactId, acquired.capture?.evidence.artifactId);
  assert.equal(reused.collectedAt, acquired.collectedAt);
  assert.equal(second.artifacts.size, 0);
  assert.equal(await second.readGeography(geographyUrl), geography);
  assert.equal(second.geographyCaptures[0].observedAt, "2026-09-30T00:00:00.000Z");
  assert.deepEqual(second.cost, { requestCount: 0, bytesFetched: 0 });
  const third = await reader("2026-10-02T01:00:00.000Z", "job:refresh");
  assert.equal(await third.readGeography(geographyUrl), null, "expired Census bytes leave a source refresh owed");
  const refreshed = await third.read(url);
  assert.equal(fetched, 2);
  assert.equal(refreshed.collectedAt, "2026-10-02T01:00:00.000Z");
  assert.notEqual(refreshed.capture?.evidence.acquiredByAttemptId, acquired.capture?.evidence.acquiredByAttemptId);
  for (let index = 2; index < RESEARCH_BOUNDS.perDispatch.maxRequestsPerHost; index++) {
    await third.read(`https://legislature.gov/page-${index}`);
  }
  await assert.rejects(third.read("https://legislature.gov/next"), PlaceSourceDeferred);
  assert.ok(third.deferred?.message.includes("next pass"), "ordinary page hosts defer just like Census");
  assert.equal(third.cost.requestCount, RESEARCH_BOUNDS.perDispatch.maxRequestsPerHost);
  assert.equal((await third.read(url)).text, body, "the bound never blocks already saved pages");
});

test("the national election directory follows its published form for any state", () => {
  const page = { url: "https://www.eac.gov/voters/register-and-vote-in-your-state", collectedAt: "2026-09-30T00:00:00Z",
    text: '<form action="/voters/state" method="get"><select name="state_id"><option value="12">Missouri</option><option value="13">Utah</option></select></form>' };
  assert.equal(electionDirectorySelection(page, "Utah"), "https://www.eac.gov/voters/state?state_id=13");
  assert.equal(electionDirectorySelection(page, "Unknown"), null);
});

test("official profile headings produce officeholders; news headlines do not", async () => {
  const stages: string[] = [];
  const pages: Record<string, string> = {
    "https://www.usa.gov/state-governments": '<a id="mo" href="/states/missouri">Missouri</a>',
    "https://www.usa.gov/states/missouri": '<h1>Missouri</h1><a href="https://ag.example.gov/">Office of the Attorney General</a>',
    "https://ag.example.gov/": '<h1>TRUE TRANSPARENCY</h1><h1>POLICE TRAINING PROVIDED REGIONALLY</h1><h1>True Transparency</h1><a href="/about">Attorney General</a>',
    "https://ag.example.gov/about": '<h1>Attorney General Jane Doe</h1>',
  };
  const result = await collectNationalPlaceSources({ now: "2026-09-30T00:00:00Z",
    divisions: [{ id: "ocd-division/country:us/state:mo", label: "Missouri", divisionType: "state", geoid: "29", sourceUrl: "https://census.gov" }],
    onSources: async sources => { stages.push("ready"); assert.equal(sources.officials[0].name, "Jane Doe"); },
    read: async url => { if (url.includes("eac.gov")) stages.push("elections"); if (!(url in pages)) throw Error("No page"); return { url, text: pages[url], collectedAt: "2026-09-30T00:00:00Z" }; } });
  assert.deepEqual(result.officials.map(o => [o.name, o.officeTitle]), [["Jane Doe", "Attorney General"]]);
  assert.equal(result.officials[0].document.url, "https://ag.example.gov/about");
  assert.deepEqual(stages, ["ready", "elections"], "a ready officeholder reaches the publisher before unrelated election collection");
});

test("election dates use explicit source year and official lookup links remain navigation", () => {
  const page = { url: "https://elections.example.gov/calendar", collectedAt: "2026-09-30T00:00:00Z",
    text: '<h1>2027 Voting Schedule</h1><p>October 5: Deadline to register to vote.</p><p>October 6: Early in-person voting begins.</p><a href="/poll">Find My Polling Place</a>' };
  const fields = electionPageFields(page, "ocd-division/country:us/state:mo");
  assert.deepEqual(fields.find(f => f.kind === "registration_deadline")?.dates, ["2027-10-05"]);
  assert.match(fields[0].quote, /2027 Voting Schedule/);
  assert.equal(fields.find(f => f.kind === "polling_lookup")?.value, "https://elections.example.gov/poll");
  assert.equal(electionPageFields({ ...page, text: "<p>October 5: Deadline to register to vote.</p>" }, "division").length, 0);
  assert.equal(electionPageFields({ ...page, text: "<p>February 30, 2027: Deadline to register to vote.</p>" }, "division").length, 0);
  const vendor = { ...page, url: "https://state-election-office.org/calendar" };
  assert.equal(electionPageFields(vendor, "division").length, 0);
  const linkingPage = { url: "https://www.eac.gov/state", html: '<a href="https://state-election-office.org">State election office</a>' };
  const linked = electionPageFields(vendor, "division", linkingPage);
  assert.equal(linked.length, 3);
  assert.deepEqual(linked[0].linkingPage, linkingPage, "official ancestry survives to the publisher");
});

test("redirected election pages keep their saved source identity and resolve links from the final location", () => {
  const page = { url: "https://elections.example.gov/start", baseUrl: "https://elections.example.gov/voters/current/",
    text: '<a href="polling">Find my polling place</a>', collectedAt: "2026-09-30T00:00:00Z" };
  const [field] = electionPageFields(page, "ocd-division/country:us/state:mo");
  assert.equal(field.sourceUrl, page.url);
  assert.equal(field.value, "https://elections.example.gov/voters/current/polling");
  const directory = { ...page, text: '<form method="get" action="states"><select name="state"><option value="MO">Missouri</option></select></form>' };
  assert.equal(electionDirectorySelection(directory, "Missouri"), "https://elections.example.gov/voters/current/states?state=MO");
});

/**
 * State legislators, and the reconciliation that makes them attachable.
 *
 * The interesting failure is New Hampshire. Plural designates House districts
 * "Merrimack 8"; this repo's identifiers are Census numeric codes (`sldl:608`).
 * A direct join scores **0 of 201** and does so silently — the same shape as
 * the at-large trap in the federal roster, and the reason both are pinned here.
 */

const DIVISIONS = (
  registry as { divisions: { ocdId: string; label: string; divisionType: string }[] }
).divisions;

test("designation normalization survives zero-padding", () => {
  assert.equal(designationKey("Merrimack 08"), designationKey("Merrimack 8"));
  assert.equal(designationKey("  merrimack   8 "), "MERRIMACK 8");
  assert.equal(designationKey("19"), "19");
});

test("the registry label yields the designation Plural publishes", () => {
  assert.equal(designationFromLabel("State House District Merrimack 08"), "MERRIMACK 8");
  assert.equal(designationFromLabel("State Senate District 19"), "19");
  assert.equal(designationFromLabel("Assembly District 25"), "25");
});

test("New Hampshire House districts index by designation, not by number", () => {
  const index = indexDivisions(DIVISIONS);

  // sldl:608 is labelled "State House District Merrimack 08". A join on the
  // identifier's digits would look for 608 and find nothing.
  const ocdId = index.get("nh|lower|MERRIMACK 8");
  assert.ok(ocdId, "NH Merrimack 8 must resolve");
  assert.match(ocdId, /state:nh\/sldl:/);
});

test("New Jersey's lower chamber members are Assemblymembers", () => {
  // Not derivable and not guessable. Calling them Representatives would be a
  // small fabrication rendered to a reader.
  assert.equal(CHAMBER_TITLE.nj.lower, "Assemblymember");
  assert.equal(CHAMBER_TITLE.az.lower, "State Representative");
});

test("a state beyond the original pilots normalizes without a local registry", () => {
  const set = normalize(
    [person({ id: "ocd-person/x", state: "tx", current_district: "1" })],
    new Map(),
    "2026-08-12T00:00:00.000Z",
    "48",
  );

  assert.equal(set.officeholders.length, 1);
  assert.equal(set.officeholders[0].officeTitle, "State Representative");
  assert.match(set.unmatched[0].reason, /no lower division/);
});

test("a district outside the clipped coverage is reported, not dropped silently", () => {
  /*
   * **THE FIXTURE MOVED BECAUSE THE CLIP DID.** (RULING 80, NJ Hunt 4 item 4,
   * 2026-08-22.)
   *
   * This used Arizona's district 2, which was outside the one-county clip and
   * is inside the widened one — the registry now carries all thirty of
   * Arizona's lower-house districts. That is the ruling working, and it left
   * this test asserting the opposite of what is now true.
   *
   * The claim under test is unchanged and is not about any particular district:
   * a legislator whose district this build cannot draw is KEPT and the miss is
   * REPORTED, never silently dropped. District 31 does not exist in Arizona, so
   * it is outside any clip this project could ever ship, and the assertion
   * stops depending on where the clip happens to stop.
   */
  const index = indexDivisions(DIVISIONS);
  const set = normalize(
    [person({ id: "ocd-person/y", state: "az", current_district: "31" })],
    index,
    "2026-08-12T00:00:00.000Z",
    "04",
  );

  // The person is still a real legislator and is kept; only the link is absent.
  assert.equal(set.officeholders.length, 1);
  assert.equal(set.divisions.length, 0);
  assert.equal(set.unmatched.length, 1);
  assert.match(set.unmatched[0].reason, /outside the clipped boundary coverage/);
});

test("CSV parsing handles quoted fields with embedded commas", () => {
  const rows = parseCsv('id,name\n1,"Last, First"\n2,Plain\n');
  assert.deepEqual(rows[1], ["1", "Last, First"]);
  assert.deepEqual(rows[2], ["2", "Plain"]);
});

test("rows without an id are skipped", () => {
  const people = rowsToPeople(
    "id,name,current_party,current_district,current_chamber,email,image,links,sources\n" +
      ",Nobody,,,,,,,\n" +
      "ocd-person/a,Real Person,Democratic,19,upper,,,,\n",
    "az",
  );
  assert.equal(people.length, 1);
  assert.equal(people[0].name, "Real Person");
});

test("a roster with the wrong header or too few rows is refused, not read as empty", () => {
  // An HTML error page served at 200 passes the comma blank-check and parses to
  // a table whose header is not the roster's — rowsToPeople would then find no
  // id column and return zero people, a whole legislature reading as absent.
  assert.match(pluralRosterIssue("<html>error, error</html>") ?? "", /missing id/);

  const header =
    "id,name,current_party,current_district,current_chamber,email,image,capitol_voice,district_voice,links,sources\n";
  // The right header but a handful of rows is a truncated file.
  assert.match(pluralRosterIssue(header) ?? "", /below the floor/);

  // A full roster passes.
  const rows = Array.from(
    { length: 60 },
    (_, i) => `ocd-person/${i},Name ${i},D,19,upper,,,,,,`,
  ).join("\n");
  assert.equal(pluralRosterIssue(header + rows + "\n"), null);
});

test("provenance names the bulk file the row was read from", () => {
  const index = indexDivisions(DIVISIONS);
  const set = normalize(
    [person({ id: "ocd-person/z", state: "az", current_district: "19" })],
    index,
    "2026-08-12T00:00:00.000Z",
    "04",
  );

  assert.equal(
    set.officeholders[0].provenance.sourceUrl,
    "https://data.openstates.org/people/current/az.csv",
  );
  assert.equal(set.officeholders[0].provenance.verifiedAt, null);
});

test("no Plural photo is shipped — the URL is a hotlink of unknown licence", () => {
  const index = indexDivisions(DIVISIONS);
  const set = normalize(
    [
      person({
        id: "ocd-person/p",
        state: "az",
        current_district: "19",
        image: "https://example.invalid/face.jpg",
      }),
    ],
    index,
    "2026-08-12T00:00:00.000Z",
    "04",
  );

  assert.equal(set.officeholders[0].photo, null);
});

test("an Arizona legislative district returns one senator and two representatives", async () => {
  // The many-to-many case the brief says breaks a one-district-per-seat column,
  // now visible in real data rather than argued from the statute.
  const coverage = await coverageAt(32.04903, -110.62291, 0);

  const house = coverage.seats.find((s) => s.divisionType === "sldl");
  const senate = coverage.seats.find((s) => s.divisionType === "sldu");

  assert.equal(house?.representatives.length, 2, "AZ elects two per LD");
  assert.equal(senate?.representatives.length, 1);
});

test("all four target-zip seat types are now named", async () => {
  for (const [lat, lng] of [
    [32.04903, -110.62291],
    [40.91, -74.51],
    [43.32, -72.03],
  ]) {
    const coverage = await coverageAt(lat, lng, 0);
    assert.equal(
      coverage.seatCounts.named,
      coverage.seatCounts.total,
      "every seat at this point should now have someone",
    );
    for (const seat of coverage.seats) {
      for (const holder of seat.representatives) {
        assert.ok(holder.sourceUrl, `${holder.name} would render without a source`);
      }
    }
  }
});

test("the roster reads the unmetered bulk host, never the quota'd API", () => {
  // The regression this exists for: someone moves the roster onto GraphQL for
  // a field the CSV lacks — term dates are the likely reason — and 620
  // legislators quietly eat most of a 500/day quota on every build. If that
  // ever happens it should fail here rather than mid-run on a 429.
  for (const state of ["az", "nj", "nh"]) {
    const url = bulkUrl(state);
    assert.match(url, /^https:\/\/data\.openstates\.org\/people\/current\//);
    assert.doesNotMatch(url, /graphql|open\.pluralpolicy\.com/i);
  }
});

test("the quota is stated where the build can print it", () => {
  // Plural's documented free tier. Recorded as a constant so the build output
  // shows the ceiling rather than the ceiling being discovered by hitting it.
  assert.equal(GRAPHQL_DAILY_QUOTA, 500);
  assert.equal(GRAPHQL_MIN_INTERVAL_MS, 1000);
});

test("bulk and GraphQL request counts stay separate", () => {
  // Bulk files are static and unmetered; adding them to the GraphQL count
  // would invent pressure on a ceiling nothing is approaching.
  resetRequestCount();
  assert.deepEqual(requestCount, { bulk: 0, graphql: 0 });

  const index = indexDivisions(DIVISIONS);
  normalize(
    [person({ id: "ocd-person/q", state: "az", current_district: "19" })],
    index,
    "2026-08-12T00:00:00.000Z",
    "04",
  );

  // normalize() is pure — it must never spend a request of either kind.
  assert.deepEqual(requestCount, { bulk: 0, graphql: 0 });
});

function person(overrides: Partial<PluralPerson>): PluralPerson {
  return {
    id: "ocd-person/test",
    name: "Test Person",
    current_party: "Independent",
    current_district: "19",
    current_chamber: "lower",
    email: "",
    image: "",
    capitol_address: "",
    capitol_voice: "",
    district_address: "",
    district_voice: "",
    links: "",
    sources: "",
    state: "az",
    ...overrides,
  };
}

test("the bulk CSV's capitol and district office addresses are carried, not dropped", () => {
  const csv = "id,name,current_party,current_district,current_chamber,email,image,links,sources,capitol_address,capitol_voice,district_address,district_voice\n" +
    'ocd-person/n1,Al Abdelaziz,Democratic,35,lower,,,,,,,"680 Broadway Suite 207, Paterson, NJ 07514",862-264-2540\n';
  const [row] = rowsToPeople(csv, "nj");
  assert.deepEqual([row.capitol_address, row.district_address, row.district_voice], ["", "680 Broadway Suite 207, Paterson, NJ 07514", "862-264-2540"]);
});
