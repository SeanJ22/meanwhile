# The tracker — what is left

**GENERATED FILE — do not hand-edit.** Written by `corepack pnpm tracker:views`
(`scripts/tracker.mjs`) from `docs/tracker-working.csv`. It cannot disagree with the
store, because it is derived from it.

Generated 2026-09-01 (America/Phoenix, from `pnpm stamp`).

Open rows only. Finished work is in `docs/tracker-resolved.csv` and on the
**Resolved** tab of `docs/tracker.xlsx`, which is the record of what was decided
and when. Nothing is ever deleted.

---

## Where the project stands

- **378 open**, 476 resolved.
- **69 waiting on Sean** — the first section below.
- P1 by section:
  - Needs Sean — **2**
  - New Hampshire hunt — **2**
  - New Jersey hunt — **1**
  - Arizona hunt — **2**
  - Visual feedback — **3**
  - Data infrastructure — **3**
  - Product / UI — **3**
  - Constitution & rules — **1**
  - Repo & ops — **6** · **OVER THE FIVE-ROW CAP: THIS SECTION IS STOPPED**

**1 section(s) over the cap.** A section over five P1 rows is STOPPED, and that is reported as a fact. Nothing is relabelled to fit — a demotion changes the label and not the situation.

---

## Needs Sean

Anything only Sean can unblock: an API key, a legal review, a business decision, a visual judgment, and specifically go look at the site and confirm this is right.

**69 open · 70 resolved.**

Only Sean closes a row here. A session may open one and may work it.

### P1

**NH108** — The questionnaire instrument is built and 272 invitations are generated, every one with invitedOn null, so nothing has been sent to anybody. The page a candidate types into is buildable and is NH104. SENDING is not a build, it is four decisions, and they are all yours: (1) the sending DOMAIN this goes out from, because a civic questionnaire arriving from a generic address is the one a campaign deletes; (2) an email PROVIDER CREDENTIAL, which this project does not hold and cannot obtain on your behalf; (3) DELIVERABILITY WARM-UP, because 272 near-simultaneous messages from a cold domain is the textbook shape of a spam classification, and being classified once is close to unrecoverable; and (4) WHETHER THE INVITATION GOES OUT BEFORE OR AFTER 3 NOVEMBER 2026, which is a judgement about the election and not a technical question at all. Raised as ONE row on purpose so you can rule once rather than in four pieces, and so a session cannot start building a send path on the strength of having answered one of them.

**T05** — The abuse policy is written but the review path behind it does not exist. No free-text answer can be accepted until somebody can actually act on a threat.

  Waiting on reaction capture (P03).

  Pending review.

### P2

**B01** — The product is called Meanwhile on screen while the real name is decided. Nothing a reader sees changes until Sean settles it; when he does, one file changes and the whole site follows.

**NH105** — Opened 2026-08-23. The instrument is built and the invitation list is generated - 272 of 272 Morris County candidacies, every row carrying invitedOn: null because nothing has been sent. The message is docs/candidate-questionnaire-invitation.md, quoted in full, plus a reminder message. FOUR THINGS ARE YOURS AND NONE OF THEM IS A SESSION'S CALL: (1) the message itself - it goes out under this product's name to 272 named people asking for votes; (2) a monitored reply address a person actually reads, which the message promises three times and which does not exist yet; (3) the schedule - one send date, two reminder dates and a deadline, which are constants at the top of scripts/questionnaire-invitations.mts and are quoted in full in that file and in data/questionnaire/invitations-nj-morris-2026.json; one edit moves all 272 symmetrically; (4) whether sparkwtp.netlify.app comes off its password wall first, because a candidate following the link today hits a password prompt. RULING 112 governs everything about the instrument itself; this row is only the decision to contact real people.

**NH165** — Rule 4 of your BC-11 ruling is built: nothing typed into Speak Your Mind is ever auto-forwarded, and content the triage reads as a threat or as menacing is stored with review_state HELD and excluded from everything. What does not exist is the surface where you READ that queue and act on it - which is exactly what T05 says about the abuse policy generally. This row links the two: the HOLD half now has a concrete first surface, and the REVIEW half is still yours to unblock. T05 stays open and only you close it. The tiers are docs/abuse-policy.md's own T1/T2/T3, not new ones, and the rules that decide are lib/speak/triage.ts with the harsh-political-speech cases planted in the test so over-filtering fails the build.

**NH174** — pnpm door2 walked all 19 candidacies on the 07866 ballot who are people this repo already records sitting on a governing body — the class your 8/24 ruling pre-approves — at the MEMBER'S OWN page rather than the body's index, which was NJ13's defect. 19 of 19 pages answered, 0 walls. Six portraits found, four of them new: Jennifer Rowland (Chatham Township), Russell Goodwin and Michael Dominianni (Chester Borough), Sean Mabey (Kinnelon), Kyle Russell and Melissa Florance-Lynch (Pequannock). Each is name-matched on the person's own municipal .gov page, read as an img element and never an og:image. ZERO shipped, which is the rule for a candidate portrait and is not something a hunt gets to decide. The queue is data/photos/door2-incumbents-2026-08-25.json. Two phones from the same walk DID ship — Nancy Verga and Melissa Fostle — because a number a town publishes beside a named member is a fact checkable by dialling it, where a portrait's failure mode is a wrong face beside a real name.

**NH208** — CORRECTED TWICE, and both corrections are recorded rather than left standing. NOTHING IS WRONG WITH YOUR RULESET and no setting needs changing — the row's title still says otherwise because the amend tool deliberately cannot edit a title, so read this instead of it. Both PRs this session merged on green required checks with no override, no admin flag and no auto-merge. What actually happened is that GitHub Actions was running badly behind on this repository for about two hours on 2026-08-26. Observed across four separate events: PR 191 opening created NO GitHub Actions check suite at all (only a Claude-app and a Netlify-app suite, both sitting queued with zero runs); closing and reopening it created none either; a push to the branch fired one but GitHub queued it against the PREVIOUS head SHA, so the current head still had nothing; and the push events onto main for both f6ef545 and 343ca7e registered nothing for roughly twenty-five minutes each, so pnpm main:green read CANNOT TELL through six minutes of polling on a commit that was in fact fine. Meanwhile every workflow_dispatch started within seconds. Everything else was ruled out: Actions enabled, all nine workflows active, the token carrying workflow scope, and the commits attributed to SeanJ22. The delayed runs did all eventually arrive and go green, and each merge unblocked on its own once they did. THE SECOND FINDING, and it is ours rather than GitHub's: dispatching build-check to work around the lag is not free. build-check carries concurrency cancel-in-progress on the ref, so a dispatch racing a late event-run CANCELS one of them — and pnpm main:green counts every check-run on the commit rather than the latest per context name, so it reported main 343ca7e as RED with two cancelled checks while GitHub's own filter=latest view showed all three required contexts SUCCESS from the newer run. Branch protection uses the latest per name, so main was genuinely green the whole time and the alarm was ours. An instrument that cries wolf on a superseded run is the thing RULING 115 warns about, and RULING 75's whole value is that main:green can be trusted. THE QUESTION: (a) fix main:green to judge the LATEST check-run per context name, matching what branch protection actually evaluates — small, and it removes a false RED that will recur every time anyone dispatches a check by hand; (b) leave it strict and accept that a hand-dispatched check can produce a false RED; (c) also keep this row open as a watch on the GitHub-side lag until two more session PRs open cleanly. Recommended: (a) and (c).

**NH212** — The guard asserted fallenOutOfServing === 0. The serving window looks back 90 days, so a row falls out when its start sits between generatedAt-90d and now-90d - a band exactly as wide as the snapshot's own age. 447 rows over 90 days is about five a day, so one day of age is worth roughly five crossings. On 2026-08-26 it went red at 1 of 447 with the snapshot 0.07 days old, one hour and forty minutes after refresh-daily run 33005902616 landed GREEN. Nothing had stopped landing; a meeting had concluded and aged past ninety days. That is RULING 116's shape - a guard pinning the size of a gap time creates - and RULING 115's cost, an alarm firing on the normal operating state. I moved the assertion to the snapshot's AGE (two days: the daily cadence plus one missed run), which is what FROZEN means and what this row was about, and kept the crossing count reported beside it plus a second assertion that the shedding is explicable by that age. The detector is untouched and the constructed-crossing test still proves it catches one. QUESTION: keep the age-based assertion, or do you want the stricter zero-crossing reading back with the daily refresh cadence tightened to match it?

**NH225** — Arizona's Department of Revenue website tells eight named AI crawlers to stay out, and ClaudeBot is one of them. It allows every other visitor. This product's reader identifies itself by its own name and a contact address, so the rule that applies to it is the allow-everyone rule. That is what the robots standard says, and it is also a judgement call, so it is yours rather than a session's.

**NH246** — A tester reported that privacy and what-the-site-collects information was not easy to find. Inspecting the product: the information is NOT missing. /transparency is a 470-line page with nine sections — What is collected, What is not collected, Reactions to votes and candidates, Campaign money, Photographs of officials, Speak Your Mind, What happens to the data, What this site will never do, Feedback — and it is linked from the entry screen. The defect is DISCOVERABILITY, not content: on the entry screen the link sits in components/map/site-footnote.tsx at 0.625rem (10px) in muted colour, alongside Feedback, and is the smallest text on the page. It is also linked from /ballot, /feedback, /about-area, the welcome overlay and the reaction control, all at similar weight. So the proposal is a short plain-language summary at the TOP of a long page, plus a heavier entry point — NOT a rewrite of the disclosure, which is thorough and accurate. NOTHING BELOW IS SHIPPED AND NO USER-FACING PRIVACY UI HAS BEEN CHANGED. Needs Sean's review, edit and approval before any of it becomes reader-visible. PROPOSED SUMMARY BLOCK, to sit directly under the existing h1 'What this site collects, and what it doesn't' — every line checked against the code, and nothing promised that the code does not already do: (1) 'You never need an account to read anything here. If you make one, it is an email address and a magic link — there is no password and no social login.' [Auth.js, email magic link only, per CLAUDE.md Stack.] (2) 'We ask for a zip or an address to work out which districts you are in. An address you type is sent to the Census Bureau's geocoder to turn it into a point, and we do not keep it. Your zip is kept in your browser for the session, not on our servers as yours.' [app/api/geocode is a stateless Census proxy and is POST specifically so an address never lands in a URL or an access log; wtp.approximate_location is sessionStorage.] (3) 'Using the map writes an anonymous row: what kind of thing happened, roughly where — the zip you entered and the districts it touched — and the date. No name, no account, no IP address, no cookie that follows you.' [search_log columns: occurredAt, eventType, approximateLocation, ocdIds, divisionVintage, detail. There is no IP column.] (4) 'When you react to a vote, a candidate or part of a ballot measure, we store the reaction and a random key your browser invented so you can change your mind later. The key is stored only as a hash, it links your own reactions to each other and to nothing else, and clearing your browser storage just means older reactions can no longer be edited.' [reactions.reactionKeyHash, wtp.reaction_key in localStorage, disclosed in these terms already.] (5) 'Reactions are never shown back to anyone — not to you, not to other readers, not as a total on a page.' [CLAUDE.md: no user-to-user surface; write-only from the reader's perspective.] (6) 'Anonymous totals are sold to political organisations. That is how the site is free. Individual rows are not sold and the stores are built so they cannot be joined back to a person.' [The n-stores rule; tests/db-schema.test.ts proves no shared value space.] (7) 'Feedback you send is read by a person, is scrubbed of anything that looks like a phone number, an email or an address before it is stored, carries no key at all, and enters no total we sell. It is one-way — we cannot write back.' [feedback table: no continuity key, no zip, no IP, no email; scrubbed via lib/log/scrub.ts at the single write path.] PROPOSED PLACEMENT AND DISCOVERABILITY, for Sean to accept or reject: (a) put the seven lines above at the top of /transparency under the existing heading, so a reader gets the whole answer in fifteen seconds and the detail stays below it; (b) raise the entry-screen link out of 10px muted — same words, 'What this site collects', at body size, since reader friction is a defect but this is one of the three named exceptions and consent-adjacent text is allowed to be prominent; (c) consider a persistent footer entry on the ballot and body surfaces, which are where a reader has just been asked for the most. OPEN QUESTIONS FOR SEAN: whether 'sold' is the word he wants in a summary line, whether the summary should name the buyer class at all, and whether retention should be stated — the code today auto-deletes nothing except intake_limiter rows after 48 hours, and saying 'we keep it indefinitely' is true but is a bigger statement than the page currently makes.

**NH274** — Arizona publishes 151 Governor's letters explaining why bills were signed or vetoed. They are scanned images rather than text, so reading them needs OCR, and the OCR tool cannot install itself without an elevation prompt.

**NH275** — The branch retirement sweep classified 143 remote branches and could prove 135 of them content-shipped. This one it could not. It holds a single commit from 2026-08-18, 'AUD-03 measurement: the eight pre-registered surfaces behind async boundaries', which changes map-entry.tsx by +52/-8. No pull request ever named it, it is not an ancestor of any merged integration head, and a trial merge is not a no-op. It is genuinely unshipped work, and the only person who can say whether it is still wanted is the author.

**NH277** — The Legistar union now carries a truthful PUBLISHED_BUT_UNPLACED_BY_US disposition: a first-party route publishes a sitting, the meeting-producing route did not carry it, and we hold it without being able to place it. Discharging that obligation needs one of two things this session may not decide alone — promoting the RSS or the clerk schedule from corroboration to an ingestion source, which CLAUDE.md lists under Ask before as adding an external source; or composing a meeting from fields spread across routes, which needs SittingRoute in lib/sources/event-identity.ts to be able to name CLERK_SCHEDULE_PAGE at all.

**NH282** — The control plane can now survive a worker dying: leases expire, a dead Attempt is observed from outside, the route returns to the pool, another process resumes from durable state, and a crash between two writes is finished by a recovery pass. All of that is proven by tests. What does not exist is anything that RUNS the loop when nobody is watching. A workflow driver is the thing that wakes up, claims what is claimable, renews what it holds and reclaims what died. This repository has GitHub Actions and three workflows permitted to hold a cron, and an outside scheduler would be invisible to every guard the repo has, so the choice is yours rather than a session's. Nothing downstream is blocked except unattended operation itself - every rule, every refusal and the shadow proving run all work today when a person or a test starts them.

**NH283** — When a captured public page carries a live third-party credential - which is not hypothetical, it is what PR #216 hit on Pima County's own Clerk of the Board page - the exact bytes are kept but quarantined, and only a sanitized copy reaches any parser. Those quarantined bytes currently cannot be stored durably, because the only two places this repository can write are a PUBLIC GitHub asset store and a plain folder on disk, and neither offers encryption at rest or access control. The tier was deliberately NOT weakened to fit what is available: that would put a working credential somewhere it can be read, which is the original incident one layer down. Ordinary evidence is fully durable already; this is only about the quarantined tier.

**NH287** — 16 of the 20 speculative Pima routes carry a recorded outcome with jurisdiction 'az'. Several of those walks were actually against school districts and water districts, not the county. Promoting a route to REQUIRED on that evidence would let a school-district technique become a required county route on the strength of 'somewhere in Arizona'. The route-floor repair therefore deliberately did NOT implement an OBSERVED_HERE proof kind, and 0 method routes are currently REQUIRED for Pima.

**NH299** — docs/Meanwhile-Owner-Checklist.xlsx holds three rows with Status CONFIRMED — EX, F1 and F5 — of which EX is the workbook's own documented example row. So the answer key is two facts, both known_present. The Adversarial questions tab has Keep? blank on all twelve rows, so zero questions load. The READER contract therefore reads AWAITING_OWNER_DATA and TRUTH cannot score a false-presence rate for want of a known_absence denominator.

**NH43** — RULING 60's residual. NH Hunt 5 hand-worked every un-held unit at 03255 and holds 48 of 48. Three bodies inside those units were reached by nothing, and each is listed below with every branch already walked and what each returned. The ruling asks you to hunt one or two yourself and return the process, which then gets built as a branch the same way the six in zip-playbook.md section 8 were.

**NS01** — The Meta Ad Library is the single best compliant route to a campaign that lives on Facebook, and it is the one route in the manifest that this project cannot walk at all. Political-ad disclosure is mandatory by law, so any candidate who buys a single ad appears there with the campaign's website, its paid-for-by disclaimer and often a contact. The API refuses every unauthenticated request (graph.facebook.com/ads_archive answers HTTP 500 OAuthException), and the public Ad Library web pages answer HTTP 403 with an anti-automation challenge. Measured 2026-08-22 for all sixteen Merrimack County candidates: ad-library REFUSED 16 of 16, and that refusal is recorded as a refusal rather than an absence, so no candidate field moved toward exhaustion on it. A token is issued against an identity-verified Meta developer account, which means it is tied to a real person and to that person's acceptance of Meta's platform terms. That is a standing commitment to a third party and a legal question wearing an API key, which CLAUDE.md lists as an ask-before. It is also the reason no session may make it: RULING 12 says a wall like Facebook's is named and not defeated, and authenticated access risks the account it runs under. This row exists so the decision is documented and yours, with counsel's read, rather than made quietly inside a session. NOTHING is blocked on it — the other three RULING 66 routes are built and walked, and the answer may simply be no.

**NS12** — RULING 125 moves every walk onto the local production build and leaves exactly one question that needs Netlify: which SHA is live. pnpm deploy:live reads it from Netlify's deploy API in one call with zero requests to the site. There is no NETLIFY_AUTH_TOKEN in .env.local and the Netlify CLI config on this machine holds no user, so the tool correctly reports CANNOT-TELL and exits 3 rather than passing. A Personal Access Token from Netlify (User settings, Applications, Personal access tokens) added to .env.local as NETLIFY_AUTH_TOKEN closes it.

**NS13** — RULING 124 item 5 makes pnpm closeout REFUSE a separate push to main, per Sean's instruction that records ship inside the PR or not at all. CLAUDE.md's merge-cadence rule permits separate close-out commits for a stated reason: a document cannot name the commit that contains it. Most of that reason is now gone — RULING 125 moves walks onto a local build, so the walk numbers ARE knowable before the ship. What remains genuinely unknowable in advance is the deploy SHA. This session's position: that is an operational fact read from Netlify's deploy record afterwards and it does not need to live in a commit at all. If Sean disagrees, the merge-cadence rule needs amending rather than the tool.

**NS14** — Your brief said to read VOTE411's terms from its own site before extracting anything and to treat it as restricted until the terms say otherwise. There are no terms. Read 2026-08-24: /terms-use, /terms-of-use and /privacy-policy are all HTTP 404 on vote411.org, lwv.org/terms-use is HTTP 404, and neither the homepage nor its footer links a terms document — the only assertion anywhere is the footer's copyright notice. Its robots.txt permits crawling everything except admin, user and search paths, but a crawl permission is not a licence. So nothing was extracted and it stays RESTRICTED. The judgement that is yours: an absent terms document is not a permissive one, and VOTE411 is a nonprofit's compilation about public records rather than a government publication — the same question RULING 70 asks of Ballotpedia and RULING 93 asks of usmayors.org. If you want it walked, say so and it will be.

**NS16** — The brief for 2026-08-25 names docs/feedback/we-the-people-feedback-2026-08-25.md as AUTHORITATIVE and says its carryover table is law. That file is not in the repo, not in the Drive mirror root, and not in the Drive screenshots folder — searched all three at session start. The 17 captures ARE committed and were read; only the document is missing. The same is true of the 8/24 document: the LAY, BC, WGH and ASK ids exist in briefs and commit messages and in no committed file, so a session cannot check an id against anything. RULING 108 is exactly this: anything a session must read at session start lives in the repo, because a session has a shell and a clone. This session worked from the brief's prose plus the captures and says so rather than pretending it had the document. THE QUESTION: would you rather (a) paste the feedback doc into docs/feedback/<date>/ as part of each walkthrough, so a session can diff its ids against something, or (b) keep it in chat and accept that ids are only ever as good as the brief that quotes them? If (a), it is one paste and nothing else changes.

**NS22** — The reader-answerability suite (RULING 210) shipped this session and runs today with an honest zero state: '0 questions loaded — awaiting owner corpus'. It evaluates YOUR questions against the rendered DOM of the four pilot ZIPs (85701, 85641, 07866, 03255) and turns every red into a typed diagnostic WorkItem. What it cannot do is invent the corpus: the questions are the owner's definition of what a reader must be able to learn, and a session writing them would be grading its own homework. Templates like 'When does [BODY] meet next?' instantiate mechanically from the registry; hand-authored adversarial literals are a distinct class that guards against an incorrectly small generated universe. The file is data/health/reader-questions.json; the schema is lib/health/reader-question.ts; 'pnpm reader:suite' shows the zero state. THE QUESTION: how do you want to author the corpus? Options: (a) you write questions in plain language (a sentence each is enough) and a session formalizes them into the schema for your review; (b) a session drafts a candidate corpus and you strike, amend and approve each question; (c) you dictate a handful of seed questions per ZIP now and the corpus grows continuously as RULING 210 expects.

**NS23** — The permanent control set (RULING 211) needs roughly 40-60 OWNER-VERIFIED facts across the four pilot ZIPs — both known-present facts and known-absence negative controls carrying their authority, period and verified-through scope — weighted toward the dangerous failure modes (a denied present fact; an asserted absent one). Controls are injected unlabeled into normal flow; only the scoring harness may read control identity (the isolation is proven by a seeded-failure test shipped this session). A session cannot verify these facts for you without the set measuring the session instead of the system. The file is data/health/control-facts.json; the schema is lib/health/control-fact.ts; 'pnpm truth:controls --prove-fixture' demonstrates the whole plumbing on synthetic data and deletes it after. THE QUESTION: how do you want to build the answer key? Options: (a) a session proposes candidate facts with their sources and you verify or strike each one — your verification is what makes them controls; (b) you name facts you already know cold (meetings you attended, filings you read) and a session formalizes them; (c) a mix, starting with the negative controls since false presence is the costlier failure.

**OWN01** — From the owner's 8.30.26 testing pass, surface Who Governs Here at 85641. WHAT IS NEEDED: The capture the owner saw, or the address/date that produced the 7-versus-6 state, so it can be placed against a build. WHY THE MACHINE CANNOT PROCEED: A defect that does not reproduce cannot be fixed without knowing what it looked like. The owner's own sheet marks this row PENDING and it is the only row in the sweep with no screenshot. Changing the count logic on a guess would be editing working code against an unreproduced report — and a defect that does not reproduce is not a defect that is absent, so it is not closed either. WHAT WAS TRIED: Reproduced at 85641 on this build. The panel reports 9 governing bodies and renders 9 rows — the 7-versus-6 mismatch the owner saw does not appear. Both numbers come from one derivation, so there is no second source to reconcile against. WHAT CONTINUES WITHOUT IT: Every other Who Governs Here row is worked. A permanent check now pins the count and the rendered rows to one number, so a future divergence is caught rather than reported.

**OWN02** — From the owner's 8.30.26 testing pass, surface Officials at 85701. WHAT IS NEEDED: Approval to acquire and ship the 5 Tucson portraits at the 480x720 resolution tucsonaz.gov publishes, replacing the 150x150 crops we hold. And a decision on the 138 others: their own governments publish nothing larger, so the only remaining route is a different door (a campaign site, a press portrait) for a sitting official — which is a source decision, not a render one. WHY THE MACHINE CANNOT PROCEED: RULING 55: every photo is reviewed by the author, and only an approved photo renders — and a decision is about an IMAGE, not about a person. A 480x720 original is a different image from the 150x150 crop we hold, so it needs its own review. A session shipping it would be taking the author's decision. WHAT WAS TRIED: The measurement the blocker required, made 2026-08-31 on the rendered DOM and over the committed store. The large circle is 92 CSS px and needs 184 device pixels at devicePixelRatio 2; object-fit: cover scales the image's SHORT side to fill it. Of 1057 committed portraits, 144 (13.6%) are narrower than that and 8 fall under the small card's 104px floor. Attributed by publisher, then each publisher's own page fetched: 129 are gc.nh.gov, whose OWN published file is 101-180px — gc.nh.gov/house/images/memberpics/376521.jpg is 101x152 at the source, so we hold the record at the resolution it exists at. 5 are govboard.tusd1.org at 117x160, which is what that site publishes. 4 are njleg at 151px. And 5 are tucsonaz.gov, where we hold 150x150 while the same page's own asset serves 480x720 with or without its dimension parameter — a higher-resolution ORIGINAL that is publicly available. tests/portrait-resolution.test.ts pins the census so the class cannot silently worsen. WHAT CONTINUES WITHOUT IT: Every portrait renders today with the resolution its publisher offers, and tests/portrait-resolution.test.ts now fails if a NEW portrait lands below either floor. Nothing is suppressed and no card is emptier for it.

**OWN03** — From the owner's 8.30.26 testing pass, surface Officials at 85641. WHAT IS NEEDED: Approve or refuse the 9 portraits queued in data/photos/door2-statewide-executives-2026-08-28.json, Mayes, Fontes and Horne among them. The acquisition is done; the review is the only remaining step. WHY THE MACHINE CANNOT PROCEED: RULING 55: every photo is reviewed by the author, and only an approved photo renders — and a decision is about an IMAGE, not about a person. A 480x720 original is a different image from the 150x150 crop we hold, so it needs its own review. A session shipping it would be taking the author's decision. The row's own note says it: QUEUED for the author, shipped by nobody. WHAT WAS TRIED: The acquisition already ran. scripts/hunt-statewide-portraits-0828.mts walked door 2 — the portrait a government body publishes of its own member — for every statewide executive on 2026-08-28: 11 pages walked, 9 portraits QUEUED, 0 shipped. Mayes, Fontes and Horne are all three of them queued off their own offices' pages (azag.gov, azsos.gov, azed.gov), name-matched and decoded as real images — Mayes at 442x553, which is well above every floor in tests/portrait-resolution.test.ts. WHAT CONTINUES WITHOUT IT: Each of the three renders honest initials rather than a wrong or unreviewed photo, which is the correct state under RULING 55 and is not a suppression: the card is complete in every other respect.

**OWN04** — From the owner's 8.30.26 testing pass, surface Officials at 85701. WHAT IS NEEDED: What was wrong with the Hobbs portrait on the ballot, beyond resolution — or a capture of it, so the actual defect can be placed against a build. If the answer is the CROP, that is a render change this session can make; if it is the IMAGE, it is a RULING 55 decision. WHY THE MACHINE CANNOT PROCEED: The report is real and its cause is not resolution, so there is nothing to fix until it is known what 'renders badly' meant — the crop, the aspect, the surrounding layout, or the portrait itself. Changing the render on a guess would be editing working code against an undiagnosed report, and the measurement rules out the one cause the row named. RULING 55: every photo is reviewed by the author, and only an approved photo renders — and a decision is about an IMAGE, not about a person. A 480x720 original is a different image from the 150x150 crop we hold, so it needs its own review. A session shipping it would be taking the author's decision. WHAT WAS TRIED: Measured on the rendered DOM at devicePixelRatio 1 and 2, which is what the blocker asked for. **Katie Hobbs is not under-resolved.** Her portrait is 284x354 — 1.65x what the large circle needs at dpr 2 and 3.09x what the ballot circle needs — so the resolution fix this row was filed under would have shipped and changed nothing the owner saw. tests/portrait-resolution.test.ts pins that, so the row cannot be closed by the fix for a different defect. The measurement the blocker required, made 2026-08-31 on the rendered DOM and over the committed store. The large circle is 92 CSS px and needs 184 device pixels at devicePixelRatio 2; object-fit: cover scales the image's SHORT side to fill it. Of 1057 committed portraits, 144 (13.6%) are narrower than that and 8 fall under the small card's 104px floor. Attributed by publisher, then each publisher's own page fetched: 129 are gc.nh.gov, whose OWN published file is 101-180px — gc.nh.gov/house/images/memberpics/376521.jpg is 101x152 at the source, so we hold the record at the resolution it exists at. 5 are govboard.tusd1.org at 117x160, which is what that site publishes. 4 are njleg at 151px. And 5 are tucsonaz.gov, where we hold 150x150 while the same page's own asset serves 480x720 with or without its dimension parameter — a higher-resolution ORIGINAL that is publicly available. tests/portrait-resolution.test.ts pins the census so the class cannot silently worsen. WHAT CONTINUES WITHOUT IT: The portrait renders at a resolution above every floor on both surfaces, and OFF-8's census now guards the class it was filed under.

**OWN05** — From the owner's 8.30.26 testing pass, surface Data at 85701. WHAT IS NEEDED: Approval to add a source for state executive action records, and which publisher it should be — the Arizona Secretary of State's bill history, the Governor's own office, or another. WHY THE MACHINE CANNOT PROCEED: Adding an external source is on CLAUDE.md's ask-before list by name. Choosing which publisher to take executive action records from is a source decision, and this product's sourcing rule reserves it to the author. WHAT WAS TRIED: Audited lib/sources/ for any adapter collecting executive action records — bills signed, vetoed, executive orders. There is none, and no held corpus carries the class: the Ask engine can only answer a question about a governor's record as a gap because there is nothing to answer it from. WHAT CONTINUES WITHOUT IT: The governor renders with a NAMED GAP attributed to us rather than an invented record, which is the honest state. Every other ballot row proceeds.

**OWN06** — From the owner's 8.30.26 testing pass, surface Ballot at 85701. WHAT IS NEEDED: Approval to add an address-suggestion source, and which one — with a decision about whether partial addresses may leave this product as the reader types. WHY THE MACHINE CANNOT PROCEED: A real address typeahead needs an external suggestion source, which is an ask-before under CLAUDE.md. It also carries a privacy question the collection rules reserve to the author: a typeahead sends partial addresses to a third party as the reader types. WHAT WAS TRIED: Checked what could serve typeahead from data already held. The Census geocoder the app uses has no typeahead endpoint; data/voting-sites.json and the ZCTA store hold points and polygons, not an address universe. Suggesting from our own partial data would offer a reader a list that silently excludes addresses we simply do not hold, which is a coverage gap wearing an autocomplete. WHAT CONTINUES WITHOUT IT: The address field accepts and geocodes a typed address today. BAL-38, the out-of-zip redirect on that same field, is worked independently.

**T01** — The page that says, in plain words, what the product collects, how it is used, and that anonymous totals may be sold. Written before any marketing page, because the marketing has to be true.

**ASK03** — Today an answered ask stores only a topic id; only a refusal keeps the question text. That discards the richest civic-interest signal the product has — what a constituent actually asked, what it resolved to, and what answer they received. The capture path for that is built and it is NOT ACTIVE. It cannot activate until Sean approves reader-facing disclosure copy, because the data-privacy policy requires honest disclosure at the box before free text a reader typed may enter a store whose aggregates may be shared with campaigns, organizations and researchers.

  Waiting on needs sean — the disclosure exists and a tester could not find it; draft summary copy inside (NH246).

**B03** — What legal entity this becomes. An LLC now and a public benefit corporation after the buyer calls, rather than a plain C-corp.

  Waiting on five buyer calls (V01).

**B04** — Registering as a data broker in California, Vermont, Texas and Oregon. Annual deadlines with per-day penalties for missing them.

  Waiting on entity decision (B03).

**B09** — The question to put to counsel: can a software vendor's terms of use narrow the public's statutory right to records a government body is required to publish? The product's whole retrieval posture rests on the answer being no.

  Waiting on find counsel (B05).

**D23** — Federal law restricts commercial use of individual donor names and addresses. This row records exactly what the restriction covers before any code ships that touches it, so the line is drawn on paper first.

  Waiting on find counsel (B05).

**T03** — A security review before a single real person's political opinions are stored. A breach ends the product.

  Waiting on reaction capture (P03).

### P3

**B05** — Two lawyers, probably: one on privacy and one on election law. Both have long lead times and several other rows are waiting on them.

  Pending review.

**C01** — A sample of what a buyer actually receives: one Pima County measure broken into its provisions, with support per provision and counts by how well each answer was verified. Synthetic numbers, clearly labelled, built to show rather than to sell.

**NH08** — The Town of Newbury publishes its whole calendar as a feed nobody had wired, and it has more meeting dates on it than the portals we were using. Both now ship, and when they both carry the same meeting the site shows the one with the agenda attached. That is a change to what you see at 03255 and it is worth a look.

**NH164** — Your BC-11 ruling asked for the disclosure to be drafted this session, marked for your review as COPY, and shipped as drafted meanwhile. It ships as: 'What you write may be shared - without a name, because we don't hold one - with campaigns, organizations, and researchers working to understand what people want.' Three things in it are load-bearing and worth checking: it says MAY rather than will, because a commitment not honoured on every instance is worse than a reserved right; it gives the REASON there is no name inside the sentence, because anonymously is a promise and we-don't-hold-one is a checkable fact; and it names the buyer classes out loud at the moment of typing. The framing above the box reads 'What would you say if [the body] were standing in front of you?' and the placeholder is 'What would you want to say?'. Change any of it and the words live in lib/speak/copy.ts.

**NH166** — OFF-3 asked for the superintendent's photo from the TUSD site, queued for your review under the photo rules, with the rest of the board swept alongside. NOT DONE this session and reported as not done rather than smoothed. Two things you may want to rule on. First, the four-door rule: a district's own site publishing a portrait of its own superintendent is door 2, an official government-published portrait, and TUSD is not a .gov host - so whether door 2 reaches a school district's own domain is your call and not a session's. Second, the app spells him Gabriel Trujillo; the 8/24 brief dictated Gabrielle. The naming rule says the app's spelling is authoritative, so nothing was changed - but if the app is wrong, that is a data fix and it wants your word first. The board's other five members already carry portraits; he is the one initials circle on that card.

**NH194** — From the 8/25 Part 2 walkthrough, capture 17-33-54, confirmed independently in this session's own desktop-01-map-wgh.png: in dark mode the district boundaries render as saturated yellow and orange across the whole viewport and dominate everything else on the map. The same rendering reads fine in light mode. Sean has said all he intends to say — tone down the contrast, no rework — and explicitly does not want the fix specified for him. The deliverable is a WRITTEN PROPOSAL with two or three concrete options and side-by-side captures in both themes, plus a recommendation, and NO map colour change ships until he reacts. THE ASK: once the proposal exists, which of the options do you want, or none of them? Not produced by part2-0825, which shed from the bottom of its item list — so what is owed him first is the proposal, and this row cannot close until that exists.

**NH200** — You said the map lines and yellow are overwhelming in dark view and that the same rendering reads fine in light, and you deliberately did not specify a fix. Three concrete options are captured side by side for you to react to. Nothing shipped.

**NH276** — The one sean/* branch on the remote. Its content IS provably in main — a trial merge is a no-op and PR #199 squash-merged it — so on evidence it is disposable. It was not deleted, because nothing in CLAUDE.md, the policies, or current-decisions.md says a session may retire a branch the author created, and the sweep will not invent a permission.

**NS10** — RULING 119 gives tribal nations their own category, and they needed identifiers. The canonical national list of government identifiers - opencivicdata/ocd-division-ids - has no tribal category at all: read on 2026-08-24, its entire top-level vocabulary is states, districts, territories and courts of appeal, and searching it for the three nations by name returns only Navajo COUNTY, Arizona. So this project minted its own, built on the Census Bureau's own codes for tribal areas with the federal code recorded beside each one.

**NS17** — BC-14 says sources live in the large battlecard and the small card lists names and nothing else. Four .source-tag render sites existed; three are removed (district-popup, coverage-notice, official-popup — all three render into .popup-card, so all three are small cards). The fourth is components/officials/key-votes-section.tsx and it is DELIBERATELY LEFT. A roster row is an identity; a vote is a CLAIM about how a named person voted, and the no-claim-without-a-source rule attaches the source to the claim rather than to the card. RULING 138 says display consolidates sources to one line and the record is never deleted — but it does not say where a VOTE's consolidated line goes, and the small card has no such line today. THE QUESTION: (a) leave the per-vote source where it is, (b) remove it and add one consolidated source line to the bottom of the small card, or (c) remove it because the large card already carries every vote's source. (b) is the most work and the most consistent with RULING 138.

**NS18** — You asked whether Mark Kelly's two sources are capped or filtered. NEITHER. sourceCountLabel is computed from the same array the tab maps over, so the stated N equals the rendered rows by construction; mergeSources merges by (org, url), which is a dedupe of identical publishers rather than a cap; and there is no slice, limit or threshold anywhere in the path. The 2 is a true count of what the tab was handed, and personCardSources is handed exactly two things: the identity spine, and the congress-legislators directory. THE GAP, and it is a design question rather than a defect: his card also renders CAMPAIGN MONEY from the FEC and a VOTING RECORD from roll calls, and both cite their own publisher inline at the claim rather than joining the Sources tab. So the tab is honest about what it was given and is not a complete list of what the card is sourced from. THE QUESTION: should the Sources tab be (a) the card's COMPLETE citation list, which means passing the FEC and the roll-call publishers into it, or (b) what it is now — the identity sources, with each section citing its own? (a) makes the count larger and more useful; (b) keeps every citation next to the claim it supports.

**NS19** — Built nothing, as the brief directs. THE EVIDENCE: the ballot page at 07866 now carries THREE pill treatments in one screen. (1) The two top pills — Narrow this to where you live, Moving here? Know the basics — at 40px tall, lavender-tinted, 1px border, semibold, added this session for BAL-11. (2) The election-box pills — Where can I vote?, Check whether you're registered — taller, more saturated lavender, and set on their own lines rather than in a row. (3) View Battlecard, now deep navy and filled, 522px wide, one per candidate. A fourth exists on the map: the two map pills, which this session made agree with each other for WGH-9 at 224x42 with a mono face. THE PROPOSAL: one pill scale with three named roles — PRIMARY (filled, the one thing a surface most wants done: View Battlecard, Speak Your Mind), SECONDARY (tinted outline, a real action that is not the main one: the top two, the election box's two), and COUNT (mono, a readout that happens to be pressable: the map's meetings and who-governs pills). Same height and padding within a role, at every surface. THE QUESTION: is that the right three roles, and do you want the election-box pair to become a ROW like the top two, or stay stacked?

**V01** — Five conversations with the people who would buy the data — campaign consultants, party data staff, PAC data directors, at least one on each side. The question to put to them is exclusivity.

**V03** — Build a throwaway prototype against three to five cities' agenda systems and find out whether the local-meetings thesis holds. If those systems are locked down or wildly inconsistent, the product changes shape.

**V04** — Take one real Pima County down-ballot race and build the full side-by-side of sourced positions and the reader's own priorities. The test of whether the sourcing actually holds up end to end.

**V05** — A short, sharp answer to the buyer who asks why this beats a thirty-thousand-dollar tracking poll. Needed before the first meeting, not after it.

**V06** — Read the plain-language output back to real people with real questions and find out whether it is actually plain. Synthetic test questions cannot tell you that.

**V07** — A schools and civics-education version of the product, suggested by the tester. A business question rather than product work, parked for Sean.

**B02** — A trademark search in the three classes this product would file under. Cannot usefully happen until the name is settled.

  Waiting on settle the name (B01).

**B07** — How to price this. Selling to a campaign below fair market value can count as an in-kind political contribution, so the prices have to be real and documented, pilots included.

  Waiting on five buyer calls (V01).

**C02** — The commercial front end: buyers log in and see signal by district, race, measure and provision, over time, with the ability to filter, drill down and export.

  Waiting on signal aggregation (P04).

**C03** — The actual file or API a buyer receives — its schema, the confidence-mix figures on every row, how much was excluded by moderation, and the snapshot id that makes it citable.

  Waiting on signal aggregation (P04).

**C04** — Publish what the signal predicted before each election and how it actually turned out. A public scoreboard, including the misses.

  Waiting on signal aggregation (P04).

**D70** — Work out which public bodies sit on which agenda platform, so the meetings layer can reach past the four pilot zips. Three platforms, three different methods, and it needs Sean's ruling on the approach first.

  Waiting on body enumeration per unit - the missing second layer of the who-governs denominator (HUNT02).

**PB10** — Reading individual donors out of the federal campaign-finance data, rather than only committee totals. Held until an election lawyer rules on the commercial-use restriction that attaches to donor names and addresses.

  Waiting on fec contributor information - commercial-use restriction (D23).

**T02** — Proving a real person is answering without learning who they are — device attestation, a phone check that rejects burner numbers, an address that exists. Weighted rather than gated, so nobody is turned away.

  Waiting on reaction capture (P03).

**T06** — Grade a hundred real answers by hand against the verification tiers before any automatic classifier touches them. The hand pass is what tells you whether the tiers mean anything.

  Waiting on abuse policy live (T05).

**T07** — The abuse policy points at a file of escalation contacts that does not exist — local police, the state agency per state, the Capitol Police threat unit. A policy pointing at nothing cannot be followed.

  Waiting on abuse policy live (T05).

**V08** — A page for candidates rather than readers, showing what the product holds on them next to what it holds on their opponents. Sean's idea: the fastest way to fill a thin card is to let the person fill it.

  Waiting on the blurb-equalization hunt - a sourced one-line description for every ballot candidate (B14).

**X02** — Five content creators on Instagram. The cheapest distribution channel available to a product nobody has heard of.

**X03** — A podcast pitch, shorter and more specific than feels comfortable.

## New Hampshire hunt

Everything owed to a reader in New Hampshire — Newbury and 03255 first. Bodies, officeholders, candidates, meetings, the ballot.

**33 open · 5 resolved.**

### P1

**HUNT01** — Walk every single governing body around Newbury, New Hampshire to full depth — who sits on it, when it meets, where its records are. The first place the product tries to answer completely.

**HUNT04** — The 47 people who filed to run around Newbury, New Hampshire. None has been researched. Every one of them is a card a reader will meet.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

### P2

**NH02** — Newbury's own site lists a Parks and Recreation Committee and a Housing Committee in its sitemap, and both pages ask for a password. They are real committees the town has not published. We never sign in to anything, so their membership and meetings have to come from somewhere else.

**NH04** — We now hold all three county commissioners, the delegation's officers and every department head by name. What the county publishes for reaching any of them is one main number. The Kelly standard asks for a working contact per person and the county does not print one.

**NH05** — Ten Newbury boards now read their meetings off the town's own calendar, and the town has not posted a single upcoming date for any of them. Seventy-eight of their past sittings are on that calendar, so they do meet. A reader who wants to attend one cannot find out when from anything the town publishes.

**NH122** — cfs.sos.nh.gov ANSWERS: Node fetch gets HTTP 200 and 65,928 bytes. But the page is an Angular single-page app whose HTML is a shell, and the campaign-finance data endpoints were not found. Rung 6 (a live browser, which would reveal the calls) is REFUSED with 403 by the edge — curl is also refused, and only Node's fetch passes, which inverts the usual assumption that the browser is the strongest rung. Reading the served JS bundles (a new route, recorded in the expansion log) surfaced only lobbyist paths; the campaign-finance routes are in lazy chunks this pass did not locate.

**NH34** — Sutton has 18 governing bodies, all named in the registry and all shipping KNOWN_UNCOVERED. Its CivicPlus calendar exports 1,312 events - 47 of them upcoming - and every single one has an empty LOCATION field. Nothing this session reached states a meeting venue for any Sutton body, so wiring them would have produced 18 bodies whose every sitting drops.

**NH48** — pnpm venue:hunt read 157 body pages on 2026-08-21. Three state where the body meets; 137 were read and state nothing; 17 could not be read. That 137 is a dated measurement about 137 specific pages and it is the next hunt's starting point.

**NH49** — pnpm hunt:gaps reports 182 owed of 368 possible across 30 contests and 92 candidates, down from 184 at NH Hunt 4's close. Per class: Photo 45, In their own words 41, Contact 60, Campaign site 36.

**NH50** — Sutton's own boards-and-committees index lists sixteen governing bodies and the registry holds two of them. RULING 57 names a body first and hunts it second, so the fifteen missing ones are entered with what is known — the name, the host municipality, and the page that named them — whether or not a meeting source exists. The index is at suttonnh.gov/boards-committees and is reachable at rung 5 (rungs 2, 3 and 4 hit a Cloudflare managed challenge). NH Hunt 6 wired the Planning Board only, because its page is the only one that states a venue.

**NH51** — Fifteen of Sutton's sixteen bodies have no published venue this session could find. Their pages carry '93 Main Street | Sutton Mills' in the SITE FOOTER only — the town's postal address on a template, not a statement about where that board sits — and reading a footer as a venue would pin fifteen bodies on the strength of a page layout. What is owed is the posted NOTICE per body, which carries the room by construction, or a minutes header that states it.

**NH52** — facebook.com renders 977,803 and 928,697 bytes and ZERO characters of readable text to our headless browser, on two campaign and committee pages read 2026-08-21. campaign-social is the highest-yield branch-manifest route for the smallest races — the rule that a campaign living on Facebook still has a campaign site exists to protect exactly the candidates least able to buy a domain. The route is WALLED today, with its date, and RULING 53 puts it back on the queue in fourteen days.

**NH59** — Sutton's calendar titles the committee's sittings 'WRLAC Mtg @ Pillsbury Library'. Its own page on suttonnh.gov carries only the site footer, so the body names a venue the page does not. Two sittings are held out of the product because of it.

**NH60** — pnpm venue:hunt --town sutton_town reads 18 of Sutton's board pages and cannot reach seven: Municipal Budget Committee, Supervisors of the Checklist, Trustees of the Trust Funds, Website Committee, Ad Hoc Waste Reduction Advisory Committee, Ad Hoc Grist Mill Bridge Committee, and the 26 Grist Mill Street Committee. suttonnh.gov/boards-committees itself answers 404.

**HD01** — Eleven people are running for United States Senator in New Hampshire and forty-one things about them have never been looked for — faces, their own words, a way to reach them, a website.

**HD02** — Six people are running for Congress in New Hampshire's second district and eighteen things about them have never been looked for.

**HD03** — Four people are running for Merrimack County Attorney and sixteen things about them have never been looked for.

**HD04** — Four people are running for Merrimack County Sheriff and sixteen things about them have never been looked for.

**HD05** — Three people are running for Merrimack County Commissioner in the second district and twelve things about them have never been looked for.

**HD09** — Three people are running for Governor of New Hampshire and nine things about them have never been looked for.

**HD10** — Two people are running for Merrimack County Treasurer and eight things about them have never been looked for.

**HD11** — Two people are running for New Hampshire Executive Councillor in the second district and eight things about them have never been looked for.

**HD12** — Two people are running for Merrimack County Register of Deeds and eight things about them have never been looked for.

**HD13** — Two people are running for state representative in Merrimack County's seventh district and eight things about them have never been looked for.

**HD19** — Two people are running for New Hampshire's seventh state senate district and five things about them have never been looked for.

**HD24** — One person is running for Merrimack County Register of Probate and four things about them have never been looked for.

**HUNT05** — Forty special districts that might or might not reach Newbury, New Hampshire. Nobody publishes their boundaries, so the answer has to come from somewhere other than a map.

  Waiting on body enumeration per unit - the missing second layer of the who-governs denominator (HUNT02).

### P3

**NH03** — The town's own pages state terms ending 2021, 2022 and 2023 for its Cemetery Trustees, and March 2021 for one Planning Board alternate. Those are the town's current published words and they are up to five years out of date. We render them as published, which is honest, and a reader may still be looking at people who left.

**NH116** — He is running for US Senate and is owed a photo at 03255. His campaign site publishes exactly one picture of him: a clean solo studio portrait, refused on 2026-08-24 on two stated grounds rather than on composition. The file is named 'Picture Trinity campaign shot high def 2007 001.jpg' - the publisher dating it to 2007, nineteen years ago - and it is served at 220px in 5,699 bytes, which is below any size this product could render as a portrait.

**NH220** — The permission read now walks the ladder to rung 4 and recovered az.gov, azed.gov, irc.az.gov, nh.gov, courts.nh.gov, education.nh.gov, revenue.nh.gov and nhsba.org — all of which the sweep had been refusing. sos.nh.gov still answers HTTP 503 to every client tried, so the may-we-walk question is UNANSWERED and the walk is refused under RULING 148. Also still refused: newburynh.org, doe.nh.gov, dra.nh.gov, nhdes.nh.gov and data.az.gov.

**NH35** — Warner's own boards index names 26 governing bodies. Its calendar files sittings for 16 of them. The other ten are named in the registry and ship KNOWN_UNCOVERED: the Cemetery Trustees, the Community Power Committee, the Corridor Committee, the Economic Development Advisory Committee, the Groundwater Protection Committee, the Highway Safety Committee, the Housing Advisory Committee, the Joint Loss Management Committee, the Mink Hills Recreation Committee and the Record Preservation Committee.

**NH36** — Wilmot's Master Plan Committee, its Safety Services Facility Committee and its Transfer Station Advisory Group all meet, and the town files their meetings under CATEGORIES:Planning Board and CATEGORIES:Select Board. A category-driven read cannot separate them and a title-driven row over the same feed would claim events that already belong to another body. All three are named and KNOWN_UNCOVERED.

**NH41** — The Lake Todd Village District's own site, which the Census of Governments records as laketoddvillagedistrict.us, answers HTTP 404 at rungs 2, 3, 4, 5 and 6, and so does the Town of Bradford's news item for its meeting. The Internet Archive - rung 11, and the rung that produced this district's own words for an earlier session - answered 'Temporarily Offline' on 2026-08-21.

## New Jersey hunt

Everything owed to a reader in New Jersey — Rockaway Township and 07866 first.

**44 open · 5 resolved.**

### P1

**NH198** — Sean found Morris Hills Regional School District rendering 'We haven't sourced who runs it yet' and said he found that hard to believe given New Jersey was supposed to be complete. He was right to doubt it, and the cause is a process defect rather than a data gap: the hunt ran a municipal enumeration and its denominator never contained the school districts.

### P2

**NH113** — The scheduled NJ filing refresh rebuilds data/ballot/nj-morris-2026.json and the file comes back reordered even when nothing about the ballot has changed. Run 32711668624 on 2026-08-24 showed 1,013 insertions against 1,013 deletions across two files while the clerk's own totals were identical - 272 candidacies, 90 contests, both PDFs still dated 08-21-26. So the workflow reports 'data/ballot/ CHANGED' and runs the full gate on every single run. That is not just noise: a real republish by the clerk will look exactly like the churn, and the one signal that would tell somebody the ballot actually moved is the one being spent every day on nothing.

**NH115** — pnpm roster:stale, built 2026-08-24 for NH73, compares the Morris County Clerk's 263 certified winners against the 271 people this project holds on Morris body rosters. Of 234 municipal winners: 99 are confirmed in our rosters, 90 belong to municipalities we hold no roster for at all (a coverage gap), and 45 belong to places where we DO hold a roster that does not name them. Those 45 are the NH73 shape - a roster that may be showing a reader somebody who is not in the seat. Boonton Town has 13 of them and Chester Township 7.

**NH172** — Measured 2026-08-25 during the tier-above directory inversion. www.governor.nh.gov, www.nh.gov and www.nh.gov/governor/executive-council/ all answer HTTP 403 to a browser header set AND to curl — two different clients, two different TLS fingerprints, same refusal. That is an EGRESS or host-policy wall rather than a header problem (ladder rung 5's finding), and it is recorded with its date rather than as a standing property (RULING 52). What sits behind it: the Governor's own page and the Executive Council's roster, which are the official sources for two contests on the 03255 ballot — Governor (4 candidates) and Executive Councilor District 2 (3 candidates). The next rungs not yet walked are 5 (a different egress), 11 (the Internet Archive) and 12 (the vendor platform, if the state runs one). NOT an absence: this names what the wall is around, per RULING 90 item 4.

**NH175** — 2026-general-candidate-order-081026.pdf, the third document on the Morris County Clerk's candidates page. Read 2026-08-25: 7 pages, every one rendering with NO text layer, so the extractor correctly reports ZERO_ROWS with the reason 'this is a scanned PDF. The next rung is OCR (lib/extract/ocr.ts), NOT a finding that the document is empty'. Both the filing parser and nj:filing:check exclude it by name and say why, which is right — including it would produce a guaranteed zero-row parse. What it carries is the BALLOT POSITION of every candidate, drawn by lot, which decides the order a reader meets them on a real ballot and which this product does not hold. lib/extract/ocr.ts exists. Nobody has pointed it at this document.

**NH191** — From the 8/25 Part 2 walkthrough, captures 17-30-28 and 17-30-58. The Morris Hills Regional School District card reads We haven't sourced who leads this body yet and We know this division has a governing body because its boundary exists. We haven't sourced who sits on it. Sean finds this hard to believe given New Jersey was supposed to be complete. The audit he asks for is whether the NJ hunt actually finished or silently skipped districts — a possible partial-extraction defect of the class RULING 100 governs, seen six times before — and the deliverable is the DISTRICT-LEVEL COVERAGE DENOMINATOR for New Jersey. One number is already measured and is a start: pnpm nj:wire reports 20 bodies wired and 19 owed of 39 MUNICIPALITIES, which is a municipal denominator and says nothing about school districts. Not reached by part2-0825.

**NH213** — Sean found Morris Hills Regional School District rendering 'We haven't sourced who runs it yet' and doubted it, given New Jersey was supposed to be complete. Audited 2026-08-26 against data/audit/universe-07866.json, the official universe: 413 units carry an NJ ocd id, 187 of them school districts. 23 have a roster in BODY_ROSTERS; 390 do not, and Morris Hills is one of them. This is NOT the partial-extraction defect it was suspected of being - the universe NAMES all 413, which is RULING 57 working, named first and hunted second. The NJ hunt did not silently skip districts; it named them all and hunted a fraction. What was reported complete was the 07866 BALLOT (272 candidacies), which is a different denominator from district-level roster coverage, and the two were being read as one.

**NH38** — Six of the 40 New Jersey senators carry a websiteUrl on assemblydems.com or njassemblygop.com - a party caucus page for the Assembly, for people who now sit in the Senate. Two of them, John McKeon and Parker Space, answer HTTP 404 and surfaced in the officials audit as MISS-404.

**NH66** — 44 of the 90 Morris County contests are Boards of Education, and the municipal-roster branch built this session reaches municipalities only. A school district publishes its board members on its own site exactly as a borough publishes its council, so the same branch should reach them - what is missing is the INDEX step: there is no equivalent of the county's Cities-and-Towns page listing every district's website.

**NH67** — search-index was made mechanically walkable this session and walked all 272 candidates: 148 came back with at least one classified URL and 124 came back with none, because Bing and Yahoo both began refusing after roughly 170 queries. That 124 is a fact about one IP's rate ledger on one afternoon, not about those 124 people, and it may never be read as an absence.

**NH72** — NJ Hunt 6 wired 19 of 39 Morris municipalities' governing bodies. The other 20 are OWED, not absent, and `corepack pnpm nj:wire --dry` names every one with its reason. Three reasons, in order of frequency: (1) the confirmed member count does not reach the seat count the municipality's own form of government declares, so a partial list would state a false composition; (2) the form-of-government line states no seat count at all, so completeness cannot be checked; (3) the county clerk's certified winners do not reach the municipality, so the SEATS' partisanship is unsettled under M62. Every one of these is closed by more hunting, not by loosening the gate. The nearest wins: Boonton (7 of 8 confirmed), Dover (5 of 8), Netcong (4 of 6), Long Hill (4 of 5).

**NH88** — data/hunt/wiki-graph-07866.json holds 80 leader entries harvested on 2026-08-22, and 5 of the 72 usable ones store the Wikipedia link syntax as part of the person's name - "Joseph Jackson ([[Republican Party (United States)" is what the file actually contains for the Mayor of Rockaway Township, and one office title is stored as "[[City manager". A consumer reading the name field straight out gets a string that is not a name. NOTHING WENT RED, because nothing was empty: this is RULING 100's shape, an extraction that came back with some rather than none, and only reading the rows shows it. The fix belongs in the graph's own generator per RULING 92, and that generator reads Wikipedia over the network, so the artifact is owed a regeneration when egress is available. scripts/mine-wiki-leaders.mts cleans the markup at read time as a stopgap and exports cleanWikiText; it is a workaround, not the fix.

**NH89** — The 2026-08-23 session mined two committed corpora that had never been read for the fields they answer, and produced leads it could not confirm because every outbound host was refused at that environment's egress. data/hunt/campaign-site-leads-nj-morris.json holds 12 campaign-site leads across 12 of 272 candidates, 8 of them STRONG (selenformorriscounty.com, joehathawayforcongress.com, strobelforschoolboard.com, rebeccabennettforcongress.com, corybooker.com and three more) against a field that stood at 0 of 272. data/hunt/wiki-leader-leads-07866.json holds 9 New Jersey municipal roster leads - mayor, manager and clerk for Rockaway Township, Rockaway Borough and Denville - none currently held as an officeholder. EVERY ROW IS A LEAD AND NOT A HIT: a domain matching a candidate's name is a guessed identifier, and Wikipedia names a person while the citation proves them (RULING 87). What is owed is the control check - fetch each, confirm the page self-identifies with the filed name, the office and the cycle - which is one fetch per lead for a session that has egress. Regenerate the leads with pnpm mine:campaign-sites and pnpm mine:wiki-leaders.

**NJ02** — The official-universe pair at 07866, measured 2026-08-22 against the 2022 Census of Governments: 178 units within the first radius rung, 5 held, 173 with no body, 13 bodies held across those five. Compare 03255, which is 48 of 48. The five held are Township of Rockaway (9 bodies), County of Morris, Morris County Soil Conservation District, Morris Hills Regional District and Rockaway Township School District. Every un-held unit is named in the twig:pair output rather than counted, per RULING 57. This is the enumeration finding, not a defect: the New Jersey universe is simply much larger inside 25 km than Newbury's, because northern New Jersey is dense with boroughs, townships, fire districts and regional authorities. The work is to name and reach them, one shape at a time, and the fire districts and municipal utilities authorities are the biggest single class.

**NJ06** — data/ballot/nh-merrimack-2026.json gives the contest "Executive Councilor, District 2" the ocdId ocd-division/country:us/state:nh/county:merrimack/place:newbury_town. New Hampshire's Executive Council District 2 covers 81 cities and towns; Newbury is one of them. Two consequences: the contest renders only for readers whose divisions include Newbury, so the other 80 towns in the district never see their own Executive Council race; and the id is a wrong join key, which CLAUDE.md makes the universal key for districts, offices and elections. Found while verifying RULING 71's certainty classification -- the contest read as CERTAIN at 03255, which is accidentally the right answer for the wrong reason (Newbury covers the whole zip, and District 2 does cover Newbury). The right division is an Executive Council district, which this repo has no committed geometry for. Fixing it means either committing that layer or recording the contest against the state with a scope note.

**NJ08** — The other half of the 52. Fire districts, sewerage authorities and a power authority -- ROCKAWAY VALLEY REGIONAL SEWAGE AUTHORITY, five PARSIPPANY-TROY HILLS TOWNSHIP FIRE DISTRICTs, three MONTVILLE TOWNSHIP FIRE DISTRICTs, HANOVER TOWNSHIP FIRE DISTRICTs 2 and 3, PEQUANNOCK RIVER BASIN REGIONAL SEWERAGE AUTHORITY, NEW JERSEY PUBLIC POWER AUTHORITY, SOUTHEAST MORRIS COUNTY MUNICIPAL UTILITIES AUTHORITY, PEQUANNOCK-LINCOLN PARK-FAIRFIELD SEWERAGE AUTH, WANAQUE VALLEY REGIONAL SEWERAGE AUTHORITY, MUSCONETCONG SEWERAGE AUTHORITY. No TIGER polygon exists for any of them at any vintage, so no geometry pipeline will ever reach them. RULING 57 says a body is NAMED FIRST and hunted second, and that a body with no source and no site is still entered and still rendered. scripts/twig-pair.mts already has divisionlessBodyFor(), so the mechanism exists in one place and has not been generalised. Eleven of the eighteen publish a website, listed in the twig:pair output.

**NJ09** — Measured 2026-08-22, not assumed. Across all 272 Morris candidacies: contact 272 of 272, ballot slogan 70 of 272, campaign site 0 of 272, photo 0 of 272. Both of the fields that are held come from ONE route -- filing-county, one county-clerk PDF -- and that document carries no portrait, no prose about a candidate and no URL. So New Jersey's mechanical contact windfall is a property of that DOCUMENT and does not generalise to the other three fields. pnpm nj:fields walks a contest and reports per route; the Rockaway Borough Council four were walked (Burnside, McDonald, Dawkins Jr., Natale) and returned filing-county empty, campaign-site not walkable, domain-search one lead (patrickmcdonald.com, capped at a lead under RULING 68 because the identifier was guessed) and three empty. 86 of the 90 contests are unwalked, and no candidate anywhere has had the full named route list walked, so no absence has been earned for anybody in either zip.

**NJ11** — The wikipedia-municipality parser reads 39 of 39 Morris County municipalities and parses a roster for most of them. Jefferson Township and Pequannock Township return zero council members while their Local government sections plainly carry one, and both are Faulkner Act municipalities. Chatham Borough and Montville parse a roster but return no form-of-government string. These are parser seams rather than absences and must never be reported as absences about those bodies. The seams already found and fixed are written up in docs/zip-playbook.md section 8 - the roster sentence has no reliable lead-in so every sentence is scored, ref bodies must be masked before sentence splitting or every citation detaches, generational suffixes are not separators, and office titles are glued to names longest-first. These two are the next ones. The diagnostic is the headings array the parser returns on every record.

**NJ12** — Carries forward what NH71 recorded, minus what this session closed and plus what tiering revealed. CLOSED THIS SESSION: filing-campaign-finance-local (NJ ELEC) - the wall was on elec.nj.gov and the records are on njelecefilesearch.com at rung 2; 19 filed entities across the two 07866 municipalities with both controls clean. STILL OWED, with tier: lwv-questionnaire (Tier A) - onyourballot.vote411.org returned candidate-detail pages in search results last session and none has been opened, and it is the highest-value unwalked Tier A route left because one ballot page answers a whole contest. party-committee-roster (Tier A) - the Morris County Republican and Democratic committees publish slates and neither has been walked. filing-prior-candidacy (Tier A) - the manifest calls it the most under-used route in the list and it is under-used again. bar-directory and licensing-board (Tier C) - two candidates surfaced as attorneys through their firms' own sites and njcourts.gov has never been asked. records-request (Tier B) - rung 13, not reached. announcement-archive (Tier C). ad-library (Tier A) - NS01 is tabled by Sean and was not touched. press-outlet-map (Tier A) - the route was BUILT this session and its host list DERIVED from 726 distinct citation hosts, but the outlets' own site searches have not yet been queried.

**NJ13** — From the 8/22 walkthrough, NOT STARTED this session (no hunting was in scope). Morris County has solid representation data and most commissioners have no photo — the first-listed and one other have none, a third does. If one commissioner has an image the rest are findable by the same route. WHAT IS OWED: source photos for every official on that body through the four doors, then open ONE photo review row for Sean. Photos never block anything: every other field renders immediately, photos-first ordering is presentation and not a completeness gate (RULING 50), and a photo decision keys to the ASSET rather than the person — refusing a bad banner once withheld a good Senate portrait.

**NJ17** — Conceived and walked 2026-08-24. Every HTTPS campaign site has a TLS certificate and every certificate is in a public append-only log searchable by substring, so crt.sh is one of very few routes that searches the whole web by NAME without a search engine. The control is clean: an impossible substring returns HTTP 200 with []. Three of four live queries returned HTTP 502 from crt.sh's own nginx. That is a wall on those queries, not an absence of certificates. Re-walk on the RULING 53 clock.

**NJ18** — The press-outlet-wp-search route asks newjerseyglobe.com and morristowngreen.com their own /wp-json/wp/v2/search once per distinct surname — 258 surnames, 516 questions, control clean on both hosts. Those searches named 4,056 distinct articles. Harvesting them at a polite rate is several hours. pnpm hunt:sites now takes --max-pages so a run states BOTH numbers when it stops short, and the disk cache means every page already fetched is free on the next run. What is owed is finishing the harvest and mining it.

**NJ20** — After the sitemap branch, pnpm roster:hunt reaches a confirmed governing-body page on 17 of 39 municipal sites and 82 members. The other 22 report a FAILED extraction with candidate pages found and fetched — so DISCOVERY is no longer the binding constraint; EXTRACTION is. Each failure names the site and the pages tried. What is owed is reading a sample of those pages and naming the shapes lib/hunt/roster-page.ts cannot parse, as a class rather than one site at a time.

**NJ23** — pnpm hunt:sites grew a rung escalation this session — node fetch, then curl at rung 4, then plain HTTP, then an Internet Archive lookup at rung 11 — and it is right for a link read off a real page: two municipal committee domains the county party links no longer resolve, and the archive holds their candidate pages. It is wrong for a GUESS. The party-committee-domain-shape route constructs 580 candidate domains, five suffix patterns per party per municipality, and most of them do not exist; NXDOMAIN is the EXPECTED answer for a guess rather than a wall to climb, so the full ladder runs on hundreds of hosts that were never real. The route was walked and had to be stopped unfinished for that reason, which is recorded rather than smoothed. The fix is to carry the guessed flag into the fetch path and escalate a guessed identifier differently: one attempt, and a non-resolving host is a NO rather than a rung-11 question.

**HD06** — Three people are running for the Rockaway Township Board of Education and twelve things about them have never been looked for.

**HD14** — Two people are running for the Morris Hills regional school board's Rockaway Township seats and eight things about them have never been looked for.

**HD17** — Three people are running for United States Senator in New Jersey and six things about them have never been looked for.

**HD20** — Two people are running for the Morris County Board of Commissioners and five things about them have never been looked for.

**HD21** — Two people are running for Congress in New Jersey's 11th district and five things about them have never been looked for.

**HD25** — One person is running for the Rockaway Township school board's unexpired term and four things about them have never been looked for.

### P3

**NH107** — Promoting the rung-1 campaign-site leads turned up attorney bio pages for two Morris County candidates — chippersonlaw.com for Rita C. Chipperson and dawkinswarrington.com for Clifford D. Dawkins. Both were briefly and wrongly promoted as campaign sites by a first version of the evidence test, and both are correctly recorded as MISS for that field now: a law firm page is not evidence of a candidacy. But it IS a real find for a different field. The branch manifest already names the route — bar-directory, which it describes as reaching an office address and a direct line — and the manifest's own index says to try it first when a candidate is a lawyer. Nothing read these two pages for a phone or an address.

**NH114** — data/hunt/nj-morris-certified-winners.json holds 263 rows and some of them carry an office that is plainly not an office. Carolyn Dempsey's reads 'DEMPSEY', Robert Simpson's reads 'SIMPSON' - the surname landing in the office field - and several read null outright, among them Robert H. Conley, Howard Kritz, Maria Cote, Louis R. Maffei and James A. Lynch. The row count is right and the names are right, so every count over this file reconciles and reports success.

**NH173** — Read 2026-08-25. https://www.tapinto.net/robots.txt answers HTTP 403, so the policy that would say whether we may walk it cannot be read at all — and a 403 on a policy is not an implied yes. TAPinto is a hyperlocal NETWORK with per-town sites across New Jersey and is the largest press surface this county has that this project does not read; docs/sources.md already recorded it walled at rung 3 on 2026-08-24. lib/hunt/press-surface.ts records it as UNREADABLE, which is a third state beside PERMITTED and DISALLOWED and is deliberately not either. Routes not yet walked: the Internet Archive's capture of the robots.txt (rung 11), which would establish what the policy SAYS even if the live file refuses; and asking the publisher directly, which is rung 13 and is a real option for a local outlet.

**NH224** — mtoliveboe.org, the Mount Olive Township School District address reported to the Census Bureau, answers HTTP 200 and serves a Japanese personal-finance blog. WWW.MTLAKES.ORG no longer carries Mountain Lakes Borough School District content. Both districts exist and govern; the ADDRESS is stale. Neither was promoted, because the control requiring a page to name the entity refused them — which is the only thing standing between the registry and a link to a stranger's blog. The live addresses have not been hunted.

**NH57** — The welcome overlay offers four starting zips and labels 07866 'Rockaway Twp., NJ'. Two municipalities sit in that zip and the product now renders both, so the label names one of them and silently drops the other — for a Borough resident it is the wrong town.

**NH68** — Robert Strobel is a Board of Education candidate and strobelforschoolboard.com answered HTTP 200 to a plain fetch with no mention of his name anywhere in the HTML. That is the classic JavaScript-rendered page: a false miss at rung 2, not a wall and not an absence. The extractor recorded it EMPTY, which is honest about the fetch and wrong about the candidate.

**NH71** — The branch manifest names 41 routes. This session walked search-index, filing-county, body-roster-page, gov-staff-directory, campaign-site, campaign-social, candidate-platform, local-newspaper, web-archive and domain-search. The rest were not walked and each one's reason is recorded here rather than left as a silence, because a route nobody names is a route the next session rediscovers as new.

**NH74** — The township's own Township Council page shows `hmorrison@rockawaytownship.org` as Howard Morrison's address, and the link behind it targets `hkritz@rockawaytownship.org`. Howard Kritz held the seat before Morrison and appears in the Clerk's certified 2023 winners, so the mailto is a predecessor's mailbox the page never updated. We ship the DISPLAYED address, which is what the body publishes as his, and record the mismatch rather than silently preferring either. Worth telling the township: the link on their own page reaches the wrong person.

**NH76** — `corepack pnpm nj:winners` reads the Morris County Clerk's certified general-election winners: 263 people across three cycles, each with a party, a filed street address and usually an email, certified by the election authority. NJ Hunt 6 wired the PARTY from it for 98 sitting officials and used the email only as a fallback where the body's own page publishes none. What is owed is the rest: the filed addresses are unused, and the same document class exists for every New Jersey county and for the school-board and fire-district races the municipal walk does not reach.

**NJ04** — RULING 65's footer-address branch wired seven Sutton bodies on 2026-08-22, and three were deliberately left out because each has better evidence about itself than the town's footer has about it. Ad Hoc Speed Sign Committee: its own feed titles read 'Ad Hoc Speed Sign Committee - Zoom Mtg', so it meets on Zoom and pinning it at 93 Main Street would send a reader to an empty building; the playbook already records that a Zoom URL in LOCATION is a fact and not a building, and this is the same rule read from a title. Warner River Local Advisory Committee: its titles read 'WRLAC Mtg @ Pillsbury Library', a venue this session could not resolve to a coordinate, and it is a multi-town river committee so Sutton's town hall is a poor guess; the work is to resolve Pillsbury Library. Sutton Free Library Board of Trustees: its page states its own meeting arrangement, so it is a STATES A VENUE case. Each has four future sittings, two, and an unknown respectively.

**NJ10** — Read as an image on production 2026-08-22. With the zip-area widening in place the card at 07866 lists both municipalities, and the Borough's row reads "Rockaway  MUNICIPAL" while the Township's reads "Rockaway township  MUNICIPAL". A reader cannot tell which is which, which is the exact confusion RULING 71 exists to remove -- borough and township are coequal forms and these are two separate governments sharing a name. The label comes from the division's own name in the registry, which for the place layer is the Census's "Rockaway" for the CDP-style entry. The fix is a labelling decision about which of the two committed names a row shows, and it wants a look at the other states before it is made.

**NJ14** — Of the 07866 ballot's 272 candidacies, 235 resolved to an ELEC location and 37 did not. Fifteen of the 37 are correctly out of scope: US Senate and two congressional districts file with the FEC, and the state-level contest files elsewhere. The rest are REGIONAL SCHOOL DISTRICTS — West Morris Regional, Morris Hills Regional, Hanover Park Regional — plus Long Hill Township and Parsippany-Troy Hills, whose names did not resolve against the ELEC dropdown under any of the six municipal suffixes tried.

**NJ19** — The certified-winners sweep names Washington Township among the 17 dark municipalities, and it is absent from both data/hunt/nj-morris-municipal-sites.json (30 rows) and data/hunt/muni-sites-nj-morris.json (39 rows). The state's own directory at nj.gov/nj/gov/county/localgov.shtml names it as wtmorris.org, read 2026-08-24. That host answers rung 3 with a 1,331-byte Sucuri CloudProxy JavaScript challenge titled 'You are being redirected...', so rung 6 is owed. The same directory lists four different Washington Townships across four counties, so the Morris one must be identified by its position in the county section rather than by name — the Boonton / Boonton Township problem this project has already paid for once.

**NJ21** — A finding rather than a defect, recorded because it decides how symmetry is kept. The Morris County Democratic Committee publishes an index of its 39 municipal committees linking 22 distinct municipal committee websites, reachable in one request through its own WordPress REST API. The Morris County Republican Committee publishes no municipal committee index at all — 25 pages in its sitemap, 8 of which name somebody on this ballot, and no outbound link on any of them survives the campaign-site filter. This is RULING 60's sub-branch rule arriving inside one county rather than across states: a route proven on one party's site is proven for that PUBLISHER, not for the office. The session's answer was to turn the shape the Democratic index revealed into a guessed-domain route applied to both parties with the same patterns and the same number of guesses each.

## Arizona hunt

Everything owed to a reader in Arizona — Vail (85641) and downtown Tucson (85701) first.

**36 open · 1 resolved.**

### P1

**NH226** — Two things this project has written down about Vail are wrong, and both are now measured. The stored board roster had six names when the board has five. And the research note says the Vail area is in one legislative district when it is in two.

**NH234** — A directly elected government that taxes every parcel in Pima County has no meeting adapter, and adding it to the registry correctly moved both Pima pilot zips from NONE_SCHEDULED to NO_SOURCE.

### P2

**AZ01** — NOT STARTED this session. AZ-1: "Know the basics" needs more topics — hunting and fishing ("Am I allowed to hunt or fish?", a common question when somebody moves states) and state abortion law. Both contentious, which is exactly why a clear factual account of where the state stands is owed: state what the law is, cite it, take no position. AZ-2: the state comparison holds one comparison at a time, which is right, but Back returns to Arizona alone when the expected destination is the map — either a reset pill or state pills in the title bar, with deselecting a state dropping it from the comparison, and the same pill pattern on the ballot. AZ-3 (applies across the board, Arizona is only the example): the voting section is five separate items — next election, add to calendar, check registration, where can I vote, search the Secretary of State's tool — and should read as next election, 2026, early voting, with the rest of the noise cut. AZ-4 and AZ-5 (ruled together): three links to the same registration destination inside about ten lines deduplicate to ONE prominent pill, "Check whether you're registered to vote", pointing at the reader's Secretary of State; same pattern for polling location. The Secretary of State is the only authoritative source for either, and a reader who trusts an in-app answer and does not check loses their vote. AZ-6 is positive: the federal-representative pill system works and stays.

**AZ02** — POST https://seethemoney.az.gov/Reporting/GetNEWTableData answers HTTP 200. Posted with a guessed body it returns a two-byte empty payload, which is a statement about our request rather than about Arizona's records. The sibling name GetDetailedTableData is a 404, so the endpoint name is exact. robots.txt is 404 and there is no terms-of-use page at the guessed path — both recorded as measurements rather than as permissions.

**AZ03** — The corpus holds Katie Hobbs as an officeholder — name, office, party, contact, each sourced — and holds nothing about what she has DONE in office. There is no store of vetoes, bill signings, executive orders or line-item actions for any governor. lib/votes/ is congressional only: H.R. numbers and CRS summaries for members of Congress. So a reader asking what their governor did in the last twelve months gets an honest and very thin answer.

**AZ04** — vailschools.novusagenda.com is live, publishes no robots restriction, and - driven through its ddlDateRange control rather than by setting the hidden date fields - returns 30 meetings and 30 agenda ITEMS with Online Agenda, Agenda PDF and Minutes links, newest 2017-02-28. That is a real, permitted, machine-readable archive of a district's board agendas that this product does not hold. The walk is scripts/hunt-vail-novus.mts; turning it into an adapter under lib/sources/ is ordinary work now that the form is understood, including pagination past the first 30 rows. It does NOT reach the current agenda, which is on Highbond and disallowed.

**NH192** — From the 8/25 Part 2 walkthrough, capture 17-28-02, which shows John Carruth's large battlecard rendering JC initials. Third session in which a missing official photo has been reported. THE STANDING RULE Sean states with it, which outlives the instance: superintendent photos are almost always on the district site under a link that simply says superintendent, and they are captured everywhere. He allows that 85641 may not have been through the Arizona hunt yet, so this instance may resolve on its own; the standing rule applies regardless. The deliverable is how many districts across all four pilot zips lack a superintendent photo, then the hunt. Not reached by part2-0825.

**NH201** — The denominator Sean asked for, and it turned up a second finding larger than the one he reported. Half the school districts in the registry have no superintendent row of any kind, so a missing photo is not their problem yet - a missing person is.

**NH214** — Sean's standing rule from the 8/26 walkthrough: superintendent photos are almost always on the district site under a link that simply says 'superintendent', and should be captured everywhere. Audited 2026-08-26 across every roster: 42 bodies hold a roster, 6 are school districts, and 3 hold a substantive superintendent - Dr. Gabriel Trujillo (Tucson Unified), John Carruth (Vail Unified) and Michael Bessette (Interim Superintendent, Kearsarge). NONE of the three has a portrait. The other 3 school districts - Rockaway Township, Sunnyside Unified and Amphitheater Unified - hold no superintendent at all, which is a separate and larger gap. Note the correction that produced this number: a first pass read a photoUrl field off the roster member and reported 'NO PHOTO' for all three, and that field does not exist on RosterMember - photos live in the content-addressed asset store. The count is right; the first instrument was measuring nothing.

**NH227** — Seven governments that reach ZIP 85641 have been confirmed to govern there, but we have not yet listed the people who sit on them.

**NH228** — Five more governments might cover ZIP 85641. We have found each of them and we have not yet checked where their territory starts and stops, so we cannot say either way.

**NH230** — We know two measures will be on the 85641 ballot this November, and we have the school district's own legal notice for one of them. We have not yet read the county's official ballot, which is the document that actually decides what a voter sees.

**NH235** — The Central Arizona Water Conservation District's own board page names all 15 popularly elected members, their counties and their officers. The registry body now resolves to UNKNOWN_COMPOSITION - which is honest and is not the roster the reader is owed.

**NH236** — Every City of Tucson board, committee and commission now resolves to UNKNOWN_COMPOSITION, because each was previously inheriting the Mayor and Council through the division fallback. The City Clerk publishes each board's actual membership.

**NH244** — The Central Arizona Water Conservation District board is popularly elected and serves every reader in 85641 and 85701. All four Pima County seats carry terms expiring 12-31-2026, so they are on the 2026 general ballot. The ballot corpus contains no CAWCD contest at all.

**NH265** — The signed-bill and veto half of the gubernatorial record, which the corpus currently names as a gap.

**NH266** — The corpus holds 12 executive orders read out of 37 indexed, and the index was not walked to its end.

**NH278** — Mesa's own site lists dated council meetings, which is the first-party check on its Legistar tenant. parseClerkSchedule was written for Pima's HTML table; Mesa publishes a CMS calendar widget instead. Pointed at Mesa the existing parser returns zero rows, and a zero-row extraction is a FAILED extraction that would read forever as a city publishing no schedule of its own.

**NH294** — Lane A (2026-08-30) measured live routes and robots permission for 85641 bodies that have registry rows but no wired meetings/agenda route. Wirable with existing or trivial adapter classes: Tanque Verde USD board — Apptegy/Thrillshare org id 25, the exact keyless API class already wired for Vail (district site robots ALLOWED); Corona de Tucson FD (coronafire.org) and Sonoita-Elgin FD (sefd911.org) — Streamline class where sitemap.xml IS the dated meeting inventory, 115 and 70 dated sittings, both ALLOWED; Rincon Valley FD (rinconvalleyfdaz.gov) — first-party agenda+minutes PDFs, ALLOWED; Pima JTED (pimajted.org apex, not www) — 267 meetings 2009-2026, ALLOWED per docs/sources.md; Pima County RTA — listing HTML on rtamobility.com allowed while its PDFs are robots-disallowed, and the meeting PDFs actually live on pagregion.com (agendas, full packets, draft summaries), whose robots ALLOW them — host-per-document favors us.

**NH295** — Lane A (2026-08-30): Sahuarita USD No. 30's agendas/packets/minutes live at susd-30.community.diligentoneplatform.com — the same 23,479-byte blocked-bots robots file (User-agent: * → Disallow: /) as the four Highbond tenants already recorded. THEIR wall, named, never rendered as absence. The district's own site susd30.us is ALLOWED (Crawl-delay 5) and links a board-approved meeting calendar PDF hosted on files.smartsites.parentsquare.com — a host whose robots were NOT read this session (not fetched, so no claim about it either way). Tanque Verde's Highbond tenant (tanqueverdeschools.community.highbond.com) is the same wall for agendas, while its meetings are wirable via Thrillshare (see the wirable-now row).

**NH37** — Every Arizona officeholder's stored page URL carries a legislature number, and 67 of the 90 carry one that is not the current session: 5 at legislature 54, 23 at 55 and 39 at 56. Two of them surfaced as MISS-GENERIC in the officials audit - Rachel Keshel and Rosanna Gabaldon - and the rest are latent, waiting for their seat to be wired to a district.

**NH83** — Carried forward unchanged from AZ01. The 2026-08-23 session did not reach Arizona. Read as an image from the 8/22 capture of the ballot near 85701, the registration destination appears three times inside about ten lines: Check whether you're registered to vote as an inline link, the Secretary of State's own tool named beneath it, and a third box below the card repeating Check whether you're registered to vote. They deduplicate to ONE prominent pill pointing at the reader's Secretary of State, and the same pattern applies to polling location. The Secretary of State is the only authoritative source for either, and a reader who trusts an in-app answer and does not check loses their vote. AZ-1 also still needs hunting and fishing and state abortion law in Know the basics, both written to the plain-language register with the law stated, its source named and a fetch date, and no position taken.

**HD07** — Four people are running for Arizona's 19th state house district and ten things about them have never been looked for.

**HD08** — Four people are running for Congress in Arizona's sixth district and ten things about them have never been looked for.

**HD15** — Two people are running for Arizona State Mine Inspector and six things about them have never been looked for.

**HD16** — Three people are running for Arizona Secretary of State and six things about them have never been looked for.

**HD18** — Two people are running for Arizona's 19th state senate district and five things about them have never been looked for.

**HD22** — Three people are running for Governor of Arizona and four things about them have never been looked for.

**HD23** — Two people are running for Arizona's 20th state house district and four things about them have never been looked for.

**HD26** — Two people are running for Arizona State Treasurer and three things about them have never been looked for.

**HD27** — Two people are running for Congress in Arizona's seventh district and three things about them have never been looked for.

**HD28** — Two people are running for Arizona Attorney General and two things about them have never been looked for.

**HD29** — Two people are running for Arizona Superintendent of Public Instruction and two things about them have never been looked for.

**HD30** — One person is running for Arizona's 20th state senate district and one thing about them has never been looked for.

### P3

**NH245** — Wiring the verified CAWCD roster into BODY_ROSTERS needs a partisanship value, and every roster in that store cites the record that settled it. Neither the board's own page nor any statute reached on 2026-08-27 states whether these seats carry a party.

**NH279** — The Legistar tenant comment says a study session names no place, so those rows drop as unknownVenue — we know the sitting exists and not where it is. The city's own council-meetings page contradicts that: it prints City Hall (lower level) for study sessions. The rows could carry a place.

## Visual feedback

Everything arriving in Sean's twice-weekly batches — what the product looks like and reads like when he walks it.

**20 open · 40 resolved.**

### P1

**F01** — Sean's full walk of the product on 2026-08-18, forty-odd findings across cards, meeting order, votes, the ask box, the ballot and the map. The parent row that keeps the whole batch together; the individual findings became their own rows.

**NH183** — From the 8/25 Part 2 walkthrough, capture 17-17-53. Filters collapsed leaves a large empty white area between the FILTERS control and the sidebar's bottom edge; 17-18-13 shows the same sidebar with Filters expanded and no empty space, so the panel is holding its expanded height. Sean: floating empty space is not acceptable. THE PUSH-DOWN BEHAVIOUR WHEN FILTERS OPENS IS CORRECT AND PROTECTED — his words, I like that, I think that is smart — and the defect is only in the collapsed state. Not reached by part2-0825, which shed from the bottom of its item list after Item 8's WGH-11 half.

**NH296** — The owner recorded a testing pass on 2026-08-30 and left 20 screenshots plus a commentary document under feedback/8.30.26/. He states in it that these are systemic issues and must be treated as class-wide rather than as instances. This row is the intake obligation for that pass; it is deferred to the next session by the owner's own instruction on 2026-08-30.

### P2

**NH163** — Sean's 8/24 walkthrough of the app, recorded as sixteen captures between 11:54 and 12:27. Every id was built and verified against a local production build in the visual-0824 session, with the captures read as images. Opened as ONE row because they were worked as one item list and share one verification pass; the per-id endings are on the Session record and in the session's close-out. Kept open only until Sean has looked at the result — the work itself is done and the gates are green.

**NH184** — From the 8/25 Part 2 walkthrough, captures 17-34-50 and 17-41-20. DARK-2: the Speak Your Mind pill is navy with white text, which Sean likes in LIGHT mode and which fades into the background in dark. Everything else in dark mode is white on dark, so the pill inverts — lighter blue with black text. Light mode is unchanged. DARK-3: switching theme requires going back to the map; a toggle is needed on the ballot page itself and the setting persists across the session no matter where it is switched. The principle Sean states with them: anything whose job is to stand out needs a per-theme treatment, not one colour used in both. Not reached by part2-0825.

**NH185** — From the 8/25 Part 2 walkthrough. BAL-14 (SETTLED by Sean, third sighting): the View Battlecard control matches the width of the Would you vote for them? box per spec capture 17-35-14, and its colour is GREEN in both themes — green because it does not compete with the red and blue of party affiliation. BAL-16: collapse Where that money came from and What kind of money it was by default (17-41-20). BAL-17: no candidate photo on ballot battlecards, AZ and NJ (17-42-48). BAL-18: party affiliation renders as grey text and should be a coloured pill. BAL-19: the Speak Your Mind pill is absent from the ballot battlecard. BAL-20: incumbency is not stated and the ballot card is exactly where it belongs. BAL-21: the NJ registration deadline of October 13th 2026 has no Add to Calendar while November 3rd and in-person voting both do (17-44-07) — every date that matters gets the same treatment, audited across all zips. The map battlecard is the reference for all of them. Not reached by part2-0825.

**NH186** — From the 8/25 Part 2 walkthrough, spec-annotated capture 17-37-45, which red-boxes the campaign site, email address and mailing address blocks on Cory Booker's and Veronica Fernandez's ballot rows. The tagline is ALREADY in quotes and attributed as of this capture — In the campaign's words, corybooker.com, read 2026-08-14 — so that half is done. What remains: campaign site, email address and mailing address come off the ballot page and into the battlecard, and the battlecard's Sources section annotates that the ballot-card tagline comes from the campaign's own website. Sean's reason: we always want people to choose the battlecard, in the campaign's own words, and stripping the ballot page drives them there. Persistent across all ballots and all candidates; equal-effort-per-candidate applies, so the treatment lands for every candidate in a contest or for none. Not reached by part2-0825.

**NH187** — From the 8/25 Part 2 walkthrough, capture 17-46-00. Read as an image by part2-0825, and the diagnosis is NOT what the id implies. The two NO LOCAL ELECTION paragraphs are for DIFFERENT townships — Denville Township and Rockaway Township — so they are two legitimate records rendered as two near-identical sentences, and deduplicating the output would delete a true statement about one of them. The literal duplication is directly above them: two footnote lines reading Morris County Clerk filing, read August 25th, 2026, one marked with a dagger and one with a double dagger, same publisher and same date. That is the per-item source annotation RULING 138 says collapses to ONE line at the bottom of the card. Sean's instruction was to find why rather than filtering the output; this is the why. Not reached by part2-0825.

**NH188** — From the 8/25 Part 2 walkthrough. MAP-2: clicking a shaded area renders it off-centre — visible in capture 17-25-38, where the Vail Unified district sits in the bottom-right corner of the viewport. The map should move so whatever was clicked becomes front and centre, for every clickable area type: school district, state house district, congressional district, anything else. VOT-1: capture 17-23-22 shows an address entered in Vail and the top polling result at Ambassador Event Center, 3455 S Wilmot Road, Tucson — many miles away. Returning everywhere in the county is CORRECT and stays; the defect is the ordering. Draw a roughly 10-mile radius on the map around the entered address and surface the closest locations first, keeping the full county list available. Across the board, not scoped to the example. Not reached by part2-0825.

**NH189** — From the 8/25 Part 2 walkthrough. BC-26 (capture 17-28-02): John Carruth's large battlecard renders an Incumbent pill beside Local, and superintendents are not elected in the Vail School District — branch on whether the role is elected before rendering the label, and audit every non-elected role in the product for the same mislabel with a count. BC-27 (SPEC capture 17-28-27, red outline): What would you say if John Carruth were standing in front of you? sits flush against the bottom edge of the navy pill with no gap at all; padding and line treatment inside the pill change and THE LIGHT-MODE NAVY AND WHITE STAYS. BC-29 (capture 17-51-51): on the Kearsarge large battlecard the Speak Your Mind pill sits in a small scroll region of its own — it becomes a floating pill fixed at the bottom, only the board member list scrolls, and it is never covered by anything. Applies to every large battlecard with a scrolling list. Not reached by part2-0825.

**NH258** — State propositions get a plain-language summary and a part-by-part breakdown. The four local measures on the Pima ballot - the school-district budget overrides and the Permanent Base Adjustment - carry their sources and nothing else, so a reader meets a title and a Yes/No and no help at all with the one question actually about their own district.

**NH259** — Adrian Fontes and Kris Mayes render 'We haven't sourced who holds this seat yet' on their battlecards. Both are sitting Arizona statewide officers.

**NH260** — After an exact address, the who-governs card retires the invitation on bodies the address CONFIRMED but keeps it on bodies the address EXCLUDED - so the City of Tucson still asks a reader in Vail to add the address they already gave.

**NH261** — Clicking State House District 21 shows District 21's representatives in the popup while the panel beside it still shows the reader's own District 19. Two surfaces on one screen, two answers.

**NH268** — A school, congressional or local district is an area, and an area can lie across several legislative districts. Only a single point resolves to one. Vail Unified sits across Arizona Legislative District 19 AND District 17, measured over 44 probed points and 20 walked map layers, and so does the Corona de Tucson Fire District. The shipping registry already models this correctly, so nothing wrong reaches a reader today.

**NH271** — Most candidates on a rendered ballot show initials rather than a face. The gap is overwhelmingly New Jersey down-ballot: 117 Board of Education candidacies, 47 Borough Council, 27 Township Committee.

**VF05** — Five issues, NOT STARTED this session. MTG-1: the "Governs your area" pill overlaps the next meeting date in the meetings box. MTG-2: Meetings, then Rockaway Township Municipal / Township Council, opens MULTIPLE pop-ups at once — it should open the large battlecard for that specific meeting, one surface. MTG-3: the large meeting battlecard's location is not clickable and has no Add to Calendar; Add to Calendar exists under Meetings but Meetings has no directions. Directions and Add to Calendar must both be available from Overview and from Meetings. MTG-4 (ruled): assume the venue is missing from created calendar events and build it so the event carries the venue in the location field alongside date and time — a no-op if it already works. MTG-5: "Make Your Voice Heard" renders fully expanded and the reader scrolls past all of it to reach the next meeting; it becomes a collapsed drop-down with the content kept verbatim.

**M92** — Bodies and districts on the map still click straight out to a website. Sean and the tester both wanted a card that tells you about the thing first, with the website as one of the things on it.

### P3

**NH190** — Carried from the 8/25 MORNING walkthrough, whose document has never been placed in the repo — so the original wording is unavailable and these are derived from the Part 2 brief. BAL-12: measure every pill the product renders, across surfaces and both themes, and where sizes differ without a reason make them uniform; the voting-pill treatment named in BAL-22 is the reference. Report the denominator as N pills measured, K normalised. BAL-11: find both link-to-pill conversions in the code, capture them in place, and propose a placement with captures — shipping it where the correct placement is obvious from the surrounding layout, and presenting a RECOMMENDATION rather than a question where it is not. Not reached by part2-0825.

**VF01** — Read as an image on production f20e1e9 at 430x932. On the map's who-governs card the pill sits inline in each body row, between the body name and the type label. At phone width that squeezes the name into two and three lines - Rockaway Township School District wraps to three, Denville Township School District to three - and the pill itself wraps to two or three lines beside them. Every word is legible and the classification is correct; the row is simply cramped, and six of eight rows carry it at this zip. The pill reads well on the ballot page, where it wraps under a wide heading rather than competing with a narrow column. Worth a look at whether it belongs under the row rather than inside it on narrow viewports, or whether the type label should move.

## Data infrastructure

Sources, ingest, denominators, extraction, crawlers. The machinery that turns a public record into a row.

**93 open · 111 resolved.**

### P1

**NH215** — pnpm tenancy found morriscountynj.gov linking out to morriscountynj.iqm2.com/Citizens/LegalNotice.aspx. This project has an IQM2 adapter (lib/sources/iqm2/) and Morris County is the county containing 07866, the New Jersey pilot zip. It has never been connected. This is the cheapest coverage in the product: an adapter we already own, a tenant we already found, a county a reader is standing in.

**NH270** — A definition tells a reader what a body actually does. definitionsForBody is keyed on the DIVISION rather than the BODY, so every body sharing the Pima County division resolves to the Arizona county class definition.

**NH45** — data/ballot/candidate-hunt-state.json holds 136 candidate keys in TWO formats for the same people: a slug form, ballot-az-pima:governor:hobbs-katie, and a pipe-and-display-name form, ballot-az-pima:governor|Katie Hobbs. Thirty of the 136 are the pipe form and every one names somebody the slug form already names. candidate-cards-2026.json carries 20 of the same duplicates.

### P2

**ASK06** — lib/ask/ballot-inventory.ts retrieves sourced POSITION passages for a candidate - the candidate corpus's own quotes, with document URL and retrieval date - and nothing else about what they have done. lib/votes/ is congressional only, so a state legislator on the ballot who has cast hundreds of recorded votes contributes no vote record to an Ask answer, and an incumbent's answer is therefore thinner than the corpus can actually support. The evidence record class exists; the retrieval does not.

**D05** — Everything the product can say about a candidate from their own site, their own filings and their own voting record. Never an endorsement list — that is somebody else's judgement about them.

**D07** — Turning a street address into the exact set of districts a person votes in. Without it the product can orient a reader by zip but cannot promise them their own ballot.

**D08** — Pick the source that says which contests are on which ballot. The commercial-use terms are the first question to ask, because they decide whether the answer can ship.

**D36** — Twenty-seven candidates whose website and contact hunts were written down as never attempted. Each one finished is a candidate who stops being a name with nothing beside it.

**D50** — The second pass at candidate and official photographs, now that the author has opened the door for portraits a government body publishes about its own members. More faces on cards, each one carrying the door it came through.

**D52** — Turning each state's campaign-finance filing vocabulary into words a fifteen-year-old reads. Every state files differently, so this is a programme with one adapter per state rather than a single job.

**F02** — The product renders 186 congressional committee rows with no description of what any of them does. The text does not exist in the upstream file, so it has to come from somewhere else.

**F03** — Ten of the twelve bodies the product covers show an elected leader and no appointed one — no superintendent, no town manager, no county administrator. The person who actually runs the place is missing from the card.

**F11** — One family of school-district websites ships its page content as data hidden inside the HTML, and the product's reader comes back empty without saying so. Sized, deliberately not built yet, and named so the silence is not mistaken for an empty page.

**NH06** — Newbury's Selectboard and its three land-use boards are now read from two places at once: the vendor portals that carry agendas, and the town calendar that carries more dates. A merge decides which row a reader sees. That works, and nobody has measured whether it is the right arrangement over a few refreshes.

**NH110** — walk:all against production on 2026-08-23, deploy 6a8ba907304b640008d06090, reports one regression: lib/db/migrations/0016_known_cerebro.sql is in the tree and has not been applied to the live database. It creates three tables and nothing else - questionnaire_invitations, questionnaire_responses and questionnaire_tokens - with no ALTER and no DROP, so it touches no existing data. It arrived with the questionnaire stack merged in 9399a69. NO READER IS AFFECTED TODAY: nothing has been sent, all 272 invitations carry invitedOn null, and the route catches the failed insert and still serves the page. It becomes blocking the moment a candidate can submit an answer, because the answer would have nowhere to land.

**NH140** — Found while building the A-002 conservation contract. In boardbook, civicplus, diligent, clerksboards and legistar the counter TALLIES an online-only meeting that is then kept per D18; in iqm2 and revize the same field is a real drop with a continue behind it. One field name, two meanings, in a shared type. Conservation works around it with a declared countedButProduced term; the real fix is moving the kept-tally out of the drop counts.

**NH197** — Every meetings adapter clips to the same 90 days at fetch time and the snapshot stamps generatedAt minutes later, so every 90d-clipped source lands within about a day and a half of its own edge permanently, by construction. That is not eight sources about to fail; it is the architecture. R59's clerksboards failure was one of them crossing on a day when the gap between the two clocks happened to be wide enough.

**NH206** — Two different clocks decide two different things, and only one of them has an alarm. The F22 staleness guard measures a source's oldest row against the SNAPSHOT'S OWN generatedAt, so when it trips the refresh fails loudly at Validate before committing and nothing is written — that is the clerksboards failure of 2026-08-25 and it works. What a reader sees is clipped against NOW instead, and now keeps moving while a frozen snapshot does not. So every day the push stays blocked, more committed rows fall outside the serving window and quietly stop appearing on a reader's calendar, with no test failing and no run going red — because the F22 guard only runs while a refresh is being BUILT, which is precisely the thing that has stopped. Measured 2026-08-26: 0 of 449 rows have fallen out and the snapshot is 0.41 days old, so this is a mechanism rather than a live wound today. pnpm source:headroom now prints both clocks and the fallen-out count so the next session does not re-derive the distinction. What is still owed is an alarm on the second clock: something that goes red when the committed snapshot has aged past a stated threshold, independent of whether a refresh ever runs.

**NH217** — pnpm descent walked NJ, AZ and NH on 2026-08-26 and every one of the three ended with its final pass still producing: NJ queued 1,885 new links, AZ 1,986, NH 771. Under RULING 169 that means the walk stopped rather than finished, and the ledger says so on its own verdict line. Continuing is a matter of re-running with more passes and a higher budget; nothing is blocked.

**NH218** — The descent named 1,392 candidate governing bodies across NJ, AZ and NH that the registry does not already match. A candidate is a link whose text named a governing body. Confirming it is a body, resolving it to a division and minting an id is the next motion, and it has not begun. Until it does, these are a work queue in states/<code>/descent-candidates.md and not coverage.

**NH221** — The descent and Census-of-Governments promotions on 2026-08-26 wrote 723 registry bodies with ocdId null, deliberately: the descent knows the tier it walked and the host it read, and neither establishes which census division a body governs. Writing the state division for all of them would be a plausible guess in the one field a reader uses to decide whether a body governs THEM. Attaching divisions with real evidence is the owed work. tests/registry-oracle.test.ts already refuses a non-null ocdId that resolves to no division, so the guard is in place; what is missing is the evidence route.

**NH222** — Of 211 active governments in the 2022 Census of Governments clip for Pima AZ, Morris NJ and Merrimack NH, 35 reported no usable web address — Epsom Village District, Penacook Boscawen Water Precinct, Hardy Road Village District, BCEP Solid Waste District, seven Morris County township fire districts, and others. They are named in canonical state and are NOT absent: they levy, so somebody bills for them. The route not yet walked is the funder/auditor: NH DRA publishes municipal and village-district tax rate tables, NJ DCA Division of Local Government Services publishes fire-district budgets, and azauditor.gov publishes special-district reports.

**NH229** — Every Vail school board agenda and minute sits on two meeting platforms this product cannot read yet.

**NH231** — Our count of the governments covering a ZIP is built from each county's own roll. Districts formed in a neighbouring county but taxing land here are missing from it, and the shortfall looks like completeness.

**NH237** — The same government has a curated row and a descent-promoted row. The promotion's duplicate check compares names, and the two spellings differ by one word, so it did not match.

**NH255** — Measured 2026-08-27 while building the body-agenda rung. data/meetings-snapshot.json reports 198 agendaDocuments, but only 146 distinct documentUrls: 56 documents share a URL with another meeting. The four largest: bradfordnh.gov/pages/calendar on 27 meetings, warnernh.gov/calendar/ on 14, vailschooldistrict.community.highbond.com/Portal/ on 9, and govboard.tusd1.org/ on 6. ONE PAGE CANNOT BE THE AGENDA OF TWO DIFFERENT MEETINGS, so a document the same body reuses across sittings is a landing page by construction. Vail's is 1,652 characters of Highbond portal navigation plus the year's meeting schedule, and agendaItems correctly extracts zero items from it. THE READER CONSEQUENCE is now handled rather than hidden: the body-agenda rung returns AGENDA_LINK_IS_A_LANDING_PAGE for this shape instead of saying we hold an agenda with no items, which would be a claim about the government made out of a fact about our retrieval. THE COLLECTION DEFECT IS NOT FIXED. The adapters are attaching a calendar or portal ROOT to every meeting they discover there rather than fetching each sitting's own agenda. For the Highbond and CivicPlus calendar shapes that means navigating to the meeting inside the portal. Until that is done the corpus's own agendaDocuments count overstates how many real agendas it holds by up to 56, and any denominator built on it inherits the overstatement.

**NH27** — Springfield is one of Kearsarge seven member towns and had no bodies in this registry at all. Eight are now enumerated and recorded KNOWN_UNCOVERED. They are not wired because the town iCal export is capped at the OLDEST 50 events and stops at 2024-11-07 - six different views all return the identical stale document and the plugin REST API answers 404. The town has NOT stopped meeting: its own front page links events/cemetery-trustees-meeting-2026-08-11 and events/conservation-commission-meeting-2026-09-03 [expected-future: the town's own published meeting date, read 2026-08-21]. The live meetings are in the HTML, and no adapter here reads that shape for this town yet. Wiring to the stale feed would have shipped eight bodies rendering as having no meetings while the town publishes them.

**NH28** — Springfield was found by probing six conventional iCal paths against the town host - one request, and a town that had been dark since the registry was built produced eight named governing bodies. The same probe was run against Bradford, New London, Warner and Newbury; only Springfield and Newbury answered. Sutton at www.sutton-nh.gov does not resolve at all and needs its real host found. The remaining towns need the OTHER branches walked - vendor portals, board pages, minutes archives - rather than the conclusion that they publish nothing. Six of seven member towns were dark and this session moved one of them.

**NH29** — Springfield NH went from zero bodies in the registry to eight enumerated and the gap ledger is byte-identical at 22383 bytes before and after. The ledger measures special-district coverage against the Census of Governments, which is right and is not the whole of coverage: RULING 9 says the Census counts GOVERNMENTS and the product renders BODIES, and a New Hampshire town is one government and a dozen or more bodies. So the instrument that is supposed to say how covered a place is cannot see the unit the product actually renders. Six of Kearsarge seven member towns are dark at the body level and nothing measures that. This is a defect in the instrument rather than a gap in coverage, which is why it is a row and not a ledger entry.

**NH293** — NH288's fix serves sourced body names from BODY_ROSTERS for 12 of the 14 division-label bodies. The two remaining — ocd-division/country:us/state:az/place:mesa#governing and ocd-division/country:us/state:nj/school_district:morris_hills_regional_school_district#board — have no roster read yet, so no sourced name is held and nothing was invented. Classified: source exists, not ingested.

**NH301** — Found by running the shadow cycle over the real corpus. The meetings snapshot identifies a row's origin by provenance.sourceOrg - a PUBLISHER, such as Pima County - and the method store identifies a route by a method id, such as party-county-directory. There is no mapping between them, so methodMaturityFrom answers UNGRADUATED for every meetings obligation and all 78 dispatch to the bounded model worker. The digest's executor split is where this shows: 0 deterministic, 8 bounded. That reading is CORRECT and it is not the end state - it means the deterministic lane cannot currently be reached for this record class, not that no method exists. The fix is a join from a source adapter to the method route it implements.

**NH46** — One of the three coverageNotes in data/ballot/nh-merrimack-2026.json ends with a paragraph of internal record-keeping that reaches a reader on the ballot page: 'CORRECTED 2026-08-21 under RULING 52: this note used to end ... That was true when it was written on 2026-08-14 and is FALSE now - re-walked 2026-08-21, gc.nh.gov answers a plain rung-2 fetch at HTTP 200. A wall is recorded with the date it was last tested...'

**NH75** — Playwright's extraHTTPHeaders applies to EVERY request a context makes, third parties included. MapTiler's CORS preflight does not allow x-wtp-synthetic-run, so the basemap style request was refused in every capture and every walk. That is why NJ Hunt 5's captures showed BASEMAP UNAVAILABLE against a production site serving readers a working map. Fixed at the shared path in scripts/browser.mts. This row is open for the QUESTION IT RAISES rather than the fix: what else has an instrument of ours been breaking while measuring it? The shape - a synthetic marker leaking into a third-party request - is worth sweeping for beyond the browser.

**NH79** — pnpm dupes reads 2114 function bodies across 806 files and finds 26 groups where the same logic lives in more than one file. Two were consolidated on 2026-08-23: four copies of the outbound User-Agent, which CLAUDE.md makes law, and two of the person-name normaliser, one of which sat inside the tool that CHECKS whether the same person is shown twice - so the audit was using a different definition of a person from the resolver it audits. The other 24 are recorded in tests/duplicate-implementations.json with a disposition and a reason each. Six are ALLOWED for reasons that hold: the two intake key paths must stay unable to converge because the stores may never join, React context accessors are three identical lines by construction, and the .mjs date helper cannot import TypeScript because the pre-commit hook runs without tsx. Eighteen are OWED. The guard fails on a NEW group, so the class cannot grow while the backlog is worked, and the baseline only shrinks. The heaviest three: six byte-identical useSyncExternalStore subscribe callbacks across the hooks, four separate CSV parsers with the tracker stores downstream of two of them, and - the worst of the set - tests/district-hits.test.ts carrying its own copies of inRing, inPolygon and contains, so the test that checks point-in-district geometry proves its own copy works and says nothing at all about the shipped one.

**NJ03** — lib/sources/http.ts gives the Cloudflare interstitial signature a 20 KB maxBytes floor, with a comment explaining exactly why: Cloudflare injects its challenge-platform script into ORDINARY pages, so reading the marker at any size would mark a working source refused. The Imperva/Incapsula signature has no such floor, and Imperva injects _Incapsula_Resource script tags into ordinary served pages in the same way. Swept on 2026-08-22 with git grep -a --untracked: no committed fixture currently carries the marker in a real page, so this is a LATENT risk and not a live defect, which is why it is a row rather than an edit. Diagnose before fixing applies with force here — changing a challenge detector without evidence would risk the opposite failure, a real wall read as a page. What would settle it is a recorded fixture of a large Imperva-fronted page that is genuinely served, which www.nj.gov can supply.

**PB02** — Nobody publishes boundaries for special districts — fire, water, irrigation, library — so the product cannot tell a reader whether they live in one. They are 43.55% of every government in the country, and this is the largest single hole in the coverage promise.

**PB05** — School districts are matched between two federal files by name, because neither file carries a shared identifier. Roughly 4,000 do not match. The proper crosswalk exists and has to be acquired.

**PB08** — LegiScan already supplies bill text and votes. What is unread is the rest of a state legislator's record — who sponsored what, which committees they sit on, how long they have served — which is most of what a state card should say.

**PB09** — Congress.gov's own API, unread. The product already reads roll calls straight from the House and Senate clerks; this adds cosponsorships and committee membership, which is how a reader sees what a member works on rather than only how they voted.

**PD01** — Roughly four million people in Washington DC and the five territories are shown no federal representative at all, because their at-large district is missing from the registry. The six people are real, non-voting members of Congress, and their constituents currently see nothing.

**PD03** — When a reaction's location lookup fails, the row is written with an empty list of districts rather than a recorded failure — so a lookup that broke is indistinguishable from a place with no districts.

**B14** — Every candidate on every ballot gets a one-line description of themselves, taken from their own words and cited. The hunt is run just as hard for everybody in a race, which is what stops the cards tracking who could afford a website.

**D03** — State legislators' voting records, all fifty states, from Plural Open. Today a state legislator's card can say who they are but not how they voted.

**D06** — Where a candidate's money comes from — top sources, how concentrated it is, and how much came from inside the district they want to represent.

  Waiting on candidate info (D05).

**HUNT02** — Nobody publishes a list of the boards and commissions inside a government. The Census counts governments; readers need bodies. Until a government's boards are enumerated, there is no honest denominator for how much of it the product covers.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

**HUNT03** — Coverage records written before the product knew how to get past several kinds of wall. Each one re-walked is a public body that becomes visible after having been written off.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

**M123** — Six towns around Newbury hold meetings inside the radius a reader at 03255 sees. The routes to their calendars have been walked and written down; none of them is wired, so those meetings do not appear.

**PB03** — A reader for agenda data hidden inside a page's HTML rather than published at an address. Without it, whole families of school and municipal sites come back empty and look like places with no meetings.

  Waiting on body enumeration per unit - the missing second layer of the who-governs denominator (HUNT02).

**PB04** — The list of towns on the CivicPlus platform covers about 12% of its customers and most of it went stale in 2020. Every town missing from that list is a town whose meetings the product cannot find.

  Waiting on embedded-json extractor, sized against f01c2's blind spot (PB03).

### P3

**AUD05** — Meetings are found by scanning the whole snapshot rather than looking them up. It works at today's size and gets slower with every place added.

**AUD08** — Meetings are matched to a location without a spatial index. Same shape as the row above: correct now, and the wrong shape at scale.

**D25** — For every body the product watches: whether there is a public comment period, when it falls, how to sign up, where to send something in writing, and how long anybody gets to speak. The difference between knowing a meeting exists and being able to be heard at it.

**D46** — Showing who sponsored and funded each ballot measure. The tester argued both sides and Sean has not decided, so it is parked rather than half-built.

**D62** — A research corpus of everything all 535 members of Congress have said publicly since 2022. It would give a member's card its third leg — votes show what they do, money shows who funds them, this shows what they say.

**D69** — The Montana school-district disagreement, recorded as its own investigation. Named separately from the row above so the discrepancy has somewhere to be resolved rather than being carried as a caveat forever.

**DI01** — pnpm nj:filing reports 42 seats a party filed nobody for, and entry 28 is "Morristown Town -- NO LOCAL ELECTION (Democratic)". NO LOCAL ELECTION is a jurisdiction-level statement in the clerk's document, not an office, so a row carrying it as an office is a bleed between two record types the parser already separates elsewhere -- the same class NJ2 playbook entry 7 describes. It does not reach a reader (the 42 are a finding stated in the report, not a rendered surface) and the total still reconciles, which is why this is P3. The count of 42 should be read as 41 unfilled seats plus one parser artifact until it is fixed.

**DI02** — The wikipedia-government-graph crawl enumerates governing bodies the registry has never held, most of them state executive departments, agencies, boards and commissions. Each carries its own official site harvested from the article's infobox and External links block. What is NOT yet done is the second hop: fetching each of those official sites and finding the meeting, agenda, hearing or calendar page on it, so the body becomes a reader surface rather than a name in a file. The crawl records meetingLinks where Wikipedia itself linked one, which is rare - an encyclopedia links a department's home page, not its hearing calendar. The work is a pass over data/hunt/wiki-graph-07866.json that walks each harvested official site for the schedule, and then wiring what it finds into the meetings composite the same way every other source is wired. Whether appointed officials RENDER is a separate question and is on a Needs Sean row; their meetings are not in question.

**NH07** — Merrimack County's department pages all load cleanly and all of them list their staff in a table our reader cannot understand. It is a different table shape from the one we built for. Nobody has looked at how many other counties use it.

**NH102** — Found 2026-08-23 walking unitedstates/images at commit aec3e4a88af843b282c0576f420b930f6a9a46ad. H001104 Jon Husted, A000383 Alan Armstrong and G000608 Darline Graham are sitting members and the GPO pictorial-directory corpus carries no file for any of them. This is a FINDING about that corpus on that date, not an absence of a photograph: the photo rule's doors 2, 3 and 4 are unwalked for these three, and RULING 53 puts the corpus itself on a 14-day re-walk. NOT a gap-ledger row because it names three PEOPLE and a route, not a body's coverage.

**NH117** — pnpm bodies:spanning, built 2026-08-24 for RULING 121, finds bodies carrying the same name under more than one division. Two were merged this session because Sean ruled on them by name - Lake Todd Village District and the New London-Springfield Water System Precinct. Ten more share a name and have NOT been merged, because a shared name is not proof of a shared body: a Master Plan Committee in Wilmot and one in Grantham are almost certainly two committees, not one.

**NH16** — Bradford, New Hampshire publishes every agenda and minute set on a vendor platform this product has never seen. Its own town website carries no boards index and no calendar, so the vendor is the only route to the town's meetings.

**NH17** — The consolidated miss list says newbury.nh.gov/sitemap.xml is a 403 and that robots declares none. It answers HTTP 200 at 43,484 bytes. A sitemap is the discovery rung for every page on a site, and this one has been closed to us on a stale reading.

**NH211** — Walked 2026-08-26 while looking for a route that geocodes a STREET rather than an address - which is exactly what the narrowing chip wants and what the onelineaddress endpoint cannot do. tigerweb.geo.census.gov answers robots.txt with HTTP 200 carrying a WAF body: 'The requested URL was rejected. Please consult with your administrator.' That is a 200 that is not a document (RULING 93), so the may-we-walk verdict is UNKNOWN, and RULING 148 says unknown REFUSES. No route was built. It is worth a decision because the host is the Census Bureau, already an approved source (D53), publishing the same TIGER data this product already ships committed - so the refusal is about reachability and permission rather than about the source.

**NH219** — pnpm tenancy separates bodies on a platform we already read from bodies on a platform we merely recognise, because those need completely different responses. The second column across NJ, AZ and NH holds 17 hosts on eCode360, Granicus ViewPublisher, PrimeGov, CivicClerk, eSCRIBE and NovusAgenda. That is scoped work — we know the vendor — as distinct from the 87 hosts where nothing machine-readable was detected at all, which is a hunt.

**NH239** — CAWCD's own 2026 schedule lists board meetings on 3 September, 1 October, 5 November and 3 December. The snapshot carries September and stops.

**NH257** — lib/signal/taxonomy.ts inventories every live collection point and names three the product does not have: a reader who emails their board president, follows a citation to an agenda or opens an online-meeting link does so through an ordinary anchor and no row is written anywhere. They are recorded as gaps rather than omitted, because an omission from a taxonomy reads as coverage. Whether to collect any of them is a privacy decision before it is a product one - each would be a new class of behavioural record about a reader, and the Ask store's own capture is gated pending exactly that kind of approval.

**NH39** — James Gallagher, a U.S. Representative sworn in on 2026-06-10, has no websiteUrl at all - the congress-legislators dataset this registry reads has not yet published his House page. Kate Murray is the one New Hampshire officeholder pnpm nh:fix-pages could not repair, because she is not on the General Court's current roster; a former member's page is the archive's hunt.

**NH40** — cfs.sos.nh.gov holds first-party contact details for every New Hampshire candidate who registered a committee, and it refuses rungs 2, 3, 4 and 6 with an Akamai 403 - headless Chromium, a real Chrome channel and a masked user agent alike. A visible browser on the same machine and the same IP gets HTTP 200. It was harvested by hand this session through the app's own XHR at rung 7, which is a procedure and not a script, so nothing in CI can repeat it.

**NH42** — pnpm twig:pair reports 48 government units inside 03255's first-rung circle, 28 with a body in this registry and 20 without. Seven of the twenty are not missing a body so much as missing a DIVISION: Sullivan County itself, and the towns of Lempster, Croydon, Newport, Windsor, Acworth and Grantham are not in the shipped division list at all, so no body could be attached to them.

**NH53** — The walker covers 7 of the 36 manifest routes mechanically. Per field that leaves 4 of 7 photo routes, 8 of 10 blurb, 29 of 35 contact, 10 of 14 campaign site and 6 of 8 verified page needing a person — reported by name on every run, never counted as walked. Each route automated is a whole class of candidate the manifest can be exhausted against without a session reading pages one at a time.

**NH54** — A statewide New Hampshire candidate-and-results database exists at electiondatabase.nhpr.org and nh.electionstats.com. Every /candidates/view/<Name> URL from the search index returns the SPA's 404 shell — 41,148 bytes, identical for a known-good name — and rung 6 confirms a genuine 'Page Not Found'. The path has moved. It would serve many candidates at once if found: prior candidacies, districts, and results.

**NH70** — New Jersey has two places named Silver Lake, Census GEOIDs 3467590 and 3467650, and placeIdentity keys on state plus name, so both slug to state:nj/place:silver_lake. The widened geometry clip surfaced it and the build refused to write, correctly - a duplicate join key is a join that collapses. It is fixed for the build by suffixing EVERY side of a collision with its Census GEOID, and the underlying identifier convention is still not unique.

**NH87** — RULING 107's wider sweep found this and it is the one site of 31 that is a real restamp rather than a reading path. scripts/ship-staged-portraits.mts writes collectedAt: new Date() on every portrait it commits (lines ~175 and ~193), but the collection happened earlier, when the portrait was STAGED from Wikimedia Commons. The ship step is not the read. It cannot be fixed where it stands, because the staged ResultRow carries no collection date to carry forward - so the fix is in the STAGING step, which has to start recording one, and then the ship step carries it rather than minting. Until then the provenance date on every Commons portrait is the day somebody ran the shipper. Pinned in tests/freshness-provenance.test.ts as the single entry of KNOWN_UNDECLARED, a baseline that may only shrink; run pnpm freshness:audit --all to see it.

**NH95** — pnpm schools:classify reaches 510 of 514 rendered districts across five one-to-one branches, up from 295 of 514. The four it does not reach are named on every run and each was read by hand against the committed Census files: AZ Indian Oasis-Baboquivari Unified District, which the 2022 Census of Governments spells BABOQUIVARA; AZ Tonto Basin Elementary District, which the Census calls TONTO SCHOOL DISTRICT 33; AZ Union Elementary District, whose whole distinctive name is the word Union — a structural word in every district name in the country, so it cannot be keyed; and NH Prospect Mountain High School Joint Maintenance Agreement District, which is not in the 2022 Census of Governments at all and is therefore RULING 57's two-enumerations-disagree finding rather than a miss. None of the four renders a refusal: they carry the unclassified-school class definition, which describes what a school system is and names the open question rather than asserting who governs the schools. WHAT WOULD CLOSE IT: a hand-evidenced alias table, which needs a source a session can cite for each pairing — NCES state_leaid does not decode to the Census district number, so the join has to come from somewhere with network.

**NJ05** — suttonnh.gov/sitemap.xml answers HTTP 200 with a valid sitemap containing exactly one URL: https://d9template1.civiccms.acsitefactory.com/ — the vendor's Drupal 9 template host, not the town. Rung 10 of the retrieval ladder is sitemaps and search-index caches, and on this CMS family that rung returns the vendor and none of the body's own pages. A session walking rung 10 here would read a well-formed sitemap, find no board pages in it, and have no signal that anything was wrong. Recorded 2026-08-22. Worth checking across the CivicPlus D9 tenants this project already knows before it is treated as one town's misconfiguration; data/reference/civicplus_tenants.csv is the list.

**P12** — Showing readers what other readers answered. Sean tabled this: it anchors the next respondent and corrupts the very data being sold. Recorded so nobody builds it by accident.

**PB01** — Two federal sources disagree about how many school districts Montana has — 387 against 311, with nothing to account for the gap. Until it reconciles, the product cannot state a district count for Montana or any national figure that includes it.

**PB06** — Two small, named holes in the national map: 35 government boundaries that landed in no zip at all, and 1,599 real postal zips that have no mapped area, so no place can be resolved for them.

**PB11** — The Census Bureau's own data service is unused. The product reads Census boundary files offline, which give shape but no people — no population, no income, nothing about who lives in a place.

**PB12** — Lobbying disclosure data. The repo fetches none of it — not partially, not at all — and this row says so plainly rather than leaving a half-built impression.

**SRC01** — A Census Bureau API key sits unused. The product reads Census bulk files instead, so the key buys nothing until something wants live population or income figures.

**SRC03** — A data.gov umbrella key sits unused, and an earlier session reported it did not exist. It does — it is in the environment file — and this row corrects the record.

**SRC04** — The government publishing office's API, sized and deliberately not built. The row records the decision so a later session does not re-open the question from scratch.

**V13** — A municipal agenda vendor nobody here had met, found while walking Bradford, New Hampshire. Wiring it reaches meetings that are currently invisible in several New Hampshire towns.

**D04** — How your own city council voted. It sits in unstructured minutes nobody has parsed, which is exactly why it is worth doing and why nobody else has.

**D51** — Money spent about a race by groups that gave the campaign nothing. It reads completely differently from a contribution and has to render differently, or a reader will read it as the candidate's own money.

**HUNT06** — Re-running each new capability against the place it was built for, so its cost is measured in steady state rather than mixed in with the cost of inventing it.

  Waiting on the 03255 depth sweep across the full body universe (HUNT01).

**M95** — The three state governors' cards carry no term end and no date of birth, so those lines correctly say nothing. Federal members already have them.

**SRC02** — A lobbying-disclosure API key sits unused. The credential half of the row that says the product fetches no lobbying data at all.

  Waiting on lda lobbying disclosure - currently fetching nothing (PB12).

**V09** — Accela, one of four permit and zoning platforms Sean approved in principle. These are the records that answer "is there a data center coming?" before it is built.

  Waiting on "is there a data center coming?" (A03).

**V10** — Tyler EnerGov, the second of the four permit and zoning platforms. Approved in principle; needs its own clearance.

  Waiting on "is there a data center coming?" (A03).

**V11** — OpenGov Permitting & Licensing, the third of the four permit and zoning platforms. Approved in principle; needs its own clearance.

  Waiting on "is there a data center coming?" (A03).

**V12** — CityView, the fourth of the four permit and zoning platforms. Approved in principle; needs its own clearance.

  Waiting on "is there a data center coming?" (A03).

## Product / UI

How the app behaves and reads — surfaces, flows, wording, features. Distinct from how it looks in a feedback batch.

**48 open · 141 resolved.**

### P1

**ASK01** — Ask used a model for one thing only — picking one of sixteen curated topic ids, with no civic context supplied at all. It could not read a tense, could not expand an alias, and never saw a record. This row is the rebuild: Claude interprets the question against a real entity inventory and today's date, deterministic code reconciles that hypothesis against the registry and retrieves only records belonging to the resolved ids, Claude explains those records, and structural validation rejects an answer that reaches past them.

**ASK02** — bodyAgendaAnswer selected `upcoming[0] ?? past[0]` for every question that named a body and asked what it was discussing. So 'What did Vail discuss at its LAST meeting?' was answered with the agenda of a meeting that has not happened yet. The government, the attribution, the source link and the retrieval timestamp were all correct — it was a wrong answer wearing a complete provenance record.

**P02** — Mapping candidates' stated positions onto the issues on a reader's ballot, every one carrying its source. Never a score, never a ranking — the positions side by side and the reader deciding.

  Waiting on candidate info (D05).

### P2

**ASK04** — Ask was absent from the ballot entirely: AskBox mounts only inside PillCluster, which is constructed only in map-entry.tsx. A reader looking at their ballot — the surface where they have just been asked for the most and have the most questions — had no way to ask one. components/ask/ballot-ask.tsx posts to the same /api/ask/grounded engine and contributes the ballot's own context: the contests and candidates actually rendered, which is what lets a referent resolve and what makes it refuse when more than one person is on screen.

**ASK05** — The map Ask box now posts every ask to /api/ask/grounded, and the agenda route is retained ONLY for the topic sweep - 'is there a data centre coming?' - a keyword search across every readable agenda in the reader's area. It is called with scope: TOPIC_ONLY and the route refuses to answer a named body's docket under that scope, so the boundary is enforced in the server. The remaining question is whether the topic sweep should become an INTENT of the grounded engine rather than a second call beside it: it answers a real question the grounded path cannot, but it renders its own block with its own denominator sentence, which is a second shape of answer on one screen. Not a defect today; a design decision worth making deliberately rather than by accretion.

**NH104** — Opened 2026-08-23 by the session that built the instrument. WHAT EXISTS: the versioned five-question instrument (lib/questionnaire/instrument.ts, docs/candidate-questionnaire.md), the office-class classifier, the response record with versioning and withdrawal, the single-use token auth, the three Positions empty states wired into the battlecard, the Drizzle schema and migration 0016, and 272 of 272 generated invitations. WHAT DOES NOT EXIST: (a) the reader-facing page a candidate opens their link on and types into, with the word-limit check shown as they type; (b) the send path - and per RULING 107 it must stamp invitedOn AS IT SENDS, never from the plan, because the Positions empty state reads exactly that field to decide whether to tell a reader we asked; (c) the reminder job on the two planned dates; (d) the read path joining a stored response onto the battlecard Positions section. NOTHING may be sent until the Needs Sean row approving the message is answered.

**NH193** — Sean RULED on this in the part2-0825 brief and it is no longer a question: build it, try it while it's in testing. Capture 17-49-29 is the current behaviour — why is it raining returns We don't have a sourced answer for who owns this topic yet. The constraint is not optional and is the whole reason it is allowed: a sourced civic answer and an unsourced general answer must NEVER be visually or structurally confusable. Unsourced answers are explicitly and visibly marked as unsourced in plain language a fifteen-year-old reads correctly, not a footnote and not an asterisk; they carry NO Sources section and never borrow the sourced answer's chrome; the routing sits behind a named flag that is ON in testing so it can be turned off in one place without a code change; and if a question can be answered from sources it IS — the fallback is last, never first, proved by showing a civic question still answering from sources after the change. ANTHROPIC_API_KEY is present and was PROVEN live by pnpm credentials on 2026-08-25. Not reached by part2-0825.

**NH249** — The tester's words: jurisdiction types may rely too much on colour. If the only thing distinguishing a county boundary from a school district is hue, the distinction is unavailable to a reader with a colour vision deficiency and weak on a low-quality screen in sunlight. P2 rather than P3 because this is an accessibility question rather than a taste one, and because a reader who misreads which government a boundary belongs to has been told something false about who governs them. Recorded as stated; the actual encoding has not been audited.

**NH251** — Found while repairing the Vail-to-Sunnyside substitution on 2026-08-27. The question that started it — what is on the Vail school district agenda — never reaches the agenda corpus at all. /api/ask/agenda answers a TOPIC within a scope (data-center, warehouse, rezoning, cell-tower) and agendaTopicFor returns null for a question that names a body and asks what is on its agenda, so the agenda rung says nothing and the question falls to topic routing, which names bodies rather than agenda items. Meanwhile the corpus DOES hold what the reader asked for: Vail Unified has 11 meetings and 9 readable agenda documents in data/meetings-snapshot.json. The entity binding now stops the wrong body answering, and /api/ask/agenda binds retrieval to a named body when one resolves, but nothing routes this SHAPE of question into that path. THE SPEC: a body-agenda intent — what is on X's agenda, what are they discussing, what is happening at their next meeting — resolves the named body, takes that body's next or most recent meeting, and answers from that meeting's own agenda items, saying the true thing when the meeting is known and the agenda is not published, not fetched, or not extractable. Never a generic civics explainer when exact body agenda data exists.

**NH262** — At 2000px the ballot renders in a narrow centred column with large empty margins either side. The mobile layout itself is fine; the desktop one simply does not use the space it has.

**NH263** — Sean could not find the Ask feature in his own product. It sits below every contest, below the footnotes.

**NH269** — A reader deciding whether they can attend should learn that a meeting has no room to walk into before they open it. The main meeting list already says Online. The door overlay next-meeting line and the Ask autocomplete do not.

**NH297** — The standing walk names this regression on both the 2026-08-30 baseline run and the verification run after the walk speed-up. It reads 0 jurisdiction(s) carrying 0 recorded rung(s) where g21 shipped rungs. Pre-existing at this session's start on 608623c5 and untouched by A.1.

**NH58** — When map tiles do not load, the reader-facing panel reads: 'BASEMAP UNAVAILABLE — Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use'. An environment-variable name and a source file path are internal identifiers and may not render outside a technical-details disclosure.

**NH61** — RULING 70. Ballotpedia's Candidate Connection works because candidates volunteer answers and identity is verified before publication. The mechanism is not licensed and is worth more than the content: a questionnaire on this product's own site is original data with no licence, no copyleft and no dependency, and it is symmetric by construction because every candidate in a contest gets the same invitation and the same questions.

**PU01** — Read as an image on production 2026-08-22 at 430x932. The map at 07866 shows a panel reading "BASEMAP UNAVAILABLE -- Map tiles didn't load. Pins and meeting details still work. Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to use". That is an environment variable name and a dotfile path rendered to a reader, which the plain-language rule forbids outside a technical-details disclosure: identifiers, enum values and internal keys never render to a reader. The honest half of the message -- that tiles did not load and pins still work -- is right and should stay. Two questions for whoever takes it: whether the key is simply unset on the production deploy (in which case the message is doing its job for the wrong audience), and what a reader should see instead.

**PU03** — NOT STARTED this session. ASK-1: "When is the next meeting?" returns "Where to look: Meetings near you" and explains that the map shows collected meetings, with nothing to click. Give the reader a control right there, tappable on mobile. NH-3: "When does school start again?" returns "we don't have a sourced answer for who owns this topic yet" — the school district owns this and it must be routed. THE STANDARD FOR BOTH is NH-2, which Sean called out as the thing to replicate: coverage disclosure with denominators (35 agendas read, 9 more held but unreadable and therefore excluded), honest gaps, the relevant record surfaced, and a NAMED HUMAN with a phone number and an email. He called the contact details the best part.

**PU05** — The 8/22 brief said to fetch the Census ZCTA-to-congressional-district relationship file — free, keyless, national. MEASURED 2026-08-23: NO SUCH FILE EXISTS for the current Congress, and four Census directories were walked to establish it. rel2020/zcta520/ holds six files and none of them is CD. rel/ holds only zcta_cd111_rel_10.txt, the 111th Congress with 2010 ZCTAs — two rounds of redistricting stale. rel2022/ and rel2024/ hold Connecticut-only files. baf2020/'s CD assignment file is dated 2020-12-11 (116th) and baf/'s is dated 2011-01-21. WHAT IS OWED, and the machinery for it already exists: scripts/build-zip-governments.mts samples every ZCTA on a 0.01-degree lattice against TIGER cartographic boundary layers and has been verified across all 33,791 zips. Adding a cd layer to its LAYERS list gives per-zip congressional-district sample counts nationally, and the existing partial-versus-whole arithmetic then answers "one district or more than one" for every zip in the country by exactly the method the who-governs pill already trusts. 07866 itself is settled independently: it sits entirely within NJ-11, confirmed against the House zip lookup.

**M75** — On a phone, the map's legend crosses the bottom of an open meeting panel and covers the text underneath it.

**P03** — The one-tap yes or no, with an optional free-text answer, asked after the explanation and attached to a specific provision or a specific sourced position. This is the revenue path.

### P3

**ASK07** — Both Ask surfaces hold the last four turns in memory so 'and what did they decide?' has a referent, and neither persists it - closing the panel or leaving the page ends it, which is the correct privacy posture and is stated as deliberate rather than accidental. The consequence a reader can feel: on the map the panel is behind a pill, so dismissing it and reopening it loses the thread mid-conversation. Worth deciding whether the context should survive a panel dismissal within one visit. It must never survive the visit.

**AUD09** — The animation that flies the map to a state has no agreed speed budget, so nothing can tell whether a change made it slower.

**B18** — Sean asked for federal officials' town halls. There is no authoritative feed for them anywhere, so this row records what was checked and what it found rather than pretending a build is waiting.

**M13** — The radius control broke twice — once blanking results, once refusing to switch off — and both times the tests only covered the logic underneath, not the control a reader touches.

**NH141** — Found by the A-007 sweep for catch-return-valid shapes. lib map districts.ts returns an empty array when queryRenderedFeatures throws, so an exception is indistinguishable from a viewport with no districts in it. Nine other sites of the same shape were assessed and fail closed; this one does not, and how it should behave is a visual decision.

**NH167** — LAY-4 puts Who Governs Here and the meetings count in a floating region beneath the rail, and both live in one fixed flex column so they cannot overlap at any viewport. At 1440x900 the rail wants 662px and the who-governs card wants 350px or more against 876px of column, so they do not both fit and something is always scrolling. The rail is capped at 58% of the column: at 70% the card had 100px, less than its own header. Both scroll internally so nothing is unreachable either way, and WGH-6 is the real answer - clicking Who Governs Here minimizes the rail and the card takes the whole column. The number decides what a reader sees BEFORE they choose, and it is the kind of call worth looking at on a real screen.

**NH168** — MTG-6 titles a venue card with the body and MTG-7 puts the sitting's own name on the entry beneath. Where a source publishes a DIFFERENT bodyName per sitting - Tucson Unified does, with names like GOVERNING BOARD AGENDA SPECIAL MEETING - the entry carries something distinct and it reads well. Where a source publishes ONE name for every sitting, as Tucson Parks and Recreation does, the entry repeats the card title. Sean's own reference capture 12-01-44 shows the same repetition and he marked only the jurisdiction prefix, so nothing was changed here. Worth a look on a real card: the honest options are to drop the entry title where it equals the card title, or to leave it as the anchor for the date and the agenda link.

**NH199** — Two props the map passes down the who-governs card reach the bottom of the chain and are never called. Found while clearing lint warnings, which is the only reason anybody noticed.

**NH238** — The body is listed in the sidebar's Bodies door and opens its card from there, and typing its name into the ask box offers no Body row at either Pima ZIP.

**NH247** — The tester's words: the landing page undersells the functionality behind the hook. A reader arriving at the entry screen does not learn that the product will show them their ballot with sourced positions, translate measures into plain language, name the bodies that govern their address and list nearby meetings — they get the hook and a zip prompt. Recorded as the tester stated it; the product path has not been inspected and no redesign is prescribed here.

**NH248** — The tester's words: map boundary density is hard to parse. With several overlapping jurisdiction layers drawn at once a reader cannot easily tell which boundary belongs to which government. Recorded as stated; no redesign prescribed before the product path is inspected.

**NH250** — The tester's words: the left-side information is dense, and filters or progressive disclosure may help. Recorded as the tester framed it, including that the remedy is a suggestion rather than a finding. Note that reader friction is a defect with only three checkable exceptions, so any progressive-disclosure work has to be argued as reducing friction rather than adding a click.

**NH252** — The named-entity binding rung reconciles the government a reader names against an inventory built from the search index and the reader's own covered bodies. Both are scoped to the reader's area, so at 85706 the question about Vail resolves to UNRESOLVED — we do not have a government recorded under that name — even though the product holds Vail Unified with meetings and agendas. That is HONEST and is a large improvement on answering about Sunnyside, and it is weaker than it needs to be: BOUND is available if the inventory reaches every body the product holds rather than every body near the reader. The trade is index size on the client, which is why it was not simply widened.

**NH267** — The map's filter line reads '60 meetings · 1 venue' at 85641. The served set for that view holds 147 meetings across 15 distinct venues, 61 of them placeless.

**NH292** — lib/ask/inventory.ts's titleCaseName capitalizes every word, so the sourced body name 'Pima County Board of Supervisors' reaches pack.subject.name and the reader surface as 'Pima County Board Of Supervisors' — the particle 'of' wrongly capitalized. Observed on production 2026-08-30 in the post-deploy reader verification of the NH288 fix (synthetic run session-2026-08-30-lane-b-after).

**NH62** — Recorded so no future session re-derives Ballotpedia as an available branch and starts building one.

**PU06** — Measured 2026-08-23 at 07866 against a local production build: TWELVE instances across NINE contests on /ballot, unchanged by this session. The MAP panel was fixed — six rows each carrying the full sentence became six asterisks and ONE pill, read as an image — but the ballot page renders the pill per contest heading, which RULING 28 permits and which Sean nonetheless called the headline UX problem of the New Jersey pass. WHAT IS OWED: decide whether the ballot page takes the same treatment (one page-level pill, marks on the affected contests) and, wherever the sentence survives, make it one clear deliberate annotation, bolder and more explicit than the current small text. It is not a completeness statement and it never gates a page.

**PU07** — Measured 2026-08-25 against a local production build at 07866. The SERVER is fast — TTFB 22-94 ms — and the browser sees FCP 1,760 ms on the first cold navigation against 156-164 ms warm, DOMContentLoaded 62 ms, load 185 ms. So there is nothing to fix in the render path and the number that matters is the cold first paint, which is the size of the document: 386 KB of server-rendered HTML for 90+ contests and 276 candidacies. app/ballot/loading.tsx ships as the visible loading state the item required regardless. Reducing the document is the actual fix and is a bigger change than one item: candidate cards are fully rendered for every contest whether or not a reader ever scrolls to them, so the obvious lever is rendering contests below the fold on demand. That trades against the page being one server-rendered document a reader can search and a crawler can read, which is worth keeping.

**PU08** — Found 2026-08-25 while measuring BC-16. Counting .panel elements whose text contains PUBLIC MEETINGS returns 2 when one venue panel is open, and the entity modal's title renders twice in its own innerText ('Rockaway township' followed by 'Rockaway township'). Only one of each is visible, so this is not a reader-facing defect today — it is almost certainly the desktop and mobile placements both rendering with one hidden by CSS, which is the same pattern .rail-floaters and .map-bottom-stack use deliberately. It is a row because it made a measurement wrong: the BC-16 harness reported two panels open before anything had been clicked, and a duplicate node is a thing every future DOM count will have to know about.

**A03** — Answering "is there a data center coming?" by searching pending zoning, permits and agenda items near an address. The same machinery answers warehouses, rezonings and road projects.

**M18** — A city and county that merged into one government still render as two bodies with two councils. A reader sees their single local government twice.

**P04** — Turning individual answers into a number a buyer can trust: weighting by how much the person actually read, freezing each snapshot so it can never be quietly amended, and reporting on every export how well each answer was verified.

  Waiting on reaction capture (P03).

**P05** — Tell a reader when an official they follow votes on something.

**P06** — One tap to send a letter when a representative votes against a position the reader cared about. Public contact details only — delivery, not lobbying.

  Waiting on vote notifications (P05).

**P07** — Tell a reader what happened at the hearing they could not attend: passed, failed, or held over.

**P08** — After a decision, tell the reader how long they have to appeal it and how.

  Waiting on outcome notifications (P07).

**P09** — A different product for people deciding where to live: pending development, zoning and state-by-state requirements near an address they are considering. A real market, and not this one.

  Waiting on "is there a data center coming?" (A03).

**P10** — Build the product for a second metro so the demo is not only Tucson.

## Constitution & rules

CLAUDE.md, docs/rulings.md, and the guard tests that enforce them. The amendment history — every rule added or changed, when, and which session changed it — is generated into docs/amendment-history.md by corepack pnpm rules:history, because it is derived from the commits rather than composed from memory.

**3 open · 7 resolved.**

### P1

**D68** — A script rewrote a verified data file with less data than it found and exited cleanly. Caught and reverted the same day. The row exists because the shape recurs, and a script that can lose data must be asked what it wrote.

### P2

**R13** — A standing rule rather than a task: the zip playbook only ever gains entries, never loses them, and every depth run ends by stating what it added or that it added nothing. It rides every future session.

**X07** — In small races a campaign's entire public presence is a Facebook page. Recording that as no site found hides something real and penalizes exactly the candidates who could not afford a domain.

## Repo & ops

CI, tests, workflows, storage, the machinery the project runs on.

**32 open · 96 resolved.**

### P1

**JOB03** — The scheduled job refresh-meetings-snapshot.yml failed on two CONSECUTIVE runs (32372995194 and 32342602616), both at: Validate before committing, and has since gone green on its own. It is not broken right now. Nobody found out why it broke, so the next occurrence starts from the same nothing — which is why this is a row rather than a shrug. This watcher runs once a day and used to read only the two most recent runs, so a double failure that healed in between was invisible to it (NJ Hunt 3 item 1c). Over its last 40 completed runs it has failed 17 time(s). Two consecutive failures is evidence the cause is ours rather than a host refusing on a schedule — a wall would not usually repeat exactly. RULING 56 opens this automatically so a degrading data path is not a page nobody watches. [job-watch:refresh-meetings-snapshot.yml]

**JOB19** — The scheduled job refresh-daily.yml failed on two CONSECUTIVE runs (32955499285 and 32833989579), both at: Commit, and has since gone green on its own. It is not broken right now. Nobody found out why it broke, so the next occurrence starts from the same nothing — which is why this is a row rather than a shrug. This watcher runs once a day and used to read only the two most recent runs, so a double failure that healed in between was invisible to it (NJ Hunt 3 item 1c). Over its last 15 completed runs it has failed 8 time(s). Two consecutive failures is evidence the cause is ours rather than a host refusing on a schedule — a wall would not usually repeat exactly. RULING 56 opens this automatically so a degrading data path is not a page nobody watches. 

OPERATIONAL INCIDENT (RULING 218): this is engineering work, not an owner decision. The standing class incident is WorkItem incident-scheduled-run-failures in data/control-plane/incidents.

WHAT THE FAILING RUN PRINTED (run 32955499285). The line(s) that NAME the failure:
  !   agenda fetch failed for legistar:pima:1803: Error: HTTP 404 for https://legistar.granicus.com/pima/meetings/2026/6/1803_A_Board_of_Supervisors_26-06-09_Online_Agenda.pdf
  !   agenda fetch failed for legistar:pima:1817: Error: HTTP 404 for https://legistar.granicus.com/pima/meetings/2026/6/1817_A_Board_of_Supervisors_26-06-23_Online_Agenda.pdf
  !   agenda fetch failed for legistar:pima:1821: Error: HTTP 404 for https://legistar.granicus.com/pima/meetings/2026/7/1821_A_Board_of_Supervisors_26-07-14_Online_Agenda.pdf
  !   REFUSED rows (no division)     0, across 0 named jurisdiction/office pair(s)
  !   276 built + 0 refused = 276 vs 276 read  (accounted)

The last 14 of 3208 line(s) the run printed:
  |  ! [remote rejected] HEAD -> main (protected branch hook declined)
  | error: failed to push some refs to 'https://github.com/SeanJ22/We-The-People'
  | push-main: rebased onto origin/main, retrying
  | push-main: FAILED — push to main still rejected after 5 attempts
  | push-main: attempt 5 of 5 rejected — remote: error: GH006: Protected branch update failed for refs/heads/main.
  | push-main: the commit made by this run has NOT landed on main. This run is red on purpose; it did not exit zero having lost its work.
  | remote:
  | remote: - Changes must be made through a pull request.
  | remote:
  | remote: - 3 of 3 required status checks are expected.
  | To https://github.com/SeanJ22/We-The-People
  |  ! [remote rejected] HEAD -> main (protected branch hook declined)
  | error: failed to push some refs to 'https://github.com/SeanJ22/We-The-People'
  | ##[error]Process completed with exit code 1.

[job-watch:refresh-daily.yml]

**JOB20** — The scheduled job intake-tripwire.yml failed on two CONSECUTIVE runs (32961466707 and 32840268606), both at: Commit the report if changed, and has since gone green on its own. It is not broken right now. Nobody found out why it broke, so the next occurrence starts from the same nothing — which is why this is a row rather than a shrug. This watcher runs once a day and used to read only the two most recent runs, so a double failure that healed in between was invisible to it (NJ Hunt 3 item 1c). Over its last 20 completed runs it has failed 5 time(s). Two consecutive failures is evidence the cause is ours rather than a host refusing on a schedule — a wall would not usually repeat exactly. RULING 56 opens this automatically so a degrading data path is not a page nobody watches. 

OPERATIONAL INCIDENT (RULING 218): this is engineering work, not an owner decision. The standing class incident is WorkItem incident-scheduled-run-failures in data/control-plane/incidents.

WHAT THE FAILING RUN PRINTED (run 32961466707). The last 14 of 257 line(s) the run printed:
  |  ! [remote rejected] HEAD -> main (protected branch hook declined)
  | error: failed to push some refs to 'https://github.com/SeanJ22/We-The-People'
  | push-main: rebased onto origin/main, retrying
  | push-main: FAILED — push to main still rejected after 5 attempts
  | push-main: attempt 5 of 5 rejected — remote: error: GH006: Protected branch update failed for refs/heads/main.
  | push-main: the commit made by this run has NOT landed on main. This run is red on purpose; it did not exit zero having lost its work.
  | remote:
  | remote: - Changes must be made through a pull request.
  | remote:
  | remote: - 3 of 3 required status checks are expected.
  | To https://github.com/SeanJ22/We-The-People
  |  ! [remote rejected] HEAD -> main (protected branch hook declined)
  | error: failed to push some refs to 'https://github.com/SeanJ22/We-The-People'
  | ##[error]Process completed with exit code 1.

[job-watch:intake-tripwire.yml]

**NH170** — Three separate defects, all reproduced before they were touched, all fixed in final-pass-0825 — this row exists so the FOURTH is not lost. (1) legistar's composite wrapper re-branded the adapter's result through a second accountedNormalize call without countedButProduced, so every online meeting was counted once as produced and once as dropped; against the recorded Pima fixture the adapter reports CONSERVED 18 of 18 and the wrapper threw '4 more dispositions than records'. (2) nj-filing ran nj:filing:check BEFORE nj:ballot --write, and the check exits non-zero on STALE — so the staleness gate stopped the only command that could clear the staleness, and curatedAt froze on 2026-08-23. (3) The orchestrator's own header states a three-valued exit vocabulary and calls exit 2 'commit the survivors, THEN go red', and runCommand asked status === 0 — so the ingest's 'PARTIAL PROGRESS IS ON DISK AND MUST BE COMMITTED: 451 rows from 10 of 11 sources' was read exactly like a total failure and the workflow printed 'nothing usable was written'. WHAT IS STILL OWED: the daily refresh has not been verified end-to-end since the fixes. It runs at 09:11 UTC. Read the next run and confirm all three paths behave — and if legistar conserves and nj-filing rebuilds and a partial commits, close this.

**NH264** — refresh-daily is on cron 09:11 UTC. Of the three scheduled runs on record two failed, the one success started 637 minutes late, and today's has not appeared at all ten hours past its cron.

**NH280** — PR #216 built and bundled clean, then failed Netlify secret scanning: Pima County's own Clerk of the Board page emitted a Google Maps browser key into the HTML that scripts/learn-legistar-horizon.mts recorded verbatim as a test fixture. Scanning the whole tree for the class found more than Netlify reported - the same fixture also carried a live 30-day CivicPlus bearer token repeated five times, and a second fixture, the New London NH calendar, carried a different Google key that would have been the next red deploy. The repair sanitizes captured pages at the moment of acquisition, records the provenance of every redaction without keeping the credential, and adds a gate so GitHub CI catches the class before Netlify does.

### P2

**NH103** — Found 2026-08-23 writing the first test that imports lib/officials/body-definitions.ts at RUNTIME rather than reading it as text. Two separate ESM defects were in the chain and both were invisible because nothing had ever imported that file under node --test. (1) body-definitions.ts and lib/registry/census-school-systems.ts used EXTENSIONLESS relative imports, which Next's bundler tolerates and Node's ESM loader refuses - FIXED this session, 3 sites. (2) school-dependency.ts still imports data/derived/school-district-dependency.json with no `with { type: json }` attribute, so ERR_IMPORT_ATTRIBUTE_MISSING. WORKED AROUND rather than fixed: lib/officials/body-form.ts takes the dependency as a PARAMETER instead of importing it. WHAT IS OWED: decide whether to add the import attribute (verify the Next build accepts it first) or to move the JSON read behind a function. Until then any new test importing that module transitively fails, and the failure names the JSON rather than the cause. THE CLASS, swept: 3 extensionless relative imports under lib/**/*.ts, all fixed; 10 more under components/**/*.tsx and lib/state/*.tsx are OUT OF SCOPE with the reason - they are React components reached only through the bundler and never imported by node --test.

**NH139** — The external audit of ae5b178 read 50 files of an unestablished denominator and did not perform Phase 2, the Drive consistency check. Neither number is known. A second pass owes both: the denominator of files that exist and should have been read, and the Drive comparison that was never run.

**NH177** — Read from Netlify's deploy API on 2026-08-25 while answering Item 6's verdict (a). Of the last 60 production deploys, these reached state 'error' and were never published: 3449eb8 (PR #177), 41113c1 (PR #171), 55d3047 (PR #170) and e0f6426 (this morning's intake tripwire). Three are real CODE merges. Each was covered by a later successful merge so nothing was permanently lost — but between the merge and that later deploy production was serving older code, and no instrument in this repo reports it. This is NJ25's shape still alive. It did NOT cause any of the six recurrences in Item 6 (all three testable claims were live in d43adf7 during Sean's walk), which is why it is a row rather than part of that verdict. RULING 152 now says a reader-facing DONE names the deploy that carries it; what is still missing is something that NOTICES an errored deploy without being asked. pnpm deploy:live answers for the tip only.

**NH181** — Found 2026-08-25 by part2-0825 while closing NS16. The 8/25 Part 2 document is now at docs/feedback/we-the-people-feedback-2026-08-25-part2.md and is the FIRST one that has ever been there. The captures for every batch are committed and reachable; the DOCUMENTS are not. Missing: the 8/22 walkthrough (captures at docs/feedback/2026-08-22/, 21 files), the 8/24 walkthrough (docs/feedback/8.24/, 16 files) and the 8/25 morning walkthrough (docs/feedback/8.25/, 19 files). Each has been cited as authoritative by at least one session brief, and RULING 108 says anything a session must read at session start lives in the repo. docs/feedback/README.md is the index and names all three as missing. Only the author can supply the text — a session cannot reconstruct a dictation it never had.

**NH205** — Branch protection is now asserted against the live GitHub API by one command, so the answer to whether main is still protected the way we think is a command rather than a memory. Nothing runs it automatically. It needs gh authenticated with admin scope, which the gates job does not have and should not be given, so wiring it into pnpm gates was deliberately not done.

**NH256** — The standing regression net's g8 check asserts no internal adapter id reaches a reader surface. It greps the raw response text for each id as a word, so it matched INSIDE source URLs: civicplus in content.civicplus.com asset links and legistar in a pima.legistar.com LegislationDetail link. Both are CITATIONS — Pima County's own document CDN and its legislative portal — carried because the ballot corpus's absences must cite the record that settled them, which is the Vail Unified and Empire Elementary election cancellations. The guard was reporting the transparency rules working. MEASURED: with URLs stripped, ZERO adapter ids remain anywhere in the served HTML at any of the four pilot zips, so there was no reader-visible leak at any point. ATTRIBUTION, established rather than assumed: git log -S puts the citation in 9e75bea, the merged handoff of PR #210 from the 85641-detective branch, and git merge-base --is-ancestor confirms that commit is an ancestor of this session's start SHA 1e02e2f. The ask-entity session made no commits touching the Pima ballot corpus. So it had been failing on main since #210 and was reported as 2 regressions on every walk in between. REPAIRED: the check strips http and https URLs before scanning and nothing else changed. Narrowing a check is exactly where a check quietly stops checking, so a PLANTED control runs on every walk and asserts BOTH halves — an adapter id in reader text is still caught, and the same id inside a source URL is not — and says THE GUARD IS BLIND if the first half ever stops firing. Walk after the repair: 369 passed, 0 regressions, 11 could not run.

**NH298** — A.1 WI7 measured the walk, repaired the dead readiness wait, and took it from 1463.4s to 321.2s over the same 390 checks. Three of the named avenues are not done: running checks concurrently across Playwright contexts, making the walk hermetic with no live network, and reusing the production build when HEAD is unchanged.

**NH302** — pnpm walk:wait-audit, added this session, reports 26 until()/untilPresent() call sites in scripts/walk-all.mts: 26 of 26 name a selector the product source can produce, so the A.1 dead-selector class is clear, and 25 of 26 DISCARD the boolean. A wait whose result nobody reads cannot fail - if its condition is never met the walk spends the ceiling and proceeds identically, which is exactly how A.1's dead .coverage-notice wait cost 1142 seconds without anything going red. Session B did not convert the 25 call sites to hard failures: until() returning false is deliberately not a failure (a slow surface must not red the walk), so making every miss throw would trade one instrument defect for another. What shipped instead is that every timeout is now COUNTED and written to the walk run record by label, so a wait that never settles appears as a number rather than as unattributed wall time. Converting individual call sites to consume their result is the remaining work, one at a time, each with a reason.

**NH32** — The intake tripwire raised an alarm on 2026-08-21 at 00:28 UTC: a search_log insert was refused in production. The alarm is doing exactly what it was built for. The problem is that its output prints five dashes where the database's reason should be, so the one thing needed to diagnose it is the one thing not recorded. Production schema is in sync at 0015, so a missing column is ruled out.

**NH47** — pnpm test reported 1561 passing, 0 failing, while EIGHT guard tests had stopped running entirely. A deleted test and a passing test are indistinguishable in that output; the only instrument that can see the difference is the COUNT, and nothing checks it.

**NH69** — Every tracker run this session ended with THE WORKBOOK IS STALE and exit code 3: docs/tracker.xlsx is locked (docs/~$tracker.xlsx exists, which is Excel's own lock file). The two CSV stores are authoritative and were written correctly, and docs/tracker.md and docs/log.md regenerated from them - but the workbook Sean edits is showing the tracker as it was before this session, and saving it would write those older rows back over the stores.

**NH85** — RULING 75's third part asks GitHub rather than the working tree, and the four verdicts it keeps apart are green, red, pending and could-not-tell. Measured on 2026-08-23: both of this session's commits to main are GREEN on GitHub - d0f2831 carries build default, build standalone and the gates, and e83db50 carries those plus the tripwire. But main's TIP was 7112307, an intake-tripwire[bot] commit pushed minutes later, and no check has ever been registered against it. So main:green exits 2 with CANNOT TELL on a healthy tree, and it did the same on 750e094 at the start of this session. Seven workflows push main daily, so the tip is a bot commit far more often than it is a human one, and a gate that reads could-not-tell as its normal answer is a gate a session learns to walk past. What is owed is a decision about the shape rather than a patch: either the scheduled workflows' pushes to main run build check too, or main:green reports on the newest commit that HAS a check and says how many bot commits sit above it. The second keeps the Actions budget RULING 78 protects; the first is stricter. Nothing is broken today and the distinction between the four verdicts must not be softened to make this go away.

**NH96** — NH91 is closed: playwright is pinned to an exact version, EXPECTED_CHROMIUM_REVISION is committed in lib/ops/chromium-pin.ts and checked against playwright's own browsers.json, and scripts/browser.mts launches whatever complete Chromium the image has by explicit path while NAMING the substitution. Two of the three tests that could not run now run and pass on build 1194. THE THIRD CANNOT, and it is a real finding rather than a harness problem: the plant that proves the guard can fail asserts that an unload-time sendBeacon escapes extraHTTPHeaders, and on Chromium 1194 the headers DO reach it, so the beacon arrives declared. That is a measurement of build 1194 and says nothing about the pinned 1234, so the test reports CANNOT RUN with the substituted build named rather than asserting either way. WHAT WOULD CLOSE IT: the container image carrying the pinned build, at which point the plant runs against the browser it was written for. Nothing in the repo can fix it — this is a fact about the image.

**PB07** — Four of the five scheduled jobs run the full test suite before they push. The fifth does not, so a broken document can reach the repository unchallenged.

**JOB30** — THE CLASS ROW for scheduled-workflow lateness, absorbing JOB21 through JOB29. Nine rows were opened on 2026-08-31 recording nine individually-audited late slots across three workflows over three days: intake-tripwire.yml (276.1, 256.6 and 420.6 minutes late), job-watch.yml (187.9, 186.5 and 322.1) and refresh-daily.yml (315.7, 313.1 and 471). Every one of them records the SAME cause in its own text - the run was CREATED late rather than queued late, so the delay is GitHub's dispatch of the cron event and not this repository's runners, its concurrency or its jobs. Nine rows describing one phenomenon is a measurement wearing a task's clothes, which RULING 33 refuses: a measurement changes every time it is taken, and at three workflows a day this accumulates about three new rows daily forever while the thing they describe stays exactly the same. The nine are resolved into this row and remain permanently readable in the resolved store. WHAT IS ACTUALLY OWED, and it is a decision rather than an audit: the 60-minute tolerance was chosen when GitHub dispatch was assumed punctual, and every observation on record says it is not. Either the tolerance is re-derived from observed dispatch delay so it measures something real, or lateness stops being a per-slot row and becomes a rate on a dashboard, or the scheduler stops depending on cron punctuality altogether - which is what RULING 218's runtime-scheduler-derived clock and RULING 220's durable control plane exist to make possible. Until one of those lands, a late slot is a fact about GitHub and never a fact about this product's freshness.

  Waiting on the daily refresh schedule fires late or not at all (NH264).

### P3

**NH171** — Run 32840268606, 2026-08-25 11:03 UTC. push-main.mjs retried five times and every attempt came back 'remote: fatal error in commit_refs' with '! [remote rejected] HEAD -> main (failure)'. That is a GitHub-side error rather than a rejected fast-forward — a rebase-and-retry cannot fix it and correctly did not. Nothing in this repo is broken by it and nothing was lost: the tripwire commits only under docs/, which the deploy filter classifies as non-shipping. Recorded so a SECOND occurrence is recognised as a pattern rather than diagnosed from scratch, and because RULING 24 says a check that could not run is reported separately from one that failed. If it recurs, the question is whether push-main should distinguish a remote-side fatal from a rejected push and stop retrying.

**NH178** — Reproduced 2026-08-25. deploy:live reads Netlify correctly and prints the full verdict — site, main tip, last deployable, live deploy id and state, live commit, and CURRENT — and then dies with 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src/win/async.c, line 94' and ELIFECYCLE exit code 3221226505. That is a libuv teardown crash on Windows, after the work is done. It matters because RULING 125 makes this the ONE production question a close-out asks, and any caller that gates on its exit code reads a successful read as a failure — the exact shape of the defect NJ25 is about. The verdict itself is trustworthy; the exit code is not.

**NH223** — scripts/adjudicate-leads.mts implements its own rung 2/3/4 ladder and its own decodeEntities, both of which lib/sources/http.ts already exports. RULING 63: duplication is worse than a gap. The private ladder works — it sends a raw browser User-Agent, which is what passes the *.nh.gov family — but it lacks rung 3b, it does not pace itself, and it will drift from the shared one. scripts/census-gap-walk.mts was converted to politeGetText in the same session and is the model.

**NH253** — tests/tracker-transaction.test.ts writes a synthetic tracker row, backs the tracker files up in memory and restores them in a finally block. If a run is killed before that finally executes, the synthetic row NH246 survives in docs/tracker-working.csv — and every later run then fails, because the row is already open and tracker.mjs add correctly refuses a duplicate. Worse, the next run's backup is taken WITH the row present, so its own restore puts it back: the failure is self-perpetuating and only a manual removal clears it. Observed on 2026-08-27, where it turned a green suite red until the residue was written forward out of the four tracker files and the log. THE SPEC: the test should either use an id it can guarantee is unique per run, or detect and clear its own residue before writing, so an interrupted run cannot poison every subsequent one.

**NH284** — When a site's robots.txt says do not crawl, we do not send a request at all. But every one of the six transport states describes an attempt that actually happened, so there is no honest value to record. Both the Pima shadow fixture and the new proving run write CHALLENGED, which reads as though we tried and were turned away. Nothing about correctness turns on it today - the route is disposed BLOCKED_CURRENTLY, an open state, so the obligation correctly stays open and no absence is asserted. But the vocabulary is imprecise at exactly the point where a wall must not become an emptiness, which is the one conversion this product cannot survive.

**NH285** — states/nh/explainer.md says RSA 664:6 and 664:7 are quoted in sources.md. They are not: states/nh/sources.md contains no 664 string at all, and a repo-wide search finds no verbatim operative sentence anywhere. Two other states' notes summarise the rule as centralised on the Secretary of State, but a summary is not a quote. This blocks New Hampshire from entering the campaign-finance filing-regime registry, because a regime record built from a paraphrase of a routing rule is a different routing rule - and the registry's whole job is to say which authority governs a contest.

**NH86** — Measured 2026-08-23. corepack pnpm closeout fails its build gate with "pnpm build refused (exit 1)" and no TS diagnostic, while the same build run on its own exits 0; pnpm closeout passes the gate in 9 seconds. This is the same failure already recorded for pnpm handoff --ship, one script later: close-out.mjs shells out to pnpm run build, and through corepack that inner call cannot run. The gate is honest about it - it refuses rather than passing - which is exactly the four-verdict discipline working, and it still cost a debugging round because nothing in the repo says so at the point of use. What is owed is small: close-out.mjs and handoff.mjs should detect a corepack-shimmed parent and say which command to run instead, rather than reporting a build refusal that is really an environment refusal. A note in CLAUDE.md's Commands section would do at a minimum.

**PD02** — The local development database is eight migrations behind production, so nothing can be tried locally against the real schema.

**PD05** — The production walk creates rows under two different run labels and then counts only one of them, so it under-reports how many rows it wrote.

**PE02** — The short summary file generated at the end of every session still reads the frozen pre-rebuild tracker, so it reports a priority count on a scale that no longer exists. Nothing a reader sees is affected; the next session opens on a number that means nothing.

**RO02** — Found 2026-08-23 while running the gates. pnpm exec node scripts/check-lint-allowlist.mjs refused with five unlisted warnings, and stashing every change in this session proved all five were already on main: scripts/guard-history.mjs (unused sep), scripts/tier-directory.mts (unused readFileSync), and three in tests/coverage.test.ts. All five were unused imports or an unused local and all five are fixed here. THE ROW IS FOR THE SHAPE, not the fix: this check is not part of build-check.yml, so a gate that a session is expected to run by hand had been red for an unknown number of sessions with nothing reporting it. Worth deciding whether it joins the CI gate or the handoff gate, remembering RULING 78 — a gate that runs three times for one merge is one gate and two copies of it.

---

Every row also carries who opened it, the technical detail, and the full session
record. Those are in the spreadsheet and are left out here on purpose: this file
answers what is left, and the spreadsheet answers everything else.
