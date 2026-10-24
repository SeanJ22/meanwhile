# CAL-01 — findings and calendars through the runner

Readers should receive every verified hunter finding promptly, and calendar acquisition must reach every state. A failed source, worker, handoff or publication stays visible and owed.

## Changes

- Meeting readbacks and grouped calendar reads use private files, with the parent's count and SHA-256 checked before execution. The parent-only writer is separate from the read-only module source children can reach, preserving the release firewall. An absent, unreadable, shortened, changed or empty selection fails explicitly. Reader checks use the parent's exact partition snapshot even if the door registry changes while the pass runs.
- Meeting readbacks are bounded batches within each state, with their own child outcomes. Latest receipts are read in one indexed request per batch. Each calendar resumes catch-up when its own repair finishes. Catch-up reads have an enforced five-minute child, acquisition and memory deadline, with seven minutes reserved including settlement. Explicitly deferred reads stay owed. The original source receipts, pointers and last good data keep their existing authority.
- Publish-now accepts an empty reader denominator, saves bounded failure totals by code and representative causes, and writes a local fsynced fallback before attempting canonical persistence. Admission failures, uncaught errors and the standing parent's fallback retain the cause.
- Box selection shares each pass between new findings and retries. Source failures and missing dependencies retry independently; new evidence reopens a held finding. One body failing does not stop other bodies, and the first source that verifies a fact publishes it immediately. Audits run separately. Metadata admission reserves time for publication, so slow lookups cannot consume the whole pass before any verified finding is built. Publication stops admitting work with time left to save its result.
- Publish-now saves each owed work item's retry before moving the shared changed-since cursor. A failed or unstarted item cannot rewind the entire window. Retry rows use the existing `pass_cursor` table; no migration is required. The changed-since scan reads one hour of changes per query and fetches the changed items by id, for up to two minutes per pass; the cursor moves only as far as the scan read, so a cursor that fell days behind catches up instead of timing out on one oversized read.
- Never-read meeting deadlines now sort as overdue. New calendar scopes are checked for presence in pages instead of performing several empty clock queries per board. Existing scopes retain full clock proofs. State programs rotate their launch order and carry the newest owner read-now requirement.
- Standing calendar acquisition covers the whole earth while remaining restricted to its exact source, body and state. Its previous Kansas-centered 5,000 km filter prevented Legistar and InSite from reading Hawaii and western Alaska at all. Local reader radius filtering is unchanged.
- Every runner TypeScript child receives the same Node loader as the standing server. The state-pointer reconciliation scratch files now use the temporary directory its existing path validator requires.
- Release 84 supplies PM-01's post-acquisition publication clocks for Legistar rosters and meeting facts, plus board-name publication. The duplicate CAL clocks are removed. One separately reproduced Legistar gap remains fixed here: a real full reread of unchanged contents now confirms the existing facts' checked dates. Row-version probes alone do not restamp the full evidence, and saved source-copy dates stay immutable.
- The release 83 memory queue order and the CAL catch-up deadline share the runner's third admission argument. Both retain their original behavior. PM-01's Box board-name backfill also remains, with admissions bounded by the original Box deadline and failures included in the saved outcome.
- The calendar read-now environment key lives in a pure shared module. Importing its source-owner implementation through calendar admission made the public reader trace the vault and control-plane stores; the key no longer brings those dependencies into reader requests.

The reader child limit remains four, with existing host memory admission and its 0.75 GiB margin. Box publishing runs up to four independent bodies within its existing process. Actual simultaneous production worker counts and live delivery remain deployment checks.

## Evidence and remaining work

The production baseline at the start of this job had 200,132 never-examined waiting findings and 24,484 still held under slots `7`. The latest routine outcome had 161 missing reader results and two unexpected-contract errors. There were 6,806 reader contracts but only 207 distinct meeting candidate scopes. The live site still served `be812ba` during implementation.

The initial 270 focused tests pass through the server's Node loader and the CI test runner. They cover native children with 10,000 long IDs, invalid handoff files, changed registry snapshots, bounded failure records, durable cursor retries after restart, fair PostgreSQL Box selection, independent publication errors, state scheduling, and source-to-reader publication. The previous READY passed all eight local gates (9,281 tests: 9,279 passed, two skipped), including both builds and the firewall. River's new return requires merging releases 83 and 84, then running the complete gates again. The 30-day whole-registry timing replay retains its original 60-minute and 12-hour targets and models the server's actual 20/25-minute phase caps.

Remaining owners and dependencies:

1. CAL-01: finish the full local gates and push a follow-up `READY:` commit on `stream/cal-01`.
2. River: fold and test the exact READY commit, then ship it.
3. CAL-01: every 15 minutes after READY, read `returns/cal-01.md` on `board/river` and the newest runner records; fix any return and publish another READY. Check actual Box attempts and the waiting backlog, calendar door successes, and the live page. Verify AL, AR, AZ, and randomly selected AK and IA. The original SD draw had no Box findings, so retain it as an additional calendar check and draw IA uniformly from other states with waiting findings before deployment. Continue until hunter facts and calendars outside AZ/NH/NJ are visible to readers.

This document records implementation and verification scope; it does not claim deployment or live success.
