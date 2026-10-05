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
