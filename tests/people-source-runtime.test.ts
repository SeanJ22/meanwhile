import assert from "node:assert/strict";
import test from "node:test";
import { PEOPLE_SOURCE_CONTRACTS, PEOPLE_SOURCE_STATES, STANDING_PEOPLE_SOURCE_IDS, peopleSourceContractId } from "../lib/civic-data/people-source-contracts.ts";
import { PLURAL_STATES } from "../lib/sources/plural/targets.ts";
import { routineFailureDomainFrontier, routineTaskFromContract, routineTaskDue, ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";
import { keyRefFor } from "../lib/doors/seed-feeds.ts";
import { runPeopleSourceRefresh, parsePeopleSourceArguments } from "../lib/civic-data/people-source-runtime.ts";
import { normalizeLegiscanPeople } from "../lib/sources/people/acquisition.ts";
import { stateIdentity } from "../lib/sources/people/common.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readPeopleSourceProjection } from "../lib/civic-data/people-source-publication.ts";
import { parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";

test("every nationally available people source has an independent standing state shard", () => {
  const tasks = PEOPLE_SOURCE_CONTRACTS.filter(contract => contract.sourceId !== "people-portraits").map(routineTaskFromContract);
  assert.equal(tasks.length, PEOPLE_SOURCE_STATES.length * STANDING_PEOPLE_SOURCE_IDS.length);
  assert.equal(new Set(tasks.map(task => `${task.recordClass}:${task.scope}`)).size, tasks.length);
  for (const state of PEOPLE_SOURCE_STATES) for (const sourceId of STANDING_PEOPLE_SOURCE_IDS) {
    const task = tasks.find(task => task.id === peopleSourceContractId(state, sourceId));
    assert.ok(task);
    assert.equal(task.scope, `US-${state.toUpperCase()}:people:${sourceId}:v1`);
    assert.deepEqual(task.command, ["scripts/national-people-refresh.mts", "--promote", `--state=${state}`, `--source=${sourceId}`]);
    assert.equal(routineTaskDue(task, undefined, 0), true);
    assert.equal(task.recordClass, sourceId === "congress-api" || sourceId === "govinfo" ? "FEDERAL_DIRECTORY" : "STATE_LEGISLATOR");
  }
  const admitted = routineFailureDomainFrontier(tasks.map(task => ({ task, lastConsideredAt: null })));
  assert.equal(admitted.length, tasks.length, "a failure in one state cannot defer another state's first read");
});

test("portraits are automatic and independently clocked after a fresh state roster", () => {
  const now = Date.parse("2026-10-12T00:00:00.000Z");
  const native = ROUTINE_SOURCE_TASKS.find(task => task.id === `openstates-people-${PLURAL_STATES[0]}`)!;
  const portraits = PEOPLE_SOURCE_CONTRACTS.filter(contract => contract.sourceId === "people-portraits").map(routineTaskFromContract);
  assert.equal(portraits.length, PEOPLE_SOURCE_STATES.length + 1);
  assert.equal(routineTaskDue(native, { lastAttemptedAt: new Date(now).toISOString(), lastSucceededObservedAt: new Date(now).toISOString() }, now), false);
  for (const task of portraits) {
    assert.equal(routineTaskDue(task, undefined, now), true);
    assert.equal(task.childTimeoutMs, 0, "the runner must not end finite portrait work at an aggregate deadline");
    assert.notEqual(task.scope, native.scope);
    assert.equal(task.authorityMode, "DERIVED");
    assert.ok(task.command[0]?.endsWith("people-portraits-refresh.mts"));
  }
});

test("standing credentialed people doors name the provided keys", () => {
  assert.equal(keyRefFor("people-legiscan-api-xx", "legiscan-api"), "LEGISCAN_API_KEY");
  assert.equal(keyRefFor("people-govinfo-xx", "govinfo"), "DATA_GOV_API_KEY");
  assert.equal(keyRefFor("people-congress-api-xx", "congress-api"), "CONGRESS_API_KEY");
});

test("the standing reader publishes acquired people and preserves both states after a source failure", async () => {
  const store = new MemoryRoutineDataStore(), states = PEOPLE_SOURCE_STATES.filter(state=>stateIdentity(state).root.includes("/state:")).slice(0, 2);
  const sourceId = "legiscan-api" as const;
  const sourceUrl = "https://api.legiscan.com/?op=getSessionPeople&id=123";
  let at = "2026-10-12T00:00:00.000Z";
  const calls: string[] = [], lines: string[] = [];
  const acquire = async (input: Parameters<NonNullable<import("../lib/civic-data/people-source-runtime.ts").PeopleSourceRuntimeDependencies["acquire"]>>[0]) => {
    calls.push(input.state);
    const body = JSON.stringify({ status: "OK", sessionpeople: { session_id: 123, people: [{
      people_id: 456, name: "Member One", role: "Representative", role_id: 1, district: "3", votesmart_id: 789,
    }] } });
    const roster = normalizeLegiscanPeople(JSON.parse(body), { ...input, sourceId, asOf: at }, sourceUrl, at, 123);
    assert.equal(roster.divisions[0]?.ocdId,`ocd-division/country:us/state:${input.state}/sldl:3`,"new source members use their state's held boundaries without an Open States match");
    const release = { state: input.state, roster, releaseId: at, gaps: [],
      acquisitions: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, httpStatus: 200, body, retrievedAt: at }],
      coverage: { people: roster.officeholders.length } };
    await input.onPerson?.(release);
    const immediatelyPublished = await readPeopleSourceProjection(`US-${input.state.toUpperCase()}`, sourceId, { store, now: at, bypassCache: true });
    assert.equal(immediatelyPublished.kind, "PROMOTED", "verified people reach readers before acquisition finishes the state");
    return release;
  };
  const dependencies = { now: () => at, writeLine: (line: string) => lines.push(line),
    readDivisions: async (state:string) => {assert.ok(states.includes(state));return [{ocdId:`ocd-division/country:us/state:${state}/sldl:3`,label:"State House District 3",divisionType:"sldl"}];},
    readHeld: async (state: string) => { assert.ok(states.includes(state)); return undefined; }, acquire };
  for (const state of states) {
    const result = await runPeopleSourceRefresh({ state, sourceId, store }, dependencies);
    assert.equal(result.succeeded, true,lines.join("\n"));
    const receipt = parseRoutineRunnerReceipt(lines.at(-1)!);
    assert.equal(receipt.ok, true);
    if (receipt.ok) assert.equal(receipt.receipt.source, peopleSourceContractId(state, sourceId));
  }
  const before = await Promise.all(states.map(state => store.readPromotion("STATE_LEGISLATOR", `US-${state.toUpperCase()}:people:${sourceId}:v1`)));
  assert.ok(before.every(Boolean));
  at = "2026-10-12T01:00:00.000Z";
  const failed = await runPeopleSourceRefresh({ state: states[0]!, sourceId, store }, { ...dependencies,
    acquire: async () => { throw new Error("HTTP 503 from the people provider"); } });
  assert.equal(failed.succeeded, false);
  const failureReceipt = parseRoutineRunnerReceipt(lines.at(-1)!);
  assert.ok(failureReceipt.ok);
  assert.equal(failureReceipt.receipt.state, "SOURCE_BLOCKED");
  assert.equal(failureReceipt.receipt.lastKnownGoodVersion, before[0]!.versionId);
  for (let index = 0; index < states.length; index++) {
    const held = await readPeopleSourceProjection(`US-${states[index]!.toUpperCase()}`, sourceId, { store, now: at, bypassCache: true });
    assert.equal(held.kind, "PROMOTED");
    if (held.kind === "PROMOTED") {
      assert.equal(held.metadata.versionId, before[index]!.versionId);
      assert.equal(held.value.roster.officeholders[0]!.name, "Member One");
    }
  }
  assert.deepEqual(calls, states);
});

test("people commands require one data-derived state and one supported source", () => {
  const state = PEOPLE_SOURCE_STATES[0]!;
  assert.deepEqual(parsePeopleSourceArguments(["--promote", `--state=${state}`, "--source=legiscan-api"]), { state, sourceId: "legiscan-api" });
  assert.throws(() => parsePeopleSourceArguments(["--promote", `--state=${state}`]), /EXACT_STATE_AND_SOURCE/);
  assert.throws(() => parsePeopleSourceArguments(["--promote", "--state=all", "--source=legiscan-api"]), /STATE_UNSUPPORTED/);
});
