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
