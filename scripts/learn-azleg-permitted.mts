/**
 * `pnpm method:learn-azleg-permitted` — THE BLOCKED HOST WAS NOT THE FACT
 * CLASS. (2026-08-28. **RULING 182**, **RULING 184**.)
 *
 * ## What the record said before this walk
 *
 * Ask's answer about the Governor carried this named gap, and it was the
 * honest thing to say at the time:
 *
 * > These are executive orders only. We have not recorded bills signed or
 * > vetoed — the legislature's bill-status system does not permit automated
 * > reading, so that half of the record is not ours to show yet.
 *
 * True of ONE HOST. `apps.azleg.gov/robots.txt` is `User-agent: * / Disallow:
 * /` and is not walked, not circumvented, and not re-walked on a clock.
 *
 * ## What one robots.txt read settled
 *
 * `www.azleg.gov` is a DIFFERENT HOST and it is PERMITTED. Its wildcard block
 * is a specific path list — `/DocumentsForBill.asp`, `/FormatDocument.asp`,
 * `/search/`, `/xml/`, `/aspWebCalendar/`, `/ExecutiveNominationsByNominee.asp`,
 * `/Wordpress/`, `/azlegwp/`, `/aspnet_client/` — with `Crawl-delay: 120` and a
 * sitemap it advertises itself. Nothing there forbids the legislature's own
 * publications.
 *
 * So the state was never "the fact class is unreachable". It was ONE ROUTE
 * BLOCKED and another primary-source route unwalked, which is exactly the
 * distinction `RULING 184` exists to hold.
 *
 * ## The lead the failure generated
 *
 * The advertised sitemap is STALE: it lists 28 `.asp` URLs and
 * `SessionLaws.asp` returns HTTP 404. That is a dead end on its own terms and
 * it is where most walks would stop — but the 404 page is served by the LIVE
 * site and carries the live navigation, which is the map. Eighty-two distinct
 * links, and among them the two that are the fact class:
 *
 * ```
 * https://www.azleg.gov/sessionlaws/        every bill enacted, by chapter
 * https://www.azleg.gov/governors-letters/  the Governor's transmittal letters
 * ```
 *
 * Arizona's Governor transmits signing statements and VETO LETTERS to the
 * legislature, and the legislature publishes them. That is the veto record,
 * on a permitted host, in the open.
 *
 * ## The general shape, which is the reusable part
 *
 * **A 404 FROM A PUBLISHED SITEMAP IS A LEAD, NOT A WALL.** A stale sitemap on
 * a live site means the URL scheme moved, and the 404 page a modern CMS serves
 * is a full page with the current navigation in it. Read the links off the
 * error page before concluding anything about the publisher. The site told us
 * where everything went, on the page that said the old address was gone.
 *
 * Idempotent: `learnRoute` refuses a duplicate id.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "sibling-host-is-a-different-permission-decision",
    title:
      "the blocked application and the permitted publisher are two hosts, and only one of them was ever asked",
    tier: "A0",
    fields: ["vote", "document", "permission"],
    note:
      "THE MISTAKE THIS PREVENTS IS RECORDING A HOST'S DISALLOW AS A FACT ABOUT A GOVERNMENT. apps.azleg.gov publishes User-agent: * / Disallow: / and is correctly not walked. www.azleg.gov is a DIFFERENT HOST with a DIFFERENT ANSWER: a specific disallow list (/DocumentsForBill.asp, /FormatDocument.asp, /search/, /xml/, /aspWebCalendar/, /ExecutiveNominationsByNominee.asp, /Wordpress/, /azlegwp/, /aspnet_client/), Crawl-delay: 120, and a sitemap it advertises. The legislature's own publications are not forbidden anywhere in it. THE PROCEDURE: when a vendor or application subdomain disallows, resolve the PUBLISHER's own hostname and read ITS robots.txt before writing down anything about the record. A body very often runs a locked-down interactive app beside an open publication site, and the second one is where the primary documents actually live. FOUND ON THE PERMITTED HOST for Arizona: www.azleg.gov/sessionlaws/ (every bill enacted, by chapter) and www.azleg.gov/governors-letters/ (the Governor's transmittal letters to the legislature, which is where signing statements and VETOES are published). Neither is under a disallowed path.",
    origin:
      "walked 2026-08-28 after the session brief pointed out that #213's own report recorded www.azleg.gov as permitted and unwalked while the reader-facing gap sentence read as though the bill and veto class were unreachable. One robots.txt read settled it.",
    effort: {
      repeats: "PER_STATE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One robots.txt per candidate hostname. The crawl-delay is the real cost here — 120 seconds between requests on this host, so a walk is paced in minutes rather than seconds and must be planned that way.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 2,
      outcome: "YIELDED",
      note:
        "Two permitted primary-source routes identified for the signed-bill and veto class that the corpus previously recorded as unreachable: /sessionlaws/ and /governors-letters/. Ingestion is not yet built; the permission question is settled.",
    },
  },
  {
    id: "read-the-navigation-off-the-404-page",
    title:
      "a stale sitemap on a live site, and the error page that carries the current map",
    tier: "A1",
    fields: ["meeting", "agenda", "document", "source"],
    note:
      "A 404 FROM A PUBLISHED SITEMAP IS A LEAD AND NOT A WALL. www.azleg.gov advertises robotsitemap.xml; it lists 28 .asp URLs written against a scheme the site has since left, and SessionLaws.asp returns HTTP 404. Most walks stop there and record the route as dead. THE PAGE ITSELF IS THE ANSWER: a modern CMS serves a FULL page on 404 — this one is 78 KB and carries the site's live navigation, a session picker listing every legislature back to 2018, and 82 distinct links. Reading the hrefs off the error page produced the two routes the walk was looking for, both at new addresses. THE RULE: when a URL from a sitemap, an old bookmark or a search result 404s on a host that is otherwise up, EXTRACT THE LINKS FROM THE ERROR RESPONSE before concluding anything. Check the status AND the body — a 404 with 78 KB of navigation is a redirect nobody wrote, and the site is telling you where everything went on the page that says the old address is gone. The same shape appears wherever a body migrates CMS, which they all eventually do.",
    origin:
      "found 2026-08-28 when the permitted azleg route walked from its own advertised sitemap returned 404, and the 404 body turned out to contain the live route list including /sessionlaws/ and /governors-letters/.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "No extra request at all — the response is already in hand. It costs one link extraction over bytes that were downloaded anyway.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 82,
      outcome: "YIELDED",
      note:
        "82 distinct links recovered from a 404 body, including the two live routes for the signed-bill and veto class that the stale sitemap could not name.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
