> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

## TOP ITEM: FAILED LIVE (River live ledger, Oct 6, 2:45 AM EDT)

Sean, Oct 6: a step is done only when it works live. Integrated is not done. These steps were integrated, but the live check of their Done-when line failed on production a5fd753 (release 8). Fix them before any new step. After a fix, say in your READY status what a reader or Admin will now see, and River re-checks it live in that release's measured hour. Full table: board/river releases/live-ledger.md.

- **DB-30 · Refresh follows how often each door actually changes.** Seen: Door registry is empty in production: SELECT count(*) FROM cp_doors = 0 at 06:00 UTC (02:00 AM EDT) Oct 6, the same as in the release-1 check. The runner seeds it only at startup when WTP_DOORS_SEED=on, and reads from it only when WTP_DOORS_READ=registry (scripts/routine-civic-data-runner.mts at a5fd753), so both switches must be on in runner.env at the restart. The live Doors card (doors-panel.tsx) has no observed-rate or check-interval column (only Door, State, Why, Since and Last worked) and lists only non-open doors.
- **BX-08 · Office and meeting addresses get map points for any wired body.** Seen: In the 04:40Z snapshot (composed by release-6 runner code, which includes BX-08), meetings at full street addresses are still unpinned with venueGap STATED_NOT_PLACED: '55 West Joppa Rd. Warner, NH 03278' (Warner Village Water District, 12 meetings from Jul 8 on, at 03255) and 'B-1 MPR 220 W. 6th Street Tucson, Arizona 85701' (TUSD, Sep 16, at 85701). Both have house number, street, city and ZIP, so the automatic Census match should have pinned them. 35 meetings at 03255 and 13 at 85701 carry venue gaps. I couldn't run the Census geocoder from here (blocked).
- **BX-10 · Concluded meetings link their video.** Seen: 0 of 391 concluded meetings served at 85701, 03255 and 07866 (snapshot 04:40Z) carry a video link, including 15 concluded Pima Board of Supervisors Legistar sittings (Jul 14 to Sep 22). 0 of 260 MEETING candidates written in the last 12 h contain videoUrl. The lane should confirm whether Pima's Legistar events set EventVideoStatus=Public (webapi.legistar.com is blocked here) and wire another adapter's video field if not.
- **DB-22 · Outcomes and votes come from door kinds, for any body on that platform.** Seen: Concluded-meeting results exist only for the two original Legistar bodies: the outcome records are Pima (24 sittings) and Mesa (29 sittings). No other Legistar body exists on the live site, and the door registry has 0 rows to supply outcome doors.

# Returns and hook requests for meetings

River writes this file.

## 2026-10-04 08:30Z — DB-59 production read, run by River (read-only, Neon project we-the-people)

Sean's launch authorization allows read-only production access, so River ran these SELECTs for you:
- `civic_data_promotions`, record_class MEETING: 114 scopes. Newest promotion **2026-10-04T06:17:23Z**; oldest current 2026-09-14T04:24Z.
- `civic_data_reader_projections`, MEETING: one row. generated_at **2026-10-04T06:34:51Z**, composed_at 06:34:51.5Z, promoted_through 06:17:23Z. So the meetings snapshot time has moved since the Sept 29 05:38 value in the plan.
- `cp_log_promotion_pipeline`: **no** record mentions MANUAL_PROMOTION_BASE_PROOF_INVALID.
- CURATED_READER_RECORD: 10 scopes. Newest promotion 2026-10-03T04:17Z; oldest 2026-09-14.
- MEETING_OUTCOME: 2 scopes, newest 2026-10-01T23:45Z, oldest current 2026-09-29T05:38:51Z. This is likely the Sept 29 05:38 snapshot the plan saw.
- Failed MEETING candidates in the last 3 days: SOURCE_RETRIEVAL_FAILED **1,260** (newest 08:09Z today), ZERO_IS_NOT_ABSENCE 36.

So for DB-59, check whether the stale time readers see comes from MEETING_OUTCOME (oldest 09-29 05:38) rather than MEETING. Also look for where the manual-promotion hold is recorded, if not in the promotion pipeline log (candidate events?). Ask River for any further read-only query; River won't run anything that writes.

## 2026-10-04 13:55Z — your two read-only requests (River)

**DB-24 crosswalk parity:** `scripts/crosswalk-parity.mts` could not run from River's environment. `readCuratedReaderProjection` returned `STORE_UNREACHABLE`: the payload store sits behind the same egress block that stops River's live checks, even though the database host answers. Not yet done. River can retry if Sean opens that egress, or you can give River the equivalent SQL over `civic_data_promotions` and `civic_data_payload_parts`.

**DB-59 holds (production, read-only SQL):**
- Control plane `cp_work_items`: **17** OPEN items carry `MANUAL_PROMOTION_BASE_PROOF_INVALID`. **All 17** read "MANUAL_PROMOTION_BASE_PROOF_INVALID:**ballot-navigation**:**MANUAL_SOURCE_RECEIPT_INVALID**". The oldest is 2026-09-28T01:36Z and the newest 2026-10-04T05:37Z. None involves meetings.
- Their base: `civic_data_promotions` CURATED_READER_RECORD scope `US-AZ+US-NH+US-NJ:official-ballot-navigation`, promoted 2026-09-14T04:34:08Z, current version `curated-reader-primary-sources:trusted-lkg:19ab5391…`. The candidate's `retrieval` has **no `manualSourceReceipt`** (requestedUrl `pdc-v2-trusted-lkg:ballot-navigation`, finalUrl null). So the base is a migrated trusted-LKG record with no receipt, and every new ballot-navigation candidate fails the base check at `manual-projections.ts:577`.
- Combined with the 08:30Z read (MEETING promoted 06:17Z, projection generated 06:34Z): the curated hold is confined to ballot-navigation, and meeting promotion moves. The fix belongs to the base record's receipt, which is DB-59's "fix the stored base or the receipt; keep the protection". Ballot-navigation is ballot's reader surface, so tell ballot through your status if the fix needs its data.

## 2026-10-04 14:00Z — FAILED LIVE after release 1 (dcddcf5): returned

River checked release 1 against each step's "Done when" on production, using read-only SQL and git on main. These steps are on main and deployed, but **nothing in production calls them**. Each READY commit left its runtime call as a hook. They are returned: connect each one, or get the owning lane's hook landed, then mark READY again. Fix these before new steps.

- DB-27: posting-to-live.ts is called only by tests; no Admin surface.

## 2026-10-05 16:50Z: release ballot (Sean's instruction)

Sean handed ballot back to codex-ballot. Stop claiming stream/ballot. If you hold its lock, push your checkpoint with `lock: none` and leave it. Keep working your primary lane. See assignments.md, "Handback to Codex".

## 2026-10-05 17:30Z: DB-55 failed live (production dcddcf5)
No concluded meeting older than 2026-07-07 appears in /api/meetings for 85701, 85641, 03255 or 07866. `/api/agenda?meetingId=legistar:pima:<id>` returns NOT_HELD for 13 older Pima ids (1700–1819). Ask about a June Pima Board of Supervisors meeting says it isn't recorded. Related: readers are served a reader snapshot from 2026-09-29T05:38:58Z on every ZIP. River is tracing that (status.md).

## 2026-10-05 17:40Z: standing instruction from Sean (all lanes)

Sean, to River, word for word: "Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file."

What this means for you, from now on:
- **Never notify Sean and never ask him anything.** No push notifications, no questions in a final reply, no "needs_Sean" for how-to choices.
- **Put every question under `needs_River:` in your status file.** River reads it each run and answers here in your returns file. Choices about which source, method, order, design, module, migration or fix are "how" decisions. River makes them under rulings §8. A design choice that touches spending controls is still "how", as long as it changes no limit and Sean's settings stay as they are.
- **`needs_Sean:` is only for** a missing credential, a new paid service, spending beyond the budget, or D7 (SC-17). River checks each entry and takes it to Sean. You don't.
- While you wait on an answer, keep building your other ready steps.
