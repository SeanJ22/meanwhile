# fec_combined_federal_state_disclosure_directory.csv — source note

## Source
- **Landing page:** https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/combined-federalstate-disclosure-and-election-directory/
- **Source document (PDF):** https://www.fec.gov/resources/cms-content/documents/cfsded.pdf
- **Publisher:** Federal Election Commission (United States).
- **Captured UTC:** 10/02/2026 05:11:34
- **Retained source key:** project/meanwhile/source/fec-disclosure-directory/2026/10/02/s16-fec-directory-regeneration/sha256-0a30a76fb056f4708d6edaff96b3be6b026f4cc7f36f65b2cf1bed6a5bd0d22c.pdf
- **Bytes:** 2347174
- **SHA-256:** `0a30a76fb056f4708d6edaff96b3be6b026f4cc7f36f65b2cf1bed6a5bd0d22c`
- **Columns:** jurisdiction, office, records_held, url, email, phone, directory_page.
- **Parsed offices:** 323 across 56 jurisdictions.

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
Run `node --experimental-strip-types scripts/fec-disclosure-directory.mts`
with --pdf, --source-url, --captured-at and --archive-key from the retained capture.
Then run the per-state money registration generator for the requested states.
The source PDF remains in the existing ignored vault and is not committed.

## Licence
A work of the United States federal government, in the public domain.
