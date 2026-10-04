# Build lane: measures (Measures and Scoreboard)

**Suggested starting model: Sonnet 5.5.** Structured calculations, status reporting and existing Admin connections.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Claude as an hourly cloud task.** Your primary lane is `measures`. You also continue the `admin` lane when River assigns it after its Codex run stops. Work one lane at a time, in separate worktrees, under the ownership and handoff rules in `common.md`.

Your status file is `.factory/measures.md` on `stream/measures`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 30 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **SC-01** The checklist's rules move into a data overlay, unchanged
2. **BR-23** The Scoreboard view, first rows; needs BR-01 (admin)
3. **BR-08** Start a mission for any place
4. **BR-21** The budget dial says what it buys; needs CH-02 (hunters)
5. **SC-03** One percent formula, and the obvious honesty fixes
6. **SC-20** Each coverage explanation stays within one kind of fact
7. **SC-02** The overlay carries units, triggers, due dates and squads
8. **BR-14** One queue board for everything in motion; needs BR-01 (admin), BR-03 (admin), BR-12 (admin)
9. **BR-38** Admin shows each code change from built to live; needs RL-05 (river), CH-01 (hunters)
10. **SC-05** Every blank carries its six statuses
11. **BR-25** Now shows the few things that matter; needs BR-24 (admin)
12. **SC-08** Coverage, counted against what is expected
13. **SC-10** New finds join the list with a date; needs BR-24 (admin)
14. **BR-22** Shift focus by kind of information
15. **BR-34** The old order and stuck lists are deleted
16. **SC-04** Items are counted at the right unit
17. **SC-13** Launch gates become health checks that never stop publishing
18. **SC-14** Sean can add to what's owed, from Admin; needs BR-06 (admin)
19. **SC-16** Operational readiness is counted apart from civic completeness
20. **SC-07** Completeness, freshness and delivery are reported separately, never blended
21. **SC-12** The mission map is handed to the coach and the national job
22. **SC-09** People coverage: who has a full profile
23. **BR-31** Facts per hour, cost per fact, and where the flow stopped; needs BX-06 (slide)
24. **BR-33** Sean can decline a new owed item; needs BR-24 (admin)
25. **SC-06** "Nothing hunts this yet" is shown honestly
26. **SC-11** Scores keep history, so trends show
27. **SC-17** Honest coverage tags on sold signal rows (as Sean decides)
28. **BR-30** The Scoreboard reads the Scorecard's honest measures
29. **BR-32** Door numbers on the Scoreboard; needs DB-27 (meetings), DB-31 (meetings), DB-34 (registry)
30. **SC-19** Time from mission start to core information live

## Other lanes wait on these of yours (push each the moment it's ready)

- BR-08 → DB-56 (meetings)
- BR-14 → BR-17 (admin)
- BR-14 → BR-27 (admin)
- BR-14 → BR-29 (admin)
- BR-14 → DB-47 (bank)
- BR-14 → DP-26 (auditors)
- BR-23 → DP-18 (auditors)
- BR-23 → DP-26 (auditors)
- BR-23 → FE-23 (meetings)
- BR-23 → FE-24 (registry)
- BR-23 → FE-26 (meetings)
- BR-25 → FE-37 (registry)
- SC-02 → BX-07 (slide)
- SC-02 → CH-15 (hunters)
- SC-05 → CH-19 (hunters)
- SC-10 → CA-39 (ballot)
- SC-12 → CH-17 (hunters)
- SC-12 → CH-18 (hunters)
- SC-12 → CH-19 (hunters)
- SC-12 → CH-20 (hunters)
- SC-12 → CH-21 (hunters)

## Notes for this lane

- SC steps put Sean's State Run Checklist v1.1 into data. It is Admin's scorecard and **never holds back publishing** (rulings §3).
- SC-02 and SC-12 are what the hunters lane's mission steps (CH-15 to CH-21) wait on. Do the SC chain early.
- SC-17 waits on decision D7, which Sean has parked. Build nothing for it. List it under `waiting on` as "Sean's decision D7". It is the explicitly parked step. Once all your other steps are on River, report `BUILD COMPLETE — SC-17 PARKED`; do not claim SC-17 is done. This exception does not keep other lanes or the final release waiting.
- BR-38 needs River's RL-05.
- Scoreboard rows show counts behind every percentage and never blend measures into one number.
