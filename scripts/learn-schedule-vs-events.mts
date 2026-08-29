/**
 * `pnpm method:learn-schedule-vs-events` — **RETIRED 2026-08-28. IT REFUSES.**
 *
 * ## What this script used to do, and what was wrong with it
 *
 * It taught the project two real routes off the Pima County "missing meetings"
 * investigation — reading a source's own denominators before opening the
 * adapter, and asking a body's own site when its vendor calendar runs dry. Both
 * routes were good, both are still in `data/method/knowledge.json`, both are
 * still inherited, and nothing here removes them.
 *
 * What it also did was write three substantive assertions into route prose that
 * were disproved the same day: that Pima published its September sittings only
 * as a recurring rule and not individually, that the resulting gap was the
 * publisher's, and that a reconciled fetched/normalized denominator established
 * a window as COMPLETE. All three were corrected by the session that shipped
 * `scripts/learn-legistar-insite.mts` and typed, evidenced and formally
 * withdrawn in `lib/method/pima-claim-classes.ts`.
 *
 * ## Why leaving it executable was the actual defect
 *
 * The defence was that `learnRoute` refuses a duplicate id, so re-running it
 * against today's store changes nothing. That is a statement about one store's
 * current contents and not about this writer. Offer these routes to an EMPTY,
 * migrated, replayed or test-copied store and the `learned` branch runs: the
 * false sentences land as current project knowledge, in prose fields that carry
 * no claims and that therefore no retraction can reach.
 *
 * A writer that is safe only because its output already exists is one
 * `emptyKnowledge()` away from teaching a false fact about a government.
 *
 * ## What to run instead
 *
 * `pnpm method:learn-legistar-insite` is the corrected writer for this
 * knowledge, and `pnpm method:amend-claim-classes-pima` attaches the claim
 * classes and the two retractions. To READ what a jurisdiction inherits, run no
 * writer at all: `projectMethodFor()` in `lib/method/projection.ts` is the
 * consumer read path.
 *
 * The refusal itself, the list of what was false, and the pointers all live in
 * `lib/method/retired-writers.ts` so that the regression in
 * `tests/method-projection.test.ts` can assert on them without spawning a shell,
 * and so that the next writer that has to be retired inherits the mechanism
 * rather than reinventing it.
 */

import { SCHEDULE_VS_EVENTS_RETIRED, refuseRetiredWriter } from "../lib/method/retired-writers.ts";

refuseRetiredWriter(SCHEDULE_VS_EVENTS_RETIRED);
