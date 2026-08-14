# Session brief — the FINAL build before the outside tester (executed 2026-08-18)

This file is the session's full brief, committed on completion per its
own instruction. Executed on branch
`claude/fec-funding-and-final-prep-0818`; the record is `docs/state.md`
§16 and the tracker rows it names. This session runs unattended. Nobody
is available to answer.

- Reversible decisions: cheaper-to-undo option, recorded with the
  rejected alternative, keep going. Irreversible: skip, tracker row,
  continue.
- A source hunt is never a stopping point — make more rungs, record
  every rung with `attemptedAt`. "The long way is still a way" (the
  author, on NH).
- Browser-heavy steps LAST, inline, no background agents.
- Live on every push; nothing half-finished to `main`. End with
  `pnpm handoff --ship`, verify on `main`, verify the deploy, standing
  report.

Session-open: read `docs/defects.md` and triage.
Correct first. Fast second. Nothing third. The stranger test governs
every surface.

This is the last session before the tester. The order below is
deliberate: FEC is FIRST because it has been deferred twice by running
last. It ships this round — the author's explicit order, no exceptions,
no duress clause this time.

## 1 — FEC funding surfaces. First. Whole.

The spec is carried verbatim from D34's row and the prior briefs — build
exactly it:

- Adapter: FEC key from `.env.local` into the fetch-script environment
  ONLY — never Netlify, never client. Snapshot pattern: committed
  artifact, scheduled refresh, no live calls per page load. Print the
  FEC-candidate-id vs roster/ballot-id match rate before writing the
  adapter.
- Data, tagged: committee-level (total raised, spent, cash on hand,
  small-donor share, cycle-to-date) tagged `FEC_COMMITTEE`;
  contributor-level display (top contributors/committees as the FEC
  publishes them) tagged `FEC_CONTRIBUTOR`, reader-facing only. A guard
  test asserts FEC_CONTRIBUTOR rows are unreachable from the
  aggregation/export path.
- Surface: a Funding section on candidate cards and official large
  popups. Plain register, 15-year-old test: "Her campaign has raised
  $4.2M this cycle. About a third came from small donors." Top
  contributors listed as filed, cited, never characterized. Cited
  absences for no-committee / no-filings-yet.
- Reactions: the reusable control on both funding displays — tags
  `FUNDING_TOTAL_REACTION` and `CONTRIBUTOR_REACTION`.
- Ripcords: `ripcord.fecContributorDisplay` (kills contributor display +
  its control; committee totals unaffected) and
  `ripcord.fundingReactionsInAggregates` — the second ships PULLED
  (funding reactions excluded from any sellable aggregation from day
  one). Tracker rows name counsel as closer of the RIPCORDS — the build
  is done.
- Transparency page updated in the same commit: the funding data shown
  is public FEC data; reactions to it follow the same rules as vote
  reactions.
- Federal officials and candidates first (they have FEC committees);
  state/local candidates render the honest "state campaign-finance data
  comes from state systems — coming" note rather than silence.

Gate: the Funding section live on Ciscomani's and at least three ballot
candidates' cards, screenshots, both ripcord flags demonstrably
functional (flip each in a test).

## 2 — Sunnyside and Amphitheater: actually wire them

The author checked: nothing is wired — "like nothing happened." The
registry divisions existed; the audit marked the municipal/school layers
complete; and no bodies, sources, or links shipped. Diagnose the miss
honestly (the audit's "complete" claim was about the REGISTRY layer —
record in state.md that the wiring layer was not delivered and the
report implied more than shipped), then deliver the full treatment:
governing-board body rows, agenda sources hunted per the ladder (both
districts run standard AZ vendor stacks — identify and wire), rosters
with Kelly-standard member cards (6e's rule: if we show a body, we show
its people), comment access, office explainers. Same for any other
four-zip-serving district the audit's backlog lists as within reach.

Gate: both districts render bodies, members, and meeting sources (or
recorded exhausted hunts) at 85701/85641 — screenshots.

## 3 — NH legislator contacts: the long way

gc.nh.gov walls this environment entirely. The author's direction:
nh.gov is accessible — find the click path. The long way is still a way.
Rungs to work, in order, recording each:

- The nh.gov portal's own paths INTO legislative content — state
  directories, the state library, agency pages that republish member
  lists.
- The Wayback Machine's captures of gencourt member pages and roster
  downloads.
- The SOS's election results and filings (they carry every member's
  name, town, district — and often addresses).
- County delegation pages (NH counties publish their state-rep
  delegations), municipal sites listing "our representatives," and the
  two chambers' clerk documents wherever mirrored.
- Published PDF directories (the General Court publishes printable
  member directories — find a mirror or cached copy).
- Official press/committee documents carrying member contact blocks.

The Kelly-standard fields per member: specific page or verified
directory entry, email, phone, photo where officially published. Partial
is acceptable if honest — a member with email-but-no-phone renders what
exists. Every miss recorded. Merrimack-district members (the tester's)
first, then the rest.

## 4 — The punch list from the tester pass and the honest-limits section

- 4a — Rockaway Township BOE members: surnames-only → full names, from
  the district's own pages or minutes (the long way applies).
- 4b — Goodlander's portrait and any other seeded portrait gaps —
  official sources.
- 4c — Minutes-summary curation: the seeded worklist — plain-language
  "what happened" for concluded meetings in the window where minutes are
  published, register standard, cited; honest "minutes not yet posted"
  otherwise.
- 4d — Every open item in `docs/tester-pass.md` not covered above: work
  the list, mark each resolved or explicitly deferred with reason.

## 5 — The final polish pass

Walk all four zips once more at 390×844 as a stranger — the stranger
test explicitly — after items 1–4 land. Every new surface (Funding
sections, the new districts, NH contacts) joins the pass. Fix small on
the spot; log anything larger. Supersede `docs/tester-pass.md` with the
final log. This log is what the author reads before sending the link.

## 6 — Documents and handoff

`state.md`: the FEC build with its structural line and the D34 closure
(build done, ripcords open, counsel closes them); the Sunnyside/Amphi
wiring and the honest record of the prior session's overclaim; the NH
contact rungs; the punch-list resolutions; test count in all three
places. Tracker: D34 updated, rows in place, next free ID verified.
Transparency page verified. Overwrite `docs/session-brief.md`. Ship,
verify deploy, standing report — and end the report with a short section
addressed to the author: "Before you send the link" — the migration
reminder, anything requiring his eyes, and the state of every known
limitation in one place.

## Order, and cuts if short

1 (FIRST, whole, ships) → 2 → 3 → 4 → 5 → 6.

Item 1 is not deferrable this session — the author's explicit order. If
the session runs short: thin 4c to the five most recent meetings, then
4b, then 3 beyond the tester's Merrimack members. Items 1, 2, and 5 ship
regardless. Documents never cut.

## Standing rules

All of CLAUDE.md's non-negotiables, the stranger test, the
official-universe denominator. Denominators with counts; screenshot
before believing green; diagnose before fixing; compare identifier sets
before any adapter; never assert absence of data in a test; grep after
scripted edits; verify branches; nothing Done without branch + checks; a
failed operation may not render as an empty success; a URL cited must
have been fetched and verified.

## Outcome (recorded on completion)

All six items shipped whole — nothing cut. D34 Done (ripcords are
counsel's to close via D23); D39 done; NH 389/410 enriched through the
Archive's capture of the General Court's own directory; BOE full names;
Goodlander's portrait; two minutes summaries with the rest of the
worklist honestly recorded; 89 walk checks green, zero console errors.
test 371 · lint clean · build exit 0. The record: `docs/state.md` §16.
