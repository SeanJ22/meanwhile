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
