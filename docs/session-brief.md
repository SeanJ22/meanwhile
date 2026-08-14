# Session brief — correctness first: NH ballot, the Kelly standard, then FEC and positions

This session runs unattended. Nobody is available to answer.
Work straight through. The standing motion, in full:

* Reversible decisions: take the option cheaper to undo, record the decision AND the rejected alternative in `state.md`, keep going. Do not stop.
* Genuinely irreversible decisions (schema keys, identifier conventions, stored user data fields): do not choose — skip that item, open a tracker row with the options and evidence, continue with everything else.
* A source hunt is never a stopping point. Work the ladder, make more rungs, record every rung with `attemptedAt`.
* Browser-heavy steps go LAST, after everything else is committed — the host has crashed on them repeatedly. Inline work only; background agents stay off.
* Anything else that surfaces: tracker row, keep working.
* The site is live on every push — nothing half-finished goes to `main`.
* End with `pnpm handoff --ship`, verify the files on `main`, verify the production deploy published, and leave the standing report.

Session-open: read `docs/defects.md` and triage. This file is the session's full brief — on completion, overwrite `docs/session-brief.md` with it.

Correct first. Fast second. Nothing third. Two shipped surfaces are wrong (NH ballot, state-official contacts); they lead.

Context that governs the whole session: this is the second-to-last build before the first outside tester uses the product unsupervised. The bar is not "works when the author drives it" — it is "a first-time reader on her own phone in New Hampshire, then New Jersey, hits nothing wrong, nothing confusing, and nothing that speaks database." Every trade this session resolves toward perfection. Where an item can be done quickly or done right, do it right and let the cut order handle time.

## The tester pass — new final item before documents

After everything else, walk the product as the tester will: 03255 and 07866, at phone width, as a stranger. Enter the zip cold. Read every surface that renders. For each: does it pass the 15-year-old test, is every link real (fetch it), is every number honest, does every control do what it looks like it does. Fix what fails on the spot if small; file it with a screenshot if not. The gate is a written walk-through log — surface by surface, pass/fail — for both zips, plus the same at 85701 and 85641. This log is the release evidence the next (final) session builds its punch list from.

## 1 — The NH ballot is wrong. Fix it with the AZ pattern.

The shipped "thin November ballot" finding was correct ONLY for town offices (genuinely March). For state and federal, NH's 2026-11-03 ballot is one of the largest in the country: a U.S. Senate seat, the governorship (NH governors serve two-year terms — up every midterm), both U.S. House seats, all 24 state senate seats, all 400 state house seats, Executive Council, and county offices. The wrinkle that fooled the session: the primary is 2026-09-08, so general nominees don't exist yet.

Render it with the AZ pre-canvass pattern already built: every contest listed, filed candidates shown from the SOS filing lists (filing period closed June 12 — the lists exist at sos.nh.gov), "nominees final after the September 8 primary" stated per contest. For Newbury/03255 specifically: the correct state house and senate districts, Executive Council district, Merrimack county offices. Cited absences only where a contest genuinely has none. Update the NH date strip if the primary date changes anything shown.

Correct the tracker/state.md record of the earlier finding in place — the overturn is preserved, not tidied.

## 2 — The Kelly standard: every official and candidate, every tier, all their links

The author's screenshots define the gate. The Mark Kelly card is the standard: photo, phone, working contact (form or email), the SPECIFIC official page, campaign site, all present and correct. The Lupe Diaz card is the gap: placeholder photo, no phone, no campaign site, a generic azleg.gov link where the specific member URL belongs — and the specific URL previously recorded is WRONG (author verified), with a dead email hyperlink.

* 2a — State officials to the Kelly standard. AZ, NJ, NH legislators: specific member page URL (verified by fetching it — a URL that 404s or lands generic is a MISS, not a citation), working email hyperlink, phone, photo per the recorded source rules, campaign site. Fix Diaz specifically and audit every state official for the same defects — the wrong-URL and dead-email diseases are unlikely to be his alone. Print the audit table: per official, which of the five Kelly fields is present/verified.
* 2b — Ballot candidates get their links, all levels, all three states. The author found five in seconds (Biggs: biggs.house.gov + biggsforarizona.com; Hobbs has one; Lombardo: risalombardo.com; Diaz: lupediazaz.com; Mansour: mansourforarizona.com) — they are findable, so find them all. Statewide, legislative, county, school board. Campaign site AND official site where the person holds office (label both, official primary). Contact hyperlinks from those sites where published. NJ and NH candidates get the same hunt — do the work. The ladder applies; a candidate without a found site gets a recorded hunt, not a blank.
* 2c — Voter-registration check links. Per state, the official registration-status checker (AZ, NJ, NH SOS/elections sites), linked prominently from each ballot page.

## 3 — Defect batch, from the author's production pass (screenshots on file)

* 3a — Meeting title hierarchy, still wrong. The Vail card renders the venue big/bold with the address duplicated in the subtitle. The shipped what-first fix did not reach all cards. Fix everywhere: WHAT it is big/bold ("Vail Unified School District — Governing Board Meeting"), then address once, then room. Audit every meeting surface, not the one card.
* 3b — The narrowing question becomes a modal. On zip entry with multiple coverage: a centered overlay, blurred background, the approved wording, forcing a RESPONSE — with "No thanks, show me everything" as one of the two big equally-weighted buttons, never an X to hunt. Forced response, never forced narrowing (the consent exception survives). The buried yes/no-thanks text links in the who-governs card retire.
* 3c — Disclosure, TOS pattern (author approved). The per-button line dies. First reaction tap ever: a one-time notice — "Your answer joins anonymous local totals. We never know who you are. How we use this →" — acknowledged once, stored device-local, never repeated. The link opens the transparency page, which keeps the full truth including the may-be-sold language, plainly stated. Update the CLAUDE.md wording-decision record from last session accordingly.
* 3d — Candidate reactions. "Would you vote for them? Yes / No / Unsure" on every ballot candidate card — the reusable control, new provenance tag `CANDIDATE_REACTION` (fourth class). Same store rules, same one-time disclosure. This is reader expression, not app recommendation — the neutrality guard tests extend to confirm nothing ranks or recommends from these.
* 3e — The missing mayor. Tucson's mayor was curated but does not surface at 85701. Find why (rendering path, not data) and surface: mayor card at the Kelly standard, office blurb, in the who-governs representation for Tucson.
* 3f — Shading regression. District shading on free-click is gone (the deselect fix likely killed the default). Restore: click shades, click again unshades — both work.
* 3g — Sidebar date range gains the past. Slider extends backward (e.g., 90d past), direction intuitive (left = further past), and concluded/canceled meetings render where sources carry them — Legistar and the county feeds hold past events; the snapshot window extends backward. "Older meetings" is now twice-requested; the agenda-document store already holds their documents.
* 3h — Layout smalls: US Senators label on its own line, names beneath; expansion photos larger; office blurb moves to the TOP of the large popup; legend z-index fixed (it overlays the small popup — screenshot on file); dates render mm/dd/yyyy everywhere.

## 4 — Plain-language bill summaries, curated (author approved)

The CRS text writes for staffers. The vote window is bounded — dozens of bills, not thousands — so hand-curate a plain-language summary per bill in the current window, the Prop 142 pattern: the author's register (15-year-old test), labeled "Plain-language summary," cited to the CRS summary and bill text it derives from, official text one click below. A data file keyed by bill, refreshed as the vote window rolls — note in the refresh script that new bills entering the window need summaries, and surface unsummarized bills honestly ("official summary below; plain-language version coming") rather than blocking the vote row. Vote-type explainer stays adjacent (passage vs. procedural), both visible.

## 5 — FEC funding surfaces, with reactions, behind two ripcords

(Carried from the prior brief, author-approved, unchanged in substance.)

* The ripcord doctrine into CLAUDE.md: legally-open features ship behind named kill switches; every record carries a provenance tag so a pull is a filter; the tracker row names flag, question, closer; ripcorded data never enters an export or sold aggregate until its question closes.
* Adapter: FEC key wires into the fetch script env only — NEVER Netlify, never client. Snapshot pattern. Committee-level (raised, spent, cash on hand, small-donor share) tagged `FEC_COMMITTEE`; contributor-level display (top contributors as filed) tagged `FEC_CONTRIBUTOR`, reader-facing only; a guard test asserts FEC_CONTRIBUTOR rows are unreachable from aggregation/export.
* Surface: Funding section on candidate cards and official large popups, plain register, cited, never characterized. Cited absences for no-committee/no-filings.
* Reactions: the control on both funding displays — tags `FUNDING_TOTAL_REACTION` and `CONTRIBUTOR_REACTION`.
* Ripcords: `ripcord.fecContributorDisplay` and `ripcord.fundingReactionsInAggregates` — the second ships PULLED (funding reactions excluded from sellable aggregation from day one). Tracker rows name the lawyer as closer. Transparency page updated same commit.
* Identifier rule: FEC candidate ids vs roster/ballot ids — print the match rate before the adapter.

## 6 — Positions go live: the three-answer machinery

(Carried, unchanged.) The corpus is full. Matched (verbatim short passages, source + retrieved date) / searched-nothing-matched (with denominator) / not-yet-collected (say so, link their site) — distinguishable in data and on screen, a test per type. Quote and link, never characterize. Change markers: "last checked" on every position; visible "this page changed since we last checked" with prior date when snapshots differ; never interpreted. Surface: Positions section in the large popup, topic-searchable within the popup (corpus search for this person only — NOT the routing chat). A07 in full; party-inference guard extends.

## 7 — Documents and handoff

`state.md`: the NH overturn preserved, the Kelly-standard audit table, every 3-series fix, the summaries file, FEC with its structural line, positions live; test count in all three places. `CLAUDE.md`: the ripcord doctrine; the disclosure-decision update. Tracker: D23 split recorded, ripcord rows, defects triaged with row IDs, next free ID verified. Transparency page verified against everything shipped. Overwrite `docs/session-brief.md`. Ship, verify deploy, standing report.

## Order, and cuts if short

1 → 2 → 3 → 4 → 5 (whole or defers whole) → 6 → tester pass → 7.

Items 1–3 are correctness and the author's direct experience — never cut. The tester pass is never cut — it is the point of the session. If short: defer 6 first, then 5 (it defers WHOLE — a funding surface without tags and ripcords is the forbidden configuration), then thin 4 to the top ten bills by recency with the honest "coming" state on the rest. A deferred build item is fine; a defect the tester will hit is not — when choosing between finishing a new surface and polishing an existing one, polish wins this session. Documents never cut.

## Standing rules

All of CLAUDE.md's non-negotiables. Denominators with counts; screenshot before believing green; diagnose before fixing; compare identifier sets before any adapter; never assert absence of data in a test; grep after scripted edits; verify branches; nothing Done without branch + checks; a failed operation may not render as an empty success; a URL cited must have been fetched and verified — a 404 or a generic landing is a MISS, not a citation.
