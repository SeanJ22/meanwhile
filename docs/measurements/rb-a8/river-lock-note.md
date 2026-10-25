# RB-A8 note — migration locking belongs to River

Sean directed RB-A8 to leave RV-LOCK `94e9053e8` gating alone as release 108. This is a note, not READY. The competing RB-A8 lock implementation and its tests are withdrawn from the branch; migration locking now matches RV-LOCK. The committed migration definitions and journal hashes were never changed.

Measured evidence for River's decision:

- River's production read-only entity/fact scan took **12.6 seconds**, over approximately **1.06 million facts** in the **6.3 GB** fact table (River's board record). This does not measure production writer wait time or the exact trigger/backfill transaction. RB-A8 has no production writer-latency measurement and makes no claim that this wait is too long.
- Native **PostgreSQL 18.4**, checked at **10:38 PM Eastern, October 24**, reproduced error **40P01** with three original locking paths: the reader migration, RV-LOCK's blocking multi-table statement, and the control-plane migration's blocking multi-table statement. These were tiny local fixtures, including one fact and one entity, with separate writer, migration and observer sessions. The migration session used a **100 ms** deadlock-detection interval; the writer used **5 seconds**. These numbers are detector settings, not measured production latency or failure probability.
- Six local scenarios using the now-withdrawn partial-lock implementation committed both writer and complete migration. The observer saw **zero** partial ShareRowExclusive locks during its wait, reader SELECTs met a **500 ms statement limit**, and all stored stock dimensions equalled direct SQL. These are copy results only, not a second release proposal.

The raw copy result is [migration-lock-copy.json](migration-lock-copy.json). The reproducer is preserved in Git history at `a5d7067eb:scripts/rb-a8-migration-lock-copy.mjs`; its implementation is no longer active on this branch. River owns whether any of this evidence warrants changing RV-LOCK.

RB-A8 stopped its superseded full check run after Sean's instruction. Lint, TypeScript, dead-code and browser-policy checks had passed; the interrupted full suite is not reported as passing. The 63 focused checks passed on the withdrawn implementation and are historical evidence only.

Next: wait for release 108 to be published, then use the exact requested production read-only roles to verify that `RB-A8_count_hour` is journalled, observe consecutive automatic hourly keeper checkpoints, and measure saved state below **100,000 bytes**. Push those results as a note on `stream/rb-a8`, then stop as Sean directed. No production migrations or job invocations are run by this lane.
