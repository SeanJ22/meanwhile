# Owner decisions recorded by River

## 2026-10-05 ~16:50Z: data never rebuilds the site

Sean, in the River session (session_012Ufwyxx6iej1CSEX6khMyg), word for word:

> Owner decision: new or changed data must never rebuild the site. Data reaches readers only through the data system. Record this decision on board/river and resolve the deploy-paths trace-sweep exception to match it.

What it settles: the open question in status.md ("should a committed change to a traced `data/` file rebuild the site?"). **No.** All of `data/` stays non-shipping for Netlify, as `lib/ops/deploy-paths.ts` and `tests/hosted-cost-invariant.test.ts` already say. Readers get data only from the data system (the data plane and its reader projections), never from a copy bundled at build time.

How the trace-sweep exception is resolved:
- `tests/deploy-paths.test.ts` "no file under a non-shipping prefix is traced into the deploy" is **correct as written**, and it now enforces this decision. It is not weakened, and `data/` is not made shipping.
- The 3,330 traced `data/` files are the defect. They are a stale copy that a data-only commit can never refresh. The baseline exception in integration.md (07:34Z, Oct 4) is withdrawn as an exception and reopened as work: about 81 app/lib modules read `data/` at runtime (for example `lib/registry/server.ts`, `lib/geo/zip-division-index.ts`, `lib/coverage/photo-slots.ts`, `lib/meetings/snapshot.ts`, and the JSON imports in `lib/registry/body-membership.ts`, `lib/ballot/measure-records.ts` and `lib/meetings/notice-summary.ts`). Each moves to a data-system read with no traced file, lane by lane, owner recorded in hooks.md. The sweep goes green when the last one moves.
- Until then CI keeps running without `.next`, as it does now, so this test skips with its named reason in CI and fails locally after a build. River reports it as open, never as passing.
- This is the owner's own rule. It does not change docs/rulings.md on main; adding it there is Sean's call.

## 2026-10-05 ~17:40Z: builders bring questions to River, not Sean

Sean, in a River session (session_01KbZarGhrBfffhSMzZ3Si4t), word for word:

> Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file.

Scope: every builder lane, every provider. River answers every "how" choice itself. Only credentials, new paid services, spending beyond the budget and D7 go to Sean. Every `returns/<lane>.md` now says this. Workers put questions under `needs_River:`.

## 2026-10-05 ~17:40Z: CH-24 and CH-26 go ahead

Sean, same session, word for word:

> Answer hunters: CH-24, go ahead. Extract the shared spending-guard module behind a runner switch, keep the old path as the default until it's checked live, and prove in tests that the guards behave identically. Check it live after the next release. CH-26, go ahead with the lineage-keyed index. You number the migration.

River's engineering choice (not Sean's decision): CH-26 takes control-plane schema version 20. Details are in returns/hunters.md.

## 2026-10-05 ~21:00Z — Sean: River's notifications (in the River session)

Sean's words: "Each time river moves forward to a new tested batch, send me one push notification. Say in one line which Codex lanes (admin, slide, ballot, bank, frontend) now have ready work or a new return, so I can send those Codex tasks "Continue." Send nothing else to me unless it is a release or a real decision I have to make."

How River applies it, every run:
- After each `river promote` (river fast-forwards to a tested batch), send exactly one push notification. Its one line names the Codex lanes that now have something to do: a new or open return in `returns/<lane>.md` addressed since the last notification, or a newly integrated batch to catch up on and continue from. Example: "River moved to <sha>: Codex Continue → admin (return), slide (return), ballot, bank, frontend." If none, say "no Codex lane needs Continue."
- The only other notifications are a release (PR opened, merged or failed live) and a real owner decision. No status, no-change or progress pushes.
- This replaces the per-event reporting in the river brief for Sean's phone. Board status files still record everything.

## 2026-10-06 ~01:20Z: Sean, spend holds, Neon transfer, research and spend alerts (River session)

Sean's directions, in his message to River:
- **Leaked spend holds:** build and ship the fix (release 5, or in the urgent release if that would not hold it back). Sean approved a one-time cleanup of unsettled holds older than 2 hours. **Done 2026-10-06 ~00:42Z:** snapshot branch `snapshot-before-spendhold-cleanup-20261006` (br-still-dew-aeeyy53o, parent LSN D/609B33F8) on meanwhile-control-plane. Before: 19,749 holds, 16,901 unsettled, 16,463 of them older than 2 h ($683.49), row 38.4 MB as text, revision 29995. After: 3,288 holds, 440 unsettled (all under 2 h), row 7.8 MB, revision 29998. One atomic UPDATE bumped the revision, so the runner's compare-and-set retried on top of it.
- **Neon transfer:** keep the ledger row small; scope the heavy reads of cp_attempts, cp_work_items and cp_log_artifacts.
- **Research crash:** ship the stall probe and memory-wait fix in release 4; hunters bounds the side lanes and campaign-publication-cycle.ts:56.
- **CH-24 part 2:** research runs continuously, without timed rounds. River chose Proposal A (returns/hunters.md).
- **Money page:** returned to admin (returns/admin.md).
- **Spend alerts:** Sean should not have to find spikes. Push him when any vendor's daily spend runs well above its normal level, naming the vendor and the likely cause. How River applies it: no product channel can reach Sean's phone, so River checks on every hourly run and uses its own push. It compares Anthropic (cp_log_costs) and Neon transfer (the project's data-transfer reading) per day against the median of the previous 7 days. It pushes once per vendor per day when today's pace is at least 2x that median and at least $5 or 50 GB above it. Other vendors are added when admin's per-vendor read exists. These alerts are added to the notification rule above.
- **Verify live:** Money "Left today" above $0, Anthropic spend resumes, a research cycle completes, and Neon transfer per hour drops sharply.
