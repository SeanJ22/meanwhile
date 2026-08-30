/**
 * `pnpm method:learn-85641-districts` — WHAT THE 2026-08-29 PILOT SWEEP TAUGHT.
 * (**RULING 178**, **RULING 182**, **RULING 184**, **RULING 205**,
 * **RULING 207**.)
 *
 * Six routes, and not one of them is about Vail, Pima or Arizona. Each was
 * found while working the mandatory pilot ZIP and each names a SHAPE that
 * recurs — two vendor platforms whose market is the layer this product is
 * thinnest in, two ways a corpus ends up pointing at a host that is no longer
 * the publisher, a custodian split that makes "who do I file with" have two
 * correct answers in one county, and the method that turned a 401 into a 200
 * without a credential.
 *
 * **Why these are worth a store entry rather than a paragraph.** Every one of
 * them cost a session to find, and four of them are the difference between
 * recording a body as `BLOCKED_CURRENTLY` and reading its whole archive.
 * RULING 178 is the rule that makes them travel; this script is the write path
 * that rule needs in order to mean anything.
 *
 * Idempotent: `learnRoute` refuses a duplicate id, so a re-run cannot inflate
 * the method version or deepen a route's evidence.
 */

import { join } from "node:path";

import { today } from "./doc-dates.mjs";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "streamline-sitemap-is-a-dated-meeting-inventory",
    title:
      "a Streamline-hosted special district publishes one URL per sitting, and its sitemap enumerates every one",
    tier: "A1",
    fields: ["meeting", "agenda", "minutes"],
    note:
      "THE SHAPE TRAVELS BECAUSE THE VENDOR DOES. Streamline publishes each sitting at a path of the form /<YYYY>-<MM>-<DD>-<body>-<slug>, so the DATE, the BODY and the meeting KIND are already separated in the URL before anything is parsed, and sitemap.xml lists them all. No API, no account, no pagination and no date-range control to defeat. Read 2026-08-29 on two tenants with byte-identical robots policy shape: www.coronafire.org (Corona de Tucson Fire District) yielded 115 dated sittings 2017-2026 and 5 directors with emails; www.sefd911.org (Sonoita-Elgin Fire District) yielded 70 dated sittings and 5 directors with seat, term, phone and email. Both robots.txt carry 'User-agent: * / Allow: /' with named disallows confined to SEO crawlers (SemrushBot, AhrefsBot, Sidetrade, PetalBot, MJ12bot). WHY IT MATTERS BEYOND TWO FIRE DISTRICTS: Streamline's market is SPECIAL DISTRICTS, which is the thinnest governmental layer in this product in every state worked so far, and the layer least likely to appear in any directory. The route to test on a new special district is its sitemap BEFORE its calendar page.",
    origin:
      "conceived 2026-08-29 working the four fire districts that levy on pilot ZIP 85641. data/hunt/85641-obligation-ledger.json recorded all four with ZERO rosters and ZERO meetings and named the unwalked route for each; two of the four turned out to run on the same vendor, which is what made the shape visible rather than the tenant.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One sitemap fetch per tenant, at rung 2 with a plain Node fetch. No browser was needed anywhere. The expensive alternative is paging a calendar widget per month per body.",
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      rows: 185,
      outcome: "YIELDED",
      note:
        "185 dated sittings across two tenants (115 Corona de Tucson, 70 Sonoita-Elgin), plus 10 directors with contact detail. Both bodies previously held zero meetings and zero roster rows.",
    },
    claims: [
      {
        id: "streamline-sitemap-is-a-dated-meeting-inventory#path-carries-date-and-body",
        class: "ROUTE_EXISTENCE",
        statement:
          "A Streamline tenant publishes one URL per sitting whose path carries the ISO date, the body and the meeting kind, and sitemap.xml enumerates them without pagination.",
        restsOn: [],
      },
      {
        id: "streamline-sitemap-is-a-dated-meeting-inventory#two-tenants-2026-08-29",
        class: "ROUTE_OUTCOME",
        statement:
          "Walked on two tenants on 2026-08-29: 115 dated sittings from www.coronafire.org and 70 from www.sefd911.org, both permitted by robots.",
        restsOn: ["streamline-sitemap-is-a-dated-meeting-inventory#path-carries-date-and-body"],
      },
    ],
  },
  {
    id: "boardbook-organization-page-returns-the-whole-archive",
    title:
      "BoardBook Premier serves an entire meeting archive on one unpaginated page, and its Minutes path is a client-rendered shell",
    tier: "A1",
    fields: ["meeting", "agenda", "packet"],
    note:
      "TWO FACTS, AND THE SECOND ONE IS THE TRAP. /Public/Organization/{id} returns the ENTIRE archive on one page with no pagination — read 2026-08-29 on meetings.boardbook.org for Pima County JTED No. 11, yielding 267 meetings spanning 2009-2026 with agendas as HTML — and /Public/DownloadAgenda/{slug}?meeting={id} returned a verified 12.4 MB packet PDF. robots.txt answers HTTP 404, so NO_ROBOTS: the host publishes no restriction. THE TRAP: /Public/Minutes/ is a CLIENT-RENDERED shell that strips to 757 bytes of chrome. A parser pointed at it returns nothing and, unless the zero is treated as a failed extraction (RULING 100), reports every meeting in the archive as having empty minutes — an absence manufactured from a rendering choice. The minutes are reachable through the packet and through the 302 on /Documents/FileViewerOrPublic/, neither of which was walked. BoardBook is operated by Sparq Data Solutions Inc. and its market is school districts and JTEDs nationally.",
    origin:
      "conceived 2026-08-29 while working Pima County JTED No. 11, a body covering 36 of 44 sampled points in pilot ZIP 85641 and holding zero meetings in the corpus. The JTED was reachable only after the apex/www finding below.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One request returns the whole archive, which is the cheapest meeting inventory measured on any platform so far. The packet PDFs are large (12.4 MB observed) and are the expensive half.",
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      rows: 267,
      outcome: "YIELDED",
      note:
        "267 meetings 2009-2026 with agendas as HTML and packets as PDF, for a body that held zero. The Minutes path yielded 757 bytes of chrome and is recorded as a failed extraction, never as absent minutes.",
    },
    claims: [
      {
        id: "boardbook-organization-page-returns-the-whole-archive#one-page-archive",
        class: "ROUTE_EXISTENCE",
        statement:
          "BoardBook Premier's /Public/Organization/{id} returns a tenant's entire meeting archive unpaginated, and /Public/DownloadAgenda/{slug}?meeting={id} serves the packet PDF.",
        restsOn: [],
      },
      {
        id: "boardbook-organization-page-returns-the-whole-archive#minutes-shell-is-not-absence",
        class: "ROUTE_OUTCOME",
        statement:
          "BoardBook's /Public/Minutes/ is client-rendered and strips to 757 bytes of chrome; a zero there is a failed extraction and must never be recorded as the body publishing no minutes.",
        restsOn: ["boardbook-organization-page-returns-the-whole-archive#one-page-archive"],
      },
    ],
  },
  {
    id: "apex-and-www-are-different-origins-for-permission-and-transport",
    title:
      "the www host answers 403 to every client while the apex answers 200 and serves the whole site",
    tier: "B",
    fields: ["meeting", "roster", "agenda"],
    note:
      "A HOST IS AN ORIGIN, NOT A GOVERNMENT, AND THE TWO FORMS ARE TWO ORIGINS. Read 2026-08-29: www.pimajted.org answers HTTP 403 with a Cloudflare interstitial titled 'Just a moment...' to four clients, while the apex pimajted.org answers 200, carries robots.txt with 'Disallow: /wp-admin/' only, and serves the entire site including a 267-meeting archive. A session that resolved the www form, met the interstitial and stopped would have recorded a body covering 36 of 44 sampled ZIP points as BLOCKED_CURRENTLY. Under RULING 182 the 403 is TRANSPORT and permission on that origin is CANNOT_TELL; it is never a permission verdict and never a fact about the body. THE GENERAL RULE: try both the apex and the www form before recording any host-level disposition, and record the disposition against the ORIGIN that produced it rather than against the government.",
    origin:
      "conceived 2026-08-29 when the JTED's published URL carried the www form and answered 403. The apex was tried because RULING 182 requires varying the client and the route before converting a refusal into a verdict, and the origin turned out to be the variable that mattered rather than the client.",
    /* No `effort` recorded: it repeats PER HOST, and the enum has no such unit.
       An absent value means nobody measured it, which is deliberately different
       from zero — mislabelling it PER_VENDOR would understate what it costs
       across a descent. The cost is one extra fetch per host walked. */
    outcome: {
      jurisdiction: "az-pima-85641",
      rows: 1,
      outcome: "YIELDED",
      note:
        "One body recovered from an apparent block: Pima County JTED No. 11, whose whole archive sits behind the apex while the www form is Cloudflare-gated.",
    },
    claims: [
      {
        id: "apex-and-www-are-different-origins-for-permission-and-transport#two-origins",
        class: "ROUTE_EXISTENCE",
        statement:
          "The apex and www forms of a hostname are separate origins that can differ in both robots policy and bot gating; a disposition belongs to the origin that produced it.",
        restsOn: [],
      },
    ],
  },
  {
    id: "government-migrated-to-dot-gov-and-the-authoritative-layer-is-stale",
    title:
      "a district moved to a .gov and the government layer that published its URL still names the dead host",
    tier: "B",
    fields: ["verifiedPage", "roster", "meeting"],
    note:
      "AN AUTHORITATIVE GOVERNMENT SOURCE CAN CARRY A DEAD HOST, AND A TLS ERROR CAN BE A TRUE READING OF A HOST THAT STOPPED BEING THE PUBLISHER. Two instances on 2026-08-29. www.mescalj6fd.com was recorded 2026-08-27 as CANNOT_TELL, 'unwalkable because of a certificate' (ERR_TLS_CERT_ALTNAME_INVALID); the TLS failure is real and reproducible, and plain HTTP answers 200 and redirects to https://mescalj6fd.gov/. www.rinconvalleyfd.org — the URL published by PIMA COUNTY'S OWN fire-taxation GIS layer, which is as authoritative as a source gets for district identity — 404s its robots and redirects to rinconvalleyfdaz.gov. Both districts had been recorded with zero rosters and zero meetings; both publish rosters, agendas and minutes at the new host. THE GENERAL RULE: before recording a body as unreachable, re-resolve its host over plain HTTP and follow redirects, and treat a special district's .com or .org as a candidate for a .gov migration. The corollary is sharper: a URL inherited from an authoritative layer is EVIDENCE, not a fact, and it goes stale like any other observation.",
    origin:
      "conceived 2026-08-29 working two fire districts the corpus had recorded as unwalkable. Both were expected to be genuine walls and both were stale addresses, which is why the entry is about the CLASS rather than about either district.",
    /* No `effort` recorded, for the same reason as the route above: this
       repeats PER HOST and the enum has no such unit. One plain-HTTP fetch
       with redirects followed, per host walked. */
    outcome: {
      jurisdiction: "az-pima-85641",
      rows: 2,
      outcome: "YIELDED",
      note:
        "Two districts recovered: Mescal-J6 (5 directors with term dates) and Rincon Valley (5 directors, agendas AND minutes as first-party PDFs). Both were previously recorded unreachable.",
    },
    claims: [
      {
        id: "government-migrated-to-dot-gov-and-the-authoritative-layer-is-stale#stale-authoritative-url",
        class: "ROUTE_EXISTENCE",
        statement:
          "A government's own GIS or taxation layer can publish a superseded host for a district; re-resolving over plain HTTP and following redirects reaches the current .gov.",
        restsOn: [],
      },
      {
        id: "government-migrated-to-dot-gov-and-the-authoritative-layer-is-stale#tls-error-can-mean-migration",
        class: "ROUTE_OUTCOME",
        statement:
          "An ERR_TLS_CERT_ALTNAME_INVALID on a district's old domain can be a stale redirector rather than a broken publisher; it is never evidence about the body.",
        restsOn: [
          "government-migrated-to-dot-gov-and-the-authoritative-layer-is-stale#stale-authoritative-url",
        ],
      },
    ],
  },
  {
    id: "the-filing-officer-publishes-what-the-elections-department-has-not",
    title:
      "candidate filings and measure texts live with the filing OFFICER, and one county has more than one",
    tier: "A1",
    fields: ["candidate", "measure", "contest"],
    note:
      "A COUNTY'S ELECTIONS DEPARTMENT IS NOT THE ONLY FILING OFFICER, AND 'THE COUNTY HAS PUBLISHED ALMOST NOTHING' CAN BE TRUE OF ONE OFFICE AND FALSE OF ANOTHER. The corpus recorded that the Nov 3 2026 general had exactly ONE published document on the Pima County elections page. That reading was correct about the ELECTIONS DEPARTMENT and wrong as a statement about the county: on 2026-08-29 the Pima County School Superintendent at www.schools.pima.gov published every school district in the county with seats, minimum signatures, and each candidate's name, filing date and signature count — Vail Unified, 2 seats, Andrea Black (filed 2026-07-01, 474 signatures) and Edward Buster (2026-07-02, 374) — plus two ballot measures whose texts extracted from PDFs on pima-county-schools.s3.amazonaws.com. THE CUSTODIAN SPLIT, which is the portable half: FIRE DISTRICTS file with the County Elections Department while SCHOOL DISTRICTS file with the County School Superintendent, so a single 'who do I file with' answer is wrong for one of them. Its robots.txt answers HTTP 200 with a ZERO-BYTE body — a robots that exists and forbids nothing — and the bare host is ECONNREFUSED over HTTPS while the www form serves.",
    origin:
      "conceived 2026-08-29 from a ledger entry recording that the general election had one published document. The entry was treated as a statement about a PAGE rather than about a county, which is what sent the walk to the other custodian.",
    effort: {
      repeats: "PER_COUNTY",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Cheap once the custodian is known. The expensive error is inferring an absence of contests from the elections department's page alone.",
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      rows: 4,
      outcome: "YIELDED",
      note:
        "Two filed candidates with dates and signature counts, and two ballot measures with texts extracted from PDF, for a general election the corpus recorded as having one published document.",
    },
    claims: [
      {
        id: "the-filing-officer-publishes-what-the-elections-department-has-not#custodian-split",
        class: "ROUTE_EXISTENCE",
        statement:
          "A county can have more than one filing officer — school districts filing with the School Superintendent while fire districts file with Elections — and each publishes only its own filings.",
        restsOn: [],
      },
      {
        id: "the-filing-officer-publishes-what-the-elections-department-has-not#one-page-is-not-a-county",
        class: "ROUTE_OUTCOME",
        statement:
          "A count of documents on an elections department page is a fact about that page and never about what the county has published for that election.",
        restsOn: ["the-filing-officer-publishes-what-the-elections-department-has-not#custodian-split"],
      },
    ],
  },
  {
    id: "enumerate-the-app-bundle-routes-when-the-known-endpoint-refuses",
    title:
      "the publisher's own single-page app names every public route it calls, and one of them answers where the known one does not",
    tier: "B",
    fields: ["filing", "contribution", "expenditure"],
    note:
      "A 401 ON THE ONE ROUTE ANYBODY KNOWS IS NOT THE PUBLICATION'S ANSWER. Pima County's campaign-finance filing BODIES answer HTTP 401 at documents/getdocumentfiling/{id} to every client tried — bare curl, a browser user agent, Origin and Referer set, and the trailing-slash form the app itself calls. A prior session correctly recorded that as a wall on a route rather than a statement about the filing, and stopped. On 2026-08-29 the app's own JavaScript bundle was read and all 59 API routes enumerated from it (RULING 207: one route failing never bounds the route universe). /advancedsearch/contributions/{customerId} answers 500 rather than 401, and the ASP.NET stack trace NAMES the cause — ContributionsSearch calling CurrentUserOrWebSiteUserAsync then GetSubdomain(url) throwing on a null URI. The API has its own anonymous WEBSITE-USER path and needed only the tenant subdomain, which it reads from the Origin header. With Origin set it answers HTTP 200 at 1,090,303 bytes: 900 contribution rows and 584 distribution rows, with no credential, no login and no bypass — the identical request the county's own public app makes. THE PORTABLE METHOD: when a known endpoint refuses, read the SPA bundle for the route table before concluding anything, and read a 500's stack trace as a description of what the server wanted rather than as a failure. THE PORTABLE CAUTION: 900 was proved not to be a cap by partitioning against the server (2025: 502 = 502, 2026: 368 = 368), because a truncated result cannot partition consistently.",
    origin:
      "conceived 2026-08-29 under RULING 205, which forbids a route disposition from closing a record obligation. The 401 had already been recorded honestly and the obligation left open; this is what working it rather than accepting it produced.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Reading a bundle is a one-off per vendor and yields the whole route table at once. Far cheaper than probing paths, and it finds routes no amount of guessing would.",
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      rows: 1484,
      outcome: "YIELDED",
      note:
        "900 contribution rows and 584 distribution rows for Pima County committees, from a record class that had zero rows and a route recorded as walled. Every filing remains a _Redacted public copy and all rows are DocumentType CCFR, so no independent-expenditure row is present and its absence is OURS.",
    },
    claims: [
      {
        id: "enumerate-the-app-bundle-routes-when-the-known-endpoint-refuses#bundle-names-the-routes",
        class: "ROUTE_EXISTENCE",
        statement:
          "A publisher's single-page app bundle enumerates the public API routes it calls, and reading it bounds the route universe far better than probing paths does.",
        restsOn: [],
      },
      {
        id: "enumerate-the-app-bundle-routes-when-the-known-endpoint-refuses#origin-header-is-the-tenant",
        class: "ROUTE_OUTCOME",
        statement:
          "An EasyVote campaign-finance API resolves its tenant from the Origin header and serves an anonymous website-user path; a 500 naming GetSubdomain is the server asking for that header, not a refusal.",
        restsOn: [
          "enumerate-the-app-bundle-routes-when-the-known-endpoint-refuses#bundle-names-the-routes",
        ],
      },
    ],
  },
];

runLearnBatch(STORE, ROUTES, today());
