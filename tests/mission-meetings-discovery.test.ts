import assert from "node:assert/strict";
import test from "node:test";

import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import {
  jurisdictionMeetingsSubject,
  heldCalendarRouteReason,
  openOccurrence,
  planHeldRouteRetirement,
  planSupersededRetirement,
  settleRetirements,
  syncObligations,
  type ProviderReading,
  type StandingObligation,
} from "../lib/control-plane/scheduler/durable.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { OWN_SITE_MEETINGS_SOURCE, meetingsDiscoveryNeeds, type JurisdictionRegistryFile } from "../lib/hunt/meetings-discovery.ts";
import { heldCalendarRouteBodies, missionMeetingsDiscoveryNeeds } from "../lib/hunt/mission-meetings-discovery.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { buildPlaceOwedList, type HeldPlaceField, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { eachStore } from "./control-plane-fixtures.ts";

const T0 = "2026-09-09T12:00:00.000Z"; // a cycle before 902f5c50 that opened a meetings occurrence and never reached it
const T1 = "2026-10-05T19:00:00.000Z"; // a cycle that reads the owed rows
const AVONDALE = "az:city:city-of-avondale";
const BENSON = "az:city:city-of-benson";
const UNLISTED = "az:town:town-nowhere"; // its body holds no calendar route
const NOBODY = "az:town:town-unjoined"; // no exact body join
const meetingsRow = (jurisdictionId: string, n = 1) => `freshness:jurisdiction:${jurisdictionId}#meetings-${n}`;
const CLERK = `freshness:jurisdiction:${AVONDALE}#candidate-filings-1`;
const bodyOf = (jurisdictionId: string) => `ocd-division/country:us/state:az/place:${jurisdictionId.split(":")[2]}#governing`;
const routesHeldFor = (held: readonly string[]) => ({
  bodyIdFor: (id: string) => (id === NOBODY ? null : bodyOf(id)),
  held: new Set(held.map(bodyOf)),
});
const ROUTES = routesHeldFor([AVONDALE, BENSON]);
const CLEAN: ProviderReading = { providerId: "local-jurisdictions", units: 2, readFailure: null, emptyReason: null };

function obligation(id: string): FreshnessObligation {
  return {
    id,
    recordClass: "local-jurisdiction",
    subjectId: id.slice("freshness:jurisdiction:".length, id.indexOf("#")),
    routeId: id.slice(id.indexOf("#") + 1),
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
  };
}

function stored(id: string, over: Partial<StandingObligation> = {}): StandingObligation {
  return { ...obligation(id), nextDueAt: T0, occurrenceCount: 0, openOccurrenceId: null, updatedAt: T0, ...over };
}

/** The corpus: local-jurisdictions emits its other routes, and no MEETINGS route. */
const corpus = [{ providerId: "local-jurisdictions", obligationId: CLERK }];

function registry(rows: JurisdictionRegistryFile["jurisdictions"], states: Record<string, string>): JurisdictionRegistryFile {
  return {
    stateCode: "AZ",
    generatedOn: "2026-09-01",
    sourceCatalog: Object.fromEntries(
      Object.entries(states).map(([id, state]) => [id, { recordClass: id.split(":")[0], state }]),
    ),
    jurisdictions: rows,
  };
}

test("RECORD: a jurisdiction is owed meetings discovery until a MEETINGS source it carries is anything but DISCOVERY_OWED", () => {
  const row = (id: string, sourceIds: string[], ownWebAddress: string | null = null) => ({
    id,
    stateCode: "AZ",
    name: id.toUpperCase(),
    govClass: "CITY_OR_TOWN",
    ownWebAddress,
    sourceIds,
  });
  const needs = meetingsDiscoveryNeeds([
    registry(
      [
        row(BENSON, [OWN_SITE_MEETINGS_SOURCE, "CANDIDATE_FILINGS:COUNTY:x"], "http://www.cityofbenson.com"),
        row(AVONDALE, [OWN_SITE_MEETINGS_SOURCE], "http://www.avondale.org"),
        row("az:town:town-without-a-site", ["CANDIDATE_FILINGS:COUNTY:x"]),
        row("az:county:county-wired", [OWN_SITE_MEETINGS_SOURCE, "MEETINGS:COUNTY:legistar"]),
      ],
      {
        [OWN_SITE_MEETINGS_SOURCE]: "DISCOVERY_OWED",
        "CANDIDATE_FILINGS:COUNTY:x": "ADAPTED",
        "MEETINGS:COUNTY:legistar": "ADAPTED",
      },
    ),
  ]);
  assert.deepEqual(
    needs.map((n) => [n.jurisdictionId, n.basis, n.sources]),
    [
      [AVONDALE, "SOURCE_DISCOVERY_OWED", [OWN_SITE_MEETINGS_SOURCE]],
      [BENSON, "SOURCE_DISCOVERY_OWED", [OWN_SITE_MEETINGS_SOURCE]],
      ["az:town:town-without-a-site", "NO_MEETINGS_SOURCE_RECORDED", []],
    ],
    "sorted by id; a row whose MEETINGS source is wired is not a discovery need",
  );
});

const NOW = "2026-10-05T18:00:00.000Z";
const DIVISION = "ocd-division/country:us/state:oh/place:3918000";
const OH_BODY = `${DIVISION}#governing`;

/** One mission place's owed rows: a body, and whatever was captured for it. */
function owedRows(held: readonly HeldPlaceField[], subjects: readonly PlaceSubject[] = []) {
  return buildPlaceOwedList({
    divisions: [{ id: DIVISION, label: "Columbus" }],
    subjects: [{ id: OH_BODY, kind: "body", captureKind: "registry-body", divisionIds: [DIVISION], label: "Columbus City Council" }, ...subjects],
    held,
    now: NOW,
  });
}

test("HELD ROUTE: a body holds a calendar route when its calendar row or a meeting captured from it holds a source", () => {
  const blank = owedRows([]);
  assert.ok(blank.some((r) => r.subject.id === `${OH_BODY}#calendar` && r.checklistId === "MTG-01" && r.state === "missing"),
    "the mission map owes the body a calendar route");
  assert.deepEqual([...heldCalendarRouteBodies(blank)], [], "an open calendar blank is no route");

  const field = (subjectId: string, checklistId: string, state: HeldPlaceField["state"] = "published"): HeldPlaceField =>
    ({ subjectId, checklistId, state, sourceUrl: "https://columbus.example.gov/calendar", checkedAt: "2026-10-01T00:00:00.000Z", freshUntil: "2026-10-02T00:00:00.000Z" });
  assert.deepEqual([...heldCalendarRouteBodies(owedRows([field(`${OH_BODY}#calendar`, "MTG-01")]))], [OH_BODY],
    "the calendar row holds its route; a route due a refresh is still held");

  const meeting: PlaceSubject = { id: "mtg-1", kind: "calendar", captureKind: "meeting", calendarBodyId: OH_BODY, divisionIds: [DIVISION], label: "Council", startsAt: "2026-10-06T22:00:00.000Z" };
  assert.deepEqual([...heldCalendarRouteBodies(owedRows([field("mtg-1", "MTG-12")], [meeting]))], [OH_BODY],
    "a meeting captured from the body's source shows its route is held");

  assert.deepEqual([...heldCalendarRouteBodies(owedRows([field(`${OH_BODY}#calendar`, "MTG-01", "unpublished")]))], [],
    "a statement that the government publishes nothing is not a route");
});

test("MISSION BLANKS: every government in a mission place whose body holds no route is owed discovery, in a state never worked before", () => {
  const OH_CITY = "oh:city:columbus";
  const OH_WIRED = "oh:county:franklin";
  const OH_HELD = "oh:school:columbus-city";
  const oh = {
    stateCode: "OH",
    registration: { kind: "REGISTRATION", versionId: "reg-oh-1", referenceSha256: "a".repeat(64), webAddresses: "x" },
    sourceCatalog: {
      [OWN_SITE_MEETINGS_SOURCE]: { recordClass: "MEETINGS", state: "DISCOVERY_OWED" },
      "MEETINGS:COUNTY:legistar": { recordClass: "MEETINGS", state: "ADAPTED" },
    },
    jurisdictions: [
      { id: OH_CITY, stateCode: "OH", name: "CITY OF COLUMBUS", govClass: "CITY_OR_TOWN", ownWebAddress: "https://columbus.example.gov", sourceIds: [OWN_SITE_MEETINGS_SOURCE], bodyId: OH_BODY },
      { id: OH_WIRED, stateCode: "OH", name: "FRANKLIN COUNTY", govClass: "COUNTY", ownWebAddress: "https://franklin.example.gov", sourceIds: ["MEETINGS:COUNTY:legistar"] },
      { id: OH_HELD, stateCode: "OH", name: "COLUMBUS CITY SCHOOLS", govClass: "SCHOOL_DISTRICT", ownWebAddress: "https://ccs.example.org", sourceIds: [OWN_SITE_MEETINGS_SOURCE] },
    ],
  } as unknown as JurisdictionRegistry;
  const bodies: Record<string, string> = { [OH_CITY]: OH_BODY, [OH_HELD]: `${DIVISION}#board` };
  const read = missionMeetingsDiscoveryNeeds({
    jurisdictionIds: [DIVISION, OH_CITY, OH_WIRED, OH_HELD, "nv:city:las-vegas", `${OH_BODY}#calendar`],
    registryFor: (state) => {
      if (state === "oh") return oh;
      throw new Error(`REGISTRATION_NOT_READ:${state}`);
    },
    bodyIdFor: (id) => bodies[id] ?? null,
    heldRoutes: new Set([`${DIVISION}#board`]),
  });
  assert.deepEqual(read.entries.map((e) => e.need.jurisdictionId), [OH_CITY], "the city's calendar blank is owed; a wired county has no need");
  assert.equal(read.entries[0]!.need.ownWebAddress, "https://columbus.example.gov");
  assert.deepEqual(read.heldRoute, [OH_HELD], "a government whose body holds a route is not walked again");
  assert.equal(read.failures.length, 1);
  assert.match(read.failures[0]!, /the NV jurisdiction registry could not be read/);

  const unjoined = missionMeetingsDiscoveryNeeds({ jurisdictionIds: [OH_CITY], registryFor: () => oh, bodyIdFor: () => null, heldRoutes: new Set([OH_BODY]) });
  assert.deepEqual(unjoined.entries.map((e) => e.need.jurisdictionId), [OH_CITY], "with no exact body join nothing shows a route, so the blank stays open");
});

test("the census reads all state governments independently; research retirement still reads held routes", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const runner = readFileSync("scripts/freshness-shadow.mts", "utf8");
  const census = readFileSync("lib/control-plane/discovery/platform-census-runtime.ts", "utf8");
  assert.match(census, /REGISTRATION_TARGETS.map/);
  assert.match(census, /runPlatformCensusPass\(/);
  assert.doesNotMatch(runner, /runMeetingsDiscovery|MEETINGS_DISCOVERY_MAX_WALKS|missionMeetingsDiscoveryNeeds/);
  assert.match(runner, /const held = heldCalendarRouteBodies\(rows\)/);
  assert.match(runner, /: planHeldRouteRetirement\(\{/, "old meetings rows retire on held routes");
  assert.doesNotMatch(runner, /gapLedger|GAP_LEDGER|gap-ledger/, "the runner no longer reads the ledger");
  for (const path of ["scripts/build-gap-ledger.mts", "docs/gap-ledger.md", "data/derived/gap-ledger.json"]) {
    assert.equal(existsSync(path), false, `${path} is retired`);
  }
});

test("PLAN: a meetings row retires only when its government's exact body holds a calendar route; every other one is held back by name", () => {
  assert.equal(jurisdictionMeetingsSubject(meetingsRow(AVONDALE, 2)), AVONDALE);
  assert.equal(jurisdictionMeetingsSubject(CLERK), null);
  assert.equal(jurisdictionMeetingsSubject("freshness:meetings:legacy-body"), null);

  const outside = [
    stored(meetingsRow(AVONDALE)),
    stored(meetingsRow(BENSON, 2)),
    stored(meetingsRow(UNLISTED)),
    stored(meetingsRow(NOBODY)),
    stored(meetingsRow("az:city:already-retired"), { active: false }),
    stored(`freshness:jurisdiction:${BENSON}#clerk-1`),
  ];
  const plan = planHeldRouteRetirement({ outside, corpus, providers: [CLEAN], routes: ROUTES });
  assert.deepEqual(plan.retire, [
    { obligationId: meetingsRow(AVONDALE), reason: heldCalendarRouteReason(AVONDALE, bodyOf(AVONDALE)) },
    { obligationId: meetingsRow(BENSON, 2), reason: heldCalendarRouteReason(BENSON, bodyOf(BENSON)) },
  ]);
  assert.match(plan.retire[0].reason, /^CALENDAR ROUTE HELD: az:city:city-of-avondale's body ocd-division\/country:us\/state:az\/place:city-of-avondale#governing has a held calendar route/);
  assert.deepEqual(plan.heldBack.map((h) => [h.obligationId, h.code]), [
    [meetingsRow(UNLISTED), "NO_HELD_CALENDAR_ROUTE"],
    [meetingsRow(NOBODY), "NO_EXACT_BODY"],
  ]);
  assert.match(plan.heldBack[0].why, /place:town-nowhere#governing holds no calendar route/);
  assert.deepEqual(
    [...plan.owned].sort(),
    [meetingsRow("az:city:already-retired"), meetingsRow(AVONDALE), meetingsRow(BENSON, 2), meetingsRow(UNLISTED), meetingsRow(NOBODY)].sort(),
    "every meetings row is owned here, retired or not; a non-meetings row is not",
  );

  const inCorpus = planHeldRouteRetirement({
    outside: [stored(meetingsRow(AVONDALE))],
    corpus: [...corpus, { providerId: "local-jurisdictions", obligationId: meetingsRow(AVONDALE) }],
    providers: [CLEAN],
    routes: ROUTES,
  });
  assert.deepEqual([inCorpus.retire, inCorpus.heldBack, [...inCorpus.owned]], [[], [], []], "a row a provider emits again is not retired");
});

test("PLAN: unread owed rows or a provider that did not read cleanly retire nothing", () => {
  const outside = [stored(meetingsRow(AVONDALE)), stored(meetingsRow(BENSON))];
  const unreadable = planHeldRouteRetirement({
    outside,
    corpus,
    providers: [CLEAN],
    routes: { unreadable: "the held place capture could not be read (STORE_UNREACHABLE)" },
  });
  assert.deepEqual(unreadable.retire, []);
  assert.deepEqual(unreadable.heldBack.map((h) => h.code), ["ROUTES_UNREAD", "ROUTES_UNREAD"]);
  assert.match(unreadable.heldBack[0].why, /STORE_UNREACHABLE/);

  const failing = planHeldRouteRetirement({
    outside,
    corpus,
    providers: [{ ...CLEAN, readFailure: "az jurisdictions projection read rejected" }],
    routes: ROUTES,
  });
  assert.deepEqual(failing.retire, []);
  assert.deepEqual(failing.heldBack.map((h) => h.code), ["PROVIDER_NOT_READ_CLEANLY", "PROVIDER_NOT_READ_CLEANLY"]);

  const unowned = planHeldRouteRetirement({ outside, corpus: [], providers: [CLEAN], routes: ROUTES });
  assert.deepEqual(unowned.heldBack.map((h) => h.code), ["NO_PROVIDER_NAMESPACE", "NO_PROVIDER_NAMESPACE"]);
});

test("PLAN: the superseded planner never sees a meetings row, so a met need does not trip the bound", () => {
  /* The provider's meetings rows are a large share of its standing set. */
  const meetings = Array.from({ length: 4 }, (_, i) => stored(meetingsRow(i % 2 === 0 ? AVONDALE : BENSON, i + 1)));
  const stale = stored(`freshness:jurisdiction:${BENSON}#clerk-9`);
  const wide = [...corpus, ...Array.from({ length: 5 }, (_, i) => ({ providerId: "local-jurisdictions", obligationId: `${CLERK}-${i}` }))];
  const outside = [...meetings, stale];

  const alone = planSupersededRetirement({ outside, corpus: wide, providers: [CLEAN] });
  assert.deepEqual(alone.retire, [], "without the moved planner, 5 of 11 is over the bound");

  const moved = planHeldRouteRetirement({ outside, corpus: wide, providers: [CLEAN], routes: ROUTES });
  assert.equal(moved.retire.length, 4);
  const rest = planSupersededRetirement({ outside: outside.filter((row) => !moved.owned.has(row.id)), corpus: wide, providers: [CLEAN] });
  assert.deepEqual(rest.retire.map((r) => r.obligationId), [stale.id], "1 of 7 standing is inside the bound");
  assert.deepEqual(rest.heldBack, []);
});

/** A meetings row registered before the provider stopped emitting MEETINGS routes, its occurrence opened and never reached. */
async function meetingsShape(repos: ControlPlaneRepositories, jurisdictionId: string) {
  const id = meetingsRow(jurisdictionId);
  await syncObligations(repos, [obligation(id), obligation(CLERK)], T0);
  const opened = await openOccurrence(repos, { obligation: (await repos.obligations.mustRead(id)).value, dueAt: T0, now: T0 });
  assert.ok(opened);
  return { id, occurrenceId: opened.occurrence.id, routeTaskId: opened.routeTask.id, workItemId: opened.workItem.id };
}

async function untouched(repos: ControlPlaneRepositories, routeTaskId: string, workItemId: string) {
  return {
    task: await repos.routeTasks.mustRead(routeTaskId),
    lease: await repos.leases.read(routeTaskId),
    attempts: (await repos.attempts.list()).filter((row) => row.value.routeTaskId === routeTaskId),
    commits: await repos.dispositions.read(routeTaskId),
    artifacts: await repos.artifacts.read(workItemId),
    workItem: await repos.workItems.mustRead(workItemId),
  };
}

test("SEEDED: a meetings row whose body holds a calendar route retires naming the body, its occurrence closes unresolved, and nothing else is written", async () => {
  for (const [label, repos] of await eachStore("wtp-moved-")) {
    const listed = await meetingsShape(repos, AVONDALE);
    const unlisted = await meetingsShape(repos, UNLISTED);
    const before = await untouched(repos, listed.routeTaskId, listed.workItemId);

    /* The provider emits no MEETINGS route. */
    const sync = await syncObligations(repos, [obligation(CLERK)], T1);
    assert.deepEqual(sync.outside?.map((o) => o.id).sort(), [listed.id, unlisted.id].sort(), `${label}: sync names both rows it no longer walks`);
    const plan = planHeldRouteRetirement({ outside: sync.outside ?? [], corpus, providers: [CLEAN], routes: ROUTES });
    assert.deepEqual(plan.heldBack.map((h) => [h.obligationId, h.code]), [[unlisted.id, "NO_HELD_CALENDAR_ROUTE"]]);
    const applied = await settleRetirements(repos, { items: plan.retire, now: T1 });
    assert.deepEqual(applied, { retired: [listed.id], occurrencesClosed: [listed.occurrenceId], failed: [], deferred: [] });

    const row = (await repos.obligations.mustRead(listed.id)).value;
    assert.equal(row.active, false);
    assert.equal(row.nextDueAt, null);
    assert.equal(row.openOccurrenceId, null);
    assert.equal(row.retiredAt, T1);
    assert.equal(row.retirementReason, heldCalendarRouteReason(AVONDALE, bodyOf(AVONDALE)));

    const occurrence = (await repos.occurrences.mustRead(listed.occurrenceId)).value;
    assert.equal(occurrence.closedAt, T1);
    assert.equal(occurrence.disposition, null, `${label}: a retirement is not a reading`);
    assert.match(occurrence.unresolvedReason ?? "", /^CALENDAR ROUTE HELD: .*nothing was read and nothing was refreshed$/);

    assert.deepEqual(await untouched(repos, listed.routeTaskId, listed.workItemId), before, `${label}: RouteTask, lease, Attempts, commits, artifacts and WorkItem unchanged`);

    const kept = (await repos.obligations.mustRead(unlisted.id)).value;
    assert.equal(kept.active, true, `${label}: a need with no held route stays live`);
    assert.equal((await repos.occurrences.mustRead(unlisted.occurrenceId)).value.closedAt, null, `${label}: and its occurrence stays open`);
    assert.equal((await repos.obligations.mustRead(CLERK)).value.active, true, `${label}: a row the corpus names is untouched`);

    const again = await syncObligations(repos, [obligation(CLERK)], T1);
    const replan = planHeldRouteRetirement({ outside: again.outside ?? [], corpus, providers: [CLEAN], routes: ROUTES });
    assert.deepEqual(replan.retire, [], `${label}: a retired row is history, never planned twice`);
  }
});

test("SEEDED: while the owed rows cannot be read, no meetings row retires and its occurrence stays open", async () => {
  for (const [label, repos] of await eachStore("wtp-moved-")) {
    const listed = await meetingsShape(repos, AVONDALE);
    const sync = await syncObligations(repos, [obligation(CLERK)], T1);
    const plan = planHeldRouteRetirement({
      outside: sync.outside ?? [],
      corpus,
      providers: [CLEAN],
      routes: { unreadable: "the held place capture could not be read (ENOENT)" },
    });
    const applied = await settleRetirements(repos, { items: plan.retire, now: T1 });
    assert.deepEqual(applied, { retired: [], occurrencesClosed: [], failed: [], deferred: [] });
    assert.equal((await repos.obligations.mustRead(listed.id)).value.active, true, `${label}: still active`);
    assert.equal((await repos.occurrences.mustRead(listed.occurrenceId)).value.closedAt, null, `${label}: still open`);
  }
});

test("SEEDED: a spent budget defers the rest untouched, in order, and the next cycle retires them", async () => {
  for (const [label, repos] of await eachStore("wtp-moved-")) {
    const rows = [AVONDALE, BENSON, "az:city:city-of-chandler"];
    const shapes = [];
    for (const id of rows) shapes.push(await meetingsShape(repos, id));
    const routes = routesHeldFor(rows);
    const sync = await syncObligations(repos, [obligation(CLERK)], T1);
    const plan = planHeldRouteRetirement({ outside: sync.outside ?? [], corpus, providers: [CLEAN], routes });
    assert.equal(plan.retire.length, 3);

    /* The budget is asked before each row: this one allows the first row only. */
    let asked = 0;
    const applied = await settleRetirements(repos, { items: plan.retire, now: T1, budget: { spent: () => asked++ >= 1 } });
    assert.deepEqual(applied.retired, [shapes[0].id], `${label}: one row inside the budget`);
    assert.deepEqual(applied.deferred, [shapes[1].id, shapes[2].id], `${label}: the rest deferred, in order`);
    assert.equal(asked, 2, `${label}: once spent, the budget is not asked again`);
    for (const shape of shapes.slice(1)) {
      assert.equal((await repos.obligations.mustRead(shape.id)).value.active, true, `${label}: a deferred row is untouched`);
      assert.equal((await repos.occurrences.mustRead(shape.occurrenceId)).value.closedAt, null, `${label}: and so is its occurrence`);
    }

    const next = await syncObligations(repos, [obligation(CLERK)], T1);
    const replan = planHeldRouteRetirement({ outside: next.outside ?? [], corpus, providers: [CLEAN], routes });
    assert.deepEqual(replan.retire.map((r) => r.obligationId), [shapes[1].id, shapes[2].id], `${label}: planned again next cycle`);
    const finished = await settleRetirements(repos, { items: replan.retire, now: T1 });
    assert.deepEqual(finished.retired, [shapes[1].id, shapes[2].id]);
    assert.deepEqual(finished.deferred, []);
  }
});
