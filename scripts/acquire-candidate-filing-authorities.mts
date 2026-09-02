/**
 * `pnpm acquire:filing-authorities` — **THE CANDIDATE FILING AUTHORITIES OF NH
 * AND NJ, WORKED TO THE POINT WHERE EACH ONE ACTUALLY STOPS.**
 * (Session C final, lane 1, 2026-09-01. RULING 205, RULING 206, RULING 182,
 * RULING 184, R-C9.)
 *
 * `@freshness-reads-here` — every date this writes is stamped in the same
 * expression as the retrieval it describes, from that retrieval's own response.
 *
 * ```
 *   pnpm acquire:filing-authorities            probe, extract, write the record
 *   pnpm acquire:filing-authorities --dry      probe and print, write nothing
 * ```
 *
 * ## Why this exists as an instrument rather than as prose
 *
 * Arizona's statewide filing list is now held as a corpus
 * (`pnpm acquire:az-sos-candidates`). New Hampshire's and New Jersey's are not,
 * and the difference between *"we have not acquired it"* and *"it is not
 * published"* is the difference this whole product turns on. A paragraph
 * asserting where each state stands would be a claim. This RUNS the routes,
 * records what each one answered with its bytes hashed, and names the exact
 * remaining step — so the disposition is measured every time it is re-run and
 * a wall that falls is noticed rather than remembered.
 *
 * ## What it establishes for each authority
 *
 * ```
 *   PERMISSION   the host's own robots.txt, read at the HOST ROOT, verbatim
 *   TRANSPORT    HTTP status, bytes, content-type, last-modified, sha256
 *   EXTRACTION   whether this repository's layers can actually read the document
 *   DISPOSITION  ACQUIRED_AS_CORPUS | REQUIRES_NEW_ADAPTER | BLOCKED_CURRENTLY
 * ```
 *
 * **A disposition is about a ROUTE. The obligation to hold the record stays
 * open regardless** (RULING 205), and `owed` says what would close it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { extractTables } from "../lib/extract/tables.ts";
import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const DRY = process.argv.includes("--dry");
const OUT = join(ROOT, "data", "hunt", "candidate-filing-authorities-2026.json");

const HEADERS: Record<string, string> = {
  "user-agent": "we-the-people/1.0 (civic data for a public-records product)",
  "x-purpose": "civic candidate record index for a public-records product",
};

interface Target {
  readonly id: string;
  readonly stateCode: string;
  readonly authority: string;
  readonly authorityBasis: string;
  readonly scope: string;
  readonly documentTitle: string;
  readonly url: string;
  readonly landingUrl: string;
  readonly robotsUrl: string;
  readonly owed: string;
}

const TARGETS: readonly Target[] = [
  {
    id: "nh-sos-cumulative-filings-2026",
    stateCode: "NH",
    authority: "New Hampshire Secretary of State — Elections Division",
    authorityBasis:
      "the Secretary of State receives every declaration of candidacy for the state primary and " +
      "publishes the cumulative filing list, covering state, federal, county and legislative offices",
    scope: "STATEWIDE",
    documentTitle:
      "09/08/2026 State Primary Election — cumulative filing as of 07/16/2026 (Democratic and Republican)",
    url: "https://www.sos.nh.gov/sites/g/files/ehbemt561/files/docs/cumulative-filings-7.16.26.pdf",
    landingUrl: "https://www.sos.nh.gov/elections/candidates",
    robotsUrl: "https://www.sos.nh.gov/robots.txt",
    owed:
      "PARSE AND NORMALIZE. Two named unknowns, and neither is a fact about New Hampshire: (1) the " +
      "pages are ROTATED, so the generic table layer reads each COLUMN as one row and returns " +
      "ZERO_ROWS — an axis-swapped positional parse is the adapter that is owed, and the office " +
      "heading / county section / candidate row segmentation is its unsolved half; (2) this " +
      "repository holds NO SOURCED CROSSWALK from a New Hampshire State Representative district or " +
      "Executive Council district to an OCD division. `data/ballot/nh-merrimack-2026.json` carries " +
      "exactly one such id (sldl:607, Merrimack District 7) and one data point is not a scheme. " +
      "Deriving the rest would be inventing division ids, so the corpus is not wired into the " +
      "reader projection until the crosswalk is acquired from its own authority.",
  },
  {
    id: "nj-doe-general-candidates-us-house-2026",
    stateCode: "NJ",
    authority: "New Jersey Division of Elections",
    authorityBasis:
      "the Division of Elections is the filing officer for federal office in New Jersey and publishes " +
      "the official list of general-election candidates for those offices",
    scope: "STATEWIDE_FEDERAL_OFFICES_ONLY",
    documentTitle:
      "Official List Candidates for House of Representatives — General Election 11/03/2026",
    url: "https://www.nj.gov/state/elections/assets/pdf/election-results/2026/2026-official-general-candidates-us-house.pdf",
    landingUrl: "https://www.nj.gov/state/elections/election-information-2026.shtml",
    robotsUrl: "https://www.nj.gov/robots.txt",
    owed:
      "PARSE AND NORMALIZE, and then acquire the OTHER HALF OF NEW JERSEY. This document is the " +
      "Division's complete applicable universe for the offices it is the filing officer for — " +
      "federal — and that is not New Jersey's candidate universe. Every county, municipal, school " +
      "and fire-district candidacy is filed with and published by ONE OF 21 COUNTY CLERKS, which is " +
      "where data/ballot/nj-morris-2026.json's 276 candidacies come from. NJ therefore cannot be " +
      "labelled statewide by acquiring this alone (R-C9): the state universe is the UNION of this " +
      "document and 21 county-clerk publications.",
  },
  {
    id: "nj-doe-general-candidates-us-senate-2026",
    stateCode: "NJ",
    authority: "New Jersey Division of Elections",
    authorityBasis:
      "the Division of Elections is the filing officer for federal office in New Jersey and publishes " +
      "the official list of general-election candidates for those offices",
    scope: "STATEWIDE_FEDERAL_OFFICES_ONLY",
    documentTitle: "Official List Candidates for United States Senate — General Election 11/03/2026",
    url: "https://www.nj.gov/state/elections/assets/pdf/election-results/2026/2026-official-general-candidates-us-senate.pdf",
    landingUrl: "https://www.nj.gov/state/elections/election-information-2026.shtml",
    robotsUrl: "https://www.nj.gov/robots.txt",
    owed: "PARSE AND NORMALIZE. See the House row for what the Division's universe does and does not cover.",
  },
];

/**
 * Read a host's robots.txt and return the operative rules VERBATIM.
 *
 * **Only the HOST ROOT counts, and the difference has already bitten this
 * project.** `https://nj.gov/state/elections/robots.txt` answers 200 with
 * `Disallow: /assets`, and the elections documents live under
 * `/state/elections/assets/`. A robots document is only operative at the root
 * of its host — the Drupal template this project has read on three government
 * sites says so in its own header comment — so that file governs nothing. It is
 * recorded anyway, as an OBSERVED PUBLISHER SIGNAL, because a session that
 * silently ignored it would have made a permission decision nobody could later
 * inspect.
 *
 * A transport failure is `CANNOT_TELL`, never `ALLOWED` (RULING 182).
 */
async function readRobots(url: string): Promise<{
  url: string;
  status: number | null;
  verdict: "READ" | "CANNOT_TELL";
  body: string | null;
  note: string;
}> {
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: "follow" });
    const text = await r.text();
    if (!r.ok) {
      return {
        url,
        status: r.status,
        verdict: "CANNOT_TELL",
        body: null,
        note:
          `HTTP ${r.status} to this client. That is a TRANSPORT answer and not a permission verdict ` +
          "(RULING 182). It fails safe for the route and never becomes a fact about the record.",
      };
    }
    return {
      url,
      status: r.status,
      verdict: "READ",
      body: text.slice(0, 4000),
      note: "read at the HOST ROOT, which is the only place a robots document is operative",
    };
  } catch (error) {
    return {
      url,
      status: null,
      verdict: "CANNOT_TELL",
      body: null,
      note: `the client could not complete the request: ${(error as Error).message}. RULING 182: a transport failure is never a permission verdict.`,
    };
  }
}

interface Reading {
  target: Target;
  robots: Awaited<ReturnType<typeof readRobots>>;
  retrieval: {
    httpStatus: number | null;
    byteLength: number;
    contentType: string | null;
    lastModified: string | null;
    etag: string | null;
    sha256: string | null;
    retrievedAt: string;
    error: string | null;
  };
  extraction: {
    textLayer: string;
    textPages: number;
    tables: string;
    tableRows: number;
    positionalRows: number;
    reason: string;
  };
  disposition: "ACQUIRED_AS_CORPUS" | "REQUIRES_NEW_ADAPTER" | "BLOCKED_CURRENTLY";
}

async function read(target: Target): Promise<Reading> {
  const robots = await readRobots(target.robotsUrl);
  const retrievedAt = new Date().toISOString();
  let bytes: Uint8Array | null = null;
  const retrieval: Reading["retrieval"] = {
    httpStatus: null,
    byteLength: 0,
    contentType: null,
    lastModified: null,
    etag: null,
    sha256: null,
    retrievedAt,
    error: null,
  };
  try {
    const r = await fetch(target.url, { headers: HEADERS, redirect: "follow" });
    const buf = new Uint8Array(await r.arrayBuffer());
    retrieval.httpStatus = r.status;
    retrieval.byteLength = buf.length;
    retrieval.contentType = r.headers.get("content-type");
    retrieval.lastModified = r.headers.get("last-modified");
    retrieval.etag = r.headers.get("etag");
    retrieval.sha256 = createHash("sha256").update(buf).digest("hex");
    if (r.ok) bytes = buf;
    else retrieval.error = `HTTP ${r.status}`;
  } catch (error) {
    retrieval.error = (error as Error).message;
  }

  const extraction: Reading["extraction"] = {
    textLayer: "NOT_ATTEMPTED",
    textPages: 0,
    tables: "NOT_ATTEMPTED",
    tableRows: 0,
    positionalRows: 0,
    reason: "",
  };
  if (bytes) {
    const text = await extractTextLayer(bytes.slice(), target.url);
    extraction.textLayer = text.outcome;
    extraction.textPages = text.counts.pagesWithText ?? 0;
    const tables = await extractTables(bytes.slice(), target.url);
    extraction.tables = tables.outcome;
    extraction.tableRows = tables.counts.tableRows ?? 0;
    extraction.positionalRows = tables.counts.candidateRows ?? 0;
    extraction.reason = tables.reason;
  }

  const disposition: Reading["disposition"] =
    retrieval.error !== null || bytes === null ? "BLOCKED_CURRENTLY" : "REQUIRES_NEW_ADAPTER";

  return { target, robots, retrieval, extraction, disposition };
}

console.log(`acquire:filing-authorities · ${AS_OF}\n`);

const readings: Reading[] = [];
for (const t of TARGETS) {
  const reading = await read(t);
  readings.push(reading);
  console.log(`  ${t.id}`);
  console.log(`    robots      ${reading.robots.verdict} (HTTP ${reading.robots.status ?? "none"}) ${t.robotsUrl}`);
  console.log(
    `    retrieval   HTTP ${reading.retrieval.httpStatus ?? "none"} · ${reading.retrieval.byteLength} B · ` +
      `${reading.retrieval.contentType ?? "no content-type"} · last-modified ${reading.retrieval.lastModified ?? "not stated"}`,
  );
  console.log(`    sha256      ${reading.retrieval.sha256 ?? "not retrieved"}`);
  console.log(
    `    extraction  text ${reading.extraction.textLayer} over ${reading.extraction.textPages} page(s) · ` +
      `tables ${reading.extraction.tables} (${reading.extraction.tableRows} row(s) from ` +
      `${reading.extraction.positionalRows} positional row(s))`,
  );
  console.log(`    DISPOSITION ${reading.disposition}\n`);
}

const record = {
  formatVersion: 1,
  generatedBy: "scripts/acquire-candidate-filing-authorities.mts",
  generatedOn: AS_OF,
  cycle: 2026,
  _note: [
    "GENERATED ARTIFACT — never hand-edited (RULING 92). Regenerate with `pnpm acquire:filing-authorities`.",
    "",
    "THE CANDIDATE FILING AUTHORITIES OF NH AND NJ, AND WHERE EACH ROUTE ACTUALLY STOPS TODAY.",
    "",
    "EVERY DISPOSITION HERE IS ABOUT A ROUTE (RULING 205). None of them closes the obligation to hold",
    "the record. `owed` says what would. REQUIRES_NEW_ADAPTER means the document was RETRIEVED and",
    "this repository cannot yet READ it — a fact about our tooling, never about the state.",
    "",
    "ARIZONA IS NOT IN THIS FILE because it is no longer in this state: the Secretary of State's 2026",
    "partisan filing list is held as a corpus at data/candidates/az-2026-sos-candidate-filings.json.",
  ],
  authorities: readings.map((r) => ({
    id: r.target.id,
    stateCode: r.target.stateCode,
    authority: r.target.authority,
    authorityBasis: r.target.authorityBasis,
    scope: r.target.scope,
    documentTitle: r.target.documentTitle,
    url: r.target.url,
    landingUrl: r.target.landingUrl,
    permission: r.robots,
    retrieval: r.retrieval,
    extraction: r.extraction,
    disposition: r.disposition,
    owed: r.target.owed,
  })),
  observedPublisherSignals: [
    {
      url: "https://nj.gov/state/elections/robots.txt",
      observed: "HTTP 200, `User-agent: *` with `Disallow: /assets`, `Disallow: /javascript`",
      operative: false,
      why:
        "a robots document governs only at the ROOT of its host. https://www.nj.gov/robots.txt and " +
        "https://nj.gov/robots.txt were both read on 2026-09-01 and neither disallows " +
        "/state/elections/assets/. This sub-path file is recorded so the decision to treat the " +
        "host-root document as operative is inspectable rather than silent.",
    },
  ],
};

if (DRY) {
  console.log("  --dry: nothing written.\n");
} else {
  mkdirSync(join(ROOT, "data", "hunt"), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(record, null, 1)}\n`, "utf8");
  console.log("  wrote data/hunt/candidate-filing-authorities-2026.json\n");
}
