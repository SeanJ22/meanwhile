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
