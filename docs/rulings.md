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

**CLAIMED 2026-08-22 (Discovery Conduct session).** He did. **RULING 88 is the
expansion requirement and RULING 89 is expansion-is-not-a-side-quest**, both from
his Discovery Conduct brief, and both are written in full further down this file
under *The discovery-conduct rulings*. This paragraph is left standing rather
than replaced, because the reason the gap was held open is the reason it was
worth holding.

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

### RULING 91 — every key in `.env.local` is a Tier A route and is walked

*Adopted 2026-08-22 (NJ Hunt 6), the author's ruling, carried in the session
brief. Recorded here 2026-08-22 — it had been in force and unrecorded, which the
ruling-gap guard in `tests/tracker-stores.test.ts` is what caught.*

**A paid-for, authenticated source going unwalked while a session hits a
free-tier rate wall is a DEFECT and is reported as one.**

This is RULING 90 item 5 promoted to a rule of its own and pointed at the
register: a credential is a route somebody already paid for, so it sits at
Tier A under RULING 84 and is walked before any unauthenticated route is
treated as exhausted.

**The measurement behind it**, from NJ Hunt 5: seven credentials, three of which
nothing in the repo had ever called. Calling them returned 18 sitting members of
Congress with photos and official pages, 61 state legislators with email
addresses, 137 federal candidates, 42 federal document collections, and
**119 owed fields closed in a single run** — all of it available while the
previous session was measuring how fast a free search engine would rate-limit
it.

**And a key is only known to work by calling it.** `CENSUS_API_KEY` was
INVALID, which no amount of reading the register could have surfaced.
`docs/sources.md` carries the per-key walk with what each one returned,
including the ones that returned nothing useful.

### RULING 92 — fix the generator, never the artifact

*Adopted 2026-08-22 (NJ Hunt 6), the author's ruling, carried in the session
brief. Recorded here 2026-08-22. Guarded by `tests/generated-artifacts.test.ts`.*

**A generated artifact is never hand-corrected. The generator is fixed and the
artifact is regenerated.**

Hand-editing an output produces a file that **looks fixed until it
regenerates**, which is a silent class: nothing goes red, and the defect returns
on a schedule nobody is watching.

**The instance it was adopted over.** A screenshot caption was wrong. NJ Hunt 4
corrected it in `docs/state.md` — the generated file — and left the string in
the script that writes it untouched. The script kept producing the wrong caption
and **the defect recurred in NJ Hunt 5**, one session later.

**The sweep it requires**, run on adoption day: every generated file is checked
against what its generator currently produces, and a difference is a finding.
NJ Hunt 6's sweep found `data/hunt/nj-morris-municipal-sites.json` **five
municipalities deep in wrong governments** — `morris_township` pointed at Morris
Plains' website, `chatham_township` at Chatham Borough's, and three more — with
six municipalities missing outright. The generator had already been fixed;
nobody had regenerated. Regenerating corrected all five and added the six.

*Related: RULING 76 (session-dated scripts are committed and held to every
standard) — the two together are why a generator is a first-class, gated,
committed artifact rather than a throwaway.*

### RULING 93 — ask what the tier above publishes about the tier below

*Adopted 2026-08-22 (NJ Hunt 6), the author's ruling. **Written into `CLAUDE.md`
as law in the same session** — it governs every hunt, so it belongs in the
constitution rather than only here. Authoritative account: `docs/state.md`.
Shipped as `scripts/tier-directory.mts` (`pnpm tier:directory`) and as
state-scoped routes in `docs/branch-manifest.md`.*

**The federal government publishes directories of state governments. States
publish directories of their counties and municipalities. Counties publish
directories of their towns, school districts and special districts. Before
hunting any tier, walk the directory the tier above publishes about it.**

A general principle, not a list. **Tier A by construction** under RULING 84: a
directory answers for everything below it in one fetch.

**What it cost not to have it, measured.** Morris County's own *Cities and
Towns* page reached **30 of 39** municipalities, and the nine it missed included
**Rockaway Township — the governing body of the target zip**. Six sessions hunted
municipal sites sideways. New Jersey had published all 21 counties and all 564
municipalities with their official websites the whole time, and
`usa.gov/states/new-jersey` links straight to it.

**The route that taught the control-string rule.** `nj.gov/nj/gov/county/` —
the URL USA.gov itself publishes — answers **HTTP 200 with a styled "Page not
found"**. The document lives at `localgov.shtml`. A status check alone reads
the first as success, so every directory route declares a control string that
must appear in the response.

**Measured on adoption day** (`data/hunt/tier-directories.json`): 8 routes
walked, 8 answering, **851 entities named**, of which the New Jersey state
directory alone carried **624**.

**`usmayors.org` is a discovery surface, never a source of record** — a
nonprofit's directory, so RULING 70's Ballotpedia question governs it rather
than public-domain status. It is deliberately absent from the route list.

*Supersedes nothing. It sits beside RULING 86 (per-state source enumeration
precedes the hunt): RULING 86 says enumerate the state's sources before hunting,
and this says WHERE THAT ENUMERATION COMES FROM — the tier above.*


---

## THE DISCOVERY-CONDUCT RULINGS (2026-08-22, the Discovery Conduct session)

*Eight rulings from the author's brief, adopted together. They are law: written
into `CLAUDE.md` in full in the same commit, under the heading **Discovery
conduct**, with their rationale attached.*

**The numbers, and why they are these numbers.** The brief lettered them A
through H and left the numbering to the file. `docs/rulings.md` had 1 through 93
in use with **88 and 89 deliberately unassigned** — held open on 2026-08-22 so
the author could later claim them rather than have this document renumber a
ruling of his. He is claiming them now. So A and B take **88** and **89**, and
C through H continue from the highest in use: **94, 95, 96, 97, 98, 99**.

| The brief called it | It is law as | Its name |
| --- | --- | --- |
| A | **RULING 88** | The expansion requirement |
| B | **RULING 89** | Expansion is not a side quest |
| C | **RULING 94** | The stuck protocol |
| D | **RULING 95** | Credentials are proven, not assumed |
| E | **RULING 96** | Sources have freshness |
| F | **RULING 97** | A founder find is a class-wide defect |
| G | **RULING 98** | Exploration holds a guaranteed position in item order |
| H | **RULING 99** | The amendment procedure |

**What these eight are for, stated once so the individual rules read as parts of
one thing.** Every previous fix to this problem was a LIST — Wikipedia was a
list, the caucus sites were a list, the API keys were a list. RULING 84 tiered
the list and RULING 61 named it, and both were real improvements. None of them
could be the fix, because the failure is that lists are finite: each new list
closes the gap that was just found and leaves the next one open, and the next
one has been found the same way every time — by the author, with a browser, in
about two clicks.

RULING 90 named that and asked sessions to argue exhaustion rather than assert
it. Behaviour did not change, and the reason is now measured rather than
guessed: **no report contract has ever asked a session what it found that was
not on the list.** A session that walked eleven known routes and a session that
invented three new ones produced identically-shaped reports and were graded the
same. Scope is a ceiling by rule, the manifest is a checklist with a completion
condition, and the discipline rules — correctly — make speculative moves feel
like confessable defects. Sessions walk the routes the brief names and no
others because **that is what the system asks for.**

More principles will not fix this. What changes behaviour is a REQUIRED OUTPUT
THAT CANNOT BE PRODUCED BY WALKING A LIST. That is RULING 88, and the other
seven are what make it real: 89 keeps it from becoming a licence to build
whatever a session feels like, 94 forces the five moves at the moment a session
is most likely to give up, 95 and 96 stop the cheapest routes being left
unwalked, 97 turns the author's own finds into process repairs instead of
manifest entries, 98 stops exploration from being scheduled where it never
happens, and 99 is how any of this gets changed honestly.

---

### RULING 88 — the expansion requirement

*Adopted 2026-08-22 (Discovery Conduct session, from the author's brief, item
3A). Law: written into `CLAUDE.md` under **Discovery conduct**. **Supersedes
nothing. It gives RULING 90 the required output it was missing.***

**Every hunt report carries an EXPANSION section, and it lists routes that did
not exist at session start.**

For each one, four things:

1. **How it was conceived** — what question or observation led to it.
2. **The literal query or URL** that produced it. Not a description of the
   search; the text that was typed.
3. **What it returned, including zero.**
4. **Whether it generalises to a class of entities**, or only reached the one
   thing it was invented for.

**A hunt report with an EMPTY expansion section fails the item.** Not a note, not
a caveat — the item does not pass. This is deliberately the same consequence
RULING 90 already attaches to the sentence "nothing further".

**A newly conceived route that returns NOTHING is a reported SUCCESS.** The
invention is the deliverable; the yield is not. This clause is load-bearing and
is the one most likely to be quietly ignored, because every other rule in this
project rewards rows found. A session that conceives four routes and gets zero
rows from all four has done the thing this ruling asks for, and its report says
so without apology.

*Why a required output rather than another principle.* Because a principle can
be satisfied by a session that believes it complied, and this one cannot: there
is either a route in the section that did not exist this morning, or there is
not. It is the first rule in this file that is checkable against a session's
imagination rather than its diligence.

---

### RULING 89 — expansion is not a side quest

*Adopted 2026-08-22 (Discovery Conduct session, item 3B). Law: `CLAUDE.md`,
**Discovery conduct**. **Supersedes nothing. It bounds RULING 88** and it is
inseparable from it.*

**Expansion is a NEW ROUTE TO A FIELD ALREADY OWED on the item list.**

**A side quest is a new capability, a new surface, new infrastructure, or work
on a zip that is not the current zip.**

- Expansion is **required**.
- Side quests remain **forbidden** and become tracker rows. Writing the row is
  the whole response — the standing rule is unchanged.
- **A session citing RULING 88 while building infrastructure has committed a
  scope breach, and reports it as one.**

*Why this ships in the same breath as RULING 88.* Because "you must invent new
routes" is one sentence away from "you may build anything you can justify", and
that reading would undo the scope discipline that keeps a session finishing what
it started. The test is narrow and it is about the DESTINATION, not the
technique: does this route end at a field the item list already owes? If yes it
is expansion, however novel the method. If no, it is a row.

---

### RULING 94 — the stuck protocol

*Adopted 2026-08-22 (Discovery Conduct session, item 3C). Law: `CLAUDE.md`,
**Discovery conduct**. **Supersedes nothing. It sits between RULING 84's tiers
and any recorded absence**, and it is what RULING 90's "what would I try if
there were no manifest at all" looks like as a procedure.*

**When a field is unfound after Tier A and Tier B — before any absence is
recorded, and before Tier C per-entity search begins — run five moves. Record
the literal query text or URL and the result for each.**

1. **What would a person with a browser type right now?** Type it.
2. **What does the tier above publish about the tier below?** Federal publishes
   states; states publish counties and municipalities; counties publish towns
   and districts. Descend the hierarchy; do not guess sideways. (RULING 93.)
3. **What did entities of this same shape do?** If one township posts a clerk's
   PDF, the other twenty may. **Test the shape, not the instance.**
4. **Who else needed this badly enough to have compiled it already?** Courts,
   local news, the League of Women Voters, unions, chambers of commerce,
   libraries, universities.
5. **One lateral query phrased exactly as "where else can I find this"** for the
   specific fact, on a general search engine.

**A recorded absence with no stuck-protocol block is VOID, and the field returns
to owed.**

*Why questions rather than a list of URLs.* A fixed list goes stale and becomes
the next thing a session walks instead of thinking. These are five questions
precisely so they cannot be completed — the answer is different in every state,
which is the point.

*Where it sits, exactly.* After Tier A and Tier B, BEFORE Tier C. That placement
is the whole economy of it: per-entity search is the expensive tier, and four of
these five moves are broad routes that may answer for fifty entities at once.
NJ Hunt 4 spent an entire search budget on 272 individuals and never once asked
where all 272 live.

---

### RULING 95 — credentials are proven, not assumed

*Adopted 2026-08-22 (Discovery Conduct session, item 3D). Law: `CLAUDE.md`,
**Discovery conduct**. **Supersedes nothing. It makes RULING 91 checkable** —
RULING 91 says every key is a Tier A route that gets walked; this says how the
walk is proven.*

**Every hunt session regenerates `docs/credential-ledger.md` at session start by
CALLING each key.**

- **A key not called this session is reported as UNPROVEN.** Not assumed
  working, not carried forward from the last session's table.
- **An invalid key opens a Needs Sean P1 row the same session.**

*Why calling and not reading.* The register can only say which files reference a
key. It cannot say whether the key works, and the difference has cost real
findings: `CENSUS_API_KEY` was invalid and nothing discovered it until something
finally hit the endpoint. Reading the register would never have surfaced it, at
any level of care.

*And why the bar is "is the body about the thing we asked for".* Because the
Census host answers a rejected key with **HTTP 200 and an HTML page titled
"Invalid Key"**. A check written against the status code reads a dead credential
as healthy. The ledger's control is that the body parsed as the data requested,
plus a deliberately bogus second request that must come back DIFFERENT
(RULING 68).

The generator is `scripts/credential-ledger.mts` (`pnpm credentials`). The
artifact is never hand-edited (RULING 92).

---

### RULING 96 — sources have freshness

*Adopted 2026-08-22 (Discovery Conduct session, item 3E). Law: `CLAUDE.md`,
**Discovery conduct**. **Supersedes nothing. It extends RULING 53's expiry
discipline from ABSENCES to SOURCES.***

**`docs/sources.md` carries a LAST-WALKED DATE on every entry, keyed or not.**

The expiry windows are the ones that already govern absences, unchanged:

- **candidate fields — 7 days**
- **bodies and rosters — 14 days**
- **walled sources — 14 days**

- **A source past its expiry is re-walked, or reported STALE with its date.**
- **A source walked but not recorded is a DEFECT**, because the next session
  re-derives it.

*Why sources and not just absences.* RULING 53 made an absence a measurement
with a shelf life. A source is the same kind of claim wearing a friendlier face:
*this endpoint answers, this licence permits, this is where the list lives*.
Every one of those can stop being true without anything in this repo noticing,
and a register with no dates cannot tell a session which of its rows are
observations and which are folklore.

---

### RULING 97 — a founder find is a class-wide defect

*Adopted 2026-08-22 (Discovery Conduct session, item 3F). Law: `CLAUDE.md`,
**Discovery conduct**. **Supersedes nothing. It applies the named-instance rule
to the DISCOVERY PROCESS itself.***

**When the author finds a source, route, or fact the sessions did not, that is a
DEFECT IN THE DISCOVERY PROCESS** — handled exactly like a named instance of a
class-wide defect in code.

The next session answers three questions in its report:

1. **What procedure would have found this without him?**
2. **Why did that procedure not run?**
3. **What changed so that it runs next time?**

**Absorbing the find as a new manifest entry and moving on is NOT an adequate
response.** That is fixing the named instance and reporting it closed, which the
constitution already forbids everywhere else.

**Manifest growth that comes only from the author is the failure this ruling
names.**

*What it cost to learn.* Wikipedia as a Tier A source was identified by him, not
by a session. When it was finally walked it returned **261 officials, 898 rows,
818 citations confirmed against primary sources (91.1%), and 174 governing
bodies against a registry holding 12**. The response at the time was to add
Wikipedia to the manifest — a correct action and an insufficient one, because
nothing about the process that missed it for six sessions changed, and the next
find came the same way.

---

### RULING 98 — exploration holds a guaranteed position in item order

*Adopted 2026-08-22 (Discovery Conduct session, item 3G). Law: `CLAUDE.md`,
**Discovery conduct**. **Supersedes nothing. It binds the CHAT THAT WRITES
BRIEFS as much as the session that executes them**, which no other rule in this
file does.*

**In every hunt brief, expansion work is its own NUMBERED ITEM, and it is NEVER
LAST.**

*The reason, stated plainly because it is a fact about how this system actually
behaves.* Whatever sits at item 1 eats the run. Expansion placed at the tail
never happens, because it is scheduled to begin after exhaustion — and
exhaustion never arrives, by design: RULING 90 exists precisely to stop a
session declaring it. So a brief that puts exploration last has not deprioritised
it; it has cancelled it, while appearing to require it.

This is the one ruling here that a session cannot comply with on its own. It is
an instruction to whoever writes the brief.

---

### RULING 99 — the amendment procedure

*Adopted 2026-08-22 (Discovery Conduct session, item 3H). Law: `CLAUDE.md`,
**Discovery conduct**. **Supersedes nothing. It generalises the 2026-08-22
renumber**, which is the precedent and the format.*

**Every ruling in this file is amendable. A ruling is changed only by a LATER
DATED RULING that:**

1. **names the number it supersedes**,
2. **states what changed and why**, and
3. **adds a mapping line in BOTH `docs/rulings.md` and `CLAUDE.md`.**

**Rulings are never edited in place and never silently dropped.** A superseded
ruling STAYS IN THE FILE, marked superseded, carrying its successor's number.

*The precedent.* On 2026-08-22 a brief adopted five rulings as 81 through 85
while a session earlier the same day had already spent 81 and 82. Renumbering
the two that shipped would have left dangling references in an append-only
record whose entire value is that it does not move. The five took 83 through 87
with a mapping table in both files, and both numbers a search would find still
find the rule. That is the shape every amendment takes from here.

*Why the file, and not memory.* Because a superseded ruling that is deleted
comes back as drift. Something in this project reads it, cites it, or reasons
from it, and nothing says it was overturned — which is the exact failure
`docs/rulings.md` was created to end.

---

### RULING 100 — a partial answer that adds up is still a wrong answer

*Adopted 2026-08-23 (Hunt 6 hardening, item 3). Law: `CLAUDE.md`, **Non-negotiables in code**. **Supersedes nothing. It is the missing half of the zero-row-extraction rule**, which catches a reader that came back with nothing and cannot see one that came back with some.*

**When a document says how many people are on a body, and we read fewer than that, we have not read the document. That is a failure, and the machine now says so.**

A council page says *nine members*. Our reader came back with five. Every check we had said this was fine, because every check was asking *did anything come back* — and five is not nothing. The five were real people, correctly read. The four who were missing were simply not there, and nothing anywhere noticed.

**When the source states no number, we now say that out loud too.** "We read four people and the page never said how many there should be" is a different and much weaker statement than "we read four and the page says four", and a report that ran the two together would be telling you it had checked something it had not.

*What this cost to learn, three times in one session.* A stray piece of formatting in Rockaway Township's page cut its council list short: **four of nine members vanished and the run reported five rows and finished clean.** A filter meant to keep out stray text deleted the two Mount Olive members the page says least about — the two least-documented people on the body, which is the fairness problem this project has rules about, pointed the other way. And Pequannock's page used *was composed of* where the reader only knew *is composed of*: **five sitting council members read as an empty body.**

Only the third of those was visible before today. The first two are the reason this ruling exists.

---

### RULING 101 — our own identifier never leaves our own site

*Adopted 2026-08-23 (Hunt 6 hardening, item 4). Law: `CLAUDE.md`, **The collection stores never join**. **Supersedes nothing. It finishes `VF02`**, where one of two findings was fixed and the other was written down and left.*

**When our own tools walk the site, they attach a label saying "this is us, not a reader". That label must never be sent to anyone else's server.**

Two things went wrong and only one was fixed. The first: the map provider's server refuses any request carrying a header it does not recognise, so attaching our label to the map's own request meant **the map failed in every screenshot and every automated walk this project has ever taken.** That is why one session's photographs showed a broken map while its 371 checks were green — both were honest, and they were looking at different pages, because the instrument was breaking the thing it was measuring.

The second was recorded and never enforced: **the label was going to every outside company the page touches.** Nothing sensitive is in it — it names a walk, not a person — but a marker identifying our infrastructure arriving at servers we do not control is the wrong shape for a product whose central promise is that its records cannot be joined together.

The rule is now a piece of code with its own test rather than four lines inside a tool, which is the difference between something enforced and something remembered. It is checked against every outside service these pages reach, by name, so the list has a stated size rather than one example.

---

### RULING 102 — fixing the recipe is not finished until you re-cook the dish

*Adopted 2026-08-23 (Hunt 6 hardening, item 5). Law: `CLAUDE.md`, **Repo layout**. **Amends RULING 92** by giving it an end: RULING 92 says fix the generator and never the output, and had no answer to "how do I know I am done".*

**When a program writes a file for us, fixing the program is only half the job. The file has to be written again and compared, and the number that changed has to be reported.**

A file listing every municipality's official website pointed **five towns at the wrong government** — one township at the neighbouring town's site, another at the borough's. The program that writes that file had **already been fixed**. Somebody did the right thing and stopped. The wrong file stayed where it was, every later piece of work read it as current, and nothing anywhere went red, because "fix the generator" was satisfied the moment the generator was fixed.

So each program now has a fingerprint taken of its own code, recorded next to the file it writes. **Change the program and the build fails until the file is written again.** Fixing a generator now costs a re-run, which is what finishing the job always was.

The fingerprint is taken of the PROGRAM, not the file, and that is the whole design. A changed file tells you it changed; it cannot tell you it SHOULD have changed. A program that reads a government's website will legitimately produce a different file when that government moves its site — but the program itself only changes when a person edits it, and that is exactly the moment a re-run is owed.

---

### RULING 103 — a sweep looks for the same code twice, not just the same symptom

*Adopted 2026-08-23 (Hunt 6 hardening, item 6). Law: `CLAUDE.md`, **A named instance is an example of a class-wide defect**. **Amends that rule** by naming the blind spot in its own instruction.*

**When something is wrong in one place, we already look for the same symptom everywhere. We now also look for the same code, written out more than once.**

Three separate copies of the same small routine turned **Thomas J. Haynes III** into the initials **"TI"** — each took the first letter of the first word and the first letter of the last, and the last word was *III*. Fixing the copy that was complained about left two copies of the same fault standing.

Searching for the symptom cannot find them. They are not the same text, and they do not use the same names for things. So the sweep now also compares the SHAPE of the code, with the names set aside, which is what makes a renamed copy show up as a copy.

The existing rule's own instruction is where the gap was. *Fix at the shared code path* assumes there is one.

The first version of the new tool read 241 pieces of code across 806 files and reported one duplicate — which is a sweep announcing nothing found without having looked, the failure this project names most often. It now reads 2,114 and found 26 groups. Four copies of "who is calling", which is a claim this project makes law, are now one. Two copies of "is this the same person" are now one, and one of them was in the tool that CHECKS whether the same person is shown twice — it had been checking with a different definition of a person than the thing it was checking.

---

### RULING 104 — a file you put in the repo is something a session must go and read

*Adopted 2026-08-23 (Hunt 6 hardening, item 15). Law: `CLAUDE.md`, **Non-negotiables in code**. **Extends RULING 94 to visual sessions explicitly**, which were outside its stated scope.*

**When you leave something for a session to look at, it goes in the repository, and the session must reach it. Not reaching it is a fault to report, never an acceptable outcome.**

The 8/22 visual brief pointed at a shared Drive folder. A session has a terminal and a copy of the repository; it has no way into that folder. The input was unreachable by construction. The brief then said *if the folder is unreachable, proceed and report that — it is not a blocker*, which is permission to skip, and the session took it and honestly reported that it had not tried.

Both halves were the brief's fault, and the cost was specific: one issue came back *"could not reproduce"* while the picture showing it sat in a folder the session never opened. Refusing to guess at a fix was right. Stopping with the evidence unread was not.

RULING 94 already says an obstacle you did not attempt is not an obstacle. It was written for hunting. It applies here too.

---

### RULING 105 — say what is rendering, what is out of scope, and what is still dark

*Adopted 2026-08-23 (Hunt 6 hardening, item 15). Law: `CLAUDE.md`, **Where collection and rendering can diverge**. **Supersedes nothing. It extends the two-numbers rule** from a pair to a three-way split.*

**A count of what we are showing is not a report. Three numbers are: what is rendering, what is deliberately out of scope and why, and what is in scope and still missing.**

*"174 bodies render"* sounds complete and says nothing about the ones that do not. The middle number is the one that keeps a report honest, because without it there is no way to tell a body we decided not to cover from a body we failed to reach — and those need completely different responses. One is a decision. The other is work.

Each of the three carries its own denominator, so the three add up to something a reader can check.

---

### RULING 106 — no generated file has a size limit

*Adopted 2026-08-23 (Hunt 6 hardening, item 16, `NS09` — the author ruled C and extended it: there are no caps anywhere). Law: `CLAUDE.md`, **Repo layout**. **Supersedes the 40 KB cap** set on 2026-08-17 and the 20 KB one before it.*

**A file this project writes for itself is as long as it needs to be. Nothing trims it to fit.**

A size limit forces quiet trimming, and quiet trimming produces a file that says less than it knows while reading as complete — the same failure as RULING 100's partial answer, one floor up.

The orientation file every session opens was capped at 20 KB and dropped its entire recent-changes section. The cap was raised to 40 KB. By today it was dropping the same section again and shortening notes from 130 characters to 90. Raising a limit is treating a symptom; the third time it happens, the limit is the problem.

**When a generated file grows, the answer is to remove repetition from what feeds it — never to cut the output.**

Two limits were found and removed. The orientation file now runs to 44 KB with its recent-changes section whole at ten of ten rows and its notes at full length. The session log clipped its finished and still-open lists to twelve rows each with an *"and N more"* line beneath — the same trim wearing a polite face — and grew by 25 KB when that came out.

**What replaces a limit.** Without one, a generated summary can drift toward reproducing the constitution and leave two documents that disagree about the law. The answer is not a cap: **every section says where its content came from, and any block that claims to be word-for-word is tested against the original**, so a difference fails the build instead of sitting there. That sweep immediately found a real gap — the pinned rules block said where it came from only at the END, after the whole thing, rather than at the point a reader arrives.

---

### RULING 107 — a freshness date is written only by the code that read the source

*Adopted 2026-08-23 (the visual tail and rehunt session, item 1). Law: `CLAUDE.md`, **Non-negotiables in code**. **Supersedes nothing. It closes `NH80`**, and it is the enforcement half RULING 96 was missing: RULING 96 made last-walked dates the instrument that decides what gets re-checked, and had no way to tell a date somebody earned from a date a program printed.*

**When we write down the date something was last checked, that date has to come from actually checking it. A program that stamps today's date every time it runs is not recording freshness. It is erasing it.**

A note in the tracker said we should not re-run one of our programs, because re-running it would move a date from 16 August to today without anybody re-reading the thing the date is about. So it was left alone.

**Re-running it turned out to be safe, and something else was not.** The file everyone was worried about came back **identical, byte for byte** — it copies its date from the snapshot it reads, which is the day somebody genuinely looked. That program was already honest.

The one nobody was watching sat next to it. A report it also writes had *"Generated 16 August"* at the top, and re-running moved that to *"Generated 23 August"* **with nothing read at all**. Anyone scanning that document for how current it is — a person or a program — would have read week-old data as a day old.

**And that is worse than having no date.** A missing date sends somebody back to check. A confident wrong one stops them, and stops them permanently. So the two kinds of date are now different things that cannot be mixed up: one says *when we read this*, and can only be produced by a read or copied from an earlier one; the other says *when this program ran*, and is never allowed to sit in a freshness field. Where nothing was read, the answer is `UNKNOWN`, which reads as stale.

*What the sweep found across everything else.* Of the ten programs that write files for us, **one** could stamp a date without reading, and it is fixed. Reading every file under `scripts/` and `lib/` — 523 of them — turned up **31** places where a date came off the clock. **Twenty-nine were legitimate and are now marked as such**: a program that fetches a page and stamps the moment it fetched is doing exactly the right thing, and each was checked by hand before being marked. One is fixed. **One remains** and is a tracker row: it stamps a portrait with today's date when the portrait was actually collected earlier, and the earlier date was never recorded, so fixing it needs the collecting step to start recording one.

---

### RULING 108 — anything a session must read at the start lives in the repository

*Adopted 2026-08-23 (the visual tail and rehunt session, item 2). Law: `CLAUDE.md`, **Repo layout**. **Supersedes nothing. It generalises RULING 104**, which said an artifact the author places in the repo is an input a session must reach; this says where the author has to place it for that to be possible.*

**A session has a terminal and a copy of the repository. It has no way into a shared drive. So anything we expect a session to read before it starts work has to be in the repository, or we have not given it to them.**

The orientation file — the one every session is told to open first — was being written to the shared Drive folder and nowhere else. Worse, the program that writes it **gave up entirely when the Drive folder was missing**, which is always, on any machine that is not the author's. So on a session's machine the file was not merely out of reach: it was never written at all.

**Everything done to improve it had landed somewhere no session could look.** The size limit that had been quietly cutting its contents was removed, its recent-changes section was restored to its full ten rows, and its notes were put back to full length — all of it, into a folder no session has ever been able to open.

This is the second time in two sessions. The first was a folder of screenshots a visual session was told to look at and could not, which is what RULING 104 was adopted over. The pattern is the same both times: **something is left for a session in a place only a person can reach**, and the session honestly reports it did not look.

The repository copy is now the one that gets written, it is written first, and nothing is allowed to stop it. The Drive copy is written afterwards, as a convenience for the author, and if it fails that is a note about the Drive rather than a reason to produce nothing. **The file is 44 KB, in the repository, with the conduct rules in it word for word.**

*Why the order is the rule and not a detail.* If the Drive write came first and threw, the repository copy would never happen — which is the failure this ruling exists to end, rebuilt inside the fix for it.

---

### RULING 109 — a brief says what it needs to run, and the session checks before item one

*Adopted 2026-08-23 (the remote visual-tail session, item 8). Law: `CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing.*

**Every brief says up front which of two kinds it is, and the session confirms that before it starts item one.**

**Local-required** means the work needs credentials, a live network, or the production site. **Remote-capable** means every item can be done from what is committed in the repository. **A hunt is always local-required**, because a hunt is by definition a thing that goes and fetches.

**A session that finds itself in the wrong environment says so immediately and does the part it can**, rather than discovering the constraint partway down a ladder, three items in, having already spent an hour of its window finding out.

*Why this is worth a rule.* Today's session opened by checking four things — is there a credentials file, is anything other than GitHub reachable, is the browser usable, does a production build run — and had the answer in about a minute. Without that check the same facts arrive one at a time, each as a failure in the middle of some other piece of work, and each one costs the time it takes to work out whether it is a broken machine or a deliberate boundary. The 2026-08-23 wall against every host but GitHub was established the hard way, across four separate retrieval attempts, by a session that had no way of knowing it was policy rather than breakage.

**The check itself is cheap and the answer is reported in one line each.** What it prevents is a session spending its scarce attention proving something the brief could have told it in a sentence.

---

### RULING 110 — a search that finds nothing must show it looked in the right FORM

*Adopted 2026-08-23 (the remote visual-tail session, item 8). Law: `CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing. It is RULING 100's lesson moved from extraction to searching: that ruling caught a reader that came back with SOME of a document and called it all of it; this catches a search that came back with none of a thing and called it absent.*

**Not finding a match is not the same as the thing not being there. A report that says "it is gone" has to say what SHAPES it searched for, not only what words.**

On 2026-08-23 a session reported a particular piece of copy — the app telling a reader it would not describe an office — gone from the whole repository. It had searched for one exact sentence. The copy was alive, in different words, on the **first and mandatory section of every candidate card**: so while the product was counting 214 bodies it could not describe, every candidate on every ballot was opening with the app declining to describe the office they were standing for.

**That first report was not dishonest.** It searched in the wrong form, and nothing in the process asked it to prove otherwise.

So: **report the shapes, not just the terms.** A shape is the pattern the thing takes rather than the letters it happens to be spelled with — *a sentence that announces we will not describe something*, rather than *the words "we're not going to describe it"*. And the instrument has to be shown catching the real thing: a sweep that cannot find the defect it was written for is a sweep reporting green about nothing.

*The half that is easy to get wrong, and it would delete a rule rather than enforce one.* A refusal and an honest named gap use nearly the same words. *"We haven't recorded this chamber's vote on this yet"* is **required** — it names our gap and attributes it to us. What is forbidden is announcing that we will therefore say nothing. Any instrument built for this has to pass every honest line this product ships, or it becomes pressure to delete the attribution rule instead of the refusal.

---

### RULING 111 — a join is never a lookup for a fact that lives on only one side

*Adopted 2026-08-23 (the questionnaire-and-corpora session, item 5). Law:
`CLAUDE.md`, **Data model conventions**. Supersedes nothing.*

**Before you ask a joined-up file a question, say which of the two files
actually holds the answer — and whether joining them can lose rows. If it can,
ask the file that holds the answer.**

A join puts two lists side by side by matching them on something. When the match
fails, the row does not come back at all — and a row that does not come back
looks exactly like a row where the answer was genuinely "nothing". **Those are
two completely different things and nothing in the output tells them apart.**

That is what happened here. The school-district classifier asked the
Census–NCES crosswalk whether a district is independent or run by another
government. **Only the Census file knows that.** NCES does not carry it. So the
question could have been asked of the Census file directly, and instead it was
asked of the two files stapled together — and the crosswalk's own report says,
in as many words, that **4,083 of 13,859 Census school systems have no NCES
match and are absent from it entirely.** Every one of those disappeared
silently, and the disappearance looked identical to a real answer of "we do not
know".

The reason the two files cannot be matched cleanly is worth stating, because it
is not a bug anyone can fix: **the two files share no identifier at all.** The
join is on state code plus a normalised district name, one-to-one, and a name
that matches more than one row on either side is thrown out rather than guessed
at. That is the correct way to do it and it still loses nearly three in ten.

So:

- **Say which side holds the fact, before querying.**
- **Say whether the join can drop rows.** A join on names always can.
- **If it can, query the side that holds the fact.**

*Why this is a ruling and not just a fixed bug.* Every instrument in this
project asks whether something came back. A dropped join row comes back as
nothing, and nothing is the same shape as an honest absence — so no existing
guard could ever have caught it. It is RULING 100's failure moved from reading a
document to reading a database: **a result that adds up is not a result that is
correct.**

---

### RULING 112 — a first-party instrument is symmetric by construction, or it is not shipped

*Adopted 2026-08-23 (the questionnaire-and-corpora session, item 5). Law:
`CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing.*

**Anything we ask candidates ourselves must be identical for every candidate in
a contest — the same questions, the same word limit, the same deadline, the same
number of reminders, and the same way of showing that somebody did not answer.
Their answers publish word for word and are never shortened or summarised.**

*The reason, and it is the whole point of building the thing.* An incumbent
always has more public material about them than a challenger does. **Looking
harder makes that gap wider, not narrower**, because there is simply more to
find on the incumbent. So the rule that we hunt equally hard for everybody —
which is right, and stays — cannot fix this on its own. It is a problem in the
world, not in our effort.

A questionnaire we write ourselves is the one thing that can be fair by
construction. Everybody gets the same blank page. The candidate who has been in
office twenty years and the candidate who filed last month are handed the
identical five questions on the identical day with the identical limit, and
whatever comes back is theirs.

Which means the asymmetries we would introduce are the ones that matter most:

- **The same questions.** Not a longer set for the incumbent, not an easier set
  for anybody.
- **The same word limit, and nothing is ever cut.** If an answer is over the
  limit the candidate is told before they send it and they decide what to
  remove. Cutting it for them quietly favours whoever writes short.
- **The same deadline and the same reminders**, sent on the same days to
  everyone who has not answered.
- **Answers publish exactly as written.** No summarising, no shortening, no
  rewriting, no putting a machine over them, no fact-check inside the answer, no
  rating. The moment we compress somebody's words we have replaced their framing
  with ours — and doing that across a contest is the exact unfairness the
  instrument exists to remove.
- **Not answering is a plain fact and reads the same for everyone.** *We sent
  these questions on this date, followed up on these dates, and have not had an
  answer.* Never that they refused, declined, avoided or ignored us. **A
  candidate owes us nothing**, and a sentence implying otherwise would be this
  product scoring somebody for silence.
- **Withdrawing puts a candidate back where they started.** Not "answered and
  then withdrew", which invites a reader to wonder what was taken back and would
  make answering risky.

**Unfairness in an instrument we control is worse than unfairness in the world,
because we chose it.** The world's version is a fact to work around. Ours would
be a decision, made by us, about named people asking for votes.

---

### RULING 113 — a step that reports success is asked whether it did the thing

*Adopted 2026-08-23 (the CI-and-depth session, item 9). Law: `CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing. It is the operation-count rule pointed at a BUILD STEP rather than at a data fetch — that rule asks an operation what it returned, and this asks a step what it produced.*

**Where a step's product can be looked at, look at it AT THE STEP. Not at the first thing that needs it.**

`main` went red and stayed red. Four tests failed with one message: *no browser is installed; I looked in this folder and found nothing.* The step before them — the one whose whole job is installing that browser — **reported success, in twenty-seven seconds**. Its own log, two screens above the failure, said it had downloaded the browser into exactly the folder the tests then searched.

The install was fine. **The thing doing the looking was broken**: it was looking for the browser file at the path an older version of the tool used, and the current version puts it somewhere else. It had been broken on every machine, including the author's own, for as long as it had existed.

Two things went wrong and they are separable:

- **A step reported success without its product being checked**, so the failure surfaced eighty seconds later, inside four unrelated tests, in a job that had already run a two-thousand-test suite.
- **The failure message pointed at the wrong half of the problem.** "No browser is installed" about a folder containing a freshly installed browser sends every reader to the installer, which was working perfectly.

So a step whose product can be observed gets a check right after it, and that check says what it looked for, where, and what it actually found. Where the thing the step produced can be compared against what the tool ITSELF says it produced, compare them — that comparison is what was missing here, and it is the only one that could have failed.

**And the check has no skip flag.** An escape hatch on a gate is how a gate stops meaning anything, and the one "fix" available locally — letting the check pass with no browser — is the exact thing the harness forbids in as many words.

---

### RULING 114 — a layer that always renders must be right, because finishing it removed the honest silence

*Adopted 2026-08-23 (the CI-and-depth session, item 9). Law: `CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing. It is the render-default rule read forward in time: that rule forbids a default turning a blank into a claim, and this is about what happens when there are no blanks left.*

**When a layer covers everything, every mistake in it becomes a false statement instead of a gap. So every always-on stamp is checked against a source of record, and a disagreement fails rather than renders.**

The product had a bug where two government-type codes were swapped: the code for *town* was being read as *township* and the other way round. The result was that **Morristown, Kearny, Dover, Newton, Boonton, Westfield, Clinton, Hackettstown, Phillipsburg, Harrison and Belvidere** were each shown an explanation of how a township works. Not one of them is a township.

The bug is fixed. The lesson is not about the bug.

**Completing the layer to cover all 1,253 bodies is what made the bug dangerous.** Before it was complete, a body with no description showed nothing — and nothing is never wrong. Finishing it meant every misclassification turned into a confident, wrong statement about how a reader is governed, and a wrong description looks exactly as healthy on the page as a right one. The coverage number went from something that could only embarrass us to something that could lie.

**Checking the stamp against the same field it was stamped from proves nothing.** It only proves the code is consistent, and it would have agreed with the swap on all 1,253 rows every day for as long as the swap lived. So the check has to be against a *different publication*: one Census product describes the shape of a place, another describes the GOVERNMENT and writes out its full name — *Township of Rockaway*, *Town of Morristown*. The swap disagrees with the second one on every row it touched.

*Where two authorities disagree, that is a FINDING and it is closed by going and looking.* One did: a Census roster from 2022 calls Buckeye, Arizona a town, and the map data calls it a city. Buckeye's own website refuses our requests, so an archived copy of it was read instead — it says **City of Buckeye**, three times, on its own front page. The roster is simply out of date. That disagreement is recorded with the route that settled it, and it stays visible; it is not quietly deleted.

*And a check that cannot reach its subject may never read like a passing one.* A row with nothing to compare against is counted separately, by name, with a reason. It is never folded into the verified total, because a sweep that quietly counted the things it could not check would be reporting confidence it never measured.

---

### RULING 115 — a drill is not a failure, and an alarm that cannot tell them apart spends the next real one

*Adopted 2026-08-24 (the overnight depth hunt, item 8, closing the diagnosis on `JOB02`). Law: `CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing.*

**An alarm must be able to tell an exercise from an event. One that cannot will eventually cry wolf, and the cost is not the false alarm — it is the real one nobody reads.**

A watcher raised a priority-one row saying a scheduled job had failed twice in a row and recovered without anyone finding out why. That is exactly what the watcher is for, and two failures in a row is good evidence the cause is ours rather than the world's.

**Both runs were deliberate tests.** They were five minutes apart, both started by hand rather than on the schedule, both carrying the flag whose only purpose is to make the job fail on purpose — and the job's own log said so in each: *"This failure is FORCED… No vendor failed. No source failed."* Somebody was testing this very watcher, and it worked.

So the alarm did its job perfectly and produced a row nobody could act on. That is the failure this ruling names: **a queue that reaches a person is a scarce thing, and an item in it that turns out to be nothing teaches the reader to skim the next one.**

Three things about the fix, and the second and third are the ones easy to get wrong:

- **Only the test that RAISES a row is narrowed.** The failure RATE still counts every run, because the rate is a fact about the workflow and a drill really did fail.
- **The number set aside is printed on every run.** A deliberate exclusion that reads as a clean result is the same shape as a silent trim, and this project names that failure more often than any other.
- **An unknown trigger is NOT treated as a drill.** Where it cannot be told which kind a run was, the alarm still fires. That is the direction that costs a wasted look; the other direction loses a real failure.

---

### RULING 116 — a guard may pin an invariant or a direction, never the size of a gap

*Adopted 2026-08-24 (the overnight depth hunt, item 6). Law: `CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing. It is the two-numbers rule pointed at the test suite rather than at a report.*

**A test that freezes how much work is left goes red when the work gets done. That trains a reader to raise the number instead of looking at what changed — which is the opposite of what a guard is for.**

A check on the coverage of one layer asserted that 1,037 bodies were still owed a description. That was true on the day it was written. Reading eight statutes and writing the descriptions took the number of covered bodies from 216 to 857, so the number owed fell to 396 — **and the suite went red because the work had been done.**

Nothing was wrong. The guard was measuring the size of the hole.

What is actually worth holding still is the shape of the accounting, not its current value:

- **The INVARIANT.** Every body is either described or counted as owed, and the two sides add up to the total. That stays true whatever the numbers are, and it is what catches a body going missing.
- **The DIRECTION.** Coverage may improve and may not silently reverse. A number that went the wrong way means something was removed, which is a real finding; a number that went the right way is the point of the project.
- **The PAIR.** Both halves are asserted together, because "owed fell" on its own is also what it looks like when rows vanish.

*The reason this is worth a ruling rather than a note.* A frozen coverage number does not fail loudly and get fixed — it fails on a day somebody made progress, and the cheapest way to make it green again is to edit the constant to match. Do that twice and the guard has become a record of what the coverage happens to be, which nobody reads, rather than a claim about what must always be true, which somebody would.

---

### RULING 117 — the asset store has a public address, and a restore is proved by hash

*Adopted 2026-08-24 (Sean's decisions of that day, closing `R57`). Law: `CLAUDE.md`, **Repo layout**. Supersedes nothing. It finishes RULING 20, which moved portrait bytes out of git and could not say where they should land.*

**The portraits and public-record PDFs live in their own public repository, and a restore checks the bytes rather than the status code.**

RULING 20 moved the bytes out of git for a good reason: git keeps every version of every file forever, and the corpus this product wants is every agenda PDF for every body it watches. What it could not do was finish, because the store was a folder on Sean's own machine and a build server cannot reach a folder on somebody's machine. So the pictures stayed committed as well as stored, and the repo carried both the bytes and the machinery meant to replace them.

That cost more than disk. **97 sitting members of Congress had portraits already retrieved, licence-checked and byte-verified, and could not ship, because there was nowhere to put them a build could read.**

Sean ruled: a dedicated public repository, created automatically. It is `github.com/SeanJ22/wtp-assets`.

**Public is the right posture, not a shortcut.** Everything in it was already published — by a government body, by a campaign about itself, or under an open licence. A private store would need a password in the build, and a password is a thing that expires, leaks, or sits unused while somebody hits a rate limit next to it.

**Why the bytes get checked and the status code does not.** A file here is stored under a fingerprint of its own contents, so the name of the file *is* the answer to "are these the right bytes". A web server can answer "200 OK" and hand back an error page, a proxy notice, or half a file. Checking the fingerprint costs nothing and catches all of it. A file that fails is reported as "could not fetch this one", never as "this picture does not exist".

---

### RULING 118 — an appointed official never carries the govern verb

*Adopted 2026-08-24 (Sean's decision of that day, closing `NS07`). Law: `CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing.*

**Say "runs the department", "chair", "president of the committee". Never "governs you".**

New Jersey's executive departments are real bodies with real public hearings — the Department of Banking and Insurance sets rules on mortgages, insurance premiums and pawnbrokers, and those hearings are exactly the there-is-a-hearing-Tuesday thing this product exists for. **Their meetings were never in question.**

The question was the person. A commissioner of a state department is appointed. A reader did not elect them and cannot vote them out. Telling that reader "this person governs you" describes a relationship that does not exist, and the whole claim of this product is that it does not do that.

The distinction is not a softer version of the same sentence. *Runs the department* is accurate and useful — it tells a reader who is responsible for something that affects them. *Governs you* is a claim about the reader's own power over that person, and it would be false.

Sean's ruling covers role descriptions too, not just the headline: **no wording anywhere may attach the govern verb to somebody appointed.**

---

### RULING 119 — a sovereign tribal nation is its own category of government

*Adopted 2026-08-24 (Sean's decision of that day, closing `NS08`). Law: `CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing.*

**Tribal nations are their own specific category — neither federal nor state nor local — and this is national, not an Arizona special case.** Sean named New Mexico, Oklahoma and Texas as coming.

Nothing in this product's ordinary enumeration would have found this. It came out of the federal directory of state election offices, whose Arizona entry lists six offices — and one of them is the Navajo Nation Ethics and Rules Office, sitting alongside the states as a place that holds hearings and investigations under the Navajo Nation's own ethics law. No list of towns, no county roster and no state register carries that.

**Why a new category rather than a label on an old one.** Filing a nation as an ordinary governing body inside a state makes it a subdivision of that state, which is exactly what it is not. Every other existing category was worse. The rule that the smallest body matters as much as the biggest is about branches and twigs; a sovereign nation is not a twig, it is a trunk this product had never touched.

**What is deliberately not claimed.** The govern verb does not attach here — and that is not a smaller claim, it is an honest one. Whether a tribal government has authority over a particular person turns on tribal membership and on the status of the land, not simply on where somebody is standing. This product locates a reader by geography alone. So it names the nation, its government and its meetings, and does not assert a governing relationship it has no way to establish.

**The identifier had to be minted, and it says so.** The standard national list of government identifiers has no tribal category at all — read on 2026-08-24, its entire top-level vocabulary is states, districts, territories and courts of appeal. There was nothing to look up. So the identifiers here are built on the Census Bureau's own codes for tribal areas, with the federal code recorded beside each one. That is a different thing from a guess, and the difference is written down so nobody has to work it out again. Whether this project should propose a tribal category to the people who maintain that national list is Sean's call, and it has a row.

---

### RULING 120 — equal solicitation is the obligation; who buys is not

*Adopted 2026-08-24 (Sean's decision of that day, closing `T04`). Law: `CLAUDE.md`, business constraints. Supersedes nothing.*

**In his words: "We will never sell exclusively. I will solicit equally. Whether they buy is up to them — if 65% of buyers end up on one side, that is not something I can control so long as the solicitation was equal."**

This settles a question that had been open since the business section was first written: does the neutrality claim survive the data being sold?

It survives, and the reason is a clean separation between the thing that can be controlled and the thing that cannot. **Selling exclusively to one buyer would be a choice this product made** — it would hand one side an advantage that came from us, and no amount of explaining would undo that. **Who chooses to buy is a fact about the market**, and holding ourselves responsible for it would mean either refusing customers based on their politics or pretending to a control nobody has.

So the obligation is real, specific and checkable: **the offer goes out equally.** The composition of who accepts is reported honestly and is not steered.

---

### RULING 121 — one body that spans two towns has one identity, and renders in both

*Adopted 2026-08-24 (Sean's decision of that day, closing `NH33`). Law: `CLAUDE.md`, **Data model conventions**. Supersedes nothing.*

**A body that governs territory in more than one town is one body with one identity, listed for readers in every town it covers.**

Lake Todd Village District governs land in both Bradford and Newbury. The New London–Springfield Water System Precinct serves both towns in its name. Because a body's identity was built out of the single town it was filed under, each of these shipped as two separate entries with the same name — one body wearing two identities. Every count that walked the list counted them twice.

Filing each under one town only would have been worse: it hides a real body from readers in the other town, who are governed by it just the same.

**Sean ruled one body, one identity, rendered under both.** This is the first pair of many rather than a curiosity — village districts, precincts, fire districts and regional school committees routinely cross town lines, and a product that reaches the smallest bodies will meet this constantly.

---

### RULING 122 — a page on a party's own site can be a candidate's page, with the host named

*Adopted 2026-08-24 (Sean's decision of that day, closing `NH11`). Law: `CLAUDE.md`, **Non-negotiables in code**. Supersedes nothing. It extends the rule that a campaign living on Facebook still has a campaign site.*

**Where a candidate's only public presence is a page on their party's own website that carries their name, the office, their own words and a way to contact them, it renders as their page — and the host is named.**

A candidate for Governor had no campaign website and no campaign social page. What he had was a page on a party's site with his name, the office he is seeking, a sentence in his own words and an email address. Recording that as "no campaign presence found" would hide a real, findable thing from a reader — and it would do it to the candidate with the fewest resources, which is precisely the imbalance the equal-effort rule exists to catch.

**The host is labelled, and that is what keeps this safe.** This product never characterises an organisation's politics. Presenting a party's website as though it were the candidate's own would blur exactly that line. Saying *the page his party publishes about him* names the source plainly and lets the reader judge it — which is what this product does with every other source.

---

### RULING 123 — the author's decisions of 2026-08-24, recorded as a batch

*Adopted 2026-08-24 (Sean's decisions of that day, given in the session brief and in a mid-session correction). Law: none of it — these are decisions, not rules, which is exactly what this file is for. Supersedes nothing.*

**Not every decision is a rule.** Most of what an author decides is a call about one thing on one day: this photograph ships, that one does not, this gate is the right shape, that document is the copy to use. Those decisions bind just as firmly as a rule does and they belong written down, because a decision that lives only in a chat window is one nobody can check later — which is the whole reason this file exists.

This entry records the ones Sean made on 2026-08-24 that are not rules. The five that ARE rules became RULINGS 117 through 122 and have their own entries.

**The photographs — all approved.**

- **The seven Morris County commissioner portraits.** All seven from the county's own site, all seven read as images. Six shipped; the seventh was already shipping.
- **The five New Jersey municipal portraits** — Rowland, Senatore, Mabey, Althoff, Muilenburg — each from the municipality's own website. Two carried stated reservations and he approved them with the reservations in view: Senatore's attribution is by POSITION on the page rather than by filename, and Mabey's is full-length rather than head-and-shoulders.
- **The three New Hampshire county portraits** — Hagaman, Raiche, Ribas.
- **The two campaign portraits at 07866** — Leguía and Hathaway. Hathaway's was put to him as a three-quarter-length shot rather than a portrait, stated as a reservation, and he took it.
- **The forty-eight that were already shipping**, approved EN BLOC. In his words: he checked a few, and if one has issues later he will call it out specifically; otherwise good to go. They had been recorded as "grandfathered", which meant shipping before the rule existed and approved by nobody. They are his now. **The record says en bloc rather than per asset**, because that is what happened, and writing it the other way would claim he read forty-eight images one at a time.

**Tobin Menard stays initials.** His campaign publishes exactly one picture of him and it carries the words "Accountability Responsibility" printed across it. His words: *no campaign slogans or anything like that.* The refusal is affirmed. He renders honest initials, which this product treats as a success, and the hunt for a clean portrait of him continues.

**The other decisions of the day.**

- **The meetings refresh gates per source, not per run** — one broken source may not throw away the work of the healthy ones. His condition: the broken source carries forward and is loudly identified for fixing.
- **The demo-deletion promise is built**, with the wall coming down as the trigger: rows collected during the password-walled test period delete when the wall lifts, and the deletion is logged.
- **The session map, the intent document and the rebuilt tracker sections are confirmed** — the committed copies are the ones to use.
- **The candidate questionnaire is on HOLD.** He reviews the instrument and the invitation before anything sends. Nothing has been sent to anybody.
- **The agenda-platform crawler is re-scoped rather than shelved**: it starts after the pilot zips are done rather than after the election, and its open design questions come to him before the first fetch.
- **The Census API key was activated**, mid-session. It had been refused by the host as invalid; it now answers with real data.

*Why one entry rather than a dozen.* These were given together, on one day, in one brief. Splitting them into separate numbered rulings would suggest each was reasoned about separately and would make the record longer without making it truer.

### RULING 124 — a commit that cannot change what a reader sees does not cost a deploy

*Adopted 2026-08-24 (Sean's instruction of that day, escalated twice: deploys are burning credits, cut them to the floor). Law: `CLAUDE.md`, **Stack**. Amends RULING 78, which set every scheduled refresh to once daily; the ORCHESTRATOR now runs once daily and each SOURCE runs at the rate its own data moves.*

**Six production deploys landed before 5 AM on 2026-08-24. Three of them rebuilt and redeployed a byte-identical application in order to serve paperwork.**

Reading the commits rather than counting them is what makes the finding obvious. `cdb5ce2` moved the meetings snapshot and `ccda6ea` moved the FEC snapshot — both are data a reader sees, and both deserved their build. `ba0947c` moved an intake report. `2a7e825` and `ae5b178` moved `docs/context.md` and `docs/state.md`. Nothing a reader can reach changed in any of those three, and each cost a full Next build and a deploy.

And that is only the visible half. Deploy previews are Netlify's default, so **every push to every session branch has been building too** — invisible in the production deploy list, and never looked at by anybody. The overnight session of 2026-08-24 alone pushed 15 branch commits.

**Five changes, and the last one closes the class:**

1. **Previews and branch deploys do not build.** The preview context was already closed in g17; the branch context was not, which left the same duplicate build running under a different name. Both are closed in `netlify.toml` now. `.github/workflows/build-check.yml` already runs the literal build command on every pull request, with a log readable without a Netlify login — which is the check the preview was standing in for.
2. **A path-keyed deploy filter.** `scripts/netlify-ignore.mjs` cancels a production build when every changed path is one that cannot change what a reader sees. The allowlist is `lib/ops/deploy-paths.ts`, with a stated reason per entry.
3. **One daily orchestrated refresh.** Five workflows on five crons committing five times becomes `refresh-daily.yml`: one run, per-source isolation, one gate, and **one commit however many sources moved**. A quiet day commits nothing at all — not a ceremonial "refreshed, no changes" commit, which is what was quietly being spent.
4. **Cadence matched to each source's real rate of change**, each with its reason stated on the entry: meetings and the NJ clerk filing daily through the election, FEC and LegiScan weekly, the federal `.gov` register monthly. Refreshing a barely-moving federal register every day burns a build to learn nothing.
5. **The close-out tool refuses a separate push to `main`.** Records ship inside the pull request. `scripts/close-out.mjs` had been made SAFE — it gates the build — and was still costing a full production deploy to serve a paperwork diff.

**THE ALLOWLIST DIRECTION IS THE RULE, and it keeps the cheap failure the only one available.** A path is paperwork only if it matches a named prefix. Everything else — every directory added tomorrow, every path this list has never heard of — is shipping, and builds. An unknown directory wrongly built costs one wasted build. An unknown directory wrongly classified as paperwork serves stale data to readers with nothing going red. Those are not comparable.

**`scripts/` is deliberately SHIPPING**, and it is the entry most likely to look like a mistake. Nothing under it reaches a reader — but `pnpm build` type-checks everything `tsconfig.json` includes, `scripts/` included, and RULING 76 exists because a session script broke the build. Cancelling that build would move the failure onto whichever unrelated commit built next.

**Every failure path builds.** No cached ref, a shallow clone, a git failure, the predicate failing to load — every one of them lets the build run and says why. RULING 24: a check that cannot reach its subject must never print like a passing one.

**The claim is measured rather than asserted.** `tests/deploy-paths.test.ts` reads the built `.nft.json` trace manifests — Next's own statement of which repo files each server bundle actually needs — and fails if any file under a non-shipping prefix appears in one. Re-deriving the classification from the list it was written from would prove only that the code is deterministic, which is RULING 114's lesson exactly. Measured on adoption: **31 trace manifests, 233 traced repo files, 0 under any non-shipping prefix.**

**And the cadence is calendar-driven on purpose.** The obvious implementation asks when an artifact last changed, with `git log -1 -- <path>`. That is wrong on CI and it fails silently: in a shallow clone, per-file `git log` returns the tip date for every file with no error, so a weekly source would read as refreshed-today every day forever.

---

### RULING 125 — verification happens on the local production build; production is the delivery truck, not the test bench

*Adopted 2026-08-24 (Sean's ruling of that day). Law: `CLAUDE.md`, **Non-negotiables in code**. It is RULING 77 — verify locally, ship once — carried to its conclusion: that ruling said WHEN to verify, and this says WHERE.*

**Every walk, every screenshot and every card check runs against a local production build. `walk:all` loses its production mode entirely.**

RULING 77 already established that almost nothing needs production, because a local production build is the same bytes. What it left standing was the habit: `walk:all` still defaulted to `https://sparkwtp.netlify.app`, and every session ended by walking the live site.

**The cost was never the traffic.** Every `/api/meetings` GET writes a row to the search log, and **the search log is a store this product sells.** A four-zip walk writes dozens; **11,755 synthetic rows** had accumulated in the production store by 2026-08-24. They are excluded from every aggregate by the `T10` machinery and that machinery works — but *organic by construction* is a stronger claim than *organic after filtering*, it is the claim the transparency page implies, and it costs nothing to have.

**The one remaining production fact is which SHA is live**, and it is read from **Netlify's deploy record via the API — one call, zero requests to the site.** Asking `/api/build` answers the same question while writing reader-indistinguishable traffic into a sold store, which is the thing this ruling exists to stop.

**And it is compared against the last DEPLOY-ELIGIBLE commit, never the tip of `main`.** Under RULING 124 a docs-only commit correctly never builds, so `main`'s tip is routinely a commit Netlify was right to ignore. A check comparing against the tip would report "production is behind" every time a close-out lands, forever — and an alarm that is wrong on every quiet day is an alarm nobody reads (RULING 115). `pnpm deploy:live` walks back to the newest commit the filter would have built, and compares that one.

**Four verdicts, and `cannot-tell` exits non-zero.** No Netlify credential is not a pass.

---

### RULING 126 — campaign-finance data renders for readers and never enters anything sold

*Adopted 2026-08-24 (Sean's ruling of that day). Law: `CLAUDE.md`, **The collection stores never join**. It EXTENDS the existing FEC posture to every source; it narrows nothing.*

**Campaign-finance data, from any source — the FEC, a state agency, a county clerk, or anything else — renders for readers and never enters an export, an aggregate, or anything sold. There is no source of campaign-finance data to which this does not apply.**

Two separate reasons, and either alone would be enough.

**The legal one.** Federal law restricts the commercial use of FEC contributor information — 52 U.S.C. § 30111(a)(4), which is the open question `ripcord.fecContributorDisplay` has been held against since 2026-08-13. **Several states restrict theirs analogously**, and a product about to ingest New Jersey's, New Hampshire's and Arizona's filings would otherwise acquire that question three more times without noticing.

**The product one, which binds even where the law does not.** What this product licenses is **reader-attention signal** — anonymous reactions, opinions about displays. That is the ruling the author already made on 2026-08-15 for `ripcord.fundingReactionsInAggregates`, and it generalises exactly: a buyer receives opinions, never records. Campaign-finance data is a public record we retrieved and republished; reselling it is a different business from the one described on the transparency page.

**So the firewall is ARCHITECTURE, not policy.** A rule that lives only in a document is a rule the next join breaks by accident. Campaign-finance rows live in the reader-content stores, and the n-stores-never-join discipline is asserted against them by a test that fails if a joinable column ever appears — the same instrument `tests/db-schema.test.ts` already points at the search log, the reactions store and the intake limiter.

*Sean's decision of 2026-08-24 also settled the other half of this — that the data is COLLECTED AND RENDERED NOW, with election counsel reviewing afterwards, riding with `B05`. That supersedes the older render-after-review posture for STATE data. It changes nothing about this firewall, which is the condition the collection proceeds under rather than a question deferred alongside it.*

---

### RULING 127 — no tool prints a credential value, and the guard is the values themselves

*Adopted 2026-08-24 (Sean's instruction of that day, item 3). Law: `CLAUDE.md`, **External sources**. Supersedes nothing.*

**A credential value never reaches a transcript, a log, a report or a committed file. The check is not a pattern that looks credential-shaped — it is the actual values in `.env.local`.**

The Census API key was printed in plaintext into a session transcript. That transcript mirrors to Drive, and an external audit tool can read it. The key was rotated.

**The instance is not the finding.** A pattern-based scan for credential-shaped strings is the RULING 110 failure waiting to happen: it searches for the FORM a secret takes rather than for the secret, and every secret that does not match the pattern passes. The only sweep that cannot be wrong about this reads the values themselves and looks for those.

- **Nothing a tool prints may contain a value from `.env.local`.** Not a script's output, not an error message that helpfully echoes its input, not a URL carrying the key in a query string — which is how this one escaped, since several of these APIs take the key as a parameter.
- **The redaction layer is applied at the point of output**, so a value cannot leak through a code path nobody thought to check.
- **The sweep covers the repo AND the Drive-mirrored artifacts**, because RULING 108 established that the mirror is a place things land, and this is the same surface pointed the other way: what a session writes there leaves the machine.
- **A rotated key is proven dead, and the new one proven live**, by calling both. RULING 95's bar applies to the corpse as much as to the replacement: a host that answers a rejected key with HTTP 200 and an HTML error page will report a dead credential as healthy.

---

---

## THE EIGHT RULINGS OF 2026-08-24 — THE AUDIT REMEDIATION

*Adopted 2026-08-24, the audit-remediation session, item 9. Two external audits
of `ae5b178` (code head `336a3eb`) — one for correctness, one for performance —
returned eight findings, two systemic patterns and six performance items. Every
finding was REASONED rather than reproduced, because the auditor could not run
code; the session's law was that no fix ships without its finding first
reproduced as a failing test.*

*Each ruling below cites the finding it answers. Numbering continues from
**RULING 127**, the highest in use.*

---

### RULING 128 — extraction conserves: every input has exactly one disposition, and the sum is exact

*Adopted 2026-08-24. Answers **A-002** and **S-001**. Law: `CLAUDE.md`, the
zero-row-extraction rule and RULING 100. It EXTENDS both; it narrows nothing.*

**A pass that produced some rows must account for all of them. `produced +
dropped + outOfWindow + duplicates === logicalInput`, exactly.**

The shipped contract asked a boolean — *was anything dropped?* — and a boolean
cannot tell one drop from ninety-nine. Reproduced before it was touched: 100
logical inputs, 0 output and `{malformed: 1}` was branded as a clean,
fully-accounted result. **One recorded drop laundered ninety-nine
disappearances.**

That was the right question for RULING 43, which is about a pass that produced
NOTHING. It is silent about a pass that produced SOME, which is exactly RULING
100's partial: *a total that reconciles is not a total that is correct.*

- **The unit is the LOGICAL RECORD, never the document.** One `.ics` file is one
  raw row and, at Newbury, 1,157 events. The old module doc used that fact to
  argue against counting at all; the answer to "documents and events are
  different units" is to count in the unit the disposition happens in.
- **A pass that cannot count records `COULD_NOT_ASSERT`** — a named, reported
  state, never a silent pass. `clerksboards` is the honest case: where the Clerk
  writes *meets as required*, one counted drop stands in for an unknowable
  number of sittings, and no true number exists.
- **A duplicate is a disposition.** It used to be a bare `continue` leaving no
  trace, which is also where **A-005**'s collisions vanished.

Measured on adoption: 13 of 13 call sites declare a count, 12 adapters' committed
fixtures re-run under the shared contract, 0 newly failing. Both copies of the
`droppedAny` predicate replaced by one implementation (RULING 103).

---

### RULING 129 — a safety cap is a failure boundary, never an implicit end of data

*Adopted 2026-08-24. Answers **A-006**. Law: `CLAUDE.md`, the operation-count
rule. Supersedes nothing.*

**Reaching a cap while the source still advertises more is a FAILURE. It throws,
naming what was fetched and what was left.**

Apptegy's walk stopped at twelve pages with the API still offering a next page:
**240 events read, an unknown number left on the server, no error, no partial
marker, no unretrieved count.** Reproduced against the shipped code.

The adapter's own comment already called the cap *a runaway stop, not a coverage
cap*. The code did not enforce the difference, and **a cap documented as
unreachable and silently reachable is worse than one nobody claimed anything
about.**

The sweep this required found the identical shape in `legistar`'s `pageById`,
behind an identical comment. Both are failure boundaries now. The cap itself
stays: a runaway stop is a real need, and what changed is what hitting it MEANS.

---

### RULING 130 — every transport success passes one shared document finalizer

*Adopted 2026-08-24. Answers **A-003**. Law: `CLAUDE.md`, the public-records
rule and RULING 43. Supersedes nothing.*

**A body becomes a return value in exactly one place, and every rung goes
through it.**

The 403 escalation had two return paths that never met `notADocument`: a rung-3
browser-header 200 was checked only for a known challenge page, and the rung-4
curl fallback was returned raw with neither check. **So document validity
depended on WHICH RUNG happened to succeed** — the same bytes refused on rung 2
and accepted on rung 3. Reproduced: an HTML 404 page returned as an `.ics` feed.

**And no test could reach either branch**, because the escalation is gated on
`!options.fetchImpl` — correctly, so a fake fetch is not routed around, but the
effect was a production path nothing could observe. That is the chromium-pin
shape. The ladder now takes a DECLARED seam so a test can drive it with its own
doubles, and production, which injects nothing, walks the real rungs.

---

### RULING 131 — a partial source is a first-class result, and completeness is never inferred from `ok: true`

*Adopted 2026-08-24. Answers **A-004** and **S-002**. Law: `CLAUDE.md`, the
refresh corollary. It EXTENDS it; it narrows nothing.*

**A result says which SCOPE failed, for which divisions, and why. Carry-forward
preserves that scope and no other.**

`ical` fetches two feeds per body. The past feed's failure was caught by an
EMPTY `catch` whose comment read: *this row still produces its upcoming
sittings, and the archive's absence is visible as a jurisdiction with no
concluded meetings.* **That sentence is the render-default failure written down
as a design note** — an outage rendering as a fact about the town.

The chain: archive refuses → adapter reports success → carry-forward preserves
rows only for a source or division that FAILED → every concluded meeting the
previous snapshot held is deleted.

Marking the whole division unreachable would be wrong the other way: the
upcoming feed answered, and carrying its rows forward would resurrect a sitting
the town had just cancelled. So an `ARCHIVE` failure carries back only sittings
that had already concluded — asserted in both directions.

---

### RULING 132 — the identity boundary is proven over VALUE SPACES, not column names

*Adopted 2026-08-24. Answers **A-001**. Law: `CLAUDE.md`, **The collection
stores never join**. It is that rule's enforcement, and it narrows nothing.*

**No reader collection store may hold a value that identifies a person
independently of us.**

`CLAUDE.md` states the claim without qualification: *no store carries a column
that could join to another.* The test that was supposed to assert it checked
column NAMES against a list of forbidden fragments. `feedback.reply_to` held a
raw email address, does not contain the letters `email`, and was waved through
as a carefully-written named exception. `questionnaire_invitations.email` holds
a raw email address too. **One value space, two tables, equality-joinable, and
a guard that could not see it** — RULING 110's wrong-form search, living inside
a test.

- **The classification is by DOMAIN**, in `lib/db/identity-domains.ts`: every
  column of every table, and a column missing from it fails the build.
- **The distinction that matters is world-value versus minted handle.** An email
  address is joinable using data nobody here controls — a mailing list, a voter
  file, a breach dump. A handle we minted is joinable only where we put it, and
  we can say exactly where that is.
- **A shared deterministic hash is the same join key relocated.** Two tables
  holding `sha256(address)` can still be matched. The contact handle is
  `randomUUID()`, never derived.

*The scope correction, recorded rather than smoothed.*
`questionnaire_invitations.email` is a candidate's address from the county
clerk's certified public filing, held to send one questionnaire. Nothing about
it is wrong. **The finding's force is the class**: the claim is absolute, and an
absolute claim is falsified by one counterexample however defensible the other
side of the join is.

---

### RULING 133 — a performance change ships with its measurement

*Adopted 2026-08-24. Answers **P-001**, **P-002**, **P-003** and **P-004**. Law:
`CLAUDE.md`, the two-numbers rule and RULING 113. Supersedes nothing.*

**Operation counts, bytes or timings, before and after, asserted by counters or
committed baselines. Never "looks the same".**

`lib/map/marker-pool.ts` had claimed since it was written that a filter
narrowing 500 pins to 480 does 20 DOM writes. Nothing measured it, and the
wiring above it made it false: the canvas was handed the FILTERED venues, so
twenty filtered-out venues arrived as twenty venues the data no longer had and
their markers were destroyed.

**Visual equivalence cannot tell a reused marker from a recreated one.** The map
looks identical either way, which is exactly why it lasted. A counter can, and
the tests assert counts.

- **A change is kept only if the rebuilt number actually FELL.** P-002's first
  attempt moved the landing bundle from 2,955,835 to 2,956,534 raw bytes — UP —
  because one static importer remained. A change kept because it sounded right
  is the thing this ruling forbids.
- **A speed change that alters an answer is a wrong answer that arrived
  faster.** P-003 dropped 67.6% of the resolver's geometry and cut exact polygon
  tests from 2,291 to 14 per lookup, and it shipped only because all **279 of
  279** supported zips resolve to an identical set of divisions.

---

### RULING 134 — an instrument without a committed baseline is unfinished

*Adopted 2026-08-24. Answers **P-005**. Law: `CLAUDE.md`, the ceiling rule.
Supersedes nothing.*

**It measures nothing until normal is recorded.**

`pnpm perf` measures first paint, LCP and frame timing on the machine's real
Chrome, and honestly refuses to call a software-rendered run a baseline. It has
existed since 2026-08-17 and `docs/perf-baseline.md` has never been committed —
a thermometer with no recorded normal temperature.

**And a dishonest baseline is worse than none.** Run on this machine against a
local production build, the harness reported *hardware acceleration OFF or
UNKNOWN* and returned `NaN` for every frame metric. That output was NOT
committed, which is the rule working: the row stays open with the measurement
attached rather than closing on a number that describes a rasterizer.

---

### RULING 135 — a fence bars acting on content, never committing Sean's artifacts

*Adopted 2026-08-24, the author's instruction. Law: `CLAUDE.md`, RULING 104.
It REFINES RULING 104; it narrows nothing.*

**A file the author places in the repo is registered into git UNREAD, and the
fence on its content stands in full force.**

RULING 104 says an artifact the author places in the repo is an input the
session must reach, and unreachable is a defect to report. A standing fence says
a session may not act on a visual batch's contents until the visual session owns
them. Read together they appeared to conflict, and the conflict blocked
`handoff --ship` for every session while the files sat untracked.

They do not conflict. **Committing is REGISTRATION, not action.** `git add` on a
capture the session never opens makes it reachable to the session that owns it
— which is precisely what RULING 104 asks for — and reads nothing.

*Recorded for the next session, because it is a fact about the repo rather than
about the rule:* on 2026-08-24 `docs/feedback/8.24/` existed and was **EMPTY**.
There were no captures to commit, git cannot track an empty directory, and the
first act of the session was therefore a no-op. Reported rather than smoothed.

---

## THE SIX RULINGS OF 2026-08-24 — SEAN'S VISUAL WALKTHROUGH

*Adopted 2026-08-24, from Sean's 8/24 walkthrough of the app and the sixteen
captures he recorded between 11:54 and 12:27. `CLAUDE.md` carries them as law.*

---

### RULING 136 — feedback names examples; a fix closes the class

*Adopted 2026-08-24, Sean's frame for the whole walkthrough, stated by him
three times across two walkthroughs before it was written down.*

**His words: "All of what I've provided are examples of recurring issues. These
are not the specific issues; these are examples of underlying issues."**

Every id in a feedback list names an INSTANCE. The defect is the CLASS. An item
is done when the class is closed everywhere it exists — every state, every zip,
every surface — and the named instance is only the verification case.

- **An item closed at the instance and open at the class is NOT DONE**, and may
  not be reported as done.
- **Every ending carries its denominator**: the class named, the surfaces and
  states it exists on, N of M closed, and the observed instance confirmed among
  them.

*The rationale stays attached, because a stripped rule reads as guidance.* The
named-instance rule already said a reported defect is the START of a sweep. What
it did not say is what a feedback ITEM is, and a feedback item looks like a
request to fix one thing. "The role text is cut off on Dr. Ravi Shah" reads as a
request about one card; it was 17 uncompensated letter-spaced runs across 11
files. Fixing the card would have been a truthful report of an untrue fix.

*What this cost before it was written down.* `LBL-2` closed on 2026-08-23 at
"6 found, 6 fixed", correctly, and Sean found the same defect on another card
the next day. The six were right. The CLASS was 23.

---

### RULING 137 — for layout, an annotated image is the spec, and it outranks prose

*Adopted 2026-08-24. It is the render-default rule's cousin: that one says a
capture is evidence only once read as an image, and this says a capture can be
a SPECIFICATION.*

**Where Sean annotates a capture — an arrow, a red box, a strikethrough — that
image IS the spec. It is built to directly, and it wins against any prose
describing it, including the brief's own.**

- **The two spec images are identified BY CONTENT before anything is built.** A
  file-to-issue mapping inferred from capture times is a guess, and on 2026-08-24
  it was wrong about both of them.
- **Where the image and the prose disagree, the image wins and the disagreement
  is REPORTED**, so Sean can overrule the reading rather than discover it.

*The rationale, and it is a measured failure rather than a preference.* The 8/22
prose said "left column, nested". The build was faithful to those words and the
result was wrong: the cards ended up INSIDE the sidebar instead of floating
beneath it, and the whole of `LAY-1` had to be deleted the following day. **Prose
lost information the image carries.** An arrow has a start and an end; "nested"
does not.

*Both halves were exercised on the day this was adopted.* The brief said to cut
a phrase from the jurisdiction note that turned out to be inside the paragraph
Sean had marked GOOD — his red box covered only the two paragraphs after it. The
image was followed and the difference was reported.

---

### RULING 138 — display consolidates sources; the record is never deleted

*Adopted 2026-08-24, from `SRC-1` through `SRC-4`. It narrows nothing in the
no-claim-without-a-source rule; it constrains how a fix to it may be built.*

**Every inline asterisk and per-item source annotation collapses to ONE line at
the bottom of the card. That is a change to what RENDERS, never to what is
HELD.**

- Single source: *These were sourced from [publisher].*
- More than one: *We sourced this information from these three sources,* then
  the list, still at the bottom.
- **Footnotes, source URLs and fetch dates are never deleted from the data**,
  and a test asserts the populated provenance fields are IDENTICAL before and
  after the consolidation runs.

*Why the test is not optional.* "Remove the source annotations" and "remove the
sources" are one careless edit apart, and only one of them is allowed. A session
that deleted the fields would satisfy every visual check — the cards would look
exactly as asked — and the product would have quietly stopped being able to say
where anything came from. Nothing else in the repo would have gone red.

*What this supersedes, and the cost is stated rather than hidden.* F01 3.2
collapsed repeated provenance to one note per distinct source with a footnote
MARKER on each row. That was a real improvement and the markers are now the
friction. On a card carrying two bodies at one building a reader can no longer
tell which row came from which — Tucson splits city and school meetings at one
address, so this is not hypothetical. It is Sean's call; what it buys is that
the other ninety-odd cards, which carry one source, stop printing punctuation
nobody reads.

---

### RULING 139 — the product never announces its own failure

*Adopted 2026-08-24, from `BAL-7`, made product-wide. It is the render-default
rule's other edge, and the two are easy to confuse.*

**"That is a gap on our side" and every variant comes out, everywhere. State
what is known, offer the narrowing, move on.**

**THE ATTRIBUTION IS NOT WHAT THIS TOUCHES, and the distinction is the whole
rule.** The render-default rule requires a reader be able to tell OUR gap from
THEIR absence, and it says in as many words that what it protects is the
ATTRIBUTION rather than any particular sentence. *We haven't recorded this
chamber's vote on this yet* is REQUIRED. *That is a gap on our side, not a
finding about those districts* is attribution PLUS a verdict on ourselves, and
only the second half is struck.

- **The sweep is by SHAPE, never by string** (RULING 110), and it lives on the
  existing refusal-shapes instrument rather than in a second one.
- **The honest attributions are planted in the test alongside the defects**, so
  the family can never become pressure to delete the render-default rule.
- **The report states N found and N cut.**

*Measured on adoption: four instances shipped, four cut* — two Sean red-boxed
himself, plus one in the map entry and one in the voting-sites panel that the
widened sweep found. One of the three new patterns could not match anything at
all until a planted instance caught it.

---

### RULING 140 — dates spell out, product-wide

*Adopted 2026-08-24, from `BC-12` and `BAL-4`. Supersedes the mm/dd/yyyy
convention of `3h` (2026-08-16).*

**Sean's words: "in seat until January 3rd, 2029," never "01-03-2029." Full
month name, ordinal day, four-digit year, everywhere a reader sees a date.**

**ONE formatter.** RULING 103 applies with force here, because this defect had
three implementations under three names and none of them called each other:

1. `formatDateMDY`, which rendered the ballot page and the whole funding surface;
2. `inSeatUntil`, which built `${m}/${d}/${y}` by hand off its own regex — and
   is the LITERAL instance Sean quoted, so fixing only the first would have left
   his example on screen;
3. the picks card, which spelled the month already and stopped there —
   "August 24, 2026" against "August 24th, 2026", close enough to look right and
   different enough to be a separate convention.

*A calendar date is read from the string and never round-tripped through a
`Date`.* `new Date("2026-11-03")` <!-- expected-future: the 2026 general election, quoted as a code example --> is midnight UTC, and formatting that in
America/Phoenix returns November 2nd — an election date off by one day, which in
this product is a false claim about a government.

---

### RULING 141 — the Speak Your Mind store's four rules

*Adopted 2026-08-24, Sean's ruling on `BC-11`. All four are constitutional and
none is optional.*

**Speak Your Mind is the collection point for verbatim constituent sentiment —
product infrastructure, not a comment box.** The framing is what you would say
if this person were standing in front of you.

1. **DISTRICT-STAMPED, JOINED TO NOTHING.** The subject's public id, the
   reader's zip-resolved district, a timestamp, the text, and a hashed
   browser-minted continuity key. No email, no account reference, no address,
   no new join path to any other store. **The continuity key is digested under
   its own prefix**: three stores hash the same kind of key, and without
   distinct prefixes they would be equality-joinable on a value nobody had to
   look up.
2. **HONEST DISCLOSURE AT THE BOX.** One line, plain language, before the reader
   types: what is written may be shared — without a name, because we do not hold
   one — with campaigns, organizations and researchers. **"May", never "will."**
   The reason there is no name is inside the sentence, because *anonymously* is
   a promise a reader takes on trust and *we do not hold one* is a fact they can
   check. The honest version is the credible version.
3. **PII SELF-DISCLOSURE IS REDACTED AND FLAGGED, AND A FLAGGED ROW NEVER
   EXPORTS VERBATIM.** People type their own names, emails, phones and addresses
   into boxes like this. The pass and the flag exist BEFORE any export path
   does — the store is born safe, not retrofitted. **It detects the act of
   introducing yourself rather than trying to recognise names**, because any
   list of names is incomplete and a list built from our own officials would
   flag the very sentiment this box collects.
4. **ABUSE TRIAGE, NOT FORWARDING.** Nothing typed here is ever auto-forwarded
   to anyone. Severe content goes to a HELD queue for Sean's review, in the
   tiers `docs/abuse-policy.md` already defines. **Harsh political speech is
   never held** — over-filtering degrades the product to guard against a rare
   case, and a box that promises you can say what you would say to their face
   and then swallows it would be worse than not asking. The intake limiter's
   attestation applies to submissions.

**Not rendered publicly.** Collected, never displayed — the same reasoning that
keeps reaction aggregates off every card, because showing them anchors later
respondents and corrupts what is being sold. **The default is REVERSIBLE and is
Sean's call.**

---

### RULING 142 — the line in the sand, and nothing collected before it is ever sold

*Adopted 2026-08-24, Sean's ruling. His words are the ruling and are recorded
verbatim, because a paraphrase of a promise is a different promise.*

> **"I will draw a line in the sand once people outside of testing are actually
> using it. We have not crossed that line yet."**

**Nothing collected before that line — organic-looking or not — is ever sold, or
shown to anyone as signal.** Not the reactions, not the search log, not a
sample, not an aggregate, not a chart in a buyer deck, not a screenshot in a
pitch. **The sellable clock starts at zero on the day the password wall comes
down.**

*The rationale stays attached, because a stripped rule reads as guidance.* Every
row in those two stores today was made by Sean, by a tester he asked, or by this
project's own instruments. Some of them look exactly like reader rows, because
they were produced by walking the product the way a reader would. **That is the
problem, and it is not solvable by filtering.** A filter that separates them
depends on a session having correctly declared every synthetic run, forever, in
every path — and the measured history says otherwise: 11,755 synthetic
search-log rows accumulated against 260 organic before RULING 125 sent
verification to the local build. *Organic after filtering* is a weaker claim than
*organic by construction*, and only one of them survives being asked about.

**The mechanism is `T10`, not a filter somebody remembers.** `lib/ops/demo-window.ts`
holds the wall-down trigger and `pnpm demo:sweep` fires it; **`WALL_DOWN` is set
by the change that takes the wall down and by nothing else** — never inferred
from a deploy, a config read or a probe. A promise kept by memory is a promise
broken, which is the sentence T10 was opened over.

**What this ruling changes about that mechanism, and it is a real change.** T10
was built to delete a *window* — from `WALL_UP` to `WALL_DOWN` — and refused to
run at all while `WALL_UP` was unset, on the correct reasoning that deleting from
the beginning of time would take real reader rows with it. **Under this ruling
there are no real reader rows before the line**, by definition, so the lower
bound is not unknown: it is the beginning. The refusal is therefore lifted for
that one case and kept for every other, and `demoSweepVerdict` says which of the
two it is on the verdict itself.

**No date is written here.** The line has not been drawn, `WALL_DOWN` is `null`,
and a plausible date in this module would decide an irreversible deletion on a
fabricated number.

---

### RULING 143 — what DONE means for 07866, and it is per candidate

*Adopted 2026-08-24, Sean's ruling, recorded so the finish line is a measurement
rather than a feeling.*

**Every candidate on the 07866 ballot either meets the Kelly standard in full —
a photo, a phone, a working contact, a specific verified page, and a campaign
site — or carries an ARGUED ABSENCE: a five-move stuck protocol under RULING 94
with its literal queries recorded, and an expiry date under RULING 53. Nothing
in between counts, and there is no partial credit.**

- **A candidate with four of the five Kelly fields and no protocol on the fifth
  is NOT done.** The field is still owed.
- **An absence with no stuck-protocol block is VOID** and the field returns to
  owed — RULING 94, unchanged and restated here because this is the place a
  session will be tempted to round up.
- **An absence expires.** Candidate fields carry a 7-day clock (RULING 53), so a
  protocol walked tonight is owed again next week. **Done is not a permanent
  state**, and a report that says otherwise is describing a measurement as a
  conclusion.
- **The distance remaining is reported as a NUMBER against 272, every session**,
  and it is the number that decides when Arizona starts. The zip order is law:
  NH `03255`, then NJ `07866`, then AZ `85641`, then AZ `85701`.

*The rationale stays attached.* "Depth" has no finish line and a session can
always report progress against it, honestly, forever. Many small-race candidates
genuinely have no campaign site, and the honest end state for them is an argued
absence rather than a blank — **which means the finish line cannot be "everybody
has five fields", because that line is unreachable and would make the zip
permanently unfinished.** It also cannot be "we hunted hard", because that is a
fact about the session rather than about the ballot. Kelly-or-argued is the only
version that is both reachable and checkable, and it is checkable per candidate
rather than in aggregate — which is what stops a well-covered contest carrying a
thin one across the line.

---

### RULING 144 — an argued absence may be built from walls, and it expires the day a wall falls

*Adopted 2026-08-25, Sean's ruling, the final pass. It is the operational half
**RULING 94** was missing, and it narrows neither RULING 94 nor RULING 61.*

**A five-move stuck protocol whose moves were REFUSED still earns an absence.
Each wall is recorded as a walked move carrying its rung history and the date it
was tested, alongside the moves that answered. The absence expires on its normal
RULING 53 window, or EARLY — the day any wall inside it falls — whichever comes
first.**

*The rationale stays attached, because a stripped rule reads as guidance, and
here the rationale is a measurement rather than an argument.*

The NJ depth session of 2026-08-24 earned **zero** argued absences. Not because
it did not walk the protocol — it walked it — but because the general search
indexes are closed to this project, and a move that returns HTTP 403 is not a
move that returned nothing. Read strictly, that meant **no absence could ever be
earned while any wall stood**, and a field with no route left would sit owed
forever, re-hunted nightly against the same refusal, reported as still-owed in
perpetuity.

**That is dishonest in the other direction, and it is the direction nobody
watches.** This project's whole discipline points at one failure — asserting an
absence that was never earned — and the mirror of it is asserting that a field
is still reachable when every route to it has been tested and refused. A
permanent "still owed" is a claim too: it says *we believe this exists and we
will find it*, and after the tenth identical refusal that sentence is no longer
supported by anything.

- **The protocol still runs in FULL.** All five moves, every literal query or URL
  recorded. A wall is a recorded move, never a skipped one, and a protocol with
  four moves walked and one omitted is still void.
- **Each wall names what it is a wall AROUND** — RULING 90 item 4, unchanged. *A
  search engine refused after six queries* is one road closed; it is not a fact
  about a candidate.
- **The absence carries BOTH clocks and expires on the earlier.** The RULING 53
  window is the ceiling. The floor is any wall in the record falling, which is
  checked by the same re-walk that already runs on cadence — so an absence built
  on a closed door becomes owed again the moment the door opens, automatically,
  without anyone having to remember which absences were built on which walls.
- **An absence built ENTIRELY of walls is recorded as such and says so.** It is
  the weakest kind and it must be legible as the weakest kind. `VERIFIED_ABSENT`
  is still RULING 61's bar and is not reached this way; what this earns is a
  dated, argued, expiring absence — which is what RULING 143 asks for and is a
  different thing.

*What this does NOT license.* It is not permission to declare a wall and stop.
The tree of RULING 52 is unchanged: a branch refusing is one measurement on one
date, and the response to a refusal is another branch. This governs only what
happens when every named branch has been tried and the record is honest about
which of them answered and which slammed.

---

### RULING 145 — a platform-hosted campaign presence fills the campaign-site field, with the host labelled

*Adopted 2026-08-25, Sean's ruling, the final pass. A direct extension of
**RULING 122** — a party-hosted candidate page is the candidate's page with the
host named — to the platform a campaign actually lives on. It supersedes
nothing, and the campaign-that-lives-on-Facebook rule in `CLAUDE.md` is its
parent rather than its rival.*

**An official campaign presence on a platform — a Facebook page or its
equivalent — FILLS the campaign-site field when it is reached by a compliant
route, and it renders with its host labelled plainly.**

*The rationale stays attached.* Small-race candidates overwhelmingly live on
platforms rather than on domains. A domain costs money and a page costs nothing,
so a rule that recognises only domains does not measure campaign presence — it
measures campaign budget, and it records the least-resourced candidate in every
contest as having no presence at all. That is the information asymmetry the
equal-effort rule exists to catch, committed by the field definition itself.

- **The verification bar does not move.** The presence must be the candidate's
  OWN, established by name–office–cycle agreement and control-checked. A page
  found by guessing a handle is a `LEAD`, never a `HIT`, and a guessed
  identifier has never been anything else here.
- **Compliant routes only.** The Meta Ad Library API, archived captures,
  cross-posted mirrors, local-news embeds, and the campaign's own filed
  materials. The two standing prohibitions are untouched.
- **The host is named, never dressed as a website.** *The campaign's Facebook
  page*, in those words. A reader is told exactly what they are being sent to
  and left to judge it, which is what this product does with every other source.
- **It NEVER supplies a photo.** Social-media images are prohibited at every
  door of the photo rule, and a door the campaign-site rule opens is not a door
  into the photo rule. This is the one clause most likely to be lost, because
  the page has a picture on it and the field beside it is empty.
- **It supplies no prose** beyond the labelled self-description the blurb rule
  already governs.

---

## The six rulings of 2026-08-25 — the one-session brief

*Five were written BEFORE the work they govern, which is the point of them: a
rule adopted after a session is a rule that describes what the session already
did. The sixth records Sean's tracker decisions of the same day as a batch, the
way RULING 123 recorded his decisions of 2026-08-24.*

### RULING 146 — a session runs unattended, and nothing it runs may be able to ask it a question

(Adopted 2026-08-25, Sean's standing instruction, made law for every future
session rather than repeated in every brief.)

**Nobody is watching. A question asked is hours lost.**

- A decision that is genuinely Sean's becomes a **Needs Sean row** and the
  session keeps going. It never waits and it never ends its turn to ask.
- **No command may be capable of prompting.** Non-interactive flags everywhere,
  `GIT_TERMINAL_PROMPT=0`, `GH_PROMPT=disabled`, stdin closed, every
  long-running command inside a timeout. Five silent minutes is a kill, a row,
  and carry on.
- **Ambiguity resolves against the repo.** The repo is the thing that can be
  checked; a brief is a description of it written earlier.
- **"Ran out of room" is not a blocker.** Neither is a wall, a refusal, or a
  missing input — each is a finding with a row.

*Why this is law and not a header.* It has been the top of every brief for days
and it is a fact about how this project runs, not about one night's work. A rule
that has to be restated every time is a rule that will eventually be left out of
a brief, and the session that reads that brief will stop and wait.

### RULING 147 — no reconciliation may compare a parser to itself

(Adopted 2026-08-25. It is RULING 114's reasoning — *re-deriving a stamp from
the field it was stamped from proves only that the code is deterministic* —
made general and pointed at every check in the repo.)

**Every reconciliation names its EXTERNAL ANCHOR: an authority we did not
write. A check with no external side is decoration, and is deleted or rebuilt.**

*The rationale stays attached, because a stripped rule reads as guidance.* The
MAYOR defect shipped **nine invisible contests and seven fabricated
candidates** while `pnpm nj:filing:check` reported AGREES on 272 against 272.
Both of those numbers came from our own parser reading the same document. The
check was not lying and it was not broken; it was asking whether a thing equals
itself, which it always does.

- **The anchor is named on the check**, in words, so a reader can see what the
  other side is without reading the code.
- **A count published BY the authority is an anchor. A count we derived from
  the authority's document is not.**
- **Where no external anchor exists, the check says so** and reports
  `COULD_NOT_ANCHOR` rather than `AGREES`. Two names for two different states,
  because a check that cannot reach an authority must never print like one that
  did (RULING 24).

### RULING 148 — the may-we-walk verdict is enforced by the fetcher, never remembered by a session

(Adopted 2026-08-25. It is the enforcement half of the permission rule the way
RULING 107 was the enforcement half of RULING 96.)

**The shared fetcher REFUSES any host whose recorded verdict is `no` or
`unknown`. Permission is asked before the first byte, by the code, not by a
person remembering to look.**

*The rationale.* On 2026-08-25 two search engines went into a pool on the
strength of the right two questions asked in the wrong order — *does it answer*
and *does it pass a control query*. Both do. Both also carry `Disallow: /search`,
which is the exact path a query goes to, and `docs/sources.md` had recorded that,
dated, in a column headed *may we walk it*, with the answer **no**. The register
was correct, the tracker row was correct, and the session opened the register and
read the sections it expected to need rather than the one about the thing it was
about to do. The run was stopped at 125 of 276 and its output discarded.

- **`unknown` refuses.** A host nobody has ruled on is not a host we may walk;
  that direction costs a lookup, and the other direction costs an apology.
- **A DISALLOW is not a WALL.** A wall is a host refusing us and RULING 53 sends
  a session back to re-walk it on a clock. A disallow is a host telling us not
  to ask, and re-walking it on a clock is asking again after being told no.
- **Proved with a planted forbidden host**, so the refusal is demonstrated
  rather than asserted.

### RULING 149 — the coverage matrix is generated, internal, and never rendered to a reader

(Adopted 2026-08-25, with the instrument it governs.)

**`docs/coverage-matrix.csv` is written by `pnpm matrix`, regenerated every
session, never hand-edited (RULING 92), and never rendered to a reader in any
form.**

*Why the last clause is constitutional rather than a preference.* The matrix is
a grid of every candidate against every fact, with a state and a provenance in
every cell. Put in front of a reader it is a **completeness score per
candidate**, sorted — which is the composite match score this product does not
compute, the per-card completeness marker RULING 42 deleted, and the equal-effort
failure all at once. It is exactly as useful internally as it is forbidden
externally.

**It reads the stores and adds nothing to them.** The collection minimum is
untouched: a measuring instrument that had to collect something in order to
measure would have changed the thing it measures.

### RULING 150 — a Needs Sean row states its ask as an answerable question, with options

(Adopted 2026-08-25.)

**A row in that section ends with a QUESTION Sean can answer, and the options he
is choosing between. A row that cannot state one is misfiled and is rerouted to
the section that owns the work.**

*The rationale.* Needs Sean is the only channel that reaches a person, and it
stood at 48 open. A row that describes a situation without asking anything
cannot be closed by him — there is nothing to say — so it sits there forever,
and every row like it makes the queue less likely to be read at all. That is the
accumulation RULING 79 was adopted over, arriving through a different door.

- **Not every long row is misfiled.** A row asking a genuine judgement call is
  correct however long it is; what is misfiled is a row asking nobody anything.
- **A rerouted row is never reworded** (RULING 41) and is never closed by the
  reroute. It moves to the section that owns the work and stays open there.

### RULING 151 — Sean's tracker decisions of 2026-08-25, recorded as a batch

(Adopted 2026-08-25, Sean's instruction. Recorded the way RULING 123 recorded
his decisions of 2026-08-24, so that a close has an authority which exists.)

- **`NS11`, `NH142` and `NH169` are CLOSED on the rotation proof.** All nine
  leaked credentials were rotated; `pnpm rotation:prove` called every old value
  it could recover from the transcripts and returned **18 old values proven
  dead, 0 still live**; `pnpm credentials` returned **15 of 15 proven**; and
  `pnpm secrets:sweep` returned **0 secret occurrences across 2,813 files read**
  across the repository and the Drive mirror.
- **`B05` (find counsel) drops to P3 and is Sean-owned.** Its dependents are
  noted as parked rather than closed.
- **`T05` and `NH108` are annotated and LEFT OPEN.** The date he gave them is
  2026-08-28. <!-- expected-future: 2026-08-28, the date Sean set for T05 and NH108 -->
- **`JOB03` is REROUTED out of Needs Sean to the section that owns the work.**
  It asked nobody anything — it recorded that a job broke and that nobody found
  out why, which is work rather than a judgement call. It is RULING 150's first
  application, and it was diagnosed the same day it moved.

### RULING 152 — a reader-facing DONE names the production deploy that is serving it

(Adopted 2026-08-25, earned by the reconciliation of Item 6. It is the
merge-cadence rule's missing receipt.)

**A session may not report a reader-facing item DONE without naming the
production deploy that carries it and the state that deploy reached.** Not the
merge, not the commit — the DEPLOY.

- **The deploy id, its state, and the SHA it built.** Read from Netlify's deploy
  API, which is one call and zero requests to the site (RULING 125).
- **A deploy that never reached `ready` has not shipped anything**, however
  green the merge was.
- **Where the deploy record cannot be read, the item reports `COULD_NOT_TELL`**
  and never DONE. RULING 24, applied to the last step.

*The rationale stays attached, because a stripped rule reads as guidance.* The
reconciliation of 2026-08-25 tested six DONEs against what production was
actually serving during Sean's walk, and found **every claimed fix genuinely
live** — so this rule is not written because a deploy ate one. It is written
because ANSWERING the question took an afternoon and a Netlify token that was
not there a day earlier, and because the same read turned up four production
deploys in two days that reached `error` and were never published — `3449ef8`,
`41113c1`, `55d3047` and `e0f6426`. Three were real code merges. Each was
covered by a later merge so nothing was permanently lost, and **between the
merge and that later deploy production served older code while nothing in this
repo said so.** A receipt costs one API call and removes the question
permanently.

### RULING 153 — a fix is verified on the reader's path, not on the path that satisfies the assertion

(Adopted 2026-08-25, earned by the reconciliation of Item 6. It is RULING 147 —
*no reconciliation may compare a parser to itself* — pointed at VERIFICATION
rather than at reconciliation, and it is RULING 136's missing half: that ruling
says a fix closes the class, and this says what it means to have checked.)

**A verification states the READER'S ROUTE to the thing it verifies, and walks
it. A test that exercises only the code path the fix introduced has proved that
the code does what the code does.**

*The rationale stays attached, because here the rationale is a measurement.* Six
DONEs were disproved by Sean the next morning. Verdict (a) — never reached
production — did not happen once; every fix was live. The five real recurrences
share one mechanism, and it is not carelessness:

- **`BAL-9`** built a camera store and restored from it correctly. The store is
  written only after a user GESTURE — the code says so itself: *"flyTo, jumpTo
  and fitBounds never [carry an originalEvent], so this stays silent through
  every camera move the app makes itself."* Entering a zip flies the camera
  programmatically, so a reader who types a zip and clicks through has nothing
  remembered and gets the continent back. The fix works for a reader who
  happened to pan first. **And `git grep BAL-9 -- tests/ scripts/` returns
  nothing**: the words "done, verified" rested on no artifact this repo holds.
- **`BC-14`** asserted the consolidation it had written, on the data type it had
  written it for, and reported *4 surfaces, 0 footnote markers* — true, and
  about the wrong four surfaces.
- **`JUR-2`** asserted the new branch and not the branch beside it, while the
  module's own documentation already said the branch beside it was wrong.

Operationally:

- **The route is stated in words** — *type a zip, open the ballot, press back* —
  before the assertion is written, so a route that never touches the fix is
  visible as one.
- **A verification that cannot reach the reader's route says so** and the item
  is a BOUNDARY STOP rather than a finish. That is a real ending and an honest
  one.
- **An assertion over stored state is not a verification of a rendered
  outcome.** A history-state round-trip is not a restored viewport, and only a
  capture read as an image is (the read-as-an-image rule).

### RULING 154 — the Speak Your Mind disclosure leaves the panel, and the commitment does not

(Adopted 2026-08-25, the author's ruling on `BC-19`. **It amends RULE 2 of
RULING 141 and nothing else** — the other three rules of that ruling, and every
other clause of rule 2, are untouched. RULING 99 is the procedure this follows.)

**The disclosure PARAGRAPH comes out of the panel. The no-name commitment
stays, enforced architecturally, stated in fine print at the box and in full on
the transparency page.**

*What RULING 141 rule 2 said, and it is quoted rather than paraphrased because
this amends it:* "HONEST DISCLOSURE AT THE BOX. One line, plain language,
before the reader types: what is written may be shared — without a name,
because we do not hold one — with campaigns, organizations and researchers."

*What changes:* the full sentence no longer renders inside the panel.

*What does not change, and this is the load-bearing half:*

- **The no-name commitment is ARCHITECTURE, not a promise.** `speak_your_mind`
  has no column that could hold a name — no account reference, no email, no
  address — which is the fact the paragraph was asserting. A schema with
  nowhere to put a name cannot be talked out of it, and RULING 132's identity
  boundary is asserted over value spaces rather than column names, so it cannot
  be smuggled in under another heading either.
- **"MAY", never "will."** The fine print carries it, for the same reason the
  threat notice does: a stated commitment that is not honoured on every
  instance is worse than a reserved right.
- **The THREAT NOTICE does not move.** `CLAUDE.md` requires it adjacent to any
  free-text field about named real people, and `BC-19` says nothing about it.
- **The buyer classes are still named out loud**, in full, on
  `/transparency` — campaigns, organizations and researchers, rather than "our
  partners".

*And it closes a gap that had nothing to do with the author's note.* The
transparency page **had no Speak Your Mind section at all.** RULING 141 shipped
a fourth reader-collection store on 2026-08-24, and the coupling rule — the
transparency page changes in the same commit that ships the feature — was not
met. Moving the disclosure is what made anyone look. The page now carries what
is stored, that it is stored without a name and why, who it may be shared with,
that the text is redacted and flagged for self-disclosed identifiers before
storage, and that nothing written there is displayed back to anybody.

*Why this is not a weakening.* The disclosure rule exists so a reader is not
asked for something before being told what happens to it. A reader still is
told, at the box, before typing. What is gone is a three-line paragraph
standing between a person and a text field they had already decided to use —
and the reader-friction rule counts that as a defect with the same standing as
a wrong number, with exactly three exceptions, of which "consent to collection"
is one. The fine print IS that consent line; the paragraph was the essay around
it.


---

### RULING 155 — a session may not claim local gates green unless it ran the gate set CI requires, and named each one

(Adopted 2026-08-25, Sean's authority, from the recovery brief that followed
`RO04`. It is the operation-count rule — *an operation that can return nothing
must be asked what it returned* — pointed at the GATE SET rather than at a
single gate, and it is RULING 113's sibling: that ruling asks whether a step did
the thing, and this asks whether the step was ever run at all.)

**A session may not claim local gates green unless it ran the exact gate set CI
requires and named each gate with its individual result in its report.**

*The rationale stays attached, because a stripped rule reads as guidance — and
here the rationale is a measurement rather than an argument.*

On 2026-08-25 the one-session-0825 run reported passing the full local gates:
**2,295 of 2,295 tests, `walk:all` exit 0, the deploy confirmed serving the
work.** It merged twice on that confidence. **`pnpm lint` was failing the entire
time**, on two `react-hooks/set-state-in-effect` errors, and `main` was red
across both merges.

**The report was true about every gate it ran.** That is the whole finding.
Nothing in the repo asked it to run the one that was failing, because the local
door did not know that gate existed:

| | the local door ran | CI required |
| --- | --- | --- |
| `pnpm build` (default) | yes | yes |
| build, standalone mode | no | yes |
| `pnpm test` | no | yes |
| **`pnpm lint`** | **no** | **yes** |
| `tsc --noEmit` | no | yes |
| `assert:browser` | no | yes |
| `test:bundle` | no | yes |

`pnpm handoff --ship` calls itself the single door everything merges through and
`pnpm closeout` is RULING 75's gated door. **Both ran `pnpm run build` and
nothing else** — one of CI's seven commands. A session using either door
correctly, reporting honestly, still shipped red. **This is a hole in a door,
not a careless session**, and every session that used the door inherited it.

- **The local gate command is `pnpm gates`**, and it runs the set CI requires.
  Each gate is reported BY NAME with its own result, because a summary line
  cannot be written from a single aggregate boolean and "gates green" is exactly
  the sentence that was true and useless.
- **The gate set is anchored EXTERNALLY** (RULING 147).
  `tests/gate-parity.test.ts` reads `.github/workflows/build-check.yml` and
  fails when a command CI runs is absent locally. A check that re-derived the
  expected set from the local set would prove the file equals itself, and would
  have agreed with the hole every day it lived.
- **Every gate runs even after one fails**, mirroring the workflow's
  `if: always()`. A session gets all seven answers from one run rather than
  discovering them one merge at a time.
- **There is no skip flag**, for the reason the build gate already gives: an
  escape hatch on a gate is how the gate stops meaning anything.

*What the instrument taught about itself, recorded because it is the same class
of defect one floor up.* The first version of `scripts/gates.mjs` ran its gates
**on import**, so `tests/gate-parity.test.ts` importing the gate list executed
the whole suite — and the `process.exit()` at the end of that run killed the
test process after the first test. **A four-test file reported `pass 1, fail 0`
and a green tick.** It was caught by reading the run's own output rather than
its exit status: `test … PASS (1s)` for a 2,295-test suite is not a pass. That
is RULING 62's shape — a suite quietly reporting on fewer guards than it holds —
arriving through an imported side effect.

*And the parity test is shown catching the real hole* (RULING 110). Removing the
lint entry from the gate list fails two of its four assertions by name. A sweep
that cannot find the defect it was written for is a sweep reporting green about
nothing.

### RULING 156 — a required check is registered by NAME, and a rename disarms protection in silence

(Adopted 2026-08-25, closing `NS20` and `NS21`. It is RULING 155's shape one
floor up: that ruling closed a gate set with a hole in it, and this closes the
hole that would put a hole back in it without anyone editing a gate.)

**Sean hardened `main` himself on 2026-08-25, and it reads back from the GitHub
API exactly as intended.** `repos/SeanJ22/We-The-People/branches/main/protection`
returns, on that date:

| What the row asked for | What the API returns |
| --- | --- |
| PR required, approvals off | `required_pull_request_reviews` present, `required_approving_review_count: 0` |
| Three required contexts | `build (default)`, `build (standalone)`, **`gates (test · lint · tsc)`** |
| Branches up to date | `required_status_checks.strict: true` |
| **Do not allow bypassing** | **`enforce_admins.enabled: true`** |
| No force pushes, no deletions | `allow_force_pushes: false`, `allow_deletions: false` |

`NS20` asked for the gates job to become a required check and `NS21` asked for
bypassing to be turned back off. Both hold. **Both close on the API response**,
which is a server fact rather than a claim about the working tree (RULING 75's
third part, and RULING 125's reason for asking Netlify rather than the site).

**The hole underneath them is the NAME.** GitHub matches a required context
against the check-run name a workflow reports, as a literal string. Two of the
three are matrix legs — `build (${{ matrix.mode }})` — and the third carries a
middot-separated display name that a tidying edit would change without a second
thought. **Rename the job and the required context never arrives, and GitHub
does not treat that as a failure: there is nothing to wait for, so the merge
button turns green.** Protection disarms itself with nothing anywhere going red.

That is the same failure mode as the gate set RULING 155 was adopted over — a
check reporting nothing because it is not running, rather than a check that
fails — and it is worse here, because the disarming edit looks like tidying.

- **The anchor is the WORKFLOW FILE** (RULING 147). `REQUIRED_CONTEXTS` in
  `lib/ops/required-checks.ts` is a transcription of what the branch says;
  `contextsProducedByWorkflow` parses `.github/workflows/build-check.yml` and
  expands its matrix to derive what the workflow actually reports. Re-deriving
  one from the other would prove the file equals itself and would agree with a
  rename on every run, forever.
- **It fails in BOTH directions.** A required context the workflow no longer
  produces is protection disarmed; a check the workflow produces that the branch
  does not require is a gate nobody has to pass.
- **A rename is not forbidden — a SILENT rename is.** It has to move the
  workflow and the constant in one diff and then be re-registered on the branch.
  That is the mechanism `tests/guard-census.json` already uses to let a guard
  leave: leaving is allowed, leaving unnoticed is not.
- **A name this reader cannot resolve is REFUSED, never dropped.** A parser that
  quietly skipped an unexpandable job would under-report the produced set, and
  an under-reported set reads as agreement — RULING 100's partial, wearing a
  test's clothes.

*And the instrument is shown catching the real thing* (RULING 110). Three plants
run against the shipped workflow text: the gates job renamed to
`gates (test, lint, tsc)`, the `default` matrix leg renamed to `plain`, and a
job name carrying an expression the reader does not know. The first two drop a
required context; the third throws. `tests/required-checks.test.ts`, five
assertions.

---

### RULING 157 — a fix is verified against a case it was NOT derived from

(Adopted 2026-08-25, the all-open-board session, written before the work it
governs. It is **RULING 153's missing half**: that ruling said a verification
must walk the READER'S route, and this says it must walk a route the fix did
not come from. It narrows neither RULING 136 nor RULING 153.)

**A fix's verification must exercise at least one case the fix was NOT derived
from, and the report NAMES that case. Verifying only against the reported
instance does not close the class.**

*The rationale stays attached, because a stripped rule reads as guidance, and
here the rationale is a measurement rather than an argument.*

The prior session produced four reconciliations and **all four came back verdict
(b) — predicate too narrow**. Not one of the earlier fixes had regressed; not
one had failed to reach production. Every one of them was real, live, and
wrong about a case it had never seen.

**`MTG-9` is the clean illustration.** It was validated against a district whose
bad data was NOISY — the defect was loud there, the predicate caught it, the
capture proved it. It then shipped wrong against a district whose bad data was
CLEAN, because the predicate had been shaped by the noise. **The fix passed
because the test case was the source of the fix.**

That is not carelessness and it will not be fixed by care. It is what happens
when the same instance supplies both the diagnosis and the proof: the
verification is guaranteed to succeed, because it is asking whether the fix
fixes the thing it was written from. **RULING 147 named this exact shape one
floor up** — *no reconciliation may compare a parser to itself* — and this is
that reasoning pointed at a FIX rather than at a check.

- **The derived-from case is still verified.** This adds a case; it removes
  none. The reported instance is the one Sean can check, and dropping it would
  make the report unreadable to him.
- **The independent case is NAMED IN THE REPORT**, by id, surface or entity —
  not "audited across the class", which is a claim with no case in it.
- **Where the class genuinely has ONE member, the report says so** and states
  how that was established. A class of one is a real answer; an unexamined
  class of one is the assumption this ruling exists to break.
- **An independent case that FAILS is the deliverable**, not a defeat. It is the
  session finding the class before Sean does, which is the whole point.

### RULING 158 — a shed requires a measurement and a reason, or it is an unfinished session

(Adopted 2026-08-25, the all-open-board session. It is the **read-as-an-image
rule's** shape applied to a session's own account of itself: that rule forbids
reporting a step that was not taken, and this forbids reporting a mechanism
that was not triggered.)

**A shed is invalid without a STATED CONTEXT-USAGE MEASUREMENT, as a number, and
a SPECIFIC reason it could not continue. Below 80% context usage there is room:
stopping is an UNFINISHED SESSION and is reported as one, never as a shed.
Invoking the shed clause without a number is a failed close-out.**

*The rationale stays attached.* The prior session shed Items 9 through 14 plus
`LAY-11` — more than half its visual work — **at 56% context usage**, and
reported it as a shed with no measurement and no reason.

**That is the same shape as its own capture script reporting `0 offenders`
about a panel it never opened**: a legitimate-sounding mechanism invoked for
something that did not happen. The shed clause exists for a real condition —
genuinely running out of room, mid-session, with items left — and a session
that reaches for it early has not lied about anything except which mechanism it
was using. That is enough to make the report unreadable, because *shed* and
*stopped* call for completely different responses from the author: one is
scheduling, the other is a problem.

- **The number is stated at the MOMENT OF THE DECISION**, not reconstructed
  afterwards.
- **The reason is specific to what remained** — *the next item needs a full
  build and a browser and there is not room for both* — never "running low".
- **A session that chooses to stop says so plainly**: *I stopped here, and why*.
  It does not point at the shed clause to describe it.
- **Order is unchanged.** Shedding is from the BOTTOM, never mid-item.

### RULING 159 — a counting script fails loudly when its denominator is zero

(Adopted 2026-08-25, the all-open-board session. It is **RULING 100's** partial
and **RULING 43's** zero-row extraction, moved from a document reader to the
instruments that measure this repo — and it is the third time this exact shape
has been written down.)

**Any script that reports a count FAILS LOUDLY when its denominator is zero or
its selector matches nothing. Zero is a result that must be EARNED, never
defaulted to.**

*The rationale stays attached, because the instance is the third of its kind.*

The prior session's capture script reported **`0 offenders`** about a panel it
never opened. Three guessed selectors, none of which matched, and a clean exit
— because an empty match set and a healthy surface produce the identical
number. **That is the Chromium step that installed nothing and reported success
(RULING 113), and it is the six silent partial extractions before it (RULING
100).** Same failure, third venue.

- **A selector that matches nothing is an ERROR**, naming the selector, the
  surface and what it did find. Not a warning, and not a zero.
- **A denominator of zero is an ERROR** unless the script can state a reason the
  population is genuinely empty — which is a `COULD_NOT_ASSERT`, named and
  reported, never a silent pass (RULING 100's second state).
- **The floor is asserted BEFORE the count is reported**, so a report cannot be
  produced from an unmeasured population.
- **The instrument is shown catching the real thing** (RULING 110): every floor
  ships with a case that trips it.

The machinery is `lib/ops/denominator-floor.ts` and the audit is
`pnpm floor:audit`, whose baseline in `tests/denominator-floor.test.ts` only
shrinks.

---

### RULING 160 — in-cycle sales are allowed, and equal solicitation is the constraint that carries neutrality

(Adopted 2026-08-25, Sean's ruling, the all-open-board session. **Amends
RULING 120** under the RULING 99 procedure: RULING 120's prohibition on
exclusivity and its equal-solicitation obligation are UNCHANGED and are carried
forward verbatim in force. What changes is WHEN a sale may happen, and what the
whole set of neutrality constraints is.)

**Sean's ruling, and his reasoning, recorded because a paraphrase of a business
decision is a different decision: in-cycle sales are ALLOWED, as standing
policy. August and September of an election year are the highest-value moment,
and refusing it is the wrong call.**

**The old retrospective-only posture — nothing sold until after November 3 — was
PILOT-SCOPED and is superseded.** It is not to be re-imported anywhere: not in
the pricing sheet, not in the committee-sale rules, not as a lingering
conditional in code or in copy.

*Swept on adoption, and the result is stated rather than assumed.* Nine search
shapes were run over the whole tree with `git grep -a` — `retrospective`,
`after the election`, `after November`, `post-election`, `in-cycle`, `during the
cycle`, `historical only`, `past cycles only`, `not until after`. **Every hit was
a ballot-measure analysis or an unrelated build note. 0 remnants found, 0
removed.** The posture had never been written into the repo; it lived in briefs
and in conversation, which is precisely how a superseded rule comes back as
drift (RULING 99), so the search is recorded here as the record of having
looked.

#### Neutrality is now carried by FOUR constraints, and they are the whole of it

1. **Equal solicitation.**
2. **Published uniform rates.**
3. **Never exclusive.**
4. **No off-catalog bespoke cuts for any single buyer.**

**Three of the four are ARTIFACTS and verify themselves.** A rate sheet is
either published and uniform or it is not; an exclusivity clause either exists
or it does not; a bespoke cut is either on the catalog or it is not. Anyone can
check those by looking at them, and they need no instrument.

**Equal solicitation is a BEHAVIOUR, and it is the one that actually carries the
neutrality.** Offering insight to the campaign that asked, while never
approaching its opponent, produces a **perfectly uniform rate sheet and a
lopsided customer list** — and that failure is invisible in every artifact
above. Nothing about the published rates, the absence of exclusivity, or the
catalog would look any different.

#### So the solicitation ledger is built, and it is the artifact that proves it

**Every offer is recorded: to whom, when, at what published rate, and which
contest it touches.** The ledger must make it answerable **at a glance and by
anyone** whether both sides of a given contest were approached — which is why
the reconciling unit is the CONTEST rather than the buyer. A list of offers
sorted by buyer cannot answer that question without someone doing the join in
their head, and a claim that depends on the reader doing arithmetic is a claim
nobody checks.

- **The ledger shares NO JOINABLE COLUMN with reader data.** The same
  architectural separation that governs everything else here (RULING 132), not a
  policy promise. It holds buyers, offers, published rates and public contest
  ids; it holds nothing about a reader, and no store that holds anything about a
  reader can reach it.
- **A contest with one side approached and the other not is a BREACH**, named as
  one, with the unapproached side listed — never a percentage. The purpose is to
  produce a name somebody has to act on.
- **The rate on an offer is a reference to a PUBLISHED rate-card entry**, never
  a number typed on the offer. A per-offer number is how an off-catalog cut gets
  made without anyone deciding to make one.
- **Buyer composition is NOT an obligation** — RULING 120's second half is
  untouched. If the buyers who accept skew one way that is a fact about the
  market, and the only ways to "fix" it would be to screen customers by politics
  or to claim a control nobody has. Both are further from neutrality than the
  honest number.

The machinery is `lib/business/solicitation-ledger.ts`, guarded in
`tests/solicitation-ledger.test.ts`, whose load-bearing case is the one an
artifact can never catch: **a uniform rate sheet with a one-sided customer
list.**

---

### RULING 161 — Sean's tracker decisions of 2026-08-26, recorded as a batch

(Adopted 2026-08-26, Sean's instructions in the all-open-board brief, recorded
the way RULING 151 recorded his decisions of 2026-08-25 and RULING 123 those of
2026-08-24 — **so that a close has an authority which exists.**)

*Why this shape rather than a session simply acting on the brief.* RULING 37
reserves Needs Sean rows to him and `tests/tracker-stores.test.ts` enforces it
in both directions; RULING 79 is the amendment for a row he has ALREADY
ANSWERED, and it routes the close through a NUMBERED ruling rather than through
a session's reading of a prompt. A brief is not a ruling and is not in the
repo. This entry is what makes his answer citable.

**`NS15` — CLOSED.** His words in the brief: *"`NS15` closes on Sean's
authority: done, communicated."* The row existed to tell him that Speak Your
Mind had shipped live with migrations `0019` and `0020` unapplied — every
insert naming those columns failed, the route caught it, the page served
normally, and a reader's words went nowhere with nothing saying so. It was
applied; the row was a notification rather than a question. Verified on the
store rather than on the claim this session: `pnpm db:surfaces` reports **6 of 6
serving surfaces have their store**, 10 tables needed against 12 held.

**`BAL-14` — SETTLED, and it is not open.** *"Green. Sean settled this; it is
not open. Width matches the 'Would you vote for them?' box per the highlighted
capture, color is green, in both themes."* This supersedes `BAL-13`'s navy of
the same morning; the FILLED-among-outlines mechanism that ruling gave is
unchanged and only the hue moved.

**`ASK-12` — BUILD IT, with hard separation.** *"Try it while it's in
testing."* The condition travels with the permission and is the reason it is
allowed at all: a sourced civic answer and an unsourced general answer must
never be visually or structurally confusable.

**In-cycle sales — ALLOWED as standing policy.** Recorded in full as
**RULING 160**, which is where the reasoning and the four constraints live.

**`OFF-7`'s title question — RESOLVED, do not redo.** LeBoeuf is Business
Administrator and Bessette is Interim Superintendent: two people, two rows,
determined from the district's own site.

**`OFF-5` — the session determines it, not him.** *"Not a Sean question."*
Determined 2026-08-26 by an independent fetch: both Rockaway Township pages
answer HTTP 200 with full content and every image on them is site chrome.
Nothing held, and not a fetch problem — a dated measurement rather than an
exhausted absence.

**`DARK-1` — the proposal IS the deliverable.** *"Sean has said all he intends
to say."* Three options with side-by-side captures and a recommendation; the
row that carries it asks him a question with four answers rather than asking
him to specify a fix.


---

## THREE RULINGS OF 2026-08-26 — THE SCHEDULED PUSHERS

(Adopted 2026-08-26, the unblock-pushers session. **RULINGS 162, 163 and 164.**
Recorded here rather than in `CLAUDE.md`: these govern how this repository's own
plumbing behaves, not what the product may claim about a government. If Sean
wants any of them to bind as law he writes it into `CLAUDE.md` and this entry
says so.)

### RULING 162 — a bypass is only as safe as the paths it can carry

**A scheduled workflow that pushes to `main` declares which paths it may write,
and the shared pusher refuses anything else. Fail closed, per workflow, with no
skip flag.**

*The rationale stays attached, because a stripped rule reads as guidance.*
Hardening `main` on 2026-08-25 blocked all eight scheduled pushers, which push
directly. Sean ruled for a scoped bypass for the Actions bot — and **a bypass
that could carry code is the 8/25 hole reopened.** That hole was sessions
merging red code through PRs with nothing required; the actor was Claude Code
and the payload was code. The allowlist is what makes the payload structurally
incapable of being code, which is the only reason the bypass is acceptable at
all.

- **PER-WORKFLOW, not one global list.** A single list is the union of eight
  workflows' needs, so the FEC refresher would be permitted to write the ballot.
  Each profile grants exactly what its own workflow writes, so the blast radius
  of any one of them is one artifact.
- **It fails closed in FOUR directions**: an unknown or absent workflow id, a
  diff that could not be read, an **empty** diff, and any path outside the
  profile. The empty case is the one that looks harmless — a push of nothing is
  a path check with nothing to check, which is RULING 159's earned zero.
- **A second, independent list bars the dangerous prefixes outright**, so a
  profile widened by mistake still cannot admit `.github/`, `scripts/`, `lib/`,
  `tests/`, `CLAUDE.md`, `docs/rulings.md` or the resolved tracker store.
  Re-deriving one list from the other would prove the file equals itself
  (RULING 147).
- **It lives in `scripts/push-main.mjs`**, the one script all eight already go
  through. Eight copies of a guard is eight places for it to drift, and a ninth
  pusher would inherit the copy nobody remembered to add.

**THE LIST IS DERIVED FROM WHAT THE PUSHERS ACTUALLY WRITE**, read off their own
`git add` lines, never from what they were expected to write. That reading is
what produced the finding: **`job-watch` ran `git add docs/` — the whole
directory — while needing exactly one file in it.** `docs/` holds `rulings.md`,
the resolved tracker store and every generated report, so anything left dirty in
the runner's tree by an earlier step would have been swept into a bot commit and
pushed to `main` unreviewed. Nothing had gone wrong yet; the blast radius was
simply far larger than the job's purpose.

**One grant sits outside `data/` and it is named rather than absorbed.**
`job-watch` may write `docs/tracker-working.csv`, because RULING 56 makes
committing the Needs Sean row its entire function, and that row is the only
channel that reaches a person when a scheduled job fails twice running. The
brief said the allowlist never includes the tracker stores; read strictly that
ends the alarm. The grant is made to one workflow for one file, reported, and
rowed for Sean to overrule (`NH204`).

`lib/ops/push-allowlist.ts`, guarded in `tests/push-allowlist.test.ts`, whose
load-bearing case is a workflow that did not exist when the guard was written:
a guardless pusher is constructed, caught, and gone when the test ends
(RULING 157).

### RULING 163 — the answer to "is the protection still what we think" is a command

**Branch protection is asserted against the live API by `pnpm protection:verify`,
which exits non-zero on drift and on could-not-tell.**

*The rationale.* `main` was hardened by hand and read back once, into a ruling,
as a table. **A table in a document is a claim about a server on the day
somebody looked.** Protection is edited in a web UI by a person, under no diff
and no review, and nothing in this repo would have noticed a checkbox coming
off — which is how the 8/25 chain started.

- **`cannot-tell` is not a pass** and exits `2`. No credential is not a pass
  (RULING 24, RULING 125).
- **It understands classic protection AND rulesets**, because the scoped bypass
  moves `main` from one to the other and a verifier that knew only the shape it
  was written against would report `cannot-tell` on the day it is most wanted.
  It reports `shape: both`, which is the trap: the two are **additive**, so
  leaving classic in place means the bot is still refused while the ruleset
  looks correct.
- **It closes the half of RULING 156 that no ruleset existed for.** That ruling
  anchors the required-context names against `build-check.yml` and fails in both
  directions; it cannot see a name registered on a *branch*. Moving to a ruleset
  re-registers all three names BY HAND, which is exactly when a typo enters. A
  context spelled `gates (test, lint, tsc)` reads as MISSING, never as
  agreement.
- **It is STANDALONE, not in `pnpm gates`**, and the reason is stated rather
  than assumed: it needs `gh` authenticated with admin scope, which reading
  branch protection requires and which the gates job — running with
  `contents: read` — has neither.

`lib/ops/protection-state.ts` holds the judgement with no network in it, so the
intended end state is testable and was pinned in `tests/protection-state.test.ts`
**before it existed on the server**, which is the only way a click-list can be
checked against anything.

### RULING 164 — a workflow reports every failure, not just the first

**Independent steps run to completion and report together. A genuinely
dependent step says "stopped here, N not attempted" rather than letting a
skipped step read as a passing one. And a `continue-on-error` step whose
outcome nobody reads is a swallowed failure.**

*The rationale.* Three failures were once stacked in run order in this repo,
each invisible until the one before it was fixed. **A workflow that reports only
its first failure makes the number of remaining defects unbounded** — nobody can
know how many lie between the current failure and the end, so every fix costs
another round trip through CI. It is the same family as every instrument defect
this repo has named: a mechanism reporting less than it knows.

*Measured on adoption: 9 workflows audited, 3 short-circuiting on independent
steps and 3 fixed, 6 legitimately dependent with the reason stated.*

- **`intake-tripwire`** ran three independent checks unguarded and in sequence —
  the schema gate, the write alarm and the tripwire — so the first failure ended
  the job. A schema that has drifted is precisely when the write alarm is most
  worth reading, so letting the gate suppress it is the wrong way round.
- **`refresh-daily`**'s go-red-for-failed-sources step lacked `always()`, so a
  validation failure hid which sources had failed. **Its sibling in
  `refresh-meetings-snapshot` already carried the guard** — an independent case,
  and the one that proves the correct form (RULING 157).
- **`refresh-nj-filing`** carried `continue-on-error: true` on the clerk-count
  reconciliation with **nothing reading `steps.pair.outcome` afterwards**, so a
  disagreement between the clerk's published count and what we render was
  swallowed whole and the run finished green. It stays non-blocking, as
  designed, and becomes visible.

**The general rule is the third one, and it is the class rather than the
instance** (RULING 136): `continue-on-error` converts a failure into a silent
pass, so any step carrying it must have its outcome read by something
downstream. `tests/workflow-failure-reporting.test.ts` sweeps every workflow for
it, asserts a floor so a reader that matched nothing cannot report green
(RULING 159), and is shown catching a planted one.


## ONE RULING OF 2026-08-26 — THE DEPLOY-KEY CUTOVER

Adopted 2026-08-26 by the deploy-key cutover session. **RULING 165.**

**A numbering near-collision, named rather than smoothed** (RULING 99). This
session drafted its ruling as 164 and wrote that number into five files before
discovering that the unblock-pushers session, earlier the same day, had already
spent 164 on *a workflow reports every failure, not just the first*. The forty
references were renumbered to 165 in one sweep and 164 was left exactly where it
was. `docs/rulings.md` is append-only, so renumbering the one that already
shipped would have left dangling references in a record whose whole value is
that it does not move — the same reasoning that gave RULINGS 83 through 87 their
numbers on 2026-08-22.

### RULING 165 — the scheduled pushers authenticate as a deploy key, and the private half is never held

**What this replaces, and why.** RULING 162 built a per-workflow path allowlist
to make a scoped bypass safe, on the assumption that the bypass would be granted
to the GitHub Actions app. **It cannot be.** A branch ruleset's `Add bypass`
list does not offer GitHub Actions as a selectable actor — confirmed by Sean
against the live UI on 2026-08-26, Apps tab filtered on `actions`, zero
suggestions. The community reports were right and the documentation was not.

So the bypass is granted to the **Deploy keys** category, and the eight
scheduled pushers stop using the default `GITHUB_TOKEN` over HTTPS.

**The cutover is in `scripts/push-main.mjs` and `lib/ops/deploy-key-ssh.ts`, and
nowhere else.** All eight pushers already routed through that one script. Eight
edits in eight workflows would be eight places to drift, and a ninth pusher
would inherit whichever copy nobody updated. *The one thing that could not live
there is the secret REFERENCE — `${{ secrets.* }}` is only expressible in
workflow YAML — so each pusher carries one plumbing line, and a test asserts all
eight carry it against a stated denominator, which turns eight lines into a
guarded invariant rather than eight places to drift.*

**Two facts about the bypass make the allowlist matter more than it did
yesterday, not less.**

- **It is CATEGORY-WIDE.** `bypass_actors` reports `DeployKey` with
  `actor_id: null`; there is no way to name a single key. Every write-enabled
  deploy key on the repository holds it. One is the intended state, and
  `pnpm protection:verify` now counts them and goes red at two.
- **Its mode is `exempt`, and that is Sean's settled decision.** An `always`
  bypass still EVALUATES the ruleset and waves the actor through afterward;
  `exempt` skips enforcement outright, which is what GitHub recommends for
  trusted high-volume automation and what a scheduled deploy-key push is. The
  consequence is stated rather than left implied: **an exempt key skips every
  rule in the ruleset, not only the ones that were blocking it. There is nothing
  left on the server between a scheduled job and `main`.**
  `lib/ops/push-allowlist.ts` is the whole of it, and it is unchanged and
  unweakened by this cutover.

**THE CREDENTIAL RULE SHAPED EVERY DESIGN DECISION, and it is absolute.** On
2026-08-25 a `curl` reporting flag printed nine credential values into a
transcript that mirrors to Drive, and all nine required rotation (RULING 127). A
private key is that failure with a worse blast radius. So:

- **No private key is generated, printed, echoed, or written by any session.**
  Sean generates the keypair locally, puts the public half in Deploy keys and
  the private half in the `PUSH_DEPLOY_KEY` secret. Code references the secret
  by name and never reads its value. **A design that would require a session to
  hold the private key is a wrong design and is changed.**
- **No diagnostic may carry key material.** Every refusal describes the key's
  SHAPE — absent, empty, missing its header, public half pasted by mistake — and
  the test proves it by handing in a marker and asserting it does not come back
  out.
- **The key file never lands in the repository or a synced folder.**
  `refuseUnsafeKeyRoot` turns that from a habit into a check, refusing rather
  than silently relocating.
- **It is removed on every exit path, the failure path included** — a `finally`
  around the push loop, proved through a declared seam because the real path
  needs a private key and a network call.
- **Even the tests hold no key.** A structural placeholder exercises every
  decision the module makes, which are all about shape and placement. Generating
  a throwaway keypair to make a test feel more real would put private-key
  material into a test run, a temp folder and a CI log.

**HOST VERIFICATION IS PINNED, NEVER DISABLED.** The obvious way to make an
unattended SSH push work is `StrictHostKeyChecking=no`, and that turns every
push into an unauthenticated one. `GITHUB_HOST_KEYS` is a DECLARED constant read
from GitHub's own `meta` endpoint — a value fetched at push time from the host
you are about to authenticate is not verification, it is a round trip. *Verified
against the live endpoint on adoption: `ssh -T git@github.com` with only these
keys pinned and no identity offered returned `Permission denied (publickey)`,
which means host verification SUCCEEDED and only authentication failed. A wrong
pin fails earlier and differently.*

**A MISSING CREDENTIAL IS A RED RUN AND MAY NEVER DEGRADE TO "NOTHING TO PUSH".**
That shape — a mechanism reporting success for work it did not do — has been
sighted enough times in this repo to have its own rulings (100, 113, 159). The
empty-string case is the one that matters: **in GitHub Actions an unset secret
interpolates to `""`**, so a check that only tested for `undefined` would sail
straight past a missing repository secret.

**The proof is both directions, on a real repository, through the command line
the workflows actually run.** A guard that refuses everything passes a refusal
test on its own. A commit carrying `scripts/anything.mjs` alongside the snapshot
is refused with the path named and origin's `main` unmoved; the same commit
without it lands. Asserting against `classifyPushPaths` would have proved that
the code the fix introduced does what the code does (RULING 153) — the guard is
wired in the direct-invocation block, so that is where it is exercised.

**And it is verified against a case it was not derived from** (RULING 157). The
cutover was derived from `refresh-daily`. The independent case is `job-watch`,
independent in the way that matters rather than in name: the only profile whose
grant lies outside `data/`, the only one whose allowlist is a single exact file
rather than a directory prefix, and the only pusher whose commit is an alarm
rather than an artifact.

*Measured on adoption: 1 of 1 write-enabled deploy key; `pnpm protection:verify`
INTACT, 9 of 9, against the live API; 8 of 8 pushers plumbed; 46 guards passing
across the three affected test files.*

### RULING 166 — the body's own publication is rung one, and its bulk download is rung zero

(Adopted 2026-08-26, Sean's ruling, the sources-and-incumbency session. **Amends
RULING 84** under the RULING 99 procedure: RULING 84's three tiers stand and its
cost-per-fact reasoning is untouched, and what changes is the ORDER INSIDE
Tier A. Narrows nothing.)

**Before any aggregator, any third party, and any per-entity search, the
governing body that holds the office is walked first. Where that body offers a
bulk download, the bulk file is taken before any page-by-page retrieval. A
third-party source may only be reached after the body's own publication has been
walked and what it carries has been recorded.**

*Why this is being ruled now, stated plainly so it is not softened.* New
Hampshire's state legislative data reached this product through **LegiScan — a
third-party aggregator** — while the New Hampshire General Court publishes its
own data directly, at `gc.nh.gov/downloads/`, including a downloads section
carrying Member Data as `.txt`, `.xls` and `.xlsx` and an ODBC connection
document for a public read-only SQL Server. That page exists precisely so
consumers do not have to scrape the site. **The ladder was inverted.** LegiScan
is a good source and stays in use; it simply is not rung one, and reaching it
first meant no session ever asked what the body itself offered.

**This is not a legislature rule.** It applies to every body in the product — a
county, a school district, a city council, a state agency. The body that holds
the office publishes its own officeholders, and the bodies that publish in bulk
usually do so precisely to avoid being scraped.

**The amendment to RULING 84, stated exactly.** That ruling's Tier A is *broad
sources that answer many entities at once*, and its list mixes two kinds of
thing: government publications (the Census of Governments, NCES, the Secretary
of State, the county clerk) and third-party compilations (Wikipedia). Walked as
one tier, a session may reach an encyclopedia before it reaches the body the
encyclopedia is about. So Tier A splits:

- **Tier A0 — the body's own publication, and the tier above it in government.**
  Bulk download first, then the body's own pages. RULING 93's descend-the-
  hierarchy move lives here: a directory the tier above publishes about the tier
  below is the body's own publication about its subdivisions.
- **Tier A1 — third-party compilations that answer many entities at once.**
  Wikipedia, LegiScan, Citizens Count, Open States, GovTrack. Still Tier A,
  still cheap, still walked before Tier B and Tier C — and now walked AFTER A0.

Tier B (the entity's own official source, per entity) and Tier C (per-entity
search) are unchanged.

**A bulk file is rung zero because it is not a retrieval problem at all.** The
fourteen rungs in `CLAUDE.md` are about getting bytes past a wall. A published
`.txt` of the whole roster has no wall in front of it, and a session that walks
rungs 2 through 6 against a body's individual member pages while that file sits
one directory away has not been defeated by anything — it never asked.

*What it returned on the day it was adopted, measured rather than argued.*
`gc.nh.gov/downloads/Members.txt` is 82,694 bytes, 408 rows, tab-delimited, and
carries per legislator: name in three parts, chamber, seat number, county,
district, **`electedStatus`**, mailing address, phone, work email, party, title
and up to five committee assignments with their phone numbers. **406 of 408 rows
carry an email and 266 carry a phone** — two Kelly-standard fields for the whole
of the New Hampshire General Court, in one fetch, from the body itself.
`ftp://ftp.azsos.gov/cfsdata2/` — named in Arizona's own Bulk Filing Guide,
revised 28 July 2026 — is anonymous, live, and carries **8,828 Arizona campaign
committees** and the state's **109 campaign-finance filing jurisdictions**
(1 state, 15 counties, 93 cities and towns). Neither had ever been walked.

**And the ruling paid for itself twice over on adoption day**, which is the part
worth keeping. The brief that ordered this work named the NH public SQL Server
as `216.177.20.245\sqlexpress`. The body's own document at `gc.nh.gov` names
`66.211.150.69\sqlexpress`. Probed the same hour: the brief's address is
`ECONNREFUSED`, the body's answers with **TCP OPEN on 1433**. A session that had
gone to the aggregator, or to the brief, and not to the body, would have
recorded a dead endpoint.

### RULING 167 — donor rendering is AGGREGATE ONLY, and no individual donor name or address renders anywhere

(Adopted 2026-08-26, Sean's authority, stated in the sources-and-incumbency
brief as in force rather than as a proposal. It sits beside **RULING 126**,
which walls campaign-finance data out of everything sold; this governs what may
be shown to a READER, which is a different question and was open.)

**Totals, source types, in-state versus out-of-state, and employer-level
rollups. No individual donor name and no donor address renders anywhere in this
product, for FEC data or for state data.**

*The rationale stays attached, because a stripped rule reads as guidance.*
Publishing them is lawful — that is what a disclosure regime is — and this
product could render them and be within the law all day. **Rendering them
searchably builds a way to locate private individuals by their politics**, next
to a map, next to a zip box, in a product whose whole architecture is organised
around a reader's address. This project will not build that, and the reason is
not legal exposure.

The measurement that makes it concrete rather than hypothetical: the FEC's
individual-contribution schedule and New Hampshire's receipts file both carry
contributor **name, street address, city, state, zip, occupation and employer**,
and Arizona's Bulk Filing Guide (revised 28 July 2026) specifies the same seven
fields as columns 10 through 22 of every filed transaction — `Occupation` and
`Employer` are **conditionally REQUIRED** for individual contributions. Three
states' worth of the same personal record, arriving through three different
doors, is why this is a standing rule rather than a decision taken once per
source.

- **A donor is a private individual. A committee is not.** An organization
  renders as filed, with its registered name and committee type, exactly as the
  organizations-render-as-filed rule already requires. Nothing here narrows that.
- **An employer-level rollup is an aggregate and is permitted**; a single row
  that names one person's employer alongside their contribution is not, because
  with a name attached it is the same record wearing a summary's clothes.
- **This is a RENDER rule and not a COLLECTION rule.** The filings are retrieved
  and held with their provenance intact — a claim about money still needs its
  source record, and a source record we did not keep is a claim we cannot make.
  What is forbidden is putting an individual donor in front of a reader.
- **RULING 126 is untouched and is the other wall.** None of this data enters an
  export, an aggregate, or anything sold, whatever level it is summarised to.

*Audited on adoption across every funding surface, and the audit is the reason
this entry exists in the shape it does. **The session first wrote that nothing
rendered and the count changed was 0 of 0.** That was wrong, and it was wrong in
the way this repo names most often: it was an assertion about a surface nobody
had opened. `components/funding/funding-section.tsx` was rendering
`group.contributorName` beside `{group.city}, {group.state}` for every itemized
individual receipt in the snapshot, live, with `ripcord.fecContributorDisplay`
not pulled.*

***2 of 2 render sites changed.*** *The named one is the "Individual donors"
column. The second is the SECOND-HOP panel — a joint fundraiser's own book,
folded by a different call, concatenated into a different list, inside a
collapsed `<details>` — and it is the case a fix aimed at the first would have
left standing (RULING 103, RULING 157). Both now render*
`lib/funding/donor-privacy.ts`'s *aggregate: a donor count, a filing count, a
total, a state rollup that sums to it, and the candidate's own money held apart
as a subset. Guarded in* `tests/donor-aggregation.test.ts` *— 5 assertions, the
render half swept BY SHAPE with a planted violating component proving the sweep
catches a real one.*

*And the cheap fix was refused on purpose. Keeping the rows and dropping only
the names leaves an amount, a city and a date per row, which is re-identifiable
against the FEC's own public search in about a minute — the product would have
published the same record with one column hidden. The row had to stop being a
row.*

## One ruling of 2026-08-26 — the all-open-board session

Adopted 2026-08-26, from Sean's all-open-board brief. **RULING 168.** `CLAUDE.md`
does not carry it: it is a decision about one row and one workflow, not a law
that binds every session, and the record-what-is-not-law rule puts it here.

### RULING 168 — Sean's ratification of the job-watch tracker grant, and his tracker decisions of that brief

Recorded the way **RULING 161** recorded his decisions of 2026-08-26 and
**RULING 151** those of 2026-08-25 — so that a close has an authority which
exists, rather than a session deciding for him.

**`NH204` — RATIFIED IN FULL.** His words: the grant covers the complete
transaction, not one file.

*The reasoning he gave, recorded because a paraphrase of a decision is a
different decision.* `job-watch` opens a tracker row when a scheduled job fails
twice running, and **that row is the only channel telling him the alarms are
broken.** The row cannot reconcile unless its derived views are written with it.
The 2026-08-26 corruption happened precisely because the row landed and the
views did not.

**The enumerated set, verified against what the job actually writes rather than
against the list the brief supplied.** The brief named five paths and asked for
any difference to be reported. **There is none — 5 of 5 match**, and each is
already justified individually in `lib/ops/push-allowlist.ts`:

| Path | Why it is in the transaction |
| --- | --- |
| `docs/tracker-working.csv` | the row itself (`TRACKER_ROW_GRANT`) |
| `docs/tracker.md` | the readable view, regenerated in the same `tracker add` call |
| `docs/log.md` | the session-by-session record, same call |
| `docs/tracker-opened.json` | the opened-row ledger the guards reconcile against |
| `docs/tracker.xlsx` | the workbook Sean actually reads |

**Still barred outright, and this does not change:** `docs/rulings.md`, the
resolved tracker store, and every prefix in `NEVER_PUSHABLE` — `.github/`,
`scripts/`, `lib/`, `app/`, `components/`, `tests/`, `CLAUDE.md`. The grant is
enumerated paths only and **a path not named is refused**, checked twice by two
lists that are not derived from each other (RULING 147).

**The write is atomic** — row, session attribution, section state, derived
views, recount and reconciliation assertion, all or nothing. `scripts/tracker.mjs`
already refuses a whole batch rather than writing the good half of it, which is
the property this ratification depends on: a partial success is the defect the
grant exists to prevent, not merely to permit around.

*Also recorded from the same brief, so the close has an authority:* **`BAL-14`
is SETTLED** — width matching the *Would you vote for them?* box, green, in both
themes — and is not an open question. **`NS15`** closes on his authority: done,
communicated.

## Two rulings of 2026-08-26 — the descent

Adopted 2026-08-26, the descent session, Items 3 and 9. **RULINGS 169 and 170.**
`CLAUDE.md` carries both, because both bind every session rather than deciding
one row.

### RULING 169 — a walk is COUNTED or it did not happen

Adopted 2026-08-26, the descent session, Item 3. Supersedes nothing. It is the
**operation-count rule** — *an operation that can return nothing must be asked
what it returned* — pointed at a SITE WALK rather than at an adapter, and it is
the instrument RULING 93 has never had.

**Coverage is built by DESCENDING the tiers of government in order, because each
tier publishes the tier beneath it. A tier is not complete until the tier above
has been asked what is in it. A body found only by per-entity search, when the
tier above publishes a list containing it, is a DEFECT IN THE WALK rather than a
find.**

**And every level's walk is REPORTED AS COUNTS: links found, links followed,
what each yielded, what was declined and why.** *"We walked the site"* without
those numbers is not a walk, and no report may claim one.

*The rationale stays attached, because a stripped rule reads as guidance, and
here the rationale is a diagnosis rather than an argument.*

RULING 93 has said *ask what the tier above publishes about the tier below*
since 2026-08-22. RULING 166 has said *the body's own publication is rung one*
since 2026-08-26. RULING 90 has said *exhaustion is argued, never asserted*.
None of them changed the behaviour, and the reason is that **not one of them
produces a number.** A session can satisfy all three in its own belief and be
graded identically to a session that walked one page — because the report shape
they produce is the same report shape.

Every session picked a body and hunted it. **No session had walked a tier top to
bottom**, and nothing in the process could tell the difference. That is RULING
88's diagnosis exactly, one level up: what changes behaviour is a required
output that cannot be produced by walking a list.

- **A count is per LEVEL, per STATE**, never one number for a run. A run total
  hides the level that returned nothing, which is the level somebody needed.
- **DECLINED carries its reason** — disallowed, off-scope, already recorded,
  unreachable — because a declined link and a followed link that yielded nothing
  are completely different facts, and a bare *followed* count runs them
  together.
- **The number that says whether the descent WORKED is bodies discovered that
  were not already in the registry.** Every other column measures effort.
- **The walk states its PASS COUNT and the final pass's new-link count. If the
  final pass found anything new, the walk was not finished and the session says
  so.** Following links produces more links; a walk that stops while its last
  pass was still producing has stopped, not finished.
- **Zero at a tier FAILS LOUDLY** (RULING 159). Zero counties in a US state is a
  broken walk, never a finding.

*What this does NOT license.* It is not a licence to count instead of hunting. A
high followed-count with no bodies discovered is a session that walked a site
thoroughly and learned nothing, and the report says that too.

### RULING 170 — no number of attempts earns an absence, and a protocol that TERMINATES is not persistence

Adopted 2026-08-26, the descent session, Item 9. **Amends RULING 94** under the
RULING 99 procedure. RULING 94's five moves stand, its placement between Tier B
and Tier C stands, and its void condition stands. What changes is what reaching
the end of them MEANS.

**RULING 94's five moves are the OPENING, not the count. Running them does not
earn an absence and never has.** An absence is earned only by the argument
RULING 90 requires.

**A session that has exhausted its ideas says "I have run out of ideas" — which
is a claim about the session — rather than "this is not published", which is a
claim about the government. Only one of those is ever true here.**

**Any cap in any brief — five moves, N routes, a list of seven — is a FLOOR.**
Reaching the end of a list is not completion. **A brief that appears to cap
effort is misdrafted, and the session says so rather than obeying the cap.**

*The rationale stays attached.* RULING 94 phrased its moves as five numbered
questions so they could not go stale, and the numbering was read as the job.
That is the same failure RULING 61 named about the manifest — *trying
thirty-seven routes and stopping does not tell you the forty-third would have
failed either* — arriving through the door built to prevent it. A protocol with
a terminating condition is a checklist, and a checklist completed is a session
that believes it complied.

**The standard, in the author's words: what would the most diligent, persistent
person do if they got stuck? Keep looking. Find another avenue.**

**And the productive question is not "where would this be published?" It is
"WHO WAS COMPELLED TO WRITE THIS DOWN?"** Governments are forced by statute to
produce documents nobody thinks of as directories — the municipal code that
establishes every board by ordinance, the tax rate table that must list every
levying district because somebody has to be billed, the legal notice published
in a newspaper of record, the budget and the audit, the minutes of the tier
above recording an appointment, the annual report, the state oversight
directory. **Those documents are where the dark bodies are**, and none of them
was in the ladder on the day this was adopted.

*This does not narrow RULING 144.* An argued absence may still be built from
walls, and it still expires the day a wall falls. What it forbids is arriving at
that argument by counting.
