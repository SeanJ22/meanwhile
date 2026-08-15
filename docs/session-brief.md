# Session brief — the tester's mobile pass: Arizona bleeds again, and the ballot goes missing on phones

*Executed 2026-08-14 (sixth session of 2026-08-14), branch
`claude/tester-mobile-pass-0814`. This is the brief as the author wrote it,
committed for the record; what actually happened is `docs/state.md` §22 and
`docs/tester-pass.md`.*

On completion, overwrite `docs/session-brief.md`.
This session runs unattended. Nobody is available to answer.

* Reversible: cheaper-to-undo, recorded with the rejected alternative, keep
  going. Irreversible: skip, tracker row, continue.
* Hunts never stop — more rungs, `attemptedAt` on every rung. The long way is
  a way.
* Browser-heavy steps LAST, inline, no background agents.
* Live on every push; nothing half-finished to `main`. End with
  `pnpm handoff --ship`, verify on `main`, verify the deploy, standing report
  ending with "Needs your hands."

Session-open: read `docs/defects.md` and triage.

## Context

The outside tester ran a full mobile pass and sent recorded feedback with
screenshots. Overall verdict: navigation smooth, found everything without the
tutorial, calendar/election header praised. This brief is the defects and the
one big finding. She tapped many reactions — the store's tester delta is now
real; the daily intake report should reflect it.

The photo session (`docs/photo-report.md` as input, brief already written)
runs IMMEDIATELY AFTER this one — nothing photo-related here beyond item 5's
line.

Correct first. Fast second. Nothing third. Item 1 is a false claim about which
government serves the reader, live in production, found by the tester. It
leads and it gates.

## 1 — Arizona bleeds into New Hampshire through the ask box (GATED)

The tester asked "library" at 03255. The rendered answer's explainer copy
cites Pima County ("in Pima County the county board sits as the Library
District board"), and tapping through from the Newbury result landed her on
the PIMA COUNTY LIBRARY BOARD — Arizona content and an Arizona link served to
a New Hampshire reader. Last session's cross-jurisdiction audit covered
rosters, curated bodies, and everyday contacts; the ask box's TOPIC EXPLAINER
TEMPLATES and their LINK TARGETS were outside its scope. Same class as the
Rockaway mayor: one jurisdiction's content bound to another's key.

* Diagnose before fixing: find how shared explainer copy and its links are
  assembled, and every place a topic template carries jurisdiction-specific
  content or targets.
* Fix: explainer copy is either jurisdiction-neutral (no named counties,
  cities, or bodies from elsewhere) or resolved per-jurisdiction from the
  reader's own registry entries. Every link in an ask-box answer resolves ONLY
  within the reader's jurisdiction set. An Arizona example may never render at
  a New Hampshire zip, however illustrative.
* Extend the cross-jurisdiction guard (last session's mechanical
  place-name/domain check) to cover ask-box answer templates and their link
  targets. Audit ALL topics × all four zips for the same bleed; report what
  was found.
* Gate: screenshot of the library question at 03255 — zero Arizona references,
  every link resolving to a New Hampshire body, spot-verified.

## 2 — The ballot is unreachable on mobile

The tester: the what's-on-the-ballot floater never appears on her phone; the
only entry sits at the very bottom, covered by browser chrome. "I don't think
I would have found that without knowing it existed." The product's core
surface — reactions, picks card, the CTA header — is invisible to a mobile
reader who doesn't already know it's there.

* A persistent "What's on the ballot" entry renders at the TOP of the mobile
  layout (sidebar header / who-governs card — placement judged in the walk,
  but top, always visible, never behind chrome).
* Diagnose why the floater fails at phone width and either fix it or retire it
  honestly on mobile in favor of the top entry — no half-dead floater.
* Guard: at 390×844, the ballot is reachable within one tap of initial load,
  asserted in the walk.

## 3 — Fixed controls cover content at phone width

The hamburger (left) and map zoom +/− (right) sit fixed over text at mobile
width, permanently obscuring card content behind them (tester screenshot: the
Kearsarge card header). Fix the layering/layout so controls never sit over
readable content — reserved gutters, scroll-aware behavior, or repositioning;
judged in the walk. Check every fixed-position control at phone width, not
just these two.

## 4 — District-type defaults: diagnose her four-of-six

Last session shipped all six district-type layers defaulting ON with a
claims-reachable guard. The tester reports only ~4 were checked and she
manually enabled the rest. Likeliest cause: her device's stored layer
preferences predate the fix, and device-local prefs override defaults.

* Diagnose which it is (stale persisted prefs vs a defaults regression). Say
  which honestly.
* If stale prefs: a one-time migration — stored layer selections from before
  the defaults fix are cleared once (versioned prefs key), after which the
  reader's own choices persist as normal. Device-local storage rules
  unchanged.
* Verify on both profiles: a fresh device and a device carrying pre-fix stored
  prefs, both landing all-six-on after migration.

## 5 — The thin-candidate line, and the equal-effort principle

The tester's finding, her words: "Karen might be the perfect fit for me, but
she has no information here. So I'm only going to look at the folks that do
have information... how could using this app actually impact voter outcomes
instead of collect information from voters." The app says nothing about anyone
and still tilts races through information asymmetry — thin cards track
incumbency and campaign professionalism, not merit.

* Every ballot candidate whose card lacks a blurb/photo/contact gets the
  standard line, in the register: "We haven't found much about this candidate
  yet." Full stop — no apology, no second sentence. Rendered wherever the thin
  card renders. Silent absence becomes named absence.
* Into CLAUDE.md, the principle: equal effort per candidate within a race —
  hunts for candidate information (photos, blurbs, contacts) are run for every
  candidate in a contest to the same rung depth, and misses are recorded per
  candidate. The app's neutrality includes what it fails to find.
* Tracker row: the blurb-equalization hunt (a sourced one-line description for
  every ballot candidate, campaign-site or filing-derived, labeled per the
  blurb-source rule) — a future session's item, not this one's.
* Tracker row (business): the candidate coverage-gap report — the author's
  idea. A generated per-race artifact showing a candidate what the app holds
  on them vs. their opponents (fields present/absent, never reader data). A
  candidate-side product surface; design later, record now.
* `state.md` records the tester's finding verbatim as the principle's origin.

## 6 — PAC typing: the funding section says what kind of money (the author's item, tester-validated same day)

Every committee in the tester's screenshot renders "a political action
committee" — Grant Thornton's PAC, Marsh & McLennan's, the Broadcasters',
Fidelity's, undifferentiated. The author's standing rule (organizations render
as filed with committee type) gains its plain-language layer:

* A fixed, committed mapping table translates FEC committee-type codes and
  connected-organization categories into plain labels: "a PAC connected to a
  corporation" / "...a labor union" / "...a trade association" (separate
  segregated funds by connected-org category), "a super PAC"
  (independent-expenditure-only), "a leadership PAC," "a party committee,"
  "the candidate's own committee." Derived MECHANICALLY from FEC fields —
  where the FEC doesn't classify, "an organization" stays, honestly.
* The mapping table is author-reviewable in one file; labels render in the
  register; nothing is ever guessed from a committee's name.
* Each type label carries a tap-for-explainer: two sentences, 15-year-old
  register, sourced to the FEC's own definitions page (fetched and verified).
* Tests: every FEC type code in our snapshot maps or falls to the honest
  default; no label renders that isn't in the table.

## 6b — Photos, round 2: the second door opens, and every face gets fetched (NEVER CUT — the author's order: all of them)

The author's decision, into CLAUDE.md: the photo rule gains a second
acceptable basis. A photo ships with (1) an explicit recorded license, OR (2)
an OFFICIAL GOVERNMENT-PUBLISHED portrait — the portrait a government body
publishes to identify its own member — used with source URL recorded,
attribution, and a documented remove-on-request posture (one line on the
transparency page, same commit). Commercial photography — campaign headshots,
press photos, wire images, anything a working photographer plausibly owns —
still requires an explicit license, no exceptions: that is the class that
generates demand letters. The clean-solo-portrait standard and the
never-wrong-face standard move for nobody.

* FIRST, before any fetching: Katie Hobbs is a wrong or failing face. The
  shipped Commons image is a dark-haired event candid; the state's own
  portrait (gray hair, studio) is at
  https://azgovernor.gov/governor/meet-governor-katie-hobbs — fetch THAT
  portrait under door 2 and replace. Record what the Commons image actually
  was. Check the other two governors' images against their offices' pages
  while there.
* The 130 state legislators: fetch each member's official portrait from their
  chamber's own member page, matched by the member id already in our roster,
  under door 2 — source recorded, EXIF-stripped, committed. AZ's pattern
  (author-verified example):
  https://www.azleg.gov/house-member/?legislature=57&session=130&legislator=2366
  — the portrait is right on the member page. NJ and NH member pages carry the
  same class of official portrait; establish each pattern. This is the tier the
  old rule blocked; the new basis unblocks it whole.
* The Commons sweep across any legislator or local the chamber page fails, and
  across the 68 remaining curated locals — machine-checkable license,
  attribute-verified, same standard.
* Curated locals: official jurisdiction pages under door 2 (board and clerk
  pages publish member photos more often than roster pages); then Commons;
  then the email rung.
* Ballot challengers (the remaining ~76): official pages where they hold any
  office; Commons; campaign og:image ONLY where it is a clean solo portrait
  AND plausibly campaign-produced (their own site's own headshot, recorded as
  campaign-provided) — never a press or photographer image without license.
  The canonical failure classes (logos, wordmarks, banners, event candids)
  keep failing.
* The email rung, drafted not sent: for every person still faceless after the
  above, generate a short permission-request email (nonpartisan civic app,
  official portrait, attribution offered) addressed to the right clerk/photo
  office, batched into `docs/photo-requests.md` for the author to send.
  Sending is the author's; drafting is this session's.
* Manifest and generated report updated; every shipped photo's basis (license
  vs official-portrait) recorded per row; misses keep rungs. Report the new X
  of 750 with the per-tier breakdown.

## 6c — Recorded, not built: LegiScan (the author's find)

Tracker row only, no build this session: LegiScan
(https://legiscan.com/AZ/datasets) publishes state bill data and roll-call
votes as JSON datasets for all 50 states — the candidate source for the STATE
LEGISLATOR VOTING RECORDS gap the app currently renders honestly (and the
tester explicitly asked for). The evaluation, a future state-layer session's
anchor: (1) terms of use read carefully against both the free consumer app AND
the commercial data layer — the two may be licensed differently; (2) roll-call
coverage and freshness verified for AZ/NJ/NH specifically; (3) id-join
feasibility to our roster (their people ids vs ours). Record the row; do not
fetch.

## 7 — Final pass and handoff

Walk at 390×844 as a stranger: the library question at 03255 (the gate), the
ballot reachable in one tap, controls covering nothing, defaults all-on on
both device profiles, a thin candidate's honesty line, PAC labels on a funding
section with one explainer opened, Hobbs's card showing the official portrait,
and twenty new photos spot-checked as clean solo portraits of the right person
against their source pages. Supersede `docs/tester-pass.md`. Documents:
`state.md` (real-date header; the bleed's cause and audit results; the
tester's finding verbatim; every item), tracker in place (including the
blurb-equalization row and the tester's items), next free IDs verified,
transparency page verified. Overwrite `docs/session-brief.md`. Ship, verify
deploy, standing report ending with "Needs your hands" — include the reactions
delta and search-log delta since 2026-08-14 18:32 UTC (the tester's activity,
now including her mobile pass).

## Order, and cuts if short

1 (GATED) → 2 → 3 → 4 → 5 → 6 → 6b → 7.

If short: defer 6 (PAC typing) whole to the next content session — never ship
half a mapping table. Within 6b, the Hobbs verification and the 130 chamber
fetches come first; the email drafts may thin to the largest jurisdictions.
Never cut 1, 2, 5, 6b, or 7. Documents never cut.

## Standing rules

All of CLAUDE.md's non-negotiables including the uniqueness invariant, the
organizations-as-filed rule, the blurb-source rule, n-stores-never-join, and
(new this session) equal-effort-per-candidate. The playbook clause stands. The
stranger test. Denominators with counts; stated N equals rendered rows;
screenshot before believing green; diagnose before fixing; never assert
absence; a failed operation may not render as an empty success; reader-facing
dates are wall clock; a URL cited must have been fetched and verified.
