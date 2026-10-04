# Build lane: admin (Admin controls)

**Suggested starting model: GPT Sol 6.1.** Admin controls and UI/data connections; escalate difficult gateway or authorization problems.
**Claude continuation:** existing `measures` worker, using its selected Sonnet 5.5 model unless a supported model change is made. The lane keeps the same scope and branch.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Codex.** Your logical lane stays `admin` and your branch stays `stream/admin`. If the Codex run stops, the existing scheduled Claude worker `measures` continues this same lane under the handoff rules in `common.md`. No routine restart by Sean is required.

Your status file is `.factory/admin.md` on `stream/admin`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 29 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **BR-01** Every order keeps its row after a reload (read side)
2. **BR-03** The fix list lives in the control plane
3. **BR-05** Settings with a log and undo
4. **BR-12** Orders show Accepted with a plan, then a progress bar
5. **BR-15** Orders can be scheduled
6. **BR-24** An updates feed with honest labels
7. **BR-07** Every control in Admin can be sent
8. **BR-37** A timer for due orders and the brief that always runs
9. **BR-02** No order sits at "Queued" without a reason
10. **BR-04** Fix items get worked without a dispatch click
11. **BR-09** Unowned work goes to the team, not to Sean
12. **BR-10** One sentence per receipt
13. **BR-11** Two broken numbers fixed, and Eastern days everywhere
14. **BR-26** Ask Admin "why is this place stuck?"
15. **BR-35** Dead gateway actions, sections and routes are removed
16. **BR-36** New orders are written to history with their kind
17. **BR-39** Admin speaks plain English everywhere
18. **CH-12** Pilot ZIPs lose their place at the front of the line
19. **CH-14** Old comments and reasons that read like gates
20. **BR-13** Orders finish with "Done" and the before and after
21. **BR-20** Decision cards that turn into orders
22. **BR-06** A Settings view with a log and an Undo button
23. **BR-18** Plain-words orders through Ask Admin
24. **BR-16** Scheduled orders fire on time, even if a round hangs
25. **BR-27** Reports with wins, problems and decisions; needs BR-14 (measures)
26. **BR-29** Alerts only when Sean is needed; needs BR-14 (measures)
27. **BR-17** "When" on every order: now, at a time, by a date, after something, or repeating; needs BR-14 (measures)
28. **BR-19** Sequenced orders in plain words
29. **BR-28** The daily brief arrives at Sean's time

## Other lanes wait on these of yours (push each the moment it's ready)

- BR-01 → BR-14 (measures)
- BR-01 → BR-23 (measures)
- BR-03 → BR-14 (measures)
- BR-03 → DB-34 (registry)
- BR-03 → DB-35 (registry)
- BR-03 → DP-14 (auditors)
- BR-03 → DP-30 (auditors)
- BR-03 → FE-21 (auditors)
- BR-03 → FE-26 (meetings)
- BR-05 → CA-04 (people)
- BR-05 → CA-10 (people)
- BR-05 → CA-16 (people)
- BR-05 → CH-15 (hunters)
- BR-05 → CH-25 (hunters)
- BR-05 → DB-45 (bank)
- BR-05 → DB-46 (bank)
- BR-05 → DP-11 (auditors)
- BR-05 → DP-17 (auditors)
- BR-05 → DP-23 (bank)
- BR-05 → FE-32 (frontend)
- BR-06 → DB-44 (bank)
- BR-06 → SC-14 (measures)
- BR-12 → BR-14 (measures)
- BR-24 → BR-25 (measures)
- BR-24 → BR-33 (measures)
- BR-24 → CA-37 (ballot)
- BR-24 → DP-26 (auditors)
- BR-24 → DP-33 (auditors)
- BR-24 → SC-10 (measures)

## Notes for this lane

- BR-05 (settings with a log and undo) is what eleven steps in five other lanes wait on. Do it first. Then BR-03 (the fix list), which seven steps in four other lanes and River write to. Give the fix list one clear function for adding an item from code.
- BR-01 is the read side only. BR-36 is the writer.
- BR-29: the alerts switch exists and starts OFF (rulings §0.4). Concerns go in the daily brief (BR-28) at the time Sean sets.
- BR-39: Admin in plain English everywhere, per rulings §10.
- Admin already starts hunts for a state, district or county, and already has priorities, pause and stop, and the budget dial. Connect what's there before building new.
- CH-12 and CH-14 are small cleanups placed here to balance the load.
