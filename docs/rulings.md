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
No candidate cards ship in a contest until every candidate in that contest can
ship at equal depth.

**Status: LAW.** `CLAUDE.md`'s equal-effort rule. **How equal depth is
MEASURED was superseded by RULING 18 below.**

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

### RULING 18 — equal depth is measured by hunt completion, not field presence
Every Kelly field, per candidate, carries one of three states: `NOT_HUNTED`
(no completed hunt), `FOUND` (present, with its source recorded), or
`VERIFIED_ABSENT` (a completed hunt walked every applicable rung and the thing
does not exist, recorded with those rungs and the date). A contest renders
candidate cards when no field anywhere in it is `NOT_HUNTED`.

**Supersedes:** the strict-equality implementation shipped in Prompt B, under
which a minor-party or write-in candidate with no campaign site could never
reach an incumbent's four fields, so their contest was withheld permanently —
a blackout produced by that candidate's circumstances rather than by our
effort, and unclosable by any amount of hunting.

Implemented in `lib/ballot/hunt-state.ts` and the one shared gate in
`lib/coverage/tier.ts`; the work it names is tracker rows `HD01`–`HD30`.

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

The Kelly gate stands: a race displays per-issue alignment only when every
candidate in it clears equal depth.

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
