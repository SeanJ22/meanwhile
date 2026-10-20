# BA-01 southern source comparisons

Captured October 20, 2026. First integration freeze: 23:33 UTC. Reproduce counts with `python scripts/ba01-south-compare.py`. The capture metadata and source documents in this directory support that replay. These are source comparisons, not live ZIP acceptance results.

| State | Official comparison scope | Official contests / candidate rows | Held matches | Remaining work |
| --- | --- | --- | --- | --- |
| AL | Federal, statewide, legislative, education certifications | 167 / 241 | 167 / 241 | Full county, municipal, district and measure coverage |
| TN | Five federal, gubernatorial and legislative certified lists | 126 / 266 | 126 / 266 | Locals; House 93 says no candidate qualified |
| KY | Active federal and legislative candidate list | 126 / 206 | 126 / 206 | Locals |
| OK | Printed federal, statewide and legislative races across 77 county sections | 84 / 182 | 84 / 182 | Locals; unopposed offices omitted by the election authority |
| KS | All offices in the official candidate table | 247 / 362 | 149 / 263 | 98 judicial contests / 99 names need division mapping |
| NE | Statewide list excluding natural resources districts | 42 / 92 | 42 / 92 | 64 NRD candidate rows need regional divisions; two additional workers compensation retention candidates already held |
| MS | Statewide sample including regional judicial and DA races | 133 / 188 | 7 / 22 | 126 regional judicial and DA contests / 166 names need divisions |
| LA | Federal and legislative candidate inquiry | 8 / 44 | 8 / 44 | 317 other office selectors need ballot-by-ballot comparison; selectors alone do not establish printed offices |
| AR | Regular federal, statewide and legislative offices listed in official handbook | 129 / unknown | 72 / 112 | 57 regular legislative races; complete statewide November nominee list and later specials remain unacquired |

MS's seven federal/legislative races include special House districts 70 and 77. LA's regular legislature is not up in November 2026. Their small core counts do not establish missing regular legislative seats.

This lane has added 16 countywide AL contests / 23 candidates, five KS State Board of Education contests / 10 candidates, and 95 AR contests / 144 candidates / nine measures. AR additions comprise the first Benton/Pulaski pass and 20 further legislative contests / 26 names from Garland, Saline, Stone, White, Marion and Crawford. JSON totals at the freeze are AL 187 contests / 264 candidates / four measures; KS 150 / 263 / one; AR 117 / 177 / 13.

All original AL, AR and KS contest, candidacy, measure and field-absence objects still appear unchanged after parsing. New legislative source replay is idempotent. The nine-state comparison and `git diff --check` pass. Root owns publication, production-copy validation and live checks; this lane claims no deployment or full ZIP ballot.

## Arkansas core still open

Regular Senate districts: **2, 9, 10, 21, 28, 30, 31**.

House districts: **1, 2, 3, 5, 6, 9, 19, 20, 21, 22, 23, 26, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 42, 43, 44, 45, 53, 55, 56, 57, 59, 60, 61, 62, 63, 64, 65, 68, 86, 87, 88, 93, 94, 95, 96, 97, 98, 99, 100**.

Successful county routes are replays in `scripts/ba01-south-benton.py`, `ba01-south-pulaski.py` and `ba01-south-ar-core.py`. Their receipts link each source. Crawford's county-clerk `.gov` page links its election-commission domain. Marion embeds its notice in a base64 widget configuration. White's current `.ar.gov` site publishes a DOCX notice. Those methods can be reused for more counties.

The Secretary of State search banner still names the preferential primary/nonpartisan judicial election. Its published DataTables API returned HTTP 200 with an empty body for ordinary, full-column and corrected-column requests. A public VoterView address search correctly resolves courthouse addresses and ballot styles without voter identity; its published sample-ballot route returned an empty block for both Washington and Pulaski. That route has not supplied a ballot PDF. County-site retrieval failures and empty API responses do not show that the underlying information is unpublished. Source acquisition continues in `/tmp` while this integration snapshot is frozen.
