> **THE MISSION (Sean, Oct 6). Read this first and work backward from it for your own part.**
> Anyone in the United States enters a ZIP and right away understands everything their government does that touches them: complete, correct, current, fast, and a pleasure to use. The finish line for all work is a verified fact reaching a reader within minutes, at a known and falling cost, with the system proving it every hour. Start at that finish line and work backward: what must be true right before a reader sees the fact, and before that, until you reach a step already working live. Never fix a symptom alone; find the cause the finish line exposes and fix that. Work is done only when the live system's vital signs show it, never because tests pass.
> Targets: control-plane Neon under 0.7 GB an hour; no paid job ending with nothing; cost per fact measured and falling.
> Every change that adds database reads states its estimated Neon cost in its READY status before it ships. The measured hour on the droplet checks it. A release that makes the hour clearly worse rolls back (DB-47) and returns to its lane with the numbers. Full text: board/river decisions.md, "Oct 6, about 1:20 AM EDT".

## TOP ITEM: FAILED LIVE (River live ledger, Oct 6, 2:45 AM EDT)

Sean, Oct 6: a step is done only when it works live. Integrated is not done. These steps were integrated, but the live check of their Done-when line failed on production a5fd753 (release 8). Fix them before any new step. After a fix, say in your READY status what a reader or Admin will now see, and River re-checks it live in that release's measured hour. Full table: board/river releases/live-ledger.md.

- **Sources rows say 'Last checked: We're working on getting this info' under a shown read date.** Seen: Many ballot Sources rows read 'Last checked: We're working on getting this info' even when the row above shows a read date (e.g. 85701, 03255 ballot Sources).

## 2026-10-04 08:20Z — continuation handoff

This lane is now continued by its paired Claude worker (see assignments.md → Handoffs). Start from the saved continuation file on stream/frontend. The waiting_on items about FULL failures are answered in assignments.md → "Checks guidance for FULL batches". Browser and live acceptance belong to River after release, so don't hold a step for them.

## 2026-10-05 17:30Z: FE-39 failed live (browser, production dcddcf5)
The welcome screen at https://meanwhileusa.com/ still says "OR START WITH ONE OF THESE: Tucson, AZ / Vail, AZ / Rockaway Twp., NJ / Newbury, NH". The hard-coded `QUICK_ZIPS` is still in `components/map/welcome-overlay.tsx:45-50` on main. #642 only removed a disclaimer. It also breaks "nothing built for one place".

## 2026-10-05 17:40Z: standing instruction from Sean (all lanes)

Sean, to River, word for word: "Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file."

What this means for you, from now on:
- **Never notify Sean and never ask him anything.** No push notifications, no questions in a final reply, no "needs_Sean" for how-to choices.
- **Put every question under `needs_River:` in your status file.** River reads it each run and answers here in your returns file. Choices about which source, method, order, design, module, migration or fix are "how" decisions. River makes them under rulings §8. A design choice that touches spending controls is still "how", as long as it changes no limit and Sean's settings stay as they are.
- **`needs_Sean:` is only for** a missing credential, a new paid service, spending beyond the budget, or D7 (SC-17). River checks each entry and takes it to Sean. You don't.
- While you wait on an answer, keep building your other ready steps.
