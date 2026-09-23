/**
 * **THE UNPAID MEETINGS-DISCOVERY EXECUTOR ASKS PERMISSION FIRST, EVERY HOST,
 * AND RECORDS EVERY WALK.** (2026-09-23.)
 *
 * `lib/control-plane/discovery/meetings-discovery-executor.ts`, run against a
 * recorded fake transport; no test reaches the network. What these tests hold:
 *
 * - **Permission first.** robots.txt is the first request to every host. A
 *   DISALLOWED or CANNOT_TELL verdict, or a recorded wall, sends nothing more,
 *   and a redirect onto a refusing host is not followed.
 * - **Evidence to find.** A route the homepage links is requested and confirmed
 *   by content; its bytes are vaulted with the walk's own identity; a vendor we
 *   cannot read is a lead and is never requested.
 * - **Bounded.** A walk stops at its request bound. A spent budget defers the
 *   remaining needs untouched. A need not yet due is passed over.
 * - **Recorded.** Every walk is appended to `discoveryAttempts` under its
 *   jurisdiction, found or not, and finds, leads and dead doors go to the field
 *   manual. Dispatched needs are walked first; one another executor holds is
 *   never walked.
 *
 * Every test that writes runs on the in-memory double AND the durable file
 * store.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  RECORDED_WALLS,
  discoveryWorkId,
  rotationWindow,
  runMeetingsDiscovery,
  walkMeetingsDiscoveryNeed,
  type DiscoveryOpen,
  type DiscoveryRuntime,
} from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import type { Artifact } from "../lib/control-plane/evidence/artifact.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { eachStore } from "./control-plane-fixtures.ts";

const NOW = "2026-09-24T01:00:00.000Z";
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Council\r\nDTSTART:20261001T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

function need(jurisdictionId: string, ownWebAddress: string | null, basis: MeetingsDiscoveryNeed["basis"] = "SOURCE_DISCOVERY_OWED"): MeetingsDiscoveryNeed {
  return {
    jurisdictionId, stateCode: "AZ", name: jurisdictionId.toUpperCase(), govClass: "CITY_OR_TOWN", ownWebAddress, basis,
    sources: basis === "SOURCE_DISCOVERY_OWED" ? ["MEETINGS:THIS_JURISDICTION:this-government-itself"] : [],
  };
}

type Reply = { readonly status: number; readonly body?: string; readonly contentType?: string; readonly location?: string } | { readonly transportError: string };

/** A recorded transport: unmapped URLs answer 404, and every request is kept in order. */
function fakeOpen(map: Readonly<Record<string, Reply>>): { open: DiscoveryOpen; seen: string[] } {
  const seen: string[] = [];
  const open: DiscoveryOpen = async ({ url, headers }) => {
    seen.push(url);
    assert.match(headers["user-agent"] ?? "", /we-the-people/, "every request identifies the project");
    const reply = map[url] ?? { status: 404, body: "not found" };
    if ("transportError" in reply) return { status: null, body: "", bytes: 0, contentType: "", location: null, transportError: reply.transportError };
    const body = reply.body ?? "";
    return { status: reply.status, body, bytes: Buffer.byteLength(body), contentType: reply.contentType ?? "text/html", location: reply.location ?? null, transportError: null };
  };
  return { open, seen };
}

function runtime(open: DiscoveryOpen, over: Partial<DiscoveryRuntime> = {}): DiscoveryRuntime & { vaulted: Artifact[] } {
  const vaulted: Artifact[] = [];
  let tick = 0;
  return {
    open,
    spaceOut: async () => {},
    vault: async (artifact) => {
      vaulted.push(artifact);
      return { stored: true, where: `vault/${artifact.id}`, why: "stored" };
    },
    now: () => new Date(Date.parse(NOW) + (tick++) * 1000).toISOString(),
    budget: { spent: () => false },
    vaulted,
    ...over,
  };
}

const ALLOW = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" } as const;
const DENY = { status: 200, body: "User-agent: *\nDisallow: /\n", contentType: "text/plain" } as const;

test("FOUND: robots first, then the homepage, then the route it links; confirmed by content and vaulted under the walk", async () => {
  const { open, seen } = fakeOpen({
    "https://avondale.org/robots.txt": ALLOW,
    "https://avondale.org/": { status: 200, body: `<a href="/calendar/meetings.ics">Meetings</a> <a href="https://x.novusagenda.com/agendapublic">Novus</a>` },
    "https://avondale.org/calendar/meetings.ics": { status: 200, body: ICS, contentType: "text/calendar" },
  });
  const rt = runtime(open);
  const attempt = await walkMeetingsDiscoveryNeed(need("az:city:city-of-avondale", "http://avondale.org"), rt);

  assert.deepEqual(seen, ["https://avondale.org/robots.txt", "https://avondale.org/", "https://avondale.org/calendar/meetings.ics"]);
  assert.equal(attempt.outcome, "FOUND");
  assert.deepEqual(attempt.found.map((f) => [f.vendor, f.url, f.count]), [["ical", "https://avondale.org/calendar/meetings.ics", 1]]);
  assert.deepEqual(attempt.leads.map((l) => l.vendor), ["novusagenda"], "a vendor we cannot read is a lead and is never requested");
  assert.equal(attempt.requestCount, 3);
  assert.ok(Date.parse(attempt.recheckAfter) > Date.parse(attempt.finishedAt));
  assert.equal(rt.vaulted.length, 3, "robots, homepage and the route are all evidence");
  for (const a of rt.vaulted) {
    assert.equal(a.workItemId, discoveryWorkId("az:city:city-of-avondale"));
    assert.equal(a.attemptId, attempt.attemptId);
    assert.equal(a.methodRouteId, "discovery:meetings");
  }
  assert.equal(attempt.found[0].artifactId, rt.vaulted[2].id);
});

test("BLOCKED: a disallowing or unreadable robots.txt sends nothing more, on either origin", async () => {
  const { open, seen } = fakeOpen({
    "https://www.benson.gov/robots.txt": DENY,
    "https://benson.gov/robots.txt": { status: 500, body: "oops" },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:city:city-of-benson", "www.benson.gov"), runtime(open));
  assert.deepEqual(seen, ["https://www.benson.gov/robots.txt", "https://benson.gov/robots.txt"], "only robots.txt was ever requested");
  assert.equal(attempt.outcome, "BLOCKED");
  assert.deepEqual(
    attempt.steps.filter((s) => s.purpose === "homepage").map((s) => [s.url, s.permission, s.status]),
    [["https://www.benson.gov/", "DISALLOWED", null], ["https://benson.gov/", "CANNOT_TELL", null]],
  );
});

test("REDIRECT: each hop asks permission of its host, and a hop onto a refusing host is not followed", async () => {
  const { open, seen } = fakeOpen({
    "https://oldtown.gov/robots.txt": ALLOW,
    "https://oldtown.gov/": { status: 301, location: "https://portal.vendor-cms.com/oldtown/" },
    "https://portal.vendor-cms.com/robots.txt": DENY,
    "https://www.oldtown.gov/robots.txt": DENY,
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:town:oldtown", "oldtown.gov"), runtime(open));
  assert.equal(seen.includes("https://portal.vendor-cms.com/oldtown/"), false, "the refusing host's page was never requested");
  assert.ok(seen.indexOf("https://portal.vendor-cms.com/robots.txt") > seen.indexOf("https://oldtown.gov/"), "permission was asked on arrival at the new host");
  assert.equal(attempt.outcome, "BLOCKED", "a homepage that redirects onto a refusing host is a wall");
});

test("WALL: a recorded wall is never requested, not even its robots.txt", async () => {
  assert.ok(RECORDED_WALLS.some((w) => w.host === "go.boarddocs.com"));
  const { open, seen } = fakeOpen({ "https://boarddocs.com/robots.txt": DENY });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:district:walled", "go.boarddocs.com"), runtime(open));
  assert.equal(seen.some((u) => u.startsWith("https://go.boarddocs.com/")), false);
  assert.equal(attempt.steps.find((s) => s.url === "https://go.boarddocs.com/")?.permission, "RECORDED_WALL");
});

test("NOT A ROUTE: a linked feed that answers an HTML shell is a lead, never a find; an unreachable site is COULD_NOT_READ", async () => {
  const shell = fakeOpen({
    "https://shell.gov/robots.txt": { status: 404, body: "" },
    "https://shell.gov/": { status: 200, body: `<a href="/Services/iCalendar.aspx">iCal</a>` },
    "https://shell.gov/Services/iCalendar.aspx": { status: 200, body: "<!DOCTYPE html><html>calendar portal</html>" },
  });
  const lead = await walkMeetingsDiscoveryNeed(need("az:town:shell", "shell.gov"), runtime(shell.open));
  assert.equal(lead.outcome, "LEAD");
  assert.match(lead.leads[0].detail, /not a calendar/);

  const down = fakeOpen({ "https://down.gov/robots.txt": { status: 404 }, "https://down.gov/": { transportError: "ETIMEDOUT" } });
  const unreadable = await walkMeetingsDiscoveryNeed(need("az:town:down", "down.gov"), runtime(down.open));
  assert.equal(unreadable.outcome, "COULD_NOT_READ");
});

test("BOUNDED: a walk stops at its request bound and says so", async () => {
  const { open, seen } = fakeOpen({
    "https://busy.gov/robots.txt": ALLOW,
    "https://busy.gov/": { status: 200, body: `<a href="/a.ics">a</a><a href="/b.ics">b</a><a href="/c.ics">c</a>` },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:town:busy", "busy.gov"), runtime(open, { maxRequestsPerWalk: 3 }));
  assert.equal(seen.length, 3);
  assert.equal(attempt.requestCount, 3);
  assert.ok(attempt.steps.some((s) => /request bound/.test(s.note)));
});

test("ROTATION: every need comes round in turn from the cycle's hour, with no stored cursor", () => {
  const needs = ["e", "a", "d", "c", "b"].map((id) => ({ jurisdictionId: id }));
  assert.deepEqual(rotationWindow(needs, 0, 1).map((n) => n.jurisdictionId), ["a", "b", "c"]);
  assert.deepEqual(rotationWindow(needs, 1, 1).map((n) => n.jurisdictionId), ["b", "c", "d"]);
  assert.deepEqual(rotationWindow(needs, 4, 1).map((n) => n.jurisdictionId), ["e", "a", "b"], "the window wraps");
  assert.deepEqual(rotationWindow(needs, 3, 5).map((n) => n.jurisdictionId), ["a", "b", "c", "d", "e"], "never longer than the list");
  assert.deepEqual(rotationWindow([], 7, 3), []);
});

test("PASS: every walk is appended under its jurisdiction; a need not yet due is passed over; a spent budget defers the rest untouched", async () => {
  for (const [label, repos] of await eachStore("wtp-discovery-")) {
    const { open, seen } = fakeOpen({
      "https://found.gov/robots.txt": ALLOW,
      "https://found.gov/": { status: 200, body: `<a href="/m.ics">m</a>` },
      "https://found.gov/m.ics": { status: 200, body: ICS },
      "https://blocked.gov/robots.txt": DENY,
      "https://www.blocked.gov/robots.txt": DENY,
    });
    const needs = [
      need("az:a:found", "found.gov"),
      need("az:b:blocked", "blocked.gov"),
      need("az:c:not-due", "notdue.gov"),
      need("az:d:no-site", null, "NO_MEETINGS_SOURCE_RECORDED"),
    ];
    const earlier = await walkMeetingsDiscoveryNeed(need("az:c:not-due", "notdue.gov"), runtime(fakeOpen({}).open, {
      now: () => "2026-09-23T00:00:00.000Z",
    }));
    await repos.discoveryAttempts.append("az:c:not-due", earlier.attemptId, { ...earlier, recheckAfter: "2026-10-01T00:00:00.000Z" }, earlier.finishedAt);

    const pass = await runMeetingsDiscovery(repos, { needs, runtime: runtime(open), cycleIndex: 0, maxWalks: 5 });
    assert.deepEqual(pass.walked.map((a) => [a.jurisdictionId, a.outcome]), [["az:a:found", "FOUND"], ["az:b:blocked", "BLOCKED"]], label);
    assert.deepEqual(pass.notDue, ["az:c:not-due"], `${label}: a need not yet due is passed over`);
    assert.equal(seen.some((u) => u.includes("notdue.gov")), false);
    assert.deepEqual(pass.appendFailures, []);

    const recorded = await repos.discoveryAttempts.readRecent("az:a:found", 5);
    assert.deepEqual(recorded.map((a) => a.outcome), ["FOUND"], `${label}: the walk is recorded under its jurisdiction`);
    assert.equal((await repos.discoveryAttempts.readRecent("az:b:blocked", 5))[0]?.outcome, "BLOCKED", `${label}: a blocked walk is recorded too`);
    assert.deepEqual(await repos.discoveryAttempts.readRecent("az:d:no-site", 5), [], `${label}: a need with no site is not walked`);

    const manual = (await repos.fieldManual.read("live"))?.value.entries ?? [];
    assert.deepEqual(manual.map((e) => [e.kind, e.outcome]).sort(), [["DEAD_DOOR", "BLOCKED"], ["MEETINGS_ROUTE", "YIELDED"]], `${label}: a route and a dead door are learned`);
    assert.equal(pass.fieldManual.written, 2);

    let asked = 0;
    const deferred = await runMeetingsDiscovery(repos, {
      needs: [need("az:e:one", "one.gov"), need("az:f:two", "two.gov")],
      runtime: runtime(fakeOpen({}).open, { budget: { spent: () => asked++ >= 1 } }),
      cycleIndex: 0,
      maxWalks: 5,
    });
    assert.deepEqual(deferred.walked.map((a) => a.jurisdictionId), ["az:e:one"], label);
    assert.deepEqual(deferred.deferred, ["az:f:two"], `${label}: the rest is deferred untouched`);
    assert.deepEqual(await repos.discoveryAttempts.readRecent("az:f:two", 5), []);
  }
});

test("DISPATCH: an owner-dispatched need is walked first, and one another executor holds is never walked by this one", async () => {
  for (const [label, repos] of await eachStore("wtp-discovery-")) {
    const { open } = fakeOpen({});
    const needs = [need("az:a:first-in-rotation", "a.gov"), need("az:m:dispatched", "m.gov"), need("az:z:held", "z.gov")];
    const pass = await runMeetingsDiscovery(repos, {
      needs,
      runtime: runtime(open),
      cycleIndex: 0,
      maxWalks: 3,
      firstIds: new Set(["az:m:dispatched", "az:z:held"]),
      skipIds: new Set(["az:z:held"]),
    });
    assert.deepEqual(
      pass.walked.map((a) => a.jurisdictionId),
      ["az:m:dispatched", "az:a:first-in-rotation"],
      `${label}: dispatch order beats the rotation, and the held need is skipped even though it was dispatched`,
    );
    assert.deepEqual(await repos.discoveryAttempts.readRecent("az:z:held", 5), [], `${label}: a held need is never walked twice`);
  }
});
