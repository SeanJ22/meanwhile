VS-07 county sources, captured October 23, 2026 — trimmed test excerpts

`config-fragment.json` holds the 30 door mappings this test reads (identical to their rows in `data/reference/voting-source-doors.json`): every non-NYC county door plus the eight Richmond (Staten Island) NYC panels. `captures.json` records each exact request URL, final URL, capture time, HTTP status, content type and saved-byte SHA-256.

These are small excerpts, not the saved source documents. A row with `storage: "TRIMMED_EXCERPT"` names the full publisher document's SHA-256 and size in `excerpt`:

- multi-page PDFs keep one printed page (Palm Beach's map panels are on page 2; Tarrant's two-page early schedule is whole), with embedded images removed;
- HTML lists keep their text and links with styles, scripts, images and presentation attributes removed;
- authority-chain pages keep only a native excerpt around the official link the test checks.

The full documents, including all ten NYC borough PDFs and the other county lists, are saved evidence for the production-copy replay (`scripts/vs07-replay.mts`, loaded by `scripts/vs07-evidence.mts`), not code-tree fixtures. NYC and Cuyahoga also use `../vs-07/expand-east-{nyc,cuyahoga}-page.html`.

Source findings recorded at capture (full documents): Harris 617 confirmed Election Day centers; Dallas 70 early and 346 Election Day; Tarrant 47 early and 223 Election Day; Miami-Dade 28 early; Broward 280 polling facilities; Palm Beach 28 early sites and the same 28 drop sites; NYC all ten borough early/day lists through 70 panels; Cuyahoga 268; Franklin 1; Fulton 33; Gwinnett 13 early and 7 drop sites; Wayne 47; Cook (Wheeling, Barrington Hills) 2. Open leads: Harris's scanned early map, Broward's scanned early list and drop schedule, Palm Beach office intake schedules, Fulton's drop page, Oakland's multi-community early sites, Allegheny's workbook, Cook's full county list (HTTP 403).
