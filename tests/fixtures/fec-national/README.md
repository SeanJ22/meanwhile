These are real FEC source samples captured on October 12, 2026. `sources.json`
records the source archive URLs and their original SHA-256 hashes.

`cn-2026.txt` selects the 2026 House/Senate rows from `cn26.zip` / `cn.txt`.
Its five mailing-address columns are cleared. `weball-2026.txt` selects the
matching candidate IDs from `weball26.zip` / `weball26.txt`; filed amounts
and dates are unchanged. Together they cover all 50 states and territories.

The JSON files are the first 100 results of `/v1/candidates/` for each of
`office=H` and `office=S`, and `/v1/candidates/totals/`, all filtered by
`election_year=2026`. Totals also use `cycle=2026&election_full=false` to select the two-year period. Pagination metadata is unchanged. Mailing-address
fields are removed from totals. The ID-named totals files are the complete
`/v1/candidate/{id}/totals/?cycle=2026&per_page=100` responses, including the
filed individual itemized and unitemized lines and an empty response.

`totals-full-election.json` is the original default totals response. Its Senate rows can start before 2025; it is retained as real evidence for the period-mismatch regression. No donor identities are present. Tests use actual records for source parsing
and projections, with controlled paging and transport failures to exercise
the acquisition paths. These fixtures are test evidence, not published data.
