# Build lane: bank (Knowledge Bank and Fix Map)

**Suggested starting model: GPT Sol 6.1.** Playbook storage, fix history and reusable methods with focused tests.
**Claude continuation:** existing `registry` worker, using its selected Sonnet 5.5 model unless a supported model change is made. The lane keeps the same scope and branch.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Codex.** Your logical lane stays `bank` and your branch stays `stream/bank`. If the Codex run stops, the existing scheduled Claude worker `registry` continues this same lane under the handoff rules in `common.md`. No routine restart by Sean is required.

Your status file is `.factory/bank.md` on `stream/bank`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 27 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **DP-07** Routes are written for the kind of door, not one address
2. **DB-42** Playbooks, part 1: Scouts and detectives read written playbooks
3. **DB-38** Silent Bank write failures become visible
4. **DB-49** A door-kind fix is checked by its own tests only
5. **DP-09** We can tell how often detectives' routes get reused
6. **DB-37** Lessons and doors in the Bank are tied to places
7. **DB-40** The Bank knows how long and how much each kind of job takes
8. **DB-41** Platform fingerprints are data
9. **DP-08** One place's notes stop crowding everyone's head start
10. **DP-19** A fix map table
11. **DB-51** Dead links are found before readers find them; needs DB-09 (registry)
12. **DB-39** The Bank moves to one row per entry (only if writes are failing)
13. **DB-43** Playbooks, part 2: every other role reads a playbook
14. **DB-46** Switches that need no release; needs BR-05 (admin)
15. **DB-57** A repair agent gets only the broken part
16. **DP-20** The fix map fills from every attempt
17. **DB-44** Playbooks are edited in Admin, with undo; needs BR-06 (admin)
18. **DB-47** Roll back a release from Admin; needs BR-14 (measures)
19. **DB-50** An engineer-built adapter can become a feed; needs DB-17 (registry)
20. **DP-21** Briefs say whether a method works, is untried, or fails here
21. **DP-27** Failures are compared to find what they share
22. **DP-23** A fix moves from Testing to Proven against a bar that is a setting; needs BR-05 (admin)
23. **DP-24** A fix is tried everywhere the same kind of door exists; needs DB-17 (registry)
24. **DB-45** Meeting windows and check timings are settings; needs BR-05 (admin), DB-01 (meetings), DB-26 (meetings)
25. **DB-52** The factory measures how much faster it gets; needs BX-06 (slide)
26. **DP-22** Results in one place no longer overwrite another place's
27. **DP-28** Lessons from losses: predict, build a variant, or call the engineers; needs DP-03 (auditors)

## Other lanes wait on these of yours (push each the moment it's ready)

- DB-42 → CA-25 (ballot)
- DB-51 → FE-26 (meetings)
- DB-51 → FE-28 (frontend)
- DP-07 → DP-10 (auditors)
- DP-20 → DP-30 (auditors)
- DP-21 → CH-20 (hunters)
- DP-23 → DP-25 (auditors)
- DP-23 → DP-26 (auditors)
- DP-23 → DP-33 (auditors)
- DP-23 → DP-34 (auditors)
- DP-24 → DP-25 (auditors)
- DP-28 → DP-29 (auditors)

## Notes for this lane

- The fix map chain, DP-19 → DP-20 → DP-23 and DP-24, feeds the end of the plan's longest chain in the auditors lane (DP-25, DP-30, DP-33, DP-34). Do it early.
- DB-42 (written playbooks) unblocks the ballot lane's translator (CA-25). Push it early.
- DB-46 (switches that need no release) needs admin's BR-05.
- DB-47: the rollback button uses the existing Netlify token if its scope allows (Sean's decision D6). If the token's scope doesn't allow it, write that under `needs Sean` in one line and carry on with everything else.
- Playbooks and settings are data, with a log and undo (rulings §9).
