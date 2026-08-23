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
