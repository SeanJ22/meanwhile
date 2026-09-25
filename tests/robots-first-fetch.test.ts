/**
 * **A RESEARCH FETCH SENDS NOTHING BEFORE ROBOTS.TXT, TO ANY ORIGIN.** (2026-09-24, R15.)
 *
 * `lib/hunt/robots-first-fetch.ts` against a recorded fake transport; no test
 * reaches the network. On 2026-09-24 a research agent's own script read an
 * unread robots.txt redirect as "no robots file" and sent four homepage
 * requests first. These tests hold the construction that makes that impossible:
 * robots.txt is the first request to every origin, a redirect's new origin is
 * asked again, a chain that ends unread refuses, a disallow refuses, walls and
 * hosts awaiting the owner are never asked anything, every path is evaluated
 * for itself, and one host is spaced.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { memoryInProcess, researchFetch, type ResearchGet, type ResearchRuntime } from "../lib/hunt/robots-first-fetch.ts";

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

test("A ROBOTS.TXT THAT ENDS UNREAD IS NEVER 'NO ROBOTS FILE': a chain past five redirects, a 5xx and a transport failure all refuse, and nothing else is requested", async () => {
  const chain: Record<string, Reply> = {};
  for (let i = 0; i < 7; i += 1) chain[i === 0 ? "https://loop.gov/robots.txt" : `https://loop.gov/r${i}.txt`] = { status: 301, location: `https://loop.gov/r${i + 1}.txt` };
  const cases: [string, Readonly<Record<string, Reply>>][] = [
    ["https://loop.gov/", chain],
    ["https://down.gov/", { "https://down.gov/robots.txt": { status: 503, body: "down" } }],
    ["https://gone.gov/", { "https://gone.gov/robots.txt": { transportError: "getaddrinfo ENOTFOUND gone.gov" } }],
    ["https://walled.gov/", { "https://walled.gov/robots.txt": { status: 403, body: "Forbidden" } }],
  ];
  for (const [url, map] of cases) {
    const { runtime, seen } = fakeRuntime(map);
    const got = await researchFetch(url, runtime);
    assert.equal(got.outcome, "REFUSED", url);
    if (got.outcome !== "REFUSED") continue;
    assert.match(got.reason, /robots\.txt CANNOT_TELL/, url);
    assert.ok(seen.every((u) => u.includes("robots.txt") || /\/r\d+\.txt$/.test(u)), `${url}: only the rules were ever requested: ${seen.join(", ")}`);
  }
  const { runtime } = fakeRuntime({ "https://nofile.gov/robots.txt": { status: 404, body: "not found" }, "https://nofile.gov/": { status: 200, body: "home" } });
  assert.equal((await researchFetch("https://nofile.gov/", runtime)).outcome, "FETCHED", "a robots.txt that answers 404 is a host with no rules");
});

test("A DISALLOW REFUSES, AND EVERY PATH IS EVALUATED FOR ITSELF against the one reading of its origin", async () => {
  const { runtime, seen } = fakeRuntime({
    "https://mixed.gov/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /private\n", contentType: "text/plain" },
    "https://mixed.gov/public": { status: 200, body: "public" },
  });
  const open = await researchFetch("https://mixed.gov/public", runtime);
  const closed = await researchFetch("https://mixed.gov/private/minutes", runtime);
  assert.equal(open.outcome, "FETCHED");
  assert.equal(closed.outcome, "REFUSED");
  if (closed.outcome === "REFUSED") assert.match(closed.reason, /robots\.txt DISALLOWED/);
  assert.deepEqual(seen, ["https://mixed.gov/robots.txt", "https://mixed.gov/public"], "robots.txt read once, and the disallowed path never requested");
});

test("WALLS AND HOSTS AWAITING THE OWNER ARE NEVER ASKED ANYTHING, not even robots.txt, and not by a redirect", async () => {
  const { runtime, seen } = fakeRuntime({
    "https://city.gov/robots.txt": ALLOW,
    "https://city.gov/agendas": { status: 302, location: "https://public.destinyhosted.com/agenda_publish.cfm?id=1" },
  });
  const direct = await researchFetch("https://public.destinyhosted.com/agenda_publish.cfm?id=1", runtime);
  assert.equal(direct.outcome, "REFUSED");
  if (direct.outcome === "REFUSED") assert.match(direct.reason, /waits on the owner/);
  const viaRedirect = await researchFetch("https://city.gov/agendas", runtime);
  assert.equal(viaRedirect.outcome, "REFUSED");
  const wall = await researchFetch("https://go.boarddocs.com/az/x/Board.nsf/Public", runtime);
  assert.equal(wall.outcome, "REFUSED");
  if (wall.outcome === "REFUSED") assert.match(wall.reason, /a recorded wall/);
  assert.ok(!seen.some((u) => /destinyhosted\.com|boarddocs\.com/.test(u)), `nothing was sent to either: ${seen.join(", ")}`);
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
  // 2026-09-25: the module's transport, asked once more through curl as who we are on a 403
  // (lib/hunt/research-transport.ts). It is handed to researchFetch like the Node one, so robots.txt
  // is still read first and every redirect's origin asked again.
  assert.match(cli, /\n\s+get: identifiedResearchGet\(\),\n/, "it hands researchFetch the module's one transport");
  const lib = readFileSync("lib/hunt/robots-first-fetch.ts", "utf8");
  const transport = lib.slice(lib.indexOf("export const nodeResearchGet"), lib.indexOf("\n};", lib.indexOf("export const nodeResearchGet")));
  assert.equal((transport.match(/\bfetch\(/g) ?? []).length, 1, "one transport");
  assert.match(transport, /redirect: "manual"/, "the transport never follows a redirect itself");
  const second = readFileSync("lib/hunt/research-transport.ts", "utf8");
  assert.equal((second.match(/\bfetch\(/g) ?? []).length, 0, "the curl rung wraps the Node transport and has no fetch of its own");
  assert.match(second, /options\.first \?\? nodeResearchGet/, "the Node transport is asked first");
  assert.doesNotMatch(second, /"-L"|--location/, "curl never follows a redirect either");
  assert.match(readFileSync("package.json", "utf8"), /"research:fetch": "tsx scripts\/research-fetch\.mts"/);
});
