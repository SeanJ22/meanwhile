/**
 * **A JURISDICTION'S MEETINGS DISCOVERY MOVES TO THE GAP LEDGER BEFORE ITS OLD
 * CLOCK RETIRES.** (2026-09-23.)
 *
 * Since 902f5c50 no freshness obligation carries a jurisdiction's meetings
 * discovery: the local-jurisdictions provider opens no MEETINGS source. The
 * old `freshness:jurisdiction:<id>#meetings-N` rows sat outside the corpus,
 * 484 of them active on 2026-09-23, and the superseded planner's bound held
 * them all. The need did not end. The committed gap ledger now records it
 * (`data/derived/gap-ledger.json`, `meetingsDiscovery.needs`).
 *
 * What these tests hold:
 *
 * - **The record.** The ledger lists a jurisdiction when every MEETINGS source
 *   its registry row carries is DISCOVERY_OWED, or it carries none. A ledger
 *   that is malformed, empty, duplicated or self-contradicting is UNREADABLE,
 *   never an empty list. The committed ledger reads.
 * - **Recorded first.** A meetings row retires only when the ledger lists its
 *   jurisdiction, with a reason naming the entry. An unlisted jurisdiction, an
 *   unreadable ledger or a provider that did not read cleanly holds it back by
 *   name, and it stays active.
 * - **Owned once.** The superseded planner never sees a meetings row, so the
 *   bound it keeps for sudden drops is not tripped by a need that moved.
 * - **Nothing else is written.** The occurrence closes unresolved, never with
 *   a disposition; the RouteTask, its lease, Attempts, commits and artifacts
 *   are not written, and nothing is deleted.
 *
 * Every test that writes runs on the in-memory double AND the durable file
 * store.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import {
  jurisdictionMeetingsSubject,
  movedToGapLedgerReason,
  openOccurrence,
  planMovedToGapLedger,
  planSupersededRetirement,
  settleRetirements,
  syncObligations,
  type ProviderReading,
  type StandingObligation,
} from "../lib/control-plane/scheduler/durable.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import {
  GAP_LEDGER_PATH,
  OWN_SITE_MEETINGS_SOURCE,
  meetingsDiscoveryNeeds,
  recordedMeetingsDiscovery,
  type JurisdictionRegistryFile,
} from "../lib/hunt/meetings-discovery.ts";
import { eachStore } from "./control-plane-fixtures.ts";

const T0 = "2026-09-09T12:00:00.000Z"; // a cycle before 902f5c50 that opened a meetings occurrence and never reached it
const T1 = "2026-09-23T19:00:00.000Z"; // the first cycle that reads the ledger
const AVONDALE = "az:city:city-of-avondale";
const BENSON = "az:city:city-of-benson";
const UNLISTED = "az:town:town-nowhere";
const meetingsRow = (jurisdictionId: string, n = 1) => `freshness:jurisdiction:${jurisdictionId}#meetings-${n}`;
const CLERK = `freshness:jurisdiction:${AVONDALE}#candidate-filings-1`;
const LEDGER = { path: GAP_LEDGER_PATH, recorded: { jurisdictionIds: new Set([AVONDALE, BENSON]) } } as const;
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

/** The corpus after 902f5c50: local-jurisdictions still emits its other routes, and no MEETINGS route. */
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

test("RECORD: anything short of a well-formed ledger is unreadable, never an empty list", () => {
  const need = (jurisdictionId: string) => ({
    jurisdictionId, stateCode: "AZ", name: jurisdictionId.toUpperCase(), govClass: "CITY_OR_TOWN",
    ownWebAddress: null, basis: "NO_MEETINGS_SOURCE_RECORDED", sources: [],
  });
  const readable = recordedMeetingsDiscovery({ meetingsDiscovery: { counts: { enumerated: 2 }, needs: [need(AVONDALE), need(BENSON)] } });
  assert.ok("jurisdictionIds" in readable);
  assert.deepEqual([...readable.jurisdictionIds], [AVONDALE, BENSON]);

  const unreadable: [unknown, RegExp][] = [
    [null, /no meetingsDiscovery section/],
    [{}, /no meetingsDiscovery section/],
    [{ meetingsDiscovery: { counts: { enumerated: 0 }, needs: [] } }, /records no meetingsDiscovery\.needs/],
    [{ meetingsDiscovery: { counts: { enumerated: 1 }, needs: [{ name: "x" }] } }, /a need with no jurisdictionId/],
    [{ meetingsDiscovery: { counts: { enumerated: 2 }, needs: [need(BENSON), need(BENSON)] } }, /lists az:city:city-of-benson twice/],
    [{ meetingsDiscovery: { counts: { enumerated: 3 }, needs: [need(AVONDALE), need(BENSON)] } }, /counts 3 needs and lists 2/],
    [{ meetingsDiscovery: { counts: { enumerated: 1 }, needs: [{ ...need(AVONDALE), basis: "WIRED" }] } }, /malformed need for az:city:city-of-avondale/],
    [{ meetingsDiscovery: { counts: { enumerated: 1 }, needs: [{ ...need(AVONDALE), ownWebAddress: 7 }] } }, /malformed need/],
  ];
  for (const [ledger, why] of unreadable) {
    const answer = recordedMeetingsDiscovery(ledger);
    assert.ok("unreadable" in answer, JSON.stringify(ledger));
    assert.match(answer.unreadable, why);
  }
});

test("RECORD: the committed ledger reads, and lists the jurisdictions the runner will retire against", () => {
  const committed = recordedMeetingsDiscovery(JSON.parse(readFileSync(join(process.cwd(), GAP_LEDGER_PATH), "utf8")));
  assert.ok("jurisdictionIds" in committed, "unreadable" in committed ? committed.unreadable : "");
  assert.ok(committed.jurisdictionIds.has(AVONDALE));
  assert.ok(committed.jurisdictionIds.has(BENSON));
});

test("PLAN: a meetings row retires only when the ledger lists its jurisdiction; every other one is held back by name", () => {
  assert.equal(jurisdictionMeetingsSubject(meetingsRow(AVONDALE, 2)), AVONDALE);
  assert.equal(jurisdictionMeetingsSubject(CLERK), null);
  assert.equal(jurisdictionMeetingsSubject("freshness:meetings:legacy-body"), null);

  const outside = [
    stored(meetingsRow(AVONDALE)),
    stored(meetingsRow(BENSON, 2)),
    stored(meetingsRow(UNLISTED)),
    stored(meetingsRow("az:city:already-retired"), { active: false }),
    stored(`freshness:jurisdiction:${BENSON}#clerk-1`),
  ];
  const plan = planMovedToGapLedger({ outside, corpus, providers: [CLEAN], ledger: LEDGER });
  assert.deepEqual(plan.retire, [
    { obligationId: meetingsRow(AVONDALE), reason: movedToGapLedgerReason(GAP_LEDGER_PATH, AVONDALE) },
    { obligationId: meetingsRow(BENSON, 2), reason: movedToGapLedgerReason(GAP_LEDGER_PATH, BENSON) },
  ]);
  assert.match(plan.retire[0].reason, /^MOVED TO THE GAP LEDGER: .*still owed\. data\/derived\/gap-ledger\.json records it \(meetingsDiscovery\.needs, az:city:city-of-avondale\).*Nothing was discovered$/);
  assert.deepEqual(plan.heldBack.map((h) => [h.obligationId, h.code]), [[meetingsRow(UNLISTED), "NOT_RECORDED_IN_LEDGER"]]);
  assert.match(plan.heldBack[0].why, /does not list az:town:town-nowhere/);
  assert.deepEqual(
    [...plan.owned].sort(),
    [meetingsRow("az:city:already-retired"), meetingsRow(AVONDALE), meetingsRow(BENSON, 2), meetingsRow(UNLISTED)].sort(),
    "every meetings row is owned here, retired or not; a non-meetings row is not",
  );

  const inCorpus = planMovedToGapLedger({
    outside: [stored(meetingsRow(AVONDALE))],
    corpus: [...corpus, { providerId: "local-jurisdictions", obligationId: meetingsRow(AVONDALE) }],
    providers: [CLEAN],
    ledger: LEDGER,
  });
  assert.deepEqual([inCorpus.retire, inCorpus.heldBack, [...inCorpus.owned]], [[], [], []], "a row a provider emits again is not retired");
});

test("PLAN: an unreadable ledger or a provider that did not read cleanly retires nothing", () => {
  const outside = [stored(meetingsRow(AVONDALE)), stored(meetingsRow(BENSON))];
  const unreadable = planMovedToGapLedger({
    outside,
    corpus,
    providers: [CLEAN],
    ledger: { path: GAP_LEDGER_PATH, recorded: { unreadable: "data/derived/gap-ledger.json records no meetingsDiscovery.needs" } },
  });
  assert.deepEqual(unreadable.retire, []);
  assert.deepEqual(unreadable.heldBack.map((h) => h.code), ["LEDGER_UNREADABLE", "LEDGER_UNREADABLE"]);
  assert.match(unreadable.heldBack[0].why, /records no meetingsDiscovery\.needs/);

  const failing = planMovedToGapLedger({
    outside,
    corpus,
    providers: [{ ...CLEAN, readFailure: "az jurisdictions projection read rejected" }],
    ledger: LEDGER,
  });
  assert.deepEqual(failing.retire, []);
  assert.deepEqual(failing.heldBack.map((h) => h.code), ["PROVIDER_NOT_READ_CLEANLY", "PROVIDER_NOT_READ_CLEANLY"]);

  const unowned = planMovedToGapLedger({ outside, corpus: [], providers: [CLEAN], ledger: LEDGER });
  assert.deepEqual(unowned.heldBack.map((h) => h.code), ["NO_PROVIDER_NAMESPACE", "NO_PROVIDER_NAMESPACE"]);
});

test("PLAN: the superseded planner never sees a meetings row, so a moved need does not trip the bound", () => {
  /* The production shape: the provider's meetings rows are 41% of its standing set. */
  const meetings = Array.from({ length: 4 }, (_, i) => stored(meetingsRow(i % 2 === 0 ? AVONDALE : BENSON, i + 1)));
  const stale = stored(`freshness:jurisdiction:${BENSON}#clerk-9`);
  const wide = [...corpus, ...Array.from({ length: 5 }, (_, i) => ({ providerId: "local-jurisdictions", obligationId: `${CLERK}-${i}` }))];
  const outside = [...meetings, stale];

  const alone = planSupersededRetirement({ outside, corpus: wide, providers: [CLEAN] });
  assert.deepEqual(alone.retire, [], "without the moved planner, 5 of 11 is over the bound");

  const moved = planMovedToGapLedger({ outside, corpus: wide, providers: [CLEAN], ledger: LEDGER });
  assert.equal(moved.retire.length, 4);
  const rest = planSupersededRetirement({ outside: outside.filter((row) => !moved.owned.has(row.id)), corpus: wide, providers: [CLEAN] });
  assert.deepEqual(rest.retire.map((r) => r.obligationId), [stale.id], "1 of 7 standing is inside the bound");
  assert.deepEqual(rest.heldBack, []);
});

/** A meetings row registered before 902f5c50, its occurrence opened and never reached. */
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

test("SEEDED: a recorded jurisdiction's meetings row retires naming the ledger, its occurrence closes unresolved, and nothing else is written", async () => {
  for (const [label, repos] of await eachStore("wtp-moved-")) {
    const listed = await meetingsShape(repos, AVONDALE);
    const unlisted = await meetingsShape(repos, UNLISTED);
    const before = await untouched(repos, listed.routeTaskId, listed.workItemId);

    /* After 902f5c50 the provider emits no MEETINGS route. */
    const sync = await syncObligations(repos, [obligation(CLERK)], T1);
    assert.deepEqual(sync.outside?.map((o) => o.id).sort(), [listed.id, unlisted.id].sort(), `${label}: sync names both rows it no longer walks`);
    const plan = planMovedToGapLedger({ outside: sync.outside ?? [], corpus, providers: [CLEAN], ledger: LEDGER });
    assert.deepEqual(plan.heldBack.map((h) => [h.obligationId, h.code]), [[unlisted.id, "NOT_RECORDED_IN_LEDGER"]]);
    const applied = await settleRetirements(repos, { items: plan.retire, now: T1 });
    assert.deepEqual(applied, { retired: [listed.id], occurrencesClosed: [listed.occurrenceId], failed: [], deferred: [] });

    const row = (await repos.obligations.mustRead(listed.id)).value;
    assert.equal(row.active, false);
    assert.equal(row.nextDueAt, null);
    assert.equal(row.openOccurrenceId, null);
    assert.equal(row.retiredAt, T1);
    assert.equal(row.retirementReason, movedToGapLedgerReason(GAP_LEDGER_PATH, AVONDALE));

    const occurrence = (await repos.occurrences.mustRead(listed.occurrenceId)).value;
    assert.equal(occurrence.closedAt, T1);
    assert.equal(occurrence.disposition, null, `${label}: a moved need is not a reading`);
    assert.match(occurrence.unresolvedReason ?? "", /^MOVED TO THE GAP LEDGER: .*nothing was read and nothing was refreshed$/);

    assert.deepEqual(await untouched(repos, listed.routeTaskId, listed.workItemId), before, `${label}: RouteTask, lease, Attempts, commits, artifacts and WorkItem unchanged`);

    const kept = (await repos.obligations.mustRead(unlisted.id)).value;
    assert.equal(kept.active, true, `${label}: a need the ledger does not record stays live`);
    assert.equal((await repos.occurrences.mustRead(unlisted.occurrenceId)).value.closedAt, null, `${label}: and its occurrence stays open`);
    assert.equal((await repos.obligations.mustRead(CLERK)).value.active, true, `${label}: a row the corpus names is untouched`);

    const again = await syncObligations(repos, [obligation(CLERK)], T1);
    const replan = planMovedToGapLedger({ outside: again.outside ?? [], corpus, providers: [CLEAN], ledger: LEDGER });
    assert.deepEqual(replan.retire, [], `${label}: a retired row is history, never planned twice`);
  }
});

test("SEEDED: while the ledger cannot be read, no meetings row retires and its occurrence stays open", async () => {
  for (const [label, repos] of await eachStore("wtp-moved-")) {
    const listed = await meetingsShape(repos, AVONDALE);
    const sync = await syncObligations(repos, [obligation(CLERK)], T1);
    const plan = planMovedToGapLedger({
      outside: sync.outside ?? [],
      corpus,
      providers: [CLEAN],
      ledger: { path: GAP_LEDGER_PATH, recorded: { unreadable: "data/derived/gap-ledger.json could not be read (ENOENT)" } },
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
    const ledger = { path: GAP_LEDGER_PATH, recorded: { jurisdictionIds: new Set(rows) } };
    const sync = await syncObligations(repos, [obligation(CLERK)], T1);
    const plan = planMovedToGapLedger({ outside: sync.outside ?? [], corpus, providers: [CLEAN], ledger });
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
    const replan = planMovedToGapLedger({ outside: next.outside ?? [], corpus, providers: [CLEAN], ledger });
    assert.deepEqual(replan.retire.map((r) => r.obligationId), [shapes[1].id, shapes[2].id], `${label}: planned again next cycle`);
    const finished = await settleRetirements(repos, { items: replan.retire, now: T1 });
    assert.deepEqual(finished.retired, [shapes[1].id, shapes[2].id]);
    assert.deepEqual(finished.deferred, []);
  }
});
