import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { ROBOTS_BLOCKS_ACQUISITION } from "../lib/control-plane/scheduler/robots.ts";
import { DEFAULT_USER_AGENT } from "../lib/control-plane/scheduler/user-agent.ts";
import {
  walkMeetingsDiscoveryNeed,
  type DiscoveryOpen,
  type DiscoveryRuntime,
} from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { accessControlIn, carriesCredential } from "../lib/hunt/access-control.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { RECORDED_WALLS } from "../lib/hunt/recorded-walls.ts";
import {
  OWNER_DECISION_HOSTS,
  memoryInProcess,
  researchFetch,
  type ResearchGet,
} from "../lib/hunt/robots-first-fetch.ts";
import { makePermissionGate, permittedText } from "../lib/sources/permission-gate.ts";
import { SourceHttpError, politeGetBytes, politeGetText, sourceUserAgent } from "../lib/sources/http.ts";
import { identifiedResearchGet } from "../lib/hunt/research-transport.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { InSiteSession } from "../lib/sources/legistar-insite/http.ts";
import { placePageReader } from "../lib/hunt/source-page-reader.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";

const DISALLOW_ALL = "User-agent: *\nDisallow: /\n";

/* ------------------------------------------------------------- 1. one home */

test("THE RULE HAS ONE HOME: ROBOTS_BLOCKS_ACQUISITION is false, no host waits on the owner for robots, and every recorded wall is an access control", () => {
  assert.equal(ROBOTS_BLOCKS_ACQUISITION, false);
  for (const h of OWNER_DECISION_HOSTS) {
    assert.doesNotMatch(h.why, /robots|disallow/i, `${h.host}: a host waits on the owner only for a real pending decision, never a robots line`);
  }
  for (const w of RECORDED_WALLS) {
    assert.match(w.why, /HTTP (401|403|407|429)|challenge|login|authenticat/i, `${w.host}: a recorded wall names the access control that walls it`);
    assert.doesNotMatch(w.why, /robots/i, `${w.host}: a robots line never makes a wall`);
  }
});

/* ------------------------------------------------ 2. read first, recorded */

test("THE RESEARCH FETCH reads robots.txt first, records a Disallow: / with its rule, and reads the public page", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const get: ResearchGet = async ({ url, headers }) => {
    seen.push({ url, headers: { ...headers } });
    const body = url.endsWith("/robots.txt") ? DISALLOW_ALL : "<html><title>Council agendas</title></html>";
    return { status: 200, body: new TextEncoder().encode(body), contentType: url.endsWith(".txt") ? "text/plain" : "text/html", location: null, transportError: null };
  };
  let clock = Date.parse("2026-09-25T18:00:00.000Z");
  const got = await researchFetch("https://agendas.example.gov/council", {
    get,
    memory: memoryInProcess(),
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
  });
  assert.equal(got.outcome, "FETCHED");
  if (got.outcome !== "FETCHED") return;
  assert.deepEqual(seen.map((s) => s.url), ["https://agendas.example.gov/robots.txt", "https://agendas.example.gov/council"]);
  assert.equal(got.permissions[0]?.verdict, "DISALLOWED");
  assert.equal(got.permissions[0]?.matchedRule, "Disallow: /");
  assert.equal(got.accessControl, null);
  for (const s of seen) {
    assert.equal(carriesCredential(s.headers), false);
    assert.equal(s.headers["user-agent"], DEFAULT_USER_AGENT);
  }
});

test("THE HUNTER PAGE READER saves the Disallow rule and still reads the government's page", async () => {
  const vault = new MemoryEvidenceStore();
  const saved: { url: string; key: string }[] = [];
  const seen: string[] = [];
  const pageUrl = "https://council.example.gov/meetings";
  const reader = placePageReader({
    now: () => "2026-10-20T12:00:00.000Z", workItemId: "wi-robots-hunter",
    attemptId: "att-robots-hunter", routeId: "own-site-meetings", canRead: () => true,
    spaceOut: async () => {},
    open: async ({ url }) => {
      seen.push(url);
      const body = url.endsWith("/robots.txt") ? DISALLOW_ALL : "<h1>City Council meetings</h1>";
      return { status: 200, body, bytes: Buffer.byteLength(body), contentType: url.endsWith(".txt") ? "text/plain" : "text/html",
        durationMs: 1, transportError: null };
    },
    vault: async (artifact, body) => {
      const stored = await putArtifact(vault, "freshness", artifact, Buffer.from(body));
      saved.push({ url: artifact.canonicalUrl, key: stored.key });
      return { stored: true, where: stored.key, why: "saved" };
    },
  });
  const page = await reader.read(pageUrl);
  assert.deepEqual(seen, ["https://council.example.gov/robots.txt", pageUrl]);
  assert.match(page?.html ?? "", /City Council meetings/);
  const robots = saved.find(record => record.url.endsWith("/robots.txt"));
  assert.ok(robots, "the robots response is retained in the evidence vault");
  const written = await vault.get(robots.key);
  assert.ok(written);
  assert.match(Buffer.from(written.bytes).toString("utf8"), /Disallow: \//);
  assert.equal(reader.cost.requestCount, 2);
  assert.ok(saved.some(record => record.url === pageUrl), "the disallowed public page is saved too");
});

test("THE ADAPTER PERMISSION GATE reads robots.txt once per origin, records the Disallow, and the page is read", async () => {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("authorization") || headers.has("cookie"), false, "no credential or cookie is ever sent");
    if (url.endsWith("/robots.txt")) return new Response(DISALLOW_ALL, { status: 200, headers: { "content-type": "text/plain" } });
    return new Response("<html><h1>Board meetings</h1></html>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const gate = makePermissionGate({ fetchImpl });
  const a = await permittedText(gate, "https://district.example.org/board/meetings", { fetchImpl });
  const b = await permittedText(gate, "https://district.example.org/board/agendas", { fetchImpl });
  assert.match(a, /Board meetings/);
  assert.match(b, /Board meetings/);
  assert.deepEqual(asked, [
    "https://district.example.org/robots.txt",
    "https://district.example.org/board/meetings",
    "https://district.example.org/board/agendas",
  ]);
  assert.deepEqual(gate.readings().map((r) => r.reading.verdict), ["DISALLOWED", "DISALLOWED"]);
});

type Reply = { readonly status: number; readonly body?: string; readonly contentType?: string; readonly location?: string };

function discoveryRuntime(map: Readonly<Record<string, Reply>>): { runtime: DiscoveryRuntime; seen: string[] } {
  const seen: string[] = [];
  const open: DiscoveryOpen = async ({ url, headers }) => {
    seen.push(url);
    assert.equal(carriesCredential(headers), false, "no credential or cookie is ever sent");
    assert.match(headers["user-agent"] ?? "", /we-the-people/, "every request identifies the project");
    const reply = map[url] ?? { status: 404, body: "not found" };
    const body = reply.body ?? "";
    return { status: reply.status, body, bytes: Buffer.byteLength(body), contentType: reply.contentType ?? "text/html", location: reply.location ?? null, transportError: null };
  };
  let tick = 0;
  return {
    seen,
    runtime: {
      open,
      spaceOut: async () => {},
      vault: async (artifact) => ({ stored: true, where: `vault/${artifact.id}`, why: "stored" }),
      now: () => new Date(Date.parse("2026-09-25T18:00:00.000Z") + (tick++) * 1000).toISOString(),
      budget: { spent: () => false },
    },
  };
}

function need(jurisdictionId: string, site: string): MeetingsDiscoveryNeed {
  return {
    jurisdictionId, stateCode: "AZ", name: jurisdictionId.toUpperCase(), govClass: "CITY_OR_TOWN", ownWebAddress: site,
    basis: "SOURCE_DISCOVERY_OWED", sources: ["MEETINGS:THIS_JURISDICTION:this-government-itself"],
  };
}

test("THE DISCOVERY WALK reads robots.txt first, records a Disallow: / on the step, and reads the homepage and the route it links", async () => {
  const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Council\r\nDTSTART:20261001T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const { runtime, seen } = discoveryRuntime({
    "https://closedtown.gov/robots.txt": { status: 200, body: DISALLOW_ALL, contentType: "text/plain" },
    "https://closedtown.gov/": { status: 200, body: `<a href="/meetings.ics">Meetings</a>` },
    "https://closedtown.gov/meetings.ics": { status: 200, body: ics, contentType: "text/calendar" },
  });
  const attempt = await walkMeetingsDiscoveryNeed(need("az:town:closedtown", "closedtown.gov"), runtime);
  assert.deepEqual(seen.slice(0, 2), ["https://closedtown.gov/robots.txt", "https://closedtown.gov/"]);
  for (const path of ["/agendas", "/meetings", "/calendar", "/sitemap.xml", "/meetings.ics"]) assert.ok(seen.includes(`https://closedtown.gov${path}`));
  assert.equal(attempt.outcome, "FOUND");
  assert.ok(attempt.steps.filter((s) => s.purpose !== "robots").every((s) => s.permission === "DISALLOWED"));
  for (const path of ["/", "/meetings.ics"]) assert.ok(attempt.steps.some(step => step.url === `https://closedtown.gov${path}` && step.status === 200));
});

/* ------------------------------------------- 3. access controls stay walls */

test("ACCESS CONTROLS ARE NAMED, NEVER PUSHED THROUGH: 401, 402, 403, 407, 429, 451 and a challenge page at any status", () => {
  for (const [status, kind] of [[401, "AUTHENTICATION"], [402, "PAYMENT"], [403, "FORBIDDEN"], [407, "AUTHENTICATION"], [429, "RATE_LIMIT"], [451, "LEGAL"]] as const) {
    assert.equal(accessControlIn({ status, text: "denied" })?.kind, kind, String(status));
  }
  assert.equal(accessControlIn({ status: 200, text: "<html><title>Just a moment...</title></html>" })?.kind, "CHALLENGE");
  assert.equal(accessControlIn({ status: 403, text: "<script>window._cf_chl_opt={}</script>" })?.kind, "CHALLENGE");
  assert.equal(accessControlIn({ status: 200, text: "<html><h1>Agenda</h1></html>" }), null);
  assert.equal(accessControlIn({ status: 404, text: "not found" }), null, "a missing page is not an access control");
  assert.equal(carriesCredential({ "user-agent": "x", Authorization: "Bearer t" }), true);
  assert.equal(carriesCredential({ "user-agent": "x", Cookie: "s=1" }), true);
  assert.equal(carriesCredential({ "user-agent": "x", accept: "text/html" }), false);
});

test("THE RESEARCH FETCH names each access control, sends each request once, and backs a rate-limited host off", async () => {
  const seen: string[] = [];
  const replies: Record<string, { status: number; body: string }> = {
    "https://guarded.example.gov/robots.txt": { status: 200, body: "User-agent: *\nAllow: /\n" },
    "https://guarded.example.gov/login": { status: 401, body: "Unauthorized" },
    "https://guarded.example.gov/waf": { status: 403, body: "Forbidden" },
    "https://guarded.example.gov/cf": { status: 200, body: "<html><title>Just a moment...</title></html>" },
    "https://guarded.example.gov/busy": { status: 429, body: "Too Many Requests" },
    "https://guarded.example.gov/next": { status: 200, body: "ok" },
  };
  const get: ResearchGet = async ({ url, headers }) => {
    seen.push(url);
    assert.equal(carriesCredential(headers), false);
    const r = replies[url] ?? { status: 404, body: "" };
    return { status: r.status, body: new TextEncoder().encode(r.body), contentType: "text/html", location: null, transportError: null };
  };
  const slept: number[] = [];
  let clock = Date.parse("2026-09-25T18:00:00.000Z");
  const runtime = { get, memory: memoryInProcess(), now: () => clock, sleep: async (ms: number) => void (slept.push(ms), (clock += ms)) };
  const kinds: (string | null)[] = [];
  for (const path of ["login", "waf", "cf", "busy"]) {
    const got = await researchFetch(`https://guarded.example.gov/${path}`, runtime);
    kinds.push(got.outcome === "FETCHED" ? (got.accessControl?.kind ?? null) : got.reason);
  }
  assert.deepEqual(kinds, ["AUTHENTICATION", "FORBIDDEN", "CHALLENGE", "RATE_LIMIT"]);
  for (const path of ["login", "waf", "cf", "busy"]) {
    assert.equal(seen.filter((u) => u.endsWith(`/${path}`)).length, 1, `${path} was asked once, never re-sent`);
  }
  await researchFetch("https://guarded.example.gov/next", runtime);
  assert.ok((slept.at(-1) ?? 0) >= 60_000, `a 429 backs the host off before it is asked anything else: ${slept.join(", ")}`);
});

test("THE DISCOVERY WALK honours a 429 at robots.txt (nothing more is asked) and records a homepage 403 as a wall, never re-sent", async () => {
  const limited = discoveryRuntime({
    "https://busytown.gov/robots.txt": { status: 429, body: "Too Many Requests" },
    "https://www.busytown.gov/robots.txt": { status: 429, body: "Too Many Requests" },
  });
  const a = await walkMeetingsDiscoveryNeed(need("az:town:busytown", "busytown.gov"), limited.runtime);
  assert.ok(limited.seen.every((u) => u.endsWith("/robots.txt")), `a rate limit is honoured: ${limited.seen.join(", ")}`);
  assert.equal(a.outcome, "COULD_NOT_READ");

  const walled = discoveryRuntime({
    "https://waftown.gov/robots.txt": { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" },
    "https://waftown.gov/": { status: 403, body: "Forbidden" },
    "https://www.waftown.gov/robots.txt": { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" },
    "https://www.waftown.gov/": { status: 403, body: "Forbidden" },
  });
  const b = await walkMeetingsDiscoveryNeed(need("az:town:waftown", "waftown.gov"), walled.runtime);
  assert.equal(b.outcome, "BLOCKED");
  assert.equal(walled.seen.filter((u) => u === "https://waftown.gov/").length, 1, "a 403 is asked once, never re-sent under another identity");
});

test("THE SHARED SOURCE CLIENT IS ONE HONEST IDENTITY: a 403 or a challenge is a wall, and the one second ask is the same name through curl", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const answering = (status: number, body: string) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
      return new Response(body, { status, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;

  await assert.rejects(politeGetText("https://waf.example.gov/a", { fetchImpl: answering(403, "Forbidden") }), (e: unknown) =>
    e instanceof SourceHttpError && e.status === 403 && /access control/.test(e.message));
  await assert.rejects(politeGetText("https://waf.example.gov/b", { fetchImpl: answering(200, "<html><title>Just a moment...</title></html>") }), (e: unknown) =>
    e instanceof SourceHttpError && /challenge/.test(e.message));
  await assert.rejects(politeGetBytes("https://waf.example.gov/c.pdf", { fetchImpl: answering(403, "Forbidden") }), (e: unknown) =>
    e instanceof SourceHttpError && e.status === 403);
  assert.deepEqual(seen.map((s) => s.url), ["https://waf.example.gov/a", "https://waf.example.gov/b", "https://waf.example.gov/c.pdf"], "each asked exactly once");
  for (const s of seen) {
    assert.equal(s.headers["User-Agent"], sourceUserAgent(), "the project's own identified User-Agent, every time");
    assert.equal(carriesCredential(s.headers), false);
    assert.ok(!Object.keys(s.headers).some((h) => /^sec-fetch-/i.test(h)), "no browser-navigation headers");
  }

  /* Rung 4: the same identity through curl, once; its challenge is the wall. */
  const curled: Record<string, string>[] = [];
  await assert.rejects(
    politeGetText("https://waf.example.gov/d", {
      fetchImpl: answering(403, "<html><title>Just a moment...</title></html>"),
      ladder: {
        curl: async (_url, headers) => {
          curled.push(headers);
          return { status: 200, contentType: "text/html", text: "<html><title>Just a moment...</title></html>" };
        },
      },
    }),
    (e: unknown) => e instanceof SourceHttpError && e.rung === 4 && /challenge/.test(e.message),
  );
  assert.equal(curled.length, 1, "one second ask, never a third");
  assert.equal(curled[0]["User-Agent"], sourceUserAgent(), "as who we are");
  assert.equal(carriesCredential(curled[0]), false);
});

test("THE RESEARCH TRANSPORT'S SECOND ASK IS WHO WE ARE: a 403 is asked once more through curl with the same User-Agent, and a refusal there stands", async () => {
  const args: string[][] = [];
  const get = identifiedResearchGet({
    first: async () => ({ status: 403, body: new Uint8Array(0), contentType: "text/html", location: null, transportError: null }),
    curl: async (a) => {
      args.push([...a]);
      return Buffer.from("HTTP/1.1 403 Forbidden\r\ncontent-type: text/html\r\n\r\n<title>Just a moment...</title>");
    },
  });
  const got = await get({ url: "https://waf.example.gov/", headers: { "user-agent": DEFAULT_USER_AGENT, accept: "text/html" }, timeoutMs: 5_000 });
  assert.equal(got.status, 403, "the refusal stands; nothing answers the challenge");
  assert.equal(args.length, 1);
  const headerValues = args[0].filter((_, i) => args[0][i - 1] === "-H");
  assert.ok(headerValues.includes(`user-agent: ${DEFAULT_USER_AGENT}`), "the same identified User-Agent");
  assert.ok(!headerValues.some((h) => /mozilla|chrome/i.test(h)), "never a browser's");
  assert.ok(!args[0].includes("-L"), "never follows a redirect");
});

test("NO WIRING ROW ASKS FOR A DISGUISE", () => {
  const browserRows = FIXTURE_DOOR_ROWS.filter((row) => row.config.profile !== undefined).map((row) => row.bodyId);
  assert.deepEqual(browserRows, [], "the browser profile dressed the client as a browser to get past a refusal; it is retired");
});

test("A PORTAL'S SESSION COOKIE GOES BACK ONLY TO THE HOST THAT SET IT, never to the vendor's document host", async () => {
  const sent: { url: string; cookie: string | null }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({ url: String(url), cookie: headers.Cookie ?? headers.cookie ?? null });
    const setCookie: Record<string, string> = String(url).startsWith("https://mesa.legistar.com/") ? { "set-cookie": "ASP.NET_SessionId=abc; path=/; HttpOnly" } : {};
    const pdf = String(url).endsWith(".pdf");
    return new Response(pdf ? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) : "<html>Calendar</html>", {
      status: 200,
      headers: { "content-type": pdf ? "application/pdf" : "text/html", ...setCookie },
    });
  }) as unknown as typeof fetch;
  const session = new InSiteSession({ fetchImpl });
  await session.get("https://mesa.legistar.com/Calendar.aspx");
  await session.getBytes("https://legistar.granicus.com/mesa/meetings/2026/9/x_Minutes.pdf");
  await session.get("https://mesa.legistar.com/MeetingDetail.aspx?ID=1");
  assert.deepEqual(sent.map((s) => s.cookie), [null, null, "ASP.NET_SessionId=abc"]);
});

const DISGUISES: readonly RegExp[] = [
  /Mozilla\/5\.0 \((Windows|Macintosh|X11|Linux|iPhone|iPad)/,
  /\bChrome\/\d{2,3}\./,
  /HeadlessChrome/,
  /["']?user-agent["']?\s*:\s*["']Mozilla/i,
];

test("NO PRODUCTION MODULE CARRIES A BORROWED IDENTITY", () => {
  const offenders = (files: readonly string[]) =>
    files.map((f) => f.replace(/\\/g, "/")).filter((f) => {
      const text = code(readFileSync(join(ROOT, f), "utf8"));
      return DISGUISES.some((p) => p.test(text));
    });
  assert.deepEqual(offenders([...sources("lib"), ...sources("app"), "scripts/ingest.ts"]), [], "production code sends one honest client");
});

/* --------------------------------------------- 4. every consumer is named */

const ROOT = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    const stat = statSync(join(ROOT, rel));
    if (stat.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      out.push(...sources(rel));
    } else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.test\./.test(name)) {
      out.push(rel);
    }
  }
  return out;
}

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const ROBOTS_CONSUMERS: Readonly<Record<string, string>> = {
  "lib/control-plane/scheduler/robots.ts": "the evaluator itself (tests/scout-tools.test.ts evaluator cases)",
  "lib/ballot/voting-source-fetch.ts": "VS-01 honors robots.txt: tests/voting-source-readers.test.ts blocks disallowed pages and keeps their hunter blanks open",
  "lib/hunt/robots-first-fetch.ts": "tests/robots-first-fetch.test.ts, this file",
  "lib/hunt/source-page-reader.ts": "this file: THE HUNTER PAGE READER saves the Disallow rule and still reads the government's page",
  "lib/sources/permission-gate.ts": "this file, tests/pima-edu-source.test.ts",
  "lib/sources/pima-edu/index.ts": "via the gate: tests/pima-edu-source.test.ts",
  "lib/sources/suiteone/index.ts": "via the gate: tests/suiteone-source.test.ts",
  "lib/sources/document-listing/index.ts": "via the gate: tests/document-listing-source.test.ts",
  "lib/sources/diligent/index.ts": "via the gate: tests/tusd-schedule-union.test.ts",
  "lib/sources/smartsites/index.ts": "via the gate: tests/smartsites-source.test.ts",
  "lib/sources/tusd-govboard/index.ts": "via the gate: tests/tusd-govboard-source.test.ts",
  "lib/control-plane/scheduler/scout-tools.ts": "tests/scout-tools.test.ts",
  "lib/control-plane/scheduler/model-routing.ts": "catalogue text only; no fetch",
  "lib/control-plane/discovery/meetings-discovery-executor.ts": "this file, tests/meetings-discovery-executor.test.ts",
  "lib/control-plane/promotion/campaign-publication-cycle.ts": "tests/campaign-site-runner.test.ts: a disallowed linked publication is captured with its robots verdict",
  "lib/candidates/campaign-site-verifier.ts": "tests/campaign-site-verifier.test.ts",
  "lib/civic-data/website-correction-acquisition.ts": "tests/website-corrections.test.ts",
  "lib/control-plane/leads/plain-test.ts": "tests/research-leads.test.ts: a lead whose robots.txt disallows us is read, works, and carries the verdict",
  "lib/method/method-try.ts": "tests/method-spread.test.ts: a disallowed site's request is still made and its verdict counted",
  "scripts/robots-sweep.mts": "records verdicts only; its consumers below",
  "scripts/verify-extraction.mts": "records the verdict on each result; never skips a roster for one",
  "scripts/research-fetch.mts": "the command line over researchFetch (tests/robots-first-fetch.test.ts)",
};

const CONSUMES = /\b(evaluatePermission|judgeUrl|makePermissionGate|researchFetch)\b/;

test("EVERY ROBOTS CONSUMER IS NAMED with the test that holds it to the rule, and none has gone missing", () => {
  const found = [...sources("lib"), ...sources("scripts"), ...sources("app")]
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => CONSUMES.test(code(readFileSync(join(ROOT, f), "utf8"))));
  const unnamed = found.filter((f) => !(f in ROBOTS_CONSUMERS));
  assert.deepEqual(unnamed, [], `name each new robots consumer in ROBOTS_CONSUMERS with the test that holds it to its applicable acquisition rule: ${unnamed.join(", ")}`);
  const stale = Object.keys(ROBOTS_CONSUMERS).filter((f) => !found.includes(f));
  assert.deepEqual(stale, [], `these no longer consume the evaluator; drop them from the list: ${stale.join(", ")}`);
});

/** The refusal messages the old rule produced. None may return in code (comments and tests may quote them). */
const OLD_REFUSALS: readonly RegExp[] = [
  /not requested: robots\.txt/,
  /not requested: permission \$\{/,
  /Nothing was requested from this path/,
  /so \$\{tool\} did not open it/,
  /code: "ROBOTS_REFUSED"/,
];

test("THE OLD ROBOTS REFUSALS DO NOT RETURN in production code", () => {
  const offenders: string[] = [];
  for (const f of [...sources("lib"), ...sources("scripts"), ...sources("app")]) {
    const text = code(readFileSync(join(ROOT, f), "utf8"));
    for (const pattern of OLD_REFUSALS) if (pattern.test(text)) offenders.push(`${f.replace(/\\/g, "/")}: ${pattern}`);
  }
  assert.deepEqual(offenders, []);
});
