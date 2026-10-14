import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_MAX_REQUESTS_PER_WALK,
  DiscoveryTimeSpent,
  RECORDED_WALLS,
  discoveryFieldManualEntries,
  discoveryWorkId,

  walkMeetingsDiscoveryNeed,
  type DiscoveryOpen,
  type DiscoveryRuntime,
} from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import type { Artifact } from "../lib/control-plane/evidence/artifact.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { ROUTE_HINTS, namesItself, routeHintProblems, routeHintsFingerprint, type JurisdictionRouteHints } from "../lib/hunt/meetings-route-hints.ts";

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

  assert.deepEqual(seen, ["https://avondale.org/robots.txt", "https://avondale.org/", ...["agendas", "meetings", "calendar", "sitemap.xml"].map(path => `https://avondale.org/${path}`), "https://avondale.org/calendar/meetings.ics",
    "https://x.novusagenda.com/robots.txt", "https://x.novusagenda.com/AgendaPublic/MeetingsResponsive.aspx"]);
  assert.equal(attempt.outcome, "FOUND");
  assert.deepEqual(attempt.found.map((f) => [f.vendor, f.url, f.count]), [["ical", "https://avondale.org/calendar/meetings.ics", 1]]);
  assert.deepEqual(attempt.leads.map((l) => l.vendor), ["novusagenda"], "an unconfirmed public list remains a lead");
  assert.equal(attempt.requestCount, 9);
  assert.ok(Date.parse(attempt.recheckAfter) > Date.parse(attempt.finishedAt));
  assert.equal(rt.vaulted.length, 9, "every source response is saved as evidence");
  for (const a of rt.vaulted) {
    assert.equal(a.workItemId, discoveryWorkId("az:city:city-of-avondale"));
    assert.equal(a.attemptId, attempt.attemptId);
    assert.equal(a.methodRouteId, "discovery:meetings");
  }
  assert.equal(attempt.found[0].artifactId, rt.vaulted.find(artifact => artifact.canonicalUrl === "https://avondale.org/calendar/meetings.ics")!.id);
  assert.deepEqual(attempt.found[0].via, { page: "https://avondale.org/", artifactId: rt.vaulted[1].id }, "the find names the page that linked it");
  assert.deepEqual(attempt.site, {
    address: null,
    homepage: { url: "https://avondale.org/", artifactId: rt.vaulted[1].id, basis: "RECORDED_ADDRESS", hintFingerprint: null, startedAt: "https://avondale.org/", redirects: [] },
  });
});

test("ROBOTS RECORDED, NOT BLOCKING: a disallowing or unreadable robots.txt is recorded on the step and the public homepage is still read, on either origin (owner decision 2026-09-25)", async () => {
  const { open, seen } = fakeOpen({
    "https://www.benson.gov/robots.txt": DENY,
    "https://benson.gov/robots.txt": { status: 500, body: "oops" },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:city:city-of-benson", "www.benson.gov"), runtime(open));
  assert.deepEqual(
    seen,
    ["https://www.benson.gov/robots.txt", "https://www.benson.gov/", "https://benson.gov/robots.txt", "https://benson.gov/"],
    "each origin's robots.txt first, then its homepage",
  );
  assert.deepEqual(
    attempt.steps.filter((s) => s.purpose === "homepage").map((s) => [s.url, s.permission, s.status]),
    [["https://www.benson.gov/", "DISALLOWED", 404], ["https://benson.gov/", "CANNOT_TELL", 404]],
    "the verdict travels on the step that was requested",
  );
  assert.equal(attempt.outcome, "COULD_NOT_READ", "neither homepage answered; nothing refused us");

  const read = fakeOpen({
    "https://bisbee.gov/robots.txt": DENY,
    "https://bisbee.gov/": { status: 200, body: `<a href="/m.ics">Meetings</a>` },
    "https://bisbee.gov/m.ics": { status: 200, body: ICS, contentType: "text/calendar" },
  });
  const found = await walkMeetingsDiscoveryNeed(need("az:city:city-of-bisbee", "bisbee.gov"), runtime(read.open));
  assert.equal(found.outcome, "FOUND", "a route behind a Disallow: / is found and confirmed by content");
  assert.deepEqual(found.found.map((f) => f.url), ["https://bisbee.gov/m.ics"]);
  assert.ok(found.steps.filter((s) => s.purpose !== "robots").every((s) => s.permission === "DISALLOWED"), "and every request carries the recorded verdict");
});

test("WALL OR NOT: only an access control — a recorded wall, or the site's own 401/403/429 — makes a walk BLOCKED and teaches a dead door; robots.txt never does", async () => {
  const cases: [string, Readonly<Record<string, Reply>>, string][] = [
    ["az:t:walled", {
      "https://walled.gov/robots.txt": { status: 403, body: "Forbidden" },
      "https://walled.gov/": { status: 403, body: "Forbidden" },
      "https://www.walled.gov/robots.txt": { status: 401, body: "Auth" },
      "https://www.walled.gov/": { status: 401, body: "Auth" },
    }, "BLOCKED"],
    ["az:t:closed", {
      "https://closed.gov/robots.txt": DENY,
      "https://closed.gov/": { status: 200, body: "<html>Closed, AZ</html>" },
      "https://www.closed.gov/robots.txt": DENY,
    }, "NOTHING_DETECTED"],
    ["az:t:limited", { "https://limited.gov/robots.txt": { status: 429, body: "Too many" }, "https://www.limited.gov/robots.txt": { status: 429, body: "Too many" } }, "COULD_NOT_READ"],
    ["az:t:gone", { "https://gone.gov/robots.txt": { transportError: "getaddrinfo ENOTFOUND gone.gov" }, "https://www.gone.gov/robots.txt": { transportError: "getaddrinfo ENOTFOUND www.gone.gov" } }, "COULD_NOT_READ"],
    ["az:t:erroring", { "https://erroring.gov/robots.txt": { status: 503, body: "down" }, "https://www.erroring.gov/robots.txt": { status: 502, body: "bad gateway" } }, "COULD_NOT_READ"],
    ["az:t:shell", { "https://shellrobots.gov/robots.txt": { status: 200, body: "<!DOCTYPE html><html>home</html>" }, "https://www.shellrobots.gov/robots.txt": { transportError: "ECONNRESET" } }, "COULD_NOT_READ"],
    ["az:t:waf", {
      "https://waf.gov/robots.txt": ALLOW,
      "https://waf.gov/": { status: 403, body: "Access denied" },
      "https://www.waf.gov/robots.txt": { status: 301, location: "https://waf.gov/" },
      "https://www.waf.gov/": { status: 301, location: "https://waf.gov/" },
    }, "BLOCKED"],
    ["az:t:missing", {
      "https://missing.gov/robots.txt": { status: 404 },
      "https://missing.gov/": { status: 404, body: "not here" },
      "https://www.missing.gov/robots.txt": { transportError: "ETIMEDOUT" },
    }, "COULD_NOT_READ"],
  ];
  for (const [id, map, expected] of cases) {
    const host = Object.keys(map)[0].replace(/^https:\/\//, "").replace(/\/robots\.txt$/, "");
    const { open, seen } = fakeOpen(map);
    const attempt = await walkMeetingsDiscoveryNeed(need(id, host), runtime(open));
    assert.equal(attempt.outcome, expected, `${id}: ${attempt.steps.filter((s) => s.purpose === "robots").map((s) => s.note).join(" | ")}`);
    if (Object.keys(map).every((u) => u.endsWith("/robots.txt")) && id !== "az:t:limited") {
      assert.ok(seen.some((u) => !u.endsWith("/robots.txt")), `${id}: an unread robots.txt does not stop the homepage request`);
    }
    if (id === "az:t:limited") assert.equal(seen.every((u) => u.endsWith("/robots.txt")), true, `${id}: a 429 is honoured; nothing more is asked of the host`);
    if (id === "az:t:closed") assert.ok(seen.includes("https://closed.gov/"), `${id}: a Disallow: / is recorded, and the homepage is read`);
    const deadDoors = discoveryFieldManualEntries(attempt).filter((e) => e.kind === "DEAD_DOOR");
    assert.equal(deadDoors.length, expected === "BLOCKED" ? 1 : 0, `${id}: a dead door is taught only for a wall`);
    if (id === "az:t:waf") assert.match(deadDoors[0].summary, /walled this client by an access control \(.*HTTP 403.*\)/, "the dead door names what walled it: the homepage's own 403");
  }
});

test("ROBOTS REDIRECTS: robots.txt is followed through its redirects (RFC 9309), at most five, never to a private address; the rules found govern the host asked about", async () => {
  const followed = fakeOpen({
    "https://red.gov/robots.txt": { status: 301, location: "https://www.red.gov/robots.txt" },
    "https://www.red.gov/robots.txt": ALLOW,
    "https://red.gov/": { status: 200, body: `<a href="/m.ics">Meetings</a>` },
    "https://red.gov/m.ics": { status: 200, body: ICS, contentType: "text/calendar" },
  });
  const found = await walkMeetingsDiscoveryNeed(need("az:t:red", "red.gov"), runtime(followed.open));
  assert.deepEqual(followed.seen, ["https://red.gov/robots.txt", "https://www.red.gov/robots.txt", "https://red.gov/", ...["agendas", "meetings", "calendar", "sitemap.xml"].map(path => `https://red.gov/${path}`), "https://red.gov/m.ics"]);
  assert.equal(found.outcome, "FOUND");
  const robotsStep = found.steps.find((s) => s.purpose === "robots")!;
  assert.deepEqual([robotsStep.url, robotsStep.permission, robotsStep.status], ["https://red.gov/robots.txt", "ALLOWED", 200]);
  assert.match(robotsStep.note, /followed 1 redirect\(s\): https:\/\/www\.red\.gov\/robots\.txt/);

  /* Six redirects in a row: five are followed, the sixth is not, and nothing is concluded about a wall. */
  const loopMap: Record<string, Reply> = { "https://www.loop.gov/robots.txt": { transportError: "ECONNRESET" } };
  loopMap["https://loop.gov/robots.txt"] = { status: 302, location: "https://loop.gov/r1.txt" };
  for (let i = 1; i <= 5; i += 1) loopMap[`https://loop.gov/r${i}.txt`] = { status: 302, location: `https://loop.gov/r${i + 1}.txt` };
  const loop = fakeOpen(loopMap);
  const looped = await walkMeetingsDiscoveryNeed(need("az:t:loop", "loop.gov"), runtime(loop.open));
  assert.deepEqual(
    loop.seen.filter((u) => u.startsWith("https://loop.gov/")),
    ["https://loop.gov/robots.txt", ...[1, 2, 3, 4, 5].map((i) => `https://loop.gov/r${i}.txt`), "https://loop.gov/"],
    "five redirects are followed, the chain is recorded CANNOT_TELL, and the homepage is still asked for",
  );
  assert.equal(looped.steps.find((s) => s.url === "https://loop.gov/")?.permission, "CANNOT_TELL");
  assert.equal(looped.outcome, "COULD_NOT_READ");

  /* A redirect to a private address is never followed. */
  const priv = fakeOpen({
    "https://priv.gov/robots.txt": { status: 302, location: "http://127.0.0.1/robots.txt" },
    "https://www.priv.gov/robots.txt": { status: 302, location: "http://localhost/robots.txt" },
  });
  const refused = await walkMeetingsDiscoveryNeed(need("az:t:priv", "priv.gov"), runtime(priv.open));
  assert.deepEqual(
    priv.seen,
    ["https://priv.gov/robots.txt", "https://priv.gov/", "https://www.priv.gov/robots.txt", "https://www.priv.gov/"],
    "the private hop is never taken; the unread rules are recorded and the public homepage is still asked for",
  );
  assert.equal(refused.outcome, "COULD_NOT_READ");
});

test("REDIRECT: each hop records robots.txt and stops when the destination refuses the identified client", async () => {
  const { open, seen } = fakeOpen({
    "https://oldtown.gov/robots.txt": ALLOW,
    "https://oldtown.gov/": { status: 301, location: "https://portal.vendor-cms.com/oldtown/" },
    "https://portal.vendor-cms.com/robots.txt": DENY,
    "https://portal.vendor-cms.com/oldtown/": { status: 200, body: "<html>Oldtown council</html>" },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:town:oldtown", "oldtown.gov"), runtime(open));
  assert.ok(seen.indexOf("https://portal.vendor-cms.com/robots.txt") > seen.indexOf("https://oldtown.gov/"), "robots.txt was read on arrival at the new host");
  assert.ok(seen.indexOf("https://portal.vendor-cms.com/oldtown/") > seen.indexOf("https://portal.vendor-cms.com/robots.txt"), "and the page after it");
  assert.equal(attempt.steps.find((s) => s.url === "https://portal.vendor-cms.com/oldtown/")?.permission, "DISALLOWED", "the verdict is recorded on the step");
  assert.equal(attempt.outcome, "NOTHING_DETECTED", "a homepage read over a Disallow is a read, not a wall");

  const walled = fakeOpen({
    "https://newtown.gov/robots.txt": ALLOW,
    "https://newtown.gov/": { status: 302, location: "https://go.boarddocs.com/az/newtown/Board.nsf/Public" },
    "https://www.newtown.gov/robots.txt": ALLOW,
    "https://go.boarddocs.com/robots.txt": DENY,
    "https://go.boarddocs.com/az/newtown/Board.nsf/Public": { status: 403, body: "refused" },
  });
  const blocked = await walkMeetingsDiscoveryNeed(need("az:town:newtown", "newtown.gov"), runtime(walled.open));
  assert.ok(walled.seen.includes("https://go.boarddocs.com/robots.txt"));
  assert.equal(blocked.steps.find((s) => s.url.endsWith("/Board.nsf/Public"))?.status, 403);
});

test("A CHALLENGE AT 200 IS A WALL: the walk records the access control on the step, vaults the page as its evidence, never reads it as the homepage, and teaches a dead door", async () => {
  const challenge = "<html><head><title>Just a moment...</title></head><body>Checking</body></html>";
  const { open, seen } = fakeOpen({
    "https://cftown.gov/robots.txt": ALLOW,
    "https://cftown.gov/": { status: 200, body: challenge },
    "https://www.cftown.gov/robots.txt": ALLOW,
    "https://www.cftown.gov/": { status: 200, body: challenge },
  });
  const rt = runtime(open);
  const attempt = await walkMeetingsDiscoveryNeed(need("az:town:cftown", "cftown.gov"), rt);
  assert.equal(attempt.outcome, "BLOCKED");
  const home = attempt.steps.filter((s) => s.purpose === "homepage");
  assert.ok(home.length > 0 && home.every((s) => /challenge/.test(s.accessControl ?? "")), JSON.stringify(home));
  assert.ok(home.every((s) => s.artifactId !== null), "the challenge page is vaulted as the wall's evidence");
  assert.equal(seen.filter((u) => u === "https://cftown.gov/").length, 1, "asked once, never re-sent");
  const doors = discoveryFieldManualEntries(attempt).filter((e) => e.kind === "DEAD_DOOR");
  assert.equal(doors.length, 1);
  assert.match(doors[0].summary, /a bot challenge/);
});

test("A TOKEN REDIRECT AT 200 IS A WALL: Sierra Vista Unified's homepage (2026-09-26) is recorded BLOCKED by an access control, never 'read and shows no route'", async () => {
  /* The real page's shape (490 bytes, "Loading...", a script sending the browser back with a signed token), made-up token. */
  const redirect =
    "<html><head><title>Loading...</title></head><body><script type='text/javascript'>" +
    "window.location.replace('https://district.example/?ch=1&js=fixture-header.fixture-claims.fixture-signature&sid=fixture-session');" +
    "</script></body></html>";
  const { open, seen } = fakeOpen({
    "https://district.example/robots.txt": DENY,
    "https://district.example/": { status: 200, body: redirect },
    "https://www.district.example/robots.txt": DENY,
    "https://www.district.example/": { status: 200, body: redirect },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:school:token-district", "district.example"), runtime(open));
  assert.equal(attempt.outcome, "BLOCKED", attempt.note);
  const home = attempt.steps.filter((s) => s.purpose === "homepage");
  assert.ok(home.length > 0 && home.every((s) => /JavaScript token redirect/.test(s.accessControl ?? "")), JSON.stringify(home));
  assert.equal(seen.some((u) => u.includes("js=")), false, "the tokened URL is never requested: that would be passing the challenge");
  const doors = discoveryFieldManualEntries(attempt).filter((e) => e.kind === "DEAD_DOOR");
  assert.equal(doors.length, 1);
  assert.match(doors[0].summary, /a bot challenge/);
});

test("BoardDocs is checked as a public source; a refusal is recorded without closing every tenant forever", async () => {
  assert.ok(!RECORDED_WALLS.some((w) => w.host === "go.boarddocs.com"));
  const { open, seen } = fakeOpen({ "https://go.boarddocs.com/robots.txt": DENY, "https://go.boarddocs.com/": { status: 403, body: "refused" } });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:district:walled", "go.boarddocs.com"), runtime(open));
  assert.ok(seen.includes("https://go.boarddocs.com/robots.txt"));
  assert.equal(attempt.steps.find((s) => s.url === "https://go.boarddocs.com/")?.status, 403);
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

test("BOUNDED BY DEFAULT: a source with many linked calendars stays inside its finite request allowance and remains due", async () => {
  const { open, seen } = fakeOpen({
    "https://busy.gov/robots.txt": ALLOW,
    "https://busy.gov/": { status: 200, body: Array.from({length: 60}, (_, i) => `<a href="/meeting-${i}.ics">Calendar ${i}</a>`).join("") },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:town:busy", "busy.gov"), runtime(open));
  assert.ok(Number.isFinite(DEFAULT_MAX_REQUESTS_PER_WALK));
  assert.equal(seen.length, DEFAULT_MAX_REQUESTS_PER_WALK);
  assert.equal(attempt.recheckAfter, attempt.finishedAt, "unwalked routes keep the source due immediately");
  assert.ok(attempt.steps.some(s => /request bound/.test(s.note)));
});

test("TIME: each request's timeout is cut to the time left; a walk the time runs out on concludes nothing unless it already confirmed a route", async () => {
  /* The transport is never offered more time than the budget has left. */
  const offered: number[] = [];
  const slow = fakeOpen({
    "https://slow.gov/robots.txt": ALLOW,
    "https://slow.gov/": { status: 200, body: `<a href="/m.ics">m</a>` },
    "https://slow.gov/m.ics": { status: 200, body: ICS },
  });
  const timed: DiscoveryOpen = async (input) => {
    offered.push(input.timeoutMs);
    return slow.open(input);
  };
  const clamped = await walkMeetingsDiscoveryNeed(need("az:t:slow", "slow.gov"), runtime(timed, { budget: { spent: () => false, remainingMs: () => 7_500 } }));
  assert.equal(clamped.outcome, "FOUND");
  assert.deepEqual(offered, Array(7).fill(7_500));

  /* Out of time after robots.txt: no further request, and no reading of the site. */
  let left = 60_000;
  let cutSpacings = 0;
  const cut = fakeOpen({ "https://cut.gov/robots.txt": ALLOW, "https://cut.gov/": { status: 200, body: "<p>home</p>" } });
  const spendOnFirst: DiscoveryOpen = async (input) => {
    left = 0;
    return cut.open(input);
  };
  await assert.rejects(
    walkMeetingsDiscoveryNeed(need("az:t:cut", "cut.gov"), runtime(spendOnFirst, {
      websiteSize: () => ({ kind: "local-government", population: 9_999 }),
      spaceOut: async () => {
        cutSpacings += 1;
      },
      budget: { spent: () => left <= 0, remainingMs: () => left },
    })),
    (error: unknown) => error instanceof DiscoveryTimeSpent && error.jurisdictionId === "az:t:cut" && error.requestCount === 1,
    "a walk cut short before any find is not a BLOCKED, NOTHING_DETECTED or COULD_NOT_READ reading",
  );
  assert.deepEqual(cut.seen, ["https://cut.gov/robots.txt"], "no request is sent once the time is spent");
  assert.equal(cutSpacings, 1, "a spent budget does not wait for the host's spacing either");

  /* The host's spacing can spend the time too: the request it was waiting for is not sent. */
  let spacings = 0;
  let spacedLeft = 60_000;
  const spaced = fakeOpen({ "https://spaced.gov/robots.txt": ALLOW, "https://spaced.gov/": { status: 200, body: "<p>home</p>" } });
  await assert.rejects(
    walkMeetingsDiscoveryNeed(need("az:t:spaced", "spaced.gov"), runtime(spaced.open, {
      websiteSize: () => ({ kind: "school-district", students: 4_999 }),
      spaceOut: async () => {
        spacings += 1;
        if (spacings === 2) spacedLeft = 0;
      },
      budget: { spent: () => spacedLeft <= 0, remainingMs: () => spacedLeft },
    })),
    (error: unknown) => error instanceof DiscoveryTimeSpent && error.requestCount === 1,
  );
  assert.deepEqual(spaced.seen, ["https://spaced.gov/robots.txt"], "the time is asked again after the spacing wait");

  /* A route confirmed before the time ran out stands; the routes not reached are leads that say so. */
  let remaining = 60_000;
  const two = fakeOpen({
    "https://two.gov/robots.txt": ALLOW,
    "https://two.gov/": { status: 200, body: `<a href="/a.ics">a</a><a href="/b.ics">b</a>` },
    "https://two.gov/a.ics": { status: 200, body: ICS, contentType: "text/calendar" },
  });
  const spendAfterFirstFeed: DiscoveryOpen = async (input) => {
    const reply = await two.open(input);
    if (input.url.endsWith("/a.ics")) remaining = 0;
    return reply;
  };
  const partial = await walkMeetingsDiscoveryNeed(
    need("az:t:two", "two.gov"),
    runtime(spendAfterFirstFeed, { budget: { spent: () => remaining <= 0, remainingMs: () => remaining } }),
  );
  assert.equal(partial.outcome, "FOUND");
  assert.deepEqual(partial.found.map((f) => f.url), ["https://two.gov/a.ics"]);
  assert.deepEqual(partial.leads.map((l) => [l.url, l.detail]), [["https://two.gov/b.ics", "not checked: the cycle's discovery time ran out first"]]);
  assert.equal(two.seen.includes("https://two.gov/b.ics"), false);
});

test("THE EVIDENCE KEY IS A LEGAL PATH ON THE RUNNER'S HOST: no character Windows refuses, two ids never share a directory, and a real vault write succeeds", async () => {
  const { workItemPrefix } = await import("../lib/control-plane/evidence/store.ts");
  const { cycleVault } = await import("../lib/control-plane/scheduler/vault.ts");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  for (const id of ["az:school:central-arizona-college", "az:city:city-of-chandler", "nh:town:town-of-sutton", "az:school:tucson-unified-school-district-1"]) {
    const work = discoveryWorkId(id);
    assert.match(work, /^[A-Za-z0-9._-]+$/, `${work} carries a character a Windows directory name refuses`);
    const prefix = workItemPrefix("freshness", { sourceId: "meetings-discovery", retrievedAt: NOW, workItemId: work } as never);
    assert.doesNotMatch(prefix, /[:*?"<>|\\]/, `${prefix} is not a legal Windows path`);
  }
  assert.notEqual(discoveryWorkId("az:a:b"), discoveryWorkId("az_a_b"), "ids that differ only in a replaced character stay apart");
  assert.equal(discoveryWorkId("az:city:city-of-chandler"), discoveryWorkId("az:city:city-of-chandler"), "the same need, the same directory");

  /* The runner's own vault, on this host. */
  const vault = cycleVault(mkdtempSync(join(tmpdir(), "wtp-discovery-vault-")));
  const { open } = fakeOpen({
    "https://cac.example.edu/robots.txt": ALLOW,
    "https://cac.example.edu/": { status: 200, body: `<a href="/calendar/meetings.ics">Meetings</a>` },
    "https://cac.example.edu/calendar/meetings.ics": { status: 200, body: ICS, contentType: "text/calendar" },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:school:central-arizona-college", "https://cac.example.edu"), runtime(open, { vault: vault.put }));
  assert.equal(attempt.outcome, "FOUND");
  assert.ok(attempt.found[0].artifactId !== null, "the route's evidence was stored in the durable vault");
  assert.ok(attempt.steps.every((s) => s.status === null || s.artifactId !== null), "every page read was vaulted");
});

test("THE NEXT HOP: when nothing is confirmed, the pages the walk read are read for the routes they link; a readable one is confirmed, an unreadable publisher is a lead and is never requested", async () => {
  const { knownRecipes } = await import("../lib/hunt/meetings-recipes.ts");
  const { open, seen } = fakeOpen({
    "https://www.chandler.example.gov/robots.txt": ALLOW,
    "https://www.chandler.example.gov/": { status: 200, body: `<a href="/council-meetings">City Council Meetings</a> <a href="/news/council-appoints-attorney">Council Appoints City Attorney After Long Search Today</a>` },
    "https://www.chandler.example.gov/council-meetings": {
      status: 200,
      body: `<h1>City Council Meetings</h1><p>Agendas are posted 24 hours in advance.</p>` +
        `<a href="https://public.destinyhosted.com/agenda_publish.cfm?id=24263">Agendas</a> <a href="/calendar/council.ics">Subscribe</a>`,
    },
    "https://www.chandler.example.gov/calendar/council.ics": { status: 200, body: ICS, contentType: "text/calendar" },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:city:city-of-chandler", "https://www.chandler.example.gov"), runtime(open, { recipes: knownRecipes([]) }));
  assert.equal(attempt.outcome, "FOUND");
  assert.deepEqual(attempt.found.map((f) => [f.vendor, f.url]), [["ical", "https://www.chandler.example.gov/calendar/council.ics"]]);
  assert.match(attempt.found[0].evidence, /^linked from https:\/\/www\.chandler\.example\.gov\/council-meetings/, "the evidence names the page that linked it");
  assert.equal(attempt.found[0].via?.page, "https://www.chandler.example.gov/council-meetings", "and so does its provenance");
  assert.ok(attempt.found[0].via?.artifactId, "with the linking page's vaulted artifact");
  assert.ok(attempt.leads.some((l) => l.vendor === "destiny-agenda" && l.url.startsWith("https://public.destinyhosted.com/")), "the agenda publisher is a lead");
  assert.ok(!seen.some((u) => u.includes("destinyhosted.com")), "a lead is never requested");
  assert.ok(!seen.some((u) => u.includes("/news/")), "and the headline was never followed");
});

/* ------------------------------------------------------------ route hints */

const HINT_SEEN = { at: "2026-09-24T18:00:00Z", by: "test" } as const;

const OLDTOWN_HINTS: readonly JurisdictionRouteHints[] = [{
  jurisdictionId: "az:city:city-of-oldtown",
  officialSite: {
    origin: "https://www.oldtownaz.gov",
    selfName: "City of Oldtown",
    replaces: "http://www.ci.oldtown.az.us",
    recordedState: "the host does not resolve",
    evidence: [".gov registry: oldtownaz.gov, City of Oldtown, Oldtown AZ"],
    observed: HINT_SEEN,
  },
  routes: [],
}];

test("A STALE RECORDED ADDRESS: the current official site a route hint records is walked first, and the walk says what it replaced", async () => {
  const { open, seen } = fakeOpen({
    "https://www.oldtownaz.gov/robots.txt": ALLOW,
    "https://www.oldtownaz.gov/": { status: 200, body: `<title>City of Oldtown, Arizona</title><a href="/calendar/meetings.ics">Meetings</a>` },
    "https://www.oldtownaz.gov/calendar/meetings.ics": { status: 200, body: ICS, contentType: "text/calendar" },
  });
  const oldtown = need("az:city:city-of-oldtown", "http://www.ci.oldtown.az.us");
  const attempt = await walkMeetingsDiscoveryNeed(oldtown, runtime(open, { routeHints: OLDTOWN_HINTS }));
  assert.deepEqual(
    seen,
    ["https://www.oldtownaz.gov/robots.txt", "https://www.oldtownaz.gov/", ...["agendas", "meetings", "calendar", "sitemap.xml"].map(path => `https://www.oldtownaz.gov/${path}`), "https://www.oldtownaz.gov/calendar/meetings.ics"],
    "the current site is walked, and the dead recorded host costs nothing",
  );
  assert.equal(attempt.outcome, "FOUND");
  assert.equal(attempt.ownWebAddress, "http://www.ci.oldtown.az.us", "the attempt still names the address the reference records");
  assert.deepEqual(attempt.routeHints, {
    fingerprint: routeHintsFingerprint(OLDTOWN_HINTS[0]),
    officialSite: "https://www.oldtownaz.gov",
    replaces: "http://www.ci.oldtown.az.us",
    homepageRead: "https://www.oldtownaz.gov",
    routes: [],
  });
  assert.match(attempt.note, /It walked the current official site, https:\/\/www\.oldtownaz\.gov; the recorded http:\/\/www\.ci\.oldtown\.az\.us is stale \(the host does not resolve\)\.$/);
  assert.equal(attempt.site?.homepage?.basis, "ROUTE_HINT");
  assert.equal(attempt.site?.homepage?.hintFingerprint, routeHintsFingerprint(OLDTOWN_HINTS[0]));

  const bare = fakeOpen({
    "https://www.ci.oldtown.az.us/robots.txt": { transportError: "getaddrinfo ENOTFOUND www.ci.oldtown.az.us" },
    "https://ci.oldtown.az.us/robots.txt": { transportError: "getaddrinfo ENOTFOUND ci.oldtown.az.us" },
  });
  const without = await walkMeetingsDiscoveryNeed(oldtown, runtime(bare.open));
  assert.equal(without.outcome, "COULD_NOT_READ", "without the hint the walk knocks on the dead host");
  assert.equal(without.routeHints, undefined, "and records no hint");
});

test("A HINTED SITE IS THE GOVERNMENT'S ONLY WHILE IT SAYS SO: a homepage that no longer names it is not walked, and the recorded address is tried behind it", async () => {
  const { open, seen } = fakeOpen({
    "https://www.oldtownaz.gov/robots.txt": ALLOW,
    "https://www.oldtownaz.gov/": { status: 200, body: `<title>This domain may be for sale</title><a href="/calendar/meetings.ics">Calendar</a>` },
    "https://www.ci.oldtown.az.us/robots.txt": { transportError: "getaddrinfo ENOTFOUND www.ci.oldtown.az.us" },
    "https://ci.oldtown.az.us/robots.txt": { transportError: "getaddrinfo ENOTFOUND ci.oldtown.az.us" },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:city:city-of-oldtown", "http://www.ci.oldtown.az.us"), runtime(open, { routeHints: OLDTOWN_HINTS }));
  assert.ok(!seen.includes("https://www.oldtownaz.gov/calendar/meetings.ics"), "nothing the lapsed page links is requested");
  assert.ok(seen.includes("https://www.ci.oldtown.az.us/robots.txt"), "the recorded address is tried behind it");
  assert.deepEqual(attempt.found, []);
  assert.equal(attempt.routeHints?.homepageRead, null, "no homepage was walked as the government's");
  assert.ok(attempt.steps.some((s) => s.purpose === "homepage" && s.status === null && /not walked as .*'s own site: its homepage no longer names City of Oldtown/.test(s.note)));
  assert.match(attempt.note, /answered but was not walked as the government's own: its homepage no longer names City of Oldtown; the recorded http:\/\/www\.ci\.oldtown\.az\.us is stale/);
});

test("HINTED ROUTES GO FIRST, ROBOTS-FIRST: a route a check covers is confirmed by content; any other is requested and recorded as a lead, a witness is never a sitting, and a binary body is never vaulted as text", async () => {
  const hints: readonly JurisdictionRouteHints[] = [{
    jurisdictionId: "nh:city:town-of-hilltop",
    officialSite: null,
    routes: [
      { url: "https://library.example.org/feed/", kind: "FEED", body: "Hilltop Library Trustees", platform: "wordpress", verifyAs: null, evidence: "trustee notices", observed: HINT_SEEN },
      { url: "https://energy.example.org/meetings.ics", kind: "FEED", body: "Hilltop Energy Committee", platform: "squarespace", verifyAs: "ical", evidence: "the committee's calendar", observed: HINT_SEEN },
      { url: "https://schools.example.org/f/board_schedule.pdf", kind: "DOCUMENT", body: "Hilltop School Board", platform: "pdf", verifyAs: null, evidence: "the board's calendar", observed: HINT_SEEN },
      { url: "https://video.example.com/@HilltopCable/streams", kind: "WITNESS", body: "Hilltop boards", platform: "youtube", verifyAs: null, evidence: "scheduled streams", observed: HINT_SEEN },
    ],
  }];
  const { open, seen } = fakeOpen({
    "https://hilltop.gov/robots.txt": ALLOW,
    "https://hilltop.gov/": { status: 200, body: `<p>Welcome to Hilltop</p><a href="/m.ics">Meetings</a>` },
    "https://hilltop.gov/m.ics": { status: 200, body: ICS, contentType: "text/calendar" },
    "https://library.example.org/robots.txt": ALLOW,
    "https://library.example.org/feed/": { status: 200, body: "<rss><channel><item><title>Public Notice: Trustees Meeting</title></item></channel></rss>", contentType: "application/rss+xml; charset=UTF-8" },
    "https://energy.example.org/robots.txt": ALLOW,
    "https://energy.example.org/meetings.ics": { status: 200, body: ICS, contentType: "text/calendar" },
    "https://schools.example.org/robots.txt": ALLOW,
    "https://schools.example.org/f/board_schedule.pdf": { status: 200, body: "%PDF-1.7 binary", contentType: "application/pdf" },
    "https://video.example.com/robots.txt": ALLOW,
    "https://video.example.com/@HilltopCable/streams": { status: 200, body: "<html>Upcoming: PB_2026_10_05</html>" },
  });
  const rt = runtime(open, { routeHints: hints });
  const attempt = await walkMeetingsDiscoveryNeed(need("nh:city:town-of-hilltop", "hilltop.gov"), rt);

  assert.deepEqual(seen, [
    "https://hilltop.gov/robots.txt", "https://hilltop.gov/",
    ...["agendas", "meetings", "calendar", "sitemap.xml"].map(path => `https://hilltop.gov/${path}`),
    "https://library.example.org/robots.txt", "https://library.example.org/feed/",
    "https://energy.example.org/robots.txt", "https://energy.example.org/meetings.ics",
    "https://schools.example.org/robots.txt", "https://schools.example.org/f/board_schedule.pdf",
    "https://video.example.com/robots.txt", "https://video.example.com/@HilltopCable/streams",
    "https://hilltop.gov/m.ics",
  ], "every hint before the route the page itself links");
  assert.equal(attempt.outcome, "FOUND");
  assert.deepEqual(attempt.found.map((f) => [f.vendor, f.url, f.basis, f.count]), [["ical", "https://energy.example.org/meetings.ics", "HINT", 1], ["ical", "https://hilltop.gov/m.ics", "LINKED", 1]]);
  assert.match(attempt.found[0].evidence, /^route hint \(feed, observed 2026-09-24T18:00:00Z by test\): the committee's calendar$/);
  const leads = new Map(attempt.leads.map((l) => [l.url, l] as const));
  assert.match(leads.get("https://library.example.org/feed/")!.detail, /answered HTTP 200 .* of application\/rss\+xml; charset=UTF-8; no content check covers a feed yet: a lead, not a route$/);
  assert.match(leads.get("https://schools.example.org/f/board_schedule.pdf")!.detail, /no content check covers a document yet: a lead, not a route$/);
  assert.match(leads.get("https://video.example.com/@HilltopCable/streams")!.detail, /a witness corroborates a sitting and is never one on its own$/);
  assert.deepEqual([...leads.values()].map((l) => [l.vendor, l.basis]), [["wordpress", "HINT"], ["pdf", "HINT"], ["youtube", "HINT"]]);

  const pdf = attempt.steps.find((s) => s.url === "https://schools.example.org/f/board_schedule.pdf")!;
  assert.equal(pdf.artifactId, null);
  assert.match(pdf.note, /^read \d+ bytes of application\/pdf; not vaulted: a binary body does not survive the text decode$/);
  assert.ok(!rt.vaulted.some((a) => a.canonicalUrl.endsWith(".pdf")), "the PDF is not in the vault as text");
  assert.ok(rt.vaulted.some((a) => a.canonicalUrl === "https://library.example.org/feed/"), "a feed is text and is vaulted");

  assert.deepEqual(
    discoveryFieldManualEntries(attempt).map((e) => [e.kind, e.outcome, e.platforms.join(",")]),
    [["PLATFORM_CENSUS", "ZERO", ""], ["MEETINGS_ROUTE", "YIELDED", "ical"], ["MEETINGS_ROUTE", "YIELDED", "ical"], ["MEETINGS_LEAD", "REFERENCE", "wordpress"], ["MEETINGS_LEAD", "REFERENCE", "pdf"], ["MEETINGS_LEAD", "REFERENCE", "youtube"]],
    "what the hints yielded is written the way every walk's results are, so later walks inherit it",
  );
});

test("A HINT LIST THAT CANNOT BE TRUSTED SAYS WHY, AND A LAPSED PAGE IS TOLD FROM THE GOVERNMENT'S OWN", () => {
  const problems = routeHintProblems([
    { jurisdictionId: "az:city:x", officialSite: { origin: "http://x.gov/path", selfName: "X", replaces: "http://x.gov", recordedState: " ", evidence: [], observed: { at: "yesterday", by: "" } }, routes: [] },
    { jurisdictionId: "az:city:x", officialSite: null, routes: [{ url: "https://y.example/w", kind: "WITNESS", body: "Y boards", platform: "youtube", verifyAs: "ical", evidence: "e", observed: HINT_SEEN }] },
    { jurisdictionId: "az:city:y", officialSite: { origin: "https://www.y.gov", selfName: "City of Y", replaces: "http://y.gov", recordedState: "parked", evidence: ["e"], observed: HINT_SEEN }, routes: [] },
    { jurisdictionId: "az:city:z", officialSite: null, routes: [] },
  ]);
  for (const expected of [
    /az:city:x: official site http:\/\/x\.gov\/path is not a bare https origin/,
    /az:city:x: the official site's own name for the government is not recorded/,
    /az:city:x: the recorded address's state is not said/,
    /az:city:x: the official site carries no evidence/,
    /az:city:x: the official site's observation is not dated and attributed/,
    /az:city:x: listed twice/,
    /az:city:x: witness https:\/\/y\.example\/w is checked as a route; a witness is never a sitting on its own/,
    /az:city:y: the official site is the recorded host itself; there is nothing to correct/,
    /az:city:z: no official site and no route; nothing to try/,
  ]) {
    assert.ok(problems.some((p) => expected.test(p)), `missing: ${expected}\n${problems.join("\n")}`);
  }
  assert.ok(namesItself("<title>City&nbsp;of \n El Mirage | Home</title>", "City of El Mirage"));
  assert.ok(!namesItself("<title>This domain may be for sale</title>", "City of El Mirage"));
});

test("committed route hints stay valid and the independent census passes them to its walks", () => {
  assert.deepEqual(routeHintProblems(ROUTE_HINTS), []);
  const runner = readFileSync("scripts/platform-census-runner.mts", "utf8");
  assert.match(runner, /routeHints: ROUTE_HINTS/);
});

/* -------------------------------------------- what the vault will not hold */

/* Synthesized, never a literal: the shape the credential scanner confirms (tests/control-plane-evidence-durability.test.ts). */
const FAKE_MAPS_KEY = ["AI", "za"].join("") + "SyD4mQ8vX1nR7pLbT2wCzE0jHfGuY5aKs_-3xNp".slice(0, 35);

/** The durable vault as the runner builds it today: no RestrictedEvidenceProvider, so a RESTRICTED_RAW body is refused by name. */
function refusingVault(vaulted: Artifact[]): DiscoveryRuntime["vault"] {
  return async (artifact) => {
    if (artifact.tier === "RESTRICTED_RAW") {
      throw new Error(`Key ${artifact.id} carries a RESTRICTED_RAW body and this store was constructed without a RestrictedEvidenceProvider.`);
    }
    vaulted.push(artifact);
    return { stored: true, where: `vault/${artifact.id}`, why: "stored" };
  };
}

test("A PAGE CARRYING A CREDENTIAL IS READ AS ITS SANITIZED DERIVATIVE, AND A VAULT THAT REFUSES ITS BYTES NEVER ENDS THE WALK", async () => {
  const { open } = fakeOpen({
    "https://gilabend.example.org/robots.txt": ALLOW,
    "https://gilabend.example.org/": {
      status: 200,
      body: `<a href="/m.ics">Board Meetings</a><script>var clerkEmbedProps = { "mapsKey": "${FAKE_MAPS_KEY}", "tenant": "gilabendexample" };</script>`,
    },
    "https://gilabend.example.org/m.ics": { status: 200, body: ICS, contentType: "text/calendar" },
  });
  const vaulted: Artifact[] = [];
  const attempt = await walkMeetingsDiscoveryNeed(need("az:school:gila-bend-example", "gilabend.example.org"), runtime(open, { vault: refusingVault(vaulted) }));

  assert.equal(attempt.outcome, "FOUND", "the walk goes on past a body the vault will not hold");
  assert.deepEqual(attempt.found.map((f) => f.url), ["https://gilabend.example.org/m.ics"], "the sanitized page still carries its links");
  const home = attempt.steps.find((s) => s.purpose === "homepage")!;
  assert.match(home.note, /the body carries a confirmed credential, so the walk read its sanitized derivative; its exact bytes were not kept \(Key .* carries a RESTRICTED_RAW body/);
  const kept = vaulted.find((a) => a.canonicalUrl === "https://gilabend.example.org/")!;
  assert.equal(kept.tier, "SANITIZED_DERIVED", "the page's evidence is its sanitized derivative");
  assert.equal(home.artifactId, kept.id);
  assert.ok(!vaulted.some((a) => a.tier === "RESTRICTED_RAW"));
  assert.ok(!JSON.stringify(attempt).includes(FAKE_MAPS_KEY), "no credential value reaches the record");
});

test("PROVENANCE (NH330): the walk records where the address came from, each redirect to the homepage, and a withdrawn route's own 404 as vaulted evidence", async () => {
  const { open } = fakeOpen({
    "https://redirected.gov/robots.txt": ALLOW,
    "https://redirected.gov/": { status: 301, location: "https://www.redirected.gov/" },
    "https://www.redirected.gov/robots.txt": ALLOW,
    "https://www.redirected.gov/": { status: 200, body: `<a href="/gone.ics">Meetings</a>` },
    "https://www.redirected.gov/gone.ics": { status: 404, body: "<html>Page not found</html>" },
  });
  const rt = runtime(open);
  const addressSource = { source: "GAP_LEDGER" as const, versionId: "a".repeat(64) };
  const attempt = await walkMeetingsDiscoveryNeed({ ...need("az:city:city-of-redirected", "redirected.gov"), addressSource }, rt);
  assert.deepEqual(attempt.site?.address, addressSource, "the need's address source is carried onto the attempt");
  assert.deepEqual(attempt.site?.homepage?.redirects, [{ from: "https://redirected.gov/", to: "https://www.redirected.gov/", status: 301 }]);
  assert.equal(attempt.site?.homepage?.url, "https://www.redirected.gov/");
  const gone = attempt.steps.find((s) => s.url === "https://www.redirected.gov/gone.ics")!;
  assert.equal(gone.status, 404);
  assert.ok(gone.artifactId !== null, "a 404 route's body is vaulted: the only evidence that withdraws a derived row");
  assert.match(gone.note, /its body is vaulted as withdrawal evidence/);
  assert.equal(rt.vaulted.find((a) => a.id === gone.artifactId)?.httpStatus, 404);
  assert.deepEqual(attempt.found, [], "and a 404 is never a find");
});

test('discovery caps only known small publishers, leaving larger and unknown websites uncapped', async () => {
  const home='https://many.gov';
  for(const size of [undefined,{kind:'local-government',population:10000},{kind:'school-district',students:5000},
    {kind:'local-government',population:9999},{kind:'school-district',students:4999}] as const){
    const {open,seen}=fakeOpen({[home+'/robots.txt']:ALLOW,
      [home+'/']:{status:200,body:Array.from({length:15},(_,i)=>`<a href="/meeting-${i}.ics">Calendar ${i}</a>`).join('')}});
    let spacings=0;
    const got=await walkMeetingsDiscoveryNeed(need('az:town:many','many.gov'),runtime(open,{websiteSize:()=>size,spaceOut:async()=>{spacings++;}}));
    const small=size!==undefined && ((size.kind==='local-government' && size.population<10000) || (size.kind==='school-district' && size.students<5000));
    if(small){assert.equal(seen.length,10);assert.ok(got.steps.some(s=>/website reached its 10-request/.test(s.note)));assert.equal(spacings,10);}
    else {assert.ok(seen.length>10,JSON.stringify({size,count:seen.length}));assert.equal(spacings,0);}
  }
});

test("the census owns an independent runner clock outside the research walk budget", () => {
  const runner = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(runner, /id: "platform-census", everyMs: CENSUS_LANE_INTERVAL_MS, run: runPlatformCensus/);
  const source = readFileSync("scripts/freshness-shadow.mts", "utf8");
  assert.doesNotMatch(source, /MEETINGS_DISCOVERY_MAX_WALKS|runMeetingsDiscoveryPass/);
  assert.match(source, /timed\("campaign-sites"/);
  assert.match(source, /timed\("candidate-publications"/);
});
