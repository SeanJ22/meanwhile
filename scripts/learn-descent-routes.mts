/**
 * `pnpm method:learn-descent` — PUT THIS SESSION'S ROUTES INTO PROJECT MEMORY.
 * (2026-08-26, the descent-resume session. **RULING 178**, **RULING 88**.)
 *
 * A route that exists only in a session report is a route the next session
 * re-invents. These three were conceived while doing owed descent work, each
 * one because a specific owed fact could not be reached by anything the
 * project already knew, and each is recorded here with what it actually
 * returned — including the zero, which is knowledge (RULING 88).
 *
 * **Every one enters at `UNKNOWN` portability.** Each was proved in one place.
 * RULING 178 is explicit that a route does not become nationwide by working
 * somewhere, and `UNKNOWN` still inherits to every jurisdiction — it simply
 * does not claim.
 *
 * Idempotent: `learnRoute` refuses a duplicate id and says so, so re-running
 * this cannot inflate the method version or deepen a route's evidence.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "census-of-governments-gap-walk",
    title:
      "the Census of Governments as the tier denominator: reconcile an official enumeration against the registry, then open each missing government's OWN reported website",
    tier: "A0",
    fields: ["body", "roster"],
    note:
      "proved against the 2022 Census of Governments clipped to three pilot counties. The national file is already committed at data/reference/census_govt_units_2022.csv — 88,748 active governments in 52 state/territory codes, 38,046 of them carrying a web address — so the SHAPE is national even though the walk so far is three counties.",
    origin:
      "conceived 2026-08-26: the link descent works OUTWARD from pages and finds what governments choose to link, which is structurally blind to a fire district nobody links to. This works INWARD from an enumeration that already exists.",
    outcome: {
      jurisdiction: "pilot-counties",
      rows: 57,
      outcome: "YIELDED",
      note: "211 governments in the clip, 86 already held; 90 of the 125 missing reported a website and 57 named themselves when opened",
    },
  },
  {
    id: "county-annual-report-directory",
    title:
      "the county annual report PDF as directory, roster and minutes archive in one file — read the text layer, do not stop at the link",
    tier: "A1",
    fields: ["body", "roster", "meeting", "vote"],
    note:
      "proved on one New Hampshire county for one year. Every NH county publishes one because the county convention has to receive it, which is a statutory reason to expect the shape to repeat — and a reason is not a measurement.",
    origin:
      "conceived 2026-08-26 from this repository's own note: `states/nh/NOTES.md` recorded the Merrimack County Board of Commissioners as COULD NOT ASSERT because 'its source is a PDF annual report and this reader reads HTML', and named ladder rung 9 as owed",
    outcome: {
      jurisdiction: "nh",
      rows: 45,
      outcome: "YIELDED",
      note: "44 pages, 37 with a native text layer, no OCR needed: the commissioners and ten department heads on page 3, the full 45-member delegation and both sets of officers on page 5, county convention minutes with roll-call votes on pages 22-29. Confirmed a roster a prior session had already recorded, and reconciled it against the General Court roster 42/45 on surname.",
    },
  },
  {
    id: "who-bills-for-it",
    title:
      "a government that publishes nothing is still billed for: find the state agency that computes its tax rate, and read the rate table",
    tier: "A1",
    fields: ["body"],
    note:
      "proved on New Hampshire's Department of Revenue Administration, whose 2024 village sheet names 10 of the 15 Merrimack County governments the Census of Governments recorded with NO website. The SHAPE is statutory rather than local — a district that levies must have its rate set and published by somebody — and the specific publisher differs per state, so the route travels further than the URL does.",
    origin:
      "conceived 2026-08-27 from this repository's own note: states/TIERS.md said 'revenue.nh.gov's municipal and property division publishes the rate tables precisely because somebody has to be billed', and that host had refused this project at every rung until rung 3b landed the same day",
    outcome: {
      jurisdiction: "nh",
      rows: 45,
      outcome: "YIELDED",
      note: "180-row village sheet; 10 of Merrimack's 15 no-website governments named. The five absent are East Andover Fire Precinct, BCEP Solid Waste District and three school districts, which are apportioned in a different DRA publication. Lake Todd Village appears TWICE at 0.24 and 0.38, both flagged *Apportioned — independent official evidence for the Bradford/Newbury spanning district RULING 121 names. A rate of 0 is a district that filed and set no rate, not an absence.",
    },
  },
  {
    id: "sitemap-when-the-index-is-javascript",
    title:
      "when a CMS renders its own index in the browser, sitemap.xml is the index — read it instead of the page",
    tier: "A0",
    fields: ["body", "meeting", "source"],
    note:
      "proved on revenue.nh.gov, whose Municipal and Property Division landing page is 243,735 bytes carrying two usable anchors while its sitemap named 26 URLs about rates, villages and precincts. Any CMS that hydrates its navigation has this shape; recorded UNKNOWN because one site is not a measurement of how common it is.",
    origin:
      "conceived 2026-08-27 after a division landing page returned almost no links despite being a quarter of a megabyte — the giveaway that the navigation is built client-side",
    outcome: {
      jurisdiction: "nh",
      rows: 26,
      outcome: "YIELDED",
      note: "26 sitemap URLs mentioning rates, villages or precincts, one of which was the village-district tax-rate page the walk needed and the rendered page did not link",
    },
  },
  {
    id: "reported-address-has-rotted",
    title:
      "an official register's web-address column is a snapshot: re-validate it, and treat a page that does not name the government as a stale ADDRESS rather than an absent body",
    tier: "A0",
    fields: ["body", "source"],
    note:
      "measured across the 2022 Census of Governments clip for three counties. The column is dated 2022 and no process re-checks it. Every register with a URL column has this shape — a state agency directory, a school-district list, a licensing roster — so the CHECK travels even though the specific rot does not.",
    origin:
      "conceived 2026-08-27 after a promotion control refused a page: mtoliveboe.org, the Mount Olive Township School District's reported address, answers HTTP 200 and serves a Japanese personal-finance blog",
    outcome: {
      jurisdiction: "pilot-counties",
      rows: 33,
      outcome: "YIELDED",
      note: "of 90 governments reporting a usable address, 57 opened and named themselves, 25 were unreachable at every rung and 8 answered with a page about something else — a THIRD of the column did not lead to the government that filed it. Named cases: newburyh.org (Town of Newbury, the pilot ZIP's own town) does not resolve; laketoddvillagedistrict.us 404s; centralhooksettwater.com serves a Parallels Plesk default page; mtoliveboe.org serves a Japanese finance blog; WWW.MTLAKES.ORG carries no district content. None is an absent government — Newbury's live site is newbury.nh.gov and the DRA rate table proves Lake Todd and Central Hooksett still levy.",
    },
  },
  {
    id: "official-enumeration-cross-check",
    title:
      "reconcile two INDEPENDENT official enumerations of the same body and record the disagreement rather than choosing one (RULING 57)",
    tier: "A0",
    fields: ["roster", "body"],
    note:
      "proved once, on a county delegation. The technique needs two official publishers of the same universe, which is common for legislative bodies and rare for special districts — so its reach is a property of the SUBJECT rather than of the state.",
    origin:
      "conceived 2026-08-26 while reading a county annual report against the General Court member roster the project already held; the counts agreed exactly and six names did not",
    outcome: {
      jurisdiction: "nh",
      rows: 6,
      outcome: "YIELDED",
      note: "45 against 45, 42 agreed on surname; 2 surname spellings and 4 given-name forms disagreed. Recorded on both sides rather than resolved.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
