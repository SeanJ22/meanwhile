Philadelphia current official ward/division polygons

The native official Atlas client at `https://atlas.phila.gov/assets/index-BE7Gx29W.js` names this exact layer:

`https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Political_Divisions/FeatureServer/0/query`

The saved link extract includes the native client SHA-256 and capture time. The application's full 11 MB code bundle remains temporary execution material; the evidence fixtures retain the exact link-bearing excerpt and native polygon responses. `captures.json` records exact request/final URLs, capture times, response types, HTTP status, and saved-byte hashes. The two polygon responses here are trimmed to Ward 2 (29 of 1,703 divisions, the ward holding the native polling point); each `captures.json` row names the full response's hash in `excerpt.of`. The full responses are saved evidence for `scripts/vs07-replay.mts` (see `scripts/vs07-evidence.mts`), not code-tree fixtures.

The current layer metadata names `Political_Divisions`, identifies polygon geometry, reports a September 10, 2026 last data edit, supports out-field SQL expressions, and allows 2,000 records. The separately captured native count response reports 1,703. Both the original full GeoJSON and the final query contain all 1,703 polygons, with identical geometries.

The source has one contradictory short label: canonical `division_num=1301` has `short_div_num=13`, colliding with the true division 1313. The official polling-place list and canonical code both identify the former as ward 13/division 1. The final native server query derives integer `ward` and `division` from the two halves of `division_num`. This also makes wards 01–09 match the native polling layer's integer ward values. The raw short label remains in the native response for comparison. The door maps `precinct` to `division` and `ward` to `ward`; its Philadelphia county scope supplies FIPS 42101.

`config-fragment.json` contains one data-only `boundaryLayer` door. Its URL is the separately captured official Atlas root, `https://atlas.phila.gov/`, and its `extraction.dataUrl` is the complete WGS84 GeoJSON query. The existing boundary reader handles this combination without a code change. Add this door to the master catalog and rerun Pennsylvania. Its distinct root URL keeps boundary acquisition separate from polling-list source replacement; sequential publication merges preserve both.

`tests/voting-source-philly-boundaries.test.ts` verifies hashes, server count and record limit, identical polygon geometries after normalization, the 1,703 published ward/division assignments, a join for every saved Ward 2 polygon, and separate publication merges retaining 683 facilities plus the saved boundaries on both the current and next-day merge. It passes an actual point published by the official polling service through polygon containment and `answerVotingSites`: ward 2/division 8 narrows to exactly ST MARONS CHURCH, 1013 ELLSWORTH ST, with official hours 7 A.M. to 8 P.M.

That test point is a published polling-facility point. It is not a residential live check. Root VS-07 owns the required real-home production replay and post-shipping checks. No Google responses or home addresses are saved here.
