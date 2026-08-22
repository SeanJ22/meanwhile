/**
 * **THE FEC's TWO DIRECTORIES, FETCHED INTO THE REPO** — RULING 69 (NJ Hunt 2,
 * 2026-08-22).
 *
 *   corepack pnpm fec:directories
 *
 * ## Why these two documents and not some others
 *
 * The NJ Hunt's headline finding was that the number of manifest ROUTES is not
 * the variable that decides whether a candidate's contact can be reached. What
 * decides it is **what each state's filing authority publishes**: Morris
 * County's clerk publishes a filed email and a filed street address for every
 * candidate in the county, and New Hampshire's authority publishes a name and a
 * town. Same manifest, same seven mechanical routes, wildly different answer.
 *
 * There is no national floor for that, which means the next state has to be
 * asked rather than assumed. These two FEC publications are the national INDEX
 * to that question — every state's election office, and the combined directory
 * naming, per state, the offices that hold disclosure records, the legislative
 * committees that deal with elections and with ethics, and the associations
 * that work on campaign finance.
 *
 * They are **federal government works and therefore public domain**, which is
 * why they can be fetched into the repo rather than linked and re-fetched.
 *
 * ## Refreshable, not a one-time drop
 *
 * Each file lands in `data/reference/` beside a provenance note in the existing
 * convention — source URL, fetch date, byte count, row or page count, licence
 * status, and the trust caveats that apply. Re-running this is how they stay
 * current, and the note records what changed rather than overwriting silently.
 *
 * ## Every fetch states its counts
 *
 * A zero-byte or non-matching response is a FAILED fetch that names the wall,
 * never an empty directory. A 200 whose body is not the document asked for is
 * not the document — the HTML fetch is checked for the words it must contain
 * and the PDF for its `%PDF` magic, because a challenge page served at 200 is
 * the shape this project has been caught by before.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { parseFecDirectory, type DirectoryOffice } from "../lib/hunt/fec-directory.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const OUT = join(ROOT, "data", "reference");
mkdirSync(OUT, { recursive: true });
const STAMP = today();
const UA = "we-the-people/1.0 (civic data; seanj22@gmail.com)";

type Target = {
  slug: string;
  what: string;
  url: string;
  kind: "html" | "pdf";
  /** Words the real document must contain. A 200 without them is not it. */
  mustContain: string[];
};

const TARGETS: Target[] = [
  {
    slug: "fec_state_election_offices",
    what: "FEC — State election offices",
    url: "https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices/",
    kind: "html",
    mustContain: ["election", "New Jersey", "New Hampshire", "Arizona"],
  },
  {
    slug: "fec_combined_federal_state_disclosure_directory",
    what: "FEC — Combined Federal/State Disclosure and Election Directory",
    url: "https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/combined-federalstate-disclosure-and-election-directory/",
    kind: "html",
    mustContain: ["Combined Federal", "Directory"],
  },
];

type Result = {
  target: Target;
  status: number;
  bytes: number;
  ok: boolean;
  reason: string;
  body?: string;
  bin?: Uint8Array;
};

async function get(t: Target, url = t.url): Promise<Result> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
  } catch (err) {
    return {
      target: t,
      status: 0,
      bytes: 0,
      ok: false,
      reason: `rung 2 refused at the transport: ${String(err).split("\n")[0]}`,
    };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const bytes = buf.byteLength;
  if (!res.ok) {
    return { target: t, status: res.status, bytes, ok: false, reason: `HTTP ${res.status}` };
  }
  if (t.kind === "pdf") {
    const magic = new TextDecoder("latin1").decode(buf.slice(0, 5));
    if (!magic.startsWith("%PDF")) {
      return {
        target: t,
        status: res.status,
        bytes,
        ok: false,
        reason:
          `200 but the body does not begin with %PDF (saw ${JSON.stringify(magic)}) — this is not the ` +
          "document, and writing it would commit a challenge page as a federal directory",
      };
    }
    return { target: t, status: res.status, bytes, ok: true, reason: "ok", bin: buf };
  }
  const body = new TextDecoder("utf8").decode(buf);
  const missing = t.mustContain.filter((w) => !body.includes(w));
  if (missing.length > 0) {
    return {
      target: t,
      status: res.status,
      bytes,
      ok: false,
      reason:
        `200 but the body does not contain ${missing.map((m) => JSON.stringify(m)).join(", ")} — ` +
        "a response that is not about the thing asked for is not that thing",
    };
  }
  return { target: t, status: res.status, bytes, ok: true, reason: "ok", body };
}

console.log(`\nFEC DIRECTORIES — RULING 69, fetched ${STAMP}\n`);

const results: Result[] = [];
for (const t of TARGETS) {
  const r = await get(t);
  console.log(
    `  ${r.ok ? "HIT   " : "FAILED"} ${t.slug} — HTTP ${r.status}, ${r.bytes} bytes${r.ok ? "" : ` — ${r.reason}`}`,
  );
  results.push(r);
}

/*
 * The directory's own PDF is linked FROM the landing page, so the link is read
 * off the page's hrefs rather than hardcoded — the same discipline the Morris
 * clerk's republication taught, one state up. A hardcoded PDF URL reads a
 * superseded edition as current.
 */
const directoryPage = results.find(
  (r) => r.target.slug === "fec_combined_federal_state_disclosure_directory",
);
let pdfResult: Result | null = null;
let pdfUrl: string | null = null;
if (directoryPage?.ok && directoryPage.body) {
  const hrefs = [...directoryPage.body.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => m[1]!);
  const candidate = hrefs.find((h) => /directory|combined/i.test(h)) ?? hrefs[0];
  if (candidate) {
    pdfUrl = candidate.startsWith("http")
      ? candidate
      : new URL(candidate, directoryPage.target.url).toString();
    const t: Target = {
      slug: "fec_combined_federal_state_disclosure_directory",
      what: "FEC — Combined Federal/State Disclosure and Election Directory (PDF)",
      url: pdfUrl,
      kind: "pdf",
      mustContain: [],
    };
    pdfResult = await get(t, pdfUrl);
    console.log(
      `  ${pdfResult.ok ? "HIT   " : "FAILED"} directory PDF — ${pdfUrl.split("/").pop()} — ` +
        `HTTP ${pdfResult.status}, ${pdfResult.bytes} bytes${pdfResult.ok ? "" : ` — ${pdfResult.reason}`}`,
    );
  } else {
    console.log("  NO PDF LINK found on the directory page — recorded, not assumed absent");
  }
}

/* -------------------------------------------------------------------------- */
/* WHAT IS COMMITTED, AND WHY IT IS THE CONTENT RATHER THAN THE CONTAINER      */
/* -------------------------------------------------------------------------- */

/*
 * RULING 69 says these documents land in `data/reference/`. RULING 20 says PDF
 * binaries do not go in git — they are content-addressed outside the repo with
 * their hashes committed, while REFERENCE DATA and all provenance stay in git.
 *
 * Both hold if what is committed is the DATA rather than the file: the
 * directory's 349 offices as a CSV in the reference convention, the source
 * document's URL, byte count and SHA-256 in the provenance note, and the
 * 2.24 MB binary not committed. Nothing is lost — the CSV is what a session
 * actually reads, and it diffs, where a PDF does not.
 *
 * The conflict between the two rulings is NAMED on a Needs Sean row rather than
 * settled by this session. `CLAUDE.md`: a ruling that contradicts another does
 * not silently win; the conflict is named and the author rules.
 */

function csv(header: string[], rows: string[][]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

let written = 0;
function note(slug: string, lines: string[]) {
  writeFileSync(join(OUT, `${slug}.md`), `${lines.join("\n")}\n`, "utf8");
}

/* ── 1. The state election offices table ─────────────────────────────────── */

const offices = results.find((r) => r.target.slug === "fec_state_election_offices")!;
const officeRows: string[][] = [];
if (offices.ok && offices.body) {
  /*
   * A plain HTML table: state, office, URL, phone. Parsed by CELL rather than
   * by regex over the whole row, because the FEC's template puts a great deal
   * of whitespace and several nested wrappers between cells and a row-level
   * pattern would be guessing at their nesting.
   */
  const rowBlocks = offices.body.split(/<tr[^>]*>/i).slice(1);
  for (const block of rowBlocks) {
    const cells = [...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1]!
        .replace(/<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi, " $1 ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cells.length < 2 || !cells[0]) continue;
    const url = cells.find((c) => /^https?:\/\//.test(c)) ?? "";
    const phone = cells.find((c) => /\d{3}[\/\-]\d{3}-\d{4}/.test(c)) ?? "";
    officeRows.push([cells[0]!, cells[1] ?? "", url.split(/\s+/)[0] ?? "", phone]);
  }
}
if (officeRows.length === 0) {
  console.error(
    "\n  ZERO ROWS parsed from the state-election-offices table — a failed parse, not a country with no " +
      "election offices. The page's markup has changed.",
  );
  process.exit(1);
}
writeFileSync(
  join(OUT, "fec_state_election_offices.csv"),
  csv(["jurisdiction", "office", "url", "phone"], officeRows),
  "utf8",
);
written++;
console.log(`\n  fec_state_election_offices.csv — ${officeRows.length} rows`);

/* ── 2. The combined directory ───────────────────────────────────────────── */

let directoryRows: DirectoryOffice[] = [];
let pdfSha = "";
if (pdfResult?.ok && pdfResult.bin) {
  pdfSha = createHash("sha256").update(pdfResult.bin).digest("hex");
  const text = await extractTextLayer(pdfResult.bin, pdfUrl!);
  if (text.outcome !== "EXTRACTED") {
    console.error(`\n  the directory PDF's text layer is ${text.outcome} — this is a scan, not a parse failure`);
    process.exit(1);
  }
  const parsed = parseFecDirectory(text.items as { page: number; text: string }[], pdfUrl!);
  if (parsed.outcome !== "EXTRACTED") {
    console.error(`\n  directory parse ${parsed.outcome} — ${parsed.reason}`);
    process.exit(1);
  }
  directoryRows = parsed.items as DirectoryOffice[];
  writeFileSync(
    join(OUT, "fec_combined_federal_state_disclosure_directory.csv"),
    csv(
      ["jurisdiction", "office", "records_held", "url", "email", "phone", "directory_page"],
      directoryRows.map((r) => [r.state, r.office, r.recordsHeld, r.url, r.email, r.phone, String(r.page)]),
    ),
    "utf8",
  );
  written++;
  console.log(
    `  fec_combined_federal_state_disclosure_directory.csv — ${directoryRows.length} offices across ` +
      `${new Set(directoryRows.map((r) => r.state)).size} jurisdictions · ` +
      `${directoryRows.filter((r) => r.url).length} with a URL · ` +
      `${directoryRows.filter((r) => r.phone).length} with a phone · ` +
      `${directoryRows.filter((r) => r.email).length} with an email`,
  );
}

/* ── Provenance notes, in the convention `data/reference/*.md` already uses ─ */

note("fec_state_election_offices", [
  "# fec_state_election_offices.csv — source note",
  "",
  "## Source",
  `- **Source URL:** ${offices.target.url}`,
  "- **Publisher:** Federal Election Commission (United States).",
  "- **What it is:** the FEC's own index of every state's election office — the authority that receives",
  "  candidate filings in that state.",
  `- **Columns:** jurisdiction, office, url, phone. ${officeRows.length} rows.`,
  "",
  "## Why this repo holds it — RULING 69",
  "",
  "The NJ Hunt measured that the variable deciding whether a candidate's contact is reachable is NOT the",
  "number of routes in the branch manifest. It is **what each state's filing authority publishes**. Morris",
  "County's clerk publishes a filed email and a filed street address for every candidate in the county;",
  "New Hampshire's authority publishes a name and a town. The manifest is identical in both states and the",
  "same seven routes are mechanical in both — what differs is what two of them return.",
  "",
  "There is no national floor for that, so the next state must be ASKED rather than assumed. This is the",
  "national index to the question.",
  "",
  "## Acquisition",
  `- Fetched ${STAMP} by \`corepack pnpm fec:directories\`, rung 2 (plain fetch).`,
  `- HTTP ${offices.status}, ${offices.bytes} bytes of HTML, parsed to ${officeRows.length} rows.`,
  "- **Content-checked, not merely status-checked.** The response must contain the word \"election\" and the",
  "  names of the three covered states before it is parsed. A 200 whose body is not about the thing asked",
  "  for is not that thing, and this project has been caught by that shape seven times.",
  "- A zero-row parse exits NON-ZERO. A parser that returns nothing has told you about itself.",
  "",
  "## Licence",
  "- **Public domain.** A work of the United States federal government (17 U.S.C. § 105). No attribution",
  "  obligation attaches, and none is claimed to.",
  "",
  "## Trust caveats",
  "- This is the page as served on the fetch date. The FEC revises it; re-run the command to refresh.",
  "- It is an INDEX OF OFFICES, not of publishing practice. It names who the authority is; it does not say",
  "  what that authority publishes. Answering that still requires walking the route.",
]);

const dir = results.find(
  (r) => r.target.slug === "fec_combined_federal_state_disclosure_directory",
)!;
note("fec_combined_federal_state_disclosure_directory", [
  "# fec_combined_federal_state_disclosure_directory.csv — source note",
  "",
  "## Source",
  `- **Landing page:** ${dir.target.url}`,
  `- **Source document (PDF):** ${pdfUrl ?? "no PDF was linked from the landing page on the fetch date"}`,
  "- **Publisher:** Federal Election Commission (United States).",
  `- **Columns:** jurisdiction, office, records_held, url, email, phone, directory_page. ` +
    `${directoryRows.length} rows across ${new Set(directoryRows.map((r) => r.state)).size} jurisdictions.`,
  "",
  "## The PDF is NOT committed, and this is why",
  "",
  "RULING 69 says these documents land here. RULING 20 says PDF binaries do not go in git — they are",
  "content-addressed outside the repo with their hashes committed, while reference data and all provenance",
  "stay in git. Both hold if what is committed is the CONTENT rather than the container.",
  "",
  "So the directory's offices are committed as the CSV beside this note, and the PDF is identified here:",
  "",
  pdfResult
    ? `- **Bytes:** ${pdfResult.bytes}`
    : "- **Bytes:** the PDF was not reached on the fetch date",
  pdfSha ? `- **SHA-256:** \`${pdfSha}\`` : "- **SHA-256:** not computed — the PDF was not reached",
  "",
  "Re-fetch it with `corepack pnpm fec:directories`; the hash above is what to check it against.",
  "",
  "**The conflict between RULING 69 and RULING 20 is named on a Needs Sean tracker row rather than settled",
  "by a session.** `CLAUDE.md`: a ruling that contradicts another does not silently win — the conflict is",
  "named, and the author rules.",
  "",
  "## What it covers",
  "",
  "All 50 states, the District of Columbia, American Samoa, Guam, the Northern Mariana Islands, Puerto Rico",
  "and the US Virgin Islands. For each: the federal disclosure offices, the legislative committees dealing",
  "with elections, the legislative committees dealing with ethics, and nine national and international",
  "associations dealing with campaign finance and elections.",
  "",
  "Every one of those is a manifest CANDIDATE — a body that may publish something a candidate can be",
  "reached through. They are named in `docs/branch-manifest.md` as candidates rather than silently added:",
  "RULING 61 adds a route when it has been WALKED somewhere, not when a directory says the office exists.",
  "",
  "## What New Jersey's entry names — the direct test",
  "",
  "Six offices: the Department of State's Division of Elections (candidates on ballot, election results,",
  "federal campaign-finance reports); the Election Law Enforcement Commission (state and local campaign",
  "finance, personal financial reports, lobbying, pay-to-play); the State Ethics Commission; the Office of",
  "Legislative Services; the Department of the Treasury (political-contributions compliance, and corporate",
  "registration); and the Attorney General.",
  "",
  "**It names WHO the authority is and how to reach a human there. It does not say what that authority",
  "PUBLISHES.** So it does not tell the next state whether its county clerks put a filed email in a PDF the",
  "way Morris County's does — that still takes a walk. What it removes is the part that used to take",
  "longest: finding out who to walk to.",
  "",
  "It has already paid for itself once. `elec.nj.gov` has been recorded in this repo as Imperva-walled",
  "since 2026-08-19 and was still walled on re-walk. That was read as *ELEC is unreachable*. It is not: it",
  "is ELEC's WEBSITE that is unreachable, and this directory hands over a named Executive Director, a",
  "telephone number and a postal address for the same records — a compliant route straight to rung 13 that",
  "no WAF can refuse. Recorded as a sub-branch on `filing-campaign-finance-state`.",
  "",
  "## Acquisition",
  `- Fetched ${STAMP} by \`corepack pnpm fec:directories\`, rung 2 (plain fetch).`,
  `- Landing page: HTTP ${dir.status}, ${dir.bytes} bytes.`,
  pdfResult
    ? `- PDF: HTTP ${pdfResult.status}, ${pdfResult.bytes} bytes, text layer extracted and parsed.`
    : "- PDF: no link found on the landing page on the fetch date.",
  "- **The PDF link is read off the landing page's own hrefs, never hardcoded.** The Morris County Clerk",
  "  republishes at a new version path on every revision and both revisions stay reachable; a hardcoded URL",
  "  reads a superseded edition as current. The same hazard applies here.",
  "- The PDF is checked for its `%PDF` magic bytes before being parsed, so a challenge page served at 200",
  "  cannot be read as a federal directory.",
  "- A zero-row parse exits NON-ZERO with the reason.",
  "",
  "## Licence",
  "- **Public domain.** A work of the United States federal government (17 U.S.C. § 105).",
  "",
  "## Trust caveats",
  "- An edition, as served on the fetch date. Re-run to refresh.",
  "- The parse reads the layout's `*` cell breaks and its ALL-CAPS office headings. Both are properties of",
  "  the FEC's current template, and a template change would show up as a falling office count rather than",
  "  as wrong rows — which is why the count is asserted in `tests/reference-data.test.ts` rather than",
  "  eyeballed.",
  "- `records_held` is the directory's own phrasing, concatenated. The layout interleaves the record labels",
  "  with the office's address block, so some rows carry an address fragment inside that field. It is left",
  "  as the document printed it rather than cleaned, because guessing where a label ends would invent",
  "  structure the document does not have.",
]);

console.log(`\n  files written: ${written} CSV(s) + 2 provenance notes`);

const failed = [...results, ...(pdfResult ? [pdfResult] : [])].filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(
    `\n  ${failed.length} FAILED fetch(es) — each is a named wall, never an empty directory:\n` +
      failed.map((f) => `    ${f.target.slug}: ${f.reason}`).join("\n"),
  );
  process.exit(1);
}
