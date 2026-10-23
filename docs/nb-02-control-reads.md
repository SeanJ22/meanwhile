# NB-02: routine control-plane reads

Status: **not READY**. The production full-pass and next-scheduled-run proofs Sean requires remain open. Passing narrowed-read tests or a scheduler replay is insufficient. Work is on `stream/nb-02`, cut from `origin/river` at `78f82a232dd1d0545a46835e7716032ff3807425`, with NB-01 READY `637e2cb8107d4fa2fa93855d23a78f2fe4f86808` merged in `fba22176355d1aa19091ad86e57232cee185057e`.

Before pushing, the remote lane was found to have advanced to integration READY `0b42253dcd9dbe29265784c859d24afcf8bd5698`. Its two documentation-only commits and separate NB-01 merge are preserved by a normal merge. Its original [integration report](nb-02.md) remains. Its sampled reader and nationwide door/manual checks do not measure a complete routine pass, and its CI run predates this follow-up's runtime changes. This branch tip therefore remains WIP.

The reader goal (§0) is complete, current government information with fewer database bytes spent repeatedly finding work. Coverage, cadence, publication rules, spending settings and process admission stay as set.

## Connections and remaining plan

The preceding step is **NB-01**, which narrows census/manual/vault/method reads. Its normal producers—source discovery, Scout/Detective results and mission/edit marks—supply the rows this step reads. NB-02 feeds the **routine scheduler and publish-now lane**, then source acquisition and verification, the fact/meeting publishers, and the existing reader routes and cards. No new runtime, private queue or publishing gate is introduced.

| Remaining work | Owner | Actual dependency |
| --- | --- | --- |
| Obtain a clean aggregate gate run after the focused repairs below | NB-02 | The complete suite has run; repaired cases and both builds pass separately |
| Prove a complete routine pass through source output to reader cards, then its next scheduled pass | NB-02 | A replay that actually exercises these stages; partial checks cannot substitute |
| Diagnose existing routine-pass termination | NB-02; River's existing return names cal-01 | Exact production evidence below |
| Fold and ship a READY only after both required proofs pass | River | NB-02's explicit READY |
| Check served SHA, runner SHA, then complete-hour bytes and ten-state reader sample | River | Runner following the shipped release |

## Changes

- The routine coordinator reads the fields its probe, publication, page-refresh and due-request stages consume. The due-request stage shares one read between mission marks and edits. Publication re-reads after probes, and due requests re-read after mark settlement, so an update made during a pass remains visible in that pass. Refresh retains observed-rate and saved work-item fields.
- Postgres filters census matching by active status, meeting presence, null/missing family and presence of the crosswalk key before returning matching descriptors. A JSON-null crosswalk key remains a census key. A derived-origin hand-wired door remains eligible. ID pagination preserves deterministic ordering.
- Replayed Scout/Detective Box origins first check their exact identity and metadata in SQL, returning only the finding ID when complete. New references, fact gains and missing result keys still use the existing full merge and CAS. Direct reported findings retain the full result needed by acquisition. Builder state, attempts, claims and source references remain intact. This removes repeated full reads for completed replayed origins; it does **not** remove full reads needed for new merges.
- Research metrics and progression read each candidate's ID, lifecycle, submitted time and admission; proposals, validation documents and rejection histories stay in Postgres. Pages must have the same stored revision; a concurrent change is reported as unavailable rather than mixing versions. Lifecycle counts and progression still consume the same candidate summaries.
- A successful aggregate insert returns its metadata and the exact JSON submitted before the request; it avoids re-reading its payload. Identity conflicts still read and compare the existing row.
- Artifact append-conflict recovery reads the requested member with its actual allocated log position, preserving position gaps.

## Production evidence and limits

Production access uses server-enforced read-only transactions. The reader connection is the existing `readonly` role on `tiny-hill-13996172` / `br-delicate-lab-ax02xuo5`. The control plane is `withered-sunset-39821877` / `br-tiny-frog-aeufpjeq`; it has no `readonly` role, so its existing owner connection is confined to read-only transactions in the replay. No production write, settings change, source job, model call or Neon branch is made.

The baseline in [nb-01.md](nb-01.md) records **2,783,674,697** control-plane bytes in the October 23 00:00 UTC complete hour, and its later 02:00 hour read **3,291,252,800**. A fresh NB-02 observation of the 08:00 hour reports **2,844,084,762** bytes, on release 88 (`825ff1c43ff44632923f1011e9480b961aa20dbb`). Its top two callers are census **1,405,735,761** and manual saves **888,708,250**. NB-01 and NB-02 are absent from that release; this is a before observation, not realized savings.

The final live recheck at October 23 06:47 Eastern (10:47 UTC) still found release 88 on both the served build and runner. Its newly complete 09:00 UTC hour read **2,073,192,857** control-plane bytes, including census **1,004,394,849** and manual `readMany` **479,401,333**. The decline while the runner remains on the old release illustrates why an hourly change alone cannot establish NB-02 savings. Output: `.scratch/nb02/before-push-live/replay.json`.

At the October 23 read, the last **51 ordinary routine supervisor outcomes in 24 hours contain zero successes**. Forty-four have exact receipts (454 source task receipts altogether); the latest seven outer timeout outcomes have none. The latest five each failed with `ROUTINE_CHILD_TIMED_OUT`; their outer supervisor says `UNAVAILABLE_OUTER_SUPERVISOR`, with zero task receipts. The latest observed run started at 08:42:54 UTC and ended at 09:12:54 UTC. Its parent saw two good/two held summaries but no exact launch plan. This does not identify the underlying slow source, and does not prove what any unrecorded inner task did. The latest exact pass started at 04:48:01 UTC and ended at 05:13:04 UTC; it also failed, with entity-upsert, source-job, and reader-repair errors. A query originally looked for the wrong receipt label; grouping by the actual `EXACT`/`UNAVAILABLE_OUTER_SUPERVISOR` values corrected that reading.

`scripts/nb02-replay.mts` measures its actual Neon HTTP response-body bytes, records door adapter families, compares the changed selectors on real production rows, and checks the normal due decisions at its captured clock and one day later. It explicitly excludes acquisition and publication writes, and reports `fullRoutineExecutionProven: false`. It therefore cannot alone satisfy Sean's full-pass acceptance condition or authorize READY. Its final local output is `.scratch/nb02/final/replay.json`; credentials and raw working snapshots are not committed.

River's post-release observation uses the same script with `--live --out=.scratch/nb02-after-release` and the two explicit production connections. That mode reads only `/api/build`, the runner heartbeat and the latest three complete `cp_vital_signs` hours. First verify the served and runner commits contain this step. Then choose an hour that began after the runner followed that release, compare its total and caller families against NB-01's baseline, and repeat the ten-state reader sample. A complete wall-clock hour containing an earlier runner revision is not an after observation.

### Measured reads

The final production control-read audit completed successfully at October 23 **06:12:42 Eastern** (10:12:42 UTC). It matched the old consumers at both its captured clock and the next-day clock. Actual Neon HTTP response-body measurements include **200,910,486 bytes** for one full door listing and **88,727** for the filtered census descriptors. Candidate reads measured **4,675,875 → 396,675** for full candidates versus revision-checked summaries (1,757 candidates, identical summary values). These are measurements of named reads, not a complete routine pass or an hourly savings forecast. HTTP headers, TLS and billed bytes are not measured.

| Narrowed selector stage | HTTP response-body bytes, both controlled clocks |
| --- | ---: |
| Mission and edit requests | 11,976,826 |
| Probes | 15,648,964 |
| Page refresh | 1,286,864 |
| Publication | 11,106,354 |
| **Total** | **40,019,008** |

The before full-door listing was shared by the comparison harness. The former runner listed repeatedly at its own stage boundaries; these totals do not measure two complete before/after passes. The baseline hourly ranking in NB-01 and the source-family table below remain separate measurements.

A separate real production Box finding with **144 origins** returned **89,638 → 281 HTTP response-body bytes** through the old full read and the new identity check. The ID matched and its stored revision stayed unchanged. No finding was inserted, merged, claimed or published by this check.

The source-family breakdown below is a separate server-side aggregate on the same OPEN rows in one read-only statement: full door JSON versus the exact probe projection. It reports **Postgres JSON text bytes**, not HTTP bytes, and does not satisfy the outstanding whole-pass, per-source wire accounting requirement. Remaining family detail is in `.scratch/nb02/door-family-json-bytes.json`.

The selector comparison stresses the probe projection with every installed meeting partition in the hot set. It does not claim that all those doors currently have a meeting inside the production seven-day window.

| Door source family | Full JSON bytes | Probe JSON bytes |
| --- | ---: | ---: |
| official-voting-source | 154,851,546 | 279,876 |
| legistar | 4,342,061 | 1,973,179 |
| legistar-insite | 2,172,295 | 897,459 |
| civicplus | 1,975,308 | 839,028 |
| granicus | 1,250,544 | 458,759 |
| page | 799,197 | 456,862 |
| Other source families | 2,623,500 | 1,142,426 |
| **Total** | **168,014,451** | **6,047,589** |

### Next-day clock check

The first audit's individual-clock scan stopped on a proxy/upstream HTTP 503; its failure and measured bytes remain saved in `.scratch/nb02/replay.json`. The replay now uses the routine runner's existing empty-clock presence check and eight-way bounded clock reader. Both the separate `--schedules-only` run and the final combined audit completed. The final audit read **6,593 registered core tasks**, **6,066 empty clocks**, and **zero clock-read failures**. It found **6,476 due at October 23 06:12:42 Eastern** and **6,528 due at October 24 06:12:42 Eastern**, by the existing per-source rules. Reader-store clock checks transferred another **57,861,462 response-body bytes**, separately from the control-plane reads. Detailed family counts are in `.scratch/nb02/final/replay.json`.

This proves the registered core clock decisions can still be evaluated on the controlled next day. It does not execute tomorrow's source jobs, provider-frontier selection, mission additions, acquisition, verification or publication, and therefore does not prove the next full scheduled routine pass. That acceptance condition remains open.

### Recorded pass to normal readers

A separate read-only check followed all **44 receipts** from the latest exactly recorded pass (**51 attempted tasks**) through their existing reader paths. Nine current typed projections passed `verifyRoutineReaderProjection` at both today's clock and tomorrow's controlled clock. Mesa's receipt had already been superseded by a later version; the check explicitly verified that current version. Seventeen receipts had no current promoted version (EPA and sixteen derived meeting scopes); that result supplies no reader-delivery proof for them. Seven attempted tasks had no exact receipt.

The other eighteen receipts use the native Legistar member path, which deliberately has no generic reader projection. All eighteen matched `legistarMemberReceiptIssue` and the normal `readFactRosters` reader: **170 body rosters and 994 member rows** in total. Their existing task clocks were not due at the audit's current clock and were due the next day. The first generic-only check reported these as unregistered; following their actual native reader path resolved that audit limitation. Outputs are `.scratch/nb02/delivery-replay.json` and `.scratch/nb02/native-reader-replay.json`.

These checks establish existing receipt/checkpoint-to-reader connections. They do not execute source refreshes, publish changed records, or render newly published NB-02 output on a page. A future clock reading held data also cannot establish tomorrow's refresh-to-page behavior. The full-pass and next-scheduled-run requirements remain unmet.

### Live readers before release

The served build and runner both still identify release 88 (`825ff1c43ff44632923f1011e9480b961aa20dbb`). Ten live state/ZIP APIs returned 200, and the governing card rendered sourced officials/coverage for AZ, TX, OH, CA, NY, MT, WI, NC, WA and FL. Screenshots and per-request timings are retained under `.scratch/nb02/live-*`. The initial browser harness waited for a navigation label instead of resolved data and could race onboarding; corrected checks waited for the resolved ZIP and governing card, and the AZ/FL final screenshots used the device-local dismissed-tour preference. Earlier failures are retained. These are baseline observations, not evidence that NB-02 has shipped or reached readers.

Several page/card actions exceeded three seconds, including a 3.665-second MT governing-card action and a 6.232-second AZ resolved-ZIP observation. They fail §6's speed standard; there is no healthy-reader or latency-win claim.

Worker admission is unchanged. NB-01's earlier baseline recorded nine route-worker processes with a 0.75 GiB margin. The current production heartbeat's `memory` value is null, so current worker capacity and any post-release increase remain unmeasured.

## Verification status

Focused SQL tests exercise probe-to-publication visibility on consecutive daily passes, preserved mission/edit decisions, refresh cadence, null versus absent census keys, legacy Box identities and metadata upgrades, builder-state preservation, paged candidate summaries, insert snapshot isolation from caller mutation, and original artifact positions. They measure actual query-result payloads before repository projection in PGlite.

`pnpm gates` completed: **4 of 8 legs passed in that aggregate run**. The suite registered **9,328 tests: 9,316 passed, seven failed, five skipped, zero cancelled**, across all 1,299 files. Lint, the default production build, all sixteen completed-bundle tests, and the standalone build passed. The four failed legs were TypeScript, the pinned-browser assertion, tests, and the database gate. That run is not reported as green.

The replay-script generic-arrow syntax error is fixed; final-source TypeScript and lint both pass. Pinned Chromium build 1234 is installed and its assertion passes. All six previously failed browser cases pass when rerun with that browser. The seventh failed case was the replay's hardcoded public origin; it now uses `PUBLIC_SITE_ORIGIN`, and all seven origin tests pass. The database gate initially used a stale `origin/main` reference and counted already-shipped migrations as new; fetching the actual release-88 reference made it pass as not applicable, with all fifty journal entries immutable and no schema change or database contact.

Three of the five skips required a completed build. Rerunning their files after both builds exposed one additional pre-existing contradictory trace assertion: it required state geometry inside every function despite DS-01 moving those files to the reader edge store. It now requires the state-geometry manifest and nationally bundled inputs. All **33 tests** in those three files pass against the completed build. The two held roster/profile archive cases remain skipped because their archives were not supplied. No test failure is concealed by those skips.

The final new SQL suite passes all five cases, including state isolation and concurrent candidate revision changes. An earlier focused research worker run passed all six cases with local networking, as used by the full gates. Final focused repairs have passed; the 48-minute aggregate suite has not been rerun after those repairs. No READY commit or release claim has been made.
