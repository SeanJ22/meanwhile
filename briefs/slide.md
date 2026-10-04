# Build lane: slide (Box and Slide)

**Suggested starting model: GPT Astra 6.** Publication and verification connections where a mistake can publish the wrong fact or halt delivery.
**Claude continuation:** existing `hunters` worker, using its selected Opus 5.5 model unless a supported model change is made. The lane keeps the same scope and branch.
Select the model in the actual task/session settings; writing its name in this brief does not switch models. Follow the model and usage rules in `common.md`.

**Starts in Codex.** Your logical lane stays `slide` and your branch stays `stream/slide`. If the Codex run stops, the existing scheduled Claude worker `hunters` continues this same lane under the handoff rules in `common.md`. No routine restart by Sean is required.

Your status file is `.factory/slide.md` on `stream/slide`. A provider change does not change your steps or their acceptance conditions. Read the current assignment on `board/river` before writing.

Read `briefs/common.md` first. It tells you how every run works. This file is your lane's steps and notes. You have 28 steps, and the full text of each is in `plan/plan.md`.

## Your steps, in the order to take them

Take the first one that's ready. "Needs" lists only what you wait on from other lanes. Steps inside your own lane follow the plan's "Depends on" line.

1. **CP-01** No filed mailing address on any card or Ask answer
2. **CP-19** A value must come from the same person's row
3. **BX-01** The Box: one index of every finding
4. **CP-02** The checker labels sources instead of refusing them
5. **CP-09** Every record kind has its design minimum
6. **BX-12** A publish-now lane that runs every minute
7. **CP-10** A portrait from the person's own page publishes at once
8. **CP-13** Candidate enrichment can publish every field
9. **CP-16** Sources lists for meetings, money, votes and actions
10. **CP-11** The campaign-site chain loses its planted-control audit stage
11. **BX-13** Slow discount batches only where no clock is running
12. **CP-05** The quote travels with the fact
13. **CP-06** Dates must make sense
14. **CP-15** The research meeting fact chain is retired
15. **CP-17** Wording that could be wired as a gate
16. **BX-02** Builders take grounded findings straight from the Box
17. **CP-03** Labeled non-official sources reach publication
18. **CP-07** Newer and more official wins, and the conflict is kept
19. **CP-14** The activation gate is gone
20. **BX-03** Publish as soon as a parser result lands
21. **CP-12** The campaign-site second signal is dropped
22. **BX-06** We can see where the flow stops
23. **BX-07** A map from checklist family to reader door, as data; needs SC-02 (measures)
24. **CP-04** Every Sources row says what kind of source it is
25. **CP-08** Contacts follow the same conflict rule, and Admin shows conflicts
26. **CP-18** The same meeting from two sources is shown once, and conflicts are logged
27. **BX-05** Nothing a reader needs is written only to local staging; needs CH-23 (hunters)
28. **BX-04** A finding about someone else reaches their card; needs CH-20 (hunters)

## Other lanes wait on these of yours (push each the moment it's ready)

- BX-01 → CH-20 (hunters)
- BX-02 → CA-52 (ballot)
- BX-02 → CH-22 (hunters)
- BX-02 → DB-54 (registry)
- BX-06 → BR-31 (measures)
- BX-06 → DB-52 (bank)
- BX-07 → CH-18 (hunters)
- BX-12 → DB-26 (meetings)
- CP-02 → CA-02 (people)
- CP-02 → CA-05 (people)
- CP-02 → CA-07 (people)
- CP-02 → CA-11 (people)
- CP-03 → CA-17 (people)
- CP-03 → CA-19 (ballot)
- CP-09 → BX-11 (meetings)
- CP-09 → CA-11 (people)
- CP-09 → CA-33 (ballot)
- CP-10 → CA-08 (people)
- CP-14 → CA-17 (people)
- CP-16 → FE-12 (frontend)
- CP-16 → FE-14 (frontend)

## Notes for this lane

- CP-01 and CP-19 stop harm readers see today. Do them first. CP-01: no candidate's filed mailing address on any card or Ask answer (rulings §9). Search the whole codebase for every path a filed address takes. CP-19: a field found outside its person's row never publishes.
- BX-01 (the Box), BX-02 and BX-12 (the publish-now lane) are what the hunters, meetings, registry and ballot lanes wait on. Push each one the moment it's ready.
- CP-02 (sources labeled, not refused) unblocks the people lane's CA-02, CA-05, CA-07 and CA-11. Push it early.
- You own `standing-runtime.ts`, which hunters need for CH-06, CH-26 and CH-28. Answer hook requests fast.
- Rulings §3 is the standard. Add no check beyond it.
