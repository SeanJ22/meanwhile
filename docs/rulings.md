# Meanwhile: Sean's standing decisions

This document is the only rulebook for Meanwhile. Only Sean changes it. He writes and uploads every change himself. No Claude, Codex or other agent edits it, for any reason. An agent may suggest that something could become a ruling, and Sean decides whether it does and how it's worded. Anything Sean says in a conversation is an instruction for the task, with the overall goal in mind.

Code, tests and documents that contradict this document are defects. They are deleted outright. Nothing is kept as a historical note, a comment, commented-out code, an archive or any other record of what used to be there, so nothing in the repository can tell a reader anything this document doesn't. CLAUDE.md and other agent entry files explain how to apply this document and create no policy of their own. Technical documents describe how the code works. Current state records temporary pauses, settings and unfinished work.

## 0. What Meanwhile is, and how all work is judged

Anyone in the United States can open Meanwhile and right away understand everything government does that touches them, at every level: federal, state, county, city, school district and special district. The bar is the best way anyone has ever had to understand and act on their government: complete, correct, current, fast, and a pleasure to use.

A reader can look at any place at all, including but not limited to their ZIP, county, city, district, a whole state, or anywhere else they move the map. Information fills for whatever place they're looking at. Meetings shown are always for that place, and meetings from somewhere else never stand in. Where something isn't covered yet, the page says so.

To show what that means, a resident sees, among other things:

- **Who governs them:** every official and every board, commission and body with authority over where they live.
- **Information about the people governing them:** background, role, term, and what they say publicly, including their public statements as tracked by sources such as, but not limited to, the Polarization Research Lab.
- **How to hold them accountable:** how to contact them (including but not limited to phone, office address and social media), how they voted, what they decided, and what is on the ballot to keep or replace them.
- **How they are funded:** who pays for their campaigns, linked to the official filings.
- **What boards and meetings are happening,** shown on a map and a calendar running 90 days back and 90 days ahead, with when the next meeting is and when the last one was. What happened at meetings (votes, outcomes, minutes, what people said) is kept for good, so a reader can ask how someone voted years ago.
- **What those bodies make decisions on:** agendas before the meeting, minutes and outcomes after, in plain English.
- **How to take part:** how to attend, comment, or say something in the app.

**This list shows the intent. It is not the whole of it, and it will change.** Anything a resident would reasonably need to understand and act on their government is in scope whether or not it is written here. That includes things Sean has not named, such as the boundaries of every district a resident lives in, an interface that is beautiful, fast and easy, and an Ask that answers as well as asking Claude directly. Agents are expected to notice what a resident would miss and raise it or build it, without waiting for Sean to name it. No list in this document, the success checklist, or any plan is a ceiling, and nothing is out of scope because it is missing from one.

**Ask answers every question.** It answers from Meanwhile's data with sources when we hold the answer, and otherwise from the AI with a plain label saying so. Every question we can't answer from our data becomes acquisition work automatically and appears in the daily brief.

Everything comes from sources a reader can follow, official ones replacing other values wherever they exist, shows when it was last checked, and stays current without anyone touching it. Where something is not covered yet, the page says so plainly, so a blank never reads as "nothing here." Every plan works backward from this picture. How information gets into the site is a means to it, never the goal. Every other section of this document serves this one.

1. **Every hunt starts from the place.** Resolve every division the place touches, including ZIPs split across districts. List everything a reader there is owed from the picture above: every seat and who holds it, every body with its members, contact, calendar and decisions, every funding record, every contest on the ballot, every deadline. Fill it first from national sources, including but not limited to Congress, Census, Open States, FEC, the Polarization Research Lab and state election offices, and from everything already held for those places, whichever job, ZIP or pipeline captured it. Send agents only for what is still blank. A fact researched once for a county, city or district serves every ZIP it covers.
2. **Set the table.** A record goes live when its minimum facts check out against the source they came from (§3). Every other fact attaches as it is verified. Each blank stays open as standing work until it is filled or shown to be unpublished by the government. Nothing waits on the rest of the checklist, and getting the basics never ends the work.
3. **Agents run in parallel, at scale.** They use every API, feed and tool Sean has provided, and learn from each place so the next one is faster and cheaper. Scale is limited by the budget Sean sets, not by one-at-a-time processing.
4. **Admin is the command center.** It shows what readers have for any place, what agents are doing right now and what they found, where work is stuck and why, and lets Sean send agents and budget to any gap or blocker. It works with Sean's PC off. There is no Admin page outside the command center: a fix to Admin goes into the command center, and the old page it replaces is deleted in the same change.

 Sean decides what, whether, how and when. He starts missions, shifts focus, pauses or stops anything, and gives orders now, at a time, by a date, after another order or repeating, with a control or in plain words. Every order is tracked Received → Accepted → Scheduled → In progress → Done, and an order that can't be done says why at once. Each state has a queue, plus one for national and system work. A daily brief carries wins, problems and decisions. For now there are no alerts: concerns go in the daily brief, and an alerts switch exists and stays off until Sean turns it on. Every settings change shows when it changed, its value before, and an undo, and names who made it only when the factory made it.

**Every plan, change and report is judged by these tests:**

- Does it bring more places closer to the full picture above, with the admin page saying plainly what is still missing?
- Would a resident using it find it complete, correct, fast, and a pleasure to use?
- Does a hunt for any place return everything we already hold, then go after the blanks?
- Does a verified fact reach readers within minutes, and keep filling in?
- Can Sean see in Admin what is happening and where it is stuck, and send agents to fix it?
- Is it running in parallel, at scale, with Sean's PC off?

No new gate, proof step, certification, ledger or scoring system is added without Sean's approval.

**Admin's own measures and labels are approved, because they never stand between a verified fact and readers:** how much of a place is captured, the Scoreboard rows (including the accuracy of the team's own reports), the Proven, Testing and Expected labels on the team's methods and fixes, auditors checking the team's claimed wins, and the look at the live page before a change is called done. The Box, the Door Registry, the fix list, order tracking, the queue, the settings log with undo and the daily brief are approved parts of how the work runs. None of them may hold back publishing.

## 1. Sean sets the direction; agents own delivery

Sean sets the goals, priorities, business policies, and spending authority. Section 0 states the goal. Agents make the engineering decisions needed to complete the work. Sean's current explicit instructions take priority over older project instructions.

**Stay on the original objective until it is completed, a fatal error derails it, or Sean changes it.** A routine failure, difficult source, slow test, or unfinished dependency is not a fatal error. If a fatal error makes the objective impossible under current conditions, show the evidence, preserve the work, and identify recovery options. Do not quietly substitute another objective. Honor explicit pauses and continue independent work.

Plan backward from the full requested result and identify steps along the way. Identify essential dependencies before building. Required connections must work and be verified before the assignment is finished. Viewing success or failures through the Admin site is crucial. A handoff, passing component test, or working screen does not prove the whole system works. Building a car that backs out of the driveway does not satisfy a request for a car that drives on the highway and gets to the grocery store.

Meanwhile must acquire and present information across expanding geographic coverage. Admin must support adding and tracking ZIPs, counties, metros, and states through work creation, discovery, acquisition, verification, and public delivery. Necessary connections are part of the assignment, not optional future work.

**Build general capabilities without preparing a specific test place.** Don't trial-run or prep a place before the fleet works it. When a new area, ZIP, county, district or state is about to be worked, don't test it first, map its sources by hand, fill in data by hand, or make special repairs for it. Send the fleet and let the normal system do the work. When Sean points the team at a specific place, working that place is the job. Using evidence the system already holds, from any job, during a hunt is how the system is meant to work. Fix real blockers and reuse valid evidence rather than adding minor improvements, broad rechecks or repeated unchanged attempts. Verification means the standard in §3; do not add gates beyond it.

**Free sources run everywhere, all the time. Sean decides where paid work goes and how much it spends.**

## 2. Get the public information to readers

**Find a way to get the information, parse it, verify it, and push it to readers.** Finding a link or knowing information exists is not completion, however it is the critical first step. A failed route does not end the obligation.

Think like the world's greatest detective: What are we missing? How else could we get it? What have we not tried? Follow promising clues, combine sources, and build missing tools or acquisition methods. A checklist or fixed number of attempts is not the limit. Creating a route means obtaining real evidence, never inventing facts. Ask what if throughout and find ways around every barrier.  

Investigate what already worked. Trace existing data and working reader links through their sources, tools, stored evidence, code, and history. Establish what changed; reuse, repair, or learn from the earlier methods. Past success is evidence to investigate, not a guarantee that the same route still works.

During discovery and ongoing coverage, search broadly for current information about each body being worked and compare it with what Meanwhile shows. Do this even when connected feeds work. Follow search results to underlying evidence, confirm the body and current details, and recover missing information. A healthy feed does not prove complete coverage. Sean must not be the system's search engine or quality control. This comparison is ongoing coverage work; it never holds back a fact that already passed §3.

**Use every source and API Sean has provided, constantly, for everything it carries.** Sean researches and provides these sources so the information comes in rapidly, constantly and for little to no cost. Information behind any source or API we hold is acquired by plain code, rapidly and constantly, for every place. The sources include but are not limited to Legistar, Census, LegiScan, Open States, Congress, FEC, the House and Senate clerks, the Polarization Research Lab, Brave and Exa, plus every reference file and API key already held. Every agent that acquires information, including but not limited to scouts and detectives, must also be able to call these resources directly as tools. Use search early when useful; do not force every free option ahead of a better paid tool within the agreed budget. Confirm that the integration actually exposes and uses the needed capability. Avoid irrelevant calls and reuse valid evidence.

**Acquisition is fast and accurate, and expanding to new places needs no new code.** Money is spent where Sean directs it, including but not limited to hard-to-find information.

Before escalating a retrieval blocker, challenge it with another appropriate method and evidence of prior success. Record the actual routes, results, missing information, and next approach. Distinguish discovery, access, extraction, verification, publication, and display problems. One failed step does not establish that the information is unavailable. “Not found in the sources checked” must not become “does not exist.”

**Dead ends.** A detective marks a true dead end, records what would unlock it, and brings it to Sean when only a person can unlock it. If it can be unblocked without Sean, then that means the agents (workers) can and should unblock it or find a way around it. The blank stays open, and the route reopens when its unlock appears. How long a dead end waits before another try follows how often the source changes, and while coverage is expanding no dead end waits more than 5 days.

**Request pacing by publisher size.** The cap of ten requests per website per hour applies only to small local governments under 10,000 population and school districts under 5,000 students. Everything else is read at full speed: state and federal sites and APIs (including census.gov and TigerWeb), larger counties, cities and districts, and national data sources. Always honor Retry-After and back off on 429 and 5xx responses.

**Robots.txt alone does not block acquisition.** Automated reading of publicly accessible pages is authorized even when robots.txt asks otherwise. Record what robots.txt says as evidence, but do not stop reading, remove coverage, or ask Sean again about individual publishers or groups solely because of it. This does not authorize bypassing authentication or other access controls. When retrieval technically fails, use alternative public routes and the available tools above; one failed route is not a completed investigation. 

**One flow carries every fact, free or paid.**

1. Free code runs everywhere, all the time. Plain code reads every source and API we hold, for every place, on a schedule, and drops what it gets into the box. Nothing waits for a Send, a mission or a paid budget.
2. Hunters go after what free code doesn't get. Before going anywhere, a hunter checks what the box already holds for that place, and what has worked in that state and in states whose governments are built the same way. Hunters drop every finding in the box and go straight back out. Paid hunters work where Sean points the money.
3. The box is shared. Every finding carries its place, so each state has its own view of it, and every role can read all of it.
4. Builders take findings from the box and turn them into records. Checkers confirm each fact against its saved source under §3. That is the only check. A fact that passes publishes.
5. Anything that can't be built or confirmed goes to a detective with the reason. The detective finds another route or marks a true dead end under this section.
6. Auditors re-read published facts afterward and report what still holds as well as what doesn't. A fact that looks wrong is flagged to be investigated and potentially pulled, and the flag shows in Admin with four choices for Sean: remove it, keep it, send the fleet to find the right value, or type the right value himself. A value Sean types publishes at once, with any link he adds shown in Sources, and stays until he changes it. If an official source later states something different from a value Sean typed, it comes back to him as a flag. A value the system found is simply replaced when an official source states something different.
7. Every win and every loss is saved to that state's profile and to the shared methods. A method that works in one place is tried everywhere with the same kind of website or the same kind of government.

No role waits on another. No step holds a fact after it passes §3. No one adds an approval, a review, a second capture or a shadow stage. Every role can call every source and tool we hold.

**Nothing fails silently.** Every part of the system, including but not limited to every source, website, job, worker and role, records when it runs, what it took in, what it passed on and what failed. A line keeper, running apart from everything it watches, checks the whole line every hour from source to reader: anything that stopped, anything piling up, anything failing again and again, anything built but never running, and verified facts that aren't live. Every problem it finds becomes fix work with an owner in the queue it belongs to in Admin and in the daily brief, and stays there until it is fixed and proven on the live site. The line keeper never holds a fact back or stops other work. If the line keeper itself stops, Admin says so.

## 3. Publish verified information promptly

**Information that passes verification publishes automatically.** No election-based delay or routine per-record approval. Publish as results become ready; do not wait for an entire hunt, state, or unrelated build. Keep unverified information out of publication and keep working to obtain and verify it.

**What verification means.** A fact passes verification when its value appears in a saved source document about the correct jurisdiction, captured within that kind of fact's freshness window, and code confirms the value is on that page. An official source is always enough but never required: a fact can also come from a source that shows where it got the fact and that checks out, such as but not limited to Open States, a news story, or a Wikipedia citation whose linked source confirms it. Evidence captured by any job counts, whichever work item captured it. A second, independent source is required only for judgment calls, including but not limited to portraits not from an official source or the person's own campaign site, and matching the same person across sources. Other sources not yet checked never hold back a verified fact; they are coverage work. After publishing, samples are re-checked against their sources, and anything that looks wrong is flagged as in §2.

**What counts as an official source.** Any .gov site is official automatically. A vendor-hosted government portal and a government site on a .us, .org or .com domain count as official once an official government page links to them. Official means it publishes on its own. It never means it's the only acceptable source.

**Portraits.** A portrait from an official source publishes on its own: any official site above, such as a .gov page, and the official account of the person's office on a social platform. A portrait from the person's own campaign site also publishes on its own. A portrait from anywhere else, including a personal social account, needs a second matching source. There is no review step.

**Facts from sources.** Every source a fact came from is linked in its card's Sources section. A fact from a non-official source is published and finished. A campaign or advocacy group's own site is a source for facts about itself. What it says about anyone else is a lead: it goes to a detective and publishes once another source confirms it. When an official source states a different value, the official value replaces it, except a value Sean typed in Admin, which comes back to him as a flag. For example, Open States is an approved source for everything it carries, including but not limited to legislators, executives, municipal officials, their contacts, photos, social accounts and committees, votes, bills and hearings. When two official sources differ, the newer one wins and goes live at once. The losing value is logged, and a disputed fact never waits.

**Sources live in the Sources section.** Sources live only in the Sources section of the card they belong to: ballot, person, battle, body and meeting cards. They never repeat across the face of a card, including source-kind labels and "read <date>" lines. The Sources section shows when each source was last checked.

**Outside measurements and key votes.** Meanwhile never scores, rates or labels anyone itself. Measurements from an outside source, such as the Polarization Research Lab's share of a person's posts about policy versus attacks on opponents, show on person cards credited to that source in Sources. Sean picks key votes himself and keeps them current; they show on person cards alongside the person's full voting record.

**Meanwhile never tells anyone how to vote. We will always do our best to ensure that every candidate in a contest gets equal effort.**

**The State Run Checklist is Admin's capture scorecard.** Sean's State Run Checklist measures how much of what a place is owed has been captured, and Admin shows it. It never gates publishing: a fact that passes verification publishes whatever the checklist says. It is the scorecard for all of this work until Sean changes it. It defines each mission's map, its families decide how agents are grouped, and each blank carries six statuses. Completeness, coverage, freshness and delivery are reported separately, as bars in Admin rather than text. New finds join with a date, one line each in the daily brief. Sean's orders and the budget dial in Admin run the work.

**Each fact publishes on its own.** A record goes live when its minimum facts are verified, and every other fact attaches as soon as it is verified. A meeting (with pin) is live when its body, date and time are found; its location (the body's own address when the meeting's location isn't published), agenda, minutes and outcomes attach as each is verified. An official is live with the seat, the holder's name and the source page it came from; contact details, portrait, term and the rest attach as each is verified. A body is live with its name, type and source; its members, contact and calendar attach as each is verified. A contest is live with the election, the office and the candidates its source lists; everything else attaches as it is verified. Every blank stays open as standing work until it is filled.

The other minimums: a candidate is live with the name as listed, the contest and the source, as soon as they are found; a contest never waits for more candidates (some races only ever have one). A ballot measure is live with the election, its number or title, the measure's text (official where it exists), and the source. A vote is live with the person, what was voted on, how they voted, the date and the source. A stance is live as an exact quote with its source and date. A summary of a stance can be written by the AI when the card's Sources section links the statement it summarizes. A portrait follows the portrait rule above. Money is live with the candidate or committee, the amount, the period and a link to the filing. The "Kelly standard," the full profile, is what this work strives for and measures; it is never a gate.

Once the full hunt starts, we cannot go hours without new information reaching readers. When delivery stalls, find and fix the failing step. Attempts, busy agents, stored files, and unchanged records do not count as newly delivered information. Deliver time-sensitive information while people can still use it.

Missing information must not hide independently verified information. Meeting schedules, publisher agenda links, and extracted agenda contents are separate capabilities. A missing agenda or location must not suppress an otherwise verified meeting. Preserve working links; distinguish “not yet published” from “not yet acquired.” Combine complementary sources with clear attribution and preserve verified dates, cancellations, and reschedules when changing routes.

Use published meeting addresses for map pins, with official ones replacing others, after normal source and location validation. Sean does not need to certify them personally. An online-only meeting is pinned at its body's own published address, clearly marked online only, with the join link on the pin. Keep source and reviewer attribution truthful; investigate ambiguity instead of inventing details.

## 4. Keep meeting coverage current

Maintain an active, rolling **90-day window of upcoming meetings**. Meetings (in regards to pins) are held 120 days back and 120 days ahead so Ask and search can use them, and shown 90 days each way on the site. However, meeting information (including but not limited to: what happened in the meeting, how things were voted on, who voted, minutes, et al) are held in a database so readers can ask and discover past information. Continue discovery after dates are posted: new meetings, changes, cancellations, and reschedules can appear at any time. Do not invent unpublished dates or delete history to maintain the window. Finding a meeting after it starts does not satisfy the goal of helping people attend.

Meeting discovery stays on. Sean controls paid search separately through Admin. Respect the current setting and spending limits; do not treat a paid-search pause as a pause on all discovery.

Check meeting sources:

- **Twice daily** generally.
- **Hourly, within 60 minutes**, for bodies with a meeting in the **next seven days OR concluded in the previous seven days**.

The seven-day window rolls automatically. Checks cover calendars, agendas, changes, cancellations, decisions, and minutes. This cadence is separate from the forward coverage window and does not change other data families' schedules.

**Live within 90 minutes inside the seven-day window.** For a body inside that seven-day window, its sources are checked every hour, and anything it posts (an agenda, a result, a cancellation, a change of time or place) is live on the site within 90 minutes of posting. Outside the window, the twice-daily check picks it up. Checks are plain code with no AI cost. The windows, the hourly check and the 90-minute target are Admin settings that may go faster, never slower. This is separate from section 0's test that a verified fact reaches readers within minutes; both apply.

Do not add an unapproved timing allowance. Verify that prioritizing one group does not repeatedly delay another beyond its required cadence. Claims that a delay happens only once need evidence; otherwise investigate and fix the recurring cause.

## 5. Build, test, verify, promote, and finish

**Waiting is not the plan. Work effectively and efficiently.** Start ready work immediately. Challenge long estimates across every active session before relaying them and whenever the plan changes. Include release queues, runner handoffs, scheduled cycles, and verification windows. Sean must not have to challenge each delay. As much as possible things should happen concurrently, never sequentially unless absolutely required.

Keep a brief execution plan with each remaining task, one accountable owner, and its actual dependency. Agents' plans carry no durations or dates; Sean's orders may carry a start time, a finish-by date or a repeat. Separate active work from idle time.

Run independent work in parallel without conflicting edits or interfering tests. Prepare downstream work as soon as its inputs exist. Assign one owner per shared check; hand off evidence and close redundant sessions rather than leaving several idle for the same verification.

**A worker holds only what its job needs.** A job for a place loads that place plus every district touching it inside the same state (the state line is the hard boundary), from data stored by area, and nothing else is in memory. Nothing loads the whole country's records. Every worker still calls national sources and APIs whenever its job needs them. Shared tools (browser, field manual) are shared, not copied per worker. Any change to the fleet reports how many workers the production server runs at once at the 0.75 GiB memory margin.

**Production migrations apply themselves; Sean is never in that loop.** Expand migrations apply during the production build, before the new code goes live; if one fails, the deploy fails and the old site keeps serving. Contract migrations apply after the deploy is serving, applied by the runner when it follows the newly deployed commit. Both refuse any target that is not the production database and any migration not committed in the journal. Every apply, refusal and failure shows in Admin's existing deploy or stuck panel. Preview and branch builds never touch production.

**How code ships.** Code reaches `main` a couple of times a day as one combined, tested change, not one pull request per session. Sessions work on their own branches in the cloud, a merge session folds them together and tests the result, and the combination merges to `main` as one pull request. Data, settings, doors and playbooks still go live with no release.

Replaced code is removed, not amended. When code is changed to make things more efficient, the old code it overrides is deleted in the same change. It is never patched, left in place beside the new code, or kept behind an on/off switch. If new code fails, the release is reverted. Sean's own controls in Admin are not affected. Bloat in the code is not acceptable. Contradictory evidence must be called out as soon as it's found so it can be addressed. That includes two pieces of code doing the same job different ways, and code, tests or documents that disagree with each other or with how the system actually behaves.

Remove duplicate regeneration and checks when they prove the same thing on unchanged code and inputs. Preserve focused handoff checks and full verification of the version that ships. Repeat checks when changes invalidate their evidence, not for reassurance. Improve slow checks and pipelines rather than accepting hours of delay as fixed.

Use direct tests, controlled runs, controlled clocks, or equivalent measurements instead of waiting when they can prove the required behavior. If elapsed time truly remains necessary, identify exactly what must wait, why, what was tried to shorten it, and the earliest event or check that resumes it. Continue independent work and resume promptly. Do not stop just to report progress while useful work remains.

Do not circle the drain or go off on tangents. Stay focused on the current goal and align with the overall mission. Fix required defects, meet the full agreed standard, deliver, and move forward. Record optional refinements for later. Do not restart investigations, add reviews, or expand into unrelated work without a concrete reason. Speed must not come from skipping the §3 standard, reduced coverage, hidden failures, or unfinished work passed to someone else. Speed does come from removing checks that go beyond §3 and proof steps that protect no reader outcome.

## 6. Prove the actual result and fix the cause

Verify the whole user journey and its connections, not just individual components. For visible changes, inspect the actual page and relevant device or layout. Preserve every agreed acceptance condition; never narrow the finish line to whatever passed. The section 0 tests are the finish line for every piece of work.

**Any user-facing action taking longer than three seconds fails.** This includes, but isn't limited to, page loads and Ask responses. Measure from the user's action until the requested result is usable, including cold starts and first visits. A spinner, placeholder, or first streamed words are not completion. Averages must not hide failures.

**When our own code, tests, or releases succeed only on a second attempt, investigate.** Preserve the first failure, establish what changed, correct the cause, and verify under the original conditions. A successful reload or retry proves recovery, not resolution. Outside websites fail intermittently; a retry that succeeds against a public source is normal, is handled by backoff, and shows in Admin as source reliability rather than starting a separate investigation each time.

**Contradictions start an investigation.** Check conflicting reports, records, instructions, or observed behavior, even when inconvenient or apparently minor. State what was checked and what remains unknown. Reuse the evidence and reopen when new information warrants; never invent a resolution. A contradiction between sources about a fact is settled by the rule in §3, the losing value is logged, and the fact does not wait; a contradiction never holds back unrelated verified facts.

When information is missed or behavior regresses, restore the result and permanently fix the identified cause in the system or process. A backfill, explanation, reminder, or future task alone is not completion. Test the conditions that caused the failure and check related work for the same cause. If the cause or lasting repair remains unresolved, keep it open and say so. Do not promise that every future failure is impossible.

Required verification must pass before “all clear.” Required verification means the §3 standard and the section 0 tests. Do not move required proof after completion and rename it monitoring. A triggered run alone does not prove automatic scheduling; the evidence must test that behavior too. State any live behavior still unverified. Never report a skipped or failed check as passing. Proof exists to protect readers: retire proof steps, receipts and ceremonies that no longer protect a reader outcome, and do not let proof about one change block unrelated releases.

## 7. Make learning compound

Continuous improvement applies to the whole system: acquisition, parsing, verification, publishing, reliability, tools, cost, and communication. Each pass inherits everything useful learned before it.

Save successes and failures where future workers actually use them: evidence, proven or suspected cause, lesson, where it applies, and what changes next time. Register both the specific source and the transferable method. Preserve the search pattern and reasoning, not just one name or URL. Every role that acquires, parses or verifies information reads this shared knowledge, not only scouts.

Adapt useful methods to each new body or area and test them there without waiting for Sean to suggest it. Check during ongoing work that routes still produce current, relevant information reaching readers. Repair or replace failed routes and turn proven methods into reusable tools and code. Do not repeat unchanged failures without new evidence or changed conditions.

Sean expects improvement every pass, significant daily progress, and order-of-magnitude weekly gains in capability and efficiency. Measure actual results on comparable work: information delivered, time, cost, repeated failures, and reliability. Report shortfalls honestly. Do not invent gains, reduce coverage, fall below the §3 standard, or manufacture unnecessary work to claim improvement. Keep delivering while learning.

Do not compound or generate massive data files for workers to read every time.  Data should be useful and succinct.  Information that impacts how hunters hunt, how detectives discover, how they all do their jobs should read what has CHANGED since the last read.  This keeps data transfer in check.  

## 8. Carry decisions forward; ask only for real owner actions

Check current decisions and relevant handoffs before asking Sean. Approval keeps its original scope across sessions and restarts. Reopen it only when changed facts or a genuine conflict require a new decision, and explain exactly what changed.

A prompt Sean pastes as an instruction is his instruction and authorization within its stated scope, even if AI drafted it. He takes responsibility for reading it. An unsent suggestion is not approval; quotations and chat logs supplied for review are not automatically instructions to execute.

Discovering, building, testing, enabling, and using new acquisition routes are part of an existing acquisition assignment. Follow the deployment process and publish verified results without asking again merely because the route is new.

Coverage is every place in the US at every level, and the team expands free coverage without asking. Sean decides where money is spent, contracts, credentials, what Meanwhile collects and sells, how reader data is used, and this document. New credentials, new paid services and contracts come to him. The team makes every decision about how: which source, method, order, door or fix and why. Everything else is done and reported as an update labeled Proven, Testing or Expected. A new kind of door or government-site reader is team work. Identify any exact instruction creating a conflict; do not invent approval gates. Prepare everything you can first, provide the working page or exact action, explain what it unlocks, and ask promptly. Consolidate duplicate requests, continue independent work, and resume after he acts.

**Sean sees everything in Admin,** including but not limited to what's running, what readers have, what's broken, what it costs and where money goes.

**Sean sets every spending limit, including but not limited to AI token usage, in Admin. Nothing else sets a cap.** Sean can turn paid spending off at once from Admin, for everything or for one area, while a spike is investigated. Turning spending off never stops free data acquisition.

Acquisition and publication instructions do not themselves authorize external messages, public comments, or contacting other people.

## 9. Protect evidence and keep policy separate from implementation

Preserve source evidence and the last verified working data when an update fails. Keep credentials private. Do not silently change privacy, collection, sharing, sales, or retention behavior.

**Every Ask question is saved with the reader's place,** to learn what readers need and to feed the data business.

**Privacy and money on reader pages.** Public office and campaign addresses only, never anyone's home. Candidates' filed mailing addresses are not shown on reader pages or in Ask. Money is reported as the filings state it and never characterized. Committees, PACs and organizations show by filed name. Individual donors are never named. Their money shows as totals, plus one share: how much of a person's individual money came from donors giving $200 or less in the cycle, for example "62% of individual money came from donors giving $200 or less", from the filings' own lines for small and large donors.

Use the standing data system for routine civic-data collection, verification, publication, and refresh. Use software releases for code and schema changes. Reader data never needs a software release to go live. Doors, playbooks, settings, labels and help text are also edited as data, with a log and undo, and take effect without a release or restart. Routine data problems should be visible and recoverable without forcing unrelated software releases.

Automatic publishing under §3 is on. Spending limits, the paid-research switch, and pauses Sean sets in Admin stay as set until he changes them.

## 10. Speak plainly and celebrate wins

Use short, transparent, high-school-level English. Lead with the result, problem, or exact decision needed. Separate facts from inferences. State material failures, costs, uncertainty, and unfinished work plainly; keep supporting evidence available without burying the answer. Admin shows times in Eastern time. Report schedules to Sean in Eastern time.

**Admin and reader copy: plain labels and numbers.** No hedging, no "it's X, not Y" lines, no disclaimer boxes, no "what it will never do" lists, and no paragraphs about how something is enforced or what is not published. In Admin, a number we do not have shows as "—". On reader pages, a section not covered yet says "We're working on getting this info" with the existing "Want us to get this sooner?" link, never "—". A stance topic that a full, equal-effort search came up empty on says "Not found in the sources checked", with what was searched in the card's Sources section. A "not posted yet" line shows when the government hasn't published something yet, such as an agenda. Admin is plain English throughout: no code names, error codes, IDs or raw technical text on any Admin screen, with technical detail behind a "Technical details" link, and never a wall of text.

**Celebrate verified wins clearly and give them their own space.** Say what succeeded and why it matters. Do not bury a win or immediately undercut it with optional improvements. A verified milestone can be celebrated while the larger assignment remains open. No agent points or scoring system is needed.

Report what changed, how it was verified, and whether it is built, tested, merged, deployed, and working for readers. Say which section 0 test it moves. State remaining work separately, with its owner and next action. A task recorded for later is not completed work.
