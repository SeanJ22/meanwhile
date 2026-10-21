# BA-01 Madison address comparisons

Central Library, 201 W Mifflin St, Madison WI 53703, matches the city's official geocoder with a score of 100. The exact point query against the city's ward layer places this address in Ward 52. Dane County's certified list maps that ward to Assembly District 76. The Town of Blooming Grove's official election page links the county's printed ballot style 005, whose reverse explicitly includes City of Madison Ward 052.

Both original printed pages were visually reviewed. The normal repository reader projection matches all eight candidate contests, all fourteen printed candidate choices (including the two explicit governor tickets), and all three statewide measures: 11 contests. The full text of every question matches. The reverse has ward labels and administrative fields, with no additional contest or question. `printed-comparison.json` records the complete race ledger. No ballot data needed changing for this address.

The original City Hall comparison remains separate in `comparison.json`: 210 Martin Luther King Jr Blvd, Madison WI 53703 is Ward 51 and matches the certified list's 11 contests / 14 choices. Ward 51 is absent from printed style 005. Its printed sample remains **NOT_VERIFIED**. Neither comparison establishes every address in ZIP 53703. The live `/ballot` page remains **NOT_VERIFIED** for both addresses.

All original source bytes are compressed unchanged. `captures.json` records requested and final URLs, actual HTTP statuses, retrieval timestamps and SHA-256 hashes; the new municipal parent, printed PDF and Central Library GIS responses also retain actual response headers and byte lengths. The official municipal parent links the exact county PDF. `dane-style005-reviewed.json` transcribes the visibly checked names, party labels, complete questions and printed ward list; OCR is retained as a supplementary aid because the sample watermark obscures parts of its automatic text.

Replay both comparisons with:

`node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/ba01-pacific-wi-madison.mts`

Add `--write-report` to regenerate both reports. The replay verifies raw hashes, HTTP status, the official parent link, exact geocoder-to-ward query coordinates, printed ward scope, every projected race and candidate field, explicit ticket pairings, and every complete question.

Dane's certified list has a stale November 5 sentence and spells Tiffany as Tiffay despite its November 3, 2026 heading. The separately preserved Kenosha list and the printed style 005 establish the correct spelling and both joint tickets. No candidate is invented from either typo. Madison directs readers to MyVote; its HTTP 403 response prevented retrieval of the Ward 51 printed sample here.
