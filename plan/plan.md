# Civic Data Factory: master build plan (version 6)

This plan builds the approved Civic Data Factory design (version 16) from the code on `main` at commit `022a183c`. This is version 6 of the plan. Version 6 builds all 321 steps inside the 36 hours, across eleven lanes in Claude and Codex plus River. Version 5 applied Sean's rulings decisions of Oct 3 and what live Admin actually shows. Version 4 added how code reaches `main` and the findings of an outside audit made on Oct 3. It merges the eight first-pass reports (A–H), the four verification reports (V1–V4) and an independent review, each checked against the code. Where reports disagreed, the step follows the code, and the detail a builder needs is in the step itself.

Plan rules applied everywhere: no durations, dates or time estimates on steps (the one time in this plan is yours: all 321 steps within 36 hours); no new gates, approvals, certifications or proof ceremonies; nothing built for one place. Every step works for any place with the same kind of door or page. Steps that remove existing special-casing for one place are included on purpose.

Lanes (one owner per step): Admin, Coach & Hunters, Box & Slide, Checkers & Publishing, Doors & Bank, Detectives & Proving, Collects & Ask, Front-end, Scorecard, Release.

Step IDs are stable and carry the lane: BR (Admin), CH (Coach & Hunters), BX (Box & Slide), CP (Checkers & Publishing), DB (Doors & Bank), DP (Detectives & Proving), CA (Collects & Ask), FE (Front-end), SC (Scorecard), RL (Release). Stages are ordered by real dependency: a step sits in the earliest stage where everything it depends on is already in an earlier stage. No step depends on another step in its own stage, so every step in a stage can run in parallel with every other step in that stage.

---

## What changed in this version

**Version 6 (Oct 3, evening):**
1. **The whole plan is the 36-hour goal.** All 321 steps are built, connected, deployed and checked on the live system within 36 hours of launch. The 83-step first push is no longer a separate round. Proving each part across many places continues afterward, with the Testing and Proven labels.
2. **Eleven build lanes, six in Claude and five in Codex, run at the same time, plus River.** Every step has an owner from the start (see "How the build runs").
3. **Releases to `main` about every eight hours,** around five in all, with one narrow exception for urgent production repairs. Lanes share work through the `river` branch, so nobody waits for a release.
4. **Each lane pushes only to its own branch** and acts on this plan and Sean's rulings. Only River's release pull request reaches `main`.

**Version 5:**

1. **Your rulings decisions of Oct 3 are in.** The rulings batch is now final wording, ready to go into `docs/rulings.md` (22 items). The design is version 16 to match.
2. **Meetings: within the hour, inside the 7-day window.** The checks in rulings §4 stay as they are. Inside the 7-day window, what a body posts is live by the next hourly check; outside it, the twice-daily check picks it up. The separate watch on every source is gone: DB-25 and DB-26 now make the existing checks cheaper and publish what they find at once.
3. **Admin was checked live.** Starting hunts for a state, congressional district or county, priorities, pausing, stopping and the budget dial already work. BR-08 and BR-22 now connect what is there instead of building it. Scheduling orders, the order history and the daily brief are the real gaps.
4. **Three new steps in the first push:** CH-29 (348 items stuck because our own spending guard refused them), CH-30 (276 items whose work was thrown away when the AI service didn't answer) and BR-39 (Admin in plain English, with no code names).
5. **Steps changed by your decisions:**
   - CP-10, portraits from official sources and campaign sites;
   - CP-07, newer official beats older official;
   - DP-11, dead ends wait at most 5 days while expanding;
   - DP-24, places for trying a fix are picked by kind or at random, never because they are next;
   - CA-45, the small-donor share;
   - CA-46, PRL's measurements and your key votes;
   - FE-29, "Not found in the sources checked";
   - BR-05 and BR-06, the settings log;
   - BR-29, alerts built with a switch that starts off;
   - DB-45, the check settings.
6. **Every decision is answered except D7, which you parked.** D1, D3 and D5 on Oct 3 in the rulings, and D2 (PRL's licence covers every place), D4 (post text comes from PRL), D6 (yes to the rollback button) and D8 (no real-reader timing; we test speed ourselves) the same evening. None of these changes the rulings.
7. **RL-07 is new:** a change that only touches documents runs only the tests that read those documents, so it no longer costs a 30-minute check.
8. **Version 4, for reference:** it added the first push, the river, the Release lane and 20 steps from the outside audit, each checked against the code.

---

## Where things stand today

**Worth keeping.**
1. The routine Slide works: meetings from wired doors are re-read with no AI cost, checked by code, promoted atomically and published with a cache purge, and officials from their own pages, election-office fields, comment rules, service contacts and filings publish on their own.
2. A Send for any registered state creates work for every government in the place, and the national place job fills federal and state facts first with no model cost.
3. Every research role reads and writes the field manual (the Knowledge Bank's lessons) with no human step.
4. Admin is already one command center whose controls go through one receipted gateway, and its spend ceiling really binds the runner.
5. The pre-restart runner fixes (#670, #671, #672, #674, #675), the lazy linking fix (#679) and the scout-publication work (#666, #681, #697) are all merged in `022a183c`; whether production runs that commit is read out of Admin (CH-01).

**Broken.**
6. Scout findings outside campaign sites still never reach readers, because the registry lane writes them only to local staging files, so paid research mostly produces nothing a reader sees.
7. One unpriced model charge can set paid capacity to zero, a seven-row receipt check at startup can halt the research cycle, and orders other than pause and resume lose their status on reload.
8. Readers are harmed today: concluded meetings are deleted once they pass 90 days (current rulings already forbid this), and candidates' filed mailing addresses, many of them homes, show on ballot cards and in Ask.
9. The checker refuses every non-official page, and a campaign-site chain plus seven owner-invoked contracts make contests, candidate profiles and portraits, stances, measures, executive actions and reviewed venue pins wait for a person.
10. The place score is not honest: the owed list uses wrong units in places, counts "the government doesn't publish it" as captured, and only 43 of 218 civic items have any code that can fill them.
11. Much is still built for three states or one place, from ballots, state money, local votes, measures and curated rosters to pilot-ZIP priority, the original Send's privileges and per-place feeds (the Tucson board portal, the community college reader, the TUSD hook, two county outcome contracts).

12. The checks can tie a value to the wrong person: a record's fields only have to appear somewhere on the page, not in that person's row (CP-19).
13. The full test run on `main` failed on every scheduled run on Oct 3, on one counting script (RL-01), and 33 pull requests sit open, 20 of them red only because they wait on auto-merge (RL-02).
14. Public meeting snapshots were still dated Sept 29 on Oct 3 while new publication attempts were being held (DB-59).
15. Readers hit three smaller faults: Ask can't find local candidates the ballot shows (CA-51), the homepage fails when a device can't draw the map (FE-43), and U.S. Senate races are tagged State (FE-44).

**Missing.**
16. The factory has no Box, no squads, no single editable Door Registry, no shut-door alarm, nothing that gets new postings live within the hour, no 120-day held window, no auditor re-reading live facts, no Proven/Testing labels or fix map, no plain-English translator, and no front-end reviewer judging the live page.
17. Admin already starts hunts for a whole state, congressional district or county, sets priorities, pauses and stops hunts and paid work, and sets the daily budget. It lacks orders set for a time, a date or a repeat, an order history that keeps every order, the daily brief, decision cards that become orders, settings with undo, and most Scoreboard rows. Several buttons show "Not connected yet", and stuck causes often show as code names.
18. Speed is limited by structure more than money: the research side is one serial child per cycle with a 15-minute paid slice and full-history loads per task, so hunters cannot reach "hundreds at once" whatever the budget.
19. There is no way to fold many sessions' code into a few merges a day (RL-03), and nothing collects government budgets and finance or the boundaries of special districts (CA-52 to CA-55).
20. On Oct 3, live Admin showed 2,818 stuck items. 348 were refused by our own spending guard before anything was sent (CH-29), and 276 lost their work when the AI service didn't answer (CH-30).

---

## How the build runs: all 321 steps

The goal Sean set: every step in this plan built, connected, deployed and working on the live system within 36 hours of launch. After that the factory runs on its own. Each method, door and fix carries a Testing label the first time it works, and a Proven label once it has worked across enough places.

### The lanes

Eleven build lanes and River run at the same time. Each lane owns a set of steps and the files they touch. It works in its own cloud workspace and on its own branch, and keeps going until its list is done.

| Lane | Runs in | Steps | What it covers |
|---|---|---|---|
| measures | Claude | 30 | The State Run Checklist as data, the mission map, the Scoreboard, Now and the queue board |
| hunters | Claude | 30 | The coach, squads, hunters running continuously, spending and lost work put back, runner releases |
| registry | Claude | 27 | The Door Registry (the longest chain in the plan), shut doors, door repair, the look reviewer |
| meetings | Claude | 27 | Meeting history, the 120/90-day windows, live within the hour, refresh, venue pins |
| auditors | Claude | 30 | Detectives, auditors, proving and learning from losses, looking at the live site |
| people | Claude | 27 | Officials and candidates, stances, socials, portraits, PRL measures and key votes |
| admin | Codex | 29 | Orders, settings with undo, the fix list, controls, reports and the daily brief, plain English |
| slide | Codex | 28 | Checkers, the Box, the publish-now lane, portraits and addresses |
| ballot | Codex | 30 | Contests, measures, the translator, campaign money, budgets, special districts, Ask |
| bank | Codex | 27 | The Knowledge Bank, playbooks, no-release switches, rollback, the fix map |
| frontend | Codex | 29 | The shared Card and design tokens, person, meeting and body cards, reader copy, pins |
| River | Claude | 7 | Combines, tests, releases and checks live (RL-01 to RL-07) |

Why eleven and not five: on Oct 2, sessions here shipped roughly one plan-sized change an hour. At five lanes, the 314 build steps come to about 63 each, close to three days. At eleven, it's 27 to 30 each. The total work, and so the total cost, is the same either way. It just runs side by side.

Every step's lane:

- **measures** (Claude): BR-08, BR-14, BR-21, BR-22, BR-23, BR-25, BR-30, BR-31, BR-32, BR-33, BR-34, BR-38, SC-01, SC-02, SC-03, SC-04, SC-05, SC-06, SC-07, SC-08, SC-09, SC-10, SC-11, SC-12, SC-13, SC-14, SC-16, SC-17, SC-19, SC-20
- **hunters** (Claude): CH-01, CH-02, CH-03, CH-04, CH-05, CH-06, CH-07, CH-08, CH-09, CH-10, CH-11, CH-13, CH-15, CH-16, CH-17, CH-18, CH-19, CH-20, CH-21, CH-22, CH-23, CH-24, CH-25, CH-26, CH-27, CH-28, CH-29, CH-30, DB-48, DB-53
- **registry** (Claude): DB-09, DB-10, DB-11, DB-12, DB-13, DB-14, DB-15, DB-16, DB-17, DB-18, DB-19, DB-20, DB-21, DB-23, DB-25, DB-32, DB-33, DB-34, DB-35, DB-36, DB-54, DP-12, FE-20, FE-24, FE-25, FE-37, FE-40
- **meetings** (Claude): BX-08, BX-09, BX-10, BX-11, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08, DB-22, DB-24, DB-26, DB-27, DB-28, DB-29, DB-30, DB-31, DB-55, DB-56, DB-58, DB-59, FE-23, FE-26, FE-27
- **auditors** (Claude): DP-01, DP-02, DP-03, DP-04, DP-05, DP-06, DP-10, DP-11, DP-13, DP-14, DP-15, DP-16, DP-17, DP-18, DP-25, DP-26, DP-29, DP-30, DP-31, DP-32, DP-33, DP-34, FE-01, FE-02, FE-03, FE-04, FE-16, FE-17, FE-18, FE-21
- **people** (Claude): CA-01, CA-02, CA-03, CA-04, CA-05, CA-06, CA-07, CA-08, CA-09, CA-10, CA-11, CA-12, CA-13, CA-14, CA-15, CA-16, CA-17, CA-18, CA-40, CA-41, CA-42, CA-43, CA-46, CA-47, CA-48, SC-15, SC-18
- **admin** (Codex): BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-09, BR-10, BR-11, BR-12, BR-13, BR-15, BR-16, BR-17, BR-18, BR-19, BR-20, BR-24, BR-26, BR-27, BR-28, BR-29, BR-35, BR-36, BR-37, BR-39, CH-12, CH-14
- **slide** (Codex): BX-01, BX-02, BX-03, BX-04, BX-05, BX-06, BX-07, BX-12, BX-13, CP-01, CP-02, CP-03, CP-04, CP-05, CP-06, CP-07, CP-08, CP-09, CP-10, CP-11, CP-12, CP-13, CP-14, CP-15, CP-16, CP-17, CP-18, CP-19
- **ballot** (Codex): CA-19, CA-20, CA-21, CA-22, CA-23, CA-24, CA-25, CA-26, CA-27, CA-28, CA-29, CA-30, CA-31, CA-32, CA-33, CA-34, CA-35, CA-36, CA-37, CA-38, CA-39, CA-44, CA-45, CA-49, CA-50, CA-51, CA-52, CA-53, CA-54, CA-55
- **bank** (Codex): DB-37, DB-38, DB-39, DB-40, DB-41, DB-42, DB-43, DB-44, DB-45, DB-46, DB-47, DB-49, DB-50, DB-51, DB-52, DB-57, DP-07, DP-08, DP-09, DP-19, DP-20, DP-21, DP-22, DP-23, DP-24, DP-27, DP-28
- **frontend** (Codex): FE-05, FE-06, FE-07, FE-08, FE-09, FE-10, FE-11, FE-12, FE-13, FE-14, FE-15, FE-19, FE-22, FE-28, FE-29, FE-30, FE-31, FE-32, FE-33, FE-34, FE-35, FE-36, FE-38, FE-39, FE-41, FE-42, FE-43, FE-44, FE-45
- **River** (Claude): RL-01 to RL-07.

Each lane's brief lists its steps in the order to take them, with the steps others are waiting on and the longest chains first. It also lists what the lane waits on from other lanes, and which lanes wait on it.

### What decides the finish time

1. **Average pace per step.** Run against every dependency in this plan:
   - at one hour per step, everything is on the river by about hour 32;
   - at 1.1 hours, by about hour 36;
   - at 1.25 hours, by about hour 40.

   The final release and its live check follow within about two hours.
2. **Waiting on other lanes adds no idle time,** as long as each lane takes its steps in the listed order. A blocked lane always has another ready step.
3. **The longest chain is seven steps deep.** It runs through the Door Registry (DB-09 → DB-10 → DB-12 → DB-13 → DB-14 → DB-15 → DB-20) and ends in the auditors' DP-25 and DP-30 to DP-34. The registry lane takes that chain first.
4. **From hour 8, River measures each lane's real pace.** A lane headed past hour 36 has its remaining steps split off into an overflow lane. Sean approves up to two.
5. **Named risks:**
   - Claude and Codex usage limits with this many sessions at once;
   - SC-17 waits on decision D7, which Sean parked;
   - a few "done when" lines need more days or more places, such as the proof bar and trends. Those steps are built inside the 36 hours and reported as "built, proving over time".

### How code moves: streams, river, main

1. **Streams.** Each lane pushes only to its own branch, `stream/<lane>`, never to `main` or `river`. It runs focused checks in its own workspace (lint, types, and the tests its change reaches) and marks finished batches `READY`. A Codex lane that can't push a branch directly keeps one draft pull request into `river`. Drafts start no checks.
2. **River.** River folds the ready batches into the `river` branch and runs the full check once on the combination. If the check fails, it splits the group to find the batch that broke it and sends that batch back to its lane. The rest go in.
3. **Building on each other.** Lanes build on `river`, so a step that needs another lane's work starts as soon as that work is on the river. Nothing waits for a release.
4. **Releases.** About every eight hours, River releases `river` to `main` as one pull request from a `release/<n>` branch, around five releases in all. The checks run once and Netlify deploys once. Nothing is released just because a lane is waiting.
5. **The one exception is an urgent production repair:** readers shown something harmful or wrong, the runner halted or losing work, or a release that broke production. That fix goes out on its own, at once.
6. **After each release,** River:
   - starts the after-deploy check;
   - confirms Netlify published the release;
   - confirms the production runner picked up the new code;
   - checks every step's "Done when" on the live system.

   A step that fails live goes back to its lane and onto the fix list.
7. **Data never waits for code.** Facts, doors, settings and playbooks still go live with no release.

### How the lanes keep going

1. **Each lane acts on this plan and Sean's rulings.** Rulings §8 makes every "how" the team's call. Only credentials, a new paid service, spending beyond the budget, and decision D7 go to Sean, and they reach him through River.
2. **Progress lives on each lane's own branch,** in a status file saved after every step. A run that's cut off is picked up exactly where it stopped, and a lock stops two runs of the same lane from overlapping.
3. **Claude lanes and River restart hourly** as scheduled tasks on Sean's account, in the cloud, with his PC off.
4. **Codex lanes are started by Sean** from their start prompts. If Codex offers cloud automations on his account, the same prompt set to repeat hourly restarts a lane on its own. If not, River tells Sean in one line when a Codex lane needs starting again.
5. **River reads every lane's status**, restarts a stalled Claude lane, sends failures back, and passes hook requests between lanes.
6. **Live checks.** River reads reader pages directly, and Admin's numbers from the production database, read only. Admin's screens need Sean's Google sign-in, so their look is checked whenever Sean, or his oversight chat, next opens Admin.
7. **Notifications come only from River,** as progress updates, for example "Release 2 is deployed, the workers are running it, and 23 of its 26 steps checked out live."

### Cost

1. **Pushing a branch costs nothing.** GitHub's checks run only on `main` and pull requests, and Netlify builds only `main` and `test`.
2. **Full checks run on combined work only:** once per group in River, and once per release pull request. RL-04 cuts the scheduled full check to once a day.
3. **River keeps a running tally** of GitHub Actions minutes, Netlify builds, and each lane's runs and working minutes. Claude and Codex usage show in each app's own settings.

### Shared files

Some files are touched by many steps. Each has one owner lane. Other lanes put their logic in a new file and ask the owner for a small hook through River, or wait until the owner's change is on the river.

| Shared file | Owner lane |
|---|---|
| `scripts/freshness-shadow.mts`, `scripts/pilot-runner.mts`, `lib/ops/runtime-release-handoff.ts` | hunters |
| `lib/doors/registry.ts` | registry |
| `scripts/ingest.ts`, `lib/civic-data/runner.ts` | meetings |
| `lib/control-plane/gateway/registry.ts`, `lib/control-plane/settings.ts`, `lib/control-plane/fix-list.ts` | admin |
| `lib/control-plane/promotion/section3.ts`, `lib/civic-data/worker-publication-evidence.ts`, `lib/control-plane/workers/standing-runtime.ts`, `lib/civic-data/worker-publication-tasks.ts` | slide |
| `lib/coverage/place-owed.ts`, `lib/civic-data/held-place-capture.ts` | measures |
| `lib/control-plane/workers/detective.ts` | auditors |
| `lib/control-plane/field-manual.ts` | bank |
| The shared reader Card and design tokens | frontend |
| `lib/ask/`, `app/api/ask/` | ballot |
| The database schema and migration numbers, `.github/workflows/`, `scripts/ci-*`, `scripts/river.mjs` | River |

### What Sean does to launch

1. **Approve three things:**
   - pushing the branch `board/briefs`, which holds this plan and the briefs;
   - creating the seven Claude scheduled tasks (River and six lanes);
   - up to two overflow lanes.
2. **Start the five Codex tasks** from the start prompts: admin, slide and ballot in Codex environment 1, bank and frontend in environment 2.
3. **Close idle sessions on his laptop.**

After that, Sean reads River's notifications and answers only what rulings §8 reserves for him.

---

## Working backward from the end (design §5)

Each link is what has to be true right before the link above it. For each link: what exists today, its honest status, and the steps that close the gap.

### Link 1. The end: people use Meanwhile constantly, and the anonymized aggregate signal is good enough to sell
- **Exists today:** reader behaviour capture with returning-reader counts (`lib/events/client.ts`, `lib/control-plane/data-business/recipes.ts:156-165`, shown in Admin capture health); data-business switches and recipes; signal writers (`lib/db/search-log.ts`, `ask-signal.ts`, `speak.ts`, `reactions.ts`) that tag rows with a coverage tier last stamped long ago.
- **Status:** PARTIAL. The design does not specify the selling side, and this plan does not build sales features. What this plan owes link 1 is honest inputs: the tier tags on sold rows must stop being stale, and return visits must be measured where Sean looks.
- **Steps:** SC-17 (honest coverage tags, waits on decision D7), BR-23 (return visits on the Scoreboard), plus every step below, since use comes from links 2–9.

### Link 2. Residents in every covered place find everything that touches them and come back because it looks great and just works
- **Exists today:** a token design system, CDN-held map data with purge on publish, keep-warm, a production headless browser the runner already drives for data witnesses (`lib/control-plane/served-reader-production.ts`), shared `CardSourcesList`, `WorkingOnIt`.
- **Status:** PARTIAL. No one judges the live page; the walk and visual harnesses are locked to localhost; first-visit speed is measured by hand on the median; cards are assembled separately per surface; sources print on card faces; empty states use many sentences; online-only meetings are kept off the map; Ask's cold start already measures above three seconds.
- **Steps:** FE-01 to FE-42, CA-49, CA-14, CP-16, CP-04, CP-05, BR-05 (settings published to the reader edge).

### Link 3. Every covered place is complete, fresh and fast on the site: people, meetings, votes, the ballot and Ask
- **Exists today:** meetings for wired bodies; officials from own pages; legislators where their own page names them; FEC for 24 people; state money for three states; election-office fields; Ask with sources on every answer.
- **Status:** PARTIAL. Contests and candidates are automatic in one county only; measures, plain English, stances, socials, office pins, structured terms and top donors for state and local races are missing or hand-built; Ask refuses every stance question.
- **Steps:** CA-01 to CA-55, BX-08 to BX-11, CP-18, DB-06 to DB-08, DB-22, DB-55, FE-44, FE-45.

### Link 4. Every known door is on automatic refresh, new postings for bodies meeting this week are live within an hour, shut doors reopen fast, and auditors confirm what is live is still right
- **Exists today:** hourly-near-a-sitting and twice-daily meeting re-reads with no AI; last-known-good kept when a read fails; a research-side detective for failing research routes.
- **Status:** PARTIAL. Checks don't publish what they find right away, nothing aims at the hour, posted-to-live is not measured, a failed feed door raises nothing, a moved site is usually a code release, non-meeting facts re-read only through a Send, and no one re-reads live facts after publishing.
- **Steps:** BX-12, BX-13, DB-09 to DB-36, DB-45 to DB-59, DP-02, DP-12 to DP-18, DP-30, DP-31.

### Link 5. Checked records flow down the Slide continuously, with nothing falling off
- **Exists today:** the routine validator and atomic promotion; worker reader doors; the §3 checker; post-publication pulls on an auditor BROKE.
- **Status:** PARTIAL. Scout findings fall off (staging only); non-official sources are refused instead of labeled; campaign sites wait on a five-stage chain; holds go back to a fresh Scout instead of a detective; publication waits for the next five-minute pass; conflicts are not ranked or logged.
- **Steps:** BX-01 to BX-06, BX-12, CP-02 to CP-15, CP-18, CP-19, DP-03.

### Link 6. Builders turn everything in the Box into site-ready records as fast as it arrives
- **Exists today:** worker publication from Parser output for five reader doors; roster and directory reads from saved pages.
- **Status:** MISSING (the Box) and CONFLICTS (seven families need a person to run a script).
- **Steps:** BX-01, BX-02, BX-04, BX-07, BX-09, CA-11, CA-17 to CA-19, CA-31 to CA-34, CP-13, CP-14.

### Link 7. Squads of hunters fill the Box for every part of the mission, with detectives cracking what they can't
- **Exists today:** paid Scouts with a real head start and every keyed tool; write-back to the field manual; a model detective chosen after blocked or failed walks.
- **Status:** PARTIAL. Each hunter is bound to one government and one record class, can't drop a finding for another part, has no per-target clock, and loses its case file on a timeout. The research side is serial and reloads all history per task. A transient failure turns into a paid detective walk.
- **Steps:** CH-03 to CH-28, DP-02 to DP-11.

### Link 8. The coach has the mission map for the place, built from what a resident there is owed plus the Bank's head starts
- **Exists today:** `buildPlaceOwedList` for any ZIP, county, district or state; the checklist profile matching v1.1 exactly; head starts in the Scout brief.
- **Status:** PARTIAL. The map has wrong units, no applicability triggers, one blended status instead of six, and nothing dispatches from it. Head starts are crowded by other places' entries and say nothing about where a method fails.
- **Steps:** SC-01 to SC-19, CH-15 to CH-21, DP-07, DP-08, DP-19 to DP-22.

### Link 9. The start: a mission, meaning the place and the full list of what a resident there is owed
- **Exists today:** `expansion.scope.set` already records a county, congressional district, metro or state legislative district mission with priority and budget, and the runner orders work by it. It has no Admin control and no "state" type. The checklist is in code.
- **Status:** EXISTS, NOT CONNECTED.
- **Steps:** BR-08, SC-01, SC-02.

### The meeting point
The forward path starts from what already works and can be built on directly:
- the owed list and the v1.1 checklist profile;
- `expansion.scope.set` as the mission record;
- the national place job;
- the routine Slide, worker reader doors and the §3 checker;
- the field manual;
- `AdminConfig`, the gateway receipts and the already-written receipt history table;
- the runner's production browser;
- the fix queue's views and repair-lineage reader;
- the outcome store;
- the derived wiring store with its national automatic crosswalk.

The two paths meet at Stage 0 and Stage 1 below. Every step in those stages depends only on things that exist today. The ones that connect the most links at once are:
- **BX-01 and BX-02:** findings, including those already paid for, reach readers.
- **BX-12:** a publish-now lane that reacts within a minute.
- **DB-55:** deleted meeting history comes back.
- **CP-02 and CP-03:** every kind of source is labeled instead of refused.
- **SC-01 and SC-03:** an honest map and one formula.
- **BR-08:** start a mission for any place.
- **DB-09:** the Door Registry.
- **DP-13:** auditors re-read live facts.
- **FE-01:** looking at the live site safely.
- **CA-31:** a ballot contests door for any place.

---

## Stages and steps

Each step lists: lane; what changes; code (files to change or add, reusing what exists); depends on; done when (checked on the live site or live Admin); retires.

**Proof across places (applies to every step).** The first place a door kind, feed, method, builder or fix works makes it usable at once, labeled Testing. The step is reported done, and labeled Proven, only when it has worked at the proof bar: Admin setting from DP-23, whose starting value is five or more places spread across more than one district or state, tried in parallel, and in more than one state wherever that kind of door exists in more than one. Places where it fails go to detectives. Until DP-23 exists, the same starting value is applied by hand. "At the proof bar" in a done-when line means this rule.

**Nothing invented in front of readers.** No done-when plants a stale fact, a dead link, a slow page or a fake door on the live site. Checks use real cases as they happen, or controlled runs on projections never served to readers.

**Runner changes keep a way back.** A step that restructures the production runner keeps the old path behind a runner switch (an entry in the runner's environment file until DB-46's switches exist) until the new path is verified live.

Stage overview (321 steps; the full index by lane is at the end):

| Stage | Steps | What it is |
|---|---|---|
| 0 | 13 | Before anything else: the runner on fixed code, spend that can't zero out, order rows that survive a reload, a fix list that works with Sean's PC off, no startup halt, no paid walks for passing outages, no home addresses, no deleted meeting history, values tied to the right person, meeting snapshots moving, a green full check, open pull requests sorted, and the river |
| 1 | 106 | Ready now. Foundations everything else reads: settings published to the reader edge, an always-running timer, the publish-now lane, mission start, the Box with backfill, source kinds, the checklist overlay, the Door Registry store, history restored, per-host meeting lanes, live audit, playbook loader, looking at the live site, Open States floor, contests door, measure records, Ask cold start, the full check once a day, an after-deploy check per merge, batches only where no clock runs, Ask for local races, the homepage without the map, Federal tags, coverage by kind of fact, refused and lost agent work put back, Admin in plain English, plus cleanups and one-place retirements |
| 2 | 60 | First connections: builders pulling from the Box, publish right after a parser result, labeled sources reaching readers, the queue board, decision cards, registry seeding, 120-day windows per adapter family, watch probes, translator for measures, the shared Card, resident tasks, releases installed beside the running one, the river running itself, releases in Admin, nearby meetings labeled |
| 3 | 60 | The map and the doors come alive: six statuses and right units, mission parts, one hunter queue, many hunters per process, page doors, hourly checks that publish what they find, posting-to-live clock, stances, socials, finance doors, plain English for bodies, offices and agendas, one meeting from two sources shown once, person/meeting/body cards, post-deploy look pass, budgets part 1 |
| 4 | 39 | Honest separate measures, the mission map handed out, the runner reading doors, shut-door marking, facts tied to their doors, Proven/Testing with a bar, fix spreading, topic chips as ready answers, candidates on the person card, existing content into records, budgets part 2, special district boundaries |
| 5 | 26 | Squads sized by gaps and difficulty, every blank owned, "done" means full and refreshing, refresh by date, shut doors swarmed and repaired as data, mission start refreshes known doors, loss study, report accuracy, trends, budgets on the body card and in Ask |
| 6 | 12 | Scoreboard on honest measures and door numbers, time to core information, cross-subject findings, local votes, vacancies, detective repairs used on the next check, every loss studied, door and fix history |
| 7 | 5 | Code door list deleted, two-attempt proof retired, repeat breaks from history, patterns, Proven means still working today |

### Stage 0. Before anything else

Things that must be true first. They stop the machine from halting, losing orders, spending money for nothing or tying facts to the wrong people, stop harm readers see today, and set up how code reaches `main`. All 13 can start now, and none depends on another.

**BR-01 · Every order keeps its row after a reload (read side)**
- Lane: Admin · Depends on: —
- Change: Only runner pause and resume orders keep their row and status after a reload. Other orders keep their effect but lose their row. Read one bounded, newest-first page from the existing `cp_admin_action_history_projection` table joined to the receipts. Projection rows are immutable and every existing non-pause row is stored as unmapped, so map each row's kind at read time from the joined receipt's `type`, using the reverse of the `gateway` map in `actions.ts`, and take the place from the receipt's subject. Keep the filter by place. The writer and trigger change is BR-36.
- Code: `lib/control-plane/admin-view/admin-v6-history.ts`, `lib/control-plane/repository/action-history-atomic.ts` (read query), `app/(admin)/_mw/admin-v6/actions.ts` (reverse map).
- Done when: in live Admin, a hunt, a ceiling change and a send-agents order made before a reload are listed after it with their current state, both at the country and at their own place, and the view opens within three seconds.
- Retires: browser-only order rows; the history "MISSING" strings (`admin-v6-history.ts:31-35`).

**BR-03 · The fix list lives in the control plane**
- Lane: Admin · Depends on: —
- Change: "Add this to the queue" and "Go fix these" are stored as owner decision intents. Only a local script (`pnpm decisions:apply`) turns them into tracker rows, and the runner deliberately never does (`scripts/pilot-runner.mts:690-699`), so items sit at "Being fixed · Sent" forever.
  - Store fix items as a control-plane record written through the gateway. `fix.add` reuses the `queue.add` registry entry. `fix.complete` records what broke, what changed, who or what changed it, before, after, and an undo action when the change was a record or a setting.
  - Show Open, Being fixed, Fixed and checked, and Came back on the existing Fix list view, with the repair lineage from `fix-prevention-history.ts`.
  - This becomes the one list of broken things and their repairs. Shut doors, look flags, slow pages and audit red flags write to it too; there is no second repair log.
- Code: `lib/control-plane/fix-queue.ts`, `lib/control-plane/gateway/registry.ts:276-300`, new `lib/control-plane/fix-list.ts`, `lib/control-plane/admin-view/v6-fixes-read.ts`, `fix-prevention-history.ts`, `app/api/admin/fix-history`, `app/(admin)/_mw/admin-v6/screen-fix.tsx`, `fix-queue-controls.tsx`.
- Done when: an item added in live Admin shows as Open after a reload with Sean's PC off, and completing it shows before and after under "Fixed and checked".
- Retires: the decision-log store for fix items; the empty "Fixed and checked / Came back" columns.

**CH-01 · Production runs the fixed runner code**
- Lane: Coach & Hunters · Depends on: —
- Change: Check that the standing runner is on `022a183c` or later. That commit carries the five pre-restart fixes (#670, #671, #672, #674, #675, including the near-cubic `officialLinkingPageFrom` fix behind the meetings-discovery hang), #679 (lazy linking source), and the scout-publication work (#666, #681, #697). If the heartbeat shows an older commit, fix whatever is holding the existing release handoff instead of restarting by hand.
- Code: none expected; `scripts/pilot-runner.mts` (served-SHA follow, :1935-1944), `lib/ops/runtime-release-handoff.ts`.
- Done when: Admin Workers view shows the runner heartbeat on `022a183c` or later, and research rounds since then finish instead of being killed for no progress (`RESEARCH_CHILD_NO_PROGRESS`).
- Retires: —

**CH-02 · One unpriced charge no longer shuts off paid work**
- Lane: Coach & Hunters · Depends on: —
- Change: Today `aggregateModelSpend` returns no total when a model job has an unpriced charge with no covering hold. `admissionSpendUsd()` then returns infinity, and paid capacity drops to zero whatever the budget dial says (#659 narrowed this but did not remove it). Charge an uncovered unpriced job at its worst case instead: the request's token limits at the highest listed price for that provider. Spend then stays counted and the dial keeps control. Add a price row for every model the fleet calls, so the worst case is rarely used. Report how many charges were counted at worst case.
- Code: `lib/control-plane/fleet-safety.ts` (`aggregateModelSpend` :191-252, `admissionSpendUsd` :605-608); the price table used by `budgetGuardedTransport`.
- Done when: with an unpriced job present, live Admin Workers and Money views show paid workers running under the dial, plus a count of worst-case charges.
- Retires: the infinite-spend path in `admissionSpendUsd`.

**CP-01 · No filed mailing address on any card or Ask answer**
- Lane: Checkers & Publishing · Depends on: —
- Change: Sean decided "Public office and campaign addresses only. Never anyone's home." Candidates' filed mailing addresses, which are often homes, render on ballot cards and in Ask today; 62 of 122 bootstrap cards carry one. Stop rendering them and stop carrying them into reader projections. Keep the address in vault evidence only, and keep the link to the filing in Sources.
- Code: `components/ballot/candidate-contact.tsx:56-96`, `components/ask/answer-contacts.tsx:22`, `lib/ask/contacts.ts:69,296`, `lib/ask/candidate-profile.ts:50`, `lib/ask/evidence.ts:181`, `lib/ask/candidate-contact.ts:10`, `lib/ballot/candidate-contacts.ts:44`, `lib/ballot/candidate-cards.ts:56-84`, `lib/sources/ballot-nj-morris/index.ts:59`.
- Done when: on the live site, no ballot card or Ask candidate-contact answer anywhere shows a street address other than a published office or campaign office.
- Retires: `filedAddress` on reader surfaces and in Ask (the old RULING 54 behaviour).

**DB-01 · Meeting history stops being deleted**
- Lane: Doors & Bank · Depends on: —
- Change: Reconciliation removes every prior meeting outside the 90-day window as `OUTSIDE_REGISTERED_SERVING_WINDOW`, so concluded meetings and their agendas disappear. Current rulings already say not to delete history.
  - Add held-window constants (120 days back, 120 ahead) and `meetingHeldWindowAt`.
  - Bump the removal contract to `MEETING_READER_SERVING_WINDOW_V2` with the held bounds, and never remove a concluded meeting that carries an agenda, minutes, an outcome or a vote. Accept `V1` removal rows for one pass so each partition's first candidate after the change is not refused.
  - Adapters still fetch 90 days until DB-02 to DB-05. Pass the window each read actually fetched into `reconcileMeetingPartition`, and carry prior rows outside it with a new reason, `OUTSIDE_FETCH_WINDOW`, that never counts as a disappearance (today they would be carried as `UNEXPLAINED_DISAPPEARANCE` and raise false counts).
  - Apply the shown window (90 back, 90 ahead) once, inside `readReaderEdgeMeetings`, with an option `SHOWN` or `HELD`. The map, Ask's "when does it meet next" and agenda listings use `SHOWN`; Ask's and the agenda route's lookups of a past meeting by body and date use `HELD`.
  - Partitions now grow with kept history until DB-06 moves concluded meetings into the history projection; DB-06 must not wait.
- Code: `lib/meetings/constants.ts`, `lib/civic-data/validate.ts:244-245,334-371`, `lib/civic-data/types.ts:332-334`, `scripts/ingest.ts:1290,1319-1398` (`reconcileMeetingPartition`), `lib/meetings/edge-serving.ts`, `lib/meetings/query.ts:271-272`, `app/api/ask/grounded/route.ts:761`, `app/api/agenda/route.ts:44`.
- Done when: on the live site, a concluded meeting with minutes from more than 90 days ago is still in its promoted partition and Ask can answer what happened at it, the map and "when does it meet next" show only the 90-day window, and Admin shows no new disappearance counts from the change.
- Retires: deletion of concluded meetings that carry records.

**DP-01 · A provenance receipt can no longer stop the research cycle**
- Lane: Detectives & Proving · Depends on: —
- Change: The research child throws at startup (`METHOD_CANDIDATE_AUTHORITY_NOT_ADOPTED`) unless an adoption receipt for a frozen seven-row seed is found. The module's own comment says reading that log "is what stopped the runner". Remove the throw. If the candidate store can't be read, skip candidate proposals for that round and show one line in Admin. Delete the authority module and its seed.
- Code: `scripts/freshness-shadow.mts:589-600`, `lib/control-plane/method-candidate-authority.ts`, `METHOD_CANDIDATE_CUTOVER_SEED`, the adoption digest kind, the authority read in `scripts/method-candidate.mts`, the comment at `lib/control-plane/repository/pg-store.ts:580`.
- Done when: on the live runner, a research round runs to the end with no adoption receipt present, and meeting refresh and publication continue (Admin Workers view shows rounds finishing).
- Retires: the method-candidate authority gate and its seed constants.

**DP-02 · A passing outage stays a free retry**
- Lane: Detectives & Proving · Depends on: —
- Change: `sourceFailureRecovery` turns a single 429, 5xx or timeout on a known door into a paid detective walk. When paid research is paused, that door then gets no plain re-read at all.
  - Keep plain backoff retries for `RATE_LIMITED`, `UPSTREAM_ERROR` and `TRANSPORT_FAILED`.
  - Send a door to a detective when it is shut: at once for `REFUSED_BY_HOST` and `EXTRACTION_FAILED` (the site changed), or for any other cause past a shut threshold. The code default is 3 consecutive failures, which becomes a Admin setting after BR-05.
  - When a detective is sent, schedule a separate plain re-read route task as well, because the registry lane picks only one executor per obligation.
- Code: `lib/control-plane/workers/detective.ts:17-29` (`needsSourceInvestigation`, `sourceFailureRecovery`), `scripts/freshness-shadow.mts:995`, `lib/control-plane/scheduler/debt.ts`.
- Done when: on the live runner, a source that answers 503 once is re-read by plain code at its next backoff slot with no model charge in Admin. A source refused three times shows a Detective attempt while plain re-reads continue, including while paid research is paused.
- Retires: paid detective walks for passing outages.

**RL-01 · The scheduled full check passes again**
- Lane: Release · Depends on: —
- Change: GitHub's full test run on `main`, every three hours, has failed every time on Oct 3 on the live code (`022a183c`). The cause is one test: the meeting-body crosswalk script prints counts with no denominator floor and is not on the floor baseline (RULING 159). Wrap its counts in the existing `floored()` helper so a zero denominator says so. Do not add it to the baseline, which only shrinks. Until this passes, every merge looks red and a real failure can't be told from this one.
- Code: `scripts/derive-meeting-body-crosswalk.mts`, `lib/ops/denominator-floor.ts:90` (`floored`), `tests/denominator-floor.test.ts:106-133`.
- Done when: `pnpm gates` passes in a cloud session and the next full check on `main` passes.
- Retires: —

**RL-02 · Every open pull request is sorted into the river or closed**
- Lane: Release · Depends on: —
- Change: 33 pull requests are open: 20 ready and 13 drafts. The 20 ready ones fail on purpose until auto-merge is switched on (the "waiting" tier in `scripts/ci-verdict.mjs`), so red does not mean broken. Go through each one, reading before changing anything:
  - **Keep** when it fixes something a plan step needs and still applies to current `main`. Its branch joins the first river merge, tagged with the step it serves. Check #695 (reuses verified registry information), #698 (keeps provider failure history and backs off), #700 (keeps going when some saved evidence is missing) and #703 (cost savings by the model actually used) first.
  - **Stacked:** #704 sits on #701, which sits on #700. Take them in that order.
  - **Close with a one-line note** when a plan step replaces it, when it conflicts with `main` and is smaller to redo (#569, #607), or when it is too broad to fold in safely (#603, 121 files). Its useful parts come back as stream branches.
  - No pull request merges on its own. Kept ones ride the river (RL-03).
- Code: none; the open pull requests on GitHub, `scripts/ci-verdict.mjs`.
- Done when: every pull request open on Oct 3 is either in the river with its step named or closed with a note, and none is waiting on auto-merge.
- Retires: one pull request per session waiting on auto-merge.

**RL-03 · Code reaches main through one river branch, a couple of times a day**
- Lane: Release · Depends on: —
- Change: Sessions stop opening and merging their own pull requests. Work flows like streams into a river, and only the river goes to `main`.
  - Create a long-lived `river` branch from `main`.
  - Each build session works in the cloud on `stream/<step id>`, cut from the current `river`, runs `pnpm gates` in its own container, and pushes the branch. It opens no pull request and never pushes to `main` or `river`. A pushed branch with no pull request starts no GitHub Actions run (Build check runs only on a push to `main` and on pull request events).
  - The merge session folds finished streams into `river` one at a time and runs `pnpm gates` after each. A stream that fails is taken back out and returned to its session with the failure; the others carry on.
  - New streams branch from the current `river`, so a step that needs another can start as soon as that step is on the river, without waiting for `main`.
  - Database migrations are named by step in streams and numbered by the merge session as they fold in, so parallel sessions never collide on a number.
  - A couple of times a day, the merge session opens one pull request from `river` to `main` on the full check tier, lists the steps it carries, and merges when the three required checks pass. If `main` moved after the river was tested, it tests again first. `river` then restarts from the new `main`.
  - Data never rides the river. Facts, doors, settings and playbooks go live as data with no release (rulings §9). Only code waits for a merge.
  - Write this flow into `CLAUDE.md` and `AGENTS.md` so every Claude and Codex session follows it.
- Code: `CLAUDE.md`, `AGENTS.md`, `docs/ci-efficiency.md`, new `scripts/river.mjs` (fold, test, open, merge), reusing the ordering in `scripts/merge-engineer-adapters.mjs` and the tiers in `scripts/ci-verdict.mjs`.
- Done when: a river merge lands on `main` carrying work from several sessions in one pull request, with one Netlify deploy and one set of GitHub checks, and that day's GitHub Actions runs are only river pull requests, pushes to `main` and the scheduled check.
- Retires: a pull request and a merge per session.

**CP-19 · A value must come from the same person's row**
- Lane: Checkers & Publishing · Depends on: —
- Change: The quote check confirms each field's quote appears somewhere in the page after where the record started (`confirmQuotedRecords`, `locateQuote(text, quote, from)`). Nothing checks that a record's fields come from the same row. An Oct 3 test page gave Alice Adams' record Bob Brown's email, and the quote check, the generalized validator and the §3 check all passed it. With hundreds of hunters this would put correct facts on the wrong people at scale.
  - Tie every field to the record's own block: the table row, list item or card that holds the name (the row cells `inventoryRecordEvidence` already finds), or, in running text, the same paragraph as the name.
  - A field found only outside that block is dropped from the record and goes to a detective as a finding (DP-03). It never publishes.
  - Add the Alice and Bob page and a two-column roster as tests beside the existing §3 tests.
  - Valid records keep publishing automatically.
- Code: `lib/control-plane/workers/quoted-proof.ts:69-130`, `lib/control-plane/workers/record-evidence.ts:198` (`inventoryRecordEvidence`), `lib/control-plane/workers/generalized-validator.ts`, `lib/control-plane/promotion/section3.ts`.
- Done when: the new tests refuse the mismatched email, and live Admin shows officials still publishing at their usual daily count.
- Retires: —

**DB-59 · Meeting snapshots move again, and one bad base holds back only itself**
- Lane: Doors & Bank · Depends on: —
- Change: On Oct 3 the public meetings responses for several places carried a snapshot made Sept 29 at 05:38 UTC and nothing collected later, while publication attempts ran on Oct 3, some held with `MANUAL_PROMOTION_BASE_PROOF_INVALID`. That error comes from the hand-curated projection path: the stored base it builds on has no good source receipt (`manual-projections.ts:577`) or fails the prior-authority check (`manual-successor.ts:86`).
  - In live Admin and the data plane, read the held candidate, its base and its source receipt, and find which check fails and why.
  - Fix the stored base or the receipt. Keep the protection.
  - Find why the meetings snapshot time (the reader manifest's `generatedAt`) stopped moving: either meeting promotions stopped or the manifest is not re-stamped when they happen. Fix whichever it is.
  - A held curated projection blocks only its own contract, never meeting promotion or any other contract, and last-known-good records stay readable.
- Code: `lib/civic-data/manual-projections.ts:560-580`, `lib/civic-data/manual-successor.ts:60-88`, `lib/civic-data/manual-prior-authority.ts`, `lib/meetings/edge-serving.ts:116-151`, `app/api/meetings/route.ts:572-590`.
- Done when: on the live site the meetings snapshot time advances after the next routine pass for every place, the newest collection time is from that pass, and Admin shows no `MANUAL_PROMOTION_BASE_PROOF_INVALID` hold older than one pass.
- Retires: —

### Stage 1. Ready now: depends only on what exists or on Stage 0

#### Admin

**BR-02 · No order sits at "Queued" without a reason**
- Lane: Admin · Depends on: BR-01
- Change: 
  - Remove the follow-up cutoff, and refresh open orders from the history revision.
  - Add a "not picked up" state. When the runner has not taken an order, and either its heartbeat is silent or a round due after the save has passed, the order turns red with one line ("The runner hasn't checked in since <ET time>") and three options: take it back, try again, see Workers.
- Code: `app/(admin)/_mw/admin-v6/executor.ts:54-58`, `lib/control-plane/gateway/confirmation.ts`, `receipts.ts`, `receipt-view.tsx`, `lib/control-plane/admin-view/v6-capabilities.ts` (`historyRevision`).
- Done when: in live Admin, an order saved while the runner is paused turns red with the reason and options at the next pulse, and turns green when the runner picks it up.
- Retires: the follow-up cutoff in `followUpDelayMs`.

**BR-04 · Fix items get worked without a dispatch click**
- Lane: Admin · Depends on: BR-03
- Change: Design §7.6 says the team fixes things without asking.
  - When a fix item is a data gap for a named place or body, the gateway sends agents to it at once through the existing `fleet.deployHere` (which reorders existing work and, when a state is named, creates that state's registry work) and records the dispatch on the item. Items about layout, wording or code are not dispatched; they stay on the queue for the team.
  - Every other item shows on the queue owned by the team. Engineering sessions read it through Admin API, not a tracker export.
  - Move the existing queued intents into the new record once.
- Code: `lib/control-plane/fix-list.ts`, `lib/control-plane/gateway/registry.ts` (reuse `fleet.deployHere`), `app/(admin)/_mw/admin-v6/actions.ts`, `scripts/tracker-core.mjs` (`planFixQueue`), a one-time migration script.
- Done when: a fix item added in live Admin for a missing fact in a place shows "Agents sent" with the runner's honored dispatch, and no "Go fix these" button exists anywhere.
- Retires: the `fix-go` kind, "Go fix these", the fix queue's dependence on `pnpm owner:decisions:pull` and `decisions:apply`, and `planFixQueue`.

**BR-05 · Settings with a log and undo**
- Lane: Admin · Depends on: —
- Change: Add a typed `settings` map to `AdminConfig` and one gateway action, `config.setSetting {key, value, why}`. Each key has its own validation and stores the previous value. Add `readSetting(key, default)`: the runner re-reads it every pass. The site never reads the control plane per request: reader-facing keys (windows, topics, platforms, copy, switches) are published to the reader edge when they change, with a cache tag purge, and reader pages read them from there. Each lane registers its own keys in later steps (windows, watch interval, platforms, topics, source-kind host table, squads, proof bar, absence hold, audit policy, hunter count, brief time, copy keys). Validation lets meeting check frequency go faster than the rulings §4 floor (hourly near a sitting, twice daily otherwise) but never slower. The first key registered is the detective shut threshold from DP-02.
- Code: `lib/control-plane/gateway/admin-config.ts:74-145`, `lib/control-plane/gateway/registry.ts`, `lib/control-plane/gateway/contract.ts` (`actionInput`), new `lib/control-plane/settings.ts`, `lib/civic-data/reader-edge-publication.ts` (publish reader-facing settings with a tag purge).
- Done when: the shut threshold changed in live Admin is logged with when it changed and its value before, and the Workers view shows the new value in force after the runner's next pass. The log names who changed a setting only when the factory changed it, since Sean is the only person who does.
- Retires: "undo" as a sentence (`actions.ts:515` and similar).

**BR-07 · Every control in Admin can be sent**
- Lane: Admin · Depends on: —
- Change: Delete the 17 controls that can never be sent: `contain`, `uncontain`, `recheck`, `workfirst`, `fixfirst`, `stopmethod`, `scope-stop`, `stoprepeats`, `scope-recheck`, `doc-request`, `reprocess`, `retry-method`, `resume-publish`, `eng-task`, `job-stop`, `focus` and `scope-first`, with their `DEP` entries and buttons. Sean's ability to stop things stays and moves onto queue rows (BR-14); `use-url` comes back as door editing (DB-35). Delete "Tell it what to do" (`instruction.ts`, `instruction-draft.ts`, `instructionDrafts`); it can only produce dead controls, and Ask Admin becomes the one plain-words box (BR-18).
- Code: `app/(admin)/_mw/admin-v6/actions.ts`, `model.ts`, `screen-now.tsx`, `screen-work.tsx`, `screen-workers.tsx`, `command-center.tsx`, `instruction.ts`, `instruction-draft.ts`.
- Done when: live Admin shows no "Not connected yet" control on any view.
- Retires: the 17 dead controls; "Tell it what to do".

**BR-08 · Start a mission for any place**
- Lane: Admin · Depends on: —
- Change: Admin already lets Sean pick a whole state, congressional districts or counties under "Start many hunts", with a budget and a priority, but it turns the pick into a pile of ZIP hunts (`bulk-hunts.tsx`). Keep that control, add metros and state legislative districts to it, and make the pick submit one mission: the existing `expansion.scope.set` with priority and budget. Add `state` to the scope types and to scope resolution and the runner's place ordering. The mission is that one scope record; the coach adds parts and squads on top of it (CH-15). A whole-state mission must not rebuild every division's owed list on each refresh: reuse the owed-list memo (`place-owed-read.ts:120`) and refresh only the scope that changed.
- Code: `lib/control-plane/expansion/scopes.ts:43-50` and its resolver (`resolveScopes`), `lib/control-plane/gateway/registry.ts:984-1092`, `scripts/freshness-shadow.mts:1252-1278`, `lib/control-plane/admin-view/place-owed-read.ts:120`, `app/(admin)/_mw/admin-v6/actions.ts`, `app/(admin)/_mw/admin-v6/bulk-hunts.tsx`, `screen-now.tsx`.
- Done when: a mission started in live Admin for a whole state shows as one row with its place score, and the runner's work for that state appears.
- Retires: the mission as "a pile of ZIP hunts" in Admin.

**BR-09 · Unowned work goes to the team, not to Sean**
- Lane: Admin · Depends on: —
- Change: Owner `NOBODY` maps to the "Needs your decision" lane today. Send it to the team lane, with owner "The runner (unassigned)". Keep the decision lane only for causes that need Sean under design §7.6. Add a `needs` field (`money`, `platform`, `credentials`, `contract` or `broken`) so each card says which. Anything that raises decisions later must use one of these reasons.
- Code: `lib/control-plane/admin-view/blocker-causes.ts:52`, `v6-stuck-read.ts`.
- Done when: in live Admin, every item under "Needs me" names one of those five reasons.
- Retires: the `NOBODY → decision` rule.

**BR-10 · One sentence per receipt**
- Lane: Admin · Depends on: —
- Change: Cap each receipt line in Admin at one plain sentence, built per type. Keep the gateway's long `says` text behind "show details". Shorten the `canCheck` paragraph to "Checking isn't available yet." Delete the unused `LANE_MEANS`.
- Code: `app/(admin)/_mw/admin-v6/receipts.ts`, `receipt-view.tsx`, `screen-now.tsx:30`, `command-center.tsx:281`.
- Done when: every receipt face in live Admin is a single sentence.
- Retires: enforcement paragraphs on receipt faces; `LANE_MEANS`.

**BR-11 · Two broken numbers fixed, and Eastern days everywhere**
- Lane: Admin · Depends on: —
- Change: Fix the Hosting pattern (`/^20dd-dd$/` should be `/^20\d\d-\d\d$/`) and the ZIP pattern in stuck items (`(d{5})` should be `(\d{5})`). Make capture health bucket and label days in Eastern time. Renaming `mst` to `et` is optional cleanup.
- Code: `app/(admin)/_mw/admin-v6/screen-money.tsx:68`, `lib/control-plane/admin-view/v6-stuck-read.ts:99`, `lib/control-plane/admin-view/v6-capture-health.ts:21,81`.
- Done when: in live Admin, Hosting shows a value, stuck items' "Send agents" words include the ZIP, and capture health days read in Eastern time.
- Retires: —

**BR-12 · Orders show Accepted with a plan, then a progress bar**
- Lane: Admin · Depends on: BR-01
- Change: Add a plan to each confirmation, built from data already read: `{who, change, affects, resultsBy}`. Sources are the runner's honored detail, assignment counts, the heartbeat's next round time and the created-work count. Define progress per order type: for a hunt or mission, the place's score change since it was accepted; for a dispatch, created out of created plus deferred; for a setting, one step. Replace the never-filled 7-chip lifecycle with the design's five-step bar (Received, Accepted, Scheduled, In progress, Done) plus one progress bar.
- Code: `lib/control-plane/gateway/confirmation.ts`, `app/(admin)/_mw/admin-v6/receipts.ts`, `receipt-view.tsx`, `model.ts:726-734`, `lib/control-plane/admin-view/admin-v6-history.ts`.
- Done when: a hunt sent in live Admin shows "Accepted · Runner · creates N items in <place> · first results by <ET time>", and its bar moves as the place's score rises.
- Retires: the 7-chip receipt lifecycle.

**BR-15 · Orders can be scheduled**
- Lane: Admin · Depends on: BR-01
- Change: Add a durable scheduled-order record and two gateway actions, `orders.schedule {orderType, input, startAt | after | repeat | finishBy}` and `orders.unschedule`. Store them in `AdminConfig` beside place targets, with who decided and the receipt.
- Code: `lib/control-plane/gateway/admin-config.ts`, `registry.ts`, new `lib/control-plane/gateway/scheduled-orders.ts`.
- Done when: an order scheduled in live Admin shows "Scheduled" with its time, and survives a reload and a runner restart.
- Retires: —

**BR-21 · The budget dial says what it buys**
- Lane: Admin · Depends on: CH-02
- Change: 
  - Show the dial as "$X a day → about N hunters at once now", beside the value already shown as in force. Export the `researchPaidWorkerCapacity` math as a pure function to compute N.
  - When charges were counted at worst case (CH-02), show one problem line with the count.
  - Add the missing amount field to the send-agents preview so "send agents and budget to a gap" works.
- Code: `lib/control-plane/admin-view/v6-spend-route.ts`, `lib/control-plane/research-policy.ts:657`, `app/(admin)/_mw/admin-v6/screen-money.tsx`, `screen-now.tsx`, `actions.ts:662-677` (send-agents preview).
- Done when: in live Admin, the dial shows dollars and hunters; a send with $5 shows its budget under sends, and the runner holds paid work there after $5.
- Retires: —

**BR-23 · The Scoreboard view, first rows**
- Lane: Admin · Depends on: BR-01
- Change: Add `scoreboard-read.ts`, which returns one row per design §19 number: `{value or null, counts, trend, one sentence, why it is not measured}`. "—" shows when there is no value. Wire the rows whose source exists today:
  - orders, from BR-01;
  - the current place score, rewired in BR-30;
  - public delivery from the existing publication reads and page witnesses;
  - stale counts;
  - doors failing now;
  - return visits;
  - doors handed and used (head start);
  - a GATE health group showing "—" until SC-13.

  This view replaces "Is it learning"; its weekly series move here.
- Code: new `lib/control-plane/admin-view/scoreboard-read.ts`, new `app/api/admin/v6/scoreboard/route.ts`, `v6-capabilities.ts`, new `app/(admin)/_mw/admin-v6/screen-scoreboard.tsx`; delete `screen-learning.tsx` and fold `v6-learning-read.ts` into the new reader.
- Done when: the live Scoreboard shows real values with counts for the wired rows and "—" for every other §19 row.
- Retires: the "Is it learning" view.

**BR-24 · An updates feed with honest labels**
- Lane: Admin · Depends on: BR-03
- Change: Add an update record: `{what, when, label: PROVEN | TESTING | EXPECTED, evidenceHref (before and after), shownAt}`. Updates appear on Now once, then drop off. The first sources are merged-and-live changes (the Changes feed) and fix-list completions. Later steps add fix-map transitions (DP-26), door reopenings (DB-34), new kinds of things found (CA-37) and new owed items (SC-10). An EXPECTED item never appears as a win.
- Code: new `lib/control-plane/admin-view/updates-read.ts` and update store, `lib/control-plane/changes/source.ts`, `app/(admin)/_mw/admin-v6/screen-now.tsx`.
- Done when: a fix completed in live Admin appears once on Now as an update with its label and a before/after link, then leaves Now.
- Retires: —

**BR-26 · Ask Admin "why is this place stuck?"**
- Lane: Admin · Depends on: —
- Change: Add a `PLACE_STUCK` topic. It reads the stuck section and the place score for the place named or selected, and answers in one line with a link to the detail.
- Code: `lib/control-plane/operator-chat/contract.ts:56-71`, `router.ts`, `read-models.ts`.
- Done when: "Why is <district> stuck?" in live Admin returns one line from live numbers with a working link.
- Retires: —

**BR-35 · Dead gateway actions, sections and routes are removed**
- Lane: Admin · Depends on: —
- Change: Delete the gateway actions that do nothing (`config.setApiFallback`, `fleet.retryWorkItem`), the never-announced sections `workRows` and `decided` with the Work "All work rows" tab, and the Admin API routes no page calls: `checklist-definitions`, `checklist-instances`, `deploy-preview`, `public-reader-observation`, `runner-progress` and `work-progress`. `fix-history` stays for BR-03; `v6/checklist` goes with SC-15.
- Code: `lib/control-plane/gateway/registry.ts:582-600,681-690`, `app/(admin)/_mw/admin-v6/live-data.ts:113,125`, `screen-work.tsx`, the listed `app/api/admin/*` routes.
- Done when: live Admin shows no tab that always reads "—", and the removed routes return not found.
- Retires: `config.setApiFallback`, `fleet.retryWorkItem`, `workRows`/`decided`, the six unused routes.

**BR-36 · New orders are written to history with their kind**
- Lane: Admin · Depends on: BR-01
- Change: Have the history writer fill kind and scope for every gateway type instead of `UNAVAILABLE`. The table's triggers only accept runner pause, resume and `expansion.scope.set`, so replace `cp_admin_action_history_assert_scope` through an expand migration (applied automatically during the build) that accepts every registered kind. Old rows keep being mapped at read time by BR-01.
- Code: `lib/control-plane/repository/pg-store.ts:1118-1131` (`validatedAction`), `lib/control-plane/repository/pg-schema.ts:519-650`, the migration journal.
- Done when: in live Admin, an order made after the change shows in history with its kind straight from the stored row, and the projection's ready counts still match the receipts.
- Retires: the parity triggers' "unproven scope" rule.

**BR-37 · A timer for due orders and the brief that always runs**
- Lane: Admin · Depends on: —
- Change: The parent runner's control timer acts only while a research round is running, and a release handoff clears it (`pilot-runner.mts:1248-1266`). Add a separate parent timer that always runs, between rounds and outside them, for due scheduled orders and the daily brief. It restarts after every handoff and, on start, fires anything overdue once. Each firing is idempotent, keyed by the scheduled order's ID (or the brief's day), so a restart never fires twice.
- Code: `scripts/pilot-runner.mts` (new timer beside `ownerControlTimer`, restart after `holdStandingRuntimeAtQuiescence`), `lib/control-plane/gateway/gateway.ts:116` (`submit()`).
- Done when: on the live runner, a due test entry fires while no research round is running and again fires exactly once after a release handoff that overlapped its due time, as Admin's receipt log shows.
- Retires: —

**BR-39 · Admin speaks plain English everywhere**
- Lane: Admin · Depends on: —
- Change: Live Admin shows code names and raw error text: stuck causes such as `DIRECTORY_NO_READABLE_SAVED_PAGE`, `ELECTION_OFFICE_NOT_ON_SAVED_PAGES`, `ROSTER_NO_READABLE_SAVED_PAGE` and `MANUAL_PROMOTION_BASE_PROOF_INVALID`, and refusal text quoting `SCOUT_POLICY_DENIED`. Sean decided on Oct 3 that Admin is plain English throughout.
  - Give every stuck cause a plain sentence and its next step in the cause table.
  - A cause with no sentence yet shows "A problem we haven't described yet" and goes on the fix list, so it gets one.
  - Code names, error text and IDs move behind "Technical details".
  - A check fails the build when a code name or raw error string reaches Admin screen text.
- Code: `lib/control-plane/admin-view/blocker-causes.ts` (`SHAPES`), the Work and Now screens in `app/(admin)/_mw/admin-v6/`, `lib/control-plane/fix-list.ts`.
- Done when: every view in live Admin shows no code name or raw error text outside "Technical details".
- Retires: code names on Admin screens.


#### Coach & Hunters

**CH-03 · Settings take effect in the middle of a round**
- Lane: Coach & Hunters · Depends on: —
- Change: The research child reads the spend ceiling once at the start of each round. Re-read `adminConfig` on each admission batch, the same way `refreshPlaceOrder` already does mid-round, and update the ceiling that `paidWorkerCapacity` and the fleet-safety bounds use.
- Code: `scripts/freshness-shadow.mts:1252-1262,1503-1524,1955-1977`, `lib/control-plane/fleet-safety.ts:409`.
- Done when: raising the ceiling in live Admin mid-round lets more paid workers in before that round ends (visible in Workers).
- Retires: the round-start-only ceiling read.

**CH-04 · Don't pay to find what is already live**
- Lane: Coach & Hunters · Depends on: —
- Change: When planning a Send, pass in the held place capture. Skip the paid discovery Scout for any government and family whose owed rows are all published and fresh, or shown as not published by the government. Keep that family's refresh and comparison scheduled (rulings §2: a healthy feed does not prove complete coverage).
- Code: `lib/control-plane/expansion/dispatch-work.ts` (`planDispatchWork` :605-636), `lib/civic-data/held-place-capture.ts` (`readHeldPlaceCapture`), `lib/coverage/place-owed.ts`.
- Done when: a Send whose county and city officials are already live from an earlier Send creates no new paid `coverage-discovery:officeholders` Scout for those governments (no such cost in Admin), while their refresh stays scheduled.
- Retires: —

**CH-05 · The first hunt starts in the same round as the order**
- Lane: Coach & Hunters · Depends on: —
- Change: After `applyDispatchWork` writes new obligations, sync those IDs and add the due ones to this round's work before the lanes start, instead of waiting a round.
- Code: `scripts/freshness-shadow.mts:1737-1817`.
- Done when: the first attempt for a new Send's government is recorded in the same round as the Send's work is written (visible on the order's track).
- Retires: the one-round lag between a Send and its first hunt.

**CH-06 · Each worker process builds its runtime once**
- Lane: Coach & Hunters · Depends on: —
- Change: Every lease worker rebuilds the whole runtime from all history for every task, and the coordinator reads every artifact inside a loop. That breaks rulings §5 ("nothing loads the whole country").
  - Build the subject-independent parts of the standing runtime once per worker process, and pass the per-task guards (`openBytes`, `transportFor`) with each task.
  - The scoped reads are CH-26.
  - Keep the old path behind a runner switch (an entry in the runner's environment file until DB-46's switches exist) until the new path is verified live, then remove the switch.
- Code: `lib/control-plane/workers/lease-worker.ts:27-65`, `standing-runtime.ts:64-100`.
- Done when: live Admin shows tasks finished per hour rising on the same host after the change, with the same results per task.
- Retires: building the whole runtime for every task.

**CH-07 · A clock on every target, and the case file is kept**
- Lane: Coach & Hunters · Depends on: —
- Change: Enforce the existing `WorkerBound.maxWallMs`; it is declared but the coordinator passes 0 and nothing reads it. The limit comes from a code default (a setting after BR-05). When the limit is hit, or a worker child is killed on timeout, write the Scout result as `NO_PROGRESS` with the steps walked so far and `stoppedBy: "TIMEOUT"`. The next turn then goes to a detective with what was tried, and the case is not filed as a 30-day "argued absence" (`isArguedAbsence` only accepts `MODEL` or `BOUND`).
- Code: `lib/control-plane/scheduler/dispatch.ts:111-118`, `lib/control-plane/workers/coordinator.ts:450`, `workers/runtime.ts:270`, `scheduler/scout-executor.ts`, `workers/process-pool.ts:96-103,156-196`, `scheduler/absence.ts:49-62`.
- Done when: in a controlled run against a test site never served to readers, a hunter stops at its limit, and live Admin shows the next attempt as a Detective whose brief lists the earlier steps.
- Retires: timeouts that lose the case file.

**CH-08 · Discovery passes run on their own lanes**
- Lane: Coach & Hunters · Depends on: —
- Change: Move meetings discovery, the campaign-site pass and candidate publications out of the serial research child into their own lanes of the existing independent lane scheduler. Each gets its own no-progress limit. Bound each discovery walk by the time left instead of capping 12 walks per round. Keep the old path behind a runner switch (an entry in the runner's environment file until DB-46's switches exist) until the new path is verified live, then remove the switch.
- Code: `scripts/freshness-shadow.mts:3104-3336`, `scripts/pilot-runner.mts:1161-1168` (`IndependentRuntimeLaneScheduler`).
- Done when: in live Admin, a slow discovery site no longer ends a research round, and walks per hour rise.
- Retires: the 12-walks-per-round cap (`MEETINGS_DISCOVERY_MAX_WALKS`).

**CH-09 · The saved-page index is built once, not three times a round**
- Lane: Coach & Hunters · Depends on: —
- Change: Replace the three full `indexVault` calls per round with an incremental index that only adds newly saved pages.
- Code: `scripts/freshness-shadow.mts:3168,3273,3332`; the vault index helper.
- Done when: the round's phase timings in live Admin show the vault index step once and short.
- Retires: per-pass full vault indexing.

**CH-10 · Every funded Send gets the same rules**
- Lane: Coach & Hunters · Depends on: —
- Change: `ORIGINAL_LIFETIME_HUNT` (ZIP 85635) still gets privileges no other Send gets:
  - exemption from the scheduled blackout;
  - its budget overriding overlapping scopes;
  - billing attribution;
  - the admin-bridge runner path;
  - special registry handling;
  - snapshot census output.

  Give every funded Send the same rule. The runner's continuation should consider every funded scope (`lifetimeHuntContinuations` already exists).
- Code: `lib/control-plane/scheduler/hunt-continuation.ts:19-62`, `lib/civic-data/hunt-source-tasks.ts:13-20`, `lib/control-plane/expansion/membership.ts:500-505`, `expansion/assignment-budget.ts:406-410`, `provider-billing-attribution.ts:24-26`, `evidence/admin-bridge-runner.ts:38-39`, `lib/control-plane/gateway/registry.ts:1055-1075`, `scripts/publish-owner-snapshot.mts:775-777`.
- Done when: two funded Sends in live Admin show the same budget and schedule behaviour, and no code names the original receipt.
- Retires: `ORIGINAL_LIFETIME_HUNT` and its branches.

**CH-12 · Pilot ZIPs lose their place at the front of the line**
- Lane: Coach & Hunters · Depends on: —
- Change: Delete the hard-coded pilot band that puts four pilot places ahead of all other standing work. Order comes from Sends and Sean's place targets only.
- Code: `lib/control-plane/research-metrics.ts:108-210` (`PILOT_JURISDICTION_KEYS`, `bandFor`), `scripts/freshness-shadow.mts:1346-1348` (`orderingInputs.pilotZips`); also check `lib/control-plane/readiness/compute.ts:39` and `lib/health/owner-corpus-compile.ts:49`.
- Done when: live Admin's work order for standing work shows no pilot place ahead of a sent place.
- Retires: pilot-ZIP band 1.

**CH-13 · Statute-routed requirements work for any state**
- Lane: Coach & Hunters · Depends on: —
- Change: Only three states get statute-routed requirements (`JURISDICTION_REFERENCE_STATES`). Make the jurisdiction reference a data record per state, read at runtime. The three existing states become seed rows, and a new state's reference is added as data.
- Code: `lib/civic-data/reviewed-registry-states.ts:7`, `lib/registration/jurisdictions.ts`, `scripts/enumerate-jurisdictions.mts`, `lib/civic-data/operational-references.ts:281-291`, `lib/control-plane/scheduler/providers/local-jurisdictions.ts`.
- Done when: a reference added as data for a fourth state makes its statute-routed requirements appear on that state's place work in live Admin, with no release.
- Retires: the hard-coded state list.

**CH-14 · Old comments and reasons that read like gates**
- Lane: Coach & Hunters · Depends on: —
- Change: Correct stale text that misleads people and agents:
  - `freshness-shadow.mts:1737-1739` (a write budget that no longer exists);
  - the `manual-producer-invocation.ts` reasons claiming worker output "must pass independent verification and audit before publication";
  - the "review-gated" wording on engineer adapters (`workers/field-manual-learnings.ts:20-22`, `engineering-types.ts:80`);
  - the `auto-crosswalk.ts:13-14` header that lists two kinds instead of four.

  No behaviour changes.
- Code: `scripts/freshness-shadow.mts:1737-1739`, `lib/civic-data/manual-producer-invocation.ts`, `lib/control-plane/workers/field-manual-learnings.ts:20-22`, `engineering-types.ts:80`, `lib/control-plane/discovery/auto-crosswalk.ts:13-14`.
- Done when: the reasons shown in live Admin no longer say an audit must come before publication.
- Retires: the stale wording.

**CH-29 · Work our own spending guard refused goes back in line**
- Lane: Coach & Hunters · Depends on: CH-02
- Change: On Oct 3, live Admin showed 348 items stuck because our own policy refused the request before anything was sent to the AI service. The spending or execution guard refused it (`refusedBeforeSending`, `scout-executor.ts:1474-1480`), and the item was recorded as a refusal (`scout-executor.ts:2013-2017`). Two more were refused by the per-Scout cost ceiling.
  - Read which guard refused each one. The likely cause is CH-02's unpriced charge, which sets paid capacity to zero.
  - Fix the cause, then put every refused item back in line with its case file.
  - A refusal by our own guard never counts as an attempt on the source or as a dead end.
- Code: `lib/control-plane/scheduler/scout-executor.ts:1466-1480,2013-2017`, `lib/control-plane/scheduler/scout-result.ts:499`, `lib/control-plane/workers/detective.ts:215`, `lib/control-plane/fleet-safety.ts`.
- Done when: live Admin's Work view shows those items being worked again and that cause's count at zero, with paid work running under the budget dial.
- Retires: refusals by our own guard counted as failed attempts.

**CH-30 · When the AI service doesn't answer, the agent's work is kept**
- Lane: Coach & Hunters · Depends on: —
- Change: On Oct 3, live Admin showed 276 items where the AI service didn't answer and the agent's work was thrown away. A new agent starts from scratch when the item comes due again (`blocker-causes.ts:70-72`).
  - On an outage or timeout, save the steps walked and the pages read as the case file, the same way CH-07 does for a hunter that hits its time limit.
  - Retry with backoff. After repeated failures, try the other model tier.
  - The next agent resumes from the case file.
  - Keep each provider's failure history so backoff learns. Open PR #698 does part of this; RL-02 checks it first.
- Code: `lib/control-plane/scheduler/scout-executor.ts:2013-2017` (`SCOUT_TRANSPORT_FAILED`), `lib/control-plane/scheduler/scout-result.ts`, `lib/control-plane/workers/detective.ts:215`, `lib/control-plane/admin-view/blocker-causes.ts:70-72`.
- Done when: in live Admin, items hit by an AI service outage resume with their earlier steps, and that cause's count falls.
- Retires: thrown-away work on an AI service outage.


#### Box & Slide

**BX-01 · The Box: one index of every finding**
- Lane: Box & Slide · Depends on: —
- Change: Add a findings projection over Scout and detective results: each finding with its exact quote, page address and saved copy. Add `subjectId?` (the target subject) and `missionPart?` to `ScoutFinding`, and a state of waiting, taken, built or refused. Index findings where results are written today, in both writers, and backfill the index once from every Scout and detective result already written, so research already paid for reaches builders through BX-02. Mid-walk drops come later with the `report_finding` tool (CH-20). This reuses existing results and is not a second store. The Box records which builder took each finding and when, retries a finding whose builder failed, never builds the same finding twice (keyed by quote, page and subject), and survives a runner restart because it lives in the control-plane store. When builders fall behind, hunters keep dropping findings and Admin shows the backlog.
- Code: `lib/control-plane/scheduler/scout-result.ts:195`, `lib/control-plane/repository/pg-schema.ts`, `types.ts`, `lib/control-plane/workers/standing-runtime.ts:236`, `scripts/freshness-shadow.mts:2619`.
- Done when: live Admin shows findings waiting, taken and live for each Send, including findings from results written before the change, and a runner restart loses no finding and builds none twice.
- Retires: —

**BX-08 · Office and meeting addresses get map points for any wired body**
- Lane: Box & Slide · Depends on: —
- Change: Match a published address with the Census geocoder when the house number, street and city agree; check the ZIP only when the published text carries one. Run the automatic match for hand-wired bodies too, not only derived families. Remove the 20-per-pass cap (rulings §2 reads federal sites at full speed).
- Code: `lib/meetings/automatic-venue-resolutions.ts:10,56-64`, `scripts/ingest.ts:852-870` and the registered-partition path.
- Done when: new venues of hand-wired bodies get pins on the live map within one pass with no reviewed row, at the proof bar (see the rule above).
- Retires: `MAX_ADDRESSES_PER_PASS = 20` and the ZIP-required match.

**BX-10 · Concluded meetings link their video**
- Lane: Box & Slide · Depends on: —
- Change: Add an optional `videoUrl` to `Meeting`, set by adapters that publish one (for example Legistar's `EventVideoPath`, Granicus).
- Code: `lib/sources/types.ts:214+`, `lib/sources/legistar/index.ts` and other adapters with a video field; the meeting card renderer.
- Done when: a concluded meeting card on the live site shows a video link whose source is in its Sources section.
- Retires: video carried only as a loose published link.

**BX-12 · A publish-now lane that runs every minute**
- Lane: Box & Slide · Depends on: —
- Change: The routine lane runs every five minutes (`ROUTINE_DATA_ADMISSION_MS`) and one pass can run long, so nothing today can react within a minute. Add a `publish-now` lane to the parent's `IndependentRuntimeLaneScheduler` that runs every 60 seconds. It runs only two kinds of work: worker publication requests (BX-03) and reads of doors whose watch probe saw a change (DB-26). It never runs inside the routine pass, so a long pass can't delay it.
- Code: `scripts/pilot-runner.mts:1133,1161-1168` (lane scheduler), new `scripts/publish-now-runner.mts`, `lib/civic-data/worker-publication-tasks.ts`.
- Done when: live Admin's Workers view shows the publish-now lane running every minute, including while a long routine pass is still going.
- Retires: —

**BX-13 · Slow discount batches only where no clock is running**
- Lane: Box & Slide · Depends on: —
- Change: Background parse and audit model calls go through the discounted batch service by default (`BATCH_LANES`, `defaultEnabled: true`). A batch can take hours to come back, which breaks the one-hour target for anything a reader is waiting on. Route by job instead of by role: refreshes of live facts, anything on the publish-now lane (BX-12) and the first fill of a new mission's core items go straight to the model; backfills, history and audit samples keep the batch discount. Keep the durable batch journal and recovery as they are.
- Code: `lib/control-plane/model-batch.ts:14-43`, the callers of the `background-worker-parse` and `background-worker-audit` lanes.
- Done when: live Admin's Money view shows batch use only on backfill, history and audit work, and parse calls for doors whose checks found a change come back in minutes.
- Retires: batch-by-default for work a reader is waiting on.


#### Checkers & Publishing

**CP-02 · The checker labels sources instead of refusing them**
- Lane: Checkers & Publishing · Depends on: —
- Change: Add `SourceKind`: `OFFICIAL`, `CAMPAIGN`, `FILING`, `VOTER_GUIDE`, `FORUM`, `NEWS`, `REFERENCE` or `OTHER`. `section3Page` returns `{ok, kind}`:
  - an official page (as today) is `OFFICIAL`;
  - a verified campaign site is `CAMPAIGN`, only for facts about its own candidate;
  - a filing authority's document is `FILING`;
  - known hosts come from a host table (an `AdminConfig` key with a code default; Open States is `REFERENCE`);
  - unknown hosts are `OTHER` and pass only when the page links a source whose saved copy also holds the value.

  Add a second setting, "which source kinds count", listing every kind as on by default (design §16.3); a kind turned off is labeled but not published from.

  The freshness check stays.
- Code: `lib/control-plane/promotion/section3.ts` (`section3Page` :128).
- Done when: on the live site, a campaign page can source a fact about its own candidate and never about an opponent (no opponent fact appears from it).
- Retires: the `NOT_OFFICIAL_SOURCE` refusal.

**CP-05 · The quote travels with the fact**
- Lane: Checkers & Publishing · Depends on: —
- Change: Copy each published field's parser span into `fieldSources[field].quote` in the worker reader, roster and directory packages. Show it as one line under "Read from" in the Sources section.
- Code: `lib/civic-data/worker-reader-publication.ts:63`, `worker-roster-publication.ts`, `worker-body-directory.ts`, `lib/control-plane/workers/types.ts:157`, `components/officials/card-sources-list.tsx`.
- Done when: a comment-rule fact's Sources row on the live site shows the exact sentence it came from.
- Retires: —

**CP-06 · Dates must make sense**
- Lane: Checkers & Publishing · Depends on: —
- Change: Design §6.6 asks whether a date makes sense: not in the past for an upcoming meeting, not years stale for an official. In `section3Record`:
  - refuse a meeting record whose own status says scheduled or upcoming while its start is more than a day past (`DATE_IN_PAST`); never refuse a concluded meeting;
  - for officials, keep the existing capture-age check (`OUTSIDE_FRESHNESS_WINDOW`), and refuse a member only when the same page now lists a different holder for that seat. Officials often serve past their term end until a successor is sworn in, so a passed term date alone never removes anyone.

  Refusals go to a detective (DP-03).
- Code: `lib/control-plane/promotion/section3.ts`.
- Done when: on the live site, an upcoming meeting that a source left dated in the past goes to a detective instead of showing as upcoming, and an official serving past their term end stays on their card.
- Retires: —

**CP-09 · Every record kind has its design minimum**
- Lane: Checkers & Publishing · Depends on: —
- Change: Add `VOTE: [person, subject, position, date]`, `STANCE: [personId, quote, date]` and `BALLOT_MEASURE: [election, number or title, textUrl]` to `SECTION3_MINIMUMS`. Set the Money minimum to the design's: candidate or committee, amount, period and a link to the filing. `BALLOT_MEASURE` needs a number or a title, not both. The correct-jurisdiction test stays part of §3 verification, not an extra minimum field. A filing without an amount still publishes as a filing document (a different record); only the Money record needs an amount (rulings §3: missing information must not hide verified information).
- Code: `lib/control-plane/promotion/section3.ts:27-38`, `lib/civic-data/official-filings.ts:33`.
- Done when: on the live site, a filing with an amount shows in the Money section, and a filing without one still shows as a filing document.
- Retires: —

**CP-10 · A portrait from the person's own page publishes at once**
- Lane: Checkers & Publishing · Depends on: —
- Change: Sean decided (design §10, confirmed Oct 3) that a portrait from an official source or the person's own campaign site goes live immediately, and needs a second matching source only otherwise, with no review step.
  - Add `basis: OWN_PAGE | TWO_SOURCES` to the portrait verification.
  - `OWN_PAGE` accepts one source when it is official or the person's own campaign site (Sean, Oct 3): any official site under rulings §3, such as a .gov page, that shows the person; their own entry on their body's roster page where the image is bound to that entry (`pickPortraits`, `lib/photos/evidence.ts:28-35`); the official account of their office on a social platform; or their verified campaign site. A personal social account, or any other page that merely mentions them, still needs a second matching source. Record attribution only; no licence sentence is required.
  - Change the read-time binding check to match, because it currently drops any portrait with fewer than two sources.
  - Limit `needsSecondSource` for portraits to images not from the person's own page.
- Code: `lib/photos/evidence.ts:39-81` (`verifyPortraitSources`, `portraitVerificationMatches`, `portraitBindingMatches`), `lib/registry/runtime-data-plane.ts:20`, `lib/control-plane/promotion/section3.ts:47-49`, `workers/audit-sampling.ts:136`.
- Done when: officials whose only photo is on their own official profile show that portrait on the live site on the next pass, with its source in the card's Sources section, at the proof bar (see the rule above).
- Retires: the blanket two-publisher portrait rule.

**CP-11 · The campaign-site chain loses its planted-control audit stage**
- Lane: Checkers & Publishing · Depends on: —
- Change: Remove the pre-publication AUDITED stage with planted known-answer controls; it is a ceremony beyond §3. Keep the identity check that the site names the candidate, office and cycle. The extra "independent second signal" goes in CP-12. A later sample by the live auditor (DP-13) can still pull a site.
- Code: `lib/control-plane/promotion/campaign-site-chain.ts:1-45,345-397,649-655`, `pipeline.ts`.
- Done when: a newly found campaign site is live within one pass of its identity check, with no audit record.
- Retires: the planted-control audit requirement.

**CP-13 · Candidate enrichment can publish every field**
- Lane: Checkers & Publishing · Depends on: —
- Change: Remove the `openFields` restriction that lets `candidate-enrichment` publish only `campaignSite` and `bio`.
- Code: `lib/control-plane/promotion/activation-policy.ts:25`.
- Done when: a verified candidate contact field from a campaign site shows on the live ballot card.
- Retires: the field restriction.

**CP-15 · The research meeting fact chain is retired**
- Lane: Checkers & Publishing · Depends on: —
- Change: The chain re-promotes snapshots that routine adapters already promoted, with an activation receipt; it protects no reader outcome. Delete it, along with the `AUDIT_NOT_RECORDED` bottleneck code that frames a missing audit as blocking.
- Code: `lib/control-plane/promotion/fact-chain.ts`, `fact-verification.ts` (as a publish gate), `production-meetings.ts`, `lib/civic-data/meeting-research-evidence.ts:105-124`, `lib/control-plane/workers/routine-meeting-intake.ts`, `scripts/ingest.ts:1615-1633,1754`, `lib/control-plane/research-progression.ts:163-164`.
- Done when: meetings keep publishing on the live site and the "fact chain" lines no longer appear in the runner's output in Admin.
- Retires: everything listed.

**CP-16 · Sources lists for meetings, money, votes and actions**
- Lane: Checkers & Publishing · Depends on: —
- Change: Extend the card-sources assembler so meeting cards (agenda, minutes, records, comment access, cadence), money (FEC and state filings), votes and official actions each produce Sources rows.
- Code: `lib/officials/card-sources.ts`.
- Done when: the meeting, money and vote data on the live site each carries a Sources list ready for its card (rendered by FE-12 and FE-14).
- Retires: —

**CP-17 · Wording that could be wired as a gate**
- Lane: Checkers & Publishing · Depends on: —
- Change: Reword `bothSidesShip` / `BLOCKED_ASYMMETRIC` ("neither ships") as a scoreboard reading only. Rename the `US-AZ+US-NH+US-NJ:` scope labels on curated worker-door scopes at their next contract version.
- Code: `lib/hunt/measure-depth.ts:183-226`, `lib/civic-data/manual-contracts.ts`.
- Done when: no publish path or Admin label reads as a three-state limit or a "neither ships" rule.
- Retires: the wording.

#### Doors & Bank

**DB-02 · Shared meeting fetch limits use the held window**
- Lane: Doors & Bank · Depends on: DB-01
- Change: Point the shared fetch bounds at the held window (120 back, 120 ahead): the partition and Legistar fetch arguments, carry-forward, derived wiring readings and site discovery.
- Code: `scripts/ingest.ts:748-749,971-974`, `lib/meetings/carry-forward.ts:135,158`, `lib/control-plane/discovery/derived-wiring-reading.ts`, `lib/hunt/meetings-site-discovery.ts`.
- Done when: a derived-family body in live Admin holds sittings more than 90 days out that the map does not show.
- Retires: the shared "fetch window is the served window" rule.

**DB-06 · Concluded meetings with records are kept for good**
- Lane: Doors & Bank · Depends on: DB-01
- Change: Move concluded meetings that carry an agenda, minutes, outcome or vote into a durable history projection, under the same record class with a `:history` scope, readable by person or body with no window. Order of operations: write and promote the history version first, and remove a row from its partition only after the history pointer holds it, so no record is ever in neither place.
- Code: `scripts/ingest.ts`, `lib/civic-data/validate.ts`, `lib/meetings/query.ts`.
- Done when: live Admin's publication view shows the history projection holding concluded sittings older than 120 days, with no removals of sittings that carry records.
- Retires: —

**DB-08 · Congress refreshes itself daily, and votes accumulate**
- Lane: Doors & Bank · Depends on: —
- Change: Put `congress-bulk-roster`, `congress-rollcalls` and `federal-key-votes` on the daily automatic refresh. Change the roll-call projection from a replacing window to append-only. The key votes Sean picks show on person cards (CA-46).
- Code: `lib/civic-data/automatic-refresh.ts:5-10`, `lib/civic-data/manual-contracts.ts:46,78`, `lib/civic-data/manual-producer-invocation.ts`.
- Done when: live Admin shows these contracts promoting daily with no Send, and a roll call older than the old window is still answerable in Ask.
- Retires: Send-only refresh for Congress.

**DB-09 · The Door Registry: one editable list of every door**
- Lane: Doors & Bank · Depends on: —
- Change: Create the registry as the editable source of truth: a control-plane table written only through a gateway action with a receipt. One record per door:
  - `doorId` (stable and readable);
  - `kind` (adapter);
  - `ocdId` and `bodyIds[]`;
  - `hosts[]`, because one door can span several hosts;
  - `config`, with references to keys and never secret values;
  - `holds` (record classes), `checkEvery` and `notes`;
  - `status` (`OPEN`, `SHUT` or `SUSPENDED`);
  - `lastSuccessAt`, `lastFailureAt`, `shutSince` and `readNow`.

  Derived wiring rows upsert into it by door id without overwriting a manual edit that is newer than the derive input.
- Code: new `lib/doors/registry.ts`, `lib/control-plane/repository/pg-schema.ts`, `types.ts`, `lib/control-plane/gateway/registry.ts` (read and write action).
- Done when: live Admin lists the registry, empty or seeded, with its receipt log.
- Retires: —

**DB-24 · The manual crosswalk contract is retired**
- Lane: Doors & Bank · Depends on: —
- Change: The automatic crosswalk already covers all four derived kinds nationally. Check that the derived output holds the rows the manual three-state contract produced, then retire the manual contract.
- Code: `lib/civic-data/manual-contracts.ts:464-469`, `lib/control-plane/discovery/auto-crosswalk.ts`.
- Done when: live Admin shows the same bodies wired as before, with only the derived crosswalk contract active.
- Retires: the manual `meeting-body-crosswalk` contract and its three-state scope.

**DB-37 · Lessons and doors in the Bank are tied to places**
- Lane: Doors & Bank · Depends on: —
- Change: Add optional `ocdIds[]` and `bodyIds[]` to field-manual entries and to the projection query, matched on division prefix, so place-specific doors come ahead of general lines.
- Code: `lib/control-plane/field-manual.ts:72-100,191-238`.
- Done when: a hunter's brief for a county on the live runner lists that county's doors first (visible in the brief lines it inherited).
- Retires: —

**DB-38 · Silent Bank write failures become visible**
- Lane: Doors & Bank · Depends on: —
- Change: `writeFieldManual` returns errors and nobody sees them. Count returned write errors and show the count with the Bank's learning numbers (which move onto the Scoreboard in BR-23). This count is what decides when DB-39 is needed.
- Code: `lib/control-plane/field-manual.ts:332-350`, its callers, `lib/control-plane/admin-view/v6-learning-read.ts`.
- Done when: live Admin shows the Bank write-error count, or "0".
- Retires: —

**DB-40 · The Bank knows how long and how much each kind of job takes**
- Lane: Doors & Bank · Depends on: —
- Change: When an attempt closes, write or refresh a Bank entry keyed by platform or route and record class, with the typical duration and cost per success, so hunters see it in their head start.
- Code: `lib/control-plane/scheduler/cycle-finalization.ts` or the attempt commit path, `lib/control-plane/field-manual.ts`.
- Done when: a live Scout's brief shows "typically N requests, $X" for its platform.
- Retires: —

**DB-41 · Platform fingerprints are data**
- Lane: Doors & Bank · Depends on: —
- Change: Move the code list of nine known platforms into Bank `PLATFORM_FINGERPRINT` entries read at runtime, so a new platform is added without a release.
- Code: `lib/hunt/platform-tenancy.ts:40-50`, `lib/control-plane/field-manual.ts`.
- Done when: a platform fingerprint added as data is detected on the next live walk.
- Retires: `KNOWN_PLATFORMS` as code.

**DB-42 · Playbooks, part 1: Scouts and detectives read written playbooks**
- Lane: Doors & Bank · Depends on: —
- Change: 
  - Add a playbook loader that reads `PLAYBOOK` Bank entries by role.
  - The Scout and detective system prompts become a short fixed safety frame plus the current playbook text, read when each agent starts. The frame holds the laws: no bypassing access controls, quotes come from saved bytes, robots.txt is recorded and not obeyed as a block.
  - Keep the playbook in the cached system block so prompt caching still holds per version.
  - The detective playbook names archived copies of old pages as a route (web.archive.org through `fetch_public`, already used as a route in `lib/hunt/branch-manifest.ts:664`).
- Code: `lib/control-plane/scheduler/scout-executor.ts:507-540`, `lib/control-plane/workers/detective.ts:20-22,157-166`, `lib/control-plane/field-manual.ts:76`, `scripts/field-manual-seed.mts:233-240`.
- Done when: a changed Scout playbook line appears in the next live Scout's request.
- Retires: Scout and detective instructions as TypeScript strings.

**DB-48 · New releases install beside the running one**
- Lane: Doors & Bank · Depends on: —
- Change: Today every release drains all lanes, installs and restarts, and no door is read meanwhile. Install each new release into a second checkout while the current one keeps admitting work. The switch of which checkout new children start from is DB-53. Keep the old path behind a runner switch (an entry in the runner's environment file until DB-46's switches exist) until the new path is verified live, then remove the switch.
- Code: `scripts/pilot-runner.mts:1262-1281,1935-1944`, `lib/ops/runtime-release-handoff.ts`, `deploy/runner/`.
- Done when: on the live runner, a release installs into its own checkout while partition admissions continue, as the runner log in Admin shows.
- Retires: —

**DB-49 · A door-kind fix is checked by its own tests only**
- Lane: Doors & Bank · Depends on: —
- Change: Give each adapter under `lib/sources/<kind>/` its own fixture tests. Add a CI planner rule: a change limited to one kind runs only that kind's tests plus the composite contract test.
- Code: `scripts/ci-affected-tests.mjs`, `tests/` fixtures per adapter.
- Done when: an adapter-only pull request on GitHub runs fewer than 5% of test files, and its fix reaches the live site through the normal release.
- Retires: full-suite runs for adapter-only changes.

**DB-55 · Meeting history already deleted is restored**
- Lane: Doors & Bank · Depends on: DB-01
- Change: Rulings §6: restore the result, not only stop the loss. Rebuild concluded meetings that carried an agenda, minutes, an outcome or a vote and were removed as `OUTSIDE_REGISTERED_SERVING_WINDOW`, from prior promoted versions in `civic_data_promotions` history and from saved captures. Promote them back into their partitions (DB-01 no longer removes them); DB-06 later moves them into history. Each restored row keeps its original sources and read dates.
- Code: a one-time restore script over `civic_data_promotions` history and the saved-capture vault, `scripts/ingest.ts` promotion path.
- Done when: on the live site, concluded meetings removed before DB-01 are back, with their agendas and minutes, and Ask can answer what happened at them.
- Retires: the gap left by earlier deletions.

**DB-58 · A slow site holds up only its own reads**
- Lane: Doors & Bank · Depends on: —
- Change: Full meeting reads run inside the routine pass, a few per lane one after another (`lib/civic-data/runner.ts:136-147`), so one slow host can hold others. Run full meeting partition reads on their own lanes, one per failure domain (host), so a slow or hung host delays only its own doors. Keep the old path behind a runner switch (an entry in the runner's environment file until DB-46's switches exist) until the new path is verified live, then remove the switch.
- Code: `lib/civic-data/runner.ts:120-147`, `scripts/routine-civic-data-runner.mts`, `scripts/pilot-runner.mts:1161-1168`.
- Done when: in live Admin, a host that is slow to answer delays only its own doors' reads, while other hosts' doors keep their cadence.
- Retires: —

#### Detectives & Proving

**DP-03 · Held records and failed checks go to a detective with the reason**
- Lane: Detectives & Proving · Depends on: —
- Change: Route these cases to the model detective with the failing code and fields in its brief, instead of a fresh Scout:
  - a work item whose publication was held for a §3 failure (`SOURCE_REPLAY_FAILED`, `PAGE_UNVERIFIED`, minimum missing) and whose recovery is the worker;
  - validator failures (`PARSE_INVALID`, `IDENTITY_UNRESOLVED`, `SEMANTIC_INVALID`) from routine candidates;
  - date-sanity refusals (CP-06).

  The role choice is made where `investigationRole` is called (`standing-runtime.ts:130`). The coordinator's `plan.detective` loop feeds only the deterministic `runDetective`, which is being retired (DP-05).
- Code: `lib/control-plane/workers/standing-runtime.ts:130`, `lib/control-plane/workers/detective.ts:25-29`, `coordinator.ts:396-401` (unchanged).
- Done when: a held record in live Admin's stuck view shows a Detective attempt naming the failed check, and a later version publishes the field.
- Retires: held records looping back to a fresh Scout.

**DP-04 · A walk that hits its limit goes to a detective before it is called absent**
- Lane: Detectives & Proving · Depends on: —
- Change: In the argued-absence loop, don't record an absence when the walk was not a detective. The next walk then goes to a detective, through the existing `NO_PROGRESS` trigger. Record the absence only after a detective walk also comes back empty.
- Code: `scripts/freshness-shadow.mts:3370-3388`, `lib/control-plane/scheduler/absence.ts`.
- Done when: a stuck subject's dead-end box in live Admin shows a detective attempt before "absent until".
- Retires: absences recorded without a detective.

**DP-05 · The unused rule-based detective is removed**
- Lane: Detectives & Proving · Depends on: —
- Change: `runDetective` is never fed: every plan is built with `detective: []`, and the model detective does this job. Delete it and its branches.
- Code: `lib/control-plane/workers/detective.ts:52-153`, `research-runtime.ts:104-107`, `coordinator.ts:347-387` (detective loops), `standing.ts:436`, `plan-repair.ts:149,177`, `autonomous-plan.ts:31`.
- Done when: the live runner keeps dispatching model detectives as before (Admin Workers), with no deterministic detective code left.
- Retires: `runDetective`, `DetectiveTaskSpec`, `AutonomousWorkPlan.detective`.

**DP-07 · Routes are written for the kind of door, not one address**
- Lane: Detectives & Proving · Depends on: —
- Change: Stamp each discovery and route with its door kind: the platform (detected by `platform-tenancy.ts` on the saved page), the record class, and a host-free procedure. Keep a method entry keyed by (platform, record class, procedure), separate from the per-place door entry. Copy `ocdIds` onto the door entry (DB-37).
- Code: `lib/control-plane/scheduler/field-manual-scout.ts:130-175`, `scheduler/scout-candidates.ts:91-130,236-258`, `lib/hunt/platform-tenancy.ts`.
- Done when: after a second place on the same platform is walked, live Admin's Bank view shows one method with two places under it.
- Retires: routes stored only as one place's URL.

**DP-08 · One place's notes stop crowding everyone's head start**
- Lane: Detectives & Proving · Depends on: —
- Change: Set `states` (and `ocdIds` when DB-37 lands) on investigation-result entries and on the two-attempt route entries, so they stop projecting as "portable" into every state's 30-line brief.
- Code: `lib/control-plane/workers/standing-runtime.ts:231-235`, `scheduler/scout-candidates.ts:241-246`, `field-manual.ts:192-197,312-323`.
- Done when: a live Scout working in one state no longer inherits another state's investigation lines (visible in its inherited lines).
- Retires: the portable leak.

**DP-09 · We can tell how often detectives' routes get reused**
- Lane: Detectives & Proving · Depends on: —
- Change: Put `foundBy` (Scout or detective) on discovery and investigation entries, and split the reused-doors series by finder.
- Code: `lib/control-plane/scheduler/field-manual-scout.ts`, `workers/standing-runtime.ts:231`, `lib/control-plane/admin-view/learning-trends.ts`.
- Done when: live Admin's learning numbers (the Scoreboard after BR-23) show a "detective routes reused" series.
- Retires: —

**DP-13 · Auditors re-read live facts after they publish**
- Lane: Detectives & Proving · Depends on: —
- Change: Most published facts are never audited today; an auditor runs only for judgment calls.
  - Add a live-audit job to the standing runtime. Each pass it samples live facts by area (never loading the whole read model), re-reads each fact's source through the acquirer toolkit at normal pacing, and re-runs the value-on-page and date checks.
  - Count an unchanged routine refresh of a sampled fact as a green flag, and spend new fetches only where refreshes don't reach.
  - Results are green or red with the fact ID and the re-read page. Sampling rules start as a code default and move into the audit policy setting in DP-17.
- Code: `lib/control-plane/workers/standing.ts`, new `lib/control-plane/workers/live-audit.ts`, `lib/control-plane/promotion/section3.ts` (reuse `section3Record`).
- Done when: live Admin shows "audited this week: N", with real live-fact IDs and their re-read pages.
- Retires: —

**DP-15 · A pulled fact really leaves the published version**
- Lane: Detectives & Proving · Depends on: —
- Change: Check, and fix if needed, that an auditor BROKE pull removes the record from the next published version and does not just hold the next one.
- Code: `lib/civic-data/worker-publication-evidence.ts:167-180`, `lib/civic-data/manual-successor.ts`.
- Done when: a fact pulled by an audit on the live site is gone from the reader page at the next version.
- Retires: —

#### Collects & Ask

**CA-01 · Open States can publish legislators again (authority and firewall)**
- Lane: Collects & Ask · Depends on: —
- Change: Current rulings §3 already approve Open States for state legislators, but code still blocks it.
  - Set `routineAutoPromotion: true` for `STATE_LEGISLATOR` on `plural-openstates`, drop its three-state jurisdiction list and update its horizon note.
  - Remove the retired-intermediary firewall rules and the `mayReadRetiredPluralRoster` branches.
  - Fix the family note in `lib/holdings/datasets.ts:74`.
- Code: `lib/civic-data/source-authority.ts:804-820`, `lib/civic-data/firewall.ts:1769-1797`, `lib/registry/server.ts:623,719-728`, `lib/ask/votes.ts:147`, `lib/ask/server-sources.ts:85,268`, `lib/holdings/datasets.ts:74`.
- Done when: on the live site, a state legislator whose Open States row is held shows on their district card even where the official roster read is missing.
- Retires: the Open States retirement machinery.

**CA-03 · Terms have a start and an end**
- Lane: Collects & Ask · Depends on: —
- Change: Add optional ISO `termStart` and `termEnd` to roster members and seat holders. The roster publisher fills them when the dates are on the page, using the same value-on-page check.
- Code: `lib/registry/body-rosters.ts` types, `lib/civic-data/worker-roster-publication.ts:161-176`, `components/officials/official-term-note.tsx`.
- Done when: a council member's card on the live site shows "Term ends <month year>" with its source in the card's Sources section.
- Retires: free-text-only terms.

**CA-06 · Bodies have a published office address and phone**
- Lane: Collects & Ask · Depends on: —
- Change: Add `officeAddress` and `officePhone` to `Body` and to the body-directory door's field allowlist. They attach when found on the body's own page as an office address.
- Code: `lib/registry/types.ts:409-464`, `lib/civic-data/worker-body-directory.ts` (~:66), the body card.
- Done when: a county board's card on the live site shows its office address and phone, each with its source in the card's Sources section.
- Retires: —

**CA-09 · Statements carry what kind of source they came from**
- Lane: Collects & Ask · Depends on: —
- Change: Widen `SnapshotKind` to a data list of kinds: official page, campaign site, filing, voter guide, news, social post, forum or questionnaire, minutes and endorsement. Each kind has a reader label, shown only in the passage's Sources row (rendered by CP-04), never on the card face.
- Code: `lib/corpus/types.ts:35`, `lib/corpus/unified.ts`, `components/officials/positions-section.tsx:186-190`.
- Done when: a quoted passage's Sources row on the live site says which kind of source it came from.
- Retires: the two-kind statement list.

**CA-12 · Ask answers with a person's exact words**
- Lane: Collects & Ask · Depends on: —
- Change: When the only stance evidence is a verbatim passage with its address and date, either from the person's own page or naming them as the speaker on the saved page, compose the answer in code: the quote, the date and the Sources section. No model writes it. Keep the refusal for a model paraphrase without a second source.
- Code: `lib/ask/stance-answerability.ts:12-24`, `app/api/ask/grounded/route.ts:2583-2590`, `lib/ask/synthesize.ts:626-628`, `lib/ask/statements.ts`.
- Done when: on the live site, Ask asked what a held official said about water returns their own dated sentence with its source.
- Retires: the blanket `UNVERIFIED_PERSONAL_STANCE` refusal for exact quotes.

**CA-13 · Topic chips stop erroring**
- Lane: Collects & Ask · Depends on: —
- Change: Refresh the projections that `verifiedReaderPersonKeys` needs before resolving identity, so a missing bridge resolves to the subject's own key instead of a 503 or a 409.
- Code: `app/api/positions/[subject]/[topic]/route.ts:61-121`, `lib/identity/reader-person.ts`.
- Done when: chips on officials in every held state answer 200 on the first click on the live site.
- Retires: —

**CA-20 · FEC money for every member and every candidate in a sent place**
- Lane: Collects & Ask · Depends on: —
- Change: Targets become every promoted member of Congress, plus FEC candidate search for every congressional district in an admitted Send (resolved the way `place-source-admission.ts:62-67` already does). FEC filers never create contests.
- Code: `scripts/fetch-fec.mts:122-127,334-387`.
- Done when: a member of Congress from a state never worked before shows FEC totals and top committee and organization contributors by filed name, with individuals as aggregates (today's donor rule, `lib/funding/donor-privacy.ts`), with filing links on the live site.
- Retires: the one-county FEC target read.

**CA-23 · Local money shows on the person's card**
- Lane: Collects & Ask · Depends on: —
- Change: Join local finance records to people through the committee-to-office bridge that Ask already uses, and render them on the person card.
- Code: `lib/ask/local-finance.ts`, `components/funding/state-money-section.tsx` or the person card.
- Done when: a local candidate with held local filings shows committee totals on their live card.
- Retires: local money visible in Ask only.

**CA-24 · Ballot measures are records, not code**
- Lane: Collects & Ask · Depends on: —
- Change: Add a measure record: `{contestId, whatItDoes, yesMeans, noMeans, parts[{number as in source, kind, label, what}], sourceUrl, sourceHash, writtenAt}`, stored in the civic-data store and loaded by the reader's divisions. Seed it from today's JSON and TypeScript rows so current readers see no change. Reaction IDs stay the same.
- Code: new `lib/ballot/measure-records.ts`; `lib/ballot/measure-summary.ts` and `measure-provisions.ts` become thin readers; `app/ballot/page.tsx`, `lib/ask/server-sources.ts`, `app/api/reactions/route.ts`.
- Done when: measure pages on the live site render as before, read from records, and a measure record added as data shows with no release.
- Retires: the static measure imports (finished in CA-29).

**CA-31 · A ballot contests door for any place**
- Lane: Collects & Ask · Depends on: —
- Change: Add a worker reader door `ballot-contests` that calls the existing `section3Contest` on the saved official candidate list. Admit PDF text captures, since most official lists are PDFs or CSVs. Publish each contest only with its full listed set of candidates, together, into a generic `BALLOT_CANDIDACY` projection keyed by state and election.
- Code: `lib/civic-data/worker-reader-contracts.ts`, `lib/control-plane/promotion/section3.ts:189`, `lib/civic-data/worker-publication-evidence.ts:29` (content types).
- Done when: counties with no prior ballot show their contests with all listed candidates in the live generic projection (visible in Admin and to Ask; the ballot page reads it after CA-32), at the proof bar (see the rule above).
- Retires: —

**CA-42 · A person's votes stay with them after they leave**
- Lane: Collects & Ask · Depends on: —
- Change: Check that a departed member's votes survive the next roster version. For example, promote a roster without member X and read X's votes from the state roll-call projection. Fix it if they don't.
- Code: `lib/civic-data/worker-roster-publication.ts:104-110`, `lib/civic-data/contracts.ts:296-339`, `lib/votes/types.ts:56`, `lib/outcomes/types.ts`.
- Done when: Ask on the live site answers how a departed member voted.
- Retires: —

**CA-44 · Money shows filings without disclaimers**
- Lane: Collects & Ask · Depends on: —
- Change: Remove the disclaimer sentences on the FEC section ("not the whole", "the filings don't give a district", "we don't sort donors"), which break rulings §10. The computed share sentences go in CA-45.
- Code: `lib/funding/concentration.ts:218-264`, `components/funding/funding-section.tsx:164-230`, `lib/funding/display.ts:121-131`.
- Done when: the money section on the live site shows amounts and categories with no disclaimer lines.
- Retires: the disclaimer sentences.

**CA-46 · PRL's measurements and Sean's key votes on person cards**
- Lane: Collects & Ask · Depends on: —
- Change: Sean decided D1 on Oct 3. Person cards show PRL's measurements, such as how much of a person's posts are about policy and how much are attacks on opponents, credited to PRL in the card's Sources section. Meanwhile never scores, rates or labels anyone itself. The key votes Sean picks stay on the card, alongside the person's full voting record, and he keeps them current.
- Code: `components/officials/public-statements-profile.tsx`, `lib/civic-data/manual-producer-invocation.ts:28`.
- Done when: a person card on the live site shows PRL's measurements credited to PRL in Sources, and Sean's key votes next to the full voting record.
- Retires: —

**CA-47 · Curated rosters and statewide officers become data**
- Lane: Collects & Ask · Depends on: —
- Change: Move the hand-written rosters and statewide-officer rows into promoted registry records read at runtime, the same way the worker roster path publishes, then delete the TypeScript files.
- Code: `lib/registry/body-rosters.ts`, `rosters-nj-morris.ts`, `cawcd-rosters.ts`, `lib/officials/statewide-executives.ts`.
- Done when: those places' officials render unchanged on the live site, with the TypeScript files gone.
- Retires: the files listed.

**CA-48 · Curated bodies become data**
- Lane: Collects & Ask · Depends on: —
- Change: Move `curated-bodies.ts` into promoted registry records read at runtime, then delete the file.
- Code: `lib/registry/curated-bodies.ts`, `lib/registry/runtime-data-plane.ts`.
- Done when: those bodies render unchanged on the live site with the file gone.
- Retires: `lib/registry/curated-bodies.ts`.

**CA-49 · Ask answers within three seconds, even cold**
- Lane: Collects & Ask · Depends on: —
- Change: A cold Ask already measures 3.27 seconds. Find what the cold path loads, starting from the recorded measurement (`app/api/warm/route.ts:17-21`), and fix it so every §11 question is usable within three seconds.
- Code: `app/api/ask/grounded/route.ts`, `app/api/warm/route.ts:17-21`, Ask module graph.
- Done when: a cold Ask on the live site is usable within three seconds for every §11 question (FE-02 confirms it in its worst-case row once that exists).
- Retires: —

**CA-51 · Ask answers "who's running" for any office on the reader's ballot**
- Lane: Collects & Ask · Depends on: —
- Change: Ask's direct ballot path knows only a fixed list of state and federal office names (`OFFICE_WORDS`). In the Oct 3 audit the ballot page for a ZIP listed four candidates for its borough council, and Ask, asked who was running for that council, said it had no candidate information and answered about current officeholders instead.
  - Match the office a reader names against the offices of the contests their ballot actually holds, by normalized name and by kind (council, board, commission, district), not against a fixed list. Keep the fixed list as synonyms.
  - A "running for" question never falls back to officeholders while a held contest matches.
- Code: `lib/ask/ballot-summary.ts:47-100`, `app/api/ask/grounded/route.ts:1093-1111`.
- Done when: on the live site, at the proof bar, asking who is running for a local race on a place's ballot lists the same candidates as the ballot page.
- Retires: the fixed office list as the only way into the direct ballot answer.


#### Front-end

**FE-01 · Look at the live site safely**
- Lane: Front-end · Depends on: —
- Change: The runner already browses production with synthetic marking (`served-reader-production.ts`, `launchGuarded`), and current rulings §6 require looking at the live page. RULING 125 is historical.
  - Lift the localhost refusals in the four harnesses.
  - Add an option to `launchGuarded` that aborts write routes in the browser: `/api/log`, `/api/events`, `/api/reactions`, `/api/feedback`, `/api/ask` and Send posts.
- Code: `scripts/browser.mts`, `scripts/walk-all.mts:115-178`, `visual-suite.mts:74-92`, `reader-suite.mts:96-115`, `admin-walk.mts:56`.
- Done when: a walk run against the live site records zero search-log and Ask rows in its run record.
- Retires: the RULING 125 refusals.

**FE-03 · Every published place gets warmed, not just the pilots**
- Lane: Front-end · Depends on: —
- Change: Replace the pilot points and the place-specific preloads in the warm route with places read from the reader edge manifest (one ZIP per published county).
- Code: `lib/ops/post-deploy-warm.ts:35-41`, `app/api/warm/route.ts:67-68,117,120`.
- Done when: after a live deploy, a ZIP never in the pilot list returns a CDN hit on its first reader request.
- Retires: `PILOT_ZIP_POINTS` and the place-specific preloads.

**FE-05 · Contrast is checked on every change**
- Lane: Front-end · Depends on: —
- Change: Run the contrast audit in CI through a test that imports its pure function.
- Code: `scripts/contrast-audit.mts`, new `tests/contrast-audit.test.ts`.
- Done when: a pull request that drops a token pair below the bar is refused on GitHub before it reaches the live site.
- Retires: the manual-only `pnpm contrast`.

**FE-06 · The spacing and type guard covers components too**
- Lane: Front-end · Depends on: —
- Change: Extend the rhythm guard to scan TSX for `text-[`, `p*-[`, `gap-[` and hex colours, with the same shrink-only baseline.
- Code: `lib/design/rhythm.ts`, `tests/rhythm-tokens.test.ts`, `tests/rhythm-tokens.baseline.json`.
- Done when: a pull request adding a new 9px label is refused on GitHub before it reaches the live site.
- Retires: —

**FE-07 · Type-rung classes for the six sizes**
- Lane: Front-end · Depends on: —
- Change: Add utility classes for the six type rungs (display to caption) that are already tokens.
- Code: `app/globals.css`, `docs/DESIGN.md`.
- Done when: the classes render at the right sizes on the live site's existing pages.
- Retires: —

**FE-16 · Page measurements anyone can run**
- Lane: Front-end · Depends on: —
- Change: Add pure evaluators over a browser page: layout shift, horizontal overflow, cut-off text, tap targets under 44 by 44 CSS pixels (40 for compact controls), font sizes and spacing off the token scales, and rendered contrast under the bar.
- Code: new `lib/health/page-metrics.ts`.
- Done when: running them against a live page lists each issue with the element.
- Retires: —

**FE-17 · Resident tasks written as data**
- Lane: Front-end · Depends on: —
- Change: Write `data/health/resident-tasks.json`: plain-word tasks, each with a start surface, a success condition in reader terms and a tap budget. Seed it with:
  - the three tasks in design §6.11;
  - the six Ask questions in §11;
  - the §6.7 items (portrait, contacts, votes, money, pins with directions, ballot).
- Code: new `data/health/resident-tasks.json`.
- Done when: the file exists and FE-18 runs it on the live site.
- Retires: —

**FE-19 · The look standard is written down**
- Lane: Front-end · Depends on: —
- Change: Write `docs/look-standard.md` from Sean's rulings in `docs/DESIGN.md`, `docs/feedback/` and the feedback sweep records in `data/feedback/sweeps/`. Each rule has one good and one bad screenshot. It includes the design's "one clean, consistent design everywhere, with a glass-like polish" as a rule, pointing at the Lumen glass material tokens. It is the reviewer's only rubric.
- Code: new `docs/look-standard.md`, `lib/feedback/sweep.ts` records as input.
- Done when: the standard lists every Sean look ruling with examples taken from live screens.
- Retires: —

**FE-29 · One "working on it" component with three states (map and popups)**
- Lane: Front-end · Depends on: —
- Change: `WorkingOnIt` gets a `state`:
  - not yet searched: "We're working on getting this info" plus the "Want us to get this sooner?" link;
  - searched and nothing found, for stance topics only: "Not found in the sources checked" plus what was searched, shown only when an equal-effort sweep record exists (CA-15). Every other empty field keeps "We're working on getting this info" while the hunt continues (design §10);
  - the government hasn't published it yet.

  Route every not-covered literal on map and popup surfaces through it, passing the subject so the demand pill shows. Replace `NoValue` "not recorded" and "not yet", and the meeting-place line (default: the same sentence).
- Code: `components/demand/working-on-it.tsx`, `components/map/popup/popup-card.tsx:224`, `card-sources-list.tsx:91`, `entity-modal.tsx`, `official-modal.tsx`, `member-directory.tsx`, `coverage-notice.tsx:762-837`, `meeting-popup.tsx:288-292`, `map-entry.tsx`, `location-bar.tsx`, `welcome-overlay.tsx`, `stats-bar.tsx`, `lib/meetings/online.ts:150`.
- Done when: at a thin place on the live site, every empty map or popup section shows one of the three states, with the link where a subject exists.
- Retires: the alternative empty-state sentences on those surfaces.

**FE-38 · One Admin stylesheet, and no leftover Admin prefix**
- Lane: Front-end · Depends on: —
- Change: Fold `mw.module.css` into `v6.module.css`. Point `admin-walk.mts` at Admin views. Remove the `/readiness` Admin prefix, which has no page behind it.
- Code: `app/(admin)/_mw/mw.module.css`, `_mw/ui.tsx`, `live-refresh.tsx`, `app/(admin)/loading.tsx`, `scripts/admin-walk.mts:46`, `middleware.ts:68-75`.
- Done when: live Admin looks the same with one stylesheet, and `/readiness` returns not found.
- Retires: `mw.module.css`; the readiness prefix.

**FE-39 · No pilot ZIP buttons on the welcome screen**
- Lane: Front-end · Depends on: —
- Change: Remove the hard-coded quick-ZIP buttons. The welcome screen asks for the reader's ZIP or location only.
- Code: `components/map/welcome-overlay.tsx:45-50`.
- Done when: the live welcome screen names no place.
- Retires: `QUICK_ZIPS`.

**FE-43 · The homepage keeps working when the map can't draw**
- Lane: Front-end · Depends on: —
- Change: When a device can't start the map's graphics (WebGL), map setup calls `map.touchZoomRotate.disableRotation()` on an object that does not exist, and the whole page fails with "This page didn't load". Check that the map started before touching its controls. When graphics can't start, show navigation and the meeting list with one plain line saying the map can't show on this device.
- Code: `components/map/map-canvas.tsx:480-510`.
- Done when: the live homepage, opened in a browser with WebGL turned off, shows navigation and the meeting list.
- Retires: —

**FE-44 · Federal offices are tagged Federal on the ballot**
- Lane: Front-end · Depends on: —
- Change: The ballot's level tag comes from the contest's district (`tierForOcdId(contest.ocdId)`). A U.S. Senate race covers a whole state, so it is tagged State while the House race is tagged Federal. Take the level from the office first (the office identity table already knows `us_senator` and `us_representative`) and fall back to the district only when the office is unknown.
- Code: `app/ballot/page.tsx:2153,2652`, `lib/ocd/tiers.ts:112`, `lib/officials/office-identity.ts:120`.
- Done when: every live ballot with a U.S. Senate race tags it Federal.
- Retires: —


#### Scorecard

**SC-01 · The checklist's rules move into a data overlay, unchanged**
- Lane: Scorecard · Depends on: —
- Change: Create `lib/coverage/checklist-map.json`, keyed by checklist ID, and a loader. Move `GROUPS`, `appliesToRecord`, `DEADLINE_ITEMS`, `CALENDAR_ITEMS` and the freshness hours into it with identical behaviour. Leave the v1.1 profile and its importer byte-identical, since the importer rewrites the profile.
- Code: new `lib/coverage/checklist-map.json` and `checklist-map.ts`, `lib/coverage/place-owed.ts:39-75`, `lib/civic-data/held-place-capture.ts:54-104`, `held-place-families.ts:143`.
- Done when: live Admin's checklist card for a sent place shows exactly the same rows and counts as before.
- Retires: the rule constants in TypeScript.

**SC-03 · One percent formula, and the obvious honesty fixes**
- Lane: Scorecard · Depends on: —
- Change: 
  - One shared percent function for Admin, the national list and runner ordering (`dispatch-work.ts:66-70` uses a different formula today).
  - Keep extension (E) items out of the core count and show them separately.
  - Remove ASK from place groups. Show every scored core family, so the family rows add up to the headline.
  - Remove ENG from bodies.
  - Correct the family names: EXE is "Executive actions", PRL is "Public statement profiles", ENG is "Reader participation".
- Code: `lib/control-plane/admin-view/place-scorecard.ts:71-93`, `lib/control-plane/expansion/dispatch-work.ts:66-70`, `v6-checklist-section.ts:38-45`, `app/(admin)/_mw/admin-v6/groups.ts:13-16`, `lib/coverage/place-owed.ts:40`.
- Done when: live Admin and the runner's place order show the same number for a place, and the family names read correctly.
- Retires: the second percent formula; the duplicate group-name maps.

**SC-15 · The unused checklist census is removed**
- Lane: Scorecard · Depends on: —
- Change: Delete the per-instruction checklist census and its index publisher, route and owner-snapshot field, `evaluateChecklistSnapshot`, and `checklist-timings.ts` (posted-to-live is rebuilt in DB-27). Keep the `CHECKLIST_PROFILE` export.
- Code: `lib/control-plane/readiness/checklist-census.ts`, `checklist-dispatch-witness.ts`, `lib/control-plane/admin-view/checklist-index-publisher.ts`, `checklist-instance-index-write.ts`, `checklist-instance-index-read.ts`, `app/api/admin/v6/checklist/route.ts`, `owner-surface.ts:1478`, `scripts/publish-owner-snapshot.mts:775-782`, `checklist-timings.ts`, `checklist-score.ts` (`evaluateChecklistSnapshot`).
- Done when: the live runner's snapshot no longer publishes the census, and Admin is unchanged.
- Retires: the checklist census and its display path; `checklist-timings.ts`; `evaluateChecklistSnapshot`.

**SC-18 · The unused readiness snapshot and dead ZIP planners are removed**
- Lane: Scorecard · Depends on: —
- Change: Delete the readiness snapshot published every round and read by nothing, with its runner entry and repository, and the dead ZIP planners. Keep `catalog.ts` `US_STATES`.
- Code: `scripts/readiness-refresh.mts`, `scripts/pilot-runner.mts:701` (console publisher entry), `lib/control-plane/readiness/{compute,extract,gates,model,read,standard}.ts`, `standard.json`, `readinessSnapshots` in `repository/{types,pg-store,memory,file-store}.ts` and the type import at `pg-store.ts:74`, `lib/control-plane/zip-queue.ts`, `zip-acquisition-plan.ts`, `zip-gap-resolution.ts`.
- Done when: the live runner's rounds no longer run the readiness publisher, and Admin is unchanged.
- Retires: the readiness snapshot and its repository; the dead ZIP planners.

**SC-20 · Each coverage explanation stays within one kind of fact**
- Lane: Scorecard · Depends on: —
- Change: The registry's coverage view attaches a body's latest attempt whatever kind of fact it was for, so a school district's meeting coverage can show an election-office error. Pick the latest attempt by body and fact family, and show for each family the last good check, the latest attempt and what is published now. Label the list of recent failures across the country as a national list, not the place's own.
- Code: `lib/registry/coverage.ts:182`, `lib/registry/body-attempt-read.ts`, `lib/registry/server.ts`.
- Done when: live coverage for a body shows meeting attempts only under meetings.
- Retires: one blended attempt per body.


#### Release

**RL-04 · The full check runs once a day and on each river merge, not every three hours**
- Lane: Release · Depends on: RL-03
- Change: Build check runs the whole suite on `main` every three hours (`17 */3 * * *`). One run used about 37 runner-minutes (measured in the Oct 3 audit), so the schedule alone is about 300 minutes a day before any pull request runs. Every river pull request already gets the full check, so change the schedule to once a day and keep the event triggers. Update the cost note in `docs/ci-efficiency.md`.
- Code: `.github/workflows/build-check.yml:19-20`, `docs/ci-efficiency.md`.
- Done when: GitHub shows one scheduled full run a day, and every river pull request still gets the full check.
- Retires: the every-three-hours schedule.

**RL-05 · Every river merge gets its after-deploy check**
- Lane: Release · Depends on: RL-03
- Change: The after-deploy integrity check starts on a push to `main`. A merge made inside GitHub Actions with the built-in token does not start it, because GitHub suppresses workflows triggered by that token. After every river merge, start it directly with the merged commit (`workflow_dispatch`, input `sha`). A second start is harmless: its concurrency group cancels the older one.
- Code: `.github/workflows/post-deploy-integrity.yml:50-62`, `scripts/river.mjs`.
- Done when: every river merge on `main` has an after-deploy reading for its own commit.
- Retires: —

**RL-07 · A change that only touches documents runs only the tests that read them**
- Lane: Release · Depends on: RL-03
- Change: On Oct 3 a pull request that changed only `docs/rulings.md` ran 30 minutes of checks. Ten test files read that document, so the selection counted it as reaching tests, and that pulled in every test that sweeps whole folders of source. When a change touches only documents (`docs/`, `*.md`, `CLAUDE.md`, `AGENTS.md`), run lint and the tests that name those files, and skip the source sweeps and builds. Code changes keep today's selection.
- Code: `scripts/ci-affected-tests.mjs`, `scripts/ci-selection-summary.mjs`, the admission job in `.github/workflows/build-check.yml:119`, `scripts/ci-verdict.mjs`.
- Done when: a pull request that changes only a document finishes its checks in a few minutes, and the tests that read that document still run.
- Retires: full source sweeps for document-only changes.

### Stage 2

#### Admin

**BR-06 · A Settings view with a log and an Undo button**
- Lane: Admin · Depends on: BR-05, BR-01
- Change: One view lists every registered setting with its current value and when it changed, plus a log of earlier values read from the receipts. Undo sends the same action with the logged previous value. A change shows who made it only when the factory made it; Sean is the only person who changes settings. A "why" note is optional.
- Code: new `app/(admin)/_mw/admin-v6/screen-settings.tsx`, `context.tsx`, `view-param.ts`, `lib/control-plane/gateway/contract.ts`, `registry.ts`.
- Done when: in live Admin, changing the spend ceiling and pressing Undo restores the old value, and the log shows both entries with their times and values.
- Retires: undo as a sentence on receipts.

**BR-13 · Orders finish with "Done" and the before and after**
- Lane: Admin · Depends on: BR-12
- Change: Add structured `before` and `after` to the receipt effect, filled by config actions from values they already compute (previous ceiling, previous target, previous switch). For hunts and missions, store the place score at acceptance and show it next to the current score when the work list is exhausted or the order is stopped.
- Code: `lib/control-plane/gateway/contract.ts`, `registry.ts` (`ActionEffect`), `bulk-actions.ts`, `confirmation.ts`.
- Done when: in live Admin, a ceiling change shows "Done · $50 → $80" and a finished hunt shows its score before and after.
- Retires: before-values buried in prose.

**BR-14 · One queue board for everything in motion**
- Lane: Admin · Depends on: BR-01, BR-03, BR-12
- Change: Add a Queue view. Rows are orders (BR-01), hunts and missions, stuck cases, doors failing now, and fix-list items (BR-03). Each row shows what it is, a status chip, the owner, when it is due (finish-by or next round), the next step and a progress bar. Each row also carries its own stop or pause through the action that fits it: `expansion.scope.budget` or `remove` for hunts and missions, `fleet.cancelDispatch` for sends, `runner.pause` for the runner, and `orders.unschedule` for scheduled orders. Filters: needs me, in progress, scheduled, waiting, done. The old lists are deleted in BR-34.
- Code: new `app/(admin)/_mw/admin-v6/screen-queue.tsx`, `context.tsx`, `view-param.ts`, `lib/control-plane/admin-view/v6-stuck-read.ts`, `v6-reliability-read.ts`, `v6-sends-read.ts`, `lib/control-plane/fix-list.ts`.
- Done when: in live Admin, every order, hunt, stuck item, failing source and fix item appears exactly once under the right filter, and its stop or pause works from the row.
- Retires: —

**BR-18 · Plain-words orders through Ask Admin**
- Lane: Admin · Depends on: BR-07
- Change: Add router patterns for the orders Sean gives: "send agents to …", "start a mission in <place>", "set the budget to $N", "pause/resume …" and "take back …". Each reads back a sendable order and goes through the gateway after confirmation.
- Code: `lib/control-plane/operator-chat/router.ts:417-454`, `contract.ts`, `app/(admin)/_mw/admin-v6/actions.ts`.
- Done when: each example phrase typed into live Admin reads back a sendable order, and its receipt appears on the queue.
- Retires: —

**BR-20 · Decision cards that turn into orders**
- Lane: Admin · Depends on: BR-01, BR-15
- Change: A decision card holds what is happening, what the team recommends, what it costs, what it gets, and the exact gateway order it becomes (for example `config.setFleetSpendCeiling {rollingCeilingUsd: 120}`). Approve submits that order. Decline records why. Change edits the order's input. Schedule uses BR-15. Cards are raised only for the reasons in BR-09.
- Code: `lib/control-plane/decision-cards.ts`, `app/(admin)/_mw/admin-v6/actions.ts:287-312` (`decide`), `action-dialog.tsx`, `lib/control-plane/gateway/registry.ts:330` (`decision.record`).
- Done when: approving a "raise the daily budget" card in live Admin changes the ceiling, and the card shows on the queue as an order going from Received to Accepted.
- Retires: `/api/admin/decision` and the local decision sync for decisions.

**BR-38 · Admin shows each code change from built to live**
- Lane: Admin · Depends on: RL-05, CH-01
- Change: Add a Releases row to Admin's Workers view. Each river merge shows the steps it carried and six states, each with its time: built, tested, merged, deployed, runner on it, checked live. Built, tested and merged come from the river pull request; deployed and checked live from the after-deploy reading; runner on it from the heartbeat's commit (CH-01).
- Code: `lib/ops/runtime-release-handoff.ts`, the after-deploy reading store, the Workers read in `lib/control-plane/admin-view/`, the Workers screen in `app/(admin)/_mw/admin-v6/`.
- Done when: live Admin shows the latest river merge with all six states and the steps it carried.
- Retires: —


#### Coach & Hunters

**CH-11 · Producers that ran only for the original Send run for every Send by geography**
- Lane: Coach & Hunters · Depends on: CH-10
- Change: PRL is a national source, so it would run for every Send, but the code records it as a licensed archive "for the original authorized Send". Sean confirmed on Oct 3 that the licence covers every place, so PRL runs for every Send like any national source. The jurisdiction reference and voting-site producers apply by the Send's geography and door records, not one receipt. Delete the Cochise-only branch and the `--cochise-only` flag.
- Code: `lib/civic-data/manual-producer-invocation.ts:22,28-29,57-77`, `lib/civic-data/hunt-source-tasks.ts:6,14,30`.
- Done when: a Send in a place never worked before gets reference and voting-site work in live Admin (including PRL), with no code naming a single county or receipt.
- Retires: `originalOnly` branches, the Cochise special case, `COCHISE_VOTE_CENTERS_URL`.

**CH-24 · Hunters work continuously, not in slices**
- Lane: Coach & Hunters · Depends on: CH-06
- Change: Add a standing lease-worker lane in the parent runner that keeps pulling pending and reclaimable route tasks. The research round keeps planning and queueing (`runAutonomousCoordinator({ planOnly: true })`). The old 15-minute slice and wave loop are deleted in CH-27. Keep the old path behind a runner switch (an entry in the runner's environment file until DB-46's switches exist) until the new path is verified live, then remove the switch.
- Code: `scripts/freshness-shadow.mts:1978,3087-3098`, `scripts/pilot-runner.mts`, `lib/control-plane/workers/process-pool.ts`.
- Done when: live Admin shows workers active between research rounds, with no idle gap at round boundaries.
- Retires: —

**CH-26 · Each task reads only its own history**
- Lane: Coach & Hunters · Depends on: CH-06
- Change: Replace the whole-table reads in the standing runtime and the coordinator (all scout results, worker results, work items, occurrences, artifacts and attempts, and `artifacts.readAll()` inside a loop) with reads scoped to the item's subject, work item and lineage. Add indexed queries where missing. Rulings §5: nothing loads the whole country. Keep the old path behind a runner switch (an entry in the runner's environment file until DB-46's switches exist) until the new path is verified live, then remove the switch.
- Code: `lib/control-plane/workers/standing-runtime.ts:64-100`, `coordinator.ts:359,442-470`, `lib/control-plane/repository/pg-store.ts`, `pg-schema.ts` (indexes).
- Done when: live Admin shows repository calls per task staying flat as history grows.
- Retires: per-task full-history loads.

#### Box & Slide

**BX-02 · Builders take grounded findings straight from the Box**
- Lane: Box & Slide · Depends on: BX-01
- Change: Convert each grounded finding into a Parser-shaped extraction on the same work item, so the existing worker doors publish it with no separate Acquirer or Parser turn. A grounded finding is one whose exact quote is on the saved page and whose value is inside the quote. Each one is re-proved by `quotedSourceFindings` and checked with `section3Record`: right jurisdiction, source standing, freshness and the design §10 minimum. Detective results are Scout results, so this one path carries detective finds too. Pages are official only until CP-03 lets labeled non-official kinds through.
- Code: new `lib/control-plane/workers/scout-extraction.ts`, `lib/control-plane/workers/quoted-proof.ts`, `lib/control-plane/workers/detective.ts:318-335` (`scoutFactGrounded`), `lib/civic-data/worker-publication-tasks.ts`, `lib/control-plane/promotion/section3.ts`.
- Done when: a hunter's finding of a board member's email from the body's official page appears on the live card within one pass, with its source in Sources.
- Retires: the separate detective-to-publication path once proposed (one builder path only); Scout findings that stop at SCOUTED.

**BX-03 · Publish as soon as a parser result lands**
- Lane: Box & Slide · Depends on: BX-12
- Change: Worker publication waits for the next five-minute pass, and roster and directory reads wait up to an hour. When a parser result is written, file a "publish now" request for that work item. The publish-now lane (BX-12) runs it on its next run. Requests are not one at a time and do not expire like `routineDueRequest`.
- Code: `lib/civic-data/worker-publication-tasks.ts:19-52`, the worker result handler, the BX-12 lane.
- Done when: live Admin shows a parser result's records reaching the reader projection on the publish-now lane's next run after the result, by the reader readback time.
- Retires: the pass-boundary wait for worker publication.

**BX-09 · Venue pins publish on their own**
- Lane: Box & Slide · Depends on: BX-08
- Change: Make `venue-resolutions` a routine contract built from automatic matches and published addresses, with `reviewedBy` set by the §3 validator. Accepted matches are written into its pointer and no longer need hand review.
- Code: `lib/civic-data/manual-contracts.ts`, `manual-producer-invocation.ts`, `lib/civic-data/contracts.ts`, `source-authority.ts:621-694`, `lib/meetings/automatic-venue-resolutions.ts`.
- Done when: live Admin shows `venue-resolutions` promoting on its own cadence, and pins no person reviewed appear on the live map at the proof bar (see the rule above).
- Retires: `REVIEWED_INPUT` mode for `venue-resolutions`.

#### Checkers & Publishing

**CP-03 · Labeled non-official sources reach publication**
- Lane: Checkers & Publishing · Depends on: CP-02
- Change: Drop the official-only filter when reading held pages for publication. Set `sourceClass` on the source receipt from the kind, adding `FILING`, `NEWS`, `VOTER_GUIDE` and `FORUM` to `MANUAL_SOURCE_CLASSES`.
- Code: `lib/civic-data/worker-publication-evidence.ts:29,54,105,129-131`, `lib/civic-data/types.ts:136`.
- Done when: a fact found only in a county voter guide is live on the person's card with its source.
- Retires: the `isOfficialSource` filters in `heldPageCopies` and `capturesForPublication`.

**CP-07 · Newer and more official wins, and the conflict is kept**
- Lane: Checkers & Publishing · Depends on: CP-02
- Change: When a field changes value from a different source, keep the higher kind: official, then filing, then campaign (about itself), then voter guide, then news. Between two official sources, the newer one wins and goes live at once (Sean, Oct 3). On any other tie, keep the newer read. Write the losing value as an excluded fact with code `CONFLICT_SUPERSEDED`, which the receipt already stores. The disputed fact never waits.
- Code: `lib/civic-data/manual-successor.ts` (`prepareManualProjectionSuccessor`), `worker-reader-publication.ts:174`, `election-field-publication.ts:90`.
- Done when: an official phone replaces a news-sourced phone on the live card, a newer official value replaces an older official one, and each receipt shows the superseded value.
- Retires: —

**CP-12 · The campaign-site second signal is dropped**
- Lane: Checkers & Publishing · Depends on: CP-11
- Change: Design §10 and §6.6: the campaign site's own page naming the candidate, the office and the cycle is enough to tie it to the candidacy, and auditors sample afterward (DP-13). Nothing waits on a second source. Remove the "one independent second signal" requirement and `AUDITED` from the publishable approval.
- Code: `lib/control-plane/promotion/campaign-site-chain.ts`, `lib/civic-data/derived-campaign-site-writer.ts:150`.
- Done when: newly found campaign sites that name their candidate, office and cycle are live on the next pass with no second signal, at the proof bar (see the rule above).
- Retires: the campaign-site "independent second signal" requirement.

**CP-14 · The activation gate is gone**
- Lane: Checkers & Publishing · Depends on: CP-13
- Change: Delete `ACTIVATION_GATE`, `classFieldOpen` and every caller: the campaign-site publication and chain, the promotion tail, the Admin "implemented research routes" line, and the receipt bases.
- Code: `lib/control-plane/promotion/activation-policy.ts`, `activation-gate.ts:19-66`, `campaign-site-publication.ts:118`, `campaign-site-chain.ts:654`, `lib/control-plane/scheduler/promotion-tail.ts:62,622,645`, `fleet-delivery.ts:158`, `historical-receipt.ts:12`.
- Done when: campaign and candidate facts keep publishing on the live site, and Admin no longer shows the routes line.
- Retires: `ACTIVATION_GATE`, `classFieldOpen`, the `RECORD_CLASS_CANDIDATE` burden.

#### Doors & Bank

**DB-03 · Legistar, Legistar InSite and calendar feeds hold 120 days**
- Lane: Doors & Bank · Depends on: DB-02
- Change: Point these adapters' `WINDOW_*_DAYS` at the held window.
- Code: `lib/sources/legistar/index.ts:138-150`, `lib/sources/legistar-insite/`, `lib/sources/ical/index.ts:105-106`.
- Done when: bodies on each of these kinds hold sittings 91 to 120 days out on their live partitions, and those sittings appear on the map the day they cross 90 with no new read, at the proof bar (see the rule above).
- Retires: the "fetch window IS the served window" rule in these adapters.

**DB-04 · Diligent, BoardBook, CivicClerk, CivicPlus and IQM2 hold 120 days**
- Lane: Doors & Bank · Depends on: DB-02
- Change: Same change for these adapters.
- Code: `lib/sources/diligent/`, `boardbook/`, `civicclerk/`, `civicplus/`, `iqm2/`.
- Done when: same check as DB-03, for each kind, at the proof bar (see the rule above).
- Retires: the same rule in these adapters.

**DB-05 · Every other meeting adapter holds 120 days**
- Lane: Doors & Bank · Depends on: DB-02
- Change: Same change for schedule-page, document-listing, official-page-events, OnBase, Revize, SuiteOne, Apptegy, ClerksBoards, PIMA_EDU and the TUSD reader. The last three are generalized or removed in DB-18 and DB-19.
- Code: the matching `lib/sources/*` adapters.
- Done when: same check as DB-03, for each kind, at the proof bar (see the rule above).
- Retires: the last copies of the rule.

**DB-07 · Outcomes are kept past the window**
- Lane: Doors & Bank · Depends on: DB-06
- Change: Extend the existing outcome store so records past the rolling window stay, instead of starting a new store.
- Code: `lib/outcomes/store.ts`, `window.ts`, `publication.ts`, `types.ts:480`.
- Done when: live Admin shows held outcomes older than the window still published.
- Retires: the one-county frozen-union special case (`TrustedLkgPimaOutcomeUnionEvidence`) once the general rule holds.

**DB-10 · The registry is seeded from today's meeting doors**
- Lane: Doors & Bank · Depends on: DB-09
- Change: Import every `SOURCE_WIRING` row (including the 27 Tucson routes) plus the active and suspended derived rows once. Door IDs follow how partitions really work: a hand-wired door is (meeting source, body), which is today's partition ID (`meetings:<source>:<bodyId>`); one wiring row can produce several sources and so several doors (`meetingSourceNamesForWiring`). A derived member's door ID is its derived wiring row ID, and it stays a member of its state's family partition (`meetings:derived:<state>`). Pointers and last-known-good data are kept.
- Code: a one-time import script, `lib/registry/source-wiring.ts`, `lib/civic-data/derived-meeting-wiring.ts`.
- Done when: live Admin lists every door feeding meetings, by name, kind and body, and every derived member still shows its last verified sittings on the live map.
- Retires: —

**DB-11 · Non-meeting feeds are doors too**
- Lane: Doors & Bank · Depends on: DB-09
- Change: Add records for the non-meeting feeds: the daily automatic refresh tasks (voting sites, state money for three states, one county's local money, member offices) and the routine source contracts (FEC, state legislators and roll calls, Census, registration, outcomes, the one-county filing feed). Each gets a kind, a key reference, `holds` and `checkEvery`.
- Code: `lib/civic-data/automatic-refresh.ts:4-10`, `lib/civic-data/contracts.ts`, `lib/doors/registry.ts`.
- Done when: live Admin's door list includes every non-meeting feed with its last read.
- Retires: —

**DB-17 · Any adapter kind can be added as a data row**
- Lane: Doors & Bank · Depends on: DB-09
- Change: Extend the derived wiring kinds and crosswalk kinds to every adapter kind in `composite/wiring.ts`: CivicPlus (via its calendar), BoardBook, CivicClerk, IQM2, Revize, Apptegy, OnBase, SuiteOne, schedule page, document listing and Legistar InSite. Each declares its config keys. Add `readDerivedFamilyMember` support for each.
- Code: `lib/civic-data/derived-meeting-wiring.ts:43-51`, `lib/sources/composite/wiring.ts`, `scripts/ingest.ts:733-890`.
- Done when: bodies on each newly added kind show meetings on the live map after their door rows are saved, at the proof bar (see the rule above).
- Retires: the four-kind limit on data doors.

**DB-25 · Each check looks before it reads**
- Lane: Doors & Bank · Depends on: DB-09
- Change: Before each scheduled read (hourly inside the 7-day window, twice daily otherwise, as rulings §4 sets), make one cheap first look per door kind: a conditional request (stored ETag or Last-Modified) or a hash of the listing page or feed bytes. It reads nothing more when nothing changed, which keeps small governments well under ten requests an hour. Probes are keyed by door, so one probe covers every body behind one feed. There is no AI cost.
- Code: `lib/sources/composite/` (probe per kind), `lib/doors/registry.ts` (stored validators).
- Done when: in a controlled run on a feed never served to readers, a change triggers a full read on the next probe and no change makes no extra requests; on the live runner, Admin's door list shows first looks running with no AI cost.
- Retires: —

**DB-39 · The Bank moves to one row per entry (only if writes are failing)**
- Lane: Doors & Bank · Depends on: DB-38
- Change: Do this when the DB-38 count is not zero. Move the field manual from one JSON row rewritten on every write to a table with one row per entry, indexed by kind, states, platforms, record classes and outcome. Keep the read and write signatures, and push filtering into SQL.
- Code: `lib/control-plane/field-manual.ts:244,332-350`, `lib/control-plane/repository/pg-schema.ts`, `pg-store.ts:1174-1177`.
- Done when: live Admin's Bank write-error count stays at 0, and hunters' briefs are unchanged.
- Retires: the single `cp_field_manual/live` document.

**DB-43 · Playbooks, part 2: every other role reads a playbook**
- Lane: Doors & Bank · Depends on: DB-42
- Change: Move the parser, validator, auditor and engineer instructions into `PLAYBOOK` entries with the same safety frame. The translator writes its own playbook entry in CA-25, and audit sampling is a setting (DP-17), not a playbook line.
- Code: `lib/control-plane/workers/model-parser.ts:74`, `model-audit.ts:19`, `promotion/validator-manual.ts`, `workers/engineering-adapter.ts`.
- Done when: a changed parser playbook line appears in the next live parser request.
- Retires: role instructions as TypeScript strings.

**DB-46 · Switches that need no release**
- Lane: Doors & Bank · Depends on: BR-05
- Change: Add `features` to the settings store with `readFeature(name, default)`: the runner reads it each pass, and reader-side switches reach pages through the reader-edge settings publication (BR-05), not a database read per request. Move the five ripcords onto it; the environment variable stays as an emergency override. New risky changes ship behind a named feature.
- Code: `lib/ripcords.ts:33-134`, `lib/control-plane/settings.ts`, `docs/ripcords.md`.
- Done when: flipping a ripcord in live Admin takes effect on the live site without a deploy.
- Retires: environment variable plus redeploy as the normal way to switch.

**DB-51 · Dead links are found before readers find them**
- Lane: Doors & Bank · Depends on: DB-09
- Change: A plain-code sweep visits every outbound link in the published reader edge (sources, official sites, join links, agenda PDFs). It honours Retry-After and the small-publisher pacing in rulings §2, and records status per link beside door health.
- Code: new `lib/doors/link-sweep.ts`, `lib/civic-data/reader-edge-publication.ts` (manifest read).
- Done when: live Admin shows counts of dead links by surface.
- Retires: —

**DB-53 · New code loads without stopping the factory**
- Lane: Doors & Bank · Depends on: DB-48
- Change: Switch which checkout new children start from once the new release is installed. Restart the parent only when its own code changed. Contract migrations stay at the switch point; children already running finish on the old code. Remove the drain-everything step and DB-48's switch once verified live.
- Code: `scripts/pilot-runner.mts:1262-1281,1935-1944`, `lib/ops/runtime-release-handoff.ts`, `deploy/runner/`.
- Done when: a release lands with no gap in partition admissions in the runner log shown in live Admin.
- Retires: drain-everything-then-restart.

**DB-57 · A repair agent gets only the broken part**
- Lane: Doors & Bank · Depends on: DB-49
- Change: Design §16.5. When the engineer worker repairs a door kind, give it only that kind's adapter folder, the failing example (the saved page bytes and the failure) and that kind's own tests (DB-49), and limit what it can write to that folder.
- Code: `lib/control-plane/workers/engineering-adapter.ts`, `lib/sources/platform-adapters/`, `scripts/ci-affected-tests.mjs`.
- Done when: the next engineer repair on the live system shows on GitHub as a pull request touching only one adapter folder, checked by that kind's tests alone.
- Retires: —

#### Detectives & Proving

**DP-06 · Dead ends say what would unlock them**
- Lane: Detectives & Proving · Depends on: DP-04
- Change: Add `unlockWhen` to the absence record: a text plus typed triggers (new adapter for platform X, new tool, new route for record class Y, a date). It is filled from the detective's next steps and dead-end narrative.
- Code: `lib/control-plane/scheduler/durable.ts` (`recordArguedAbsence`), `scheduler/absence.ts`, `lib/control-plane/admin-view/dead-ends.ts`.
- Done when: a dead-end box in live Admin shows "would unlock: …" from stored data.
- Retires: unlock text derived on the fly.

**DP-14 · Red flags are fixed or pulled at once, and the lesson is kept**
- Lane: Detectives & Proving · Depends on: DP-13, BR-03, DP-15
- Change: On a red flag:
  - write a pull or correction through the existing publication path;
  - reopen the owning work item;
  - add a fix-list item;
  - write an audit lesson that carries the platform, so it applies to every door of that kind.
- Code: `lib/control-plane/workers/live-audit.ts`, `lib/civic-data/worker-publication-evidence.ts:167-180`, `workers/audit-sampling.ts:232-265`, `lib/control-plane/fix-list.ts`.
- Done when: the first real red flag the live auditor finds is corrected or pulled from the live page within one pass, and the Bank shows the lesson (proved first in a controlled run on a projection never served to readers).
- Retires: —

**DP-16 · Auditors look harder where it matters**
- Lane: Detectives & Proving · Depends on: DP-13
- Change: Add three sampling boosts in the live sampler, then in `sampleDecision`: reader demand rank, single-source facts, and facts past their refresh date.
- Code: `lib/control-plane/workers/live-audit.ts`, `workers/audit-sampling.ts:127-140`, `lib/control-plane/reader-demand.ts`, `promotion/fact-freshness.ts`.
- Done when: live Admin's audit card splits the sample by reason.
- Retires: —

**DP-18 · Audit accuracy on the Scoreboard**
- Lane: Detectives & Proving · Depends on: DP-13, BR-23
- Change: Compute weekly `{audited, still right, fixed, pulled}` with the list of fixed facts. Add the Scoreboard row: "Of N facts audited this week, X% are still accurate. Here are the K we fixed." Show the counts, and "—" when nothing was audited. Fold the old coverage report into it as a second line.
- Code: new `lib/control-plane/admin-view/v6-audit-read.ts`, `scoreboard-read.ts`, `workers/audit-sampling.ts:196-224`.
- Done when: the live Scoreboard shows the row with a real N.
- Retires: `auditCoverageReport` as an uncalled function.

**DP-19 · A fix map table**
- Lane: Detectives & Proving · Depends on: DP-07
- Change: Add a fix map: one row per method and place, with state (works, fails or untried), last tried time, attempt and cause. It is read scoped to the asking place, never loaded whole.
- Code: `lib/control-plane/repository/pg-schema.ts` (expand migration, applied automatically), `types.ts`, `pg-store.ts`, new `lib/method/fix-map.ts`.
- Done when: the table exists in production and live Admin can read one method's map.
- Retires: —

#### Collects & Ask

**CA-02 · Open States fills a legislator seat when the own-page check fails**
- Lane: Collects & Ask · Depends on: CA-01, CP-02
- Change: In the national place publisher, when a legislator's own official page fails the seat-word check, publish the Open States row (name and seat checked on the saved CSV) to the same seat, with Open States as a Reference source. An official roster value replaces it later.
- Code: `lib/civic-data/worker-national-publication.ts:13-15,62`, `lib/sources/plural/place.ts:128-158`.
- Done when: in a Send state where a legislator's page fails the check, the member still shows on the live site with an Open States Sources row.
- Retires: —

**CA-04 · The social platform list is a setting, with six pills**
- Lane: Collects & Ask · Depends on: BR-05
- Change: Store a platform list in settings: id, label, URL patterns, profile URL template and icon key. It defaults to Facebook, X, Instagram, YouTube, LinkedIn and TikTok; Mastodon stays only if Sean keeps it. `SocialAccounts` becomes a list of `{platform, url, accountKind: OFFICIAL | CAMPAIGN | PERSONAL_PUBLIC, sourceUrl, collectedAt}`. Pills map over the list. Add LinkedIn and TikTok marks. The coverage matrix reads the same list.
- Code: `lib/officials/types.ts:101-134`, `components/officials/contact-pills.tsx:120-130,301-360`, `channel-marks.tsx`, new `lib/officials/social-platforms.ts`, `lib/officials/federal-directory-data-plane.ts:43`, `lib/hunt/coverage-matrix.ts:257`.
- Done when: a person with a LinkedIn URL shows the pill on the live site at phone width, and a seventh platform added in Admin shows its pill with no deploy.
- Retires: the hard-coded platform lists; "never backfilled from a campaign account".

**CA-07 · Offices near you, for people**
- Lane: Collects & Ask · Depends on: CP-02
- Change: Add one office-location fact: `{ownerId, kind: DISTRICT_OFFICE | CAPITOL_OFFICE | CAMPAIGN_OFFICE | BODY_OFFICE | MEETING_PLACE, address, hours?, sourceUrl}`. Generalize member offices into it, fed from federal directory offices, Open States offices, roster pages and campaign sites. Accept only an address the page presents as an office. A campaign address counts only when the page labels it an office or headquarters, and never when it equals the candidate's filed mailing address (small campaigns often list a home as the contact address). Ask contact answers include address and hours.
- Code: new `lib/officials/office-locations.ts`, `lib/officials/member-offices.ts`, `lib/ask/contacts.ts`.
- Done when: Ask on the live site, asked where a school district office is, returns its address and hours with the source in the answer's Sources.
- Retires: member offices as a separate legislator-only shape.

**CA-08 · Candidate portraits come from the campaign's own page, with no release**
- Lane: Collects & Ask · Depends on: CP-10
- Change: Route candidate portraits through `storeVerifiedPortrait` with an `OWN_PAGE` basis from the verified campaign site, and bind them on the candidate profile. Widen the stored key prefix and the read-time path check to cover candidates.
- Code: `lib/photos/store.ts:23-24`, `lib/photos/evidence.ts:65-81`, `lib/civic-data/derived-campaign-sites.ts`, `lib/ballot/candidate-cards.ts`, `lib/ballot/photo-order.ts`.
- Done when: candidates show photos from their own campaign sites with a Sources row on the live ballot, at the proof bar (see the rule above), and no commit touches `public/`.
- Retires: candidate portraits as committed files (`public/candidates/`).

**CA-10 · One list of ten stance topics, as a setting**
- Lane: Collects & Ask · Depends on: BR-05
- Change: Store the ten topics (housing, water, schools, taxes, immigration, health care, public safety, jobs, environment, transportation), each with its search phrases, as a setting. Both the person card and the ballot card read it through the reader-edge settings publication (BR-05).
- Code: `lib/corpus/positions.ts:341-352`, `lib/candidates/issues.ts:50-181`, `lib/candidates/positions.ts:81-86`, `components/ballot/candidate-positions.tsx`, `lib/ask/server-sources.ts:11`.
- Done when: the ballot card and the official card on the live site show the same ten plain nouns.
- Retires: `CANDIDATE_ISSUES` with its framed labels and four extra issues.

**CA-15 · A statement sweep for every person, from what we already hold**
- Lane: Collects & Ask · Depends on: CA-09
- Change: Each official and candidate gets a standing "statements" blank. The sweep reads held captures first: roster and profile pages, campaign sites, minutes, filings and financial disclosure statements, voter guides. A page counts for a person only when it is theirs or quotes them by name. A sweep record per person and topic says which sources were searched, so "No public statement found" can be shown only after an equal-effort sweep.
- Code: new `lib/corpus/statement-sweep.ts`, `lib/corpus/unified.ts`.
- Done when: live Admin shows a sweep record for each person in a sent place, listing sources searched per topic.
- Retires: —

**CA-25 · The translator, part 1: measures and their parts**
- Lane: Collects & Ask · Depends on: CA-24, DB-42
- Change: Add one translator worker:
  - a writer model rewrites the official text in high-school English, describing and never judging, only from the source, with every statement traceable to it;
  - a checker model compares the result to the original, sentence by sentence;
  - on a pass, the measure record is written through the normal Slide;
  - a multi-part measure is split only on the official numbering, each part labeled by kind (funding, what it pays for, oversight, start, end or renewal);
  - when the source's hash changes, the record is rewritten.

  The model choice and the playbook text are data, and spending runs under the budget dial.
- Code: new `lib/translate/worker.ts`, `lib/translate/records.ts`, its own translator `PLAYBOOK` entry read by the DB-42 loader, a routine contract `plain-english-translations` in `lib/civic-data/contracts.ts`.
- Done when: measures show their plain-English summary, YES and NO meaning and parts on the live site, written and checked with no person involved, at the proof bar (see the rule above).
- Retires: hand-written measure parts (finished in CA-29).

**CA-30 · YES and NO each get their own line**
- Lane: Collects & Ask · Depends on: CA-24
- Change: Render `yesMeans` and `noMeans` as their own lines on the measure card and in Ask's measure answers.
- Code: `app/ballot/page.tsx`, `lib/ask/server-sources.ts`, the measure card components.
- Done when: Ask on the live site, asked what a NO vote means on a held measure, quotes the stored NO meaning with its source.
- Retires: YES and NO meaning buried in summary prose.

**CA-32 · The ballot page and Ask read the general ballot**
- Lane: Collects & Ask · Depends on: CA-31
- Change: Make the ballot page and Ask read the generic ballot projection. Fold the per-state ballot sources into it: the two reviewed-input ballot contracts become the contests door, and the one-county filing feed becomes a filing door kind.
- Code: `lib/ballot/registry.ts:20-28`, `app/ballot/page.tsx`, `lib/ask/ballot-summary.ts`, `ballot-inventory.ts`, `lib/control-plane/scheduler/providers/candidate-enrichment.ts:132,534-546`, `lib/civic-data/manual-contracts.ts`.
- Done when: a place with no hand-built ballot shows its contests and candidates on the live ballot page and in Ask.
- Retires: `BALLOT_SOURCES`, `az-sos-ballot`, `nh-curated-ballot`, `BALLOT_AUTHORITY_STATES`, `nj-morris-filing` as a one-county contract.

**CA-33 · A ballot measures door for any place**
- Lane: Collects & Ask · Depends on: CA-31, CA-24, CP-09
- Change: Add a `ballot-measures` worker door. It checks the measure's minimum (election, number or title, a link to the official text, source) and writes measure records into the generic ballot, with the verbatim question when found.
- Code: `lib/civic-data/worker-reader-contracts.ts`, `lib/ballot/measure-records.ts`.
- Done when: local measures in sent places show on the live ballot with their official text links, at the proof bar (see the rule above).
- Retires: measures only inside hand-built ballot sets.

**CA-37 · Things that fit no shape still go up**
- Lane: Collects & Ask · Depends on: BR-24
- Change: Add a `PUBLIC_RECORD` class: `{id, place or body, kindLabel as the source words it, title, sourceUrl, capturedAt, sourceSentence}`. It publishes when a title and kind are on a saved page about the jurisdiction. The first time a `kindLabel` appears, Admin gets one "new kind found" update.
- Code: `lib/civic-data/types.ts:13-40`, `lib/civic-data/contracts.ts`, the update feed.
- Done when: a hunter's find of a kind with no shape appears as a plain record on the live place page with its source, and Admin shows "new kind found".
- Retires: —

**CA-45 · Money reports what filings say, plus the small-donor share**
- Lane: Collects & Ask · Depends on: CA-44
- Change: Design §9.3: the factory reports what the filings say and does not characterize it. Drop the computed share sentences ("the single biggest accounts for X%", in-state share as a percent). Keep the aggregates that are how individual donors appear under today's donor rule (`lib/funding/donor-privacy.ts`): totals, in-state and out-of-state amounts in dollars, and the FEC's own split between organizations and individuals, all as reported figures. Individual donors are never named. Add one share, by Sean's decision: how much of a person's individual money came from donors giving $200 or less in the cycle, from the filing's own unitemized and itemized individual lines, in dollars and as a percent (for example "62% of individual money came from donors giving $200 or less"). The filings report small donors' money as a total, not a count, so the share is of dollars. For state and local races it shows only where the filings report the same split.
- Code: `lib/funding/concentration.ts:212-264`, `components/funding/funding-section.tsx:164-230`, `lib/funding/display.ts:121-131`.
- Done when: the live money section shows amounts and the filings' own categories in dollars, and the small-donor share for federal candidates, with no other percentage or interpretive sentence.
- Retires: computed share sentences.

#### Front-end

**FE-02 · Worst-case speed is measured on production, phone and desktop**
- Lane: Front-end · Depends on: FE-01
- Change: The measurement:
  - judges the worst run, not the median, and counts unfinished runs as failures;
  - covers every surface in the resident-task set plus the design §11 Ask questions;
  - uses ZIPs sampled from the published places;
  - uses phone (390 by 844) and desktop profiles.

  It runs on the runner host by the pattern of `served-reader-production.ts`, and writes to the control-plane store Admin reads.
- Code: `scripts/measure-load.mts:47-49,234-240`, `lib/control-plane/served-reader-production.ts`, a new runner lane entry.
- Done when: live Admin shows, for each surface and sampled ZIP, worst-case PASS or FAIL against three seconds, including Ask.
- Retires: the median verdict.

**FE-08 · Map and popup components use the tokens**
- Lane: Front-end · Depends on: FE-06, FE-07
- Change: Convert hand-typed sizes, spacing and hex colours in map and popup components to the tokens and type-rung classes. Brand colours stay.
- Code: `components/map/**`, `components/calendar/calendar-marks.tsx`.
- Done when: those surfaces look the same or better on the live site at 390 and 1280 pixels wide, and the guard baseline shrinks.
- Retires: those literals.

**FE-09 · Ballot and Ask components use the tokens**
- Lane: Front-end · Depends on: FE-06, FE-07
- Change: The same conversion for ballot and Ask components.
- Code: `components/ballot/**` (including `picks-card.tsx`), `components/ask/**` (including `ask-box.tsx`).
- Done when: same check as FE-08 for those surfaces.
- Retires: those literals.

**FE-10 · One finished Card with a Sources section built in**
- Lane: Front-end · Depends on: FE-07
- Change: Add `components/ui/card.tsx`: frame, eyebrow, close, sections and a required `sources` slot that always renders the Sources section through `CardSourcesList`. It is built only from tokens, and its frame uses the existing Lumen glass material tokens (`--lumen-peak`, `--lumen-rim` and the rest in `app/globals.css`) for the design's glass-like polish.
- Code: new `components/ui/card.tsx`, `components/officials/card-section.tsx`, `card-sources-list.tsx`.
- Done when: the Card renders on a live page with its Sources section.
- Retires: —

**FE-18 · Resident tasks run on the live site**
- Lane: Front-end · Depends on: FE-01, FE-16, FE-17
- Change: Add a runner that drives each task at sampled ZIPs on phone and desktop. It records taps, time from action to usable result (worst case), dead ends and a screenshot at each step, and runs the page measurements on every screen. When a mission's place first publishes, its ZIPs are queued for a run. Screenshots are stored in the Netlify blob store the site already uses for portraits (`lib/photos/store.ts`), so no new storage service is added.
- Code: new `scripts/resident-tasks.mts` (on the runner host by the `served-reader-production.ts` pattern), `scripts/browser.mts` (`launchGuarded`, `decodePng`), `lib/health/page-metrics.ts`.
- Done when: a run at a ZIP never in the pilot list produces a step-by-step screenshot strip and a pass or fail per task in Admin.
- Retires: walk ZIPs fixed to four places (`scripts/walk-all.mts:179-185`).

**FE-20 · A look reviewer separate from the builder**
- Lane: Front-end · Depends on: FE-19
- Change: Add a reviewer that receives only screenshots, the task text and the look standard. Its function signature enforces this: no checklist, data counts, page text dumps or session notes. Per screen it answers the five §6.11 questions in one line each (beautiful? easy? instant? come back? show a friend?) and gives red or green naming the element. Spending runs under the budget dial.
- Code: new `lib/frontend/look-review.ts`.
- Done when: a fixture page never served to readers (a 9px label, a cramped card) gets a red flag from the reviewer while every data check on it passes.
- Retires: —

**FE-30 · The same three states on the ballot, officials and money; disclaimers deleted**
- Lane: Front-end · Depends on: FE-29
- Change: Route every remaining not-covered literal through `WorkingOnIt`, including the battlecard `emptyLine` strings and the literals in the money and key-vote sections. Delete the ballot disclaimers, including the hard-coded list of covered counties.
- Code: `lib/ballot/battlecard-sections.ts:104-130`, `app/ballot/page.tsx:882,1915,1924,1930-1933,3029`, `components/funding/state-money-section.tsx:237`, `funding-block.tsx:26`, `components/officials/key-votes-section.tsx:350`, `public-statements-profile.tsx:63-64`, `components/map/voting-sites-panel.tsx:219`, `lib/corpus/unified.ts:32`, `lib/candidates/corpus.ts:451`.
- Done when: the live ballot at a ZIP outside the old pilot counties shows no county list, and every empty section shows one of the three states.
- Retires: the alternative sentences and disclaimers listed.

**FE-32 · Reader labels and help text are settings**
- Lane: Front-end · Depends on: BR-05, FE-29
- Change: Read reader labels and help sentences through `copy("key")` from the reader-edge settings publication (BR-05), with code defaults. Start with the empty-state sentences.
- Code: new `lib/design/copy.ts`, `components/demand/working-on-it.tsx`, `lib/routing/ask-pill-labels.ts`.
- Done when: a label edited in live Admin changes on the live site without a deploy.
- Retires: reader copy as code only.

**FE-34 · Online-only meetings get a pin at the body's address**
- Lane: Front-end · Depends on: CA-06, BX-08
- Change: Give an online-only meeting a venue at its body's published office address, with `kind: ONLINE_ONLY`. A meeting with no recorded place still gets no pin. Render a distinct "Online only" marker, using the existing `--online` token, with the join link as the main action. Rewrite the rule in `online.ts`, and replace walk check `[g10]` with "every online-only meeting with a published body address has an online-only pin with its join link".
- Code: `lib/meetings/venues.ts:27-43`, `lib/meetings/online.ts:39-44`, `components/map/map-canvas.tsx`, the meeting popup, `components/map/list-overlay.tsx`, `docs/walk-checks.txt:225`.
- Done when: bodies that meet only online show pins marked "Online only" with working join links on the live map, at the proof bar (see the rule above).
- Retires: the "online sittings are never pinned" rule and walk check `[g10]`.

**FE-41 · Officials and shell components use the tokens**
- Lane: Front-end · Depends on: FE-06, FE-07
- Change: The same conversion for officials and shell components.
- Code: `components/officials/**`, `components/shell/**`.
- Done when: those surfaces look the same or better on the live site at 390 and 1280 pixels wide, and the guard baseline shrinks.
- Retires: the remaining literals.

**FE-45 · Nearby meetings are labeled nearby, and the place's own governments are counted apart**
- Lane: Front-end · Depends on: FE-29
- Change: When too few meetings are close by, the meetings search widens to 60 and then 150 km (`RADIUS_LADDER_KM`). In the Oct 3 audit one ZIP got 111 upcoming meetings this way, none from the governments that serve it, and nothing said so.
  - Mark widened results as nearby, not the reader's own.
  - For each government that serves the place, say whether its upcoming meetings are held, apart from the nearby results, using the "working on it" state when they are not.
  - Keep "meeting scheduled" separate from "agenda posted", so a missing agenda never hides the meeting.
- Code: `lib/meetings/constants.ts:13`, `app/api/meetings/route.ts`, `components/map/coverage-notice.tsx`, `components/map/meeting-panel.tsx`.
- Done when: at the proof bar, a place whose own governments have no held upcoming meetings shows each of them as "working on it", and widened results are labeled nearby.
- Retires: —


#### Scorecard

**SC-02 · The overlay carries units, triggers, due dates and squads**
- Lane: Scorecard · Depends on: SC-01
- Change: Add to each checklist ID in the overlay:
  - `unit`;
  - `trigger` (an unknown trigger means applicability is unresolved, never dropped);
  - `due`;
  - `squad`, a setting whose starting value gives families the design doesn't assign as: geography, reference definitions, government finance and public participation with governments and meetings; executive actions and public-statement profiles with people and money; measures with the ballot;
  - `scoreAs` (core, extension, answer, operations, delivery or gate);
  - `predicateKind`;
  - family names.

  Also: map REF to body and government units. Collapse shared predicates by `canonicalPredicate` so a fact is never counted twice (for example MTG-20 into MTG-17). Keep summary items out of the denominator where residuals exist. Record GATE-01 and GATE-13 as replaced by Admin.
- Code: `lib/coverage/checklist-map.json`, `checklist-map.ts`, `lib/coverage/place-owed.ts`.
- Done when: the live checklist card shows REF rows and shows shared items counted once.
- Retires: —

#### Release

**RL-06 · The river runs on its own**
- Lane: Release · Depends on: RL-03, RL-05
- Change:
  - Run `scripts/river.mjs` a couple of times a day as a scheduled cloud session on Sean's account. Its schedule is the cadence and shows in Sean's list of scheduled tasks.
  - The runner's adapter engineer pushes `stream/adapter-<door kind>` branches instead of opening and merging its own pull requests. The river takes them like any other stream.
  - A stream that fails the river's checks goes on the fix list (BR-03) with the failure, owned by the lane that wrote it.
- Code: `scripts/river.mjs`, `.github/workflows/engineer-adapter-merge.yml`, `scripts/merge-engineer-adapters.mjs`, `lib/control-plane/workers/engineering-adapter.ts`, `lib/control-plane/fix-list.ts`.
- Done when: two river merges in one day happen with no session started by hand, and an adapter repair made by the runner reaches `main` through the river.
- Retires: the one-at-a-time adapter merges in `engineer-adapter-merge.yml`.

### Stage 3

#### Admin

**BR-16 · Scheduled orders fire on time, even if a round hangs**
- Lane: Admin · Depends on: BR-15, BR-13, BR-37
- Change: Submit each due scheduled order through the same gateway `submit()` as Sean who set it, on the always-running timer from BR-37, and record the child receipt. An "after X" order fires on X's Done state. A hung research round or a release handoff never delays or doubles it.
- Code: `scripts/pilot-runner.mts` (BR-37 timer), `lib/control-plane/gateway/gateway.ts:116`, `scheduled-orders.ts`.
- Done when: an order scheduled in live Admin fires at its time with Sean's PC off and moves to Accepted; an "after" order fires when the first one shows Done.
- Retires: —

**BR-22 · Shift focus by kind of information**
- Lane: Admin · Depends on: SC-02
- Change: Connect the existing "Put waiting work here first" button, which shows "Not connected yet" (`actions.ts:559-574`), to `fleet.deployHere`, and add `kind: {family?, divisionType?}` to it. Families come from the overlay (SC-02); division types (school district, special district, county, city) come from held divisions. The runner filters dispatch on both, so "school boards in this district, then candidates" can be expressed.
- Code: `lib/control-plane/gateway/registry.ts:510` (`fleet.deployHere`), `contract.ts`, `scripts/freshness-shadow.mts` (dispatch handling), `app/(admin)/_mw/admin-v6/actions.ts`.
- Done when: "send agents to school boards in <district>" in live Admin moves only school-district work first, and the order's runner note counts it.
- Retires: `PLACE_GROUP_NAMES` as a focus list.

**BR-25 · Now shows the few things that matter**
- Lane: Admin · Depends on: BR-14, BR-23, BR-24
- Change: Rebuild Now around four things:
  - Needs me (count);
  - orders in motion (top five from the queue);
  - the selected place's mission progress with counts;
  - facts live per hour and cost per fact, with their trend ("—" until BR-31).

  The latest updates sit under them. Every number gets one plain sentence saying what it means and whether it is good. Reader demand, capture health, topic counts and data switches move to a "Data business" view, and the old cards are deleted in the same change.
- Code: `app/(admin)/_mw/admin-v6/screen-now.tsx:46-69`, `command-center.tsx:381`, new `screen-data.tsx`.
- Done when: in live Admin on a phone, Now fits above the fold and each number has one sentence.
- Retires: the 15-card Now stack.

**BR-27 · Reports with wins, problems and decisions**
- Lane: Admin · Depends on: BR-14, BR-20, BR-24
- Change: Build a report from live data in three parts. Wins and updates come from the updates feed, with room of their own. Problems are one line each from the queue's red rows, with the cause and what is being done. Decisions are cards (BR-20). Add "Pull a report". Reader "Report a problem" submissions become queue rows owned by auditors. The Reports view is renamed for the brief, and the old reader-reports view is deleted.
- Code: new `lib/control-plane/admin-view/brief.ts`, `lib/control-plane/reports/read-reports.ts`, `app/(admin)/_mw/admin-v6/reports-view.tsx`.
- Done when: "Pull a report" in live Admin shows the three parts from live data.
- Retires: the reader-reports-only Reports view.

**BR-29 · Alerts only when Sean is needed**
- Lane: Admin · Depends on: BR-02, BR-14, BR-20
- Change: An alert strip on every view lists the Needs-me rows and any order not picked up. Nothing else raises an alert. It is built behind an `alerts.on` setting that starts off (Sean, Oct 3): until he turns it on, the same items go in the daily brief (BR-27, BR-28) and no strip shows.
- Code: `app/(admin)/_mw/admin-v6/command-center.tsx` (header).
- Done when: in live Admin no strip shows while the setting is off; switched on, an order not picked up and a new decision card each appear in the strip, and routine updates do not.
- Retires: —

**BR-34 · The old order and stuck lists are deleted**
- Lane: Admin · Depends on: BR-14
- Change: Delete Work's Lanes and History tabs, Workers' "Your instructions", Now's recent-orders list (replaced by a top-five strip from the queue) and the separate Fix list view, whose items are queue rows now (rulings §0: the replaced page goes in the same change set).
- Code: `app/(admin)/_mw/admin-v6/screen-work.tsx`, `screen-workers.tsx`, `screen-now.tsx`, `screen-fix.tsx`, `context.tsx`.
- Done when: in live Admin, each order, hunt, stuck item and fix item appears only on the queue, and the old tabs and the Fix list view are gone.
- Retires: the five scattered order and stuck lists; the Fix list view as a separate page.

#### Coach & Hunters

**CH-15 · Missions split into parts from settings**
- Lane: Coach & Hunters · Depends on: SC-02, BR-05
- Change: Add a pure mapping from checklist family and record class to mission parts. It is read from the overlay's `squad` and can be overridden by a `missionParts` setting. The default is the three §8.1 parts (governments and meetings; people and money; ballot), with governments split by class only for weighting ; that is the setting's starting value. Families the design doesn't assign start as: geography, reference definitions, government finance and public participation with governments and meetings; executive actions and public-statement profiles with people and money; measures with the ballot.
- Code: new `lib/control-plane/expansion/mission-parts.ts`, `lib/control-plane/settings.ts`.
- Done when: live Admin's mission view groups the owed list and its work by part, with counts.
- Retires: —

**CH-22 · Local research rows join the one hunter queue**
- Lane: Coach & Hunters · Depends on: BX-02, CH-06
- Change: Local-jurisdiction rows that reach the paid model path get an autonomous plan with a publication door, the way Sends do, so their findings go through the coordinator and the builders. The per-state candidate-enrichment and campaign-finance providers do not get plans; they are replaced by door records instead (CA-21, CA-32, CA-34).
- Code: `lib/control-plane/scheduler/providers/local-jurisdictions.ts`, `lib/control-plane/workers/autonomous-plan.ts`.
- Done when: facts from formerly staged-only local obligations appear on the live site, and every such Scout cost in Admin maps to a work item with a plan.
- Retires: —

**CH-25 · A hunter-count dial, with the memory ceiling beside it**
- Lane: Coach & Hunters · Depends on: CH-24, BR-05
- Change: Add a `hunterCount` setting, read live, as the upper bound on paid workers in the continuous pool. Budget, rate limits and memory still cap it. Show beside it the most workers the host runs at the 0.75 GiB memory margin (rulings §5). The dial counts hunters in flight, not processes; CH-28 lets one process run several.
- Code: `lib/control-plane/settings.ts`, `scripts/freshness-shadow.mts:1958` (`paidWorkerCapacity`), the pool from CH-24, `lib/control-plane/workers/worker-slots.ts:8-27`.
- Done when: changing the dial in live Admin changes the active-hunter count without a restart, and the memory ceiling shows beside it.
- Retires: —

**CH-27 · The 15-minute paid slice and the wave loop are deleted**
- Lane: Coach & Hunters · Depends on: CH-24
- Change: Once the continuous lane is verified live, delete the 15-minute paid dispatch slice and the wave loop from the research round, and remove CH-24's runner switch.
- Code: `scripts/freshness-shadow.mts:1978,3087-3098`.
- Done when: live Admin shows paid work running only through the continuous lane, with no change in tasks finished per hour.
- Retires: the 15-minute dispatch slice and the wave loop.

**CH-28 · Many hunters in each worker process**
- Lane: Coach & Hunters · Depends on: CH-24
- Change: Each hunter is its own worker process today, budgeted at a 342 MiB peak (`worker-slots.ts:9`). A hundred would need about 33 GiB, far beyond the droplet. Most of a hunter's time is spent waiting on a model or a web page, so let each worker process run several hunters at once (a setting, starting at 8). The hunter count is then set by requests in flight, rate limits and the budget dial, and the process count by memory. Admission keeps using real free memory (`worker-slots.ts:37-39,205-208`). CH-25's dial counts hunters, not processes.
- Code: `lib/control-plane/workers/process-pool.ts`, `lib/control-plane/workers/worker-slots.ts`, `lib/control-plane/workers/standing-runtime.ts`, the pool from CH-24.
- Done when: live Admin shows hunters in flight, worker processes and memory headroom separately, with several hunters per process and headroom above the 0.75 GiB margin.
- Retires: one process per hunter.


#### Box & Slide

**BX-06 · We can see where the flow stops**
- Lane: Box & Slide · Depends on: BX-01, BX-02
- Change: Emit hourly counts per stage: findings in the Box, built, passed the check, live. Add facts live per hour and the inputs for cost per fact (settled spend in the window over facts live in the window).
- Code: `lib/control-plane/box/` (findings index), `lib/civic-data/publication-status.ts`, publication receipts, new `lib/control-plane/admin-view/flow-read.ts`.
- Done when: stopping one stage on purpose shows a drop at that stage only in live Admin.
- Retires: —

**BX-07 · A map from checklist family to reader door, as data**
- Lane: Box & Slide · Depends on: SC-02
- Change: Add a data map from checklist family and field to the worker reader door that publishes it. New work plans use it, and builders use it for findings about other subjects.
- Code: `lib/civic-data/worker-reader-contracts.ts`, `lib/coverage/checklist-map.json`.
- Done when: every family with a door shows that door in live Admin's checklist card.
- Retires: —

#### Checkers & Publishing

**CP-04 · Every Sources row says what kind of source it is**
- Lane: Checkers & Publishing · Depends on: CP-03
- Change: Add an optional `kind` to `Provenance`, carried from the source receipt, and render it as the first word of each Sources row: Official, Campaign, Filing, Voter guide, Forum, News or Reference. Verification wording reads the kind, so a vendor portal linked from an official page reads as verified.
- Code: `lib/sources/types.ts:31`, `components/officials/card-sources-list.tsx`, `lib/officials/verification.ts:55-60,131-136`.
- Done when: the live ballot card's Sources section shows "Campaign" beside a campaign-site row, and a Legistar-sourced meeting reads "Verified".
- Retires: `isOfficialHost` and the "vendor portal is not official" rule.

**CP-08 · Contacts follow the same conflict rule, and Admin shows conflicts**
- Lane: Checkers & Publishing · Depends on: CP-07
- Change: Apply the rank-then-newer rule inside roster publication for phone, email, website and term, and write the loser to the roster receipt's existing excluded list. Show `CONFLICT_SUPERSEDED` counts in Admin's publication section.
- Code: `lib/civic-data/worker-roster-publication.ts:160-170`, `lib/control-plane/admin-view/v6-publication-read.ts`.
- Done when: live Admin shows superseded counts, and a card shows the more official contact.
- Retires: —

**CP-18 · The same meeting from two sources is shown once, and conflicts are logged**
- Lane: Checkers & Publishing · Depends on: CP-07
- Change: Meetings live in per-source partitions, so the same sitting can come from two doors (for example a calendar feed and an agenda platform) with different times or places. When reader meetings are assembled, match sittings of the same body on the same day across partitions using the existing sitting identity (`lib/sources/event-identity.ts`). Show one, keep the newer and more official value for each differing field, and log the losing value as `CONFLICT_SUPERSEDED` in the count Admin already shows (CP-08).
- Code: `lib/meetings/edge-serving.ts`, `lib/sources/event-identity.ts`, `lib/civic-data/reader-edge-publication.ts`, `lib/control-plane/admin-view/v6-publication-read.ts`.
- Done when: on the live site, a body read from two doors shows each sitting once, and Admin counts the time or place conflicts it settled.
- Retires: —

#### Doors & Bank

**DB-12 · Adapters read their doors from the registry**
- Lane: Doors & Bank · Depends on: DB-10
- Change: Add an accessor, `doorRowsFor(kind)`, that adapters use instead of importing `SOURCE_WIRING`. The composite reader already accepts derived rows.
- Code: `lib/doors/registry.ts`, the 20 adapter importers of `SOURCE_WIRING`, `scripts/ingest.ts:740`.
- Done when: meetings on the live site are unchanged with adapters reading the registry.
- Retires: adapter imports of `SOURCE_WIRING`.

**DB-21 · Each door knows when it last worked**
- Lane: Doors & Bank · Depends on: DB-10
- Change: Write `lastSuccessAt` and `lastFailureAt` onto the door record. For hand-wired doors, take them from the partition's promotion outcome. For derived members, take them from the family child's per-member result, not from the family promotion (add a per-member result where the child doesn't report one yet). This does not wait for DB-13.
- Code: `lib/civic-data/promotion.ts`, `lib/civic-data/source-acquisition-failure.ts:40-80`, `lib/doors/registry.ts`, the derived family child in `scripts/ingest.ts` (per-member result).
- Done when: live Admin door list shows each door's last success and last failure.
- Retires: "last worked" computed only inside observability.

**DB-23 · Route hints become door records**
- Lane: Doors & Bank · Depends on: DB-10
- Change: Move the 25 committed per-place meeting route hints into door records or Bank entries, then delete the file.
- Code: `lib/hunt/meetings-route-hints.ts:165-463`, `lib/doors/registry.ts`.
- Done when: discovery walks on the live runner still find those routes, and the file is gone.
- Retires: `lib/hunt/meetings-route-hints.ts`.

**DB-26 · What the hourly check finds is live within the hour**
- Lane: Doors & Bank · Depends on: DB-25, DB-10, BX-12
- Change:
  - Rulings §4's checks stay exactly as they are: hourly for a body with a meeting in the next 7 days or one held in the last 7, twice daily for everyone else.
  - When a check's first look (DB-25) sees a change, the read and publish run on the publish-now lane (BX-12) right away, not in the next routine pass.
  - Target (Sean, Oct 3): inside the 7-day window, anything a body posts is live within an hour of posting, which means by the next hourly check. An agenda posted at 3:45 is live after the 4:00 check. Outside the window, the twice-daily check picks it up.
  - Small governments: at most ten requests per website per hour (rulings §2).
- Code: `lib/civic-data/runner.ts:147`, `lib/civic-data/sitting-window-admission.ts`, `scripts/routine-civic-data-runner.mts`, `lib/doors/registry.ts`.
- Done when: a real agenda posted inside a body's 7-day window is live by the next hourly check, and Admin's posted-to-live time for it is an hour or less.
- Retires: a found agenda waiting for the next routine pass.

**DB-27 · Time from posting to live is measured**
- Lane: Doors & Bank · Depends on: DB-09, DB-25
- Change: Record when each new or changed meeting, agenda link, outcome and status was first seen, using the change set promotion already computes. Use the publisher's own posted stamp where it exists (Legistar `EventAgendaLastPublishedUTC`, iCal `LAST-MODIFIED`/`DTSTAMP`), otherwise the time the probe first saw the change. Stop the clock at the reader readback PASS for that version, which comes after edge publish and purge. Keep four times apart for each change: when the publisher says it posted it, when we first saw it, the last check that found it unchanged, and when it went live. When a publisher gives no posted time, Admin labels the figure as measured from first seen, never as posted-to-live.
- Code: `lib/civic-data/changes.ts`, `lib/civic-data/reader-readback.ts`, `lib/doors/registry.ts`.
- Done when: live Admin shows posting-to-live times for real agendas.
- Retires: `checklist-timings.ts`'s always-null posted time (removed in SC-15).

**DB-44 · Playbooks are edited in Admin, with undo**
- Lane: Doors & Bank · Depends on: DB-42, BR-06
- Change: Add a `playbook.update` gateway action (receipt, who, when, why; undo restores the previous revision) and a playbook editor in the Settings view.
- Code: `lib/control-plane/gateway/registry.ts`, `app/(admin)/_mw/admin-v6/screen-settings.tsx`, `lib/control-plane/field-manual.ts`.
- Done when: a Scout playbook line edited in live Admin appears in the next Scout's request, and Undo restores it.
- Retires: `scripts/field-manual-seed.mts` as the way playbooks reach agents.

**DB-47 · Roll back a release from Admin**
- Lane: Doors & Bank · Depends on: BR-14
- Change: Add a Admin action that restores the previous production deploy. It offers only deploys whose code works with the contract migrations already applied, which are in the journal, and it says why when none does. The runner follows through the existing handoff receipts.
- Code: `lib/control-plane/gateway/registry.ts`, `lib/ops/runtime-release-handoff.ts:262-275`, the existing Netlify token, if its scope allows a restore (Sean approved, Oct 3).
- Done when: a rollback from live Admin restores the previous site, and the runner follow shows on the queue.
- Retires: rollback only through the Netlify dashboard.

**DB-50 · An engineer-built adapter can become a feed**
- Lane: Doors & Bank · Depends on: DB-17
- Change: Let an engineer adapter declare itself a feed kind (`kind`, `configKeys`, `read(door)`), and have composite wiring load installed feed kinds the same way Scout adapters are loaded.
- Code: `lib/sources/platform-adapters/`, `lib/sources/composite/wiring.ts`, `lib/control-plane/scheduler/scout-adapters.ts:6,27`.
- Done when: doors using an engineer-built kind publish meetings on the live site at the proof bar (see the rule above).
- Retires: engineer adapters as Scout-only extractors.

**DB-54 · Pages that feed live facts become doors**
- Lane: Doors & Bank · Depends on: DB-09, BX-02
- Change: Only meeting wiring and a fixed list of feeds become door records, so roster, contact, comment-rule, directory and campaign pages found by hunters and detectives never do. When a worker door publishes a fact from a saved page, upsert a page-kind door record for that page: its hosts, what it holds, a `checkEvery` defaulted from the fact class's freshness window (`FRESHNESS_WINDOW_HOURS`, `section3.ts:73-83`), and who found it (Scout or detective). The registry then grows with every mission (design §6.3).
- Code: `lib/doors/registry.ts`, `lib/civic-data/worker-reader-publication.ts`, `worker-roster-publication.ts`, `worker-body-directory.ts`, `lib/control-plane/promotion/section3.ts:73-83`.
- Done when: in live Admin, every published roster and contact fact's page shows as a door with what it holds and when it is next due.
- Retires: —

#### Detectives & Proving

**DP-10 · A new capability reopens the dead ends it could solve**
- Lane: Detectives & Proving · Depends on: DP-06, DP-07
- Change: Generalize "wake when an adapter is installed" into "wake when a capability appears". When a route or method entry is written for a platform and record class, clear the absence on every obligation whose `unlockWhen` matches.
- Code: `lib/control-plane/workers/detective.ts:303-317` (`wakeInstalledAdapterDebts`), `scripts/freshness-shadow.mts:987`, `lib/method/conclusions.ts`.
- Done when: writing a method for a platform reopens an absent obligation on that platform in the next live round.
- Retires: `reopenConclusions`, which has no caller.

**DP-11 · The dead-end hold is a setting tied to the source's pace**
- Lane: Detectives & Proving · Depends on: DP-06, BR-05
- Change: Replace the fixed 30-day absence hold with a setting that defaults per record class to the source's cadence (checklist REC-20), capped by a second setting, the longest a dead end may wait, which starts at 5 days while the factory is expanding (Sean, Oct 3).
- Code: `lib/control-plane/scheduler/absence.ts:22`.
- Done when: no dead end in live Admin waits more than 5 days, and changing either setting changes the next absence's end date with no deploy.
- Retires: `ABSENCE_EXPIRY_DAYS = 30`.

**DP-17 · The audit policy is a setting**
- Lane: Detectives & Proving · Depends on: DP-16, BR-05
- Change: Move the audit sample policy into a setting.
- Code: `lib/control-plane/workers/audit-sampling.ts:46`, `live-audit.ts`.
- Done when: changing the ratio in live Admin changes the next pass's sample size with no deploy.
- Retires: `DEFAULT_AUDIT_SAMPLE_POLICY` as a constant.

**DP-20 · The fix map fills from every attempt**
- Lane: Detectives & Proving · Depends on: DP-19
- Change: Write a fix-map result from every attempt that used a method: Scouts and detectives (from the entries they used and their outcome), plain-code route runs, acquirer verdicts and audit outcomes.
- Code: `scripts/freshness-shadow.mts:2590-2594`, `lib/control-plane/workers/research-runtime.ts`, `live-audit.ts`, `lib/method/fix-map.ts`.
- Done when: a method used in three places shows three entries with the right outcomes in live Admin.
- Retires: —

#### Collects & Ask

**CA-05 · Social accounts are collected for everyone**
- Lane: Collects & Ask · Depends on: CA-04, CP-02
- Change: Read social profile links, matched by the platform list's URL patterns, from pages already held: official roster and profile pages and verified campaign sites. Publish them as attached facts with `accountKind` set by where each link was found. The check is that the link is on the saved page.
- Code: new `lib/civic-data/social-accounts.ts`, `worker-roster-publication.ts`, `lib/civic-data/derived-campaign-sites.ts`, `lib/control-plane/promotion/section3.ts` (`socials.<platform>`).
- Done when: officials' cards on the live site show social pills whose Sources rows are their own pages, at the proof bar (see the rule above).
- Retires: —

**CA-11 · A stances door publishes people's own words**
- Lane: Collects & Ask · Depends on: CP-02, CP-09, CA-09, CA-10
- Change: Add a worker reader door `stances`. It publishes an exact quote with its date and topic when `quotedSourceFindings` proves it on the saved page. A campaign page counts only for its own candidate. A paraphrase needs a second source.
- Code: `lib/civic-data/worker-reader-contracts.ts`, `lib/control-plane/workers/quoted-proof.ts`, `lib/control-plane/promotion/section3.ts:48`.
- Done when: candidates' quotes from their own sites show on live cards with date and source, at the proof bar (see the rule above).
- Retires: —

**CA-16 · The statement sweep searches, and searches more as the election nears**
- Lane: Collects & Ask · Depends on: CA-15, BR-05
- Change: After the held-captures pass, the sweep searches for statements on every topic with the same effort for every candidate. Its due date comes from a setting that tightens as the election date approaches. The sweep record lists what was searched.
- Code: `lib/corpus/statement-sweep.ts`, the Scout toolkit search tools.
- Done when: a school board candidate with no campaign site shows a quote from the county voter guide on the live site, with date and source.
- Retires: —

**CA-17 · Candidate profiles publish on their own**
- Lane: Collects & Ask · Depends on: CA-08, CP-03, CP-14
- Change: Build `candidate-profiles` on a clock from §3-checked records (portraits, bios, contacts) with `reviewedBy` set by the §3 validator, then remove its manual entry.
- Code: `lib/civic-data/manual-contracts.ts:149`, `manual-producer-invocation.ts`, `lib/civic-data/contracts.ts`, `source-authority.ts:621-694`.
- Done when: live Admin shows the contract promoting on its own, and a profile no person packaged appears on the live ballot.
- Retires: `REVIEWED_INPUT` mode for `candidate-profiles`.

**CA-19 · Executive actions for any state, on their own**
- Lane: Collects & Ask · Depends on: CP-03
- Change: Replace the one-state executive actions contract with a routine contract reading any state's governor and legislature pages through door records.
- Code: `lib/civic-data/manual-contracts.ts`, `manual-producer-invocation.ts`, `lib/civic-data/contracts.ts`.
- Done when: governors' recent actions show on the live site at the proof bar (see the rule above).
- Retires: `az-official-actions` as a reviewed one-state contract.

**CA-21 · State and local campaign finance are door kinds**
- Lane: Collects & Ask · Depends on: DB-11
- Change: Turn the three state systems and the one county's local finance into door records of a few kinds (CSV export, search API, bulk zip), each with a field map and one reader per kind.
- Code: `lib/funding/data-plane.ts:14-37`, `lib/funding/state-money.ts`, `scripts/state-money-*.mts`, `lib/doors/registry.ts`.
- Done when: state money appears on the live site after door records are added, with no code change, at the proof bar (see the rule above).
- Retires: `STATE_CAMPAIGN_FINANCE_SOURCES` and `PIMA_LOCAL_FINANCE_CONTRACT` as code.

**CA-26 · The translator, part 2: what a kind of body is, and what this body can do**
- Lane: Collects & Ask · Depends on: CA-25
- Change: Add the two levels. The general definition of a body class is written once from the law that creates the class. The specific one comes from that body's own charter or law, so a general definition never claims powers a particular body lacks.
- Code: `lib/translate/worker.ts`, `lib/officials/body-description.ts`.
- Done when: boards on the live site show both definitions with sources, written and checked with no person, at the proof bar (see the rule above).
- Retires: —

**CA-27 · The translator, part 3: what an office does**
- Lane: Collects & Ask · Depends on: CA-25
- Change: Add office definitions written from the law that defines each office, per state.
- Code: `lib/translate/worker.ts`, the office blurb reader.
- Done when: offices show "what this office does" with its source at the proof bar (see the rule above).
- Retires: —

**CA-28 · The translator, part 4: agendas and minutes in plain English**
- Lane: Collects & Ask · Depends on: CA-25
- Change: Run the translator on each held agenda and minutes capture, and show "What's on this agenda" above the clerk's list. The agenda route keeps returning the verbatim list beside it.
- Code: `lib/translate/worker.ts`, `app/api/ask/agenda/route.ts:51`, `components/map/popup/agenda-section.tsx`, `lib/ask/meeting-knowledge.ts`.
- Done when: agenda cards on the live site show a plain-English summary above the original, with a Sources row, at the proof bar (see the rule above).
- Retires: the "nothing is summarised" stance.

**CA-35 · Polling places by door kind**
- Lane: Collects & Ask · Depends on: DB-11
- Change: Voting sites cover only a few places today. Read polling places from door records by kind (state election office lists and county lookups), with no per-place code.
- Code: the voting-sites contract, `lib/civic-data/automatic-refresh.ts`, `lib/civic-data/manual-producer-invocation.ts:27`, `components/map/voting-sites-panel.tsx`.
- Done when: counties show their polling places on the live ballot after their doors are added, at the proof bar (see the rule above).
- Retires: per-place voting-site lists.

**CA-38 · Kinds of things are data, starting with special districts**
- Lane: Collects & Ask · Depends on: CA-37
- Change: Move division and body kinds, office types and statement source kinds into a kinds table loaded at runtime and edited as a setting. Validate against the table instead of code unions. The first use is special districts (fire, water, sanitation).
- Code: `lib/registry/types.ts:25-51`, `lib/officials/office-blurbs.ts:22-48`, `lib/corpus/types.ts:35`, `lib/ballot/measure-provisions.ts` (kinds).
- Done when: a fire district appears on the live map for its ZIPs, and a new kind added in Admin is accepted by builders with no deploy.
- Retires: the closed kind unions.

**CA-40 · What they said at the time**
- Lane: Collects & Ask · Depends on: CA-09, CA-15, DB-06
- Change: Attach statements a person made around a vote to that vote, by person and agenda item: from minutes, and from the text of their social posts as PRL's collection holds it (Sean, Oct 3). No paid platform is added; people PRL doesn't cover are handled later. Account links come from CA-05.
- Code: `lib/corpus/`, `lib/outcomes/types.ts`, `lib/ask/person-votes.ts`.
- Done when: Ask on the live site answers how a mayor voted on an item a year ago and what they said then.
- Retires: —

**CA-41 · Ask answers from meeting history**
- Lane: Collects & Ask · Depends on: DB-06, DB-07
- Change: Ask's meeting, outcome and vote answers read the history projection by person or body, with no window.
- Code: `lib/meetings/query.ts`, `lib/ask/meeting-outcomes.ts`, `lib/ask/person-votes.ts`, `app/api/ask/grounded/route.ts`.
- Done when: Ask on the live site answers how a board voted on an item more than 120 days ago.
- Retires: —

**CA-52 · Budgets, part 1: each government's adopted budget (FIN-01 to FIN-05)**
- Lane: Collects & Ask · Depends on: DB-11, BX-02
- Change: The checklist owes 16 finance items (FIN-01 to FIN-16) and nothing collects them. Start with the budget itself:
  - a door kind for a government's budget page, with fiscal year dates and the responsible government;
  - the current adopted budget, never the proposed one, stored with its fiscal year, version and a readable link, with published amendments linked to it;
  - who proposes, adopts, runs and oversees the budget, from the government's own charter or code.
- Code: `lib/control-plane/readiness/checklist-profile.json` (FIN-01 to FIN-05), `lib/doors/registry.ts`, a new budget builder beside the other worker reader contracts in `lib/civic-data/`, `lib/civic-data/contracts.ts`.
- Done when: at the proof bar, Admin shows FIN-01 to FIN-05 filled, with sources, for governments in sent places.
- Retires: —


#### Front-end

**FE-04 · The ballot is served from the cache**
- Lane: Front-end · Depends on: CA-32
- Change: Extend the existing `app/api/ballot/scope` route to a cache-held form keyed on the ZIP, with the same headers and tag purge as the meetings route. The page shell is static.
- Code: `app/api/ballot/scope`, `app/ballot/page.tsx`, `lib/civic-data/reader-edge-publication.ts:363`.
- Done when: a cold first visit to the ballot at a ZIP never in the pilot list is usable within three seconds on a phone, as measured by FE-02.
- Retires: the per-request dynamic ballot page.

**FE-11 · One person card, mounted for officials**
- Lane: Front-end · Depends on: FE-10
- Change: Render every person from one section table: identity, contact row, what this office does, where they stand, offices near you, money, voting record and Sources. Mount it from the official modal first. The battle card switch is FE-42.
- Code: new `components/ui/person-card.tsx`, new `lib/design/card-sections.ts` (from `lib/ballot/battlecard-sections.ts`), `components/map/popup/official-modal.tsx`.
- Done when: officials' cards on the live site render from the one section table at phone width.
- Retires: the official modal's own shell.

**FE-12 · One meeting card, with its sources in a Sources section**
- Lane: Front-end · Depends on: FE-10, CP-16
- Change: Make one `MeetingCard` and `MeetingRow` and mount them in the popup, the panel, the list overlay, the door overlay and Ask answers. Move the meeting provenance into the card's Sources section and drop the inline "From X · read <date>" lines.
- Code: `components/map/popup/meeting-popup.tsx:282,298`, `agenda-section.tsx:186,245,296,385`, `meeting-records.tsx`, `components/map/meeting-panel.tsx`, `list-overlay.tsx`, `door-overlay.tsx`, `components/ask/answer-records.tsx`.
- Done when: the live meeting card on a phone shows sources only under "Sources".
- Retires: five separate meeting row renderers; inline meeting citations.

**FE-13 · One body card**
- Lane: Front-end · Depends on: FE-10
- Change: Keep the sectioned body card shape and remove the tabbed one.
- Code: `components/map/popup/entity-modal.tsx:61-79,1027-1062`.
- Done when: every body on the live site opens the same card shape.
- Retires: the tabbed body card.

**FE-21 · Every deploy is looked at on the live site**
- Lane: Front-end · Depends on: FE-01, FE-16, FE-20, BR-03
- Change: When the served commit changes, the runner (which already watches this) runs a look pass on production at phone and desktop size. It takes screenshots, runs the page measurements and asks the reviewer for verdicts. Red flags become fix-list items with screenshots; green flags are counted. A change is reported done only when its look entry is green; this is a reporting rule and never holds back data.
- Code: `scripts/pilot-runner.mts` (served-SHA observation), `lib/frontend/look-review.ts`, `lib/health/page-metrics.ts`, `lib/control-plane/fix-list.ts`, the Netlify blob store already used for portraits (`lib/photos/store.ts`).
- Done when: after a live deploy, Admin shows that deploy's look results with screenshots.
- Retires: visual diagnostics written to the unread `pilot-health` store.

**FE-26 · Site speed and reliability on the Scoreboard**
- Lane: Front-end · Depends on: FE-02, DB-51, BR-03, BR-23
- Change: Add the Scoreboard row: the share of actions over three seconds per surface (worst-case counts), errors per surface and dead links. When a surface crosses its setting threshold, it goes to the top of the stuck list and opens a fix-list item. This shares the top-of-list placement with shut doors, not the door mechanism.
- Code: `lib/control-plane/admin-view/scoreboard-read.ts`, `v6-stuck-read.ts`, `lib/control-plane/fix-list.ts`.
- Done when: the live Scoreboard shows the row, and the first real surface over three seconds (or one from a controlled run never served to readers) appears at the top of the stuck list.
- Retires: —

**FE-28 · A dead link shows as text, not a broken link**
- Lane: Front-end · Depends on: DB-51, FE-29
- Change: A link the latest sweep found dead renders as plain text with the "working on it" line instead of a dead link.
- Code: `components/officials/card-sources-list.tsx`, link renderers.
- Done when: the first real dead link DB-51 finds renders as text on the live site.
- Retires: —

**FE-31 · A guard keeps the reader copy honest**
- Lane: Front-end · Depends on: FE-29, FE-30
- Change: Extend the absence-defaults test so no reader file outside `working-on-it.tsx` contains the not-covered sentence, and banned patterns are refused ("not a statement that", "not evidence that", "We don't hold").
- Code: `tests/absence-defaults.test.ts` and its JSON.
- Done when: a pull request adding a disclaimer line is refused before it reaches the live site.
- Retires: —

**FE-35 · Offices near you are pins with directions**
- Lane: Front-end · Depends on: CA-07, BX-08
- Change: Add an office pin layer from published office addresses (official, body and campaign offices; never homes), with Directions through `venueLink`.
- Code: `components/map/map-entry.tsx`, `map-canvas.tsx`, the popup components.
- Done when: a school district office shows as a pin with directions on the live map.
- Retires: offices as a text-only card section.

**FE-36 · A plain record card for things with no shape**
- Lane: Front-end · Depends on: FE-10, CA-37
- Change: Add `components/ui/record-card.tsx` (title, body text, date and Sources) on the shared Card.
- Code: new `components/ui/record-card.tsx`.
- Done when: a plain public record shows on the live place page as a clean card with Sources.
- Retires: —

#### Scorecard

**SC-04 · Items are counted at the right unit**
- Lane: Scorecard · Depends on: SC-02
- Change: 
  - ZIP-scope GEO items go per ZIP in the place.
  - Division GEO items go per division, gated by trigger: school-district items only for school districts, special-district items only for special districts, tribal items only where a tribal overlap is held.
  - LEG items go per legislature and session, per roll call when roll calls are held, and per seat only for the seat items.
- Code: `lib/coverage/place-owed.ts:108-150`, `lib/civic-data/held-place-geography.ts:47-51`.
- Done when: a sent district's total owed in live Admin drops by the GEO and LEG excess, with per-family counts shown.
- Retires: GEO-on-every-division and LEG-on-every-seat.

**SC-05 · Every blank carries its six statuses**
- Lane: Scorecard · Depends on: SC-02
- Change: Each owed row gets six statuses: applies, due, what the hunt found, whether the government has published it, how fresh it is, and whether residents can see it. They are filled from data already held:
  - overlay rules for applies and due;
  - work items, attempts and Box findings (by `subjectId`) for what the hunt found;
  - publication observations, extended to agendas and other items with a posting deadline, with "awaiting publication" and a next check;
  - `freshUntil` and source dates for freshness;
  - served-reader witnesses for residents' view (others stay "not checked" until FE-18 records page witnesses).

  The government-unpublished rule follows the adopted checklist: awaiting publication does not remove a requirement that is already due, and "not yet due" needs a lifecycle rule. The old blended state stays as a compatibility field until SC-07.
- Code: `lib/coverage/place-owed.ts:28-37,138-156`, `lib/civic-data/held-place-capture.ts:128-166`, `lib/control-plane/served-reader.ts`.
- Done when: a sent place's meeting with no agenda posted yet shows "Agenda not published yet · next check <time>" in live Admin's item list, not "missing".
- Retires: the one blended state (finished in SC-07).

**SC-08 · Coverage, counted against what is expected**
- Lane: Scorecard · Depends on: SC-02
- Change: Count governments, bodies, seats and people accounted for against what the place should have:
  - governments: expected from the place's Census and school-district divisions (statistical places excluded);
  - bodies: "total unknown", with the found count and sources checked;
  - seats: expected from held body compositions where present;
  - people: seats plus candidates on held contests.
- Code: new `lib/coverage/place-coverage.ts`, `readHeldPlaceCapture`.
- Done when: live Admin shows, for a sent district, "Governments: N of M accounted for · Bodies: K found, total unknown".
- Retires: —

**SC-10 · New finds join the list with a date**
- Lane: Scorecard · Depends on: SC-02, BR-24
- Change: Each row gets `owedSince` (its subject's first-seen time, or the definition's `addedAt`). The mission start is the `expansion.scope.set` receipt time. Show completeness on the starting list and on the grown list side by side. Emit one Admin update for each new kind of subject.
- Code: `lib/coverage/place-owed.ts`, `lib/civic-data/held-place-capture.ts`, `lib/control-plane/admin-view/updates-read.ts`.
- Done when: a newly found body in a sent place shows "added <date>" in live Admin, and completeness on the starting list does not drop.
- Retires: —

**SC-13 · Launch gates become health checks that never stop publishing**
- Lane: Scorecard · Depends on: SC-02
- Change: Map GATE-02 to GATE-12 onto existing health readings: runner heartbeat and deployed commit, database reach, dispatch result, spend control, schedule and overnight continuity. Each shows as pass, attention or not measured in the Scoreboard's GATE group.
- Code: `lib/control-plane/owner-surface.ts`, `lib/control-plane/admin-view/scoreboard-read.ts`.
- Done when: the live Scoreboard shows the GATE rows with live readings, and none can hold publishing.
- Retires: the readiness gate model (removed in SC-18).

**SC-14 · Sean can add to what's owed, from Admin**
- Lane: Scorecard · Depends on: SC-02, BR-06
- Change: Store the overlay as its own control-plane record with the same log and undo as settings. Add an "add to what's owed" action that writes a definition with `addedAt`, `addedBy` and the reason.
- Code: `lib/coverage/checklist-map.ts`, `lib/control-plane/gateway/registry.ts`, `screen-settings.tsx`.
- Done when: an item added in live Admin appears on a place's owed list on the next read, with no release.
- Retires: overlay changes needing a release.

**SC-16 · Operational readiness is counted apart from civic completeness**
- Lane: Scorecard · Depends on: SC-02
- Change: Show ACQ, REC, PUB and ASK as readiness counts, never added to civic completeness. Witness REC items from fields that already exist: inherited and used Bank entries, failure debts, absences and manual write-back.
- Code: `lib/control-plane/admin-view/scoreboard-read.ts`, `lib/coverage/checklist-map.json`.
- Done when: the live Scoreboard shows the readiness counts with their evidence.
- Retires: —

### Stage 4

#### Admin

**BR-17 · "When" on every order: now, at a time, by a date, after something, or repeating**
- Lane: Admin · Depends on: BR-16, BR-14
- Change: Add Start now (`runner.runCycleNow`), Schedule, After, Repeat and Finish-by to the order dialog. Finish-by is shown as the row's due date on the queue, and the row turns red when it is late. It never pauses publishing.
- Code: `app/(admin)/_mw/admin-v6/action-dialog.tsx`, `actions.ts`, `screen-queue.tsx`, `lib/control-plane/gateway/registry.ts:486`.
- Done when: an order given in live Admin with each "when" option shows Scheduled and fires as set; a late finish-by turns its row red.
- Retires: —

**BR-19 · Sequenced orders in plain words**
- Lane: Admin · Depends on: BR-18, BR-16
- Change: Parse "until done, then …" into two orders, the second scheduled "after" the first.
- Code: `lib/control-plane/operator-chat/router.ts`, `scheduled-orders.ts`.
- Done when: "Put everything on school boards in this district until they're done, then go back to candidates" in live Admin reads back as two linked orders, and the second fires when the first is Done.
- Retires: —

**BR-28 · The daily brief arrives at Sean's time**
- Lane: Admin · Depends on: BR-27, BR-05, BR-37
- Change: Add a brief-time setting. At that time the always-running timer (BR-37) writes the brief snapshot, and the latest brief shows first on Now. The brief and alerts stay in Admin.
- Code: `lib/control-plane/admin-view/brief.ts`, `scripts/pilot-runner.mts` (BR-37 timer), `screen-now.tsx`.
- Done when: the brief appears in live Admin at the time set, with Sean's PC off.
- Retires: —

**BR-31 · Facts per hour, cost per fact, and where the flow stopped**
- Lane: Admin · Depends on: BR-23, BX-06
- Change: 
  - Add the Scoreboard rows for facts live per hour (with a seven-day trend) and cost per fact.
  - Add a per-stage flow view for "find out why something is slow".
  - Add an Ask-the-Admin topic for "What did we spend yesterday and what did it get us?".
- Code: `lib/control-plane/admin-view/scoreboard-read.ts`, `flow-read.ts`, `lib/control-plane/operator-chat/contract.ts`, `router.ts`, `read-models.ts`.
- Done when: the live Scoreboard shows both rows; the spend question returns a one-line answer from live numbers with a link.
- Retires: —

**BR-33 · Sean can decline a new owed item**
- Lane: Admin · Depends on: BR-24, SC-10
- Change: An update for an item added to a place's owed list carries a Decline button. Declining removes the item from what is owed, with the reason recorded. Additions stay automatic.
- Code: `lib/control-plane/admin-view/updates-read.ts`, `lib/control-plane/gateway/registry.ts`, `lib/coverage/checklist-map.ts`.
- Done when: declining an added item in live Admin removes it from that place's list, and the log shows why.
- Retires: —

#### Coach & Hunters

**CH-16 · Every piece of work knows its mission part**
- Lane: Coach & Hunters · Depends on: CH-15
- Change: Add `missionPart` to autonomous work plans, set where plans are built.
- Code: `lib/control-plane/workers/autonomous-plan.ts`, `lib/control-plane/scheduler/providers/local-jurisdictions.ts` (`requirementsFor`).
- Done when: live Admin shows work counts by part for a mission.
- Retires: —

**CH-23 · One hunter path: the separate registry-lane Scout is retired**
- Lane: Coach & Hunters · Depends on: CH-22, DP-02, DP-04, DP-06
- Change: Every paid Scout runs through the coordinator and its publication chain. First, carry the passing-outage rule (DP-02), detective-before-absence (DP-04) and unlock conditions (DP-06) into the coordinator path. Then delete the registry lane's Scout path. Keep the old path behind a runner switch (an entry in the runner's environment file until DB-46's switches exist) until the new path is verified live, then remove the switch.
- Code: `scripts/freshness-shadow.mts:995,2500-2530,3370-3388` (`scoutFor`), `lib/control-plane/scheduler/shadow-loop.ts` (research options), `lib/control-plane/workers/coordinator.ts`.
- Done when: every Scout cost in live Admin maps to a work item with a plan, and the rules above still hold.
- Retires: the `runCycle` research path and `scoutFor`.

#### Doors & Bank

**DB-13 · The runner builds its meeting work from the registry every pass**
- Lane: Doors & Bank · Depends on: DB-12
- Change: The runner builds its list of meeting tasks from the registry on each pass, as derived families already do, instead of from code at start-up. Hand-wired doors keep one partition per door and body; derived members stay inside their state family partition. Last-known-good isolation is unchanged.
- Code: `lib/civic-data/meeting-partitions.ts:118-178`, `lib/civic-data/runner.ts:120-125`.
- Done when: a door row added in live Admin is read on the next pass with no deploy.
- Retires: partition membership fixed at module load.

**DB-28 · Every live fact knows its door**
- Lane: Doors & Bank · Depends on: DB-10, DB-11, DB-54
- Change: Stamp `doorId` on every published fact. Meeting rows take it from their partition; worker facts take it from the page door their source page belongs to (DB-54).
- Code: `lib/civic-data/reader-edge-publication.ts`, `worker-reader-publication.ts`, `lib/doors/registry.ts`.
- Done when: a fact's Sources row in live Admin's fact view names its door.
- Retires: —

**DB-30 · Refresh follows how often each door actually changes**
- Lane: Doors & Bank · Depends on: DB-21
- Change: Store each door's observed change interval from its successive changed promotions. `checkEvery` defaults to the faster of the policy and the observed rate. Meetings are never slower than the rulings §4 floor.
- Code: `lib/doors/registry.ts`, `lib/civic-data/promotion.ts`.
- Done when: live Admin door list shows each door's observed rate and the check interval it produces.
- Retires: one fixed cadence per contract for doors with history.

**DB-32 · A door that stops working is marked shut at once**
- Lane: Doors & Bank · Depends on: DB-21
- Change: For derived members, judge each member from its own per-member result (DB-21), never from the family's total. Mark a door `SHUT` and set `shutSince` on any of: a 404 or 410 at its address; a successful read that yields zero rows where the last good version had rows; a parse or schema failure; or the threshold of consecutive transport failures. Clear it on the next good promotion and record when it reopened.
- Code: `lib/civic-data/source-acquisition-failure.ts`, `lib/civic-data/promotion.ts`, `lib/doors/registry.ts`.
- Done when: in a controlled run with a synthetic door whose projection is never served to readers, a moved address shows SHUT within one pass; in live Admin, the next real failing door shows SHUT within one pass.
- Retires: failures that only keep last-known-good data and raise nothing.

**DB-45 · Meeting windows and check timings are settings**
- Lane: Doors & Bank · Depends on: BR-05, DB-01, DB-26
- Change: Register these keys and point their readers at `readSetting`:
  - `meetings.shownBackDays` and `meetings.shownAheadDays` (default 90);
  - `meetings.heldBackDays` and `meetings.heldAheadDays` (default 120);
  - `meetings.hourlyWindowDays` (7, before and after a meeting);
  - `meetings.postedToLiveTargetMinutes` (60 inside that window, shown as the Scoreboard target).

  Full-read cadence may go faster than rulings §4 but never slower. Reader-facing windows reach reader pages through the reader-edge settings publication (BR-05).
- Code: `lib/meetings/constants.ts`, `lib/meetings/edge-serving.ts`, `lib/meetings/query.ts`, `lib/civic-data/contracts.ts:47-52`.
- Done when: changing shown-ahead days in live Admin changes the map without a deploy, and Undo restores it.
- Retires: the windows as code constants.

**DB-52 · The factory measures how much faster it gets**
- Lane: Doors & Bank · Depends on: BX-06, DP-09
- Change: Compute four measures (design §14):
  - time to cover a government the second time compared with the first;
  - the share of targets solved from the head start alone;
  - how often detectives' routes are reused;
  - facts live per hour, week over week.
- Code: `lib/control-plane/admin-view/learning-trends.ts`, `scoreboard-read.ts`, `flow-read.ts`.
- Done when: the live Scoreboard shows the head-start hit rate and the second-time coverage measure.
- Retires: the old weekly learning series it replaces.

#### Detectives & Proving

**DP-21 · Briefs say whether a method works, is untried, or fails here**
- Lane: Detectives & Proving · Depends on: DP-20
- Change: When the Bank is projected for a place, mark each method "works here", "untried here (try it and record the result)" or "fails here (cause)", and drop the ones that fail here. This step owns the Scout brief's line budget, shared later with the mission lines from CH-20, so the two don't crowd each other.
- Code: `lib/control-plane/field-manual.ts:209-238`, `scheduler/field-manual-scout.ts:46-77`, `lib/method/fix-map.ts`.
- Done when: a live Scout's inherited lines for a place where a method failed leave it out or mark it.
- Retires: —

**DP-22 · Results in one place no longer overwrite another place's**
- Lane: Detectives & Proving · Depends on: DP-20
- Change: Stop the newer-wins upsert from overwriting outcomes across places. Keep the single outcome only as "latest anywhere" for display. This also records which observation superseded which (checklist REC-12).
- Code: `lib/control-plane/field-manual.ts:136-163`.
- Done when: a route that worked in one state and failed in another shows both results in live Admin.
- Retires: cross-place overwrite.

**DP-23 · A fix moves from Testing to Proven against a bar that is a setting**
- Lane: Detectives & Proving · Depends on: DP-20, BR-05
- Change: Add a pure `fixStatus(map, bar)` that returns TESTING or PROVEN. The bar is a Admin setting whose starting value is five or more places spread across more than one district or state (the design's example), with at least 90% of tried places succeeding (an adjustable starting value; the design's "40 of 42" passes it). Mostly working counts: enough places and a high enough share succeeding. Failing places get detective cases.
- Code: new `lib/method/fix-status.ts`, `lib/control-plane/settings.ts`.
- Done when: changing the bar in live Admin flips a fix between Testing and Proven with no deploy.
- Retires: the hard-coded `earnedPortability` bars.

**DP-24 · A fix is tried everywhere the same kind of door exists**
- Lane: Detectives & Proving · Depends on: DP-07, DP-20, DB-17
- Change: When a method has its first success, list every place whose door kind matches (registry kind plus platform detection on held pages) and try it there in parallel:
  - plain-code tries go everywhere, within pacing;
  - paid tries (a Scout briefed with the method) go only to places inside a Send, within the budget dial. Design §17.2 (try it everywhere, no approval needed) and §7.1 (where the factory is sent is Sean's call) together give this split.

  Places for these tries are picked by kind of door or at random, never because a place is next in line for a mission or a test (rulings §1). Results go to the fix map. No approval is needed.
- Code: new `lib/method/spread.ts`, `lib/hunt/platform-tenancy.ts`, `lib/doors/registry.ts`, `lib/control-plane/scheduler/host-supervision.ts:43`, `lib/control-plane/expansion/membership.ts:511-514`.
- Done when: after a new method works once, live Admin's fix map shows many places tried in the same round.
- Retires: `wakeInstalledAdapterDebts` as the only way to spread a fix.

**DP-27 · Failures are compared to find what they share**
- Lane: Detectives & Proving · Depends on: DP-20
- Change: Add a pure `studyLosses(fixMap, placeTraits)`. For each fix with two or more failures, it compares failing places with working ones on traits we already hold:
  - platform and platform version;
  - state;
  - agendas posted as images;
  - a login or form in the way;
  - body size or how far ahead it posts.

  It returns the shared traits, or "nothing shared".
- Code: new `lib/method/study-losses.ts`, `lib/hunt/platform-tenancy.ts`, `lib/extract/ocr.ts`.
- Done when: run over the live fix map, it names the shared trait for a real group of failures in Admin.
- Retires: —

#### Collects & Ask

**CA-14 · Each stance topic is a ready-made answer that opens instantly**
- Lane: Collects & Ask · Depends on: CA-11, CA-12, CA-15, FE-11
- Change: When statements publish, build each person-and-topic answer on the Slide into the reader edge, the way Ask would answer it: their own words, the date, and sources in the card's Sources section. A chip renders the stored answer at once with Ask's components, so no cold Ask runs per tap. Free-text questions about the person still go to Ask.
- Code: new `lib/corpus/topic-answers.ts`, `components/officials/positions-section.tsx`, `components/ask/answer-records.tsx`, `lib/civic-data/reader-edge-publication.ts`.
- Done when: clicking "housing" on any person card on the live site shows the same answer as typing that question into Ask, within three seconds.
- Retires: `/api/positions/[subject]/[topic]` as a separate answer engine.

**CA-18 · Statements and the candidate corpus publish on their own**
- Lane: Collects & Ask · Depends on: CA-11
- Change: Convert `officeholder-statements` and `candidate-corpus` into the stances door's routine output, then remove their manual entries.
- Code: `lib/civic-data/manual-contracts.ts:165,181`, `manual-producer-invocation.ts:19-20`, `lib/civic-data/contracts.ts`.
- Done when: live Admin shows statements promoting on their own, and a statement no person packaged shows on a card.
- Retires: `REVIEWED_INPUT` mode for both contracts.

**CA-22 · Top donors and PACs for state and local races**
- Lane: Collects & Ask · Depends on: CA-21
- Change: Carry the top PACs, committees and organizations by amount, by filed name and committee type, from the same filings, and render them the way the FEC rows render. Individual donors render only as aggregates, as `lib/funding/donor-privacy.ts` requires today, plus the small-donor share (CA-45).
- Code: `lib/funding/state-money.ts`, `components/funding/state-money-section.tsx:66-200`.
- Done when: a state legislative candidate's live card lists top PACs and organizations with links to the filings, and individual giving as totals.
- Retires: —

**CA-29 · Existing definitions become translation records**
- Lane: Collects & Ask · Depends on: CA-26, CA-27
- Change: Turn the curated body and form definitions, office blurbs and body blurbs into translation records, with the same text and citations. Point their readers at the records, and delete the static files.
- Code: `lib/officials/body-definitions.ts`, `form-definitions.ts`, `office-blurbs.ts`, `data/states/az/reference/body-blurbs.json`, `lib/officials/body-description.ts`.
- Done when: pages that used those files render unchanged on the live site, and the files are gone.
- Retires: the static body, form and office definition files.

**CA-34 · Campaign-finance work comes from the ballot, not a hard-coded list**
- Lane: Collects & Ask · Depends on: CA-32, CA-21
- Change: Campaign-finance obligations and routes come from candidates on the generic ballot and from door records, not from hard-coded candidacies and per-place routes.
- Code: `lib/control-plane/scheduler/providers/campaign-finance.ts:195-345`, `lib/control-plane/campaign-finance/obligations.ts:87-94`.
- Done when: money work for candidates in a place never worked before shows in live Admin, and no code names a candidacy.
- Retires: the hard-coded district candidacies and per-place finance routes.

**CA-36 · Ask fetches full detail through the keys when asked**
- Lane: Collects & Ask · Depends on: CA-20, CA-21
- Change: When a question needs detail beyond the stored summary (an itemized filing, an older document), fetch it through the registered key (FEC API, state finance door, the document address). Extract the needed rows and add them to the answer with their addresses. A timeout falls back to the stored summary plus the link, within three seconds.
- Code: new `lib/ask/fetch-through-key.ts`, `app/api/ask/grounded/route.ts`.
- Done when: Ask on the live site, asked to list every PAC that gave to a member of Congress this year, returns rows fetched live, each with a filing link.
- Retires: —

**CA-39 · A new kind of thing joins a place's owed list**
- Lane: Collects & Ask · Depends on: CA-37, SC-10
- Change: When a new kind is published for a place, add a dated owed item for that place.
- Code: `lib/coverage/place-owed.ts`, `lib/coverage/checklist-map.ts`.
- Done when: after a new kind is found in a sent place, live Admin shows it on that place's owed list with its date.
- Retires: —

**CA-50 · Existing measure, notice and minutes summaries become translation records**
- Lane: Collects & Ask · Depends on: CA-25, CA-28
- Change: Turn the measure summaries and parts, notice summaries and minutes summaries into translation records, with the same text and citations. Point their readers at the records, and delete the static imports.
- Code: `data/states/az/ballot/measure-summaries.json`, `lib/ballot/measure-provisions.ts`, `data/states/az/meetings/notice-summaries.json`, `lib/meetings/minutes-summaries.ts`, `lib/ballot/measure-summary.ts`, `lib/meetings/notice-summary.ts`, `components/map/popup/meeting-popup.tsx`, `lib/ask/meeting-knowledge.ts`.
- Done when: measure, notice and minutes pages render unchanged on the live site, and the files are gone.
- Retires: the static measure, notice and minutes summary files.

**CA-53 · Budgets, part 2: totals, revenue, spending, contracts, debt, audits and grants (FIN-06 to FIN-16)**
- Lane: Collects & Ask · Depends on: CA-52
- Change:
  - First from national sources at no model cost: the Census Bureau's government finance data (revenue, spending and debt by government), the Federal Audit Clearinghouse (audits) and USAspending (federal grants to each government).
  - Then from the adopted budget, audit reports and procurement pages: operating and capital totals, appropriations kept apart from actual spending, taxes and levies with rate and effective date, procurement notices, contract awards, and debt and bonds.
  - Budgets, spending, debt and campaign money stay separate categories (FIN-16). Nothing is computed into shares or characterized.
- Code: new finance builders in `lib/civic-data/`, `lib/coverage/place-owed.ts`, `lib/civic-data/contracts.ts`.
- Done when: at the proof bar, Admin shows FIN-06 to FIN-16 filled or honestly blank for governments in sent places, each with its source.
- Retires: —

**CA-55 · Special districts get boundaries, so they show only for addresses they serve**
- Lane: Collects & Ask · Depends on: CA-38
- Change: CA-38 makes special districts (fire, water, sanitation and others) a kind of government, but nothing says which addresses each one serves. Hold each district's boundary as a door, from the state or county GIS layer or the district's own service-area map, and add it to the divisions an address lookup returns. Until a boundary is held, the district shows on its county as serving part of the county and is not attached to any one address.
- Code: `lib/hunt/jurisdiction-universe.ts`, `lib/registration/jurisdictions.ts`, `lib/civic-data/held-place-capture.ts`, `lib/doors/registry.ts`.
- Done when: at the proof bar, a held special district appears for addresses inside its boundary and not for addresses outside it.
- Retires: —


#### Front-end

**FE-15 · Official and body cards keep sources in their Sources section**
- Lane: Front-end · Depends on: FE-11, FE-13
- Change: Remove the holder-source, term-note, roster-gap, official-action and other inline source lines from official and body cards and the map entry, including the "their campaign site · last checked …" line in the positions section and the "· read <date>" line in the key-votes section.
- Code: `components/map/popup/entity-modal.tsx:1268`, `components/map/map-entry.tsx:2791`, `components/map/meeting-panel.tsx:332,652,710`, `meeting-listing-notice.tsx:14`, `voting-sites-panel.tsx:317`, `components/officials/official-term-note.tsx:11`, `roster-completeness-gap.tsx:10`, `official-actions.tsx:37`, `components/area/shuffled-facts.tsx:92`, `components/officials/positions-section.tsx:183-187`, `components/officials/key-votes-section.tsx:330`.
- Done when: those live cards show sources only under "Sources".
- Retires: the remaining inline citations.

**FE-23 · Look and feel on the Scoreboard**
- Lane: Front-end · Depends on: FE-21, BR-23
- Change: Add the row and card: red and green counts this week, the newest reds with thumbnails, and each red's fix and re-look.
- Code: `lib/control-plane/admin-view/scoreboard-read.ts`, `lib/control-plane/fix-list.ts`.
- Done when: a red from a live look pass shows on the Scoreboard with its screenshot.
- Retires: —

**FE-24 · Sean rates a sample of real screens**
- Lane: Front-end · Depends on: FE-21, BR-23
- Change: Add a "Screens to rate" card: a regular random sample of production screens from the look passes, each with like or dislike and an optional note. Each verdict is written in the feedback sweep record shape and added to the look standard's examples.
- Code: `lib/feedback/sweep.ts`, `docs/look-standard.md` examples, a new Admin card.
- Done when: a dislike Sean taps in live Admin appears as a "bad" example the reviewer cites on its next run.
- Retires: —

**FE-27 · Speed is measured by our own regular test visits**
- Lane: Front-end · Depends on: FE-26
- Change: Sean decided on Oct 3 not to collect real readers' page timing. Run FE-02's production speed measurement on a regular schedule instead, and nothing about readers' timing or errors is collected.
- Code: `lib/events/wire.ts:16-24`, `lib/events/client.ts`, `app/error.tsx`, `app/ballot/error.tsx`, `/transparency`, `lib/db/search-log.ts:48-55`.
- Done when: the live Scoreboard's speed row shows the scheduled test visits' worst cases, labeled as our own tests.
- Retires: —

**FE-37 · Admin itself is reviewed by running Sean's tasks**
- Lane: Front-end · Depends on: FE-18, FE-20, BR-25
- Change: Write Sean's tasks as data: start a mission, shift focus, schedule an order, find out why something is slow, read what the team fixed today, decide on a new expense. Run them in Admin with a minted session, using the same measurements and reviewer, and count words on screen, taps and time to the first decision. Include the first-open time per view against three seconds.
- Code: new `data/health/admin-tasks.json`, `scripts/resident-tasks.mts`, `scripts/admin-walk.mts` (session method).
- Done when: Admin reviews in live Admin produce red and green flags with screenshots on the Scoreboard.
- Retires: —

**FE-40 · Dated one-off screenshot and walk scripts are retired**
- Lane: Front-end · Depends on: FE-18, FE-21
- Change: Delete the roughly 51 one-off shot and walk scripts. They protect nothing the look pass and resident tasks don't.
- Code: `scripts/shoot-*.mts`, `shot-hobbs.mts`, `shots-0815d`, `*-shots.mts`, `tester-walk-08*.mts`, `walk-r39/40/41.mts`, `verify-visual-feedback-9-2.mts`, `verify-tester-visual-9-4.mts`.
- Done when: the look pass and resident tasks keep running on the live site with the scripts gone.
- Retires: those scripts.

**FE-42 · Candidates use the same person card**
- Lane: Front-end · Depends on: FE-11
- Change: Mount the person card from the candidate battle card and delete its own shell in the same change. Challengers get the same contact row as incumbents. Move old history comments out of the files touched.
- Code: `components/ballot/candidate-battlecard.tsx`, `lib/ballot/battlecard-sections.ts`, `components/ui/person-card.tsx`.
- Done when: an incumbent and a challenger for the same seat show the same section headers in the same order at phone width on the live site.
- Retires: the battle card's own shell.

#### Scorecard

**SC-06 · "Nothing hunts this yet" is shown honestly**
- Lane: Scorecard · Depends on: SC-05
- Change: Record in the overlay which producers can fill each item, checked by a test against the code that writes them. A row whose item has no producer shows the reason "no squad or door covers this item yet", counted per family.
- Code: `lib/coverage/checklist-map.json` (`filledBy`), `lib/coverage/place-owed.ts`, `app/(admin)/_mw/admin-v6/screen-checklist.tsx`.
- Done when: a sent place's card in live Admin splits "not captured" into "hunted, not found" and "nothing hunts this yet", with counts.
- Retires: —

**SC-07 · Completeness, freshness and delivery are reported separately, never blended**
- Lane: Scorecard · Depends on: SC-05
- Change: Report three measures, each with the counts behind it, by family and by place:
  - completeness: satisfied out of applicable, due, core items, with the counts of blocked, not checked, awaiting publication, no producer and unresolved applicability beside it;
  - freshness: current out of items that need freshness;
  - delivery: visible and checked out of published items expected on a page.

  Show them side by side on the checklist card, Now and the national list. Replace the paragraph-style "missing parts" text with one-line labels. Remove the old blended state.
- Code: `lib/control-plane/admin-view/place-scorecard.ts`, `screen-checklist.tsx:50-95`, `screen-now.tsx:318,431`, `v6-national-read.ts:216-220`, `model.ts` (`PlaceScoreView`), `v6-place-section.ts:136-137`.
- Done when: a sent place's live card shows three labeled figures, each "N of M", and the national column reads "Completeness".
- Retires: the blended "captured" percent; government-unpublished counted as captured.

**SC-09 · People coverage: who has a full profile**
- Lane: Scorecard · Depends on: SC-05
- Change: Add a `kellyFields` map to the overlay with the union of the design's two lists: portrait, phone and contact, verified page, campaign site, stances, money and votes (a measure, never a gate). Count only the fields that apply to each person: campaign site and money only for people with a campaign, votes only for voting members. Show per-field counts and the full-profile share.
- Code: `lib/coverage/checklist-map.json`, new `lib/coverage/people-coverage.ts`.
- Done when: live Admin shows "Officials and candidates with a full profile: N of M" for a sent place, with per-field counts.
- Retires: `scripts/kelly-scoreboard.mts`, `lib/hunt/kelly-depth.ts`, `KELLY_FIELDS` in `lib/ballot/hunt-state.ts`, `scripts/argue-absences-0825.mts`, `scripts/migrate-hunt-state.mts`, and the seven-day expiry and five-move "argued absence" proof rules in them.

**SC-12 · The mission map is handed to the coach and the national job**
- Lane: Scorecard · Depends on: SC-05
- Change: Export `openBlanks(placeKey)`: rows that apply, are due, are not satisfied and are not in progress, grouped by squad and then subject. Pass the blanks into the national place job so it skips families with nothing open. Delete the no-op `placeFieldWork` and `closePublishedPlaceWork`.
- Code: `lib/coverage/place-owed.ts` or `lib/control-plane/admin-view/place-owed-read.ts`, `lib/hunt/place-source.ts:54-55`, `lib/hunt/place-plan.ts:19-49,66-70`.
- Done when: a second national pass on a sent ZIP reads no sources for families with no open blanks, as shown in the attempt's progress note in Admin.
- Retires: `placeFieldWork`, `closePublishedPlaceWork`.

### Stage 5

#### Coach & Hunters

**CH-17 · Squads are sized to their parts, and hunters move to the gaps**
- Lane: Coach & Hunters · Depends on: CH-16, SC-12
- Change: Change the coordinator's fairness from one item per Send to round-robin over (Send, part), weighted by each part's count of open blanks and by how hard it has been (its recent share of detective turns and open failure debts), re-read every wave. Bigger and harder parts get more hunters. A part that empties stops getting turns.
- Code: `lib/control-plane/workers/coordinator.ts:405-428` (`fairAutonomousWorkIds`), `scripts/freshness-shadow.mts:3060-3072` (`orderPending`).
- Done when: live Admin shows hunter activity by part tracking open blanks and difficulty by part during a mission.
- Retires: fairness by Send only.

**CH-18 · Every blank has an owner**
- Lane: Coach & Hunters · Depends on: CH-16, SC-12, BX-07
- Change: After planning, list open blanks whose subject has no work, such as seat contacts, contests and deadlines. Create work for them with a new plan template for seats, contests and deadlines (they are not jurisdictions), using the family-to-door map and seed addresses from the held subject's source.
- Code: `lib/control-plane/workers/autonomous-plan.ts`, `lib/control-plane/expansion/dispatch-work.ts`, `lib/civic-data/worker-reader-contracts.ts`.
- Done when: a mission in a place never worked before shows zero open blanks with no owning work in live Admin.
- Retires: —

**CH-19 · A mission is done when its map is full and its doors refresh**
- Lane: Coach & Hunters · Depends on: CH-16, SC-05, SC-12
- Change: A Send is Done only when its places have no open or stale blanks (government-unpublished items count as resolved under the checklist rule) and every door it opened has a next scheduled read. Done never ends standing work, and a newly found owed row reopens the mission.
- Code: `lib/control-plane/assignment-completion.ts`, `assignment-read.ts`, `lib/control-plane/workers/autonomous-plan.ts:140-141`.
- Done when: a mission in live Admin flips to Done with its before-and-after owed counts, and reopens when a new body is found.
- Retires: "done" counted against registry obligations only.

**CH-20 · Hunters see the whole mission and can drop a finding for any part**
- Lane: Coach & Hunters · Depends on: BX-01, CH-16, SC-12, DP-21
- Change: Add to each Scout brief a compact list of the mission's open blanks for the same government and the governments above and below it, within the brief budget DP-21 owns. Add a `report_finding` tool that writes a finding to the Box at once: subject hint, field, value, exact quote, address and saved copy.
- Code: `lib/control-plane/workers/standing-runtime.ts:160-185`, `lib/control-plane/scheduler/scout-tools.ts`, `scout-contract.ts:310`.
- Done when: a live Scout working one government drops a finding for another subject into the Box, shown in Admin (published in BX-04).
- Retires: findings dropped because they belong to another part.

**CH-21 · Meetings discovery follows the mission map; the gap ledger is retired**
- Lane: Coach & Hunters · Depends on: SC-12
- Change: Feed meeting-calendar blanks for bodies in mission places into the existing dispatch-built discovery needs. Replace the ledger's use as evidence for retiring an obligation with "the body has a held calendar route" from owed rows. Then delete the ledger script, document and data file.
- Code: `scripts/freshness-shadow.mts:865-946` (`planMovedToGapLedger`, `materializedDiscoveryNeeds`), `lib/hunt/meetings-discovery.ts:36`, `lib/control-plane/scheduler/providers/meetings-discovery.ts:166-196`.
- Done when: a body in a mission in a state never worked before gets a discovery attempt in live Admin with no dispatch words, and no obligation retires without the new evidence.
- Retires: `scripts/build-gap-ledger.mts` (with its hard-coded pilots), `docs/gap-ledger.md`, `data/derived/gap-ledger.json`.

#### Box & Slide

**BX-05 · Nothing a reader needs is written only to local staging**
- Lane: Box & Slide · Depends on: BX-01, CH-23
- Change: Delete the research lane's staging writer. The one remaining reader, the campaign-site pass for Marginalia, reads from the Box instead. Rewrite the now-wrong header line in `pilot-runner.mts:12-18` ("Shadow research promotion stays OFF") in the same change.
- Code: `lib/control-plane/scheduler/promotion-tail.ts` (`stageOne`, `writeStagingManifest`), `scripts/freshness-shadow.mts:3277,3424-3516`, `scripts/autonomy-evidence.mts`, `scripts/pilot-runner.mts:12-18`.
- Done when: campaign sites keep publishing on the live site, and no code writes reader-relevant results only to `.runtime/control-plane/staging/`.
- Retires: the staging writer.

#### Doors & Bank

**DB-14 · Refresh requests and observability read the registry**
- Lane: Doors & Bank · Depends on: DB-13
- Change: Due requests, owner refresh and observability list doors from the registry instead of from code.
- Code: `lib/civic-data/routine-due-request.ts`, `owner-refresh.ts`, `observability.ts`.
- Done when: a door added as data shows FRESH, DUE or STALE in live Admin.
- Retires: their imports of the code door list.

**DB-16 · Allowed hosts come from each door**
- Lane: Doors & Bank · Depends on: DB-13
- Change: Check each requested address against the door's `hosts[]` instead of the hand-kept host list. Keep the rulings §3 rule that a vendor host counts when an official page links to it.
- Code: `lib/civic-data/source-authority.ts:407-470`, `lib/civic-data/derived-door.ts:195`.
- Done when: a door with a new host reads on the live runner with no edit to a host list.
- Retires: `routePrefixes` for `meetings-public-bodies`.

**DB-18 · The Tucson board portal reader becomes a general kind**
- Lane: Doors & Bank · Depends on: DB-17, DB-13
- Change: Express the 27 Tucson board routes as door records of a general board-portal listing kind, with the body ID in config, or reach them through the events-page or document-listing kinds if those cover them.
- Code: `lib/sources/clerksboards/`, `lib/registry/source-wiring.ts:11-38,585`, `lib/sources/composite/wiring.ts:172`.
- Done when: those boards' meetings still show on the live map, read through door records.
- Retires: `TUCSON_CLERKSBOARDS_ROUTES`, `TUCSON_OCD_ID` and the `CLERKSBOARDS` special case.

**DB-19 · The community college reader and the TUSD hook become general kinds**
- Lane: Doors & Bank · Depends on: DB-17, DB-13
- Change: Read the college's pages through the events-page and document-listing kinds, and the TUSD board through a general kind. Remove the hook inside the Diligent adapter.
- Code: `lib/sources/pima-edu/`, `lib/sources/tusd-govboard/`, `lib/sources/diligent/schedule-union.ts:7`, `lib/registry/types.ts:156,192,204`, `lib/sources/composite/wiring.ts:204`.
- Done when: those bodies' meetings still show on the live map through door records.
- Retires: the `PIMA_EDU` type, the `tusd-govboard` hook.

**DB-22 · Outcomes and votes come from door kinds, for any body on that platform**
- Lane: Doors & Bank · Depends on: DB-13, DB-07
- Change: Make outcomes a capability of two door kinds: Legistar API outcomes, and Legistar InSite minutes outcomes. A door with `holds: [MEETING, OUTCOME]` collects them. The election-date phase becomes data on the door. Then retire the two per-place outcome contracts.
- Code: `lib/sources/legistar/outcomes.ts`, `scripts/legistar-outcomes-ingest.mts`, `scripts/legistar-insite-minutes-ingest.mts`, `lib/civic-data/contracts.ts:404-480`, `lib/outcomes/ingest.ts`.
- Done when: Legistar bodies beyond the two that had their own contracts show results on concluded meeting cards on the live site, at the proof bar (see the rule above).
- Retires: `pima-legistar-outcomes`, `mesa-legistar-minutes-outcomes`.

**DB-29 · A fact past its refresh date is re-read, with no Send needed**
- Lane: Doors & Bank · Depends on: DB-28
- Change: When any fact behind a door reaches its refresh date, schedule a re-read of that door. Feed doors get a partition read. Page doors (rosters, contacts) get a plain re-fetch plus the existing value-on-page check, with no AI.
- Code: `lib/doors/registry.ts`, `lib/control-plane/promotion/section3.ts` (`valueOnPage`), `scripts/routine-civic-data-runner.mts`.
- Done when: a roster fact on the live site past its 30-day refresh date is re-checked on its own, and its "checked" date moves.
- Retires: stale non-meeting facts waiting for a Send.

**DB-31 · Overdue doors are listed**
- Lane: Doors & Bank · Depends on: DB-21, DB-28
- Change: List doors whose last successful read is older than their `checkEvery`, with how many live facts sit behind each one.
- Code: `lib/doors/registry.ts`, `lib/control-plane/admin-view/scoreboard-read.ts`.
- Done when: live Admin shows overdue doors with their fact counts.
- Retires: —

**DB-33 · A shut door gets a detective at once, wherever it is**
- Lane: Doors & Bank · Depends on: DB-32, DP-02
- Change: Add a scheduler provider for shut doors. It turns each shut door into an obligation whose failure debt carries the evidence: the door record, the last good bytes, the failure and the kind's Bank history. It does this whatever the current dispatch scope, because the door is already live, and ranks it first. The existing detective path then applies unchanged.
- Code: new `lib/control-plane/scheduler/providers/shut-doors.ts`, `lib/control-plane/workers/detective.ts:18-29`.
- Done when: the next real shut door gets a Detective attempt in live Admin in the next round (proved first on the synthetic door from DB-32).
- Retires: shut feed doors with no work created.

**DB-34 · Shut doors go to the top of the list, and repairs are recorded**
- Lane: Doors & Bank · Depends on: DB-32, BR-03
- Change: When a door goes shut:
  - put it at the top of the stuck list through the owner snapshot index, with how long it has been shut;
  - open a fix-list item automatically.

  When the door reopens, complete the item with what broke, what changed (the door record diff or the release commit), who, when it shut and when it reopened. Time to repair and the share of repairs needing no code come from these items.
- Code: `lib/control-plane/admin-view/v6-stuck-read.ts`, `scripts/publish-owner-snapshot.mts`, `lib/control-plane/fix-list.ts`, `lib/doors/registry.ts`.
- Done when: the next real shut door shows at the top of live Admin's list while shut, then as "Fixed and checked" with time shut and the change.
- Retires: a separate repair log (never built).

**DB-35 · A door is repaired by editing its record**
- Lane: Doors & Bank · Depends on: DB-09, DB-13, BR-03
- Change: Add a `door.update` gateway action: receipt, who, when, why, and undo to the previous record. It sets `readNow` so the next pass reads the door, and records the repair on the door's fix item. Detectives call it through a tool; Sean uses it from the queue row (this replaces the old `use-url` control).
- Code: `lib/control-plane/gateway/registry.ts`, `lib/doors/registry.ts`, `lib/control-plane/scheduler/scout-tools.ts`.
- Done when: on the synthetic door, an address edit publishes from the new address within one pass with no deploy and Undo restores the old record; then real moved doors are repaired by record edits at the proof bar (see the rule above).
- Retires: moved sites needing a code change.

**DB-56 · Starting a mission refreshes every door already known there**
- Lane: Doors & Bank · Depends on: DB-13, BR-08
- Change: Design §3 and §13.2: a place the factory already covers is refreshed in minutes, because its doors are known. When a mission starts, set `readNow` on every known door whose body or division is inside the mission's place, so feeds re-read them at once alongside the national place job.
- Code: `lib/control-plane/gateway/registry.ts` (`expansion.scope.set` effect), `lib/doors/registry.ts`.
- Done when: starting a mission in live Admin for a place with known doors shows those doors read again within the next publish-now and routine runs.
- Retires: —

#### Detectives & Proving

**DP-26 · A fix shows once when it proves out, then goes quiet**
- Lane: Detectives & Proving · Depends on: DP-23, BR-24, BR-14, BR-23
- Change: A fix in Testing is a queue row. Each status change writes one update: "Proven: worked in X places, failed in Y", "a lesson changed it", or "a proven fix broke". The fix then drops out of Admin. Add the "Proven fixes" Scoreboard row (proven count, and any proven fix that broke).
- Code: `lib/method/fix-status.ts`, `lib/control-plane/admin-view/updates-read.ts`, `scoreboard-read.ts`, `screen-queue.tsx`.
- Done when: in live Admin a fix appears in the queue while testing, produces one Proven update, and is then gone.
- Retires: the Fix list's learning statuses and running history.

**DP-28 · Lessons from losses: predict, build a variant, or call the engineers**
- Lane: Detectives & Proving · Depends on: DP-27, DP-03
- Change: Run the loss study after fix-map updates. On a shared trait:
  - write a lesson ("method M fails where T");
  - mark untried places with trait T as predicted to fail;
  - open one detective case to build a variant, which enters Testing as a new method.

  When nothing is shared, open a fix-list item for the engineers.
- Code: `lib/method/study-losses.ts`, `lib/control-plane/workers/standing.ts`, `lib/control-plane/field-manual.ts`, `lib/control-plane/fix-list.ts`.
- Done when: live Admin shows a lesson update naming the shared cause, and a variant in Testing.
- Retires: —

**DP-33 · Auditors check the team's own claims**
- Lane: Detectives & Proving · Depends on: DP-23, BR-24, DP-18
- Change: Each week, sample claimed wins and Proven labels. Recompute each number from source records (fix-map counts, spend ledgers, facts-live counts) and mark it confirmed or wrong. A wrong claim is a red flag in Admin and a lesson with its cause. Add the "Report accuracy" row.
- Code: new `lib/control-plane/workers/claim-audit.ts`, `scoreboard-read.ts`.
- Done when: the live Scoreboard shows "Report accuracy: X of K claimed wins confirmed", and a false claim fed to it in a controlled run, never shown to Sean as real, is caught.
- Retires: —

#### Front-end

**FE-14 · Ballot and money cards keep sources in their Sources section**
- Lane: Front-end · Depends on: FE-42, CP-16
- Change: Move the funding caption, measure footnotes, filing lines and candidate bio and contact source lines into Sources. Move the candidate contact block out of the Sources slot into the contact section. Remove the inline source and date line on the ballot's positions block. Reverse the ballot page rule that money and votes "cite themselves on the row".
- Code: `components/funding/funding-section.tsx:259-269,640,809`, `components/ballot/official-filings.tsx:18`, `filing-changes.tsx:15-17`, `candidate-card.tsx:189,204-209`, `candidate-contact.tsx:66,95`, `app/ballot/page.tsx:838-868`, `components/ballot/candidate-positions.tsx:109`.
- Done when: the live ballot and money cards on a phone show sources only under "Sources".
- Retires: inline citations on ballot and money cards.

**FE-25 · Pages are judged side by side with the best**
- Lane: Front-end · Depends on: FE-20, FE-24
- Change: Add a comparison mode. The reviewer sees our screen next to a reference and says which is better and why; a loss is a red flag. The reference set starts with our own best screens (Sean's likes); products people love to use are added to the reference set as data when Sean names them, and nothing waits on that.
- Code: `lib/frontend/look-review.ts`, `data/frontend/reference-screens/`.
- Done when: the live look pass shows comparison verdicts with both screenshots.
- Retires: —

**FE-33 · Every candidate shows the ten topics on the ballot, never hidden**
- Lane: Front-end · Depends on: CA-14, CA-15, FE-42
- Change: Replace the ballot's positions block with the same positions section as the person card, so every candidate shows the ten chips. Remove the logic that hides the section when nothing is held.
- Code: `components/ballot/candidate-positions.tsx:16-40`, `components/officials/positions-section.tsx`.
- Done when: in a live contest with one well-covered and one thin candidate, both cards show the same ten chips, and a chip with nothing found shows the plain line and what was searched.
- Retires: the hide-when-empty rule (old RULING 28/44/47 logic).

#### Scorecard

**SC-11 · Scores keep history, so trends show**
- Lane: Scorecard · Depends on: SC-07
- Change: Write per-place counts (numerators and denominators by family) into the owner snapshot, for places with an active scope only. Reuse the existing owed-list memo, and keep a fixed number of daily points per place.
- Code: `scripts/publish-owner-snapshot.mts`, `lib/control-plane/admin-view/place-owed-read.ts:120`.
- Done when: a sent place's card in live Admin shows an up or down arrow and the previous value.
- Retires: —

**SC-17 · Honest coverage tags on sold signal rows (as Sean decides)**
- Lane: Scorecard · Depends on: SC-07, SC-08 (waits on decision D7, which Sean has parked)
- Change: Apply D7 to the tier tags the signal writers put on rows: either re-tag from the new completeness and coverage numbers with a version bump and a `/transparency` line, or leave them as they are. Then retire the stale stamping path.
- Code: `lib/db/search-log.ts`, `ask-signal.ts`, `speak.ts`, `reactions.ts`, `lib/coverage/tier.ts`, `scripts/stamp-coverage-tiers.mts`, `data/derived/zip-coverage-tiers*.json`.
- Done when: new signal rows carry the tag D7 calls for, and the tag is described on `/transparency`.
- Retires: the stale coverage tier stamp.

#### Collects & Ask

**CA-54 · Budgets on the body card and in Ask**
- Lane: Collects & Ask · Depends on: CA-53, FE-13
- Change: The body card gets a Money section: the adopted budget with its fiscal year, operating and capital totals, revenue and spending by category, debt and the latest audit, with every source in the card's Sources section. Ask answers budget questions from the same records.
- Code: the body card from FE-13, a finance read in `lib/ask/`, `app/api/ask/grounded/route.ts`.
- Done when: at the proof bar, live body cards show the Money section and Ask answers "what is this government's budget" from it.
- Retires: —

### Stage 6

#### Admin

**BR-30 · The Scoreboard reads the Scorecard's honest measures**
- Lane: Admin · Depends on: BR-23, SC-07, SC-08, SC-09, SC-11
- Change: Rewire the Scoreboard rows to the Scorecard's measures: checklist completeness, freshness, public delivery, coverage, people coverage, trends, and mission progress since the mission started. Each gets one sentence and a direction ("Up from 31 last week · good").
- Code: `lib/control-plane/admin-view/scoreboard-read.ts`, `screen-scoreboard.tsx`.
- Done when: the live Scoreboard shows those rows with counts, trend and a sentence each.
- Retires: the interim place-score row.

**BR-32 · Door numbers on the Scoreboard**
- Lane: Admin · Depends on: BR-23, DB-27, DB-31, DB-34
- Change: Add the door rows to the Scoreboard:
  - shut doors now, with how long each took to reopen;
  - posted-to-live against the one-hour target inside the 7-day window;
  - overdue doors;
  - time to repair;
  - repairs needing no code.
- Code: `lib/control-plane/admin-view/scoreboard-read.ts`.
- Done when: the live Scoreboard shows each row with real values.
- Retires: —

#### Box & Slide

**BX-04 · A finding about someone else reaches their card**
- Lane: Box & Slide · Depends on: BX-02, CH-20
- Change: Route a Box finding whose target subject differs from the hunter's to the door for that subject, using the family-to-door map, with the same checks.
- Code: `lib/control-plane/workers/scout-extraction.ts`, `lib/civic-data/worker-reader-contracts.ts`.
- Done when: a live hunter working one government produces a published fact on another subject's card.
- Retires: —

**BX-11 · Local votes are linked to the people who cast them**
- Lane: Box & Slide · Depends on: DB-22, CP-09
- Change: Add a `local-votes` worker door that joins each vote's person to the published roster member on the same body, checked against the vote minimum.
- Code: `lib/civic-data/worker-reader-contracts.ts`, `lib/outcomes/types.ts`, `lib/ask/person-votes.ts`.
- Done when: a mayor's live card shows "voted Yes on item X" from minutes, with its source.
- Retires: local votes joined to people by name strings only.

#### Doors & Bank

**DB-15 · Reader coverage and curated-body status read the registry**
- Lane: Doors & Bank · Depends on: DB-14
- Change: Reader-side coverage and the curated bodies' live status read the registry projection.
- Code: `lib/registry/` coverage and curated-body status readers, `lib/coverage/`.
- Done when: those reader surfaces on the live site are unchanged with the code list unused.
- Retires: the last reader-side imports of the code door list.

**DB-36 · A door edit is applied at once, not on a six-hour clock**
- Lane: Doors & Bank · Depends on: DB-35
- Change: When a door record is edited, run the crosswalk and wiring derives for that one door at once, instead of waiting for their six-hour clocks.
- Code: `lib/civic-data/contracts.ts:545-575` (derive contracts), `scripts/derive-meeting-source-wiring.mts`, the crosswalk derive.
- Done when: a derived door edited in live Admin is read on the next pass.
- Retires: the six-hour clocks as the only trigger.

#### Detectives & Proving

**DP-12 · A detective's door repair is used on the very next check**
- Lane: Detectives & Proving · Depends on: DB-35, DP-02
- Change: When a detective result on a failing door has a candidate whose saved bytes ground the required fields, write it at once as the door's new record through `door.update`, labeled Testing. The fix-spreading step (DP-24) then tries it elsewhere.
- Code: `lib/control-plane/workers/detective.ts:196-209,319-321`, `lib/doors/registry.ts`.
- Done when: doors with changed addresses on the live runner are read by plain code on their next check after one detective find, with no further model cost, at the proof bar (see the rule above); the first one is usable and labeled Testing.
- Retires: waiting for a second independent attempt before a repaired route is used.

**DP-29 · Every kind of loss is studied**
- Lane: Detectives & Proving · Depends on: DP-28, DB-32, DP-14, FE-21
- Change: Feed the other loss kinds into the same study: shut doors, empty hunts (absences), checker failures (hold codes), auditors' red flags and front-end red flags (including a red that repeats across places).
- Code: `lib/method/study-losses.ts`, the loss sources listed.
- Done when: live Admin shows lesson updates from at least three loss kinds.
- Retires: —

**DP-30 · Every door and fix keeps its history**
- Lane: Detectives & Proving · Depends on: BR-03, DB-34, DP-20
- Change: History is the fix-list items for a door or method in order: when it broke, how it was fixed, how long it held, and when it broke again. Write a fix-list item when a method goes from working to failing in a place. No separate history log.
- Code: `lib/control-plane/fix-list.ts`, `lib/method/fix-map.ts`, `lib/control-plane/admin-view/fix-prevention-history.ts`.
- Done when: a door that broke twice shows two episodes with how long each fix held in live Admin.
- Retires: one-episode-only debt rows as the only memory.

#### Collects & Ask

**CA-43 · The people layer updates when someone leaves or a seat changes**
- Lane: Collects & Ask · Depends on: DB-29, CA-42
- Change: When a roster re-read shows a departure, record it, show the seat as vacant until it is filled, and add any special-election contest to the place's owed list. The person's voting record stays with them.
- Code: `lib/civic-data/worker-roster-publication.ts:104-110`, `lib/hunt/roster-page.ts`, `lib/coverage/place-owed.ts`.
- Done when: a departed official's seat shows as vacant on the live site after the next re-read, with their votes still answerable in Ask.
- Retires: —

#### Front-end

**FE-22 · A check that sources never leak onto card faces**
- Lane: Front-end · Depends on: FE-12, FE-14, FE-15, FE-16
- Change: Add a page measurement that flags a source host name or "read <date>" outside a Sources section on any card. Update `tests/card-sources.test.ts` for the new card classes.
- Code: `lib/health/page-metrics.ts`, `tests/card-sources.test.ts`.
- Done when: the live look pass reports zero leaks across sampled places.
- Retires: —

#### Scorecard

**SC-19 · Time from mission start to core information live**
- Lane: Scorecard · Depends on: SC-10, SC-11, BR-23
- Change: Design §3 target: a county's core resident information live within an hour of the mission starting. Define "core" as a setting listing the core items (starting value: the county and city governments and their bodies, every seat's holder, and each body's next meeting). Measure the time from the mission's `expansion.scope.set` receipt until those items first reach their counts, and add it as a Scoreboard row per mission.
- Code: `lib/coverage/place-owed.ts`, `lib/control-plane/admin-view/scoreboard-read.ts`, `lib/control-plane/settings.ts`.
- Done when: the live Scoreboard shows, for each recent mission, the time from start to core information live.
- Retires: —

### Stage 7

#### Doors & Bank

**DB-20 · Door membership is no longer code**
- Lane: Doors & Bank · Depends on: DB-15, DB-16, DB-18, DB-19
- Change: Delete `SOURCE_WIRING` as membership, with its firewall and test pins. Keep the `BodySourceWiring` type as the adapter input shape.
- Code: `lib/registry/source-wiring.ts`, `lib/civic-data/firewall.ts`, `tests/meeting-wiring-authority.test.ts`.
- Done when: every meeting door on the live site reads from the registry, and adding or repairing a body is a data edit.
- Retires: `SOURCE_WIRING` (2,630 lines of code doors).

#### Detectives & Proving

**DP-25 · Proof means working in many places, not two attempts on one address**
- Lane: Detectives & Proving · Depends on: DP-23, DP-24, DP-12
- Change: Retire "two attempts offered the same route ID" as proof that a method works. A per-place door entry is still used the moment it works once.
- Code: `lib/control-plane/scheduler/scout-candidates.ts:176-258`, `lib/method/manual-bridge.ts:30-40`.
- Done when: a method's label in live Admin comes only from the fix map and the bar.
- Retires: two-attempt graduation as proof.

**DP-31 · A repeat break starts from what fixed it last time**
- Lane: Detectives & Proving · Depends on: DP-30, DP-02
- Change: When a door breaks again, put its last successful fix at the top of the detective's brief, and try that fix first in plain code before any model call.
- Code: `lib/control-plane/workers/detective.ts` (`sourceFailureRecovery`, `detectiveExecutor`), `lib/control-plane/fix-list.ts`.
- Done when: a repeat break on the live runner is fixed by plain code from history with no model cost.
- Retires: —

**DP-32 · Patterns in when doors break are learned**
- Lane: Detectives & Proving · Depends on: DP-30
- Change: Add a simple pattern pass: the same door breaking in the same month across years, or right after a known event, writes a lesson so the next fix is ready first. It only pays off once history builds up.
- Code: `lib/method/` (new pattern pass), `lib/control-plane/field-manual.ts`.
- Done when: live Admin shows a pattern lesson for a door with repeated breaks.
- Retires: —

**DP-34 · A green "Proven" means still working today**
- Lane: Detectives & Proving · Depends on: DP-30, DP-23
- Change: Before keeping a Proven label, check that the fix map's recent results still pass the bar; if not, show "Proven, broke since" and bring it back as an update.
- Code: `lib/method/fix-status.ts`, `lib/control-plane/admin-view/updates-read.ts`.
- Done when: a proven fix that breaks on the live runner shows "Proven, broke since" and returns to the queue.
- Retires: —


---

## Retire list

Each item names the step that removes it. Nothing here is removed before its replacement works for readers.

### Gates, ceremonies and approval steps
- Method-candidate authority startup check, its seed and adoption digest: **DP-01**
- Pre-publication planted-control AUDITED stage for campaign sites: **CP-11**
- Campaign-site "independent second signal": **CP-12**
- `ACTIVATION_GATE`, `classFieldOpen`, the `RECORD_CLASS_CANDIDATE` burden, the candidate-enrichment field restriction: **CP-13**, **CP-14**
- Research meeting fact chain (`fact-chain.ts`, `production-meetings.ts`, activation receipts in `meeting-research-evidence.ts`, `routine-meeting-intake.ts`) and the `AUDIT_NOT_RECORDED` bottleneck code: **CP-15**
- `REVIEWED_INPUT` / owner-invocation-only mode, with `manualReceiptPromotion` review authorities, for:
  - `venue-resolutions`: **BX-09**
  - `candidate-profiles`: **CA-17**
  - `officeholder-statements` and `candidate-corpus`: **CA-18**
  - `az-sos-ballot` and `nh-curated-ballot`: **CA-32**
  - `az-official-actions`: **CA-19**
- Owner-invoked-only refresh of the Congress roster, roll calls and key votes: **DB-08**
- "Go fix these" dispatch click, the `fix-go` kind, the fix queue's dependence on `pnpm owner:decisions:pull` / `decisions:apply`, `planFixQueue`: **BR-04**
- `/api/admin/decision` and the local decision sync for decisions: **BR-20**
- Unowned blockers routed to "Needs your decision" (`NOBODY → decision`): **BR-09**
- Two-attempts-on-one-route-ID as proof a method works: **DP-25**
- Blanket two-publisher rule for portraits (keeps the second source only for portraits not from the person's own page): **CP-10**
- Blanket Ask refusal of exact quotes (`UNVERIFIED_PERSONAL_STANCE` for verbatim passages): **CA-12**
- `NOT_OFFICIAL_SOURCE` refusal and the official-only filters in `heldPageCopies` / `capturesForPublication`: **CP-02**, **CP-03**
- `isOfficialHost` and "vendor portal is not official": **CP-04**
- Open States retirement machinery (`RETIRED_INTERMEDIARY_*`, `mayReadRetiredPluralRoster`, `routineAutoPromotion: false` and the three-state list on `plural-openstates`): **CA-01**
- The RULING 125 localhost refusals in the walk, visual, reader and admin harnesses: **FE-01**
- The hide-when-empty positions logic on the ballot: **FE-33**

### Code and modules
- `runDetective`, `DetectiveTaskSpec`, `AutonomousWorkPlan.detective` and their branches: **DP-05**
- Paid detective walks on passing outages (`sourceFailureRecovery` on transient causes): **DP-02**
- The infinite-spend path in `admissionSpendUsd`: **CH-02**
- The browser-only order rows and the history MISSING strings: **BR-01**; the projection parity triggers' "unproven scope" rule: **BR-36**
- The follow-up cutoff in `followUpDelayMs`: **BR-02**
- The fix queue's decision-log store: **BR-03**
- The 17 dead Admin controls and "Tell it what to do" (`instruction.ts`, `instruction-draft.ts`): **BR-07**; `config.setApiFallback`, `fleet.retryWorkItem`, unannounced `workRows`/`decided`, unused Admin API routes (`checklist-definitions`, `checklist-instances`, `deploy-preview`, `public-reader-observation`, `runner-progress`, `work-progress`): **BR-35**
- `LANE_MEANS`, enforcement paragraphs on receipt faces: **BR-10**
- The 7-chip receipt lifecycle: **BR-12**
- The five scattered order/stuck lists and the separate Fix list page: **BR-34**
- The 15-card Now stack: **BR-25**
- The "Is it learning" view (folded into the Scoreboard): **BR-23**; the Fix list's learning statuses and running history: **DP-26**
- The reader-reports-only Reports view: **BR-27**
- Building the whole runtime for every task: **CH-06**; per-task full-history loads in lease workers and the coordinator: **CH-26**
- The 15-minute paid dispatch slice and the wave loop: **CH-27**
- The 12-walks-per-round discovery cap: **CH-08**
- Three full vault indexes per round: **CH-09**
- The registry-lane Scout path (`scoutFor`, `runCycle` research options): **CH-23**
- The research-lane staging writer (`stageOne`, `writeStagingManifest`): **BX-05**
- No-op `placeFieldWork` / `closePublishedPlaceWork`: **SC-12**
- Checklist census, census index publisher, `/api/admin/v6/checklist`, owner-snapshot `checklists` field, `checklist-timings.ts`, `evaluateChecklistSnapshot`: **SC-15**; readiness snapshot and its runner entry, `readinessSnapshots` repository, dead ZIP planners: **SC-18**
- The second percent formula in `dispatch-work.ts`, duplicate `GROUP_NAMES` maps: **SC-03**
- Kelly scripts and lists (`kelly-scoreboard.mts`, `kelly-depth.ts`, `KELLY_FIELDS`, `argue-absences-0825.mts`, `migrate-hunt-state.mts`): **SC-09**
- Coverage tier stamping (`lib/coverage/tier.ts` stamping, `stamp-coverage-tiers.mts`, `zip-coverage-tiers*.json`): **SC-17** (per D7)
- `reopenConclusions` (no caller): **DP-10**
- `auditCoverageReport` as an uncalled function: **DP-18**
- The manual `meeting-body-crosswalk` contract: **DB-24**
- `scripts/field-manual-seed.mts` as the way playbooks reach agents: **DB-44**; role prompts as TypeScript strings: **DB-42**, **DB-43**
- The single `cp_field_manual/live` document (only if write errors appear): **DB-39**
- Drain-everything-then-restart releases: **DB-53**
- Ripcords as environment variable plus redeploy: **DB-46**
- `/api/positions/[subject]/[topic]` as a separate answer engine: **CA-14**
- Candidate portraits as committed files under `public/candidates/`: **CA-08**
- Static per-state plain-English files: `body-definitions.ts`, `form-definitions.ts`, `office-blurbs.ts` as content, `body-blurbs.json`: **CA-29**; `measure-summaries.json`, `measure-provisions.ts`, `notice-summaries.json`, `minutes-summaries.ts`: **CA-50**
- The "nothing is summarised" stance on agendas: **CA-28**
- Closed kind unions (`DivisionType`, `BodyClass`, `OfficeType`, `SnapshotKind`): **CA-38**, **CA-09**
- The second, framed topic list `CANDIDATE_ISSUES`: **CA-10**
- `mw.module.css`, the `/readiness` Admin prefix: **FE-38**
- The median verdict in `measure-load.mts`: **FE-02**
- The roughly 51 dated one-off shot and walk scripts: **FE-40**
- Visual diagnostics written to the unread `pilot-health` store: **FE-21**
- Five separate meeting row renderers, two person card shells, the tabbed body card: **FE-12**, **FE-11**, **FE-42**, **FE-13**
- One pull request and merge per session, and pull requests waiting on auto-merge: **RL-02**, **RL-03**
- The every-three-hours full check: **RL-04**
- One-at-a-time adapter merges in `engineer-adapter-merge.yml`: **RL-06**
- Batch-by-default for work a reader is waiting on: **BX-13**
- One process per hunter: **CH-28**
- Refusals by our own spending guard counted as failed attempts: **CH-29**
- Work thrown away when the AI service doesn't answer: **CH-30**
- Code names on Admin screens: **BR-39**
- Full source sweeps for document-only changes: **RL-07**

### Rules in code that the design replaces
- Deletion of concluded meetings at 90 days (`OUTSIDE_REGISTERED_SERVING_WINDOW` against the 90-day contract): **DB-01**; the history it already deleted is restored in **DB-55**
- Worker publication and changed-door reads waiting for the five-minute routine pass: **BX-12**, **BX-03**; full meeting reads running one after another inside the routine pass: **DB-58**
- "The fetch window IS the served window" in every adapter: **DB-02** to **DB-05**
- "Online sittings are never pinned" (`online.ts`, `venues.ts`) and walk check `[g10]`: **FE-34**
- `MAX_ADDRESSES_PER_PASS = 20` and the ZIP-required geocode match: **BX-08**
- Fixed 30-day absence hold (`ABSENCE_EXPIRY_DAYS`): **DP-11**
- Constant audit sample policy (`DEFAULT_AUDIT_SAMPLE_POLICY`): **DP-17**
- Hard-coded `earnedPortability` bars: **DP-23**
- Meeting windows and check timings as code constants: **DB-45**
- "Never backfilled from a campaign account" social rule and the hard-coded platform lists: **CA-04**
- `filedAddress` on reader surfaces and in Ask (old RULING 54 behaviour): **CP-01**
- Money disclaimer sentences: **CA-44**; computed share sentences: **CA-45**
- Alternative empty-state sentences, `NoValue` "not recorded" / "not yet", ballot disclaimers and the covered-county list: **FE-29**, **FE-30**
- Reader copy as code only: **FE-32**
- "Neither ships" measure wording and three-state scope labels: **CP-17**
- Stale comments and gate-like reasons (`DISPATCH_WORK_WRITE_BUDGET`, "must pass audit before publication", "review-gated" adapters, the two-kind crosswalk header): **CH-14**; the "Shadow research promotion stays OFF" header, once it stops being true: **BX-05**

### Hard-coded places and per-place code
- `ORIGINAL_LIFETIME_HUNT` and every privilege tied to it (blackout exemption, budget precedence, billing attribution, admin-bridge runner, registry branch, snapshot census): **CH-10**
- `originalOnly` producers, the Cochise branch, `COCHISE_VOTE_CENTERS_URL`, `--cochise-only`: **CH-11**
- Pilot-ZIP band in Scout ordering (`PILOT_JURISDICTION_KEYS`, `bandFor`, `orderingInputs.pilotZips`): **CH-12**
- `JURISDICTION_REFERENCE_STATES` as a code list: **CH-13**
- The gap ledger with its hard-coded pilots (`build-gap-ledger.mts`, `docs/gap-ledger.md`, `gap-ledger.json`): **CH-21**
- `SOURCE_WIRING` as membership: **DB-20** (after **DB-12** to **DB-16**); `routePrefixes` host list: **DB-16**
- `TUCSON_CLERKSBOARDS_ROUTES`, `TUCSON_OCD_ID`, the `CLERKSBOARDS` special case: **DB-18**
- `PIMA_EDU` type and the TUSD hook in the Diligent adapter: **DB-19**
- `pima-legistar-outcomes` and `mesa-legistar-minutes-outcomes` (and the one-county outcome union evidence): **DB-22**, **DB-07**
- `lib/hunt/meetings-route-hints.ts` (25 per-place hints): **DB-23**
- `KNOWN_PLATFORMS` as code: **DB-41**
- `BALLOT_SOURCES`, `BALLOT_AUTHORITY_STATES`, one-county `nj-morris-filing` contract: **CA-32**
- `STATE_CAMPAIGN_FINANCE_SOURCES`, `PIMA_LOCAL_FINANCE_CONTRACT`: **CA-21**
- Hard-coded district candidacies and per-place finance routes: **CA-34**
- One-county FEC target read: **CA-20**
- Per-place voting-site lists: **CA-35**
- Curated rosters and statewide officers in TypeScript (`body-rosters.ts`, `rosters-nj-morris.ts`, `cawcd-rosters.ts`, `statewide-executives.ts`): **CA-47**; `curated-bodies.ts`: **CA-48**
- `PILOT_ZIP_POINTS` and place-specific warm preloads: **FE-03**
- `QUICK_ZIPS` pilot buttons: **FE-39**
- Walk ZIPs fixed to four places: **FE-18**

---

## Rulings to update (decided by Sean, Oct 3)

These are Sean's decisions of Oct 3, written as the changes to `docs/rulings.md`. Each names the section, what it says now, and the new wording. Items 1 to 7 change something the rulings say today. Items 8 to 10 settle wording. Items 11 to 22 add things the rulings don't cover yet. Each change is recorded in the file as (Sean, October 3, 2026).

1. **§3, portraits.** Now: a second, independent source is required for portraits. New: a portrait from an official source publishes on its own. That means any official site under §3, such as a .gov page, and the official account of the person's office on a social platform. A portrait from the person's own campaign site also publishes on its own. A portrait from anywhere else, including a personal social account, needs a second matching source. There is no review step. A campaign site whose own page names the candidate, the office and the cycle is enough to tie it to the candidacy, and auditors sample afterward. Matching the same person across other sources stays a judgment call.

2. **§3, sources that disagree, and §6, contradictions.** Now: the official value replaces a non-official one, and a contradiction holds back the facts in dispute. New: official beats non-official, as now. Between two official sources, the newer one wins and goes live at once. The losing value is logged. A disputed fact never waits.

3. **§4, meeting coverage.** The checks stay word for word: twice daily, and hourly within 60 minutes for bodies with a meeting in the next seven days or one concluded in the previous seven. Add: inside that seven-day window, anything a body posts (an agenda, a result, a cancellation, a change of time or place) is live on the site within an hour of posting, by the next hourly check. Outside the window, the twice-daily check picks it up. Meetings are held 120 days back and ahead and shown 90 days each way. Checks are plain code with no AI cost. The windows, the check timings and the one-hour target are Admin settings that may go faster, never slower.

4. **§2, request pacing.** Now: "ten-requests-per-website cap" with no time period. New: ten requests per website per hour, for small local governments under 10,000 population and school districts under 5,000 students. Everything else is read at full speed, as now.

5. **§0, Polarization Research Lab.** Add: PRL's measurements, such as how much of a person's posting is about policy and how much is attacks on opponents, show on person cards credited to PRL in the Sources section. Meanwhile never scores, rates or labels anyone itself. Sean picks key votes himself and keeps them current; they stay on person cards alongside the full voting record. PRL's licence covers every place (Sean, Oct 3).

6. **§0, "No new gate, proof step, certification, ledger or scoring system without Sean's approval," and §10, "No agent points or scoring system is needed."** Both stay word for word. Add that Admin's own measures and labels are approved, because they never stand between a verified fact and readers. That covers:
   - how much of a place is captured;
   - the Scoreboard rows, including the accuracy of the team's own reports;
   - the Proven, Testing and Expected labels on the team's methods and fixes;
   - auditors checking the team's claimed wins;
   - the look at the live page before a change is called done.

   The Box, the Door Registry, the fix list, order tracking, the queue, the settings log with undo and the daily brief are approved parts of how the factory runs. None of them may hold back publishing.

7. **§1, "Build general capabilities without preparing a specific test ZIP."** Stays word for word. Add the reason: nothing aimed at a place about to be tested may slip into the code or the data ahead of time, because it makes speed on new places look better than it is. Trying a general method or fix on places picked by kind of source or at random is not preparation. Picking places because they are next in line is. Paid tries happen only inside places Sean has sent the factory to.

8. **§10, reader copy for empty sections.** Add: a stance topic that a full, equal-effort search came up empty on says "Not found in the sources checked", with what was searched in the card's Sources section. Every other empty section keeps "We're working on getting this info". A "not posted yet" line shows when the government hasn't published something yet, such as an agenda.

9. **§8, what comes to Sean.** New: Sean makes the large decisions:
   - what Meanwhile covers;
   - what it shows readers;
   - what it collects and sells;
   - spending beyond the agreed budget;
   - credentials, contracts, and any new outside vendor or paid service.

   The team makes every decision about how: which source, method, order, door or fix. Everything else is done and reported as an update labeled Proven, Testing or Expected. New acquisition routes still need no approval, and a new kind of door or government-site reader is team work.

10. **§0, the test "Does a verified fact reach readers within minutes."** Stays word for word. It measures how fast a verified fact goes live. The one hour in item 3 measures from a body's posting to live inside the seven-day window. Both apply.

11. **§0, the resident picture.** Now: meetings shown "on a map and a rolling 90-day calendar". New: meetings are held 120 days back and ahead so Ask and search can use them, and shown 90 days each way on the site. Votes, outcomes, minutes and what people said are kept for good, so a reader can ask how someone voted years ago.

12. **§0.4, Admin.** Add:
    - Sean decides what, whether, how and when. He starts missions, shifts focus, pauses or stops anything, and gives orders now, at a time, by a date, after another order or repeating, with a control or in plain words.
    - Every order is tracked Received → Accepted → Scheduled → In progress → Done, and one that can't be done says why at once.
    - There is one queue.
    - A daily brief carries wins, problems and decisions. For now there are no alerts: concerns go in the daily brief, and an alerts switch exists and stays off until Sean turns it on.
    - Every settings change shows when it changed, its value before, and an undo. It names who made the change only when the factory made it.

13. **§2 and §3, dead ends.** Add: a detective marks a true dead end, records what would unlock it, and brings it to Sean when only a person can unlock it. The blank stays open, and the route reopens when its unlock appears. How long a dead end waits before another try follows how often the source changes. While the factory is expanding, no dead end waits more than 5 days.

14. **§3, the State Run Checklist.** New: the checklist is the scorecard for everything the factory does until Sean changes it.
    - It defines each mission's map, and its families decide the squads.
    - Each blank carries six statuses.
    - Completeness, coverage, freshness and delivery are reported separately, as bars in Admin, not text.
    - New finds join with a date, one line each in the daily brief.
    - Its own run ceremony (frozen manifest, single launch owner, the 20-attempt/$10 stop) is replaced by Sean's orders and the budget dial already in Admin.
    - It never holds back publishing.

15. **§3, minimums.** Add the minimums not yet written down:
    - map pin: a live meeting and a published address; an online-only meeting is pinned at its body's published address, marked online only, with the join link;
    - candidate: name as listed, the contest and the source, with every candidate in a contest going live together;
    - ballot measure: election, number or title, a link to the official text, and the source;
    - vote: person, what was voted on, how they voted, date and source;
    - stance: an exact quote with source and date; a paraphrase needs a second source;
    - portrait: as in item 1;
    - money: candidate or committee, amount, period, and a link to the filing.

    The Kelly standard (the full profile) is what the factory strives for and measures. It is never a gate.

16. **§3, map pins.** Add: an online-only meeting is pinned at its body's own published address, clearly marked online only, with the join link on the pin.

17. **§3, the Sources section.** Add: sources live only in the Sources section of the card they belong to: ballot, person, battle, body and meeting cards. They never repeat across the face of a card, including source-kind labels and "read <date>" lines. The Sources section shows when each source was last checked.

18. **§5, "Plans carry no durations or dates."** Add: this applies to agents' plans. Sean's orders may carry a start time, a finish-by date or a repeat.

19. **§9, "Reader data never needs a software release to go live."** Add: doors, playbooks, settings, labels and help text are also edited as data, with a log and undo, and take effect without a release or restart. Information reaches readers as fast as it is verified.

20. **§9, privacy and money on reader pages (new lines).**
    - Public office and campaign addresses only, never anyone's home. Candidates' filed mailing addresses are not shown on reader pages or in Ask. This replaces old RULING 54.
    - Money is reported as the filings state it and never characterized. Committees, PACs and organizations show by filed name.
    - Individual donors are never named. Their money shows as totals, plus one share: how much of a person's individual money came from donors giving $200 or less in the cycle, for example "62% of individual money came from donors giving $200 or less". It comes from the filings' own lines for small and large donors.

21. **§5 and §9, how code ships (new).** Code reaches `main` a couple of times a day as one combined, tested change, not one pull request per session. Sessions work on their own branches in the cloud. A merge session folds them together and tests the result, and the combination merges to `main` as one pull request. Data, settings, doors and playbooks still go live with no release.

22. **§10, Admin and reader copy.** Add: Admin is plain English throughout. No code names, error codes, IDs or raw technical text appear on any Admin screen; technical detail sits behind a "Technical details" link. Admin is never a wall of text.

No rulings change is needed for RULING 125 (the localhost lock). It is historical and already superseded by §6 and CLAUDE.md; FE-01 removes it from code.

---

## Decisions only Sean can make

All answered except D7, which is parked. None of them changes the rulings.

- **D1:** PRL's measurements show, credited to PRL, and Sean's key votes stay (CA-46).
- **D2:** PRL's licence covers every place, so PRL runs for every Send (CH-11).
- **D3:** individual donors are never named; totals plus the small-donor share (CA-45).
- **D4:** the text of social posts comes from PRL's collection, with no paid platform (CA-40).
- **D5:** ten requests per website per hour for small governments (DB-26).
- **D6:** yes to a rollback button in Admin, using the existing Netlify token if its scope allows (DB-47).
- **D7:** coverage tags on sold data rows. Parked by Sean; SC-17 waits.
- **D8:** no real-reader timing. Speed is measured by our own regular test visits (FE-27).

---

## Coverage matrix: design section → steps

| Design section | Steps that deliver it |
|---|---|
| §1 The mission comes first (work backward; speed default; nothing built for one place; proven on many places; mission at the front of every role) | BR-08, SC-12, CH-15–CH-19, BX-02, BX-03, BX-12, CH-10–CH-13, CH-21, DB-18, DB-19, DB-22, DB-23, CA-21, CA-32, CA-34, CA-35, CA-47, CA-48, FE-03, FE-39, FE-30; the proof-across-places rule on every door, method, feed and fix step (DP-23 sets the bar) |
| §2 The foundation: it just works | FE-01–FE-42 (including the glass-like polish in FE-10 and FE-19), DB-01–DB-05 and DB-55 (held 120, shown 90, history restored), DB-26 and BX-12 (one hour), FE-43 (the homepage without the map), DB-51 + FE-28 (dead links), CA-49 (Ask speed), FE-04 (ballot speed), FE-21 (tested on the live page) |
| §3 What it does, and the targets | Mission and squads: BR-08, CH-15–CH-20. Box, builders, Slide: BX-01–BX-06, BX-12. Doors: DB-09–DB-36, DB-54–DB-58. Targets: county core within an hour → CH-05, CH-17, CH-24, measured by SC-19; covered place refreshed in minutes → DB-56, DB-26, DB-29; nothing goes stale → DB-29, DB-31, DB-32; within an hour → DB-26, DB-27, BX-12, BX-13; everything about people → CA-01–CA-17; exact sentence → CP-05; facts per hour → BX-06, BR-31; instant site → FE-02, FE-04, CA-49; scored on the checklist → SC-01–SC-19 |
| §4 The team at a glance | Each role maps to a lane: Admin → Admin; Coach and Hunters → Coach & Hunters; Box and Builders → Box & Slide (plus Collects & Ask for people, money and ballot builders); Checkers and Live site → Checkers & Publishing; Detectives and Auditors → Detectives & Proving; Back-end engineers → Doors & Bank; Front-end developers → Front-end; Scoreboard measures → Scorecard. No step of its own. |
| §5 Working backward from the end | This document's chain section; mission map and "done" in SC-12, CH-19 |
| §6.1 Knowledge Bank | DB-09 (Door Registry), DB-54 (page doors), DB-37–DB-41, DP-07, DP-08, DP-19–DP-22, DB-28 (facts tied to doors). Federal→state→local by place already works (registry runtime) |
| §6.2 Coach | SC-12, CH-04, CH-15–CH-19 (CH-17 sizes squads by gaps and difficulty), DP-21 (head starts per place), BR-08 |
| §6.3 Hunters (squads) | CH-06, CH-07, CH-20, CH-22–CH-27, BX-01, DB-40, DB-54 (the registry grows with every mission), DP-07. Every tool already works (Scout toolkit and 11 keyed APIs) |
| §6.4 The Box | BX-01, BX-02, BX-04, BX-05, CH-20 |
| §6.5 Builders | BX-02, BX-08–BX-11, CA-03–CA-08, CA-11, CA-17–CA-19, CA-21–CA-25, CA-31–CA-34, CP-07, CP-08, CP-16, CP-18 (duplicates merged, conflicts flagged). PDFs and scanned agendas already work (OCR is installed on the runner) |
| §6.6 Checkers | CP-19, CP-02–CP-10, CP-18, DP-03, BX-03, BX-12 |
| §6.7 Live on the site | FE-11–FE-15, FE-42, FE-34, FE-35, CA-12, CA-14, CA-30. Pages read only finished records: already works, and settings reach pages through the reader edge (BR-05) |
| §6.8 Detectives | DP-02–DP-12, CH-07, DB-33, DB-35, DB-42 (archived copies of old pages as a route) |
| §6.9 Auditors | DP-13–DP-18, DB-51 |
| §6.10 Back-end engineers | DB-09–DB-36, DB-45–DB-58, BX-12, CH-02, CH-03, CH-08, CH-09. Keyed services as hunter tools already work |
| §6.11 Front-end developers | FE-01–FE-42 |
| §7.1 What, whether, how, when | BR-08, BR-22, BR-14 (stop or pause any row), BR-21, BR-05, BR-06, BR-15–BR-19, BR-37 |
| §7.2 Every order confirmed and tracked | BR-01, BR-02, BR-36, BR-12, BR-13, BR-16, BR-37 |
| §7.3 Never a wall of text | BR-39 (plain English, no code names), BR-07, BR-10, BR-25, BR-35, FE-37, FE-38 |
| §7.4 The queue | BR-14, BR-34, BR-03, BR-04 |
| §7.5 Progress | BR-38, BR-23, BR-30, BR-31, SC-11, SC-19, CH-15, CH-16 |
| §7.6 The team runs the factory | BR-09, BR-04, BR-20, BR-24, DP-24 |
| §7.7 Reports | BR-27, BR-28, BR-37, BR-20 |
| §7.8 Alerts and questions | BR-29 (built with a switch that starts off; issues go in the daily brief); Ask Admin is partial: BR-26 and BR-31 add the design's two example questions, and further topics are added the same way |
| §8 The scorecard | SC-01–SC-19; it never holds back publishing (already true) |
| §8.1 How the factory uses it | Mission map SC-02, SC-04, SC-12; squads CH-15; six statuses SC-05; separate measures SC-07–SC-09; new finds SC-10, CA-39; Admin runs it SC-14, BR-33, BR-08, SC-02 (GATE-01/13 replaced) |
| §8.2 Where each part lives | SC-20 (coverage by kind of fact); ACQ/REC/PUB/ASK readiness SC-16; ACQ-10 shut-door alarm DB-32–DB-34; PUB FE lane; ASK CA-12, CA-14, CA-36, CA-49; SAFE CP-01 and §18 steps; GATE as health checks SC-13 (old readiness gates removed in SC-18) |
| §9 What the factory collects (intro) | Collects & Ask lane, CA-01–CA-55; government budgets and finance (FIN-01–FIN-16) CA-52–CA-54 |
| §9.1 People | CA-01–CA-08, CA-15–CA-17 (CA-15 includes financial disclosure statements), CA-43, CA-47, CP-01, CP-10, FE-11, FE-42; social-post text from PRL (CA-40); was D4 |
| §9.2 Where they stand | CA-09–CA-12, CA-14–CA-16, FE-29, FE-33 |
| §9.3 Who funds them | CA-20–CA-23, CA-34, CA-36, CA-44, CA-45, CP-09; individual donors never named, small-donor share in CA-45 |
| §9.4 Meetings and votes | DB-01–DB-08, DB-55, DB-59, FE-45, DB-22, DB-26, BX-10, BX-11, CP-18, CA-40–CA-43 |
| §9.5 The ballot and measures | CA-51, FE-44, CA-24, CA-25, CA-30–CA-35, FE-04 |
| §9.6 What we store and what we fetch | DB-01, DB-06, DB-55 (store), CA-36 (fetch through the keys) |
| §9.7 Plain English for everything | CA-25–CA-29, CA-50 (CA-25 writes the translator's own playbook) |
| §9.8 Things nobody planned for | CA-55 (special district boundaries), CA-37–CA-39, FE-36, DB-17, DB-50 |
| §10 Minimum to go live | CP-09, CP-10, CP-12, CP-13, CP-14, CA-31 (candidates together), CA-17–CA-19 (no waiting for approval), BX-08, BX-09, FE-34 (pins), CA-06 (body contact), SC-09 (Kelly measured, never a gate), FE-29 ("working on getting this info") |
| §11 What Ask can answer | Office address, pin, hours: CA-06, CA-07, FE-35. Next meeting and agenda: already works, plus CA-28. Mayor's votes: BX-11, CA-41. Who's running and what they say: CA-31, CA-32, CA-12, CA-14. Who funds them: CA-20, CA-36. What a measure does: CA-25, CA-30. Speed: CA-49 |
| §12 Keeping it live | DB-26, DB-28–DB-35, DB-54, DB-56, DB-58, BX-12, DP-02, DP-12 |
| §13 How any mission runs | BR-08, DB-56, SC-12, CH-04, CH-05, CH-15–CH-20, BX-02, DP-03–DP-12, DP-13, FE-18 (front-end review of the mission's places) |
| §14 How it gets faster every time | DB-52, DB-40, DP-09, DP-21, DP-24 |
| §15 Running at scale | CH-29, CH-30, CH-28, BX-13, CH-02, CH-03, CH-06–CH-09, CH-24–CH-27, BX-03, BX-06, BX-12, DB-58, BR-31 |
| §16.1 Doors are records | DB-09–DB-20, DB-23, DB-35, DB-36, DB-54, DP-12 |
| §16.2 Written playbooks | DB-42–DB-44, CA-25 |
| §16.3 Settings in Admin | BR-05, BR-06, DB-45, DB-46, CA-04, CA-10, CH-15, CH-25, CP-02 (source-kind table and which kinds count), DP-11, DP-17, DP-23, SC-02 (squads), SC-19 (core items), FE-32 |
| §16.4 The look set in one place | FE-05–FE-10, FE-41, FE-32 |
| §16.5 Small, fast code | RL-01–RL-07 (code ships through the river), DB-46–DB-50, DB-53, DB-57 (a repair agent gets only the broken part) |
| §16.6 Every repair visible | BR-03, DB-34, DB-35, BR-32 |
| §17.1 Every claim labeled | BR-24, DP-23 |
| §17.2 Success has to repeat | DP-23–DP-25; the proof-across-places rule |
| §17.3 Every fix has a map | DP-19–DP-22 |
| §17.4 Learning from losses | DP-27–DP-29 |
| §17.5 Shown once, then quiet | DP-26, BR-24 |
| §17.6 Watched forever, quietly | DP-30–DP-32, DP-34 |
| §17.7 Checking the checkers | DP-33, DP-34 |
| §18 Honest and nonpartisan | CP-01–CP-05, CP-07, CA-10–CA-12, CA-15, CA-16, CA-25, CA-44–CA-46, FE-11–FE-15, FE-42, FE-22, DP-14 |
| §19 The Scoreboard | BR-23, BR-30–BR-32, DP-18, DP-26, DP-33, FE-23, FE-26, DB-52, SC-07–SC-09, SC-13, SC-16, SC-19 |
| How code ships (Sean, Oct 3) | RL-01–RL-06, BR-38 |
| §20 Next step | This document is that next step; no build step |
| Figure 1 (how the factory connects) | The backward chain above, links 1–9, and all lanes |
| Figure 2 (how a fix proves itself; how losses teach) | DP-19–DP-34 |
| Figure 3 (what the factory collects, every level) | CA-01–CA-55, DB-08, DB-22, BX-11 |

Every section has at least one step except §4 (a table of roles, mapped to lanes above) and §20 (this document). §7.8 is partly covered, as noted.

---

## Step index by lane

Stage in brackets. 321 steps in 8 stages (0 to 7).

Steps per stage: Stage 0: 13, Stage 1: 106, Stage 2: 60, Stage 3: 60, Stage 4: 39, Stage 5: 26, Stage 6: 12, Stage 7: 5.


### Admin (39)
- BR-01 [0] Every order keeps its row after a reload (read side) · depends on —
- BR-02 [1] No order sits at "Queued" without a reason · depends on BR-01
- BR-03 [0] The fix list lives in the control plane · depends on —
- BR-04 [1] Fix items get worked without a dispatch click · depends on BR-03
- BR-05 [1] Settings with a log and undo · depends on —
- BR-06 [2] A Settings view with a log and an Undo button · depends on BR-05, BR-01
- BR-07 [1] Every control in Admin can be sent · depends on —
- BR-08 [1] Start a mission for any place · depends on —
- BR-09 [1] Unowned work goes to the team, not to Sean · depends on —
- BR-10 [1] One sentence per receipt · depends on —
- BR-11 [1] Two broken numbers fixed, and Eastern days everywhere · depends on —
- BR-12 [1] Orders show Accepted with a plan, then a progress bar · depends on BR-01
- BR-13 [2] Orders finish with "Done" and the before and after · depends on BR-12
- BR-14 [2] One queue board for everything in motion · depends on BR-01, BR-03, BR-12
- BR-15 [1] Orders can be scheduled · depends on BR-01
- BR-16 [3] Scheduled orders fire on time, even if a round hangs · depends on BR-15, BR-13, BR-37
- BR-17 [4] "When" on every order: now, at a time, by a date, after something, or repeating · depends on BR-16, BR-14
- BR-18 [2] Plain-words orders through Ask Admin · depends on BR-07
- BR-19 [4] Sequenced orders in plain words · depends on BR-18, BR-16
- BR-20 [2] Decision cards that turn into orders · depends on BR-01, BR-15
- BR-21 [1] The budget dial says what it buys · depends on CH-02
- BR-22 [3] Shift focus by kind of information · depends on SC-02
- BR-23 [1] The Scoreboard view, first rows · depends on BR-01
- BR-24 [1] An updates feed with honest labels · depends on BR-03
- BR-25 [3] Now shows the few things that matter · depends on BR-14, BR-23, BR-24
- BR-26 [1] Ask Admin "why is this place stuck?" · depends on —
- BR-27 [3] Reports with wins, problems and decisions · depends on BR-14, BR-20, BR-24
- BR-28 [4] The daily brief arrives at Sean's time · depends on BR-27, BR-05, BR-37
- BR-29 [3] Alerts only when Sean is needed · depends on BR-02, BR-14, BR-20
- BR-30 [6] The Scoreboard reads the Scorecard's honest measures · depends on BR-23, SC-07, SC-08, SC-09, SC-11
- BR-31 [4] Facts per hour, cost per fact, and where the flow stopped · depends on BR-23, BX-06
- BR-32 [6] Door numbers on the Scoreboard · depends on BR-23, DB-27, DB-31, DB-34
- BR-33 [4] Sean can decline a new owed item · depends on BR-24, SC-10
- BR-34 [3] The old order and stuck lists are deleted · depends on BR-14
- BR-35 [1] Dead gateway actions, sections and routes are removed · depends on —
- BR-36 [1] New orders are written to history with their kind · depends on BR-01
- BR-37 [1] A timer for due orders and the brief that always runs · depends on —
- BR-38 [2] Admin shows each code change from built to live · depends on RL-05, CH-01
- BR-39 [1] Admin speaks plain English everywhere · depends on —

### Coach & Hunters (30)
- CH-01 [0] Production runs the fixed runner code · depends on —
- CH-02 [0] One unpriced charge no longer shuts off paid work · depends on —
- CH-03 [1] Settings take effect in the middle of a round · depends on —
- CH-04 [1] Don't pay to find what is already live · depends on —
- CH-05 [1] The first hunt starts in the same round as the order · depends on —
- CH-06 [1] Each worker process builds its runtime once · depends on —
- CH-07 [1] A clock on every target, and the case file is kept · depends on —
- CH-08 [1] Discovery passes run on their own lanes · depends on —
- CH-09 [1] The saved-page index is built once, not three times a round · depends on —
- CH-10 [1] Every funded Send gets the same rules · depends on —
- CH-11 [2] Producers that ran only for the original Send run for every Send by geography · depends on CH-10
- CH-12 [1] Pilot ZIPs lose their place at the front of the line · depends on —
- CH-13 [1] Statute-routed requirements work for any state · depends on —
- CH-14 [1] Old comments and reasons that read like gates · depends on —
- CH-15 [3] Missions split into parts from settings · depends on SC-02, BR-05
- CH-16 [4] Every piece of work knows its mission part · depends on CH-15
- CH-17 [5] Squads are sized to their parts, and hunters move to the gaps · depends on CH-16, SC-12
- CH-18 [5] Every blank has an owner · depends on CH-16, SC-12, BX-07
- CH-19 [5] A mission is done when its map is full and its doors refresh · depends on CH-16, SC-05, SC-12
- CH-20 [5] Hunters see the whole mission and can drop a finding for any part · depends on BX-01, CH-16, SC-12, DP-21
- CH-21 [5] Meetings discovery follows the mission map; the gap ledger is retired · depends on SC-12
- CH-22 [3] Local research rows join the one hunter queue · depends on BX-02, CH-06
- CH-23 [4] One hunter path: the separate registry-lane Scout is retired · depends on CH-22, DP-02, DP-04, DP-06
- CH-24 [2] Hunters work continuously, not in slices · depends on CH-06
- CH-25 [3] A hunter-count dial, with the memory ceiling beside it · depends on CH-24, BR-05
- CH-26 [2] Each task reads only its own history · depends on CH-06
- CH-27 [3] The 15-minute paid slice and the wave loop are deleted · depends on CH-24
- CH-28 [3] Many hunters in each worker process · depends on CH-24
- CH-29 [1] Work our own spending guard refused goes back in line · depends on CH-02
- CH-30 [1] When the AI service doesn't answer, the agent's work is kept · depends on —

### Box & Slide (13)
- BX-01 [1] The Box: one index of every finding · depends on —
- BX-02 [2] Builders take grounded findings straight from the Box · depends on BX-01
- BX-03 [2] Publish as soon as a parser result lands · depends on BX-12
- BX-04 [6] A finding about someone else reaches their card · depends on BX-02, CH-20
- BX-05 [5] Nothing a reader needs is written only to local staging · depends on BX-01, CH-23
- BX-06 [3] We can see where the flow stops · depends on BX-01, BX-02
- BX-07 [3] A map from checklist family to reader door, as data · depends on SC-02
- BX-08 [1] Office and meeting addresses get map points for any wired body · depends on —
- BX-09 [2] Venue pins publish on their own · depends on BX-08
- BX-10 [1] Concluded meetings link their video · depends on —
- BX-11 [6] Local votes are linked to the people who cast them · depends on DB-22, CP-09
- BX-12 [1] A publish-now lane that runs every minute · depends on —
- BX-13 [1] Slow discount batches only where no clock is running · depends on —

### Checkers & Publishing (19)
- CP-01 [0] No filed mailing address on any card or Ask answer · depends on —
- CP-02 [1] The checker labels sources instead of refusing them · depends on —
- CP-03 [2] Labeled non-official sources reach publication · depends on CP-02
- CP-04 [3] Every Sources row says what kind of source it is · depends on CP-03
- CP-05 [1] The quote travels with the fact · depends on —
- CP-06 [1] Dates must make sense · depends on —
- CP-07 [2] Newer and more official wins, and the conflict is kept · depends on CP-02
- CP-08 [3] Contacts follow the same conflict rule, and Admin shows conflicts · depends on CP-07
- CP-09 [1] Every record kind has its design minimum · depends on —
- CP-10 [1] A portrait from the person's own page publishes at once · depends on —
- CP-11 [1] The campaign-site chain loses its planted-control audit stage · depends on —
- CP-12 [2] The campaign-site second signal is dropped · depends on CP-11
- CP-13 [1] Candidate enrichment can publish every field · depends on —
- CP-14 [2] The activation gate is gone · depends on CP-13
- CP-15 [1] The research meeting fact chain is retired · depends on —
- CP-16 [1] Sources lists for meetings, money, votes and actions · depends on —
- CP-17 [1] Wording that could be wired as a gate · depends on —
- CP-18 [3] The same meeting from two sources is shown once, and conflicts are logged · depends on CP-07
- CP-19 [0] A value must come from the same person's row · depends on —

### Doors & Bank (59)
- DB-01 [0] Meeting history stops being deleted · depends on —
- DB-02 [1] Shared meeting fetch limits use the held window · depends on DB-01
- DB-03 [2] Legistar, Legistar InSite and calendar feeds hold 120 days · depends on DB-02
- DB-04 [2] Diligent, BoardBook, CivicClerk, CivicPlus and IQM2 hold 120 days · depends on DB-02
- DB-05 [2] Every other meeting adapter holds 120 days · depends on DB-02
- DB-06 [1] Concluded meetings with records are kept for good · depends on DB-01
- DB-07 [2] Outcomes are kept past the window · depends on DB-06
- DB-08 [1] Congress refreshes itself daily, and votes accumulate · depends on —
- DB-09 [1] The Door Registry: one editable list of every door · depends on —
- DB-10 [2] The registry is seeded from today's meeting doors · depends on DB-09
- DB-11 [2] Non-meeting feeds are doors too · depends on DB-09
- DB-12 [3] Adapters read their doors from the registry · depends on DB-10
- DB-13 [4] The runner builds its meeting work from the registry every pass · depends on DB-12
- DB-14 [5] Refresh requests and observability read the registry · depends on DB-13
- DB-15 [6] Reader coverage and curated-body status read the registry · depends on DB-14
- DB-16 [5] Allowed hosts come from each door · depends on DB-13
- DB-17 [2] Any adapter kind can be added as a data row · depends on DB-09
- DB-18 [5] The Tucson board portal reader becomes a general kind · depends on DB-17, DB-13
- DB-19 [5] The community college reader and the TUSD hook become general kinds · depends on DB-17, DB-13
- DB-20 [7] Door membership is no longer code · depends on DB-15, DB-16, DB-18, DB-19
- DB-21 [3] Each door knows when it last worked · depends on DB-10
- DB-22 [5] Outcomes and votes come from door kinds, for any body on that platform · depends on DB-13, DB-07
- DB-23 [3] Route hints become door records · depends on DB-10
- DB-24 [1] The manual crosswalk contract is retired · depends on —
- DB-25 [2] Each check looks before it reads · depends on DB-09
- DB-26 [3] What the hourly check finds is live within the hour · depends on DB-25, DB-10, BX-12
- DB-27 [3] Time from posting to live is measured · depends on DB-09, DB-25
- DB-28 [4] Every live fact knows its door · depends on DB-10, DB-11, DB-54
- DB-29 [5] A fact past its refresh date is re-read, with no Send needed · depends on DB-28
- DB-30 [4] Refresh follows how often each door actually changes · depends on DB-21
- DB-31 [5] Overdue doors are listed · depends on DB-21, DB-28
- DB-32 [4] A door that stops working is marked shut at once · depends on DB-21
- DB-33 [5] A shut door gets a detective at once, wherever it is · depends on DB-32, DP-02
- DB-34 [5] Shut doors go to the top of the list, and repairs are recorded · depends on DB-32, BR-03
- DB-35 [5] A door is repaired by editing its record · depends on DB-09, DB-13, BR-03
- DB-36 [6] A door edit is applied at once, not on a six-hour clock · depends on DB-35
- DB-37 [1] Lessons and doors in the Bank are tied to places · depends on —
- DB-38 [1] Silent Bank write failures become visible · depends on —
- DB-39 [2] The Bank moves to one row per entry (only if writes are failing) · depends on DB-38
- DB-40 [1] The Bank knows how long and how much each kind of job takes · depends on —
- DB-41 [1] Platform fingerprints are data · depends on —
- DB-42 [1] Playbooks, part 1: Scouts and detectives read written playbooks · depends on —
- DB-43 [2] Playbooks, part 2: every other role reads a playbook · depends on DB-42
- DB-44 [3] Playbooks are edited in Admin, with undo · depends on DB-42, BR-06
- DB-45 [4] Meeting windows and check timings are settings · depends on BR-05, DB-01, DB-26
- DB-46 [2] Switches that need no release · depends on BR-05
- DB-47 [3] Roll back a release from Admin · depends on BR-14
- DB-48 [1] New releases install beside the running one · depends on —
- DB-49 [1] A door-kind fix is checked by its own tests only · depends on —
- DB-50 [3] An engineer-built adapter can become a feed · depends on DB-17
- DB-51 [2] Dead links are found before readers find them · depends on DB-09
- DB-52 [4] The factory measures how much faster it gets · depends on BX-06, DP-09
- DB-53 [2] New code loads without stopping the factory · depends on DB-48
- DB-54 [3] Pages that feed live facts become doors · depends on DB-09, BX-02
- DB-55 [1] Meeting history already deleted is restored · depends on DB-01
- DB-56 [5] Starting a mission refreshes every door already known there · depends on DB-13, BR-08
- DB-57 [2] A repair agent gets only the broken part · depends on DB-49
- DB-58 [1] A slow site holds up only its own reads · depends on —
- DB-59 [0] Meeting snapshots move again, and one bad base holds back only itself · depends on —

### Detectives & Proving (34)
- DP-01 [0] A provenance receipt can no longer stop the research cycle · depends on —
- DP-02 [0] A passing outage stays a free retry · depends on —
- DP-03 [1] Held records and failed checks go to a detective with the reason · depends on —
- DP-04 [1] A walk that hits its limit goes to a detective before it is called absent · depends on —
- DP-05 [1] The unused rule-based detective is removed · depends on —
- DP-06 [2] Dead ends say what would unlock them · depends on DP-04
- DP-07 [1] Routes are written for the kind of door, not one address · depends on —
- DP-08 [1] One place's notes stop crowding everyone's head start · depends on —
- DP-09 [1] We can tell how often detectives' routes get reused · depends on —
- DP-10 [3] A new capability reopens the dead ends it could solve · depends on DP-06, DP-07
- DP-11 [3] The dead-end hold is a setting tied to the source's pace · depends on DP-06, BR-05
- DP-12 [6] A detective's door repair is used on the very next check · depends on DB-35, DP-02
- DP-13 [1] Auditors re-read live facts after they publish · depends on —
- DP-14 [2] Red flags are fixed or pulled at once, and the lesson is kept · depends on DP-13, BR-03, DP-15
- DP-15 [1] A pulled fact really leaves the published version · depends on —
- DP-16 [2] Auditors look harder where it matters · depends on DP-13
- DP-17 [3] The audit policy is a setting · depends on DP-16, BR-05
- DP-18 [2] Audit accuracy on the Scoreboard · depends on DP-13, BR-23
- DP-19 [2] A fix map table · depends on DP-07
- DP-20 [3] The fix map fills from every attempt · depends on DP-19
- DP-21 [4] Briefs say whether a method works, is untried, or fails here · depends on DP-20
- DP-22 [4] Results in one place no longer overwrite another place's · depends on DP-20
- DP-23 [4] A fix moves from Testing to Proven against a bar that is a setting · depends on DP-20, BR-05
- DP-24 [4] A fix is tried everywhere the same kind of door exists · depends on DP-07, DP-20, DB-17
- DP-25 [7] Proof means working in many places, not two attempts on one address · depends on DP-23, DP-24, DP-12
- DP-26 [5] A fix shows once when it proves out, then goes quiet · depends on DP-23, BR-24, BR-14, BR-23
- DP-27 [4] Failures are compared to find what they share · depends on DP-20
- DP-28 [5] Lessons from losses: predict, build a variant, or call the engineers · depends on DP-27, DP-03
- DP-29 [6] Every kind of loss is studied · depends on DP-28, DB-32, DP-14, FE-21
- DP-30 [6] Every door and fix keeps its history · depends on BR-03, DB-34, DP-20
- DP-31 [7] A repeat break starts from what fixed it last time · depends on DP-30, DP-02
- DP-32 [7] Patterns in when doors break are learned · depends on DP-30
- DP-33 [5] Auditors check the team's own claims · depends on DP-23, BR-24, DP-18
- DP-34 [7] A green "Proven" means still working today · depends on DP-30, DP-23

### Collects & Ask (55)
- CA-01 [1] Open States can publish legislators again (authority and firewall) · depends on —
- CA-02 [2] Open States fills a legislator seat when the own-page check fails · depends on CA-01, CP-02
- CA-03 [1] Terms have a start and an end · depends on —
- CA-04 [2] The social platform list is a setting, with six pills · depends on BR-05
- CA-05 [3] Social accounts are collected for everyone · depends on CA-04, CP-02
- CA-06 [1] Bodies have a published office address and phone · depends on —
- CA-07 [2] Offices near you, for people · depends on CP-02
- CA-08 [2] Candidate portraits come from the campaign's own page, with no release · depends on CP-10
- CA-09 [1] Statements carry what kind of source they came from · depends on —
- CA-10 [2] One list of ten stance topics, as a setting · depends on BR-05
- CA-11 [3] A stances door publishes people's own words · depends on CP-02, CP-09, CA-09, CA-10
- CA-12 [1] Ask answers with a person's exact words · depends on —
- CA-13 [1] Topic chips stop erroring · depends on —
- CA-14 [4] Each stance topic is a ready-made answer that opens instantly · depends on CA-11, CA-12, CA-15, FE-11
- CA-15 [2] A statement sweep for every person, from what we already hold · depends on CA-09
- CA-16 [3] The statement sweep searches, and searches more as the election nears · depends on CA-15, BR-05
- CA-17 [3] Candidate profiles publish on their own · depends on CA-08, CP-03, CP-14
- CA-18 [4] Statements and the candidate corpus publish on their own · depends on CA-11
- CA-19 [3] Executive actions for any state, on their own · depends on CP-03
- CA-20 [1] FEC money for every member and every candidate in a sent place · depends on —
- CA-21 [3] State and local campaign finance are door kinds · depends on DB-11
- CA-22 [4] Top donors and PACs for state and local races · depends on CA-21
- CA-23 [1] Local money shows on the person's card · depends on —
- CA-24 [1] Ballot measures are records, not code · depends on —
- CA-25 [2] The translator, part 1: measures and their parts · depends on CA-24, DB-42
- CA-26 [3] The translator, part 2: what a kind of body is, and what this body can do · depends on CA-25
- CA-27 [3] The translator, part 3: what an office does · depends on CA-25
- CA-28 [3] The translator, part 4: agendas and minutes in plain English · depends on CA-25
- CA-29 [4] Existing definitions become translation records · depends on CA-26, CA-27
- CA-30 [2] YES and NO each get their own line · depends on CA-24
- CA-31 [1] A ballot contests door for any place · depends on —
- CA-32 [2] The ballot page and Ask read the general ballot · depends on CA-31
- CA-33 [2] A ballot measures door for any place · depends on CA-31, CA-24, CP-09
- CA-34 [4] Campaign-finance work comes from the ballot, not a hard-coded list · depends on CA-32, CA-21
- CA-35 [3] Polling places by door kind · depends on DB-11
- CA-36 [4] Ask fetches full detail through the keys when asked · depends on CA-20, CA-21
- CA-37 [2] Things that fit no shape still go up · depends on BR-24
- CA-38 [3] Kinds of things are data, starting with special districts · depends on CA-37
- CA-39 [4] A new kind of thing joins a place's owed list · depends on CA-37, SC-10
- CA-40 [3] What they said at the time · depends on CA-09, CA-15, DB-06
- CA-41 [3] Ask answers from meeting history · depends on DB-06, DB-07
- CA-42 [1] A person's votes stay with them after they leave · depends on —
- CA-43 [6] The people layer updates when someone leaves or a seat changes · depends on DB-29, CA-42
- CA-44 [1] Money shows filings without disclaimers · depends on —
- CA-45 [2] Money reports what filings say, plus the small-donor share · depends on CA-44
- CA-46 [1] PRL's measurements and Sean's key votes on person cards · depends on —
- CA-47 [1] Curated rosters and statewide officers become data · depends on —
- CA-48 [1] Curated bodies become data · depends on —
- CA-49 [1] Ask answers within three seconds, even cold · depends on —
- CA-50 [4] Existing measure, notice and minutes summaries become translation records · depends on CA-25, CA-28
- CA-51 [1] Ask answers "who's running" for any office on the reader's ballot · depends on —
- CA-52 [3] Budgets, part 1: each government's adopted budget (FIN-01 to FIN-05) · depends on DB-11, BX-02
- CA-53 [4] Budgets, part 2: totals, revenue, spending, contracts, debt, audits and grants (FIN-06 to FIN-16) · depends on CA-52
- CA-54 [5] Budgets on the body card and in Ask · depends on CA-53, FE-13
- CA-55 [4] Special districts get boundaries, so they show only for addresses they serve · depends on CA-38

### Front-end (45)
- FE-01 [1] Look at the live site safely · depends on —
- FE-02 [2] Worst-case speed is measured on production, phone and desktop · depends on FE-01
- FE-03 [1] Every published place gets warmed, not just the pilots · depends on —
- FE-04 [3] The ballot is served from the cache · depends on CA-32
- FE-05 [1] Contrast is checked on every change · depends on —
- FE-06 [1] The spacing and type guard covers components too · depends on —
- FE-07 [1] Type-rung classes for the six sizes · depends on —
- FE-08 [2] Map and popup components use the tokens · depends on FE-06, FE-07
- FE-09 [2] Ballot and Ask components use the tokens · depends on FE-06, FE-07
- FE-10 [2] One finished Card with a Sources section built in · depends on FE-07
- FE-11 [3] One person card, mounted for officials · depends on FE-10
- FE-12 [3] One meeting card, with its sources in a Sources section · depends on FE-10, CP-16
- FE-13 [3] One body card · depends on FE-10
- FE-14 [5] Ballot and money cards keep sources in their Sources section · depends on FE-42, CP-16
- FE-15 [4] Official and body cards keep sources in their Sources section · depends on FE-11, FE-13
- FE-16 [1] Page measurements anyone can run · depends on —
- FE-17 [1] Resident tasks written as data · depends on —
- FE-18 [2] Resident tasks run on the live site · depends on FE-01, FE-16, FE-17
- FE-19 [1] The look standard is written down · depends on —
- FE-20 [2] A look reviewer separate from the builder · depends on FE-19
- FE-21 [3] Every deploy is looked at on the live site · depends on FE-01, FE-16, FE-20, BR-03
- FE-22 [6] A check that sources never leak onto card faces · depends on FE-12, FE-14, FE-15, FE-16
- FE-23 [4] Look and feel on the Scoreboard · depends on FE-21, BR-23
- FE-24 [4] Sean rates a sample of real screens · depends on FE-21, BR-23
- FE-25 [5] Pages are judged side by side with the best · depends on FE-20, FE-24
- FE-26 [3] Site speed and reliability on the Scoreboard · depends on FE-02, DB-51, BR-03, BR-23
- FE-27 [4] Speed is measured by our own regular test visits · depends on FE-26
- FE-28 [3] A dead link shows as text, not a broken link · depends on DB-51, FE-29
- FE-29 [1] One "working on it" component with three states (map and popups) · depends on —
- FE-30 [2] The same three states on the ballot, officials and money; disclaimers deleted · depends on FE-29
- FE-31 [3] A guard keeps the reader copy honest · depends on FE-29, FE-30
- FE-32 [2] Reader labels and help text are settings · depends on BR-05, FE-29
- FE-33 [5] Every candidate shows the ten topics on the ballot, never hidden · depends on CA-14, CA-15, FE-42
- FE-34 [2] Online-only meetings get a pin at the body's address · depends on CA-06, BX-08
- FE-35 [3] Offices near you are pins with directions · depends on CA-07, BX-08
- FE-36 [3] A plain record card for things with no shape · depends on FE-10, CA-37
- FE-37 [4] Admin itself is reviewed by running Sean's tasks · depends on FE-18, FE-20, BR-25
- FE-38 [1] One Admin stylesheet, and no leftover Admin prefix · depends on —
- FE-39 [1] No pilot ZIP buttons on the welcome screen · depends on —
- FE-40 [4] Dated one-off screenshot and walk scripts are retired · depends on FE-18, FE-21
- FE-41 [2] Officials and shell components use the tokens · depends on FE-06, FE-07
- FE-42 [4] Candidates use the same person card · depends on FE-11
- FE-43 [1] The homepage keeps working when the map can't draw · depends on —
- FE-44 [1] Federal offices are tagged Federal on the ballot · depends on —
- FE-45 [2] Nearby meetings are labeled nearby, and the place's own governments are counted apart · depends on FE-29

### Scorecard (20)
- SC-01 [1] The checklist's rules move into a data overlay, unchanged · depends on —
- SC-02 [2] The overlay carries units, triggers, due dates and squads · depends on SC-01
- SC-03 [1] One percent formula, and the obvious honesty fixes · depends on —
- SC-04 [3] Items are counted at the right unit · depends on SC-02
- SC-05 [3] Every blank carries its six statuses · depends on SC-02
- SC-06 [4] "Nothing hunts this yet" is shown honestly · depends on SC-05
- SC-07 [4] Completeness, freshness and delivery are reported separately, never blended · depends on SC-05
- SC-08 [3] Coverage, counted against what is expected · depends on SC-02
- SC-09 [4] People coverage: who has a full profile · depends on SC-05
- SC-10 [3] New finds join the list with a date · depends on SC-02, BR-24
- SC-11 [5] Scores keep history, so trends show · depends on SC-07
- SC-12 [4] The mission map is handed to the coach and the national job · depends on SC-05
- SC-13 [3] Launch gates become health checks that never stop publishing · depends on SC-02
- SC-14 [3] Sean can add to what's owed, from Admin · depends on SC-02, BR-06
- SC-15 [1] The unused checklist census is removed · depends on —
- SC-16 [3] Operational readiness is counted apart from civic completeness · depends on SC-02
- SC-17 [5] Honest coverage tags on sold signal rows (as Sean decides) · depends on SC-07, SC-08
- SC-18 [1] The unused readiness snapshot and dead ZIP planners are removed · depends on —
- SC-19 [6] Time from mission start to core information live · depends on SC-10, SC-11, BR-23
- SC-20 [1] Each coverage explanation stays within one kind of fact · depends on —

### Release (7)
- RL-01 [0] The scheduled full check passes again · depends on —
- RL-02 [0] Every open pull request is sorted into the river or closed · depends on —
- RL-03 [0] Code reaches main through one river branch, a couple of times a day · depends on —
- RL-04 [1] The full check runs once a day and on each river merge, not every three hours · depends on RL-03
- RL-05 [1] Every river merge gets its after-deploy check · depends on RL-03
- RL-06 [2] The river runs on its own · depends on RL-03, RL-05
- RL-07 [1] A change that only touches documents runs only the tests that read them · depends on RL-03
