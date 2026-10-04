# Build lane: hunters (Coach and Hunters)

**Suggested starting model: Opus 5.5.** Worker concurrency, spending controls and recovery across the running system.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Claude as an hourly cloud task.** Your primary lane is `hunters`. You also continue the `slide` lane when River assigns it after its Codex run stops. Work one lane at a time, in separate worktrees, under the ownership and handoff rules in `common.md`.

Your status file is `.factory/hunters.md` on `stream/hunters`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 30 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **CH-01** Production runs the fixed runner code
2. **CH-02** One unpriced charge no longer shuts off paid work
3. **CH-06** Each worker process builds its runtime once
4. **CH-10** Every funded Send gets the same rules
5. **DB-48** New releases install beside the running one
6. **CH-03** Settings take effect in the middle of a round
7. **CH-04** Don't pay to find what is already live
8. **CH-05** The first hunt starts in the same round as the order
9. **CH-07** A clock on every target, and the case file is kept
10. **CH-08** Discovery passes run on their own lanes
11. **CH-09** The saved-page index is built once, not three times a round
12. **CH-13** Statute-routed requirements work for any state
13. **CH-29** Work our own spending guard refused goes back in line
14. **CH-30** When the AI service doesn't answer, the agent's work is kept
15. **CH-24** Hunters work continuously, not in slices
16. **CH-11** Producers that ran only for the original Send run for every Send by geography
17. **CH-26** Each task reads only its own history
18. **DB-53** New code loads without stopping the factory
19. **CH-15** Missions split into parts from settings; needs SC-02 (measures), BR-05 (admin)
20. **CH-22** Local research rows join the one hunter queue; needs BX-02 (slide)
21. **CH-25** A hunter-count dial, with the memory ceiling beside it; needs BR-05 (admin)
22. **CH-27** The 15-minute paid slice and the wave loop are deleted
23. **CH-28** Many hunters in each worker process
24. **CH-16** Every piece of work knows its mission part
25. **CH-23** One hunter path: the separate registry-lane Scout is retired; needs DP-02 (auditors), DP-04 (auditors), DP-06 (auditors)
26. **CH-20** Hunters see the whole mission and can drop a finding for any part; needs BX-01 (slide), SC-12 (measures), DP-21 (bank)
27. **CH-17** Squads are sized to their parts, and hunters move to the gaps; needs SC-12 (measures)
28. **CH-18** Every blank has an owner; needs SC-12 (measures), BX-07 (slide)
29. **CH-19** A mission is done when its map is full and its doors refresh; needs SC-05 (measures), SC-12 (measures)
30. **CH-21** Meetings discovery follows the mission map; the gap ledger is retired; needs SC-12 (measures)

## Other lanes wait on these of yours (push each the moment it's ready)

- CH-01 → BR-38 (measures)
- CH-02 → BR-21 (measures)
- CH-20 → BX-04 (slide)
- CH-23 → BX-05 (slide)

## Notes for this lane

- CH-01 is a check first: which commit is the production runner running? If it's `022a183c` or later and research rounds finish, CH-01 is done with no code. On Oct 3 around 8:15 PM Arizona time, live Admin's Workers view said "No live check has succeeded yet" with every number blank. Find out whether that's real. Never restart the runner by hand.
- CH-02 (an unpriced charge no longer zeroes paid work) unblocks admin's BR-21 and your own CH-29. CH-06 unblocks CH-22 to CH-28.
- CH-29 and CH-30 put back the 348 items refused by our own spending guard and the 276 whose work was lost (live Admin, Oct 3).
- Any change to how many hunters run reports how many workers the production server runs at once at the 0.75 GiB memory margin (rulings §5).
- DB-48 and DB-53 are here because you own the runner files they change.
