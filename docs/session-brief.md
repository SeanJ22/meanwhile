# Session brief — 2026-08-15

The author's production pass, as delivered. Committed for the record and
superseding the previous brief; the work it asked for is recorded in
`docs/state.md` §24 and in tracker rows **M57–M63**, **D50–D52**.

---

## The counters tell the truth and the faces finish

This session runs unattended. Nobody is available to answer.

- Reversible: cheaper-to-undo, recorded with the rejected alternative, keep
  going. Irreversible: skip, tracker row, continue.
- Hunts never stop — more rungs, `attemptedAt` on every rung. The long way
  is a way.
- Browser-heavy steps LAST, inline, no background agents.
- Live on every push; nothing half-finished to `main`. End with
  `pnpm handoff --ship`, verify on `main`, verify the deploy, standing report
  ending with "Needs your hands."
- **NEW STANDING RULE, this session and forever:** every production probe row
  a session creates (reactions, log events) is NAMED in the standing report —
  timestamp and target — so the author can distinguish plumbing from reader
  signal. The T08 session did this; the 0814f session didn't, and it cost the
  author a manual investigation. Into CLAUDE.md.

Session-open: read `docs/defects.md` and triage. The Pima/Newbury library
issue is CLOSED by the author (timing overlap between the 0814c routing fix
and the tester's pass); do not reinvestigate. The two VELOCITY-quarantined
rows are confirmed as session probe taps, not the tester's — the limiter
thresholds are CORRECT, do not retune.

A dedicated DESIGN session follows this one; visual/polish work is out of
scope here except where a fix requires touching a render.

Correct first. Fast second. Nothing third. Items 1–4 are truth defects and
lead. Photos ride last but are NEVER CUT.

### 1 — The sidebar counters lie (the denominator disease, third sighting)

The sidebar reads "6 OFFICIALS" while the officials popup renders 20+ (mayor,
six council members, governing board, five supervisors, state and federal).
The DISTRICTS counter renders blank ("—"). The stated-N guard family exists
and these counters escaped it.

- Diagnose: the officials count is almost certainly computed from the
  district-elected roster set while the popup unions curated locals.
  Districts blank is its own bug — find it.
- Fix: every sidebar counter computes from the SAME set its surface renders.
  One source of truth per number.
- Extend the stated-N guard to the sidebar counters explicitly: counter value
  equals rendered rows of its popup/surface, asserted for all four counters
  at all four zips.

### 2 — Concluded meetings exist everywhere, render only for Tucson

The author sees concluded meetings only at 85701. Vail, Newbury, Rockaway all
have recent past meetings in reality.

- Diagnose: likely only the Legistar adapter (Tucson) was ever asked for past
  meetings; the other vendors' adapters fetch upcoming only — or the snapshot
  window excludes history. Say which per adapter.
- Fix: extend each adapter to fetch concluded meetings where its vendor
  provides them (match the Tucson window). Where a vendor genuinely does not
  serve history, the Concluded filter at that jurisdiction says so honestly
  ("This body's system doesn't publish past meetings") instead of rendering
  empty.
- Guard: for every jurisdiction whose vendor serves history, the concluded
  surface is non-empty OR carries the honest line. Never silent-empty.

### 3 — The mojibake: a broken em-dash renders in every blurb attribution

"From the candidate's site [mojibake] cindewarmington.com" — a UTF-8 em-dash
decoded wrong, everywhere the attribution line renders.

- Diagnose where the bytes go wrong (fetch, store, or render) — fix at the
  SOURCE, not with a display-time patch. Re-run whatever pipeline stored the
  corrupted strings so the stored data is clean.
- Guard: a test greps all reader-facing strings (registry, blurbs, summaries,
  templates) for mojibake byte signatures and fails on any hit.

### 4 — Party affiliation missing on who-governs rows (rule regression)

Ayotte shows "Republican" on the ballot and nothing on the who-governs box.
The standing rule is party in colored font EVERYWHERE it renders. The
statewide-executive rows (and audit: any other row class) shipped without the
party join.

- Party renders on every officeholder row on every surface: who-governs,
  officials popup, modals — colored per the existing scheme, sourced as
  already held.
- Audit all officials surfaces for rows lacking party where party is held;
  fix the class. Where party is genuinely not held for an office
  (nonpartisan local boards), nothing renders — never guess.
- Guard: any officeholder row whose registry entry carries party must render
  it.

### 5 — "Someone else" on single-candidate contests

Under "What do you think?" in contests with exactly one candidate, a fourth
option renders: "Someone else." It is the only honest sentiment measure an
uncontested race has.

- A NEW reaction enum value, added properly to the server-side validity table
  (accepted only for single-candidate contest contexts), same identifier-free
  store, same tier stamping, same honest-outcome rendering (success only on
  204).
- The transparency page's reaction language covers the new value in the same
  commit; the coupling guard extends.
- Tests: validity (rejected outside single-candidate contexts), storage,
  rendering. The walk taps one on production — NAME the probe row.

### 6 — Photos: D50 finishes (NEVER CUT)

The email rung is DEAD by the author's order — the portraits are on the
states' own pages. Complete the remaining classes under door 2 and the
existing rules (clean solo portrait or initials; basis recorded; EXIF
stripped; served from origin; never a wrong face):

- NH Senate: the roster page the author supplied —
  https://gc.nh.gov/senate/members/senate_roster.aspx — member pages carry
  portraits. Fetch all 24 under door 2.
- NH House: the member pages behind the roster dropdown at
  https://gc.nh.gov/house/members/ carry photos for members who have them;
  fetch what exists. The state's own nophoto.jpg means initials — that is the
  honest end state for a volunteer 400-seat House, recorded per member, and
  it satisfies equal-effort.
- Commons sweep for NH members the state lacks, the 68 curated locals, and
  the ~76 ballot challengers — machine-checkable licenses, attribute-verified.
- Locals: official jurisdiction/board pages under door 2 first, then Commons.
- Manifest + generated report updated; new X of 750 with per-tier breakdown;
  every miss with rungs. D50 → Done or the honest remainder named.

### 7 — Final pass and handoff

Two tracker rows recorded this session (recorded, not built):

- Independent expenditures: the next funding content item — FEC Schedule E
  spending ABOUT covered races, rendered distinctly from contributions ("this
  group spent money on its own about this race" vs "gave to the campaign"),
  same mechanical typing rules. A future session's item.
- The state money-translation program (umbrella): per-state campaign-finance
  adapters with author-approved plain-language mapping tables, born with the
  state-folder convention; parked behind the state-layer sessions.

Walk at 390×844 as a stranger: counters equal popups at all four zips, a
concluded meeting outside Tucson (or its honest line), zero mojibake,
Ayotte's party on who-governs, a "Someone else" tap landing in Neon (NAME the
probe row), and twenty new faces spot-checked against sources. Supersede
docs/tester-pass.md. Documents: state.md (real-date header, every item),
tracker in place, next free IDs verified, transparency page verified.
Overwrite docs/session-brief.md. Ship, verify deploy, standing report ending
with "Needs your hands" — probe rows named per the new rule.

### Order, and cuts if short

1 → 2 → 3 → 4 → 5 → 6 → 7. If short: thin 6's Commons sweep to NH members
only (locals/challengers named as remainder). Never cut 1, 2, 3, 4, 5, or 7.
Documents never cut.

### Standing rules

All of CLAUDE.md's non-negotiables including the uniqueness invariant, the
organizations-as-filed rule, the blurb-source rule, n-stores-never-join,
equal-effort-per-candidate, and (new) probe-rows-named. The playbook clause
stands. The stranger test. Denominators with counts; stated N equals rendered
rows; screenshot before believing green; diagnose before fixing; never assert
absence; a failed operation may not render as an empty success; reader-facing
dates are wall clock; every date written into any document comes from
`pnpm stamp`, never typed from assumption (R14's law); a URL cited must have
been fetched and verified.

---

## What the session did with it

Every item was taken. Three of the five truth defects were **worse or
different than reported**, which is the argument for the diagnose-first rule:

- **1** — two counters were wrong, not one. BODIES read 13 against a door
  listing 60 and nobody had noticed. DISTRICTS' blank was the couldn't-check
  dash spent on a switch the reader had flipped.
- **2** — the Concluded chip matched nothing at **all four zips including
  Tucson**; the payloads already held the meetings. Apptegy also served
  history and had never been asked.
- **3** — the repo-wide scan found **twelve more** corrupted strings nobody
  had reported, separately caused (TIGER DBFs read as latin1; a vendor
  serving genuinely double-encoded bytes).
- **4** — the render was never broken. The data was null on purpose, and the
  audit found that **no curated local body publishes party at all**, which
  had been silently read as "these offices are nonpartisan".
- **5** — built as specified, context-restricted at the write path.
- **6** — 535 → 590 of 750; the three NH identity joins the hunt could not
  previously make, and one fabricated absence caught by going to look.

The brief's sanctioned cut was taken: the Commons sweep is thinned to NH
members, with the locals partially done under door 2 (20 of 68) and the ~76
ballot challengers named as remainder. D50 stays **In progress** for that
reason.
