> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

# Returns and hook requests for bank

River writes this file. Do these before new steps.

## 2026-10-04 08:20Z — continuation handoff

This lane is now continued by its paired Claude worker (see assignments.md → Handoffs). Start from the saved continuation file on stream/bank. The waiting_on items about FULL failures are answered in assignments.md → "Checks guidance for FULL batches". Browser and live acceptance belong to River after release, so don't hold a step for them.

## 2026-10-04T11:27:36Z — integration repair by River (DB-50)

`tests/freshness-provenance.test.ts` (RULING 107) refused `lib/sources/feed-kinds.ts`: `collectedAt: new Date().toISOString()` with no declaration. River added `@freshness-reads-here` to its header on river 3690498b5, because the stamp is taken right after `kind.read`. Any new clock stamp needs this declaration, or a stamp minted from the read.

## 2026-10-04 14:00Z — FAILED LIVE after release 1 (dcddcf5): returned

River checked release 1 against each step's "Done when" on production, using read-only SQL and git on main. These steps are on main and deployed, but **nothing in production calls them**. Each READY commit left its runtime call as a hook. They are returned: connect each one, or get the owning lane's hook landed, then mark READY again. Fix these before new steps.

- DP-19: table cp_fix_map does not exist in production. FIX_MAP_EXPAND_SQL is never applied and createFixMapRepository is never called. A schema change goes through River as a numbered migration (lib/db/migrations + journal + MIGRATION_PHASES); name it by step id.
- DP-20: fix-map-record.ts recordAttempts has no runtime caller.
- DP-24: spread.ts is called only by tests.
- DP-27: study-losses.ts is used only by loss-response.ts, which is itself not called.
- DP-28: loss-response.ts has no runtime caller.
- DB-49 / DB-57: adapter-test-selection.ts is imported only by adapter-repair-scope.ts, which nothing calls; no workflow uses it.
- DB-51: link-sweep.mts is not scheduled anywhere, and no sweep is stored (the registry is also empty).

## 2026-10-05 17:40Z: standing instruction from Sean (all lanes)

Sean, to River, word for word: "Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file."

What this means for you, from now on:
- **Never notify Sean and never ask him anything.** No push notifications, no questions in a final reply, no "needs_Sean" for how-to choices.
- **Put every question under `needs_River:` in your status file.** River reads it each run and answers here in your returns file. Choices about which source, method, order, design, module, migration or fix are "how" decisions. River makes them under rulings §8. A design choice that touches spending controls is still "how", as long as it changes no limit and Sean's settings stay as they are.
- **`needs_Sean:` is only for** a missing credential, a new paid service, spending beyond the budget, or D7 (SC-17). River checks each entry and takes it to Sean. You don't.
- While you wait on an answer, keep building your other ready steps.

## River, 2026-10-06 ~04:00Z: lessons for paid endings (Sean's rule: no paid worker ends with nothing)
A Scout or Detective that ends NO_PROGRESS (rung limit or model stop) or has its finish refused currently saves only a job-cost REFERENCE entry. Add a field-manual lesson kind, "exhausted on these rungs", carrying the subject, the rungs tried and why each failed, so the next worker starts past them. Hunters will call it from dispatch; agree the shape under needs_hook. Note: 757 method candidates are VALIDATED but only 6 ADMITTED. Say what holds the rest.
