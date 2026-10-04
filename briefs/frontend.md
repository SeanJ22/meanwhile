# Build lane: frontend (Front-end)

**Suggested starting model: GPT Sol 6.1.** Components, layouts, accessibility and browser-driven implementation.
**Claude continuation:** existing `auditors` worker, using its selected Opus 5.5 model unless a supported model change is made. The lane keeps the same scope and branch.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Codex.** Your logical lane stays `frontend` and your branch stays `stream/frontend`. If the Codex run stops, the existing scheduled Claude worker `auditors` continues this same lane under the handoff rules in `common.md`. No routine restart by Sean is required.

Your status file is `.factory/frontend.md` on `stream/frontend`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 29 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **FE-07** Type-rung classes for the six sizes
2. **FE-19** The look standard is written down
3. **FE-29** One "working on it" component with three states (map and popups)
4. **FE-06** The spacing and type guard covers components too
5. **FE-05** Contrast is checked on every change
6. **FE-38** One Admin stylesheet, and no leftover Admin prefix
7. **FE-39** No pilot ZIP buttons on the welcome screen
8. **FE-43** The homepage keeps working when the map can't draw
9. **FE-44** Federal offices are tagged Federal on the ballot
10. **FE-10** One finished Card with a Sources section built in
11. **FE-30** The same three states on the ballot, officials and money; disclaimers deleted
12. **FE-08** Map and popup components use the tokens
13. **FE-09** Ballot and Ask components use the tokens
14. **FE-32** Reader labels and help text are settings; needs BR-05 (admin)
15. **FE-34** Online-only meetings get a pin at the body's address; needs CA-06 (people), BX-08 (meetings)
16. **FE-41** Officials and shell components use the tokens
17. **FE-45** Nearby meetings are labeled nearby, and the place's own governments are counted apart
18. **FE-11** One person card, mounted for officials
19. **FE-13** One body card
20. **FE-12** One meeting card, with its sources in a Sources section; needs CP-16 (slide)
21. **FE-28** A dead link shows as text, not a broken link; needs DB-51 (bank)
22. **FE-31** A guard keeps the reader copy honest
23. **FE-35** Offices near you are pins with directions; needs CA-07 (people), BX-08 (meetings)
24. **FE-36** A plain record card for things with no shape; needs CA-37 (ballot)
25. **FE-42** Candidates use the same person card
26. **FE-15** Official and body cards keep sources in their Sources section
27. **FE-14** Ballot and money cards keep sources in their Sources section; needs CP-16 (slide)
28. **FE-33** Every candidate shows the ten topics on the ballot, never hidden; needs CA-14 (people), CA-15 (people)
29. **FE-22** A check that sources never leak onto card faces; needs FE-16 (auditors)

## Other lanes wait on these of yours (push each the moment it's ready)

- FE-11 → CA-14 (people)
- FE-13 → CA-54 (ballot)
- FE-19 → FE-20 (registry)

## Notes for this lane

- FE-07 (type sizes) and FE-10 (one finished Card with a Sources section) are what most of your list and the people lane's CA-14 wait on. Do them first.
- Sources live only in a card's Sources section, never on its face (rulings §3).
- Uncovered sections say "We're working on getting this info", with the existing "Want us to get this sooner?" link (rulings §10).
- Every page is usable within three seconds, cold, on a phone (rulings §6). Look at the live page after each release, not just the code.
- FE-39 removes the pilot ZIP buttons. FE-43 keeps the homepage working when the map can't draw.
