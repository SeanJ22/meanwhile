/** Re-extract the reference directory from a retained national source PDF. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { extracted, zeroRows, type ExtractResult } from "../lib/extract/types.ts";
import { dataPath, notePath } from "./lib/reference-paths.ts";

/** One office in one state, as the directory prints it. */
interface DirectoryOffice {
  state: string;
  office: string;
  /** The record types the directory says this office holds, semicolon-joined. */
  recordsHeld: string;
  url: string;
  email: string;
  phone: string;
  page: number;
}

/**
 * Every state and territory heading the directory uses. Named explicitly: an
 * ALL-CAPS run is also how the document writes an office, so a state cannot be
 * detected by shape.
 */
const JURISDICTIONS = [
  "ALABAMA", "ALASKA", "AMERICAN SAMOA", "ARIZONA", "ARKANSAS", "CALIFORNIA",
  "COLORADO", "CONNECTICUT", "DELAWARE", "DISTRICT OF COLUMBIA", "FLORIDA",
  "GEORGIA", "GUAM", "HAWAII", "IDAHO", "ILLINOIS", "INDIANA", "IOWA", "KANSAS",
  "KENTUCKY", "LOUISIANA", "MAINE", "MARYLAND", "MASSACHUSETTS", "MICHIGAN",
  "MINNESOTA", "MISSISSIPPI", "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA",
  "NEW HAMPSHIRE", "NEW JERSEY", "NEW MEXICO", "NEW YORK", "NORTH CAROLINA",
  "NORTH DAKOTA", "NORTHERN MARIANA ISLANDS", "OHIO", "OKLAHOMA", "OREGON",
  "PENNSYLVANIA", "PUERTO RICO", "RHODE ISLAND", "SOUTH CAROLINA",
  "SOUTH DAKOTA", "TENNESSEE", "TEXAS", "UTAH", "VERMONT", "VIRGINIA",
  "VIRGIN ISLANDS", "WASHINGTON", "WEST VIRGINIA", "WISCONSIN", "WYOMING",
] as const;

const URL_RE = /URL\s+(https?:\/\/\S+?)(?:\s|\*|$)/i;
const EMAIL_RE = /E-?Mail:?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const PHONE_RE = /(\d{3}\/\d{3}-\d{4})/;

/**
 * Fields are `*`-delimited cells in reading order: an ALL-CAPS cell is an
 * office, a `-` prefixed cell is a record it holds, and URL, e-mail and phone
 * are labelled. It never decides which office is "the" filing authority. A
 * zero-row parse is a failed parse, never an empty directory.
 */
function parseFecDirectory(
  pages: readonly { page: number; text: string }[],
  sourceLabel: string,
): ExtractResult<DirectoryOffice> {
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars === 0) {
    return zeroRows(
      "TEXT_LAYER",
      sourceLabel,
      0,
      "the directory's text layer was empty — a fact about the fetch, not about the directory",
      { pages: pages.length },
    );
  }

  const rows: DirectoryOffice[] = [];
  let currentState = "";

  for (const p of pages) {
    // The state is the first jurisdiction near the top of the page; contents pages name every state and are skipped.
    const head = p.text.slice(0, 200).toUpperCase();
    const stateHere = JURISDICTIONS.filter((j) => head.includes(j)).sort(
      (a, b) => head.indexOf(a) - head.indexOf(b) || b.length - a.length,
    )[0];
    const contents = /TABLE OF CONTENTS/i.test(p.text);
    if (stateHere && !contents) currentState = stateHere;
    if (contents || !currentState) continue;

    const cells = p.text.split("*").map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);

    let office = "";
    let records: string[] = [];
    let url = "";
    let email = "";
    let phone = "";
    const flush = () => {
      if (!office) return;
      rows.push({
        state: currentState,
        office,
        recordsHeld: records.join("; "),
        url,
        email,
        phone,
        page: p.page,
      });
      records = [];
      url = "";
      email = "";
      phone = "";
    };

    for (const cell of cells) {
      // The page marker (`-80-`) and "(Continued)" banner are dropped by name.
      const bare = cell.replace(/^-\d+-\s*/, "").replace(/\(Continued\)/i, "").trim();
      const isHeading =
        bare.length > 3 &&
        !bare.startsWith("-") &&
        bare === bare.toUpperCase() &&
        /[A-Z]{3}/.test(bare) &&
        !/^\d/.test(bare) &&
        // Labelled phone continuations are contact cells, even in capitals.
        !PHONE_RE.test(bare);
      if (isHeading) {
        const withoutState = JURISDICTIONS.reduce(
          (acc, j) => (acc.startsWith(j) ? acc.slice(j.length).trim() : acc),
          bare,
        );
        if (withoutState) {
          flush();
          office = withoutState;
        }
        continue;
      }
      if (cell.startsWith("-")) {
        const record = cell.replace(/^-\s*/, "").trim();
        if (record) records.push(record);
      }
      if (!url) url = URL_RE.exec(cell)?.[1] ?? "";
      if (!email) email = EMAIL_RE.exec(cell)?.[1] ?? "";
      if (!phone) phone = PHONE_RE.exec(cell)?.[1] ?? "";
    }
    flush();
  }

  if (rows.length === 0) {
    return zeroRows(
      "TEXT_LAYER",
      sourceLabel,
      chars,
      "the text layer was read but no office heading matched — the directory's layout has changed, or this " +
        "is not the directory",
      { pages: pages.length, textChars: chars },
    );
  }

  return extracted("TEXT_LAYER", sourceLabel, chars, rows, {
    offices: rows.length,
    jurisdictions: new Set(rows.map((r) => r.state)).size,
    withUrl: rows.filter((r) => r.url).length,
    withPhone: rows.filter((r) => r.phone).length,
    withEmail: rows.filter((r) => r.email).length,
    textChars: chars,
  });
}

const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const path = argument("pdf"), url = argument("source-url"), capturedAt = argument("captured-at"), archiveKey = argument("archive-key");
if (!path || !url || !capturedAt || !archiveKey) throw new Error("Pass --pdf=<retained path> --source-url=<URL> --captured-at=<UTC timestamp> --archive-key=<vault key>.");
const bytes = new Uint8Array(readFileSync(path)), byteLength = bytes.length;
const hash = createHash("sha256").update(bytes).digest("hex");
const text = await extractTextLayer(bytes, url);
if (text.outcome !== "EXTRACTED") throw new Error(`FEC_DIRECTORY_TEXT_FAILED:${text.reason}`);
const parsed = parseFecDirectory(text.items, url);
if (parsed.outcome !== "EXTRACTED") throw new Error(`FEC_DIRECTORY_PARSE_FAILED:${parsed.reason}`);
const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
const csv = ["jurisdiction,office,records_held,url,email,phone,directory_page",
  ...parsed.items.map(row => [row.state, row.office, row.recordsHeld, row.url, row.email, row.phone, row.page].map(cell).join(",")),
].join("\n") + "\n";
const dataset = "fec_combined_federal_state_disclosure_directory";
writeFileSync(dataPath(dataset), csv);
writeFileSync(notePath(dataset), `# ${dataset}.csv — source note

## Source
- **Landing page:** https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/combined-federalstate-disclosure-and-election-directory/
- **Source document (PDF):** ${url}
- **Publisher:** Federal Election Commission (United States).
- **Captured UTC:** ${capturedAt}
- **Retained source key:** ${archiveKey}
- **Bytes:** ${byteLength}
- **SHA-256:** \`${hash}\`
- **Columns:** jurisdiction, office, records_held, url, email, phone, directory_page.
- **Parsed offices:** ${parsed.rows} across ${parsed.counts.jurisdictions} jurisdictions.

## Extraction
The existing PDF text-layer extractor reads the retained bytes. The shared FEC
directory parser groups office blocks at the document's cell breaks. Capitalized
phone continuations remain in their office block. URLs and record categories
are copied from that block; no URL is guessed or copied from another office.
directory_page is the one-based PDF page containing the office, not its printed
page label. The rows are filing-office leads; they do not establish statutory
custody or assert that campaign reports have been acquired. Record-category text
may retain interleaved address fragments from the published text layer.

## Regeneration
Run \`node --experimental-strip-types scripts/fec-disclosure-directory.mts\`
with --pdf, --source-url, --captured-at and --archive-key from the retained capture.
Then run the per-state money registration generator for the requested states.
The source PDF remains in the existing ignored vault and is not committed.

## Licence
A work of the United States federal government, in the public domain.
`);
console.log(`FEC directory: ${byteLength} source bytes; sha256 ${hash}; ${parsed.rows} offices; ${parsed.counts.jurisdictions} jurisdictions`);
