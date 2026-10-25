# River status

build_state: LIVE FOR READERS: release 112 (main 0d36af457, RV-MEET3), live 3:59 AM EDT. GATING: DB-03A 421ce7abe alone (River-finished 4:20 AM EDT: the walk now runs outside the cp_doors lock; river-next 99ce96f52), next release, ahead of everything else. RB-A6 d7b31ba67 gate stopped to give DB-03A the machine; re-gates after. Queue (each its own batch, by arrival): RB-A6, CL-01 b98903e96, MD-01 a7014d303, RB-A4 624ac2d3d (River-finished), RT-01 a13baecf8, AD-01 69806d306, DB-03 one fix at a time (Admin 04681516c, state doors e4305907d, inventory readback f2d76ac1f), RB-A7 after RB-A4, DB-02 + BL-02 (bl-02-bills c3fff3702), MT-01 follow-up 79758c831, RB-A3 follow-up be0bef2bf. HELD: RB-A10 7b5eacd03 (place map 0 rows)
worker: claude-river
provider: Claude
run_id: session_01KQeVtrq9c4dWXSpaNnogn3
lock: session_01KQeVtrq9c4dWXSpaNnogn3
heartbeat: 2026-10-25T08:06:47Z

## River session session_01KQeVtrq9c4dWXSpaNnogn3 (Oct 24, from 4:40 AM EDT)

Sean's orders (4:40 AM EDT): Job 1 fix the meeting-outcome repairs release 95 broke; Job 2 publish key-like official pages from a cleaned copy (never hold, never ask); fold order: RV-REPAIR, RIVER-KEYS, MT-01, RN-03, DB-01, SO-01, CL-01, PT-01, MD-01, RB-A1, then RB-A2/A3/A5/A8, RB-A6/A4/A10, RB-A7, RB-A9, RB-A11. Standing order (Oct 24 ~4:50 AM EDT): a lane sent back with no new READY in 60 minutes, or silent for 2 hours, River finishes it on its own branch, marks it READY with the lane's id and folds it; what was fixed and why goes here.

Plan (owner · next action):
- RV-REPAIR · River · gates on river-next 39c3037f4, then promote and ship as release 96.
- RIVER-KEYS · River (helper building stream/river-keys) · READY, then fold second.
- MT-01, RN-03, DB-01, SO-01, CL-01, PT-01, MD-01, RB-A1..A11 · their lanes · no branch has work ahead of river yet (stream/rb-a1 exists, 0 ahead); River checks every 20 minutes.
- RN-02's return: its repair-failure half is RV-REPAIR; the named meetings (San Diego legistar:sdcounty:2042, Galveston) are rechecked after release 96.

### RV-REPAIR (Job 1), 4:55 AM EDT
Cause confirmed: lib/civic-data/reader-repair-protocol.ts installOutcomeRepairSelection filled OUTCOME_PARTITION_CONTRACTS but not RUNTIME_ROUTINE_CONTRACTS, and lib/civic-data/store.ts registeredMutationContract looks only there, so every outcome readback in a repair child was refused. Fix (stream/river-repair, READY ba769a4ed): one installOutcomePartitions in lib/civic-data/outcome-partitions.ts that moves the outcome list, runtime contracts, door pointers and sitting windows together; refreshOutcomePartitions and installOutcomeRepairSelection both call it; the repair side keeps its validation; the old copy is deleted. The child gets the sitting windows too (same function), so it sees what its parent sees.
- Proof on real production data: all 3,836 Legistar doors from the production control plane, built into 3,831 outcome contracts, handed as JSON to a fresh child as the supervisor does. Release 95 code: 0 of 3,831 pass the store's authority check (door-outcomes 2,601 and door-minutes-outcomes 1,230 refused). Fixed code: 3,831 of 3,831 pass. By state: CA 1271, WI 457, TX 432, FL 388, MO 214, IL 162, NY 104, WA 89, CO 85, MI 67, NV 54, OK 50, CT 47, AL 46, AK 41, NC 41, AZ 39, MA 39, NM 37, OH 30, PA 26, MN 24, GA 20, VA 19, OR 14, ME 10, HI 8, UT 7, ID 2, MS 2, NJ 2, WY 2, KY 1, MD 1.
- Baseline (Admin owner digest on release 95): "1308 Reader repair mechanism failure(s)" on every pass 2:59 to 4:42 AM EDT; supervisor failures 1,476 to 1,687 a pass.
- Done when READER_READBACK_REPAIR_FAILED is under 60 on the next 2 passes that run reader repair after release 96 is live.

### River finished RB-A4 on its branch, 11:10 PM EDT (standing order; no READY by 10:40 PM EDT)
- READY 0bdb1353d on stream/rb-a4 (fast-forward from ef7987b1e; merges origin/river through RV-LOCK 829f38c05).
- Resolutions:
  - lib/core/door.ts keeps RB-A8's single counter (RB-A3's filePublication increment removed); river's recursive queueRebuild is replaced by RB-A4's queueEntityPlaces, which queues the places the door just filed (fileEntityPlaces inherits ancestors' places).
  - lib/facts/meeting-facts.ts keeps MT-01's version; drops only the line copying owner places onto meetings (the door files inherited places now).
  - The reader journal appends RB-A4_entity_places (idx 56) after RB-A8_count_hour; phases keep RB-A8's lockFirst.
  - tests/helpers/fact-db.ts keeps both sides.
- Migration: one ADD COLUMN with a constant default (expand). Production is PostgreSQL 18.6 with 184,628 entity_place rows; metadata-only, no rewrite.
- Checks: 176/176 focused tests, 261/261 tests using fact-db, 131/131 after the RV-LOCK merge; tsc, eslint, knip clean.
- Proof (read-only exports at 11:04 PM EDT, replayed locally): all 174 original board IDs resolve and are placed (2,191 member facts); all 27,571 state-root districts placed; 2,369 live facts preserved; next import reloads 0 states. Northwest Inupiat Housing Authority's and BART's boards reach readPlacePackage. All 60 stored event references resolve (36 distinct ids).
- Folds in its own small batch, in queue order.

### 4 AM EDT: release 112 live, 3:59 AM EDT (main 0d36af457: RV-MEET3)
- Reader checks pass:
  - /ballot 85701 and 03255: 200, no console errors.
  - Ask on 85701: grounded.
  - /api/meetings: 85701 438 id fields, 60602 615.
  - /national: 200.
- Random ZIPs, seed 1112: 20/20 load and resolve to their county and city, across AK, AZ, IL, HI, OR, OK, MT, AR, WI, MA, VI, PA, MS, AL, NE, VT, CT, IN, LA and WA.
- Meeting proof owed once the runner takes 112:
  - publish-now passes launch meeting boards (first launch before about 280 s);
  - meeting reads per ET hour at or above the 8 PM-hour 57;
  - new meeting facts above 1,000 an hour from calendar reads.
  - Then DB-01's read savings are re-measured with meetings running.
- Box proof second look about 4:03 AM EDT.

### RV-BOX proof, first look, 3:28 AM EDT (counts only)
- The runner took release 111 at about 3:05 AM EDT. Publish-now passes on 111: 3:14 and 3:23 AM, both with no box-facts failure. The proof needs 3.
- Box failures had also stopped in every pass from 2:32 AM EDT (still on 110, and before the indexes existed at 2:40), so a quiet hour alone does not prove the fix. River keeps counting across the next hours.
- Box built per ET hour: 11 PM 7, midnight 120, 1 AM 175, 2 AM 232, 3 AM 46 by 3:27. Waiting: 352,711.
- Built by state, last 4 h: VT 129, DE 109, TN 69, IA 43, ID 29, FL 27, DC 26, KY 24, SC 20, GA 18, CO 12, AL 11, CA 11, AR 8, PA 7, AK 6, HI 6, CT 6, AZ 4, IN 3, WI 3, UT 2, MD 2, MS 1, OK 1, OR 1, WY 1, ND 1.
- No clear rise in built per hour yet. Box publication is capped at 1,000 findings and about 200 s a pass, so boxDue speed alone may not raise the rate. RV-MEET3 also moves Box beside the source pass.

### 3 AM EDT
- Live for readers: release 111 (RV-BOX).
  - Every fixed check and 20 random ZIPs in 20 states pass.
  - The four Box indexes are built. The boxDue proof is due about 3:26 AM EDT.
- Meetings: still stopped in publish-now passes (pre-admission about 485 s). RV-MEET3, which moves pins and Box beside the source pass, is gating alone.
- RB-A4 finished by River (no fact pulls outside door.ts). DB-03A returned for its cp_doors lock.
- DB-03 posted two more READYs (state doors; inventory readback, which deletes a readback phase rather than adding one). They fold one at a time, as Sean ordered.

### RV-MEET3: why publish-now passes still launch no meetings (River helper, 2:55 AM EDT)
- Timeline of the publish-now pass that started 2:15:07 AM EDT (seconds in; from the rows the pass writes; counts and small aggregates only):
  - 0 to 16: start-up.
  - 16 to 216: held meeting pins, capped at 200 s.
  - 216 to about 290: Box publication.
  - about 290 to 322: publication inputs and hot meeting partitions.
  - 322 to 353: hourly probes.
  - 353 to 485: task clocks, due requests and the decision loop.
  - 485 to 494: decisions and QUEUED lines written.
  - 494: first launch, already past the about 400 s launch window, so every board defers with PASS_TIME_BUDGET.
- First decision before release 110: 242 to 285 s into the pass. Since about 12:30 AM EDT: 402 to 565 s. Since then the pin step has work every pass (MT-01's source-first addresses made more held sittings placeable), so it spends its full 200 s every time.
- Fix, RV-MEET3 (READY 6f57717fc on stream/river-meet3, River's own lane):
  - Meeting pins, then Box publication, now run in the background beside admission and the source pass, with the same deadlines and failure codes.
  - The pass waits for them before it saves its outcome, and the quiet publish-now exit waits too. A test pins the order and that a failure is recorded without rejecting.
- Expected first launch about 210 to 225 s, against about 494 s. The real cutoff for starting a board is about 280 s (launch deadline less 120 s), which leaves about 55 to 150 s for boards.
- Still open, not in this change:
  - The 41 to 139 s segment of clocks and decisions.
  - The hunt-source-progress log (1.9M rows, growing about 220,000 a day).
  - Pins also run in the routine pass at the same time.

### Release 111 live, 2:43 AM EDT (main 2e874974f: RV-BOX)
- RV-BOX_expand applied at the production build, 2:40:45 AM EDT. All four indexes are valid: cp_box_findings_retry 40 kB, _slot 21 MB, _refused 296 kB, _unslotted 16 MB.
- Reader checks pass:
  - /ballot 85701 and 03255: 200, no console errors.
  - Ask on 85701: grounded.
  - /api/meetings: 85701 438 id fields, 60602 615.
  - /national: 200.
- Random ZIPs, seed 1111: 20/20 load and resolve to their county and city, across MD, AK, ND, OR, GA, GU, MN, AL, WV, MS, NC, HI, DC, LA, CO, CT, ME, NE, OK and ID.
- Proof owed once the runner takes 111: 0 boxDue timeouts over the next 3 publish-now passes, and Box built per hour up by state against the baseline.

### Meeting proof on release 110, 2:30 AM EDT: not met yet
- The routine pass on 110 (2:12 AM EDT) attempted 65 tasks, including 10 meetings and 25 voting sites; on 109 it was 1 to 5 meetings.
- Every publish-now pass on 110 (1:57, 2:06, 2:14, 2:23 AM EDT) attempted 0 tasks and deferred 782 to 796 meeting boards, now with PASS_TIME_BUDGET: the state calendar programs reach their start after the 400 s launch window has closed.
  - Timeline of the pass that started 2:15:07 AM EDT: first digest (ACTIVITY) at +203 s; launch decisions at +485 s. Before 106 that step came at about +245 s.
- Meeting reads per ET hour: 1 AM 43, 2 AM so far 27.
- A River helper is placing the 485 s on the pre-admission steps (counts only) and will put a fix on stream/river-meet3. It ships alone as soon as it gates.

### 2 AM EDT
- Live for readers: release 110. The runner switched to it about 1:50 AM EDT; its first publish-now pass (1:57 AM) attempted 0 tasks, and the first routine pass on 110 is running.
- Meeting reads per ET hour: 10 PM 3, 11 PM 22, midnight 14, 1 AM 43 (mostly before the switch).
- New meeting facts: midnight 1,822, 1 AM 4,171 (mostly MT-01 re-publishing addresses), 2 AM so far 257.
- The proof waits for 2 hours on 110: reads at or above the 8 PM-hour 57, and facts above 1,000 from calendar reads.
- The 1:46 AM routine pass (on 109) attempted 114 tasks, up from 33 to 57 earlier in the night.

### Release 110 live, by 1:30 AM EDT (main f6d35d05b: RV-MEET2)
- Reader checks pass:
  - /ballot 85701 and 03255: 200, no console errors.
  - Ask on 85701: grounded.
  - /api/meetings: 85701 438 id fields (was 435), 60602 611 (was 598).
  - /national: 200.
- Random ZIPs, seed 1110: 20/20 load and resolve to their county and city, across AL, AK, DE, VA, NH, CO, NV, OR, MS, AZ, UT, WY, SC, TN, LA, PR, CT, SD, OH and MN. Thin: Puerto Rico 00953 (Toa Alta), a 445-character ballot page.
- Meeting proof, owed once the runner takes 110 (it was on 109 at 1:33 AM EDT):
  - Reads (first attempts per ET hour, civic_data_candidate_events): 3 PM 61, 4 PM 190, 5 PM 335, 6 PM 156, 7 PM 177, 8 PM 57, 9 PM 94, 10 PM 3, 11 PM 22, midnight 14, 1 AM 20.
  - New meeting facts per ET hour: 1,027 at 9 PM, 214 at 11 PM, 1,822 at midnight, 2,226 at 1 AM.
  - The midnight and 1 AM facts are MT-01 (release 109) re-publishing existing meetings with source-first addresses, not new calendar reads; reads are still about 20 an hour. The proof is reads back to the 8 PM-hour rate or better with new facts above 1,000.
  - Counts: /var/tmp/live/meeting-reads.mjs.

### Random-ZIP release check (Sean: never one city), release 109 baseline, 2:05 AM EDT
- Method: /var/tmp/live/random-zips.cjs <base> 20 [seed]. It picks one random standard ZIP in each of 20 random states from the repo's ZIP shards (no database read), then loads /ballot?zip=, /api/meetings?zip= and /api/location/zip?zip= live, and checks the ZIP resolves to its own county and city.
- Seed 4242: 20/20 load (ballot 200, meetings 200, no "didn't load", 0 console errors) and 20/20 resolve to their county and city, across IN, AK, MS, WY, MO, NH, VT, AR, MD, NJ, TX, NM, GU, NY, UT, ME, MN, KY, ND and NV.
  - Thin: Guam 96929 (Yigo) shows a 412-character ballot page.
- Unseeded run: 20/20 load across WA, AR, MN, TX, FL, WI, NC, SC, IL, VT, OR, OK, GA, NY, NJ, ND, CO, MS, ID and AK.
- Every release from 110 on is checked this way, plus the fixed checks, which include the one Ask. RB-A10's gate uses the same check once the place map has rows in every state.

### DB-03A baseline: cp_doors bytes per hour (control plane cp_vital_signs, 1:40 AM EDT)
- cp_doors, last 12 h (EDT): 2 PM 768 MB, 3 PM 779, 4 PM 1,124, 5 PM 731, 6 PM 1,109, 7 PM 2,220, 8 PM 3,606, 9 PM 4,239, 10 PM 4,960, 11 PM 3,219, midnight 2,373, 1 AM (partial) 1,249.
- Usually 50 to 80% of all runner Neon bytes (the hour totals run 1.2 to 8.4 GB).
- Largest caller: cp_doors.listWhere at lib/ballot/voting-source-publication.ts:41, 690 MB to 1.8 GB an hour; it grew when release 104 brought voting sites back.
- Next: voting-source-publication.ts:19 and :52, then registry.ts:406 read and :385 listChangedSince.
- RV-MEET2 gives voting sites about half of each pass, so part of the drop may land before DB-03A. Both get reported.

### Sean's orders, 1:20 AM EDT
- Neon: ask production for counts and small samples only. Never pull whole tables or whole copies, never open a new copy of production, stop any replay that reads a copy in bulk. A proof that needs more goes to Sean first with what it reads and how many GB.
- DB-03A: gate it alone when it posts READY and ship it right after RV-MEET2 and RV-BOX, ahead of everything else. Proof: cp_doors bytes per hour before and after.
- RB-A10: hold until place_boundary, zip_place and zcta_place have rows for every state in production (0 rows now; RT-01 is filling them) and 20 random ZIPs in 20 states resolve to their county and city. RB-A10 deletes the old ZIP lookups.
- RB-A4: before it ships, count read-only how many live facts lib/facts/portal-publication.ts's own "pulled" UPDATE would pull in production, by state. If readers would lose any, send it back to go through lib/core/door.ts.
- Fold RB-A4 before RB-A7 (both change lib/reader/place.ts and lib/core/door.ts).
- BL-02 folds only from stream/bl-02-bills c3fff3702; stream/bl-02 is stale.
- New lanes DB-03A, RT-01, DB-03 (one fix at a time) and AD-01: fold their READYs as they come.
- Prove every release on random ZIPs across the country, never on one city.

### 1 AM EDT: what is live for readers
- Release 109 (since 12:08 AM EDT):
  - One official photo per person across official cards, ballot entries and National cards (PT-01).
  - Meeting places from the source's own street address first (MT-01).
  - Reader checks green.
- Not live yet:
  - Meeting calendars still stopped (no new meeting facts since about 9:30 PM EDT); release 110 fixes it.
  - Box facts still publish only on passes whose boxDue read finishes in time; RV-BOX (release 111) fixes it.

### RV-BOX: Box publishing timeouts (Sean, 12:15 AM EDT), READY 9350e15da on stream/river-box
- Cause (production control plane, read-only, EXPLAIN ANALYZE BUFFERS): each boxDue call read about 610,000 pages (4.7 GB) to return 1,000 of the about 1,646 due rows.
  - The waiting branch reads every waiting row (386,000 pages) to test each one's slot and retry clock.
  - The refused branch scans the whole 587 MB table.
  - The unslotted branch reads all 162,000 rows to keep 1,000.
  - Warm, that took 3.1 s. In a busy pass, with about 346,000 of the pages read from storage, it ran past the 25 s bound on 13 passes from 4 PM EDT.
  - Every due row is due by its retry time; none by a moved slot version.
- Fix: no new work system. Four partial indexes, one per branch: retry time, class and slot, refused ids, unslotted waiting ids.
  - The control-plane migration RV-BOX_expand builds them concurrently at the production build (the runner's writes are never blocked), then runs ANALYZE.
  - The one SQL change: the waiting branch's OR becomes its retry arm plus a stale-slot arm. The stale-slot arm walks the few distinct class and slot pairs, so a moved slot version still requeues its whole class.
- Checks:
  - Local Postgres 16 copy shaped like production (365,000 rows, 535 MB): 440,068 to 2,255 pages, 1.8 s to 29 ms, identical rows.
  - Also identical after slot bumps for site walk, rosters, other and governments (30 to 50 ms against 1.3 to 1.5 s).
  - A new test pins stale slots per class, including a missing class and one not in the map, and that no branch uses a sequential scan.
  - Box, migration and schema tests pass, apart from the one harness-database test that fails on river too. tsc and eslint are clean.
- Baseline (control plane, 12:20 AM EDT): Box built per hour 27, 56, 133, 364, 151, 95, 56, 73, 102 (4 PM to midnight EDT); 349,713 waiting.
  - Built in the last 8 h by state: CT 145, VT 124, AK 69, TN 68, CO 66, WY 62, FL 59, GA 55, AZ 47, AL 45, AR 36, IA 33, CA 32, KS 31, UT 28, NV 27, ID 20, SC 19, DE 15, IN 12, MD 9, IL 9, PA 7, HI 7, MA 5, MS 5, KY 4, DC 3, WV 3, ND 2, NC 2, MN 2, OR 2, VI 1, NM 1, TX 1, OK 1.
- Proof owed after release: 0 boxDue timeouts over the next 3 publish-now passes, and Box built per hour up, by state (/var/tmp/live/box-built.mjs).

### Release 109 live, 12:08 AM EDT (main 5a3f76a8b: PT-01 + MT-01)
- Chrome reader checks on meanwhileusa.com all pass:
  - /ballot 85701 and 03255: 200, no console errors.
  - Ask on 85701: grounded.
  - /api/meetings: 200 for 85701 (435 id fields) and 60602 (598).
  - /national: 200.
- PT-01's card/ballot portrait pair: one photo per person, live.
  - Alma Hernandez: card (/api/reader/state AZ 85701) and 85701 ballot both show /api/portraits/officials/0db1d6e6b249facd….webp.
  - Sally Ann Gonzales: both show f1d0edf8ad365a8e….webp.
  - Both hashes are the ones PT-01's proof recorded.
- What readers gain:
  - The same person carries the same official photo on their official card, ballot entry and National card.
  - Meeting places publish from the source's own street address, before falling back to the board's or the government's office.

### Release 108 live, 11:32 PM EDT (main c0500807b, RV-LOCK)
- /api/build shows c0500807b. Chrome reader checks on meanwhileusa.com all pass:
  - /ballot 85701: 200, AZ voting card intact (Election Day Nov 3; early voting Oct 7 to Oct 30; mail-ballot request Oct 23; voter registration Oct 5, 11:59 p.m.). No console errors.
  - Ask on 85701: grounded, names Kelly, Gallego and Grijalva (District 7).
  - /ballot 03255: 200.
  - /api/meetings: 200 for 85701 (435 id fields) and 60602 (598).
  - /national: 200.
- What readers gain: nothing visible. It unblocks every later release, which could not deploy while release 107's migration deadlocked.

### Release 108 build: RB-A8_count_hour lock hold (Sean item 4), 11:32 PM EDT
- Applied on the release 108 production build: 19 statements, reader journal 56 of 56 (id 56 = RB-A8_count_hour, hash aaea8f93); control plane RB-A5_expand at 11:29:07 PM and RB-A8_expand at 11:29:48 PM EDT; outcome recorded in Admin's "Production migrations" digest at 11:29:48 PM EDT.
- Locks on fact, civic_data_promotions and entity were taken together at 11:26:46.19 PM EDT (the 'counter start' row's statement_timestamp, which is the DO statement's start, when LOCK TABLE ran first). They were released when the transaction committed, before the control-plane step began. RB-A5_expand finished at 11:29:07.53 PM, so the hold was at most 2 min 21 s, including the backfill of all 1.06M facts.
- Reader locks (fact, civic_data_promotions, entity), 11:26:46 to at most 11:29:07 PM EDT: no runner write failed.
  - The last fact write before the window was 11:26:16.55 PM.
  - Two passes spanned the window: routine 11:10 to 11:34 PM (57 tasks) and publish-now 11:25 to 11:33 PM. Neither shows deadlock, lock-timeout or statement-timeout text, and their failure codes match the passes before.
- Control-plane locks: one runner write failed (Sean item 4, settled 11:58 PM EDT).
  - RB-A8_expand locks cp_doors, cp_work_items, cp_work_items_archive, cp_box_findings, work_row and cp_owner_snapshots together (SHARE ROW EXCLUSIVE). It held them from RB-A5's finish at 11:29:07 PM to its own at 11:29:48 PM, at most 41 s.
  - In that window the 11:25 PM publish-now pass's box-facts step could not record its result: two cp_box_findings compareAndSet writes ran past their 10 s bound (BOX_FAILURE_RECORD_UNWRITTEN, digest 11:33:32 PM). This is the only failure of that kind all evening. The digest does not give the exact write time, but its 10 s waits fall inside the lock window.
  - The box work stays owed and later passes retry it. Nothing was lost.
- Separate, and older than the release: box-facts has failed 13 times since 4:00 PM EDT, including 11:44 PM, on cp_box_findings.boxDue (PAGE) exceeding its 25 s read bound. Box facts are not publishing from those passes. FOR SEAN, or the box lane: that query needs an index or a smaller page. It is not lock-related.

### Meeting calendars stopped after release 106 (Sean, 11:10 PM EDT)
- Sean's report: new meeting facts per hour 1,027 (9 PM hour) -> 0 (10 PM hour). meetings-public-bodies reads came in hourly bursts (51 at 8:10 PM, 90 at 9:00 PM); since the runner took release 106 (526fe7131, DB-01) about 9:27 PM, only 1 to 4 reads every 10 minutes and no 10 PM burst. The 10:44 PM digest has PUBLICATION_INPUT_CLOCK_UNREAD=1 and CHILD_EXIT_CONTRADICTED_SOURCE_RECEIPT=3; Bismarck CivicPlus got HTTP 429 at 10:55 PM.
- A River helper is root-causing it, starting with DB-01's per-scope clock versions (civic_data_clock_versions and its triggers; the runner's shared read cache), against production records read-only, with a fix on stream/river-meet2 and a replay of how many meeting partitions launch on the next pass, by state.
- Placement: the fix ships as its own small batch, ahead of everything except RV-LOCK (release 108, already in CI and needed so any build can deploy). If RV-LOCK merges first, the meeting fix is release 109 and PT-01 + MT-01 (PR #819) moves to 110.
- Proof owed after deploy: meeting calendar reads at the 8 PM-hour rate on the next pass, and new meeting facts per hour above 1,000. Then River re-measures DB-01's read savings with meetings running.
- Cause found (11:55 PM EDT). DB-01's clock code is not it:
  - Replaying the clock read on 1,000 real meeting scopes with the 105 and 106 store code gives identical clocks.
  - 0 of 3,525 meeting clock versions changed in 7.6 minutes of live passes.
  - About 800 due boards are still queued every publish-now pass, before and after 106.
- The two real steps:
  1. Release 104 (RV-VOTE, River's change, 7:17 PM EDT) put every voting-sites program at the front of the routine pass. Each holds its memory to the pass deadline, so 25 to 35 of them per pass left the meeting calendars waiting on memory. Routine passes went from 163-278 attempted tasks to 33-57; the 03:10Z pass deferred 826 meeting boards in 39 states on worker memory. After that, meetings ran only when a 10-minute publish-now pass launched them early.
  2. A state calendar program may start a board only until 280 s into a publish-now pass (two-thirds of 10 minutes, less the 120 s read timeout). Before 106, the first launch came at a median 253 s, and the passes that launched by about 245 s read 38 to 289 boards (Sean's 51 and 90 bursts). After 106 the median is 309 s, earliest 306 s, so every board defers.
     - Most of the pre-launch time is about 800 QUEUED and then 800 COLLECTING hunt progress lines written one at a time (about 50 s a set).
     - Part of the 60 s shift may be DB-01 re-reading clocks its shared cache evicted: about 780 clock reads per pass in the 10 PM hour, about 15 s. Not proven.
  - The 10:44 PM digest failures are voting-sites ones: NH's input is over Neon's 64 MB response limit, and MN, WA and UT have contradicted receipts. Bismarck-type 429s ran 17 to 81 an hour all evening, so they are not new.
- Fix, RV-MEET2 (READY c02e4bf30 on stream/river-meet2, River's own lane):
  - Ballot files still lead the pass. Voting sites now take turns with the rest of it, so each gets about half the memory: at 20 GB with 30 voting states and 15 calendar programs, at least 8 of each start (a test pins this; on the old order, calendars got 2 or 3).
  - Hunt progress lines are written 16 at a time.
  - Focused tests pass (the 5 that need the harness database fail on river too); tsc and eslint are clean.
  - Gating alone now; it ships as its own release right after 109.
- Proof owed after it is live: meeting reads per hour back to the 8 PM-hour rate or better, new meeting facts above 1,000 an hour, then DB-01's read savings re-measured with meetings running.

### Sean's queue fixes, 11:10 PM EDT
1. MD-01 READY a7014d303 (7:18 PM EDT; implementation 576965f, the cheaper explanation writer) added to the queue after CL-01.
2. RB-A8's own migration-lock commits (ebb4ff8e9, a5d7067eb) are not folded; locking stays with River (RV-LOCK). Release 107 already shipped RB-A8 at fb1783a62; nothing newer from RB-A8 folds unless it posts a new READY that drops those changes.
3. RB-A10 (no push since WIP 17bb75130 at 5:58 PM EDT): Sean is restarting its session. If no READY by 1 AM EDT, River finishes it under the standing order (check scheduled).
4. When release 108 builds, River records how long RB-A8_count_hour held the locks on fact, entity and civic_data_promotions, and whether any runner writes failed while waiting.
- Queue now: 108 RV-LOCK (PR #820) -> 109 PT-01 + MT-01 (PR #819, held) -> DB-02 + BL-02 (gating on river-next e9317ec72) -> RB-A6 d7b31ba67 -> CL-01 b98903e96 -> MD-01 a7014d303 -> RB-A4 (River helper finishing) -> RB-A10.

### Release 108 (RV-LOCK) open; RB-A6 finished; disk, 11:20 PM EDT
- Release 108 = RV-LOCK alone, PR #820 (branch release/108-lock, since release/108 is #819's), auto-merge on.
  - Gates on 94e9053e8: 9,851 tests pass. build and build:standalone failed because River's container disk filled ("No space left on device"); after freeing space, build, test:bundle 16/16 and build:standalone pass.
  - The preview of this tree (release 107's code + RV-LOCK) against production passes Sean's checks.
  - Its build retries RB-A8_count_hour with fact, civic_data_promotions and entity locked first. If it applies, 107's code goes live too.
- PR #819 renamed Release 109 (PT-01 + MT-01). It stays held until 108 is live; then River merges main into it and turns auto-merge back on.
- River finished RB-A6 on its branch (standing order; no READY by 10:40 PM EDT): READY d7b31ba67, merging river 90d0f445e.
  - lib/control-plane/line-keeper/country.ts keeps RB-A8's compact keeper (no deleted inventory restored); RB-A6's hunter handoff and Admin counts already read owed, held and missing per place on demand (lib/coverage/owed-read.ts). Three tests take river's versions, which include RB-A6's edgeOnly change.
  - Checks: 110/110 assigned tests, 340/340 wider tests; tsc, eslint, knip clean.
  - Proof (read-only production): all 57 state/territory/national rows match direct SQL; owed 1,895,086, held 519,794, missing 1,375,292; ten ZIPs replayed on copies keep every held fact id and value (15,571 held, 28,768 missing).
- RB-A4: a River helper is still finishing it on stream/rb-a4.
- Disk: River removed 12 finished worktrees (all pushed) and its local Postgres copy; free space went from 568 MB to 13 GB.

### Returns at 10:40 PM EDT
- CL-01 posted READY b98903e96 at 10:05 PM EDT, inside its window; return cleared. It folds after PT-01 + MT-01.
- RB-A6 (READY 50405245e) and RB-A4 (READY ef7987b1e) posted nothing by 10:40 PM EDT. Per the standing order, River helpers are merging origin/river 90d0f445e into stream/rb-a6 and stream/rb-a4, keeping RB-A8's compact keeper and single fact counter, MT-01's meeting points, and each lane's own reader/Admin results, with proofs on production data (read-only). Each gets READY and folds in its own small batch.
- RV-LOCK gating (release 108); PR #819 (PT-01 + MT-01) CI green, held with auto-merge off until 108 is live.

### Release 107 build failed: migration deadlock; fix RV-LOCK gating, 10:25 PM EDT
- Release 107 merged at 9:44 PM EDT, but /api/build still shows 106 (readers unaffected).
- The build's own record (owner digest "Production migrations", 9:47 PM EDT, d4ce7606a, expand, FAILED): RB-A3_expand applied (rebuild_queue, count_hour); RB-A8_count_hour "transaction rolled back … deadlock detected". The build stopped there, so release 107 never deployed and RB-A5/RB-A8's control-plane migrations didn't run.
- Cause: RB-A8_count_hour's single transaction adds a trigger on fact, backfills about 1.06M fact rows (6.3 GB table), then adds triggers on civic_data_promotions and entity. It holds fact while the runner, writing those tables, holds the others. Every later build retries the same pending migration.
- Fix RV-LOCK (stream/river-lock READY 94e9053e8, on main d4ce7606a): a migration can declare lockFirst tables in lib/db/migration-phases.ts. scripts/apply-migrations.mts locks them together (SHARE ROW EXCLUSIVE, what CREATE TRIGGER takes) before the first statement, so it never waits for a lock while holding another. RB-A8_count_hour declares fact, civic_data_promotions, entity. Readers' SELECTs aren't blocked; runner writes to those tables wait for the backfill (River measured an entity-joined scan of fact at 12.6 s read-only).
- Checks: new test fails without the declaration; 92 migration tests pass; tsc and eslint clean. Full gates running from 10:25 PM EDT; it ships alone as release 108 (main 107 + RV-LOCK). The 108 build then retries RB-A8_count_hour with the locks first.
- Held: PR #819 (PT-01 + MT-01, titled release 108) has auto-merge off until RV-LOCK is live; it becomes release 109. DB-02 + BL-02 gates stopped; re-gated after.

### Batches and returns, 9:45 PM EDT
- Release 107 (PR #818): RB-A8 fb1783a62 with RB-A3 d92e9a054 and RB-A5 f7ab065e3. Gates 9 of 9, 9,850 tests. The preview against production shows Arizona's October 5 registration deadline on the 85701 ballot (RB-A8's retained-date repair); live today shows "Still gathering: … voter registration deadlines". Every other 85701 date matches.
- Gating: PT-01 a109cf965 + MT-01 0c28ca5c7 (river-next 78a1f9e0d). River re-merged PT-01's two-line card-source label map.
- Pre-folded next: DB-02 2769c614e (clean) + BL-02 c3fff3702 (b42272b1b). River merged the worker memory list in lib/control-plane/workers/worker-slots.ts to keep both legiscan-bulk.mts and place-map-refresh.mts; both have peak figures.
- Returned, with exact merges in returns/<lane>.md (River takes each over at its deadline):
  - RB-A6 50405245e: conflicts with RB-A8 in lib/control-plane/line-keeper/country.ts (RB-A8 removed the held-capture inventory RB-A6 builds on) and 3 tests. 10:40 PM EDT.
  - RB-A4 ef7987b1e (8 hours old): conflicts in lib/core/door.ts, lib/facts/meeting-facts.ts (RB-A8's single fact counter, MT-01's meeting points), the reader journal and phases, and tests/helpers/fact-db.ts. 10:40 PM EDT.
  - CL-01 56e7dce36: conflicts with PT-01's portrait selection in lib/officials/lookup.ts toSeatHolder, and in merge-people.ts. 10:45 PM EDT.

### Release 106 live, 9:04 PM EDT (DB-01); hourly status
- /api/build 526fe7131 (PR #817 merge commit). Sean's checks in Chromium at 9:05 PM EDT, all pass: /ballot 85701 and 03255 200 (render, 0 console errors), Ask on the 85701 ballot 200 grounded, /api/meetings 85701 200 and 60602 200, /national 200.
- DB-01's expand migration applied at the production build: civic_data_clock_versions exists; journal 54.
- Live for readers tonight: polling places refresh again (104), Cochise's 5 drop boxes, Arizona's statewide card fixed (103), about 170 more meeting calendars a pass (102), one card per person (101), the id lookup behind reactions (0051), and the reader pool that fails one read instead of the function (100).
- Gating: RB-A8 fb1783a62 with RB-A3 d92e9a054 and RB-A5 f7ab065e3 (river-next 0916a5b87). River appended RB-A3_expand and RB-A8_count_hour after DB-01 in the reader journal (idx 54, 55); 101 migration, control-plane and identity tests pass.
- New READYs since 7 PM: MT-01 0c28ca5c7 (source-first meeting addresses), CL-01 f5ea2e910 (reconciled with river; same person across ballot and held records), RB-A6 50405245e (hunters get missing fields with held values), DB-02 2769c614e (registry prior reuse on DB-01's scope versions), BL-02 c3fff3702 (bills).
- Queue after the RB-A8 batch, one batch gating at a time: PT-01 a109cf965 + MT-01 0c28ca5c7; RB-A6 50405245e + RB-A4 ef7987b1e (Sean's order RB-A6/A4/A10; RB-A4's meeting-facts.ts conflict reviewed at fold); CL-01 f5ea2e910; DB-02 2769c614e; BL-02 c3fff3702.

### Release 105 live, 8:23 PM EDT (RB-A2)
- /api/build 7f13a561c (PR #816 merge commit). Sean's checks in Chromium at 8:24 PM EDT, all pass: /ballot 85701 and 03255 200 (render, 0 console errors), Ask on the 85701 ballot 200 grounded, /api/meetings 85701 200 and 60602 200, /national 200.
- RB-A2's contract migration applied in production at 8:35 PM EDT (owner digest "Production migrations": OK for every statement; place_boundary exists; journal 53). It finished inside the 1-second statement limit, as the local 173 ms timing predicted.
- RB-A6 and RB-A10 can now build on river 667d8dad2 (RB-A2).

### Live for readers, 8:20 PM EDT
- Live: release 104 (2082dc9b1). Polling places refresh; Cochise's drop boxes are live (8:05 PM entry). Wheeling waits on the runner-host check (FOR SEAN).
- Release 105 (RB-A2 alone, Sean's order) in CI on PR #816, auto-merge on.
- DB-01 gating on top of RB-A2 (river-next b7246b8a1). River appended DB-01_read_versions after RB-A2_place_boundaries in the reader journal (idx 53, date after RB-A2's), so RB-A2's established entry keeps its number. 87 migration tests pass.
- RB-A8 posted READY fb1783a62 at 8:03 PM EDT, inside its return window; return cleared. It merges batch E and RB-A5, and keeps one fact counter: RB-A8's fact-table hooks; RB-A3's extra door increments and hour table are deleted. It folds next after DB-01 and brings RB-A3 and RB-A5 with it (both READY).
- Then PT-01 a109cf965, then RB-A4 ef7987b1e (conflicts in lib/facts/meeting-facts.ts; River reviews at fold).

### Verified: polling places refresh again, and Cochise's drop boxes are live, 8:05 PM EDT
- Release 104 (RV-VOTE) works in production: voting-sites tasks launched from 7:25 PM EDT (DC and DE checked at 7:35 PM; MT, AK and ME failed and retry hourly).
- Voting doors read since 7:05 PM EDT, published/failed by state: AL 2/2, AR 4/2, AZ 4/7, CA 10/2, CO 3/0, CT 1/1, DE 1/1, FL 7/1, GA 2/1, HI 1/1, IA 3/10, ID 7/2, IL 2/1, IN 2/2, KS 4/2, KY 2/0, LA 4/1. Total 59 published, 36 failed, 17 states so far; the rest follow as passes run.
- Sean's item 3, live on meanwhileusa.com (POST /api/voting-sites):
  - 85603 Cochise County: 5 drop boxes + 18 vote centers. cochise:ballot-box-table published at 7:51 PM EDT (RIVER-KEYS-FX reopened it in release 101).
  - 60090: still 0 sites. The Wheeling door (page:wheelingil.gov:14d010f03f2c) failed again at 7:51 PM EDT with the same transport error: "robots.txt could not be retrieved with this client: TypeError: fetch failed". From River's container wheelingil.gov answers in 0.5 s (robots.txt 200), so the failure is between the runner host and the site, possibly the site blocking the runner. FOR SEAN: run `curl -I https://wheelingil.gov/robots.txt` on the runner machine; if it fails there, Wheeling needs another route (e.g. the Cook County Clerk's early-voting list).
- El Paso 79901 and Cochise's vote centers were already live per Sean.

### Sean's order, 7:10 PM EDT: RB-A2 next
- "Fold RB-A2 (78a2a9f14) next, before DB-01, PT-01 and RB-A4. RB-A6 and RB-A10 are both waiting on it."
- Done: batch E's gates (DB-01 + RB-A2 + RB-A3) stopped. RB-A2 folded alone on river 4040fb227 (clean merge, no journal conflict without DB-01) -> river-next d72cf90d0, gating from 7:12 PM EDT. It ships alone as release 105.
- After it: DB-01 (re-fold on RB-A2; River merges the reader journal), then RB-A3, PT-01 + RB-A5, RB-A4. RB-A8 per its return.

### Release 104 live, 7:05 PM EDT (polling places)
- /api/build 2082dc9b1 (PR #814 merge commit). Sean's checks in Chromium at 7:06 PM EDT, all pass: /ballot 85701 and 03255 200 (render, 0 console errors), Ask on the 85701 ballot 200 grounded, /api/meetings 85701 200 and 60602 200, /national 200.
- Owed: the next source-launch passes must show voting-sites launched (not DEFER) and voting receipts recorded; then Cochise's 5 drop boxes on 85603 and Wheeling on 60090, with counts by state. River is watching.
- Release 105 plan: DB-01 + batch E (RB-A2 + RB-A3) together, since batch E is gated on top of DB-01 and its build is what a preview can check; if E fails, DB-01 ships alone.
- RB-A8 returned (returns/rb-a8.md): 7 files conflict with RB-A3/RB-A2/RB-A5, including the Admin scoreboard route's hourly reading and a possible double hourly count (RB-A3's fact counts vs RB-A8's count_hour). River takes it at 8:15 PM EDT if the lane hasn't.
- Next batch pre-folded on batch E (8c7e75c18): PT-01 a109cf965 (River merged two lines of the card-source label map) + RB-A5 f7ab065e3 (River merged the control-plane migration list with RIVER-KEYS-FX; 6 control-plane migration tests pass).

### Live for readers, 7:00 PM EDT
- Live: release 103 (d3416a24f). Reader checks passed at 5:51 PM EDT; Arizona's statewide card is fixed (SO-01).
- Release 104 (RV-VOTE, polling places) is in CI on PR #814, auto-merge on. Polling places haven't refreshed in any state since late morning; this is the fix.
- DB-01 (River-finished 4c5b40e39) on f26f9552d: gates 8 of 9, tests 9,812 pass, 1 fail: tests/congress-runner-receipt.test.ts "the Congress runner publishes core first…", which took 9,008 ms under the full parallel suite. Run alone it passes, and it takes the same time with and without DB-01 (918 ms vs 903 ms on 4040fb227). It is a load-time failure, not DB-01's. DB-01 ships as release 105 after 104 merges; CI on its PR runs the test again.
- PT-01: the lane merged SO-01's statewide selection itself and posted READY a109cf965 at 6:36 PM EDT; return cleared, no takeover.
- RB-A3 posted READY d92e9a054. Batch E (RB-A2 78a2a9f14 + RB-A3) gating from 7:00 PM EDT on 0873f9e42, on top of DB-01. River merged the reader migration journal (DB-01, RB-A3, RB-A2 entries by date) and both phase declarations.
- RB-A2's reader migration is contract phase (runs after deploy under the 1-second statement limit). Timed on the local production-size copy: 173 ms for the whole migration (0051 was 1.7 s there).
- Next: PT-01 a109cf965; RB-A5 + RB-A8 (control-plane journal and migration list merges); RB-A4 (also conflicts in lib/facts/meeting-facts.ts with today's meeting work; River reviews it at fold).
- River pushed a stray branch river-next-e (batch E's pre-fold, 0873f9e42); deleting it is refused by the git proxy ("remote end hung up"). It is harmless; River removes it after batch E ships.

### Release 103 live, 5:50 PM EDT
- /api/build d3416a24f (PR #813 merge commit). Sean's checks in Chromium at 5:51 PM EDT, all pass: /ballot 85701 and 03255 200 (render, 0 console errors), Ask on the 85701 ballot 200 grounded, /api/meetings 85701 200 (435 id fields, up from 409) and 60602 200, /national 200.
- SO-01 live: /api/representation for Arizona has no "Actions"; Kris Mayes and the governor's official contact engage@az.gov are present (before 103: "Actions" and no Mayes).
- RN-03 live: voting and registration input changes refresh once and then keep the real source clock.

### Why polling places stopped refreshing, and the fix (RV-VOTE), 5:50 PM EDT
- Cause (River helper; real code and production records, read-only):
  1. Worker memory goes in launch order (scripts/routine-civic-data-runner.mts:1283, lib/control-plane/workers/worker-slots.ts:475). Work started at the top of a pass holds its memory until the pass's launch deadline. Waiters expire at that same moment (worker-slots.ts:366), so no wait can ever succeed. Source children were never told the pass deadline (sourceChildCommand had no withPassDeadline), so fetch-voting-sites ran its own 20-minute read and was killed before printing a receipt. 27 of 35 voting runs at 12:24Z ended PASS_TIME_BUDGET; only 8 voting receipts all day. At 21:16Z fifteen 1,447 MiB state meeting-calendar programs held the pool (278 MiB spare).
  2. Voting always launched last. 31 states (AZ and IL among them) are due only through RN-03's door-input stamps; runner.mts:1146 marks them owed "now" every pass, so they never age and sort behind 56 candidate-campaign tasks also owed "now". Because the stamp is recorded only after a completed run, they stay due forever. 21 states have never had a state-level read and sort as first reads behind overdue work. AK, KY, ME, MT sit behind older meeting deadlines.
  3. The ballot-first ordering only broke ties: it ran inside routinePassLaunchOrder, not after it.
- Fix RV-VOTE (stream/river-vote READY c618f6973): electionLaunchOrder (lib/civic-data/ballot-publication.ts:44, replacing ballotPublicationLaunchOrder, deleted) puts due ballot-contests and voting-sites first, after the owed-time order. sourceChildCommand passes the pass deadline, so a voting child saves, prints its receipt, records its stamp and frees memory inside the pass.
- Proof: offline replay from production clocks and the 21:32Z heartbeat. On the next pass, 49 of 56 voting tasks start at the top of the pass (all but WI, WY, PR, VI, AS, GU, MP, which are next in line); before the fix the same model starts 4 and production started 0. If voting's real memory peak is 1,024 MiB rather than the 512 MiB floor, 24 start. A new test with the production shapes shows IL, TX and AK start with the fix; IL doesn't without it. tsc and eslint clean.
- Trade-off: on the first fixed pass voting takes most of the pool at the start, and meeting programs get memory as voting runs finish (about 13 minutes in). From Oct 27 the voting check runs hourly (Sean's voting.checkEveryMinutes), so voting would lead about every other pass. That cadence is Sean's setting; River didn't change it.
- Open, not changed: the owed-"now" rule (runner.mts:1146) also keeps registration-xx and candidate-campaign-sites-derived due forever.
- Order: RV-VOTE gates alone now (batch D with DB-01 stopped and re-queued right after), then a release, then River watches the next pass for voting receipts, Cochise drop boxes on 85603 and Wheeling on 60090, with counts by state.

### Meeting calendars after release 102, 5:40 PM EDT
- First full supervisor pass on 102 (5:32 PM EDT): 148 source tasks promoted, 62 held their last good copy, MEETING_PARTITION_READ_FAILED 0 (195 to 339 a pass all day before). Total supervisor failures 10 (4 RECEIPT_COUNT_INVALID, 4 CHILD_EXIT_CONTRADICTED_PARTITION_RECEIPT, 1 PUBLICATION_INPUT_CLOCK_UNREAD, 1 MEETING_PIN_PUBLICATION_FAILED: Census rejects a Carmel-by-the-Sea council address written as a description).
- Granicus, CivicPlus and PrimeGov meeting doors that published since 5:00 PM EDT: 57 (CO 9, FL 8, AZ 8, MA 6, CT 3, CA 2, MN 1, plus 20 whose ids carry no state).
- Not yet re-read since 102: the three replay examples (Peoria County zoning appeals, Barrington Hills plan commission, Adams County CO planning); their last failures predate 4:54 PM EDT. River checks them when they come due.
- PT-01 returned (returns/pt-01.md): it conflicts with SO-01 in lib/officials/statewide-executives.ts (SO-01's statewideHolder vs PT-01's inline portrait step) and carries an old copy of lib/reader/database.ts. River does the merge at 6:30 PM EDT if the lane hasn't.
- Batch D gating: DB-01 4c5b40e39 alone.

### River finished DB-01 on its branch, 5:30 PM EDT (standing order: no READY within 60 minutes of the return)
- What: merged river 720bc77b6 into stream/db-01 (no conflicts), fixed its 6 failing tests and two production bugs, READY: DB-01 4c5b40e39 (fast-forward from befe7b6f1).
- Fixes:
  - lib/db/identity-domains.ts:582 classifies civic_data_clock_versions (operational; identifies no one).
  - Admin Money (app/(admin)/_mw/admin-v6/screen-money.tsx:67): the hour select gets the shell select class.
  - screen-money.tsx:52: Admin Money crashed before any runner hour existed. An empty `hour` matched an empty load, then read null; this took down the whole Money view and was what failed tests 4-6.
  - lib/civic-data/store.ts readStatePromotion: DB-01 split the single keyed state-publication read into one read per nesting level, which broke serving reads (the TypeError in test 3). Serving processes again read pointer, metadata and parts in one keyed read, using DB-01's indexed hash lookup. Runner children keep DB-01's slim read with shared copies (cache test: 645,813 bytes cold, 2,550 on the next pass).
  - lib/civic-data/place-payload-slices.ts:29: DB-01's slice query failed in production for every MEETING read ("could not determine data type of parameter $5"); the typed CTE is restored. A new regression test at tests/db01-read-versions.test.ts:44 fails without the fix.
- Checks: 248 tests pass, 0 fail (the six, DB-01's own, migration tests, store integrity); tsc, eslint, knip clean.
- Proof, read-only production, river vs branch:
  - AZ registry binding: same 1 row, same digests.
  - AZ state publication: same row, 672 parts, same digests.
  - Cincinnati meetings: same 2 rows and the same decoded meetings; the promotions scan goes from a 20,579-row sequential scan to 1 indexed row.
  - Not rerun: DB-01's copy replay and write benchmark (they need the lane's throwaway Neon branch credentials). The fix doesn't touch the clock path.
- Folds in the next small batch.

### Found: no state's polling places have refreshed since late morning, 5:10 PM EDT
- Every source-launch pass since 1:42 PM EDT defers voting-sites in all 56 jurisdictions: "WORKER_MEMORY_DEADLINE: memory wait deferred", "Waiting for a worker slot". 25 states (AK, AS, GU, KY, ME, MP, MT, ND, OK, OR, PA, PR, RI, SC, SD, TN, TX, UT, VA, VI, VT, WA, WI, WV, WY) were deferring on alternating passes from 11:09 AM; before that they were not yet due. The last known IL voting read was 8:28 AM.
- Readers keep the polling places already published. But no new or changed site can publish, including Cochise's 5 drop boxes, Wheeling's early-voting site, or any county's updated early-voting list. The election is in 10 days.
- A River helper is root-causing this from the runner's admission code and real records (read-only). Possible trigger: release 97's RN-03 made every state's voting input due at once (all 56 first deferred at 12:22 PM EDT, after 97 went live at 11:48). The fix ships as its own small batch.

### Live for readers, 5:00 PM EDT
- Live: release 102 (4ae2e14e6, 4:54 PM EDT). Reader checks pass. The first supervisor digest on 102 is owed to confirm meeting calendar failures drop.
- Gating: batch C (RN-03 + SO-01), re-run with SO-01's new dependency installed.
- DB-01: no new READY by its 4:55 PM EDT window. Per the standing order a River helper is fixing its 6 failures on stream/db-01 (classify civic_data_clock_versions; shell select rule on the Admin Money hour select; the registry payload-part read's TypeError; the Admin Money and view tests), keeping DB-01's readers-unchanged proofs, then READY: DB-01 and the next batch.
- Voting: voting-sites:AZ and :IL still deferred on worker memory (last checked 3:25 PM EDT pass). Cochise's 5 drop boxes and Wheeling 60090 aren't live yet.
- Queue: C (gating) RN-03 + SO-01; D PT-01; E RB-A2 + RB-A5 + RB-A8; DB-01 when River's fix is READY; RB-A4 after RB-A3.

### Release 102 live, 4:54 PM EDT
- /api/build 4ae2e14e6 (PR #812 merge commit). Sean's checks in Chromium at 4:55 PM EDT, all pass: /ballot 85701 and 03255 200 (render, 0 console errors), Ask on the 85701 ballot 200 grounded, /api/meetings 85701 200 and 60602 200 (598 id fields, up from 584), /national 200.
- Readers now get: RV-MEET (Granicus, CivicPlus and PrimeGov calendars publish instead of failing on the vault's manifest URL); MT-01 (held meetings keep saved map pins; Sunnyside online meeting).
- Owed: the first supervisor digest on 4ae2e14e6 must show MEETING_PARTITION_READ_FAILED far below the 195 to 339 a pass seen since 2 AM. River is watching for it.
- Batch C's first gates run failed everywhere: SO-01 adds the npm package `entities` (named HTML entity decoding) and River's gating worktree wasn't reinstalled. Installed from the lockfile; re-gating from 4:45 PM EDT. River now reinstalls after every fold.

### River finished SO-01 on its branch, 4:40 PM EDT (standing order: no READY within 60 minutes of the return)
- What: merged river e2ee3657a (with CL-01) into stream/so-01 and marked READY: SO-01 05012c722 (fast-forward from 64ea93bb5).
- Why: SO-01's READY conflicted with CL-01 in 5 files / 8 hunks; the lane didn't answer by 4:08 PM EDT.
- How each conflict was resolved, keeping both lanes:
  - scoped-holders: CL-01's held sources, field merging and federal bare-title identity, plus SO-01's personName skip, state-scoped samePlace and per-field source date as the last tie-break.
  - campaign-money: CL-01's funding index, with the statewide executives added to its inputs; SO-01's separate executives cache removed.
  - state-publication, runtime-data-plane, runtime-issues: both import sets; the registry parser version only in runtime-version.ts.
- Two tests updated to SO-01's intended behavior: white-house-cabinet (parser version people-sources/3 so held pages reparse) and sl-03-real-sources (a verified statewide holder is placed, selection method UNKNOWN).
- Checks: 186 focused test files, 1,703 of 1,706 pass. The 3 failures were exactly those two files' old assertions, failing on SO-01's own READY too; after the update both files pass 15/15. tsc, eslint and knip clean.
- Proof on production data (read-only, merged code in-process):
  - AZ statewide: 12 -> 11. AG Kris Mayes; "Actions" gone. One governor, Katie Hobbs, engage@az.gov, her old IDs resolve to her card. All 5 Corporation Commissioners kept.
  - All 50 states: 186 -> 185 non-Congress statewide officials, only AZ changes; governors 51 -> 50; invalid names 1 -> 0.
  - Raleigh NC-02 keeps a single Deborah K. Ross.
- Open, for the SO-01 lane or Sean: looking up the old id plural:az:6e522a2a directly returns Katie Hobbs with the older Open States email (sosadmin@azsos.gov). The card shows engage@az.gov. SO-01's own code does the same.
- Folds in batch C with RN-03 953466400.

### Live for readers, 4:10 PM EDT
- Live: release 101 (6cd25dd09). Reader checks passed at 3:38 PM EDT. Readers have CL-01's one card per person, 0051's id lookup, the pool error handler, and Cochise's reopened doors (publishing waits on a voting-sites run, see 3:37 PM).
- Batch B split: DB-01 befe7b6f1 made 6 tests fail when folded. It was dropped and returned (returns/db-01.md, exact fixes): civic_data_clock_versions unclassified; the hour select on Admin Money lacks the shell select rule; the registry runtime read throws STORE_READ_FAILED in its test; 3 Admin Money/view tests. Without DB-01 all six files pass. River fixes it on stream/db-01 at 4:55 PM EDT if the lane hasn't.
- Batch B re-formed and gating from 3:48 PM EDT on river-next ca26d9092: MT-01 db4cd927b (latest READY), RB-A1 1d6df41d9 (docs), RV-MEET 6be91744f (meeting calendars: about 170 bodies a pass).
- SO-01: no new READY in its 60-minute window (4:08 PM EDT). Per the standing order a River helper is merging river into stream/so-01, keeping both CL-01's and SO-01's reader behavior, with proofs on production data (AZ AG Kris Mayes, one governor with the official contact, old IDs as aliases; Raleigh's single Ross). Then READY: SO-01 and the next batch.
- New READY: RN-03 953466400 (supersedes 13f6eb19f; on river e2ee3657a; NC 2,806 voting sites, Metro boards reach 97204). Next batch.
- Queue: C RN-03 + SO-01; D PT-01; E RB-A2 + RB-A5 + RB-A8; DB-01 when re-READY; RB-A4 after RB-A3.

### Release 101 live, 3:37 PM EDT
- /api/build 6cd25dd09 (PR #811 merge commit). Sean's checks in Chromium at 3:38 PM EDT, all pass: /ballot 85701 and 03255 200 (render, 0 console errors), Ask on the 85701 ballot 200 grounded, /api/meetings 85701 200 and 60602 200, /national 200.
- CL-01 live: Raleigh 27601's US House District 02 race shows 3 choices (Eugene F. Douglass, Matthew Laszacs, Deborah K. Ross), one Ross row; page mentions dropped 87 -> 73.
- RIVER-KEYS-FX applied: cochise:ballot-box-table and legacy:cochise:vote-center-pdf are OPEN since 3:34 PM EDT.
- Sean's item 3, checked on the live voting lookup (POST /api/voting-sites):
  - 85603: Cochise County, vote-center model, 18 vote centers live, 0 drop boxes yet.
  - 60090: 0 sites; Cook County, matched through Barrington Hills' page.
  - The Wheeling door (page:wheelingil.gov:14d010f03f2c, vs07-cook-wheeling-early, Chamber Park early voting) last failed at 8:28 AM EDT on "fetch failed" at robots.txt; Node fetch reaches it fine from here, so the failure looks transient.
  - Both wait on the next voting-sites run. Voting doors are read least-recently-checked first (scripts/fetch-voting-sites.mts votingSourceReadOrder), so Cochise's never-read drop-box door and Wheeling come early.
  - Blocker: since 12:22 PM EDT every source-launch pass defers voting-sites:AZ and voting-sites:IL with WORKER_MEMORY_DEADLINE ("Waiting for a worker slot"). Before noon they were skipped only as not due. River keeps checking; drop boxes and Wheeling, with counts by state, follow the first run that gets a slot.

### Meeting calendars failing per pass: cause found, fix READY (RV-MEET), 3:35 PM EDT
- What readers lose: about 200 public bodies a pass (Granicus, CivicPlus, PrimeGov calendars) never publish fresh meetings. Digest code MEETING_PARTITION_READ_FAILED / FINAL_ROUTE_NOT_REGISTERED.
- Cause, proven on real production doors (read-only replay): a meeting read records every successful fetch while the source is in scope as that read's sources (lib/sources/acquisition-trace.ts captureSourceAcquisitions). The release cache those three adapters use stores copies in Netlify Blobs on the runner, through the same global fetch (lib/control-plane/evidence/netlify-store.ts boundedFetch). So the first recorded "source" is the vault's own api.netlify.com manifest request, which source authority refuses (lib/civic-data/source-authority.ts authorityFor; lib/civic-data/promotion.ts:269). The digest redacted the URL, which hid this.
- It didn't start in release 95: the same boards failed before as RECEIPT_COUNT_INVALID "observed 0", 45 to 52 a pass in release 94. RN-02 gave the failure its own name, and release 95 ran about 4 times as many tasks a pass.
- Fix RV-MEET (stream/river-meet READY 6be91744f, River's helper): the vault's fetch runs outside the source scope (`outsideSourceAcquisition`, +6/-1 in 2 files). A read's sources are only what the publisher sent.
- Proof: 3 real boards fail on current river with the exact production error and publish with the fix: Peoria County IL zoning appeals (156 meetings), Barrington Hills IL plan commission (49), Adams County CO planning (6). Replay of the doors that failed in the 2:17 PM EDT pass, current river failing vs fix published, by state: AZ 12/12, CO 23/23, CT 11/11, IL 13/13, MO 2/2, NC 7/7, OH 4/4, PA 6/6, TX 53/48, VA 26/26, WA 12/12, WI 7/6; total 176/170. The 6 left fail on their own publishers (Blanco x3 and Brownsville TX return 404, Round Rock TX and Appleton WI return 0 meetings). New test fails without the fix, passes with it; 327 related tests and tsc pass.
- Next: gates as its own batch right after batch B (ahead of PT-01). After release, the next digest's MEETING_PARTITION_READ_FAILED count must drop.
- Open, not fixed here: the meeting byte-retaining fetch (lib/civic-data/retained-meeting-bytes.ts retainingFetch) still keeps vault responses against each read's 16 MB allowance.

### Release 100 live, 3:11 PM EDT
- /api/build 2d0b664ce (PR #810 merge commit). A broken reader connection now fails only its own read (503); the function keeps serving.
- Sean's checks on meanwhileusa.com in Chromium at 3:12 PM EDT, all pass: /ballot 85701 200 and 03255 200 (render, 0 console errors), Ask on the 85701 ballot 200 grounded answer, /api/meetings 85701 200 and 60602 200, /national 200.
- Release 101 (batch A: CL-01, RV-TOOLS, RIVER-KEYS-FX) is PR #811, auto-merge on.

### Live for readers, 3:05 PM EDT
- Live: release 99 (388d02c51). Reader checks passed at 2:00 PM EDT. Migration 0051 applied, and all 35 event ids resolve.
- Release 100 (RV-POOL, PR #810): admission, verify, both builds green; "test (affected)" running since 2:31 PM EDT; auto-merge on. Local gates: tests 9,775 pass. tsc, build and build:standalone ran out of memory at this container's default 2 GB Node heap; with the 4 GB heap netlify.toml and CI use, all pass. River's gates now run with NODE_OPTIONS=--max-old-space-size=4096.
- Batch A (release 101 when 100 merges): CL-01 88af51ae2 + RV-TOOLS 2645e12d5 + RIVER-KEYS-FX 33a304632 on river-next c09c1e606. Gates 9 of 9, 9,780 pass, 0 fail. Preview against the production database: /ballot 85701 and 03255 render, /national 200, /api/meetings 60602 200. The Raleigh 27601 ballot mentions Deborah K. Ross 73 times on the preview vs 87 live, consistent with CL-01 removing her duplicate card (Chrome check after release).
- Batch B gating from 3:07 PM EDT (c1b0199fa): DB-01 befe7b6f1 (reader migration DB-01_read_versions, expand), MT-01 0b0674d8d (restores held meetings' saved pins, Sunnyside), RB-A1 1d6df41d9 (docs only).
- SO-01 dropped from batch B and returned (returns/so-01.md): 5 files, 8 hunks conflict with CL-01's person-merge code. Exact merge written; River does it at 4:08 PM EDT if the lane hasn't.
- Found: MEETING_PARTITION_READ_FAILED, 195 to 339 meeting calendars failing per supervisor pass since 2 AM EDT (release 95, from RN-02's calendar changes), 0 before. Detail: FINAL_ROUTE_NOT_REGISTERED, "outside meetings-public-bodies's registered publication routes" (lib/civic-data/source-authority.ts:1095), on Granicus, CivicPlus and PrimeGov calendars. Those bodies' meeting calendars aren't refreshing. A River helper is root-causing it on stream/river-meet against real failing tasks (read-only), with counts by state before and after; it ships as its own batch.
- RB-A4 READY ef7987b1e: its boundary_year collision is gone (its migration now only adds placement_basis; boundary_year comes from 0051). It merged RB-A3's un-READY work, so it folds after RB-A3 posts READY. Queue after B: C PT-01 660cb878f; D RB-A2 9900bc396 + RB-A5 f7ab065e3 + RB-A8 (latest READY); SO-01 when re-READY; RV-MEET when proven.

### Live for readers, 2:00 PM EDT: release 99 live, migration 0051 applied
- Release 99 (PR #809, RV-0051 only) live 1:59 PM EDT: /api/build 388d02c51.
- Sean's checks on meanwhileusa.com in Chromium at 2:00 PM EDT, all pass:
  - /ballot?zip=85701: 200, renders, 0 console errors.
  - /ballot?zip=03255: 200, renders, 0 console errors.
  - Ask on the 85701 ballot: /api/ask/grounded 200, grounded answer with sources.
  - /api/meetings?zip=85701: 200.
  - /api/meetings?zip=60602: 200.
  - /national: 200, renders.
- 0051 (RB-A1) is in the production reader database (read-only check at 2:01 PM EDT): reader_resolve_id, zip_place and place_page exist; entity_place has boundary_year with key (entity_id, place_id, boundary_year); journal 52 of 52. All 35 ids that reactions, Speak your mind and demand signals point at resolve through reader_resolve_id (35 of 35). Reacting to a renamed candidate works again on release 97's code.
- Release 100 (RV-POOL, reader pool error handler alone) gating on river-next c125bfa59. The tsc gate fails fast inside direct `pnpm gates` runs (stale .next route types; `river.mjs test` clears .next); tsc alone on c125bfa59 passes. Batches from here are gated through `river.mjs test`.
- New READYs: PT-01 660cb878f, RB-A5 f7ab065e3, RB-A8 df6af132c; earlier SO-01 64ea93bb5, DB-01 befe7b6f1, CL-01 88af51ae2. Queue (one batch gating at a time, each its own release): 100 RV-POOL; A CL-01 + RV-TOOLS + RIVER-KEYS-FX (pre-folded on 100; CL-01's duplicate jit edit resolved to River's live version); B SO-01 + DB-01; C PT-01; D RB-A5 + RB-A8. RB-A4 isn't READY (its lane is finishing it); now that 0051 is live, it can fold once its migration agrees with 0051's boundary_year (NOT NULL DEFAULT 0).

### Release 98 live, 1:07 PM EDT: readers have the site back on release 97's features
- /api/build shows 5a09ea42d (PR #808 merge commit) from 1:07 PM EDT.
- Sean's checks on meanwhileusa.com in Chromium at 1:08 PM EDT, all pass:
  - /ballot?zip=85701: 200, renders, no console errors.
  - /ballot?zip=03255: 200, renders, no console errors.
  - Ask on the 85701 ballot ("Who represents me in Congress?"): /api/ask/grounded 200, grounded answer (Kelly, Gallego, Grijalva AZ-7, with sources).
  - /api/meetings?zip=85701: 200 (409 id fields).
  - /api/meetings?zip=60602: 200 (556 id fields).
  - /national: 200, renders.
- The 14 ZIPs that failed on release 97, re-walked at 1:09 PM EDT: all 200, render, 0 console errors: AZ 85003 and 85653, NJ 07102, NH 03301, PA 19147, WA 98101, DC 20001, DE 19901, FL 32301, CA 90012, TX 78701, IL 60602, GA 30303, NY 10007. /api/reader/state?state=AZ 200.
- Readers now have release 97's lane work: RN-03, RB-A1 code, BL-21-FX, RN-01, BL-01, LV-01, RIVER-KEYS, MT-01, SRC-01, CL-01 (first READY), PB-02, MD-01. Outage total: 11:48 AM to 12:24 PM EDT.
- Still missing: 0051 isn't in production. Until release 99 ships and the runner applies it, a reaction on a renamed candidate (reader_resolve_id) fails. Next: release 99 (0051 budget) after its gates; then release 100 (pool error handler).

### Live for readers, 1:00 PM EDT
- Live: release 96's deploy (/api/build 38b470355). Readers have /ballot (dates, offices), /national, place answers, meetings (checked 12:30 PM EDT). Reactions, Speak your mind and Ask work on release 96's code; release 96 doesn't call reader_resolve_id.
- Release 98 (PR #808, the jit line alone): admission, verify, both builds green; "test (affected)" running since 12:30 PM EDT; auto-merge on. River runs Sean's checks on meanwhileusa.com within 5 minutes of /api/build showing its merge commit.
- 0051 (RB-A1) can't apply as shipped. The runtime contract stops every statement at 1 s (scripts/apply-migrations.mts RUNTIME_CONTRACT_SQL_SETTINGS). 0051 rebuilds the entity_place key (183,755 rows), re-checks entity kinds (271,422 rows) and indexes entity_external_id (593,062 rows). Timed on a local Postgres 16 copy of the schema at production row counts: 1.7 s (index 1.29 s, key 0.36 s). That is why it failed at 12:02 PM EDT. Production still has no reader_resolve_id, zip_place or place_page. The file is established and can't be rewritten. Fix RV-0051 (178151d61): a contract can declare its own statement budget in lib/db/migration-phases.ts; 0051 gets 10 s, and the 250 ms lock wait stays. Readers' reads of entity and entity_place wait about 2 s once while it runs. 26 migration tests pass. Full gates running from 12:56 PM EDT. It ships alone as release 99 after 98 is live, then the runner applies 0051 after deploy.
- Reader pool error handler RV-POOL (207b50f5e, Sean's item 2): the pool and each connection now have error listeners. A refused or dropped connection fails its own read (route answers 503) instead of crashing the function; the next read reconnects. New test fails without it, passes with it. Ships alone as release 100 after 99.
- RB-A4: dropped per Sean (its lane is finishing it). River won't touch stream/rb-a4; it folds when RB-A4 posts READY, after 0051 is live. Its boundary_year column must agree with 0051's (NOT NULL DEFAULT 0).
- SO-01 (last push 6 h ago) and DB-01 (8 h ago): no new READY yet. Sean told them to post READY; River folds each in a small batch and runs live checks after release.
- Next small batch after 100: CL-01 6c3578d48 (Raleigh's duplicate Deborah K. Ross card), RV-TOOLS 2645e12d5, RIVER-KEYS-FX 33a304632 (reopens Cochise's 2 held doors, cochise:ballot-box-table and legacy:cochise:vote-center-pdf). Then check Cochise's 5 drop boxes (85603) and Wheeling 60090 on the live site, with counts by state.

### Live for readers, 12:45 PM EDT (Sean's orders 12:40 PM EDT)
- Live: release 96's deploy (/api/build 38b470355). Sean rolled back at 12:09 PM EDT. Readers have /ballot (dates, offices), /national, place answers, meetings.
- Not live: release 97 (main 96b6ea5e7): every reader DB read failed on the pooled endpoint (`jit` startup option, lib/reader/database.ts:65, from SRC-01).
- Sean's orders, in order: (1) ship the jit fix alone with the preview check; (2) apply reader migration 0051 (RB-A1) in production; (3) small batches, a lane that fails gates is dropped and sent back, never fixed inside the batch, never added to a gating batch; (4) River takes over DB-01, RB-A4, SO-01 (silent 4 to 7 h); (5) status.md hourly with what is live for readers.

### Rolled back to release 96's deploy, 12:24 PM EDT
- /api/build shows 38b470355 (release 96), deploy 6adc8886fc9fba3129579ae8, from 12:24 PM EDT: the previous good deploy was published (not by River; River's Netlify connector needs re-authorizing). Readers lost the ballot, /national and place APIs for 36 minutes (11:48 to 12:24 PM EDT).
- Checked 12:30 PM EDT on the live site: /ballot 85701 and 03255 200 (Chromium: 6 and 3 dated deadlines, AZ and NH office lines, no console errors), 85003 6 deadlines; /api/meetings 85701 200 and 60602 200; /national 200.
- Release 98 (release 97 + the one-line reader-pool fix) stays on auto-merge (#808). When it is live River runs Sean's checklist within 5 minutes.

### INCIDENT: release 97 broke every reader database read, 11:48 AM EDT; release 98 hotfix
- Release 97 live 11:48 AM EDT (/api/build 96b6ea5e7). Reader walk in Chromium at ~11:50: every /ballot page "didn't load" (React #441 server-render error, "[ballot] render failed", 0 deadlines, 0 offices) in 14 ZIPs: AZ 85003 and 85653, NJ 07102, NH 03301, PA 19147, WA 98101, DC 20001, DE 19901, FL 32301, CA 90012, TX 78701, IL 60602, GA 30303, NY 10007. Also /national 500, /api/reader/state 503, /api/meetings 502. The home map page loaded.
- Cause, exact line: lib/reader/database.ts:65, `options: "-c default_transaction_read_only=on -c jit=off"`, added by SRC-01 (River-finished lane; River's miss). Neon's pooled endpoint (production's reader connection) refuses `jit` at connect: "unsupported startup parameter in options: jit". Proven on the production pooled URL, read-only: with the option FAIL with that error; without it, 104,048 places read. Gates and River's local builds passed because they connect without the pooler.
- What readers lost: the ballot (dates, deadlines, offices, contests, candidates), /national, place answers and meetings, from 11:48 AM EDT until release 98 is live.
- Fix: release 98 = PR #808, one line (startup option removed; SRC-01's EPA reader already sets jit per transaction). Sean's new preview check, run on a local Netlify-like standalone build of release 98 against the production pooled database (the repo has no Netlify PR previews): /ballot 85701 200 renders, 03255 200 renders, /api/meetings 60602 200, /national 200; /api/meetings 85701 503 locally only (data/states/az/geo is excluded from the Netlify bundle and production reads it from the asset store; same code as release 96). Ask not run locally (model spend). Auto-merge on 12:25 PM EDT; the live checks run within 5 minutes of release 98.
- Rollback: Sean's new step says to publish the previous good deploy in Netlify when the live check fails. River's Netlify connector needs re-authorizing (claude.ai connector settings), so River could not publish release 96's deploy; the fix-forward is release 98. FOR SEAN: re-authorize the Netlify connector so River can roll back next time.
- Release steps now include Sean's preview check (board/river README.md, "Release steps").
- RIVER-KEYS migration (control plane) applied at 11:46 AM EDT but reports "0 held door(s) reopened": Cochise's door was not reopened by it. River checks the door's status.
- RB-A1's reader migration 0051 is declared contract-phase; the runner applies it after deploy; not applied yet at 12:00 PM EDT.

### Release 97 open, 11:25 AM EDT
- Gates 9 of 9 on 166fa32ab (9,770 pass, 0 fail). river promoted to 166fa32ab, main's release-96 merge commit merged (tree identical) -> river 59b7c5577. Release 97 = PR #807, auto-merge on. 14 lane READYs recorded in integration.md: RV-TOOLS, RN-03 (x2), RB-A1, BL-21-FX, RN-01, BL-01, LV-01, RIVER-KEYS, MT-01, SRC-01, CL-01, PB-02, MD-01.
- Live checks after deploy: Job 2 (79901, 60090, 85603 polling places; counts by state; KY/FL/MT no drop) after the next polling-place run on release 97; BL-21-FX (/ballot dates and offices kept; DC, DE, FL own records); BL-01 retention cards; MT-01 meeting pins; LV-01 voting panel; CL-01 one card per person; MD-01 Ask in Chrome (20 questions); PB-02 live hour; SRC-01 EPA/FEMA first run; RN-01 planning rounds.
- Next batch gating from 11:30 AM EDT: CL-01 6c3578d48 (merges a federal member listed under a bare and an explicit chamber title: the Raleigh "Deborah K. Ross twice" card) + RV-TOOLS 2645e12d5 (River's parser refused CL-01 on the plural "connection proofs"; fixed; the auto-return is superseded). 199 focused tests pass.

### Batch 5 re-gate, 10:39 AM EDT
- Batch 5 gates: 9,767 pass, 3 fail. River fixed all three on river-next (166fa32ab): SRC-01 (River-finished) stores legiscan bills as compact parts the reader hydrates, and its browser test still served the compact part as bills (no bill showed) and compared a URL pathname the path rule flags; the test now hydrates as /api/bills does. CL-01 read settled.answer.kind on a held funding answer with no records, which threw and showed readers a "campaign money records" gap; held empty answers render nothing again (tests/pdc-reader-remaining-repairs.test.ts:55). Re-gating from 10:39 AM EDT.

### Batch 5 (release 97 candidate), 9:52 AM EDT
- Batch 4 gates: tests 9,699 pass, 0 fail. The build was cut off when GitHub returned 502 to the lock heartbeat, so River ran it directly: it really fails. build-output REFUSED, 21 tests/ files traced into the admin bundles. Bisected by building each fold: RIVER-KEYS. lib/doors/source-capture.ts (admin routes) now calls savedVotingCopy, whose PDF path loaded the runner's OCR extraction (computed-path reads), against that module's own rule that runner-only extraction stays out of deployed routes. River fix 497dfb06f: a PDF door copy is blanked from its text layer. Build passes, tests/ traced 0.
- Batch 5 on river-next, gating from 9:52 AM EDT (lock heartbeat now a separate loop that tolerates GitHub errors): RV-TOOLS, RN-03 (13f6eb19f), RB-A1, BL-21-FX, RN-01, BL-01, LV-01, RIVER-KEYS + fix, MT-01, SRC-01 (421534831), CL-01 (16159c59d), PB-02 (2bfa981e1), MD-01 (f16a1d8a2). Pre-gate: tsc, dead-code clean; 337 focused tests incl. every file that failed this morning pass; build passes with tests/ traced 0.
- CL-01 16159c59d fixed both returned failures itself (204 tests on its tip). Folded with BL-01: initials keep the filing's form, all-capitals given names are cased; both lanes' name tests kept; 359 tests pass. Return cleared.
- MD-01 f16a1d8a2 fixed its 3 tests. Its READY states the Admin "Ask reader model" and per-role starting-model overrides are removed on purpose (its prompt: every AI step starts on Haiku 5.5). FOR SEAN: Admin loses those model controls in release 97; say if you want them kept.
- PB-02 (River's helper, READY 2bfa981e1): the two tests checked the old hand-off point (PB-02 hands comment and walk pages at intake; reader-facing assertions unchanged). PB-02 had deleted board naming on purpose; restored (readers lose names without it: 86 of 101 production bodies re-named in replay). A replay on today's data caught 9 wrong publishes (a school social worker, 6 page labels, 2 misreads), fixed. 179 publish from the seven-day cohort (AZ 90, AL 34, AR 10, GA 9, ...). FOR SEAN: Rebecca Romo (Casa Grande AZ) publishes from a chamber of commerce page; the checks allow third-party pages.
- SRC-01 (River's helper, READY 421534831): EPA never published (archive pointer keyed by its own content hash; release 90's workaround re-stored the 445 MB file every run); OpenFEMA served the first states in list order until time ran out (7 of 56 published). Fixed; on live publisher data EPA 3,229,294 facilities and FEMA 70,487 disasters reach readers in all 56 jurisdictions, first and next run. Risk: the EPA proof took 1,856 s on this shared host vs production's 1,800 s cap; first post-ship run will show.
- Raleigh 27601 (MT-01's note) on release 96: no crash in a reader walk; "Who governs here?" shows Deborah K. Ross twice under NC-2 (one card with portrait, one without). CL-01's area; recheck after release 97.

### Batch 4 (release 97 candidate), 8:38 AM EDT
- Batch 3 gates (river-next c4ced5044): 9,687 pass, 10 fail. Traced each:
  - RN-03 (its own tip): tests/routine-due-request.test.ts:183 matched the runner's skip line without RN-03's new `!inputDue`. River updated the pattern (16e6fd544).
  - MD-01 (its own tip, 3): tests/playbook-workflow.test.ts:98 (Admin setting ask.readerModel deleted, Settings action/undo test left), :75 (published Admin model no longer reaches Ask), tests/field-manual-pages.test.ts:104 (field-manual text). Reverted from the batch; returned 8:39 AM EDT (returns/md-01.md).
  - CL-01 (its own tip, 2): tests/incumbency-eligibility.test.ts:390 (incumbency map loses the seat count) and the Hourihan Ask card (ballot-az-pima:governor:hourihan-teri-ann leaves the card corpus). Taken out of the batch; returned 8:39 AM EDT. Combined with BL-01 it also cased initials ("S.K.", "BJ", "JR.") and crashed on a nameless candidacy; River's fixes ride its next fold.
  - PB-02 (its own tree, 2): tests/comment-summary.test.ts:51 (comment-rule pages no longer handed to the comment writer) and tests/hunters-own-calendar.test.ts:42; its merged tree also drops river's board-naming pass (nameBoardsFromTheirPages). River's own READY 31f0cb8b3 ran only PB-02's files and missed these: River's miss. Reverted from the batch; a River helper is fixing PB-02 now.
- Batch 4 on river-next 74389649f, gating from 8:38 AM EDT: RV-TOOLS, RN-03, RB-A1, BL-21-FX, RN-01, BL-01, LV-01, RIVER-KEYS (READY 3e2dcfb7e), MT-01 (READY d1bd02b89). Focused: 585 + 422 tests pass; tsc and dead-code clean.
- RIVER-KEYS (Job 2, finished by River's helper): every fetched official page and door capture is cleaned before it is classified or saved (existing cleaner, html/text/json/xml/csv); xlsx/zip/pdf keep their bytes and only a key-holding one is saved as blanked extracted text; the change fingerprint uses cleaned bytes; the hold path is deleted; a control-plane migration (RIVER-KEYS_expand) reopens exactly the doors the hold suspended (cochise:ballot-box-table included). On the real saved pages through the full scheduled job: El Paso 39 early + 123 Election Day, Cochise 5 drop boxes, Wheeling 1 (Wheeling's saved capture holds no key; its key path is proven on El Paso and Cochise). KY xlsx 1,690, MT xlsx 335, FL zip 463 combined: identical before/after.
- MT-01 (READY d1bd02b89): meeting places from published addresses; 50-state production cohort keeps all 1,733 pins and adds 282 (CA 31->104, HI 0->23, AK 1->14, CT 6->24, ...). Its READY notes a Raleigh (27601) crash reproduced on release 96: River checks it live.

### WIN, Job 1 (RV-REPAIR) DONE, 7:33 AM EDT
- Second routine pass on 38b470355 (started 7:11, written 7:33 AM EDT): 0 Reader repair mechanism failures, 32 Reader PASS, 122 supervisor failures. Both reader-repair passes on release 96 are under 60 (0 and 0). Publish-now passes at 7:13 and 7:22 run no reader repair (0 Reader PASS) and are not counted.

### Job 1 first pass, 7:10 AM EDT
- First routine pass on release 96's code (38b470355, started 6:45, written 7:10 AM EDT): "4142 Reader PASS receipt(s) recorded; 1 Reader failure receipt(s); 0 Reader repair mechanism failure(s)". Supervisor failures 207 (release 95 passes: 1,476 to 1,746, with 1,308 to 1,311 repair failures and 0 to 91 Reader PASS). Meeting outcomes for all 3,831 Legistar boards are re-checked again instead of refused. Second qualifying pass due ~7:35 AM EDT.
- CL-01 posted a new READY d4f23a337 at 7:02 AM EDT fixing the return (Morristown 22 contests back; 54 of 54 ballot tests on its tip). Folded into batch 3 at 7:20 AM EDT; River resolved clashes with BL-01, BL-21-FX and RB-A1 and kept initials ("S.K.", a quoted "BJ") as the official filing prints them (BL-01's given-name casing had turned them into words). 296 ballot tests pass. Gates restarted 7:20 AM EDT.

### Batch 3, 7:08 AM EDT
- Batch 2 failed gates (9,626 pass, 18 fail): all in the ballot suites, caused by CL-01 alone (7 files pass 50 of 50 just before CL-01, fail 11 on CL-01's own tip). Readers would lose: 07960 Morristown 22 contests -> 19; Arizona's verified Hobbs / Giles filing; races in Minneapolis 55415, Madison 53703 Wards 51 and 52, CNMI's 13 specimen fronts, both Virgin Islands districts, a Texas write-in-only court; BA-01 publication HELD. Returned to CL-01 at 6:55 AM EDT with the exact lines (returns/cl-01.md). If no new READY by 7:55 AM EDT, River fixes it on stream/cl-01.
- Batch 3 folded on river 38b470355... (river bd77dcb0f + release 96 merge): RV-TOOLS, RN-03 (newer READY 3ed53813c), MD-01 (f04653376, adds the metering follow-up), RB-A1 (5bde46615), BL-21-FX (13918a9c8; River resolved its clash with RN-03's input stamps in the runner script), PB-02 (31f0cb8b3), RN-01 (re-resolved onto RN-03 as before), BL-01 (9f38dcfde; River resolved 4 clashes, each keeping both lanes' cases), LV-01 (River wrote READY 0b1aafa1e on stream/lv-01 from its own evidence after river's parser refused "Connections"; River resolved its clash with BL-21-FX, keeping LV-01's held voting read and office contacts and BL-21-FX's removal of the national navigation state). RB-A1's migration numbered 0051. Dead code left by the batch deleted (civicGovernmentScope). Focused suites on the merges: 120 runner/clock, 136 BL-01/ballot, 161 voting/ballot pass; tsc clean; knip clean.
- BL-01 (finished by River's helper, READY 9f38dcfde): the 10 failures fixed at the root, none expectation-changed. On production pages, 56 of 56 jurisdictions render, 0 contests lost, ballot cards 1,001 -> 1,091 (90 judge-retention cards: CA +13, UT +14, KS +12, OK +9, ID +8, CO +7, FL +6, NM +6, IN +3, IA +3, WY +3, NE +2, AK, MD, MO, MP +1); /api/reader/state identical in all 56 (326 seats, 396 representatives, 491 ZIP people). Next run publishes the 2026 Census plans (cd:120, sldu/sldl:2026).
- Sent back: LV-01's auto-return (written by River's parser on wording) is superseded by the River-written READY.

### Release 96 live, 6:32 AM EDT
- /api/build 38b4703557c7 (merge of #806) from 6:32 AM EDT. Reader walk in Chromium at 6:35 AM EDT, no console errors: /ballot 85003 Phoenix 6 dated deadlines (DOM elements, data-dated-event), 07102 Newark 8, 03301 Concord 3, 85653 Marana 6 plus Pima County Recorder 520-724-4330; 19147 PA office line 717/787-5280; 98101 WA 800/448-4881 · 360/902-4180. (Earlier River notes counted 12/16/6: each deadline appears twice in the streamed HTML; the DOM has 6/8/3.)
- Job 1 baseline continues on release 95's runner code: reader-repair passes at 5:05, 5:30, 5:55 and 6:19 AM EDT each report 1,310 to 1,311 READER_READBACK_REPAIR_FAILED. Done when the first 2 repair passes on 38b470355 are under 60.
- Batch 2: CL-01 left cardForNominee, linksForNominee and an exported BallotCandidateTicket behind; the dead-code gate refused the combination; River deleted them (3d013c360) and re-gated.
- RN-01 (finished by River's helper, READY a5601eec9): 47 of 78 state planners on release 95 died on a file race (ENOENT on /var/lib/meanwhile/meanwhile-worker-memory.json.lock, introduced in release 95); the system planner's work read took 262 s and timed out (now 4.7 s); voting-sites read "not due" because the 00:11 UTC Oct 24 pointer move counted as a read (0 of 56 due before, 52 after); overdue meetings launched before all cadence work. RN-03 landed first and covers the clock and next-due parts the same way, so River folded RN-01 onto it keeping one of each (ba5669a5a; 119 focused tests pass).
- BL-21-FX (finished by River's helper, READY 13918a9c8): per state, the page uses the state's own navigation record once published, and until then shows exactly release 94's dates, office line and local offices. Production render harness, one ZIP per state + Marana: 49 of 52 identical to release 94 in every field; DC, DE, FL (the only states with their own record today) gain Election Day and 6, 4, 3 dated deadlines and keep their office line. Open question for Sean: the hunt's held-place capture still reads only each state's own record (feeds hunts/Admin, not readers).
- PB-02 (River wrote its READY 31f0cb8b3 from the lane's own evidence in docs/pb-02.md, after merging river; 71 tests pass): 144 of 477 seven-day refusals publish; the cohort and intake cover 20 states.
- LV-01's second READY (f786ce81f) carried both proofs and every state; it was never refolded. Folding next.
- Still being finished by helpers: RIVER-KEYS, BL-01 (10 failing tests). Waiting on BL-01: CS-01 (READY wording only). Then SRC-01.

### Folds, 5:50 AM EDT
- RV-REPAIR: gates 9 of 9 on 39c3037f4 (9,631 pass, 0 fail); main's release-95 merge commit merged in (tree identical, b5af0a2ad); river bd77dcb0f; release 96 = PR #806, auto-merge on.
- Batch 2 on river-next (Sean's order; RIVER-KEYS and MT-01 not posted yet): RV-TOOLS (River reads RB-A1-style step ids and "next-run proof"), RN-03, CL-01, MD-01, RB-A1. Job 4 review: all four lane READYs carry two production proofs, counts for every state and a next-run proof; CL-01 keeps all 18 candidate targets behind 30 reactions/demand records as aliases; RB-A1 keeps all 36 reader ids (56 reactions, 1 Ask, 3 demand). RB-A1 clashed with CL-01 in lib/ballot/candidate-targets.ts (imports only); River kept both sides; 50 focused tests pass. RB-A1's migration numbered 0051 (additive). MD-01's 20-question Chrome Ask check is owed after deploy.
- Sent-back lanes being finished by River (standing order): RN-01 (planning rounds: 3 of 57 states at the last round, 10:26 PM EDT; none since) on stream/rn-01-fx; BL-21-FX (keep old dates and offices until each state's own record is published) on stream/ballot-parity-fx. Next: LV-01, BL-01, CS-01, PB-02, SRC-01, CAL-01.

### RIVER-KEYS (Job 2) baseline, 5:15 AM EDT (release 95)
- Reader walk in Chromium (/ballot, "Where can I vote?", ZIP typed, "Show me"): 79901 El Paso, 60090 Wheeling and 85603 Bisbee (Cochise) show "We're working on getting this info." and 0 sites. 40202 Louisville 226, 85701 Tucson 345. Capital ZIPs with sites: KY 226, SC 135 (29201), MA 164 (02108), ND 19, HI 18, MD 10, DE 4; 0 at the capital ZIP in the other 44 states and DC (incl. FL 32301, MT 59601). No console errors.
- Polling places published in the reader DB (VOTING_SITE, decoded): 5,279 in 15 states. SC 1,956, KY 1,690, AZ 345, DE 297, ND 209, MA 164, NJ 156, GA 132, MD 102, AL 78, IA 64, HI 60, IL 24, FL 1, NH 1; 0 in the other 36 states and DC (MT 0). After RIVER-KEYS's first polling-place run, none of these may drop, and TX (El Paso), IL (Wheeling) and AZ (Cochise) must rise.

## Waiting on Sean (from FX-01's returns/sean.md on stream/fx-01-fx, Oct 23 ~12:10 PM EDT)

Items 1 (Vice President) and 2 (planning round) are answered above and shipped or folding. New:
3. Official voting pages that carry key-like tokens: the evidence store classes such captures as restricted, there is no encrypted storage for them, so the page is held and its sites do not publish. Readers miss: Wheeling IL (60090 shows 0 voting sites), the Cochise County AZ voter page, El Paso County TX's 39 early-voting and 123 Election Day sites. Choose: (a) turn on encrypted evidence storage for restricted captures (needs a key and storage setting only Sean can give); (b) approve publishing from a cleaned copy (token-like strings removed before saving, sites verified against that copy); (c) keep holding.

## Open data issue (from RN-02, Oct 23)

NJ fresh entity import fails with PostgreSQL 21000 on a duplicate division id: ocd-division/country:us/state:nj/school_district:union_township_school_district, elementary-school GEOID 3416440 vs unified-school GEOID 3416500, both named "Union Township School District". Registration file identical on release 88 and release 90. Owner: the registration identity lane (to disambiguate the two districts). Not an observed live runner failure yet.

## Release 95 live check (RN-02), 11:50 PM EDT: FAILED, returned
- Supervisor passes on 16eead35c: 1300 (03:05 UTC) and 1316 (03:30 UTC) failures, READER_READBACK_REPAIR_FAILED=1250 ("PERMANENT_RUNTIME_AUTHORITY_REFUSED: candidate does not identify exactly one registered production contract", meetings-outcomes readbacks), READER_REPAIR_CHILD_EXIT_NONZERO=65 (store.appendEvidence failed). Release 94 passes had 11 to 56. RN-02 returned (returns/rn-02.md).
- 1:10 AM EDT Oct 24: steady, not worsening. Every reader-repair pass on 16eead35c fails the same way: 928 (879 repair) at 03:56 UTC, 1340 (1273) at 04:22, 1329 (1263) at 04:48; the routine cycles between them complete. Still waiting on an RN-02 READY (returns/rn-02.md) or Sean on "revert 95".
- Meetings by ZIP unchanged from the 10:25 PM baseline (Tucson 241/93 upcoming, Concord 9, 0 in the other 16); San Diego 92101 and Galveston 77550 still 0 (RN-02's named meetings not live). Boards rose: IL 60602 0 to 109, MN 55401 0 to 15, WI 53703 253 to 419, AZ 85701 136 to 139.
- Release 92 data still not delivered (Tucson 345, 0 sites in 10 states, Portland 0 Metro boards). The scheduler reports overdue voting-sites and registration tasks as "not due" (voting-sites:AZ last attempted 00:11 UTC, 1-hour retry, "not due" at 03:35 UTC; registration-or last attempted Oct 10); added to returns/rn-01.md.
- /ballot dates kept (85003 12 deadlines).
- Not reverted: no reader-visible loss in the sample; the failures are runner work that was already failing at a lower rate. Rulings §160 would revert failing new code; that call is Sean's (a revert of a shipped release needs his word, as for release 93).

## Release 95 live check (RN-02), first reading Oct 23, 10:20 to 10:30 PM EDT
- /ballot kept the restored dates: 85003 "The next election: November 3rd, 2026", 12 deadlines.
- RN-02's named meetings are not on the live site yet: /api/meetings?zip=92101 (San Diego) has 0 meetings and no legistar:sdcounty:2042; 77550 (Galveston) 0 meetings. RN-02 proved them on an isolated production copy; the runner has to publish them (on 16eead35c from 02:18 UTC).
- Baseline meetings by ZIP (meetings / upcoming / boards): AZ 85701 241/93/136, 85003 0/0/4; CA 92101 0/0/10, 94102 0/0/0; CO 80202 0/0/1; FL 33130 0/0/5; GA 30303 0; IL 60602 0; MN 55401 0; NH 03301 9/0/7; NJ 07102 0/0/3; NY 10007 0; OR 97204 0; TX 77550 0/0/10, 78701 0; WA 98101 0; WI 53202 0/0/342, 53703 0/0/253.
- Recheck after the runner's first passes (~11:50 PM EDT): launches for voting-sites, registration, legistar-members and ballot-navigation; supervisor and reader-repair failures; meetings by ZIP against this baseline.

## RN-02 live check, owed once release 95 is live (plus real places in 10+ states, counts by state)
- Runner: voting-sites, registration, legistar-members (oregonmetro) and ballot-navigation tasks launch instead of deferring "Reader repair waits for the next pass" / "Waiting for a worker slot"; ROUTINE CIVIC DATA SUPERVISOR FAILED counts drop; reader-repair failures (READER_READBACK_REPAIR_FAILED) gone.
- Readers: the Next meeting card and /api/meetings exact meeting IDs RN-02 named (San Diego County Oct 27 9 AM PDT legistar:sdcounty:2042; Galveston Oct 26 9:30 AM CDT); then release 92's owed data (Tucson 153 sites, CA/NC/NY/PA/TX sites, Portland 13 Metro boards).

## Release 94 live check (Oct 23, 9:11 to 9:20 PM EDT): PASS, the revert restored what release 92 showed

Release 94 = revert of BL-21-FX (Sean approved), live at 9:11 PM EDT (/api/build b518e4d8d). Code is release 92's byte for byte, so each page is back to release 92's.
- 85003 Phoenix: "The next election: November 3rd, 2026", 12 dated deadlines (voter registration deadline October 5th, early voting begins October 7th, ...), Arizona election office line (Elections Division, Office of the Secretary of State, Phoenix). No "Your election offices" card: the national record holds no Maricopa office (it did not on release 92 either).
- 19147 Philadelphia and 98101 Seattle: state election office line back (PA Bureau of Commissions, Elections and Legislation, 717/787-5280; WA Elections Division, 800/448-4881 · 360/902-4180). No next-election date or deadlines: the built-in dates table that release 92 used covers only AZ, NH and NJ, so these pages never had them. That is the real gap for PA, WA and 45 more states: each state's own dated record (BL-21-FX's per-state navigation) once it keeps the old content until it publishes.
- On release 93 those same pages had no state election-office line at all (only the campaign-finance office) and "Still gathering"; both are gone now.
- 85653 Marana: dates (12 deadlines) and "Your election offices": Pima County Recorder's Office 520-724-4330, Town Clerk (520) 382-1961.
- National sample, 18 ZIPs in 16 states and DC-less sample: next-election card in AZ (85003, 85653, 85701, 12 deadlines each), NH 03301 (6), NJ 07102 (16); state election-office line in all 16 states (AZ, CA, CO, FL, GA, MI, MN, NC, NH, NJ, NY, OH, PA, TX, WA, WI); "Still gathering" on none.
- BL-21-FX stays returned (Sean): it folds only when readers keep the old dates and offices until each state's own record is published.

## Release 93 live check (Oct 23, from 3:39 PM EDT): FAILED, readers lost election dates

- Release 93 (BL-21-FX) live at 3:39 PM EDT (/api/build 3fc035eeb). BL-21-FX deleted the built-in election-dates table and the national navigation read; /ballot now reads only each state's own navigation record, and the runner has not published any yet (its navigation tasks wait for a worker slot; runner starved, returns/rn-01.md).
- What readers lost: /ballot?zip=85003 (Phoenix) showed "The next election: November 3rd, 2026" with 12 dated deadlines on release 90; on release 93 it shows no Election Day line, 0 deadlines, and "AZ voting information · Still gathering: election office, voter registration, ...". The same empty card in 16 ZIPs in 15 states and DC (AZ 85653 and 85701, CA 90012, TX 78701, FL 33130, NY 10007, PA 19147, NC 28203, GA 30303, OH 43215, MI 48226, WA 98101, CO 80202, WI 53703, MN 55401, NH 03301, DC 20001). Marana 85653 shows none of the three promised office phone lines.
- Returned to ballot-parity (returns/ballot-parity.md): keep what readers had until the state's own record exists.
- 4:20 PM EDT recheck: unchanged. 85003 shows only "Still gathering"; the same empty card in all 17 ZIPs. The runner on 3fc035eeb has every per-state navigation task (ballot-navigation-al, -az, -ca, -co, -ct, -dc, -de, ...) at DEFER "Waiting for a worker slot", and the reader database holds no navigation candidate since 19:37 UTC. The revert is still the fastest way back.
- Sean approved the revert (Oct 23, 8:50 PM EDT): "Revert 93 now ... BL-21-FX stays returned until readers keep the old dates and offices until each state's own record is published." River reverted the BL-21-FX fold on river (60ac4852e; tree identical to release 92's tested tree) and shipped it alone as release 94 (PR #804), faster than waiting on RN-02's gates. RN-02 refolded on the revert as release 95.
- Sean's check after release 94 is live: /ballot for 85003, 19147 and 98101 shows the next election date, deadlines and election offices again. Before (release 93, 9:00 PM EDT): all three no next-election date, 0 dated deadlines, no election-office card, "Still gathering".
- (answered) rulings §160 says "If new code fails, the release is reverted." River tried to revert BL-21-FX on river (git revert -m 1 5ddf41bb8, giving release 92's tree byte for byte, already gated and live this afternoon) and ship it as release 94; the session's permission check refused the revert as a change to a shared branch. One word from Sean, "revert 93", and River ships the revert (CI about 20 minutes, then deploy). Until then every /ballot page has no election dates, 11 days before the election, unless the runner publishes the 51 state navigation records first.

## Release 92 live checks (Oct 23, from 1:46 PM EDT)

Release 92 (VS-07-FX + PB-03-FX) is live: /api/build 5f0e9de16 at 1:46 PM EDT. The runner ran its migrations on 5f0e9de16 at 17:44 UTC. Both lanes put their reader change in data the runner publishes, so the first reading is the code alone; recheck after the runner's next routine passes (scheduled ~2:55 PM EDT).
- PB-03-FX, at once: PASS. 97204 and 97232 /api/meetings?include=state list ocd-division/country:us/state:or/special_district:metro among their governing places; 97301 does not. 36602's Board of Commissioners reads under "Mobile Housing Authority" (City Council stays under "Mobile city").
- PB-03-FX, after registration:or + legistar-members:oregonmetro run: not yet. 97204 and 97232 show 0 boards (owed: 13 under Metro, Council meeting 7 members). Boards by ZIP at 1:47 PM EDT: AK 99559 1 (1 with members), AL 35801 1 (1), AL 36602 2 (0), AZ 85641 76 (7), AZ 85701 136 (9), CO 80202 1 (0), WI 53202 342 (138); 0 in CA 94102, GA 30303, MN 55401, NV 89506, NY 12207, OR 97204/97232/97301, TX 78701, WA 98101.
- VS-07-FX: not yet published. Sites the reader returns at 1:47 PM EDT against the lane's replay: AZ 85701 345 (owed 153: the official replacement retires 212 old Pima rows), KY 40202 226, SC 29201 135 (= 135); 0 everywhere the lane publishes new: CA 90012 (owed 1,054) and 92101 (362), FL 33441 (310) and 33130 (56), GA 30303 (33) and 30044 (13), NC 28203 (215) and 27601 (231), NY 10301 (82) and 11201 (409), OH 44113 (268) and 43215 (1), PA 19147 and 19104 (683 each), TX 78207 (304), 77002 (617), 75201 (70); IL 60090 0 (lane expects 0, Wheeling held, Sean's decision on key-like pages). Answers 1.0 to 4.7 s.
- 2:56 PM EDT recheck (two routine passes on 5f0e9de16): unchanged on the live site (same counts as above; Tucson 345, all new-state ZIPs 0, Portland 0 Metro boards). Not a lane failure: the runner never ran either lane's task. Every voting-sites and registration task was deferred on both passes (PASS_TIME_BUDGET, "Reader repair waits for the next pass"; voting-sites also "Waiting for a worker slot"), legistar-members waits for a worker slot (173 tasks), and civic_data_candidates holds no voting-sites, registration or legistar-members row since 17:44 UTC. Added to RN-01's return (runner capacity; returns/rn-01.md). VS-07-FX and PB-03-FX stay owed; recheck after RN-01's fix or on the next passes.
- 5:01 PM EDT recheck 2: unchanged on the site (Tucson 345, AZ 345 / KY 226 / SC 135 the only nonzero states, 0 in CA, FL, GA, IL, MI, NC, NY, OH, PA, TX; Portland 97204/97232/97301 0 boards). In 3 hours the runner launched one voting-sites task (US-ND, not a VS-07 state); VS-07's 11 states, every registration-<st>, 171 legistar-members tasks (oregonmetro included) and all 51 ballot-navigation-<st> stay deferred (reader repair waits / waiting for a worker slot). Counts added to returns/rn-01.md. Not returned to VS-07 or PB-03: their tasks never ran.

## Release 91 live checks (Oct 23, from 12:33 PM EDT)
- RN-01-FX planning round (1:41 to 1:55 PM EDT, control plane read-only): FAILED, returned (returns/rn-01.md). Both rounds on release 91 (16:48 to 17:02 and 17:04 to 17:21 UTC) finished 0 of 57 states, STATE_PLANNING_FAILED everywhere; before RN-01-FX rounds finished 1 to 20 states. No per-state digest written since d8013db; rounds last ~15 min (~16 s a state), so the state children die rather than hit the cap. The runner heartbeat shows the system planner at 1.75 GB with its event loop pinned at 1, and cp_work_items.coordinatorItems (pg-store.ts:1535) timing out at 56 s against its 25 s bound. Round order PASS (opens la, ma, md ..., ends al, ar, as, az, ak). STATE_POINTER_RETIREMENT_FAILED: 0 since release 91, PASS. 2-minute cap: no state lived long enough to test it.
- Calendar doors (1:50 PM EDT recheck, still with cal-01): 106 of 10,517 doors succeeded since release 91 (16:33 UTC): NJ 26/101, NH 19/151, CT 8/220, DC 3/8, DE 2/197, SC 2/37, one each in FL, TX, MO, IL, WA, MA, VA, NC, MI, NY, OH, PA, ID; CA and AZ 0.

Live from 12:33 PM EDT (/api/build d8013db). The sidebar link reads "National government".

SP-01-FX, Sean's cache check: PASS on the cache rule. /ballot?zip=85701 at 16:39:09 UTC: "Netlify Durable"; hit; ttl=51589, age 324, with 51,648 s to Phoenix midnight (the Edge node layer itself forwards; Netlify's Durable layer serves the copy). /ballot?zip=00000, four loads: never a hit; "Netlify Durable"; fwd=stale; ttl=-18 then ttl=0; stored: always forwarded to the origin, never served from cache, though Netlify still marks it stored with ttl 0 (noted to SP-01).
SP-01 speed: still short. First visit (16:33:53 UTC, ten ZIPs plus 85701, parallel): ballot 3.65 to 7.19 s (03301 6.9, 85711 7.1, 85701 7.1, 43215 7.2, 95814 6.6, 32301 5.1, 17101 5.0, 78701 4.9, 80202 4.6, 30334 4.6, 12207 4.4, 07102 4.4, 98501 3.7); place 3.4 to 6.7 s. Five minutes later: ballot 0.42 to 1.72 s, place 0.35 to 0.84 s (goal 300 ms; measured from River's cloud container through its proxy). First-visit speed stays open on SP-01.

RN-01-FX: planning-round check runs once the runner follows d8013db and finishes a round.

## Release 90 live checks (Oct 23, from 10:24 AM EDT)

Live from 10:24 AM EDT (/api/build a462d38). Gates 9 of 9 on 1885b95f4 (9,545 pass); river 5130d339c (main merged after gates, tree identical).

WIN: the Vice President is back. /national shows JD Vance, Donald J. Trump and the Cabinet (Rubio, Bessent, Hegseth and the rest), 165 whitehouse.gov source links, Vance's card citing whitehouse.gov/administration/jd-vance/, 1.7 s. Place lists in 12 states (AZ 85016, CA 94110, FL 33130, GA 30303, IL 60602, NH 03301, NJ 07102, NY 10007, OH 43215, PA 17101, TX 75201, WA 98101) show no White House holder. returns/nx-02.md closes. Leftover: the sidebar link still reads "National government, coming soon" (lib/national/link.ts:2, NATIONAL_LINK_LABEL); River fixes the label in the next fold.

PK-01 first restore, Sean's 13 states (after SP-01 and PK-01 live): all under 3 s, none goes back to SP-01. AZ 2,100 ms, CA 2,301, ID 1,647, KY 1,763, MA 1,608, MD 1,641, MI 1,718, MT 1,911, NC 2,205, ND 1,500, NH 1,608, NV 1,571, TX 1,642. Longest part: the private picks read (505 to 712 ms) or the page HTML (554 to 805 ms). Note: the ballot pages are held 24 h at the edge right now (SP-01's open bug), which helps these times. The check saved 13 test pick lists in production, as PK-01's check is built to.

PB-03: named places pass on the live answer: 99559 Main Governing Board under Lower Kuskokwim School District (2 members); 85641 one Vail Governing Board (6 members); 35801 City Council under Huntsville city (2 members), no "Huntsville city governing" label. 36602 shows "Board of Commissioners" under Mobile city (0 members). Oregon FAILS: 97204, 97301, 97401, 97701 all 0 boards (PB-03's table: 79 held, 0 shown); returned (returns/pb-03.md).

Runner on release 90 (control plane and reader DB, read-only, 11:35 AM EDT): the runner reports a462d38 from the 14:00 UTC hour.
- WIN (CAL-01-FX): the publish-now cursor moved from 2026-10-13T22:24:35Z (stuck since before release 86) to 2026-10-23T15:22:43Z, about 10 minutes behind live; owed publications are flowing again.
- Routine pass: the 15:00 UTC pass (release 90) finished at 15:28 inside its budget, not killed (the 14:29 pass on release 89 code was the last ROUTINE_CHILD_TIMED_OUT). It recorded 7 supervisor failures: RECEIPT_COUNT_INVALID 3, CHILD_EXIT_CONTRADICTED_SOURCE_RECEIPT 1, READER_REPAIR_CHILD_EXIT_NONZERO 1, READER_READBACK_REPAIR_FAILED 1, STATE_POINTER_RETIREMENT_FAILED 1 (RN-01's cleanup replaces it in release 91); 2 sources promoted, 1 held its last good copy, 2 Reader PASS.
- Publish-now: every pass at 15:10, 15:21, 15:32 UTC ends "PUBLISH NOW OUTER SUPERVISOR FAILED — ROUTINE_CHILD_TIMED_OUT ... PASS_TIME_BUDGET: publish-now reached its lane deadline; its unfinished work stays owed to the next pass". That is the designed deadline while it catches up, but the digest names it a failure. Recheck after it catches up; if it still ends this way, return to cal-01 (labeling and budget).
- Publish-now (12:20 PM EDT recheck): the cursor caught up to 2026-10-23T16:18:52Z, about two minutes behind live; no publish-now timeout since 15:32 UTC. CAL-01-FX's publish-now fix holds.
- Calendar doors (12:20 PM EDT recheck): FAILED, returned to cal-01 (returns/cal-01.md). 35 of about 5,800 doors recorded lastSuccessAt since 14:20 UTC (KY 10, CT 8, ID 3, HI 2, SC 2, WA 1, unscoped 9); 0 in CA (1,716), FL (722), TX (704), WI, MO, CO, AZ, IL, DE, MA, VA, MI, NH. AZ's last success 2026-10-22 17:52 UTC; CA and TX have none recorded; lastAttemptAt null throughout. Each pass logs "door-read-now ... deferred by the provider frontier".
- 15:41 UTC routine pass: 100 supervisor failures (READER_READBACK_REPAIR_FAILED 85, RECEIPT_COUNT_INVALID 13, READER_REPAIR_CHILD_EXIT_NONZERO 2): RN-02's reader-repair area; noted for RN-02 (returned, merging river).
- SRC-01 (civic_data_candidates since 14:20 UTC): legiscan-bills 4 PROMOTED (US datasets, sessions 2262, 2218, 2148); campaign-money:hourly PROMOTED. FAILED, returned (returns/src-01.md): epa-echo:national SOURCE_BLOCKED (archive key archive/epa-echo/source.json already holds a different object; the run key is not unique) and openfema:FL PARSE_INVALID (NORMALIZED_READ_MODEL_HASH_MISMATCH). FEC, FAC, Socrata: no run yet since release 90; SAM after 8 PM EDT.
- DG-02: MEETING_OUTCOME since 14:20 UTC: AZ 16 PROMOTED, 1 HORIZON_UNRESOLVED; no other state yet. DG-02's 3,170 door bindings outside AZ are due tomorrow (Oct 24); recheck outcomes by state then.
- NB-02 (cp_vital_signs neon_bytes_read by hour, GB): 05:00 4.53, 06:00 4.93, 07:00 4.81 (NB-02 baseline 4.71), 08:00 2.84, 09:00 2.07, 10:00 4.97, 11:00 3.93, 12:00 1.87, 13:00 13.54 (release 89; a spike to investigate), 14:00 7.10 (release 90 reached the runner), 15:00 1.23 at 15:35 (partial). Judge NB-02 on complete hours from 16:00 UTC.
- cp_vital_signs rounds_finished reads 0 in every hour all day, before and after release 90; it does not reflect the routine passes above (owner: line keeper reads it; investigate with RN-01's planning round in release 91).

## Release 89 live checks (Oct 23, 8:37 to 9:05 AM EDT)

Release 89 = SP-01 + EX-03 + River's dead-code gate. Live from 8:37 AM EDT (/api/build 1e353d4, deploy 6adb546b9ccc594b1c1ca3cb).

SP-01: FAILED, returned (returns/sp-01.md).
- Sean's cache check: /ballot?zip=85701 second load 5 minutes later was an edge miss; the next load was "Netlify Edge"; hit; ttl=86377 with 65,799 s to Phoenix midnight (about 5.7 h past midnight). /ballot?zip=95814 hit, ttl=86071. /ballot?zip=00000: "Netlify Edge"; hit; ttl=86050, age 353; it must never be cached. Cause found: next.config.ts:82 sets max-age=86400 for /ballot and the middleware's per-ZIP value (middleware.ts:82, lib/reader/ballot-cache.ts) never reaches the edge, so likely neither do its state cache tags: a ballot change may wait up to 24 h to reach readers.
- Speed, ten ZIPs in ten states plus 85701 (first visit, parallel): ballot 3.6 to 11.4 s (03301 10.7, 85711 11.4, 85701 11.1, 17101 8.7, 95814 7.9, 30334 7.2, 12207 6.5, 98501 6.2, 32301 5.9, 07102 5.8, 78701 4.6, 80202 3.8, 43215 3.6 s); place answers 0.9 to 10.4 s. Five minutes later: ballot 0.4 to 5.1 s, place 0.45 to 1.1 s. Goal: under 3 s first, under 300 ms repeat.
- Place answers, River's 16-place set (first visit, parallel): 12 of 16 under 3 s (was 4 of 16 at 4:56 AM): AZ 85701 4.9 s, IL 60602 3.4 s, WI 53703 3.0 s, WI 53202 2.9 s; Milwaukee 342 boards, 138 with members (was 117), 204 empty; 10 of 16 big cities still 0 boards (PB-01 not shipped).

EX-03: baseline (Sean's 24-hour test starts when EX-03, RN-01 and RN-02 are all live; RN-01 and RN-02 are not).
- Rendered ZIP ballot page, one real ZIP per state (Chromium, full page), measure cards with a plain-language summary: AL 4 of 4 (35004), AR 3 of 4 (71601), AZ 11 of 12 (85003), CA 18 of 24 (90001). Measures shown with no explainer in 33 states: AK, CO, DC, FL, GA, HI, IA, ID, IN, KS, KY, LA, MA, MD, MN, MO, NC, ND, NE, NM, NV, NY, OH, OK, RI, SD, TN, UT, VA, WA, WI, WV, WY. No measure card found by River's selector at that ZIP (may be the selector): MI, MT, NH, OR, PA, TX, VT.
- cp_attempts (control plane, read-only): measure-translation attempts exist only for AL (36: 4 completed, 32 held), AR (7: 4, 3), AZ (33: 9, 24), CA (72: 57, 15), plus finds for AK, AL, AZ. 40 states have no attempt: admission is RN-01's (not yet live). AL and AZ's latest held reason: "You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC." AR and CA: "A translated sentence lacks a confirmed source passage or independent support."
- DECISION FOR SEAN: the Anthropic workspace usage limit blocks every new explainer until Nov 1, two days before the Nov 3 election. Only Sean can raise it (Anthropic console, workspace limits). EX-03 already closes the paid lane cleanly on that refusal and shows the reason in Admin.

## River session claude/river-fold-ship-ysodir (Oct 23, from 4:15 AM EDT)

Sean's orders for this session (Oct 23, ~4:15 to 5:00 AM EDT):
- Fold READYs as they post, smallest and reader-facing first: pb-01, pb-02, rn-01, rn-02, then vs-07, lv-01, sp-01, bl-01, ex-03, pb-03, pk-01, src-01, nx-02, nb-02, dg-02; plus cs-01 (after bl-01; where both touch app/ballot/page.tsx keep both sides) and eo-01 (after lv-01, it builds on lv-01).
- Every fold deletes the code the lane replaced and left behind. `pnpm gates` now runs knip (dead-code gate) on every combination.
- A READY without both connection proofs (connected end to end; still working on the next scheduled run) is refused and returned.
- A release is live only when https://meanwhileusa.com/api/build shows its merge commit. Then each lane's live check runs at national scale: the named examples plus real places in at least 10 states, counts by state posted here.
- Hold pb-02 until it posts a new READY with a national sample (returns/pb-02.md).

Queue (8:20 AM EDT):
- Release 89 = SP-01 (489e1849b) + EX-03 (fd4c018c5) + River's dead-code gate and fold fixes: pnpm gates 9 of 9 on river 1e4b455bb (9,332 pass, 0 fail, 6 skipped; 11:20 to 12:07 UTC). PR #799, auto-merge on. Its first CI runs were the cheap "waiting" tier (the PR's opened event, before auto-merge); turning auto-merge on from this session started no run, so River added the run-full-ci label (12:20 UTC), which started run 2733 with the full suite. River note: label every release run-full-ci when it opens. Not live until /api/build shows its merge commit.
- PB-01 withdrew its READY (returns/pb-01.md). First gates with it: 14 failures, attributed and fixed or returned (see returns/pb-01.md).
- Release 90 candidate, river-next 1885b95f4 on river 1e4b455bb (first gates 8:20 to 9:10 AM EDT: 8 of 9, test 2 of 9,551 failing, both PK-01: its saved_ballot_picks table was not classified for the identity boundary, and scripts/pk-01-live.mts wrote the production host; fixed in the fold, gates re-running from 9:15 AM EDT): cal-01-fx (723ee4c4b), pb-03 (5da6588d8), pk-01 (77b70e1cd), src-01 (7b05903de), nx-02-fx (a5d5f7d4e), nb-02 (0b42253dc), dg-02 (e6745c664). All carry both proofs. Two conflicts, both with River's own dead-code cleanup, resolved and recorded (pk-01 types.ts, dg-02 standing.ts). Dead code the lanes leave on the combination, deleted in the fold: lib/doors/outcome-door-load.ts and drainWorkerQueue (DG-01/DG-02 replaced their callers), plus two imports only drainWorkerQueue used. Knip clean on the trial.
- Returned again: rn-01 (rn-01-fx fbe50130d conflicts with SP-01 in scripts/fetch-congress-legislators.mts: RN-01's many-state Congress refresh drops SP-01's saved office points; River will not hand-resolve a change that loses reader data. returns/rn-01.md has the exact resolution; first in line once SP-01 is live).
- CAL-01-FX live check (when shipped): no ROUTINE_CHILD_TIMED_OUT; each pass saves its outcome; the publish-now cursor moves past 2026-10-13T22:24:35Z and owed publications (2,770 at 11:00 UTC) drain; calendar doors record new lastSuccessAt in AZ, NH, NJ and 10+ other states.
- RN-01-FX live check (when shipped): the round opens with the longest-waiting states (not ak/al/ar/as); no state's walks pass 2 minutes; a release resumes where the round stopped; every state completes within 19 passes; the nine national pointers retire one per pass; voting sites by state on the live card (its replay: 2,836 sites in 13 states).
- DG-02 live check (when shipped): posted-minute outcomes on the live MeetingRecords card in AZ (its 59 sittings, 827 actions) and its two-state check; outcomes by state in 10+ states. Its own table: only AZ holds outcomes today (others 0, coverage gaps); CA binds 1,009 of 1,039 doors (30 unbound, to ask DG-02 why).
- NX-02-FX live check (when shipped): /national lists the President, JD Vance and the Cabinet, each with its whitehouse.gov page in Sources; 85016, 75201, 94110 and 10+ other states' ZIPs keep no White House holder in Who governs here.
- PB-03 live check (when shipped): 99559 REAA, 36602 Mobile Housing, 85641 Vail, 35801 Huntsville, Washoe Rural once in its five NV ZIPs plus 89506; reader boards by state in 10+ states. To investigate there: its own table shows OR with 79 boards held tomorrow but 0 reader boards and 0 live facts.
- Returned: pb-02 (85bf54e3d has the national sample in docs/pb-02.md but a one-line READY message without the proofs; a new READY that states them folds next), lv-01 and vs-07 (empty READY messages; vs-07 also adds 39 MB of county PDFs to tests/fixtures), nx-02 (answered by FX-01: nx-02-fx shows every current executive with seat, name and source under §3; read-only production render gives 23 cards with JD Vance). eo-01 waits behind lv-01.
- Queue at 1:35 PM EDT (the stream watcher died with the container restart; these READYs were found by a fresh scan):
  - bl-01 a27c677e6 (BL-01, both proofs): folded, c59a05e6e. Three small clashes resolved in the fold: pick-control.tsx header keeps both descriptions; civic-data runner.ts and store.ts keep both failureStreak (river) and publishedScopeVersions (BL-01).
  - ballot-parity-fx 41f20be9a (BL-21-FX, FX-01's answer to returns/ballot-parity.md, both proofs): folded, 01f39a1f6. Seven files clashed with releases 89 to 92, all resolved keeping both sides (navigation and census geography both stream and both take the held promotion path; receipt check keeps the translation-state scope and the scoped manual contract scope; text-layer keeps the pdfjs guard and the doc base URL; the runner skip line keeps recordLaunchDecision on the publication target).
  - First gates on 01f39a1f6 (BL-01 + BL-21-FX, 1:35 to 2:15 PM EDT): 8 of 9, test 9,636 pass, 10 fail. All 10 are BL-01's: they fail the same on its own READY a27c677e6 and on release 92 + BL-01 alone. BL-01 RETURNED (returns/bl-01.md): the ZIP Census read drops the district explainers and district people readers see today, a runner crash in routineTaskDue (runner.ts:692), Fargo 25 of 26 contests, the FEC "JR" suffix, BAL-41/43 ballot layout tests. CS-01 waits behind it.
  - rn-02 posted READY 4792100a1 at 2:59 PM EDT (merged release 92's river, both proofs): folded on top of the release 93 candidate as 0fab4db50. Five files clashed with BL-21-FX only, all kept both sides (navigation and meetings both take the held path and payload parts; navigation keeps durableStateHash, other read models RN-02's durableCivicDataHash; worker-slots keeps both peaks); RN-02 left createHash unused in candidate-integrity.ts, deleted in the fold. tsc and knip clean. Full gates on it as soon as release 93's finish; release 94.
  - RN-02 gates (river + RN-02, 3:58 to 4:50 PM EDT): 8 of 9, test 9,663 pass, 3 fail, all RN-02's own (they fail on 4792100a1 alone, pass on river). RETURNED (returns/rn-02.md): read-once-fetch.ts:40 writes null bytes for no-content responses (NOT NULL agenda_bytes.bytes), and two derived-family publication tests TypeError at derived-family-fact-publication.test.ts:30.
  - RN-02 answered at 8:33 PM EDT: READY da6a37852 on river 739e03665 (both proofs; empty agenda bytes stored as a zero-byte BLOB; derived-family fixtures fixed). Folded clean by river.mjs as 12eddfcc2. The 3 tests that failed now pass (5 of 5 in their files); tsc and knip clean. pnpm gates from 8:45 PM EDT; release 94 when they pass. RN-02 is the reader-repair change the starved runner needs (release 92 and 93 data waiting).
  - River-next rebuilt as release 92 + BL-21-FX alone (5ddf41bb8; only 4 files clash without BL-01, same resolutions). tsc and knip clean; pnpm gates from 2:25 PM EDT. Release 93 when they pass.
  - cs-01 39238a8be: REFUSED (returns/cs-01.md). Its message has the next-run proof but never says it is connected end to end. A READY that states it folds next, after bl-01, keeping both sides of app/ballot/page.tsx.
  - dg-01-fx 04dfa4caf (DG-01-FX): not folded, superseded. DG-01 286a2d791 already shipped inside DG-02 (release 90, live 10:24 AM EDT), which answered the same returns/dg-01.md. Merging DG-01-FX on top would re-resolve the same ingest.ts code a second way (15 clashing hunks with what is live). Nothing for FX-01 to do; dg-01 is closed.
  - Unchanged, still returned: rn-02 d04982090 (merge river), pb-02 85bf54e3d (READY message), lv-01 f786ce81f (READY message), src-01 66437c4f2 (EPA ECHO, OpenFEMA), pb-01 (withdrawn). eo-01: WIP only (waits on lv-01).
- Live checks owed when release 93 is live (plus real places in 10+ states, counts by state):
  - BL-01: /ballot on real ZIPs in every state shows the same contests today and tomorrow; 58501 (Bismarck ND) keeps its at-large House race; Maryland's Supreme Court label is county-scoped; PR and GU stay empty until BA-01 publishes their ballots (no BALLOT_CANDIDACY pointer at their state scope).
  - BL-21-FX (release 93): /ballot?zip=85653 (Marana) shows the Arizona card with Secretary of State 602-542-8683, Pima County Recorder 520-724-4330 and Marana Town Clerk 520-382-1961; 85701 the same card; every state's card renders with no false gap; navigation tasks publish on their next pass (51 due).

Baseline before this release (live, release 88, 4:56 AM EDT; first visit, 16 places fetched in parallel), /api/meetings by ZIP: boards shown / with members / empty / ms
- WI 53703 Madison 0/0/0 618 ms; WI 53202 Milwaukee 342/117/225 (184 all-caps names, 3.07 MB) 659 ms; AZ 85701 136/9/127 5.3 s; TX 77002 2/1/1; MO 64106 2/2/0; FL 33130 1/0/1.
- 0 boards: CA 94102, CO 80203, GA 30303, IL 60602, MA 02108, MN 55401, NY 10007, OR 97204, TN 37201, WA 98101.
- 12 of 16 answers took 3.4 to 5.5 s (over the 3-second rule). /ballot?zip=85701: edge miss, no-store, 3.1 s.

Sean's decisions on returns/sean.md (relayed Oct 23, ~5:15 AM EDT; FX-01 closes both):
1. Vice President: option (a). Release 88 stays. NX-02 feeds the National section, and the Vice President shows on /national. Live check when NX-02 ships: /national shows the Vice President (and the President and Cabinet) with sources; place pages keep only place-specific officials.
2. Planning round: RN-01 owns it. Rounds start with the states that have waited longest, each state's time is capped, and a release resumes the round where it stopped. Live check when RN-01 ships: the runner's round order follows longest-waiting states, no state passes its cap, and after a release the round resumes at the state where it stopped (no restart at ak/al/ar/as).

Live checks owed once the release is live (each also on real places in 10+ states, counts by state here):
- PB-01: Dane County #governing 37 members, Henry Fries once with its source link; Milwaukee 171 boards, 0 empty; WI, AZ, WA, CO, CA Legistar board names; plus 10+ states: boards shown, boards with members, empty boards.
- SP-01: ten-ZIP first-visit and five-minute repeat speed; office pins on place pages (03301 13 points, 07102 9 points) and pins by state in 10+ states; database_transfer_daily on comparable traffic. Sean's cache check: load /ballot?zip=85701 twice, five minutes apart; the second Cache-Status is a Netlify edge hit and its ttl is no longer than the seconds left to midnight Phoenix time; /ballot?zip=00000 is never cached. A ttl past midnight sends SP-01 back with the headers seen.
- PK-01 first restore, rerun once SP-01 is live (Sean, Oct 23 ~5:30 AM EDT): the 13 states PK-01 measured over 3 s (AZ 85003, CA 90001, ID 83120, KY 40003, MA 01001, MD 20601, MI 48001, MT 59001, NC 27006, ND 58002, NH 03031, NV 89001, TX 75001). Same journey: save picks on desktop, open the private link in a fresh phone browser, time until the saved pick shows pressed. Each time goes here; any state still over 3 s goes back to SP-01 with its time and the part of the load that took longest. PK-01's own times: AZ 3,875; CA 3,107; ID 4,876; KY 3,497; MA 4,989; MD 3,012; MI 3,260; MT 4,623; NC 4,529; ND 4,993; NH 3,932; NV 4,795; TX 3,457 ms. Baseline before SP-01, plain first load of /ballot for the same ZIPs from River's cloud browser (5:34 AM EDT): AZ 4,133 ms (page HTML 3,265 ms); CA 1,748; ID 2,185; KY 1,178; MA 1,208; MD 1,303; MI 1,234; ND 1,328; NH 1,613; NV 2,060; TX 1,896 ms; MT 2,397; NC 1,588 ms; the page HTML was the longest part in every state.
- EX-03 (Sean's change): once EX-03, RN-01 and RN-02 are all live, every state whose ballot file has measures shows explainers on a real ZIP ballot page within 24 hours. Any state that doesn't gets a line here with its reason from cp_attempts, and the reason goes back to the lane that owns it.
- SRC-01 (when shipped): a new PROMOTED candidate for each source within its next scheduled run; a live CT card's own money reason; SAM real-data replay after 8 PM EDT Oct 23.

## Hand-off to the next River session (Oct 23, 12:02 AM Phoenix / 3:02 AM EDT)

- State: main 825ff1c4b (release 88) is what production serves. river = 78f82a232 (release 88's tested tip). No PR open, no gates running, lock released, the 15-minute scan loop is gone. Lane tips at hand-off: ds-01 096ec0db9 (DS-01-S2, shipped in 87), cal-01 e41945169 (CAL-02, shipped in 86), pm-01 1777c5767 (NX-PLACE-3, shipped in 88), dg-01 286a2d791 (returned, not shipped).
- Open, in order: (1) Vice President: off every place page since release 88, by pm-01's NX-PLACE-1/2 design (President, Vice President and Cabinet moved to a National section that says "coming soon"); needs Sean's call: keep, ask pm-01 to keep them on the place list, or River reverts NX-PLACE-1. (2) cal-01: returns/cal-01.md (runner-r86): the routine pass times out at its 30-minute budget (ROUTINE_CHILD_TIMED_OUT, also at 06:38 UTC on release 87), no calendar door has a new lastSuccessAt since 05:13 UTC (AZ, NH, NJ and elsewhere), publish-now ends on HUNT_SCOPE_UNREAD (30-second cp_work_items_history read). (3) Legistar board names (release 84): 80903 still shows no City Council; check again after a routine pass finishes inside its budget. (4) The planning round never covers the states (ak, al, ar, as repeat; "2 states completed, 55 failed" at 06:51 UTC); design question for Sean. (5) DG-01 stays returned until it posts a new READY on current main.
- River notes: merge main into river-next before running gates, and promote only after that, or `promote` refuses (its fold base moves) and there is no restart command; a lane alone in a fold that conflicts cannot be shipped hand-resolved, so return it with the resolution. Call a release live only when https://meanwhileusa.com/api/build reports its merge commit (releases 83 and 84 merged but failed to deploy because grounded-ask went over Netlify's 250 MB; the post-deploy observer does not check this). Branch deletes are still refused by the proxy; nothing qualified.

## Release 88 took the Vice President off the place pages (Oct 22, 11:55 PM Phoenix / 2:55 AM EDT Oct 23)

- Vice President was live for about 45 minutes (releases 85 to 87; runner on 767eeba from 06:08 UTC): AZ, TX, OH, CA, NM and VT state data carried JD Vance with a White House source quote, and the page's "46 Officials Near 85016" list showed Donald J. Trump, JD Vance and the Cabinet under "United States"; his card read "Federal, Incumbent, Vice President of the United States", one source.
- Release 88 (pm-01 NX-PLACE-1, -2, -3; PR #798, merged 825ff1c4 at 06:40 UTC, served 06:42 UTC) removes them on purpose. NX-PLACE-1: "The President, the Vice President and the Cabinet are off every place's 'Who governs here?' list. The list holds only who is specific to the place." NX-PLACE-2 adds a National section that shows a card only when the national data marks it complete; with none complete it says "National government, coming soon" (link under the Local/State/Federal filter and at the bottom of Who governs here?). Nothing connects the data yet (it waits for "NX-01"), so /national has no Vance and no Vice President today. Live now: 85016 lists 23 officials (was 46), with no Trump, no Vance, no "United States" rows; 75201 and 94110 the same; /national says coming soon.
- So the Vice President (and the President and Cabinet) is not on the live page in any state. This is not a failed gate and nothing is broken: the lane did what it described. It contradicts "Done means the Vice President shows on the live page in AZ, TX, OH, CA and two random states", which was true 06:15 to 06:40 UTC.
- Sean decides: (a) keep release 88 and have NX-01 feed the National section (the Vice President returns on /national, not on each place page); (b) ask pm-01 to keep the President, Vice President and Cabinet on the place list until the National section has cards; or (c) River ships a revert of NX-PLACE-1 alone. River has not reverted anything.
- Legistar board names: 80903 (Colorado Springs) still shows the county commissioners and the school board, no City Council; Tacoma, Oklahoma City and Minneapolis show 0 bodies. Waiting for a routine pass on release 84's code (runner on 767eeba from 06:08 UTC; watch armed).

## Releases 85, 86 and 87 shipped and live (Oct 22, 10:58 PM Phoenix / 1:58 AM EDT Oct 23)

- Release 85 = DS-01 step 1 alone (PR #795, merged 107c99a3b): keeps the territory geojson and 8.4 MB of browser-only ZIP start files out of the reader functions. Netlify deployed it (and 83 and 84 with it): /api/build served 107c99a at 03:39 UTC. Release 86 = cal-01 CAL-02 (PR #796, merged 9f84aec62): served 04:50 UTC. Release 87 = DS-01-S2 (PR #797, merged 767eeba4b): geometry moved to the reader edge store; served 05:45 UTC. Each gate run 8 of 8 (9,248; 9,293; 9,297 pass), CI green, no migrations. A release is called live only when /api/build reports its merge commit.
- Site (checked after each deploy): voting pins unchanged (Los Angeles 1,076, Houston 697, Atlanta 40, Milwaukee 1, New York 1); ballots 94110 and 43215 0.8 to 2.5 s; state pages 0.8 to 2.9 s; point lookups at Tucson, Fairbanks, the Kuskokwim, Flagstaff and Houston all 200 (0.4 to 2.8 s, the Tucson one is the first read after the deploy). No errors.
- Vice President: still 0 in AZ, TX, OH, CA state data (checked 04:30 and 05:00 UTC; runner on release 85 from 03:56 UTC, one full routine pass later). Returned to ds-01 (returns/ds-01.md, vp-live-r85).
- Runner on release 86 (from 05:13 UTC), first pass: the Box is building again (cp_box_findings built 6,217 to 6,911, +287). No Netlify Blobs error. But the routine pass ran out its 30-minute budget (ROUTINE_CHILD_TIMED_OUT, a code no earlier release had), no calendar door has a new lastSuccessAt in any state since 05:13 UTC (NH and NJ were recording before), and publish-now ends every pass on HUNT_SCOPE_UNREAD (a 30-second cp_work_items_history read). Returned to cal-01 (returns/cal-01.md, runner-r86).
- Still to check once the runner follows 87: the geometry publish (the runner now files the 73 state geometry files in the edge store; first pass sends them all).
- Queue: release 88 = pm-01 NX-PLACE-3 (official card shows only the sections its office has; the President and Vice President classified separately), gates running.

## Cause found: releases 83 and 84 did not deploy (Oct 22, 7:03 PM Phoenix / 10:03 PM EDT)

- Sean read the Netlify build log: both deploys failed at upload with "The function exceeds the maximum size of 250 MB: Failed to upload file: grounded-ask". Release 83 brought SL-02's territory-XX.geojson files, which took data/states from 23.6 MB to 52.4 MB. netlify.toml line 38 (grounded-ask) and line 43 (reader-meetings) pack data/states/*/geo/**/*.geojson into those functions. Release 84 failed the same way because it sits on top of 83. Publishing is not locked and deploy 6ada90f6 is not pinned.
- Fix in flight: DS-01's step-1 READY keeps the territory files out of the function packages and out of data/derived/resolver-geometry.json. Until it lands River ships nothing (cal-01's CAL-02, gates stopped, waits behind it). Order: DS-01 step 1 first, alone or with cal-01; nothing ships without it.
- New rule for each release from here: do not call it live until https://meanwhileusa.com/api/build reports the new merge commit. Only then the runner, Vice President (AZ, TX, OH, CA and two random states) and Legistar-name checks. The Vice President and Legistar board names (releases 83 and 84) are therefore not verified live.
- The earlier line above ("What I cannot see: Netlify's deploy list") is answered by this; the post-deploy observer still passes without checking the served commit.

## Releases 83 and 84 are in main but not on the live site (Oct 22, 6:58 PM Phoenix / 9:58 PM EDT)

- https://meanwhileusa.com/api/build reports commit f44f9a18f (release 82), deployId 6ada90f662bf25a5c9dcf4c2, at 1:49 AM UTC and again at 1:55 AM UTC. Main is c88037bb9 (release 84). Release 83 (035a48044) merged at 00:13 UTC; release 84 (c88037bb9) at 01:08 UTC. Neither is being served, 105 and 50 minutes later. Earlier releases showed on the site within a few minutes.
- This is why the runner is still on f44f9a1: it follows the commit the site serves (lib/ops/runtime-release-handoff.ts), not main. So the Vice President (NE-01, release 83) and the Legistar board names (release 84) cannot appear, and nothing about them is verified.
- What I can see: GitHub shows the Build check, gates, admission and the post-deploy "observe" check green on 035a48044 and c88037bb9. The GitHub commit status for both is "pending" with no Netlify entry. What I cannot see: Netlify's deploy list and build log (no Netlify access from this session; the Netlify tool here only reads request analytics). The post-deploy observer passed for both while the site served the older commit, so it does not check that the new commit is the one being served.
- Needs Sean: open Netlify > Deploys for meanwhileusa.com and look at the builds for 035a48044 and c88037bb9 (failed? stuck queued? auto-publishing locked or a deploy pinned to 6ada90f6?). River's step after that: I hold release 85 (cal-01 CAL-02, gates running) from merging, so nothing more stacks up behind an undeployed commit and a failing build can be bisected between 82 and 83.

## Releases 83 and 84 shipped (Oct 22, 9:25 PM Phoenix / 12:25 AM EDT Oct 23)

- Release 83 (ds-01 NE-01, with SL-02 underneath it): PR #793, merged 035a48044 at 8:13 PM Phoenix; gates 8 of 8 (9,241 pass); observer green 8:23 PM. NE-01 is ds-01's answer to my Vice President return: the White House read never started because the people lane queued behind the meeting reads for memory; the fix starts it first in the next ordinary pass after a deploy.
- Release 84 (pm-01 R3-LEGISTAR-MEMBERS, board names): PR #794, merged c88037bb9 at 9:08 PM Phoenix; gates 8 of 8 (9,247 pass); observer green 9:18 PM. Boards outside the registry now get a verified, sourced name (Colorado Springs' council had 9 verified members and no name, so ZIP 80903 showed 0 bodies). 130 of 182 readable nameless production bodies get names on replay.
- Neither is verified on the live page yet: the runner (the part that reads White House and Legistar sources) was still on release 82 (f44f9a1) at 6:16 PM Phoenix, over an hour after release 83 deployed (earlier follows took 10 to 29 minutes). Vice President in AZ, TX, OH, CA state data: still 0 at 6:15 PM Phoenix. Checks run as soon as the runner is on release 83 or 84.
- cal-01: its first READY (6f7403b1b) failed the civic-data firewall (contract-handoff.ts writes a temp file); its second READY (1ac756930, clear release gates and unblock fresh fact delivery) clears the firewall but branched before releases 83 and 84 and conflicts with them in three files. I resolved it and passed 124 focused tests, but River cannot ship a hand-resolved merge for a lone lane, so cal-01 is asked to merge main and post a new READY (returns/cal-01.md has the five-point resolution).
- Runner at 5:56 PM Phoenix (routine pass on f44f9a1): 206 task failures, no Netlify Blobs error. Box built 6,217, not growing since release 82.

## Release 82 (AG-01) shipped (Oct 22, 3:55 PM Phoenix / 6:55 PM EDT)

- PR #792 merged f44f9a18f at 6:42 PM EDT (head 5864c4599, CI green, label run-full-ci); post-deploy observer green at 6:43 PM EDT. No migrations.
- What a reader sees now, checked on the live site: a place with no held calendar shows no "Checked ... ago" line. Seattle (98101) and El Paso (79901) pages have no Checked line (they said "Checked 20747 days ago" before). Flagstaff (86001) and Phoenix (85016) still show a real "Checked 20 days ago". The meetings API sends `snapshot: null` for those places: 38 of 40 sampled ZIPs across the country (none still carry a 1970 date). That also means 38 of 40 sampled places have no held calendar snapshot at all ("0 Meetings"), which is a data question for cal-01, not a display one.
- Runner after release 82: the runner follows the deploy in about 15 to 20 minutes; checks come next.
- Open: Vice President not on the live page (ds-01 return), meetings readback and calendar doors (cal-01 return), Legistar board names on the page (pm-01). No new READY on any lane at 6:55 PM EDT.

## Where things stand (Oct 22, 3:12 PM Phoenix / 6:12 PM EDT)

- Release 82 (AG-01 alone) is PR #792, head 5864c4599, label run-full-ci, CI running. River's `promote` could not move river to this tip (its recorded fold base had moved after the first promote; the later no-op fold also cleared fold.json), so the tested SHA was pushed to release/82 by hand on Sean's instruction. Gates passed 8 of 8 on that exact SHA (9,233 pass). River needs a restart-from-main step after this release; there is no command for it.
- Four hours on release 81 (be812ba), live state data for AZ, TX, OH and CA still has 0 Vice President. Not done. Returned to ds-01 (returns/ds-01.md, updated).
- Meetings readback: the child reader-readback:meetings-aggregate failed for 0 doors at 20:09, 20:35 and 21:01 UTC (10, 2 and 20 total task failures) and for 157 to 161 doors on either side of that. Moved to cal-01 as Sean asked (returns/cal-01.md has the pass-by-pass numbers; returns/pm-01.md now says PM-01 still owes Legistar board names on the page).
- Calendar doors with a new lastSuccessAt since release 81 deployed: NH 29, NJ 2, AZ 0, none elsewhere. Netlify Blobs error: 0 in 105 digests. Box built: 6,217 (+184 since 18:10 UTC). publish-now-supervisor still ends exit 2 (88 times).

## Where things stand (Oct 22, 2:58 PM EDT)

- Release 80 SHIPPED (PM-01's CK-01 alone): PR #790 merged 094c487db at 1:07 PM EDT, live 1:13 PM, observer green. The runner followed at about 1:34 PM EDT.
- Release 81 SHIPPED (DS-01's NE-01 and OR-01, PM-01's Legistar fix): PR #791 merged be812bacc at 2:07 PM EDT, observer green at 2:10 PM. The runner followed at about 2:20 PM EDT. Gates 8 of 8 (9,229 pass, 0 fail, 6 skipped), CI green. River fixes: both lanes touched lib/control-plane/gateway/registry.ts (kept both entries); OR-01 added data/reference/official-legislature-rosters.json without declaring it, so River wrote the provenance note data/reference/official-legislature-rosters.md and added the dataset to JSON_REFERENCE_DATASETS in tests/reference-data.test.ts.
- Release 82 (AG-01 alone: a place with no held calendar shows no "Checked" date instead of "20747 days ago") passed gates 8 of 8 (9,233 pass); River refused to release because main had gained release 81's merge commit, so the gates are re-running on the merged tip (the tree is byte-identical).
- NOT done: the Vice President is not on the live page. AZ, TX, OH and CA state data carry the President and 0 Vice President entries at 2:53 PM EDT, 33 minutes after the runner followed release 81. Returned to DS-01 (returns/ds-01.md). Legistar member names were not checked (the runner's meetings readback is failing, see below).

## Server checks after release 80 (Sean's four checks, 1:13 PM to 2:20 PM EDT)

1. Calendar doors with a new lastSuccessAt: AZ 1 (first at 1:54 PM EDT); NH 0 then 15 after release 81 (8 failures); NJ 0; none outside AZ, NH and NJ.
2. "Planning round" line newer than the release: only "3 states completed, 54 failed" (2:19 PM EDT). That round began 1:36 PM on release 80's code and was cut short when the runner moved to release 81 (ak took about 18 min, al about 20, ar about 4). A full 57-state round takes hours, so no round can finish between deploys; a "round finishes" check cannot pass while releases ship this often. This is a design question for Sean, not a lane return.
3. "not configured to use Netlify Blobs": gone. 0 of 25 digests after release 80, 0 of 19 after release 81.
4. Box built after the release: yes. 5,957 built at release 80, 6,049 at 2:50 PM EDT (+92). Rising.
- Still failing: publish-now-supervisor ends ROUTINE_CHILD_EXITED (exit 2) every pass; the routine supervisor's task failures went 135 (release 79 code) to 86 (release 80) to 156 (release 81). The receipt-count errors for meeting partitions (iCal, Clerk boards, schedule page) are gone. What remains: one child, reader-readback:meetings-aggregate (5-minute timeout for every meeting contract), "did not emit one exact result" for 59 then 141 doors. Returned to PM-01 (returns/pm-01.md).

## Live check after release 81 (2:10 to 2:55 PM EDT)

- /api/reader/state for AZ, TX, OH, CA: 200, 1.2 to 4.1 s (AZ 3.9 s and TX 4.1 s are the first reads after the deploy; over three seconds, open). President present, Vice President absent.
- Pages for ZIPs 85001, 85016, 75201, 43215, 94110: load; "Checked 20 days ago" still shows for places without a held calendar until release 82.
- Not yet run after 81: voting pins, ballot pages, two random states (waiting for the runner pass).

## Where things stand (Oct 22, 4:35 AM EDT)

- Release 79 SHIPPED: PR #789 merged f8e4670e4 (3:58 AM EDT), live 4:11 AM EDT. PM-01 (R3-LEGISTAR-MEMBERS, CK-01, SRC-MN, PM-01), CAL-01 (items 1 to 6, RH-01, and item 7's pause fix), DS-01, EX-02, PG-01. Gates 8 of 8 (9,209 pass), CI green. CAL-01's calendar fix (items 1 and 2) is now in main.
- Post-deploy integrity for 79: the observer's first reading REFUSED at 4:11 AM EDT (08:11:17Z), seconds after the deploy: contract migrations 0047_ck01_flag_target and 0049_r3_legistar_members_retire_index were not applied yet. Expand migrations applied at 4:09 AM; the runner applied the contract half at 4:30 AM EDT (digest db-migration:contract, f8e4670). Re-run at 4:31 AM: observer succeeded on attempt 3. Integrity is back to healthy. A release with contract migrations is refused by the observer for about 20 minutes after its deploy; the next release's gates are frozen until the passing re-check, so plan the next fold after it.
- River fixes in release 79: PM-01 vs CAL-01 clashes (dispatch-work.ts, publish.ts); the contradiction between PM-01's and CAL-01's tests is settled in PM-01's favour for now: CAL-01's reactivation (item 7, dispatch-work.ts) and its first test are left out, its pause fix stays (returns/cal-01.md has the exact contradiction for Sean or the lane); PM-01's saved-copy date bump reverted (CAL-01's test needs the copy left alone; nothing of PM-01's depends on it); migration references renumbered to 0049; River's rename had rewritten a READY subject in tests/river.test.ts (restored); pnpm install after the postgres dependency.
- DG-01 sent back (returns/dg-01.md): not one test clash. It deletes the Avondale-specific held-event code that CAL-01 item 4 builds on (HELD_EVENT_URL_PREFIXES, heldEventContract in scripts/freshness-shadow.mts and tests/legacy-activity-reads.test.ts) and conflicts with CAL-01 item 1's readStateCalendars in scripts/ingest.ts, plus tests/worker-fleet-standing.test.ts. Needs the lane to merge main and reconcile.
- Branch deletion: stream/tx-01 and stream/lk-01 (final, in main) cannot be deleted from this session; the proxy refuses it. Nothing else qualifies.

## Live check after release 79 (4:11 to 4:35 AM EDT)

- Voting at street addresses: Los Angeles 1,077 places and pins; Houston 697; Atlanta 40 (was 41); Milwaukee 1; New York 1; Lansing 14. None: Columbus, San Francisco, Lansing at 2500 S Washington Ave. 0.7 to 2.6 s.
- Ballot pages 94110 and 43215: 2.1 s and 1.2 s; 28 and 16 contests.
- Vice President in AZ, TX, NJ, OH, CA: still missing. AZ's first read after the deploy 3.4 s.
- Runner: 24 state cycles since midnight UTC, all SUCCEEDED, none FAILED, on releases 72 to 78.
- Alabama findings in the Box (subject starting al:), 4:15 AM EDT: built 970 (was 0 at 10:35 PM EDT), refused 27, waiting 15,698. Sean's Huntsville fix and the later releases are building findings.

## Live check after release 78 (2:07 to 2:15 AM EDT)

- Voting at street addresses: Los Angeles 1,077 places and pins; Houston 697; Atlanta 41; Milwaukee 1; New York 1; Lansing 14. None: Columbus, San Francisco, Lansing at 2500 S Washington Ave. 0.7 to 1.8 s.
- Ballot pages 94110 and 43215: 2.5 s and 1.7 s; 28 and 16 contests.
- Vice President in AZ, TX, NJ, OH, CA: still missing. AZ's first read after the deploy 3.6 s (over three seconds).
- Runner: 17 state cycles since midnight UTC, all SUCCEEDED, none FAILED, on releases 72 to 77.

## Live check after release 77 (10:30 to 10:40 PM EDT)

- Voting at street addresses: Los Angeles 1,077 places and 1,077 pins, Houston 697 and 697, Atlanta 41 and 41, Milwaukee 1 and 1, New York 1 and 1, Lansing 14 places (13 pins; before release 73 there were no pins anywhere). No places: Columbus, San Francisco, Lansing at 2500 S Washington Ave. Responses 0.7 to 3.3 s (first Los Angeles lookup after the deploy 3.3 s).
- Ballot pages 94110 and 43215: 1.8 s and 1.1 s; 28 and 16 contests (94110 was 18 before release 76; not traced).
- Vice President in AZ, TX, NJ, OH, CA: still missing, President only. Open.
- First reads after a deploy over three seconds: /api/reader/state 3.4 s (AZ) and 3.5 s (OH) after release 77. Open under the three-second rule.
- "Checked 20747 days ago" for places with no held meetings: still there; suggested task queued.

## Runner (cp_log_owner_digests, per state)

- Release 71: 9 states SUCCEEDED, 48 FAILED (IdentityCollision). Since DT-01's migration (5:58 PM EDT): 13 state cycles, 13 SUCCEEDED, 0 FAILED, on releases 72 to 76. DT-01_expand: 4404 debts given their state.
- Still not healthy: the fleet round digests say "3 states completed, 54 failed" (STATE_PLANNING_FAILED, no reason shown), and the routine civic data supervisor still ends FAILED every five minutes on release 75: RCD_MEETING_PARTITION_RECEIPT expected and not observed; PRL_ARCHIVE_S3_NOT_CONFIGURED; legistar-outcomes-ingest client missing; a database error (pl_exec.c). The "five-digit ZIP" line is gone.
- Alabama findings in the Box (cp_box_findings, subject starting al:, 10:35 PM EDT): built 0. Waiting 15,131: 11,063 with no reason recorded yet (not looked at), 3,095 TAKES_WHOLE_RECORDS_ONLY, 875 SUBJECT_HAS_NO_BODY_IN_THE_FACT_STORE, 98 NO_READER_FIELD. Of the 875, 644 end in #governing or #board (what Sean's fix lets through) and 231 are #body: committees (stay held). Across all states 423 built and 438 refused, newest finding recorded October 9; nothing built since. The publisher has not yet run on release 77's code; recheck after the runner's next box publication pass.

## Waiting on a new READY

- Nothing READY among the streams I scanned; none sent back.

## How River works

Per fold: claim the lock, fold the exact READY, merge main in, number migrations, run pnpm gates once, promote, release PR with run-full-ci, merge by hand when green, check /api/build, run the observer. Live before/after record with tools smoke.py (street addresses for voting checks; Google has no places for Houston, Columbus, New York, Orlando, Philadelphia, Seattle). Native auto-merge stays off. No automatic revert outside Sean's release process. Production database access is read-only.