# Build lane: people (People and Stances)

**Suggested starting model: Sonnet 5.5.** Profiles, source-backed statements and existing publishing connections.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Claude as an hourly cloud task.** Your primary lane is `people`. River may assign eligible overflow work through the ownership rules in `common.md`.

Your status file is `.factory/people.md` on `stream/people`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 27 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **CA-09** Statements carry what kind of source they came from
2. **CA-12** Ask answers with a person's exact words
3. **CA-01** Open States can publish legislators again (authority and firewall)
4. **CA-06** Bodies have a published office address and phone
5. **CA-42** A person's votes stay with them after they leave
6. **CA-03** Terms have a start and an end
7. **CA-13** Topic chips stop erroring
8. **CA-46** PRL's measurements and Sean's key votes on person cards
9. **CA-47** Curated rosters and statewide officers become data
10. **CA-48** Curated bodies become data
11. **SC-15** The unused checklist census is removed
12. **SC-18** The unused readiness snapshot and dead ZIP planners are removed
13. **CA-10** One list of ten stance topics, as a setting; needs BR-05 (admin)
14. **CA-15** A statement sweep for every person, from what we already hold
15. **CA-04** The social platform list is a setting, with six pills; needs BR-05 (admin)
16. **CA-07** Offices near you, for people; needs CP-02 (slide)
17. **CA-08** Candidate portraits come from the campaign's own page, with no release; needs CP-10 (slide)
18. **CA-02** Open States fills a legislator seat when the own-page check fails; needs CP-02 (slide)
19. **CA-11** A stances door publishes people's own words; needs CP-02 (slide), CP-09 (slide)
20. **CA-05** Social accounts are collected for everyone; needs CP-02 (slide)
21. **CA-16** The statement sweep searches, and searches more as the election nears; needs BR-05 (admin)
22. **CA-17** Candidate profiles publish on their own; needs CP-03 (slide), CP-14 (slide)
23. **CA-40** What they said at the time; needs DB-06 (meetings)
24. **CA-41** Ask answers from meeting history; needs DB-06 (meetings), DB-07 (meetings)
25. **CA-14** Each stance topic is a ready-made answer that opens instantly; needs FE-11 (frontend)
26. **CA-18** Statements and the candidate corpus publish on their own
27. **CA-43** The people layer updates when someone leaves or a seat changes; needs DB-29 (meetings)

## Other lanes wait on these of yours (push each the moment it's ready)

- CA-06 → FE-34 (frontend)
- CA-07 → FE-35 (frontend)
- CA-14 → FE-33 (frontend)
- CA-15 → FE-33 (frontend)

## Notes for this lane

- PRL's licence covers every place (D2). The text of social posts comes from PRL (D4). PRL's measurements show on person cards credited to PRL. Sean picks key votes himself: build the place he enters them, and never choose them for him (CA-46).
- Every candidate gets the same effort on the same ten topics. "Not found in the sources checked" appears only after a full sweep (rulings §10).
- CA-12 touches Ask (`lib/ask/`, owned by the ballot lane). Use the hook rule.
- SC-15 and SC-18 (unused checklist code removed) are here to balance the load.
