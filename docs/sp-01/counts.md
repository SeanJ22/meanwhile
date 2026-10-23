# SP-01 production replay counts

Window: 2026-10-22T08:59:14.769Z through 2026-10-23T08:59:14.769Z (end exclusive). Twenty-four equal one-hour buckets begin at the exact window start.

3930 real pointer moves and 4166 real unchanged receipts: 8096 original purge calls, 294 fixed purge calls. Unchanged after: zero. Read-only database role, READ ONLY transactions, zero production writes.

## Purges per hour

| Hour starting (UTC) | Original purge calls | Fixed purge calls | Publications | Unchanged checks |
| --- | ---: | ---: | ---: | ---: |
| 2026-10-22T08:59:14.769Z | 284 | 0 | 247 | 37 |
| 2026-10-22T09:59:14.769Z | 617 | 21 | 242 | 375 |
| 2026-10-22T10:59:14.769Z | 144 | 0 | 0 | 144 |
| 2026-10-22T11:59:14.769Z | 665 | 16 | 263 | 402 |
| 2026-10-22T12:59:14.769Z | 119 | 0 | 106 | 13 |
| 2026-10-22T13:59:14.769Z | 405 | 16 | 305 | 100 |
| 2026-10-22T14:59:14.769Z | 108 | 0 | 102 | 6 |
| 2026-10-22T15:59:14.769Z | 23 | 17 | 20 | 3 |
| 2026-10-22T16:59:14.769Z | 666 | 27 | 298 | 368 |
| 2026-10-22T17:59:14.769Z | 135 | 16 | 116 | 19 |
| 2026-10-22T18:59:14.769Z | 565 | 13 | 173 | 392 |
| 2026-10-22T19:59:14.769Z | 528 | 18 | 137 | 391 |
| 2026-10-22T20:59:14.769Z | 117 | 1 | 102 | 15 |
| 2026-10-22T21:59:14.769Z | 266 | 21 | 121 | 145 |
| 2026-10-22T22:59:14.769Z | 484 | 16 | 177 | 307 |
| 2026-10-22T23:59:14.769Z | 312 | 16 | 231 | 81 |
| 2026-10-23T00:59:14.769Z | 538 | 4 | 111 | 427 |
| 2026-10-23T01:59:14.769Z | 585 | 17 | 426 | 159 |
| 2026-10-23T02:59:14.769Z | 73 | 9 | 18 | 55 |
| 2026-10-23T03:59:14.769Z | 118 | 17 | 81 | 37 |
| 2026-10-23T04:59:14.769Z | 631 | 4 | 218 | 413 |
| 2026-10-23T05:59:14.769Z | 86 | 22 | 47 | 39 |
| 2026-10-23T06:59:14.769Z | 344 | 20 | 340 | 4 |
| 2026-10-23T07:59:14.769Z | 283 | 3 | 49 | 234 |

## Purges by tag over the window

Hourly counts for each tag, including zeroes, are in [purges-hourly.csv](purges-hourly.csv). Every 5203 current or observed scope is in [scope-tags.csv](scope-tags.csv).

| Tag | Before | After |
| --- | ---: | ---: |
| reader-national | 7659 | 0 |
| reader-national-people | 0 | 1 |
| reader-state:AK | 0 | 0 |
| reader-state:AL | 1 | 5 |
| reader-state:AR | 0 | 0 |
| reader-state:AS | 0 | 0 |
| reader-state:AZ | 237 | 235 |
| reader-state:CA | 1 | 1 |
| reader-state:CO | 0 | 0 |
| reader-state:CT | 0 | 0 |
| reader-state:DC | 9 | 3 |
| reader-state:DE | 17 | 4 |
| reader-state:FL | 8 | 1 |
| reader-state:GA | 8 | 1 |
| reader-state:GU | 0 | 0 |
| reader-state:HI | 1 | 1 |
| reader-state:IA | 2 | 0 |
| reader-state:ID | 9 | 1 |
| reader-state:IL | 6 | 0 |
| reader-state:IN | 4 | 0 |
| reader-state:KS | 2 | 1 |
| reader-state:KY | 1 | 1 |
| reader-state:LA | 0 | 0 |
| reader-state:MA | 1 | 1 |
| reader-state:MD | 1 | 1 |
| reader-state:ME | 1 | 1 |
| reader-state:MI | 1 | 1 |
| reader-state:MN | 1 | 1 |
| reader-state:MO | 1 | 1 |
| reader-state:MP | 0 | 0 |
| reader-state:MS | 0 | 0 |
| reader-state:MT | 1 | 1 |
| reader-state:NC | 1 | 1 |
| reader-state:ND | 2 | 2 |
| reader-state:NE | 1 | 1 |
| reader-state:NH | 89 | 11 |
| reader-state:NJ | 11 | 4 |
| reader-state:NM | 1 | 1 |
| reader-state:NV | 1 | 1 |
| reader-state:NY | 1 | 1 |
| reader-state:OH | 1 | 1 |
| reader-state:OK | 1 | 1 |
| reader-state:OR | 1 | 1 |
| reader-state:PA | 1 | 1 |
| reader-state:PR | 6 | 0 |
| reader-state:RI | 1 | 1 |
| reader-state:SC | 1 | 1 |
| reader-state:SD | 1 | 1 |
| reader-state:TN | 1 | 1 |
| reader-state:TX | 1 | 1 |
| reader-state:UT | 1 | 1 |
| reader-state:VA | 0 | 0 |
| reader-state:VI | 0 | 0 |
| reader-state:VT | 0 | 0 |
| reader-state:WA | 0 | 0 |
| reader-state:WI | 1 | 0 |
| reader-state:WV | 0 | 0 |
| reader-state:WY | 0 | 0 |

## Office points for every state and territory

12804 distinct person/address offices. Production holds 1286 saved points; the read-only publication replay holds 7798. Missing production points are distinguished from points saved only by this replay. All 56 next-run comparisons pass.

| State | Offices | Production saved / missing | Replay saved / missing | Replay missing reasons |
| --- | ---: | ---: | ---: | --- |
| AL | 273 | 31 / 242 | 231 / 42 | MAILING_ADDRESS:28; NO_MATCH:12; ZIP_MISMATCH:2 |
| AK | 133 | 13 / 120 | 124 / 9 | MAILING_ADDRESS:6; NO_MATCH:3 |
| AZ | 121 | 14 / 107 | 116 / 5 | MAILING_ADDRESS:1; NO_MATCH:4 |
| AR | 288 | 23 / 265 | 213 / 75 | MAILING_ADDRESS:53; NO_MATCH:22 |
| CA | 423 | 91 / 332 | 395 / 28 | MAILING_ADDRESS:2; NO_MATCH:22; NO_STREET_ADDRESS:1; ZIP_MISMATCH:3 |
| CO | 139 | 28 / 111 | 135 / 4 | MAILING_ADDRESS:1; NO_MATCH:3 |
| CT | 205 | 10 / 195 | 199 / 6 | NO_MATCH:3; ZIP_MISMATCH:3 |
| DE | 74 | 5 / 69 | 9 / 65 | MAILING_ADDRESS:62; NO_MATCH:3 |
| DC | 15 | 1 / 14 | 15 / 0 | — |
| FL | 410 | 73 / 337 | 376 / 34 | MAILING_ADDRESS:8; NO_MATCH:25; ZIP_MISMATCH:1 |
| GA | 463 | 26 / 437 | 345 / 118 | MAILING_ADDRESS:96; NO_MATCH:21; ZIP_MISMATCH:1 |
| HI | 87 | 4 / 83 | 84 / 3 | NO_MATCH:3 |
| ID | 176 | 17 / 159 | 24 / 152 | MAILING_ADDRESS:89; NO_MATCH:62; ZIP_MISMATCH:1 |
| IL | 447 | 41 / 406 | 246 / 201 | MAILING_ADDRESS:6; NO_MATCH:182; ZIP_MISMATCH:13 |
| IN | 178 | 20 / 158 | 175 / 3 | MAILING_ADDRESS:1; NO_MATCH:2 |
| IA | 180 | 22 / 158 | 27 / 153 | NO_MATCH:103; ZIP_MISMATCH:50 |
| KS | 187 | 18 / 169 | 27 / 160 | MAILING_ADDRESS:3; NO_MATCH:157 |
| KY | 215 | 21 / 194 | 181 / 34 | MAILING_ADDRESS:17; NO_MATCH:16; ZIP_MISMATCH:1 |
| LA | 345 | 36 / 309 | 147 / 198 | MAILING_ADDRESS:178; NO_MATCH:18; UPSTREAM_HTTP_400:1; ZIP_MISMATCH:1 |
| ME | 210 | 16 / 194 | 17 / 193 | NO_MATCH:193 |
| MD | 228 | 19 / 209 | 81 / 147 | MAILING_ADDRESS:4; NO_MATCH:143 |
| MA | 262 | 22 / 240 | 33 / 229 | MAILING_ADDRESS:1; NO_MATCH:27; NO_STREET_ADDRESS:1; ZIP_MISMATCH:200 |
| MI | 306 | 32 / 274 | 150 / 156 | MAILING_ADDRESS:2; NO_MATCH:151; ZIP_MISMATCH:3 |
| MN | 246 | 22 / 224 | 225 / 21 | NO_MATCH:21 |
| MS | 388 | 29 / 359 | 201 / 187 | MAILING_ADDRESS:184; NO_MATCH:2; NO_STREET_ADDRESS:1 |
| MO | 230 | 31 / 199 | 224 / 6 | MAILING_ADDRESS:1; NO_MATCH:4; ZIP_MISMATCH:1 |
| MT | 322 | 18 / 304 | 67 / 255 | MAILING_ADDRESS:94; NO_MATCH:13; ZIP_MISMATCH:148 |
| NE | 71 | 14 / 57 | 16 / 55 | MAILING_ADDRESS:3; NO_MATCH:52 |
| NV | 141 | 9 / 132 | 138 / 3 | NO_MATCH:3 |
| NH | 425 | 16 / 409 | 422 / 3 | NO_MATCH:3 |
| NJ | 309 | 29 / 280 | 164 / 145 | MAILING_ADDRESS:122; NO_MATCH:22; ZIP_MISMATCH:1 |
| NM | 226 | 16 / 210 | 183 / 43 | MAILING_ADDRESS:31; NO_MATCH:10; ZIP_MISMATCH:2 |
| NY | 545 | 64 / 481 | 299 / 246 | MAILING_ADDRESS:1; NO_MATCH:240; NO_STREET_ADDRESS:3; ZIP_MISMATCH:2 |
| NC | 264 | 32 / 232 | 239 / 25 | MAILING_ADDRESS:20; NO_MATCH:4; ZIP_MISMATCH:1 |
| ND | 210 | 12 / 198 | 157 / 53 | MAILING_ADDRESS:2; NO_MATCH:51 |
| OH | 184 | 33 / 151 | 145 / 39 | NO_MATCH:36; NO_STREET_ADDRESS:2; ZIP_MISMATCH:1 |
| OK | 166 | 10 / 156 | 164 / 2 | NO_MATCH:2 |
| OR | 133 | 20 / 113 | 124 / 9 | MAILING_ADDRESS:4; NO_MATCH:5 |
| PA | 743 | 65 / 678 | 443 / 300 | MAILING_ADDRESS:11; NO_MATCH:289 |
| RI | 226 | 5 / 221 | 214 / 12 | MAILING_ADDRESS:6; NO_MATCH:5; ZIP_MISMATCH:1 |
| SC | 201 | 16 / 185 | 24 / 177 | MAILING_ADDRESS:2; NO_MATCH:174; ZIP_MISMATCH:1 |
| SD | 101 | 10 / 91 | 98 / 3 | NO_MATCH:3 |
| TN | 172 | 32 / 140 | 35 / 137 | MAILING_ADDRESS:2; NO_MATCH:134; UPSTREAM_HTTP_400:1 |
| TX | 509 | 99 / 410 | 295 / 214 | MAILING_ADDRESS:20; NO_MATCH:187; ZIP_MISMATCH:7 |
| UT | 209 | 12 / 197 | 49 / 160 | MAILING_ADDRESS:119; NO_MATCH:39; ZIP_MISMATCH:2 |
| VT | 260 | 4 / 256 | 49 / 211 | MAILING_ADDRESS:15; NO_MATCH:15; ZIP_MISMATCH:181 |
| VA | 322 | 29 / 293 | 156 / 166 | MAILING_ADDRESS:117; NO_MATCH:47; NO_STREET_ADDRESS:1; ZIP_MISMATCH:1 |
| WA | 215 | 29 / 186 | 59 / 156 | MAILING_ADDRESS:4; NO_MATCH:152 |
| WV | 224 | 9 / 215 | 169 / 55 | MAILING_ADDRESS:16; NO_MATCH:39 |
| WI | 104 | 23 / 81 | 30 / 74 | NO_MATCH:64; ZIP_MISMATCH:10 |
| WY | 203 | 12 / 191 | 55 / 148 | MAILING_ADDRESS:46; NO_MATCH:8; ZIP_MISMATCH:94 |
| PR | 83 | 1 / 82 | 1 / 82 | MAILING_ADDRESS:1; NO_MATCH:81 |
| VI | 2 | 2 / 0 | 2 / 0 | — |
| AS | 1 | 0 / 1 | 0 / 1 | NO_MATCH:1 |
| GU | 1 | 0 / 1 | 1 / 0 | — |
| MP | 3 | 0 / 3 | 0 / 3 | MAILING_ADDRESS:3 |

[Full office counts, gaps and canonical versions](office-counts.csv). [Every office point, source and missing-point reason](office-points.csv).
