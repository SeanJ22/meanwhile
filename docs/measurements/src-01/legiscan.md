# LegiScan geographic publication replay

The real `getDatasetList` response contains 1,000 sessions covering 52 jurisdictions: all 50 states, DC and Congress. The old parser omitted DC (`state_id=51`), refusing the complete catalog; the actual archive envelope uses `mime_type`, which the old decoder also rejected. Both failures are fixed. The standing worker admits each jurisdiction's latest session before older historical rounds, retaining every catalog session and the existing continuation behavior.

All 52 jurisdictions completed: 167,520 actual bills were published and consumed at all 156 normal reader clock checks; all 52 real cold cards passed below 3,000 ms (largest US 2,966 ms).

The geographic replay uses the latest nonempty actual publisher dataset in each jurisdiction. It records any newer empty archive explicitly. This verifies geographic coverage; it does not claim all 1,000 historical sessions have been published. `legiscan-all-states.json` records each jurisdiction's source edition, source/archive hashes, actual readonly production roster version, registered publication counts and versions, exact reader ID hash, person association, Ask counts and clock outcomes. Source publication, normal reader correctness and cold card timing have separate statuses; a published source with a slow card is not an overall PASS.

Upstream: the standing routine scheduler invokes `scripts/legiscan-bulk.mts`; actual publisher catalog/archive bytes and exact production-held people feed the work. Downstream: registered INDEX/PART/SESSION publications feed the normal `readerRoute` selection and canonical GOOD/hash shelf, then `/api/bills`, `LegislatorBills`/`PersonCard`, and state/person Ask evidence. Publication verifies the saved source before promotion and again after promotion. The reader verifies the entire bounded PART before selecting or hydrating a person's rows.

The single `/4` format stores bounded raw-source members once, one complete parent archive inventory, exact session-wide sponsor evidence and a SESSION manifest referencing immutable PART versions/hashes/counts. There is no retained unbounded publication path. Compact provenance and sponsor dictionaries expand to the original public facts, dates, URLs and ordered sponsor occurrences only after complete canonical verification. Conflicting native profiles remain ambiguous across parts, and committees remain unjoined. DC uses its canonical `district:dc` root and real council members can display their published bills.

Every successful replay compares all published bill IDs with normal reader IDs, including uniqueness. It repeats registered publication/confirmation and state/person reader/Ask checks at an initial clock no earlier than the actual source captures, tomorrow's controlled clock, and the next weekly controlled clock. A fresh real publisher catalog read confirms the held source edition before the synthetic future clocks. After a successful weekly run the scheduler is correctly not due tomorrow and is due after seven days. Source observations remain actual observations; future clocks are controlled replay inputs. A regression also proves that a later source date with a lexically smaller archive hash can promote.

The browser proof uses the real card components and a local HTTP API executing the real reader selection/canonical SQL against an isolated native PostgreSQL store. The publisher uses the actual `PostgresRoutineDataStore`, source validators and registered promotion/readback functions. Production is accessed only as `readonly`; no production rows or resources are created. The local reader uses native binary PostgreSQL, readonly transactions and `jit=off`, with two connections for the two bounded PART batches (production's pool maximum is four). Exact production-held identity is supplied from the saved readonly roster: production network latency and `seatHolderById` lookup are excluded. These are unstyled component replays, not newly deployed production pages. System `/usr/bin/chromium` substitutes for the missing pinned Playwright build1234.

NY's laboratory publication wall duration includes measured resource/isolation holds and an earlier unmeasured hold; `legiscan-replay-resource-holds.json` preserves the exact intervals and uncertainty. It is not an unpaused production timing.

Preserved performance failures explain the changes. The unbounded US archive failed before bounded publication existed. A later PGlite/WASM replay published 19,690 US bills but was too slow and failed the old harness's reused acquisition abort signal; it is not a passed production deadline. The native full US registered publication took 1,097,990ms (18m18s), within the existing worker limit, with 19,690 bills in 97 parts. The `/3` MA model's repeated provenance caused a 9,738ms cold card; exact compact `/4` facts plus person selection after whole-PART verification reduced it to 2,299ms. Earlier injected-store Alabama 3,105ms/299ms attempts remain historical evidence, not the final national normal-SQL proof.

That US publication worker reached 1,486,741,504 bytes RSS. Adding 5% and rounding up gives 1,489 MiB: memory-only arithmetic on an 8 GiB server minus a 768 MiB reserve gives four such workers, or three with a 2,928 MiB research parent. These are calculated counts for the measured run, not observed production admission. The actual routine entry is `legiscan-bulk/legiscan-bulk.mts`. It has no routine memory-table override and uses the 342 MiB lease fallback when no recent host measurement replaces it. The largest of the host's last five job-family peaks, with 5% added, can replace that default; available memory and other reservations also affect admission. Production host peak history was not measured, and no scheduler or Admin setting changed. `legiscan-reader-performance.json` records the measured peak and calculation separately from this default mapping.

The final US cold process and empty canonical cache took 2,966ms, including a 2,167ms API read. The US publisher used `people: []`, matching the production default, and the promoted SESSION has zero publication-time person joins. Native source bioguide IDs remain in the published sponsors; the reader resolves them against the actual held federal identity. All 170 saved person bills carry that exact source Congress ID while the published sponsor remains unjoined. It rendered 20 of Robert B. Aderholt's 170 exactly joined bills; all 19,690 national bill IDs reached the state reader and state Ask at all three clocks. During this measurement the other LegiScan workers and both old EPA WASM publisher/reader processes were confirmed stopped, and no shared check or materializer benchmark ran. Earlier SLOW attempts, the JSON/stdio-to-native transport change, the former single-connection harness constraint and the small no-reference owned-payload decoding optimization remain recorded. This local result has a narrow margin below three seconds and excludes production network latency. The inspected DC screenshot shows Anita Bonds' actual council bills; the inspected US screenshot shows bill titles, statuses, sponsor names, text links, counted historical gaps and Sources.

Idaho publishes 817 bills and returns all 817 to the state reader/Ask. Its saved sponsors do not share an exact independently held identity with the production roster: source profiles commonly identify the generic House/Senate membership pages. The real Ali Rabe card correctly shows the sponsored-bills gap, with zero person bills and zero person Ask matches, rather than guessing a name join. Its cold card passed at 1,228ms. Wisconsin's latest nonempty dataset is the May 2026 special session: both published bills have only the Finance committee as sponsor. Its real held-person card likewise preserves zero personal associations and the visible gap (764ms), while state reader/Ask consume both bills. These personal association limitations are retained separately from successful source publication.

Reproduce with the private readonly credential locator and the isolated loopback test server locator (neither credential belongs in Git):

```sh
TMPDIR=/workspace/src01-scratch NODE_USE_ENV_PROXY=1 \
WTP_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
node --experimental-strip-types --import ./scripts/register-test-loader.mjs \
  scripts/replay-legiscan-all-states.mts --resume=true \
  --readonly-connection-file=/tmp/src-01-prod-readonly-url \
  --native-postgres-file=/workspace/src01-scratch/src01-native-postgres-url \
  --output-dir=.scratch/src01-legiscan/proofs/final
```

The optional native backend requires the existing isolated official PostgreSQL17 loopback container with dummy `src01_replay` credentials. It creates only generated `src01_<hex>` databases, applies the same migrations and removes successful test databases. Controlled clocks use only that test database's replay GUCs; normal production clocks and validation are unchanged. Large captures stay in ignored scratch directories outside `/tmp` tmpfs. Five closed raw-member caches are stored as lossless gzip files, saving 1,076,465,451 bytes; the harness reads this cache format without changing the source bytes. `legiscan-cache-storage.json` records original, compressed and independently decompressed hashes and byte counts. Compression ran during the preserved failed EPA raw-store attempt; its 16.7 seconds were not deducted from that attempt. The final compressed-store EPA run starts afterward and measures its own new artifact writes. Use `--aggregate=true --output-dir=docs/measurements/src-01` after every jurisdiction completes. The final aggregate snapshots source/reader/component file hashes; newly measured cards record the snapshot hash, while earlier passing receipts explicitly predate hash instrumentation.

Focused checks include bulk source/manifest/dictionary/identity tamper guards, votes, actual dataset envelopes, owned payload missing/cycle/order failures and canonical payload tampering. Final shared typecheck/lint/preflight are owned by the root SRC-01 task. Deployed River promotions and a deployed reader remain the required post-shipping live check.

| Jurisdiction | Published bills | Person bills / Ask | Cold card ms |
| --- | ---: | ---: | ---: |
| AK | 848 | 70 | 1614 |
| AL | 9 | 1 | 1058 |
| AR | 2 | 1 | 935 |
| AZ | 2190 | 167 | 1705 |
| CA | 5060 | 198 | 2526 |
| CO | 714 | 167 | 1866 |
| CT | 1283 | 40 | 1490 |
| DC | 1907 | 228 | 1523 |
| DE | 1296 | 390 | 1835 |
| FL | 5 | 1 | 1720 |
| GA | 176 | 2 | 807 |
| HI | 6132 | 506 | 2556 |
| IA | 4231 | 37 | 2419 |
| ID | 817 | 0 | 1228 |
| IL | 12113 | 202 | 2425 |
| IN | 935 | 68 | 998 |
| KS | 1483 | 18 | 1646 |
| KY | 1737 | 49 | 1624 |
| LA | 2616 | 64 | 2419 |
| MA | 8960 | 29 | 2299 |
| MD | 2675 | 205 | 1891 |
| ME | 2454 | 26 | 1653 |
| MI | 4230 | 155 | 1305 |
| MN | 48 | 2 | 616 |
| MO | 3146 | 25 | 1748 |
| MS | 8 | 1 | 834 |
| MT | 1761 | 8 | 1455 |
| NC | 5 | 1 | 984 |
| ND | 5 | 1 | 825 |
| NE | 1847 | 61 | 667 |
| NH | 1394 | 8 | 1214 |
| NJ | 11256 | 73 | 2468 |
| NM | 812 | 28 | 1524 |
| NV | 27 | 5 | 1514 |
| NY | 25440 | 575 | 2181 |
| OH | 2586 | 168 | 1309 |
| OK | 6008 | 110 | 1351 |
| OR | 304 | 22 | 763 |
| PA | 5202 | 239 | 1194 |
| RI | 3013 | 292 | 1355 |
| SC | 4035 | 113 | 1893 |
| SD | 666 | 112 | 1205 |
| TN | 9159 | 314 | 1738 |
| TX | 692 | 32 | 1545 |
| US | 19690 | 170 | 2966 |
| UT | 5 | 2 | 1537 |
| VA | 96 | 2 | 1822 |
| VT | 1717 | 110 | 1650 |
| WA | 3413 | 188 | 1504 |
| WI | 2 | 0 | 764 |
| WV | 2975 | 119 | 2381 |
| WY | 335 | 11 | 1326 |
