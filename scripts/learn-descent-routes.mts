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

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { learnRoute, recordRouteOutcome, type MethodKnowledge } from "../lib/method/knowledge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

interface Learned {
  id: string;
  title: string;
  tier: "A0" | "A1" | "B" | "C";
  fields: string[];
  note: string;
  origin: string;
  outcome: { jurisdiction: string; rows: number; outcome: "YIELDED" | "ZERO" | "FAILED" | "BLOCKED"; note: string };
}

const ROUTES: Learned[] = [
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
      "proved on New Hampshire's Department of Revenue Administration, whose 2024 workbook names 8 of the 15 Merrimack County governments the Census of Governments recorded with NO website. The SHAPE is statutory rather than local — a district that levies must have its rate set and published by somebody — and the specific publisher differs per state, so the route travels further than the URL does.",
    origin:
      "conceived 2026-08-27 from this repository's own note: states/TIERS.md said 'revenue.nh.gov's municipal and property division publishes the rate tables precisely because somebody has to be billed', and that host had refused this project at every rung until rung 3b landed the same day",
    outcome: {
      jurisdiction: "nh",
      rows: 45,
      outcome: "YIELDED",
      note: "45 village/precinct rows statewide in the 2024 workbook; 8 of Merrimack's 15 no-website governments named. Lake Todd Village appears TWICE at 0.24 and 0.38, both flagged *Apportioned — independent official evidence for the Bradford/Newbury spanning district RULING 121 names. A rate of 0 is a district that filed and set no rate, not an absence.",
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

function main(): void {
  const stamp = today();
  let k = JSON.parse(readFileSync(STORE, "utf8")) as MethodKnowledge;
  const before = k.version;
  let learned = 0;
  let already = 0;

  for (const r of ROUTES) {
    const res = learnRoute(
      k,
      {
        id: r.id,
        title: r.title,
        tier: r.tier,
        fields: r.fields,
        applicability: unknownApplicability(r.note),
        outcomes: [],
        subBranches: [],
        origin: r.origin,
        learnedOn: stamp,
      },
      stamp,
    );
    if (res.duplicate) {
      already += 1;
      console.log(`  already known   ${r.id}`);
    } else {
      k = res.knowledge;
      learned += 1;
      console.log(`  LEARNED         ${r.id}  -> method version ${k.version}`);
    }
    const out = recordRouteOutcome(k, r.id, {
      jurisdiction: r.outcome.jurisdiction,
      walkedOn: stamp,
      rows: r.outcome.rows,
      outcome: r.outcome.outcome,
      note: r.outcome.note,
    });
    if (out.recorded) k = out.knowledge;
    console.log(`                  ${out.reason}`);
  }

  writeFileSync(STORE, `${JSON.stringify({ ...k, updatedOn: stamp }, null, 2)}\n`, "utf8");
  console.log(`\nmethod version ${before} -> ${k.version}   (${learned} learned, ${already} already known)`);
  console.log(`routes known now: ${k.routes.length}  — WHAT THE PROJECT KNOWS NOW, never a cap`);
  /*
   * Both numbers, against the population this run actually offered
   * (RULING 159). "3 learned" and "0 learned" print identically as a headline
   * and mean opposite things — the second says every route was already known,
   * which is the answer a re-run should give and a first run should not.
   */
  console.log(
    `  ${floorLine(
      ROUTES.length > 0
        ? floored("routes new to the project", "the routes this session conceived", ROUTES.length, learned)
        : floored("routes new to the project", "the routes this session conceived", 0, 0, "this run offered no routes"),
    )}`,
  );
}

main();
