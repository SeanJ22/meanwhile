# Defects — the production scratchpad

Dump what you notice in production the moment you see it. No tracker
discipline required here — date, surface, what happened, what you expected,
freeform beyond that. The next session reads this file first, turns anything
new into tracker rows, and marks each line with the row ID it became.
**Author types observations; the session does the bookkeeping.**

Format per entry (loose):

```
## YYYY-MM-DD — surface
What happened:
What I expected:
```

A triaged entry gets `→ tracker <ID>` appended by the session that filed it.
Entries are never deleted — a defect that recurs needs its history.

---

## 2026-08-14 — sidebar

What happened: "Reset all" in the sidebar does not work.
What I expected: clicking it returns every control to the default view.

→ tracker **M24** (triaged 2026-08-14; fixed the same day — the handler only
reset `filters` while five control groups had grown around it, and the badge
counted the *default* district-type view as active, so the button also
appeared dead on a fresh page. Reset now runs a registry of resettable
controls; a test fails when a control is added without registering.)

## 2026-08-14 — sidebar, district types

What happened: no way to turn all district types on at once.
What I expected: a "Select all" next to the group.

→ tracker **M25** (triaged 2026-08-14; shipped the same day — "select all"
and "clear" links in the group header, in the existing clear-link style. The
default view stays three types; Reset all returns to it.)

## 2026-08-14 — map, district overlay (reported in the session brief)

What happened: the district overlay checkboxes do nothing — no lines change
when selections are made.
What I expected: checking a district type draws its boundaries.

→ tracker **M27** (triaged 2026-08-14; diagnosed before fixing: the
state→render path measured *working* at production's exact commit — check,
uncheck, select all, clear, both themes, all four zips. What reproduced was
the master "Show districts" toggle being off: the checkbox group stayed
fully interactive and every click was a silent no-op. Fixed the same day —
touching the group now turns the overlay on (except "clear"), the rule is
pure and tested, and the group says "The overlay is off — checking a type
turns it on" while it is off.)

## 2026-08-15 — the session brief (author's notes arrived as the brief, not this file)

The author's production pass for this session was delivered as the session
brief rather than entries here. Triaged and built on branch
`claude/reactions-and-plain-language-0815`; the brief is committed at
`docs/session-brief.md` for the record. Row pointers:

- Reaction capture live → **P03** (In progress: votes wired; provisions/
  free text open), **T03**/**T05** (demo-grade pass, in place), **T08**
  (new: the launch gate — full hardening before the password comes down).
- Viewport-settle failure + honest failure rendering → fixed with 2a
  (guard family extended; production cause instrumented, logs unreachable
  without the author's Netlify login).
- Prop 142 match-then-deny → fixed across all 11 measures (analyses render
  verbatim; see **P01** for what remains).
- Popup architecture → **M05** (Done).
- Plain-language layer → CLAUDE.md non-negotiable + 4a/4b/4c/4d shipped.
- Officials → body rosters ×5, mayor, no-mayor-as-fact (see **M05**/state.md
  §13; NJ rosters still open).
- Canvass lineup → **D33** updated.
- 5d (sidebar counts as doors) — the brief's sanctioned first cut, taken;
  open as future work, no row yet.

## 2026-08-19 — the session brief (author's production screenshots arrived as the brief)

The author's production pass was delivered as the session brief; the brief
is committed at `docs/session-brief.md` for the record. Row pointers:

- FEC replication (Kelly's books on Gallego and Grijalva) → **D40** (Done:
  the cache key, not the join — the query-keyed funding route was publicly
  cacheable and the CDN dropped the query string; target moved into the
  path, uniqueness invariant into CLAUDE.md and tests, gate screenshots
  against FEC-verified figures).
- Butierez as his own donor mislabeled → **D41** (Done: entity typing
  captured, "the candidate's own money" derived mechanically).
- Hobbs's banner photo → **D42** (Done: rule tightened, 6 photos dropped
  to initials with recorded hunts, docs/photo-report.md).
- Contributor names as filed → **D43** (deliberate no-change, the
  author's order, recorded so nobody fixes it).
- 3a–3i copy/UI batch → **M38–M45** (all Done; 3i's honest finding: the
  calendar links had shipped on one surface only).
- Incumbent record links → **B10** (Done, federal by construction).
- The question box → **A09** (Done: v1 routing without generation, both
  goldens live at 85701; A08 updated).

## 2026-08-14 — the tester's recorded feedback (arrived as the session brief)

The outside tester's live-demo feedback was triaged and delivered as the
third 08-14 session's brief; committed at `docs/session-brief.md` for the
record. Row pointers:

- Rockaway mayor wearing Tucson's copy + link (seen live in the demo) →
  **M46** (Done, gated: the per-type mayor blurb carried Tucson's charter;
  the cross-jurisdiction guard is the uniqueness invariant's sibling).
- Kearsarge missing at 03255 → **M47** (Done: default layer selection —
  school wasn't in the default set and the overlay master defaulted off).
- Governor missing from who-governs (the author's own catch) → **B11**
  (Done: statewide executives as a first-class attachment, verified
  in-browser against all three states' own sites).
- Flat officials lists → **M48** (Done: Local / State / Federal
  everywhere, closest-first).
- The PHA answering for potholes at 85723 → **A11** (Done: tie-or-zero
  refuses; the own-governing-slot join).
- Party breakdown on roll calls → **B12** (Done: sums gated to the
  chamber's tally).
- Ballot call-to-action → **M49**; picks card + clear → **M50** (both
  Done).
- Copy/truth batch incl. wall-clock dates sweep and the tutorial →
  **M51** (Done).
- Standing rules → **X04** + CLAUDE.md.
- Recorded, not built: **P12** (people's voice, TABLED), **T10**
  (demo-deletion promise, due at testing end), **D46** (prop sponsors,
  parked), **D47** (state comparison, parked), **V07** (ed-tech, parked),
  **R13** (the playbook clause, standing); D35 notes the tester's
  independent top-issues request.
- Found BY the walk, not reported: **M52** (Done) — overlays pushed
  history state and Next remounted them; no official's full card could
  open at phone width. The prior session's "click dead" mystery, solved.

## 2026-08-14 — the tester's mobile pass (arrived as the session brief)

The outside tester's recorded mobile feedback was triaged and delivered
as the sixth 08-14 session's brief; committed at `docs/session-brief.md`
for the record. Row pointers:

- Arizona bleeding into New Hampshire through the ask box's topic
  explainer templates → **M53** (Done, gated: the templates were outside
  last session's cross-jurisdiction guard; the audit found exactly two
  contaminations and proved the link targets were already sound).
- The ballot unreachable on a phone, and fixed controls over card text →
  **M54** and **M55** (both Done, ONE root cause: an unbounded bottom
  overlay stack, so the who-governs card reached 893px against an 844px
  viewport and its top sat at y = −113).
- Her four-of-six district types → **M56** (Done, and a deliberate
  NO-migration: the selection is not persisted anywhere; she was on a
  deploy four hours older than the fix).
- The thin-candidate line and equal effort per candidate → **B13**
  (Done, plus a CLAUDE.md non-negotiable), with **B14** (blurb
  equalization) and **V08** (the candidate coverage-gap report) recorded.
- PAC typing on the funding section → **D48** (Done).
- Photos round 2, door 2 → **D50** (In progress: three governors' wrong
  faces replaced and 278 chamber portraits shipped; the Commons sweep,
  the curated locals, the challengers and the email drafts remain).
- LegiScan → **D49** (recorded, deliberately not fetched).
- Found BY the session, not reported: **Kelly Ayotte was wearing her
  112th-Congress U.S. Senate portrait** — a different office, roughly
  fourteen years old — and **Mikie Sherrill** a Commons headshot. Only
  Hobbs was in the brief; checking the neighbours found two more.

## 2026-08-15 — the session brief (the author's production pass arrived as the brief)

The author's production pass was delivered as the session brief rather than
entries here; the brief is committed at `docs/session-brief.md` for the
record. Row pointers:

- Sidebar counters, "6 OFFICIALS" beside a 20+ popup and a blank DISTRICTS →
  **M57** (Done). Measured first: OFFICIALS **and** BODIES were both wrong,
  at every zip — 6 vs 24 and 13 vs 60 at 85701. DISTRICTS was spending the
  couldn't-check dash on a switch the reader had turned off; it says "Off"
  now and its door carries the switch.
- Concluded meetings only at Tucson → **M58** (Done). Worse than reported:
  the Concluded chip matched **nothing at all four zips**, Tucson included,
  because the client's date window starts at now. Apptegy also served history
  and had never been asked. **M59** recorded for the two vendors whose
  archives publish a date without a start time.
- The mojibake in every blurb attribution → **M60** (Done). Repaired at the
  data; the repo-wide scan found 12 more nobody had reported, separately
  caused and separately fixed at source.
- Party missing on who-governs → **M61** (Done). Not a render bug — the
  governors' rows held null on purpose. All three now cite an election
  authority's own filing. **M62** recorded: no curated local body publishes
  party on its own page, and that silence had been read as "nonpartisan".
- "Someone else" on single-candidate contests → **M63** (Done),
  context-restricted at the write path.
- Photos → **D50** (still In progress: 535 → 590 of 750; the Commons sweep
  for the ~76 ballot challengers is the named remainder).
- Recorded, not built: **D51** (independent expenditures), **D52** (the state
  money-translation umbrella).
- Standing rule added to CLAUDE.md: every production probe row a session
  creates is named in its report.
- Author's closures honoured: the Pima/Newbury library issue was not
  reinvestigated, and the limiter thresholds were not retuned.

## 2026-08-15 — the design pass (the author's mandate arrived as the brief)

The design pass ("Clean. Like Apple level clean.") was delivered as the
session brief rather than entries here; the brief is committed at
`docs/session-brief.md` for the record, the narrative is `state.md` §25.
No untriaged entries were found at session-open. Row pointers:

- Design system + type hierarchy → **M64** / **X05** (Done; DESIGN.md,
  tokens, CLAUDE.md line).
- Ask box flagship → **M65** (Done). Ballot + funding flagship, PAC-type
  pills → **M66** (Done, guard-tested palette). Three registers → **M67**
  (Done). Provenance footnotes → **M68** (Done).
- The narrowing modal popping on free panning → **M69** (Done: passive
  chip; root cause was the per-zip remount on ZCTA crossings).
- Street input's visible payoff → **M70** (Done, device-side), with the
  geocode-to-a-point remainder recorded as **D53** (blocked on author
  approval of an external geocoder).
- Clear-picks dialog → **M71** (Done).
- Recorded, not built: **B15** (key votes tracker, doctrine locked).

## 2026-08-15 — the session brief (party, meetings, faces)

The author's production pass again arrived as the session brief rather than
entries here; the brief is committed at `docs/session-brief.md` for the
record. No untriaged entries were found at session-open. Row pointers:

- Party for local partisan bodies from certified results → **M62** (Done).
- The day-not-hour meeting shape → **M59** (Done).
- The Census Geocoder, approved → **D53** (Done).
- The NH who-governs card off the top at desktop → **M72** (Done).
- The sidebar footer under the map legend at 390px → **M73** (Done).
- Picks from another state's ballot unlabelled → **M74** (Done).

## 2026-08-15 — the session brief (the depth session: NH and NJ)

The author's directive arrived as the session brief rather than entries here;
the brief is committed at `docs/session-brief.md` for the record. No untriaged
entries were found at session-open. Row pointers:

- The state folders and the zip playbook born → **R20** (Done), anchored at
  **R13**; the playbook clause into CLAUDE.md.
- The adapter window that dropped sixty days of history at every zip →
  **M76** (Done). Found by asking why Newbury showed three meetings when its
  portal publishes twenty sittings in 2026.
- Rockaway's Planning Board and Board of Adjustment → **M77** (Done): the
  boards were in a different iCal category from the council.
- Morris Hills Regional, and the published-annual-schedule shape → **M78**
  (Done). A district running no agenda vendor at all.
- Newbury's other boards and Kearsarge → **M79** (In progress, never
  blocked): both hosts refuse this pipeline; the browser rung is the next rung.
- LegiScan → **D49** (Done), with **D54** recorded for the scheduled refresh
  and its repo secret.
- Photos under doors 3 and 4 → **D50** round 5 (still In progress: 592 of 750).
- The street input's question → shipped; **M80** opened for the CORS wall the
  walk found under it, which also names what D53 has never been able to do in
  a browser.
- The jurisdiction badge → **M81** (deferred whole, nothing half-built).

## 2026-08-15 — the session brief (the money session)

The author's directive again arrived as the session brief rather than as
entries here; the brief is committed at `docs/session-brief.md` for the
record, and the narrative is `state.md` §28. No untriaged entries were found
at session-open. Row pointers:

- The register doctrine into CLAUDE.md → **X06**.
- Contributions sorted by money, grouped by kind, repeat filings collapsed →
  **D55**. The second hop, "Give me the tea" → **D56**. The small-donor
  honesty floor → **D57**.
- Found BY the work, live on production → **D58**: `/schedules/schedule_a/`
  returns every RECEIPT, not every gift, and AMALGAMATED BANK was rendering
  three times as one of Mark Kelly's biggest contributors. It was his own
  bank refunding fees (FEC line 15). 75 non-contribution receipts dropped,
  counted by line.
- The Facebook-as-campaign-site rule → **X07** (rule adopted; the sweep is
  the open half, and was the brief's own first cut).
- The polling-place pointer → **M82**, with **B16** recorded for the
  address-level version.
- One person, one photo → **D59** (the author reported one; the audit found
  nine). Risa Lombardo's portrait → **D60**. "School District Not Defined" →
  **M83** (both a real gap geometry AND a labeling defect). Cancellation
  signals per adapter → **M84** (the zeros are real, with denominators; two
  adapters were not looking at all).
- The geocoder proxy and the keepable promise → **M80** (Done, verified end
  to end on production). Found BY that verification → **M85**: the
  crossing-street question had never once been asked, because applying a
  street unmounted the component that asks it.
- The LegiScan Sunday workflow → **D54** (Done, run green in Actions).
- Key votes → **B15** (In progress: machinery and 16/16 nominations
  verified), with **B17** recording the route that resolves the laws.
- Found BY the walk → the FEC snapshot was stamped with TOMORROW's date:
  `toISOString()` after 5pm Phoenix. Scripts call `stamp()` now and a test
  fails on any snapshot date later than today.
- Recorded, not built, in the brief's own cut order: **6c** (school-life
  routing), **6d** (the ask-box classifier), **6f**/**M81** (the jurisdiction
  badge), **7b**/**R16** (the 81 session-label dates), and item 5's sweep.

## 2026-08-15 — the session brief (the truth session)

The author's directive again arrived as the session brief rather than as
entries here; the brief is committed at `docs/session-brief.md` for the
record, and the narrative is `state.md` §29. **No untriaged entries were
found at session-open** — every entry in this file already carries its row
pointer. Row pointers for what the brief asked:

- The browser rung; Kearsarge's calendar and Newbury's three land-use boards
  → **M79** (Done). The obvious guess was wrong: a Chrome User-Agent is not
  the rung — Node's fetch with a full browser header set is still 403'd and
  `curl` with the identical headers is served, so the filter reads the
  TLS/HTTP2 fingerprint.
- EVERY division battlecard denying its officeholders → **M86** (Done).
  Diagnosed before fixing, and the diagnosis narrows the report: the large
  card asked the curated rosters alone, so the twelve congressional /
  state-house / state-senate cards denied their own members while county,
  municipal and school cards were already right.
- The districts counter → **M87** (Done). Both modes, both guarded.
- The funding-reactions ripcord, the five-point question, scale versioning →
  **D61** (Done), with the author's ruling recorded verbatim.
- The transparency diet → **M88** (Done). Found BY the read-aloud: the
  photographs section still described two doors after the photo rule grew to
  four.
- The Level 1 classifier → **A12** (Done), verified live at 85701.
- The law rows' roll calls → **B17** (Done), 0 of 20 to 18 of 20. Found BY
  the work: matching BSCA's "final passage" on the literal words picked the
  House's May passage of its own unrelated version of the bill, not the June
  concurrence that is the vote on the gun law.
- Recorded, not built: **B18** (town halls) and **D62** (the PRL evaluation).
- Cut per the brief's own order: **X07**'s sweep, **R16**, 6c, **M81**.

## 2026-08-15 — the session brief (mobile round two: the phone feels native, and the palette gets reconsidered)

The author's mobile pass again arrived as the session brief rather than as
entries here; the brief is committed at `docs/session-brief.md` for the
record, and the narrative is `state.md` §30. **No untriaged entries were
found at session-open** — every entry in this file already carried its row
pointer. Row pointers for what the brief asked:

- Newbury's Zoning Board live on one curated venue row → **M89** (Done). The
  venue was never missing: it is in the department page's contact MARKUP, not
  its prose, which is why three rungs of careful reading came back MISS.
- Native dismissal, the floaters, the zip switcher, the session-scoped
  location, the palette pass, the framed question boxes → **M90** (Done).
- Found BY the palette pass: **`--signal` was never a real CSS property** →
  **M96** (Done). It lived only inside `@theme inline`, so `text-signal`
  worked and every `border-[var(--signal)]` resolved to nothing — the "filled
  amber Ask button" was an outline and the who-governs card's ballot entry had
  no accent at all, invisible in every diff because the class names read
  correctly.
- The two audits → **M97** (Done). `pnpm contrast` at a 7:1 sun bar (light
  `--link` measured 2.90:1), `pnpm overlaps` across nine states at 390px.
  Found BY the walk: the sidebar-count doors at `z-40` under z-1100 chrome.
- The battlecard's collapsed sections and two vote columns, plus "In seat
  until" and age → **M98** (Done). Found BY wiring it: the key-votes surface
  defaulted a null position to **"Did not vote"** — a false claim about a
  named member — and there were no positions in the product at all.
- The four 6f2 rulings → **M99** (Done): the 90-day default, "not
  independently verified" retired, district cards enriched, FEDERAL in
  `TIER_LABEL` where it belongs.
- 6f3's two rulings recorded: the ask classifier author-ruled acceptable
  (flag stays LIVE, question retained), and the last-passage rule as standing.
- The screenshot tooling → **R21** (Done).
- Recorded, not built, nothing half-built: **M91** (the state-focus map, the
  brief's largest item, design captured whole), **M92** (See information / Go
  to website, and the AZ-6 linking defect named inside it), **M93** (the
  who-governs information order), **M94** (two more repeated notices),
  **M95** (a sourced term end for the three governors).
- **No production probe rows were created this session** — nothing was
  written against production at all. Stated because the standing order
  requires it either way.

## 2026-08-16 — the session brief (hotfix: the deploy gate)

The author's hotfix directive arrived as the session brief; the brief is
committed at `docs/session-brief.md` and the narrative is `state.md` §31. No
untriaged entries were found at session-open. Row pointers:

- The type error that blocked the deploy, its diagnosis, and the gate →
  **R22** (Done). Netlify failed on a WALK SCRIPT while the site code
  compiled clean. The stale-`.next` suspect was tested and is wrong — a
  warm-cache build reproduces the failure exactly; the ordering suspect is
  right, and the gate is `pnpm build` inside `pnpm handoff --ship`.
- **§30 is verified live**: `pnpm walk:0815g` 20 of 20 against production,
  31 meetings and 1 zoning-board row at 03255, 36 `keyVotes` on
  `/api/votes`. **M89**, **M90**, **M96**–**M99** and **R21** amended by ID.
- Found by the verification: **the front-page-HTML deploy probe is wrong by
  construction** → **R24** (Done). `.ballot-pill` cannot appear in the SSR
  HTML now that the location is session-scoped, so the probe reports a broken
  deploy on a working one. Replaced by the CSS bundle and the walk.
- Found by building the gate: **the gate's own first version could not run
  the build it was gating** (Windows `.cmd` shim + `execFileSync`), and
  refused a clean tree. Recorded inside R22; a false refusal, so nothing
  shipped broken.
- The Turbopack whole-project-tracing warning → **R23** (recorded, not
  built). `pnpm pairs prod` → **R25** (Done).
- **No production probe rows.** Every production request this session was a
  GET; the walk taps no reaction and fires no log event.

## 2026-08-16 — the session brief (g3: the regression net)

The author's directive arrived as the session brief rather than as entries
here; the brief is committed at `docs/session-brief.md` for the record and the
narrative is `state.md` §34. **No untriaged entries were found at
session-open** — every entry above already carried its row pointer. Row
pointers for what the brief asked:

- The regression net → **R27** (Done). Run against production BEFORE anything
  was fixed: 20 named regressions, 5 checks that could not run. Four of the
  twenty were the walk's own aim and were corrected, not softened.
- `/about-area` 500ing at every zip → **M121** (Done). A render prop crossing
  the server/client boundary; nothing failed at build.
- Kearsarge dark, and the schedulepage refresh → **M122** (Done). **The
  brief's diagnosis lead was wrong**: curl is present on the runner and the
  log proves it ran and was refused — the wall is the runner's egress IP. Two
  defects fixed; 03255 restored to 31 meetings across 5 bodies against the
  truth session's 26 across 4.
- The neighbouring Kearsarge towns → **M123** (deferred, every rung recorded).
- The WGH footnote collapse → **M94** (Done).
- The sources vocabulary → **M125** (Done), with the audit the ruling asked
  for: three surfaces render the field and only one was wrong.
- Zooming out removing pins → **M124** (Done). Neither clustering nor culling.
- The ballot page → **M126** (Done) and **D65** (Done, the scale-v3 ruling).
  **Your-picks was NOT gone from production** — measured working before it was
  touched; what was true is why it read as gone.
- The governors' term end and age → **M95** (deferred first, per the brief's
  own cut order; no rungs walked, so the row is a deferral and not a partial).
- The duplicate contact section → **M127** (Done, audited before deleting).
- The state focus and the border-crossing prompt → **M91** (Done), with one
  conflict left for the author: e's 6b2 releases focus on zoom-out, g3 says
  the effect never disappears. The later instruction shipped.
- Standing rules into CLAUDE.md: walk:all every session; a failed fetch never
  empties a full surface; an official-source read IS the verification; more
  viewport never means fewer pins.

## 2026-08-16 — the session brief (g4: Apple-level clean)

The author's directive arrived as the session brief rather than as entries
here; the brief is committed at  for the record and the
narrative is  §35. **No untriaged entries were found at
session-open** — every entry above already carried its row pointer. Row
pointers for what the brief asked:

- The mask bound to the last successful activation rather than to where the
  reader is → **M128** (Done). One line: . Found while
  fixing it — the focus hook rebuilt its object every render, so the
  border-crossing prompt was cleared one render after it was raised and could
  never be read.
- The extrusion reading as a grey stroke → **M129** (Done), with **M131**
  opened for the light theme's unproven lobe asymmetry. The measurement found
  two defects no screenshot showed: an INVERTED silhouette (the mask and both
  shadows were fed the clip path) and Chromium CLAMPING an oversized SVG
  filter region rather than fading it.
- Every state drawing its districts at once → **M130** (Done), and the
  1,592 KB national congressional file split per state (23 KB in Arizona).
- The zip with no shape of its own → **M132** (Done). The geometry did not
  exist and was fetched: 1,242 of 1,246 ZCTAs across the three states, served
  per-zip rather than shipped.
- The camera gliding back to the starting point → **M133** (Done). The
  2,800 ms auto-frame, exactly as the brief suspected.
- Filters, the meeting groups, both of Grijalva's numbers, the tick and the
  cross, the tier-only dividers and the exact moving-here line → **M139**
  (In progress) and the item 7/8/11/14 work inside **M128**'s branch.
- The sidebar Bodies door throwing the reader out → **M135** (In progress:
  the named case converted, the full list-surface audit open).
- The walk grew by twelve checks and three of its own aims were corrected →
  **R28** (Done).
- **Recorded, not built, nothing half-built**: **M134** (a Yes becomes the
  pick), **M136** (body battlecards to person-card depth), **M137** (ONE
  search box), **M138** (one popup at a time), **B19** (polling place in the
  app), **C05** (the buyer surface's denominator and the exclusion of our own
  rows). **M95** and **M123** were not reached.
- **Probe rows named**: 3 from the first browser probe (2 FILTER_APPLIED, 1
  SEARCH at 03255), plus the SEARCH rows every local Playwright run writes to
  production — 25 search-log and 13 ask/log rows on the final local walk
  alone. No reaction was tapped and no ask was submitted.


## 2026-08-16 — the session brief (h: everything in 03255, and what it cost)

The author's directive arrived as the session brief rather than as entries
here; the brief is committed at `docs/session-brief.md` for the record and the
narrative is `state.md` §37. **No untriaged entries were found at
session-open** — every entry above already carried its row pointer. Row
pointers for what the brief asked:

- The transparency mandate and the fourteen-rung ladder into `CLAUDE.md`,
  verbatim, above the operational rules → **X08** (Done, item 0, first action
  of the session). One adaptation named: the brief cites experimental control
  C5, which the brief itself forbids copying into `CLAUDE.md`.
- Found AT session-open, not reported: **the tracker carried two rows per ID**
  → **R29** (Done). `M128` and `M129` each had two rows for entirely different
  work; the g5 pair is now **M140**/**M141**. `CLAUDE.md` forbids this by name
  and already records M02/M04 doing it once — it recurred because nobody
  enforced it. `tests/tracker-integrity.test.ts` is the guard, proven to fail
  on a planted duplicate before being trusted.
- The frozen universe, both denominators, the field matrix, the ballot
  universe and the meetings-near rule → item 1, committed at
  `docs/universe-03255.md` and `data/audit/universe-03255.json`.
  **The official denominator for 03255's meetings-near universe did not exist
  in the repo** — the committed extract held Merrimack County alone and the
  25 km circle crosses two county lines.
- Found BY building it: **units are not bodies, and no external enumeration of
  bodies exists** → **H02**. One Census row for the Town of Newbury stands
  behind five-plus bodies; `pnpm census:zip 03255` printing "6 of 6" is true
  against the registry and says nothing about the town.
- Found BY building it: **a self-closing empty `.xlsx` cell swallows its
  neighbour** under a naive cell regex, shifting every later column. Twelve
  Merrimack special districts vanished and it read as a data difference rather
  than a parse bug. Caught by the count discipline, fixed, and written into
  the playbook.
- Kearsarge's member towns → the brief's own working list was wrong in both
  directions: **Goshen is not a member, Warner is and holds three of nine
  seats**. A plausible false answer (Bradford/New London/Sutton — the towns
  with school buildings, carried in every page's navigation) was rejected
  rather than recorded.
- Two new facts about `kearsarge.org`, both from reading rather than guessing:
  it is **CivicPlus** (rung 12 available, never tried), and it carries a
  **RATE** wall distinct from the TLS-fingerprint wall already recorded.
- **Deferred whole, nothing half-built, each carrying its full spec**:
  **H01** (the depth sweep — 2 subjects hunted of ~60 bodies in scope),
  **H03** (the re-walk cohort, 0 walked), **H04** (the candidate sweep, 0 of
  47), **H05** (special-district territory, 40 UNRESOLVED), **H06** (the C7
  same-subject replays and the C2b backfill).
- The scorecard → `docs/scorecard-03255.md`. **Its headline is that the three
  cost views are not computable from what this session did**, and saying so is
  the finding. Total instrumented network time for the session: 12.1 seconds
  across 15 fetches.
- Documents → `state.md` §7 restructured into Phases A–E (the architecture-era
  table is in git history, its two live remainders mapped into Phase E),
  `README.md` rewritten as a pointer-style front door, `states/nh/NOTES.md`
  and `docs/zip-playbook.md` appended.
