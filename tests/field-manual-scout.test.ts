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
  scoutFieldManualCatalog,
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
  assert.equal(entries.filter(e => e.kind === "SCOUT_DISCOVERY").length, 1);
  assert.equal(entries[0]!.outcome, "YIELDED");
  assert.equal(entries[0]!.role, "SCOUT");
  assert.deepEqual(entries[0]!.states, ["nj"]);
  assert.equal(entries[0]!.url, "https://webapi.legistar.com/v1/morris/events");
  assert.equal((entries[0]!.payload as { routeId: string }).routeId, "morris-legistar-events");
});

test("writeFieldManualDiscoveries writes live and is grow-only across a second walk", async () => {
  const repos = createMemoryRepositories();
  const first = await writeFieldManualDiscoveries(repos, scoutDiscoveryEntries(result(), ["nj"]), "2026-09-19T00:01:00.000Z");
  assert.equal(first.written, 4, "door, method, cost observation and cost profile");
  let store = (await repos.fieldManual.read("live"))!.value;
  assert.equal(store.entries.length, 4);

  // A second scout re-discovers the same door: the store refreshes, never forks.
  await writeFieldManualDiscoveries(repos, scoutDiscoveryEntries(result({ attemptId: "att-2" }), ["nj"]), "2026-09-20T00:00:00.000Z");
  store = (await repos.fieldManual.read("live"))!.value;
  assert.equal(store.entries.filter(e => e.kind === "SCOUT_DISCOVERY").length, 1, "a re-discovery updates the place door in place");
  assert.equal(store.entries.length, 5, "the new attempt adds a cost observation, not another door or method");

  // The next scout inherits it via the projection.
  const projection = scoutFieldManualProjection(store, { subjectId: "ocd-division/country:us/state:nj/county:morris#governing", recordClass: "meetings" });
  assert.equal(projection.entryIds.length, 3, "the written door is inherited by the next NJ meetings scout");
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

test("OFFICIAL_ROSTER inherits historic contact and roster methods before unrelated doors", () => {
  const make = (id: string, field: string) => ({
    id, role: "SCOUT" as const, kind: "ROUTE", title: id, summary: id, states: ["az"], recordClasses: [field], platforms: [],
    outcome: "YIELDED" as const, url: `https://example.gov/${id}`, source: "method", observedAt: null, tier: null, payload: {},
  });
  const store = { formatVersion: 1 as const, updatedOn: null, entries: [make("meeting", "meeting"), make("contact", "contact"), make("roster", "roster")] };
  const projection = scoutFieldManualProjection(store, { subjectId: "az:city:sierra-vista", recordClass: "OFFICIAL_ROSTER", limit: 2 });
  assert.deepEqual(projection.entryIds, ["contact", "roster"]);
  assert.deepEqual(scoutFieldManualCatalog(store, { subjectId: "az:city:sierra-vista" }).map(entry => entry.id), ["meeting", "contact", "roster"],
    "the local searchable catalog keeps every applicable method, including those outside the brief cap");
});

test("a dead door recorded for robots.txt alone is not a wall: the brief says so and marks it walkable; an access-control dead door stays a wall (owner decision 2026-09-25)", () => {
  const door = (id: string, summary: string, outcome: "BLOCKED" | "YIELDED" = "BLOCKED") => ({
    id, role: "SCOUT" as const, kind: "DEAD_DOOR", title: id, summary, states: ["az"], recordClasses: ["meetings"], platforms: [],
    outcome, url: `https://${id}.example.gov/`, source: "cp_log_discovery_attempts", observedAt: "2026-09-20", tier: null, payload: {},
  });
  const store = { formatVersion: 1 as const, updatedOn: null, entries: [
    door("robots", "az:pima: the site's own origins refused this client (DISALLOWED)."),
    door("unread", "az:x: the site's own origins refused this client (CANNOT_TELL)."),
    door("forbidden", "az:y: the site's own origins refused this client (HTTP 403)."),
    door("mixed", "az:z: the site's own origins refused this client (DISALLOWED, HTTP 429)."),
  ] };
  const lines = fieldManualBriefLines(projectFieldManual(store, { role: "SCOUT", state: "az", recordClass: "meetings" }));
  assert.ok(lines[0]!.includes("inherited door"));
  assert.match(lines[1]!, /wall only when an access control stopped it/);
  assert.match(lines[1]!, /robots\.txt alone is NOT a wall/);
  const line = (id: string) => lines.find((l) => l.includes(`${id}.example.gov`)) ?? "";
  assert.match(line("robots"), /\[robots\.txt only — not a wall; walk it\]$/);
  assert.match(line("unread"), /\[robots\.txt only — not a wall; walk it\]$/);
  assert.doesNotMatch(line("forbidden"), /not a wall/, "a 403 is an access control: still a wall");
  assert.doesNotMatch(line("mixed"), /not a wall/, "a door that also met a 429 is still a wall");
  /* A manual with no dead door carries no dead-door note. */
  const live = fieldManualBriefLines(projectFieldManual({ ...store, entries: [door("open", "a yielded route", "YIELDED")] }, { role: "SCOUT", state: "az" }));
  assert.equal(live.length, 2);
  assert.doesNotMatch(live.join("\n"), /not a wall/);
});

for (const researchRole of ["SCOUT", "DETECTIVE"] as const) test(`${researchRole} stopped walks save scoped resumable lessons even when finish is refused`, async () => {
  const r = result({ researchRole, outcome: "NO_PROGRESS", candidates: [], stoppedBy: "BOUND",
    nextRungs: ["alternate-official-host-or-mirror"],
    rungs: [{ index: 1, rung: "primary-site-navigation", tool: "fetch_public", target: "https://government.example/calendar",
      observed: "HTTP 404", ok: false, artifactIds: [], note: null, at: "2026-09-19T00:00:01Z" }],
    refusal: [{ code: "SCOUT_NO_TOOL_USED", detail: "finish refused" }] });
  const repos = createMemoryRepositories();
  await writeFieldManualDiscoveries(repos, scoutDiscoveryEntries(r, ["nj"]), r.recordedAt);
  await writeFieldManualDiscoveries(repos, scoutDiscoveryEntries(r, ["nj"]), r.recordedAt);
  const store = (await repos.fieldManual.read("live"))!.value;
  const lesson = store.entries.find(e => e.kind === "EXHAUSTED_RUNGS")!;
  assert.equal(store.entries.filter(e => e.kind === "EXHAUSTED_RUNGS").length, 1);
  assert.equal(lesson.outcome, "REFERENCE");
  assert.equal((lesson.payload as { rungs: { whyNoProgress: string }[] }).rungs[0].whyNoProgress, "HTTP 404");
  assert.equal(scoutFieldManualProjection(store, { subjectId: r.subjectId, recordClass: r.recordClass, limit: 1 }).entryIds[0], lesson.id);
  assert.equal(scoutFieldManualProjection(store, { subjectId: r.subjectId + "-other", recordClass: r.recordClass }).entryIds.includes(lesson.id), false);
  assert.equal(scoutFieldManualProjection(store, { subjectId: r.subjectId, recordClass: "photo" }).entryIds.includes(lesson.id), false);
  assert.equal(projectFieldManual(store, { role: researchRole }).entryIds.includes(lesson.id), false);
});

test("successful transport without progress stays a resumable observation, not a dead door", () => {
  const r = result({ outcome: "NO_PROGRESS", candidates: [], rungs: [{ index: 1, rung: "site-search-or-sitemap", tool: "fetch_public",
    target: "https://government.example/", observed: "HTTP 200", ok: true, note: "No current calendar found on this page", artifactIds: ["a1"], at: "2026-09-19T00:00:01Z" }] });
  const lesson = scoutDiscoveryEntries(r, ["nj"]).find(e => e.kind === "EXHAUSTED_RUNGS")!;
  assert.equal((lesson.payload as { rungs: { whyNoProgress: string }[] }).rungs[0].whyNoProgress, r.rungs[0].note);
  assert.equal(lesson.outcome, "REFERENCE");
  assert.equal(scoutDiscoveryEntries(result(), ["nj"]).some(e => e.kind === "EXHAUSTED_RUNGS"), false);
});

test("legacy empty refusal lists do not invent a failed finish or require missing rungs", () => {
  const legacy = { subjectId: "synthetic-government", recordClass: "meetings", attemptId: "legacy", recordedAt: "2026-10-05T00:00:00Z",
    candidates: [], refusal: [], sourceDeadEnds: [] } as unknown as ScoutResult;
  assert.deepEqual(scoutDiscoveryEntries(legacy, []), []);
  const stopped = scoutDiscoveryEntries({ ...legacy, outcome: "NO_PROGRESS" }, []);
  const lesson = stopped.find(e => e.kind === "EXHAUSTED_RUNGS")!;
  assert.deepEqual((lesson.payload as { rungs: unknown[] }).rungs, []);
  assert.equal(lesson.outcome, "REFERENCE");
});
