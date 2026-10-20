# BA-01 Wisconsin county source replay

Official county packets fill Wisconsin contests while direct Wisconsin Elections Commission downloads return HTTP 403. The WEC-authored PDF held on a third-party host is a discovery lead only; no additions in this replay rely on it.

`captures.json` records official URLs, actual download timestamps, and raw SHA-256 hashes. The compressed PDFs preserve the source bytes. The corresponding text captures preserve the complete official county lists. `python scripts/ba01-pacific-wi.py --apply` replays each candidate within its source office block, deduplicates an already-held race, and asserts that every prior contest, candidate, measure and absence remains unchanged.

Winnebago's list covers 9 district races with 22 candidates and 2 county races with 4 candidates. Sauk's list covers 4 district races with 9 candidates and 3 county races with 5 candidates; its CD2 race was already held. Together the initial batch adds 17 contests and 39 candidacies. Brown County's complete certified list supplies 12 district/county races with 23 candidates, and Kenosha County's list supplies 7 district/county races with 13 candidates; CD8 was already held. Ottawa's sample ballot adds CD5, SD33, AD97 and two Waukesha county offices (5 contests, 7 candidates). All source-listed parties and independent designations receive the same fields; unpublished website and incumbent fields stay null.

The explicit governor/lieutenant governor pairings printed in Kenosha's source are recorded in `candidateTickets`, preserving the full held records and IDs. This lets the shared reader adapter render the actual joint choices.

This is a verified partial batch. Statewide completeness, remaining legislative districts, local measures and ZIP-by-ZIP sample-ballot acceptance remain open. The separate held governor/LG source records are preserved; normalized ballot comparisons must count their joint contest once.

The Ottawa PDF omitted `ToUnicode` for standard Arial Identity-H fonts. `scripts/ba01-pacific-wi-pdf.py` restores the standard ASCII glyph map only in a disposable extraction copy. All five imported office blocks were checked against the rendered original page. The raw PDF remains unchanged. The script also extracts normal native PDFs and rejects unknown unmapped font families.
