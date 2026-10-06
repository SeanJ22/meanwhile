/**
 * **THE PAID LANE READS WHAT THE FREE WALK FOUND.** (2026-09-24. MW-028's
 * free-walk-first hold.)
 *
 * `lib/control-plane/discovery/free-walks.ts`, its use by `paidDiscoveryHold`,
 * and the dispatched needs the free walk goes first on. What these tests hold:
 *
 * - **Every reading reaches its hold decision.**
 *   - FOUND keeps a dispatched row held to avoid duplicate acquisition.
 *   - NOT_WALKED permits an appropriate paid route without exhausting free routes.
 *   - WALKED_NOT_FOUND lets the paid lane take it. That covers a site that
 *     showed nothing or only leads, a wall, and an unreadable site.
 *   - NO_SITE_TO_WALK lets the paid lane take it too.
 *   - UNREAD holds it, so a failed read never opens the paid lane. So does a
 *     walk record the lane cannot read.
 *   - The newest walk decides, on the in-memory double and the durable file
 *     store.
 * - **One batched read.** The dispatched governments with a site are read in
 *   one `readLatest` call, cut to three fields. A government with no site is not
 *   read at all.
 * - **The Scout starts from the leads.** The brief names the walk's outcome and
 *   the leads it could not confirm.
 * - **Dispatched needs reach the free walk.**
 *   - They are derived from each state's registry, even for a government the
 *     committed ledger does not hold.
 *   - A state whose registry cannot be read is named.
 *   - A need whose basis moved is left out.
 * - **The runner is wired.** It reads the walk before dispatch, only while the
 *   paid lane can admit, and hands the reading to the hold and the Scout's
 *   brief.
 */

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
import {
  discoveryNeedsToWalk,
  runMeetingsDiscovery,
  walkableByFreeWalk,
  type DiscoveryRuntime,
} from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import {
  FREE_WALK_FIRST,
  MEETINGS_DISCOVERY_NAMESPACE,
  materializedDiscoveryNeeds,
  paidDiscoveryHold,
} from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
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

test("DISPATCHED NEEDS REACH THE FREE WALK: derived from each state's registry, a state it cannot read named, a moved basis left out, and walked first even outside the ledger", async () => {
  const az = JSON.parse(readFileSync(join(ROOT, "data/states/az/jurisdictions/az.json"), "utf8")) as JurisdictionRegistry;
  const registryFor = (state: string): JurisdictionRegistry => {
    if (state === "az") return az;
    throw new Error(`no promoted ${state.toUpperCase()} registry`);
  };
  const { entries, failures } = materializedDiscoveryNeeds(
    [
      COOLIDGE_ROW,
      AJ_ROW,
      `${MEETINGS_DISCOVERY_NAMESPACE}${COOLIDGE}#own-site-meetings`,
      `${MEETINGS_DISCOVERY_NAMESPACE}nh:city:city-of-berlin#own-site-meetings`,
      "freshness:jurisdiction:az:county:county-of-pima#ballot-and-candidates-1",
    ],
    registryFor,
  );
  assert.deepEqual(entries.map((e) => e.need.jurisdictionId), [AJ, COOLIDGE], "a moved basis and another namespace are left out");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /the NH jurisdiction registry could not be read .*no promoted NH registry/);
  const [aj, coolidge] = entries.map((e) => e.need);
  assert.equal(walkableByFreeWalk(aj), true);
  assert.equal(walkableByFreeWalk(coolidge), false, "no site is recorded");

  /* A mission map's blanks (CH-21) hold an older copy of Apache Junction and nothing of a newly promoted town. */
  const newTown: MeetingsDiscoveryNeed = { ...aj, jurisdictionId: "az:city:town-of-newly-promoted", name: "TOWN OF NEWLY PROMOTED", ownWebAddress: "https://newly.example.gov" };
  const mission: MeetingsDiscoveryNeed[] = [{ ...aj, ownWebAddress: "http://old.example.net" }, { ...aj, jurisdictionId: "az:city:city-of-avondale", name: "CITY OF AVONDALE" }];
  const toWalk = discoveryNeedsToWalk(mission, [aj, newTown]);
  assert.deepEqual(toWalk.map((n) => n.jurisdictionId), [AJ, "az:city:town-of-newly-promoted", "az:city:city-of-avondale"]);
  assert.equal(toWalk.find((n) => n.jurisdictionId === AJ)?.ownWebAddress, "http://www.ajcity.net", "the dispatched copy wins over the mission's");
  assert.deepEqual(discoveryNeedsToWalk(mission, [aj, newTown], need => need.jurisdictionId === AJ), [aj],
    "a narrow discovery pass keeps the current selected need and excludes every other government's work");

  for (const [label, repos] of await eachStore("wtp-free-walks-first-")) {
    const opened: string[] = [];
    const runtime: DiscoveryRuntime = {
      open: async ({ url }) => {
        opened.push(url);
        return { status: 404, body: "", bytes: 0, contentType: "text/html", location: null, transportError: null };
      },
      spaceOut: async () => {},
      vault: async () => ({ stored: true, where: "vault", why: "stored" }),
      now: () => "2026-09-24T02:00:00.000Z",
      budget: { spent: () => false },
      recipes: [],
    };
    const pass = await runMeetingsDiscovery(repos, { needs: toWalk, runtime, cycleIndex: 0, maxWalks: 1, firstIds: new Set(["az:city:town-of-newly-promoted"]) });
    assert.deepEqual(pass.walked.map((a) => a.jurisdictionId), ["az:city:town-of-newly-promoted"], `${label}: a dispatched government outside the mission is walked first`);
    assert.ok(opened.length > 0, `${label}: the walk opened its site`);
    assert.ok(
      opened.every((u) => ["newly.example.gov", "www.newly.example.gov"].includes(new URL(u).host)),
      `${label}: at the address its registry records (its own origin and its www twin), never the mission's older copy: ${opened.join(", ")}`,
    );
  }
});

test("THE RUNNER IS WIRED: it reads the walk before dispatch while the paid lane can admit, and hands the reading to the hold, the Scout's brief and the walk list", () => {
  const runner = readFileSync(join(ROOT, "scripts/freshness-shadow.mts"), "utf8");
  const read = runner.indexOf("readFreeDiscoveryWalks(repos, freeWalkSubjects)");
  const dispatch = runner.indexOf("const cycle = await runCycle({");
  assert.ok(read > 0 && dispatch > read, "the reading is taken before dispatch");
  assert.match(runner, /if \(modelLaneEnabled && freeWalkSubjects\.length > 0\) \{\n\s+freeWalks = await pending\.step\("free-walks:read"/, "and only while the paid lane can admit");
  assert.match(runner, /paidDiscoveryHold\(row\.obligation\.id, freeWalks\)/, "the hold reads it");
  assert.doesNotMatch(runner, /paidDiscoveryHold\([^)]*UNREAD_FREE_DISCOVERY_WALKS/, "the hold no longer reads the unwired stand-in");
  assert.match(runner, /freeWalks\.evidenceFor\?\.\(discovery\.jurisdictionId\)/, "the Scout's brief carries the walk's line");
  assert.match(runner, /const discoveryToWalk = discoveryNeedsToWalk\(\[\.\.\.missionDiscoveryNeeds\.values\(\)\], \[\.\.\.dispatchedNeeds\.values\(\)\], need =>/, "the walk list carries the dispatched needs, then the mission's blanks, with exact selection");
  assert.match(runner, /needs: discoveryToWalk,/, "and the walk takes that list");
});
