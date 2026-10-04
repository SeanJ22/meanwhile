# Build lane: meetings (Meetings and Refresh)

**Suggested starting model: Sonnet 5.5.** Collector, refresh and history changes with concrete acceptance conditions.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Claude as an hourly cloud task.** Your primary lane is `meetings`. You also continue the `ballot` lane when River assigns it after its Codex run stops. Work one lane at a time, in separate worktrees, under the ownership and handoff rules in `common.md`.

Your status file is `.factory/meetings.md` on `stream/meetings`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 27 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **DB-01** Meeting history stops being deleted
2. **DB-59** Meeting snapshots move again, and one bad base holds back only itself
3. **DB-06** Concluded meetings with records are kept for good
4. **BX-08** Office and meeting addresses get map points for any wired body
5. **DB-02** Shared meeting fetch limits use the held window
6. **BX-10** Concluded meetings link their video
7. **DB-08** Congress refreshes itself daily, and votes accumulate
8. **DB-24** The manual crosswalk contract is retired
9. **DB-55** Meeting history already deleted is restored
10. **DB-58** A slow site holds up only its own reads
11. **DB-07** Outcomes are kept past the window
12. **BX-09** Venue pins publish on their own
13. **DB-03** Legistar, Legistar InSite and calendar feeds hold 120 days
14. **DB-04** Diligent, BoardBook, CivicClerk, CivicPlus and IQM2 hold 120 days
15. **DB-05** Every other meeting adapter holds 120 days
16. **DB-26** What the hourly check finds is live within the hour; needs DB-25 (registry), DB-10 (registry), BX-12 (slide)
17. **DB-27** Time from posting to live is measured; needs DB-09 (registry), DB-25 (registry)
18. **FE-26** Site speed and reliability on the Scoreboard; needs FE-02 (auditors), DB-51 (bank), BR-03 (admin), BR-23 (measures)
19. **DB-28** Every live fact knows its door; needs DB-10 (registry), DB-11 (registry), DB-54 (registry)
20. **DB-30** Refresh follows how often each door actually changes; needs DB-21 (registry)
21. **FE-23** Look and feel on the Scoreboard; needs FE-21 (auditors), BR-23 (measures)
22. **FE-27** Speed is measured by our own regular test visits
23. **DB-22** Outcomes and votes come from door kinds, for any body on that platform; needs DB-13 (registry)
24. **DB-29** A fact past its refresh date is re-read, with no Send needed
25. **DB-31** Overdue doors are listed; needs DB-21 (registry)
26. **DB-56** Starting a mission refreshes every door already known there; needs DB-13 (registry), BR-08 (measures)
27. **BX-11** Local votes are linked to the people who cast them; needs CP-09 (slide)

## Other lanes wait on these of yours (push each the moment it's ready)

- BX-08 → FE-34 (frontend)
- BX-08 → FE-35 (frontend)
- DB-01 → DB-45 (bank)
- DB-06 → CA-40 (people)
- DB-06 → CA-41 (people)
- DB-07 → CA-41 (people)
- DB-26 → DB-45 (bank)
- DB-27 → BR-32 (measures)
- DB-29 → CA-43 (people)
- DB-31 → BR-32 (measures)

## Notes for this lane

- DB-01 and DB-59 stop harm readers see today. Do them first. DB-01: meetings are held 120 days each way and shown 90, and concluded meetings with records are never deleted. DB-59: find why the public meeting snapshot stopped moving, fix it through the normal data path, and keep the protection.
- DB-55 restores history already deleted, once, through the normal promotion path.
- DB-26: inside the seven-day window, anything a body posts is live within an hour (rulings §4). Checks are plain code with no AI cost.
- DB-58 touches `scripts/pilot-runner.mts` (hunters). Use the hook rule.
- FE-23, FE-26 and FE-27 (look and speed rows on the Scoreboard, our own regular test visits) are here to balance the load.
