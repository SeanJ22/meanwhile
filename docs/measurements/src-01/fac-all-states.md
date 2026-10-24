# FAC coverage across every source scope

The replay covered the contract’s 50 states, DC and AS/GU/MP/PR/VI, plus its separate unresolved-state bucket `ZZ`. Each isolated worker held one scope. The dispatcher used two workers. Production queries used the `readonly` role in READ ONLY transactions. All writes were to local in-memory stores and local reader artifacts. No SAM API calls were made.

Every jurisdiction published its initial audit reports and rendered them through the public state reader and the actual `FederalMoneySection` component. A controlled next-day clock then passed scheduler admission, resumed the saved source continuation, processed the actual subsequent official findings response and checked every accepted row through reader pagination and component rendering. Source observation dates remain the actual response dates. Initial publication follows acquisition; tomorrow’s clock derives from each scope’s first successful publication.

Results: 54 jurisdictions passed both runs. Maryland and New Mexico published and rendered 100 audit reports each, then retained those 100 when the next findings response failed. In both states the publisher supplies different findings with identical report/reference/award/requirement keys, identical acceptance dates and no unique source-row identifier. The competing flags cannot be resolved without inventing a winner. Both raw observations and response hashes are retained in the JSON evidence. No row-number or append-only row-hash identity was introduced.

Iowa exposed exact duplicate source rows. Exact duplicate observations now coalesce into one fact; distinct requirements receive distinct stable native keys. Iowa, Maine and Massachusetts pass after replaying the same saved bytes with the corrected parser.

The first run published 5,544 located audit records. After the controlled next run, 17,723 accepted records were readable and rendered across the 56 jurisdictions. The separate `ZZ` bucket grew from 100 to 600 retained records and has no invented public location. These are actual bounded scheduled slices, not a claim that all historical source backfills finished.

| Scope | Initial new rows | Tomorrow new rows | Reader rows after tomorrow | Result |
| --- | ---: | ---: | ---: | --- |
| AK | 100 | 134 | 234 | Pass |
| AL | 100 | 278 | 378 | Pass |
| AR | 100 | 85 | 185 | Pass |
| AS | 50 | 148 | 198 | Pass |
| AZ | 100 | 294 | 394 | Pass |
| CA | 100 | 28 | 128 | Pass |
| CO | 100 | 500 | 600 | Pass |
| CT | 100 | 45 | 145 | Pass |
| DC | 100 | 500 | 600 | Pass |
| DE | 100 | 209 | 309 | Pass |
| FL | 100 | 36 | 136 | Pass |
| GA | 100 | 71 | 171 | Pass |
| GU | 100 | 489 | 589 | Pass |
| HI | 100 | 226 | 326 | Pass |
| IA | 100 | 121 | 221 | Pass |
| ID | 100 | 60 | 160 | Pass |
| IL | 100 | 55 | 155 | Pass |
| IN | 100 | 69 | 169 | Pass |
| KS | 100 | 208 | 308 | Pass |
| KY | 100 | 38 | 138 | Pass |
| LA | 100 | 500 | 600 | Pass |
| MA | 100 | 246 | 346 | Pass |
| MD | 100 | 0 | 100 | Publisher identity conflict; prior rows retained |
| ME | 100 | 172 | 272 | Pass |
| MI | 100 | 73 | 173 | Pass |
| MN | 100 | 238 | 338 | Pass |
| MO | 100 | 58 | 158 | Pass |
| MP | 94 | 500 | 594 | Pass |
| MS | 100 | 69 | 169 | Pass |
| MT | 100 | 89 | 189 | Pass |
| NC | 100 | 173 | 273 | Pass |
| ND | 100 | 438 | 538 | Pass |
| NE | 100 | 233 | 333 | Pass |
| NH | 100 | 186 | 286 | Pass |
| NJ | 100 | 352 | 452 | Pass |
| NM | 100 | 0 | 100 | Publisher identity conflict; prior rows retained |
| NV | 100 | 258 | 358 | Pass |
| NY | 100 | 115 | 215 | Pass |
| OH | 100 | 93 | 193 | Pass |
| OK | 100 | 128 | 228 | Pass |
| OR | 100 | 117 | 217 | Pass |
| PA | 100 | 282 | 382 | Pass |
| PR | 100 | 500 | 600 | Pass |
| RI | 100 | 326 | 426 | Pass |
| SC | 100 | 500 | 600 | Pass |
| SD | 100 | 269 | 369 | Pass |
| TN | 100 | 81 | 181 | Pass |
| TX | 100 | 388 | 488 | Pass |
| UT | 100 | 93 | 193 | Pass |
| VA | 100 | 500 | 600 | Pass |
| VI | 100 | 500 | 600 | Pass |
| VT | 100 | 118 | 218 | Pass |
| WA | 100 | 298 | 398 | Pass |
| WI | 100 | 252 | 352 | Pass |
| WV | 100 | 153 | 253 | Pass |
| WY | 100 | 287 | 387 | Pass |
| ZZ | 100 | 500 | 0 | Unresolved source location; retained |

Evidence: [fac-all-states.json](fac-all-states.json). Reproducer: `scripts/src-01-fac-all-states-read-only-replay.mts`. Actual publisher responses and read-only query snapshots were cached by scope; final parser corrections were replayed from those same inputs without another provider or production query.

Run live with `NODE_USE_ENV_PROXY=1 node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/src-01-fac-all-states-read-only-replay.mts --connection-file=<mode-600-readonly-url-file>`. `--saved --resume` reuses the recorded source and production SELECT inputs while recomputing invalidated parser results. No production mutation path is used.

The future run was controlled. Observing automatic production publication after shipping remains a live check.
