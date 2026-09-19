import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { projectFieldManual } from "../lib/control-plane/field-manual.ts";
import {
  compoundingPair,
  fieldManualBriefLines,
  knownRouteIds,
  scoutDiscoveryEntries,
  scoutFieldManualProjection,
  scoutStateHint,
  writeFieldManualDiscoveries,
} from "../lib/control-plane/scheduler/field-manual-scout.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";

function result(over: Partial<ScoutResult> = {}): ScoutResult {
  return {
    formatVersion: 1,
    attemptId: "att-1",
    obligationId: "freshness:jurisdiction:nj:county:county-of-morris#meetings-1",
    routeTaskId: "rt-1",
    workItemId: "wi-1",
    subjectId: "ocd-division/country:us/state:nj/county:morris#governing",
    routeId: null,
    recordClass: "meetings",
    providerId: null,
    reason: "",
    outcome: "ROUTE_CANDIDATE",
    stoppedBy: "MODEL",
    rungs: [],
    distinctEvidenceRungs: 0,
    candidates: [
      {
        routeId: "morris-legistar-events",
        title: "Morris County Legistar events API",
        url: "https://webapi.legistar.com/v1/morris/events",
        procedure: "GET the events feed",
        relevance: "the county's own meeting calendar",
        permission: "ALLOWED",
        permissionReading: "robots allows /v1/",
        evidenceArtifactIds: ["a1"],
        observedOn: "2026-09-19",
        recordClass: "meetings",
        deterministic: true,
        unverified: [],
      },
    ],
    findings: [],
    nextRungs: [],
    unverified: [],
    narrative: "",
    worker: { provider: "anthropic", model: "m", modelReported: null },
    usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, turns: 1, toolCalls: 1 },
    usd: 0.1,
    elapsedMs: 1000,
    artifactIds: ["a1"],
    methodCandidateIds: [],
    refusal: null,
    startedAt: "2026-09-19T00:00:00.000Z",
    recordedAt: "2026-09-19T00:01:00.000Z",
    ...over,
  };
}

test("scoutStateHint reads the state from an OCD subject and from an obligation id", () => {
  assert.deepEqual(scoutStateHint("ocd-division/country:us/state:nj/county:morris#governing", null), ["nj"]);
  assert.deepEqual(scoutStateHint(null, "freshness:jurisdiction:az:city:city-of-tucson#meetings-1"), ["az"]);
  assert.deepEqual(scoutStateHint("nothing here", "nothing here"), []);
});

test("scoutDiscoveryEntries turns grounded candidates into YIELDED field-manual entries", () => {
  const entries = scoutDiscoveryEntries(result(), ["nj"]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.outcome, "YIELDED");
  assert.equal(entries[0]!.role, "SCOUT");
  assert.deepEqual(entries[0]!.states, ["nj"]);
  assert.equal(entries[0]!.url, "https://webapi.legistar.com/v1/morris/events");
  assert.equal((entries[0]!.payload as { routeId: string }).routeId, "morris-legistar-events");
});

test("writeFieldManualDiscoveries writes live and is grow-only across a second walk", async () => {
  const repos = createMemoryRepositories();
  const first = await writeFieldManualDiscoveries(repos, scoutDiscoveryEntries(result(), ["nj"]), "2026-09-19T00:01:00.000Z");
  assert.equal(first.written, 1);
  let store = (await repos.fieldManual.read("live"))!.value;
  assert.equal(store.entries.length, 1);

  // A second scout re-discovers the same door: the store refreshes, never forks.
  await writeFieldManualDiscoveries(repos, scoutDiscoveryEntries(result({ attemptId: "att-2" }), ["nj"]), "2026-09-20T00:00:00.000Z");
  store = (await repos.fieldManual.read("live"))!.value;
  assert.equal(store.entries.length, 1, "a re-discovery updates in place — the store only grows");

  // The next scout inherits it via the projection.
  const projection = scoutFieldManualProjection(store, { subjectId: "ocd-division/country:us/state:nj/county:morris#governing", recordClass: "meetings" });
  assert.equal(projection.entryIds.length, 1, "the written door is inherited by the next NJ meetings scout");
  assert.ok(fieldManualBriefLines(projection)[0]!.includes("inherited door"));
});

test("compoundingPair flags a rebuilt-existing route as a defect (RULING 63)", () => {
  const known = new Set(["morris-legistar-events"]);
  const pair = compoundingPair(5, result(), known);
  assert.equal(pair.inheritedCount, 5);
  assert.equal(pair.newlyBuilt, 1);
  assert.deepEqual(pair.rebuiltExisting, ["morris-legistar-events"], "rebuilding a door the manual already held is reported, not neutral progress");

  const fresh = compoundingPair(5, result(), new Set());
  assert.deepEqual(fresh.rebuiltExisting, [], "a genuinely new door is not a defect");
});

test("a projection never exceeds its limit — a worker inherits a page, not the whole store", () => {
  const repos = createMemoryRepositories();
  void repos;
  const store = { formatVersion: 1 as const, updatedOn: null, entries: Array.from({ length: 200 }, (_, i) => ({
    id: `fm-${i}`, role: "SCOUT" as const, kind: "ROUTE", title: `t${i}`, summary: "s", states: ["nj"], recordClasses: ["meetings"], platforms: [], outcome: "YIELDED" as const, url: null, source: "x", observedAt: null, tier: null, payload: {},
  })) };
  const projection = projectFieldManual(store, { role: "SCOUT", state: "nj", recordClass: "meetings", limit: 30 });
  assert.equal(projection.lines.length, 30);
  assert.equal(projection.total, 200);
});
