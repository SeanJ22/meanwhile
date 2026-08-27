/**
 * Write the 85641 roster evidence ledger.
 *
 * One line per retrieval, carrying the URL actually read, the date, the rung,
 * and the people found. A roster with no evidence line is a roster nobody can
 * check, and the Vail case is exactly why this matters: six names were stored
 * against a page that contains no names at all.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { floored } from "../lib/ops/denominator-floor.ts";

const TODAY = process.env.WTP_TODAY ?? "2026-08-27";

interface Person {
  name: string;
  seat?: string;
  termText?: string;
  email?: string;
  phone?: string;
}

interface Row {
  body: string;
  bodyKind: string;
  governs85641: "VERIFIED" | "PARTIAL" | "LEAD";
  territoryEvidence: string;
  url: string;
  finalUrl?: string;
  rung: number;
  retrieval: "OK";
  outcome: "EXTRACTED" | "ZERO_ROWS" | "EXTRACTION_FAILED";
  reason?: string;
  people: Person[];
}

const ROWS: Row[] = [
  {
    body: "Vail Unified School District No. 20 Governing Board",
    bodyKind: "unified school district",
    governs85641: "VERIFIED",
    territoryEvidence:
      "38 of 44 probed points; Pima County GIS Community2/14 School Districts; the district's own address is 13801 E Benson Hwy, Vail, AZ 85641",
    url: "https://www.vailschooldistrict.org/page/governing-board",
    rung: 6,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason:
      "RUNG 6 IS REQUIRED HERE. The served HTML is 1.44 MB and contains no roster: the site is Apptegy/Thrillshare and the board list renders client-side. Every earlier extraction cited to this URL was uncheckable against it, which is why five of six stored names verified as ABSENT.",
    people: [
      { name: "Allison Pratt", seat: "President" },
      { name: "Callie Tippett", seat: "Clerk" },
      { name: "Jen Anderson", seat: "Member" },
      { name: "Ed Buster", seat: "Member" },
      { name: "Chris King", seat: "Member" },
    ],
  },
  {
    body: "Vail Unified School District No. 20 — Superintendent",
    bodyKind: "unified school district",
    governs85641: "VERIFIED",
    territoryEvidence: "same district",
    url: "https://aptg.co/vSRHq-",
    finalUrl:
      "https://files-backend.assets.thrillshare.com/documents/asset/uploaded_file/2447/Vsd/366dbdc8-2627-4b63-9dd5-d15da5f287da/VailUSDRequestforArguments.pdf",
    rung: 9,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason: "signature block of the district's own statutory Request for Arguments, text layer extracted",
    people: [{ name: "John Carruth", seat: "Superintendent" }],
  },
  {
    body: "Sonoita-Elgin Fire District Board of Directors",
    bodyKind: "fire district",
    governs85641: "VERIFIED",
    territoryEvidence:
      "2 of 44 probed points; Pima County GIS Boundaries/4 Districts - Fire Taxation. The district's own site describes it as serving Sonoita, Elgin, Canelo and Patagonia — communities outside Pima County — so its levy reaches ACROSS the county line into 85641.",
    url: "https://sefd911.org/board-of-directors",
    rung: 2,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason:
      "the page states the governing rule itself: a five-person non-partisan board elected by registered voters of the District to alternating four-year terms",
    people: [
      {
        name: "Chris Johnson",
        seat: "Chair",
        termText: "Expires: November 30, 2028",
        phone: "925-577-4967",
        email: "sefdjohnson@sefd911.org",
      },
      {
        name: "Ruth Ann LeFebvre",
        seat: "Clerk",
        termText: "Term Expires: November 30, 2026",
        phone: "520-559-9008",
        email: "lefbvre@sefd911.org",
      },
      {
        name: "Robert Garber",
        seat: "Member",
        termText: "Expires: November 30, 2028",
        phone: "520-678-9403",
        email: "sefdRgarber@sefd911.org",
      },
      {
        name: "Kat Crockett",
        seat: "Member",
        termText: "Expires: November 30, 2028",
        phone: "520-508-8667",
        email: "crockett@sefd911.org",
      },
      {
        name: "Eddie McArthur",
        seat: "Member",
        termText: "Term Expires: November 30, 2026",
        phone: "619-994-7635",
        email: "mcarthur@sefd911.org",
      },
    ],
  },
  {
    body: "Mescal-J6 Fire District Governing Board",
    bodyKind: "fire district",
    governs85641: "VERIFIED",
    territoryEvidence:
      "ZCTA polygon intersect against Pima County GIS Boundaries/4 Districts - Fire Taxation. The district's own About page states it was ESTABLISHED BY THE COCHISE COUNTY BOARD OF SUPERVISORS on 2009-01-13 — so it is counted under Cochise County and its levy reaches into Pima County's 85641.",
    url: "https://mescalj6fd.gov/board-members/",
    rung: 2,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason:
      "reached only after the robots sweep was taught to fall back to plain HTTP: the county's recorded address www.mescalj6fd.com fails TLS with ERR_TLS_CERT_ALTNAME_INVALID and redirects, over http, to this .gov",
    people: [
      { name: "Dana Law", seat: "Board Chair", termText: "01.06.2023 – 11.30.2026" },
      { name: "Deborah Wise", seat: "Board Clerk", termText: "01.06.2023 – 11.30.2026" },
      { name: "Soni Cido", seat: "Board Member", termText: "11.30.2024 – 11.30.2028" },
      { name: "Wade Temple", seat: "Board Member", termText: "09.10.2024 – 11.30.2026" },
      { name: "William Clowers", seat: "Board Member", termText: "11/19/2025 – 11/30/2028" },
    ],
  },
  {
    body: "Pima Community College District Governing Board",
    bodyKind: "community college district",
    governs85641: "VERIFIED",
    territoryEvidence:
      "board districts 4 (44 of 44 probed points) and 2 (intersect); Pima County GIS Boundaries/15 Districts - Pima Community College Taxation",
    url: "https://pima.edu/about-pima/leadership-policies/governing-board/board-members.html",
    rung: 2,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason:
      "found via the site's own sitemap after a guessed path (/about-pima/leadership/governing-board/) returned 404 — the guess was wrong, not the page missing",
    people: [
      {
        name: "Dr. Nicole Barraza",
        seat: "District 1",
        termText: "Elected November 2024 - December 2026",
        email: "nbarraza_bog@pima.edu",
      },
      {
        name: "Theresa Riel",
        seat: "District 2 — governs part of 85641",
        termText: "Elected November 2022 - December 2028",
        email: "triel_bog@pima.edu",
      },
      {
        name: "Kristen Ann Randall",
        seat: "District 3",
        termText: "Elected November 2024 - December 2030",
        email: "Krandall11_bog@pima.edu",
      },
      {
        name: "Greg Taylor",
        seat: "District 4 (Board Chair) — governs most of 85641",
        termText: "Elected November 2022 - December 2028",
        email: "gtaylor23_bog@pima.edu",
      },
      {
        name: "Karla Bernal Morales",
        seat: "District 5",
        termText: "Elected November 2024 - December 2030",
        email: "kbernalmorales_bog@pima.edu",
      },
    ],
  },
  {
    body: "Pima County Constables — Justice Precincts 7 and 8",
    bodyKind: "county elected officer",
    governs85641: "VERIFIED",
    territoryEvidence: "Justice Precincts 7 and 8 both intersect 85641; Pima County GIS Boundaries/12",
    url: "https://www.pima.gov/225/Constables",
    rung: 2,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason: "the page states the office: a Constable is an elected Peace Officer of the County and their Judicial Precinct",
    people: [
      { name: "Thomas Schenek", seat: "Constable, Justice Precinct 7 (Green Valley)" },
      { name: "Christopher Toth", seat: "Constable, Justice Precinct 8" },
    ],
  },
  {
    body: "Pima County Consolidated Justice Court — Justice of the Peace, Precinct 8",
    bodyKind: "county elected officer",
    governs85641: "VERIFIED",
    territoryEvidence: "Justice Precinct 8 intersects 85641; Pima County GIS Boundaries/12",
    url: "https://www.jp.pima.gov/Judges/Judges.html",
    rung: 2,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason:
      "PARTIAL BY DESIGN. This bench page lists precincts 1, 1, 2, 4, 6, 8, 9 and 10. Precinct 7 IS NOT ON IT, and that is a fact about this page rather than about precinct 7 — see the next row.",
    people: [{ name: "Kristel Ann Foster", seat: "Justice of the Peace, Precinct 8" }],
  },
  {
    body: "Green Valley Justice Court — Justice of the Peace, Precinct 7",
    bodyKind: "county elected officer",
    governs85641: "PARTIAL",
    territoryEvidence:
      "Justice Precinct 7 intersects 85641; the court's own page names Corona de Tucson — an 85641 community — among the six it serves",
    url: "https://www.pima.gov/876/Justice-Court-Green-Valley",
    rung: 2,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason:
      "THE PRECINCT NUMBER IS DERIVED, NOT STATED. This page names Judge Raymond Carroll and the communities served but never the precinct number. The link to precinct 7 comes from the Constables page, which lists Constable Thomas Schenek as 'Green Valley, AZ / Justice Precinct 7', plus precinct 7's absence from the consolidated bench. Well supported, and still an inference — it is recorded as one so a later session can confirm it against a single authoritative page rather than re-deriving it.",
    people: [{ name: "Raymond Carroll", seat: "Judge, Green Valley Justice Court" }],
  },
  {
    body: "Sahuarita Unified School District No. 30 Governing Board",
    bodyKind: "unified school district",
    governs85641: "PARTIAL",
    territoryEvidence:
      "ZCTA polygon intersect against Pima County GIS Community2/14 School Districts. Found by the INTERSECT and not by the 96-point grid, so it reaches the zip without holding any sampled point — the reader population here may be small, and that is a different fact from zero.",
    url: "https://www.susd30.us/governing-board",
    rung: 6,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason:
      "rung 6: the roster renders client-side and the served HTML carries a reCAPTCHA frame and no members. The site's own sitemap gave the path after /governing-board-home returned a shell.",
    people: [
      { name: "John Sparks", seat: "Governing Board President", email: "jsparks1@sahuarita.net" },
      { name: "Tony Bruno", seat: "Governing Board Clerk", email: "anthony.bruno@sahuarita.net" },
      { name: "Denise Reis", seat: "Governing Board Member", email: "denise.reis@sahuarita.net" },
      { name: "Raul Rodriguez", seat: "Governing Board Member", email: "raul.rodriguez@sahuarita.net" },
      { name: "Amy Petersmarck", seat: "Governing Board Member", email: "amy.petersmarck@sahuarita.net" },
    ],
  },
  {
    body: "Tanque Verde Unified School District No. 13 Governing Board",
    bodyKind: "unified school district",
    governs85641: "PARTIAL",
    territoryEvidence:
      "ZCTA polygon intersect against Pima County GIS Community2/14 School Districts. Intersect only, as with Sahuarita.",
    url: "https://www.tanqueverdeschools.org/page/board-members",
    rung: 6,
    retrieval: "OK",
    outcome: "EXTRACTED",
    reason:
      "rung 6 — another Apptegy site, so the roster is client-rendered and the served HTML carries no names. Seats come from the profile headings the page renders.",
    people: [
      { name: "Beth Peterson", seat: "Board President" },
      { name: "Thomas Trask", seat: "Board Clerk" },
      { name: "Jeremy Schalk", seat: "Board Member" },
      { name: "Anne Velosa", seat: "Board Member" },
      { name: "Jeffrey Neff", seat: "Board Member" },
    ],
  },
  {
    body: "Empire Elementary School District No. 37",
    bodyKind: "elementary school district",
    governs85641: "VERIFIED",
    territoryEvidence:
      "8 of 96 sampled points, from the Census geographies endpoint AND Pima County GIS Community2/14",
    url: "data/reference/nces_ccd_lea_directory_2025_26.csv",
    rung: 1,
    retrieval: "OK",
    outcome: "ZERO_ROWS",
    reason:
      "NO ROSTER FOUND, AND NO WEBSITE FOUND. Two independent official enumerations record this district with an EMPTY website field — Pima County GIS Community2/14, and the NCES CCD LEA directory (nces_leaid 0402820, state id AZ-4415, Open as of 2025-10-01). Sahuarita and Tanque Verde both carry a URL in the same county column, so the blank is a property of this district's publishing rather than of the column. THIS IS 'WE HAVE NOT FOUND ONE', NEVER 'IT HAS NONE': the AZ Department of Education directory, the Pima County School Superintendent, the Auditor General's district reports and a records request to the address below are all unwalked. Recovered contact: 13200 E Greaterville Rd, Sonoita, AZ 85637-6421, (520) 455-0529.",
    people: [],
  },
];

mkdirSync("docs/evidence", { recursive: true });
const lines = ROWS.map((r) => JSON.stringify({ ...r, attemptedAt: TODAY, rows: r.people.length }));
writeFileSync("docs/evidence/az-85641-rosters.jsonl", lines.join("\n") + "\n", "utf8");

const people = ROWS.reduce((n, r) => n + r.people.length, 0);

// RULING 159 — bodies that produced a person, against bodies attempted. A
// roster ledger whose rows all carry zero people is a failed extraction run,
// and it must not write a tidy file and exit 0.
floored(
  "bodies yielding at least one person",
  "docs/evidence/az-85641-rosters.jsonl",
  ROWS.length,
  ROWS.filter((r) => r.people.length > 0).length,
);
console.log(`wrote docs/evidence/az-85641-rosters.jsonl — ${ROWS.length} bodies, ${people} people`);
for (const r of ROWS) {
  console.log(`  ${String(r.people.length).padStart(2)}  ${r.governs85641.padEnd(9)} ${r.body}`);
}
