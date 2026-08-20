/**
 * Item 9 — normalize, rename, dedupe, section the tracker (2026-08-20).
 *
 * Written as a script rather than done by hand because 398 rows is past the
 * point where a hand edit can be checked. Every transform below prints its
 * before and after count, and the file is re-parsed at the end — this repo's
 * own memory of the tracker is that a scripted edit which edited nothing
 * exits 0 and reports success.
 *
 * A STATUS CHANGE EDITS THE EXISTING ROW. It never appends a second row with
 * the same ID; M02 and M04 each carried a duplicate pair for a day before
 * anyone noticed, and a tracker with two rows per ID cannot be read by
 * anything, including the xlsx view generator.
 *
 * Run:  corepack pnpm tracker:promptb
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseCsv } from "../lib/reference/index.ts";
import { today } from "./doc-dates.mjs";

const FILE = join(process.cwd(), "docs", "tracker.csv");
const STAMP = today();

const rows = parseCsv(readFileSync(FILE, "utf8"));
const header = rows[0]!;
const body = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
const col = (name: string) => header.indexOf(name);
const [ID, AREA, ITEM, DETAIL, PRIORITY, STATUS, DEPENDS, TARGET, NOTES] = [
  "ID",
  "Area",
  "Item",
  "Detail",
  "Priority",
  "Status",
  "Depends on",
  "Target",
  "Notes",
].map(col);

console.log(`TRACKER IN: ${body.length} rows, ${header.length} columns`);

/* -------------------------------------------------------------------------- */
/* 9a — normalize Area                                                        */
/*                                                                            */
/* You cannot section on a field that drifted. Thirty-six distinct values,    */
/* several the same area under different spellings, and a section boundary    */
/* drawn on "Map" versus "Map & UI" is a boundary between two spellings.      */
/* -------------------------------------------------------------------------- */

const AREA_MERGES: Record<string, string> = {
  // The map family.
  Map: "Map & UI",
  "Map UI": "Map & UI",
  "Map & UX": "Map & UI",
  // The data family. `Sources` and `Data & sources` are the same work.
  Sources: "Data",
  "Data & sources": "Data",
  "Data & signal": "Data",
  Pipeline: "Data",
  // The repo family.
  Repo: "Repo & ops",
  "Repo ritual": "Repo & ops",
  Ops: "Repo & ops",
  // Named separately in the brief's minimum; these three are the same area
  // under three spellings and the merge is stated so it can be argued with.
  Commercial: "Business",
  Signal: "Business",
};

const areaBefore = new Set(body.map((r) => r[AREA]!));
const merges: string[] = [];
for (const r of body) {
  const from = r[AREA]!;
  const to = AREA_MERGES[from];
  if (to && to !== from) {
    r[AREA] = to;
    merges.push(`${from} -> ${to}`);
  }
}
const areaAfter = new Set(body.map((r) => r[AREA]!));

console.log(`\n9a AREA NORMALIZATION`);
console.log(`  distinct Area values: ${areaBefore.size} -> ${areaAfter.size}`);
const mergeCounts = new Map<string, number>();
for (const m of merges) mergeCounts.set(m, (mergeCounts.get(m) ?? 0) + 1);
for (const [m, n] of [...mergeCounts.entries()].sort()) console.log(`  ${m}: ${n} row(s)`);
console.log(`  rows moved: ${merges.length}`);

/* -------------------------------------------------------------------------- */
/* 9b — kill the namespace collision                                          */
/*                                                                            */
/* Tracker rows H01-H06 and session letters h2/h3/h4 are two numbering        */
/* systems that look identical and do not map: tracker H01 is the 03255 depth */
/* sweep, called h3 in session-speak; tracker H02 is body enumeration, called */
/* h2. H04 and h4 COINCIDE, which hides the collision rather than revealing   */
/* it — the worst case, because it makes the mapping look like an identity.   */
/*                                                                            */
/* THE TRACKER IDS MOVE, not the session letters. A tracker id is a machine   */
/* key this session can rename and sweep for; a session letter is a name in   */
/* historical prose, and renaming those would be rewriting the record of what */
/* happened. `HUNT` collides with nothing in either namespace.                */
/* -------------------------------------------------------------------------- */

const H_RENAMES = new Map<string, string>();
for (const r of body) {
  const id = r[ID]!;
  const m = /^H(0[1-6])$/.exec(id);
  if (m) H_RENAMES.set(id, `HUNT${m[1]}`);
}

// Apply to the ID column AND to every "Depends on" that points at one.
for (const r of body) {
  const renamed = H_RENAMES.get(r[ID]!);
  if (renamed) r[ID] = renamed;
  const deps = (r[DEPENDS] ?? "")
    .split(/[,;]\s*/)
    .filter(Boolean)
    .map((d) => H_RENAMES.get(d.trim()) ?? d.trim());
  if (deps.length) r[DEPENDS] = deps.join(", ");
}

console.log(`\n9b NAMESPACE COLLISION`);
console.log(`  tracker ids renamed: ${H_RENAMES.size}`);
for (const [from, to] of H_RENAMES) console.log(`    ${from} -> ${to}`);
console.log(
  `  session letters h2/h3/h4 are UNCHANGED — they are historical prose, not keys`,
);

/* -------------------------------------------------------------------------- */
/* 9c — dedupe before adding                                                  */
/* -------------------------------------------------------------------------- */

const byId = new Map<string, string[]>();
const duplicates: string[] = [];
for (const r of body) {
  if (byId.has(r[ID]!)) duplicates.push(r[ID]!);
  else byId.set(r[ID]!, r);
}
console.log(`\n9c DEDUPE`);
console.log(
  duplicates.length
    ? `  DUPLICATE IDS FOUND: ${duplicates.join(", ")}`
    : `  duplicate IDs: none — every one of ${body.length} rows has a unique key`,
);

const find = (id: string) => body.find((r) => r[ID] === id);

/*
 * THE AGENDA-PLATFORM CRAWLER: one row, a method for a row, or a sibling?
 *
 * `D70` is "Agenda-platform tenant enumeration crawler (replaces the h2
 * enumeration approach)". `HUNT02` (was H02) is "Body enumeration per unit —
 * the missing second layer of the who-governs denominator".
 *
 * They are NOT the same row and neither is redundant. HUNT02 is the GOAL —
 * knowing which bodies exist inside a government, which is exactly the Tier 1
 * to Tier 2 step this session's ledger measures. D70 is ONE METHOD for
 * reaching it, and a partial one: a vendor tenant list finds bodies that
 * publish through Diligent, Granicus or CivicPlus and finds nothing about a
 * town whose select board posts a PDF. Recording D70 as a duplicate of HUNT02
 * would delete the goal the moment the method turned out to be partial.
 *
 * So: both stay, and D70 is made to DEPEND on HUNT02 rather than float beside
 * it, which is what makes the relationship readable instead of a coincidence.
 */
{
  const d70 = find("D70");
  const hunt02 = find("HUNT02");
  if (d70 && hunt02) {
    d70[DEPENDS] = "HUNT02";
    d70[NOTES] =
      `${d70[NOTES]} | ${STAMP} (Prompt B item 9c): reconciled against HUNT02 rather ` +
      `than merged into it. HUNT02 is the GOAL - which bodies exist inside a ` +
      `government, the Tier 1 to Tier 2 step. D70 is ONE METHOD for reaching it and ` +
      `a partial one: a vendor tenant list finds bodies that publish through a ` +
      `vendor and finds nothing about a town whose select board posts a PDF. Merging ` +
      `them would delete the goal the moment the method turned out to be partial.`;
    console.log(`  D70 vs HUNT02: RESOLVED — both stay, D70 now depends on HUNT02`);
  } else {
    console.log(`  D70 vs HUNT02: one of them is missing — NOT resolved`);
  }
}

/*
 * HUNT05 (was H05) already covers special-district territory resolution at
 * 03255. Item 9c says reconcile it against item 5's output rather than
 * opening a new row, so it is UPDATED here and no sibling is created.
 */
{
  const hunt05 = find("HUNT05");
  if (hunt05) {
    hunt05[NOTES] =
      `${hunt05[NOTES]} | ${STAMP} (Prompt B item 5, reconciled per 9c): the national ` +
      `territory join RESOLVES 0 OF THE 40. TIGER publishes no special-district ` +
      `boundary at any vintage, so the geometric method that resolved 47,834 of ` +
      `90,837 Census units nationally reaches not one special district - 39,555 of ` +
      `39,555 unresolved. What this session ADDS is the NAMES: data/derived/` +
      `gap-ledger.md lists 18 Merrimack County districts with Census PID6 and office ` +
      `city, LAKE TODD VILLAGE DISTRICT among them, so the next session dials instead ` +
      `of enumerating. NO NEW ROW OPENED - this row is the work.`;
    console.log(`  HUNT05 vs item 5: RESOLVED — HUNT05 updated, no sibling opened`);
  }
}

/*
 * F24 and F25 reconciled against their fixes.
 */
{
  const f25 = find("F25");
  if (f25) {
    f25[STATUS] = "Done";
    f25[NOTES] =
      `${f25[NOTES]} | ${STAMP} (Prompt B item 1b, branch claude/promptb-denominators-0820). ` +
      `Every workflow job now carries timeout-minutes (30 or 60) and the two steps that ` +
      `can block on the network - the browser install and the suite - carry 15. The hang ` +
      `did NOT reproduce and this does not claim to have found its cause; what is removed ` +
      `is the SIX-HOUR SILENCE, so a hang fails naming the step instead of naming the ` +
      `platform. 15 minutes is chosen against measurement: the suite runs in about 8 ` +
      `seconds. Guarded in tests/push-main.test.ts. test/lint/tsc pass.`;
    console.log(`  F25: closed with the fix`);
  }
  const f24 = find("F24");
  if (f24) {
    f24[NOTES] =
      `${f24[NOTES]} | ${STAMP} (Prompt B): still Done and reconciled. RULING 12 carries ` +
      `the WALL/JOB vocabulary forward - scripts/fetch-tiger-national.mts names each ` +
      `outcome and states whose stopwatch ran out, using a 15-minute BATCH budget rather ` +
      `than any interactive one.`;
    console.log(`  F24: reconciled, stays Done`);
  }
  const r48 = find("R48");
  if (r48) {
    r48[STATUS] = "Done";
    r48[NOTES] =
      `${r48[NOTES]} | ${STAMP} (Prompt B item 1a). FIVE workflows push main, not two: the ` +
      `four governed-artifact refreshes plus the intake tripwire. Each carried only its ` +
      `OWN concurrency group, so two runs of the same workflow could not overlap and two ` +
      `different ones could - refresh-dotgov at 09:17 Monday and refresh-fec at 09:23 are ` +
      `six minutes apart. scripts/push-main.mjs rebases onto origin/main and retries, and ` +
      `never exits zero having lost work. A shared concurrency group was REJECTED: GitHub ` +
      `keeps one pending run per group and cancels earlier ones, trading a loud red for a ` +
      `quiet loss. PROVED by forcing a real collision against real git repositories in ` +
      `tests/push-main.test.ts - both runs' artifacts present afterward.`;
    console.log(`  R48: closed with the fix and the collision proof`);
  }
  const aud06 = find("AUD06");
  if (aud06) {
    aud06[NOTES] =
      `${aud06[NOTES]} | ${STAMP} (Prompt B items 1d and 11.5). The separator half is CLOSED: ` +
      `tests/coverage-manifest.test.ts now normalizes through the one shared helper ` +
      `(scripts/repo-path.mjs) and its offender list no longer contains lib/coverage/` +
      `states.ts on Linux. tests/path-separator.test.ts guards the class. WHAT REMAINS ` +
      `OWED on this row is the manifest itself - a single place describing what this ` +
      `product watches - which the gap ledger informs but does not replace.`;
    console.log(`  AUD06: separator half closed, remainder stated`);
  }
}

/*
 * THE SAME COLLISION, IN THE OTHER COLUMN.
 *
 * `R47` and `R49` both carry `g3` in "Depends on" — a SESSION letter in a
 * column that holds tracker IDs. It is the 9b collision wearing different
 * clothes: the value looks like a key, resolves to nothing, and made both rows
 * unsectionable because a dependency on a nonexistent id cannot be layered.
 *
 * A session is not a row and cannot be depended on, so the dependency is
 * CLEARED rather than repointed at a guess, and the fact is moved into Notes
 * where prose belongs.
 */
for (const r of body) {
  const dep = (r[DEPENDS] ?? "").trim();
  if (!/^[a-z]\d*$/.test(dep)) continue;
  r[DEPENDS] = "";
  r[NOTES] =
    `${r[NOTES]} | ${STAMP} (Prompt B item 9b): "Depends on" held the session letter ` +
    `"${dep}", not a tracker id. A session is not a row and cannot be depended on, so ` +
    `the dependency is cleared and the fact recorded here. This is the H0x/h-letter ` +
    `collision in the other column.`;
  console.log(`  cleared session-letter dependency on ${r[ID]}: was "${dep}"`);
}

/* -------------------------------------------------------------------------- */
/* 9e — the new rows                                                          */
/* -------------------------------------------------------------------------- */

const NEW_ROWS: Array<Record<string, string>> = [
  {
    ID: "PB01",
    Area: "Coverage",
    Item: "The Montana school-district variance blocks Montana and state-level district claims",
    Detail:
      "CCD reports 387 regular open districts in Montana; the Census reports 311 independent school districts; Montana has ZERO dependent school systems to explain the gap. Every other high-variance state collapses to near zero once Census dependent systems are added back - CT +2, MA +4, RI 0, TN -1, VA -3, ME -11 - and Montana does not. Until it is explained, no Montana school-district coverage claim and no state-level district count may be published.",
    Priority: "P1",
    Status: "Not started",
    "Depends on": "",
    Target: "",
    Notes: `${STAMP} (Prompt B item 9e, RULING 11). The variance is recorded in data/reference/nces_ccd_lea_directory_2025_26.md and reproduced in data/derived/census-nces-crosswalk.md. THE SPEC: read Montana's own district roster from the Office of Public Instruction and reconcile against both files, naming which of the three counts is the outlier rather than picking one.`,
  },
  {
    ID: "PB02",
    Area: "Coverage",
    Item: "Special-district territory resolution, nationally - the single largest gap in the product",
    Detail:
      "39,555 of 39,555 special districts are UNRESOLVED. TIGER publishes no special-district boundary at any vintage - not a subset, none. They are 43.55% of every government in the country and this number caps Tier 1 nationally: 97.88% of ZCTAs sit at Tier 0 because of it, and no zip anywhere can reach Tier 1 while a county over it holds an unresolved district.",
    Priority: "P0",
    Status: "Not started",
    "Depends on": "",
    Target: "",
    Notes: `${STAMP} (Prompt B item 5.3, the ceiling). FOUR RUNGS NAMED AND NOT WALKED: (1) county assessor/auditor special-district tax-levy layers, which carry boundaries because they have to bill them; (2) state special-district registries, where a district files its territory with the secretary of state or a local-government commission; (3) per-state GIS open-data portals publishing fire, water and library district layers county by county; (4) the district's own published service-area map. A mailing-address zip is NEVER territory - a county water authority head-quartered downtown serves the county. data/derived/gap-ledger.md names the districts per pilot zip.`,
  },
  {
    ID: "PB03",
    Area: "Data",
    Item: "Embedded-JSON extractor, sized against F01C2's blind spot",
    Detail:
      "A body's agenda data frequently lives in a JSON blob inside the HTML rather than at a documented endpoint, and the current retrieval reads the rendered prose and misses it. Ladder rung 7 - the page's own network calls - and rung 8 - structured markup the prose hides - both point at this, and neither has a reusable extractor.",
    Priority: "P1",
    Status: "Not started",
    "Depends on": "HUNT02",
    Target: "",
    Notes: `${STAMP} (Prompt B item 9e). SIZED AGAINST THE LEDGER: this closes bodies that are territory-resolved but not enumerated, which is the Tier 1 to Tier 2 step. scripts/embedded-json-census.mts already censuses where embedded JSON appears; the extractor is the thing that has not been built. Every rung it walks is recorded in docs/source-ladder.md per body.`,
  },
  {
    ID: "PB04",
    Area: "Data",
    Item: "CivicPlus vanity-domain detection - the 1,550-row legacy list does not reach the client base",
    Detail:
      "The committed CivicPlus tenant list holds 1,550 rows against a claimed 13,000+ client base - about 12% - and it is LEGACY SUBDOMAIN PATTERN ONLY, with 1,387 rows stale to 2020. Every tenant that moved to a vanity domain is invisible to it. Census and CCD website columns cannot substitute: a platform-signature scan returned 1 hit in 39,182 Census URLs and 0 in 17,346 CCD URLs, so they are seed lists for crawling and not a detection surface.",
    Priority: "P1",
    Status: "Not started",
    "Depends on": "PB03",
    Target: "",
    Notes: `${STAMP} (Prompt B item 9e). THE METHOD IS DETECTION, NOT ENUMERATION: fetch a body's own homepage from the Census/CCD seed URL and look for the platform's signature in the served markup - asset paths, script hosts, the AgendaCenter route shape - rather than guessing a subdomain. Sized against the gap ledger: it fills bodies for governments already territory-resolved.`,
  },
  {
    ID: "PB05",
    Area: "Data",
    Item: "Acquire the NCES F-33 Census ID crosswalk and retire the name-based school-district join",
    Detail:
      "The Census-to-NCES crosswalk built in Prompt B joins on fips_state plus a normalized district name because NEITHER committed file carries a shared identifier. It matches 9,776 of 13,859 Census school systems; 4,083 remain unmatched and 166 keys stay ambiguous. NCES publishes a Census ID on the F-33 fiscal survey, which would replace the method outright rather than improve it.",
    Priority: "P2",
    Status: "Not started",
    "Depends on": "",
    Target: "",
    Notes: `${STAMP} (Prompt B item 4). The 3,373 unmatched independent districts directly cap school-district territory resolution at 9,127 of 12,546 (72.75%), so this row is worth exactly that gap. data/derived/census-nces-crosswalk.md carries the full method and both unmatched denominators.`,
  },
  {
    ID: "PB06",
    Area: "Coverage",
    Item: "The 35 governments that resolve to no zip, and the 1,599 USPS ZIPs with no ZCTA",
    Detail:
      "Two small named gaps in the national territory join. 35 government polygons resolved to no zip after both the forward lattice pass and the reverse representative-point pass. Separately, 1,599 of the 26,195 USPS ZIPs observable in the Census unit file (6.10%) have no ZCTA at all and cannot be answered geographically by any method this product currently has.",
    Priority: "P2",
    Status: "Not started",
    "Depends on": "",
    Target: "",
    Notes: `${STAMP} (Prompt B items 5.4 and 5.5, RULING 10). A ZIP with no ZCTA is a delivery route with no areal geometry - PO-box-only, single-building and military ZIPs enclose no territory at all - so the honest fix is a stated refusal at those zips rather than a geometric guess. The 35 unreached polygons are enumerable from data/derived/zip-governments.json and need naming before they can be worked.`,
  },
  {
    ID: "PB07",
    Area: "Repo & ops",
    Item: "The intake tripwire pushes main with no test gate",
    Detail:
      "Four of the five workflows that push main run the full suite before committing. intake-tripwire.yml does not: it writes docs/intake-report.md and pushes straight to main. The document is governed by tests/doc-dates.test.ts and tests/generated-doc-dates.test.ts, so a bad stamp from the tripwire would go red for everybody else afterwards rather than for the run that produced it.",
    Priority: "P2",
    Status: "Not started",
    "Depends on": "",
    Target: "",
    Notes: `${STAMP} (Prompt B item 1c, found while enumerating what each workflow gates on). NOT FIXED IN THIS SESSION deliberately: adding the full suite to a daily job is a cost decision for the author, and the narrower alternative - running only the doc-date tests - is the kind of partial gate F22's shared-gate guard exists to prevent. Stated rather than smoothed.`,
  },
  {
    ID: "PB08",
    Area: "API",
    Item: "LegiScan client - roll calls, sponsors, committees and session history",
    Detail:
      "LegiScan is ALREADY WIRED as a bill-text and vote source (scripts/fetch-legiscan.mts, dataset_hash-gated, weekly Sunday). What is NOT read is most of a state legislator card sitting in the same API, already structured: getRollCall gives per-member votes, getBill gives sponsors and committee referral, getSessionList gives session history. Endpoints needed: getRollCall, getBill, getSponsor, getSessionList, on top of getDatasetList and getDataset which are already in use.",
    Priority: "P1",
    Status: "Not started",
    "Depends on": "",
    Target: "",
    Notes:
      `${STAMP} (Prompt B item 10 — SPEC ONLY. RULING 8: no API client is built in this session.) ` +
      "GAP IT CLOSES: state legislators, Tier 2 to Tier 3 - the Kelly-standard RECORD half. LEDGER ROWS IT FILLS: every territory-resolved state-legislative division whose members carry no voting record. SIZE: one getDataset per state per session is already paid for; the incremental cost is one getRollCall per roll call of interest, so a state-session backfill is roughly 500 to 3,000 fetches per state depending on session length. CADENCE: weekly Sunday, hash discipline MANDATORY - the existing job already refuses to download an unchanged dataset_hash, and that property is what keeps this affordable.",
  },
  {
    ID: "PB09",
    Area: "API",
    Item: "Congress.gov client - member votes, cosponsorships, committee membership",
    Detail:
      "CONGRESS_API_KEY is wired, and scripts/fetch-votes.mts and scripts/law-votes-resolver.mts already read roll-call XML from clerk.house.gov and senate.gov. What is not read is the Congress.gov API member-centric endpoints - sponsored-legislation, cosponsored-legislation, and committee membership - which are the two RECORD-tier fields a federal legislator card is missing.",
    Priority: "P1",
    Status: "Not started",
    "Depends on": "",
    Target: "",
    Notes:
      `${STAMP} (Prompt B item 10 — SPEC ONLY. RULING 8: no API client is built in this session.) ` +
      "GAP IT CLOSES: federal officials, Tier 2 to Tier 3. LEDGER ROWS IT FILLS: the federal divisions on every one of the 33,791 zips - this is the one layer that is already national, so it is the cheapest Tier 3 progress available anywhere on the ledger. SIZE: 535 members times 3 endpoints, paginated at 250, so roughly 2,000 to 4,000 fetches for a full backfill and delta only afterwards. NOTE THE KEY NAME: it is CONGRESS_API_KEY, not DATA_GOV_API_KEY - see PB13.",
  },
  {
    ID: "PB10",
    Area: "API",
    Item: "FEC client beyond totals - BLOCKED ON ELECTION-LAW COUNSEL",
    Detail:
      "scripts/fetch-fec.mts reads api.open.fec.gov with FEC_API_KEY and ships committee totals, small-donor share and the largest reported contributions. Beyond that sit individual contributions (schedule_a), independent expenditures (schedule_e) and committee linkages, none of which are read.",
    Priority: "P1",
    Status: "Not started",
    "Depends on": "D23",
    Target: "",
    Notes:
      `${STAMP} (Prompt B item 10 — SPEC ONLY. RULING 8: no API client is built in this session.) ` +
      "BLOCKING PRECONDITION, NOT A CAVEAT: ELECTION-LAW COUNSEL REVIEW IS REQUIRED BEFORE ANY CAMPAIGN-FINANCE FEATURE BUILT ON THIS SHIPS. Two distinct exposures. (1) The FEC sale-or-use restriction on contributor data at 52 U.S.C. 30111(a)(4), which matters more here than for a typical consumer app because the business model is selling derived data - it may constrain which endpoints are usable AT ALL. (2) In-kind contribution risk, where providing something of value to a campaign is itself a regulated contribution. D23 holds the legal question and its named closer is counsel; nothing is built until that row closes. GAP IT CLOSES: the FUNDING evidence tier on candidate cards. SIZE: unknowable until the legal scope is known, which is precisely the point of the precondition.",
  },
  {
    ID: "PB11",
    Area: "API",
    Item: "Census API client - zip geography and demographics",
    Detail:
      "api.census.gov is NOT used anywhere in this repo. This session fetched seven TIGER cartographic boundary FILES and reads them offline; that is geometry, and it carries no population, no median age and no household count. A district card that says which body governs you and nothing about who lives there is a boundary, not a place.",
    Priority: "P2",
    Status: "Not started",
    "Depends on": "",
    Target: "",
    Notes:
      `${STAMP} (Prompt B item 10 — SPEC ONLY. RULING 8: no API client is built in this session.) ` +
      "GAP IT CLOSES: it makes a district card MEAN something - the reader who wants to know whether their school district is 2,000 people or 200,000. LEDGER ROWS IT FILLS: NONE DIRECTLY, and that is stated rather than hidden. This closes no coverage gap in the ledger; it adds a layer on top of one already closed. It is the weakest-justified of the six rows and is sized last on purpose. SIZE: ACS 5-year at ZCTA level is a handful of bulk calls, roughly 10 to 50 fetches for the whole country, so it is cheap if it is wanted at all.",
  },
  {
    ID: "PB12",
    Area: "API",
    Item: "LDA lobbying disclosure - currently fetching NOTHING",
    Detail:
      "ANSWERING ITEM 10 DIRECTLY: the repo contains ZERO references to the Lobbying Disclosure Act API, to lobbying disclosure, or to senate.gov/lobby. It is not fetching anything at all - not partially, not behind a flag, not deferred mid-build. The Senate LDA REST API at lda.senate.gov is open and needs no key.",
    Priority: "P3",
    Status: "Not started",
    "Depends on": "",
    Target: "",
    Notes:
      `${STAMP} (Prompt B item 10 — SPEC ONLY. RULING 8: no API client is built in this session.) ` +
      "GAP IT CLOSES: nothing currently on the gap ledger. The ledger measures GOVERNMENTS and BODIES; a lobbying registrant is neither, so this would be a new evidence class rather than a fill of an existing one. OPENED ANYWAY, at P3, because item 10 asked whether it fetches anything and the honest answer deserves a row rather than silence. BEFORE IT IS BUILT it needs the same question D23 asks of the FEC: this product SELLS derived aggregates, and an influence-adjacent dataset is exactly where characterizing an organization becomes tempting, which CLAUDE.md forbids outright. SIZE: not estimated, because nothing on the ledger justifies estimating it yet.",
  },
  {
    ID: "PB13",
    Area: "Repo & ops",
    Item: "DATA_GOV_API_KEY does not exist in this repo",
    Detail:
      "The Prompt B brief names DATA_GOV_API_KEY as the credential for both FEC and govinfo. A full-repo sweep with the non-skipping tool finds ZERO occurrences. The FEC path uses FEC_API_KEY and Congress uses CONGRESS_API_KEY; .env.example declares ten keys and DATA_GOV_API_KEY is not among them. govinfo is not fetched at all - it appears only as four reader-facing House Practice URLs in lib/votes/vote-explainers.ts.",
    Priority: "P3",
    Status: "Done",
    "Depends on": "",
    Target: "",
    Notes:
      `${STAMP} (Prompt B item 10 — SPEC ONLY. RULING 8: no API client is built in this session.) ` +
      "RECORDED SO A LATER SESSION DOES NOT GO LOOKING FOR IT. api.data.gov issues one key that fronts several agency APIs including OpenFEC and govinfo, so the brief assumption is reasonable and simply does not describe this repo - the FEC adapter holds its own key against the same upstream. NO ROW WAS OPENED FOR GOVINFO: item 10 asks what it would close, and the answer is nothing on the ledger. The govinfo collections this product would want - the Federal Register, the US Code - answer questions about federal law, and every gap on the ledger is a local body or a local person. Stated as a decision rather than left as an omission.",
  },
];

let added = 0;
for (const spec of NEW_ROWS) {
  if (find(spec.ID!)) {
    console.log(`  ${spec.ID}: already present — NOT re-added (a status change edits the row)`);
    continue;
  }
  const row = header.map((h) => spec[h] ?? "");
  body.push(row);
  added += 1;
}
console.log(`\n9e NEW ROWS: ${added} added`);
for (const s of NEW_ROWS) console.log(`  ${s.ID} — ${s.Item}`);

/* -------------------------------------------------------------------------- */
/* 9d — section on the dependency graph                                       */
/*                                                                            */
/* "A section is a set of rows where nothing inside it depends on anything in */
/* a later section." That is a topological LAYERING, not a topic grouping:    */
/* layer 0 is everything that depends on nothing, layer N is everything whose */
/* deepest dependency sits in layer N-1. Forward, not sideways.               */
/* -------------------------------------------------------------------------- */

const idsPresent = new Set(body.map((r) => r[ID]!));
const depsOf = (r: string[]) =>
  (r[DEPENDS] ?? "")
    .split(/[,;]\s*/)
    .map((d) => d.trim())
    .filter((d) => d && idsPresent.has(d));

const layerOf = new Map<string, number>();
const dangling: string[] = [];
for (const r of body) {
  for (const d of (r[DEPENDS] ?? "").split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean)) {
    if (!idsPresent.has(d)) dangling.push(`${r[ID]} -> ${d}`);
  }
}

// Iterate to a fixed point. A cycle never settles, and is reported by name
// rather than broken silently.
for (let pass = 0; pass < 50; pass += 1) {
  let moved = 0;
  for (const r of body) {
    const deps = depsOf(r);
    const want = deps.length
      ? Math.max(...deps.map((d) => (layerOf.get(d) ?? 0) + 1))
      : 0;
    if ((layerOf.get(r[ID]!) ?? 0) !== want) {
      layerOf.set(r[ID]!, want);
      moved += 1;
    }
  }
  if (moved === 0) break;
}

const cycles: string[] = [];
for (const r of body) {
  const mine = layerOf.get(r[ID]!) ?? 0;
  for (const d of depsOf(r)) {
    if ((layerOf.get(d) ?? 0) >= mine) cycles.push(`${r[ID]} depends on ${d}`);
  }
}

// Sort: by layer, then by priority, then by id — so the file itself reads
// front to back in the order a session should work it.
const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
body.sort((a, b) => {
  const la = layerOf.get(a[ID]!) ?? 0;
  const lb = layerOf.get(b[ID]!) ?? 0;
  if (la !== lb) return la - lb;
  const pa = PRIORITY_ORDER[a[PRIORITY]!] ?? 9;
  const pb = PRIORITY_ORDER[b[PRIORITY]!] ?? 9;
  if (pa !== pb) return pa - pb;
  return a[ID]!.localeCompare(b[ID]!);
});

const layerCounts = new Map<number, number>();
for (const r of body) {
  const l = layerOf.get(r[ID]!) ?? 0;
  layerCounts.set(l, (layerCounts.get(l) ?? 0) + 1);
}

console.log(`\n9d SECTIONS (dependency layers, not topics)`);
console.log(`  sections: ${layerCounts.size}`);
for (const [l, n] of [...layerCounts.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`    section ${l}: ${n} rows`);
}
console.log(
  cycles.length
    ? `  *** ROWS DEPENDING ON A LATER SECTION: ${cycles.join(", ")}`
    : `  no row depends on a later section — the file reads front to back`,
);
console.log(
  dangling.length
    ? `  dangling dependencies (pointing at an id that does not exist): ${dangling.join(", ")}`
    : `  no dangling dependencies`,
);

/* -------------------------------------------------------------------------- */
/* Write, then RE-PARSE — a scripted edit that edited nothing exits 0         */
/* -------------------------------------------------------------------------- */

const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const out = [header, ...body].map((r) => r.map(esc).join(",")).join("\n");
writeFileSync(FILE, `${out}\n`, "utf8");

const reread = parseCsv(readFileSync(FILE, "utf8"));
const rereadBody = reread.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
const rereadIds = rereadBody.map((r) => r[ID]!);
const rereadDup = rereadIds.filter((x, i) => rereadIds.indexOf(x) !== i);

console.log(`\nRE-PARSED AFTER WRITING`);
console.log(`  rows: ${rereadBody.length}`);
console.log(`  columns on every row: ${rereadBody.every((r) => r.length === header.length)}`);
console.log(`  duplicate IDs: ${rereadDup.length ? rereadDup.join(", ") : "none"}`);
if (rereadDup.length) process.exit(1);
if (rereadBody.length !== body.length) {
  console.log(`  *** ROW COUNT CHANGED ON ROUND TRIP: wrote ${body.length}, read ${rereadBody.length}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* 9f — the new shape                                                         */
/* -------------------------------------------------------------------------- */

const statuses = new Map<string, number>();
const priorities = new Map<string, number>();
for (const r of rereadBody) {
  statuses.set(r[STATUS]!, (statuses.get(r[STATUS]!) ?? 0) + 1);
  priorities.set(r[PRIORITY]!, (priorities.get(r[PRIORITY]!) ?? 0) + 1);
}
const done = statuses.get("Done") ?? 0;

console.log(`\n9f THE TRACKER'S NEW SHAPE`);
console.log(`  total rows:      ${rereadBody.length}`);
console.log(`  Done:            ${done}`);
console.log(`  open:            ${rereadBody.length - done}`);
console.log(`  P0:              ${priorities.get("P0") ?? 0}`);
console.log(`  sections:        ${layerCounts.size}`);
console.log(`  distinct Area:   ${new Set(rereadBody.map((r) => r[AREA]!)).size}`);
console.log(`  status spread:   ${[...statuses.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log(`  priority spread: ${[...priorities.entries()].sort().map(([k, v]) => `${k}=${v}`).join(", ")}`);
void ITEM;
void DETAIL;
void TARGET;
