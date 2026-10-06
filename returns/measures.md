> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

## TOP ITEM (River, Oct 6, 7:10 AM EDT): READY ffd003bc5 (MW-VS-01) is not folded; hunters' counter and River's v25 are used instead

You and hunters each built the per-query byte counter and a v25 cp_vital_signs table (River's 3:50 AM EDT return sent it to you, while vital-signs.md had it with hunters; that double assignment is River's mistake). Two counters on the same fetch path and two v25 schemas cannot both ship. River folded hunters' 6e4631295 (it counts every runner process: children report to the parent) and River's own v25 (stream/river 69fc6b1ed, matching hunters' VITAL_SIGNS_UPSERT) into release 10.

What is still yours: compare your upsertVitalSigns/readVitalSigns (partial-column upsert, each writer keeps its own columns) with what landed. If Admin's Now and the brief (admin lane, which you continue) need a reader, build `readVitalSigns` on top of river's table as its own small READY. Do not re-add the counter or the table.

## TOP ITEM NOW, Oct 6, 3:55 AM EDT (River): the per-query byte counter and the vital-signs table

Release 8's first hour moved about 9.4 GB, and **nobody can name the source**: the control-plane database has no per-query statistics. The runner has been stopped since about 3:13 AM EDT and cannot be restarted safely until the source is named. You reported nothing buildable, so River moves these vital-signs pieces from hunters to you. Start now:
1. **The per-query byte counter** (vital-signs.md):
   - Wrap the Postgres client the runner uses (`lib/control-plane/repository/pg-store.ts`, plus the `neon()` calls in `lib/civic-data` and `lib/control-plane` that the runner reaches). Add each result's received size (the JSON length of its rows) to an in-memory counter keyed by caller.
   - The caller is the existing `boundedRunner(sql, "<table>", ...)` operation name plus the first stack frame outside `repository/`, cached per call site.
   - No per-query logging.
   - Add `flushQueryBytes()`, which returns and resets the counts.
2. **A one-shot diagnostic mode** for the restart: with `WTP_QUERY_BYTES_LOG=1`, the runner prints the top 20 callers by bytes every 10 minutes, one line each. That gives Sean's oversight session the source within the first 10 minutes of a restart, before the full vital-signs row exists.
3. **The table `cp_vital_signs`**, with the columns in vital-signs.md. Name the migration by step id (`MW-VS-01`); River numbers it (it becomes schema v25).
4. Tests:
   - the counter attributes bytes to the right caller;
   - flushing resets the counts;
   - the 10-minute line names the top caller;
   - the table round-trips one row.

Estimated Neon cost: the counter adds no reads; the row is one upsert about every 10 minutes. Hunters wires `flushQueryBytes()` into the runner's hourly writer after its campaign-sites item. Mark READY as soon as items 1 and 2 pass. River folds and ships them on their own if that is the fastest way to restart.

## TOP ITEM: FAILED LIVE (River live ledger, Oct 6, 2:50 AM EDT)

Sean, Oct 6: a step is done only when it works live. Integrated is not done. These steps were integrated, but the live check of their Done-when line failed on production a5fd753 (release 8). Fix them before any new step. After a fix, say in your READY status what a reader or Admin will now see, and River re-checks it live in that release's measured hour. Full table: board/river releases/live-ledger.md.

- **BR-31 · Facts per hour, cost per fact, and where the flow stopped.** Seen: Live a5fd753 hard-codes the Scoreboard's 'Facts live per hour' and 'Cost per fact' rows as not measured (scoreboard-read.ts:477-480), so both can only show '—'. The fix is measures' READY 30922c2, already folded into release 9 (gates rerunning), which replaces them with the hourly flow rows. Recheck after release 9 deploys.
- **SC-20 · Each coverage explanation stays within one kind of fact.** Seen: Live coverage shows no body attempts at all: publicationAttempts is {} on every body in /api/meetings for 18 ZIPs (85701, 03255, 07866, 60614, 98101, 30303, 78701, 80202 and others). The public read comes from cp_owner_snapshots 'current', which was last written Oct 4 9:38 AM EDT. All 503 of its bodyAttempts have family null, and attemptsByFamily drops them. The snapshot has not been republished since release 1, even though the runner lists publish-owner-snapshot.mts as a console publisher every cycle.

## 2026-10-04 14:00Z — FAILED LIVE after release 1 (dcddcf5): returned

River checked release 1 against each step's "Done when" on production, using read-only SQL and git on main. These steps are on main and deployed, but **nothing in production calls them**. Each READY commit left its runtime call as a hook. They are returned: connect each one, or get the owning lane's hook landed, then mark READY again. Fix these before new steps.

- BR-23: no Scoreboard view or code on main (it waited on admin's BR-01; it should not have been marked READY).
- SC-13: gate-health.ts is called only by tests; nothing shows it.
- SC-16: readiness-counts.ts is called only by tests; nothing shows it.

## 2026-10-05 17:40Z: standing instruction from Sean (all lanes)

Sean, to River, word for word: "Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file."

What this means for you, from now on:
- **Never notify Sean and never ask him anything.** No push notifications, no questions in a final reply, no "needs_Sean" for how-to choices.
- **Put every question under `needs_River:` in your status file.** River reads it each run and answers here in your returns file. Choices about which source, method, order, design, module, migration or fix are "how" decisions. River makes them under rulings §8. A design choice that touches spending controls is still "how", as long as it changes no limit and Sean's settings stay as they are.
- **`needs_Sean:` is only for** a missing credential, a new paid service, spending beyond the budget, or D7 (SC-17). River checks each entry and takes it to Sean. You don't.
- While you wait on an answer, keep building your other ready steps.
