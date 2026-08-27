/**
 * `pnpm method:learn-85641` — PUT THE 85641 DETECTIVE SESSION'S ROUTES INTO
 * PROJECT MEMORY. (2026-08-27. **RULING 178**, **RULING 88**, **RULING 61**.)
 *
 * A route that exists only in a session report is a route the next session
 * re-invents. Each of these was conceived because a specific owed fact about
 * ZIP 85641 could not be reached by anything the project already knew, and each
 * is recorded with what it actually returned — including the route whose
 * headline result was a REJECTION, because a route that correctly refuses a
 * lead is doing the job the ladder exists for.
 *
 * **Every one enters at `UNKNOWN` portability.** Each was proved in one place.
 * RULING 178 is explicit that a route does not become nationwide by working
 * somewhere; `UNKNOWN` still inherits to every jurisdiction, it simply does not
 * claim.
 *
 * Idempotent: `learnRoute` refuses a duplicate id and says so, so re-running
 * cannot inflate the method version or deepen a route's evidence.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "formation-document-to-recorded-plat-to-gis",
    title:
      "a special district with NO boundary layer anywhere: read its formation resolution, take the recorded-plat legal description out of it, look that plat up in the county's own subdivision layer, and point-test the polygon",
    tier: "A1",
    fields: ["body", "territory"],
    note:
      "proved on two Pima County community facilities districts. A CFD is formed by a county resolution that must recite the land by recorded book/page or sequence number, and the county publishes its recorded subdivision plats as a GIS layer for entirely unrelated reasons — so the join exists wherever a district is formed over platted land and the county maps its plats. That is a large class and not a universal one: a district formed over metes-and-bounds acreage has no plat to join to.",
    origin:
      "conceived 2026-08-27 because Pima County's ArcGIS catalogue (34 services, 281 layers) contains no community-facilities-district layer at all, and the project's standing record carried both CFDs as leads that 'cannot be resolved without a boundary'. The boundary was never going to be published as a boundary; it was published as a plat.",
    outcome: {
      jurisdiction: "az",
      rows: 29,
      outcome: "YIELDED",
      note:
        "Rocking K South CFD PROMOTED: its formation resolution 2017-2 (recorded 20170450755) recites 'Blocks 1 through 14 of Rocking K South ... Book 64 of Maps and Plats, Page 85'; 25 recorded Rocking K South plats in the county layer, and 25 of 25 point-test inside ZCTA 85641. Wildflower CFD REJECTED by the same route: its resolution 2021-78 recites sequence 20172440197, which the same layer places in ZCTA 85757 — the project had carried Wildflower as an 85641 lead. One route promoted a body and killed a false positive in the same pass.",
    },
  },
  {
    id: "state-education-agency-meeting-notice",
    title:
      "the state education agency's budget-filing system publishes a STATUTORY PUBLIC MEETING NOTICE for every school district — date, time, street address and a named agenda contact — so a district that publishes nothing itself still has a machine-readable meeting",
    tier: "A1",
    fields: ["meeting", "body", "contact"],
    note:
      "proved on Arizona, where A.R.S. 15-905(C) requires the notice and budgetsystem.azed.gov posts it as a filed workbook. The STATUTE is Arizona's; the SHAPE is that every state which reviews district budgets receives a hearing notice with it, so the route travels further than the URL does. Recorded UNKNOWN because one state is not a measurement.",
    origin:
      "conceived 2026-08-27 for Empire Elementary School District No. 37, which two independent official enumerations (Pima County GIS and the NCES CCD LEA directory) record with a BLANK website field. The district turned out to operate no schools and employ no staff, so it will never have a website — the meeting had to be found somewhere it is compelled to file rather than somewhere it chooses to publish.",
    outcome: {
      jurisdiction: "az",
      rows: 17,
      outcome: "YIELDED",
      note:
        "the index is a Kendo grid over a plain GET handler: 3,880 district filings statewide for FY2026 and 2,356 for FY2027, each downloadable by submission id. 17 meeting notices parsed for the seven LEAs touching 85641, including Empire Elementary's own board meeting — 2026-07-13, 11:00AM, 200 N. Stone Ave., Tucson, agenda from Peter Laing at Peter.Laing@pima.gov. The same filings carry the district's primary and secondary tax rates and its M&O budget limit.",
    },
  },
  {
    id: "official-candidate-list-is-the-ballot-not-the-canvass",
    title:
      "the certified canvass contains only CONTESTED races; the election authority's OFFICIAL CANDIDATE LIST is the ballot universe — build a ballot from the canvass and every unopposed seat vanishes silently",
    tier: "A0",
    fields: ["contest", "candidate"],
    note:
      "proved on Pima County, whose canvass carries its own 'Master List of All Contested Races' naming 15 races while the official candidate list carries 34 contests and 101 candidates. Any jurisdiction that canvasses contested races separately has this shape, and the failure mode is silent and looks like completeness, which is why the check is worth carrying everywhere.",
    origin:
      "conceived 2026-08-27 after the certified primary canvass showed Board of Supervisors District 5 and no District 2 or 4, and Constables in precincts 2, 3 and 9 and none in 7 or 8 — the exact districts governing 85641. Reading that as 'no race' would have been a false claim about an election; the official candidate list shows those seats are simply not scheduled this cycle.",
    outcome: {
      jurisdiction: "az",
      rows: 101,
      outcome: "YIELDED",
      note:
        "34 contests and 101 candidates from the Pima County 2026 Official Candidate List, against 15 contested races in the canvass. It also settled a named absence the product was carrying: the curated Arizona ballot omitted Corporation Commissioner because no source stated how many seats were scheduled, and the candidate list says 'Vote for not more than 2'.",
    },
  },
  {
    id: "two-pdf-extractors-corrupt-different-things",
    title:
      "a multi-column form PDF needs TWO extractors and knowledge of which artefact each produces: layout order for WHICH OFFICE, a second engine for HOW THE NAME IS SPELT — a majority vote between engines gets it wrong",
    tier: "A0",
    fields: ["candidate", "roster"],
    note:
      "proved on a bilingual two-column ballot list. pdfjs interleaves the English and Spanish captions with the names, which attributes candidates to the wrong office; pdftotext preserves columns in -layout mode but merges the form's rule glyph into the following surname, in BOTH its modes. Two of three extractors agreed with each other and were both wrong, so the tie-break is not a vote. Every government form laid out in columns with rules beside the fields has this shape.",
    origin:
      "conceived 2026-08-27 when the layout extraction produced 'REP IGRIFFIN, GAIL' — a rule glyph welded to a state senator's surname — while the same tool's flat mode produced the identical corruption and the repo's own pdfjs extractor produced the clean name.",
    outcome: {
      jurisdiction: "az",
      rows: 101,
      outcome: "YIELDED",
      note:
        "101 candidates: 95 agreed across both extractors and 6 carried the rule glyph and were corrected with the correction recorded on the record rather than applied silently. A leading I is never simply stripped — IBARRA is a real surname — so a name neither pass confirms is reported UNCONFIRMED rather than edited.",
    },
  },
  {
    id: "cms-hydration-state-is-the-document-catalogue",
    title:
      "a hydrating CMS ships a catalogue of its documents INTO the page — ids, filenames, slugs, parent ids and tenant-scoped download URLs — so read the hydration state rather than the anchors the page chose to render",
    tier: "A0",
    fields: ["source", "document", "meeting"],
    note:
      "proved on CivicPlus, whose pages carry content.civicplus.com/api/assets/<tenant>/<uuid> URLs and a per-item record with a parentId, i.e. a tree. Recorded UNKNOWN: the same shape is expected of any React/Redux-hydrated government CMS, and expecting is not measuring.",
    origin:
      "conceived 2026-08-27 when a county CFD page rendered thirteen document names in its visible text and only five of them appeared as anchors in the served markup — the rest were reachable only through the embedded store.",
    outcome: {
      jurisdiction: "az",
      rows: 24,
      outcome: "YIELDED",
      note:
        "recovered the formation resolutions, final petitions, general plans and official election canvasses for both Pima County community facilities districts, plus the county's 2026 election document family (official candidate list, proposition text, write-in list, vote-center locations, candidates filed, precinct committeemen filed). The formation resolutions are what made the territory route above possible.",
    },
  },
  {
    id: "single-pass-cannot-tell-may-be-a-flapping-wall",
    title:
      "a CANNOT_TELL on robots.txt from a single-pass sweep can be a NON-DETERMINISTIC challenge rather than a rule — retry the same rung before treating the host as unwalkable, and record which it was",
    tier: "A0",
    fields: ["source", "permission"],
    note:
      "measured on two Arizona hosts with opposite answers, which is the point: azed.gov serves a Cloudflare interstitial to roughly one request in three and the real robots.txt to the others, while apps.arizona.vote served the interstitial at every one of rungs 2, 3, 4, 5 and 6. A retry distinguishes them and nothing else does. RULING 182 still governs the unresolved case: the route fails safe and the FACT is hunted elsewhere.",
    origin:
      "conceived 2026-08-27 after pnpm robots:sweep returned CANNOT_TELL for www.azed.gov, which would have refused the Arizona Department of Education — the authority holding the filings for a school district with no website.",
    outcome: {
      jurisdiction: "az",
      rows: 2,
      outcome: "YIELDED",
      note:
        "www.azed.gov: rung 2 and 3 walled, rung 4 walled once then READ on retry — a standard Drupal robots.txt allowing every content path, so the department is WALKABLE and the single-pass verdict was wrong. apps.arizona.vote: walled at every rung including the live browser, so it stays CANNOT_TELL and is NOT walked; the general-election candidate list it holds was obtained instead from apps.azsos.gov and from the county's own publication.",
    },
  },
  {
    id: "county-levy-resolution-is-the-taxing-universe",
    title:
      "the county board's annual LEVY RESOLUTION enumerates every entity that taxes property in the county — a government that publishes nothing still cannot avoid it, because somebody has to collect its money",
    tier: "A0",
    fields: ["body", "territory"],
    note:
      "proved on Pima County, where A.R.S. 42-17101 to 42-17110 require the board to adopt one resolution each August levying for every entity. The STATUTE is Arizona-wide, so the route reaches all fifteen counties; every state with county-collected property tax has some equivalent, which is why it is recorded UNKNOWN rather than claimed.",
    origin:
      "conceived 2026-08-27 as the Arizona form of the who-bills-for-it route this project learned against New Hampshire. It was reached for because a hunt needs a denominator it did not write itself, and every other enumeration walked this session was a government describing its own scope.",
    outcome: {
      jurisdiction: "az",
      rows: 143,
      outcome: "YIELDED",
      note:
        "143 levy lines across 38 taxing jurisdictions and classes, from RESOLUTION NO. 2026-43 adopted 2026-08-17. It CORRECTED the county: Pima publishes a Community Facilities Districts page listing TWO and its levy names NINE. It produced whole classes this project had no vocabulary for — irrigation districts levying per acre rather than ad valorem, a health district, domestic water improvement districts, twenty street lighting improvement districts, an unorganized school district tax, a fire district assistance tax, and the Central Arizona Water Conservation District. It independently confirmed the cross-county fire districts: Mescal-J6 levies 2.1487 and Sonoita-Elgin 3.2500 on Pima property, which the project had only inferred from a GIS layer. And it gave Rocking K South CFD a rate for a reader: 0.5000 M&O plus 1.8800 bond on a 38,682,735 valuation.",
    },
  },
  {
    id: "embed-props-carries-the-vendor-tenant",
    title:
      "when a meeting portal ships as an EMBED SCRIPT, the host page carries the vendor tenant slug in its own config object — read it, then ask the vendor API directly",
    tier: "A0",
    fields: ["meeting", "source"],
    note:
      "proved on CivicClerk, whose embed reads window.clerkEmbedProps = {tenant, categoryIds} and whose API then answers an unauthenticated OData GET at <tenant>.api.civicclerk.com/v1/Events. The SHAPE is every embed-delivered portal: the browser has to be told which tenant to render, so the page must carry the identifier, and the identifier is the whole key. Recorded UNKNOWN because one vendor is not a measurement of the class.",
    origin:
      "conceived 2026-08-27 because the Central Arizona Water Conservation District governs 85641 and its own meetings page served 222,565 bytes with no dated meeting link and no iCalendar feed. The meetings were not missing from the page; the page was a client for a system whose name was in its own markup.",
    outcome: {
      jurisdiction: "az",
      rows: 14,
      outcome: "YIELDED",
      note:
        "15 events over the serving window, 14 normalized into meetings with venue, agenda flag and status — 13 placed at an address and 1 kept as an online sitting. The single drop is a CANCELED briefing whose location field is empty. It restored coverage at both Pima pilot zips, which had correctly fallen to NO_SOURCE when the district was added with no adapter.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
