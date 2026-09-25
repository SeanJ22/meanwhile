import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../../lib/method/learn-batch.ts";
import { today } from "../doc-dates.mjs";

/**
 * `pnpm method:learn-robots-recorded-not-blocking` — THE METHOD THE OWNER
 * DECISION OF 2026-09-25 CHANGES, SAVED WHERE THE NEXT WORKER LOOKS.
 *
 * Sean, 2026-09-25: "Robots.txt alone must not block acquisition. I explicitly
 * authorize automated reading of publicly accessible pages even when robots.txt
 * requests otherwise. … This authorization does not extend to bypassing
 * authentication or other access controls." (Recorded in docs/rulings.md.)
 *
 * Several routes in this store say a robots disallow is permanent and never
 * re-walked ("DO NOT RE-WALK THIS ON A CLOCK"). This batch records the method
 * that replaces that instruction, and the re-measures made the same day, so a
 * later session applies the new rule instead of the old notes.
 */

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "robots-txt-is-recorded-never-a-gate",
    title:
      "read robots.txt first and RECORD it with the read — then read the public page anyway; only an access control (login, 403 or challenge, 429) stops a route, and it is never bypassed",
    tier: "A0",
    fields: ["meeting", "agenda", "source", "document"],
    note:
      "Owner decision 2026-09-25: robots.txt alone must not block acquisition of a publicly accessible page. The " +
      "method: (1) read the host's robots.txt before anything else on it, following its redirects, and record the " +
      "verdict, the matched rule, the document's sha256 and when it was read — it travels with the page as evidence " +
      "(lib/hunt/robots-first-fetch.ts, lib/sources/permission-gate.ts, the scout tools, the discovery walk); (2) " +
      "honour Crawl-delay as spacing; (3) request the public page whatever the verdict; (4) judge the page's own " +
      "answer for an access control (lib/hunt/access-control.ts: 401/407 authentication, 402 paywall, 403 or a bot " +
      "challenge such as a CAPTCHA or Cloudflare interstitial, 429 rate limit, 451) — that is a wall, recorded, never " +
      "defeated: no credential, cookie or session is sent, no challenge is solved, a 429 backs the host off, and the " +
      "next move is another public route (the body's own site, a feed, an API, an archive). A route, a partition, a " +
      "host list or a field-manual dead door that exists ONLY because of a robots line is re-opened. SUPERSEDES the " +
      "never-re-walk instructions in agenda-vendor-portal-blanket-robots-disallow, " +
      "diligent-community-robots-is-a-named-crawler-allowlist and a-sites-file-host-carries-its-own-robots: their " +
      "robots readings stay true as evidence, their 'no permitted route' conclusions do not.",
    origin:
      "the owner's pasted instruction of 2026-09-25 to the Admin completion session, implemented on branch " +
      "claude/ac-robots-not-blocking; every gate that refused on a robots verdict was found by searching lib/ and " +
      "scripts/ for the verdicts and their consumers, and re-pointed to record instead.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "One robots.txt read per origin per run, as before; the only change is that the verdict no longer ends the walk.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 1,
      outcome: "YIELDED",
      note:
        "Re-measured 2026-09-25 through the research fetch: Chandler's agenda index on public.destinyhosted.com " +
        "(agenda_publish.cfm?id=24263) answered HTTP 200, 49,031 B, the September 2026 list of every meeting type " +
        "with a per-sitting agenda link — readable, and until today held for the owner over its robots line alone.",
    },
    claims: [
      {
        id: "robots-txt-is-recorded-never-a-gate#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A public page whose host's robots.txt disallows it is read, with the robots verdict, rule and read time recorded beside it.",
        restsOn: [],
      },
      {
        id: "robots-txt-is-recorded-never-a-gate#chandler-destiny",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-25 public.destinyhosted.com/agenda_publish.cfm?id=24263 answered HTTP 200 with Chandler's September 2026 meeting list and per-sitting agenda links.",
        restsOn: ["robots-txt-is-recorded-never-a-gate#exists"],
      },
    ],
  },
  {
    id: "an-access-control-is-the-wall-not-the-robots-line",
    title:
      "when a route stays closed after robots stops blocking, name the access control that closes it — and re-measure, because a host that answered last month may challenge today",
    tier: "B",
    fields: ["source"],
    note:
      "Two general search engines excluded since 2026-08-25 for 'Disallow: /search' alone were re-measured on " +
      "2026-09-25 once robots.txt stopped blocking: www.mojeek.com now answers its query path with a CAPTCHA page " +
      "(HTTP 200, 5,513 B, <title>Captcha</title>, 'JavaScript is required to complete this challenge') and " +
      "search.brave.com with HTTP 429. Both stay out — as WALLED, for an access control, never bypassed. The " +
      "CAPTCHA page was not recognised by the challenge signatures until that day (a 200 is not a document); it is " +
      "now (lib/sources/challenge-signatures.ts). The transferable lesson: lifting a robots gate does not open a " +
      "route by itself; re-read the route and record what actually answers.",
    origin: "the search-pool exclusions (lib/hunt/search-pool.ts) revisited under the owner decision of 2026-09-25.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "One research-fetch read per engine, robots.txt first.",
    },
    outcome: {
      jurisdiction: "us",
      rows: 0,
      outcome: "BLOCKED",
      note: "Mojeek: CAPTCHA at HTTP 200. Brave: HTTP 429. Both WALLED on 2026-09-25; neither is solved or pushed through.",
    },
    claims: [
      {
        id: "an-access-control-is-the-wall-not-the-robots-line#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A route closed only by robots.txt is re-read and closed again only if an access control answers it.",
        restsOn: [],
      },
      {
        id: "an-access-control-is-the-wall-not-the-robots-line#search-engines",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-25 www.mojeek.com answered its search path with a CAPTCHA page and search.brave.com with HTTP 429.",
        restsOn: ["an-access-control-is-the-wall-not-the-robots-line#exists"],
      },
    ],
  },
  {
    id: "a-refusal-of-the-identified-client-is-a-wall-not-a-rung",
    title:
      "when a host refuses the project's identified client (403, a bot challenge, an IP block), record the wall and find another public route — never re-send as a browser, without our name, through another TLS client or from someone else's address",
    tier: "A0",
    fields: ["meeting", "agenda", "source", "document"],
    note:
      "The same owner decision (2026-09-25) that made robots.txt a record says the authorization 'does not extend to " +
      "bypassing authentication or other access controls'. A WAF or bot filter that refuses an identified client is an " +
      "access control. So the ladder rungs that got past one are retired: the Chrome browser header set (rung 3), the " +
      "Chrome User-Agent without the project's name (rung 3b), curl for a different TLS fingerprint (rung 4), the " +
      "third-party relay from other addresses (rung 5, lib/hunt/egress.ts), wiring rows asking for a browser profile, " +
      "and a route descriptor leaving the name out of its User-Agent. lib/sources/http.ts now sends one identified " +
      "client once; a 401/403/407 or a challenge page throws a SourceHttpError naming the access control; the partition " +
      "keeps its last good version. The next move is another PUBLIC route to the same record: the body's own feed on " +
      "another host, a county or state posting, a vendor portal the body also uses, an archive, the statutory notice. " +
      "Guarded by tests/robots-recorded-not-blocking.test.ts (production code carries no borrowed identity; the " +
      "session scripts that still do are a named list that may only shrink).",
    origin:
      "the coordinator's instruction applying the owner decision of 2026-09-25 to the disguising fallbacks in " +
      "lib/sources/http.ts; the dependency was measured from production candidate records and a live identified probe " +
      "of all 41 wired URLs, robots.txt read first.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "One identified request per route; the work is finding the alternative public route for each walled host.",
    },
    outcome: {
      jurisdiction: "nh",
      rows: 0,
      outcome: "BLOCKED",
      note:
        "Measured 2026-09-25: www.newbury.nh.gov (ICAL export.ics, 15 bodies, and 3 schedule pages), www.suttonnh.gov " +
        "(ICAL, 8 bodies) and www.kearsarge.org (school board) answer the identified client HTTP 403 with a bot " +
        "challenge. Their partitions keep their last good versions; another public route is owed for each.",
    },
    claims: [
      {
        id: "a-refusal-of-the-identified-client-is-a-wall-not-a-rung#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A host that refuses the identified client is recorded as a wall and pursued by another public route; the request is never re-sent under another identity, client or address.",
        restsOn: [],
      },
      {
        id: "a-refusal-of-the-identified-client-is-a-wall-not-a-rung#nh-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-25 www.newbury.nh.gov, www.suttonnh.gov and www.kearsarge.org answered the identified client HTTP 403 with a bot challenge.",
        restsOn: ["a-refusal-of-the-identified-client-is-a-wall-not-a-rung#exists"],
      },
    ],
  },
];

runLearnBatch(STORE, ROUTES, today());
