/**
 * `lib/hunt/robots-first-fetch.ts` against a recorded fake transport; no test reaches the network.
 * robots.txt is the first request to every origin, a redirect's new origin is read again, a chain that ends
 * unread is recorded CANNOT_TELL (never "no robots file"), a disallow is recorded with its rule and the
 * public page is still read, recorded walls are never asked anything, an access control on the page is named
 * and never pushed through, and one host is spaced.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { carriesCredential } from "../lib/hunt/access-control.ts";
import { memoryInProcess, researchFetch, type ResearchGet, type ResearchRuntime } from "../lib/hunt/robots-first-fetch.ts";
import { DEFAULT_USER_AGENT } from "../lib/control-plane/scheduler/user-agent.ts";

type Reply = { readonly status: number; readonly body?: string; readonly contentType?: string; readonly location?: string } | { readonly transportError: string };

function fakeRuntime(map: Readonly<Record<string, Reply>>, over: Partial<ResearchRuntime> = {}) {
  const seen: string[] = [];
  const slept: number[] = [];
  let clock = Date.parse("2026-09-24T20:00:00.000Z");
  const get: ResearchGet = async ({ url, headers }) => {
    seen.push(url);
    assert.match(headers["user-agent"] ?? "", /we-the-people/, "every request identifies the project");
    const reply = map[url] ?? { status: 404, body: "not found" };
    if ("transportError" in reply) return { status: null, body: new Uint8Array(0), contentType: "", location: null, transportError: reply.transportError };
    return { status: reply.status, body: new TextEncoder().encode(reply.body ?? ""), contentType: reply.contentType ?? "text/html", location: reply.location ?? null, transportError: null };
  };
  const runtime: ResearchRuntime = {
    get,
    memory: memoryInProcess(),
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    ...over,
  };
  return { runtime, seen, slept };
}

const ALLOW = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" } as const;

test("ROBOTS FIRST, EVERY ORIGIN: a redirect onto a new origin asks that origin's robots.txt before anything else", async () => {
  const { runtime, seen } = fakeRuntime({
    "https://a.gov/robots.txt": ALLOW,
    "https://a.gov/x": { status: 301, location: "https://b.gov/y" },
    "https://b.gov/robots.txt": ALLOW,
    "https://b.gov/y": { status: 200, body: "<title>Town of B</title>" },
  });
  const got = await researchFetch("https://a.gov/x", runtime);
  assert.deepEqual(seen, ["https://a.gov/robots.txt", "https://a.gov/x", "https://b.gov/robots.txt", "https://b.gov/y"]);
  assert.equal(got.outcome, "FETCHED");
  if (got.outcome !== "FETCHED") return;
  assert.equal(got.finalUrl, "https://b.gov/y");
  assert.deepEqual(got.redirects, [{ from: "https://a.gov/x", status: 301, to: "https://b.gov/y" }]);
  assert.deepEqual(got.permissions.map((p) => [p.origin, p.verdict]), [["https://a.gov", "ALLOWED"], ["https://b.gov", "ALLOWED"]]);
  assert.match(got.sha256 ?? "", /^[0-9a-f]{64}$/);
});

test("A ROBOTS.TXT THAT ENDS UNREAD IS NEVER 'NO ROBOTS FILE': a chain past five redirects, a 5xx, a transport failure and a 403 are recorded CANNOT_TELL, and the public page is still read", async () => {
  const chain: Record<string, Reply> = {};
  for (let i = 0; i < 7; i += 1) chain[i === 0 ? "https://loop.gov/robots.txt" : `https://loop.gov/r${i}.txt`] = { status: 301, location: `https://loop.gov/r${i + 1}.txt` };
  const cases: [string, Record<string, Reply>][] = [
    ["https://loop.gov/", chain],
    ["https://down.gov/", { "https://down.gov/robots.txt": { status: 503, body: "down" } }],
    ["https://gone.gov/", { "https://gone.gov/robots.txt": { transportError: "getaddrinfo ENOTFOUND gone.gov" } }],
    ["https://walled.gov/", { "https://walled.gov/robots.txt": { status: 403, body: "Forbidden" } }],
  ];
  for (const [url, map] of cases) {
    const { runtime, seen } = fakeRuntime({ ...map, [url]: { status: 200, body: "<title>Town</title>" } });
    const got = await researchFetch(url, runtime);
    assert.equal(got.outcome, "FETCHED", url);
    if (got.outcome !== "FETCHED") continue;
    assert.equal(got.permissions[0]?.verdict, "CANNOT_TELL", `${url}: recorded as unread, never as no robots file`);
    assert.ok(seen.indexOf(url) > 0 && seen.slice(0, seen.indexOf(url)).every((u) => u.includes("robots.txt") || /\/r\d+\.txt$/.test(u)), `${url}: the rules were asked first: ${seen.join(", ")}`);
  }
  const { runtime } = fakeRuntime({ "https://nofile.gov/robots.txt": { status: 404, body: "not found" }, "https://nofile.gov/": { status: 200, body: "home" } });
  const nofile = await researchFetch("https://nofile.gov/", runtime);
  assert.equal(nofile.outcome, "FETCHED", "a robots.txt that answers 404 is a host with no rules");
  if (nofile.outcome === "FETCHED") assert.equal(nofile.permissions[0]?.verdict, "NO_ROBOTS");
});

test("A DISALLOW IS RECORDED, NOT OBEYED AS A REFUSAL (owner decision 2026-09-25), AND EVERY PATH IS EVALUATED FOR ITSELF against the one reading of its origin", async () => {
  const { runtime, seen } = fakeRuntime({
    "https://mixed.gov/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /private\n", contentType: "text/plain" },
    "https://mixed.gov/public": { status: 200, body: "public" },
    "https://mixed.gov/private/minutes": { status: 200, body: "minutes" },
  });
  const open = await researchFetch("https://mixed.gov/public", runtime);
  const named = await researchFetch("https://mixed.gov/private/minutes", runtime);
  assert.equal(open.outcome, "FETCHED");
  assert.equal(named.outcome, "FETCHED", "robots.txt alone never blocks a public page");
  if (open.outcome === "FETCHED") assert.equal(open.permissions[0]?.verdict, "ALLOWED");
  if (named.outcome === "FETCHED") {
    const reading = named.permissions[0];
    assert.equal(reading?.verdict, "DISALLOWED", "the disallow is recorded");
    assert.equal(reading?.matchedRule, "Disallow: /private", "with the rule that named the path");
    assert.match(reading?.robotsSha256 ?? "", /^[0-9a-f]{64}$/, "and the bytes it was read from");
    assert.equal(reading?.readAt, "2026-09-24T20:00:00.000Z", "and when it was read");
  }
  assert.deepEqual(
    seen,
    ["https://mixed.gov/robots.txt", "https://mixed.gov/public", "https://mixed.gov/private/minutes"],
    "robots.txt read once, first, and both public paths requested",
  );
});

test("BoardDocs public routes are read after robots.txt, including a redirect, and a real refusal is recorded", async () => {
  const { runtime, seen } = fakeRuntime({
    "https://city.gov/robots.txt": ALLOW,
    "https://city.gov/agendas": { status: 302, location: "https://go.boarddocs.com/az/x/Board.nsf/Public" },
    "https://go.boarddocs.com/robots.txt": ALLOW,
    "https://go.boarddocs.com/az/x/Board.nsf/Public": { status: 403, body: "Forbidden" },
    "https://public.destinyhosted.com/robots.txt": { status: 200, body: "User-agent: * Disallow: /", contentType: "text/plain" },
    "https://public.destinyhosted.com/agenda_publish.cfm?id=1": { status: 200, body: "<title>Agenda</title>" },
  });
  const wall = await researchFetch("https://go.boarddocs.com/az/x/Board.nsf/Public", runtime);
  assert.equal(wall.outcome, "FETCHED");
  if (wall.outcome === "FETCHED") assert.equal(wall.accessControl?.kind, "FORBIDDEN");
  const viaRedirect = await researchFetch("https://city.gov/agendas", runtime);
  assert.equal(viaRedirect.outcome, "FETCHED");
  if (viaRedirect.outcome === "FETCHED") assert.equal(viaRedirect.accessControl?.kind, "FORBIDDEN");
  assert.equal(seen.filter(url => url === "https://go.boarddocs.com/robots.txt").length, 1);
  assert.ok(seen.indexOf("https://go.boarddocs.com/robots.txt") < seen.indexOf("https://go.boarddocs.com/az/x/Board.nsf/Public"));
  const destiny = await researchFetch("https://public.destinyhosted.com/agenda_publish.cfm?id=1", runtime);
  assert.equal(destiny.outcome, "FETCHED", "a disallow-all robots.txt was destinyhosted.com's only hold, and robots.txt alone no longer blocks");
  assert.ok(seen.indexOf("https://public.destinyhosted.com/robots.txt") < seen.indexOf("https://public.destinyhosted.com/agenda_publish.cfm?id=1"), "its rules were still read first");
});

test("AN ACCESS CONTROL IS NAMED AND NEVER PUSHED THROUGH: 401, 403, a challenge at 200, and a 429 that backs the host off; no credential or cookie is ever sent", async () => {
  const headersSeen: Record<string, string>[] = [];
  const replies: Record<string, Reply> = {
    "https://guarded.gov/robots.txt": ALLOW,
    "https://guarded.gov/login": { status: 401, body: "Unauthorized" },
    "https://guarded.gov/waf": { status: 403, body: "Forbidden" },
    "https://guarded.gov/cf": { status: 200, body: "<html><head><title>Just a moment...</title></head></html>" },
    "https://guarded.gov/busy": { status: 429, body: "Too Many Requests" },
    "https://guarded.gov/after": { status: 200, body: "ok" },
  };
  const { runtime, seen, slept } = fakeRuntime(replies);
  const inner = runtime.get;
  const watched = { ...runtime, get: async (input: Parameters<ResearchGet>[0]) => (headersSeen.push({ ...input.headers }), inner(input)) };
  const kinds: string[] = [];
  for (const path of ["login", "waf", "cf", "busy"]) {
    const got = await researchFetch(`https://guarded.gov/${path}`, watched);
    assert.equal(got.outcome, "FETCHED", path);
    if (got.outcome === "FETCHED") kinds.push(got.accessControl?.kind ?? "none");
  }
  assert.deepEqual(kinds, ["AUTHENTICATION", "FORBIDDEN", "CHALLENGE", "RATE_LIMIT"]);
  assert.equal(seen.filter((u) => u === "https://guarded.gov/waf").length, 1, "a 403 is asked once, never re-sent");
  await researchFetch("https://guarded.gov/after", watched);
  assert.ok(slept.at(-1)! >= 60_000, `a 429 backs the host off before anything else is asked of it: ${slept.join(", ")}`);
  for (const headers of headersSeen) {
    assert.ok(!carriesCredential(headers), `no credential, cookie or session is sent: ${JSON.stringify(headers)}`);
    assert.equal(headers["user-agent"], DEFAULT_USER_AGENT, "every request carries the project's own identity, never a borrowed one");
  }
});

test("ONE HOST IS SPACED: two seconds between its requests, or its own Crawl-delay when it asks for more", async () => {
  const { runtime, slept } = fakeRuntime({
    "https://slow.gov/robots.txt": { status: 200, body: "User-agent: *\nCrawl-delay: 10\nAllow: /\n", contentType: "text/plain" },
    "https://slow.gov/a": { status: 200, body: "a" },
    "https://slow.gov/b": { status: 200, body: "b" },
  });
  await researchFetch("https://slow.gov/a", runtime);
  await researchFetch("https://slow.gov/b", runtime);
  assert.ok(slept.length >= 2, `it waited between requests: ${slept.join(", ")}`);
  assert.ok(slept[0] >= 2_000, "at least two seconds after robots.txt");
  assert.ok(slept.at(-1)! >= 10_000, "the host's own Crawl-delay governs its pages");
});

test("THE COMMAND LINE HAS NO WAY AROUND IT: it fetches only through researchFetch, and package.json names it", () => {
  const cli = readFileSync("scripts/research-fetch.mts", "utf8");
  assert.match(cli, /await researchFetch\(target, \{/);
  assert.equal((cli.match(/\bfetch\(/g) ?? []).length, 0, "no transport of its own");
  // The module's transport, asked once more through curl on a 403
  // (lib/hunt/research-transport.ts). It is handed to researchFetch like the Node one, so robots.txt
  // is still read first and every redirect's origin asked again.
  assert.match(cli, /\n\s+get: identifiedResearchGet\(\),\n/, "it hands researchFetch the module's one transport");
  const lib = readFileSync("lib/hunt/robots-first-fetch.ts", "utf8");
  const transport = lib.slice(lib.indexOf("export const nodeResearchGet"), lib.indexOf("\n};", lib.indexOf("export const nodeResearchGet")));
  assert.equal((transport.match(/\bpublicFetch\(/g) ?? []).length, 1, "one checked transport");
  assert.match(transport, /redirect: "manual"/, "the transport never follows a redirect itself");
  const second = readFileSync("lib/hunt/research-transport.ts", "utf8");
  assert.equal((second.match(/\bfetch\(/g) ?? []).length, 0, "the curl rung wraps the Node transport and has no fetch of its own");
  assert.match(second, /options\.first \?\? nodeResearchGet/, "the Node transport is asked first");
  assert.doesNotMatch(second, /"-L"|--location/, "curl never follows a redirect either");
  assert.match(readFileSync("package.json", "utf8"), /"research:fetch": "tsx scripts\/research-fetch\.mts"/);
});
