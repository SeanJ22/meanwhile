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
