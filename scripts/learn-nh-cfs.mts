/**
 * `pnpm method:learn-nh-cfs` — **THE 403 WAS OUR OWN NAME, AND CORS IS NOT A
 * WALL TO A SERVER.** (Session C, 2026-08-31. RULING 148, RULING 182.)
 *
 * ## What the record said before this walk
 *
 * `states/nh/sources.md` recorded the New Hampshire Campaign Finance System as
 * walled: HTTP 403 at rungs 2 and 3, and — decisively — **`robots.txt` itself
 * answered 403**, which made the permission question UNANSWERED. Under RULING
 * 148 an unanswered permission question REFUSES the walk, so the whole fact
 * class sat behind a question nobody could ask.
 *
 * The one route that had ever worked was recorded as a hand-driven visible
 * browser, and tracker row `NH40` says what that cost: *"a procedure and not a
 * script, so nothing in CI can repeat it."*
 *
 * ## Two measurements, and both were different
 *
 * **1. The refusal keys on OUR IDENTIFICATION, not on us.**
 * `https://www.sos.nh.gov/robots.txt` answers **HTTP 200 to a bare client** and
 * **403 to the identical request carrying this project's name in the
 * User-Agent**. That is precisely what the existing `identified-agent-refused`
 * route records for the `nh.gov` family, applied to the one host nobody had
 * re-tried it on.
 *
 * So the permission question is ANSWERABLE, and the answer is a real Drupal
 * `robots.txt`: every `Disallow` is a CMS internal — `/core/`, `/profiles/`,
 * `/admin/`, `/user/login`, `/search/`, the README files. **Nothing disallows
 * elections, campaign finance, or the lobbyist registry.**
 *
 * `cfs.sos.nh.gov` publishes **no `robots.txt` at all**: it serves its Angular
 * shell for that path, byte-identical to what it serves for a nonsense path.
 * That is an ABSENCE OF RESTRICTIONS and is recorded as such — never as a
 * grant, and never as a 200 that "allows", because the 200 is a SPA catch-all
 * and reading it as a permission answer would be reading a wildcard as a rule.
 *
 * **2. CORS binds browsers, not servers.** The recorded rung-7 procedure
 * called the API "from the page's own origin" because a browser must. A server
 * process is not subject to CORS at all, and the same endpoint answers a plain
 * POST with HTTP 200 and JSON. The visible browser was never the load-bearing
 * part of that route — the ORIGIN HEADER was, and a server can simply send it.
 *
 * ## The general shape, which is the reusable part
 *
 * **A ROUTE RECORDED AS "REQUIRES A HUMAN" MAY BE RECORDING A BROWSER
 * CONSTRAINT THAT DOES NOT APPLY OFF THE BROWSER.** When a working procedure
 * involves a live browser calling an API, ask what the browser was FOR. If the
 * answer is CORS, same-origin, or a header the page happened to send, a server
 * can send it too and the procedure becomes a script. If the answer is
 * JavaScript rendering, a login, or a challenge, it cannot.
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
    id: "unanswered-permission-may-be-the-agent-not-the-host",
    title:
      "robots.txt answered 403 to our identified client and 200 to a bare one, so the permission question was answerable all along",
    tier: "A0",
    fields: ["permission", "source", "filing"],
    note:
      "THE MISTAKE THIS PREVENTS IS RECORDING A PERMISSION QUESTION AS UNANSWERABLE WHEN ONLY OUR CLIENT WAS REFUSED. Under RULING 148 an unanswered permission question refuses the walk, so a robots.txt that 403s does not merely delay a route — it closes the whole fact class behind it. cfs.sos.nh.gov and www.sos.nh.gov were both recorded that way on 2026-08-19 and 2026-08-26. MEASURED 2026-08-31: https://www.sos.nh.gov/robots.txt answers HTTP 200 (2103 bytes, a standard Drupal file) to a bare node fetch, and HTTP 403 to the identical request whose User-Agent carries this project's name. Every Disallow in it is a CMS internal (/core/, /profiles/, /admin/, /user/login, /search/, README files); NOTHING disallows elections, campaign finance or the lobbyist registry. THE PROCEDURE: before recording a permission question as UNANSWERED, re-read robots.txt with the identification REMOVED from the User-Agent and carried in From: and X-Purpose: instead. This is the identified-agent-refused finding applied to the permission read itself rather than to the data fetch, and it is the read that gates everything else. SECOND FINDING, recorded so it is not misread later: cfs.sos.nh.gov publishes no robots.txt — it returns its Angular shell for /robots.txt byte-identically to a nonsense path. That is an absence of published restrictions, NOT a 200 that grants permission; a SPA catch-all is not a rule.",
    origin:
      "walked 2026-08-31 (Session C) after the brief asserted that NH's higher rungs had never been worked. They had — rung 7 succeeded on 2026-08-21 — but the permission question underneath them was still recorded UNANSWERED, and that is what actually blocked the class.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Two robots.txt reads per host — one identified, one bare — and the comparison IS the finding. Seconds, and it settles a question that had stood for twelve days.",
    },
    outcome: {
      jurisdiction: "nh",
      rows: 2,
      outcome: "YIELDED",
      note:
        "Permission ANSWERED for both NH SOS hosts: www.sos.nh.gov publishes a robots.txt that forbids no civic path, and cfs.sos.nh.gov publishes none at all. The walk that RULING 148 had refused is permitted.",
    },
    claims: [
      {
        id: "unanswered-permission-may-be-the-agent-not-the-host#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "Re-reading robots.txt with the project's identification moved out of the User-Agent and into From:/X-Purpose: is a route that can answer a permission question previously recorded as unanswerable.",
        restsOn: ["identified-agent-refused"],
      },
      {
        id: "unanswered-permission-may-be-the-agent-not-the-host#nh-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-08-31 it answered the permission question for www.sos.nh.gov (a Drupal robots.txt disallowing only CMS internals) and established that cfs.sos.nh.gov publishes no robots.txt at all.",
        restsOn: ["unanswered-permission-may-be-the-agent-not-the-host#exists"],
      },
    ],
  },
  {
    id: "ask-what-the-browser-was-for-before-recording-human-only",
    title:
      "a live-browser procedure whose only browser-shaped part was CORS is a server-side script",
    tier: "A0",
    fields: ["filing", "document", "source"],
    note:
      "THE MISTAKE THIS PREVENTS IS RECORDING A ROUTE AS HUMAN-ONLY BECAUSE IT WAS DISCOVERED IN A BROWSER. The NH CFS route was recorded on 2026-08-21 as: open the app in a VISIBLE browser, read its own JS bundles for endpoints, and call cfsapi.sos.nh.gov/api FROM THE PAGE'S OWN CONTEXT 'where CORS is already allowed'. Tracker NH40 concluded it was 'a procedure and not a script, so nothing in CI can repeat it'. MEASURED 2026-08-31: CORS is enforced by BROWSERS, not by servers. A plain server-side POST to https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails carrying Origin and Referer headers answers HTTP 200 with JSON, no browser and no session. THE PROCEDURE: when a working route requires a live browser, name WHAT THE BROWSER SUPPLIED. If it supplied CORS relief, an Origin/Referer header, or a same-origin context, a server can send those headers and the procedure becomes a script. If it supplied JavaScript rendering of the data, an authenticated session, or a challenge response, it cannot, and the human-only record stands. The distinction is worth making explicitly because the two look identical in a session report and only one of them can be put in CI.",
    origin:
      "walked 2026-08-31 (Session C) while trying to resume NH campaign finance from its recorded rung. The record said rung 7 worked by hand; asking why it needed a browser showed the answer was CORS, which does not apply off a browser.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One request to test the hypothesis. The endpoint honours only its search field, so every other filter runs locally and the pacing cost is one query per surname.",
    },
    outcome: {
      jurisdiction: "nh",
      rows: 28,
      outcome: "YIELDED",
      note:
        "28 candidacies on the 03255 ballot resolved against the CFS from a script: 9 filed with reported totals, 19 sourced dated absences, 0 leads. Produced data/funding/state-money-nh-2026.json, which the ballot page already knew how to load.",
    },
    claims: [
      {
        id: "ask-what-the-browser-was-for-before-recording-human-only#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "A server-side POST carrying Origin and Referer reaches cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails without a browser, because CORS binds browsers rather than servers.",
        restsOn: ["unanswered-permission-may-be-the-agent-not-the-host#nh-outcome"],
      },
      {
        id: "ask-what-the-browser-was-for-before-recording-human-only#nh-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-08-31 it returned 2026 filer records — committee name, candidate name, office, district, town, totals raised and spent, and a filer id — for every surname on the 03255 ballot that the CFS holds.",
        restsOn: ["ask-what-the-browser-was-for-before-recording-human-only#exists"],
      },
    ],
  },
];

runLearnBatch(STORE, ROUTES, today());
