> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

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
