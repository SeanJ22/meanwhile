**The Meanwhile Civic Data Factory**

A proposed system for finding, building, checking, publishing and keeping fresh everything government does that touches a resident

*Proposed design, version 16 · October 3, 2026 · written from Sean's description of the system he wants, without reference to the current code. A comparison to what is already built comes after this design is approved.*

**The Civic Data Factory is Meanwhile's process for acquiring civic information and promoting it to the live site: finding it, building it into records, checking it, publishing it and keeping it fresh.**

**1. The mission comes first**

Everything in this factory starts with the end in mind and works backward. That holds for every mission, whether the mission is to cover a county or to build the factory itself. Before anyone moves, the question is: what does done look like? Then: what has to be true right before that? And right before that? The chain keeps going back until it reaches something that's already done, and the step after that is the one to take right now.

It works like solving a maze. Forcing a way through from the entrance means hitting dead ends and backing up over and over. Working from the exit and the entrance at the same time, the two paths meet in the middle, and the full route is clear in both directions. Here, the exit is the finished result. The entrance is what exists today. The work is the path between them.

Speed is the default. The factory goes and gets information, and gets it fast. A fact with a source goes live in seconds, with its source listed in that card's Sources section, and checking happens along the Slide and after publishing while the site keeps moving. Waiting is never the safe choice; a resident looking at an empty page is the failure.

Nothing is built for one place. Every method, door feed, fix and design is built to work for every place with the same kind of door or page, and is proven on many places at once. A mission is done when the factory works everywhere it's sent, never when it works for one example.

The mission stays at the front of every role. The captain sets it from Admin, the coach plans from it, every squad knows it, builders shape for it, and the Scoreboard measures progress toward it. Work that doesn't move the mission waits.

**2. The foundation: it just works**

Under all of it sits one rule. The site looks beautiful, feels instant, never breaks, and is something people want to come back to. The products people return to every day all share one trait: they just work. If the site is slow or buggy, people leave and don't come back, and everything the factory finds is wasted.

Two kinds of engineers keep it that way. Back-end engineers keep the doors, keys and Slide working (6.10). Front-end developers own how the site looks, feels and behaves for a resident (6.11). The front-end standard is a person's judgment. Having the data on the page is only the starting line. The real test is whether a resident finds it beautiful, easy and fast, and wants to come back.

- Pages read only from records that are already finished and checked. A resident never waits on a hunt.

- The meeting calendar is held further out than it's shown (120 days each way, shown 90), so each new day is already loaded.

- Every page feels instant on a phone, including the first visit.

- No broken links, empty cards or placeholder text. Checkers and auditors catch dead links and stale facts before residents do.

- One clean, consistent design everywhere, with a glass-like polish.

- New information shows up fast: a newly posted agenda for a body meeting this week is live within an hour.

- Every change is tested on the live page, by looking at it, before it's called done.

**3. What it does**

The captain gives the factory a mission from Admin: a congressional district, a county, a metro area or a whole state. The coach works backward from the finished result to map everything a resident there is owed, then sends squads of hunters after each part: this group takes the county government, that group takes the school districts, another takes the candidates and their money. Squads sweep their part of the mission, and the coach moves hunters to wherever the gaps are until the map is full. Above it all, the captain directs the whole factory from Admin, the control center that Admin becomes: what happens, whether, how and when.

Hunters drop what they find in the Box and go straight back out. They never wait. Builders pull from the Box and shape each finding into something the site can use: a meeting, an office with a map pin and directions, an official with a portrait, a vote, a candidate's stance in their own words, a ballot measure in plain English. Finished records go down the Slide. Checkers line the Slide so nothing falls off, and whatever reaches the bottom is live on the site and ready for Ask.

The most important layer is people. Every official and every candidate, at every level from Congress to the school board, gets a full profile: portrait, office, term, contacts, official site, socials, office addresses, where they stand, who funds them, and how they voted. The Knowledge Bank ties federal, state and local together by place, so a ZIP code leads to every district it sits in, every government over it, and every person in those governments.

Once a door is open it stays open. The Door Registry remembers every source ("Door 17A is the Maricopa County Board of Supervisors") and the key that opens it. Back-end engineers turn known doors into automatic feeds so the site never goes stale (an agenda posted in the week before a meeting is live within an hour), and if a door shuts, everyone swarms it until it's open again. Front-end developers make sure all of it looks and works the way a resident wants. Detectives take the cases hunters can't crack. Auditors spot-check what's live and report the good news with the bad.

**The targets this design is built to hit**

- **A county's core resident information live on the site within an hour of the mission starting.**

- A place the factory has already covered refreshed in minutes, because every door is already known.

- Nothing that was ever live goes stale. Known doors are re-read on schedule, forever.

- A new agenda, result or meeting change live on the site within an hour of the body posting it, for any body with a meeting in the last or next seven days.

- Everything public about every official and candidate collected, wherever it's published.

- Every published fact traceable to the exact sentence on the official page it came from.

- Facts published per hour climbing week over week as the Knowledge Bank grows.

- A site that feels instant, never breaks, and that residents return to.

- **Everything scored against the State Run Checklist (section 8), the scorecard until the captain changes it.**

**4. The team at a glance**

| **Who**                | **Their job**                                                                                                                                                    | **Starts with**                                              | **Hands off to**                                             |
|------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------|--------------------------------------------------------------|
| Admin                  | Where the captain directs everything: what happens, whether, how and when. Shows every order, the queue, progress and the decisions needed                       | The captain's orders and the factory's reports               | Every role (orders), the captain (reports, queue, decisions) |
| 1 Coach                | Takes the captain's orders, works backward from the finished mission, sends a squad after each part, and moves hunters to the gaps until the mission map is full | The mission, the resident checklist, the Knowledge Bank      | Squads of hunters                                            |
| 2 Hunters              | Sweep their squad's part of the mission, drop every finding in the Box, go straight back out                                                                     | The mission, their squad's part, head starts from the Bank   | The Box (findings), Detectives (stuck), the Bank (lessons)   |
| The Box                | Holds every finding until a builder takes it. Hunters never wait on it                                                                                           | Findings with quotes, saved pages, door feeds                | Builders                                                     |
| 3 Builders             | Shape findings into site-ready records: people, portraits, meetings, pins, votes, stances, money, ballot summaries                                               | Whatever is in the Box                                       | The Slide                                                    |
| 4 Checkers             | Line the Slide. Confirm each fact automatically in seconds so nothing falls off                                                                                  | A finished record and its saved source                       | The live site (pass) or Detectives (fail)                    |
| 5 Live site            | Shows residents everything, instantly, and feeds Ask                                                                                                             | Checked records                                              | Auditors (samples), the Scoreboard                           |
| 6 Detectives           | Crack hard, failed and shut-door cases, then find the faster way for next time                                                                                   | The case file: what was tried and where it stopped           | The Box (the find), the Bank (the route)                     |
| 7 Auditors             | Spot-check what's live. Raise red flags and green flags                                                                                                          | A sample of live facts                                       | Builders (fixes), the Scoreboard (accuracy)                  |
| 8 Back-end engineers   | Keep every door open, every key working and the Slide running. Turn known doors into automatic feeds                                                             | The Door Registry and the factory's own health               | The Box (door feeds), the Bank (new doors)                   |
| 9 Front-end developers | Own how the site looks, feels and works. Judge it by looking and using it, the way a person would                                                                | The live site on a phone and a computer, the design standard | Fixes to the site, the Scoreboard (look and feel)            |

*Figure 1 shows how the factory connects, Figure 2 how a fix proves itself, and Figure 3 everything the factory collects.*

<img src="media/d92d7a1d48d2cbcd301f9a56ba4f1a55fb1bde37.png" style="width:8.54167in;height:5.73958in" />

*Figure 1. The Civic Data Factory. The captain directs from Admin at the top. Thick arrows are the main line, from mission to live site. Dashed arrows are the exception paths. Gold arrows connect to the Knowledge Bank, which holds the Door Registry. The band along the bottom is the foundation everything rests on, owned by the front-end developers.*

**5. Working backward from the end**

The factory itself is built the same way it works. This is the chain from the finished result back to the start. Each step is what has to be true right before the step above it.

1.  **The end.** People use Meanwhile constantly, and the anonymized aggregate signal from that use is good enough to sell to the people who buy it.

2.  **Right before that:** residents in every covered place find everything government does that touches them, and they come back because it looks great and just works.

3.  **Right before that:** every covered place is complete, fresh and fast on the site: people, meetings, votes, the ballot and Ask.

4.  **Right before that:** every known door is on automatic refresh, new postings for bodies meeting this week are live within an hour, shut doors get reopened fast, and auditors confirm what's live is still right.

5.  **Right before that:** checked records flow down the Slide continuously, with nothing falling off.

6.  **Right before that:** builders turn everything in the Box into site-ready records as fast as it arrives.

7.  **Right before that:** squads of hunters fill the Box for every part of the mission, with detectives cracking what they can't.

8.  **Right before that:** the coach has the mission map for the place, built from what a resident there is owed, plus the Bank's head starts.

9.  **The start.** A mission: the place, and the full list of what a resident there is owed.

At the same time, the work runs forward from what exists today. Where the two paths meet is the first step that can be taken right now. Every later step follows from there, in order, with nothing built that the chain doesn't need.

**6. How each role works**

**6.1 The Knowledge Bank (the shared memory)**

This is what makes the factory faster every time. Every role reads it before starting and writes to it when finishing, so nobody ever starts from zero. It has three layers, federal, state and local, and they tie together by place: a ZIP code points to every district it sits in, each district points to the governments over it, and each government points to the people in it.

- **Federal:** members of Congress and candidates, federal agencies and their nearby offices, FEC money, Census boundaries, national election data.

- **State:** legislators, statewide officials and candidates, the legislature's votes, state campaign-finance and election offices, statewide ballot measures.

- **Local:** counties, cities, school, fire, water and special districts, their websites and meeting platforms, clerks, officials, candidates and local measures.

- **The Door Registry:** every known source, with a name ("Door 17A: Maricopa County Board of Supervisors"), the key or method that opens it, what it holds, how often it changes, and when it last worked.

- **Lessons:** which platform each site runs on and the method that works for it, dead ends, shortcuts detectives found, and how long each job took.

**6.2 Coach**

Takes the captain's orders from Admin, keeps the mission in front of everyone and runs the squads toward it.

- Starts from the end: what does this mission look like when it's done? From that, it builds the mission map from the State Run Checklist (section 8): every checklist item that applies to the place becomes a blank on the map, covering every government, person, candidate, meeting body and ballot item a resident is owed, and what's already live.

- Breaks the mission into parts and sends a squad after each: "This group takes the county government. This group takes the cities. This group takes the school and special districts. This group takes the candidates and their money. This group takes the ballot."

- Sizes each squad to its part. Bigger and harder parts get more hunters.

- Gives each squad its head starts from the Bank: the known doors, the keys that open them, the methods that worked and the dead ends to skip.

- Watches the mission map fill in live. As parts finish, hunters move to the gaps. Anything stuck goes to detectives.

- Skips anything already live and fresh, so no money is spent finding something twice.

- Calls the mission done when the map is full and every door it opened is on automatic refresh.

**6.3 Hunters (the squads)**

Dozens to hundreds at once, working in squads. Each hunter acts like a sharp researcher with a head start.

- Each squad sweeps its part of the mission. Hunters in a squad spread out and can see on the mission map what's already been found, so effort goes to the gaps rather than to repeats.

- Every hunter knows the whole mission. Anything useful found along the way goes in the Box, even if it belongs to another squad's part.

- Use every tool: web search, a full browser, a PDF reader, every data service we hold keys for, and every page the factory has already saved. The keys are master keys; hunters use them first and constantly.

- Drop each finding in the Box the moment they have it: the fact, the exact sentence it came from, the page address and a saved copy of the page. Then keep going. A hunter never waits for a builder or a checker.

- Write back what worked, what didn't and which door it came through, so the Door Registry grows with every mission.

- Have a time limit on any one target. Anything stuck goes straight to a detective with everything that was tried. No hunter ever spins.

**6.4 The Box**

One shared pile that every hunter drops into and every builder pulls from. It lets hunters and builders both work at full speed without waiting on each other.

- Holds findings from hunters, finds from detectives and new data from back-end engineers' automatic door feeds.

- Every item carries its source sentence, page address, saved copy and the part of the mission it serves.

- Builders pull whatever is ready. Nothing in the Box blocks anything else.

**6.5 Builders (shaping it for the site)**

Take findings out of the Box and turn them into the exact records the site and Ask use. They read JSON, parse PDFs and scanned agendas, and turn every kind of source into one clean format that slides into any system built on top.

- People: portrait, name, office, district, term, phone, email, official site, socials, and office addresses as map pins with directions.

- Meetings: upcoming and concluded, with date, time, place, agenda, minutes, results and video.

- Votes: what was voted on, the result and who voted how, linked to each person.

- Statements and stances: what each person said, in their own words, with the source and date.

- Money: donors, PACs and organizations from official filings.

- Ballot: contests, candidates, deadlines, polling places, and each measure summarized simply.

- Everything linked: this person holds this office on this board, which governs these ZIPs, meets here on these dates and voted this way.

- Plain English for everything that needs explaining (section 9.7): measures and each of their parts, what a kind of body is, what an office does, agendas and minutes.

- Sources attached to each card's Sources section, never repeated across the card itself.

- Duplicates merged and conflicts flagged, for example two pages giving different meeting times.

**6.6 Checkers (along the Slide)**

Checkers line the Slide between the Box and the site. They are automatic, take a few seconds per fact, and are never a line anyone waits in. Speed is the default: a fact that has a source and matches it goes live right away. Their job is to make sure nothing falls off, and that every fact that reaches the site is traceable.

- Is the quoted sentence really on the saved copy of the source page?

- Is the source named and labeled? Official government sources, candidates' own campaigns, filings, voter guides, candidate forums and questionnaires, and news reports all count, each labeled for what it is.

- Do the dates make sense: not in the past for an upcoming meeting, not years stale for an official?

- Does it conflict with something already live? If so, newer and more official wins and the conflict is logged.

- If every answer is yes, the fact goes live immediately. If not, it goes to a detective with the reason, so it's caught rather than lost.

**6.7 Live on the site**

The end of the Slide. Everything a resident sees, all from the same checked records, and all instant.

- Every official and candidate with a portrait, contacts, socials, where they stand, who funds them and how they voted.

- Every office and meeting place as a map pin with directions.

- Upcoming meetings with agendas and how to attend or comment; concluded meetings with results.

- The ballot in plain English, with deadlines and polling places.

- Ask, answering from the same records, with the source for every answer.

**6.8 Detectives (the hard cases)**

Get every case hunters couldn't crack, every fact that failed a checker and every shut door. Once they find it, they find the faster way, so nobody has to dig for it again.

- Creative routes: archived copies of old pages, another agency that publishes the same thing, minutes that list the next meeting date, county pages that list every district, official social accounts, keys nobody tried yet.

- Drop the find in the Box, and add the route to the Bank written so a hunter can use it next time without thinking.

- Mark true dead ends so the factory stops trying them, and say what would unlock them.

**6.9 Auditors (red flags and green flags)**

Spot-check what's live after it's published, and report successes as well as failures.

- Pick facts at random, plus extra checks on high-traffic pages, single-source facts and anything past its refresh date.

- Re-read the source and ask: is this still right? Is this person still in office? Is this meeting still on?

- Red flags get fixed or pulled right away, and the lesson goes to the Bank so the mistake doesn't repeat.

- Green flags get counted. The Scoreboard shows the result plainly, for example "Of 1,000 facts audited this week, 99.2% are still accurate. Here are the 8 we fixed."

**6.10 Back-end engineers (doors, keys and the Slide)**

Keep everything flowing, all the time.

- Keep every door open and every key working. Watch each door's last success and catch the moment one fails.

- Turn known doors into automatic feeds. Once Door 17A is known, an engineer builds a feed that reads it on schedule and drops new meetings, agendas and votes in the Box with no hunter needed.

- Check meeting doors every hour for any body with a meeting in the last or next seven days, so a newly posted agenda, result, cancellation or time change is live on the site within an hour, and twice a day for everyone else. Checking a door is a plain automatic check with no AI cost; AI is only used when something changed.

- Build every feed and fix for the kind of door, never for one place, and prove it on many places at once.

- Keep repairs easy: doors, playbooks and settings are edited without touching code (section 16).

- Wrap every data service we hold keys for as a simple tool any hunter can use.

- Keep the Slide running: watch for anything slow, stuck, throttled or out of memory, and fix the cause.

- Sound the alarm on a shut door. When a site changes or a key stops working, the door is marked shut, it goes to the top of every list, and engineers, detectives and hunters swarm it until it's open again.

**6.11 Front-end developers (it just works)**

Own the resident's experience: how the site looks, feels, moves and reads. An AI reviewer left to itself will see the data on the page and call it a success. These developers are set up to judge the way a person does, and a page that has every fact but is ugly or awkward to use fails.

- Judge by looking. Every review starts from the real live page on a phone and a computer, seen the way a resident sees it, never from the code or the data behind it.

- Use the site as a resident. Each review runs real tasks start to finish: find when my council meets and how to comment, see how my mayor voted, find the school district office and get directions. Every extra tap, slow load, confusing label, cramped layout or dead end counts against it.

- Ask a person's questions. Is it beautiful? Is it easy? Does it feel instant? Would I come back tomorrow? Would I show it to a friend?

- Make ugly impossible by construction. Every page is built from one set of finished, polished components. New data fills a design that's already right, so a new place or a new kind of record can't produce a cluttered or broken page. A fix to a component fixes it on every page at once.

- Judge by comparison. Reviews put our page side by side with the products people love to use and with our own best pages, and ask which is better and why. A page that loses the comparison gets a red flag.

- Measure what can be measured automatically on every page: load time, layout that jumps while loading, text that overflows or gets cut off, tap targets too small for a thumb, inconsistent spacing and fonts, and low contrast.

- A person's eye sets the bar. Sean, or a designer he picks, reviews a regular sample of real screens, the same way auditors sample facts. Those likes and dislikes become the written standard the AI reviewers judge against, with examples of good and bad.

- Keep the reviewer separate from the builder. The reviewer never sees the data checklist, so complete data can't earn a pass.

- Raise red flags and green flags, with screenshots, the same way auditors do for facts.

- Fix what they find, then look at the live page again before calling it done.

- Watch speed and errors on the live site all the time, and treat a slow or broken page like a shut door.

- Own Admin too, to the same standard as the main site. Admin reviews run the captain's tasks: start a mission, shift focus, schedule an order, find out why something is slow, read what the team fixed today, decide on a new expense. Anything confusing, slow or wordy is a red flag.

**7. Admin: where the captain sits**

Admin is the window into the factory and its command center. In the factory metaphor it is the captain's bridge, but the product keeps the name Admin. The coach runs the squads. The captain directs everything from Admin, and everything the factory does can be seen, directed and decided from there, by someone who has never written a line of code.

**7.1 The captain decides what, whether, how and when**

- **What:** start a mission, set priorities, shift focus from one place or kind of information to another. Which places the factory is sent to, and in what order, is always the captain's call.

- **Whether:** pause, resume or stop anything, and approve or decline the few things that come to Admin for a decision (7.6).

- **How:** the budget dial, settings, playbooks and source rules (section 16).

- **When:** start now, schedule it for a set time, set a finish-by date, line it up after something else finishes, or make it repeat.

Orders are given with a control or typed in plain words, for example "Put everything on school boards in this district until they're done, then go back to candidates."

**7.2 Every order is confirmed and tracked**

Each order moves through the same short track, shown as a status bar:

1.  **Received** within seconds.

2.  **Accepted**, with who took it and the plan in one or two lines: what will change, what it affects, and when results will show.

3.  **Scheduled**, if it has a set time or is waiting its turn.

4.  **In progress**, with how far along it is.

5.  **Done**, with the before and after.

If an order can't be done, Admin says so right away, with the reason in one line and the captain's options. No order ever disappears silently.

**7.3 Never a wall of text**

- Every screen opens with the few things that matter right now, then everything else.

- Cards, status colors, progress bars and short lines, one idea per line.

- Every number gets one plain sentence: what it means and whether it's good or bad.

- Detail sits behind a "show details" link and never gets in the way of a decision.

- Plain English everywhere. No code names, error codes or technical text on any screen; anything technical sits behind the "show details" link.

- The same layout in the same place every time, so the eye knows where to go.

- Its own design, built to the same standard as the main site and reviewed by the front-end developers.

**7.4 The queue**

One board shows everything in motion: missions, orders, repairs, shut doors and stuck cases. Each row shows what it is, its status, who owns it, when it's due, the next step and a progress bar. Filters split it into needs me, in progress, scheduled, waiting and done.

**7.5 Progress**

Each mission's map fills in live. Scores by place, facts per hour, cost per fact and audit accuracy are shown with whether each is trending up or down.

**7.6 The team runs the factory; the captain makes the big calls**

Making the factory better is the team's everyday job, and it happens without asking. A new route, a new door, a new path, a cheaper method, a faster feed, a repair inside the current budget and tools: the team finds it, does it and reports it. Approving every small improvement would defeat the purpose of having a captain.

The captain is asked to decide only when something needs the captain:

- Something is truly broken and the team can't fix it with the budget, tools and platforms it already has.

- A new cost or expense.

- A new system, or a platform or service the factory hasn't used before.

Everything else shows up as an update, labeled with what has actually been shown (section 17), so the captain always knows what changed and when without having to approve it. For example: "Door 17A shut at 2:10 PM. Detectives found a new route and it was back open at 2:25." or "Forty counties use the same meeting platform. We built one feed for all of them, and their cost per fact dropped by more than half."

**7.7 Reports**

The daily brief arrives at the time the captain sets, and any report can be pulled on demand. Every report has the same three parts:

- **Wins and updates,** given room of their own: what the team fixed, improved and saved, and when.

- **Problems,** one line each with the cause in plain English and what's being done.

- **Decisions,** only the few that need the captain, each on its own card: what's happening, what the team recommends, what it costs, what it gets, and buttons to approve, decline, change or schedule. An approved card becomes an order in the queue.

**7.8 Alerts and questions**

- For now there are no alerts. Anything that needs the captain goes in the daily brief, and everything else is handled, logged and shown in the queue and the updates. An alerts switch exists and stays off until the captain turns it on.

- The captain can ask Admin anything in plain English, such as "Why is this district stuck?" or "What did we spend yesterday and what did it get us?", and gets a short answer from the live numbers with a link to the detail.

**8. The scorecard: the State Run Checklist**

The State Run Checklist (version 1.1, the Meanwhile State Run Checklist document) is the scorecard for everything the factory does, until the captain changes it. It lists what a place is owed, family by family: geography, governments and bodies, offices, meetings, agendas and outcomes, legislative votes, elections, candidates, campaign money, government finance, participation, Ask and delivery. It never holds back publishing. A fact that passes its check goes live whatever the checklist says.

**8.1 How the factory uses it**

- **It defines the mission.** When a mission starts, the coach lists every checklist item that applies to the place. One item can mean one blank per seat, per body or per meeting. Each blank is something the factory owes, and together they are the mission map.

- **Its families decide the squads.** Governments and meetings take the government, meeting and document families. People and money take offices, candidates, campaign money and legislative votes. Ballot takes elections and measures.

- **Each blank carries its six statuses:** whether it applies, whether it's due, what the hunt found, whether the government has published it, how fresh it is, and whether residents can see it. That's how Admin can say "agenda not published yet" instead of "missing."

- **Its scoring rules run the Scoreboard.** Completeness by family and by place, with counts behind every percentage, plus coverage, freshness and public delivery, each reported separately and never blended into one number.

- **New finds join it.** Anything found that isn't on the list is added to that place's owed list with a date, so the score stays honest.

- **Admin runs it.** The checklist's run ceremony (a frozen manifest, a single launch owner, the scout review stop at 20 attempts or \$10) is replaced by the captain's orders for scope, the budget dial for spending, and the captain's call on adding items to what's owed.

**8.2 Where each part of it lives in the factory**

| **Checklist families**                                                                                            | **Where they live**                                                                    |
|-------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| Geography, governments, offices, meetings, documents, votes, elections, candidates, money, finance, participation | The mission map, the squads and the builders                                           |
| Acquisition (ACQ)                                                                                                 | Hunters, the Door Registry and the checkers                                            |
| Recovery and learning (REC)                                                                                       | Detectives, the Knowledge Bank and proving (section 17)                                |
| Source change (ACQ-10)                                                                                            | The shut-door alarm                                                                    |
| Public delivery (PUB)                                                                                             | The Slide, the live site and the front-end developers                                  |
| Ask (ASK)                                                                                                         | What Ask can answer (section 11)                                                       |
| Privacy and fair treatment (SAFE)                                                                                 | Rules the checkers enforce (section 18)                                                |
| Launch and safe-operation gates (GATE)                                                                            | Health checks the back-end engineers watch, shown in Admin. They never stop publishing |

<img src="media/4952e041efdb9d46564aa32c8cc24a3aa8d63855.png" style="width:8.95833in;height:5.97917in" />

*Figure 3. What the factory collects. Every row exists at every level, and the levels tie together by place.*

**9. What the factory collects**

"Find everything" means more than governments and their meetings. Figure 3 lays it out: places, the governments and bodies over them, the people in them, and what each person has said, done and been funded by, at the federal, state and local level.

**9.1 People: the layer that matters most**

Every official and every candidate, incumbents and challengers alike, at every level: members of Congress, legislators, statewide officials, county supervisors, mayors, council members, school board members and special-district boards. Each gets the same profile, so a school board candidate and a senator are presented the same way.

- Portrait: the official photo for officeholders and the campaign's own photo for candidates, each linked to where it came from.

- Office, district, term start and end, and party where the office is partisan.

- Contacts: phone, email, official website, campaign website and social accounts.

- Social accounts on every platform the site has a pill for: Facebook, X, Instagram, YouTube, LinkedIn and TikTok. Official and campaign accounts count, and so does a personal public account when the person uses it to talk about their office or race. The platform list is a setting in Admin, so a new platform is added in one change.

- Office addresses near the resident (district offices, campaign offices, where the board meets) as map pins with directions. Never a home address.

- Where they stand, who funds them, and how they voted, described below.

For local officials and candidates, public information is often thin and scattered. Whatever is out there gets grabbed: candidate filings and financial disclosures, statements in the county voter guide, campaign sites and social accounts, local news coverage and interviews, candidate forums and questionnaires, meeting minutes where they spoke, and endorsements they announced themselves. "Not found in the sources checked" is shown only after that sweep comes up empty, and the sweep runs again as the election gets closer.

**9.2 Where they stand, in their own words**

Every person's "Where they stand" section uses the same ten topics: housing, water, schools, taxes, immigration, health care, public safety, jobs, environment and transportation. They are plain nouns, the same for every candidate, so the choice of topics never frames anyone. The list is a setting in Admin.

Each topic is a ready-made Ask question about that person. Clicking "housing" asks Ask what this person has said about housing, and shows the answer the same way Ask would: their own words, with the date, and the sources in the card's Sources section. When nothing has been found, the topic says so plainly and shows what was searched, and the factory keeps looking. A topic never opens to an empty box. More specific questions, such as a stance on a particular local project, go to Ask directly.

Every stance is a direct quote or close paraphrase of the person's own words, from wherever they said it: their site, statements, filings, voting record, social posts, news interviews, forums or questionnaires. Every candidate is searched with the same effort on the same topics.

**9.3 Who funds them**

Money comes from official filings only: the FEC for federal races and each state's campaign-finance system for state and local races. Each profile shows the PACs and organizations that gave, totals raised and spent, and the filing period, all linked to the filing. Individual donors are never named; their money shows as totals, plus one share: how much of it came from donors giving \$200 or less in the cycle. The factory reports what the filings say and does not characterize it.

**9.4 Meetings and votes**

The site shows meetings 90 days back and 90 days ahead. The database holds them 120 days back and 120 days ahead, as far out as each body publishes, on a rolling calendar. As each day ticks by, the next day's meetings are already in the database; they just weren't shown yet. A meeting that was 93 days out a few days ago and is 89 days out today appears instantly, with no new hunt.

When a meeting passes, it's already on file, so the only work left is to pick up what happened: the agenda outcome, who voted for what, and the result. Back-end engineers' feeds collect that from minutes and results as soon as the body publishes them.

Local agendas often post only days before a meeting, and that's expected. When one appears in the week before the meeting, it's live on the site within an hour; anything posted earlier is picked up by the twice-daily check. The same goes for minutes, results, cancellations and any change to a meeting's time or place.

What happened in meetings is kept for good: what was voted on, the result, who voted how, and what each person said about it at the time, including their official social posts. That's what lets someone ask, "How did the mayor of Philadelphia vote on this a year ago, now that it's coming up again, and what did they say about it then?"

Elections happen every two to four years, but people resign, are removed or die in office, and special elections happen constantly across roughly 90,000 governments. The people layer is updated whenever that happens, and a person's voting record stays attached to them when they leave office or run for another one.

**9.5 The ballot and ballot measures**

Every contest and every candidate on a resident's ballot, plus deadlines and polling places. Each ballot measure gets the plain-English treatment in 9.7: what it does, what a YES vote does and what a NO vote does, written only from the official text and linked to it.

A multi-part measure is broken into its parts using the official text's own numbering, never split finer or merged. Each part is labeled by kind: how it's funded, what it pays for, who oversees it, when it starts, and when it ends or renews. Readers react to each part, since someone can want one part of a measure and not another.

**9.6 What we store and what we fetch**

We don't need to hold everything ourselves. We store what residents and Ask use constantly: people, offices, the 120-day meeting window, votes, statements, money summaries and ballot summaries. Everything else, such as full filings, older documents and raw records, is fetched fresh through the keys when someone needs it. The keys are master keys, and the factory uses them over and over.

**9.7 Plain English for everything**

One translator process explains everything a resident needs explained. One model rewrites the official text in high-school English, for someone who has never voted, and a second model checks the result against the original. It covers:

- ballot measures and each part of a multi-part measure;

- what a kind of body is: a county, a township, a city, a school district;

- what an office does;

- agendas and minutes.

The rules are the same every time: written only from the source text, describing and never judging, sitting next to the original with its source in the Sources section, and every statement traceable to the source. Bodies and offices get two levels. The general definition ("here's what a county is") is written once and reused everywhere. The specific one ("here's what this county board can actually do") comes from that body's own charter or law, so a general definition never claims powers a particular body doesn't have. Explanations are written automatically as records come down the Slide, with no hand-writing and no approval, and rewritten whenever the official text changes.

**9.8 Things nobody planned for**

Most unusual things fit a general shape. The factory works in a few shapes: place, government, body, office, person, meeting, contest, measure, vote and record. An elected office that exists in only one state is still an office, with a seat, a holder, a term and a contest, and it slides in like any other.

- Something that fits no shape still goes up as a plain public record with its source, and Admin gets one update: a new kind of thing was found.

- If the same kind keeps appearing in other places, it gets its own shape, defined as data and settings, with no code change, rebuild or restart.

- New finds join the place's owed list on their own, so the scorecard grows honestly.

- Unusual sources are read by the general page and PDF readers. A dedicated door feed is built only when the same kind of source shows up in many places, and it proves itself like any other fix.

**10. Minimum to go live**

Every record goes live the moment it has its minimum, and every other fact attaches the moment it's verified. The minimum is only the floor that says what a record is. Nothing waits for more, and nothing waits for approval.

| **Record**     | **Live when it has**                                                                                                                                                                                                           | **Attaches as verified**                             |
|----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------|
| Meeting        | Body, date, time, source                                                                                                                                                                                                       | Location, pin, agenda, minutes, outcomes             |
| Map pin        | A live meeting and a published address. For an online-only meeting, the body's own published address, with the pin clearly marked online only and the join link on it                                                          | None. The pin attaches to the meeting                |
| Body           | Name, type, source                                                                                                                                                                                                             | Members, contact, calendar, plain-English definition |
| Official       | Seat, holder's name, source page                                                                                                                                                                                               | Contacts, portrait, term, stances, votes, money      |
| Contest        | Election, office, the candidates its source lists                                                                                                                                                                              | Everything else                                      |
| Candidate      | Name as listed on the official list or filing, the contest, source. All candidates in a contest go live together                                                                                                               | Portrait, site, contacts, stances, money             |
| Ballot measure | Election, number or title, link to the official text, source                                                                                                                                                                   | Plain-English summary, parts, YES and NO meaning     |
| Vote           | Person, what was voted on, how they voted, date, source                                                                                                                                                                        | Result, what they said about it                      |
| Stance         | An exact quote with its source and date. A paraphrase needs a second source                                                                                                                                                    | More statements over time                            |
| Portrait       | From an official source (including the official account of the person's office) or their own campaign site: immediately. From anywhere else, including a personal social account: once a second source matches. No review step | None                                                 |
| Money          | Candidate or committee, amount, period, link to the filing                                                                                                                                                                     | Donors, PACs, organizations, spending                |

For example, a body found with its name, type, source, members and calendar but no contact publishes everything it has now, the contact shows "We're working on getting this info," and the hunt for it continues. A confirmed candidate with a website and no photo goes up now, and the photo attaches when it's found.

The Kelly standard (portrait, phone, working contact, verified page, campaign site) is the full profile the factory strives for and measures on the Scoreboard. It is never a gate, and no rule holds a record back while the factory looks for more.

**11. What Ask can answer**

Because everything is linked by place and person, Ask can answer anything from simple to detailed, quickly, always with the source:

- "Where is the ABC school district office?" Address, map pin, directions and hours.

- "When does my city council meet next, and what's on the agenda?"

- "What did my mayor vote on at the last council meeting, and how did it turn out?"

- "Who is running for my state house seat, and what do they say about housing?"

- "Who gives money to my member of Congress?"

- "What does Proposition 1 actually do, and what does a NO vote mean?"

**12. Keeping it live**

Anything that was ever live came through a known door, and a known door is never treated as something we can't open again.

- Meeting doors are checked hourly in the week before and after a meeting, so a new agenda, result, cancellation or changed time is live within an hour of the body posting it.

- Every live fact knows its door. When the door's refresh date comes up, the back-end engineers' automatic feed re-reads it and drops any changes in the Box.

- Refresh dates follow how often each door actually changes: meeting calendars and agendas often, officials' contact pages less often, boundaries rarely.

- A fact past its refresh date without a successful re-read is flagged on the Scoreboard, never quietly left to go stale.

- When a door shuts, because a site moved or a key stopped working, it goes to the top of the list and everyone swarms it until it's open again. Time to reopen is tracked.

**13. How any mission runs, start to finish**

Every mission runs the same way, whatever the place: a congressional district, a county, a metro area or a state.

1.  The mission is the place, fully live and fresh. The coach starts from that end and maps what it takes: every government over the place (county, cities and towns, school, fire, water and special districts, the state and federal offices that cover it), every person in those governments, every candidate on the place's ballots, and every measure.

2.  The Bank already knows many doors, for example the platforms the local governments run on and Congress.gov for members of Congress. Back-end engineers' feeds refresh those at once.

3.  The coach sends squads at the same moment, one per part of the mission: local governments, school and special districts, the people layer and their money, and the ballot. Bigger parts get bigger squads.

4.  Within minutes the Box is filling: meetings for the next 120 days with agendas, officials with contacts, candidate websites and their stated positions, campaign-finance filings.

5.  Builders pull from the Box as it fills: profiles with portraits, meeting cards, map pins, votes from the last 120 days of minutes, ballot measures in plain English. Checkers confirm each fact in seconds and it goes live.

6.  As squads finish their parts, the coach moves those hunters to wherever the mission map still has gaps.

7.  Some targets get stuck, such as a district with no website or minutes that are scanned PDFs. Detectives crack them and write each route for the kind of door it opens, so it works for every place with the same kind of door.

8.  Auditors spot-check what went live and report green and red flags. Front-end developers run resident tasks on the place's pages and flag anything ugly or clumsy. Fixes go into the shared design, so every place's pages get better at once.

9.  From then on, every door the mission opened is on automatic refresh. When a body posts its next agenda in the week before it meets, it's live on the site within an hour. The next mission anywhere starts with everything this one learned.

**14. How it gets faster every time**

Speed comes from the Bank and the Door Registry. Each mission leaves behind the doors, keys, methods, dead ends and shortcuts it found, and each new mission starts there. Detectives turn the hardest cases into easy ones. Back-end engineers turn the most-used doors into automatic feeds. The factory measures this directly: time to cover a government the second time compared with the first, the share of targets solved from the head start alone, how often detectives' routes are reused, and facts published per hour, week over week.

**15. Running at scale**

- Every step runs on its own, connected only by the Box and the Slide, so nothing waits on anything else. A slow site holds up only the hunter working it.

- Hunter count is a dial. The budget dial in Admin sets how many run at once, from dozens to hundreds. The captain adjusts it at any time, and it actually controls spending.

- Each finding moves on the moment it arrives. Builders and checkers never wait for a whole county.

- Every agent has a time limit and hands off when it hits it. Nothing spins and nothing hangs.

- The factory watches itself. If facts per hour drop, back-end engineers see exactly where the flow stopped.

**16. Easy to repair, easy to update**

Repairs and updates take minutes. Everything that changes often lives outside the code, so most repairs are an edit the factory picks up immediately, with no code change, no new release and no restart. Code changes are kept for new kinds of doors and new features. They ship with the next combined release, which reaches the live site a couple of times a day.

**16.1 Doors are records**

Each Door Registry entry holds the address, the key, the kind of door (a meeting-platform API, a calendar feed, a page that lists PDFs), how often to check it, and plain-English notes on where the information sits on the page. Code exists only for each kind of door: one meeting-platform reader serves every government on that platform, and no code is ever written for one place. When a site moves, the repair is updating its entry. A detective usually does that on its own: it finds the new address, tests that facts flow again, saves the entry, and the door is live on its next check.

**16.2 Agents run from written playbooks**

How hunters search, how builders shape records, what checkers look for and what auditors sample are each written as plain-English playbooks the agents read every time they start. Changing how the factory behaves means editing the playbook, and the next agent to start uses the new version.

**16.3 Settings live in Admin**

The budget dial, hunter count, how often each door is checked, the one-hour target, the 90- and 120-day meeting windows, the stance topics, the social platforms, which source types count, and how missions split into squads are all settings in Admin. A change takes effect immediately. Every change is logged with who made it, when and why, and has an undo button.

**16.4 The look is set in one place**

Colors, spacing, fonts and card layouts are shared settings the whole site uses. Labels and help text are edited like content. "This is cramped" becomes one spacing change that fixes every page at once.

**16.5 When code is needed, it's small and fast**

- The code is split into small parts that each do one job.

- Each part has its own quick automatic tests, so a fix is checked in minutes and ships the same day.

- A repair agent gets only the broken part, the failing example and that part's tests, so it can't wander into the rest of the system.

- Every change can be switched on or off without a new release, and any release can be rolled back to the one before it instantly.

- New code loads without stopping the factory.

**16.6 Every repair is visible**

Admin shows what broke, what changed, who or what changed it, the before and after, and an undo. Two Scoreboard numbers track it: time to repair, and the share of repairs that needed no code change, which should be most of them and keep climbing.

**17. Proving it works, and learning from losses**

A fix can be used the moment it works once. It counts as a win only after it has worked again and again, in places it wasn't built for. After that it goes quiet, stays watched, and comes back only if it breaks.

**17.1 Every claim is labeled**

- **Proven:** measured on the live system with real results, such as facts actually flowing or cost per fact actually dropping, with the before and after one click away.

- **Testing:** in use, with results still coming in.

- **Expected:** a plan or a theory. Never shown as a result.

"This should work" is never reported as "this works."

**17.2 Success has to repeat**

A new fix, door, route or method stays in Testing until it has worked in enough different places. The bar is a setting in Admin, for example five or more places spread across more than one district or state. The team tries it everywhere the same kind of door exists, on its own and in parallel, with no approval needed:

- other places in the same district,

- a different part of the state,

- other states.

Mostly working counts. A fix that works in 40 places and fails in 2 is a success, and the 2 failures go to the detectives.

**17.3 Every fix has a map**

For every fix, the Knowledge Bank keeps a simple map: where it's confirmed working, where it hasn't been tried, and where it fails. Hunters, builders and detectives read it before they start. They use the fix where it's confirmed, try it where it's untried and record the result, and skip it where it fails. The map updates as the team learns, entirely in the back end.

**17.4 Learning from losses**

Failures are studied together. Detectives compare the places a fix failed with each other and with the places it worked, and look for what the failures share:

- the same website platform, or an older version of it;

- the same state's rules;

- agendas posted as scanned images instead of text;

- a login or a form in the way;

- a small body that posts only the week of the meeting.

What they find becomes a plain lesson in the Bank, such as "this method fails on sites that post agendas as images," so hunters and builders pick the right method up front. The lesson also predicts other places with the same cause before anyone tries them. Detectives build a version of the fix for that group, and it has to prove itself the same way. Failures that share nothing mean the method itself is shaky, which goes to the back-end engineers.

Every kind of loss is studied this way: shut doors, hunts that came back empty, facts that failed a checker, auditors' red flags and front-end red flags.

**17.5 Shown once, then quiet**

A fix appears in the queue while it's being tested. It shows in Admin once when it proves out, for example "Proven: worked in 40 places, failed in 2," and once when a lesson from its losses changes something, for example "Both failures were sites posting agendas as images. We built a version that reads them, and it now works in both, plus 30 more like them." Then it drops out of Admin. No running scorecards and no buttons to keep working things working.

**17.6 Watched forever, quietly**

- Every proven fix is monitored like every door: checked on schedule and never shown while it works.

- If it breaks, it comes back up in Admin as an update, or as a decision only if fixing it needs new money or a new platform.

- Every door and fix keeps its history in the Bank: when it broke, how it was fixed, how long it held, and when it broke again.

- A repeat break starts from that history, for example "Last time this site moved its calendar, the fix was this. It held for seven months. Try that first."

- Patterns get learned too. If a site always changes after its budget season, the next fix is ready before it breaks.

**17.7 Checking the checkers**

Auditors spot-check the team's own reports as well as the facts on the site. They pick a sample of claimed wins and confirm the numbers are real. A wrong report is a red flag on the team, and its cause gets fixed so it doesn't happen again. A green "Proven" in Admin means it was measured, repeated across many places, and is still working today.

<img src="media/2de79d9e99a193728d1248005ed5376d6299b603.png" style="width:9.375in;height:4.42708in" />

*Figure 2. How a fix proves itself, and how losses teach. The top row is a fix's life from first use to quiet monitoring. The bottom row is how its failures become lessons and a new version that goes back into testing.*

**18. Keeping it honest and nonpartisan**

- Every fact carries its source, the exact sentence it came from and the date it was read.

- Sources live in the Sources section of the card they belong to: ballot cards, person cards, battle cards, body cards and meeting cards. They are never repeated across the face of the card.

- Every source is labeled for what it is: official, campaign, filing, voter guide or news.

- When sources disagree, the more official and newer one wins, and the conflict is logged.

- Nothing is invented. A fact with no source never goes live; it stays on the to-do list.

- Stances are only ever a person's own words, with the same topics for every candidate and "not found in the sources checked" shown plainly. The factory never scores, rates or labels a candidate itself. Outside measurements, such as the Polarization Research Lab's share of a person's posts about policy versus attacks, show credited to their source. Key votes are chosen by the captain and kept current, shown alongside the person's full voting record.

- Incumbents and challengers get the same profile and the same treatment.

- Ballot summaries follow the official text in neutral words, never either campaign's framing.

- Money comes only from official filings and is reported, not characterized.

- Public office and campaign addresses only. Never anyone's home.

- Mistakes are fixed fast and traced, so the same error doesn't come back.

**19. The Scoreboard (in Admin)**

| **Number**                 | **What it tells you**                                                                                                          |
|----------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| Orders                     | Every order the captain gave: received, accepted, scheduled, in progress, done, and any that couldn't be done with why         |
| Mission progress           | How full the current mission map is, part by part, and where the squads are                                                    |
| Checklist completeness     | State Run Checklist items satisfied out of those due, by family and by place, with the counts behind every percentage          |
| Coverage                   | Bodies, offices and people accounted for out of those expected for the place, or "total unknown" with what's been found so far |
| Public delivery            | Accepted records residents can actually see, out of those that should be showing                                               |
| People coverage            | Share of officials and candidates with a full profile (the Kelly standard): portrait, contacts, stances, money, votes          |
| Facts live per hour        | Whether the factory is producing                                                                                               |
| Cost per fact              | What the factory spends for each fact it gets live                                                                             |
| Audit accuracy             | Green flags and red flags from the auditors, e.g. "99.2% still accurate"                                                       |
| Freshness                  | Share of live facts re-read on schedule, and anything overdue                                                                  |
| Shut doors                 | How many doors are shut right now and how long each took to reopen                                                             |
| Posted to live             | Time from a body posting an agenda, result or change to it being live on the site. Target: one hour or less                    |
| Look and feel              | Front-end developers' red and green flags on how the site looks and works, with screenshots                                    |
| Site speed and reliability | How fast pages load for residents, and any errors or broken links                                                              |
| Return visits              | How often residents come back                                                                                                  |
| Time to repair             | How long from something breaking to it working again                                                                           |
| Repairs without code       | Share of repairs done by updating a door, a playbook or a setting, with no code change                                         |
| Proven fixes               | Fixes that proved out across enough places, and any proven fix that broke                                                      |
| Report accuracy            | Share of the team's claimed wins that auditors confirmed                                                                       |
| Head-start hit rate        | How often the Bank alone was enough, which is the learning curve                                                               |

**20. Next step**

Once this design is approved, the next document runs the chain in section 5 forward from what's already built: which pieces exist and work, which exist but aren't connected, and which are missing. The point where the two paths meet becomes the first step of the build brief for the sessions.
