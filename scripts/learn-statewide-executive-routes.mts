/**
 * `pnpm method:learn-statewide-execs` — WHAT THE STATEWIDE-EXECUTIVE
 * ACQUISITION LEARNED. (BAL-27 / BAL-28, 2026-08-28. **RULING 178**.)
 *
 * ## The lead was a measurement, not a hunch
 *
 * `pnpm incumbency:census` on `a44559e` reported 15 INCUMBENT, 57 CHALLENGER
 * and **305 UNKNOWN** across 126 contests. The join was exact and the corpus
 * was empty: 17 of 126 contests could name a single holder. Arizona's ballot
 * ran seven statewide contests and only the Governor's had one.
 *
 * ## What travels, and what does not
 *
 * These four routes are written down because each of them cost a session
 * something to learn and none of them is specific to Arizona. Two are about
 * WHERE an officeholder is published, one is about what a certified filing
 * prints beside a name, and one is a mechanical trap in reading a face off a
 * page that a later hunt would otherwise fall into again.
 *
 * Idempotent: `learnRoute` refuses a duplicate id, so a re-run cannot inflate
 * the method version or deepen a route's evidence.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const STORE = join(process.cwd(), "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "each-statewide-executive-office-publishes-its-own-officeholder",
    title:
      "the officeholder of a statewide executive office, read off THAT OFFICE's own site — one host per office, never one host per state",
    tier: "A1",
    fields: ["officeholder"],
    note:
      "THE SEAT-HOLDER GAP IS A CORPUS GAP AND THIS IS THE ROUTE THAT FILLS IT. A ballot names an office; the incumbency join needs a person on the other side of (division, office); and the primary publisher of who holds a statewide executive office is THAT OFFICE, not the Secretary of State and not an aggregator. WHAT WORKS: each office runs its own host and publishes a page titled for the person — azsos.gov/about/about-secretary (Adrian Fontes), azag.gov/kris-mayes (Kris Mayes), aztreasury.gov/treasurer-kimberly-yee (Kimberly Yee), azed.gov/adeinfo/about-state-superintendent (Tom Horne), asmi.az.gov/about/team (Les Presmyk), azcc.gov/<slug>/biography (five Corporation Commissioners), nj.gov/governor/admin/ltgovernor (Dale G. Caldwell). Ten officeholders across seven hosts and two states, 2026-08-28. THE HOST IS NOT GUESSABLE AND MUST NOT BE GUESSED: the obvious `azmineinspector.gov` DOES NOT EXIST — ENODATA from 1.1.1.1 and 8.8.8.8, ERR_NAME_NOT_RESOLVED in a real browser — while the office publishes at `asmi.az.gov`, found by walking the state's own az.gov namespace. A non-resolving host is a DNS fact, never a permission verdict and never evidence that the office publishes nothing. AND A MULTI-MEMBER STATEWIDE BODY IS THE SAME ROUTE: the Arizona Corporation Commission elects five people to ONE office, and five holder rows on one office key join a single ballot contest exactly as a multi-member legislative district does — no special case, because the office key never carried the seat.",
    origin:
      "opened 2026-08-28 by pnpm incumbency:census, which reported 305 of 377 candidates UNKNOWN and 17 of 126 contests with any holder at all. The gap was measured before it was hunted.",
    effort: {
      repeats: "PER_STATE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One robots read plus one page read per OFFICE, and the office count is small (5-10 per state). The cost is locating the host, which is one walk of the state's own agency namespace, not a search.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 11,
      outcome: "YIELDED",
      note:
        "Eleven officeholders added to lib/officials/statewide-executives.ts. The seat join went 17/126 contests to 23/126 and the three-way split from 15/57/305 to 20/73/284.",
    },
  },
  {
    id: "a-certified-candidate-listing-is-the-party-record-an-office-page-lacks",
    title:
      "party for a sitting officeholder — from the election authority's certified candidate listing or primary canvass, never from the office's own page",
    tier: "A1",
    fields: ["officeholder", "party"],
    note:
      "AN OFFICE PAGE DOES NOT PRINT A PARTY, AND INVENTING ONE IS THE INFERENCE THIS PRODUCT FORBIDS. The record that does print it is the election authority's own: a statewide candidate listing (apps.azsos.gov/election/<year>/ge_cand/<year>_General_Candidates_Web.pdf — 5 pages, TEXT LAYER, 'Walden, Rachel | Corporation Commissioner | 3 | REP') or a county primary canvass, where the PARTY IS THE SECTION HEADING because a primary is by party ('REP State Mine Inspector — PRESMYK, WALTER \"LES\"'). PREFER THE FILING THE BALLOT SURFACE ALREADY CITES where the officeholder is also a current candidate: one record read by two surfaces cannot drift, whereas two records that agree today are two chances to disagree tomorrow. THE TRAP THAT COSTS A SESSION: the STATE-level signed canvass is a SCAN — apps.azsos.gov/election/2024/ge/canvass/20241105_GeneralCanvass_Signed.pdf is 19 pages, 0 with a text layer — while the per-county canvasses and the candidate listings extract cleanly. Reach for the listing first. AND THE COUNTY GENERAL canvass is precinct-level and carries NO party at all; only the PRIMARY canvass and the candidate listing do.",
    origin:
      "learned 2026-08-28 while giving eleven newly acquired statewide executives a sourced party. tests/party.test.ts refuses a party without a record and refuses the office page as that record.",
    effort: {
      repeats: "PER_STATE",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note:
        "One PDF per election year per state, read with pnpm pdf:read. Cheap once the right document class is known, and the wrong document class is a scan that reads as an empty file.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 10,
      outcome: "YIELDED",
      note:
        "Ten of eleven acquired officeholders carry a party with a certified election-authority record. The eleventh (New Jersey's Lieutenant Governor) carries none and says why: NJ elects that office on the gubernatorial TICKET, so the certified list for the office names only the Governor.",
    },
  },
  {
    id: "a-quoted-nickname-in-a-filing-is-an-alias-the-record-itself-publishes",
    title:
      "reconciling a filed name to a serving name — the certified filing prints BOTH, in quotation marks",
    tier: "A1",
    fields: ["officeholder", "candidate"],
    note:
      "A BODY PUBLISHES ITS MEMBER AS THEY ARE KNOWN AND A FILING PUBLISHES THEM AS THEY FILED, AND THE FILING RECONCILES THE TWO ITSELF. Arizona's canvasses print 'MYERS, NICHOLAS \"NICK\"', 'PRESMYK, WALTER \"LES\"', 'SHOPE JR., THOMAS \"T.J.\"', 'ROSENBLUM, LEONARD \"LEN\"' — the quoted token is not a guess about similarity, it is the alias the election authority printed. WHY IT MATTERS MORE THAN IT LOOKS: a strict first-name test fails (nicholas != nick), a prefix test fails too (nicholas does not start with nick), and a correct fail-closed matcher then takes the WHOLE CONTEST to UNKNOWN on the surname collision — so one unreconciled nickname cost the true incumbency of every other person in that race. Read the quoted token as an alternative first name; keep the surname exact; do NOT treat an apostrophe as a quote delimiter, because it is part of O'Brien.",
    origin:
      "measured 2026-08-28: the Arizona Corporation Commissioner contest resolved to UNKNOWN for all four candidates because Nick Myers files as Nicholas \"Nick\" Myers, losing Kevin Thompson's true incumbency with his.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "A change to the shared name comparison, not a per-jurisdiction cost.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 2,
      outcome: "YIELDED",
      note: "Two sitting Corporation Commissioners resolve as INCUMBENT where the contest previously read UNKNOWN for all four candidates.",
    },
  },
  {
    id: "a-name-match-on-the-URL-is-vacuous-on-a-campaign-domain",
    title:
      "picking a portrait — match the person's name against the image's ALT and FILENAME, never against the host or path",
    tier: "A1",
    fields: ["photo"],
    note:
      "THE MECHANICAL JOIN THAT STOPS A WRONG FACE HAS TWO HOLES AND BOTH WERE MEASURED IN ONE RUN. (1) MATCHING ON THE WHOLE URL IS VACUOUS ON A CAMPAIGN SITE, because a campaign's domain IS the candidate's name: nortonforaz.com, weir4liberty, butierezforcongress.com, strobelforschoolboard.com all matched EVERY image on the site, so the first image in the document won — which on a campaign site is the hero banner. Match on the alt text and the FILENAME. On a government roster page (jen_rowland.jpg, an alt of 'Kyle Russell') that changes nothing. (2) AN OFFICE'S OWN MASTHEAD IS NAMED AFTER THE OFFICEHOLDER: azsos.gov serves fontes_banner01_small-white.png with alt 'Logo for Arizona Secretary of State', which satisfies surname-plus-extension exactly. Refuse an image the page's own words call furniture — logo, banner, seal, masthead, wordmark, letterhead, favicon, icon, slide, hero, header — and split the filename on EVERY separator first, because `_` is a word character and \\b does not fire inside AidenSwallow_LOGOS.ai.png or RebeccaBennett-Logo_white-1.webp. AND A BANNER IS A SHAPE: every genuine portrait staged in this repository is taller than wide (14 rows, 0.67 to 1.00), while the campaign hero images measured 1.76, 1.78 and 3.45 to 1. Refuse above 1.5:1 — it is a measurement of the image, not a judgement about the person.",
    origin:
      "measured 2026-08-28 on the first door-2 walk of a new cohort and the first door-3 walk of the ballot cohort: three logos and three donate bars were queued as six people's faces before these three refusals were added.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Changes to lib/hunt/portrait-pick.ts and lib/photos/staged.ts — the shared picker and the one door into the review, so no later hunt can be missing them (RULING 103).",
    },
    outcome: {
      jurisdiction: "az",
      rows: 6,
      outcome: "YIELDED",
      note:
        "Six wrong images refused before reaching the author, each with a named, measured reason; nine correct portraits queued from the same walks.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
