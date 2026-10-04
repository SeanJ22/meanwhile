# Build lane: ballot (Ballot, Money and Ask)

**Suggested starting model: GPT Sol 6.1.** Collector and Ask implementation against explicit contracts; escalate difficult multi-source reasoning.
**Claude continuation:** existing `meetings` worker, using its selected Sonnet 5.5 model unless a supported model change is made. The lane keeps the same scope and branch.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Codex.** Your logical lane stays `ballot` and your branch stays `stream/ballot`. If the Codex run stops, the existing scheduled Claude worker `meetings` continues this same lane under the handoff rules in `common.md`. No routine restart by Sean is required.

Your status file is `.factory/ballot.md` on `stream/ballot`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 30 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **CA-24** Ballot measures are records, not code
2. **CA-31** A ballot contests door for any place
3. **CA-20** FEC money for every member and every candidate in a sent place
4. **CA-44** Money shows filings without disclaimers
5. **CA-23** Local money shows on the person's card
6. **CA-49** Ask answers within three seconds, even cold
7. **CA-51** Ask answers "who's running" for any office on the reader's ballot
8. **CA-25** The translator, part 1: measures and their parts; needs DB-42 (bank)
9. **CA-37** Things that fit no shape still go up; needs BR-24 (admin)
10. **CA-32** The ballot page and Ask read the general ballot
11. **CA-30** YES and NO each get their own line
12. **CA-33** A ballot measures door for any place; needs CP-09 (slide)
13. **CA-45** Money reports what filings say, plus the small-donor share
14. **CA-52** Budgets, part 1: each government's adopted budget (FIN-01 to FIN-05); needs DB-11 (registry), BX-02 (slide)
15. **CA-21** State and local campaign finance are door kinds; needs DB-11 (registry)
16. **CA-26** The translator, part 2: what a kind of body is, and what this body can do
17. **CA-27** The translator, part 3: what an office does
18. **CA-28** The translator, part 4: agendas and minutes in plain English
19. **CA-38** Kinds of things are data, starting with special districts
20. **CA-19** Executive actions for any state, on their own; needs CP-03 (slide)
21. **CA-35** Polling places by door kind; needs DB-11 (registry)
22. **CA-53** Budgets, part 2: totals, revenue, spending, contracts, debt, audits and grants (FIN-06 to FIN-16)
23. **CA-22** Top donors and PACs for state and local races
24. **CA-29** Existing definitions become translation records
25. **CA-34** Campaign-finance work comes from the ballot, not a hard-coded list
26. **CA-36** Ask fetches full detail through the keys when asked
27. **CA-39** A new kind of thing joins a place's owed list; needs SC-10 (measures)
28. **CA-50** Existing measure, notice and minutes summaries become translation records
29. **CA-55** Special districts get boundaries, so they show only for addresses they serve
30. **CA-54** Budgets on the body card and in Ask; needs FE-13 (frontend)

## Other lanes wait on these of yours (push each the moment it's ready)

- CA-32 → FE-04 (auditors)
- CA-37 → FE-36 (frontend)

## Notes for this lane

- Money: individual donors are never named. Totals, plus the share from donors giving $200 or less in the cycle, from the filings' own lines (CA-45, rulings §9). Filed mailing addresses never show.
- Ballot measures are summarized only from the official text, in neutral words. The translator is checked by a second model (CA-25 to CA-29).
- CA-31 (a contests door for any place) unblocks CA-32 to CA-34 and frontend's FE-04. Do it early.
- CA-52 to CA-55 (government budgets and special-district boundaries) are collectors that work for any place and run through the factory. Nothing is hand-filled.
- You own Ask (`lib/ask/`, `app/api/ask/`). Ask answers within three seconds, even cold (CA-49).
