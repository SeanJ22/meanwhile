/**
 * `pnpm method:learn-vail-agenda` — WHAT THE VAIL AGENDA HUNT TAUGHT.
 * (2026-08-27. **RULING 178**, **RULING 182**, **RULING 184**, **RULING 100**.)
 *
 * Four routes, and the headline result of two of them is a PERMISSION VERDICT
 * rather than a fact. That is worth recording precisely, because a disallow
 * costs a session every time it is rediscovered — and worse, because the
 * tracker row that sent this session here (NH229) proposes building an adapter
 * for a host that may not be crawled at all.
 *
 * **How this hunt started is the point.** It was not picked off a manifest. The
 * rebuilt Ask pipeline was asked *"What's on the Vail school district agenda?"*
 * against the real corpus, answered honestly that the only document it holds
 * for that meeting is a portal landing page, and that honest answer WAS the
 * lead. Reader demand located the gap; the hunt followed it. That is the
 * flywheel the session brief asked for, working in the direction it was meant
 * to work.
 *
 * Idempotent: `learnRoute` refuses a duplicate id, so a re-run cannot inflate
 * the method version or deepen a route's evidence.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "agenda-vendor-portal-blanket-robots-disallow",
    title:
      "the agenda-vendor portal a district links its board agendas to — and the blanket robots disallow that governs BOTH of the big ones",
    tier: "B",
    fields: ["meeting", "agenda"],
    note:
      "THE SHAPE IS GENERAL AND IT IS A PERMISSION FACT, NOT A WALL. Two vendor hosts were read on 2026-08-27 and both publish a blanket disallow for every automated client: vailschooldistrict.community.highbond.com/robots.txt (23,479 bytes, 486 User-agent blocks, EXACTLY ONE 'User-agent: *' block carrying 'Disallow: /', and ZERO 'Allow:' directives anywhere in the file) and go.boarddocs.com/robots.txt (21,760 bytes, 'User-agent: * / Disallow: / / Crawl-delay: 1000'). Both were fetched successfully at rung 2, twice, with a bare curl client and with a browser user agent, so this is a READ RULE and not a transport failure — the CANNOT_TELL case of RULING 182 does not apply and must not be claimed here. THE CONSEQUENCE FOR ANY DISTRICT ON THESE PLATFORMS: there is no permitted machine route to the agenda through the vendor, and no number of client variations changes that, because varying the client to defeat a rule is not hunting, it is circumvention. The fact remains owed and the branches that stay eligible are the body's OWN publication, the statutory posting, a different vendor the same body also uses, and a public-records request. DO NOT RE-WALK THIS ON A CLOCK: a disallow is not an absence with an expiry, and RULING 184's recheck cadence is for blocked TRANSPORT, not for a published rule.",
    origin:
      "conceived 2026-08-27 by the grounded Ask pipeline answering 'What's on the Vail school district agenda?' against the real corpus. All 9 of Vail Unified's agenda documents in the meetings snapshot are the SAME 1,652-character Highbond portal landing page, shared across 9 sittings — which is what made the question answerable only as a named gap. NH229 proposed adapters for Highbond and NovusAGENDA on the reasoning that 'Highbond is Diligent, and lib/sources/diligent already exists'. That reasoning is about REACHABILITY and the blocker turns out to be PERMISSION, which is why the permission document is read before an adapter is designed and not after.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note:
        "Cheap to establish and cheap to re-check: one robots.txt fetch per vendor host. The expensive mistake is skipping it and building an adapter first.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 0,
      outcome: "BLOCKED",
      note:
        "Both vendor hosts disallow all automated clients by published rule. Vail Unified's current agendas have no permitted vendor route. Tracked as NH229, whose premise this corrects.",
    },
  },
  {
    id: "district-site-hosts-events-but-links-agenda-out",
    title:
      "the district's OWN website as the permitted source — and the discovery that it carries the meeting but not the agenda",
    tier: "A1",
    fields: ["meeting", "agenda"],
    note:
      "www.vailschooldistrict.org/robots.txt is 39 bytes and reads 'User-agent: * / Allow: / / Disallow: /api/'. So the body's own publication is PERMITTED — which is the source order this project already walks first — with one exclusion that matters: the Apptegy CMS API under /api/ is disallowed, so the vendor's JSON endpoint may not be called even though the pages it renders may be read. THE SITEMAP IS ALLOWED AND IS THE ENUMERATOR: /sitemap.xml, 37,821 bytes, 194 URLs, no robots restriction on it, and it names the board's own document folders directly. WHAT THE PAGE ACTUALLY HOLDS, read rather than assumed: the board documents page is Nuxt-rendered, and its embedded state carries every board meeting as an event with a description — but the description's whole agenda content is a LINK OUT. The district publishes the MEETING on its own site and publishes the AGENDA nowhere on it. That is why a permitted, correctly-walked Tier A source still yields no agenda document, and it is a distinct outcome from a source that failed.",
    origin:
      "conceived 2026-08-27 while looking for a permitted alternative to the disallowed Highbond portal. The meetings already in the corpus carry ids of the form apptegy:vail:60703698, so the district's own Apptegy site was already the source of the MEETINGS; the open question was whether it was also a source of AGENDAS. It is not.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note: "robots.txt, then sitemap.xml, then the board page's own embedded state. Three fetches.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 0,
      outcome: "ZERO",
      note:
        "ZERO rather than FAILED, and the distinction is load-bearing: the source was reached, permitted, and read in full, and it genuinely does not publish agenda documents. This is an argued zero about OUR retrieval from one source, and it is NOT a claim that Vail publishes no agenda — it demonstrably does, on a portal we may not crawl.",
    },
  },
  {
    id: "anchor-text-names-a-second-vendor-than-the-href",
    title:
      "reading a government's link TEXT as well as its href — the anchor whose visible words name a different agenda portal than the one it points at",
    tier: "B",
    fields: ["meeting", "agenda", "source"],
    note:
      "A GENUINELY NEW DETECTION AND THE MOST PORTABLE THING THIS HUNT PRODUCED. Vail's own board-meeting event descriptions contain, verbatim: 'Agenda can be found here - <a href=\"https://vailschooldistrict.community.highbond.com/Portal/\">https://go.boarddocs.com/az/vail/Board.nsf/Public</a>'. The HREF points at Highbond. The VISIBLE TEXT is a BoardDocs URL. They are different vendors and different tenants. A crawler that harvests hrefs — which is what every link-following route in this project does — sees exactly one portal and never learns the second one exists. THE SHAPE IS GENERAL: a body that migrates between agenda vendors very often updates the href and leaves the old URL as the link's visible words, or the reverse, because the two live in different halves of a CMS rich-text field and a human editor changes one. So the anchor TEXT of any government page is an independent source of tenant identifiers and must be extracted alongside the href. Note the practical caveat for this instance: both portals named here turn out to be robots-disallowed, so the second identifier does not unlock Vail. It is recorded because the DETECTION is what travels, not this instance's result — and a second tenant on a permitted vendor would.",
    origin:
      "conceived 2026-08-27 while reading the raw embedded state of the Vail board documents page looking for a hosted agenda file. The mismatch was visible only because the whole anchor was read rather than a href regex being run over the page.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Free once known — it is a change to what the extractor keeps, not an extra fetch. Expensive to discover, because it is invisible to href-harvesting.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 1,
      outcome: "YIELDED",
      note:
        "One previously unknown vendor tenant identifier recovered: go.boarddocs.com/az/vail/Board.nsf/Public, published by the district itself in its own anchor text and named nowhere in this repository before today.",
    },
  },
  {
    id: "novusagenda-public-portal-viewstate-search",
    title:
      "the NovusAGENDA public portal's meeting search — reachable, unrestricted, and NOT yet readable by a bare viewstate POST",
    tier: "B",
    fields: ["meeting", "agenda"],
    note:
      "PERMISSION IS CLEAN AND THAT IS THE FINDING: vailschools.novusagenda.com/robots.txt is HTTP 404, so the host publishes NO restriction, which is a definite permission answer and not a CANNOT_TELL. The portal is live — /agendapublic/ returns 84,595 bytes and /agendapublic/meetingsresponsive.aspx returns 35,506 — and its markup carries AgendaHTML and AgendaPDF markers, so agenda documents are what it serves. WHAT WAS TRIED AND DID NOT WORK: a bare viewstate POST to meetingsresponsive.aspx carrying __VIEWSTATE, __VIEWSTATEGENERATOR, __EVENTVALIDATION, the session cookie, btnSearch, and a 1/1/2015-12/31/2026 window in both txtCalendarFrom/hfFromDate and txtCalendarTo/hfToDate. It returned HTTP 200 and 35,442 bytes containing ZERO MeetingID links, ZERO agenda links, and a date range RESET TO THE PORTAL'S OWN DEFAULTS rather than echoing the window that was sent. THE RESET IS THE DIAGNOSIS: the date parameters were not applied, so the search never ran over the requested window. THIS IS A FAILED EXTRACTION AND IS RECORDED AS ONE (RULING 100) — a zero-row result from a search that did not accept its own parameters is not evidence that the portal holds no meetings, and it must never be written down as one. The untried branches are the Telerik date-picker's own callback protocol, a real browser at rung 6 driving the actual controls, and the per-meeting DisplayAgendaPublic.aspx?MeetingID=N endpoint enumerated directly rather than through the search form. NH229's claim that this portal 'carries everything before 2017-03-14' is UNVERIFIED and is mildly contradicted by the portal defaulting to a current window.",
    origin:
      "conceived 2026-08-27 as the one remaining machine route after both vendor portals named by the district turned out to be robots-disallowed. It is the only Vail agenda source known to this project that publishes no restriction against reading it.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Four fetches to establish permission and shape. The adapter itself is unbuilt and is the open work: an ASP.NET postback grid needs either the vendor's own callback protocol or a browser at rung 6.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 0,
      outcome: "FAILED",
      note:
        "FAILED, deliberately, not ZERO. The search form did not apply the submitted date window and returned its own defaults, so nothing was actually searched. REQUIRES_NEW_ADAPTER. Tracked as NH229.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
