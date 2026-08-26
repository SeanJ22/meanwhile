# The candidate questionnaire — question set `v2`

**GENERATED FILE.** Written by `corepack pnpm questionnaire:doc --write` from
`lib/questionnaire/instrument.ts`, which is the single copy of these questions.
Editing this file by hand makes it disagree with what candidates are actually
asked; `tests/questionnaire.test.ts` fails the build when it does.

Version `v2`, fixed 2026-08-25.

---

## Why the version is recorded on every answer

Changing the question set mid-cycle across candidates who already answered the
old version breaks symmetry: two people in one contest would have answered two
different instruments, and their answers would render side by side as though
they had answered the same one. So the version travels with the response and a
bump is a decision, never a tidy-up.

## The rules every question here is held to

- **Five questions.** Three core, two keyed to the kind of office.
- **200 words per answer — the same limit for every question, every candidate,
  every contest and every office class.** Nothing is ever truncated: an
  over-limit answer is refused at submit time with its own word count shown, and
  the candidate decides what to cut.
- **Non-leading.** No question that can only be answered from one side, and none
  that assumes a candidate wants to change anything or keep anything.
- **No question tells a candidate what the office does.** That would be an
  unsourced claim about a class of body wearing a question mark. Every class
  question asks.
- **Plain language.** Every question passes the 15-year-old test.

---

## The core — asked of every candidate for every office at every level

1. **Why are you running for this office?**
   *200 words · `q1_why_running`*
2. **What are your top priorities?**
   *200 words · `q2_priorities`*
3. **If you win, what is the first thing you would work on?**
   *200 words · `q3_first_thing`*

## The class layer — two questions, by kind of office

### School board — `school_board`

4. **What do you think a school board's most important job is?**
   *200 words · `q4_job_school_board`*
5. **Some school board decisions affect one school and some affect the whole district. How would you weigh those against each other?**
   *200 words · `q5_scale_school_board`*

### Town, township, borough or city governing body — `municipal_governing`

4. **What do you think this council's most important job is?**
   *200 words · `q4_job_municipal`*
5. **Some decisions here affect one neighbourhood and some affect the whole town. How would you weigh those against each other?**
   *200 words · `q5_scale_municipal`*

### County governing board — `county_governing`

4. **What do you think county government's most important job is?**
   *200 words · `q4_job_county`*
5. **Some county decisions affect one town and some affect the whole county. How would you weigh those against each other?**
   *200 words · `q5_scale_county`*

### County office that runs one service (clerk, sheriff, surrogate and the like) — `county_row_office`

4. **What do you think this office's most important job is?**
   *200 words · `q4_job_county_row`*
5. **This office serves the whole county, one person at a time. How would you weigh what one person needs against what the office has to do for everyone?**
   *200 words · `q5_scale_county_row`*

### State legislature — `state_legislative`

4. **What do you think a state legislator's most important job is?**
   *200 words · `q4_job_state_legislative`*
5. **Some decisions in the legislature affect the area you would represent and some affect the whole state. How would you weigh those against each other?**
   *200 words · `q5_scale_state_legislative`*

### Statewide executive office — `state_executive`

4. **What do you think this office's most important job is?**
   *200 words · `q4_job_state_executive`*
5. **Some decisions in this office affect one part of the state and some affect the whole state. How would you weigh those against each other?**
   *200 words · `q5_scale_state_executive`*

### United States Senate or House of Representatives — `federal_legislative`

4. **What do you think a member of Congress's most important job is?**
   *200 words · `q4_job_federal_legislative`*
5. **Some decisions in Congress affect the area you would represent and some affect the whole country. How would you weigh those against each other?**
   *200 words · `q5_scale_federal_legislative`*

### Special district (water, fire, library and the like) — `special_district`

4. **What do you think this district's most important job is?**
   *200 words · `q4_job_special_district`*
5. **Some decisions here affect one part of the area this district covers and some affect all of it. How would you weigh those against each other?**
   *200 words · `q5_scale_special_district`*

### Any other office — `other`

4. **What do you think this office's most important job is?**
   *200 words · `q4_job_other`*
5. **Some decisions in this office affect one part of the area it serves and some affect all of it. How would you weigh those against each other?**
   *200 words · `q5_scale_other`*

---

## What happens to an answer

It publishes **verbatim**. Nobody edits it, shortens it, summarises it, rewrites
it, paraphrases it, compresses it with a language model, fact-checks inside it,
rates it or adds an editorial note to it. The Citizens Clean Elections
Commission's *in their own words* is the model.

A candidate may update an answer at any time. Every version is kept with its
date; the latest renders, marked with the date it was updated. A candidate who
withdraws returns to the neutral invited state — the card does not say they
answered and then withdrew.

