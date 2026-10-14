import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  FREE_WALK_PROJECTION,
  asFreeWalkRecord,
  freeWalkBrief,
  readFreeDiscoveryWalks,
  type FreeWalkSubject,
} from "../lib/control-plane/discovery/free-walks.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { FREE_WALK_FIRST, MEETINGS_DISCOVERY_NAMESPACE, paidDiscoveryHold } from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import type { DiscoveryOutcome, MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";
import { eachStore } from "./control-plane-fixtures.ts";

const ROOT = process.cwd();
const AJ = "az:city:city-of-apache-junction";
const COOLIDGE = "az:city:city-of-coolidge";
const AJ_ROW = `${MEETINGS_DISCOVERY_NAMESPACE}${AJ}#own-site-meetings`;
const COOLIDGE_ROW = `${MEETINGS_DISCOVERY_NAMESPACE}${COOLIDGE}#find-own-site`;
const SUBJECTS: readonly FreeWalkSubject[] = [
  { jurisdictionId: AJ, walkable: true },
  { jurisdictionId: COOLIDGE, walkable: false },
  { jurisdictionId: "az:city:underivable", walkable: null },
];

function attempt(outcome: DiscoveryOutcome, finishedAt: string, leads: MeetingsDiscoveryAttempt["leads"] = []): MeetingsDiscoveryAttempt {
  return {
    formatVersion: 1,
    attemptId: `da-${outcome}-${finishedAt}`,
    jurisdictionId: AJ,
    stateCode: "AZ",
    ownWebAddress: "http://www.ajcity.net",
    startedAt: finishedAt,
    finishedAt,
    outcome,
    found: outcome === "FOUND"
      ? [{ vendor: "legistar", url: "https://ajcity.legistar.com/Calendar.aspx", basis: "LINKED", evidence: "linked", count: 3, detail: "3 meetings", artifactId: null }]
      : [],
    leads,
    steps: [],
    recipes: { applied: [], skipped: [], learned: [] },
    search: [],
    requestCount: 2,
    recheckAfter: "2026-10-24T00:00:00.000Z",
    note: "",
  } as MeetingsDiscoveryAttempt;
}

const held = (row: string, walks: Parameters<typeof paidDiscoveryHold>[1]) => paidDiscoveryHold(row, walks)?.code ?? "PAID LANE MAY TAKE IT";

test("EVERY READING REACHES ITS HOLD DECISION: found and unread hold, not-walked or an unsuccessful walk permits paid discovery; the newest walk decides", async () => {
  for (const [label, repos] of await eachStore("wtp-free-walks-")) {
    const before = await readFreeDiscoveryWalks(repos, SUBJECTS);
    assert.equal(before.latestFor(AJ), "NOT_WALKED", `${label}: no walk recorded yet`);
    assert.equal(held(AJ_ROW, before), "PAID LANE MAY TAKE IT", `${label}: useful paid discovery need not wait for a free walk`);
    assert.equal(before.latestFor(COOLIDGE), "NO_SITE_TO_WALK");
    assert.equal(held(COOLIDGE_ROW, before), "PAID LANE MAY TAKE IT", `${label}: with no site to walk, the free lane has nothing to try`);
    assert.equal(before.latestFor("az:city:underivable"), "UNREAD");
    assert.equal(before.latestFor("az:city:not-dispatched"), "UNREAD", `${label}: a government nobody asked about is held, not guessed`);
    assert.equal(held(`${MEETINGS_DISCOVERY_NAMESPACE}az:city:underivable#own-site-meetings`, before), FREE_WALK_FIRST);

    const decisions: [DiscoveryOutcome, string, string][] = [
      ["FOUND", "FOUND", FREE_WALK_FIRST],
      ["LEAD", "WALKED_NOT_FOUND", "PAID LANE MAY TAKE IT"],
      ["NOTHING_DETECTED", "WALKED_NOT_FOUND", "PAID LANE MAY TAKE IT"],
      ["BLOCKED", "WALKED_NOT_FOUND", "PAID LANE MAY TAKE IT"],
      ["COULD_NOT_READ", "WALKED_NOT_FOUND", "PAID LANE MAY TAKE IT"],
      ["FOUND", "FOUND", FREE_WALK_FIRST],
    ];
    for (const [i, [outcome, reading, decision]] of decisions.entries()) {
      const at = `2026-09-2${i}T00:00:00.000Z`;
      await repos.discoveryAttempts.append(AJ, `da-${i}`, attempt(outcome, at), at);
      const walks = await readFreeDiscoveryWalks(repos, SUBJECTS);
      assert.equal(walks.latestFor(AJ), reading, `${label}: a newest walk of ${outcome} reads ${reading}`);
      assert.equal(held(AJ_ROW, walks), decision, `${label}: ${reading} → ${decision}`);
    }
    assert.equal(held("freshness:jurisdiction:az:county:county-of-pima#ballot-and-candidates-1", before), "PAID LANE MAY TAKE IT", "no other work is held by it");
  }
});

test("A FAILED READ HOLDS EVERY ROW: the log that cannot be read answers UNREAD, names why, and hands the Scout nothing", async () => {
  const repos = {
    discoveryAttempts: {
      readLatest: async () => {
        throw new Error("CONTROL_PLANE_REQUEST_TIMEOUT: cp_log_discovery_attempts.readLatest did not settle");
      },
    },
  } as unknown as Pick<ControlPlaneRepositories, "discoveryAttempts">;
  const walks = await readFreeDiscoveryWalks(repos, SUBJECTS);
  for (const s of SUBJECTS) assert.equal(walks.latestFor(s.jurisdictionId), "UNREAD");
  assert.equal(held(AJ_ROW, walks), FREE_WALK_FIRST);
  assert.equal(held(COOLIDGE_ROW, walks), FREE_WALK_FIRST, "a failed read opens nothing this cycle");
  assert.match(walks.source, /could not be read \(CONTROL_PLANE_REQUEST_TIMEOUT.*every dispatched discovery row stays held/);
  assert.equal(walks.evidenceFor?.(AJ), null);
});

test("ONE BATCHED READ, CUT TO THREE FIELDS: only the governments with a site are read, and none at all when none has one", async () => {
  const calls: { keys: readonly string[]; projection: unknown }[] = [];
  const repos = {
    discoveryAttempts: {
      readLatest: async (keys: readonly string[], projection: unknown) => {
        calls.push({ keys, projection });
        return new Map();
      },
    },
  } as unknown as Pick<ControlPlaneRepositories, "discoveryAttempts">;
  const avondale = "az:city:city-of-avondale";
  await readFreeDiscoveryWalks(repos, [...SUBJECTS, { jurisdictionId: avondale, walkable: true }]);
  assert.equal(calls.length, 1, "one read a cycle, never one per government");
  assert.deepEqual(calls[0].keys, [AJ, avondale]);
  assert.deepEqual(calls[0].projection, FREE_WALK_PROJECTION);
  assert.deepEqual(FREE_WALK_PROJECTION, { outcome: true, finishedAt: true, leads: true });
  await readFreeDiscoveryWalks(repos, [{ jurisdictionId: COOLIDGE, walkable: false }]);
  assert.equal(calls.length, 1, "no government with a site, no read");
});

test("A WALK RECORD THE LANE CANNOT READ HOLDS ITS ROW: no known outcome or no finish time is never guessed at, and a lead without an address is dropped", async () => {
  assert.equal(asFreeWalkRecord({ outcome: "SOMETHING_NEW", finishedAt: "2026-09-24T01:00:00.000Z" }), null);
  assert.equal(asFreeWalkRecord({ outcome: "LEAD" }), null);
  assert.equal(asFreeWalkRecord({ outcome: "LEAD", finishedAt: "2026-09-24T01:00:00.000Z", leads: "not a list" }), null);
  assert.equal(asFreeWalkRecord(null), null);
  assert.deepEqual(
    asFreeWalkRecord({ outcome: "LEAD", finishedAt: "2026-09-24T01:00:00.000Z", leads: [{ vendor: "granicus", url: "https://x.example/m" }, { vendor: "no-url" }] }),
    { outcome: "LEAD", finishedAt: "2026-09-24T01:00:00.000Z", leads: [{ vendor: "granicus", url: "https://x.example/m" }] },
  );
  assert.deepEqual(asFreeWalkRecord({ outcome: "BLOCKED", finishedAt: "2026-09-24T01:00:00.000Z" })?.leads, [], "a walk with no leads recorded has none");

  const repos = {
    discoveryAttempts: {
      readLatest: async () => new Map<string, unknown>([[AJ, { outcome: "SOMETHING_NEW", finishedAt: "2026-09-24T01:00:00.000Z" }]]),
    },
  } as unknown as Pick<ControlPlaneRepositories, "discoveryAttempts">;
  const walks = await readFreeDiscoveryWalks(repos, SUBJECTS);
  assert.equal(walks.latestFor(AJ), "UNREAD");
  assert.equal(held(AJ_ROW, walks), FREE_WALK_FIRST, "an unreadable record opens nothing");
  assert.equal(walks.latestFor(COOLIDGE), "NO_SITE_TO_WALK", "the other governments' readings stand");
  assert.match(walks.source, /1 walk record\(s\) could not be read, and their rows stay held/);
});

test("THE SCOUT STARTS FROM THE LEADS: the brief names the walk's outcome and what it could not confirm, as evidence only", () => {
  const leads = Array.from({ length: 8 }, (_, i) => ({
    vendor: i === 0 ? "granicus" : "own-site-meetings-page",
    url: `https://www.ajcity.net/m${i}`,
    basis: "LINKED" as const,
    evidence: "linked from the homepage",
    detail: "no content check exists",
  }));
  const aj = { jurisdictionId: AJ, walkable: true };
  const line = freeWalkBrief(aj, { outcome: "LEAD", finishedAt: "2026-09-24T01:00:00.000Z", leads });
  assert.match(line ?? "", /^FREE WALK 2026-09-24T01:00:00\.000Z: LEAD; leads it could not confirm \(evidence only; confirm by content\): granicus <https:\/\/www\.ajcity\.net\/m0>, /);
  assert.match(line ?? "", /<https:\/\/www\.ajcity\.net\/m5>, and 2 more$/, "six leads are named, the rest counted");
  assert.equal(
    freeWalkBrief(aj, { outcome: "BLOCKED", finishedAt: "2026-09-24T01:00:00.000Z", leads: [] }),
    "FREE WALK 2026-09-24T01:00:00.000Z: BLOCKED; no leads",
  );
  assert.match(freeWalkBrief({ jurisdictionId: COOLIDGE, walkable: false }, undefined) ?? "", /no website is recorded .* finding its own site is the first step/);
  assert.equal(freeWalkBrief(aj, undefined), null, "a government not yet walked has nothing to hand on");
  assert.equal(freeWalkBrief(undefined, undefined), null);
});

test("THE RUNNER IS WIRED: it reads the walk before dispatch, and hands the reading to the hold, the Scout's brief and the walk list", () => {
  const runner = readFileSync(join(ROOT, "scripts/freshness-shadow.mts"), "utf8");
  const read = runner.indexOf("readFreeDiscoveryWalks(repos, freeWalkSubjects)");
  const dispatch = runner.indexOf("const cycle = await runCycle({");
  assert.ok(read > 0 && dispatch > read, "the reading is taken before dispatch");
  assert.match(runner, /paidDiscoveryHold\(row\.obligation\.id, freeWalks\)/, "the hold reads it");
  assert.doesNotMatch(runner, /paidDiscoveryHold\([^)]*UNREAD_FREE_DISCOVERY_WALKS/, "the hold no longer reads the unwired stand-in");
  assert.match(runner, /freeWalks\.evidenceFor\?\.\(discovery\.jurisdictionId\)/, "the Scout's brief carries the walk's line");
  const census = readFileSync(join(ROOT, "scripts/platform-census-runner.mts"), "utf8");
  assert.match(census, /readPlatformCensusNeeds\(state, null, \{ repos, root \}/);
  assert.match(census, /runCensusState\(\{ repos, state, needs: reading.needs/);
  assert.match(runner, /const dispatchedDiscoveryIds = sync\.all\.filter\(row => row\.materializedBy === OWNER_DISPATCH\)/, "free standing inventory is never mistaken for an explicit paid dispatch");
});
