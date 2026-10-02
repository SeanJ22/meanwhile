/** Re-extract the reference directory from a retained national source PDF. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { parseFecDirectory } from "../lib/hunt/fec-directory.ts";
import { dataPath, notePath } from "../lib/reference/index.ts";

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
