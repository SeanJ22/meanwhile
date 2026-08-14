# Session brief — the second-to-last build before the first outside tester

(Executed 2026-08-17 on branch `claude/final-prep-nh-nj-depth-0817`; this
file is the brief as pasted, preserved per its own instruction. The
session ran unattended.)

Check your memory files.
This file is the session's full brief. On completion, overwrite `docs/session-brief.md`.
This session runs unattended. Nobody is available to answer.

* Reversible decisions: take the cheaper-to-undo option, record it AND the rejected alternative in `state.md`, keep going.
* Genuinely irreversible decisions: skip, tracker row with options and evidence, continue.
* A source hunt is never a stopping point. Work the ladder, make more rungs, record every rung with `attemptedAt`.
* Browser-heavy steps LAST, inline, no background agents.
* Anything else that surfaces: tracker row, keep working.
* Live on every push — nothing half-finished to `main`. End with `pnpm handoff --ship`, verify on `main`, verify the deploy, standing report.

Session-open: read `docs/defects.md` and triage.
Correct first. Fast second. Nothing third.
The session's stated priority: GO DEEP ON NH AND NJ. The tester lives in New Hampshire and is moving to Morris County, New Jersey. 03255 and 07866 are her daily zips. Where a trade exists between breadth and depth in her two states, depth wins. The tester pass runs at PHONE width — she tests on a phone; the author has only verified desktop.

## 1 — Reader-facing copy, the author's words

* 1a — The welcome overlay mission text is replaced, VERBATIM, with:
  Whether you care about politics or not, politics cares about you.
  Government reports to you.
  While you were at work, a data center was approved three miles from your kids' school. While you were at soccer practice, the school board adopted a new AI policy. While you were living an ordinary week, decisions about your next four years got made.
  Not in secret. In public, on a schedule, in a room you were allowed to walk into. Nobody told you.
  Know where it's happening. Know when it's happening. Show up if you can.
  And when you can't — say something anyway.
  Do not edit it. Keep the zip entry and one-tap examples beneath it.
* 1b — Transparency page wording: "sell" retires. The author's chosen form: "aggregates may be licensed" — e.g. "aggregates may be licensed to political organizations — that's what keeps this free to use." The commercial fact stays plainly stated; only the verb changes. Update everywhere the pattern appears, including the one-time reaction notice's linked page.

## 2 — NH and NJ depth

* 2a — NH ballot measures exist. Find and ship them. Ballotpedia reports at least one 2026 NH statewide measure — that is a LEAD (D18), not a citation. NH measures are constitutional amendments (CACRs) passed by the General Court onto the ballot: verify at the NH SOS and gencourt.state.nh.us, ship every 2026 measure with official text verbatim and a plain-language summary in the register (Prop 142 pattern). A cited absence is only acceptable if the official record genuinely shows none — given the lead, expect at least one.
* 2b — Kelly-standard cards for every ballot candidate, NH and NJ first, then AZ. Not a hyperlink — a card: photo, short bio, contact where published, official site (if officeholder) + campaign site, party. Photo rule adjusted for candidates: challengers have no official portrait, so the campaign site's own photo is the legitimate source — record and label it. Bios from the candidate's own site, brief and factual, attributed — never characterized by us. Governor, Exec Council, everyone.
* 2c — NH legislator contacts: retry the TLS wall with new rungs. The author's order: try harder. Candidate rungs not yet tried: different TLS client profiles (curl with --ciphers, node with custom agent), the Wayback Machine's copies of member pages, the General Court's bulk/roster downloads (gencourt publishes member CSVs/rosters), the chamber clerk pages, per-member PDF directories. Phone-book-style official directories count as official sources. Record every rung.
* 2d — NJ member-name capitalization: "Brian ROACH" → "Brian Roach." Normalize display case from the njleg source format, with a test (handles McDonald, O'Brien, DeCroce, van/von correctly — use a proper name-case pass, not naive title-case).
* 2e — Newbury's no-mayor fact renders: "Newbury isn't a city — it has no mayor. The Select Board runs the town." The Select Board gets its office explainer in the register ("Your Select Board is the town's government — three neighbors elected to run things between town meetings...") — and its MEMBERS get Kelly-standard cards per 6e, because the people who fill the substitute role matter exactly as much as a mayor would. Same pattern anywhere the expected office doesn't exist: name the fact, explain the actual structure, show the actual people.

The stranger test — into CLAUDE.md, and it governs every surface:
the author's principle, written as the standard: a person in Tucson should be able to learn everything they'd want to know about Newbury, NH from this product alone. The completeness bar for any place is a STRANGER's, not a local's — a local fills gaps with what they already know; a stranger has nothing, so any gap a stranger would hit is a defect. Every surface, every explainer, every card is judged against the reader who has never been there: no assumed context, no "everyone knows how town meeting works," no office left unexplained, no body left unpeopled. The tester pass (item 10) applies this test explicitly — the walker is a stranger to all four zips by instruction.

## 3 — Coverage completeness: the Sunnyside catch, generalized

The author found Sunnyside and Amphitheater school districts missing around Tucson in five minutes of clicking. His point is fully general: school districts are the EXAMPLE. The question is what else is missing — and the answer must be measured against reality, not against our own records. An audit of the registry against the wiring only finds gaps in bodies we already know about; the Sunnyside class of miss is a gap in what we know exists.

* 3a — Layer 1: the registry vs. the official universe. For each clip county (Pima, Morris, Merrimack), enumerate every government the OFFICIAL sources say exists and check each against the registry: Census of Governments; NCES district enumeration (including elementary-only, union/regional, and supervisory structures — NH's SAU layer must not hide districts); state-level enumerations where they exist. Every government in the official universe is either IN the registry or its absence is explained in the table (dissolved, merged, out-of-clip, or a genuine miss → fixed this session). Special districts get explicit attention — fire, water, library, sanitation, housing, community college — they are the largest category of government in the country and the easiest to miss.
* 3b — Layer 2: the registry vs. the wiring. The original audit: every registry body vs. wired/curated status, with the roster column from 6e. Both layers land in one committed table, `docs/coverage-audit-by-county.md`, per county — the gap becomes a measured number, not a fear, at BOTH levels.
* 3c — Fix what the audit finds, priority order: everything serving the four zips first, then the rest of each clip county as time allows, recorded as NOT_ATTEMPTED with the audit as the backlog where it doesn't. Full treatment for each: registry row, sources hunted per the ladder, comment access, boundaries where the official sources carry them.
* 3d — Kearsarge stays on the list (the TLS-blocked district) — same new rungs as 2c.
* 3e — The standing rule this creates, into CLAUDE.md: coverage claims are made against the official universe, never against our own records. "We watch N of M bodies here" — M comes from the Census of Governments / official enumerations, not from counting our registry. A registry that defines its own denominator cannot be caught missing anything.

## 4 — Ballot features

* 4a — Save my picks, DEVICE-LOCAL ONLY. Per contest, a "mark how you'd vote" control saving to localStorage (`wtp.ballot_picks`) — never transmitted, never in any store, no column anywhere could hold it (extend the schema guard). A "My picks" view for election-day reference. The surface states it plainly: "Saved on this device only. We never see your picks." This is DISTINCT from the reaction buttons (which are collected, anonymously) — the difference must be visually and textually clear.
* 4b — Office explainers for every office type on any ballot — governor, executive councilor (the NH oddity — what does this role even do), treasurer, register of probate, county commissioner, all of them. The register, the 15-year-old test, at the top of each contest or its candidate cards.
* 4c — (Registration links shipped last session — verify they render prominently on all three states' pages.)

## 5 — Votes surface polish

* 5a — Plain-language summary OPEN by default — no click to reveal. The collapse affordance may remain for closing.
* 5b — "What a No vote means here": one mechanical line per vote row — "A No vote here was a vote against passing the bill" / for procedural types, the type explainer's plain consequence ("Voting No here let the bill move forward"). Mechanical, never evaluative; derived from the vote type data file.
* 5c — Attribution once, TOS pattern: the "plain-language summary, ours…" line renders ONCE at the top of the Recent Votes section, not per bill.

## 6 — Meetings and bodies

* 6a — Past-meeting card variant: concluded meetings drop Directions and the to-be-heard boilerplate; gain a "What happened — plain language" dropdown where minutes are published (curated from the minutes for concluded meetings in the current window, cited; honest "minutes not yet posted" otherwise); and a phone link for the clerk/body office — hunt the numbers.
* 6b — Add to calendar on every upcoming meeting: .ics download (covers Apple/Outlook) + a Google Calendar link, with title (what-first), time, location, and the meeting's app link in the description.
* 6c — The county popup fills in. Pima's large popup (and every county's): all county meetings (it covers Vail AND Tucson — list them all), representation (who represents people in this county, clear about what and where), officials, bodies. Generalize — the author's Tucson examples are examples, not scope.
* 6d — Body ordering: governing bodies before advisory — City Council never below the Board of Adjustment.
* 6e — EVERY governing-body member of EVERY wired body gets a Kelly-standard card. No location exceptions — the author's explicit scope. The principle: if we show a body, we show its people. Where tier-3 rosters already exist, RAISE each member from name-with-citation to full card. Where a roster is missing, the completeness audit (3a) will surface it — hunt it from the body's own pages, ladder applies. The audit table gains a column: roster present / carded / gaps, per body. A member whose photo or phone genuinely isn't published renders the honest placeholder, never a broken image or a fake — and the miss is recorded.

## 7 — "About this area" v1 — for movers

The tester is literally moving states; build the feature for her case. A section reachable from the zip's who-governs or ballot surface: the questions people ask before moving, answered before asked — including controversial ones. Per state (NJ and NH first, AZ too): marijuana legality (recreational/medical, where sold), school vaccination requirements and exemptions, firearm carry basics, state income tax, vehicle registration/license timelines, voter registration deadlines and ID requirements, homestead/property-tax basics. Every answer: one or two register-plain sentences, cited to the official source (statute, state agency page) — never advocacy, never characterization, the same neutrality discipline as everything else. Curated data file per state; honest "we haven't covered this yet" for anything unanswered. Title and flow are the session's choice — record it; the author will react.

## 8 — Interaction and carryovers

* 8a — Sidebar numbers become doors (Meetings / Bodies / Districts / Officials counts tappable → large-popup lists → entity popups; one-large-popup rule). Twice carried, dropped once in brief-rewriting — it ships this session.
* 8b — The clutter pass: popups do not minimize naturally (author). Audit every open-surface interaction: opening anything large minimizes everything else; compact cards yield to their own large tier; nothing stacks; the minimize affordance is obvious everywhere. Screenshot the worst current stack, then the fixed behavior.

## 9 — FEC funding surfaces — the author's order: build it, no exceptions

Carried verbatim from the prior brief (tags, surfaces, reactions, ripcords). The one framing correction, recorded in the tracker: counsel closes the RIPCORDS, not the build. D34's row is updated to say so. `ripcord.fundingReactionsInAggregates` still ships PULLED; contributor display ships live behind its named flag. Adapter (fetch-script env only, snapshot pattern), committee + contributor tagged rows, guard test on the aggregation path, Funding sections in the register, reaction controls with the two funding tags, transparency page same commit, FEC-vs-roster identifier match rate printed.

## 10 — The tester pass, PHONE WIDTH, hers first

03255 and 07866 walked as a stranger on a 390px viewport, then 85701/85641. Cold zip entry; every surface read (15-year-old test), every link fetched, every control exercised, every popup opened and minimized. Written surface-by-surface pass/fail log → `docs/tester-pass.md` (supersede), open items seeding the FINAL session's punch list. Screenshots throughout.

10b — One tracker verification (no build): confirm T02's row records the author's standing position after his bot-flooding note: tier-weighting, not mandatory authentication — anonymous reactions always allowed, optional verification raises tier, aggregates always tier-split with denominators; the open design question is how optional locality verification works WITHOUT creating identity linkage, and it must be answered before public launch (alongside T08). If the row already says this, note "verified current"; if not, update it in place. No reader-facing auth is built, this session or any session, without the author's explicit direction.

## 11 — Documents and handoff

`state.md`: everything above; the completeness-audit table linked; the D34 framing correction; test count in all three places. Tracker: rows in place, sidebar-doors carry noted as recovered, next free ID verified. Transparency page verified (license wording, picks-local, FEC section). Overwrite `docs/session-brief.md`. Ship, verify deploy, standing report.

## Order, and cuts if short

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 (whole or defers whole) → 10 → 11.
NH/NJ depth (2), completeness (3), and the tester pass (10) are the session's point — never cut. If short: defer 9 whole first (it is the author's no-exceptions order — defer only under genuine duress and say so plainly at the top of the report), then thin 7 to NJ+NH only, then 6a's minutes summaries to the five most recent concluded meetings. Documents never cut. Polish beats new surface everywhere the choice arises.

## Standing rules

All of CLAUDE.md's non-negotiables. Denominators with counts; screenshot before believing green; diagnose before fixing; compare identifier sets before any adapter; never assert absence of data in a test; grep after scripted edits; verify branches; nothing Done without branch + checks; a failed operation may not render as an empty success; a URL cited must have been fetched and verified — a 404 or generic landing is a MISS, not a citation.
