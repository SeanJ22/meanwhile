# Rulings — the author's decisions that are not law

**Created 2026-08-20 (Prompt C item 5).** Append-only. Dated. One entry per
ruling. Each entry names what it supersedes.

## Why this file exists

`CLAUDE.md` is law: a rule there binds every session and is changed only by the
author. **Most decisions are not law.** They are calls about how a particular
thing is measured, which of two readings of a rule holds, what a number means,
or which piece of work comes first — and until today every one of them lived
only in whichever chat window was open when it was made.

That cost two specific things, and both had already happened:

1. **A session could be told to "hardcode the ruling as fact" with no way to
   check what the ruling said.** The instruction is correct — a session that
   re-litigates a settled decision wastes the window — but it only works if the
   decision is written down somewhere a session can read.
2. **A superseded ruling comes back as drift.** Nothing recorded that the
   08-19 precinct-geocoding position had been replaced, so the only thing
   standing between it and a future session was somebody remembering.

So: this file. It is what makes "hardcode the ruling as fact" safe.

## How to read it

- **Append-only.** A ruling that stops being true gets a dated SUPERSEDED note
  and a new entry beneath it. Nothing is deleted, because the next session may
  hit the same question from a different side and needs to see that it was
  already answered and why the answer changed.
- **A ruling that becomes law** is written into `CLAUDE.md` and its entry here
  says so. The entry stays; the law is the operative copy.
- **A ruling that contradicts `CLAUDE.md` does not silently win.** The conflict
  is named and the author rules.
- **Numbering is per-brief, not global.** "RULING 7" means RULING 7 *of the
  brief that issued it*, and the brief is named in every entry. Two briefs can
  both have a RULING 7 and they are different rulings.
- Surfaced in `docs/context.md`, so every session opens on it.

---

## Prompt C (2026-08-20)

### RULING 1 — merge cadence
ONE planned code merge per session. A second is permitted only to fix a
regression the live walk caught, and when one is taken the report names the
regression and states both SHAs. Close-out records — `state.md`, the tracker,
anything carrying the deploy SHA or the walk numbers — may follow as separate
named commits, because a document cannot name the commit that contains it.

**Status: LAW.** Written into `CLAUDE.md` on 2026-08-19 and amended
2026-08-20.

### RULING 2 — full-page screenshots are read as images
Capturing a screenshot is not looking at one. A file on disk, a byte count and
a green capture step are none of them the reader's view. Every full-page
capture offered as evidence is opened and read as an image, and the report
states screenshots as **N of N read as images**. A DOM assertion plus a live
walk does not substitute — the defects this catches are the ones the DOM is
happy about. A capture that cannot be read makes its item a BOUNDARY STOP, not
a finish.

**Status: LAW.** Written into `CLAUDE.md` on 2026-08-20.

### RULING 3 — the organic census is closed as a question
Report the number and the delta. Do not investigate its provenance, including
by timestamp.

**Supersedes:** the standing instruction in earlier briefs to explain any
movement in the organic count.

### RULING 4 — `CLAUDE.md` has no rules 4g or 4h
They do not exist. Do not look for them; do not recreate them. Earlier session
notes referred to them by number and the numbers were never real.

### RULING 5 — `walk:all` does not tap reactions
The write-path walks are excluded from the standing suite by name, and the
exclusion is printed on every run. A suite that ran every session and tapped a
reaction would manufacture reader signal in the sold store on every run.

**Status: LAW in substance** — `CLAUDE.md`'s walk rule already requires the
writing checks to be excluded by name.

### RULING 6 — the coverage tier vocabulary, used verbatim everywhere
**Tier 0 roster only · Tier 1 territory resolved · Tier 2 bodies enumerated ·
Tier 3 Kelly depth.** A tier is never inferred at read time. A tier may never be
raised by a session that did not do the work that raises it.

**Status: LAW.** `lib/coverage/tier.ts` and the stamped ledger.

### RULING 7 — a zip below Tier 2 renders what is known and names what is not
The DISPLAY half of this ruling made candidate cards conditional on how much
had been collected about the other candidates in the contest.

**Status: DEAD, 2026-08-20. SUPERSEDED IN FULL by RULING 26 (Prompt D).** The
conditional half never worked and its final form rendered nothing at all. The
half that survives is the hunt discipline in `CLAUDE.md`'s equal-effort rule:
a hunt session takes a contest as a unit and works every candidate in it. The
rule as it was written here is not to be restated, in code or in prose.

### RULING 8 — no API client was built in Prompt C
The six API-client rows are records, sized, not implementations.

### RULING 9 — Census counts governments; the product renders bodies
Census and NCES can establish Tier 0 and Tier 1. They can **never** establish
Tier 2. Tucson is one row in the Census file and holds a dozen governing
bodies, and no amount of boundary geometry tells you what those bodies are.

### RULING 10 — ZCTA is not a ZIP code
State the mapping method. Never present a ZCTA-derived answer as a ZIP-code
answer without saying so.

### RULING 11 — not issued
The Prompt C brief numbers its rulings 1–10 and then 12–21. There is no RULING
11 and nothing is missing; the number was simply not used. Recorded so a later
session does not go looking for it, exactly as RULING 4 records that rules 4g
and 4h do not exist.

### RULING 12 — WALL versus JOB
A source that is walled, challenged, or times out **on the source's side** is a
WALL: named, skipped, its ladder rung recorded, and the run continues. Anything
that is our code is a JOB failure and the run goes red. Check whose stopwatch
ran out before naming a wall — `SCHEDULED_REFRESH_TIMEOUT_MS` is 120s, and
batch work does not inherit interactive budgets.

### RULING 13 — a green build check does not mean the tests ran
Prompt B added the Linux `gates` job to `build-check.yml`. Prompt C item 1
hardened it: the type check now runs there on a checkout that was never built,
and the one test that needs a build runs in the build job instead.

### RULING 14 — path comparisons may not assume a separator
Local dev is Windows; CI and production are Linux. A repo-relative path is
POSIX, normalized once where it is produced, compared as POSIX everywhere.
`scripts/repo-path.mjs` is the one implementation.

### RULING 15 — the Kearsarge 15-row floor is retired
Never restate 15 as a floor. It was a count observed once, and a count observed
once is not a floor.

### RULING 16 — the retrieval-mechanics ladder in `CLAUDE.md` is canonical
Its fourteen rungs are the numbering that reaches the database as
`walledAtRung`. `docs/source-ladder.md`'s header list of thirteen is a
DISCOVERY ladder — where a document lives, not how to get bytes past a wall —
and it is retired in place. Only a genuinely new retrieval class increments the
mechanics number; a new technique inside an existing rung enriches that rung.
Every session reports rungs added and where they landed.

**Status: LAW.** Written into `CLAUDE.md` on 2026-08-20.
**Supersedes:** any reading in which `docs/source-ladder.md`'s thirteen were a
rung numbering.

### RULING 17 — `walledAtRung` values written before F22 are provenance-unknown
They are MARKED, never reinterpreted. F22 (2026-08-20) is the session that made
throw sites name their rung in the canonical numbering, so everything earlier is
uncertain, and guessing which ladder an old number meant would manufacture a
retrieval history nobody walked.

### RULING 18 — hunt-completion gating
It made a contest's candidate cards conditional on every Kelly field of every
candidate in that contest carrying a completed hunt.

**Status: DEAD, 2026-08-20. SUPERSEDED IN FULL by RULING 26 (Prompt D).**

**What it was, and why it failed.** It replaced Prompt B's field-presence
gating — RULING 22 in the Prompt D brief's numbering; this file carries no
entry under that number, because Prompt C recorded it only as the
"strict-equality implementation" superseded above. Under field-presence gating
a minor-party or write-in candidate with no campaign site could never match an
incumbent's four fields, so their contest was withheld permanently by their own
circumstances. RULING 18 re-aimed the measurement at something a hunt could
close — and it made things WORSE, not better: the migration that created the
states promoted nothing, so every field in every contest read as unhunted and
all 36 contests across the four pilot zips went dark. The product rendered no
candidate cards anywhere while holding portraits, campaign-finance figures,
contact details and verified pages in the database.

**The diagnosis both versions shared.** Completeness is a property of the HUNT.
Both versions treated it as a property of the record, and each was an attempt to
make the DISPLAY layer responsible for a fairness problem that belongs to the
collection discipline. Blanking a contest is never the correct response to an
incomplete hunt. The correct response to an incomplete hunt is more hunting.

**What survives.** The four states stay as DATA — see RULING 23 — and
`HD01`–`HD30` remain the work queue they sized. Nothing reads them to decide
what renders, and `tests/no-suppression.test.ts` fails the build if anything
tries.

### RULING 19 — the nonpartisanship and committee-sale section is deferred
It does not enter `CLAUDE.md`. This is a deliberate deferral, not an omission,
and it is recorded so a later session does not "notice the gap" and write it.

### RULING 20 — portraits and PDF corpora do not go in git
They are content-addressed outside the repo with their hashes committed.
Reference data, per-zip snapshots, and all provenance stay in git.

### RULING 21 — `DATA_GOV_API_KEY` exists
It is in `.env.local` at line 57.

**Supersedes:** Prompt B's report and tracker row `PB13`, which stated that the
key does not exist in this repo. That report was wrong: the sweep it rested on
read tracked files, and `.env.local` is gitignored. `.env.local` holds fifteen
keys, enumerated in `docs/sources.md`.

---

## The alignment display ruling (2026-08-20)

**There is no conflict between the per-issue alignment feature and
`CLAUDE.md`, and no amendment is needed.** The line falls exactly where the
existing rules already put it.

**Banned:** computing a match, fit, alignment or compatibility score; ranking;
ordering by fit; and a `score` / `rank` / `rating` / `match` / `fit` / `grade` /
`alignment` / `recommendation` key on any candidate or measure record.

**Permitted:** presenting sourced positions, sourced votes, and the reader's own
stated priorities side by side, rendered per issue.

**The line precisely.** *Legal* is per-issue rows, sourced on both sides,
neutral ordering (ballot order or alphabetical), and **no number anywhere**.
*Illegal* is any per-candidate aggregate **including a count** — so "agrees with
you on 7 of 9" is banned, as is ordering candidates by agreement, any badge or
bar that reads as a total, and any stored field named in the guard list. **A
count is a composite score wearing a smaller hat.**

**Amended 2026-08-20 by RULING 26 (Prompt D):** there is no display gate on
this or on anything else. Per-issue alignment renders whatever is held, for
whoever it is held for, in every race.

The implementation field is **not** named `alignment` — the guard test bans that
key and the guard is correct to.

---

## The collection ruling (2026-08-20)

**The intake-side minimum stands:** zip or address for district resolution, an
email for account identity. **No new column on the search log. No new column on
the reactions store** beyond the one existing hashed browser-minted continuity
key.

**Bot defense is attestation** — App Attest, Play Integrity, Cloudflare Private
Access Tokens — pass/fail, stateless, storing nothing; plus integrity signals
confined to the `intake_limiter` space under its own salt and TTL, joined to
nothing, exported in nothing, quarantining by `suspect_reason` rather than by
who.

**No persistent device ID.** It is the identifier an attacker discards most
cheaply, and it costs the one claim about this data that a hostile reader
cannot dispute: *"the schema shares no joinable column"* is architecture, and
*"we don't currently link these"* is a policy promise. Every buyer sophisticated
enough to pay $25K knows the difference.

**Supersedes:** the 2026-08-19 precinct-geocoding position with release-side
suppression. If it returns it returns as a deliberate reopening, not as drift.

---

## Rulings carried forward from the consolidated handoff

### `F21` — closed as correct-as-shipped (2026-08-20)
The two "Where can I vote?" pills were reported as a duplicate. The author
ruled the shipped result correct as it stands. The row closes on that ruling
and not on a change.

### `F02` — the committee denominator is PER REPRESENTATIVE (2026-08-20)
The "seven parents" figure in the F01 record was a count of parent committees
with missing jurisdiction text **in that specific hunt**. It was never a claim
about how many parent committees exist and may not be treated as one. Every
parent committee a given member actually sits on renders with its jurisdiction
text, checked against that member's real memberships, counted and stated —
never against a hardcoded seven. The 186 subcommittees stay an honest named gap.

### The two portraits — accepted (2026-08-20)
The author reviewed and accepted both.

### The 12.1 and 13.2 visual calls — accepted (2026-08-20)
The author reviewed and accepted both as shipped.

### The organic census — closed (2026-08-20)
See RULING 3. Report the number and the delta; do not investigate.

### `F03` — closed, and Vail's superintendent is John Carruth (2026-08-20)
The name was missed because Apptegy ships page content as an escaped JSON
payload inside the HTML: the fetch worked, discovery worked, and extraction
failed on rendered prose that never contained the byline. That is not a PDF
problem, and it is why the F11 extraction toolkit grew a fourth layer.

### The zip order (2026-08-20)
All future depth work runs **NH `03255` → NJ `07866` → AZ `85641` → AZ
`85701`**.

**Supersedes:** the NH → AZ → NJ order carried by older documents, including
the intent document.

**The reasoning, recorded so it is not re-argued.** New Hampshire produces a
DRAFT, not a playbook — town meeting government, selectboards, SB2, school
administrative units over districts, and a county that does almost nothing a
county does elsewhere. Rockaway Township is the median American shape, and
running it second is what proves the method generalizes rather than proving New
Hampshire is consistent with itself. Vail then breaks it on the
no-municipality edge. The New Jersey ballot mailing window is the one external
clock the author does not control.

### The repeatability bar (2026-08-20)
The playbook is repeatable when the **third zip's** mandatory diff adds fewer
than five new rungs, requires no new source-type recipe, and holds its
auto-resolved fraction within ten points of the second. `R13`'s mandatory
playbook diff is the instrument.

---

## Prompt D (2026-08-20)

**Why this section exists.** Prompt D is a RESTORATION session. The render gate
shipped in Prompt C withheld every candidate contest in all four pilot zips: 36
of 36 contests dark, zero candidate cards anywhere, while the database held
portraits, campaign-finance figures, contact details and verified pages. That is
a worse state than the product was in before Prompt B. Reverting it and writing
the rule that forbids its return were one item, because a revert without the rule
invites the next reimplementation.

### RULING 26 — SHOW EVERYTHING WE FIND
Everything the product holds about a candidate renders. Collection state never
governs display. There is no threshold, no completeness bar, no equality
condition, and no circumstance under which a candidate, a contest, or a field is
suppressed because something else is missing. A gap in one field has no bearing
on any other field, on that candidate's other data, on the other candidates in
the contest, or on whether the contest appears at all.

*The rationale, which stays attached to the rule because a stripped rule reads
as guidance.* Completeness is a property of the HUNT. It kept being treated as a
property of the record. Every version of the gate — strict field equality in
Prompt B, hunt-completion equality in Prompt C — was an attempt to make the
display responsible for a fairness problem that belongs to the collection
discipline, and each version withheld more than the last until the product
showed nothing at all. Blanking a contest over one or two missing fields is
never the correct response to an incomplete hunt. The correct response to an
incomplete hunt is more hunting.

*Where equal effort lives.* In the hunt, and nowhere else. A hunt session takes
a contest as a unit and works every candidate in it before moving to the next
contest. It does not fill in the incumbent because the incumbent is easy. That
discipline is the constraint. It is not a display rule and it never becomes one.

*Presentation of gaps is a visual question.* How a card looks when a field is
missing gets settled in visual feedback sessions over time. It is never a reason
to withhold data, and a visual concern never earns a suppression path.

**Status: LAW.** Written into `CLAUDE.md` on 2026-08-20.
**Supersedes IN FULL:** RULING 7's display half, RULING 18, and the
field-presence gating the Prompt D brief numbers RULING 22 (Prompt B's
strict-equality implementation, which this file recorded only by description).
Neither returns in any form.

### RULING 27 — no suppression path may exist in the codebase
Not live, not behind a flag, not disabled, not retained for a future feature,
not as a guard, not commented out as a reference implementation. A guard test
asserts none exists and fails the build if one is reintroduced. This is enforced
at commit rather than discovered by the author opening the site — which is how
both previous versions were found.

**Status: LAW.** Written into `CLAUDE.md` on 2026-08-20.
**Implemented:** `tests/no-suppression.test.ts`.

### RULING 28 — absence is one buried annotation per contest, never a per-field indicator
- A field with no data renders nothing — no row, no label, no placeholder, no
  greyed line, no dash, no "still looking for". Cards in a contest may be
  different lengths and that is correct.
- The only disclosure is a single asterisk on the contest heading with a
  footnote below the cards in small secondary text.
- The withheld-state paragraph is deleted outright, including the sentence
  stating that no cards were being shown and why. It was the gate explaining its
  own reasoning, and that reasoning is overruled.
- Hunt-queue vocabulary never reaches a reader. "Still looking for", field-name
  lists, `NOT_HUNTED`, `VERIFIED_ABSENT`, `NOT_APPLICABLE` and any equivalent
  are internal states. They live in the tracker and in session reports.

**Status: LAW.** Written into `CLAUDE.md` on 2026-08-20.
**Implemented:** `components/ballot/incumbency-note.tsx`.

### RULING 22 — recorded by description, and dead

*Written 2026-08-22 (NJ Hunt 4 item 1), to close the last gap in this file.
Nothing here is new: RULING 22 was never given an entry of its own, and both
places that mention it already say why.*

RULING 22 is the Prompt D brief’s number for **Prompt B’s field-presence
gating** — the rule that made a contest’s candidate cards conditional on every
Kelly field being present. Prompt C recorded it only as the “strict-equality
implementation” it superseded, so this file carried the thing without carrying
the number.

**Status: DEAD.** Superseded IN FULL by RULING 26 (2026-08-20), together with
RULING 7’s display half and RULING 18. Under field-presence gating a
minor-party or write-in candidate with no campaign site could never match an
incumbent’s four fields, so their contest was withheld permanently by their own
circumstances. **It does not return in any form**, and RULING 27 makes that
checkable: no suppression path may exist in the codebase at all.

It is entered here for the same reason RULING 11 is — so a later session does
not go looking for it, and so the numbering of this file is whole.

### RULING 23 — the four-state field is data, not a gate
`FOUND` / `NOT_HUNTED` / `VERIFIED_ABSENT` / `NOT_APPLICABLE` stays on the
candidate record as the work queue `HD01`–`HD30` were sized against. Nothing
reads it to decide what renders, and per RULING 28 no state is ever surfaced to
a reader.

**Status: LAW.** Written into `CLAUDE.md` on 2026-08-20.

### RULING 24 — a check that cannot run says so
Silence is not a passing result. A walk check whose preconditions are absent
reports COULD NOT RUN and is counted. The suite now asserts that checks
registered and checks reporting an ending are equal, and goes red when they are
not.

### RULING 25 — reader-facing behaviour is not degraded to fix an internal problem
The `D73` schema gate and write alarm must not change what a visitor sees. The
reader-facing error catch on the write path stays exactly as it is; the alarm is
a second, separate path.

---

## The interpretation calls Prompt D had to make, recorded so they are not re-derived

### `THIN_CANDIDATE_LINE` was KEPT on the card (2026-08-20)

> **SUPERSEDED 2026-08-20 by RULING 42 (Prompt E), below.** The author ruled:
> the contest footnote replaces the card line as well, and the card line is
> deleted. The entry stays, as every superseded entry does, because the reading
> it records is the one somebody would arrive at again from the same two rules.

RULING 28 says "the only disclosure is a single asterisk on the contest heading
with a footnote below the cards", which can be read as also killing the
per-candidate line `CLAUDE.md`'s equal-effort rule mandates ("We haven't found
much about this candidate yet."). It was kept, and the conflict is named here
rather than resolved silently.

**The reasoning.** RULING 28's heading and its first bullet both govern PER-FIELD
indicators, and Prompt D item 1d enumerates exactly three deletions: the
withheld-state paragraph, per-field absence indicators, and hunt-queue
vocabulary. `THIN_CANDIDATE_LINE` is none of the three — it is a whole-card
statement about OUR research, it is law in `CLAUDE.md`, and the footnote RULING
28 specifies carries a different message (incumbency asymmetry, at contest
level). Deleting a line that law mandates, on a reading the brief does not
require, would be the session overruling the author rather than the reverse.

**The author rules.** If the intent was that the contest footnote replaces the
card line as well, say so and it goes in one edit.

### The `*` is reserved across the whole ballot page (2026-08-20)
The ballot page has always run ONE footnote-marker sequence — shared source
notes first, scope notes continuing where they stop — precisely so that a `*` on
that page means one thing. RULING 28 puts an asterisk on every contest heading
that renders candidate cards, and the first render produced "Member of the
United States Senate**" at 07866: one asterisk meaning the incumbency note and
one meaning a source cited at the foot of the page, adjacent and
indistinguishable. So `*` is reserved for the incumbency footnote and the source
sequence starts at `†`, unconditionally — including on a ballot that renders no
candidate cards at all, because a symbol that means different things on
different pages is the same defect one page later.

### `NOT_APPLICABLE` moved NOTHING out of the 249 (2026-08-20)
Prompt D item 2 assumes some of the 249 owed fields cannot exist. Checked
against the queue as it stands, none of them can be so classified, and the
premise does not hold for these four fields.

**Why.** The queue tracks exactly four Kelly fields — photo, blurb, contact,
campaign site — and the frozen required-field matrix
(`lib/evidence/field-matrix.ts`, version `vH-1`, frozen 2026-08-16 before any
hunting began) records every one of them as `notApplicableWhen: "never"`. A
candidate can always in principle have a portrait, words of their own, a way to
be reached, and a site.

**The clear structural case the brief names — a voting record for a candidate
who has never held the office — is real and is not one of these four.** It is
not a tracked Kelly field anywhere in the product. It is already handled
structurally rather than by a state: the voting-record door on a ballot card
comes from the exact-key incumbent join in `lib/ballot/incumbent-record.ts`, so
a challenger simply has no door — no join, no link, and never a wrong one.

The state was added anyway, with its reason-and-date evidence standard and its
guard test, so the queue can carry a structural finding the moment one is
earned. The count moved is **0 of 249**, and `VERIFIED_ABSENT` stays at **0**.

---

## Prompt E (2026-08-20)

Eight rulings, all the author's, all about the artifacts he reads. Four of them
became law in `CLAUDE.md` in the same commit and say so in their own entry; the
other four stay here.

The numbering continues Prompt D's. RULINGS 29 through 34 were issued by this
brief as well and are recorded below with the rest, because a brief's rulings
belong in one place even when the brief numbered them out of order.

### RULING 29 — three priority levels, ranked inside a section and never across sections
**Not law. Recorded here.** Supersedes the P0/P1/P2/P3 scale and Prompt D's
definition of P0 ("blocks a reader-visible outcome before polling day"), which
is retired with the level it defined.

- **P1** — broken or blocking. Something a reader hits is wrong, or work cannot
  proceed until this is resolved. If it sits, the section stops.
- **P2** — needed for this section to be done. Not blocking today, but the
  section is not finished without it.
- **P3** — wanted, not needed. Real work, worth keeping, no consequence to
  deferring indefinitely.

The test is answerable without judgement: does something break or stall if this
waits? P1. Is the section done without it? If no, P2. If yes, P3.

**Priority is ranked independently inside each section.** P1 in one section has
no relationship to P1 in another, and the two are never compared.

**The interpretation call this session had to make**, recorded so it is not
re-derived: RULING 31 gives *Needs Sean* its own three definitions, and all
three are about LOOKING AT THE PRODUCT — "it doesn't open", "confirm it reads
right", "tell me if you like it". That section also holds legal and business
decisions, which fit none of the three. So the general test above governs a
decision row in that section (does something break or stall if this waits?) and
RULING 31's definitions govern a review row. `B05` (find counsel) is P1 under
that reading because two other rows cannot start until it closes; `B02`
(trademark search) is P3 because nothing waits on it. If the author wants a
single scale there, one sentence settles it.

### RULING 30 — five P1 rows maximum per section, and an over-cap section is STOPPED
**Not law. Recorded here.** If a section exceeds five P1 rows, that is REPORTED
as a fact — the section is stopped — and nothing is relabelled to fit. **The cap
is never satisfied by demotion**, because a demotion changes the label and not
the situation.

Measured at this session's close: no section is over the cap. The highest is
Needs Sean at three.

### RULING 31 — Needs Sean is always the first section
**Not law. Recorded here.** It holds anything only the author can unblock: an
API key, a legal review, a business decision, a visual judgement, and
specifically *go look at the site and confirm this is right*. Its priorities are
his, in his words:

- **P1** — the product is broken or fundamentally different. It doesn't open, or
  something is drastically changed from what shipped before. **Reference case:
  Prompt C removed portraits and data until there was essentially nothing.**
  Look now.
- **P2** — new information landed, confirm it reads right. A bounded spot-check
  of a named body or class: "New Hampshire state legislators added — spot-check
  five." **A P2 row names one body or class and a sample size.** It never says
  "review the new data."
- **P3** — a small adjustment, tell me if you like it.

### RULING 32 — every row has a home
**Not law. Recorded here.** No holding section, no miscellaneous section, no
unsorted bucket. A row that fits nowhere is evidence the section list is
incomplete, and the answer is a named section proposed in the report — never a
junk drawer. `tests/tracker-stores.test.ts` fails the build on a row whose
section is not in `docs/tracker-sections.json`, and on the section list growing
one called `misc`, `other`, `unsorted`, `holding` or `general`.

### RULING 33 — gaps are not tracker rows
**Not law. Recorded here.** A gap is a MEASUREMENT of coverage, not a task, and
it changes every time a hunt runs. Gaps live in the gap ledger, which is
generated and therefore current by construction. **The tracker holds the
decision to hunt Newbury; the ledger holds which of Newbury's bodies are still
dark.**

Audited at this session's close: **0 of 141 open rows is a bare gap.** Every row
that states a coverage number — `PB02`, `PB06`, `HUNT05`, `F03`, `D69` — also
states a decision to go and close it, which is what makes it a task. Five rows
carried a drifting COUNT in their title, which is a measurement wearing a task's
clothes; their titles now name the decision and the count stays in the row where
it belongs.

### RULING 34 — the reader artifacts are generated, and hold no duplicated content
**Not law. Recorded here.** Three artifacts, three questions, no overlap:

| Artifact | Answers |
|---|---|
| `docs/tracker.md` | what work exists, and what is left |
| `docs/log.md` | what happened, and what it spawned |
| `docs/gap-ledger.md` | what is still dark |

None is hand-maintained. **The one exception is the resolution and notes
columns, which the author edits by hand** — everything derived from them is
generated.

### RULING 35 — every section is a queue that empties
**Not law. Recorded here.** Supersedes the single-file tracker
(`docs/tracker.csv`), which is frozen in place as the pre-rebuild snapshot.

The tracker is a WORKFLOW, not an ongoing list. A finished row leaves the
working view and lands in the resolved store. The working view shows only what
is left. **Nothing is ever deleted**; the resolved store is permanent and is the
record of what was decided and when.

Why it was needed, stated so the shape is recognisable if it recurs: the tracker
held 456 rows, 315 of them finished, in one view. The number the author looked
at was 456 rather than the 141 that were actually left.

### RULING 36 — three resolution states, and only these three
**Not law. Recorded here.**

- **Resolved** — completely done. The row moves to the resolved store.
- **Conditionally resolved** — done provided a stated condition holds. The
  condition is written on the row in plain language, the row moves to the
  resolved store, and the condition is binding on the next session per
  RULING 38. A conditional resolution with no condition is REFUSED: the next
  session is made responsible for satisfying it and cannot read a blank.
- **Pending review** — needs a look before it can close. Under *Needs Sean*,
  only the author reviews it. Under every other section, a session reviews it.

A row carrying none of the three is OPEN.

### RULING 37 — who may move a row
**LAW.** Written into `CLAUDE.md` in the same commit, under the tracker rules.

- A session marks its own completed work Resolved and moves it, in every section
  except *Needs Sean*.
- **Only the author closes a Needs Sean row.** A session may never mark one
  Resolved or Conditionally resolved, and may never move one out, however
  obviously finished it appears.
- **Sessions OPEN Needs Sean rows.** Routing something to his attention is the
  session's job — he does not have to notice that something needs him.
- A guard test enforces both directions and fails the build if a session moves a
  Needs Sean row (`tests/tracker-stores.test.ts`).

### RULING 38 — the author's resolution notes are instructions, not commentary
**LAW.** Written into `CLAUDE.md` in the same commit.

Every session opens by reading the resolved store for rows resolved since it
last ran and surfacing his notes (`corepack pnpm tracker:open`). A conditionally
resolved row's condition is a LIVE REQUIREMENT on that session — satisfied, or
reported as unsatisfied with the reason. The report states what was read and
what was done about each note. **A note read and ignored is a session failure.**

### RULING 39 — resolution timestamps are written by the script, not by the spreadsheet
**Not law. Recorded here.** A formula can be overwritten and a silently wrong
stamp is worse than none. When a row moves, the move script writes the timestamp
from `corepack pnpm stamp`, America/Phoenix. **A date the author entered by hand
is preserved; an absent date is stamped on the move.**

The 315 rows migrated by this session are stamped with the DATE OF THE COMMIT
THAT CLOSED THEM, recovered from git — not with today's date, which would have
erased eleven days of history and replaced it with the day somebody ran a
migration.

### RULING 40 — attribution has no soft landing
**Not law. Recorded here.** The project is eleven days old, every row was
written by a session that reported what it did, and the transcripts are in the
repo. **Attribution is a lookup, not a guess. `UNKNOWN` is a defect, not an
acceptable ending.** A row that resists gets its own investigation — git
history, session report, close-out record, transcript — and any remaining row is
named individually with what was searched. A bare count is not an acceptable
report line.

Measured at this session's close: **456 of 456 attributed, 0 UNKNOWN**, by
`scripts/tracker-attribution.mjs`, which reads the first commit in which each id
appears in `docs/tracker.csv`. 105 distinct sessions. Runs before 2026-08-17
predate the session-naming convention, so they are named by their date and their
own commit subject — a lookup result, individually stated, findable with one
`git log --grep`.

### RULING 41 — the author writes rows too
**LAW.** Written into `CLAUDE.md` in the same commit.

Rows do not originate only from sessions. He adds rows by hand as he works
through the product, most often into *Visual feedback* and *Product / UI*.

- He types a description into the working store. **He does not invent an id** —
  the script assigns one in the correct format on its next run and reports which
  ids it assigned.
- Attribution records `Sean` as opening author. A row he wrote is fully
  attributed, never `UNKNOWN`.
- Every session reads his open rows at session start, alongside the RULING 38
  notes, so a row added on Monday reaches the next run without a prompt
  mentioning it. The session reports what it read.
- **A session may not reword, retitle, or delete one.** It may work the row, set
  a priority if none is set, and resolve it under RULING 37. The description is
  his. A guard test enforces this.

### RULING 42 — the page-level disclosure replaces `THIN_CANDIDATE_LINE`
**LAW.** Written into `CLAUDE.md` in the same commit. **Supersedes the
interpretation call Prompt D recorded below**, which kept the line and asked the
author to rule if that reading was wrong. He ruled. It goes.

A per-card marker naming the candidate we know least about is a badge on the
least-resourced person in the race — the information-asymmetry problem pointed
the other way — and it is the repetition RULING 28 exists to end.

In its place, one plain page-level disclosure: **"What we have found, we are
displaying here."** Simple, unhedged, at the bottom of the page, once per page —
not once per contest and never per card.

**AMENDED THE SAME DAY, BY THE AUTHOR, IN HIS OWN WORDS** (2026-08-20, his note
on `PE01`, verbatim: *"We should simply say \"What we have found, we are
displaying here.\" That's it."*). Prompt E first shipped this as two sentences —
*"We show what we have collected. Every card here carries every detail we could
find, so cards are different lengths."* — and he read it on the live deploy and
cut it to one. The second sentence was explaining the first, which is the
product talking about itself rather than telling a reader anything. **"That's
it" is half the instruction**, and the guard now asserts one sentence.

**It replaces nothing else.** The contest-level incumbency footnote Prompt D
shipped stays verbatim, in its current position after the candidate list and
before the state-funding note; so does the `*`-reserved page-wide marker
convention with the source sequence starting at `†`.

*Prompt D raised this rather than resolving it silently, and that was correct.*
The reading it faced was genuinely ambiguous — RULING 28's heading and first
bullet both govern per-FIELD indicators, and `CLAUDE.md` mandated the card line
in so many words. Deleting a line that law mandates, on a reading the brief did
not require, would have been the session overruling the author. Naming the
conflict and leaving it for him is what a session is supposed to do with one.

### RULING 43 — a source may not report success with zero normalized rows from a non-zero fetch

*Adopted 2026-08-20 (NH Hunt brief, item 1). Supersedes nothing; it makes an
existing `CLAUDE.md` rule structural.*

This is the SIXTH sighting of the zero-row shape and the first to reach a
reader. `ical` reported `ok: true, fetched: 3, normalized: 0` with every drop
counter at zero on the 02:00Z refresh, carry-forward therefore did not run, and
Wilmot, New Hampshire went from 23 meetings to none on the page at 03255. The
feed was healthy when checked by hand minutes later.

Five written prohibitions did not stop it, because a written prohibition is
something a session has to remember at the moment it writes a `return`. **The
contract itself must refuse to express it.** `ReportingMeetingSource.normalizeWithDrops`
now returns an `Accounted<...>` — a branded type whose only constructor,
`accountedNormalize()` in `lib/sources/normalize-account.ts`, throws rather than
returning a value for the forbidden shape. A plain object literal no longer
compiles, and the composite routes the throw to `JOB`, which turns the run red.
A seventh instance fails at build, not on the site.

The invariant is deliberately narrow — documents in hand, nothing out, nothing
dropped — and NOT full input/output accounting, which is false of honest
adapters: one `.ics` document is twenty meetings.

### RULING 44 — per-card completeness statements are gone, in any wording

*Adopted 2026-08-20 (NH Hunt brief). Extends RULING 42, which deleted one named
constant.*

RULING 42 deleted `THIN_CANDIDATE_LINE` and Prompt E shipped a semantically
identical sentence in the same session, because the guard matched known strings
rather than meaning. **That guard gap is the defect**, and `PE01` is one
instance of it. The page-level disclosure is the author's line, verbatim —
*"What we have found, we are displaying here."* — and that is the whole
disclosure. No card says what is missing from it, in any phrasing.

Guarded by meaning rather than by spelling in `tests/no-suppression.test.ts`
("RULING 44: no per-card completeness statement, by meaning"), which composes
subject + absence + coverage lexicons rather than listing sentences, and which
proves it is not vacuous by running the matcher against every such sentence the
product has actually shipped. Its false negatives are stated in the test's own
doc block rather than left to be discovered.

### RULING 45 — the Kelly standard, and there are no tiers of it

*Adopted 2026-08-20. Already law in `CLAUDE.md`; recorded here for the index.*

Every official and every candidate carries a photo, a phone, a working contact,
a specific verified page, and a campaign site.

### RULING 46 — the author may delete a row outright; a session never may

*Adopted 2026-08-20 (NH Hunt brief). Amends RULING 36, which named three
resolution states, and clarifies the scope of RULING 35.*

RULING 35's "nothing is ever deleted" governs WORK rows — a session may not
erase its own row by marking it done. It was never meant to bind the author's
audit. He must be able to look at a row, judge that it is not project work and
does not belong in the tracker at all, and have it gone.

`Delete` is a fourth resolution state, available to him alone. A session may
never set it and `tests/tracker-stores.test.ts` fails the build if one does. A
deleted row is HARD-REMOVED from both stores; the deletion is recorded in
`docs/log.md` — row id, date, and that he removed it — so the record that it
existed survives without the row cluttering anything.

`B08` is deleted under this ruling, on his explicit instruction.

### RULING 47 — the per-card issue count is removed

*Adopted 2026-08-20 (NH Hunt brief). Supersedes F01-continued session 2 item
14's "annotate and bury", and retires `CLAUDE.md`'s fourth friction exception.*

A small count of what is still missing on a candidate card is RULING 44's banned
statement compressed into a digit. Item 14 ruled the honesty right and the
volume wrong and split the enumeration into a COUNT on the row and a LIST buried
in the battlecard; the author has now ruled it out entirely. Both halves go, and
the fourth friction exception — *"honesty about coverage gaps, which may never
be smoothed into implied completeness"* — is retired with them, because it was
written to protect exactly this statement.

Honesty about coverage survives everywhere it was load-bearing: the gap ledger,
stated-N-equals-rendered-rows, the two-numbers pair rule, and the prohibition on
asserting absence. What is gone is the licence to spend a reader's attention on
it, beside a named person's name, once per card. `PE04` closes on this.

### RULING 48 — a session may not use git to revert the author's files

*Adopted 2026-08-20 (NH Hunt brief).*

Prompt E built collision safety on the tracker stores — digest before and after,
a mid-run save refuses and writes nothing — and a session reaching for
`git checkout` routes around it entirely. That happened: both CSVs were reverted
mid-fix and his edits were destroyed, recovered only because it was noticed.

- A guard fails the build if a session runs `git checkout`, `git restore`,
  `git reset --hard`, or any equivalent against `docs/tracker.csv`,
  `docs/tracker.xlsx`, the resolved store, or `docs/state.md`.
- Section edits to `docs/state.md` INSERT; they never replace. A replace
  destroyed 28 KB including the Phase A–E roadmap in the same session.

Enforced, not remembered.

### RULING 49 — a merge to satisfy a mid-session instruction from the author does not count against the cadence

*Adopted 2026-08-20 (NH Hunt brief). Amends RULING 1.*

RULING 38 makes his note binding on the session that reads it; RULING 1 caps
merges. An instruction arriving late in a session put those in direct conflict
and produced a reported deviation. The report names the instruction and the SHA.
The exception requires an actual note from him and cannot be self-authorized.

### RULING 50 — photos-first ordering is presentation; withholding data is suppression, and the two are never conflated again

*Adopted 2026-08-21. His note on `NH09`, verbatim: "Photos take priority.  The
ruling was to not REMOVE data from all candidates because we're missing one or
two things, e.g. "in their own words" or lacking a campaign site.  This is
conflating two statements.  A candidate with a photo should be listed above
candidates that don't have one and the same rule of "we are showing everything
we can find" still applies."*

`NH09` was opened by a session that read RULING 26 and RULING 42 as reaching the
photos-first sort adopted on 2026-08-16, and routed the apparent contradiction to
him rather than resolving it. There is no contradiction. The distinction, stated
so a session cannot collapse it again:

- **BANNED — suppression.** Removing or withholding data about a candidate
  because something else about them is missing. A card with no "in their own
  words" and no campaign site still renders everything else we hold about that
  person. That is RULING 26, and it is what the display rulings protect.
- **PERMITTED — ordering.** Sorting candidates within a contest so that those
  we hold a photo of appear above those we do not. Nothing is hidden. Every
  candidate renders with everything found, in full. Only the sequence differs.

Ordering is presentation. Suppression is data loss. They are different acts with
different consequences and a rule against one is not a rule against the other.

The three constraints in `lib/ballot/photo-order.ts` are what keep the ordering
from becoming a ranking and they are unchanged: the key is BINARY, order WITHIN
each group is as filed, and the way a candidate moves up is the HUNT finding
their photo. Equal effort stands undiminished — photo hunts run to the same rung
depth for every candidate in a contest and every miss is recorded per candidate.

The ordering ships unchanged. `NH09` closes on this. He closed it himself, per
RULING 37.

### RULING 51 — the collection disclosure renders once per surface, and there are two surfaces

*Adopted 2026-08-21. His note on `PE04`, verbatim: "That one line should be
listed once in the ballot section and once again on their battlecard."*

His sentence — **"What we have found, we are displaying here."** — renders once
in the ballot section and once on the battlecard. Two surfaces, one instance
each.

This is the `F21` polling-place-pill shape and it is correct: two surfaces is
not two instances on one page. RULING 42's "once per page, not once per contest
and never per card" is about REPETITION down a column of cards, which is what
turns a page-level statement into a per-card marker. A battlecard is one surface
a reader opened, not a card in a column, and the sentence says the same thing on
every battlecard in the product — it singles nobody out, which is the whole test
RULING 44 applies.

Mechanically: the sentence is declared ONCE, in `lib/ballot/collection-note.ts`,
and imported by both surfaces. He has rewritten it once already; a second string
literal is how a rewrite reaches one surface and not the other, and the product
ends up saying two different things about its own coverage.
`tests/candidate-cards.test.ts` asserts one declaration, exactly one render and
one `data-collection-note` marker per surface, and sweeps `app`, `components`
and `lib` with comments stripped so a third surface fails the build rather than
shipping.

`PE04` closes on this. He closed it himself, per RULING 37.

### RULING 57 — every twig is named

*Adopted 2026-08-21, the author's ruling, NH Hunt 4. His words: "The trunk is
the United States. The major branches are the states. Then counties, then
towns, then districts, then the water authority in one township — and the twig
is as relevant as the trunk."*

**This one IS law**, and is written into `CLAUDE.md` beside RULING 52 and
RULING 53 — those two govern how a fact is hunted, and this governs which
bodies are owed a hunt at all. `CLAUDE.md` **76,630 → 79,374 bytes**, rationale
attached.

It supersedes nothing. It makes explicit what the stranger test and the
official-universe coverage rule already implied and no session had been told in
so many words: a body is never skipped for being small, it is NAMED first and
hunted second, and a body that cannot be reached today is a dated measurement
carrying its branches rather than a decision to leave it out.

**What it changed on the day it was adopted.** Bradford, Sutton and Warner —
three of Kearsarge Regional School District's seven member towns — had no
bodies in this registry at all, and 59 were enumerated from their own
publications in one session. Warner's list includes the **Warner Village Water
District**, which is the author's own example wearing a New Hampshire name.
Wilmot's Safety Services Facility Committee and its Transfer Station Advisory
Group appear on no town index anywhere and were found only in the past view of
the town's calendar feed.

And it caught two claims this repo was making about itself: that no village
district's boundary reaches Newbury (Lake Todd's does, twice over — its own
words and the state register), and that the Merrimack County Conservation
District had no division (RSA 432:12 gives it the county's).

`pnpm twig:pair` is the instrument. It reports the Census denominator against
the registry's numerator for a zip, makes them reconcile, and NAMES every unit
with no body here — because a count is not a name.

### RULING 58 — `VERIFIED_ABSENT` requires two INDEPENDENT branches

*Recorded 2026-08-21 by NH Hunt 5, from the session brief. Three headers
against one host is one branch.*

> **SUPERSEDED 2026-08-21 by RULING 61 (NH Hunt 6), the same day it was
> recorded.** The two-branch NUMBER is superseded: exhaustion is now every
> route the branch manifest names for the field. The INDEPENDENCE test this
> ruling established is not superseded and is still how branches are counted.
> Zero records were ever earned under the two-branch bar, so nothing is
> grandfathered.

It supersedes nothing and makes RULING 52's independence test operational for
the one state that is a legal claim about a named person. `VERIFIED_ABSENT`
says a completed hunt walked every applicable rung and the thing does not
exist; RULING 52 already said two routes that fail for the same reason are one
route wearing two names. This joins them: **the two branches must go through
distinct dependencies — a different publisher, a different document class, a
different jurisdiction's copy — not the same host with different headers.**

`VERIFIED_ABSENT` is **0** across the whole product and has never been earned.
NH Hunt 5 did not force it: every field still owed carries at most one
exhausted branch, and one is not two.

### RULING 59 — the page says one thing about completeness and nothing else

*Recorded 2026-08-21 by NH Hunt 5, from the session brief.*

The only reader-facing statement about what this product holds is the author's
line — **"What we have found, we are displaying here."** — once in the ballot
section and once on the battlecard, per RULING 51. **No other sentence
anywhere describes coverage, counts what is missing, or characterises what has
not been worked out.**

It supersedes the fourth reader-friction exception, which RULING 47 had already
retired, and it finishes the job RULING 42 and RULING 44 started at card level
by ending the same class of sentence at PAGE level.

**Why the class goes rather than the instance.** NH Hunt 4's first merge began
rendering Lake Todd Village District's meetings while the coverage note four
inches down the same page still counted Lake Todd among eighteen districts "we
have not worked out". Every automated check was green, and that is a property
of the sentence rather than a gap in the checks: a sentence counting what is
missing is a claim ABOUT data that changes underneath it, and nothing can tell
a correct render from a stale note about that render without re-deriving the
count at render time — at which point it is a second query free to disagree
with its own page, which the stated-N rule already forbids.

**What is NOT touched, and the line is load-bearing.** The gap ledger, the
stated-N rule, the two-numbers pair rule and the prohibition on asserting
absence all stand. So does the render-default rule: a null still renders as its
NAMED GAP saying whose gap it is. The distinction is between a **named gap** —
about one field of one subject, derived from the very row being rendered, and
unable to go stale independently of it — and a **coverage claim**, about
holdings in aggregate, derived from somewhere other than what is on screen, and
going stale silently the moment the work behind it is done.

**What it removed on the day it was adopted.** Ten reader-facing statements
across five files: the whole coverage note (five statements, two render sites),
the about-area "Coverage today: New Jersey, New Hampshire, and Arizona", a
"Not covered yet" section, the welcome overlay ranking four areas by coverage
depth and forwarding the reader to a notice the same ruling deletes, a ballot
destination's claim that the page says so where it has not found something
(false since RULING 28 anyway), and a "NOT HERE YET" section enumerating
uncurated offices.

**And it found the same defect inside the document it makes load-bearing.**
`docs/gap-ledger.md` printed *"2 of these govern part of this zip and are not
in the registry"* without ever doing a lookup — both were in it. Guarded by
`tests/ruling-59-coverage-silence.test.ts`, which sweeps `.json` as well as
code, because the last one hid half in a data file.

### RULING 60 — the session hand-works bodies, and that is the point

*Recorded 2026-08-21 by NH Hunt 5, from the session brief.*

Manual hunting is the session's job and is not optional. Where no automated
route reaches a body, the session works it by hand — reads the town report,
opens the warrant article, follows the name through the minutes, calls up the
PDF. **A session that only takes automated branches and reports the rest as
unreached has not hunted.**

It supersedes nothing and gives RULING 52's tree its labour: the tree says
branches exist and this says somebody has to walk them.

Two obligations beyond the walking, and they are what make it compound:

1. **Every hand-worked body records what route succeeded, that route is built
   into a NAMED BRANCH registered in `docs/zip-playbook.md`, and the branch is
   applied across every body of the same shape with the count reached
   reported.** Hand-working one body is how the branch that reaches the next
   fifty gets discovered.
2. **The residual is the author's, and it is the TAIL rather than the starting
   point.** When the session has hand-worked everything it can and a handful
   remain, two to five are handed over by name with every branch and every
   manual route already attempted and what each returned.

**What it produced on the day it was adopted.** `docs/zip-playbook.md` §8,
and six branches — the `.gov` sibling; the Virtual Town Hall Drupal-7 `/boards`
index; the Internet Archive for a town whose site is gone; the state
village-district register (91 districts); one SAU page naming three Census
units' school boards; and the trade association's directory for a district that
publishes nothing at all. Three of those six share one shape, and it is the
generalisation worth keeping: **the body publishes nothing, and somebody else
with a statutory or associational reason to enumerate it publishes
everything.** When a small body appears to publish nothing, the next question
is never "does it exist" — it is *"who is obliged to list it?"*

**Not yet law.** RULINGS 58, 59 and 60 are recorded here and enforced in the
suite; whether any becomes law and is written into `CLAUDE.md` is the author's
decision, and `CLAUDE.md` is changed only by him.

### RULING 61 — the branch manifest, and what exhaustion means

*Recorded 2026-08-21 by NH Hunt 6, from the session brief. **Supersedes RULING
58's two-branch bar**, which was too low. Written into `CLAUDE.md` as law the
same day, item 6.*

**`VERIFIED_ABSENT` is earned only when every route in the manifest for that
field type has been walked, named and dated, and every one returned nothing.**
Not a count — a named list, the same list every time, so no session decides on
the fly what exhausted means.

**What it supersedes, and why.** RULING 58 made RULING 52's independence test
operational at two independent branches. That bar was correct law from
2026-08-21 until this ruling the same day, and **zero records were ever earned
under it**, so nothing is grandfathered and nothing had to be re-opened by hand.
Two branches proves almost nothing. Trying thirty-seven routes and stopping does
not tell you the forty-third would have failed either. The independence test
RULING 58 established is NOT superseded — it is still how branches are counted;
what is superseded is the number two standing in for exhaustion.

**Where it lives.** `docs/branch-manifest.md` is the document, indexed by
question. `lib/hunt/branch-manifest.ts` is the machine-readable twin and is
authoritative for the route ids, the counts and the verdict.
`isEvidencedAbsence` in `lib/ballot/hunt-state.ts` enforces it, and
`tests/branch-manifest.test.ts` and `tests/hunt-state.test.ts` guard it —
including a guard written as *the old bar passing and the new one refusing on
one record*, so the change itself is checkable rather than merely described.

**Manifest v1: 36 routes.** Photo 7 · in their own words 10 · contact 35 ·
campaign site 14 · specific verified page 8. A route may serve several fields; a
route forbidden for a field is not counted there — a newspaper is an excellent
route to a blurb and a phone number and its photographs are the demand-letter
class no door reaches.

**The manifest only grows, and it applies retroactively.** Every absence record
stamps the manifest version it was earned under, so adding a route re-opens
every absence earned under the old one automatically. A route is never removed;
one that stops working keeps its id with a dated note, because the next
jurisdiction may hit that wall from a different side and because a deleted route
is one the next session rediscovers as new.

**What it costs, stated rather than hidden.** The contact list is nearly the
whole manifest, because a phone number can come from anywhere, which makes
`VERIFIED_ABSENT` on a contact close to unearnable in practice. That is the
correct outcome. A field that cannot be exhausted stays **still owed** and is
hunted again on its RULING 53 clock. Nothing in this project is ever concluded
to be unobtainable.

### RULING 62 — a test file may not lose guards silently

*Recorded 2026-08-21 by NH Hunt 6, from the session brief. Written into
`CLAUDE.md` as law the same day, item 6.*

**A file write that removes assertions from an existing test file fails the
build unless the removal is explicit and intentional.**

It supersedes nothing. It closes a hole under every other rule in the repo: the
suite reports on tests that EXIST, so a deleted test reports `fail 0` rather
than failing, and every protection this project has runs through that suite. NH
Hunt 5 wrote `tests/<name>.test.ts` for a new guard, the name was taken, and
eight unrelated guards stopped existing under a green run.

**Why the count is not the instrument.** It moves for legitimate reasons on
every normal commit, so it is noise rather than an alarm. It is blind to
substitution — eight deleted and eight added leaves the total identical. And a
drop cannot name what stopped running, so it cannot be acted on without a hunt
through the history. Names are the instrument; the count is a summary of it.

**The mechanism.** `tests/guard-census.json` records every test file and every
guard NAME in it; `tests/guard-census.test.ts` recomputes it and fails BY NAME.
The census is not a lock — a guard may leave, but it leaves the census in the
same commit, and `pnpm guard:census --write` refuses to erase a name without
`--allow-removals`. Making the census agree with a deletion is itself a diff
saying which guards left.

**What the history sweep found.** `pnpm guard:history` walked all 228 commits
that touched `tests/`. 1,599 guard names have existed; 1,547 stand today; 60
have not been seen since. 57 are legitimate — renames, rewrites, and guards
retired by an explicit ruling (RULING 7's equal-depth gate, RULING 18's
hunt-completion gate, RULING 42's thin-candidate line, RULING 47's buried
enumeration), each with its replacement present. **Three were genuinely
silent**, and they are the shape one turn subtler than the overwrite that
produced this ruling: `af766f5` rewrote `tests/who-governs.test.ts` wholesale
for a count-reconciliation item and carried off three UI density guards that
belonged to the author's 2026-08-16 ruling, with no mention in its message. All
twelve of their assertions were re-run against the code as it stands and all
twelve still hold, so the guards were restored rather than the rule
re-litigated. The density ruling was never reversed — it simply stopped being
checked for four days.

### RULING 63 — every zip inherits; no zip starts from scratch

*Recorded 2026-08-21 by NH Hunt 6, from the session brief. Written into
`CLAUDE.md` as law the same day, item 6.*

**The manifest, the playbook, and every branch built are cumulative property of
the PROJECT, not of the zip that produced them.**

It supersedes nothing and gives RULING 60's hand-work an inheritance: RULING 60
says the branch a hand-worked body produces is applied across every body of that
shape, and this says it is applied across every ZIP and every STATE thereafter,
including the ones nobody has reached yet.

Five obligations, and the second is the one that makes the ratio meaningful:

1. **Every zip run opens** by loading `docs/branch-manifest.md` and
   `docs/zip-playbook.md` and stating which branches it inherited, before
   hunting anything.
2. **Branches inherited against branches newly built, reported as a pair.** That
   ratio rising across zips is the only real evidence the method compounds. A
   session that builds a branch which already existed has committed a defect and
   reports it as one, naming the existing branch.
3. **A new branch is checked against the manifest before it is built.**
   Duplication is worse than a gap.
4. **Both files are indexed by question**, not read front to back. At 175 KB and
   growing, an unindexed playbook is one a session will skim.
5. **An inherited branch that fails in a new jurisdiction grows a sub-branch**
   per RULING 60, and its failure is recorded with the jurisdiction and the
   date.

**Which of Newbury's branches are expected to fail elsewhere**, recorded now
rather than discovered later: the village-district register, town-meeting and
SB2 government, the school administrative unit sitting above the district, and
the town clerk as the record of local filings. All four are New England shapes.
Rockaway Township is the median American shape and is the first test of whether
these routes travel at all.


### RULING 64 — shared office contacts are published, labeled as the office

*Adopted 2026-08-21 (NH Hunt 5). Recorded here 2026-08-22 (NJ Hunt 3) — it and
the nine below arrived in session briefs and were binding from the day they were
made, but none of them had been written into this store. A ruling that lives
only in a chat window is the exact condition this file was created to end.*

A contact that reaches an OFFICE rather than a person is publishable, and it is
published labeled as what it is. The reader is trying to reach the body; a shared
line that reaches it is a working contact and withholding it serves nobody.

### RULING 65 — the footer-address branch

*Adopted 2026-08-21 (NH Hunt 5). Recorded here 2026-08-22.*

A body's postal address is very often in its own site footer, in every page of
it, when the contact page carries nothing. The footer is a named branch and is
walked before an address is recorded absent.

### RULING 66 — Facebook by compliant routes only

*Adopted 2026-08-21 (NH Hunt 5). Recorded here 2026-08-22.*

Where a campaign lives on Facebook and Facebook is walled, the routes are
`ad-library` (the mandatory political-ad disclosure, which needs a credential
this project does not hold — tracker `NS01`, TABLED BY SEAN), `social-archive`,
`social-mirror` and `news-embed`. Authenticated access is NEVER attempted, and
the two standing prohibitions in the transparency mandate are not narrowed.

`NS01` is Sean's row and is not to be worked, walked or duplicated by a session.

### RULING 67 — an enumeration states its geography and is checked externally

*Adopted 2026-08-22 (NJ Hunt 2). Recorded here 2026-08-22.*

**A total that reconciles is not a total that is correct.** Every enumeration
states the geography it resolved to, and that geography is checked against the
zip's own, established INDEPENDENTLY — against a second publisher, not against
the same containment test that produced it.

`lib/geo/zip-geography.ts` checks against two distinct publishers: TIGER
geometry and NCES mailing addresses. The instance that produced the ruling was
five defects at once, and the total reconciled cleanly throughout all five.

### RULING 68 — control queries are mandatory

*Adopted 2026-08-22 (NJ Hunt 2). Recorded here 2026-08-22.*

**A 200 whose content is not about the thing asked for is not a document.** Any
route that can echo, wall, or template gets a control query, and a guessed
identifier yields a `LEAD`, never a `HIT`. `lib/hunt/control-query.ts` is the
machinery.

### RULING 69 — reference data belongs in the repo, named and refreshable

*Adopted 2026-08-22 (NJ Hunt 2). Recorded here 2026-08-22. See RULING 73, which
settles how it lands.*

Structured reference data that names bodies, offices and contacts lives in
`data/reference/` where a hunt can reach it, rather than being re-derived per
session. The FEC directory's 349 offices across 56 jurisdictions is the first.

### RULING 70 — Ballotpedia is not scraped

*Adopted 2026-08-21 (NH Hunt 5). Recorded here 2026-08-22.*

It is a licensing conversation, and the first-party questionnaire is the better
path regardless. No scraping route is built.

### RULING 71 — a zip cannot answer "who governs you"; a street address can

*Adopted 2026-08-22 (NJ Hunt 3), the author's ruling. Recorded here 2026-08-22.*

In New Jersey, borough and township are COEQUAL forms of municipality — alongside
town, city and village — not levels of a hierarchy. Rockaway Borough and Rockaway
Township are two separate adjacent municipalities that share a name. Neither
governs the other's residents.

ZIP codes are postal delivery routes and have never respected municipal
boundaries. 07866 crosses the line, so "who governs you" has two different
correct answers depending on which side of a street the reader lives on. **This
is not a defect in 07866. It generalises to a large share of American zips.**

The surface answers with what a zip can establish and MARKS what it cannot. It
does not gate the page behind an address prompt, and it does not withhold.

- Bodies that CERTAINLY govern the reader render normally, with no marker. County,
  school district, state and federal do not become uncertain because a zip crosses
  a municipal line.
- A body that MAY OR MAY NOT govern the reader renders with a pill reading, in
  substance: *Could govern you — add your address to confirm.* Per body, not per
  page, and only the ambiguous ones carry it.
- **The pill is an invitation, not a disclosure of our incompleteness.** This is
  the distinction that keeps it clear of RULING 44: a per-card completeness
  statement says *we did not find this*. This pill says *this is a fact about your
  street that only you can settle*. Our data is complete; the reader's location is
  not. RULING 44 is NOT weakened, and the distinction is recorded here so no
  future session deletes the pill as a completeness marker.
- The address is an intake surface, handled under the existing collection minimum
  unchanged — nothing new retained, no new column.

**A ZCTA centroid may never resolve a ballot or a who-governs answer.**
`CLAUDE.md` already said so, and it was violated in shipped code.

### RULING 72 — a walled host is never evidence a body is unreachable

*Adopted 2026-08-22 (NJ Hunt 3), the author's ruling. Recorded here 2026-08-22.*

Discovery is a tree, not a ladder. A host refusing is ONE BRANCH returning empty
on ONE DATE. The body is still reachable by other branches — a federal directory,
a phone number, a postal address, a parent agency, a published report, a person.

ELEC was recorded in this repo as a permanent wall. The FEC's directory hands
over its phone number and postal address. **Every wall recorded anywhere in this
project is re-checked against the FEC directory's contact details, and a wall may
never be recorded without naming which other branches were tried.**

### RULING 73 — large reference documents: commit the CONTENT, never the binary

*Adopted 2026-08-22 (NJ Hunt 3), the author's ruling. Recorded here 2026-08-22.
It settles RULING 69 against RULING 20.*

RULING 20 keeps bulk binaries out of git because git retains every version
permanently and the decision cannot be reversed. RULING 69 wants reference data
in the repo and refreshable. **Both are satisfied by extraction:** parse the
document, commit the structured content, commit the source's SHA-256 and its
provenance note, leave the binary out.

That is what the FEC directory did — 349 offices across 56 jurisdictions
committed, PDF not. **This is the standing pattern for every large reference
document from here on.**

### RULING 74 — an address, once given, is never asked for twice

*Adopted 2026-08-22 (NJ Hunt 3), the author's ruling. Recorded here 2026-08-22.
Inseparable from RULING 71.*

Wherever a reader supplies an address — the who-governs surface, the
polling-place surface, the ballot, anywhere — it persists for the rest of that
SESSION and resolves every surface that could have used it.

- Every ambiguity that address settles is settled everywhere. No pill renders on a
  body the address resolves. No surface re-prompts. A reader who gave an address
  to see who governs them is not asked again to find where they vote.
- **Asking twice for the same fact is a frustration the product manufactures
  itself, and it reads as a product that is not paying attention.**
- It persists for the session and does NOT become a durable record. No new column
  on the search log, no new column on the reactions store, nothing joined to
  anything. The claim that survives a hostile reader is *the schemas share no
  joinable column* — architecture, not a policy promise — and a session-scoped
  resolution keeps that claim exactly as it is.
- It does not widen to claim every municipality in the zip governs the reader.
  `NH56`'s decision not to widen was correct: the card's verb is GOVERN. The pill
  is how both municipalities appear without either asserting jurisdiction it does
  not have.

### RULING 75 — a close-out commit is gated like any other commit to `main`

*Adopted 2026-08-22 (NJ Hunt 3 item 1.5). **LAW** as of 2026-08-22 — written into `CLAUDE.md` by NJ Hunt 4 item 1.3, which closed `NS03`.*

The merge-cadence rule in `CLAUDE.md` permits a session to ship its code once and
then write CLOSE-OUT RECORDS as separate named commits, because a document cannot
name the commit that contains it. That is correct and it stays. What went
unnoticed is what it implies about gating.

`pnpm handoff --ship` calls itself "the single door everything merges through".
**For code it is. For close-out records it never was** — they are committed after
the ship and pushed straight to `main` through no gate at all. Every session in
this repo's history has done this, and the shape has now put a red suite on
`main` twice: once from Prompt D's own close-out, and on 2026-08-22 when NJ Hunt
2's close-out carried `scripts/shoot-nj-hunt2-0822.mts` with five `TS18046`
sites. Build checks #196 and #197 failed, Netlify refused both deploys at
'building site', and production served the 10:17 build for the rest of the day.
The session reported green gates truthfully — it ran them before the file existed.

**Close-out is a door, so it gets a gate, and the session is asked what happened
after the push rather than before it.** Three parts, and the third is the one
nothing local could ever have supplied:

1. `pnpm closeout` (`scripts/close-out.mjs`) — the gated door. Refuses off
   `main`, refuses a dirty tree, runs `pnpm build` (the literal command
   `netlify.toml` gives Netlify, which type-checks everything `tsconfig.json`
   includes, `scripts/` included), pushes through `scripts/push-main.mjs`, then
   waits for the tip to go green. No skip flag, for the reason `buildGate()`
   already gives: an escape hatch on a gate is how the gate stops meaning
   anything.
2. `pnpm main:green` (`scripts/main-green.mjs`) — **asks GitHub**, not the
   working tree. Every other gate in this repo answers a question about local
   files; the question that went unasked is about the REMOTE BRANCH, and only the
   server knows what happened to a commit after it landed. Four verdicts kept
   apart — green, red, pending, and could-not-tell — because a check that cannot
   reach its subject must never print like a passing one.
3. `pnpm handoff` now carries a `main checks` line, failing on RED. **A session
   may not report clean gates while leaving `main` failing and production
   stale.**

*Why not a pre-push hook.* `buildGate()`'s header already rejected one and the
reasoning holds: `core.hooksPath` is per-clone and can be silently absent in a
fresh clone, and a hook that runs on every work-in-progress push is a hook that
gets `--no-verify`d out of existence. The server-truth check has neither
problem — it cannot be absent, and it costs one API call.

### RULING 76 — session-dated scripts are COMMITTED, and held to every standard

*Adopted 2026-08-22 (NJ Hunt 3 item 1.7). **LAW** as of 2026-08-22 — written into `CLAUDE.md` by NJ Hunt 4 item 1.3, which closed `NS03`.*

A session-dated capture or walk script — `shoot-nj-hunt2-0822.mts`,
`tester-walk-0819.mts`, `nh6-shots.mts` — photographs one session's work and will
in all likelihood never run again. **There are 34 of them in `scripts/`, and all
34 are committed.** The choice is between holding them to the same standard as
every other file and not committing them at all.

**They are committed, and they are held to the standard.** Three reasons, in
order of weight:

1. **They carry technique, and technique is a rung.** The F22 page-shrink recipe
   for a 68,000px ballot page, the `sessionStorage` seeding that stops a map
   capture showing the welcome overlay, the marker-before-shrink ordering — every
   one of those is a wall that fell, and the standing rule is that a wall which
   falls becomes a permanent reusable step rather than a discovery spent and
   kept. Deleting the script deletes the rung.
2. **They are the method record behind evidence that has already been reported.**
   RULING 2 makes a screenshot evidence only once it has been read as an image. A
   report that says four captures were read, with no committed record of how they
   were produced, is weaker than one where the recipe is in the tree.
3. **"Not committed" creates an untracked class the gates never see.** That is
   the same invisibility that caused the failure in RULING 75 — work reaching
   `main`'s neighbourhood without passing anything. Moving these out of the tree
   would not gate them; it would only stop them being looked at.

**The standard, stated:** they type-check under `strict` like every other file,
they lint, they carry a header saying which session and which claim they served,
and they are never excluded from the type check. `scripts/` holding one-shot
tools is not a reason to weaken the check over `scripts/` — it is a directory
that only grows, and it holds the extraction toolkit, `twig:pair`,
`control-query`, the move script and the walk.

**What this does NOT license** is minting a new dated script where a
parameterised one would do. A shooter that takes a zip and a list of contests is
worth more than the eleventh `shoot-<date>.mts`, and the preference is stated
here so the count of 34 is a fact about the past rather than a target.

### RULING 77 — verify locally, ship once

*Adopted 2026-08-22 (NJ Hunt 4, the session brief). **LAW** — written into
`CLAUDE.md` in the same session.*

**Never ship and then verify. Verify, confirm it works, then ship.**

Almost nothing needs production. Screenshots at 430×932, `pnpm walk:all`, the
card checks, the who-governs pill and the whole ballot page all run against a
LOCAL PRODUCTION BUILD. Only the deploy-SHA confirmation and `/api/build`
require the live site, because only those two are questions about what the
server is serving rather than about what the code does.

One planned deploy, one merge; close-out records are part of that commit where
they can be. **A defect found in local verification is fixed BEFORE the ship.**

The merge-cadence rule's second-merge exception survives — a live walk that
catches a regression must be allowed to fix it — but a session that could have
caught the defect locally and did not has spent the exception on its own
carelessness, and the report says so.

*What it supersedes:* nothing. It is the merge-cadence rule's missing half. That
rule said how many times a session may ship; this says when.

*The cost it removes:* between the ship and the verification, production was
serving the defect to readers. NJ Hunt 3 spent four of its seven code merges
exactly there. A local production build is the same bytes.

### RULING 78 — CI runs where it earns its cost

*Adopted 2026-08-22 (NJ Hunt 4, the session brief). **LAW** — written into
`CLAUDE.md` in the same session.*

**A gate that runs three times for one merge is one gate and two copies of it.**

Build check was firing on the branch push, again on the pull request, and again
on the merge to `main` — three runs plus a Netlify deploy each, on top of the
scheduled refreshes. That exhausted the Actions balance, and an exhausted
balance does not fail loudly: it produced completed jobs with ZERO STEPS
recorded, which read as a broken tree for a whole session (`NS04`).

- Build check runs on the **pull request** and on **`main`**. The branch-push
  trigger is removed.
- Scheduled refresh workflows run **once daily**, except the clerk filing near a
  filing deadline, which keeps its one-day RULING 53 clock.
- **Nothing stops gating.** Every branch that matters becomes a pull request and
  every merge lands on `main`, so the two surviving triggers cover what the
  third covered. A cadence change that dropped coverage would be the budget
  raised to fit the change it was supposed to catch, wearing another costume.

### RULING 79 — a ruling closes the Needs Sean row it answers

*Adopted 2026-08-22 (NJ Hunt 4, the session brief). **LAW** — written into
`CLAUDE.md` in the same session. **Amends RULING 37**, narrowly and
deliberately.*

RULING 37 says only the author closes a Needs Sean row. That stands for rows
awaiting his judgement. What it did not anticipate is the row he has ALREADY
ANSWERED: he rules in conversation, the ruling is recorded here and shipped, and
the row that asked the question sits open waiting for him to say the same thing
a second time in a spreadsheet. Needs Sean stood at 54 open and an unknown share
of those were already answered — the accumulation the section was built to
prevent.

- Where a dated ruling in this file **demonstrably** answers a Needs Sean row,
  the session marks it Resolved, records the ruling number and the shipping SHA
  on the row, and moves it.
- **Every such close is reported individually** with its ruling and SHA, so he
  can reverse any the session got wrong.
- Where no ruling answers the row, **it stays open and is named individually**.
  Ambiguity is not a licence to close.
- Rows that are genuinely his judgement and carry no ruling — a naming decision,
  a business call, a visual preference — stay open regardless of how long they
  have been there.

RULING 37's second half is untouched: **sessions still OPEN Needs Sean rows**,
and routing something to his attention remains the session's job.

### RULING 80 — the committed geometry follows the reader, not the county

*Adopted 2026-08-22 (NJ Hunt 4 item 4, the session brief). **LAW** — written
into `CLAUDE.md` in the same session. Answers `NH44`.*

**The TIGER geometry clip widens to the adjacent counties. A unit this product
names is a unit the map can draw.**

The committed geometry was clipped to ONE county per state — `public/geo/*.geojson`
says `clippedTo` on its own face. A zip's first-rung circle crosses county lines:
3 of 4 pilot zips do, and 184 of 279 measured. So towns inside the circle were
entering the registry with their boards, their rosters and their meetings, and
no polygon. RULING 57 says a body is NAMED FIRST and hunted second; a body that
cannot be DRAWN because a build-time clip was convenient is that rule losing to a
file format.

- The clip is **the county plus its adjacent counties**, per state.
- The vector-tiling threshold is a real constraint and is **measured, not
  assumed**: the feature count is stated before and after against it, and a tile
  over its budget is a finding rather than a rounding error.
- A unit that reads "no division of its own" AFTER the widening is a different
  finding from one that read it before, and the pair is stated.

*What it does not do:* it does not make geometry a precondition for naming a
body. `lib/registry/curated-divisions.ts` supplies a division with no polygon and
that stays legal, because RULING 57 outranks the map.

### RULING 81 — an exhausted Actions balance is not a broken tree

*Adopted 2026-08-22 (NJ Hunt 4 item 1, from the author's brief). Answers
`NS04`.*

Every job on `d0e0e34` completed in three to four seconds with ZERO STEPS
recorded, twice, including an explicit `gh run rerun`. The runs died before any
step reported and the logs were not retrievable. It was not the tree: `f20e1e9`,
twenty minutes earlier, passed all three checks; `d0e0e34` differed from it only
by documents and one capture script; and the suite was green locally.

**The cause was the Actions minutes balance, exhausted by RULING 78's triple
build.** The author has upgraded and the balance is restored.

The diagnostic that came out of it stands and is the durable part: **a completed
job with no steps NEVER RAN**, and `job-watch` reports that as `CANNOT TELL`
rather than as a failure. RULING 24 — a check that cannot reach its subject must
never print like a passing one — and its mirror image, which is that a check
that never started must never print like a failing one.

### RULING 82 — the job watcher's sampling was the defect, not its logic

*Adopted 2026-08-22 (NJ Hunt 4 item 1, from the author's brief). Answers
`JOB01`.*

`JOB01` was opened because `refresh-meetings-snapshot.yml` failed twice
consecutively and recovered unexamined. NH Hunt 3 established there was no single
cause: **three distinct causes across four failures, at a rate of 17 of 40
completed runs**, and the refresh death was a JOB reason — `total` was read off
`served`, the array before the second collapse pass, while the rows came from
`finalRows`. That was found and fixed, and proven live at `381 + 74 = 455`, 11 of
11 sources read, 0 walled, 0 job-failed.

**The watcher never fired on any of it, and that was SAMPLING, not logic.** It
looked at too narrow a window to see a 17-in-40 rate. The window was widened and
`JOB01` was itself opened from live data by the widened detector — which is the
detector working.

The row asked why the job broke. It is answered: the cause was found, named,
fixed and proven, and the instrument that missed it was corrected.

### RULINGS 83 THROUGH 87 — the five process rulings of NJ Hunt 5

*Adopted 2026-08-22 (NJ Hunt 5 item 1, from the author's brief). Law: written
into `CLAUDE.md` in the same commit, each with its rationale attached.*

**THE NUMBERING, named rather than fixed silently.** The author's brief adopted
these five as RULINGS **81 through 85**. Both of those numbers were already spent
by NJ Hunt 4 earlier the same day, from his previous brief — RULING 81 (`NS04`,
the exhausted Actions balance) and RULING 82 (`JOB01`, the job watcher's
sampling) — and both are cited by id in the resolved tracker store and above in
this file. This document is append-only, so renumbering what already shipped
would leave dangling references in the one record that is supposed never to move.
The five therefore take **83 through 87** in the brief's order. Each carries the
brief's number beside it. `NJ5-01` is open for the author to reverse this if he
wants his own numbering to win.

| Brief | Law | Name |
| --- | --- | --- |
| 81 | **83** | The free-source floor |
| 82 | **84** | The manifest is tiered and walked in order |
| 83 | **85** | The two-click test |
| 84 | **86** | Per-state source enumeration precedes the hunt |
| 85 | **87** | Wikipedia is a Tier A discovery source, never a source of record |

### RULING 83 — the free-source floor

*Adopted 2026-08-22 (NJ Hunt 5, from the author's brief, where it is numbered
81). **Supersedes nothing.** It CONSTRAINS the standing recommendation practice
that produced NJ Hunt 4's close-out, and it is the precondition on every future
"we are blocked" claim.*

No paid resource is proposed, acquired or specced until every free route in the
manifest has been walked and reported with counts. A session or a review naming a
constraint that money would solve must first show what the free routes returned.

The measurement behind it: NJ Hunt 4 correctly measured DuckDuckGo walling after
six queries, Bing and Yahoo after ~170, and 124 of 272 candidates returning no
classified URL — and recommended buying a search API. Wikipedia's Rockaway
Township page was two clicks from a plain Google search, had never been opened by
any of six hunt sessions, and carries the mayor, nine council members with party
and ward, seven county commissioners, three constitutional officers, both
districts, and links to the township, the school district, NCES and the fire
department, every fact footnoted.

### RULING 84 — the manifest is tiered, and walked in order

*Adopted 2026-08-22 (NJ Hunt 5, from the author's brief, where it is numbered
82). **Amends RULING 61.** The manifest's shape changes; its bar does not.
RULING 61 said `VERIFIED_ABSENT` is earned by walking a NAMED LIST rather than a
count, and that is untouched. What is added is that the list has an ORDER, and
that walking it out of order is itself a defect.*

Tier A is a broad source answering many entities at once; Tier B is the entity's
own official source; Tier C is per-entity search. A field may not reach Tier C
until Tier A and Tier B are walked and recorded for it.

Enforced in `lib/hunt/branch-manifest.ts`: `tier` is required on every route,
`tests/branch-manifest.test.ts` fails the build on a route without one, and
`judgeManifestWalk` refuses to honour a Tier C walk for a field whose Tier A and
Tier B routes are unwalked.

### RULING 85 — the two-click test

*Adopted 2026-08-22 (NJ Hunt 5, from the author's brief, where it is numbered
83). **Supersedes nothing. Adds a precondition to RULING 61 and RULING 52.***

Before recording any absence, or naming any constraint, the session states what a
person with a browser would type into a search box to answer this, and confirms
that path was walked. A route a non-technical person would reach in two clicks is
Tier A by definition and is added to the manifest the moment it is found.

Why it is a separate rule from RULING 84: the tier system orders routes that are
IN the manifest. This one is about the route that is not in it, and could not be,
because nobody thought of it. The ladder, the tree, the manifest and the control
query are all instruments for getting PAST something, and none of them ever asks
whether there was anything to get past.

### RULING 86 — per-state source enumeration precedes the hunt

*Adopted 2026-08-22 (NJ Hunt 5, from the author's brief, where it is numbered
84). **Extends RULING 63** from branches to sources.*

Before any state's hunt begins, the session enumerates that state's free sources
into the manifest as state-scoped routes, as a written research step producing a
written list, before the first entity is touched.

RULING 63 makes the TECHNIQUE cumulative. This makes the PLACES cumulative. A
branch that reaches a town clerk record is portable; which office in this state
IS the clerk is not, and a session that discovers that mid-hunt discovers it
once, expensively, under time pressure, and usually incompletely.

### RULING 87 — Wikipedia is a Tier A discovery source, never a source of record

*Adopted 2026-08-22 (NJ Hunt 5, from the author's brief, where it is numbered
85). **Supersedes nothing. Distinguished from RULING 70** — Ballotpedia is not
scraped because its disclaimer prohibits automated commercial extraction and its
text is copyleft; that is a licensing question and it is the author's. Wikipedia
is a different question with a different answer, and this ruling says so
explicitly so no session reads RULING 70 as covering both.*

Municipality articles are templated across roughly 19,000 US articles, so one
parser reads all of them. Every extracted fact carries the footnote it came from
and the primary source is fetched and confirmed before the fact ships — Wikipedia
names the person, the citation proves them, and a fact whose citation cannot be
confirmed is a `LEAD`, not a `FOUND`. The form-of-government line predicts which
bodies exist and answers RULING 57 twig enumeration before the hunt starts. Names,
parties, term dates and districts are facts and are not copyrightable: extract the
facts, follow the footnotes, do not copy the prose.

It gives ROSTER depth, not KELLY depth. Photos, phones and campaign sites are
still hunted — but a person who has not been named cannot be hunted at all.

---

### RULINGS 88 AND 89 — deliberately unassigned

*Recorded 2026-08-22 (NJ Hunt 5). Not a missing entry.*

The author adopted the ruling below as **RULING 90** in his own numbering. 88 and
89 were never used. They are left open rather than closed by renumbering his
ruling down, because a gap in an append-only sequence costs nothing and this
document correcting the author about the number of his own law costs a great
deal. If he later assigns 88 or 89, they slot in here.

### RULING 90 — exhaustion must be argued, not asserted

*Adopted 2026-08-22 (NJ Hunt 5, from the author's brief). Law: written into
`CLAUDE.md` in the same commit with its rationale attached. **Supersedes
nothing. It RAISES the bar RULING 61 set and RULING 84 ordered**, and it is the
first rule in this file that constrains a session's IMAGINATION rather than its
procedure.*

"I walked every route in the manifest" is not exhaustion and never was.

Five obligations, and the fifth is the one with teeth today:

1. Per unfound field, the report answers *what would I try to find this if there
   were no manifest at all?* — then tries it and reports what it returned.
2. "Nothing further" is an assertion of exhaustion and is **prohibited**. The
   item fails.
3. The **meta-search is a first move**: where does this state publish candidate
   information, where does this county publish officials, who covers these
   races. One cheap search answering that beats hundreds answering nothing.
4. A wall is a wall **around** something. Name what it is around and what other
   road reaches it.
5. **Every authenticated resource is walked before any unauthenticated one is
   exhausted.** A key sitting unused while a session hits a public rate limit is
   a defect and is reported as one.

**Why a list could not have been the fix, which is the part worth keeping.**
Wikipedia was a list. The caucus sites were a list. The API keys were a list.
RULING 84 tiered the list; RULING 61 named it. Every one of those was a real
improvement and none of them addressed the actual failure, which is that lists
are finite and the thing that keeps getting missed is always outside the current
one. The evidence is that it has been found the same way every time: the author,
with a browser, in two clicks.

*Measured the day it was adopted.* Seven credentials in `.env.local`; three had
never been called by anything in the repo, confirmed by sweeping with `git grep
-a --untracked` rather than by trusting `docs/sources.md`. One script returned 18
sitting members of Congress with a photo and an official page each, 61 state
legislators with emails, 137 federal candidates, 42 federal document collections
— and the finding only a call could produce: **`CENSUS_API_KEY` is invalid**, the
host refusing it with `X-DataWebAPI-KeyError: 1`. All of it sat available while
the previous session measured how fast a free search engine would rate-limit it.

---

---

## BACKFILL — RULINGS 52 THROUGH 56, RECORDED HERE LATE

*Written 2026-08-22 (NJ Hunt 4 item 1). **Nothing here is new.** Each of these
was adopted on the date it names and each is already binding; what was missing is
their entry in THIS file, which the constitution calls "the append-only record of
every ruling that is not law".*

**The gap, stated plainly.** This file runs 1, 2, 3 … 51, and then 57. Rulings 52
through 56 were adopted on 2026-08-21 and written into `CLAUDE.md` (52, 53) and
into `docs/state.md` (54, 55, 56) instead. Every one of them is cited by later
work and by open tracker rows, so nothing was lost — but a session asking this
file "what did he rule about filed addresses" got no answer, and RULING 79 makes
that gap operational: it closes a Needs Sean row only on a ruling recorded here.

Each entry below says where its authoritative text lives and quotes what it
decided. No text is invented, reordered or paraphrased into something new.

### RULING 52 — discovery is a tree, not a ladder

*Adopted 2026-08-21 (NH Hunt 3). **LAW** — the authoritative text is the section
of that name in `CLAUDE.md`, which is where it was written and which governs.
Recorded here 2026-08-22 to close the gap in this file.*

**Branches to the same fact are independent. A branch returning empty is one
measurement on one date, never a verdict about the fact.** The hunt does not
stop when a branch fails; it takes another branch. Where no branch exists, one is
built. A ladder produces the answer "unreachable" because a ladder has one
direction; a tree does not have that answer available to it.

Adopted over three walls this repo had written down as permanent, all three of
which fell in one session: `gc.nh.gov` (recorded as refusing every client, and
answering rung 2 at HTTP 200 on re-walk), `sos.nh.gov` (walled host-wide from
2026-08-13 until somebody walked rung 5), and Kearsarge's nine board emails
(sitting in the page's own `href`s after two sessions recorded them as honest
absences).

### RULING 53 — recorded absences expire

*Adopted 2026-08-21 (NH Hunt 3). **LAW** — authoritative text in `CLAUDE.md`.
Recorded here 2026-08-22 to close the gap in this file.*

**An absence is a measurement with a shelf life, not a conclusion.** Candidate
fields 7 days; bodies, rosters and officials 14 days; walled sources 14 days,
regardless of how emphatically the wall was recorded. Past its window a record is
STALE and is re-walked before it is relied on. Stale is not wrong and a stale
record is never deleted. Staleness is a state the data carries, not a note in a
document.

### RULING 54 — the filed mailing address renders

*Adopted 2026-08-21 (NH Hunt 3), answering `NH12`. Authoritative account:
`docs/state.md`, the section of this name. Shipped in
`lib/ballot/candidate-cards.ts` and `components/ballot/candidate-card.tsx`.*

**Public information is shown, and that includes the mailing address a candidate
filed with the state.**

All 47 of Newbury's filed addresses had been hunted, recorded, and written into a
prose `note` that nothing rendered — so the product HELD the only working contact
for about half of those people and showed none of them. Kathleen Donnelly and
Cynthia Rusis had no way to be reached at all while their opponents showed phones
and sites. That is the information asymmetry the equal-effort rule exists to
catch, produced by our own reticence.

**It renders as a FACT, not an affordance**: no `href`, because a `mailto:` is an
invitation to act now and a named person's home address dressed as a tappable
control overstates what it is.

*The bug it caught, kept because it is the more useful half:* two separate lifts
reported success and lifted 4 of 47 — a parse anchored on a period, and then a
`.find` over a 175-record array against 92 cards. Clean exit, wrong number, both
times. Found by asking for the COUNT rather than the exit code.

### RULING 55 — only a reviewed photo renders, and a decision is about an IMAGE

*Adopted 2026-08-21 (NH Hunt 3). Authoritative account: `docs/state.md`, the
section of this name. Shipped as `data/photos/review.json`,
`scripts/photo-review.mts` and `tests/photo-review.test.ts`.*

**Every photo is reviewed by the author, and only an approved photo renders.**

63 photos held, 63 render, 0 dropped. Gating on an empty store would have blanked
every portrait in the product the moment the rule shipped, so the 48 already
shipping are `APPROVED` with `decidedBy: "grandfathered"` — labelled honestly as
*shipping before the rule existed, NOT individually approved by the author* — and
carrying a decision date so RULING 53's clock runs on them.

**It is a CORRECTNESS gate on one field, never a completeness gate on a card**,
and `tests/photo-review.test.ts` asserts a person renders fully with a photo
pending. That assertion is what stops it drifting into the suppression path
RULING 27 forbids.

**A decision is about an IMAGE, not about a person.** A store keyed per person
meant recording that one candidate's WinRed banner was refused also withheld her
public-domain U.S. Senate portrait.

**One tracker row per session listing N photos**, never one row per photo — 47
candidates plus 90 officials would otherwise flood the queue.

### RULING 56 — a scheduled job that fails tells someone

*Adopted 2026-08-21 (NH Hunt 3). Authoritative account: `docs/state.md`. Shipped
as `lib/ops/job-watch.ts`, `scripts/watch-workflows.mts` and
`.github/workflows/job-watch.yml`.*

**A degrading data path may not be a page nobody watches.**

The measurement that produced it: `refresh-meetings-snapshot` had failed **14 of
36** runs, `intake-tripwire` 2 of 8, `refresh-dotgov-snapshot` 1 of 8 — a third
nobody had named. The watcher runs daily at 15:40 UTC, after the other jobs have
had their slot. **Two consecutive failures opens a Needs Sean row. It never
resolves one.**

Proved without breaking anything to prove it: `--asof` holds the detector against
a window whose outcome is already known.

*Later measurement, NJ Hunt 4 (2026-08-22):* the detector's sampling was too
narrow to see a 17-in-40 failure rate and was widened — see RULING 82, which
closes `JOB01`.
