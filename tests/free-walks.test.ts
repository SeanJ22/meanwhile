import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createPlannerSpool } from "../lib/control-plane/scheduler/planner-spool.ts";

import {
  FREE_WALK_PROJECTION,
  asFreeWalkRecord,
  freeWalkBrief,
  readFreeDiscoveryWalks,
  type FreeWalkSubject,
} from "../lib/control-plane/discovery/free-walks.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { DiscoveryOutcome, MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";
import { eachStore } from "./control-plane-fixtures.ts";

const ROOT = process.cwd();
const AJ = "az:city:city-of-apache-junction";
const COOLIDGE = "az:city:city-of-coolidge";
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

test("EVERY WALK HAS A READING: not walked, no site, unread, found or walked-not-found; the newest walk decides", async () => {
  for (const [label, repos] of await eachStore("wtp-free-walks-")) {
    const before = await readFreeDiscoveryWalks(repos, SUBJECTS);
    assert.equal(before.latestFor(AJ), "NOT_WALKED", `${label}: no walk recorded yet`);
    assert.equal(before.latestFor(COOLIDGE), "NO_SITE_TO_WALK");
    assert.equal(before.latestFor("az:city:underivable"), "UNREAD");
    assert.equal(before.latestFor("az:city:not-dispatched"), "UNREAD", `${label}: a government nobody asked about is held, not guessed`);

    const readings: [DiscoveryOutcome, string][] = [
      ["FOUND", "FOUND"],
      ["LEAD", "WALKED_NOT_FOUND"],
      ["NOTHING_DETECTED", "WALKED_NOT_FOUND"],
      ["BLOCKED", "WALKED_NOT_FOUND"],
      ["COULD_NOT_READ", "WALKED_NOT_FOUND"],
      ["FOUND", "FOUND"],
    ];
    for (const [i, [outcome, reading]] of readings.entries()) {
      const at = `2026-09-2${i}T00:00:00.000Z`;
      await repos.discoveryAttempts.append(AJ, `da-${i}`, attempt(outcome, at), at);
      const walks = await readFreeDiscoveryWalks(repos, SUBJECTS);
      assert.equal(walks.latestFor(AJ), reading, `${label}: a newest walk of ${outcome} reads ${reading}`);
    }
  }
});

test("A FAILED READ ANSWERS UNREAD: the log that cannot be read names why and hands on no evidence", async () => {
  const repos = {
    discoveryAttempts: {
      readLatest: async () => {
        throw new Error("CONTROL_PLANE_REQUEST_TIMEOUT: cp_log_discovery_attempts.readLatest did not settle");
      },
    },
  } as unknown as Pick<ControlPlaneRepositories, "discoveryAttempts">;
  const walks = await readFreeDiscoveryWalks(repos, SUBJECTS);
  for (const s of SUBJECTS) assert.equal(walks.latestFor(s.jurisdictionId), "UNREAD");
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

test("A WALK RECORD THE LANE CANNOT READ READS UNREAD: no known outcome or no finish time is never guessed at, and a lead without an address is dropped", async () => {
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
  assert.equal(walks.latestFor(COOLIDGE), "NO_SITE_TO_WALK", "the other governments' readings stand");
  assert.match(walks.source, /1 walk record\(s\) could not be read, and their rows stay held/);
});

test("THE BRIEF STARTS FROM THE LEADS: the brief names the walk's outcome and what it could not confirm, as evidence only", () => {
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

test("THE RUNNER IS WIRED: it reads the walk before dispatch", () => {
  const runner = readFileSync(join(ROOT, "scripts/freshness-shadow.mts"), "utf8");
  const read = runner.indexOf("readFreeDiscoveryWalks(repos, freeWalkSubjects, planner)");
  const dispatch = runner.indexOf("const cycle = await runCycle({");
  assert.ok(read > 0 && dispatch > read, "the reading is taken before dispatch");
  assert.match(runner.slice(0, read), /const freeWalkSubjects = freeWalkSubjectRows\.rows;/, "the runner passes the repeatable disk-backed subjects");
  const census = readFileSync(join(ROOT, "scripts/platform-census-runner.mts"), "utf8");
  assert.match(census, /readPlatformCensusNeeds\(state, null, \{ repos, root \}/);
  assert.match(census, /runCensusState\(\{ repos, state, needs: reading.needs/);
  assert.match(runner, /const dispatchedDiscoveryIds = sync\.all\.filter\(row => row\.materializedBy === OWNER_DISPATCH\)/, "free standing inventory is never mistaken for an explicit paid dispatch");
});

test("disk-backed free walks read every dispatched government in bounded projected batches", async () => {
  const planner = await createPlannerSpool();
  try {
    const subjects = planner.table<FreeWalkSubject>("fixture-dispatched-walks", row => row.jurisdictionId), keys: string[] = [];
    for (let index = 0; index < 65; index++) {
      const jurisdictionId = `oh:city:fixture-${index}`; keys.push(jurisdictionId); subjects.add({ jurisdictionId, walkable: true });
    }
    subjects.add({ jurisdictionId: "oh:city:no-site", walkable: false });
    subjects.add({ jurisdictionId: "oh:city:unread", walkable: null });
    const calls: string[][] = [];
    const repos = { discoveryAttempts: { readLatest: async (batch: readonly string[], projection: unknown) => {
      assert.deepEqual(projection, FREE_WALK_PROJECTION); calls.push([...batch]);
      return new Map(batch.map(id => [id, { outcome: "FOUND", finishedAt: "2026-09-24T01:00:00.000Z", leads: [] }]));
    } } } as unknown as Pick<ControlPlaneRepositories, "discoveryAttempts">;
    const walks = await readFreeDiscoveryWalks(repos, subjects.rows, planner);
    assert.deepEqual(calls.map(batch => batch.length), [32, 32, 1]);
    assert.deepEqual(calls.flat(), keys, "all dispatched governments are read once without a backlog cap");
    for (const key of keys) assert.equal(walks.latestFor(key), "FOUND");
    assert.equal(walks.latestFor("oh:city:no-site"), "NO_SITE_TO_WALK");
    assert.equal(walks.latestFor("oh:city:unread"), "UNREAD");
  } finally { await planner.close(); }
});
