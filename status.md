# River status

build_state: LIVE FOR READERS: release 122 (main 560cc2aa2, DB-03 reads). GATING: improvement batch 1 (AD-01, GB-01, MT-01, MD-01) on river e58835856. HELD for DB-04: DB-03's remaining steps and owner snapshot reads. See 'Every READY not on main'
worker: claude-river
provider: Claude
run_id: session_01KQeVtrq9c4dWXSpaNnogn3
lock: session_01KQeVtrq9c4dWXSpaNnogn3
heartbeat: 2026-10-26T02:21:00Z


<!-- READY-LIST -->
## Every READY not on main (updated 1:00 AM EDT Oct 26)
Rules (Sean): a release carries one lane only when it's urgent (Neon cost, runner crash, another cost spike, readers losing critical info); improvements merge several to a release (6:05 PM). One path per job: DB-03's remaining steps wait for DB-04 (10:00 PM). The drain fix ships alone, ahead of DB-04 if both are ready (12:40 AM).

**Urgent, ships alone**
| READY | Lane | Slot |
|---|---|---|
| f27aff5a8 (stream/river-drain; READY commit after the full gate) | Drain fix: a pending restart closes standing admissions on the standing clock | Full gate running (river-next-drain). Ships alone first, as release 124; batch 2 becomes 125 |
| DB-04 (not posted yet) | One read-only-what-changed path for every read | Ships alone the moment it posts READY, after the drain fix |

**Improvement batch 2: gate 9/9 on river-next-batch2 d941c6a89 (10,080 pass, 0 fail). Held behind the drain fix and the Idaho diagnosis; re-folds onto river after the drain fix ships**
| READY | Lane | State |
|---|---|---|
| c8734c5d8 (carries a13baecf8) | RT-01 (place-map jobs fill every state) | READY, River. Dropped 5 tests for code release 118 deleted |
| 8daccccb3 | MD-01 docs out | READY, deletes MD-01's 14 docs files |
| 5f28a6871 (carries c3fff3702) | BL-02 (current LegiScan session per state, sponsors matched to held legislators) | READY, River. No new bypassCache; 4 proof files out |
| 7dc32db25 (carries 04681516c) | DB-03 Admin (Admin's own screens) | READY, River. 734/734 focused |
| f856197dd (carries 0f8d6154c, 7996ae820) | RB-A7 (ready place pages; GB-01's held names reach them) | READY, River. Proof files out; Node 22 isolation flag fixed |
| stream/river-cs-01 (in progress) | CS-01 (reader-text capitals), 39238a8be | River's builder finishing it onto batch 2; joins batch 2 if READY before batch 2 re-gates, else the next batch |

**Waiting, with the reason**
| READY | Lane | Why it waits |
|---|---|---|
| e4305907d, 6f0652479, 7e81c1452, 407e02a1d, f81db4b37, 18df1421b, 2600aecdc, ef74ed82e, 11072d2ed | DB-03 state doors, research reads, accounting, research indexes, member offices, people source fields, runner doors, linking-page integration, read-path connection | Held for DB-04 (Sean, 10:00 PM EDT): DB-04's single read-what-changed path replaces most of these. Not folded until DB-04's READY says which it replaces |
| a0cb7d1ef (with its firewall fix 3e3f1ab33) | DB-03 owner snapshot reads | Held for DB-04, same reason. Its gate was stopped at 10:00 PM EDT |
| 7b5eacd03 | RB-A10 | Held: place_boundary, zip_place and zcta_place have 0 rows in production (RT-01 fills them). Ships when every state has rows and 20 random ZIPs in 20 states resolve |
| be0bef2bf | RB-A3 follow-up | Not needed after RB-A8: it only splits RB-A8's shared publication counter into official and checked in Admin (one more count write per live fact; readers see nothing). Not folding unless Sean wants that split |
| 1307d4e03 | RN-03 handoff | No code: an acceptance note for RN-03 (release 103, live). River records a reader check in Chrome; nothing to fold |
| 2cce7754c, 9c2b0c58a | DB-03 portraits / release-118 integration | Not folded at Sean's order (one portrait path: release 120's) |

**Superseded (a later READY of the same step is on main; not folding)**
2769c614e DB-02 (re-cut as e0f14fe59, release 121) · 8b69f0cbf DB-03 reads (finished as de764a119, release 122) · bb948717e (inside 3e3f1ab33) · 14dd8beb0 BL-02 (c3fff3702 replaces it) · 8ad77b9d5 VS-07 (vs-07-fx f48331d9d folded Oct 23) · 04dfa4caf DG-01-FX (DG-01 folded with DG-02 e6745c664, Oct 23) · 027144fa1 BS-01 (folded with RS-02 adee07352, Oct 19) · 61f6d1449 SL-02 and f42bc19c6 NE-01 (folded with DS-01 512e65e03, Oct 22) · 6da1efc6b STEP-7 (Oct 15, 1,345 behind) · 91f23e059 DB-29 (Oct 6) · CH-23/CA salvage copies 544e20323, 3cbb51190e, 0fc6ef6d2, 48ef946cd and the Oct 5–6 salvage-river-next branches (those steps folded Oct 6–13).
| 526da8d5a | AD-01 fix (River), rides batch 1 | READY 10:57 PM EDT: fixes the 2 batch 1 test failures; 4/4 in the two files |

**Not folding (each with its disposition; Oversight's branch audit, 12:55 AM EDT Oct 26)**

| Branch / commit | What it is | Disposition |
|---|---|---|
| stream/ba-02 7f7cf6bd8 (Oct 23, 5 commits, no READY) | Ballot questions, voting limits, election absences for 16 states and territories | Mostly already on main: contest, candidacy, measure and vote-for counts match main in 14 of 16 files (CL-01, BA-01 and MD-01 carried them). Still missing from main: Guam's 2026 ballot (6 contests, 48 candidates; Guam 96913 shows a near-empty ballot page today), Puerto Rico's election-absence note, and a source citation behind each vote-for limit (298 SC contests and the rest). Proposed future lane BA-03: re-cut just those three onto river, evidence files out. Sean decides. |
| stream/eo-01 5a0dcb21f (Oct 23, WIP) | Local election offices and county/town lookup | Kept for the Concord polling-place fix (Concord 03301 still shows New London's polling place). That fix never started because its prompt was named VS-05, a name an Oct 21 lane already used. Needs a new lane name to start. |
| stream/nb-02 7b6a7f9f8 (Oct 23, WIP) | Narrower routine control reads | DB-04 reads it; not folded on its own. |
| stream/pb-01 f5e5f8a38 (Oct 23) | Nationwide replay; readiness blocked | RB-A9 reads it; not folded on its own. |
| CS-01 39238a8be (READY, lane not running) | Reader text casing (no forced capitals, given names, PND party labels) | River finishing it onto batch 2 on stream/river-cs-01, docs/cs-01.md left out. Rides the next improvement batch. |
| RB-A2 draft PR #822 | Per-state place-map turns | Same fix as RT-01. One path: RT-01 ships in 124; #822 stays unfolded. 24 h after 124 is live, River reports place_boundary, zip_place and zcta_place rows by state. Any state still empty: River says why and re-cuts RT-01 with #822's per-state turn approach. Now: 0 / 0 / 0 rows. |
| stream/runner-headroom a4cee564a (RH-01, Oct 20 WIP) | Installer and FEC memory floors | Replaced by the rebuild. Not folding. |
| stream/steps-2-6 3bfabfa8a (PL-01, Oct 17 WIP) | Per-state publisher sizes | Replaced by the rebuild. Not folding. |
| stream/hunter-v2 af8acfe29 (H-01, Oct 17 WIP) | Hunter scale fixes | Replaced by the rebuild. Not folding. |
| stream/meetings-place fd48ea86b (Oct 16 WIP) | Meetings place body scope draft | Replaced by the rebuild (MT-01 shipped in 123). Not folding. |
| stream/fetcher 805c46b83 (R4, Oct 16) | Unified source fetcher | Replaced by the rebuild. Not folding. |
| stream/measures 0c1325a5e (MS-01, Oct 16 WIP) | Measures evidence wrappers | Replaced by the rebuild. Not folding. |
<!-- /READY-LIST -->

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

### Release 115 live, 8:40 AM EDT (main 61d7ecc06: MD-01)
- Reader checks pass:
  - /ballot 85701 and 03255: 200, no console errors.
  - Ask on 85701: grounded.
  - /api/meetings: 85701 442 id fields, 60602 615.
  - /national: 200.
- Random ZIPs, seed 1115: 20/20 load and resolve to their county and city, across OR, NE, AK, CA, TX, VI, WV, MT, CO, GU, FL, UT, IN, PA, OH, AZ, OK, DE, MI and TN.
- What it changes: the measure explanation writer reads the measure's passages instead of whole sources, at lower model cost.

### 8 AM EDT
- Live for readers: release 114 (RB-A6, since 7:03 AM EDT). Reader checks green.
- Gating: MD-01 a7014d303 alone (release 115).
- CL-01 returned at 7:45 AM EDT and reposted READY 69ca09c83 at 7:34 AM EDT; it folds after MD-01.
- Since midnight EDT these reached readers:
  - meeting calendars launch again (110, 112);
  - the Box publishes without timeouts (111);
  - voting doors no longer carry their linking pages (113);
  - hunters get each place's missing fields with what is held (114).
- Owed: cp_doors bytes per hour after DB-03A (about 9 AM EDT).
- FOR SEAN: lanes for member-offices and scheduler history reads (Neon), and for place-scoped voting doors shown county-wide (03301 Concord shows New London).

### 7 AM EDT: release 114 live, 7:03 AM EDT (main 0e3cdce42: RB-A6)
- Reader checks pass:
  - /ballot 85701 and 03255: 200, no console errors.
  - Ask on 85701: grounded.
  - /api/meetings: 85701 442 id fields, 60602 615.
  - /national: 200.
- Random ZIPs, seed 1114, across AK, OR, SC, MD, MA, IL, NH, NE, ME, KY, ND, VT, WI, PR, GA, SD, WY, FL, DC and NJ:
  - First run at 7:04 AM EDT: 19/20 loaded and 20/20 resolved to their county and city.
  - The same 20 at 7:10 AM EDT: 20/20 loaded.
  - The one miss was transient, right after the release went live. The check did not name it; it now prints every failing ZIP.
- What readers and hunters gain: hunters receive each place's missing fields with every held value, source and checked date.

### 6 AM EDT
- Live for readers: release 113 (DB-03A, since 6:13 AM EDT).
  - Reader checks green; polling places intact.
  - Voting doors no longer carry their linking pages (393 MB to 27.5 MB).
- Since midnight EDT these reached readers:
  - meeting calendars launch again (releases 110 and 112; 239 reads and 6,337 new meeting facts in the 4 AM hour);
  - the Box publishes without timeouts (release 111; 293 built in the 3 AM hour);
  - DB-03A.
- Next: RB-A6 (gating), then the queue by arrival. New READYs: DB-03 linking-page integration, RN-03 follow-up, MT-01 ed1b600aa.
- Owed: cp_doors bytes per hour after DB-03A (about 9 AM EDT). FOR SEAN: lanes for member-offices and scheduler history reads (Neon), and for place-scoped voting doors shown county-wide (03301 Concord shows New London).

### Release 113 live, 6:13 AM EDT (main 0c8f1ee0e: DB-03A)
- DB-03A_expand applied at the production build, 6:11:50 AM EDT: 493 saved linking pages; 1,521 voting doors; 0 doors read again under the lock; no authority changes.
- Voting doors' votingSource and votingMappings text: 392.7 MB to 27.5 MB (93% less for every voting-door list read).
- Reader checks pass:
  - /ballot 85701 and 03255: 200, no console errors.
  - Ask on 85701: grounded.
  - /api/meetings: 85701 442 id fields, 60602 615.
  - /national: 200.
- Random ZIPs, seed 1113: 20/20 load and resolve to their county and city, across NC, AK, UT, OR, DE, WA, NJ, GU, OH, TN, NE, NV, FL, SC, NY, NH, MS, CT, MD and LA.
- Polling places after the move (POST /api/voting-sites): 85603 Cochise County 23 sites (the 5 drop boxes and 18 vote centers); 79901 El Paso County 123; 03301 1 site under "New London".
  - 03301 is Concord, yet it shows New London's polling place. Not from DB-03A: door vs04-nh-new-london came with VS-04 on Oct 21 and DB-03A left it unchanged. The door is scoped to place:new_london_town in Merrimack County (countyFips 33013), and the ZIP lookup matches at county level, so every Merrimack County ZIP is shown another town's polling place.
  - FOR SEAN: this needs a lane, so a place-scoped voting door shows only for that place's ZIPs. NH runs elections by town, so the same pattern is likely for every NH and New England town door.
- cp_doors bytes per hour after DB-03A: measured once the runner has run 113 for 2 full hours (about 9 AM EDT), against the baseline of 731 MB to 4,960 MB an hour, 2.6 to 3.6 GB an hour overnight.

### Meeting calendars are back, 4:50 AM EDT (Sean's 11:10 PM order; counts only)
- Meeting reads (first attempts) per ET hour: 8 PM 57, 9 PM 94, 10 PM 3, 11 PM 22, midnight 14, 1 AM 43, 2 AM 145, 3 AM 123, 4 AM 239 by 4:48.
  - At or above the 8 PM-hour rate since 2 AM; 4 AM is in the daytime range (108 to 374).
- New meeting facts per ET hour: 2 AM 5,052, 3 AM 1,616, 4 AM 6,337. Above 1,000.
- Publish-now passes launch meetings again:
  - 4:00 AM and 4:09 AM EDT (still release 111) attempted 60 and 74 meeting boards; every pass before attempted 0.
  - 4:37 AM EDT on release 112 attempted 157.
  - Some passes still defer boards ("State calendar read remains due"), so there is more to gain. The next wait before launch is the 41 to 139 s segment of clocks and decisions.
- Routine passes now carry 5 to 8 meetings beside 20 to 24 voting-site programs. Voting sites still refresh every pass.
- DB-01's read savings cannot be measured honestly. The reader's per-database counter (database_transfer_hourly) starts at 9 PM EDT Oct 24, just as release 106 reached the runner, so it holds no before-106 reader number. cp_vital_signs holds control-plane bytes only.
- What the runner moves now (database_transfer_hourly, ET):
  - control plane 5.0 to 6.5 GB an hour (2:30 to 4 AM: 5.2, 5.3, 5.2 GB);
  - reader 2.6 to 7.3 GB an hour;
  - together about 8 to 12 GB an hour.
  - For comparison, Oct 24 2 to 6 PM: control plane 1.2 to 1.7 GB an hour.
- Control-plane growth since then:
  - cp_doors 0.7 to 1.1 GB an hour became 2.6 to 3.6 (voting-source-publication; DB-03A takes the pages out);
  - scheduler reads about 0.6 GB an hour became 2.4: cp_work_items_history.readMany from coordinator.ts:442 and freshness-shadow.mts:1215, about 670 MB an hour together; owner snapshots about 440 MB; dispatch readOpen about 340 MB.
- Reader, last 3 h:
  - member-offices / civic_data_candidates 1.58 GB in 675 calls (about 2.3 MB a call);
  - routine-civic-data / civic_data_candidates 270 MB;
  - member-offices / STATE_LEGISLATOR events 256 MB;
  - publish-now / civic_data_promotions 230 MB;
  - google-civic-voterinfo 224 MB plus 217 MB;
  - reader-readback inventory / payload parts 195 MB (DB-03's inventory-readback removal deletes this phase);
  - people-portraits (ME, TX, PA) about 190 MB each.
- FOR SEAN: at 8 to 12 GB an hour the runner alone moves 190 to 290 GB a day. DB-03A (cp_doors pages) and DB-03 (inventory readback) are next in River's queue. member-offices and the scheduler's history reads have no lane yet.

### RV-BOX proof, 4:08 AM EDT (Sean's 12:15 AM order; counts only)
- boxDue timeouts: 0 in all 7 publish-now passes on release 111 (3:14, 3:23, 3:30, 3:36, 3:45, 3:52 AM and 4:00 AM EDT) and in both routine passes. The proof asked for 0 over 3. Met.
- Box built per ET hour, against the baseline (27 to 364 an hour from 4 PM to midnight, about 115 average): midnight 120, 1 AM 166, 2 AM 232, 3 AM 293 (the first full hour on 111), 4 AM 51 by 4:07. Up 2.5 times on the baseline average.
- The rise began before 111 (failures also stopped at 2:32 AM on 110), so not all of it is RV-BOX. The rest is held by each pass's own cap of 1,000 findings and about 200 s; release 112 now runs Box beside the source pass. River watches the next hours.
- Built by state, last 3 h: AK 150, VT 130, DE 112, WY 40, IA 40, MA 38, AR 38, ID 31, DC 27, FL 26, KY 24, GA 20, AL 13, CT 10, CA 8, CO 7, MD 6, HI 5, AZ 4, WI 3, IN 3, ND 1, SC 1, TN 1, IL 1, KS 1, AS 1, MS 1.
- Waiting: 352,849, down by 0 net; new findings arrive about as fast as they are built.

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

### 9 AM EDT status
- CL-01 69ca09c83 passed alone: 9 of 9 gates, 9,932 tests, 0 failing. Both replay tests it was returned for now pass. River moved to c0205d49f. Release 116 is PR #828 (tree identical to river, auto-merge on). Reader checks run within 5 minutes of /api/build showing it.
- RB-A4 624ac2d3d gating alone on river-next 3aef51fa3. Sean's count is done: readers lose 0 facts to a portal withdrawal (the raw UPDATE that would have pulled up to 99,690 in 43 states is deleted). RB-A7 folds after it.
- DB-03A proof (Sean, 1:20 AM: "give cp_doors bytes per hour before and after"). From cp_vital_signs.neon_bytes_by_caller on the control plane, one small read. DB-03A went live with release 113, migration at 6:11 AM EDT.
  - Before (7 PM to 5 AM EDT): cp_doors 2,220 / 3,606 / 4,239 / 4,960 / 3,219 / 2,373 / 3,568 / 3,596 / 2,869 / 3,135 / 3,297 MB per hour. voting-source-publication.ts:41 alone was 950 to 1,775 MB/h.
  - 6 AM hour (live mid-hour): 1,573 MB.
  - After: 7 AM 599 MB, 8 AM 382 MB. voting-source-publication.ts:41 is 195 and 215 MB/h. Callers at registry.ts:385, :406, outcome.ts:38 and voting-source-publication.ts:194/:202 fell to 0 or near it.
  - Control-plane total: 4.8 to 8.4 GB/h overnight, now 3.2 GB (7 AM) and 1.6 GB (8 AM).
  - The runner was on release 114 (0e3cdce42, which contains 113's 0c8f1ee0e) for the 6, 7 and 8 AM hours, and on 113 for 5 AM.
  - What's left on cp_doors: voting-source-publication.ts:41 (~200 MB/h) and platform-census.ts:85 (126 to 183 MB/h, same as before DB-03A).

### Release 116 live, 9:31 AM EDT (main 1d2ac473a: CL-01)
- PR #828 merged at 9:29 AM EDT. /api/build showed 1d2ac473a at 9:31:55 AM; checks ran right after.
- Fixed set: /ballot 85701 and 03255 at 200, loaded, 0 console errors; Ask on 85701 at 200; /api/meetings 85701 and 60602 at 200; /national at 200, 0 console errors.
- Random ZIPs, seed 1116: 20/20 load (ballot 200, meetings 200). All 20 resolve to their county and city, across IN, AK, OH, VT, MO, TN, DE, FL, TX, IL, WI, OK, NC, AR, ME, NY, MN, VA, VI and WV.

### Release 117 live, 11:12 AM EDT (main 03e0526b6: RB-A4)
- Fixed set: /ballot 85701 and 03255 at 200, loaded, 0 console errors; Ask on 85701 at 200; /api/meetings 85701 and 60602 at 200; /national at 200, 0 console errors.
- Random ZIPs, seed 1117: 20/20 load, 20/20 resolve to county and city, across AK, AR, NM, FL, WY, PA, CA, MD, NJ, MN, WA, GU, HI, TX, NV, SC, VA, ND, KY and DC. (Guam 96919's page is thin, 412 chars, as before.)
- Migration: entity_place.placement_basis exists in production, default 'SERVICE_AREA'.

### Sean's reorder, 11:15 AM EDT: Neon first, then the place map
- I stopped the RT-01 gate run partway through. RT-01 now folds after the five DB-03 fixes.
- The DB-03 READYs sit in one line on the lane: Admin 04681516c, then state doors e4305907d, then inventory readback f2d76ac1f. To ship readback first, River cherry-picked f2d76ac1f alone onto river (-x records the source). One conflict: scripts/routine-civic-data-runner.mts kept RV-MEET3's `await heldPublication` and dropped the removed readback's `readerRuns`. tsc clean.
- Baseline, from database_transfer_hourly on the reader DB, response bytes by job, MB per hour, 5 AM to 10 AM EDT:
  - total: 7,157 / 8,520 / 12,508 / 9,979 / 9,030 / 13,925
  - reader-readback: 55 / 625 / 2,759 / 1,147 / 593 / 2,931 (average 1,352)
  - people-portraits: 396 / 804 / 3,528 / 4,414 / 3,139 / 6,001
  - research-cycle: 1,074 / 1,970 / 2,055 / 876 / 1,873 / 2,488
- FOR SEAN: people-portraits is the biggest reader (6.0 GB in the 10 AM hour), and none of the five DB-03 fixes in the order targets it.

### RB-A4 is live but readers don't see it (Sean, 11:45 AM EDT). Answer, 12:05 PM EDT
**Did the placements get written? Mostly not yet.** RB-A4 files boards and special districts when the runner reloads a state's registration entities, and the runner reloads one state per pass (fact_store_load shows about one state an hour). RB-A4 changed the load hash, so all 56 states are due. Since release 117, only Washington has reloaded (11:40 AM EDT). It gained 1,394 host-county placements; HOST_COUNTY rows nationwide are 1,400, and Oregon, Texas and Vermont have 0. Oregon was about 45 passes away. RB-A4's proof ran the import for all 56 states at once in a copy, so it never showed the rotation.

**Would Portland change once Oregon reloads? Not its governing bodies.** Pages read what they're given. The gap is that the bodies don't exist:
- City of Portland, Multnomah County and Portland Public Schools are held as governments (the page lists all 3), but none has a body record. Their council, county board and school board are not held, and Oregon's runtime registry has 0 bodies.
- Derived governing bodies (one per Census government, from lib/registry/derive.ts) reach a state's registry only through national place work. That runs only for ZIPs in the place scopes you send from Admin: today 79 ZIPs, all in Arizona (Pima, Cochise, Pinal, Graham, Greenlee). Runtime registries hold bodies only for AZ (734), NH (650) and NJ (693). The other 53 states hold 0.
- "Oregon's boards": all 72 bodies filed at Oregon's state level are Metro boards. 66 are LA Metro's (webapi.legistar.com/v1/metro: Crenshaw, 2028 Olympics), wrongly filed under Oregon, and 6 are Oregon Metro's. No Oregon state board is held. RB-A4 withdrew LA Metro's calendar from Oregon, but the 66 board records are still filed under Oregon.

**Today, 20 random ZIPs in 20 states plus 97204** (/api/meetings, seed 2117; bodies / governing / governments listed):
OR 97204 Portland 13/0/3 (all Metro) · AK 99654 7/1/4 · OR 97413 0/0/1 · RI 02920 0/0/2 · DE 19808 0/0/2 · NE 68973 0/0/3 · HI 96732 59/0/2 · DC 20005 2/1/4 · UT 84020 6/1/5 · ID 83873 0/0/3 · IA 50644 3/2/4 · TN 38134 0/0/5 · NV 89437 0/0/2 · OH 44224 0/0/6 · KS 66085 0/0/5 · OK 73738 0/0/3 · VI 00802 1/1/1 · MN 56761 0/0/8 · MT 59214 0/0/6 · WI 54425 0/0/10 · WV 25915 0/0/2.
14 of the 20 random ZIPs show 0 bodies, while every one lists 1 to 10 governments.

**Fix 1, ready (RB-A4's own gap): READY b2bbdc183 on stream/rb-a4, queued right after the DB-03 readback release.** The runner keeps loading states in rotation, from its own cursor, until one is already current or the pass deadline arrives. RB-A4's placements then reach every state in about one pass, and an unchanged pass still reads one state. Tests: rb-a4-catch-up 3/3; tsc and eslint clean.

**Fix 2, needs Sean: governing bodies everywhere.** Smallest path that keeps the §3 standard: national place work publishes each Census government's derived governing body with its saved Census source. It is gated on Admin sends. Two ways:
- (a) You send every state (or Oregon first) in Admin. That's a setting, so no release, but it is your control.
- (b) River changes national place admission so Census-only derivation runs for every state without a send. That's a code release; paid hunting stays gated on sends.

Either way it's runner work, about 1.2 GB of memory per ZIP task, plus Neon reads, so I'd do it per state rather than per ZIP. My recommendation is (b), one state at a time, starting with OR.

**Done check after both:** Portland 97204 shows its governing bodies, and on 20 random ZIPs in 20 states each board appears on every place it is filed to (entity_place against the page), with counts by state.

### Noon EDT status
- DB-03 inventory readback (River fold 50bdec3ae) is gating alone on river-next f1b766d47; lint passed, tsc running. It ships alone on 9 of 9.
- Lanes: RB-A7 posted READY 7996ae820 and folds after the queue above (RB-A4 is in river). VS-05's only READY, fd1daab0a, is already in river, so nothing new from VS-05. DB-03, RT-01 and AD-01 have no new READYs.
- Neon, reader DB response bytes, 11 AM EDT hour: 11,372 MB total (10 AM: 13,925). Portraits 2,638, readback 1,810, research cycle 1,893. No DB-03 code is live yet, so this is still baseline.

### 1 PM EDT status
- DB-03 inventory readback: third gate run on river-next be0b41a4f. Lint, tsc and dead-code pass; tests are running. The second run had 9,907 pass and 0 fail, but dead-code failed on 4 exports and 2 constants the removal leaves. They are deleted (READY 235c6f837), and the lane's copy of the fixes is in returns/db-03.md.
- Lanes: no new READYs since noon (DB-03 11072d2ed, RT-01 a13baecf8, AD-01 69806d306, RB-A7 7996ae820; VS-05's fd1daab0a is already in river).
- Sean hasn't decided governing bodies yet: (a) Admin sends or (b) a code change to national place work.
- Neon, reader DB response bytes, 12 PM EDT hour: 11,648 MB total. Portraits 3,419, readback 1,545, research cycle 1,029. Still baseline: no DB-03 code is live.

### Sean, 1:15 PM EDT: fix 2 option (b), Census-only governing bodies for every state
- Lane GB-01 (builder, stream/gb-01, built on RB-A4 catch-up):
  - A runner step makes each Census government's governing body (`<government>#governing`, or `#board` for school districts) through lib/core/door.ts `door()` → `ensureGoverningBody`, one state at a time, Oregon first, with no Admin send.
  - Nothing goes to lib/registry or a runtime registry. Paid hunting stays gated on sends.
  - It also moves the 66 LA Metro boards filed under Oregon to California.
  - Ships after DB-03 readback and RB-A4 catch-up.
- Done when Portland 97204 shows its city council, county board and school board, and 20 random ZIPs in 20 states show governing bodies, with counts by state.
- Runner Neon before, database_transfer_hourly response bytes, reader DB + control plane, GB per hour, 5 AM to 12 PM EDT: 7.16 / 8.52 / 12.51 / 9.98 / 9.03 / 13.93 / 11.37 / 11.65, average 10.52.
- Correction: the per-job MB in the 11:15 AM baseline and the noon and 1 PM statuses counted both databases, not the reader DB alone. Totals and per-job numbers are unchanged; only the label was wrong.

### GB-01 READY 900dd1427 (stream/gb-01, built on RB-A4 catch-up), 2 PM EDT
- How a board is made:
  - Every Census government whose division lib/registry/derive.ts `slotsFor` gives a governing body (counties, cities, townships, school districts, dependent school systems) gets `<government>#governing`, or `#board` for school districts.
  - The board comes from lib/core/door.ts `door()` publishing the Census record's mailing address (`office_address`) and website (`homepage`, when present), loader lane, OFFICIAL. The door's `ensureGoverningBody` makes "<government> governing board" (or "school board"), files it under the government and places it where the government is.
  - Source copy: the attested Census of Governments 2022 file (sha256 3ef3d93c…).
  - No registry, runtime registry or promotion write; paid hunting is untouched.
- Runner: one state at a time, Oregon first, resuming inside a state from cursor `census-governing-bodies`. River gave it its own 10 minutes a pass, at 2 door calls at a time; the builder's version had fact maintenance's 1 minute, about two days for all states. Once every state is done, a pass costs one cursor read.
- Reader: coverage now shows a board that has a sourced fact but no source-given name, under its held name. Before, any board without a `name` fact was dropped.
- LA Metro: migration GB-01_la_metro_boards moves the 66 boards (host webapi.legistar.com/v1/metro) from Oregon to ca:special:los-angeles-county-metro-transit-authority (Census 142274, filed on LA County). Ids and facts stay, aliases stop second copies, and the 6 Oregon Metro boards stay. LA Metro's 7 Oregon doors are SUSPENDED (RB-A4), so nothing re-files them under Oregon.
- Expected new boards (repo files minus boards held): about 50,700. OR 481, CA 1,524, TX 2,553, IL 3,697, PA 3,133, MN 3,032, OH 2,986 … Territories 0: the Census of Governments lists none.
- Checks: gb-01-census-governing 5/5 and rb-a4-catch-up 3/3 with the CI loader; tsc, eslint and knip clean.
- FOR SEAN:
  - About 40,000 special districts get no board, by the `slotsFor` rule. Their Census records carry the same address and website, so turning them on is one line if you want it.
  - Follow-ups not in this lane: the moved boards' ids still start `.../state:or#body:`, so a later fact on one clears Oregon's reader cache, not California's. And 21 stateless bodies, ids `government:US-OR:cog:155003#body:...`, host metro, are left over from the old Oregon doors.

### 2 PM EDT status
- Release 118 (DB-03 readback, PR #830): build, standalone build, verify and admission pass; the test (affected) job is still running. Production is still release 117 (03e0526b6).
- RB-A4 catch-up b2bbdc183: gating alone on river-next 456454204, in the test gate. GB-01 1636195c9 follows it alone.
- Lanes: DB-03 posted READY 2cce7754c, "DB-03 portraits". It cuts the portrait job's reads: a replay on OK, WI and KY read 98.7 MB before and 7.6 MB after. It also carries River's readback test and dead-code fixes. It sits on top of the lane's line, so folding it brings every DB-03 step below it. River folds the DB-03 steps in lane order after GB-01: Admin, state doors, then the rest through portraits. No other new READYs.
- Neon, both databases, 1 PM EDT hour: 13,368 MB. Portraits 7,834 (59%), research cycle 1,043. Readback was 56: with no readback release live yet, that low figure comes from the runner, not from us.
- Time correction: the GB-01 entry's heartbeat said 18:20Z but was written at about 18:00Z. Times on this board now come from the clock.

### 2:20 PM EDT: Sean's portraits and member-offices order (relayed by River session session_012UDbgz3sjA8QN2m7CY78QS)
- Sean, 2:15 PM EDT, to the other River session: finish DB-03 portraits under the standing order and take member offices with it.
  - Portraits: skip a state when its inputs' promotion versions are unchanged and no photo is due; save once per 50+ people; resume after a deadline cut.
  - Member offices: only states whose lawmaker list changed; resume after a cut; once a day.
  - Ship right after DB-03 readback, ahead of RB-A4 catch-up. Stop when both are under 0.3 GB/h on the live runner.
- That session is building stream/river-portraits from river be0b41a4f. It supersedes DB-03's 2cce7754c, which River will not fold separately.
- New order: release 118 (readback, live now) → river-portraits → RB-A4 catch-up → GB-01 → DB-03 in lane order.

### Release 118 live, 2:19 PM EDT (main c7576d26e: DB-03 inventory readback)
- Fixed set: /ballot 85701 and 03255 at 200, loaded, 0 console errors; Ask on 85701 at 200; /api/meetings 85701 and 60602 at 200; /national at 200, 0 console errors.
- Random ZIPs, seed 1118: 20/20 load, 20/20 resolve to county and city, across AK, MN, HI, AL, NM, MT, NC, VA, WI, MO, NH, UT, PR, IL, MI, SD, TX, OH, IN and WY. (Puerto Rico 00751's page is thin, 445 chars, like Guam's.)
- Readback MB per hour saved: measured on the 3 PM and 4 PM EDT hours, the first two full hours after release, against the 5 AM to 1 PM EDT readback of 55 to 2,931 MB/h.

### 2:27 PM EDT
- RB-A4 catch-up b2bbdc183 passed alone: 9 of 9 gates on 456454204, 9,913 tests, 0 failing. River stays at be0b41a4f so river-portraits lands first. After it, catch-up is re-merged on top and re-gated.
- Pre-gating GB-01 1636195c9 on top of catch-up (77cdd6784) to find problems early. The real gate runs again on whatever river is then.

### 3 PM EDT status
- Release 118 (DB-03 readback) has been live since 2:19 PM EDT.
- river-portraits (other River session): no branch pushed yet. RB-A4 catch-up stays held behind it (9 of 9 on 456454204).
- GB-01's pre-gate on catch-up caught a tsc error in River's own budget change: release 118 renamed PASS_REPAIR_DEADLINE_MS to PASS_MAINTENANCE_DEADLINE_MS. Fixed in READY 1636195c9 (merges river be0b41a4f); 8/8 focused tests, tsc and knip clean. Pre-gating again on 68ebfa0aa.
- Lanes: no new READYs (DB-03 2cce7754c is superseded by river-portraits).
- Neon, both databases, 2 PM EDT hour (release 118 live from 2:19): 9,242 MB total (1 PM: 13,368). Readback 21, portraits 367 (1 PM: 7,834), member offices 1,525, research cycle 2,229. Portraits fell without a release; the runner just ran less portrait work this hour. Readback savings get measured on the 3 PM and 4 PM hours.

### 3:18 PM EDT
- river-portraits posted READY 3a45d44ab (cut from river be0b41a4f).
  - Portraits: skip a state with no changed input and no photo due; save every 50 people and at the end; resume after a deadline cut.
  - Member offices: only states whose roster moved; resume after a cut; a finished run waits a day.
  - Old paths deleted. No migration, no gate, receipt or score.
- Gating alone now. GB-01's pre-gate was stopped to free the build worktree; it reruns after.

### 3:20 PM EDT: portraits tightened (relayed by the other River session)
- Relayed from Sean, verbatim in part: "once we have a portrait for a person and it shows on the site, we never re-read it. Portrait work only happens for people who don't have one yet."
  - Each run starts from the people with no portrait.
  - It reads only those people's sources.
  - The recheck of shown photos is removed.
- The other session is building that as a follow-up READY on stream/river-portraits, on top of 3a45d44ab.
- River's order: 3a45d44ab ships as release 119. If the follow-up is READY by the time 119 is live, it goes next as 120. If not, RB-A4 catch-up and then GB-01 ship while it builds, and the follow-up takes the next slot after whatever is gating when it lands. That way the build machine doesn't sit idle on unbuilt work, and Sean's GB-01 order keeps moving.

### 4 PM EDT status
- river-portraits 3a45d44ab failed alone: 8 of 9 gates, 1 of 9,915 tests. tests/path-separator.test.ts flags `new URL(options.url).pathname` in the new tests/portrait-run.test.ts. Returned to the other River session with the exact fix; it posts a new READY, which becomes release 120.
- RB-A4 catch-up had already passed 9 of 9 alone on this same river (be0b41a4f), so it ships now as release 119 (PR #831): river moved to 456454204. GB-01 1636195c9 is gating alone on top of it (68ebfa0aa).
- DB-03 readback saving, first full hour after release 118: readback read 0 MB in the 3 PM EDT hour. Before, 5 AM to 1 PM EDT: 55 / 625 / 2,759 / 1,147 / 593 / 2,931 / 1,810 / 1,545 / 56 MB, average 1,280 MB/h. Saved: about 1.3 GB/h on average (0.06 to 2.9 GB/h by hour). The 4 PM hour will confirm.
- Neon, both databases, 3 PM EDT hour: 11,915 MB. Portraits 5,918 (still the biggest; release 120 targets it), research cycle 1,092, member offices 0 this hour.

### Release 119 live, 4:25 PM EDT (main f6f68db6b: RB-A4 catch-up)
- Fixed set: /ballot 85701 and 03255 at 200, loaded, 0 console errors; Ask on 85701 at 200; /api/meetings 85701 and 60602 at 200; /national at 200, 0 console errors.
- Random ZIPs, seed 1119: 20/20 load, 20/20 resolve to county and city, across SD, AK, CO, IN, KY, TN, ME, WV, NM, DE, GA, MI, VI, CA, MA, AL, GU, AZ, NY and TX.
- Placements so far: the old one-state rotation kept going while catch-up waited. 12 states reloaded since 11:40 AM (WA, WI, WV, WY, AK, AL, AR, AS, AZ, CA, CO, CT), and HOST_COUNTY rows rose from 1,400 to 14,641. Catch-up starts on the runner's first pass on release 119; its cursor routine-fact-entities-state isn't written yet. Oregon and the other 44 states should reload in that pass.

### 4:41 PM EDT: Sean's Neon-first order (relayed verbatim by River session session_012UDbgz3sjA8QN2m7CY78QS)
"River, Neon goes first from now on until it's issues are resolved, ahead of every other READY, rebuild included. Put river-portraits READY 9bf9801a5 next. If GB-01 hasn't passed all its gates yet, stop it and test portraits first. GB-01 adds about 50,700 boards through the runner, so it adds Neon reads, and it can wait one release. Portraits pulled 5.9 GB of the 3 PM hour's 11.9 GB. After portraits, ship any Neon fix that posts READY before rebuild work. When you fold DB-03's line, fold only up to the step below 2cce7754c (its old portraits fix), so one portrait path ships. Measure portraits and member offices GB per hour on the two full hours after release and tell me the numbers."
- Done: GB-01's gate was stopped in its test step (lint, tsc and dead-code had passed). 9bf9801a5 is gating alone on 456454204. It ships as release 120 if 9 of 9.
- Standing rule from now on: Neon fixes ship ahead of every other READY until Neon's problems are resolved. DB-03 folds only through 11072d2ed (read-path connection), the step below 2cce7754c.

### 4:47 PM EDT
- Sean (relayed by the other River session): build river-portraits from DB-03 2cce7754c's tested portrait code, not from scratch.
  - Remove the 7-day and Congress 30-day rechecks.
  - Resume after a deadline cut.
  - Ship one portrait path and delete the old one.
- So 9bf9801a5 is withdrawn and its gate stopped. The other session is rebuilding on river 456454204.
- Meanwhile, under Neon-first: DB-03 Admin 04681516c is gating alone. It cuts Admin screen reads; the lane's replay put each screen's first 60 s at 0.57 to 8.3 MB, against 9.6 to 16 MB sampled before. One conflict: app/api/admin/v6/owed/route.ts keeps river's RB-A6 body with DB-03's adminRead wrapper. tsc clean.
- If the portraits READY lands mid-gate, the Admin gate stops and portraits goes first.

### 4:48 PM EDT: reversal (relayed verbatim)
"River, ship 9bf9801a5 as release 120. Don't rebuild from DB-03's 2cce7754c. That prompt was only to save build time, and your version is already built with my never-re-read rule. Leave 2cce7754c unfolded, so one portrait path ships. Tell me when /api/build shows 120 live, then the portraits and member offices GB per hour for the two full hours after."
- DB-03 Admin's gate is stopped; 9bf9801a5 is gating alone on 456454204. Admin follows.

### 5 PM EDT status
- release 120 candidate, river-portraits 9bf9801a5: gating alone on ea117a0bb, in the test step.
- RB-A4 catch-up (release 119) on the runner: cp_vital_signs shows the runner on f6f68db6b from the 3 PM row (written 4:53 PM). The last reload before that was DC at 4:35 PM, under the old rotation, and the catch-up cursor isn't written yet. Its first pass on the new code should reload Oregon and the rest; checking at 6 PM. HOST_COUNTY rows: 14,648.
- DB-03 posted 9c2b0c58a ("release118 integration": 2cce7754c merged with river be0b41a4f). Not folded: Sean said to leave 2cce7754c unfolded, and DB-03 folds only through 11072d2ed.
- DB-03 readback saving confirmed: readback read 0 MB in the 3 PM and 4 PM EDT hours, both full hours after release 118, against a 1,280 MB/h average before (5 AM to 1 PM). About 1.3 GB/h saved.
- Neon, both databases, 4 PM EDT hour: 8,740 MB total. Portraits 1,666, member offices 1,402. That's before release 120; these are its before numbers.

### 5:30 PM EDT
- river-portraits 9bf9801a5 passed alone: 9 of 9 gates on ea117a0bb, 9,919 tests, 0 failing. River moved to ea117a0bb, and release 120 is PR #832 with auto-merge on.
- DB-03 Admin 04681516c is gating alone on top of it. Same owed-route conflict, resolved the same way.

### 5:40 PM EDT: DB-03 reads ahead of Admin (Sean, relayed verbatim in part)
- "ship DB-03 reads right after release 120 … It cuts the research cycle (1.49 GB in the 4 PM hour, both databases) and Open States votes (1.72 GB in the 3 PM hour). After release 120 is live, fold 8b69f0cb next, ahead of DB-03 Admin … Fold exactly 8b69f0cb … Confirm 2cce7754c doesn't come with it. When it's live, tell me research-cycle and openstates-votes GB per hour for the two full hours after."
- Checked: 8b69f0cbf's one parent is river 456454204; 2cce7754c, 9c2b0c58a and 11072d2ed are not ancestors. 23 files, no migration. The merge onto ea117a0bb is clean. Admin's gate was stopped; DB-03 reads is gating alone.
- Order: release 120 live → DB-03 reads → DB-03 Admin → state doors through 11072d2ed (stopping below 2cce7754c) → GB-01 → rebuild.

### 6:15 PM EDT: release 121 plan and its before numbers
- Sean (6:05 PM EDT, direct): one list of every READY not on main (above). Only urgent fixes ship alone; improvements merge several to a release. DB-02 is an urgent Neon fix: River re-cuts it on current river and ships it with DB-03 reads as release 121.
- DB-02 re-cut: READY e0f14fe59 on stream/db-02-recut, from river ea117a0bb. It applies 2769c614e's code (read-model.ts, store.ts readVersioned, runtime-data-plane.ts, the registry test) without docs/db-02-ready.txt, docs/measurements/db-02 or scripts/db-02-*. The one test change: a placeholder DATABASE_URL to construct the store. Focused 76/76; tsc, eslint and knip clean.
- Release 121 = river ea117a0bb + DB-03 reads 8b69f0cbf + DB-02 e0f14fe59, gating together on 801d5db65. It releases after 120 is live.
- Before numbers, MB per hour, both databases, database_transfer_hourly response bytes, 2 PM / 3 PM / 4 PM / 5 PM EDT:
  - research cycle: 2,229 / 1,092 / 1,493 / 1,264
  - Open States votes: 1,085 / 1,718 / 255 / 349
  - registry read at runtime-data-plane.ts line 784 (worker-publication reading civic_data_candidate_events; 806 MB in the 3 PM hour matches Sean's 0.81 GB): 756 / 806 / 787 / 1,168
  - portraits: 367 / 5,918 / 1,666 / 5,849; member offices: 1,525 / 0 / 1,402 / 716 (release 120's before numbers)

### 6 PM EDT status
- Release 120 (portraits and member offices) merged at 6:06 PM EDT and is deploying; reader checks run within 5 minutes of /api/build showing it.
- Release 121 (DB-03 reads + DB-02 re-cut) is gating together on 801d5db65.
- RB-A4 catch-up on the runner: its cursor routine-fact-entities-state is at AR. The new code runs, but by design it stops at the first state that's already current. AK through DC were reloaded today, so it walks one of them per pass, then reloads DE through VT (Oregon included) in one pass, about 6 passes from now (around 8:30 to 9 PM EDT). HOST_COUNTY rows: 14,663; Oregon: 24. I'm not shipping a release for this: it finishes on its own, and Neon comes first.
- Neon, both databases, 5 PM EDT hour: 10,990 MB. Portraits 5,849, member offices 716, research cycle 1,264, Open States votes 349, registry read (worker-publication / civic_data_candidate_events) 1,168.

### Release 120 live, 6:09 PM EDT (main 4687f6a00: portraits and member offices, never re-read)
- Fixed set: /ballot 85701 and 03255 at 200, loaded, 0 console errors; Ask on 85701 at 200; /api/meetings 85701 and 60602 at 200; /national at 200, 0 console errors.
- Random ZIPs, seed 1120: 20/20 load, 20/20 resolve to county and city, across MS, AK, WI, MI, MO, NM, PA, OK, MD, CO, IL, AR, WV, AL, DC, ND, SC, MT, TX and NV.
- Portraits and member offices GB/h are measured on the first two full hours after the runner adopts 120. Per the other River session, cp_runner_heartbeat at 6:11 PM EDT still showed testedSha f6f68db6 (release 119, RUNNER_BEHIND_EXECUTABLE), next cycle 7:11 PM. If it adopts then, the hours are 8 PM and 9 PM EDT. 12-ZIP check (other session): same portraits and office contacts after 120 as at 5:32 PM in all 12 states. Before: portraits 0.37 / 5.92 / 1.67 / 5.85 GB, member offices 1.53 / 0 / 1.40 / 0.72 GB, 2 PM to 5 PM EDT.

### Sean, 6:15 PM EDT: one River
- Sean closed the second River session (session_012UDbgz3sjA8QN2m7CY78QS). River no longer messages it or hands it work.
- Oversight measures release 120: portraits and member offices GB/h for the two full hours after the runner takes it, and portraits on 12 random ZIPs in Chrome.
- River keeps the folds, gates, releases, the READY list and release 121.

### 6:49 PM EDT: release 121 gate failed on DB-03 reads; DB-02 ships alone
- 801d5db65 (DB-03 reads + DB-02): 8 of 9 gates, 8 of 9,933 tests failed. Seven are in aggregate-list-pagination and one in admin-narrow-reads. They fail the same way on stream/db-03-reads 8b69f0cbf by itself: its revision-first list reads send SQL the tests' fake databases don't recognize. Returned to the lane (returns/db-03.md).
- DB-02 e0f14fe59 is gating alone on river ea117a0bb as release 121; both fixes are urgent and DB-02 passed its own checks. DB-03 reads ships next, alone, when it's fixed.

### 7 PM EDT status
- Release 120 has been live since 6:09 PM EDT; Oversight measures it.
- Release 121, DB-02 re-cut e0f14fe59 alone, is gating on ea117a0bb, in the test step.
- DB-03 reads 8b69f0cbf: no fix yet; River finishes it at 7:50 PM EDT if none lands. The lane's newer a0cb7d1ef (6:04 PM, before the return) is a separate owner-snapshot Neon fix built on 8b69 and doesn't touch the failing tests. Sean said to fold exactly 8b69f0cb, so a0cb7d1ef is listed as the next Neon fix after it.
- RB-A4 catch-up: cursor at AZ, one current state per pass. CA, CO, CT and DC come next, then DE through VT in one pass. HOST_COUNTY rows: 14,664.
- Neon, both databases, 6 PM EDT hour: 8,750 MB.

### 7:34 PM EDT: release 121 = DB-02 alone
- DB-02 re-cut e0f14fe59 passed alone: 9 of 9 gates on a37ce95a7, 9,922 tests, 0 failing. River moved to a37ce95a7; release 121 is PR #833 with auto-merge on.
- DB-03 Admin is gating next on a37ce95a7, while DB-03 reads waits out its 60 minutes.

### 7:53 PM EDT: River finishes DB-03 reads
- No new READY on stream/db-03-reads within 60 minutes of the return (it still holds 8b69f0cbf and its child a0cb7d1ef). River is finishing it on stream/river-db03-reads (river a37ce95a7 + 8b69f0cbf).
- The change: rewrite aggregate-list-pagination and admin-narrow-reads for the revision-first protocol (a bounded revision page, then values fetched by id). Each test keeps its promise, and a new check proves an unchanged table sends revisions only. No production code changes.

### 8 PM EDT status
- Release 121 (DB-02, PR #833): build, standalone build, verify and admission pass; test (affected) still running. Production is still release 120.
- DB-03 Admin is gating on river a37ce95a7 (test step). DB-03 reads is being finished on stream/river-db03-reads (test rewrite); it ships next, alone, when it lands.
- RB-A4 catch-up: cursor at CT. DC is next, then DE through VT in one pass. HOST_COUNTY rows: 14,666.
- Neon, both databases, 7 PM EDT hour: 5,476 MB, the lowest hour today (5 AM to 6 PM EDT ran 7.2 to 13.9 GB). Release 120 went live at 6:09 PM; Oversight measures portraits and member offices once the runner adopts it.

### 8:03 PM EDT: DB-03 reads finished
- READY de764a119 "DB-03 reads (River)" on stream/river-db03-reads (river a37ce95a7 + 8b69f0cbf + test fix). Only two test files changed, aggregate-list-pagination and admin-narrow-reads, now written for the revision-first reads. Each test keeps its promise, and a new test proves an unchanged table sends revisions only. 16/16 in those files; all 37 files that import pg-store or revision-reads 402/402; tsc, eslint and knip clean.
- Gating alone now. DB-03 Admin's gate was stopped for it.

### Release 121 live, 8:33 PM EDT (main 8664f367e: DB-02)
- Fixed set: /ballot 85701 and 03255 at 200, loaded, 0 console errors; Ask on 85701 at 200; /api/meetings 85701 and 60602 at 200; /national at 200, 0 console errors.
- Random ZIPs, seed 1121: 20/20 load, 20/20 resolve to county and city, across MA, DC, AK, MI, AR, ND, MT, UT, MS, SC, AZ, NV, WY, OH, NM, NJ, VT, CA, WA and ME.
- Registry read GB/h is measured on the first two full hours after the runner adopts 121 (cp_vital_signs release_sha), against 756 / 806 / 787 / 1,168 MB for 2 PM to 5 PM EDT.

### 8:48 PM EDT: release 122 = DB-03 reads
- de764a119 passed alone: 9 of 9 gates on e58835856, 9,934 tests, 0 failing. River moved to e58835856; release 122 is PR #834 with auto-merge on.
- Next Neon fix: DB-03 owner snapshot reads a0cb7d1ef (owner snapshot read 0.81 GB in the 4 PM EDT hour). Clean merge onto river; gating alone.

### 8:49 PM EDT: owner snapshot reads returned; DB-03 Admin gating
- a0cb7d1ef: preflight refused. The civic-data release firewall found an incremental-reads.ts filesystem writer made reachable from the routine (fetch-fec) and manual (promote-manual-civic-projection) paths. Returned (returns/db-03.md); River finishes it at 9:49 PM EDT if no new READY.
- DB-03 Admin 04681516c is gating alone on river e58835856.

### 9 PM EDT status
- Release 121 (DB-02) has been live since 8:33 PM. cp_vital_signs shows the runner on 8664f367e from the 7 PM row (written 8:47 PM), so the registry read is measured on the 9 PM and 10 PM EDT hours.
- Release 122 (DB-03 reads, PR #834): in PR checks. DB-03 Admin is gating alone on e58835856. Owner snapshot reads a0cb7d1ef is returned (firewall); River finishes it at 9:50 PM if no new READY.
- RB-A4 catch-up: one pass reloaded DE, FL, GA, GU, HI, IA, ID and IL before its deadline. The cursor is at IL, and IN through VT (Oregon included) come next. HOST_COUNTY rows rose from 14,666 to 22,162. Oregon still has 25.
- Neon, both databases, 8 PM EDT hour: 4,757 MB (7 PM: 5,476). Two hours ago the runner was on release 120.

### 9:37 PM EDT: DB-03 Admin returned
- 04681516c failed alone on e58835856: 3 tests (admin-google-signin break-glass order, hunt-stop pending controls, path-separator in admin-read.ts). Returned (returns/db-03.md).
- The rest of stream/db-03 is stacked on Admin and on readback (already shipped), so it can't fold step by step as-is. The lane is asked to re-cut the remaining Neon steps on current river.

### 9:39 PM EDT: improvement batch 1 gating
- No Neon fix is ready: owner snapshot reads is with its lane until 9:50, and the rest of DB-03 needs a re-cut. So the build machine starts the improvement batch, and a Neon fix that lands takes it first.
- Batch 1 = AD-01 69806d306 + GB-01 1636195c9 + MT-01 f26ebab8d + MD-01 f67ae6709, merged cleanly on river e58835856 (d7dd06466), gating together.
- RT-01, RB-A7 and BL-02 conflict with river and go to batch 2 (returns/improvement-batch.md).

### Release 122 live, 9:47 PM EDT (main 560cc2aa2: DB-03 reads)
- Fixed set: /ballot 85701 and 03255 at 200, loaded, 0 console errors; Ask on 85701 at 200; /api/meetings 85701 and 60602 at 200; /national at 200, 0 console errors.
- Random ZIPs, seed 1122: 20/20 load, 20/20 resolve to county and city, across TN, WA, AK, WI, IN, DE, PR, MS, NH, KY, MO, NM, SD, NY, GA, IL, HI, NE, MN and MA.
- Research cycle and Open States votes GB/h are measured on the first two full hours after the runner adopts 122.

### 9:50 PM EDT: owner snapshot reads fixed by its lane
- The DB-03 lane posted 3e3f1ab33 on river e58835856. A read-clock constant moved into a pure module, so the routine and manual paths no longer import incremental-reads.ts's filesystem writer; the firewall itself is unchanged. It carries a0cb7d1ef and fixture fixes (bb948717e). No migration; 2cce7754c and 9c2b0c58a are not included.
- Improvement batch 1's gate was stopped for it (Neon first); 3e3f1ab33 is gating alone. The 9:52 PM standing-order check was cancelled because the lane answered.

### 9:54 PM EDT: Sean, hold DB-03's remaining steps for DB-04
- DB-04 builds one read-only-what-changed path for every read and will replace most of DB-03's per-job fixes. Until DB-04's READY says which it replaces, River doesn't fold: state doors e4305907d, research reads 6f0652479, accounting 7e81c1452, research indexes 407e02a1d, member offices f81db4b37, people source fields 18df1421b, runner doors 2600aecdc, linking-page integration ef74ed82e, read-path connection 11072d2ed, or owner snapshot reads a0cb7d1ef (3e3f1ab33).
- The owner snapshot gate was stopped; improvement batch 1 is gating again on d7dd06466.
- DB-03 Admin 04681516c continues (it fixes Admin's own screens). It's returned with 3 tests; River finishes it at 10:36 PM EDT if no new READY. DB-04 ships alone the moment it posts READY.

### 10 PM EDT status
- DB-02 (release 121) saving, first full hour on the runner (9 PM EDT): the registry read (worker-publication / civic_data_candidate_events, the line-784 read) was 76 MB, against 756 / 806 / 787 / 1,168 MB per hour before (2 PM to 5 PM EDT). That's about 0.7 to 1.1 GB/h less. The 8 PM hour was already 252 MB, since the runner switched at 8:47. The 10 PM hour confirms at 11 PM.
- Release 122 (DB-03 reads) has been live since 9:47 PM. Research cycle and Open States votes are measured on the 11 PM and midnight hours, once the runner adopts it.
- Neon, both databases, 9 PM EDT hour: 5,525 MB.
- RB-A4 catch-up: 30 states reloaded since 4:53 PM (DE through OH). The cursor is at OH, so OR is next. HOST_COUNTY rows: 35,824 (this morning: 1,400). Oregon still 25.
- Gating: improvement batch 1. Held for DB-04: DB-03's remaining steps and owner snapshot reads.

### 10:21 PM EDT: Sean, finish batch 2 yourself; keep proof files out
- RT-01: READY c8734c5d8 on stream/river-rt-01 (batch 1's tree + a13baecf8). The conflict was only tests for code release 118 deleted: 5 dropped, the rest kept. 103/103 focused; tsc, knip, eslint and preflight clean.
- MD-01 docs out: READY 8daccccb3 deletes the 14 docs files (982 lines) MD-01 brought into batch 1. Batch 1 itself is untouched, so its gate keeps running.
- RB-A7 and BL-02: River's two builders are finishing them on stream/river-rb-a7 and stream/river-bl-02, leaving out RB-A7's docs/measurements/rb-a7 and BL-02's 4 proof files (including scripts/bl-02-bills-replay.mts), and turning BL-02's 3 bypassCache call sites into normal reads.
- The disk filled up around 10:12 PM EDT. River removed 11 worktrees of finished, pushed work. The batch 1 gate log shows no disk errors.


### 11 PM EDT status
- DB-02 saving confirmed on a second full hour: registry read (worker-publication / civic_data_candidate_events) was 85 MB in the 10 PM hour and 76 MB in the 9 PM hour, against 756 / 806 / 787 / 1,168 MB per hour before (2 PM to 5 PM). About 0.7 to 1.1 GB/h less.
- Neon, both databases, 10 PM EDT hour: 1,792 MB (9 PM: 5,525). Part of that drop is the research cycle not running (below), so it is not all saving.
- Release 122 not yet adopted by the runner. Its heartbeat still reports tested sha 8664f367 (121), verdict RUNNER_BEHIND_EXECUTABLE. 122 changes scripts/pilot-runner.mts, so the runner takes the drain-and-restart path. It starts no research cycle while routine-civic-data and publish-now finish. Last research cycle: 8:47 to 9:54 PM, ended with exit 1 (a JavaScript heap out-of-memory in a child, plus Neon 30 s request deadlines on civic_data_promotions). No research cycle since, so research cycle and Open States votes read 0 MB in the 10 PM hour. The 122 measurement starts on the first two full hours after the heartbeat shows 560cc2aa2. River rechecks the heartbeat each status. If the drain hasn't finished by midnight, it goes to Sean as a stalled runner.
- RB-A4 catch-up: cursor at WV, so OR has been reloaded. HOST_COUNTY rows: 44,217 (10 PM: 35,824). Portland's bodies get checked after batch 1 ships.
- Batch 1: first gate failed 2 AD-01 tests, fixed on 526da8d5a, re-gating since 10:58 PM.
- Batch 2 is assembled on c8d3983b8 with all five lanes READY (RT-01, MD-01 docs out, BL-02, DB-03 Admin, RB-A7). It gates as soon as batch 1 ships.
- DB-04: no branch yet.

### 11:42 PM EDT: release 123 opened
- Batch 1 re-gate passed 9/9 on 526da8d5a (9,995 tests, 9,990 pass, 0 fail, 5 skipped). river and river-next moved to 526da8d5a. release/123 (253c926c8, same tree as river) is [SeanJ22/meanwhile#835](https://github.com/SeanJ22/meanwhile/pull/835), auto-merge on. Live checks plus GB-01 checks (Portland 97204 and 20 random ZIPs in 20 states) run once /api/build shows it.
- Batch 2 gating on d941c6a89.

### Midnight EDT status
- Runner stuck on release 121, for Sean. The pilot-runner heartbeat (beat 12:01 AM) still shows tested sha 8664f367 (121), verdict RUNNER_BEHIND_EXECUTABLE. Last research cycle: 8:47 to 9:54 PM, exit 1, JavaScript heap out of memory plus Neon 30 s deadlines on civic_data_promotions. Its next cycle was due at 10:04 PM and never started: no research cycle for 2 hours. It isn't draining either. routine-civic-data and publish-now restarted under new pids between 11:03 PM and midnight (3433459 → 3601808, 3445215 → 3651207), so the runner never reaches the quiet point its drain-and-restart path waits for. pause is null. Routine work still runs.
- Why it matters: 122's research reads and GB-01's census step (release 123) both run on the runner. Until it restarts on new code, neither does anything for readers, and River can't measure either.
- Step for Sean, on meanwhile-runner after release 123 merges (minutes away, CI finishing): `sudo systemctl restart meanwhile-runner.service`, then `journalctl -u meanwhile-runner.service -n 60 --no-pager`. River confirms in the heartbeat that tested sha moves to 123's main commit and a research cycle starts.
- Neon, both databases, 11 PM EDT hour: 2,933 MB (10 PM: 1,792). Registry read 44 MB (10 PM: 85; before DB-02: 756 to 1,168). Research cycle and Open States votes: 0, not running.
- Release 123 ([#835](https://github.com/SeanJ22/meanwhile/pull/835)): CI tests 4/4, builds, verify and admission green; final gates job running. Auto-merge on.
- Batch 2 gate: lint, tsc, dead-code, preflight pass; tests running.
- DB-04: no branch yet.

### 12:10 AM EDT: Sean, every release gets a plain report
- Each release PR now comes with a report on the board (releases/<n>.md) and to Sean. It covers every lane with its READY commit, what it does and the prompt it came from; what Sean will see and where, before and after; expected Neon GB/h, measured over the two full hours after; and what could go wrong and how River will know. When the release goes live, River reports back against the same list.
- Written now: releases/123.md and releases/124.md.

### 12:20 AM EDT: release 123 live; Idaho ballot pages broken
- Live 12:06 AM EDT (d206ba79a). Fixed set passes. 20 random ZIPs in 20 states: 20/20 resolve, 19/20 load.
- Every Idaho ZIP's ballot page stops at about 33 s before its contests render (7 ZIPs tested; neighboring states fine). Not yet known whether 123 caused it. An agent is timing 122 vs 123 against production read-only. No revert without Sean's word.
- GB-01 shows nothing yet: the runner is still on 121 and the census step hasn't run. Restart still needed.
- Full report: releases/123.md.

### 12:45 AM EDT: Sean, the runner must never wait to restart
- Sean restarted meanwhile-runner.service at 12:10 AM. The heartbeat shows a new pilot-runner process (pid 3693993) with routine and publish-now running on 123. No research cycle has started on 123 yet (last one: 8:47 to 9:54 PM). A watcher reports the first start and finish.
- Fix on stream/river-drain f27aff5a8 (not READY yet; full gate running in wt-build on river-next-drain). The runner looked for a new release only at research-cycle boundaries and during an active cycle, so with no research running nothing closed admissions, and routine and publish-now kept relaunching. Now the standing clock inspects the release every minute. A release that loads only by restart closes standing admissions; runs already started end by their deadlines; research ends its current wave; the main loop's sleep and pause wake at once to install and exit. requestQueuedReleaseDrain and the unused sleep helper are deleted. No new gate.
- Real-case test (tests/runner-pending-restart.test.ts): real lane scheduler and real child processes. Routine children finish and relaunch every 40 ms tick; publish-now's child would run 60 s past its 1.5 s deadline. After the release appears: 0 new launches, the main loop's sleep woke within 400 ms, and the runner exited to restart 943 ms later (within the 1.5 s pass deadline). With the standing-clock check removed, the test fails. Focused runner tests 150/150; tsc, eslint, knip clean.
- Runner GB/h before (database_transfer_hourly, both databases): 7 PM 5,476 MB, 8 PM 4,757, 9 PM 5,526 (normal hours). 10 PM 1,792 and 11 PM 2,933 were low because research wasn't running.
- Release 124 (batch 2, gate 9/9 on d941c6a89) is held: the drain fix ships alone first, and Idaho's ballot timeout is being diagnosed.

### 1:00 AM EDT: Sean, every unfolded branch accounted for
- "Not folding" table added to the READY list (BA-02, EO-01, NB-02, PB-01, CS-01, RB-A2 #822, and the six Oct 16 to 20 WIP branches replaced by the rebuild).
- CS-01: a River builder is finishing it onto batch 2 (stream/river-cs-01).
- Place map, one path: RT-01 in 124. Rows now: place_boundary 0, zip_place 0, zcta_place 0. Rows by state get reported 24 h after 124 is live.
- rebuild_queue: 1,423 now (Oversight counted 1,234 earlier). Reported every status after 124 is live, until RB-A7 drains it.

### 1:10 AM EDT: Idaho ballot pages, cause found (not release 123)
- Every Idaho ZIP's ballot page has stopped at about 33 s since at least release 122, and probably since release 108 (PT-01 portraits, Oct 25). Release 122 code hangs the same way; the code involved is identical in 122 and 123.
- Cause: the Oct 15 Idaho official-state-people promotion holds one record (Vito Barbieri) carrying 37 OpenStates people, because the publisher took the shared chamber membership page as everyone's profile URL. lib/photos/person.ts turns that into one 245-key identity and walks it for every officeholder and candidate card, about 1 to 2 s per walk, hundreds of times per Idaho page. It also gives Idaho legislators the wrong person's photo. Florida has one smaller collapsed record (Lori Berman, 9 ids).
- Fix on stream/river-idaho 82310c3b0 (15 lines): a record naming several people of a one-ID-per-person publisher links only its own ids. Real ballot build for 83702 against production read-only: never finished before, 7.4 s after (Utah 84101: 5.3 s before, 5.7 s after). New test reproduces the wrong photo and passes with the fix; 50/50 portrait and roster tests pass.
- Ships alone right after the drain fix (readers losing critical info). Its full gate starts when the drain gate finishes.
- Still owed, needs an owner: the people publisher must treat chamber index pages as non-personal and republish the Idaho and Florida people shards. Proposed for the people-publication lane.
