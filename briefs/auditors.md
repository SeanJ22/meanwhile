# Build lane: auditors (Detectives and Auditors)

**Suggested starting model: Opus 5.5.** Failure diagnosis, provenance, evidence quality and deciding whether repairs really worked.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Claude as an hourly cloud task.** Your primary lane is `auditors`. You also continue the `frontend` lane when River assigns it after its Codex run stops. Work one lane at a time, in separate worktrees, under the ownership and handoff rules in `common.md`.

Your status file is `.factory/auditors.md` on `stream/auditors`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 30 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **DP-02** A passing outage stays a free retry
2. **DP-01** A provenance receipt can no longer stop the research cycle
3. **DP-04** A walk that hits its limit goes to a detective before it is called absent
4. **FE-01** Look at the live site safely
5. **FE-16** Page measurements anyone can run
6. **DP-03** Held records and failed checks go to a detective with the reason
7. **DP-13** Auditors re-read live facts after they publish
8. **DP-15** A pulled fact really leaves the published version
9. **FE-17** Resident tasks written as data
10. **DP-05** The unused rule-based detective is removed
11. **FE-03** Every published place gets warmed, not just the pilots
12. **DP-06** Dead ends say what would unlock them
13. **FE-02** Worst-case speed is measured on production, phone and desktop
14. **DP-14** Red flags are fixed or pulled at once, and the lesson is kept; needs BR-03 (admin)
15. **DP-16** Auditors look harder where it matters
16. **DP-18** Audit accuracy on the Scoreboard; needs BR-23 (measures)
17. **FE-18** Resident tasks run on the live site
18. **FE-21** Every deploy is looked at on the live site; needs FE-20 (registry), BR-03 (admin)
19. **DP-10** A new capability reopens the dead ends it could solve; needs DP-07 (bank)
20. **DP-11** The dead-end hold is a setting tied to the source's pace; needs BR-05 (admin)
21. **DP-17** The audit policy is a setting; needs BR-05 (admin)
22. **FE-04** The ballot is served from the cache; needs CA-32 (ballot)
23. **DP-26** A fix shows once when it proves out, then goes quiet; needs DP-23 (bank), BR-24 (admin), BR-14 (measures), BR-23 (measures)
24. **DP-33** Auditors check the team's own claims; needs DP-23 (bank), BR-24 (admin)
25. **DP-30** Every door and fix keeps its history; needs BR-03 (admin), DB-34 (registry), DP-20 (bank)
26. **DP-29** Every kind of loss is studied; needs DP-28 (bank), DB-32 (registry)
27. **DP-25** Proof means working in many places, not two attempts on one address; needs DP-23 (bank), DP-24 (bank), DP-12 (registry)
28. **DP-31** A repeat break starts from what fixed it last time
29. **DP-32** Patterns in when doors break are learned
30. **DP-34** A green "Proven" means still working today; needs DP-23 (bank)

## Other lanes wait on these of yours (push each the moment it's ready)

- DP-02 → CH-23 (hunters)
- DP-02 → DB-33 (registry)
- DP-02 → DP-12 (registry)
- DP-03 → DP-28 (bank)
- DP-04 → CH-23 (hunters)
- DP-06 → CH-23 (hunters)
- FE-02 → FE-26 (meetings)
- FE-16 → FE-22 (frontend)
- FE-18 → FE-37 (registry)
- FE-18 → FE-40 (registry)
- FE-21 → FE-23 (meetings)
- FE-21 → FE-24 (registry)
- FE-21 → FE-40 (registry)

## Notes for this lane

- DP-01 and DP-02 come first. DP-01 removes a startup halt. DP-02 makes a passing outage a free retry and keeps plain re-reads running while paid research is paused. Edit `scripts/freshness-shadow.mts` only at the agreed lines.
- DP-03 is the detective intake that slide's CP-19 hands dropped fields to. Match the function CP-19 left.
- DP-04 and DP-06 are what hunters' CH-23 waits on.
- DP-25 and DP-30 to DP-34 are the end of the plan's longest chain. They wait on registry (DP-12, DB-34) and bank (DP-20, DP-23, DP-24). Do your other steps while you wait, and take these the moment they're ready.
- FE-01 (look at the live site safely), FE-02, FE-16 to FE-18 and FE-21 (every deploy looked at on the live site) are here because auditing pages belongs with auditing facts.
