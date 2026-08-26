# The log — what each session was for, and what came out of it

**GENERATED FILE — do not hand-edit.** Written by `corepack pnpm tracker:views`
(`scripts/tracker.mjs`) from the tracker's own attribution and description fields,
plus one authored sentence per session in `docs/log-purposes.json`.

Generated 2026-08-25 (America/Phoenix, from `pnpm stamp`).

Newest first. **137 sessions.**

Runs before 2026-08-17 predate the session-naming convention, so they are named by
their date and their own commit subject. That is a lookup rather than a guess, and
`git log --grep` finds any of them.

---

## Deleted rows — RULING 46

Rows Sean removed outright, because they are not project work and do not
belong in the tracker at all. **Only he may delete a row**; a session never
may, and `tests/tracker-stores.test.ts` fails the build if one tries. These
are hard-removed from both stores — this list is the whole surviving record.

- **B08** — Read separation agreement before signing · deleted 2026-08-20 by Sean · authority: his note: "This has absolutely nothing to do with this project at all.  Delete this entirely"

---

## visual-part2-0825 · 2026-08-25

**What it started.** 1 row(s) opened, 1 still open.

- **RO04** — The gates (test - lint - tsc) check has failed on main since 2026-08-25. Test passes, types pass, and both builds pass; LINT alone fails, with exactly 2 errors and 28 warnings. Both errors are the react-hooks/set-state-in-effect rule: components/map/map-entry.tsx:894 (setPopupMeeting(null) and setOfficialPopup(null) in an effect keyed on ui.selectedVenueKey and ui.selectedDistrictOcdId) and components/speak/speak-your-mind.tsx:120 (setOpen(false) in an effect keyed on subjectId). Reproduced locally at 70fed47 with the identical 2 errors and 30 problems, so it is not a CI-only condition. Last green Build check on main was 0160e3b at 19:18Z on 2026-08-25; the merge of PR 180 (9a2a8d7) was CANCELLED and never proved green, then 13f4fcf and 70fed47 both failed with the same two errors. Introduced by the previous session: 57ceaba (Item 9, the small cards stop scrolling sideways) added the map-entry effect and a9d0555 (Item 10, the large cards learn the difference between a person and a body) added the speak-your-mind effect. Both effects are RESET-ON-KEY-CHANGE patterns, which is the case React documents as not needing an effect at all, so the fix is likely derive-during-render or a key prop rather than a disable comment. NOT FIXED HERE: the 8/25 Part 2 visual brief carries an explicit precondition that a red main stops the session and belongs to the recovery brief. Note for whoever takes it: both files are exactly the surfaces the Part 2 items 7, 9 and 13 would edit, so the recovery and that work will collide if run in parallel. *(open)*

**Needs Sean.** Nothing.

## one-session-0825-nonhunt · 2026-08-25

**What it started.** 9 row(s) opened, 9 still open.

- **NS16** — The brief for 2026-08-25 names docs/feedback/we-the-people-feedback-2026-08-25.md as AUTHORITATIVE and says its carryover table is law. That file is not in the repo, not in the Drive mirror root, and not in the Drive screenshots folder — searched all three at session start. The 17 captures ARE committed and were read; only the document is missing. The same is true of the 8/24 document: the LAY, BC, WGH and ASK ids exist in briefs and commit messages and in no committed file, so a session cannot check an id against anything. RULING 108 is exactly this: anything a session must read at session start lives in the repo, because a session has a shell and a clone. This session worked from the brief's prose plus the captures and says so rather than pretending it had the document. THE QUESTION: would you rather (a) paste the feedback doc into docs/feedback/<date>/ as part of each walkthrough, so a session can diff its ids against something, or (b) keep it in chat and accept that ids are only ever as good as the brief that quotes them? If (a), it is one paste and nothing else changes. *(open)*
- **NH177** — Read from Netlify's deploy API on 2026-08-25 while answering Item 6's verdict (a). Of the last 60 production deploys, these reached state 'error' and were never published: 3449eb8 (PR #177), 41113c1 (PR #171), 55d3047 (PR #170) and e0f6426 (this morning's intake tripwire). Three are real CODE merges. Each was covered by a later successful merge so nothing was permanently lost — but between the merge and that later deploy production was serving older code, and no instrument in this repo reports it. This is NJ25's shape still alive. It did NOT cause any of the six recurrences in Item 6 (all three testable claims were live in d43adf7 during Sean's walk), which is why it is a row rather than part of that verdict. RULING 152 now says a reader-facing DONE names the deploy that carries it; what is still missing is something that NOTICES an errored deploy without being asked. pnpm deploy:live answers for the tip only. *(open)*
- **NS17** — BC-14 says sources live in the large battlecard and the small card lists names and nothing else. Four .source-tag render sites existed; three are removed (district-popup, coverage-notice, official-popup — all three render into .popup-card, so all three are small cards). The fourth is components/officials/key-votes-section.tsx and it is DELIBERATELY LEFT. A roster row is an identity; a vote is a CLAIM about how a named person voted, and the no-claim-without-a-source rule attaches the source to the claim rather than to the card. RULING 138 says display consolidates sources to one line and the record is never deleted — but it does not say where a VOTE's consolidated line goes, and the small card has no such line today. THE QUESTION: (a) leave the per-vote source where it is, (b) remove it and add one consolidated source line to the bottom of the small card, or (c) remove it because the large card already carries every vote's source. (b) is the most work and the most consistent with RULING 138. *(open)*
- **NS18** — You asked whether Mark Kelly's two sources are capped or filtered. NEITHER. sourceCountLabel is computed from the same array the tab maps over, so the stated N equals the rendered rows by construction; mergeSources merges by (org, url), which is a dedupe of identical publishers rather than a cap; and there is no slice, limit or threshold anywhere in the path. The 2 is a true count of what the tab was handed, and personCardSources is handed exactly two things: the identity spine, and the congress-legislators directory. THE GAP, and it is a design question rather than a defect: his card also renders CAMPAIGN MONEY from the FEC and a VOTING RECORD from roll calls, and both cite their own publisher inline at the claim rather than joining the Sources tab. So the tab is honest about what it was given and is not a complete list of what the card is sourced from. THE QUESTION: should the Sources tab be (a) the card's COMPLETE citation list, which means passing the FEC and the roll-call publishers into it, or (b) what it is now — the identity sources, with each section citing its own? (a) makes the count larger and more useful; (b) keeps every citation next to the claim it supports. *(open)*
- **NS19** — Built nothing, as the brief directs. THE EVIDENCE: the ballot page at 07866 now carries THREE pill treatments in one screen. (1) The two top pills — Narrow this to where you live, Moving here? Know the basics — at 40px tall, lavender-tinted, 1px border, semibold, added this session for BAL-11. (2) The election-box pills — Where can I vote?, Check whether you're registered — taller, more saturated lavender, and set on their own lines rather than in a row. (3) View Battlecard, now deep navy and filled, 522px wide, one per candidate. A fourth exists on the map: the two map pills, which this session made agree with each other for WGH-9 at 224x42 with a mono face. THE PROPOSAL: one pill scale with three named roles — PRIMARY (filled, the one thing a surface most wants done: View Battlecard, Speak Your Mind), SECONDARY (tinted outline, a real action that is not the main one: the top two, the election box's two), and COUNT (mono, a readout that happens to be pressable: the map's meetings and who-governs pills). Same height and padding within a role, at every surface. THE QUESTION: is that the right three roles, and do you want the election-box pair to become a ROW like the top two, or stay stacked? *(open)*
- **PU07** — Measured 2026-08-25 against a local production build at 07866. The SERVER is fast — TTFB 22-94 ms — and the browser sees FCP 1,760 ms on the first cold navigation against 156-164 ms warm, DOMContentLoaded 62 ms, load 185 ms. So there is nothing to fix in the render path and the number that matters is the cold first paint, which is the size of the document: 386 KB of server-rendered HTML for 90+ contests and 276 candidacies. app/ballot/loading.tsx ships as the visible loading state the item required regardless. Reducing the document is the actual fix and is a bigger change than one item: candidate cards are fully rendered for every contest whether or not a reader ever scrolls to them, so the obvious lever is rendering contests below the fold on demand. That trades against the page being one server-rendered document a reader can search and a crawler can read, which is worth keeping. *(open)*
- **NH178** — Reproduced 2026-08-25. deploy:live reads Netlify correctly and prints the full verdict — site, main tip, last deployable, live deploy id and state, live commit, and CURRENT — and then dies with 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src/win/async.c, line 94' and ELIFECYCLE exit code 3221226505. That is a libuv teardown crash on Windows, after the work is done. It matters because RULING 125 makes this the ONE production question a close-out asks, and any caller that gates on its exit code reads a successful read as a failure — the exact shape of the defect NJ25 is about. The verdict itself is trustworthy; the exit code is not. *(open)*
- **PU08** — Found 2026-08-25 while measuring BC-16. Counting .panel elements whose text contains PUBLIC MEETINGS returns 2 when one venue panel is open, and the entity modal's title renders twice in its own innerText ('Rockaway township' followed by 'Rockaway township'). Only one of each is visible, so this is not a reader-facing defect today — it is almost certainly the desktop and mobile placements both rendering with one hidden by CSS, which is the same pattern .rail-floaters and .map-bottom-stack use deliberately. It is a row because it made a measurement wrong: the BC-16 harness reported two panels open before anything had been clicked, and a duplicate node is a thing every future DOM count will have to know about. *(open)*
- **NH179** — Item 13's machinery shipped 2026-08-25: lib/ops/flake-quarantine.ts classifies a check from N runs of one unchanged build, walk:all consults docs/walk-flakes.json and reports a quarantined check as its own fourth outcome that is never counted passing, and pnpm flake:sweep runs the walk N times and writes the verdict. 8 guards, including NH176's four real runs replayed. WHAT IS NOT DONE: the sweep has not been run, so docs/walk-flakes.json does not exist and nothing is quarantined yet. The classifier is deliberately unable to call anything flaky from one run — it takes a PASS on the same unchanged tree — so a single walk cannot populate it. Run pnpm flake:sweep --runs=3 --write against one local production build and the quarantine fills itself; until then walk:all behaves exactly as it did before, which is the honest state rather than a silent one. *(open)*

**Needs Sean.** NS16, NS17, NS18, NS19

## one-session-0825 · 2026-08-25

**What it finished.** 3 row(s).

- **NS11** — The brief named one leaked key (Census). A sweep BY VALUE across the repo, the Drive mirror and the local session transcripts found NINE distinct credentials in plaintext: CONGRESS_API_KEY, PLURAL_API_KEY, FEC_API_KEY, LEGISCAN_API_KEY, CENSUS_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL, WTP_PRODUCTION_DATABASE_URL_READONLY and WTP_PRODUCTION_DATABASE_URL_WRITE. The last three are database connection strings carrying passwords, and one of them is the PRODUCTION WRITE credential. The Drive mirror — the surface that leaves this machine — held six of them and has been SCRUBBED (0 remaining, verified by re-read). The local ~/.claude transcripts still hold all nine and were deliberately NOT edited: they are the runtime's own files and corrupting session state to remove a secret that has already escaped would be a real cost for no security. A value written to a synced folder must be assumed read. Scrubbing is cleanup; ROTATION IS THE FIX, and only Sean can rotate these.
- **NH142** — NS11 recorded the mirror scrubbed and verified by re-read on 2026-08-24. A sweep at the start of this session found six occurrences of five live credentials back in it. Nothing un-scrubbed it: handoff re-runs the transcript exporter, which rewrites the mirror out of the local jsonl files, and those are deliberately never scrubbed. The mirror is scrubbed again and handoff now scrubs it immediately after every export and re-reads to confirm. ROTATION IS STILL THE FIX and only you can do it: 0 of the 9 credentials in NS11 are rotated as of this session, proven by the sweep still finding every current value in a leaked location.
- **NH169** — pnpm secrets:sweep found six credential VALUES in three transcripts on the Drive mirror. CONGRESS_API_KEY (twice - 8/17 and 8/18), FEC_API_KEY, PLURAL_API_KEY and LEGISCAN_API_KEY (all 8/17), and CENSUS_API_KEY (8/24, from another session that ran today). All three files have been scrubbed and re-read clean. RULING 127 is explicit that this is not enough: a value written to a synced folder must be assumed READ, so scrubbing is cleanup and ROTATION is the fix. That is yours - the accounts are yours and no session can do it. Rotate all five, then prove it the way RULING 95 asks: CALL the dead key and confirm it is refused, and CALL the new one and confirm it answers with the data requested. Both halves matter, because the Census host answers a dead key with HTTP 200 and an HTML page titled Invalid Key, so a status check alone reads a corpse as healthy. Nobody pasted these: the leak mechanism RULING 127 names is a tool printing a resolved URL back, and several of these APIs carry the key as a query parameter. This session neither caused nor touched the leaks; it found them at the ship gate and is routing them to you.

**Needs Sean.** Nothing.

## final-pass-0825 · 2026-08-25

**What it finished.** 4 row(s).

- **NJ16** — Measured 2026-08-24 with pnpm search:rung. Mojeek, Brave, Ecosia, Startpage and Bing all Disallow: /search in their own robots.txt, so they are not walked at any rung. html.duckduckgo.com and lite.duckduckgo.com publish Allow: / and answer HTTP 202 with a challenge page at rungs 2 and 3; rung 6, a live browser with JavaScript executed, renders the sentence 'Unfortunately, bots use DuckDuckGo too.' This is a WALL and no field moves toward absence on it. It matters because two of the five moves of the stuck protocol are literally 'type this into a search box', so an argued absence cannot be earned through that move today. The compliant routes that replaced it are in docs/sources.md.
- **NJ24** — RULING 125 made the Netlify deploy record the one remaining production fact a close-out needs, and the tool that reads it cannot. scripts/deploy-live.mjs defaults NETLIFY_SITE_ID to the bare name sparkwtp and calls /api/v1/sites/sparkwtp/deploys, which is HTTP 404. Measured 2026-08-25 with the token that is already in .env.local: the token works (the sites list returns 200 and shows sparkwtp), and the same deploys call returns 200 under either the site id 6b39b212-f8f8-4ddf-9357-a16faa9ecd08 or the full host sparkwtp.netlify.app. Only the bare name fails. The tool reported cannot-tell and exited non-zero, which is RULING 125's four-verdict rule working exactly as designed — it did not lie — but the verdict has been unavailable every time it has been asked. Fix: resolve a bare name through the sites list before calling deploys, and name the resolution in the output so a wrong site is legible rather than a 404. Not shipped tonight because it is a second code merge for a tooling defect rather than a regression the walk caught; the deploy fact was read directly from the API instead and is in the session report.
- **NJ25** — Read from the Netlify deploys API 2026-08-25 while getting this session's deploy id. Commit 26b357d, 'context.md, rewritten after shipping', deploy 6a8d1b7b08d04c00083024d8, context production, state ERROR. So production was serving ab4da20 rather than the tip of main from 04:35 until this session's merge deployed successfully at 07:38. Two of the six most recent production deploys are in state ERROR (41113c1b and 55d30471 as well), so this is a pattern rather than one bad build. Nothing in the close-out path notices: pnpm main:green asks GitHub whether the CHECKS passed, which they did, and a Netlify deploy failing afterwards is a different question that only the deploys API can answer — which is the same tool NJ24 says cannot currently answer it. The two rows belong together.
- **NJ22** — pnpm photo:sheet builds portraits-pending.png from candidate cards that already carry a photoUrl and whose review state is PENDING. That is the right artifact for a portrait already in the product awaiting his yes or no. It cannot show a portrait that has been STAGED and not shipped, which is every portrait a hunt produces — 55 of them on 2026-08-24, of which two were judged queueable. The session built pnpm sheet to read them as images and put the verdicts in docs/photo-staging-2026-08-24.md, but the picture itself reached Sean's Drive only as a one-off dated file, which handoff correctly refused as EXTRA: the mirror's canonical set is standing documents, and a session dropping a dated artifact into it every night is exactly the drift that guard exists to stop. So the two queued portraits are named in the doc with their source URLs and the sheet regenerates with one command, and that is worse for him than a picture would be. What is owed is a decision about where staged portraits live — a second standing mirror file that is overwritten rather than dated, or a staging area photo:sheet reads alongside the shipped cards.

**What it started.** 7 row(s) opened, 7 still open.

- **NH170** — Three separate defects, all reproduced before they were touched, all fixed in final-pass-0825 — this row exists so the FOURTH is not lost. (1) legistar's composite wrapper re-branded the adapter's result through a second accountedNormalize call without countedButProduced, so every online meeting was counted once as produced and once as dropped; against the recorded Pima fixture the adapter reports CONSERVED 18 of 18 and the wrapper threw '4 more dispositions than records'. (2) nj-filing ran nj:filing:check BEFORE nj:ballot --write, and the check exits non-zero on STALE — so the staleness gate stopped the only command that could clear the staleness, and curatedAt froze on 2026-08-23. (3) The orchestrator's own header states a three-valued exit vocabulary and calls exit 2 'commit the survivors, THEN go red', and runCommand asked status === 0 — so the ingest's 'PARTIAL PROGRESS IS ON DISK AND MUST BE COMMITTED: 451 rows from 10 of 11 sources' was read exactly like a total failure and the workflow printed 'nothing usable was written'. WHAT IS STILL OWED: the daily refresh has not been verified end-to-end since the fixes. It runs at 09:11 UTC. Read the next run and confirm all three paths behave — and if legistar conserves and nj-filing rebuilds and a partial commits, close this. *(open)*
- **NH171** — Run 32840268606, 2026-08-25 11:03 UTC. push-main.mjs retried five times and every attempt came back 'remote: fatal error in commit_refs' with '! [remote rejected] HEAD -> main (failure)'. That is a GitHub-side error rather than a rejected fast-forward — a rebase-and-retry cannot fix it and correctly did not. Nothing in this repo is broken by it and nothing was lost: the tripwire commits only under docs/, which the deploy filter classifies as non-shipping. Recorded so a SECOND occurrence is recognised as a pattern rather than diagnosed from scratch, and because RULING 24 says a check that could not run is reported separately from one that failed. If it recurs, the question is whether push-main should distinguish a remote-side fatal from a rejected push and stop retrying. *(open)*
- **NH172** — Measured 2026-08-25 during the tier-above directory inversion. www.governor.nh.gov, www.nh.gov and www.nh.gov/governor/executive-council/ all answer HTTP 403 to a browser header set AND to curl — two different clients, two different TLS fingerprints, same refusal. That is an EGRESS or host-policy wall rather than a header problem (ladder rung 5's finding), and it is recorded with its date rather than as a standing property (RULING 52). What sits behind it: the Governor's own page and the Executive Council's roster, which are the official sources for two contests on the 03255 ballot — Governor (4 candidates) and Executive Councilor District 2 (3 candidates). The next rungs not yet walked are 5 (a different egress), 11 (the Internet Archive) and 12 (the vendor platform, if the state runs one). NOT an absence: this names what the wall is around, per RULING 90 item 4. *(open)*
- **NH173** — Read 2026-08-25. https://www.tapinto.net/robots.txt answers HTTP 403, so the policy that would say whether we may walk it cannot be read at all — and a 403 on a policy is not an implied yes. TAPinto is a hyperlocal NETWORK with per-town sites across New Jersey and is the largest press surface this county has that this project does not read; docs/sources.md already recorded it walled at rung 3 on 2026-08-24. lib/hunt/press-surface.ts records it as UNREADABLE, which is a third state beside PERMITTED and DISALLOWED and is deliberately not either. Routes not yet walked: the Internet Archive's capture of the robots.txt (rung 11), which would establish what the policy SAYS even if the live file refuses; and asking the publisher directly, which is rung 13 and is a real option for a local outlet. *(open)*
- **NH174** — pnpm door2 walked all 19 candidacies on the 07866 ballot who are people this repo already records sitting on a governing body — the class your 8/24 ruling pre-approves — at the MEMBER'S OWN page rather than the body's index, which was NJ13's defect. 19 of 19 pages answered, 0 walls. Six portraits found, four of them new: Jennifer Rowland (Chatham Township), Russell Goodwin and Michael Dominianni (Chester Borough), Sean Mabey (Kinnelon), Kyle Russell and Melissa Florance-Lynch (Pequannock). Each is name-matched on the person's own municipal .gov page, read as an img element and never an og:image. ZERO shipped, which is the rule for a candidate portrait and is not something a hunt gets to decide. The queue is data/photos/door2-incumbents-2026-08-25.json. Two phones from the same walk DID ship — Nancy Verga and Melissa Fostle — because a number a town publishes beside a named member is a fact checkable by dialling it, where a portrait's failure mode is a wrong face beside a real name. *(open)*
- **NH175** — 2026-general-candidate-order-081026.pdf, the third document on the Morris County Clerk's candidates page. Read 2026-08-25: 7 pages, every one rendering with NO text layer, so the extractor correctly reports ZERO_ROWS with the reason 'this is a scanned PDF. The next rung is OCR (lib/extract/ocr.ts), NOT a finding that the document is empty'. Both the filing parser and nj:filing:check exclude it by name and say why, which is right — including it would produce a guaranteed zero-row parse. What it carries is the BALLOT POSITION of every candidate, drawn by lot, which decides the order a reader meets them on a real ballot and which this product does not hold. lib/extract/ocr.ts exists. Nobody has pointed it at this document. *(open)*
- **NH176** — Measured 2026-08-25 against one local production build, four consecutive runs, no code or data changing between them. Every run: 372 passed, 6 declared COULD NOT RUN, and exactly ONE failure — a different one each time. Run 1: [promptD] the schema check, which was REAL and deterministic (the local Neon branch was at 19 of 21 migrations) and has passed on every run since it was applied. Run 2: [g12] an exact name navigates and asks nothing at 07866, offered="Board of County Commissioners — Board of County Commissioners - Work Session" — the IDENTICAL string that PASSED in run 1. Run 3: [g5] north Tucson renders crisp, not muted, at city zoom, delta 8.61 against a 2.5 threshold. Run 4: [g12] again, at 03255 this time. WHY THIS IS A P1 RATHER THAN AN ANNOYANCE: the whole premise of this suite is that a failure is a NAMED REGRESSION — 'the win <session> shipped is undone' — and every session is required to run it and report the result. A suite that fails one arbitrary check per run teaches a session to look at the failure, decide it is probably the flaky kind, and move on. That is the CLAUDE.md failure this repo names most often, arriving through the instrument built to prevent it, and it means the ONE deterministic failure in run 1 could just as easily have been shrugged off. THE SHAPE OF THE FLAKES: both families settle a browser interaction or measure a canvas. g12 waits for the ask box to route and reads what it offered; g5 diffs a rendered map region against the same region with an effect off. Both are timing-dependent and both already carry settle logic — the question is whether the settle condition is the right one, not whether to raise a threshold. Raising a threshold to fit the change it was supposed to catch is what a ceiling raised to fit is (CLAUDE.md), and this row is not a request to do that. WHAT WOULD SETTLE IT: run walk:all N times against one unchanged build and record which check identities fail at least once — the suite already prints stable check identities, so the census is mechanical. A flaky identity is then a known set a run can report against, which is the difference between 'one check failed, and it is one of the four we know are timing-dependent' and 'something broke'. *(open)*

**Needs Sean.** NH174

## visual-0824-nonhunt · 2026-08-24

**What it started.** 7 row(s) opened, 6 still open.

- **NH163** — Sean's 8/24 walkthrough of the app, recorded as sixteen captures between 11:54 and 12:27. Every id was built and verified against a local production build in the visual-0824 session, with the captures read as images. Opened as ONE row because they were worked as one item list and share one verification pass; the per-id endings are on the Session record and in the session's close-out. Kept open only until Sean has looked at the result — the work itself is done and the gates are green. *(open)*
- **NH164** — Your BC-11 ruling asked for the disclosure to be drafted this session, marked for your review as COPY, and shipped as drafted meanwhile. It ships as: 'What you write may be shared - without a name, because we don't hold one - with campaigns, organizations, and researchers working to understand what people want.' Three things in it are load-bearing and worth checking: it says MAY rather than will, because a commitment not honoured on every instance is worse than a reserved right; it gives the REASON there is no name inside the sentence, because anonymously is a promise and we-don't-hold-one is a checkable fact; and it names the buyer classes out loud at the moment of typing. The framing above the box reads 'What would you say if [the body] were standing in front of you?' and the placeholder is 'What would you want to say?'. Change any of it and the words live in lib/speak/copy.ts. *(open)*
- **NH165** — Rule 4 of your BC-11 ruling is built: nothing typed into Speak Your Mind is ever auto-forwarded, and content the triage reads as a threat or as menacing is stored with review_state HELD and excluded from everything. What does not exist is the surface where you READ that queue and act on it - which is exactly what T05 says about the abuse policy generally. This row links the two: the HOLD half now has a concrete first surface, and the REVIEW half is still yours to unblock. T05 stays open and only you close it. The tiers are docs/abuse-policy.md's own T1/T2/T3, not new ones, and the rules that decide are lib/speak/triage.ts with the harsh-political-speech cases planted in the test so over-filtering fails the build. *(open)*
- **NH166** — OFF-3 asked for the superintendent's photo from the TUSD site, queued for your review under the photo rules, with the rest of the board swept alongside. NOT DONE this session and reported as not done rather than smoothed. Two things you may want to rule on. First, the four-door rule: a district's own site publishing a portrait of its own superintendent is door 2, an official government-published portrait, and TUSD is not a .gov host - so whether door 2 reaches a school district's own domain is your call and not a session's. Second, the app spells him Gabriel Trujillo; the 8/24 brief dictated Gabrielle. The naming rule says the app's spelling is authoritative, so nothing was changed - but if the app is wrong, that is a data fix and it wants your word first. The board's other five members already carry portraits; he is the one initials circle on that card. *(open)*
- **NH167** — LAY-4 puts Who Governs Here and the meetings count in a floating region beneath the rail, and both live in one fixed flex column so they cannot overlap at any viewport. At 1440x900 the rail wants 662px and the who-governs card wants 350px or more against 876px of column, so they do not both fit and something is always scrolling. The rail is capped at 58% of the column: at 70% the card had 100px, less than its own header. Both scroll internally so nothing is unreachable either way, and WGH-6 is the real answer - clicking Who Governs Here minimizes the rail and the card takes the whole column. The number decides what a reader sees BEFORE they choose, and it is the kind of call worth looking at on a real screen. *(open)*
- **NH168** — MTG-6 titles a venue card with the body and MTG-7 puts the sitting's own name on the entry beneath. Where a source publishes a DIFFERENT bodyName per sitting - Tucson Unified does, with names like GOVERNING BOARD AGENDA SPECIAL MEETING - the entry carries something distinct and it reads well. Where a source publishes ONE name for every sitting, as Tucson Parks and Recreation does, the entry repeats the card title. Sean's own reference capture 12-01-44 shows the same repetition and he marked only the jurisdiction prefix, so nothing was changed here. Worth a look on a real card: the honest options are to drop the entry title where it equals the card title, or to leave it as the anchor for the date and the agenda link. *(open)*

**Needs Sean.** NH164, NH165, NH166

## state-money-0824 · 2026-08-24

**What it finished.** 1 row(s).

- **NH121** — pnpm walk:all against production on 2026-08-24 raised a NAMED REGRESSION at 03255 on the phone viewport: the sidebar says 201, the panel header says 201, and the seven group headings add up to 200. One meeting is in the panel's own count and in none of its groups. The reader is not shown a wrong number - both figures are internally consistent with what they are counting - but one row is invisible in the grouped list, and the check that exists to catch exactly this is red.

**What it started.** 6 row(s) opened, 5 still open.

- **NS12** — RULING 125 moves every walk onto the local production build and leaves exactly one question that needs Netlify: which SHA is live. pnpm deploy:live reads it from Netlify's deploy API in one call with zero requests to the site. There is no NETLIFY_AUTH_TOKEN in .env.local and the Netlify CLI config on this machine holds no user, so the tool correctly reports CANNOT-TELL and exits 3 rather than passing. A Personal Access Token from Netlify (User settings, Applications, Personal access tokens) added to .env.local as NETLIFY_AUTH_TOKEN closes it. *(open)*
- **NS13** — RULING 124 item 5 makes pnpm closeout REFUSE a separate push to main, per Sean's instruction that records ship inside the PR or not at all. CLAUDE.md's merge-cadence rule permits separate close-out commits for a stated reason: a document cannot name the commit that contains it. Most of that reason is now gone — RULING 125 moves walks onto a local build, so the walk numbers ARE knowable before the ship. What remains genuinely unknowable in advance is the deploy SHA. This session's position: that is an operational fact read from Netlify's deploy record afterwards and it does not need to live in a commit at all. If Sean disagrees, the merge-cadence rule needs amending rather than the tool. *(open)*
- **NH122** — cfs.sos.nh.gov ANSWERS: Node fetch gets HTTP 200 and 65,928 bytes. But the page is an Angular single-page app whose HTML is a shell, and the campaign-finance data endpoints were not found. Rung 6 (a live browser, which would reveal the calls) is REFUSED with 403 by the edge — curl is also refused, and only Node's fetch passes, which inverts the usual assumption that the browser is the strongest rung. Reading the served JS bundles (a new route, recorded in the expansion log) surfaced only lobbyist paths; the campaign-finance routes are in lazy chunks this pass did not locate. *(open)*
- **AZ02** — POST https://seethemoney.az.gov/Reporting/GetNEWTableData answers HTTP 200. Posted with a guessed body it returns a two-byte empty payload, which is a statement about our request rather than about Arizona's records. The sibling name GetDetailedTableData is a 404, so the endpoint name is exact. robots.txt is 404 and there is no terms-of-use page at the guessed path — both recorded as measurements rather than as permissions. *(open)*
- **NJ14** — Of the 07866 ballot's 272 candidacies, 235 resolved to an ELEC location and 37 did not. Fifteen of the 37 are correctly out of scope: US Senate and two congressional districts file with the FEC, and the state-level contest files elsewhere. The rest are REGIONAL SCHOOL DISTRICTS — West Morris Regional, Morris Hills Regional, Hanover Park Regional — plus Long Hill Township and Parsippany-Troy Hills, whose names did not resolve against the ELEC dropdown under any of the six municipal suffixes tried. *(open)*

**Needs Sean.** NS12, NS13

## rulings-sweep-0824 · 2026-08-24

**What it finished.** 26 row(s).

- **T10** — Sean told the tester that everything collected during the demo gets deleted when testing ends. This builds the deletion so it happens whether or not anybody remembers to do it.
- **R33** — Sean's map of the project's sessions lived outside the repo, so nothing could read it. It is now committed, and the row stays open until he confirms the copy in the repo is the one he wants used.
- **T04** — Decide, and publish, whether this data is ever sold exclusively to one buyer. The neutrality claim does not survive a yes, so the answer shapes the business.
- **R55** — The document Sean's session prompts are generated from lived outside the repo. It is now committed, and this stays open until he confirms the committed copy is the one to use.
- **R56** — The old status page put 54% of the tracker in a section called "everything with no recorded prerequisite", which is not a place. Superseded by the rebuild this session, and it stays open until Sean says the new sections are right.
- **R57** — Portraits and PDF archives are too big for git, so they live in a content-addressed store. Where that store actually lives — so a deploy can restore from it — is Sean's call.
- **NH10** — Tobin Menard is running for Executive Council in District 2, which covers Newbury. His campaign site publishes exactly one picture of him: a clean studio portrait with the words 'Accountability Responsibility' printed across it in red. The photo rule says a portrait, never a wordmark, and this is a portrait carrying one. I refused it, which means he shows initials on the ballot page while the sitting councillor beside him shows her face - and that is the visual asymmetry the equal-effort rule exists to stop. It is a call about how a real person looks on a reader's screen, so it is yours.
- **NH11** — Shaun Fife is running for Governor. He has no campaign website and no campaign Facebook page. What he has is a candidate page on a political party's own site, carrying his name, the office, his own words and a contact address. Two of our rules point in opposite directions about it and the third makes it worse, so it is yours to settle.
- **NH26** — RULING 55 says every photo is reviewed by you and only an approved photo renders. Gating on an empty store would have blanked every portrait in the product the moment the rule shipped, so the 48 photos already shipping were recorded APPROVED with decidedBy grandfathered - which means SHIPPING BEFORE THE RULE EXISTED, NOT APPROVED BY YOU. They are labelled that way in data/photos/review.json and carry a decision date, so pnpm stale surfaces them on RULING 53 clock. What is owed is your eye on them. The 5 refusals are already recorded REJECTED with their reasons - the flag stock photo alt-texted Victor Orlando, the scanned 1978 Grand Jury manual served as a campaign og:image, the Karishma Manzur banner-with-wordmark, the photographer-credited Monkman file, and the Ayotte WinRed graphic from 2026-08-14. One row per session listing N photos, never one row per photo: 47 candidates plus 90 officials would otherwise flood this queue.
- **NH30** — RULING 55 says only a photo you have approved renders. Three were hunted on 2026-08-21 and are PENDING: Meg Hagaman (Merrimack County Attorney, door 3), Jon Raiche (Merrimack County Attorney, door 3) and Vincent S. Ribas (Merrimack County Commissioner D2, door 2). Each one was read as an image before it shipped and each is a clean solo portrait; the cards render initials until you say yes. Nothing else about any of the three is affected.
- **NH31** — The refresh commits only if every source succeeded. One source producing zero rows from a non-zero fetch fails the run, so the snapshot does not move - even when carry-forward already saved that source's rows and every other source was fine. Today that is 14 failures of 37 runs. At national volume it means the snapshot never commits again, and the decision to make the gate per-source rather than per-run is yours.
- **NH33** — Lake Todd Village District governs territory in Bradford AND Newbury. The New London-Springfield Water System Precinct serves New London AND Springfield. A body id here is <division>#<slot>, so each of them ships as two rows carrying the same name. They are one body wearing two ids, not two districts, and every count that walks the registry counts them twice.
- **NH65** — RULING 55 says only a photo you have approved renders. Five were hunted on 2026-08-22 from Morris County municipalities' own websites and are PENDING, so those five cards show initials until you say yes. Every one is door 2 - the picture the government publishes to identify its own member - and every one was read as an image before it shipped, in one contact sheet at screenshots/nj-hunt4-portraits.png. Jennifer Rowland (Chatham Township Committee, chathamtownship.org, file named jen_rowland.jpg). Melissa Senatore (Jefferson Township Council, jeffersontownship.net). Sean Mabey (Kinnelon Borough Council, kinnelonboro.org, file named thumb.Mabey 400.jpg). Marilyn Althoff (Mendham Borough Council, mendhamnj.org, file named thumb.Althoff1.png). Melissa Muilenburg (Mountain Lakes Borough Council, mountainlakes.gov, file named Muilenburg-Photo-scaled.jpg).
- **NS06** — The Census key has sat in .env.local since before this session and had never been called by anything in the repo - confirmed by sweeping the tree with git grep -a --untracked rather than by trusting docs/sources.md. Called for the first time on 2026-08-22 it returns HTTP 302 with X-DataWebAPI-KeyError: 1 and Location: api.census.gov/data/invalid_key.html. A call with no key at all returns the same 302 pointing at missing_key.html, so the API cannot be reached without a working credential. WHAT IT COSTS: the demographic layer behind a zip - population, median household income, median home value. It closes no Kelly field about a person, so nothing in the hunt is blocked; what is blocked is any zip surface that wants context about a place. WHAT IS NEEDED FROM YOU: request a replacement key at api.census.gov/data/key_signup.html and put it in .env.local. The route is in the manifest as census-acs-api with the wall recorded as a dated measurement on the CREDENTIAL, never as a property of the source.
- **NS07** — The government graph crawl enumerates New Jersey's executive departments as governing bodies under RULING 57 - each with its own official site, and each holding public meetings and rulemaking hearings. The Department of Banking and Insurance sets rules on mortgages, insurance premiums and pawnbrokers, and those hearings are exactly the there-is-a-hearing-Tuesday surface this product exists for. THE QUESTION IS NARROW AND IT IS YOURS: their MEETINGS are plainly in scope and the session is wiring them. What is not settled is whether an APPOINTED cabinet secretary or department head renders to a reader as someone who governs them, the way an elected mayor or council member does. The who-governs card's verb is GOVERN, which is a stronger claim than is-responsible-for-this-area, and a session widening it would be making a product decision about what that word means. Nothing is blocked either way - the departments are enumerated and their meetings are hunted regardless of how you rule.
- **NS08** — Arizona's entry in the FEC Combined Federal/State Directory names SIX offices, and one of them is the Navajo Nation Ethics and Rules Office - listed alongside the states as a jurisdiction that holds administrative hearings, ethics clearances, standards of conduct and investigations under the Navajo Ethics in Government Law. No municipality list, no county roster and no state register would have produced it. The Navajo Nation, the Tohono O'odham Nation and the Pascua Yaqui Tribe all hold territory in or adjacent to Pima County, which is where 85641 and 85701 are. RULING 57 says the twig is as relevant as the trunk, and a sovereign nation is not a twig - it is a trunk this product has never touched. This product has no vocabulary for a sovereign government that is neither federal nor state nor local, and a session inventing one would be making a decision about how this product describes a nation. Raised now, before the Arizona hunt, because the enumeration step under RULING 86 surfaced it and the hunt should not start without your answer. Recorded in docs/arizona-source-enumeration.md.
- **NH78** — OFF-1 photo review — the seven Morris County commissioner portraits. All seven are sourced, all seven were READ AS IMAGES, and none has been shipped. Your decision keys to the ASSET, not to the person. Every one is on morriscountynj.gov, a .gov host, and ships under DOOR 2: the portrait a government body publishes to identify its own member, with attribution to Morris County and remove-on-request. Tayfun Selen's already shipped this way on 2026-08-15, so the six join him under the same door rather than arriving under a different rule. The record with every URL, alt text, byte count and per-row judgment is docs/evidence/off1-morris-commissioner-portraits-0823.json. What is owed from you: yes or no per asset, after which the session writes them into the photo store. Worth knowing WHY they were missing: the 2026-08-15 hunt walked the board INDEX page twice for six of seven and recorded 0 candidate images, while the seventh was walked at his own page and returned a portrait immediately. Each commissioner's own page URL was already in the registry as websiteUrl. That is RULING 52's shape - a defensible rung history behind a route nobody varied - and it is why the new script DISCOVERS the member pages from the board index rather than guessing them.
- **JOB02** — The scheduled job refresh-meetings-snapshot.yml failed on two CONSECUTIVE runs (32543652154 and 32543393133), both at: A source failed for a JOB reason — this run is red, and has since gone green on its own. It is not broken right now. Nobody found out why it broke, so the next occurrence starts from the same nothing — which is why this is a row rather than a shrug. This watcher runs once a day and used to read only the two most recent runs, so a double failure that healed in between was invisible to it (NJ Hunt 3 item 1c). Over its last 40 completed runs it has failed 17 time(s). Two consecutive failures is evidence the cause is ours rather than a host refusing on a schedule — a wall would not usually repeat exactly. RULING 56 opens this automatically so a degrading data path is not a page nobody watches. [job-watch:refresh-meetings-snapshot.yml]
- **NH111** — Photos at 07866 stood at 0 of 272. Every candidate holding a verified campaign site was walked for an og:image and the page's own img elements: 7 candidates, 25 images staged, and ALL 25 were READ AS IMAGES on two contact sheets before any verdict was written. Two cleared the composition standard and both ship under DOOR 3 - the campaign's own self-published portrait from its own site, labelled campaign-provided, source recorded, remove-on-request. Nothing has shipped. The decision keys to the ASSET, not the person, and it is yours.
- **R54** — A standing mechanism rather than a job: every portrait Sean needs to eyeball collects into one list he can work through, regenerated rather than hand-kept.
- **NH73** — Denville Township's article listed Angela Cote and Christopher Golinski on the council. The Morris County Clerk's certified 2025 winners name Adrienne Zimmermann and Mark Venis in those seats, and the township's own council page confirms Zimmermann and Venis and does not name Cote or Golinski. This is RULING 87 working exactly as written - the encyclopedia named, the primary source proved, and the primary source disagreed. What is OWED is the sweep: how many of the other 38 Morris municipalities carry a stale encyclopedia roster that the certified winners contradict? `data/hunt/nj-morris-certified-winners.json` holds 263 certified winners and the comparison is a script, not a hunt.
- **NH101** — Measured 2026-08-23 by corepack pnpm congress:corpus. 437 of 537 sitting members already carry a portrait; 97 more are owed and unitedstates/images HOLDS ALL 97. Every one was retrieved over git and VERIFIED - real JPEG, dimensions read, SHA-256 and byte count recorded in data/hunt/congress-corpus-walk.json (14,676,605 bytes total; 91 are the nominal 450x550 and 6 are 440x550 or 419x550, which the corpus README says varies). Licence is CC0 1.0 Universal, confirmed from the repository's own LICENSE file, and the photographs are GPO works the GPO has confirmed are public domain - door 1 of the photo rule, an explicit recorded licence. WHY 0 SHIPPED: RULING 20 keeps portrait bytes out of git and tests/asset-store.test.ts enforces it against data/assets/manifest.json, whose content-addressed store is a local path on the author's machine. This is BLOCKED ON R57 and on nothing else - the retrieval, the licence and the provenance are done. WHAT IS OWED: once R57 lands, run corepack pnpm officials:photos (which now walks the git rung when the Pages host refuses) and pnpm assets migrate.
- **NH112** — A production run of pnpm walk:all rewrites docs/walk-checks.txt from the checks that RAN on that run. On 2026-08-24 that meant it deleted 5 check names because they reported COULD NOT RUN, taking the baseline from 377 to 372 in the working tree. The walk's own doctrine says a check that could not RUN is reported separately from one that FAILED, and its own output does exactly that - it printed all 7 under COULD NOT RUN. The defect is one step later: it then wrote a baseline as if they no longer exist.
- **NH118** — scripts/fetch-official-photos.mts claimed ownership of every registry row whose id starts with 'congress:' and rebuilt that whole set from one source, the GPO pictorial directory. Ten sitting members carried portraits found on a DIFFERENT route - Wikimedia Commons, House Creative Services, public domain, collected 2026-08-15 - and the pictorial directory does not hold any of the ten, because they are recent arrivals. So every run of the script deleted ten rows whose image files were still sitting on disk, and reported it as ten clean misses. Found and fixed 2026-08-24.
- **NH119** — docs/photo-review.md carried the sentence 'The two sides now cross exactly, which is what says the ledger is closed' with two figures interpolated into fixed prose. It was true when written and became false the moment the two sides diverged - which is what shipping NH101's 97 congressional portraits did on 2026-08-24: reachable rose by 91 and the rendered slot count did not move at all, while the sentence went on claiming they were equal. Found and fixed the same day.
- **NH120** — refresh-dotgov-snapshot run 32714838553 lost its work on 2026-08-24. It committed its snapshot, the push was rejected by a concurrent bot push - the only situation the R48 retry exists for - and then the rebase refused with 'cannot rebase: You have unstaged changes'. The run reported that as 'rebase onto origin/main conflicted', so the sentence a reader got described two bots fighting over one artifact when what had actually happened is that our own run left files it generated unstaged. Found and fixed 2026-08-24.

**What it started.** 10 row(s) opened, 6 still open.

- **NH113** — The scheduled NJ filing refresh rebuilds data/ballot/nj-morris-2026.json and the file comes back reordered even when nothing about the ballot has changed. Run 32711668624 on 2026-08-24 showed 1,013 insertions against 1,013 deletions across two files while the clerk's own totals were identical - 272 candidacies, 90 contests, both PDFs still dated 08-21-26. So the workflow reports 'data/ballot/ CHANGED' and runs the full gate on every single run. That is not just noise: a real republish by the clerk will look exactly like the churn, and the one signal that would tell somebody the ballot actually moved is the one being spent every day on nothing. *(open)*
- **NH114** — data/hunt/nj-morris-certified-winners.json holds 263 rows and some of them carry an office that is plainly not an office. Carolyn Dempsey's reads 'DEMPSEY', Robert Simpson's reads 'SIMPSON' - the surname landing in the office field - and several read null outright, among them Robert H. Conley, Howard Kritz, Maria Cote, Louis R. Maffei and James A. Lynch. The row count is right and the names are right, so every count over this file reconciles and reports success. *(open)*
- **NH115** — pnpm roster:stale, built 2026-08-24 for NH73, compares the Morris County Clerk's 263 certified winners against the 271 people this project holds on Morris body rosters. Of 234 municipal winners: 99 are confirmed in our rosters, 90 belong to municipalities we hold no roster for at all (a coverage gap), and 45 belong to places where we DO hold a roster that does not name them. Those 45 are the NH73 shape - a roster that may be showing a reader somebody who is not in the seat. Boonton Town has 13 of them and Chester Township 7. *(open)*
- **NH116** — He is running for US Senate and is owed a photo at 03255. His campaign site publishes exactly one picture of him: a clean solo studio portrait, refused on 2026-08-24 on two stated grounds rather than on composition. The file is named 'Picture Trinity campaign shot high def 2007 001.jpg' - the publisher dating it to 2007, nineteen years ago - and it is served at 220px in 5,699 bytes, which is below any size this product could render as a portrait. *(open)*
- **NH117** — pnpm bodies:spanning, built 2026-08-24 for RULING 121, finds bodies carrying the same name under more than one division. Two were merged this session because Sean ruled on them by name - Lake Todd Village District and the New London-Springfield Water System Precinct. Ten more share a name and have NOT been merged, because a shared name is not proof of a shared body: a Master Plan Committee in Wilmot and one in Grantham are almost certainly two committees, not one. *(open)*
- **NS10** — RULING 119 gives tribal nations their own category, and they needed identifiers. The canonical national list of government identifiers - opencivicdata/ocd-division-ids - has no tribal category at all: read on 2026-08-24, its entire top-level vocabulary is states, districts, territories and courts of appeal, and searching it for the three nations by name returns only Navajo COUNTY, Arizona. So this project minted its own, built on the Census Bureau's own codes for tribal areas with the federal code recorded beside each one. *(open)*

**Needs Sean.** NS10

## overnight-depth-0824 · 2026-08-24

**What it finished.** 2 row(s).

- **DI04** — lib/officials/body-definitions.ts ships eleven CLASS definitions across federal, New Jersey, New Hampshire and Arizona, and every citation was fetched and confirmed against a control string (15 of 15, pnpm definitions:verify). Four class keys are declared and have no row: governor, state_house, state_senate, and a New Hampshire COUNTY. NH counties in particular could not be cited this session — gencourt.state.nh.us answers RSA 31 and RSA 189 at rung 2 but every path tried for the county chapters returned 404, and an unverified citation is worse than a missing one. WHAT IS OWED: find the NH county chapters' live paths, write the four class definitions with citations, and add their control strings to scripts/definitions-verify.mts. Also owed: FORM-specific definitions for the New Jersey bodies, which is what turns "in New Jersey a township may run under either of two charters" into "this one runs under Faulkner Act Plan F".
- **NH109** — AZ-1 added two topics to Know the basics — Am I allowed to hunt or fish, and what the law on abortion is. Both are cited to the state's own source with a fetch date and neither takes a position. Arizona now carries nine topics; New Jersey and New Hampshire carry seven. A reader who moves to New Jersey gets no answer to either question, and a reader who moves to Arizona does. That asymmetry is not a defect in the Arizona work — it is the work being ahead — but it is an information gap that tracks which state a session happened to be briefed on rather than anything about the reader, which is the shape the equal-effort rule exists to catch, pointed at states instead of candidates.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## nj-depth-0824 · 2026-08-24

**What it finished.** 3 row(s).

- **NJ15** — A probe written by the NJ depth session to prove tracker add refuses a byte-identical second run.
- **NH137** — pnpm perf measures FCP, LCP and frame timing on real Chrome and honestly refuses software-rendered numbers, and docs/perf-baseline.md is not committed. A thermometer with no recorded normal temperature measures nothing. Needs a run on hardware-accelerated Chrome, or an honest row saying this machine has none.
- **NH144** — g9's check reads: 4 pin(s) in the stack; 4 fanned; every pair now clears 28px: false. The fan opens and every pin moves; what fails is the 28px separation assertion on a four-pin stack. ATTRIBUTED, not guessed: a worktree at ae5b178 — the head this session opened on, before any change here — was built, served and walked, and it fails the same check with byte-identical numbers. So the previous session's 0-regressions reading was taken against a different day's snapshot, where the pins that happened to collide were fewer. The likely cause is fanOffsets' radius against a stack of four rather than two or three, which is a geometry decision and a visual one; it is not a data defect and nothing a reader sees is wrong except that two fanned pins still overlap.

**What it started.** 13 row(s) opened, 8 still open.

- **NJ17** — Conceived and walked 2026-08-24. Every HTTPS campaign site has a TLS certificate and every certificate is in a public append-only log searchable by substring, so crt.sh is one of very few routes that searches the whole web by NAME without a search engine. The control is clean: an impossible substring returns HTTP 200 with []. Three of four live queries returned HTTP 502 from crt.sh's own nginx. That is a wall on those queries, not an absence of certificates. Re-walk on the RULING 53 clock. *(open)*
- **NJ18** — The press-outlet-wp-search route asks newjerseyglobe.com and morristowngreen.com their own /wp-json/wp/v2/search once per distinct surname — 258 surnames, 516 questions, control clean on both hosts. Those searches named 4,056 distinct articles. Harvesting them at a polite rate is several hours. pnpm hunt:sites now takes --max-pages so a run states BOTH numbers when it stops short, and the disk cache means every page already fetched is free on the next run. What is owed is finishing the harvest and mining it. *(open)*
- **NJ19** — The certified-winners sweep names Washington Township among the 17 dark municipalities, and it is absent from both data/hunt/nj-morris-municipal-sites.json (30 rows) and data/hunt/muni-sites-nj-morris.json (39 rows). The state's own directory at nj.gov/nj/gov/county/localgov.shtml names it as wtmorris.org, read 2026-08-24. That host answers rung 3 with a 1,331-byte Sucuri CloudProxy JavaScript challenge titled 'You are being redirected...', so rung 6 is owed. The same directory lists four different Washington Townships across four counties, so the Morris one must be identified by its position in the county section rather than by name — the Boonton / Boonton Township problem this project has already paid for once. *(open)*
- **NJ20** — After the sitemap branch, pnpm roster:hunt reaches a confirmed governing-body page on 17 of 39 municipal sites and 82 members. The other 22 report a FAILED extraction with candidate pages found and fetched — so DISCOVERY is no longer the binding constraint; EXTRACTION is. Each failure names the site and the pages tried. What is owed is reading a sample of those pages and naming the shapes lib/hunt/roster-page.ts cannot parse, as a class rather than one site at a time. *(open)*
- **NJ21** — A finding rather than a defect, recorded because it decides how symmetry is kept. The Morris County Democratic Committee publishes an index of its 39 municipal committees linking 22 distinct municipal committee websites, reachable in one request through its own WordPress REST API. The Morris County Republican Committee publishes no municipal committee index at all — 25 pages in its sitemap, 8 of which name somebody on this ballot, and no outbound link on any of them survives the campaign-site filter. This is RULING 60's sub-branch rule arriving inside one county rather than across states: a route proven on one party's site is proven for that PUBLISHER, not for the office. The session's answer was to turn the shape the Democratic index revealed into a guessed-domain route applied to both parties with the same patterns and the same number of guesses each. *(open)*
- **NS14** — Your brief said to read VOTE411's terms from its own site before extracting anything and to treat it as restricted until the terms say otherwise. There are no terms. Read 2026-08-24: /terms-use, /terms-of-use and /privacy-policy are all HTTP 404 on vote411.org, lwv.org/terms-use is HTTP 404, and neither the homepage nor its footer links a terms document — the only assertion anywhere is the footer's copyright notice. Its robots.txt permits crawling everything except admin, user and search paths, but a crawl permission is not a licence. So nothing was extracted and it stays RESTRICTED. The judgement that is yours: an absent terms document is not a permissive one, and VOTE411 is a nonprofit's compilation about public records rather than a government publication — the same question RULING 70 asks of Ballotpedia and RULING 93 asks of usmayors.org. If you want it walked, say so and it will be. *(open)*
- **NS15** — pnpm walk:all found it: the deploy's database was missing two committed migrations, 0019_next_scarlet_witch and 0020_dazzling_deathbird, both of which create and extend the speak_your_mind table. They were merged this morning with the feature (1803be2) and never applied. The surface is LIVE — components/speak/speak-your-mind.tsx renders inside the official and entity modals and /api/speak answers — so on production every insert naming those columns failed, the route caught it, and the page served normally. A reader typing what they would say to their representative got no error and their words were dropped. THE SESSION APPLIED THEM rather than opening this and waiting, because it is live data loss on a collection surface and the migrations are additive and were authored to be applied: 6 statements, journal now 21 of 21 committed and 0 pending, verified by a second dry run. This row is here because you should know a session wrote to the production database, and because the question worth your judgement is the OTHER half: how many readers typed into that box between the merge and now, and whether anything should be said to them. Nothing about the identity boundary changed — speak_key_hash carries its own digest prefix per RULING 141 and tests/db-schema.test.ts passes. *(open)*
- **NJ23** — pnpm hunt:sites grew a rung escalation this session — node fetch, then curl at rung 4, then plain HTTP, then an Internet Archive lookup at rung 11 — and it is right for a link read off a real page: two municipal committee domains the county party links no longer resolve, and the archive holds their candidate pages. It is wrong for a GUESS. The party-committee-domain-shape route constructs 580 candidate domains, five suffix patterns per party per municipality, and most of them do not exist; NXDOMAIN is the EXPECTED answer for a guess rather than a wall to climb, so the full ladder runs on hundreds of hosts that were never real. The route was walked and had to be stopped unfinished for that reason, which is recorded rather than smoothed. The fix is to carry the guessed flag into the fetch path and escalate a guessed identifier differently: one attempt, and a non-resolving host is a NO rather than a rung-11 question. *(open)*

**Needs Sean.** NS14, NS15

## audit-remediation-0824 · 2026-08-24

**What it finished.** 16 row(s).

- **NH123** — The release gate every session trusts under RULING 75 discarded its stillborn list unless EVERY check was stillborn, so one passing check beside one check that completed having executed nothing read as green. Its own test said in a comment that this is not green while asserting only that it is not red. Reproduced, fixed, and the last 20 GREEN readings on main audited.
- **NH124** — accountedNormalize asked a boolean, droppedAny, which cannot tell one drop from ninety-nine. 100 logical inputs, 0 output and one recorded drop was branded clean. Replaced with an exact conservation invariant at the logical-record layer, with COULD_NOT_ASSERT as a named second state for the one adapter that genuinely cannot count.
- **NH125** — The same predicate was written out again in the composite own zero-row check. A sweep for the shape found 2 sites and both now call one shared implementation, per RULING 103.
- **NH126** — The 403 escalation returned a browser-header 200 without the notADocument check and returned the curl rung raw with neither check, so the same bytes were refused on rung 2 and accepted on rung 3. And the branch required no injected fetch, which made it unreachable by any test. One finalizer now, and a declared ladder seam.
- **NH127** — The past-feed failure was caught by an empty catch whose comment said the absence would be visible as a jurisdiction with no concluded meetings. The adapter reported success, carry-forward preserves rows only for a failed source or division, and every concluded meeting the previous snapshot held was deleted. Scoped partial results now exist and carry-forward preserves the failed scope only.
- **NH128** — Two sittings at the same instant in one wiring row collapsed to one id and the second vanished with every drop counter at zero. Identity is now every field the feed published, and duplicates are counted apart by who judged them — the feed repeated UID, or our own fallback.
- **NH129** — Apptegy stopped at twelve pages with the API still advertising a next page: 240 events read, an unknown number left, no error and no partial marker. The sweep the finding required found the identical shape in legistar pageById. A cap is a failure boundary now, in both.
- **NH130** — catch return zero in the ical zone resolver. Measured against the shipped code: a 7pm Eastern sitting rendered four hours early, and a 1am sitting rendered on the previous day. The offset returns null now and the event is counted as unplaceable in time.
- **NH131** — feedback.reply_to and questionnaire_invitations.email share a value space and are equality-joinable, which falsifies the constitutional claim that the stores share no joinable column. The guard that was supposed to catch it checked column NAMES. The address moved to an isolated contact-delivery store behind a random handle, and the boundary is now proven over value spaces.
- **NH132** — The systemic half of A-004 and A-006: a source that partly failed reported plain success, because the result shape had only two states. Closed by the scoped partial result and by the pagination failure boundary.
- **NH133** — map-entry passes FILTERED venues into MapCanvas, whose venues effect rebuilds the marker pool — so a filter change is read as vanished data and markers are destroyed and recreated. The pool own comments document the opposite behaviour. Needs allVenues and visibleVenueKeys as separate effects, proven with operation counters.
- **NH134** — Measured 2954773 raw and 852590 gzip across 14 chunks against the committed baseline 2716714 and 818445 across 12. Needs the attribution build to attribute the growth by module provenance, then async boundaries only where the rebuilt number actually falls. MapLibre stays on the critical path.
- **NH135** — registry server.ts discovers geometry by readdir, including the 1.63 MB national congressional file whose per-state derivatives already exist, and the point resolver walks the full collection with exact polygon tests. Needs a generated resolver manifest and a build-time bounding-box index, gated on every supported zip resolving to an identical set of division identifiers.
- **NH136** — applySelection writes every pool entry on every selection and re-runs on venues changes. Store the selected key in the pool and diff to two writes. Ships with P-001 and is asserted by the same counters.
- **NH143** — pnpm purge:synthetic removes only run_class SYNTHETIC from the search log, the reactions store and feedback, exports every row to a dated backup outside the repo first, and refuses to touch ORGANIC, UNKNOWN or AUTHOR. Applied to production 2026-08-24. The row exists so the tool has a home and so the next purge is a run rather than a decision.
- **NH138** — The build log says no build cache found; measured 13.2 s compile plus 16.8 s TypeScript with package-manager caching disabled. Cache the pnpm store and .next cache, keeping both builds because they check different trace behaviour. Loop speed, not reader speed.

**What it started.** 22 row(s) opened, 3 still open.

- **NH139** — The external audit of ae5b178 read 50 files of an unestablished denominator and did not perform Phase 2, the Drive consistency check. Neither number is known. A second pass owes both: the denominator of files that exist and should have been read, and the Drive comparison that was never run. *(open)*
- **NH140** — Found while building the A-002 conservation contract. In boardbook, civicplus, diligent, clerksboards and legistar the counter TALLIES an online-only meeting that is then kept per D18; in iqm2 and revize the same field is a real drop with a continue behind it. One field name, two meanings, in a shared type. Conservation works around it with a declared countedButProduced term; the real fix is moving the kept-tally out of the drop counts. *(open)*
- **NH141** — Found by the A-007 sweep for catch-return-valid shapes. lib map districts.ts returns an empty array when queryRenderedFeatures throws, so an exception is indistinguishable from a viewport with no districts in it. Nine other sites of the same shape were assessed and fail closed; this one does not, and how it should behave is a visual decision. *(open)*

**Needs Sean.** Nothing.

## visual-tail-and-rehunt-0823 · 2026-08-23

**What it finished.** 3 row(s).

- **NH80** — The pnpm regen git sweep on 2026-08-23 found two of ten registered artifacts committed older than something in their generator's source closure. data/hunt/tier-directories.json was behind its own dedicated script and was regenerated - the content came back byte-identical and only the walk date moved. The other is lib/officials/directory-source.ts, behind scripts/doc-dates.mjs, a date helper shared by nine generators, so that edit cannot have changed what congress:migrate produces. It was deliberately NOT regenerated: re-running it moves a pinned upstream commit SHA and restamps a collectedAt of 2026-08-16, which is the date the data was actually read, and restamping a provenance date without re-reading the data is the fabrication rule. What is owed is a decision about whether a shared-helper edit should mark an artifact stale at all. The tool already distinguishes a source dedicated to one generator from one shared by nine and prints which, so the answer may be no more than making the sweep act on the distinction it already reports.
- **NH81** — Carried forward unchanged from PU03. The 2026-08-23 session spent its run on the four guards and the meeting and jurisdiction surfaces and did not reach this. Ask for the next meeting still answers with a heading and nothing to tap, and asking when school starts still answers that no sourced owner is routed for the topic when the school district plainly owns it. The standard for both is NH-2, which he named as the thing to replicate: coverage disclosure with denominators, honest gaps, the relevant record surfaced, and a named human with a phone number and an email. He called the contact details the best part.
- **NH84** — Carried forward from PU06. The MAP surfaces are done: the who-governs panel went from six full sentences to six asterisks and one pill, and the 2026-08-23 session took the meetings list from nineteen consecutive Could govern you pills down to one per jurisdiction group, both read as images. The BALLOT page is untouched at twelve instances across nine contests, because it renders the pill per contest heading, which RULING 28 permits and which he nonetheless called the headline UX problem of the New Jersey pass. What is owed is the same treatment - one page-level annotation with marks on the affected contests - and wherever the sentence survives, making it one clear deliberate annotation, bolder and more explicit than the current small text. It is not a completeness statement and it never gates a page.

**What it started.** 6 row(s) opened, 3 still open.

- **NH87** — RULING 107's wider sweep found this and it is the one site of 31 that is a real restamp rather than a reading path. scripts/ship-staged-portraits.mts writes collectedAt: new Date() on every portrait it commits (lines ~175 and ~193), but the collection happened earlier, when the portrait was STAGED from Wikimedia Commons. The ship step is not the read. It cannot be fixed where it stands, because the staged ResultRow carries no collection date to carry forward - so the fix is in the STAGING step, which has to start recording one, and then the ship step carries it rather than minting. Until then the provenance date on every Commons portrait is the day somebody ran the shipper. Pinned in tests/freshness-provenance.test.ts as the single entry of KNOWN_UNDECLARED, a baseline that may only shrink; run pnpm freshness:audit --all to see it. *(open)*
- **NH88** — data/hunt/wiki-graph-07866.json holds 80 leader entries harvested on 2026-08-22, and 5 of the 72 usable ones store the Wikipedia link syntax as part of the person's name - "Joseph Jackson ([[Republican Party (United States)" is what the file actually contains for the Mayor of Rockaway Township, and one office title is stored as "[[City manager". A consumer reading the name field straight out gets a string that is not a name. NOTHING WENT RED, because nothing was empty: this is RULING 100's shape, an extraction that came back with some rather than none, and only reading the rows shows it. The fix belongs in the graph's own generator per RULING 92, and that generator reads Wikipedia over the network, so the artifact is owed a regeneration when egress is available. scripts/mine-wiki-leaders.mts cleans the markup at read time as a stopgap and exports cleanWikiText; it is a workaround, not the fix. *(open)*
- **NH89** — The 2026-08-23 session mined two committed corpora that had never been read for the fields they answer, and produced leads it could not confirm because every outbound host was refused at that environment's egress. data/hunt/campaign-site-leads-nj-morris.json holds 12 campaign-site leads across 12 of 272 candidates, 8 of them STRONG (selenformorriscounty.com, joehathawayforcongress.com, strobelforschoolboard.com, rebeccabennettforcongress.com, corybooker.com and three more) against a field that stood at 0 of 272. data/hunt/wiki-leader-leads-07866.json holds 9 New Jersey municipal roster leads - mayor, manager and clerk for Rockaway Township, Rockaway Borough and Denville - none currently held as an officeholder. EVERY ROW IS A LEAD AND NOT A HIT: a domain matching a candidate's name is a guessed identifier, and Wikipedia names a person while the citation proves them (RULING 87). What is owed is the control check - fetch each, confirm the page self-identifies with the filed name, the office and the cycle - which is one fetch per lead for a session that has egress. Regenerate the leads with pnpm mine:campaign-sites and pnpm mine:wiki-leaders. *(open)*

**Needs Sean.** Nothing.

## remote-visual-tail-0823 · 2026-08-23

**What it finished.** 10 row(s).

- **VF04** — From the 8/22 walkthrough, NOT STARTED this session. LAY-1: the main card (Meetings / Bodies / Districts / View Officials, the one showing 48 meetings and 4 venues) sets the column width, Who Governs Here sits beneath it, and clicking any one should make it take over the left column while the others collapse to pills — one expanded at a time, nested under each other. The existing main sidebar behaviour stays as it works today. LAY-2: the sidebar filters are off-centre, crammed and sloppy when opened; a dedicated screenshot exists in the 8.22 Drive folder. Both are layout work that wants a capture read as an image before and after.
- **DI03** — pnpm schools:classify stamps each registry school district INDEPENDENT or DEPENDENT from the 2022 Census of Governments' own classification, via data/derived/census-nces-crosswalk.csv. Measured 2026-08-23: 291 INDEPENDENT, 4 DEPENDENT, 219 UNCLASSIFIED, 2 TIGER pseudo-entities skipped. An unclassified district deliberately gets NO class definition — guessing INDEPENDENT because most districts are would be a claim about who governs a reader's schools made on a base rate — so 219 districts render a card with no description. Most of the unmatched are New Hampshire. WHAT IS OWED: raise the crosswalk's match rate for the unmatched names, or add a second key (NCES LEAID, Census GIDID) so the join does not depend on a normalised name alone.
- **NH82** — Carried forward unchanged from VF04. LAY-1: the left column cards sprawl and should nest, one expanded at a time with the others collapsed to pills, and the existing sidebar behaviour untouched. LAY-2: the sidebar filters are off-centre and crammed when opened. Both want a capture read as an image before and after, and both must be built against the post-Hunt-6 panel: the registry held 12 bodies when the walkthrough was taken and holds 174 now, so a layout that reads well at 12 is not evidence that it reads well at all.
- **NH90** — Measured 2026-08-23 with pnpm exec tsx scripts/measure-definitions-0823.mts: class 1013 of 1253 bodies, form-specific 216 of 1253, NEITHER 214 of 1253. The 214 break down as 12 county body rows - 7 unique counties, EVERY ONE OF THEM NEW HAMPSHIRE, so there is simply no NH county class definition in lib/officials/body-definitions.ts - and 202 school-district rows, 195 unique, of which 90 are NH and 105 NJ. The machinery is complete and the two-layer shape works; what is missing is the EVIDENCE each row is required to carry. Every definition in that file ships with the statute that creates the class, its URL and the date it was read, and the 2026-08-23 session could not reach any statute publisher - gencourt.state.nh.us and law.justia.com are both refused at the egress. Writing a definition with a plausible citation and a plausible read date is the fabrication rule, so none was written. What is owed: RSA Title II chapters 23-31 for the NH county class, read and cited; and the independent-versus-dependent stamp for the 195 school districts, which decides whether the card can say who governs the schools.
- **NH91** — In the 2026-08-23 remote container, corepack pnpm test reports 1829 pass / 3 fail, and all three failures are the same thing: browserType.launch cannot find chromium_headless_shell-1234, because the image ships build 1194 at /opt/pw-browsers while package.json pins playwright 1.62.1. The three are tests/beacon-guard.test.ts's origin-confinement and beacon guards. THEY ARE A COULD-NOT-RUN, NOT A FAILURE, and the distinction is the one pnpm walk:all already makes - an unreachable service is not a missing feature. They pass in CI, which installs its own browsers. What is owed is a decision: either pin the browser build alongside the library so a fresh container is deterministic, or have the harness launch with executablePath against whatever build is present, which is what the environment's own guidance suggests. Until then any session in a container reports three red lines that are about the image.
- **NH92** — Recording this for your judgement because it decides what a session can be asked to do. In the 2026-08-23 remote container every outbound host except github.com is refused at the egress gateway with HTTP 403 to CONNECT. This was established by walking the ladder rather than assuming it: rung 2 plain fetch 403, rung 3 full browser header set 403, rung 4 a different client - curl, node fetch and wget each - 403, rung 6 the live browser via Playwright net::ERR_TUNNEL_CONNECTION_FAILED. Rung 5, a different egress, is the rung that would answer it and is not available; the environment's own documentation states that a policy denial must be reported rather than routed around. Rung 1, the committed snapshot, is open and is where the 2026-08-23 session did its hunting. WHAT THIS COSTS, stated rather than implied: no source can be fetched, no absence can be re-tested on its RULING 53 clock, no credential can be proven by calling under RULING 95 (and .env.local is not in the repo either, so that is doubly blocked), no lead can get its control check, and walk:all cannot reach production. THE DECISION: whether hunt sessions should run somewhere with egress, or whether hunt briefs aimed at a container should be scoped to rung 1 and to the analysis, extraction and guard work that does not need the network. A brief that asks a walled session to hunt gets an honest report of a wall where it wanted rows.
- **NH97** — The class layer is closed — 1,253 of 1,253 bodies now carry a class definition, up from 1,013 — and the twelve New Hampshire county rows that were the last gap now have one. Its TEXT is sound and its substance is this project's own 03255 hunt, recorded in docs/zip-playbook.md section 1 on 2026-08-22 and read out of the repo today: a New Hampshire county runs the jail, the nursing home, the sheriff, the registry of deeds and the county attorney, runs no roads, schools, zoning or land use, and its legislative body is the county convention of state representatives rather than the commissioners. WHAT IS OWED: the statute URLs. basisUrl is NULL on that row, deliberately, because the 2026-08-23 remote session could reach no host but github.com and writing a URL it had not opened would be RULING 107's defect — a read that did not happen. A session with network confirms the live paths for RSA 24 (county conventions) and RSA 28 (county commissioners), sets basisUrl, and adds their control strings to scripts/definitions-verify.mts. NH90's own note records that gencourt.state.nh.us answers RSA 31 and RSA 189 at rung 2 while every county-chapter path tried returned 404, so the path hunt is the work rather than the fetch.
- **NH98** — lib/registry/coverage.ts line 310 reads `divisionType: division?.divisionType ?? "place"` for a body that has NO division — the Southeast Regional Council case the comment beside it names. The default was harmless while nothing read it as a finding. Closing the class layer on 2026-08-23 made it live: a divisionType of "place" resolves to the municipality class, so such a body would have rendered "This is a New Jersey municipality — the layer of government closest to a resident" about a body nobody has established is a municipality. It is guarded at the definitions path today — definitionsForBody returns nothing for a null ocdId — which closes the false claim without touching the type. THE UPSTREAM FIX is making divisionType nullable on CoveredBody, which is 39 call sites and was out of this session's scope. Until then the placeholder is still a placeholder wearing a value's clothes, and the next thing that reads it as a finding will not have a guard waiting.
- **NH99** — pnpm schools:classify reaches 510 of 514 rendered districts across five one-to-one branches, up from 295 of 514. The four it does not reach are named on every run and each was read by hand against the committed Census files: AZ Indian Oasis-Baboquivari Unified District, which the 2022 Census of Governments spells BABOQUIVARA; AZ Tonto Basin Elementary District, which the Census calls TONTO SCHOOL DISTRICT 33; AZ Union Elementary District, whose whole distinctive name is the word Union — a structural word in every district name in the country, so it cannot be keyed; and NH Prospect Mountain High School Joint Maintenance Agreement District, which is not in the 2022 Census of Governments at all and is therefore RULING 57's two-enumerations-disagree finding rather than a miss. None of the four renders a refusal: they carry the unclassified-school class definition, which describes what a school system is and names the open question rather than asserting who governs the schools. WHAT WOULD CLOSE IT: a hand-evidenced alias table, which needs a source a session can cite for each pairing — NCES state_leaid does not decode to the Census district number, so the join has to come from somewhere with network.
- **NH100** — NH91 is closed: playwright is pinned to an exact version, EXPECTED_CHROMIUM_REVISION is committed in lib/ops/chromium-pin.ts and checked against playwright's own browsers.json, and scripts/browser.mts launches whatever complete Chromium the image has by explicit path while NAMING the substitution. Two of the three tests that could not run now run and pass on build 1194. THE THIRD CANNOT, and it is a real finding rather than a harness problem: the plant that proves the guard can fail asserts that an unload-time sendBeacon escapes extraHTTPHeaders, and on Chromium 1194 the headers DO reach it, so the beacon arrives declared. That is a measurement of build 1194 and says nothing about the pinned 1234, so the test reports CANNOT RUN with the substituted build named rather than asserting either way. WHAT WOULD CLOSE IT: the container image carrying the pinned build, at which point the plant runs against the browser it was written for. Nothing in the repo can fix it — this is a fact about the image.

**What it started.** 8 row(s) opened, 2 still open.

- **NH95** — pnpm schools:classify reaches 510 of 514 rendered districts across five one-to-one branches, up from 295 of 514. The four it does not reach are named on every run and each was read by hand against the committed Census files: AZ Indian Oasis-Baboquivari Unified District, which the 2022 Census of Governments spells BABOQUIVARA; AZ Tonto Basin Elementary District, which the Census calls TONTO SCHOOL DISTRICT 33; AZ Union Elementary District, whose whole distinctive name is the word Union — a structural word in every district name in the country, so it cannot be keyed; and NH Prospect Mountain High School Joint Maintenance Agreement District, which is not in the 2022 Census of Governments at all and is therefore RULING 57's two-enumerations-disagree finding rather than a miss. None of the four renders a refusal: they carry the unclassified-school class definition, which describes what a school system is and names the open question rather than asserting who governs the schools. WHAT WOULD CLOSE IT: a hand-evidenced alias table, which needs a source a session can cite for each pairing — NCES state_leaid does not decode to the Census district number, so the join has to come from somewhere with network. *(open)*
- **NH96** — NH91 is closed: playwright is pinned to an exact version, EXPECTED_CHROMIUM_REVISION is committed in lib/ops/chromium-pin.ts and checked against playwright's own browsers.json, and scripts/browser.mts launches whatever complete Chromium the image has by explicit path while NAMING the substitution. Two of the three tests that could not run now run and pass on build 1194. THE THIRD CANNOT, and it is a real finding rather than a harness problem: the plant that proves the guard can fail asserts that an unload-time sendBeacon escapes extraHTTPHeaders, and on Chromium 1194 the headers DO reach it, so the beacon arrives declared. That is a measurement of build 1194 and says nothing about the pinned 1234, so the test reports CANNOT RUN with the substituted build named rather than asserting either way. WHAT WOULD CLOSE IT: the container image carrying the pinned build, at which point the plant runs against the browser it was written for. Nothing in the repo can fix it — this is a fact about the image. *(open)*

**Needs Sean.** Nothing.

## questionnaire-and-corpora-0823 · 2026-08-23

**What it finished.** 2 row(s).

- **NS05** — Your NJ Hunt 5 brief adopted the free-source floor, the tiered manifest, the two-click test, per-state source enumeration and the Wikipedia route as RULINGS 81 through 85. Both of those numbers were already taken by NJ Hunt 4 earlier the same day, from your previous brief: RULING 81 is the exhausted Actions balance (it closed NS04) and RULING 82 is the job watcher's sampling (it closed JOB01), and both are cited by id in the resolved tracker store and inside docs/rulings.md itself. docs/rulings.md is append-only, so renumbering what already shipped would leave dangling references in the one record whose whole value is that it does not move. THE SESSION'S CALL: the five took 83 through 87 in your order, each carrying your number beside it, with a mapping table at the head of the block in both CLAUDE.md and docs/rulings.md. Nothing about the content changed. REVERSE IT IF YOU WANT YOUR NUMBERING TO WIN - the alternative is renumbering the two that shipped and accepting the dangling references, and that is your call rather than a session's. Separately: your RULING 90 was used exactly as you gave it, and 88 and 89 are recorded as deliberately unassigned rather than closed by renumbering you down.
- **NH94** — lib/registry/coverage.ts line 310 reads `divisionType: division?.divisionType ?? "place"` for a body that has NO division — the Southeast Regional Council case the comment beside it names. The default was harmless while nothing read it as a finding. Closing the class layer on 2026-08-23 made it live: a divisionType of "place" resolves to the municipality class, so such a body would have rendered "This is a New Jersey municipality — the layer of government closest to a resident" about a body nobody has established is a municipality. It is guarded at the definitions path today — definitionsForBody returns nothing for a null ocdId — which closes the false claim without touching the type. THE UPSTREAM FIX is making divisionType nullable on CoveredBody, which is 39 call sites and was out of this session's scope. Until then the placeholder is still a placeholder wearing a value's clothes, and the next thing that reads it as a finding will not have a guard waiting.

**What it started.** 6 row(s) opened, 5 still open.

- **NH102** — Found 2026-08-23 walking unitedstates/images at commit aec3e4a88af843b282c0576f420b930f6a9a46ad. H001104 Jon Husted, A000383 Alan Armstrong and G000608 Darline Graham are sitting members and the GPO pictorial-directory corpus carries no file for any of them. This is a FINDING about that corpus on that date, not an absence of a photograph: the photo rule's doors 2, 3 and 4 are unwalked for these three, and RULING 53 puts the corpus itself on a 14-day re-walk. NOT a gap-ledger row because it names three PEOPLE and a route, not a body's coverage. *(open)*
- **NH103** — Found 2026-08-23 writing the first test that imports lib/officials/body-definitions.ts at RUNTIME rather than reading it as text. Two separate ESM defects were in the chain and both were invisible because nothing had ever imported that file under node --test. (1) body-definitions.ts and lib/registry/census-school-systems.ts used EXTENSIONLESS relative imports, which Next's bundler tolerates and Node's ESM loader refuses - FIXED this session, 3 sites. (2) school-dependency.ts still imports data/derived/school-district-dependency.json with no `with { type: json }` attribute, so ERR_IMPORT_ATTRIBUTE_MISSING. WORKED AROUND rather than fixed: lib/officials/body-form.ts takes the dependency as a PARAMETER instead of importing it. WHAT IS OWED: decide whether to add the import attribute (verify the Next build accepts it first) or to move the JSON read behind a function. Until then any new test importing that module transitively fails, and the failure names the JSON rather than the cause. THE CLASS, swept: 3 extensionless relative imports under lib/**/*.ts, all fixed; 10 more under components/**/*.tsx and lib/state/*.tsx are OUT OF SCOPE with the reason - they are React components reached only through the bundler and never imported by node --test. *(open)*
- **NH104** — Opened 2026-08-23 by the session that built the instrument. WHAT EXISTS: the versioned five-question instrument (lib/questionnaire/instrument.ts, docs/candidate-questionnaire.md), the office-class classifier, the response record with versioning and withdrawal, the single-use token auth, the three Positions empty states wired into the battlecard, the Drizzle schema and migration 0016, and 272 of 272 generated invitations. WHAT DOES NOT EXIST: (a) the reader-facing page a candidate opens their link on and types into, with the word-limit check shown as they type; (b) the send path - and per RULING 107 it must stamp invitedOn AS IT SENDS, never from the plan, because the Positions empty state reads exactly that field to decide whether to tell a reader we asked; (c) the reminder job on the two planned dates; (d) the read path joining a stored response onto the battlecard Positions section. NOTHING may be sent until the Needs Sean row approving the message is answered. *(open)*
- **NH105** — Opened 2026-08-23. The instrument is built and the invitation list is generated - 272 of 272 Morris County candidacies, every row carrying invitedOn: null because nothing has been sent. The message is docs/candidate-questionnaire-invitation.md, quoted in full, plus a reminder message. FOUR THINGS ARE YOURS AND NONE OF THEM IS A SESSION'S CALL: (1) the message itself - it goes out under this product's name to 272 named people asking for votes; (2) a monitored reply address a person actually reads, which the message promises three times and which does not exist yet; (3) the schedule - one send date, two reminder dates and a deadline, which are constants at the top of scripts/questionnaire-invitations.mts and are quoted in full in that file and in data/questionnaire/invitations-nj-morris-2026.json; one edit moves all 272 symmetrically; (4) whether sparkwtp.netlify.app comes off its password wall first, because a candidate following the link today hits a password prompt. RULING 112 governs everything about the instrument itself; this row is only the decision to contact real people. *(open)*
- **NH106** — Established 2026-08-23 by asking GitHub directly, because gh is absent from this container and corepack pnpm main:green therefore answers CANNOT TELL - which is the correct fourth verdict and says nothing about main. main's tip 3d453fd (the merge of PR #162, a HUMAN commit rather than the NH85 bot-tip shape) FAILED build check, run 32664443326, at 2026-08-23T20:30:04Z. IT IS NOT THE RULING 81 SHAPE: 19 steps ran and the Test step ran for 81 seconds before failing, so the runner started and the tree was really tested. Lint passed, tsc passed, and BOTH build jobs passed - only the gates job is red. THE CAUSE IS ONE THING, FOUR TIMES: tests 1853, pass 1848, fail 4, skip 1, and every one of the four is 'NO CHROMIUM INSTALLED. Wanted build 1234; searched /home/runner/.cache/ms-playwright.' - three in tests/beacon-guard.test.ts and one in tests/chromium-pin.test.ts. The workflow's 'Install the browser the suite needs' step (corepack pnpm exec playwright install --with-deps chromium) reported SUCCESS in 27 seconds and left nothing the suite can find. So the step's success is not evidence a browser exists, which is the same shape as a 200 that is not a document. WHY NO FIX WAS PUSHED. It reproduces identically on the base branch, so it is not any diff's failure and a session cannot verify a CI-only change from a container with no way to run CI. The one 'fix' available locally would be to let the guard pass with no browser, and scripts/browser.mts says in as many words that nothing here may report a pass - softening it would delete the guard rather than repair the runner. WHAT IS OWED: read the install step's own log for run 32664443326 (it is not in the tail this session could fetch), and decide between pinning the Playwright version the image can actually serve, caching ~/.cache/ms-playwright, or asserting the executable exists as its own workflow step so a silent no-op install fails where it happens rather than eighty seconds later inside the suite. RELATED BUT DIFFERENT: NH96 is the same class in the SESSION CONTAINER, where a substituted Chromium 1194 makes the same test report CANNOT RUN by name rather than fail. Locally the suite is 1947 / 1946 pass / 0 fail / 1 skipped. On the runner it is 4 failures. Same pin, two environments, two different answers. *(open)*

**Needs Sean.** NH105

## hunt6-hardening-0823 · 2026-08-23

**What it finished.** 6 row(s).

- **VF03** — From the 8/22 walkthrough. Morris County's "Who runs it: [name], president" loses the last letter of the role. NOT FIXED this session, and the reason is stated rather than guessed at: the CSS for the two places a role renders (.person-row-office in the small card, and the inline span in the large one) both wrap rather than clip, and no ellipsis or nowrap rule reaches either. Reading the stylesheet did not find the cause, and guessing at a fix for a visual defect nobody has reproduced would be a change with no evidence behind it. WHAT IS OWED: reproduce it at 430x932 against a local production build with the Morris County card open, read the capture as an image, and fix at whichever bound is actually clipping. Class-wide once found — sweep every place a role or office title renders and report count found and count fixed.
- **NH77** — From the 8/22 walkthrough, NOT STARTED this session. Each person's row in Who Governs Here wraps to two lines because the SOURCE link renders beneath their name. One line per person: shift the names left so the name and its source fit on a single row. Verify at 430x932 against a local production build and read the capture as an image.
- **PU04** — From the 8/22 walkthrough. The Rockaway Township Municipal Building / Township Council regular meeting is labelled "nearby — different jurisdiction", and a ZIP CANNOT ESTABLISH THAT. NOT DONE this session: the address prompt it needs (WGH-5) is built and shipped, so what remains is wiring the meeting badge to it — the badge becomes clickable, opens the same one prompt, and everything re-resolves from the answer, exactly as the who-governs pill now does. The badge module already keeps GOVERNS, NEARBY and NO_BOUNDARY apart correctly; what it has no route to is the reader settling which applies to them.
- **VF06** — Three captures read as images on 2026-08-22 against production deploy 6a8a606851610e0008305901 - the map at 07866, 03255 and 85701 - all show the app's own fallback panel: BASEMAP UNAVAILABLE, Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use MapTiler. WHAT WAS CHECKED, so the next session does not re-check it: the key IS baked into the production client bundle - chunk 38lr8y2ek8t22.js carries api.maptiler.com/maps/${i}/style.json?key= with a real key - and that style endpoint answers HTTP 200 with 62,975 bytes of valid style JSON from this network. So neither the key's presence nor its validity is the cause. WHAT IS NOT KNOWN: whether a real reader sees this. The capture is a headless Chromium run and the fallback may be a race against the tile load rather than a failure, which would make it a capture artifact and not a defect. It is recorded as UNRESOLVED in that direction rather than dismissed, because the district geometry and the pins render either way and the fallback panel is the only thing that distinguishes the two cases. THE CHECK THAT WOULD SETTLE IT: read the network requests to api.maptiler.com from a real browser session on production, and check whether the style request is issued at all, refused, or simply slower than the capture window.
- **RO03** — NJ Hunt 4's close-out reported that three of its captures claimed to show the who-governs surface and actually showed the map, because the shooter minimises the card before capturing. It corrected the caption in docs/state.md. It did not change the string in scripts/shoot-nj-hunt4-0822.mts. NJ Hunt 5 ran the same shooter against production, read all seven captures as images per RULING 2, and found the same three wrong captions - now four, since 85701 was added. The caption is fixed in the tool this time. THE GENERAL POINT, which is why this is a row rather than a footnote: a correction recorded in a document describes what one session believed on one day; a correction written into the instrument changes what every later run produces. Where a session finds a defect in something a tool emits, the fix belongs in the tool, and the document records that it was fixed there. Worth a sweep for other corrections recorded in state.md whose instrument was never touched.
- **NS09** — Item 8 of your Discovery Conduct brief says the Discovery conduct block is pinned in context.md and never trimmed, and that if the cap forces trimming the generator trims elsewhere and reports exactly what it trimmed. Built, and it does. MEASURED: the file lands at 40,254 bytes against the 40 KB cap, and the price is the whole tracker-change section — all 10 recovered status changes dropped — plus the P0 notes clipped from 130 to 90 characters. Both are stated in the file itself, so nothing is silent. THE DECISION IS YOURS because you have already made the opposite one once: on 2026-08-17, item 8c, when 20 KB was cutting this same section to nothing, you ruled RAISE THE CAP RATHER THAN CUT ROWS. Following that precedent here means raising the cap to about 56 KB. Following the brief literally means keeping 40 KB and losing the section. The session followed the brief and is telling you what it cost.

**What it started.** 9 row(s) opened, 4 still open.

- **NH79** — pnpm dupes reads 2114 function bodies across 806 files and finds 26 groups where the same logic lives in more than one file. Two were consolidated on 2026-08-23: four copies of the outbound User-Agent, which CLAUDE.md makes law, and two of the person-name normaliser, one of which sat inside the tool that CHECKS whether the same person is shown twice - so the audit was using a different definition of a person from the resolver it audits. The other 24 are recorded in tests/duplicate-implementations.json with a disposition and a reason each. Six are ALLOWED for reasons that hold: the two intake key paths must stay unable to converge because the stores may never join, React context accessors are three identical lines by construction, and the .mjs date helper cannot import TypeScript because the pre-commit hook runs without tsx. Eighteen are OWED. The guard fails on a NEW group, so the class cannot grow while the backlog is worked, and the baseline only shrinks. The heaviest three: six byte-identical useSyncExternalStore subscribe callbacks across the hooks, four separate CSV parsers with the tracker stores downstream of two of them, and - the worst of the set - tests/district-hits.test.ts carrying its own copies of inRing, inPolygon and contains, so the test that checks point-in-district geometry proves its own copy works and says nothing at all about the shipped one. *(open)*
- **NH83** — Carried forward unchanged from AZ01. The 2026-08-23 session did not reach Arizona. Read as an image from the 8/22 capture of the ballot near 85701, the registration destination appears three times inside about ten lines: Check whether you're registered to vote as an inline link, the Secretary of State's own tool named beneath it, and a third box below the card repeating Check whether you're registered to vote. They deduplicate to ONE prominent pill pointing at the reader's Secretary of State, and the same pattern applies to polling location. The Secretary of State is the only authoritative source for either, and a reader who trusts an in-app answer and does not check loses their vote. AZ-1 also still needs hunting and fishing and state abortion law in Know the basics, both written to the plain-language register with the law stated, its source named and a fetch date, and no position taken. *(open)*
- **NH85** — RULING 75's third part asks GitHub rather than the working tree, and the four verdicts it keeps apart are green, red, pending and could-not-tell. Measured on 2026-08-23: both of this session's commits to main are GREEN on GitHub - d0f2831 carries build default, build standalone and the gates, and e83db50 carries those plus the tripwire. But main's TIP was 7112307, an intake-tripwire[bot] commit pushed minutes later, and no check has ever been registered against it. So main:green exits 2 with CANNOT TELL on a healthy tree, and it did the same on 750e094 at the start of this session. Seven workflows push main daily, so the tip is a bot commit far more often than it is a human one, and a gate that reads could-not-tell as its normal answer is a gate a session learns to walk past. What is owed is a decision about the shape rather than a patch: either the scheduled workflows' pushes to main run build check too, or main:green reports on the newest commit that HAS a check and says how many bot commits sit above it. The second keeps the Actions budget RULING 78 protects; the first is stricter. Nothing is broken today and the distinction between the four verdicts must not be softened to make this go away. *(open)*
- **NH86** — Measured 2026-08-23. corepack pnpm closeout fails its build gate with "pnpm build refused (exit 1)" and no TS diagnostic, while the same build run on its own exits 0; pnpm closeout passes the gate in 9 seconds. This is the same failure already recorded for pnpm handoff --ship, one script later: close-out.mjs shells out to pnpm run build, and through corepack that inner call cannot run. The gate is honest about it - it refuses rather than passing - which is exactly the four-verdict discipline working, and it still cost a debugging round because nothing in the repo says so at the point of use. What is owed is small: close-out.mjs and handoff.mjs should detect a corepack-shimmed parent and say which command to run instead, rather than reporting a build refusal that is really an environment refusal. A note in CLAUDE.md's Commands section would do at a minimum. *(open)*

**Needs Sean.** Nothing.

## discovery-conduct-0823-nonhunt · 2026-08-23

**What it started.** 14 row(s) opened, 7 still open.

- **VF05** — Five issues, NOT STARTED this session. MTG-1: the "Governs your area" pill overlaps the next meeting date in the meetings box. MTG-2: Meetings, then Rockaway Township Municipal / Township Council, opens MULTIPLE pop-ups at once — it should open the large battlecard for that specific meeting, one surface. MTG-3: the large meeting battlecard's location is not clickable and has no Add to Calendar; Add to Calendar exists under Meetings but Meetings has no directions. Directions and Add to Calendar must both be available from Overview and from Meetings. MTG-4 (ruled): assume the venue is missing from created calendar events and build it so the event carries the venue in the location field alongside date and time — a no-op if it already works. MTG-5: "Make Your Voice Heard" renders fully expanded and the reader scrolls past all of it to reach the next meeting; it becomes a collapsed drop-down with the content kept verbatim. *(open)*
- **PU03** — NOT STARTED this session. ASK-1: "When is the next meeting?" returns "Where to look: Meetings near you" and explains that the map shows collected meetings, with nothing to click. Give the reader a control right there, tappable on mobile. NH-3: "When does school start again?" returns "we don't have a sourced answer for who owns this topic yet" — the school district owns this and it must be routed. THE STANDARD FOR BOTH is NH-2, which Sean called out as the thing to replicate: coverage disclosure with denominators (35 agendas read, 9 more held but unreadable and therefore excluded), honest gaps, the relevant record surfaced, and a NAMED HUMAN with a phone number and an email. He called the contact details the best part. *(open)*
- **AZ01** — NOT STARTED this session. AZ-1: "Know the basics" needs more topics — hunting and fishing ("Am I allowed to hunt or fish?", a common question when somebody moves states) and state abortion law. Both contentious, which is exactly why a clear factual account of where the state stands is owed: state what the law is, cite it, take no position. AZ-2: the state comparison holds one comparison at a time, which is right, but Back returns to Arizona alone when the expected destination is the map — either a reset pill or state pills in the title bar, with deselecting a state dropping it from the comparison, and the same pill pattern on the ballot. AZ-3 (applies across the board, Arizona is only the example): the voting section is five separate items — next election, add to calendar, check registration, where can I vote, search the Secretary of State's tool — and should read as next election, 2026, early voting, with the rest of the noise cut. AZ-4 and AZ-5 (ruled together): three links to the same registration destination inside about ten lines deduplicate to ONE prominent pill, "Check whether you're registered to vote", pointing at the reader's Secretary of State; same pattern for polling location. The Secretary of State is the only authoritative source for either, and a reader who trusts an in-app answer and does not check loses their vote. AZ-6 is positive: the federal-representative pill system works and stays. *(open)*
- **NJ13** — From the 8/22 walkthrough, NOT STARTED this session (no hunting was in scope). Morris County has solid representation data and most commissioners have no photo — the first-listed and one other have none, a third does. If one commissioner has an image the rest are findable by the same route. WHAT IS OWED: source photos for every official on that body through the four doors, then open ONE photo review row for Sean. Photos never block anything: every other field renders immediately, photos-first ordering is presentation and not a completeness gate (RULING 50), and a photo decision keys to the ASSET rather than the person — refusing a bad banner once withheld a good Senate portrait. *(open)*
- **PU05** — The 8/22 brief said to fetch the Census ZCTA-to-congressional-district relationship file — free, keyless, national. MEASURED 2026-08-23: NO SUCH FILE EXISTS for the current Congress, and four Census directories were walked to establish it. rel2020/zcta520/ holds six files and none of them is CD. rel/ holds only zcta_cd111_rel_10.txt, the 111th Congress with 2010 ZCTAs — two rounds of redistricting stale. rel2022/ and rel2024/ hold Connecticut-only files. baf2020/'s CD assignment file is dated 2020-12-11 (116th) and baf/'s is dated 2011-01-21. WHAT IS OWED, and the machinery for it already exists: scripts/build-zip-governments.mts samples every ZCTA on a 0.01-degree lattice against TIGER cartographic boundary layers and has been verified across all 33,791 zips. Adding a cd layer to its LAYERS list gives per-zip congressional-district sample counts nationally, and the existing partial-versus-whole arithmetic then answers "one district or more than one" for every zip in the country by exactly the method the who-governs pill already trusts. 07866 itself is settled independently: it sits entirely within NJ-11, confirmed against the House zip lookup. *(open)*
- **PU06** — Measured 2026-08-23 at 07866 against a local production build: TWELVE instances across NINE contests on /ballot, unchanged by this session. The MAP panel was fixed — six rows each carrying the full sentence became six asterisks and ONE pill, read as an image — but the ballot page renders the pill per contest heading, which RULING 28 permits and which Sean nonetheless called the headline UX problem of the New Jersey pass. WHAT IS OWED: decide whether the ballot page takes the same treatment (one page-level pill, marks on the affected contests) and, wherever the sentence survives, make it one clear deliberate annotation, bolder and more explicit than the current small text. It is not a completeness statement and it never gates a page. *(open)*
- **RO02** — Found 2026-08-23 while running the gates. pnpm exec node scripts/check-lint-allowlist.mjs refused with five unlisted warnings, and stashing every change in this session proved all five were already on main: scripts/guard-history.mjs (unused sep), scripts/tier-directory.mts (unused readFileSync), and three in tests/coverage.test.ts. All five were unused imports or an unused local and all five are fixed here. THE ROW IS FOR THE SHAPE, not the fix: this check is not part of build-check.yml, so a gate that a session is expected to run by hand had been red for an unknown number of sessions with nothing reporting it. Worth deciding whether it joins the CI gate or the handoff gate, remembering RULING 78 — a gate that runs three times for one merge is one gate and two copies of it. *(open)*

**Needs Sean.** Nothing.

## ci-browser-and-depth-0823 · 2026-08-23

**What it finished.** 1 row(s).

- **NH93** — The class layer is closed — 1,253 of 1,253 bodies now carry a class definition, up from 1,013 — and the twelve New Hampshire county rows that were the last gap now have one. Its TEXT is sound and its substance is this project's own 03255 hunt, recorded in docs/zip-playbook.md section 1 on 2026-08-22 and read out of the repo today: a New Hampshire county runs the jail, the nursing home, the sheriff, the registry of deeds and the county attorney, runs no roads, schools, zoning or land use, and its legislative body is the county convention of state representatives rather than the commissioners. WHAT IS OWED: the statute URLs. basisUrl is NULL on that row, deliberately, because the 2026-08-23 remote session could reach no host but github.com and writing a URL it had not opened would be RULING 107's defect — a read that did not happen. A session with network confirms the live paths for RSA 24 (county conventions) and RSA 28 (county commissioners), sets basisUrl, and adds their control strings to scripts/definitions-verify.mts. NH90's own note records that gencourt.state.nh.us answers RSA 31 and RSA 189 at rung 2 while every county-chapter path tried returned 404, so the path hunt is the work rather than the fetch.

**What it started.** 4 row(s) opened, 3 still open.

- **NH107** — Promoting the rung-1 campaign-site leads turned up attorney bio pages for two Morris County candidates — chippersonlaw.com for Rita C. Chipperson and dawkinswarrington.com for Clifford D. Dawkins. Both were briefly and wrongly promoted as campaign sites by a first version of the evidence test, and both are correctly recorded as MISS for that field now: a law firm page is not evidence of a candidacy. But it IS a real find for a different field. The branch manifest already names the route — bar-directory, which it describes as reaching an office address and a direct line — and the manifest's own index says to try it first when a candidate is a lawyer. Nothing read these two pages for a phone or an address. *(open)*
- **NH108** — The questionnaire instrument is built and 272 invitations are generated, every one with invitedOn null, so nothing has been sent to anybody. The page a candidate types into is buildable and is NH104. SENDING is not a build, it is four decisions, and they are all yours: (1) the sending DOMAIN this goes out from, because a civic questionnaire arriving from a generic address is the one a campaign deletes; (2) an email PROVIDER CREDENTIAL, which this project does not hold and cannot obtain on your behalf; (3) DELIVERABILITY WARM-UP, because 272 near-simultaneous messages from a cold domain is the textbook shape of a spam classification, and being classified once is close to unrecoverable; and (4) WHETHER THE INVITATION GOES OUT BEFORE OR AFTER 3 NOVEMBER 2026, which is a judgement about the election and not a technical question at all. Raised as ONE row on purpose so you can rule once rather than in four pieces, and so a session cannot start building a send path on the strength of having answered one of them. *(open)*
- **NH110** — walk:all against production on 2026-08-23, deploy 6a8ba907304b640008d06090, reports one regression: lib/db/migrations/0016_known_cerebro.sql is in the tree and has not been applied to the live database. It creates three tables and nothing else - questionnaire_invitations, questionnaire_responses and questionnaire_tokens - with no ALTER and no DROP, so it touches no existing data. It arrived with the questionnaire stack merged in 9399a69. NO READER IS AFFECTED TODAY: nothing has been sent, all 272 invitations carry invitedOn null, and the route catches the failed insert and still serves the page. It becomes blocking the moment a candidate can submit an answer, because the answer would have nowhere to land. *(open)*

**Needs Sean.** NH108

## njhunt6 · 2026-08-22

**What it finished.** 2 row(s).

- **VF02** — Three captures read as images on 2026-08-22 against production deploy 6a8a606851610e0008305901 - the map at 07866, 03255 and 85701 - all show the app's own fallback panel: BASEMAP UNAVAILABLE, Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use MapTiler. WHAT WAS CHECKED, so the next session does not re-check it: the key IS baked into the production client bundle - chunk 38lr8y2ek8t22.js carries api.maptiler.com/maps/${i}/style.json?key= with a real key - and that style endpoint answers HTTP 200 with 62,975 bytes of valid style JSON from this network. So neither the key's presence nor its validity is the cause. WHAT IS NOT KNOWN: whether a real reader sees this. The capture is a headless Chromium run and the fallback may be a race against the tile load rather than a failure, which would make it a capture artifact and not a defect. It is recorded as UNRESOLVED in that direction rather than dismissed, because the district geometry and the pins render either way and the fallback panel is the only thing that distinguishes the two cases. THE CHECK THAT WOULD SETTLE IT: read the network requests to api.maptiler.com from a real browser session on production, and check whether the style request is issued at all, refused, or simply slower than the capture window.
- **RO01** — NJ Hunt 4's close-out reported that three of its captures claimed to show the who-governs surface and actually showed the map, because the shooter minimises the card before capturing. It corrected the caption in docs/state.md. It did not change the string in scripts/shoot-nj-hunt4-0822.mts. NJ Hunt 5 ran the same shooter against production, read all seven captures as images per RULING 2, and found the same three wrong captions - now four, since 85701 was added. The caption is fixed in the tool this time. THE GENERAL POINT, which is why this is a row rather than a footnote: a correction recorded in a document describes what one session believed on one day; a correction written into the instrument changes what every later run produces. Where a session finds a defect in something a tool emits, the fix belongs in the tool, and the document records that it was fixed there. Worth a sweep for other corrections recorded in state.md whose instrument was never touched.

**What it started.** 5 row(s) opened, 4 still open.

- **NH72** — NJ Hunt 6 wired 19 of 39 Morris municipalities' governing bodies. The other 20 are OWED, not absent, and `corepack pnpm nj:wire --dry` names every one with its reason. Three reasons, in order of frequency: (1) the confirmed member count does not reach the seat count the municipality's own form of government declares, so a partial list would state a false composition; (2) the form-of-government line states no seat count at all, so completeness cannot be checked; (3) the county clerk's certified winners do not reach the municipality, so the SEATS' partisanship is unsettled under M62. Every one of these is closed by more hunting, not by loosening the gate. The nearest wins: Boonton (7 of 8 confirmed), Dover (5 of 8), Netcong (4 of 6), Long Hill (4 of 5). *(open)*
- **NH74** — The township's own Township Council page shows `hmorrison@rockawaytownship.org` as Howard Morrison's address, and the link behind it targets `hkritz@rockawaytownship.org`. Howard Kritz held the seat before Morrison and appears in the Clerk's certified 2023 winners, so the mailto is a predecessor's mailbox the page never updated. We ship the DISPLAYED address, which is what the body publishes as his, and record the mismatch rather than silently preferring either. Worth telling the township: the link on their own page reaches the wrong person. *(open)*
- **NH75** — Playwright's extraHTTPHeaders applies to EVERY request a context makes, third parties included. MapTiler's CORS preflight does not allow x-wtp-synthetic-run, so the basemap style request was refused in every capture and every walk. That is why NJ Hunt 5's captures showed BASEMAP UNAVAILABLE against a production site serving readers a working map. Fixed at the shared path in scripts/browser.mts. This row is open for the QUESTION IT RAISES rather than the fix: what else has an instrument of ours been breaking while measuring it? The shape - a synthetic marker leaking into a third-party request - is worth sweeping for beyond the browser. *(open)*
- **NH76** — `corepack pnpm nj:winners` reads the Morris County Clerk's certified general-election winners: 263 people across three cycles, each with a party, a filed street address and usually an email, certified by the election authority. NJ Hunt 6 wired the PARTY from it for 98 sitting officials and used the email only as a fallback where the body's own page publishes none. What is owed is the rest: the filed addresses are unused, and the same document class exists for every New Jersey county and for the school-board and fire-district races the municipal walk does not reach. *(open)*

**Needs Sean.** Nothing.

## nj-hunt3 · 2026-08-22

**What it started.** 12 row(s) opened, 7 still open.

- **NJ06** — data/ballot/nh-merrimack-2026.json gives the contest "Executive Councilor, District 2" the ocdId ocd-division/country:us/state:nh/county:merrimack/place:newbury_town. New Hampshire's Executive Council District 2 covers 81 cities and towns; Newbury is one of them. Two consequences: the contest renders only for readers whose divisions include Newbury, so the other 80 towns in the district never see their own Executive Council race; and the id is a wrong join key, which CLAUDE.md makes the universal key for districts, offices and elections. Found while verifying RULING 71's certainty classification -- the contest read as CERTAIN at 03255, which is accidentally the right answer for the wrong reason (Newbury covers the whole zip, and District 2 does cover Newbury). The right division is an Executive Council district, which this repo has no committed geometry for. Fixing it means either committing that layer or recording the contest against the state with a scope note. *(open)*
- **NJ08** — The other half of the 52. Fire districts, sewerage authorities and a power authority -- ROCKAWAY VALLEY REGIONAL SEWAGE AUTHORITY, five PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICTs, three MONTVILLE TOWNSHIP FIRE DISTRICTs, HANOVER TOWNSHIP FIRE DISTRICTs 2 and 3, PEQUANNOCK RIVER BASIN REGIONAL SEWERAGE AUTHORITY, NEW JERSEY PUBLIC POWER AUTHORITY, SOUTHEAST MORRIS COUNTY MUNICIPAL UTILITIES AUTHORITY, PEQUANNOCK-LINCOLN PARK-FAIRFIELD SEWERAGE AUTH, WANAQUE VALLEY REGIONAL SEWERAGE AUTHORITY, MUSCONETCONG SEWERAGE AUTHORITY. No TIGER polygon exists for any of them at any vintage, so no geometry pipeline will ever reach them. RULING 57 says a body is NAMED FIRST and hunted second, and that a body with no source and no site is still entered and still rendered. scripts/twig-pair.mts already has divisionlessBodyFor(), so the mechanism exists in one place and has not been generalised. Eleven of the eighteen publish a website, listed in the twig:pair output. *(open)*
- **NJ09** — Measured 2026-08-22, not assumed. Across all 272 Morris candidacies: contact 272 of 272, ballot slogan 70 of 272, campaign site 0 of 272, photo 0 of 272. Both of the fields that are held come from ONE route -- filing-county, one county-clerk PDF -- and that document carries no portrait, no prose about a candidate and no URL. So New Jersey's mechanical contact windfall is a property of that DOCUMENT and does not generalise to the other three fields. pnpm nj:fields walks a contest and reports per route; the Rockaway Borough Council four were walked (Burnside, McDonald, Dawkins Jr., Natale) and returned filing-county empty, campaign-site not walkable, domain-search one lead (patrickmcdonald.com, capped at a lead under RULING 68 because the identifier was guessed) and three empty. 86 of the 90 contests are unwalked, and no candidate anywhere has had the full named route list walked, so no absence has been earned for anybody in either zip. *(open)*
- **NJ10** — Read as an image on production 2026-08-22. With the zip-area widening in place the card at 07866 lists both municipalities, and the Borough's row reads "Rockaway  MUNICIPAL" while the Township's reads "Rockaway township  MUNICIPAL". A reader cannot tell which is which, which is the exact confusion RULING 71 exists to remove -- borough and township are coequal forms and these are two separate governments sharing a name. The label comes from the division's own name in the registry, which for the place layer is the Census's "Rockaway" for the CDP-style entry. The fix is a labelling decision about which of the two committed names a row shows, and it wants a look at the other states before it is made. *(open)*
- **PU01** — Read as an image on production 2026-08-22 at 430x932. The map at 07866 shows a panel reading "BASEMAP UNAVAILABLE -- Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use". That is an environment variable name and a dotfile path rendered to a reader, which the plain-language rule forbids outside a technical-details disclosure: identifiers, enum values and internal keys never render to a reader. The honest half of the message -- that tiles did not load and pins still work -- is right and should stay. Two questions for whoever takes it: whether the key is simply unset on the production deploy (in which case the message is doing its job for the wrong audience), and what a reader should see instead. *(open)*
- **DI01** — pnpm nj:filing reports 42 seats a party filed nobody for, and entry 28 is "Morristown Town -- NO LOCAL ELECTION (Democratic)". NO LOCAL ELECTION is a jurisdiction-level statement in the clerk's document, not an office, so a row carrying it as an office is a bleed between two record types the parser already separates elsewhere -- the same class NJ2 playbook entry 7 describes. It does not reach a reader (the 42 are a finding stated in the report, not a rendered surface) and the total still reconciles, which is why this is P3. The count of 42 should be read as 41 unfilled seats plus one parser artifact until it is fixed. *(open)*
- **VF01** — Read as an image on production f20e1e9 at 430x932. On the map's who-governs card the pill sits inline in each body row, between the body name and the type label. At phone width that squeezes the name into two and three lines - Rockaway Township School District wraps to three, Denville Township School District to three - and the pill itself wraps to two or three lines beside them. Every word is legible and the classification is correct; the row is simply cramped, and six of eight rows carry it at this zip. The pill reads well on the ballot page, where it wraps under a wide heading rather than competing with a narrow column. Worth a look at whether it belongs under the row rather than inside it on narrow viewports, or whether the type label should move. *(open)*

**Needs Sean.** Nothing.

## nj-hunt-0822 · 2026-08-22

**What it started.** 6 row(s) opened, 5 still open.

- **NS01** — The Meta Ad Library is the single best compliant route to a campaign that lives on Facebook, and it is the one route in the manifest that this project cannot walk at all. Political-ad disclosure is mandatory by law, so any candidate who buys a single ad appears there with the campaign's website, its paid-for-by disclaimer and often a contact. The API refuses every unauthenticated request (graph.facebook.com/ads_archive answers HTTP 500 OAuthException), and the public Ad Library web pages answer HTTP 403 with an anti-automation challenge. Measured 2026-08-22 for all sixteen Merrimack County candidates: ad-library REFUSED 16 of 16, and that refusal is recorded as a refusal rather than an absence, so no candidate field moved toward exhaustion on it. A token is issued against an identity-verified Meta developer account, which means it is tied to a real person and to that person's acceptance of Meta's platform terms. That is a standing commitment to a third party and a legal question wearing an API key, which CLAUDE.md lists as an ask-before. It is also the reason no session may make it: RULING 12 says a wall like Facebook's is named and not defeated, and authenticated access risks the account it runs under. This row exists so the decision is documented and yours, with counsel's read, rather than made quietly inside a session. NOTHING is blocked on it — the other three RULING 66 routes are built and walked, and the answer may simply be no. *(open)*
- **NJ02** — The official-universe pair at 07866, measured 2026-08-22 against the 2022 Census of Governments: 178 units within the first radius rung, 5 held, 173 with no body, 13 bodies held across those five. Compare 03255, which is 48 of 48. The five held are Township of Rockaway (9 bodies), County of Morris, Morris County Soil Conservation District, Morris Hills Regional District and Rockaway Township School District. Every un-held unit is named in the twig:pair output rather than counted, per RULING 57. This is the enumeration finding, not a defect: the New Jersey universe is simply much larger inside 25 km than Newbury's, because northern New Jersey is dense with boroughs, townships, fire districts and regional authorities. The work is to name and reach them, one shape at a time, and the fire districts and municipal utilities authorities are the biggest single class. *(open)*
- **NJ03** — lib/sources/http.ts gives the Cloudflare interstitial signature a 20 KB maxBytes floor, with a comment explaining exactly why: Cloudflare injects its challenge-platform script into ORDINARY pages, so reading the marker at any size would mark a working source refused. The Imperva/Incapsula signature has no such floor, and Imperva injects _Incapsula_Resource script tags into ordinary served pages in the same way. Swept on 2026-08-22 with git grep -a --untracked: no committed fixture currently carries the marker in a real page, so this is a LATENT risk and not a live defect, which is why it is a row rather than an edit. Diagnose before fixing applies with force here — changing a challenge detector without evidence would risk the opposite failure, a real wall read as a page. What would settle it is a recorded fixture of a large Imperva-fronted page that is genuinely served, which www.nj.gov can supply. *(open)*
- **NJ04** — RULING 65's footer-address branch wired seven Sutton bodies on 2026-08-22, and three were deliberately left out because each has better evidence about itself than the town's footer has about it. Ad Hoc Speed Sign Committee: its own feed titles read 'Ad Hoc Speed Sign Committee - Zoom Mtg', so it meets on Zoom and pinning it at 93 Main Street would send a reader to an empty building; the playbook already records that a Zoom URL in LOCATION is a fact and not a building, and this is the same rule read from a title. Warner River Local Advisory Committee: its titles read 'WRLAC Mtg @ Pillsbury Library', a venue this session could not resolve to a coordinate, and it is a multi-town river committee so Sutton's town hall is a poor guess; the work is to resolve Pillsbury Library. Sutton Free Library Board of Trustees: its page states its own meeting arrangement, so it is a STATES A VENUE case. Each has four future sittings, two, and an unknown respectively. *(open)*
- **NJ05** — suttonnh.gov/sitemap.xml answers HTTP 200 with a valid sitemap containing exactly one URL: https://d9template1.civiccms.acsitefactory.com/ — the vendor's Drupal 9 template host, not the town. Rung 10 of the retrieval ladder is sitemaps and search-index caches, and on this CMS family that rung returns the vendor and none of the body's own pages. A session walking rung 10 here would read a well-formed sitemap, find no board pages in it, and have no signal that anything was wrong. Recorded 2026-08-22. Worth checking across the CivicPlus D9 tenants this project already knows before it is treated as one town's misconfiguration; data/reference/civicplus_tenants.csv is the list. *(open)*

**Needs Sean.** NS01

## job-watch · 2026-08-22

**What it started.** 3 row(s) opened, 1 still open.

- **JOB03** — The scheduled job refresh-meetings-snapshot.yml failed on two CONSECUTIVE runs (32372995194 and 32342602616), both at: Validate before committing, and has since gone green on its own. It is not broken right now. Nobody found out why it broke, so the next occurrence starts from the same nothing — which is why this is a row rather than a shrug. This watcher runs once a day and used to read only the two most recent runs, so a double failure that healed in between was invisible to it (NJ Hunt 3 item 1c). Over its last 40 completed runs it has failed 17 time(s). Two consecutive failures is evidence the cause is ours rather than a host refusing on a schedule — a wall would not usually repeat exactly. RULING 56 opens this automatically so a degrading data path is not a page nobody watches. [job-watch:refresh-meetings-snapshot.yml] *(open)*

**Needs Sean.** Nothing.

## NJHUNT2 · 2026-08-22

**What it finished.** 1 row(s).

- **NJ01** — Zip 07866 covers TWO municipalities, not one. The twig pair run on 2026-08-22 places BOROUGH OF ROCKAWAY and ROCKAWAY BORO SCH DIST at 0 km from the zip centroid, and this registry holds no body for either. The Borough is also holding a live election that this product does not render: the Morris County Clerk's 2026 filing carries four Borough Council candidates (Melissa Burnside and Patrick McDonald, Republican; Clifford D. Dawkins Jr. and Angelo Natale, Democratic), each with a filed street address and email, plus two Borough school board candidates (Edward Graf, Jaclyn D. Long). A reader in the Borough typing 07866 today gets the Township's ballot and nothing of their own. The contacts are already parsed and sitting in pnpm nj:filing output; what is missing is the division wiring, the bodies, and the ballot rows. Note the trap this sits on: the Census name normaliser collapsed Borough and Township onto one OCD id during this session and had to be corrected, so any fix here must keep the two distinct and be checked against that.

**What it started.** 9 row(s) opened, 6 still open.

- **NH57** — The welcome overlay offers four starting zips and labels 07866 'Rockaway Twp., NJ'. Two municipalities sit in that zip and the product now renders both, so the label names one of them and silently drops the other — for a Borough resident it is the wrong town. *(open)*
- **NH58** — When map tiles do not load, the reader-facing panel reads: 'BASEMAP UNAVAILABLE — Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use'. An environment-variable name and a source file path are internal identifiers and may not render outside a technical-details disclosure. *(open)*
- **NH59** — Sutton's calendar titles the committee's sittings 'WRLAC Mtg @ Pillsbury Library'. Its own page on suttonnh.gov carries only the site footer, so the body names a venue the page does not. Two sittings are held out of the product because of it. *(open)*
- **NH60** — pnpm venue:hunt --town sutton_town reads 18 of Sutton's board pages and cannot reach seven: Municipal Budget Committee, Supervisors of the Checklist, Trustees of the Trust Funds, Website Committee, Ad Hoc Waste Reduction Advisory Committee, Ad Hoc Grist Mill Bridge Committee, and the 26 Grist Mill Street Committee. suttonnh.gov/boards-committees itself answers 404. *(open)*
- **NH61** — RULING 70. Ballotpedia's Candidate Connection works because candidates volunteer answers and identity is verified before publication. The mechanism is not licensed and is worth more than the content: a questionnaire on this product's own site is original data with no licence, no copyleft and no dependency, and it is symmetric by construction because every candidate in a contest gets the same invitation and the same questions. *(open)*
- **NH62** — Recorded so no future session re-derives Ballotpedia as an available branch and starts building one. *(open)*

**Needs Sean.** Nothing.

## NJ Hunt 5 · 2026-08-22

**What it started.** 11 row(s) opened, 3 still open.

- **NJ11** — The wikipedia-municipality parser reads 39 of 39 Morris County municipalities and parses a roster for most of them. Jefferson Township and Pequannock Township return zero council members while their Local government sections plainly carry one, and both are Faulkner Act municipalities. Chatham Borough and Montville parse a roster but return no form-of-government string. These are parser seams rather than absences and must never be reported as absences about those bodies. The seams already found and fixed are written up in docs/zip-playbook.md section 8 - the roster sentence has no reliable lead-in so every sentence is scored, ref bodies must be masked before sentence splitting or every citation detaches, generational suffixes are not separators, and office titles are glued to names longest-first. These two are the next ones. The diagnostic is the headings array the parser returns on every record. *(open)*
- **NJ12** — Carries forward what NH71 recorded, minus what this session closed and plus what tiering revealed. CLOSED THIS SESSION: filing-campaign-finance-local (NJ ELEC) - the wall was on elec.nj.gov and the records are on njelecefilesearch.com at rung 2; 19 filed entities across the two 07866 municipalities with both controls clean. STILL OWED, with tier: lwv-questionnaire (Tier A) - onyourballot.vote411.org returned candidate-detail pages in search results last session and none has been opened, and it is the highest-value unwalked Tier A route left because one ballot page answers a whole contest. party-committee-roster (Tier A) - the Morris County Republican and Democratic committees publish slates and neither has been walked. filing-prior-candidacy (Tier A) - the manifest calls it the most under-used route in the list and it is under-used again. bar-directory and licensing-board (Tier C) - two candidates surfaced as attorneys through their firms' own sites and njcourts.gov has never been asked. records-request (Tier B) - rung 13, not reached. announcement-archive (Tier C). ad-library (Tier A) - NS01 is tabled by Sean and was not touched. press-outlet-map (Tier A) - the route was BUILT this session and its host list DERIVED from 726 distinct citation hosts, but the outlets' own site searches have not yet been queried. *(open)*
- **DI02** — The wikipedia-government-graph crawl enumerates governing bodies the registry has never held, most of them state executive departments, agencies, boards and commissions. Each carries its own official site harvested from the article's infobox and External links block. What is NOT yet done is the second hop: fetching each of those official sites and finding the meeting, agenda, hearing or calendar page on it, so the body becomes a reader surface rather than a name in a file. The crawl records meetingLinks where Wikipedia itself linked one, which is rare - an encyclopedia links a department's home page, not its hearing calendar. The work is a pass over data/hunt/wiki-graph-07866.json that walks each harvested official site for the schedule, and then wiring what it finds into the meetings composite the same way every other source is wired. Whether appointed officials RENDER is a separate question and is on a Needs Sean row; their meetings are not in question. *(open)*

**Needs Sean.** Nothing.

## NJ Hunt 4 · 2026-08-22

**What it finished.** 13 row(s).

- **NS02** — The Stack section states "Five workflows push main -- the four governed-artifact refreshes plus the intake tripwire". Since then job-watch.yml was added (NH Hunt 3, RULING 56) and refresh-nj-filing.yml was added today (NJ Hunt 3 item 2.3, the county filing on a one-day RULING 53 clock). tests/push-main.test.ts now asserts seven. CLAUDE.md is law and is changed only by the author, so this is routed rather than edited. The sentence is a factual count rather than a rule, and the rule it sits inside -- that every main-pushing workflow rebases and retries through scripts/push-main.mjs -- is unchanged and still true of all seven.
- **NH12** — The New Hampshire Secretary of State publishes a mailing address for every candidate on the ballot, and for most of them it is where they live. It is a public record, the state prints it, and it is the only working contact we hold for about half of the forty-seven people on Newbury's ballot. I have recorded all forty-seven in the hunt notes and rendered none of them, because putting a named person's home street address on a consumer app is a different act from a state PDF and I did not want to make that call on my own.
- **NH13** — The constitution records a wall that is not there. Two paragraphs - the source register in CLAUDE.md and the curator note in the New Hampshire ballot data - say gc.nh.gov 'refuses every client this project has, browsers included'. It answers a plain fetch at HTTP 200. Only you change CLAUDE.md, so this is a correction routed to you rather than made.
- **NH44** — A structural decision that belongs to you rather than to a hunt. The committed TIGER geometry is clipped to one county per state - public/geo/*.geojson says clippedTo 04019/34027/33013 on its own face - and 03255's first-rung circle crosses three counties. Six New Hampshire towns inside that circle are now in the registry with their boards and have NO POLYGON, so the map cannot draw them.
- **NH55** — Steven Endres is an Assistant Merrimack County Attorney and a candidate for County Attorney. The only working contact any manifest route reached for him is his office of record — Four Court Street, Concord, (603) 228-0529 — published on courts.nh.gov in his own filed comment and on the county's own department page. Meg Hagaman's card already carries the same number, because she is an attorney in the same office. Two candidates in one race now show one phone. That is a true fact about the office rather than a join collapsing, and it is shipped; but whether a reader is well served by a switchboard that reaches a candidate's EMPLOYER is a judgement about the product, not about the data.
- **NH63** — RULING 69 says the session fetches the FEC's Combined Federal/State Disclosure and Election Directory into data/reference/, 'including its PDF (~2.2 MB)'. RULING 20 says portraits and PDF corpora do not go in git — they are content-addressed outside the repo with their hashes committed, while reference data and provenance stay in git. Both are yours and they point different ways for this file.
- **JOB01** — The scheduled job refresh-meetings-snapshot.yml failed on two CONSECUTIVE runs (32543652154 and 32543393133), both at: A source failed for a JOB reason — this run is red, and has since gone green on its own. It is not broken right now. Nobody found out why it broke, so the next occurrence starts from the same nothing — which is why this is a row rather than a shrug. This watcher runs once a day and used to read only the two most recent runs, so a double failure that healed in between was invisible to it (NJ Hunt 3 item 1c). Over its last 40 completed runs it has failed 17 time(s). Two consecutive failures is evidence the cause is ours rather than a host refusing on a schedule — a wall would not usually repeat exactly. RULING 56 opens this automatically so a degrading data path is not a page nobody watches. [job-watch:refresh-meetings-snapshot.yml]
- **NS03** — RULING 75 -- a close-out commit is gated like any other commit to main. Close-out records were pushed straight to main through no gate at all, by every session in this repo's history, and that put a red suite on main twice. pnpm closeout is the gated door, pnpm main:green asks GitHub what happened to the tip rather than asking the working tree, and pnpm handoff now fails on a RED main. RULING 76 -- session-dated capture scripts stay committed and stay held to every standard; there are 34 of them and all 34 are committed. Both are written into docs/rulings.md with their reasoning. Neither is in CLAUDE.md, because that file is law and only the author changes it. If either should be law, it wants his hand on it.
- **NS04** — Every job on d0e0e34 completed in three to four seconds with ZERO steps recorded, twice, including an explicit `gh run rerun`. Runs 32600684167 and its re-run both died before any step reported and the logs were not retrievable. It was not the tree: f20e1e9, twenty minutes earlier, passed all three checks, d0e0e34 differed from it only by documents and one capture script, and locally the suite was 1704/1704 with lint clean, tsc clean and both build modes green. RESOLVED ITSELF WITHIN THE HOUR, and that is recorded rather than the row being dropped. The next commit, 3186eb2, went GREEN on all three checks at the first attempt. So the condition was TRANSIENT -- a runner allocation failure rather than a standing minutes or spending cap. This is left open at a lower priority because a transient failure that nobody looked at is how the meetings refresh degraded for eight days, and because the account settings that would confirm or rule out a cap are ones a session cannot see: `gh api /settings/billing/actions` returns 404 for me. What is worth Sean's minute: whether the Actions minutes balance or spending limit is anywhere near its ceiling, because if it is, this will recur and the next occurrence will look identical. Nothing needs fixing in the repo. scripts/main-green.mjs was corrected in the same session to tell this apart from a genuinely red main -- before that fix it reported "main is broken and production will not deploy", which would have sent a session hunting a defect that did not exist.
- **NH56** — The ballot page now shows Rockaway Borough's council and school board to a 07866 reader, because it resolves the zip's AREA. The map's who-governs card still resolves a single ZCTA centroid, so it reads '4 bodies govern the area around 07866' and names Morris County, Morris Hills Regional, Rockaway township and Rockaway Township School District — no Borough. Same defect as NJ01, one surface over.
- **NH64** — RULING 37 says a session marks its own completed work Resolved and moves it, in every section except Needs Sean. scripts/tracker.mjs has no mode or flag that does it. Resolution, Condition and Notes are read ONLY out of docs/tracker.xlsx, and anything found there is attributed to Sean.
- **NJ07** — pnpm twig:pair --zip 07866 gives 90 of 142 units held, and 52 of 52 unheld rows read "no division of its own". 34 of those are GENERAL_PURPOSE and SCHOOL_DISTRICT units in Sussex, Passaic, Essex, Bergen and Warren counties, 16-25 km out. Real TIGER polygons exist for all of them. The gap is that CLIP_COUNTIES is one county per covered state (lib/coverage/artifacts.ts, derived from the coverage manifest): place-34.geojson holds 67 features and cousub-34.geojson 66, all Morris. scripts/fetch-districts.ts states the tradeoff explicitly -- national coverage across these types is 13,000+ features, which ends the committed-GeoJSON approach and forces vector tiling. Extending to five adjacent counties is roughly 1,000 more features. That is a real step toward the stated ceiling and it is an architecture decision rather than a hunt, which is why this is a row and not a fix. Note the denominator: 142 is the first-rung 25 km circle, and every government whose territory reaches inside 07866 IS held.
- **PU02** — Measured on production f20e1e9, 2026-08-22, at 430x932 with the walk's own page shape. Typing "a" into the ask box and clicking the FIRST row of type Body opens no card at either zip: 85701 offers "Amphitheater Unified School District Governing Board" and 85641 offers "Armory Park Historic Zone Advisory Board", and neither produces a .account-modal within 5 seconds. No page error is thrown. This is M135's rule (g15) -- a row opens a card -- broken for at least some rows.

It is PRE-EXISTING and is not caused by this session's coverage widening. The proof is 85701, which this session did not change in that direction and which fails on its first Body row exactly the same way. walk:all passes at 85701 only because its loop retries up to three times and a LATER row happens to open ("AGENDA FOR AUDIT COMMITTEE MEETING"); at 85641 only one Body row is offered, so `attempt >= offered` breaks the loop after one attempt and a single non-opening row fails the check.

Why it surfaced as a regression today: the meetings snapshot refreshed at 20:04 (455 rows, 381 fresh + 74 carried), which changed which rows the autocomplete offers first at 85641. The check's verdict is therefore sensitive to snapshot content, which is worth knowing about the check as well as about the defect.

Two things for whoever takes it: why that class of row resolves to no card, and whether M135's retry loop should keep trying rather than breaking when a zip offers exactly one Body row -- a check that passes because the second row worked is not asserting what it reads as asserting.

**What it started.** 7 row(s) opened, 6 still open.

- **NH66** — 44 of the 90 Morris County contests are Boards of Education, and the municipal-roster branch built this session reaches municipalities only. A school district publishes its board members on its own site exactly as a borough publishes its council, so the same branch should reach them - what is missing is the INDEX step: there is no equivalent of the county's Cities-and-Towns page listing every district's website. *(open)*
- **NH67** — search-index was made mechanically walkable this session and walked all 272 candidates: 148 came back with at least one classified URL and 124 came back with none, because Bing and Yahoo both began refusing after roughly 170 queries. That 124 is a fact about one IP's rate ledger on one afternoon, not about those 124 people, and it may never be read as an absence. *(open)*
- **NH68** — Robert Strobel is a Board of Education candidate and strobelforschoolboard.com answered HTTP 200 to a plain fetch with no mention of his name anywhere in the HTML. That is the classic JavaScript-rendered page: a false miss at rung 2, not a wall and not an absence. The extractor recorded it EMPTY, which is honest about the fetch and wrong about the candidate. *(open)*
- **NH69** — Every tracker run this session ended with THE WORKBOOK IS STALE and exit code 3: docs/tracker.xlsx is locked (docs/~$tracker.xlsx exists, which is Excel's own lock file). The two CSV stores are authoritative and were written correctly, and docs/tracker.md and docs/log.md regenerated from them - but the workbook Sean edits is showing the tracker as it was before this session, and saving it would write those older rows back over the stores. *(open)*
- **NH70** — New Jersey has two places named Silver Lake, Census GEOIDs 3467590 and 3467650, and placeIdentity keys on state plus name, so both slug to state:nj/place:silver_lake. The widened geometry clip surfaced it and the build refused to write, correctly - a duplicate join key is a join that collapses. It is fixed for the build by suffixing EVERY side of a collision with its Census GEOID, and the underlying identifier convention is still not unique. *(open)*
- **NH71** — The branch manifest names 41 routes. This session walked search-index, filing-county, body-roster-page, gov-staff-directory, campaign-site, campaign-social, candidate-platform, local-newspaper, web-archive and domain-search. The rest were not walked and each one's reason is recorded here rather than left as a silence, because a route nobody names is a route the next session rediscovers as new. *(open)*

**Needs Sean.** Nothing.

## nh-hunt5 · 2026-08-21

**What it started.** 7 row(s) opened, 6 still open.

- **NH43** — RULING 60's residual. NH Hunt 5 hand-worked every un-held unit at 03255 and holds 48 of 48. Three bodies inside those units were reached by nothing, and each is listed below with every branch already walked and what each returned. The ruling asks you to hunt one or two yourself and return the process, which then gets built as a branch the same way the six in zip-playbook.md section 8 were. *(open)*
- **NH45** — data/ballot/candidate-hunt-state.json holds 136 candidate keys in TWO formats for the same people: a slug form, ballot-az-pima:governor:hobbs-katie, and a pipe-and-display-name form, ballot-az-pima:governor|Katie Hobbs. Thirty of the 136 are the pipe form and every one names somebody the slug form already names. candidate-cards-2026.json carries 20 of the same duplicates. *(open)*
- **NH46** — One of the three coverageNotes in data/ballot/nh-merrimack-2026.json ends with a paragraph of internal record-keeping that reaches a reader on the ballot page: 'CORRECTED 2026-08-21 under RULING 52: this note used to end ... That was true when it was written on 2026-08-14 and is FALSE now - re-walked 2026-08-21, gc.nh.gov answers a plain rung-2 fetch at HTTP 200. A wall is recorded with the date it was last tested...' *(open)*
- **NH47** — pnpm test reported 1561 passing, 0 failing, while EIGHT guard tests had stopped running entirely. A deleted test and a passing test are indistinguishable in that output; the only instrument that can see the difference is the COUNT, and nothing checks it. *(open)*
- **NH48** — pnpm venue:hunt read 157 body pages on 2026-08-21. Three state where the body meets; 137 were read and state nothing; 17 could not be read. That 137 is a dated measurement about 137 specific pages and it is the next hunt's starting point. *(open)*
- **NH49** — pnpm hunt:gaps reports 182 owed of 368 possible across 30 contests and 92 candidates, down from 184 at NH Hunt 4's close. Per class: Photo 45, In their own words 41, Contact 60, Campaign site 36. *(open)*

**Needs Sean.** NH43

## Sean · 2026-08-21

**What it finished.** 3 row(s).

- **PE01** — A candidate we hold no published words for still gets a sentence on their card saying so. It is honest and it names the gap as ours, and it also appears only on the shortest cards — which is the same shape as the line RULING 42 just deleted. Whether it goes too is a call about a reader surface, so it is yours. Seen on the live ballot at every pilot zip.
- **PE04** — Every candidate card carries a line saying how many of the twelve issues we search for turned up in their own pages — and, when none did, a sentence saying so. You asked for the page disclosure to be one sentence and no more. Whether that reaches this line too is the part your note does not settle, and it is worth asking because you ruled the opposite way on it once already.
- **NH09** — On 2026-08-16 you ruled that candidates we have a photo of should be listed first within a contest, and the cost was written down at the time: layout position stacks on top of the information advantage. RULING 42, four days later, says no ordering may indicate how complete one candidate's record is relative to another's. Both are yours and they point opposite ways. Nothing has been changed.

**Needs Sean.** Nothing.

## NHHUNT4 · 2026-08-21

**What it finished.** 2 row(s).

- **NH14** — Lake Todd Village District and the Merrimack County Conservation District both have territory over 03255, both are real governments with meetings and budgets, and the product has never named either. A reader in Newbury can be governed by them and hear nothing.
- **NH15** — Six of the seven towns that send members to the Kearsarge Regional School Board had no bodies in this registry at all. They now have a list - 90 boards, committees and commissions, read from each town's own website with the rung recorded - and nothing is wired to any of them. A reader in one of those towns still sees nothing.

**Needs Sean.** Nothing.

## NHHUNT3 · 2026-08-21

**What it started.** 4 row(s) opened, 3 still open.

- **NH27** — Springfield is one of Kearsarge seven member towns and had no bodies in this registry at all. Eight are now enumerated and recorded KNOWN_UNCOVERED. They are not wired because the town iCal export is capped at the OLDEST 50 events and stops at 2024-11-07 - six different views all return the identical stale document and the plugin REST API answers 404. The town has NOT stopped meeting: its own front page links events/cemetery-trustees-meeting-2026-08-11 and events/conservation-commission-meeting-2026-09-03 [expected-future: the town's own published meeting date, read 2026-08-21]. The live meetings are in the HTML, and no adapter here reads that shape for this town yet. Wiring to the stale feed would have shipped eight bodies rendering as having no meetings while the town publishes them. *(open)*
- **NH28** — Springfield was found by probing six conventional iCal paths against the town host - one request, and a town that had been dark since the registry was built produced eight named governing bodies. The same probe was run against Bradford, New London, Warner and Newbury; only Springfield and Newbury answered. Sutton at www.sutton-nh.gov does not resolve at all and needs its real host found. The remaining towns need the OTHER branches walked - vendor portals, board pages, minutes archives - rather than the conclusion that they publish nothing. Six of seven member towns were dark and this session moved one of them. *(open)*
- **NH29** — Springfield NH went from zero bodies in the registry to eight enumerated and the gap ledger is byte-identical at 22383 bytes before and after. The ledger measures special-district coverage against the Census of Governments, which is right and is not the whole of coverage: RULING 9 says the Census counts GOVERNMENTS and the product renders BODIES, and a New Hampshire town is one government and a dozen or more bodies. So the instrument that is supposed to say how covered a place is cannot see the unit the product actually renders. Six of Kearsarge seven member towns are dark at the body level and nothing measures that. This is a defect in the instrument rather than a gap in coverage, which is why it is a row and not a ledger entry. *(open)*

**Needs Sean.** Nothing.

## NHHUNT2 · 2026-08-21

**What it finished.** 1 row(s).

- **NH01** — The Kearsarge Regional School District publishes who sits on its school board, and its own page for that list refuses every way we have of reading it. The nine names we show came from an earlier read and the district may have changed them since. Getting a current list needs a route we have not walked yet.

**What it started.** 8 row(s) opened, 2 still open.

- **NH16** — Bradford, New Hampshire publishes every agenda and minute set on a vendor platform this product has never seen. Its own town website carries no boards index and no calendar, so the vendor is the only route to the town's meetings. *(open)*
- **NH17** — The consolidated miss list says newbury.nh.gov/sitemap.xml is a 403 and that robots declares none. It answers HTTP 200 at 43,484 bytes. A sitemap is the discovery rung for every page on a site, and this one has been closed to us on a stale reading. *(open)*

**Needs Sean.** Nothing.

## NH-Hunt-6 · 2026-08-21

**What it started.** 6 row(s) opened, 5 still open.

- **NH50** — Sutton's own boards-and-committees index lists sixteen governing bodies and the registry holds two of them. RULING 57 names a body first and hunts it second, so the fifteen missing ones are entered with what is known — the name, the host municipality, and the page that named them — whether or not a meeting source exists. The index is at suttonnh.gov/boards-committees and is reachable at rung 5 (rungs 2, 3 and 4 hit a Cloudflare managed challenge). NH Hunt 6 wired the Planning Board only, because its page is the only one that states a venue. *(open)*
- **NH51** — Fifteen of Sutton's sixteen bodies have no published venue this session could find. Their pages carry '93 Main Street | Sutton Mills' in the SITE FOOTER only — the town's postal address on a template, not a statement about where that board sits — and reading a footer as a venue would pin fifteen bodies on the strength of a page layout. What is owed is the posted NOTICE per body, which carries the room by construction, or a minutes header that states it. *(open)*
- **NH52** — facebook.com renders 977,803 and 928,697 bytes and ZERO characters of readable text to our headless browser, on two campaign and committee pages read 2026-08-21. campaign-social is the highest-yield branch-manifest route for the smallest races — the rule that a campaign living on Facebook still has a campaign site exists to protect exactly the candidates least able to buy a domain. The route is WALLED today, with its date, and RULING 53 puts it back on the queue in fourteen days. *(open)*
- **NH53** — The walker covers 7 of the 36 manifest routes mechanically. Per field that leaves 4 of 7 photo routes, 8 of 10 blurb, 29 of 35 contact, 10 of 14 campaign site and 6 of 8 verified page needing a person — reported by name on every run, never counted as walked. Each route automated is a whole class of candidate the manifest can be exhausted against without a session reading pages one at a time. *(open)*
- **NH54** — A statewide New Hampshire candidate-and-results database exists at electiondatabase.nhpr.org and nh.electionstats.com. Every /candidates/view/<Name> URL from the search index returns the SPA's 404 shell — 41,148 bytes, identical for a known-good name — and rung 6 confirms a genuine 'Page Not Found'. The path has moved. It would serve many candidates at once if found: prior candidacies, districts, and results. *(open)*

**Needs Sean.** Nothing.

## NH Hunt 4 · 2026-08-21

**What it started.** 13 row(s) opened, 10 still open.

- **NH32** — The intake tripwire raised an alarm on 2026-08-21 at 00:28 UTC: a search_log insert was refused in production. The alarm is doing exactly what it was built for. The problem is that its output prints five dashes where the database's reason should be, so the one thing needed to diagnose it is the one thing not recorded. Production schema is in sync at 0015, so a missing column is ruled out. *(open)*
- **NH34** — Sutton has 18 governing bodies, all named in the registry and all shipping KNOWN_UNCOVERED. Its CivicPlus calendar exports 1,312 events - 47 of them upcoming - and every single one has an empty LOCATION field. Nothing this session reached states a meeting venue for any Sutton body, so wiring them would have produced 18 bodies whose every sitting drops. *(open)*
- **NH35** — Warner's own boards index names 26 governing bodies. Its calendar files sittings for 16 of them. The other ten are named in the registry and ship KNOWN_UNCOVERED: the Cemetery Trustees, the Community Power Committee, the Corridor Committee, the Economic Development Advisory Committee, the Groundwater Protection Committee, the Highway Safety Committee, the Housing Advisory Committee, the Joint Loss Management Committee, the Mink Hills Recreation Committee and the Record Preservation Committee. *(open)*
- **NH36** — Wilmot's Master Plan Committee, its Safety Services Facility Committee and its Transfer Station Advisory Group all meet, and the town files their meetings under CATEGORIES:Planning Board and CATEGORIES:Select Board. A category-driven read cannot separate them and a title-driven row over the same feed would claim events that already belong to another body. All three are named and KNOWN_UNCOVERED. *(open)*
- **NH37** — Every Arizona officeholder's stored page URL carries a legislature number, and 67 of the 90 carry one that is not the current session: 5 at legislature 54, 23 at 55 and 39 at 56. Two of them surfaced as MISS-GENERIC in the officials audit - Rachel Keshel and Rosanna Gabaldon - and the rest are latent, waiting for their seat to be wired to a district. *(open)*
- **NH38** — Six of the 40 New Jersey senators carry a websiteUrl on assemblydems.com or njassemblygop.com - a party caucus page for the Assembly, for people who now sit in the Senate. Two of them, John McKeon and Parker Space, answer HTTP 404 and surfaced in the officials audit as MISS-404. *(open)*
- **NH39** — James Gallagher, a U.S. Representative sworn in on 2026-06-10, has no websiteUrl at all - the congress-legislators dataset this registry reads has not yet published his House page. Kate Murray is the one New Hampshire officeholder pnpm nh:fix-pages could not repair, because she is not on the General Court's current roster; a former member's page is the archive's hunt. *(open)*
- **NH40** — cfs.sos.nh.gov holds first-party contact details for every New Hampshire candidate who registered a committee, and it refuses rungs 2, 3, 4 and 6 with an Akamai 403 - headless Chromium, a real Chrome channel and a masked user agent alike. A visible browser on the same machine and the same IP gets HTTP 200. It was harvested by hand this session through the app's own XHR at rung 7, which is a procedure and not a script, so nothing in CI can repeat it. *(open)*
- **NH41** — The Lake Todd Village District's own site, which the Census of Governments records as laketoddvillagedistrict.us, answers HTTP 404 at rungs 2, 3, 4, 5 and 6, and so does the Town of Bradford's news item for its meeting. The Internet Archive - rung 11, and the rung that produced this district's own words for an earlier session - answered 'Temporarily Offline' on 2026-08-21. *(open)*
- **NH42** — pnpm twig:pair reports 48 government units inside 03255's first-rung circle, 28 with a body in this registry and 20 without. Seven of the twenty are not missing a body so much as missing a DIVISION: Sullivan County itself, and the towns of Lempster, Croydon, Newport, Windsor, Acworth and Grantham are not in the shipped division list at all, so no body could be attached to them. *(open)*

**Needs Sean.** Nothing.

## Prompt E · 2026-08-20

**What it finished.** 2 row(s).

- **PD04** — About one search in ninety was never recorded in the store this business sells, and nothing could see it happening. Diagnosed and fixed this session.
- **PE03** — A meetings source fetched three of a town's calendars, produced no meetings from them, and reported that it had succeeded — so the safety net that preserves a town's meetings during an outage never ran, and Wilmot, New Hampshire went from 23 meetings to none on a reader's page. Fixed at the one line all eleven sources pass through.

**What it started.** 4 row(s) opened, 1 still open.

- **PE02** — The short summary file generated at the end of every session still reads the frozen pre-rebuild tracker, so it reports a priority count on a scale that no longer exists. Nothing a reader sees is affected; the next session opens on a number that means nothing. *(open)*

**Needs Sean.** Nothing.

## Prompt D · 2026-08-20

Prompt C had added a rule that hid every candidate unless everybody in the race had the same information. That hid everyone. This session removed the rule, put 107 candidates back on the ballot across all 36 contests in the four test zips, and made the rule illegal so it cannot come back. It also gave a silently failing write a bell that somebody can hear.

**What it finished.** 1 row(s).

- **R58** — Seventeen production checks stopped running and said nothing at all. Only two of nineteen reported that they could not run, so a suite that had lost most of a section still passed.

**What it started.** 5 row(s) opened, 4 still open.

- **PD01** — Roughly four million people in Washington DC and the five territories are shown no federal representative at all, because their at-large district is missing from the registry. The six people are real, non-voting members of Congress, and their constituents currently see nothing. *(open)*
- **PD02** — The local development database is eight migrations behind production, so nothing can be tried locally against the real schema. *(open)*
- **PD03** — When a reaction's location lookup fails, the row is written with an empty list of districts rather than a recorded failure — so a lookup that broke is indistinguishable from a place with no districts. *(open)*
- **PD05** — The production walk creates rows under two different run labels and then counts only one of them, so it under-reports how many rows it wrote. *(open)*

**Needs Sean.** Nothing.

## Prompt C · 2026-08-20

Rewrote the constitution's shelf-life sections so they point at the files that are authoritative instead of copying them, gave rulings a permanent home, restarted the two stores that had gone dark, and tightened the gate that measures whether a hunt is finished.

**What it finished.** 2 row(s).

- **PB14** — A rule shipped in an earlier session withheld every contest whose candidates were not all fully researched, which on the four test zips meant almost all of them. It also broke two production checks.
- **D73** — Both stores this business sells stopped recording for four hours and eighteen minutes, and every instrument stayed green. A database change had shipped in code and had never been applied.

**What it started.** 39 row(s) opened, 34 still open.

- **HD01** — Eleven people are running for United States Senator in New Hampshire and forty-one things about them have never been looked for — faces, their own words, a way to reach them, a website. *(open)*
- **HD02** — Six people are running for Congress in New Hampshire's second district and eighteen things about them have never been looked for. *(open)*
- **HD03** — Four people are running for Merrimack County Attorney and sixteen things about them have never been looked for. *(open)*
- **HD04** — Four people are running for Merrimack County Sheriff and sixteen things about them have never been looked for. *(open)*
- **HD05** — Three people are running for Merrimack County Commissioner in the second district and twelve things about them have never been looked for. *(open)*
- **HD06** — Three people are running for the Rockaway Township Board of Education and twelve things about them have never been looked for. *(open)*
- **HD07** — Four people are running for Arizona's 19th state house district and ten things about them have never been looked for. *(open)*
- **HD08** — Four people are running for Congress in Arizona's sixth district and ten things about them have never been looked for. *(open)*
- **HD09** — Three people are running for Governor of New Hampshire and nine things about them have never been looked for. *(open)*
- **HD10** — Two people are running for Merrimack County Treasurer and eight things about them have never been looked for. *(open)*
- **HD11** — Two people are running for New Hampshire Executive Councillor in the second district and eight things about them have never been looked for. *(open)*
- **HD12** — Two people are running for Merrimack County Register of Deeds and eight things about them have never been looked for. *(open)*
- **HD13** — Two people are running for state representative in Merrimack County's seventh district and eight things about them have never been looked for. *(open)*
- **HD14** — Two people are running for the Morris Hills regional school board's Rockaway Township seats and eight things about them have never been looked for. *(open)*
- **HD15** — Two people are running for Arizona State Mine Inspector and six things about them have never been looked for. *(open)*
- **HD16** — Three people are running for Arizona Secretary of State and six things about them have never been looked for. *(open)*
- **HD17** — Three people are running for United States Senator in New Jersey and six things about them have never been looked for. *(open)*
- **HD18** — Two people are running for Arizona's 19th state senate district and five things about them have never been looked for. *(open)*
- **HD19** — Two people are running for New Hampshire's seventh state senate district and five things about them have never been looked for. *(open)*
- **HD20** — Two people are running for the Morris County Board of Commissioners and five things about them have never been looked for. *(open)*
- **HD21** — Two people are running for Congress in New Jersey's 11th district and five things about them have never been looked for. *(open)*
- **HD22** — Three people are running for Governor of Arizona and four things about them have never been looked for. *(open)*
- **HD23** — Two people are running for Arizona's 20th state house district and four things about them have never been looked for. *(open)*
- **HD24** — One person is running for Merrimack County Register of Probate and four things about them have never been looked for. *(open)*
- **HD25** — One person is running for the Rockaway Township school board's unexpired term and four things about them have never been looked for. *(open)*
- **HD26** — Two people are running for Arizona State Treasurer and three things about them have never been looked for. *(open)*
- **HD27** — Two people are running for Congress in Arizona's seventh district and three things about them have never been looked for. *(open)*
- **HD28** — Two people are running for Arizona Attorney General and two things about them have never been looked for. *(open)*
- **HD29** — Two people are running for Arizona Superintendent of Public Instruction and two things about them have never been looked for. *(open)*
- **HD30** — One person is running for Arizona's 20th state senate district and one thing about them has never been looked for. *(open)*
- **SRC01** — A Census Bureau API key sits unused. The product reads Census bulk files instead, so the key buys nothing until something wants live population or income figures. *(open)*
- **SRC02** — A lobbying-disclosure API key sits unused. The credential half of the row that says the product fetches no lobbying data at all. *(open)*
- **SRC03** — A data.gov umbrella key sits unused, and an earlier session reported it did not exist. It does — it is in the environment file — and this row corrects the record. *(open)*
- **SRC04** — The government publishing office's API, sized and deliberately not built. The row records the decision so a later session does not re-open the question from scratch. *(open)*

**Needs Sean.** Nothing.

## Prompt B · 2026-08-20

Built the national picture: how many governments exist, how many of them the product can locate, and how deep the coverage goes in any given place. Restructured the tracker, specced the API clients, and built the gap ledger that later sessions work from.

**What it finished.** 3 row(s).

- **F25** — Two scheduled refresh runs hung and were killed at the six-hour limit, so the meetings on the site stopped moving without anything reporting a failure.
- **R48** — Two scheduled jobs both pushed to the main branch with no retry, so when they ran close together one run's work was silently lost.
- **PB13** — A previous session reported that a data.gov key did not exist. It does. The row exists to correct the record rather than let a wrong finding stand.

**What it started.** 20 row(s) opened, 18 still open.

- **PB02** — Nobody publishes boundaries for special districts — fire, water, irrigation, library — so the product cannot tell a reader whether they live in one. They are 43.55% of every government in the country, and this is the largest single hole in the coverage promise. *(open)*
- **PB01** — Two federal sources disagree about how many school districts Montana has — 387 against 311, with nothing to account for the gap. Until it reconciles, the product cannot state a district count for Montana or any national figure that includes it. *(open)*
- **PB08** — LegiScan already supplies bill text and votes. What is unread is the rest of a state legislator's record — who sponsored what, which committees they sit on, how long they have served — which is most of what a state card should say. *(open)*
- **PB09** — Congress.gov's own API, unread. The product already reads roll calls straight from the House and Senate clerks; this adds cosponsorships and committee membership, which is how a reader sees what a member works on rather than only how they voted. *(open)*
- **PB05** — School districts are matched between two federal files by name, because neither file carries a shared identifier. Roughly 4,000 do not match. The proper crosswalk exists and has to be acquired. *(open)*
- **PB06** — Two small, named holes in the national map: 35 government boundaries that landed in no zip at all, and 1,599 real postal zips that have no mapped area, so no place can be resolved for them. *(open)*
- **PB07** — Four of the five scheduled jobs run the full test suite before they push. The fifth does not, so a broken document can reach the repository unchallenged. *(open)*
- **PB11** — The Census Bureau's own data service is unused. The product reads Census boundary files offline, which give shape but no people — no population, no income, nothing about who lives in a place. *(open)*
- **PB12** — Lobbying disclosure data. The repo fetches none of it — not partially, not at all — and this row says so plainly rather than leaving a half-built impression. *(open)*
- **HUNT01** — Walk every single governing body around Newbury, New Hampshire to full depth — who sits on it, when it meets, where its records are. The first place the product tries to answer completely. *(open)*
- **HUNT02** — Nobody publishes a list of the boards and commissions inside a government. The Census counts governments; readers need bodies. Until a government's boards are enumerated, there is no honest denominator for how much of it the product covers. *(open)*
- **HUNT04** — The 47 people who filed to run around Newbury, New Hampshire. None has been researched. Every one of them is a card a reader will meet. *(open)*
- **HUNT03** — Coverage records written before the product knew how to get past several kinds of wall. Each one re-walked is a public body that becomes visible after having been written off. *(open)*
- **PB10** — Reading individual donors out of the federal campaign-finance data, rather than only committee totals. Held until an election lawyer rules on the commercial-use restriction that attaches to donor names and addresses. *(open)*
- **HUNT06** — Re-running each new capability against the place it was built for, so its cost is measured in steady state rather than mixed in with the cost of inventing it. *(open)*
- **HUNT05** — Forty special districts that might or might not reach Newbury, New Hampshire. Nobody publishes their boundaries, so the answer has to come from somewhere other than a map. *(open)*
- **PB03** — A reader for agenda data hidden inside a page's HTML rather than published at an address. Without it, whole families of school and municipal sites come back empty and look like places with no meetings. *(open)*
- **PB04** — The list of towns on the CivicPlus platform covers about 12% of its customers and most of it went stale in 2020. Every town missing from that list is a town whose meetings the product cannot find. *(open)*

**Needs Sean.** PB10

## F22 · 2026-08-20

The scheduled job that keeps the meetings on the site current had been failing for a day and nobody had noticed. Fixed it, and fixed a vendor timeout that had quietly emptied a whole New Jersey township.

**What it finished.** 4 row(s).

- **F22** — The scheduled job that refreshes meetings had been failing for a day and the meetings on the site had quietly stopped moving. Fixed, and one vendor timeout that had emptied a whole township was fixed with it.
- **F23** — A meetings vendor publishes an archive stretching further back than the product serves and never says so, so the safety net that preserves rows during an outage was throwing most of them away.
- **F24** — A website refusing us and our own code failing both reported the same thing, so nobody could tell a wall from a bug.
- **F21** — The ballot page offered the polling-place control twice, identically, on the same screen.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## g20 · 2026-08-19

The research corpus of what members of Congress say arrived, and four numbers the project had been reporting turned out to describe nothing at all.

**What it finished.** 5 row(s).

- **D29** — A city has many boards, not one. The registry was deriving a single body per district, so Tucson's housing authority and its commissions were invisible.
- **D67** — Three Tucson boards publish schedules with exceptions the parser ignored, so the product showed meetings those boards had not scheduled.
- **D71** — Two reader-facing paths shipped with no production check at all, in a suite whose rule is that it only grows.
- **D72** — Two date guards asserted that the problem still existed, so they failed on the day it was fixed. A test that encodes the broken state passes only while it is broken.
- **A05** — Ask about a specific upcoming meeting and get its agenda summarized, alongside the raw agenda rather than instead of it.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## F01C2 · 2026-08-19

The second continuation of Sean's testing pass, worked on a phone. The ballot stopped being an endless scroll, and four instruments that were reporting the wrong thing were corrected.

**What it finished.** 9 row(s).

- **F12** — The reactions store could not say whether a row came from a reader or from one of the product's own automated runs. The search log already could.
- **F14** — The ballot page had become an endless scroll. Every long section moved into a card a reader opens when they want it.
- **F15** — Searching a candidate's positions returned nothing even when their own words were right there on the card — the search was reading the wrong file.
- **F16** — Every candidate's card ended with a full list of every issue the product searches for, repeated under every person. The count now sits on one row and the list is one tap away.
- **F17** — "Find your polling place" sent the reader out to the state's website while the product already held the answer.
- **F18** — New Jersey's in-person early voting runs across nine days, and it was the one voting event on the page a reader could not save to a calendar.
- **F20** — A bot-detection page served with a success code was recorded as a successful read of a school district's site. A challenge page counted as data.
- **F13** — A tracker row was missing its line break, so two rows fused into one and hid a duplicate id from the guard built to catch duplicate ids.
- **F19** — The "where can I vote" box suggested a Tucson address as its placeholder — to a reader in New Hampshire.

**What it started.** 11 row(s) opened, 1 still open.

- **F11** — One family of school-district websites ships its page content as data hidden inside the HTML, and the product's reader comes back empty without saying so. Sized, deliberately not built yet, and named so the silence is not mistaken for an empty page. *(open)*

**Needs Sean.** Nothing.

## F01C · 2026-08-19

The first continuation of Sean's testing pass. The numbers on the ballot page reconciled, and four things a reader actually hits were fixed.

**What it finished.** 7 row(s).

- **F04** — The "my ballot" tally counted ballot measures and skipped candidates, so a reader who had picked candidates was told they had picked nothing.
- **F05** — "Clear my picks" removed the card from the screen and left every pick in place, so the reader believed they had cleared something they had not.
- **F06** — A superintendent was carried as a bare surname with no first name. A surname alone is not a partial answer; it is a wrong one, and nothing detected it.
- **F10** — The candidate-issues extractor was reading website boilerplate as the candidate's own speech, so template chrome rendered as a person's stated position. A correctness and neutrality defect, not a formatting one.
- **F07** — A school superintendent was carried as a surname with no first name. The author supplied the full name and the source; the row records why the hunt returned half an answer.
- **F08** — A source file contained two invisible null bytes, which made every search tool skip it silently. A sweep that cannot see a file reports the same thing as a sweep that found nothing.
- **F09** — A script dated its own document in UTC, so after 5pm local time it wrote tomorrow's date.

**What it started.** 7 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## F01 · 2026-08-19

Sean walked the whole product on 2026-08-18 and left forty-odd findings. This session opened the row that keeps them together and started working them.

**What it finished.** 4 row(s).

- **B19** — "Find your polling place" used to send the reader out of the app. It now answers in the app where the answer is held.
- **M81** — A meeting forty miles away at the county seat governs the reader; the one next door may not. Every meeting now says which it is.
- **D47** — A full side-by-side comparison of two states' basics. Deliberately not built with the moving-here page; recorded as its own thing.
- **B16** — Name the reader's actual polling place on the product's own surface, rather than pointing them at the state's tool.

**What it started.** 8 row(s) opened, 7 still open.

- **F02** — The product renders 186 congressional committee rows with no description of what any of them does. The text does not exist in the upstream file, so it has to come from somewhere else. *(open)*
- **F03** — Ten of the twelve bodies the product covers show an elected leader and no appointed one — no superintendent, no town manager, no county administrator. The person who actually runs the place is missing from the card. *(open)*
- **V13** — A municipal agenda vendor nobody here had met, found while walking Bradford, New Hampshire. Wiring it reaches meetings that are currently invisible in several New Hampshire towns. *(open)*
- **V09** — Accela, one of four permit and zoning platforms Sean approved in principle. These are the records that answer "is there a data center coming?" before it is built. *(open)*
- **V10** — Tyler EnerGov, the second of the four permit and zoning platforms. Approved in principle; needs its own clearance. *(open)*
- **V11** — OpenGov Permitting & Licensing, the third of the four permit and zoning platforms. Approved in principle; needs its own clearance. *(open)*
- **V12** — CityView, the fourth of the four permit and zoning platforms. Approved in principle; needs its own clearance. *(open)*

**Needs Sean.** Nothing.

## g19 · 2026-08-18

Worked the deferred queue, and found four times that the brief's premise had already been built.

**What it finished.** 2 row(s).

- **G10** — Three deliverables an earlier session reported without measuring, measured properly, plus a performance command and a size cap on the session-context document.
- **A04** — Answering "who can I contact about X?" — the topic to the body with jurisdiction, then to the specific people and their public contact details.

**What it started.** 5 row(s) opened, 3 still open.

- **D68** — A script rewrote a verified data file with less data than it found and exited cleanly. Caught and reverted the same day. The row exists because the shape recurs, and a script that can lose data must be asked what it wrote. *(open)*
- **D69** — The Montana school-district disagreement, recorded as its own investigation. Named separately from the row above so the discrepancy has somewhere to be resolved rather than being carried as a caveat forever. *(open)*
- **D70** — Work out which public bodies sit on which agenda platform, so the meetings layer can reach past the four pilot zips. Three platforms, three different methods, and it needs Sean's ruling on the approach first. *(open)*

**Needs Sean.** D70

## g18 · 2026-08-18

Asked four instruments what they actually returned rather than trusting them, and four of them were wrong.

**What it finished.** 6 row(s).

- **R51** — The deploy host silently stopped building on push, so the live site served a stale version while the repository sat thirteen commits ahead.
- **AUD06** — Coverage was described in more than one place, so what the product claims to watch could drift between them.
- **M135** — Selecting a body anywhere in the product opens that body's full card. The goal is keeping the reader in the product rather than throwing them at a website.
- **R52** — A production check failed on one run in three, and the row records that it is intermittent rather than pretending it is reliable.
- **AUD03** — Surfaces whose payload can wait until the reader asks for them, identified by the outside audit.
- **R53** — The map-versus-application split in the size budget was decorative: it attributed a whole file to the map library if the file's bytes contained the word anywhere.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## g16 · 2026-08-18

Shipped the deploy, closed a class of leak where the product's own robots were counting as readers, and broke ballot measures into their parts.

**What it finished.** 3 row(s).

- **P01** — Ballot measures broken into the parts people actually disagree about — how it is paid for, what it funds, who oversees it, when it ends — in plain language.
- **R49** — The production walk checked a rendered result once after a fixed wait, so a slow but working page reported as a regression. Fixed in 33 more places.
- **R50** — The browser's fire-and-forget send bypasses the header that declares an automated run, so the product's own robots were landing in the sold store labelled as readers.

**What it started.** 2 row(s) opened, 1 still open.

- **F01** — Sean's full walk of the product on 2026-08-18, forty-odd findings across cards, meeting order, votes, the ask box, the ballot and the map. The parent row that keeps the whole batch together; the individual findings became their own rows. *(open)*

**Needs Sean.** Nothing.

## g15 · 2026-08-18

An external audit's findings entered the tracker, and three of the project's own numbers stopped describing the code.

**What it finished.** 1 row(s).

- **AUD07** — The scheduled refresh jobs ran the entire test suite even on runs where nothing changed — proving nothing, slowly.

**Needs Sean.** Nothing.

## AUD-04 · 2026-08-18

One audit finding, worked on its own: every meetings request was resolving the reader's location twice.

**What it finished.** 11 row(s).

- **R47** — Zooming out at Tucson wiped every pin off the map. Zooming out is a request to see more, and a map answering it with less is indistinguishable from a map losing data.
- **AUD01** — An outside audit asked whether the product should move to a different language or framework. The answer was no, and the reasoning is recorded so it is not re-litigated.
- **AUD04** — Every meetings request was resolving the reader's location against the same map twice. Now once.
- **B15** — A curated list of notable votes on each member's card, so a reader sees the votes that mattered rather than all of them.
- **M136** — Body cards brought up to the depth a person card already had — the author wanted opening one to feel like finding a great deal of information at once.
- **M139** — Arriving from another zip, or coming back from the ballot, the sidebar sometimes rendered blank and the who-governs card half-drawn.
- **R45** — Every workflow run printed a deprecation warning because the actions were pinned to a Node version the platform no longer supports.
- **R46** — Node printed a warning on every single test file, so real warnings were buried in noise.
- **R44** — The safety net that preserves a failed source's meetings was clipping them to a window that source never used, so an outage still lost rows.
- **M07** — A returning reader gets their zip and chosen district back, with a visible control to change either.
- **R43** — The scheduled cleanup of rate-limit state had failed on every run since it shipped, because the write guard refused it in the environment it runs in.

**What it started.** 17 row(s) opened, 3 still open.

- **AUD05** — Meetings are found by scanning the whole snapshot rather than looking them up. It works at today's size and gets slower with every place added. *(open)*
- **AUD08** — Meetings are matched to a location without a spatial index. Same shape as the row above: correct now, and the wrong shape at scale. *(open)*
- **AUD09** — The animation that flies the map to a state has no agreed speed budget, so nothing can tell whether a change made it slower. *(open)*

**Needs Sean.** Nothing.

## AUD-02 · 2026-08-18

One audit finding, worked on its own: the build check was reporting a file count as though it were the bytes a reader downloads.

**What it finished.** 1 row(s).

- **AUD02** — The build check's "largest bundle" figure was counting files in a server manifest, not bytes a reader downloads. Two different things reported as one number.

**Needs Sean.** Nothing.

## g8 · 2026-08-17

The deploy landed, and two instruments that could not actually measure the thing they claimed to measure started measuring it.

**What it finished.** 34 row(s).

- **B06** — The date the idea started, written down. Ten minutes of work that matters only if ownership is ever questioned.
- **D66** — The meetings file counted two different things and reported one number, so a healthy-looking total hid a real discrepancy. Both numbers are now stated and have to reconcile.
- **G01** — The who-governs card said four bodies govern this area directly above a list of five. Two definitions of the same thing on one surface; now one.
- **G02** — Every route now refuses a nonsense parameter instead of answering it. A malformed request used to produce a confident, plausible answer for a point in the Gulf of Guinea.
- **G03** — The production walk prints its own count of the checks it ran, so no session has to transcribe a number by hand. One mis-copied total had propagated through two sessions.
- **G11** — The number of meetings a reader is shown now agrees with itself in all four places it appears.
- **R01** — Framework scaffolding had once overwritten the project's own rules file with a twelve-byte stub. This makes that impossible to do silently.
- **R34** — Local development used to write into the production database. It now has its own, and the production write path refuses anything that is not production.
- **V02** — Spend a week using an existing local-meetings alert product in Tucson and find out what it has already solved.
- **G06** — A line on incumbents' cards ended with a defence of itself. The author cut the defence; the fact stayed.
- **G08** — The mayor was removed from the who-governs card, where the placement was awkward and the office already appeared elsewhere.
- **G09** — Measure the map's ramp-up animation and capture the frames before changing anything. The author ruled: measure first, decide after.
- **M137** — One search box that answers everything, replacing a question box, a separate search field and a duplicate of the first one inside another card.
- **M138** — One thing open at a time. The author's screenshot showed four surfaces stacked on top of each other.
- **R02** — The tracker lives in the repository under version control, with a spreadsheet view generated from it on demand.
- **C05** — The aggregate sold to a campaign is a different surface for a different audience, and its denominator excludes rows the product's own automated runs created.
- **G04** — The production walk reported how many rows it created by counting requests it sent rather than rows that landed. Two different numbers presented as one.
- **R11** — A commit message or tracker note that names a branch has to name a branch that exists. Eight rows had cited one that never did.
- **R30** — A mirror of the source code, so the person writing the next brief can read the code rather than infer it from reports.
- **R31** — One complete list of everything still open. The tracker had reached 329 rows and half a megabyte, and nobody could answer "what is outstanding?" without rebuilding it by hand.
- **R38** — Internal adapter names — schedulepage, civicplus, iqm2 — were reaching readers. Correct in the wiring, wrong in front of a person.
- **R08** — The mirror compared files byte for byte without normalising line endings, so a line-ending change would have forced a full recopy every time.
- **R17** — Three documents each stated a different number of mirror files and none of them matched the actual list.
- **R19** — The session-start check warned about the constitution's size on every single open, because the expected size had never been updated. A warning that always fires is a warning nobody reads.
- **M142** — "Last checked 6 hours ago" was true of the file and false of the rows carried forward out of an earlier one, which could be days old.
- **M131** — The lit side of a raised state did not lead the shaded side by the measured margin in the light theme, so the effect read flat.
- **R05** — The map tests covered the logic and nothing covered the markers, the camera or how the base map is chosen.
- **R16** — A date guard found 122 future-dated occurrences across the documents rather than the three expected. Each one needed the author to say whether it was a real future date or a fabricated one.
- **R32** — The list of open questions split into two tabs — build work and decisions only the author can make — because mixing them made both harder to read.
- **R35** — Eight rows cited a branch name that never existed, so the evidence behind eight claims pointed at nothing.
- **R37** — A session compared its walk to the previous one by subtracting two totals. A run that loses three checks and gains seven looks identical to one that gained four.
- **R18** — Generated documents stamped themselves in UTC, so after 5pm local they carried tomorrow's date.
- **R23** — A single line of code caused the build to trace the entire project into the bundle, tests included — and it was the mechanism behind a refused deploy.
- **M120** — The reported rubber-band on panning did not reproduce. The row records what was ruled out rather than leaving the report unanswered.

**What it started.** 24 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## g12 · 2026-08-17

The question matcher stopped answering questions nobody asked, and the interface stopped repeating itself.

**What it finished.** 22 row(s).

- **A07** — When the ask box has no sourced answer, it says so instead of writing one. Nothing a reader is told is ever generated to fill a gap.
- **D31** — A naming convention for the thousands of governments no national standard enumerates — community college districts, special districts, authorities, joint boards — minted in the product's own namespace rather than faked in somebody else's.
- **G05** — The interface consolidated: the ask box stopped being tangled up with the who-governs card and became its own thing that expands where it sits.
- **G07** — Hiding the ask box behind a pill was cleaner and got used less. Typed questions are the highest-intent signal the product collects, so discoverability won.
- **M134** — Answering "would you vote for them?" with Yes now sets the pick for that race, instead of the race asking a question the reader has already answered.
- **R39** — An official with seven phone numbers rendered seven rows. One pill now, everywhere a contact appears.
- **A06** — Collect the questions people actually ask. Every one that cannot be answered is either a data gap or a feature nobody has built.
- **D24** — 348 of 940 districts did not match the public standard's list. Reconciled by joining on the Census's own identifier instead of by name similarity.
- **D35** — The machinery that tells a reader whether a candidate has said something about an issue, has said nothing, or was never searched — three different answers that must never be collapsed into one.
- **R36** — The connection string named READONLY connects with full permission to write, drop and truncate. The name promised a protection that did not exist.
- **D22** — The second school-board agenda platform. Vail's district runs a different one from Newbury's, so reaching both target districts needed both.
- **A01** — One input that answers a question instead of making the reader navigate to it. This is the interface, not a feature on it.
- **D19** — A county board sitting as a different board is a real and common thing. Items were all being recorded as county-board business, which is the wrong body.
- **R42** — The local database connection could not authenticate at all, so no local run could prove that a write works.
- **D18** — A meeting held only online is real and public and has no coordinates, so the map was dropping it entirely.
- **M93** — What the who-governs card shows by default and what sits one tap down, decided and written into the design document.
- **A02** — Answering "what's going on where I live?" with upcoming items, recent decisions and who represents them, scoped to the reader's own districts.
- **R40** — The author's personal email address was in the rendered product. It is replaced by a feedback link opening a form inside the app, with its own store.
- **M119** — Two inputs in the sidebar where the author ruled there should be one, keyword-first, with anything else routing as a question. Recorded, not built.
- **M19** — Two venues a few metres apart render overlapping pins and the top one swallows clicks meant for the other, so one of them is unreachable.
- **M12** — One "school" layer merged three different kinds of district, so a K-8 boundary and a regional high-school boundary drew identically and a reader could not tell them apart.
- **R41** — The feedback form ships with no way to reply to whoever wrote in. That is the strictest reading of its own spec and it costs a real thing, so the author has to decide.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · Verified live, and the documents

Verified the previous session's work against the live site rather than against its own report, and wrote the record.

**What it finished.** 3 row(s).

- **R22** — The ship command now runs the exact build the deploy host runs and refuses to ship on failure. A green merge had once served the previous build for an hour.
- **R25** — Production screenshots file beside their local counterparts instead of overwriting the very shots they are being compared against.
- **R24** — Checking a deploy by looking at the front page's HTML returns nothing even when the deploy is correct, because the reader's location is session-scoped. The check has to look at something else.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The sensor was counting; the screen was not saying so

Tapping a reaction blanked the button, so a reader could not tell whether their answer had counted. It had.

**What it finished.** 1 row(s).

- **M113** — Tapping Yes blanked the button and tapping Love it made it vanish, so the reader could not tell whether their answer had counted. It had.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The pane that looked empty, and the sub-groups that did n…

A pane on the voting-record card looked empty when a view was selected, and its sub-groups did not read as sub-groups.

**What it finished.** 1 row(s).

- **M117** — The voting-record pane looked empty when a view was selected, and its sub-groups did not read as sub-groups.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The map answers to the reader: the mask follows, the rise…

The map's dimming followed the reader instead of staying where they had been, and the raised-state effect stopped looking like a hard grey outline.

**What it finished.** 5 row(s).

- **M128** — Changing from a New Hampshire zip to an Arizona one flew the map to Arizona and left Arizona blurred, because the mask was bound to the last activation instead of to where the reader was.
- **M129** — The raised edge on a focused state rendered as a hard grey band tracing every coastal vertex. Two soft silhouettes replaced it.
- **M130** — District lines from states the reader is not in were drawing over the state they are in. At fifty states that is unreadable, and it split a 1.6 MB file into pieces.
- **M132** — The reader can now see which zip they are looking at, shaded on the map.
- **M133** — Panning the map glided the reader back to where they started, so free exploration was impossible.

**What it started.** 6 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The mandate becomes law before the hunting starts, and th…

Wrote the transparency mandate and the fourteen-rung retrieval ladder into the constitution before any deep hunting began, and stopped the tracker carrying two rows for one item.

**What it finished.** 4 row(s).

- **X08** — The transparency mandate and the fourteen-rung retrieval ladder became law, placed above every operational rule so they all inherit from them.
- **R29** — Two tracker rows shared an id with two completely different items, which silently breaks every lookup. Nothing had caught it.
- **M141** — The meetings panel rendered blank until the mouse moved. The header said 86 meetings and the list underneath was empty — a paint failure, not a data one.
- **M140** — One state active at a time, the whole of it crisp at every zoom, every other state muted and lowered — and the mask stops dimming the state the reader is standing in.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The list goes back to clean, and the popup to three things

The who-governs list went back to clean and the small map popup slimmed to a name, a party and a way to make contact.

**What it finished.** 2 row(s).

- **M114** — The who-governs card went back to clean: no pills, no site links, one way to click. The author called the previous version a forever scroll.
- **M115** — The small popup slimmed to a name, a party and a way to make contact. The author called it ugly and scattered.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The documents: what shipped, what did not, and why the me…

Wrote up what shipped, what did not, and why measuring the work cost half the session.

**What it finished.** 1 row(s).

- **R28** — Twelve checks added to that suite and three of its own claims corrected. The suite only ever grows.

**What it started.** 9 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The documents: four standing rules, the cuts, and the con…

Recorded four new standing rules, what was deliberately cut, and one conflict left for Sean to settle.

**What it finished.** 10 row(s).

- **M121** — The "about this area" page, linked from every who-governs panel, was returning a server error at every single zip. The door was down.
- **M122** — The zip around Newbury dropped from 26 meetings to 7 because one website refused one request and the refresh wrote that refusal into the data as an absence.
- **M124** — Zooming out removed pins because the re-query ignored the zoom entirely and kept asking about a small circle around a moving point.
- **M125** — A fact read from the Governor of Arizona's own website rendered under the words "Verified: not yet". The product was slandering its own best evidence.
- **M126** — The contest pick read as a duplicate of the per-candidate question. It now names what it does, names the cards it opens, and reads as one group.
- **R27** — Every past session's production checks collected into one suite that runs against the live site, each check tagged with the session whose work it protects.
- **M127** — The large card showed the same contact details twice — once as a row of pills and once as an accordion beneath.
- **M94** — Two more kinds of repeated notice that should collapse to a footnote. The other three fixes in that batch shipped; this half did not.
- **M91** — One state vivid and its neighbours dimmed, with a real dialog when the reader crosses a state line. Recorded whole; not built at the time.
- **D65** — The contributions question got its own version, so answers to it never pool with answers given to the older wording.

**What it started.** 9 row(s) opened, 1 still open.

- **M123** — Six towns around Newbury hold meetings inside the radius a reader at 03255 sees. The routes to their calendars have been walked and written down; none of them is wired, so those meetings do not appear. *(open)*

**Needs Sean.** Nothing.

## 2026-08-16 · The documents, the cuts, and what was ruled out

Wrote the record of what shipped, what was cut, and what was ruled out — including things that turned out not to reproduce.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The district card stops denying people we hold

A district card said it had no officeholder while the product held that person all along.

**What it finished.** 1 row(s).

- **M112** — A district card denied having any officeholder whenever the reader was not standing in that district, while the product held those people all along.

**Needs Sean.** Nothing.

## 2026-08-16 · The cards take their final face, and the brown dies

The cards took their final visual form and the last of an old colour scheme was removed.

**What it finished.** 7 row(s).

- **D63** — One weekly fetch of a pinned public dataset solved the entire federal directory — roster, social accounts, district offices, committees and membership.
- **M101** — Pima County's supervisors rendered one character per line in the small popup. A layout breakage, seen live, not a style preference.
- **M102** — The identity header matched to the author's ruling: circular portrait with a neutral ring, the name as the dominant type, one row of chips with party filled and the rest outlined.
- **M106** — Every way to reach a person, in one row on the large card — social accounts where held, plus phone, contact form, official page and campaign site.
- **M103** — The voting record became one full-width section with two views, and the expand arrows stopped pointing the wrong way.
- **M104** — Yes and no became filled pills everywhere a position or a reaction renders, so a settled answer looks settled.
- **M105** — The measure question was asked in a smaller, quieter box than the candidate question, so it read as less important than it is.

**What it started.** 7 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The amber remnant dies in both themes

One control had survived the colour pass in the light theme. Sean's ruling was system-wide, so it went too.

**What it finished.** 1 row(s).

- **M118** — One amber control survived the colour pass in the light theme. The author's ruling was system-wide, so it went too.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · The .gov registry lands, with its boundary stated three t…

The federal registry of government domains landed as a reliable way to find where a government actually publishes, with the limits of that method stated plainly.

**What it finished.** 1 row(s).

- **D64** — A pinned snapshot of the federal registry of .gov domains, which is a reliable rung for finding where a government actually publishes.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · Pictures first, the counters breathe, and the documents

Candidates with a photograph list first within a contest, the sidebar counters stopped overflowing their tiles, and the record was written.

**What it finished.** 6 row(s).

- **M107** — Within a contest, candidates with a photograph list first. The author's recorded decision, after looking at the alternative.
- **R26** — Four entries added to the source ladder, including the federal legislator directory as a source of record and a fifty-state portal table.
- **M111** — The rule that came out of the closest call in the product's history: a component's default may never turn an absence into a statement. A null renders as its named gap, on every surface, always.
- **M108** — The four sidebar counters had labels wider than the tiles holding them, so they overflowed and read as clutter.
- **M109** — The who-governs card rebuilt to the same element grammar as the other cards. The author's bar was the reference screenshots' cleanliness.
- **M110** — A four-step route through three unsourced bodies said "we haven't sourced who sits on this body yet" three times, one line apart. Now once.

**What it started.** 6 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · Found by verifying the fix: a district card denies office…

Verifying one fix uncovered another: a district card denied having officeholders whenever the reader was standing somewhere else.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · Campaign money asks once per object

Two funding controls asked the reader the identical question on the same card, so the two answers could never be told apart.

**What it finished.** 1 row(s).

- **M116** — Two different funding controls asked the reader the identical question, word for word, on the same card — so the two answers could never be told apart.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-16 · A tab that reports absence has to have looked

A card's Sources tab said it had no sources, on a card built entirely from sources.

**What it finished.** 1 row(s).

- **M100** — A district card's Sources tab said it had no sources, on a card built entirely from sources. It was reporting absence without having looked.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## truth-session-0815 · 2026-08-15

Two blocked websites opened, every district card started confessing where its facts came from, and the laws got their votes attached.

**What it finished.** 52 row(s).

- **M57** — The sidebar counters disagreed with the lists behind them: 6 officials beside a list of 24, 13 bodies beside a list of 60.
- **M58** — The "concluded" filter was dead at every zip, so meetings that had already happened rendered nowhere — even though the server had been sending them all along.
- **M60** — Every candidate blurb's attribution rendered its dash as three garbage characters, on every card. One bad file round-trip in an earlier session did it.
- **M61** — A candidate's party appeared on the ballot and vanished on the who-governs card — the same person, two surfaces, one of them silent.
- **M86** — A district card said it had no officeholder while showing that officeholder's name three rows further down. Fixed at the shared source rather than on the one card where it was spotted.
- **D49** — The source for state legislators' voting records, found by the author: bulk roll-call data for all fifty states.
- **M63** — In a race with one name on the ballot, the existing three answers collect almost nothing. "Someone else" is the answer that carries the signal.
- **M64** — The committed design foundation — the type scale, the three voices the product speaks in, and the tokens everything else draws from.
- **M65** — The ask box redesigned as the flagship it is: a raised block with a real heading, an inviting input and a filled button.
- **M66** — The ballot and the funding surface given flagship treatment — a header with presence, contests as designed cards rather than a list.
- **M67** — Three voices applied across the whole product: explainer, tappable link, and sourced data, each visually distinct so a reader can tell a fact from a link from an explanation.
- **M68** — When the same source line repeats under every contest, it renders once at the foot with a marker at each contest instead of a wall of identical citations.
- **M69** — The narrowing prompt stopped being a modal that reappeared every time the reader panned across a boundary, and became a quiet chip they can ignore.
- **M70** — Typing a street now visibly does something: the municipality containing it shades on the map, so the reader can see their answer was understood.
- **M71** — Clearing every pick now asks in a real dialog rather than an inline line of text that is easy to trigger by accident.
- **M72** — At desktop width the top of the who-governs card rendered above the top of the window, so the reader never saw its heading.
- **M73** — At phone width the sidebar's footer line ran underneath the map legend.
- **M74** — Picks saved from Arizona's ballot were listed on New Hampshire's ballot with nothing saying where they came from.
- **M76** — Every meetings source was fetching thirty days of history while the product served ninety, so two months of concluded meetings could never appear.
- **M82** — Beside the voting dates, a link to the reader's own state's official polling-place lookup.
- **M83** — The map named a district "School District Not Defined" — a Census placeholder rendering as though it were the name of a real district.
- **M88** — The transparency page keeps every commitment and loses the words about how plainly it is saying them.
- **X05** — The design system written down — type scale, shared structural classes, the three registers, colour roles, spacing and shape.
- **X06** — The voice doctrine as law: playful where the reader is being invited to do something, level where the product is stating a fact about a real person or real money.
- **D53** — Turning a typed street into an actual point, so meetings and officials re-centre on where the reader lives rather than on the middle of their zip.
- **R21** — Before-and-after screenshot pairs and contact sheets, because design work is judged by eye and one browser session should produce the whole pass.
- **D59** — A governor's corrected portrait appeared on her officials row and the old one stayed on her ballot card. Photos now key to the person, so one person has one photo everywhere.
- **B17** — The Senate publishes official long titles rather than the names people use, so searching for a vote by its popular name could never work. Resolved through the Congress API instead.
- **D60** — A candidate the author reported as having no photograph was already covered by an existing rule; the miss was in what had been looked at, not in what was held.
- **M62** — Not one of the twelve local bodies publishes party affiliation on its own roster, including offices that are unambiguously partisan. Certified election results are the route.
- **M80** — Proven in a real browser rather than assumed: the Census geocoder cannot be called from a web page at all, so the promise to resolve a typed street on the device needs a different route.
- **M84** — Zero cancelled meetings across Tucson and Vail is implausible, and it was — two adapters were not reading cancellation status at all.
- **M87** — A tile read "179 DISTRICTS" as though the reader were governed by 179 of them. It was counting what was drawn on screen.
- **M90** — The second mobile pass: native dismissal gestures, the floating controls, a location that lasts only for the session, and a colour pass.
- **M98** — The card collapses, the votes read as two columns, and a missing position stopped rendering as "Did not vote" — which would have been a specific false claim about a named member of Congress.
- **M99** — Four of the author's rulings shipped together, including retiring the phrase "not independently verified" and defaulting the meetings window to 90 days.
- **R20** — Each state gets its own notes file — filing systems, vendor patterns, walls hit, statutory quirks — and the zip playbook is born.
- **D54** — The state-legislation refresh had a decided cadence and no scheduled job to run it, so it only ever ran when somebody ran it by hand.
- **M59** — Two archives publish past meetings with a date and no start time, and a meeting with no time was being dropped rather than shown as a day.
- **A12** — The ask box's second rung: when the keyword matcher cannot route a question a person could route in a second, a model picks which curated topic it belongs to — and can never invent one.
- **M77** — Rockaway Township showed one municipal body. It has five, listed on the township's own page — the others were on a different platform.
- **M78** — The high-school district serving 07866 had never been attempted. It runs no agenda vendor at all, which turned out to be a whole new shape of source.
- **M85** — When a street crosses a district line the reader is supposed to be asked for their house number. The question was never actually being asked.
- **M96** — About twenty places in the stylesheet referred to a colour that did not exist, so they resolved to nothing. Found by reading what the browser computed rather than what the file said.
- **M97** — Two design rules made machine-checkable: nothing overlaps anything, and every text passes contrast. The author asked for an audit of all of them, not a fix of the one he saw.
- **D58** — Money a committee received that was not a contribution was rendering as a contribution, live on production. Found by a line-by-line census rather than reported.
- **D61** — The author's ruling on what is actually licensed: anonymous reader-attention signal, never the federal filing data itself. A buyer receives opinions, not a repackaged public record.
- **D55** — Contributions sorted by amount and grouped by kind, with repeat filings from the same donor collapsed. The reader's question is who has spent the most to elect this person.
- **D57** — "54% from small donors" on $325 raised is true and misleading. A percentage of a tiny base is noise wearing a statistic's clothes, so it now has a floor.
- **M79** — Two New Hampshire hosts that refuse the product's pipeline, proven rather than assumed: at Newbury the portal carries only the selectboard, and a whole-year query proved it.
- **D56** — A joint fundraising committee files its own books, so "who gives to the committee that gave to this candidate" is a question with a real, published answer one hop further out.
- **M89** — Newbury's zoning board went live because its meeting venue was hidden in the markup behind a map link on the town's own site, where no plain read would find it.

**What it started.** 65 row(s) opened, 8 still open.

- **D62** — A research corpus of everything all 535 members of Congress have said publicly since 2022. It would give a member's card its third leg — votes show what they do, money shows who funds them, this shows what they say. *(open)*
- **B18** — Sean asked for federal officials' town halls. There is no authoritative feed for them anywhere, so this row records what was checked and what it found rather than pretending a build is waiting. *(open)*
- **D52** — Turning each state's campaign-finance filing vocabulary into words a fifteen-year-old reads. Every state files differently, so this is a programme with one adapter per state rather than a single job. *(open)*
- **X07** — In small races a campaign's entire public presence is a Facebook page. Recording that as no site found hides something real and penalizes exactly the candidates who could not afford a domain. *(open)*
- **D51** — Money spent about a race by groups that gave the campaign nothing. It reads completely differently from a contribution and has to render differently, or a reader will read it as the candidate's own money. *(open)*
- **M75** — On a phone, the map's legend crosses the bottom of an open meeting panel and covers the text underneath it. *(open)*
- **M92** — Bodies and districts on the map still click straight out to a website. Sean and the tester both wanted a card that tells you about the thing first, with the website as one of the things on it. *(open)*
- **M95** — The three state governors' cards carry no term end and no date of birth, so those lines correctly say nothing. Federal members already have them. *(open)*

**Needs Sean.** Nothing.

## 2026-08-14 · The tester's mobile pass: the bleed fenced, the ballot fo…

The tester walked the product on her own phone. Arizona's facts were bleeding into New Hampshire's answers, and she could not find the ballot at all.

**What it finished.** 6 row(s).

- **B13** — The tester's finding that a candidate with nothing on their card gets skipped, so the app tilts races without saying a word. It shipped a line naming the gap as ours; that line has since been replaced by a page-level disclosure.
- **M53** — The tester typed "library" in New Hampshire and got an explanation about Pima County, Arizona. One state's facts answering another state's question.
- **M54** — The tester could not find the ballot on her phone at all — the floating entry point never appeared and the only other way in sat below the browser chrome.
- **M55** — At phone width, fixed controls sat on top of the text a reader was trying to read.
- **D48** — The funding section now says what kind of money each donation is. Every committee in the tester's screenshot read "a political action committee" — true, and useless.
- **M56** — The tester found four of six district types switched on and turned the rest on by hand. Diagnosed rather than guessed at.

**What it started.** 10 row(s) opened, 3 still open.

- **D50** — The second pass at candidate and official photographs, now that the author has opened the door for portraits a government body publishes about its own members. More faces on cards, each one carrying the door it came through. *(open)*
- **B14** — Every candidate on every ballot gets a one-line description of themselves, taken from their own words and cited. The hunt is run just as hard for everybody in a race, which is what stops the cards tracking who could afford a website. *(open)*
- **V08** — A page for candidates rather than readers, showing what the product holds on them next to what it holds on their opponents. Sean's idea: the fastest way to fill a thin card is to let the person fill it. *(open)*

**Needs Sean.** V08

## 2026-08-14 · The photo session documents: 476/750, the findings for co…

Wrote up the photo hunt — 476 of 750 people covered — and the findings it produced.

**What it finished.** 1 row(s).

- **D20** — Portraits of officeholders downloaded once and served from the product's own servers, each one carrying a licence. No hotlinking and no unlicensed image.

**Needs Sean.** Nothing.

## 2026-08-14 · The documents stop making up dates, and the mirror gets a…

Documents had been carrying dates nobody read off a clock. Every date now comes from one command, and the shared drive got a short summary file.

**What it finished.** 2 row(s).

- **R14** — Three rules in the constitution carried dates later than the file's own last modification — dates nobody had read off a clock. Every date now comes from one command.
- **R15** — A short generated file so a conversation outside the repository can get current without reading a 249 KB state document.

**What it started.** 6 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · T08 session documents: state.md section 20, tracker Done …

Wrote the record of the hardening session — the rate limits, the abuse detection, and what they cost.

**What it finished.** 1 row(s).

- **T08** — The hardening pass before the password comes off the demo — adversarial load, abuse-pattern detection, and shared rate-limit state that does not violate the store-separation rule to enforce itself.

**Needs Sean.** Nothing.

## 2026-08-14 · 9c: the session documents - section 19, the executed brie…

Wrote the record of the tester-feedback session, including the walk that found a defect making the large card impossible to open on a phone.

**What it finished.** 11 row(s).

- **B11** — Governors were invisible on the who-governs card because they are elected by no district on the map. They now appear, so a reader sees the person running their state.
- **M46** — Rockaway Township's mayor card carried Tucson's charter text and a Tucson link. One jurisdiction's facts rendered on another's official.
- **M47** — The tester asked for her regional school district by name and the map never showed it, even though the product was counting it. Every district layer now starts switched on.
- **M48** — Officials group as Local, State and Federal everywhere they appear, from one shared derivation, so a growing list stays readable.
- **M49** — The top of the ballot now tells a reader what to actually do: the next election date they can add to a calendar, the registration deadline with the state's own link, and early voting.
- **M52** — The large official card could not open at all on a phone, on either the map or the ballot. Overlays had been pushing browser history and the router was tearing them down as they opened.
- **X04** — Two standing rules written into the constitution: organizations render exactly as they are registered and are never characterized, and every description of a person or organization names where it came from.
- **B12** — Every roll call shows how each party voted. Pure arithmetic over data already held, and the tester's cheapest good idea.
- **M50** — A reader can draw their own picks onto a single phone-width image and screenshot or download it. Entirely on their device; nothing is transmitted.
- **M51** — A batch of copy and truth corrections, including making every reader-facing date a real wall-clock date instead of a session label.
- **A11** — The ask box answered "pothole in front of my house" by naming the public housing authority board. A tie or a zero now refuses instead of answering.

**What it started.** 11 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 8a: the sidebar numbers become doors

The four numbers in the sidebar became doors that open the lists they count.

**What it finished.** 1 row(s).

- **M37** — The four numbers in the sidebar became doors. Each one opens the list it counts.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 8: recorded, not built - the tracker rows

Recorded several things as rows rather than building them, including two Sean deliberately parked.

**What it started.** 6 row(s) opened, 4 still open.

- **R13** — A standing rule rather than a task: the zip playbook only ever gains entries, never loses them, and every depth run ends by stating what it added or that it added nothing. It rides every future session. *(open)*
- **P12** — Showing readers what other readers answered. Sean tabled this: it anchors the next respondent and corrupts the very data being sold. Recorded so nobody builds it by accident. *(open)*
- **D46** — Showing who sponsored and funded each ballot measure. The tester argued both sides and Sean has not decided, so it is parked rather than half-built. *(open)*
- **V07** — A schools and civics-education version of the product, suggested by the tester. A business question rather than product work, parked for Sean. *(open)*

**Needs Sean.** V07

## 2026-08-14 · 7: the mover's page — the questions asked before moving, …

Built the page for people thinking of moving somewhere — taxes, schools, registering, and the rest — answered per state and cited.

**What it finished.** 1 row(s).

- **M36** — The page for people thinking of moving somewhere: curated, cited answers per state to the questions that actually get asked — marijuana, firearms, income tax, vehicle registration, voter registration.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 6: the walk, the verified contact map, and the session do…

Walked the live product, verified every contact route, and wrote the record.

**What it finished.** 4 row(s).

- **D44** — The weekly campaign-finance refresh now refuses to publish a file with substantially less in it than the one before. A shrinking book never ships unnoticed.
- **P11** — A reaction only renders as counted once the server has actually stored it. Before, the button said "counted" whether or not anything landed.
- **A10** — Real phone numbers with cited sources for the everyday things — a pothole, a streetlight, a barking dog — riding the ask box's answers.
- **T09** — The refusal log stores raw typed text and the store is described publicly as identifier-free. Phone numbers, emails and street addresses are stripped before storage, not after.

**Needs Sean.** Nothing.

## 2026-08-14 · 6: meetings — the past has a card, the future goes on you…

Meetings that already happened got their own kind of card, and every upcoming one can be added to a calendar.

**What it finished.** 1 row(s).

- **M35** — Meetings that already happened get their own kind of card — what happened and who to call — and every upcoming meeting can be added to a calendar.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 5: the votes surface — summary open, the No-vote line, at…

The votes surface got its plain-language summary open by default and a line saying what a No vote actually means on that bill.

**What it finished.** 1 row(s).

- **M34** — The votes surface: the plain-language summary open by default, a line saying what a No vote actually means on that bill, and the attribution stated once instead of on every row.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 5: the photo census — 16 of 747, counted by script (D45)

Counted, by script rather than by eye, how many of the people the product renders actually have a photograph. Sixteen of 747.

**What it finished.** 1 row(s).

- **D45** — A script rather than an eyeball counted how many of the people the product renders actually have a photograph. The answer was 16 of 747, and that number is what justified the photo hunts.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 5: the ask box, v1 — routing without generation (A09)

The first ask box: type a question and get routed to the body that can act on it. It generates nothing.

**What it finished.** 1 row(s).

- **A09** — The first ask box: type a question, get routed to the body that can actually act on it. Curated matching, and it generates nothing.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 4: the refusal log scrubs before it stores (T09)

The log of unanswered questions captures raw typed text, so phone numbers, emails and addresses are stripped before storage rather than after.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 4: save my picks — device-local only, said everywhere, en…

Readers can mark how they would vote. It saves on their own device, is never transmitted, and the database is prevented from ever having a column for it.

**What it finished.** 1 row(s).

- **M33** — A reader can mark how they would vote on each contest. It is saved on their own device, never transmitted, and the database is prevented from ever having a column to put it in.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 4: incumbents' ballot cards link their voting record (B10)

Every incumbent's ballot card links straight to their voting record, opening the same full card the map uses.

**What it finished.** 1 row(s).

- **B10** — Every incumbent's ballot card links straight to their voting record, opening the same full card the map uses rather than sending the reader somewhere else.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 3: the everyday-topics map — the pothole standard (A10)

Real phone numbers with cited sources for the everyday things — a pothole, a streetlight, a barking dog.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 3: the copy and UI batch, the author's words verbatim (M3…

A batch of wording and interface changes in Sean's own words, shipped together.

**What it finished.** 8 row(s).

- **M38** — Party shows in its own colour everywhere it renders. The colour states the label and never implies anything else.
- **M41** — "Mark how you'd vote" became "What do you think?", and the disclosure about picks stopped repeating under every contest.
- **M43** — The districts card said 3 and listed 2, because the card counted what was drawn on screen and the list counted what actually governs the reader.
- **M44** — The who-governs card stopped popping open every time the reader panned across an invisible boundary. It opens for a typed zip, which is a request.
- **M45** — Add-to-calendar had shipped on one meeting card only. It now appears on every upcoming meeting anywhere in the product.
- **M39** — The product's own plain-language summaries render in a heavier weight, so the reader can see which words are ours and which are the government's.
- **M40** — The moving-here teaser in the author's exact words, so the invitation reads like a person wrote it.
- **M42** — The government's own official analysis collapses by default, with the plain-language summary open above it. The reader gets the plain version first and the official one on request.

**What it started.** 8 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 3: the audit against the official universe — 211 governme…

Counted what the product covers against the federal Census of Governments rather than against its own list, because a list that defines its own denominator can never be caught missing anything.

**What it finished.** 1 row(s).

- **D38** — Counted what the product covers against the federal Census of Governments rather than against its own list. A list that defines its own denominator can never be caught missing anything.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 2: the FEC snapshot refuses to ship thin (D44)

The weekly campaign-finance refresh now refuses to publish a file with substantially less in it than the one before.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 2: self-funding labeled from the FEC's own typing; the ph…

A candidate lending money to his own campaign stopped rendering as an anonymous organization, and the photo rule tightened to ban logos and banners.

**What it finished.** 3 row(s).

- **D41** — A candidate who lends money to his own campaign was rendering as an anonymous organization donating to him. The federal filing says plainly it is him, and the card now says so too.
- **D42** — A governor's card was serving a campaign wordmark instead of her face. The photo rule now bans logos, banners, screengrabs and any picture where the person is not unmistakably the subject.
- **D43** — Donor names render exactly as filed, in shouting capitals, because that is what the public record says. Deliberate, and recorded so nobody tidies it.

**What it started.** 3 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 2: Sunnyside and Amphitheater wired live — the author's c…

Two Tucson-area school districts serving four zips had nothing at all. Sean spotted it; this session wired them.

**What it finished.** 1 row(s).

- **D39** — Two Tucson-area school districts serving four zips had no bodies, no members and no meetings. They now render fully — the author spotted they were missing.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 2: NH/NJ depth — Kelly cards, the name-case pass, Newbury…

New Hampshire and New Jersey got depth: proper candidate cards, names that stopped shouting, and Newbury's select board explained for somebody who has never been there.

**What it finished.** 3 row(s).

- **M30** — Candidates became cards rather than links: photograph with its source named, their own site's words for the description, published contact details and their official and campaign sites.
- **M32** — Newbury has no mayor — a select board runs the town. The card now says so, with the board's members, instead of leaving a stranger to wonder who is in charge.
- **M31** — A New Jersey clerk files names in capitals, so "Brian ROACH" rendered as shouting. Display-only correction; the filing is untouched.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 1: the author's words — the mission text verbatim, and "s…

The welcome screen took Sean's mission statement in his own words, and the word "sell" was replaced with an accurate description of what happens to the data.

**What it finished.** 1 row(s).

- **M29** — The welcome screen carries the author's mission statement in his own words, and the word "sell" was replaced with an accurate description of what happens to the data.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 1: the FEC replication bug (D40) — the cache key, not the…

Production was showing one senator's campaign finance figures on two other politicians' cards. The cause was a cache keyed on the wrong thing.

**What it finished.** 1 row(s).

- **D40** — Production showed one senator's campaign finance figures on two other politicians' cards. The cause was a cache keyed on the wrong thing, not a bad join.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-14 · 1: FEC funding surfaces, first and whole — D34 built, bot…

Built the campaign-finance surfaces whole, behind named kill switches, so an open legal question can be pulled without a migration.

**What it finished.** 1 row(s).

- **D34** — The campaign-finance surfaces ship behind named kill switches, with every record tagged, so pulling one is a filter rather than a migration.

**Needs Sean.** Nothing.

## 2026-08-14 · 10: the tester pass — four zips, phone width, 74 checks g…

A full pass across the four test zips at phone width, with 74 checks recorded.

**What it finished.** 1 row(s).

- **D37** — Checked every New Hampshire constitutional amendment proposed in 2025 and 2026 against the official record and confirmed none reached the November 2026 ballot. An absence the product earned the right to state.

**Needs Sean.** Nothing.

## 2026-08-13 · Tucson depth: the hunts, their records, and what blocks t…

Went deep on Tucson: which meeting sources exist, which were found, and what stands in the way of the rest.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · The session's documents: state.md §10, tracker closes, CL…

Wrote the record of the deploy-and-demo session.

**What it finished.** 1 row(s).

- **R12** — The deploy now runs the exact command the repository specifies rather than whatever the host guessed, so what builds locally is what builds in production.

**Needs Sean.** Nothing.

## 2026-08-13 · The session's documents: correct-first in CLAUDE.md, the …

Wrote correct-first-fast-second into the constitution as the order of every trade, and recorded the retry rule.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · The live fan-out cannot ship: production reads a committe…

Fetching five vendors live for every visitor would time out and would hammer public bodies' websites. Meetings now come from a committed file.

**What it finished.** 1 row(s).

- **D26** — Meetings are read from a committed file rather than fetched live for each visitor. Live fetching would time out and would hammer public bodies' websites with a request per reader.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · The friction batch: ten production defects under the new …

Ten small defects Sean found in one pass, shipped together under the new rule that reader friction is a defect.

**What it finished.** 1 row(s).

- **M28** — Ten small production defects the author found in one pass, shipped together: directions that opened the wrong app, links that stole the tab, and eight more.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · The cheap corrections: D15 marked, M14 built, GEOID retai…

A batch of cheap corrections, plus three new rows for the things that turned out not to be cheap.

**What it finished.** 2 row(s).

- **D15** — The identifiers the product mints for districts had drifted from the public standard. Since every join runs on those identifiers, nothing could be reliably connected until they matched.
- **M14** — County subdivisions were built and committed but never drawn, because drawing them would have shown some governments twice.

**What it started.** 3 row(s) opened, 1 still open.

- **D23** — Federal law restricts commercial use of individual donor names and addresses. This row records exactly what the restriction covers before any code ships that touches it, so the line is drawn on paper first. *(open)*

**Needs Sean.** D23

## 2026-08-13 · Search logging and the transparency page, together

Search logging and the page describing it shipped in the same commit, so the description could never lag behind what is collected.

**What it finished.** 1 row(s).

- **D30** — Search logging and the transparency page shipped in the same commit, so the page describing what is collected could never be behind what is collected.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · Retire the mock: the composite source serves real meeting…

Mock meetings retired. The product started serving real agendas from real public bodies.

**What it finished.** 5 row(s).

- **D11** — A live spike wiring the agenda source against a handful of real cities, so real agendas appeared on the map before the database existed.
- **D12** — The read API for the first real meetings vendor, replacing the assumption that the site would have to be scraped.
- **D13** — The school-board tier: a single agenda platform used by several thousand boards across the country.
- **D16** — Tucson's meetings run on a different platform from the county's, and the vendor's own portal is off-limits. The records are reached through the City instead.
- **D21** — A municipal platform that publishes real feeds anybody can read. One adapter, thousands of municipalities, and no vendor question at all.

**Needs Sean.** Nothing.

## 2026-08-13 · Restore the officials surface: the exact tier was deletin…

All 537 federal officials and every state legislator vanished at one specific zoom level. Restored and guarded.

**What it finished.** 1 row(s).

- **M23** — All 537 federal officials, the state legislators and the list of governing bodies stopped appearing at one specific zoom level. Found by the author in production, restored and guarded.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · Realign the documents to the reprioritization they record

Brought the documents into line with the decision that four zips are the product.

**What it finished.** 1 row(s).

- **D01** — The first real municipal agenda source, replacing mock meetings. One integration per vendor reaches many cities at once.

**Needs Sean.** Nothing.

## 2026-08-13 · Phone width and the landing state: the demo becomes a demo

The product became usable on a phone and the landing state became something worth showing somebody.

**What it finished.** 2 row(s).

- **X01** — Define the demo. Nobody funds or covers an idea.
- **M22** — The whole product on a phone: the sidebar becomes a slide-over drawer behind a proper touch target. The demo gets opened on a phone.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · P03: reaction capture goes live — the sensor, its stores,…

Reaction capture went live: the one-tap answer, the stores behind it, and the disclosure the reader passes through exactly once.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · Morris and Merrimack wired: the two found sources become …

Two county meeting sources found by hand became working adapters.

**What it finished.** 1 row(s).

- **D27** — Two county meeting sources found by hand and built into adapters — Morris County, New Jersey and Merrimack County, New Hampshire.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · M27: the dead district checkboxes — intent turns the over…

The district-type checkboxes did nothing while the overlay was off, so a reader ticking boxes saw no response.

**What it finished.** 1 row(s).

- **M27** — The district-type checkboxes did nothing when the overlay was switched off, so a reader ticking boxes saw no response at all.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · M26: the narrowing prompt, in the author's words and on t…

When a zip crosses several towns, the reader is asked which one is theirs — a prompt they can decline, in Sean's own wording.

**What it finished.** 1 row(s).

- **M26** — When a zip crosses several towns or districts, the reader is asked which one is theirs — a prompt they can decline, stored on their own device and never sent anywhere.

**Needs Sean.** Nothing.

## 2026-08-13 · M24/M25: Reset all resets everything, and it shows

"Reset all" left filters behind and the count of what was active was wrong. Two faults compounding into one confusing control.

**What it finished.** 2 row(s).

- **M24** — "Reset all" left filters behind, and the count of what was active was wrong. Two separate faults compounding into one confusing control.
- **M25** — There was no way to switch every district type on at once.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · Deploy pipeline pinned; session-start now repairs a stale…

The deploy now runs the exact command the repository specifies, and the start-of-session check repairs a stale development server instead of leaving it running.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · D33: the Arizona and New Hampshire ballots, as filed and …

The first two real ballots landed — Arizona and New Hampshire — rendered exactly as filed and never as advice.

**What it finished.** 1 row(s).

- **D33** — The first two real ballots — Pima County, Arizona and Merrimack County, New Hampshire — behind one contract, so adding a state does not mean rewriting the ballot.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · D32: officials become people you can actually reach

Officials stopped being names and became people with a phone number, a face, and a plain description of what their office does.

**What it finished.** 1 row(s).

- **D32** — Officials became people you can reach: contact details on the card, photographs, plain-language descriptions of what each office does, and a verified campaign link.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · D28/D29: the curated overlay — division-less bodies and o…

A city has many boards rather than one, and some governments have no mapped district at all. Both got a way to be represented.

**What it finished.** 1 row(s).

- **D28** — Special districts and community college boards that the Census does not enumerate needed identifiers before they could be wired. Pima Community College's board was one wiring row from live.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · D25: how to actually be heard, curated per body and rende…

For each body: whether there is a public comment period, when it falls, and how to be heard at it.

**What it started.** 1 row(s) opened, 1 still open.

- **D25** — For every body the product watches: whether there is a public comment period, when it falls, how to sign up, where to send something in writing, and how long anybody gets to speak. The difference between knowing a meeting exists and being able to be heard at it. *(open)*

**Needs Sean.** Nothing.

## 2026-08-13 · D17: split the gating — the statute renders now, diligenc…

New Hampshire does not require an agenda at all, so a missing one there is lawful rather than a hole in the product's coverage.

**What it finished.** 1 row(s).

- **D17** — New Hampshire does not require an agenda at all, so a missing agenda there is lawful rather than a hole in the product's coverage. The wording has to say which.

**Needs Sean.** Nothing.

## 2026-08-13 · D10: the persistence schema lands, with the vintage column

The database design for meetings landed, including the column recording which boundary vintage a record was resolved against.

**What it finished.** 1 row(s).

- **D10** — The database design for meetings — tables, a migration, and a rule for what happens when the same meeting arrives twice.

**Needs Sean.** Nothing.

## 2026-08-13 · D02: how my rep actually voted — the roll calls land as a…

Federal roll-call votes landed, read from the House and Senate clerks' own published records.

**What it finished.** 1 row(s).

- **D02** — Federal roll-call votes, read from the House and Senate clerks' own published records rather than scraped from a website.

**Needs Sean.** Nothing.

## 2026-08-13 · A08: the routing knowledge base — who can act, cited, par…

A curated, cited map of which kind of official can actually act on which kind of problem — built before any chat interface, so the routing is knowledge rather than guesswork.

**What it finished.** 1 row(s).

- **A08** — A curated, cited map of which kind of official can actually act on which kind of problem, built before any chat interface so the routing is knowledge rather than guesswork.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-13 · 7: the session's documents — §14, the ripcord doctrine, t…

Wrote the record, including the doctrine that a feature with an open legal question ships behind a named kill switch or not at all.

**What it started.** 3 row(s) opened, 1 still open.

- **D36** — Twenty-seven candidates whose website and contact hunts were written down as never attempted. Each one finished is a candidate who stops being a name with nothing beside it. *(open)*

**Needs Sean.** Nothing.

## 2026-08-13 · 7: the session's documents — §13, the rung set, the rows,…

Wrote the record, including the retrieval rungs discovered that day.

**What it finished.** 1 row(s).

- **M05** — Click a district or a pin and get a consistent card: who represents you there, what was recently decided, and what is coming up.

**Needs Sean.** Nothing.

## 2026-08-12 · Write git-state.txt into the mirror

A generated file in the shared drive recording where the repository stood at handoff, so a conversation with no checkout can still see it.

**What it finished.** 1 row(s).

- **R09** — A generated file in the shared drive recording where the repository stood at handoff, so a conversation with no checkout can still see it.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Tell every reader in the country who represents them in C…

Every reader in the country can see who represents them in Congress, not only readers in the four test zips.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Say what coverage means on screen, and stop counting 32 g…

The screen started saying what coverage actually means, and 32 governments stopped being counted twice.

**What it finished.** 1 row(s).

- **M16** — An empty map becomes an honest statement: this area has a governing board and the product does not have its calendar yet.

**What it started.** 3 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Replace the entry notice with the welcome overlay

The entry screen became a welcome card over a dimmed map, with quick-jump zips and a use-my-location option.

**What it finished.** 1 row(s).

- **M11** — The entry screen became a welcome card over a dimmed map, with quick-jump zips and a use-my-location option.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Read Pima County's meetings from the Legistar API, and wr…

The first real municipal agenda source, plus a written record of what each vendor's terms actually say.

**What it finished.** 1 row(s).

- **D14** — One written paragraph per vendor recording what its terms actually say. A record for choosing routes, deliberately not a gate that blocks retrieval.

**What it started.** 4 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Port the popup card and the full-screen modal, and pool t…

The popup card and the full-screen card landed, and map markers started being reused instead of rebuilt on every change.

**What it finished.** 1 row(s).

- **M20** — Map markers are created once and reused as filters change, rather than the whole set being torn down and rebuilt.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Let Census resolve the duplicate: FUNCSTAT, joined from T…

Let the Census's own data decide which of two overlapping map layers describes a real government, rather than guessing by name.

**What it finished.** 1 row(s).

- **M17** — 32 of 153 municipal bodies were the same government counted twice, because two federal map layers both describe it.

**What it started.** 1 row(s) opened, 1 still open.

- **M18** — A city and county that merged into one government still render as two bodies with two councils. A reader sees their single local government twice. *(open)*

**Needs Sean.** Nothing.

## 2026-08-12 · Give every meeting somewhere to click, and record who act…

Every meeting got somewhere to click through to, and the product started recording what was searched.

**What it finished.** 1 row(s).

- **M21** — Every meeting gets somewhere to click, and a body nobody has looked at stops being indistinguishable from one that was searched and found empty.

**What it started.** 3 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Fix the four defects found testing the Phase 4 build

Four defects found by actually testing the build rather than reading it.

**What it started.** 6 row(s) opened, 2 still open.

- **M13** — The radius control broke twice — once blanking results, once refusing to switch off — and both times the tests only covered the logic underneath, not the control a reader touches. *(open)*
- **B09** — The question to put to counsel: can a software vendor's terms of use narrow the public's statutory right to records a government body is required to publish? The product's whole retrieval posture rests on the answer being no. *(open)*

**Needs Sean.** B09

## 2026-08-12 · Fast-forward local main after shipping, and push -u when …

The ship command stopped leaving the local repository a whole session behind, which had made the project look empty on the next checkout.

**What it finished.** 1 row(s).

- **R07** — The ship command merged the pull request and left the local repository a whole session behind, which made the project look empty on the next checkout.

**Needs Sean.** Nothing.

## 2026-08-12 · Check the three things that lie quietly, and stop the dev…

Three start-of-session checks for the things that fail silently, and a development server that can actually be stopped.

**What it finished.** 1 row(s).

- **R10** — Three checks at the start of every session and a development server that can actually be stopped, so a stale checkout cannot pass for a working one.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Build the boundary data Phase 4.6's derivation rule needs

Built the boundary data needed to work out which governing bodies sit inside which district.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Bring state.md and the tracker current through Phase 4.6

Brought the state document and the tracker current with what had actually shipped.

**What it finished.** 1 row(s).

- **M15** — The join that did not exist: which governing bodies sit inside which district. Generated from the boundary files rather than hand-written.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-12 · Add seven district overlays and click-to-select

Seven kinds of district boundary became layers on the map, each one clickable.

**What it finished.** 2 row(s).

- **M02** — A zip crosses district lines, so after a zip is typed the reader is shown the districts that overlap it and picks the one they actually live in.
- **M04** — The same boundary treatment for state house and senate districts, council wards and school board zones, each a layer the reader can toggle.

**Needs Sean.** Nothing.

## 2026-08-11 · Port the EdiaStratMap application shell

The application shell — sidebar, scope selectors, stats, search, filters and legend.

**What it finished.** 1 row(s).

- **M10** — The application shell — sidebar, scope selectors, stats, search with autocomplete, radius and near-me controls, filters and legend.

**What it started.** 1 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-11 · Fix the MapLibre worker and port the EdiaStratMap design …

The map's rendering worker failed to load, so no map tiles were ever fetched. Fixed, and the whole visual system landed with it.

**What it finished.** 4 row(s).

- **M08** — The map's rendering worker failed to load, so no map tiles were ever fetched. Without this fix there is no map.
- **M09** — The whole visual system — colours, typefaces, and a light/dark theme that remembers what the reader chose.
- **R06** — Headless screenshot capture of the running app, so visual checks do not depend on somebody having a browser window open.
- **R04** — The README described a map setup that was not what actually ran.

**What it started.** 2 row(s) opened, 0 still open.


**Needs Sean.** Nothing.

## 2026-08-11 · Add national congressional district overlay

The first session. The map, the tracker, and congressional district boundaries over the whole country.

**What it finished.** 5 row(s).

- **D09** — The full table of zip centre points. Before it, most real zips reported as not covered; after it, the map can zoom to any zip in the country.
- **M01** — The first build of the map: type a zip, the map flies there, and upcoming public meetings appear as pins.
- **M06** — Every upcoming meeting links out to its own agenda where one exists. Never a dead end.
- **M03** — Congressional district boundaries as a layer the reader can switch on over the map.
- **R03** — Nothing is marked done without the branch and which checks passed. An agent grading its own homework drifts optimistic.

**What it started.** 68 row(s) opened, 39 still open.

- **B01** — The product is called Meanwhile on screen while the real name is decided. Nothing a reader sees changes until Sean settles it; when he does, one file changes and the whole site follows. *(open)*
- **C01** — A sample of what a buyer actually receives: one Pima County measure broken into its provisions, with support per provision and counts by how well each answer was verified. Synthetic numbers, clearly labelled, built to show rather than to sell. *(open)*
- **D07** — Turning a street address into the exact set of districts a person votes in. Without it the product can orient a reader by zip but cannot promise them their own ballot. *(open)*
- **V01** — Five conversations with the people who would buy the data — campaign consultants, party data staff, PAC data directors, at least one on each side. The question to put to them is exclusivity. *(open)*
- **V03** — Build a throwaway prototype against three to five cities' agenda systems and find out whether the local-meetings thesis holds. If those systems are locked down or wildly inconsistent, the product changes shape. *(open)*
- **V05** — A short, sharp answer to the buyer who asks why this beats a thirty-thousand-dollar tracking poll. Needed before the first meeting, not after it. *(open)*
- **B05** — Two lawyers, probably: one on privacy and one on election law. Both have long lead times and several other rows are waiting on them. *(open)*
- **D05** — Everything the product can say about a candidate from their own site, their own filings and their own voting record. Never an endorsement list — that is somebody else's judgement about them. *(open)*
- **D08** — Pick the source that says which contests are on which ballot. The commercial-use terms are the first question to ask, because they decide whether the answer can ship. *(open)*
- **T01** — The page that says, in plain words, what the product collects, how it is used, and that anonymous totals may be sold. Written before any marketing page, because the marketing has to be true. *(open)*
- **V04** — Take one real Pima County down-ballot race and build the full side-by-side of sourced positions and the reader's own priorities. The test of whether the sourcing actually holds up end to end. *(open)*
- **V06** — Read the plain-language output back to real people with real questions and find out whether it is actually plain. Synthetic test questions cannot tell you that. *(open)*
- **B02** — A trademark search in the three classes this product would file under. Cannot usefully happen until the name is settled. *(open)*
- **B03** — What legal entity this becomes. An LLC now and a public benefit corporation after the buyer calls, rather than a plain C-corp. *(open)*
- **D03** — State legislators' voting records, all fifty states, from Plural Open. Today a state legislator's card can say who they are but not how they voted. *(open)*
- **D06** — Where a candidate's money comes from — top sources, how concentrated it is, and how much came from inside the district they want to represent. *(open)*
- **P02** — Mapping candidates' stated positions onto the issues on a reader's ballot, every one carrying its source. Never a score, never a ranking — the positions side by side and the reader deciding. *(open)*
- **P03** — The one-tap yes or no, with an optional free-text answer, asked after the explanation and attached to a specific provision or a specific sourced position. This is the revenue path. *(open)*
- **B07** — How to price this. Selling to a campaign below fair market value can count as an in-kind political contribution, so the prices have to be real and documented, pilots included. *(open)*
- **P05** — Tell a reader when an official they follow votes on something. *(open)*
- **T03** — A security review before a single real person's political opinions are stored. A breach ends the product. *(open)*
- **T05** — The abuse policy is written but the review path behind it does not exist. No free-text answer can be accepted until somebody can actually act on a threat. *(open)*
- **B04** — Registering as a data broker in California, Vermont, Texas and Oregon. Annual deadlines with per-day penalties for missing them. *(open)*
- **P04** — Turning individual answers into a number a buyer can trust: weighting by how much the person actually read, freezing each snapshot so it can never be quietly amended, and reporting on every export how well each answer was verified. *(open)*
- **T02** — Proving a real person is answering without learning who they are — device attestation, a phone check that rejects burner numbers, an address that exists. Weighted rather than gated, so nobody is turned away. *(open)*
- **D04** — How your own city council voted. It sits in unstructured minutes nobody has parsed, which is exactly why it is worth doing and why nobody else has. *(open)*
- **P06** — One tap to send a letter when a representative votes against a position the reader cared about. Public contact details only — delivery, not lobbying. *(open)*
- **P07** — Tell a reader what happened at the hearing they could not attend: passed, failed, or held over. *(open)*
- **P10** — Build the product for a second metro so the demo is not only Tucson. *(open)*
- **X02** — Five content creators on Instagram. The cheapest distribution channel available to a product nobody has heard of. *(open)*
- **X03** — A podcast pitch, shorter and more specific than feels comfortable. *(open)*
- **A03** — Answering "is there a data center coming?" by searching pending zoning, permits and agenda items near an address. The same machinery answers warehouses, rezonings and road projects. *(open)*
- **T06** — Grade a hundred real answers by hand against the verification tiers before any automatic classifier touches them. The hand pass is what tells you whether the tiers mean anything. *(open)*
- **T07** — The abuse policy points at a file of escalation contacts that does not exist — local police, the state agency per state, the Capitol Police threat unit. A policy pointing at nothing cannot be followed. *(open)*
- **C02** — The commercial front end: buyers log in and see signal by district, race, measure and provision, over time, with the ability to filter, drill down and export. *(open)*
- **C03** — The actual file or API a buyer receives — its schema, the confidence-mix figures on every row, how much was excluded by moderation, and the snapshot id that makes it citable. *(open)*
- **C04** — Publish what the signal predicted before each election and how it actually turned out. A public scoreboard, including the misses. *(open)*
- **P08** — After a decision, tell the reader how long they have to appeal it and how. *(open)*
- **P09** — A different product for people deciding where to live: pending development, zoning and state-by-state requirements near an address they are considering. A real market, and not this one. *(open)*

**Needs Sean.** B01, C01, V01, V03, V05, B05, T01, V04, V06, B02, B03, B07, T03, T05, B04, T02, X02, X03, T06, T07, C02, C03, C04

## NHHUNT

**What it started.** 9 row(s) opened, 7 still open.

- **NH02** — Newbury's own site lists a Parks and Recreation Committee and a Housing Committee in its sitemap, and both pages ask for a password. They are real committees the town has not published. We never sign in to anything, so their membership and meetings have to come from somewhere else. *(open)*
- **NH03** — The town's own pages state terms ending 2021, 2022 and 2023 for its Cemetery Trustees, and March 2021 for one Planning Board alternate. Those are the town's current published words and they are up to five years out of date. We render them as published, which is honest, and a reader may still be looking at people who left. *(open)*
- **NH04** — We now hold all three county commissioners, the delegation's officers and every department head by name. What the county publishes for reaching any of them is one main number. The Kelly standard asks for a working contact per person and the county does not print one. *(open)*
- **NH05** — Ten Newbury boards now read their meetings off the town's own calendar, and the town has not posted a single upcoming date for any of them. Seventy-eight of their past sittings are on that calendar, so they do meet. A reader who wants to attend one cannot find out when from anything the town publishes. *(open)*
- **NH06** — Newbury's Selectboard and its three land-use boards are now read from two places at once: the vendor portals that carry agendas, and the town calendar that carries more dates. A merge decides which row a reader sees. That works, and nobody has measured whether it is the right arrangement over a few refreshes. *(open)*
- **NH07** — Merrimack County's department pages all load cleanly and all of them list their staff in a table our reader cannot understand. It is a different table shape from the one we built for. Nobody has looked at how many other counties use it. *(open)*
- **NH08** — The Town of Newbury publishes its whole calendar as a feed nobody had wired, and it has more meeting dates on it than the portals we were using. Both now ship, and when they both carry the same meeting the site shows the one with the agenda attached. That is a change to what you see at 03255 and it is worth a look. *(open)*

**Needs Sean.** NH08
