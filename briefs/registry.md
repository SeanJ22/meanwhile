# Build lane: registry (Door Registry)

**Suggested starting model: Sonnet 5.5.** Well-defined registry, source and refresh contracts.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Claude as an hourly cloud task.** Your primary lane is `registry`. You also continue the `bank` lane when River assigns it after its Codex run stops. Work one lane at a time, in separate worktrees, under the ownership and handoff rules in `common.md`.

Your status file is `.factory/registry.md` on `stream/registry`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 27 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **DB-09** The Door Registry: one editable list of every door
2. **DB-10** The registry is seeded from today's meeting doors
3. **DB-11** Non-meeting feeds are doors too
4. **FE-20** A look reviewer separate from the builder; needs FE-19 (frontend)
5. **DB-17** Any adapter kind can be added as a data row
6. **DB-25** Each check looks before it reads
7. **DB-12** Adapters read their doors from the registry
8. **DB-21** Each door knows when it last worked
9. **DB-54** Pages that feed live facts become doors; needs BX-02 (slide)
10. **DB-23** Route hints become door records
11. **DB-13** The runner builds its meeting work from the registry every pass
12. **DB-32** A door that stops working is marked shut at once
13. **FE-24** Sean rates a sample of real screens; needs FE-21 (auditors), BR-23 (measures)
14. **FE-37** Admin itself is reviewed by running Sean's tasks; needs FE-18 (auditors), BR-25 (measures)
15. **FE-40** Dated one-off screenshot and walk scripts are retired; needs FE-18 (auditors), FE-21 (auditors)
16. **DB-14** Refresh requests and observability read the registry
17. **DB-34** Shut doors go to the top of the list, and repairs are recorded; needs BR-03 (admin)
18. **DB-35** A door is repaired by editing its record; needs BR-03 (admin)
19. **DB-16** Allowed hosts come from each door
20. **DB-18** The Tucson board portal reader becomes a general kind
21. **DB-19** The community college reader and the TUSD hook become general kinds
22. **DB-33** A shut door gets a detective at once, wherever it is; needs DP-02 (auditors)
23. **FE-25** Pages are judged side by side with the best
24. **DB-15** Reader coverage and curated-body status read the registry
25. **DP-12** A detective's door repair is used on the very next check; needs DP-02 (auditors)
26. **DB-36** A door edit is applied at once, not on a six-hour clock
27. **DB-20** Door membership is no longer code

## Other lanes wait on these of yours (push each the moment it's ready)

- DB-09 → DB-27 (meetings)
- DB-09 → DB-51 (bank)
- DB-10 → DB-26 (meetings)
- DB-10 → DB-28 (meetings)
- DB-11 → CA-21 (ballot)
- DB-11 → CA-35 (ballot)
- DB-11 → CA-52 (ballot)
- DB-11 → DB-28 (meetings)
- DB-13 → DB-22 (meetings)
- DB-13 → DB-56 (meetings)
- DB-17 → DB-50 (bank)
- DB-17 → DP-24 (bank)
- DB-21 → DB-30 (meetings)
- DB-21 → DB-31 (meetings)
- DB-25 → DB-26 (meetings)
- DB-25 → DB-27 (meetings)
- DB-32 → DP-29 (auditors)
- DB-34 → BR-32 (measures)
- DB-34 → DP-30 (auditors)
- DB-54 → DB-28 (meetings)
- DP-12 → DP-25 (auditors)
- FE-20 → FE-21 (auditors)

## Notes for this lane

- **You carry the longest chain in the plan:** DB-09 → DB-10 → DB-12 → DB-13 → DB-14 → DB-15 → DB-20, then DB-21 → DB-32 → DB-34/DB-35 → DP-12, which the auditors' DP-25 and DP-30 to DP-34 wait on. Keep that chain moving before anything else.
- DB-18 and DB-19 turn today's one-place readers into general door kinds. New code never names a place.
- `scripts/ingest.ts` is owned by the meetings lane. Use the hook rule.
- Doors are data, edited with a log and undo, and take effect without a release (rulings §9).
- FE-20, FE-24, FE-25, FE-37 and FE-40 (the look reviewer, Sean's rating sample, side-by-side comparison, Admin task review, retiring old scripts) are here to balance the load. FE-24 builds the tool Sean rates screens in. His ratings are his choice and block nothing.
