# Bank mission continuation — Oct 6

Mission: verified facts reach readers within minutes, at a known and falling cost, proved every hour. Bank makes the next Scout start ahead. Tests establish build behavior; only the named live checks below establish completion. No paid job may leave no learning. DB-39 is unconditional under Sean's Oct 6 instruction.

## Live BEFORE findings (Neon MCP, control-plane withered-sunset-39821877)

- Bank: 3,970 entries, 6,624,973 decoded JSON bytes. The write-errors row is absent: no observed successful operating window yet, not a claim of a zero-error live run.
- 757 VALIDATED offers / 575 route ids; 6 ADMITTED offers / 3 route ids. These are exclusive lifecycle buckets.
- 745 validated offers have no corresponding ROUTE in the manual; 12 already have one. All 757 have passing saved validation, YIELDED outcomes with positive rows, claims, and machine-derived Scout Attempt origin. Seven also carry historical provenance rederivation. Offers span Sep 1–Oct 5.
- No EXHAUSTED_RUNGS lessons and no JOB_COST observations live. No factoryLearning owner digests or coverage observations.
- Neither cp_field_manual_entries nor cp_fix_map exists. Runner heartbeat still names f545fcf9493def91294bccf219ed65071b2093b1. River reports release 8 site live at a5fd753; runner restart belongs to River/owner, not Bank.
- Saved bounded aggregate evidence: bank-evidence/entry-split-backlog/live-before.json. No production writes were made during inspection.

## Cause and repair of admission backlog

DP-25 currently examines incoming candidates only, and admits at most one prior VALIDATED offer for the same route. Historical VALIDATED offers never reoffered are never reconsidered. Manual persistence and candidate CAS can also fail independently; the 12 offers already in the manual show why the stores must reconcile rather than requiring another paid Scout.

Bank built admitValidatedBankCandidates({repos, stamp}) in lib/control-plane/bank-candidate-admission.ts. It revalidates every saved successful VALIDATED offer against current knowledge, batches manual persistence once, then marks admissions through the existing candidate CAS. It retains current validator issues as REJECTED; missing saved proof remains VALIDATED with a specific report. Observation dates stay the original submitted dates, not maintenance time. Failure before admission is resumable; CAS retry cannot multiply outcomes. It does not call a model or fetch a government site.

Normal maintenance entry point: scripts/bank-admit-validated.mts, read-only by default; --apply calls the normal repositories with skipBootstrap=true (no DDL). River must integrate and execute it through the authorized runtime/provider with existing CP credentials, or call the helper in the shared research parent. Inspection credentials stay read-only. Runtime CP URL is absent in this worker's subprocess environment; Neon MCP inspection works. This is a River execution connection, not an invented request for new credentials from Sean.

Hunters/auditors: call this drain once after adoption and after incoming proposal processing in the long-lived parent; retain its report and reuse the parent's method knowledge/cache. No per-job repeated full candidate read. The one-time drain is separate from paid research.

Live acceptance: before/after lifecycle counts and per-offer dispositions explain all 757; successful saved offers appear in the next applicable worker manual/catalog without a paid re-offer. Do not label every currently VALIDATED offer automatically admitted if current validators reject it.

## DB-39 — exact needs_River

1. Assign the CP schema version number. Number/apply .factory/bank-DB-39-schema-request.sql through the authorized CONTROL-PLANE bootstrap/release path, not the serving DB. It declares entry identity/value plus indexed kind/states/platforms/record classes/outcome/place hints; the expression index supports small SQL cost totals.
2. Expose optional bankEntries: BankEntryStore on ControlPlaneRepositories and attach createBankEntryStore(sql) in pg-store.ts when WTP_BANK_ENTRY_ROWS=1. Default remains the legacy path before cutover. WTP_BANK_ENTRY_ROWS=0 is the explicit rollback switch; do not silently fall back to stale aggregate data on a row read/write error. Memory/file providers retain their existing signatures.
3. With Bank writers stopped, run moveBankToEntryRows({repos,entries,checkpointId:'db39-checkpoint-<unique-forward-id>',now}) from lib/control-plane/bank-storage-move.ts. It preserves a named aggregate checkpoint and imports in pages of 100, normalizing hints while preserving every original payload and id. A conflicting import refuses rather than overwriting newer learning. Verify all ids/payloads and representative Scout/Detective brief lines, then select row mode. Preserve cp_field_manual/live; cease its runtime rewrites after switching. write-errors stays the tiny separate aggregate.
4. Rollback while writers are stopped: moveBankBackToAggregate with a DIFFERENT unique checkpoint id. It includes every row written since cutover, retains another checkpoint, then CAS-writes the aggregate. Only then switch WTP_BANK_ENTRY_ROWS=0. A bare switch to the frozen old row would lose new learning.
5. Route remaining direct legacy readers in other owners' files: standing-runtime.ts (slide), detective.ts (auditors), freshness-shadow.mts (hunters). Bank's normal read/write, method knowledge bridge, playbook reads, and atomic playbook edit/Undo already support entry storage. Returned FieldManualRead.store is the SQL-scoped store; revision is null in row mode, with per-entry revisions underneath.
6. Shared parent cache: load the complete row store ONCE at startup via scanEntries keyset pages (including all role playbooks, JOB_COST observations, and subject-specific lessons); do not replace it after each ending with readFieldManual({role:'SCOUT'}) and do not fence row refreshes on the retired aggregate revision. Merge saved ending entries into the parent cache with upsertEntries, retaining all subjects. Use the existing shared incremental-read cache for other writers' updates. Per-worker requests carry actual subjectId/state/role/place hints and retain the Scout's cross-class catalog. Explicit PLAYBOOK, PLATFORM_FINGERPRINT, ROUTE/METHOD_VERSION reads are scoped. Reuse the shared parent rather than reading all rows per job.
7. Provider/query accounting must include pinned WebSocket queries as well as HTTP and tag Bank callers. Current HTTP transfer counter alone misses pinned result bodies. Connect to the hourly vital signs owner's accounting; do not add another raw-table Admin read.

Live acceptance: entry table populated losslessly, normal paid endings write affected entry ids without updating the legacy live document, scoped briefs equal pre-cutover briefs for representative places/roles, observed successful writes with no new write-error increments, and an hour of completing hunts below 0.7 GB CP transfer. Exercise rollback on isolated data first; live reversal only through the authorized release/runtime path.

## Estimated Neon bytes (before shipment; currency rates not guessed)

Live normal legacy update: ~6,624,973 bytes DOWNLOAD for its mandatory Bank read, plus a small CAS receipt; ~6,624,973 bytes UPLOAD to rewrite the value, plus SQL framing. Successful CAS already avoids reading back the full value. At 100 such writes/hour the Bank alone downloads ~0.6625 GB/hour before any other reads; this almost consumes the entire 0.7 GB target. Retry multiplies those terms.

Entry writes: download only prior values of incoming ids plus one small cost-total row per affected platform/class; upload merged incoming rows and their profiles. No other Bank payload or historical cost-observation payload downloads. The isolated SQL check read 199 decoded result bytes in a paid-cost update despite 6.6 MB of same-kind history, and <10 KB for the affected-entry merge despite an unrelated 6.6 MB row. These are fixture measurements, not production forecasts. Estimate actual production as sum(bytes of affected prior entries) + small totals/receipts; upload sum(bytes of affected merged entries/profiles). The live all-entry mean is ~1,669 bytes, so an ordinary one-entry update is roughly kilobytes rather than 6.6 MB; large individual entries remain proportional to their own size.

Scoped reads return matching rows plus a tiny global count; they are not artificially truncated because the on-demand catalog and brief ranking must remain correct. Parent startup can still download the Bank once, ~0.006625 GB. Method-knowledge selection currently contains 378,742 payload bytes across 158 ROUTE entries plus version, rather than the whole 6.6 MB Bank. The admission drain performs one batch, not 757 aggregate rewrites: on legacy storage the mandatory Bank write read/upload occurs once; on row storage only affected route ids move. No per-job backlog drain.

DB-52 reads four aggregate queries, not raw tables into Admin memory. Estimate a few kilobytes for aggregate rows over the weekly horizon; actual returned byte counts and billing totals must be measured. Reads of raw history happen inside SQL, affecting compute but not exporting payloads. Use bankStorage:'entry-rows' after cutover so Detective reuse joins indexed entry ids rather than expanding the retired document.

## Paid endings — exact needs_hook (hunters / auditors)

In scripts/freshness-shadow.mts dispatch, replace the candidate/refusal gate around manual write-back with an unconditional call to writePaidEndingLearning(repos,result,now) from scheduler/field-manual-scout.ts for every saved paid Scout/Detective ending. It writes only supported discoveries on accepted finishes and saves EXHAUSTED_RUNGS for NO_PROGRESS/refused finishes. It records original machine rung observations, annotations, failure reasons, subject/class, next rungs and refusal as a REFERENCE lesson, never government absence or a dead-source claim. Empty legacy refusal arrays remain accepted legacy envelopes. Failed write-back must keep the existing result durably and use the normal retry path.

Detective/scout reads pass subjectId and class. Cache handling must follow DB-39 item 6 so the next worker actually sees the lesson. Avoid calling a full manual refresh after every write.

Live acceptance: a real paid NO_PROGRESS/refused ending persists its lesson and the next worker for the same subject reads it and resumes beyond the saved rungs; a different subject does not inherit a place-specific exhausted walk. Confirm no paid ending with no result/learning in the hourly vital signs.

## DB-52 — exact needs_hook (hunters / River / admin)

Existing FactoryLearningDigest in Bank's factory-learning.ts attaches to the existing owner digest: coverage only for a complete identical targetSet, with subject, ordinal 1/2 and start/finish; target outcomes include failures and machine-observed headStartOnly, unknown=null. River extends the shared digest type. Hunters records these observations, never inferring success from a handed door or partial coverage. Preserve actual Detective identity on admitted route entries when the source result establishes it; candidate envelopes alone do not establish Detective role.

Admin owns scoreboard-read.ts and its live loader. Connect readFactoryLearning({control,from,through,recordingSince:<actual instrumentation start>,bankStorage:'entry-rows' after cutover}); pass the result to buildScoreboard and fourth v6LearningView argument. Preserve unknowns when observations do not exist. Current live digest count is zero. Bank did not edit scoreboard-read.ts in this run; earlier built changes remain in the prior checkpoint.

Live acceptance: the live Scoreboard displays measured head-start hit rate and comparable second-time coverage; Detective reuse and week-over-week facts/hour derive from real observations, and Bank health remains visible. Sample behind the displayed numbers against normal saved events and hourly facts reaching readers.

## Older open returns

DP-19 remains blocked on River's cp_fix_map migration/repository connection; live table is absent. Preserve bank-DP-19_fix_map.sql. DP-20/24/27/28 need their existing helpers called in the normal attempts, propagation and loss paths owned by hunters/auditors/slide. DB-49/57 adapter queue connection and DB-51 scheduling belong to the named runtime/workflow owners; see the preserved bank-continuation.md table. DB-45 shown windows are built; meetings/Admin still own scheduler/acquisition/settings/Map Undo hooks and the held-route reader-settings cache tag. No policy or budget changes are requested.
