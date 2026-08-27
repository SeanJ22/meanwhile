# we-the-people — current context

**GENERATED FILE — do not edit, and do not copy it back into the repo.**
Written by `pnpm handoff` (`scripts/context-file.mjs`) at 2026-08-27 11:12:40 EDT.
Session day 2026-08-27 (America/Phoenix, from `pnpm stamp`).

It has no repo counterpart, is never compared for drift, is skipped by
`pnpm handoff --check`, and is overwritten after every successful `--ship`.

It exists so a conversation outside the repo can get current without pulling
the 1106 KB `state.md`. **Nothing in it is composed** — every line is read
from `docs/state.md`, `docs/tracker.csv`, `lib/ripcords.ts` and git. Long
fields are clipped with `…`; nothing is summarised.

---

## Phases — 5 standing(s)

Source: docs/state.md §7 — Where the phases stand.

| Phase | Status |
|---|---|
| Phase A — The federal card. Complete but for… | What they do (roll-call votes: **DONE**), who funds them (FEC money surfaces: **DONE**), who they are and how to reach them (the congress-legislators… |
| Phase B — The state layer and the 50-state re… | State legislators (**DONE** — Plural), state votes (**DONE** — LegiScan, D54 weekly), jurisdiction depth (**IN PROGRESS, and further from done than t… |
| Phase C — The commercial product. EMPTY, and… | C01 (the mock export — one measure, synthetic data), V05 (the beat-a-tracking-poll answer C01 doubles as), V01 (five buyer calls), the buyer-side dem… |
| Phase D — Launch readiness. | The name (B01/B02 — USPTO classes 9 and 42 before any commitment), counsel (B05, plus the ripcord questions queued for them: D23 and the D61 review),… |
| Phase E — National scale. Not started, delibe… | Vector tiling; the Census of Governments universe as the registry's denominator; vendor tenant enumeration; special districts; plus the notes / activ… |

<!-- PINNED: never trimmed. Verbatim from CLAUDE.md. -->

> **Source: `docs/governance/ledger.jsonl`, the canonical governance store, verbatim.**
> Both hand-written copies of each ruling are carried where they diverged.
> `CLAUDE.md` is the authority; this is a copy of it, pinned here because the
> failure RULING 88 fixes is a session not knowing there was anything to look up.
> `tests/context-pinned-conduct.test.ts` fails the build if the two diverge.

## DISCOVERY CONDUCT



*Pinned VERBATIM from `docs/governance/ledger.jsonl`, the canonical governance store. Nothing here is composed.*



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

*The other hand-written copy of this rule, from `CLAUDE.md`:*

**Every hunt report carries an EXPANSION section listing routes that did not
exist at session start.** For each one: **how it was conceived**, **the literal
query or URL** that produced it (not a description of the search — the text that
was typed), **what it returned including zero**, and **whether it generalises to
a class of entities**.

**A hunt report with an empty expansion section FAILS THE ITEM** — exactly as
"nothing further" already fails an exhaustion claim under RULING 90.

**A newly conceived route that returns nothing is a REPORTED SUCCESS, not a
defect. The invention is the deliverable, not the yield.** This clause is
load-bearing and it is the one most likely to be quietly ignored, because every
other rule in this file rewards rows found. A session that conceives four routes
and gets zero from all four has done what this asks, and its report says so
without apology.

*Why a required output rather than another principle.* A principle can be
satisfied by a session that believes it complied. This cannot: either there is a
route in the section that did not exist this morning, or there is not.

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

*The other hand-written copy of this rule, from `CLAUDE.md`:*

**Expansion is a NEW ROUTE TO A FIELD ALREADY OWED on the item list. A side
quest is a new capability, a new surface, new infrastructure, or work on a zip
that is not the current zip.**

Expansion is **required**. Side quests remain **forbidden** and become tracker
rows — writing the row is the whole response, unchanged. **A session citing
RULING 88 while building infrastructure has committed a scope breach and reports
it as one.**

*Why this ships in the same breath as RULING 88.* "You must invent new routes"
is one sentence away from "you may build anything you can justify", and that
reading would undo the scope discipline that keeps a session finishing what it
started. The test is about the DESTINATION, not the technique: does this route
end at a field the item list already owes?

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

*The other hand-written copy of this rule, from `CLAUDE.md`:*

**When a field is unfound after Tier A and Tier B — before any absence is
recorded, and before Tier C per-entity search begins — run five moves and record
the literal query text or URL and the result for each.**

1. **What would a person with a browser type right now?** Type it.
2. **What does the tier above publish about the tier below?** Federal publishes
   states; states publish counties and municipalities; counties publish towns
   and districts. Descend; do not guess sideways. (RULING 93.)
3. **What did entities of this same shape do?** If one township posts a clerk's
   PDF, the other twenty may. **Test the shape, not the instance.**
4. **Who else needed this badly enough to have compiled it already?** Courts,
   local news, League of Women Voters, unions, chambers of commerce, libraries,
   universities.
5. **One lateral query phrased exactly as "where else can I find this"** for the
   specific fact, on a general search engine.

Phrased as QUESTIONS rather than fixed URLs so they cannot go stale — and so
they cannot be completed, since the answer differs in every state.

**A recorded absence with no stuck-protocol block is VOID and the field returns
to owed.**

*Where it sits, exactly, and why.* After Tier A and Tier B, BEFORE Tier C. That
placement is the whole economy of it: per-entity search is the expensive tier,
and four of these five moves are broad routes that may answer for fifty entities
at once. NJ Hunt 4 spent its entire search budget on 272 individuals and never
once asked where all 272 live.

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

*The other hand-written copy of this rule, from `CLAUDE.md`:*

**Every hunt session regenerates `docs/credential-ledger.md` at session start by
CALLING each key.** A key not called this session is reported as **unproven** —
not assumed working, not carried forward from the last session's table. **An
invalid key opens a Needs Sean P1 row the same session.**

*Why calling and not reading.* The register can only say which files reference a
key. It cannot say whether the key works, and the difference has cost real
findings: `CENSUS_API_KEY` was invalid and nothing discovered it until something
finally hit the endpoint.

*And why the bar is "is the body ABOUT the thing asked for".* The Census host
answers a rejected key with **HTTP 200 and an HTML page titled "Invalid Key"**,
so a check written against the status code reads a dead credential as healthy.
The control is that the body parsed as the data requested, plus a deliberately
bogus second request that must come back DIFFERENT (RULING 68).

The generator is `scripts/credential-ledger.mts` (`pnpm credentials`), and the
artifact is never hand-edited (RULING 92).

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

*The other hand-written copy of this rule, from `CLAUDE.md`:*

**`docs/sources.md` carries a LAST-WALKED DATE on every entry, keyed or not**,
with the expiry discipline that already governs absences under RULING 53:
**candidate fields 7 days, bodies and rosters 14, walled sources 14.**

**A source past expiry is re-walked or reported STALE with its date. A source
walked but not recorded is a DEFECT**, because the next session re-derives it.

*Why sources and not just absences.* RULING 53 made an absence a measurement
with a shelf life. A source is the same kind of claim wearing a friendlier face
— *this endpoint answers, this licence permits, this is where the list lives* —
and every one of those can stop being true without anything here noticing. A
register with no dates cannot tell a session which of its rows are observations
and which are folklore.

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

*The other hand-written copy of this rule, from `CLAUDE.md`:*

**When the author finds a source, route, or fact the sessions did not, that is a
DEFECT IN THE DISCOVERY PROCESS**, handled like a named instance of a class-wide
defect in code. The next session answers three questions in its report:

1. **What procedure would have found this without him?**
2. **Why did that procedure not run?**
3. **What changed so it runs next time?**

**Absorbing the find as a new manifest entry and moving on is not an adequate
response** — that is fixing the named instance and reporting it closed, which
the named-instance rule already forbids everywhere else. **Manifest growth that
comes only from the author is the failure this ruling names.**

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

*The other hand-written copy of this rule, from `CLAUDE.md`:*

**In every hunt brief, expansion work is its own NUMBERED ITEM and is NEVER
LAST. This binds the chat writing briefs as much as the session executing
them.**

*The reason, stated plainly because it is a fact about how this system actually
behaves.* Whatever sits at item 1 eats the run. Expansion placed at the tail
never happens, because it is scheduled to begin after exhaustion — and
exhaustion never arrives, by design, since RULING 90 exists precisely to stop a
session declaring it. **A brief that puts exploration last has not
deprioritised it; it has cancelled it, while appearing to require it.**

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

*The other hand-written copy of this rule, from `CLAUDE.md`:*

**Every ruling is amendable. A ruling is changed only by a LATER DATED RULING
that names the number it supersedes, states what changed and why, and adds a
mapping line in BOTH `docs/rulings.md` and `CLAUDE.md`.**

**Rulings are never edited in place and never silently dropped.** A superseded
ruling stays in the file marked superseded, carrying its successor's number.

*The precedent, and the format.* On 2026-08-22 a brief adopted five rulings as
81 through 85 while a session earlier the same day had already spent 81 and 82.
Renumbering the two that shipped would have left dangling references in an
append-only record whose whole value is that it does not move. The five took 83
through 87 with a mapping table in both files. Every amendment takes that shape.

*Why the file and not memory.* A superseded ruling that is deleted comes back as
drift — something reads it, cites it, or reasons from it, and nothing says it
was overturned. That is the exact failure `docs/rulings.md` was created to end.

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

*The other hand-written copy of this rule, from `CLAUDE.md`:*

(Adopted 2026-08-26, Item 9. **Amends RULING 94** under the RULING 99
procedure. RULING 94's five moves stand, its placement between Tier B and Tier C
stands, and its void condition stands. What changes is what reaching the end of
them MEANS.)

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
That is the failure RULING 61 already named about the manifest — *trying
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
levying district because somebody has to be billed, the legal notice in a
newspaper of record, the budget and the audit, the minutes of the tier above
recording an appointment, the annual report, the state oversight directory.
**Those documents are where the dark bodies are**, and none of them was in the
ladder on the day this was adopted.

*This does not narrow RULING 144.* An argued absence may still be built from
walls and still expires the day a wall falls. What it forbids is arriving at
that argument by counting.

### RULING 177 — the subject universe may be bounded; the method never is

**THE UNIVERSE OF OWED SUBJECTS MAY BE BOUNDED. THE UNIVERSE OF METHODS IS
NOT. THE EFFORT PERMITTED TO COMPLETE AN OWED ITEM IS NOT ARBITRARILY CAPPED.**

This is the correction to two bad architectures at once.

**BAD:** try N things; N things failed; therefore absent.
**ALSO BAD:** follow every hyperlink forever; completion has no possible
boundary.

A current workstream may have a defined denominator. The discovery method
itself is permanently open-ended. **"Bounded universe" applies ONLY to the
subjects currently owed** — never to the method, the route manifest, the source
vocabulary, the platform vocabulary, the government-type vocabulary, or the
retrieval technique.

**A discovered route enlarges the active graph only when it plausibly advances
an owed question.** A government page does not recursively make every hyperlink
on the internet owed. That is what keeps this bounded without capping effort.

### RULING 178 — inherit everything, assume it is incomplete, keep the learning

**A method that works across 43 states is not "the method." It is the method
learned so far.**

If the repository knows 76 routes and those routes work across 43 states, that
means WE CURRENTLY KNOW 76 ROUTES. It does not mean THERE ARE 76 ROUTES. If the
next seven states require 11 more, the system learns those 11, records them,
classifies where they apply, and future sessions inherit all 87. Then 88. There
is no maximum.

- **A new route is PROJECT KNOWLEDGE, not session knowledge.** Every successful
  new avenue is persisted so another session never rediscovers it.
- **A failed inherited route is also knowledge.** It grows a sub-branch naming
  the jurisdictional shape it failed in and the date, and it is never deleted.
- **Every route carries applicability metadata.** Nationwide, state-specific,
  state-family, government-type, publisher, platform, document-type,
  jurisdiction, or **unknown portability — which is a VALID state.** Do not
  generalize farther than the evidence supports.
- **A NEW JURISDICTION IS PRESUMED CAPABLE OF TEACHING THE PROJECT A NEW
  METHOD.** "Nothing new learned" is a legitimate measured result only after
  genuine expansion work occurred. It may never be inferred merely because all
  inherited routes completed.
- **New knowledge reopens old conclusions.** When a route is learned, prior
  items recorded absent, blocked, dark or converged are identified
  MECHANICALLY, their exhaustion state is invalidated where the route applies,
  and they return to owed. This is structural, never something a future session
  is expected to remember.

**Inheritance is the STARTING advantage of a new state, never its constraint.**

### RULING 184 — blocked is a real state, and a finite attempt count never earns absence

**Delete the false binary `taken OR absent`.** Source and work dispositions
represent at least: `UNWALKED`, `DISCOVERED`, `IN_PROGRESS`, `INGESTED`,
`POINTER_ONLY`, `WALKED_NO_YIELD`, `BLOCKED_CURRENTLY`,
`REQUIRES_NEW_ADAPTER`, `RECORDS_REQUEST_PENDING`, `NOT_APPLICABLE`,
`RECHECK_DUE`.

A CAPTCHA is not absence. Missing tooling is not absence. A pending records
request is not absence. A third-party pointer is not necessarily something to
ingest. A presently prohibited route is not absence.

**Five moves, seven tiers, N routes, every manifest entry, every known branch —
these are FLOORS and instruments. Reaching their end never means "therefore the
information does not exist."**

If a session has no further avenue it says **"I have run out of ideas"**, which
is a claim about the session. It is never "the government does not publish
this", which is a claim about a government.

*(Pinned verbatim from `CLAUDE.md` by `scripts/context-file.mjs`. Every other
section of this file is an index; this one is the text, because the failure it
fixes is a session not knowing there was anything to look up.)*

---

## Rulings — 205 recorded

Source: `docs/rulings.md`, append-only. **This is an index, not the text.**
`CLAUDE.md` is law; these are the author's calls that are not, and a session
told to hardcode a ruling as fact reads the file rather than the chat it came
from. Each entry there names what it supersedes.

- RULING 1 — merge cadence  [R-0001 · LAW_DECISION · ACTIVE]
- RULING 2 — full-page screenshots are read as images  [R-0002 · LAW_DECISION · ACTIVE]
- RULING 3 — the organic census is closed as a question  [R-0003 · DECISION · ACTIVE]
- RULING 4 — `CLAUDE.md` has no rules 4g or 4h  [R-0004 · DECISION · ACTIVE]
- RULING 5 — `walk:all` does not tap reactions  [R-0005 · LAW_DECISION · ACTIVE]
- RULING 6 — the coverage tier vocabulary, used verbatim everywhere  [R-0006 · LAW_DECISION · ACTIVE]
- RULING 9 — Census counts governments; the product renders bodies  [R-0009 · DECISION · ACTIVE]
- RULING 10 — ZCTA is not a ZIP code  [R-0010 · DECISION · ACTIVE]
- RULING 12 — WALL versus JOB  [R-0012 · DECISION · ACTIVE]
- RULING 13 — a green build check does not mean the tests ran  [R-0013 · DECISION · ACTIVE]
- RULING 14 — path comparisons may not assume a separator  [R-0014 · DECISION · ACTIVE]
- RULING 15 — the Kearsarge 15-row floor is retired  [R-0015 · DECISION · ACTIVE]
- RULING 16 — the retrieval-mechanics ladder in `CLAUDE.md` is canonical  [R-0016 · LAW_DECISION · ACTIVE]
- RULING 17 — `walledAtRung` values written before F22 are provenance-unknown  [R-0017 · DECISION · ACTIVE]
- RULING 19 — the nonpartisanship and committee-sale section is deferred  [R-0019 · DECISION · ACTIVE]
- RULING 20 — portraits and PDF corpora do not go in git  [R-0020 · LAW_DECISION · ACTIVE]
- RULING 23 — the four-state field is data, not a gate  [R-0023 · LAW_DECISION · ACTIVE]
- RULING 24 — a check that cannot run says so  [R-0024 · LAW_DECISION · ACTIVE]
- RULING 25 — reader-facing behaviour is not degraded to fix an internal problem  [R-0025 · DECISION · ACTIVE]
- RULING 26 — SHOW EVERYTHING WE FIND  [R-0026 · LAW_DECISION · ACTIVE]
- RULING 27 — no suppression path may exist in the codebase  [R-0027 · LAW_DECISION · ACTIVE]
- RULING 28 — absence is one buried annotation per contest, never a per-field indicator  [R-0028 · LAW_DECISION · ACTIVE]
- RULING 29 — three priority levels, ranked inside a section and never across sections  [R-0029 · LAW_DECISION · ACTIVE]
- RULING 30 — five P1 rows maximum per section, and an over-cap section is STOPPED  [R-0030 · LAW_DECISION · ACTIVE]
- RULING 31 — Needs Sean is always the first section  [R-0031 · DECISION · ACTIVE]
- RULING 32 — every row has a home  [R-0032 · LAW_DECISION · ACTIVE]
- RULING 33 — gaps are not tracker rows  [R-0033 · LAW_DECISION · ACTIVE]
- RULING 34 — the reader artifacts are generated, and hold no duplicated content  [R-0034 · DECISION · ACTIVE]
- RULING 35 — every section is a queue that empties  [R-0035 · LAW_DECISION · ACTIVE]
- RULING 36 — three resolution states, and only these three  [R-0036 · DECISION · ACTIVE]
- RULING 37 — who may move a row  [R-0037 · LAW_DECISION · AMENDED]
- RULING 38 — the author's resolution notes are instructions, not commentary  [R-0038 · LAW_DECISION · ACTIVE]
- RULING 39 — resolution timestamps are written by the script, not by the spreadsheet  [R-0039 · DECISION · ACTIVE]
- RULING 40 — attribution has no soft landing  [R-0040 · DECISION · ACTIVE]
- RULING 41 — the author writes rows too  [R-0041 · LAW_DECISION · ACTIVE]
- RULING 42 — the page-level disclosure replaces `THIN_CANDIDATE_LINE`  [R-0042 · LAW_DECISION · ACTIVE]
- RULING 43 — a source may not report success with zero normalized rows from a non-zero fetch  [R-0043 · LAW_DECISION · ACTIVE]
- RULING 44 — per-card completeness statements are gone, in any wording  [R-0044 · LAW_DECISION · ACTIVE]
- RULING 45 — the Kelly standard, and there are no tiers of it  [R-0045 · LAW_DECISION · ACTIVE]
- RULING 46 — the author may delete a row outright; a session never may  [R-0046 · DECISION · ACTIVE]
- RULING 47 — the per-card issue count is removed  [R-0047 · LAW_DECISION · ACTIVE]
- RULING 48 — a session may not use git to revert the author's files  [R-0048 · DECISION · ACTIVE]
- RULING 49 — a merge to satisfy a mid-session instruction from the author does not count against the cadence  [R-0049 · LAW_DECISION · ACTIVE]
- RULING 50 — photos-first ordering is presentation; withholding data is suppression, and the two are never conflated again  [R-0050 · LAW_DECISION · ACTIVE]
- RULING 51 — the collection disclosure renders once per surface, and there are two surfaces  [R-0051 · LAW_DECISION · ACTIVE]
- RULING 52 — discovery is a tree, not a ladder  [R-0052 · LAW_DECISION · ACTIVE]
- RULING 53 — recorded absences expire  [R-0053 · LAW_DECISION · ACTIVE]
- RULING 54 — the filed mailing address renders  [R-0054 · LAW_DECISION · ACTIVE]
- RULING 55 — only a reviewed photo renders, and a decision is about an IMAGE  [R-0055 · LAW_DECISION · ACTIVE]
- RULING 56 — a scheduled job that fails tells someone  [R-0056 · LAW_DECISION · ACTIVE]
- RULING 57 — every twig is named  [R-0057 · LAW_DECISION · ACTIVE]
- RULING 59 — the page says one thing about completeness and nothing else  [R-0059 · DECISION · ACTIVE]
- RULING 60 — the session hand-works bodies, and that is the point  [R-0060 · LAW_DECISION · ACTIVE]
- RULING 61 — the branch manifest, and what exhaustion means  [R-0061 · LAW_DECISION · ACTIVE]
- RULING 62 — a test file may not lose guards silently  [R-0062 · LAW_DECISION · ACTIVE]
- RULING 63 — every zip inherits; no zip starts from scratch  [R-0063 · LAW_DECISION · ACTIVE]
- RULING 64 — shared office contacts are published, labeled as the office  [R-0064 · LAW_DECISION · ACTIVE]
- RULING 65 — the footer-address branch  [R-0065 · LAW_DECISION · ACTIVE]
- RULING 66 — Facebook by compliant routes only  [R-0066 · LAW_DECISION · ACTIVE]
- RULING 67 — an enumeration states its geography and is checked externally  [R-0067 · LAW_DECISION · ACTIVE]
- RULING 68 — control queries are mandatory  [R-0068 · LAW_DECISION · ACTIVE]
- RULING 69 — reference data belongs in the repo, named and refreshable  [R-0069 · LAW_DECISION · ACTIVE]
- RULING 70 — Ballotpedia is not scraped  [R-0070 · LAW_DECISION · ACTIVE]
- RULING 71 — a zip cannot answer "who governs you"; a street address can  [R-0071 · DECISION · ACTIVE]
- RULING 72 — a walled host is never evidence a body is unreachable  [R-0072 · LAW_DECISION · ACTIVE]
- RULING 73 — large reference documents: commit the CONTENT, never the binary  [R-0073 · DECISION · ACTIVE]
- RULING 74 — an address, once given, is never asked for twice  [R-0074 · DECISION · ACTIVE]
- RULING 75 — a close-out commit is gated like any other commit to `main`  [R-0075 · LAW_DECISION · ACTIVE]
- RULING 76 — session-dated scripts are COMMITTED, and held to every standard  [R-0076 · LAW_DECISION · ACTIVE]
- RULING 77 — verify locally, ship once  [R-0077 · LAW_DECISION · ACTIVE]
- RULING 78 — CI runs where it earns its cost  [R-0078 · LAW_DECISION · AMENDED]
- RULING 79 — a ruling closes the Needs Sean row it answers  [R-0079 · LAW_DECISION · ACTIVE]
- RULING 80 — the committed geometry follows the reader, not the county  [R-0080 · LAW_DECISION · ACTIVE]
- RULING 81 — an exhausted Actions balance is not a broken tree  [R-0081 · LAW_DECISION · ACTIVE]
- RULING 82 — the job watcher's sampling was the defect, not its logic  [R-0082 · LAW_DECISION · ACTIVE]
- RULING 83 — the free-source floor  [R-0083 · LAW_DECISION · ACTIVE]
- RULING 84 — the manifest is tiered, and walked in order  [R-0084 · LAW_DECISION · AMENDED]
- RULING 85 — the two-click test  [R-0085 · LAW_DECISION · ACTIVE]
- RULING 86 — per-state source enumeration precedes the hunt  [R-0086 · LAW_DECISION · ACTIVE]
- RULING 87 — Wikipedia is a Tier A discovery source, never a source of record  [R-0087 · LAW_DECISION · ACTIVE]
- RULING 88 — the expansion requirement  [R-0088 · LAW_DECISION · ACTIVE]
- RULING 89 — expansion is not a side quest  [R-0089 · LAW_DECISION · ACTIVE]
- RULING 90 — exhaustion must be argued, not asserted  [R-0090 · LAW_DECISION · ACTIVE]
- RULING 91 — every key in `.env.local` is a Tier A route and is walked  [R-0091 · DECISION · ACTIVE]
- RULING 92 — fix the generator, never the artifact  [R-0092 · LAW_DECISION · AMENDED]
- RULING 93 — ask what the tier above publishes about the tier below  [R-0093 · LAW_DECISION · ACTIVE]
- RULING 94 — the stuck protocol  [R-0094 · LAW_DECISION · AMENDED]
- RULING 95 — credentials are proven, not assumed  [R-0095 · LAW_DECISION · ACTIVE]
- RULING 96 — sources have freshness  [R-0096 · LAW_DECISION · ACTIVE]
- RULING 97 — a founder find is a class-wide defect  [R-0097 · LAW_DECISION · ACTIVE]
- RULING 98 — exploration holds a guaranteed position in item order  [R-0098 · LAW_DECISION · ACTIVE]
- RULING 99 — the amendment procedure  [R-0099 · LAW_DECISION · AMENDED]
- RULING 100 — a partial answer that adds up is still a wrong answer  [R-0100 · LAW_DECISION · ACTIVE]
- RULING 101 — our own identifier never leaves our own site  [R-0101 · LAW_DECISION · ACTIVE]
- RULING 102 — fixing the recipe is not finished until you re-cook the dish  [R-0102 · LAW_DECISION · ACTIVE]
- RULING 103 — a sweep looks for the same code twice, not just the same symptom  [R-0103 · LAW_DECISION · ACTIVE]
- RULING 104 — a file you put in the repo is something a session must go and read  [R-0104 · LAW_DECISION · AMENDED]
- RULING 105 — say what is rendering, what is out of scope, and what is still dark  [R-0105 · LAW_DECISION · ACTIVE]
- RULING 106 — no generated file has a size limit  [R-0106 · LAW_DECISION · ACTIVE]
- RULING 107 — a freshness date is written only by the code that read the source  [R-0107 · LAW_DECISION · ACTIVE]
- RULING 108 — anything a session must read at the start lives in the repository  [R-0108 · LAW_DECISION · ACTIVE]
- RULING 109 — a brief says what it needs to run, and the session checks before item one  [R-0109 · LAW_DECISION · ACTIVE]
- RULING 110 — a search that finds nothing must show it looked in the right FORM  [R-0110 · LAW_DECISION · ACTIVE]
- RULING 111 — a join is never a lookup for a fact that lives on only one side  [R-0111 · LAW_DECISION · ACTIVE]
- RULING 112 — a first-party instrument is symmetric by construction, or it is not shipped  [R-0112 · LAW_DECISION · ACTIVE]
- RULING 113 — a step that reports success is asked whether it did the thing  [R-0113 · LAW_DECISION · ACTIVE]
- RULING 114 — a layer that always renders must be right, because finishing it removed the honest silence  [R-0114 · LAW_DECISION · ACTIVE]
- RULING 115 — a drill is not a failure, and an alarm that cannot tell them apart spends the next real one  [R-0115 · LAW_DECISION · ACTIVE]
- RULING 116 — a guard may pin an invariant or a direction, never the size of a gap  [R-0116 · LAW_DECISION · ACTIVE]
- RULING 117 — the asset store has a public address, and a restore is proved by hash  [R-0117 · LAW_DECISION · ACTIVE]
- RULING 118 — an appointed official never carries the govern verb  [R-0118 · LAW_DECISION · ACTIVE]
- RULING 119 — a sovereign tribal nation is its own category of government  [R-0119 · LAW_DECISION · ACTIVE]
- RULING 120 — equal solicitation is the obligation; who buys is not  [R-0120 · LAW_DECISION · AMENDED]
- RULING 121 — one body that spans two towns has one identity, and renders in both  [R-0121 · LAW_DECISION · ACTIVE]
- RULING 122 — a page on a party's own site can be a candidate's page, with the host named  [R-0122 · LAW_DECISION · ACTIVE]
- RULING 123 — the author's decisions of 2026-08-24, recorded as a batch  [R-0123 · LAW_DECISION · ACTIVE]
- RULING 124 — a commit that cannot change what a reader sees does not cost a deploy  [R-0124 · LAW_DECISION · ACTIVE]
- RULING 125 — verification happens on the local production build; production is the delivery truck, not the test bench  [R-0125 · LAW_DECISION · ACTIVE]
- RULING 126 — campaign-finance data renders for readers and never enters anything sold  [R-0126 · LAW_DECISION · ACTIVE]
- RULING 127 — no tool prints a credential value, and the guard is the values themselves  [R-0127 · LAW_DECISION · ACTIVE]
- RULING 128 — extraction conserves: every input has exactly one disposition, and the sum is exact  [R-0128 · LAW_DECISION · ACTIVE]
- RULING 129 — a safety cap is a failure boundary, never an implicit end of data  [R-0129 · LAW_DECISION · ACTIVE]
- RULING 130 — every transport success passes one shared document finalizer  [R-0130 · LAW_DECISION · ACTIVE]
- RULING 131 — a partial source is a first-class result, and completeness is never inferred from `ok: true`  [R-0131 · LAW_DECISION · ACTIVE]
- RULING 132 — the identity boundary is proven over VALUE SPACES, not column names  [R-0132 · LAW_DECISION · ACTIVE]
- RULING 133 — a performance change ships with its measurement  [R-0133 · LAW_DECISION · ACTIVE]
- RULING 134 — an instrument without a committed baseline is unfinished  [R-0134 · LAW_DECISION · ACTIVE]
- RULING 135 — a fence bars acting on content, never committing Sean's artifacts  [R-0135 · LAW_DECISION · ACTIVE]
- RULING 136 — feedback names examples; a fix closes the class  [R-0136 · LAW_DECISION · ACTIVE]
- RULING 137 — for layout, an annotated image is the spec, and it outranks prose  [R-0137 · LAW_DECISION · ACTIVE]
- RULING 138 — display consolidates sources; the record is never deleted  [R-0138 · LAW_DECISION · ACTIVE]
- RULING 139 — the product never announces its own failure  [R-0139 · LAW_DECISION · ACTIVE]
- RULING 140 — dates spell out, product-wide  [R-0140 · LAW_DECISION · ACTIVE]
- RULING 141 — the Speak Your Mind store's four rules  [R-0141 · LAW_DECISION · ACTIVE]
- RULING 142 — the line in the sand, and nothing collected before it is ever sold  [R-0142 · LAW_DECISION · ACTIVE]
- RULING 143 — what DONE means for 07866, and it is per candidate  [R-0143 · LAW_DECISION · ACTIVE]
- RULING 144 — an argued absence may be built from walls, and it expires the day a wall falls  [R-0144 · LAW_DECISION · ACTIVE]
- RULING 145 — a platform-hosted campaign presence fills the campaign-site field, with the host labelled  [R-0145 · LAW_DECISION · ACTIVE]
- RULING 146 — a session runs unattended, and nothing it runs may be able to ask it a question  [R-0146 · LAW_DECISION · ACTIVE]
- RULING 147 — no reconciliation may compare a parser to itself  [R-0147 · LAW_DECISION · ACTIVE]
- RULING 148 — the may-we-walk verdict is enforced by the fetcher, never remembered by a session  [R-0148 · LAW_DECISION · ACTIVE]
- RULING 149 — the coverage matrix is generated, internal, and never rendered to a reader  [R-0149 · LAW_DECISION · ACTIVE]
- RULING 150 — a Needs Sean row states its ask as an answerable question, with options  [R-0150 · LAW_DECISION · ACTIVE]
- RULING 151 — Sean's tracker decisions of 2026-08-25, recorded as a batch  [R-0151 · LAW_DECISION · ACTIVE]
- RULING 152 — a reader-facing DONE names the production deploy that is serving it  [R-0152 · LAW_DECISION · ACTIVE]
- RULING 153 — a fix is verified on the reader's path, not on the path that satisfies the assertion  [R-0153 · LAW_DECISION · ACTIVE]
- RULING 154 — the Speak Your Mind disclosure leaves the panel, and the commitment does not  [R-0154 · DECISION · ACTIVE]
- RULING 155 — a session may not claim local gates green unless it ran the gate set CI requires, and named each one  [R-0155 · LAW_DECISION · ACTIVE]
- RULING 156 — a required check is registered by NAME, and a rename disarms protection in silence  [R-0156 · LAW_DECISION · ACTIVE]
- RULING 157 — a fix is verified against a case it was NOT derived from  [R-0157 · LAW_DECISION · ACTIVE]
- RULING 158 — a shed requires a measurement and a reason, or it is an unfinished session  [R-0158 · LAW_DECISION · ACTIVE]
- RULING 159 — a counting script fails loudly when its denominator is zero  [R-0159 · LAW_DECISION · ACTIVE]
- RULING 161 — Sean's tracker decisions of 2026-08-26, recorded as a batch  [R-0161 · DECISION · ACTIVE]
- RULING 162 — a bypass is only as safe as the paths it can carry  [R-0162 · LAW_DECISION · ACTIVE]
- RULING 163 — the answer to "is the protection still what we think" is a command  [R-0163 · LAW_DECISION · ACTIVE]
- RULING 164 — a workflow reports every failure, not just the first  [R-0164 · LAW_DECISION · ACTIVE]
- RULING 165 — the scheduled pushers authenticate as a deploy key, and the private half is never held  [R-0165 · LAW_DECISION · ACTIVE]
- RULING 166 — the body's own publication is rung one, and its bulk download is rung zero  [R-0166 · LAW_DECISION · ACTIVE]
- RULING 167 — donor rendering is AGGREGATE ONLY, and no individual donor name or address renders anywhere  [R-0167 · LAW_DECISION · ACTIVE]
- RULING 169 — a walk is COUNTED or it did not happen  [R-0169 · LAW_DECISION · ACTIVE]
- RULING 170 — no number of attempts earns an absence, and a protocol that TERMINATES is not persistence  [R-0170 · LAW_DECISION · ACTIVE]
- RULING 171 — A BALLOT MEASURE IS DONE AT SEVEN FIELDS, AND THE MONEY IS A PAIR  [R-0171 · LAW_DECISION · ACTIVE]
- RULING 172 — current authority and history are separate systems  [R-0172 · LAW_DECISION · ACTIVE]
- RULING 173 — CLAUDE.md is the root constitution and carries current law only  [R-0173 · LAW_DECISION · ACTIVE]
- RULING 174 — binding authority requires author provenance  [R-0174 · LAW_DECISION · ACTIVE]
- RULING 175 — supersession is structured data, and a partial amendment names both halves  [R-0175 · LAW_DECISION · ACTIVE]
- RULING 176 — governance changes are atomic  [R-0176 · LAW_DECISION · ACTIVE]
- RULING 177 — the subject universe may be bounded; the method never is  [R-0177 · LAW_DECISION · ACTIVE]
- RULING 178 — inherit everything, assume it is incomplete, keep the learning  [R-0178 · LAW_DECISION · ACTIVE]
- RULING 179 — convergence is versioned, and completion is derived from child state  [R-0179 · LAW_DECISION · ACTIVE]
- RULING 180 — session status, workstream status and graph status are three different facts  [R-0180 · LAW_DECISION · AMENDED]
- RULING 181 — a frontier is state, not a recipe for recreating state  [R-0181 · LAW_DECISION · ACTIVE]
- RULING 182 — permission state and transport state are orthogonal  [R-0182 · LAW_DECISION · ACTIVE]
- RULING 183 — a lead is not a body  [R-0183 · LAW_DECISION · ACTIVE]
- RULING 184 — blocked is a real state, and a finite attempt count never earns absence  [R-0184 · LAW_DECISION · ACTIVE]
- RULING 185 — the authority precedence model  [R-0185 · LAW_DECISION · ACTIVE]
- RULING 186 — a session opens on task-relevant current authority, never on the full history  [R-0186 · LAW_DECISION · ACTIVE]
- RULING 188 — the descent freezes only for the minimum safe state cutover  [R-0188 · LAW_DECISION · ACTIVE]
- RULING 189 — a session does not measure its own context, and stops for real reasons only  [R-0189 · LAW_DECISION · ACTIVE]
- `package.json`'s `scripts` block is the list.  [R-C-commands-package-json-s-scripts-block-is-the-list · LAW_DECISION · ACTIVE]
- More principles will not fix this.  [R-C-discovery-conduct-more-principles-will-not-fix-this · LAW_DECISION · ACTIVE]
- THE REPORT CONTRACT IS A FILE NOW, AND IT IS AMENDED RATHER THAN REINVENTED  [R-C-discovery-conduct-the-report-contract-is-a-file-now-and-it-is-am · LAW_DECISION · ACTIVE]
- Why this section exists, and it is a diagnosis rather than an exhortation.  [R-C-discovery-conduct-why-this-section-exists-and-it-is-a-diagnosis · LAW_DECISION · ACTIVE]
- `docs/sources.md` IS THE SOURCE OF RECORD FOR WHAT RESOURCES EXIST.  [R-C-external-sources-docs-sources-md-is-the-source-of-record-for-wha · LAW_DECISION · ACTIVE]
- The register is `docs/sources.md`, and this section is the law that governs it.  [R-C-external-sources-the-register-is-docs-sources-md-and-this-sectio · LAW_DECISION · ACTIVE]
- THE DEFERRAL BOUNDARY FALLS BETWEEN SUBJECTS, NEVER INSIDE ONE  [R-C-non-negotiables-in-code-the-deferral-boundary-falls-between-subj · LAW_DECISION · ACTIVE]
- THE LADDER, EXHAUSTIVELY — AND IT IS THE ONLY NUMBERED ONE  [R-C-non-negotiables-in-code-the-ladder-exhaustively-and-it-is-the-on · LAW_DECISION · ACTIVE]
- THE TRANSPARENCY MANDATE  [R-C-non-negotiables-in-code-the-transparency-mandate · LAW_DECISION · ACTIVE]
- Candidates  [R-C-reaction-capture-candidates · LAW_DECISION · ACTIVE]
- Disclosure at the point of capture — the one-time acknowledged notice.  [R-C-reaction-capture-disclosure-at-the-point-of-capture-the-one-time · LAW_DECISION · ACTIVE]
- Incumbent and challenger reactions are stored and aggregated in separate buckets.  [R-C-reaction-capture-incumbent-and-challenger-reactions-are-stored-a · LAW_DECISION · ACTIVE]
- Measures  [R-C-reaction-capture-measures · LAW_DECISION · ACTIVE]
- Moderation runs before any export.  [R-C-reaction-capture-moderation-runs-before-any-export · LAW_DECISION · ACTIVE]
- The free-text input carries a threat notice.  [R-C-reaction-capture-the-free-text-input-carries-a-threat-notice · LAW_DECISION · ACTIVE]
- An agent does not know today's date, and a date not read from the system clock is a fabrication.  [R-C-repo-layout-an-agent-does-not-know-today-s-date-and-a-date-not-r · LAW_DECISION · ACTIVE]
- One CODE merge per session; close-out records may follow as separate named commits.  [R-C-repo-layout-one-code-merge-per-session-close-out-records-may-fol · LAW_DECISION · ACTIVE]
- Priority is three levels, ranked inside a section and never across them  [R-C-repo-layout-priority-is-three-levels-ranked-inside-a-section-and · LAW_DECISION · ACTIVE]
- Task status lives in the TWO TRACKER STORES, and the tracker is a queue that empties.  [R-C-repo-layout-task-status-lives-in-the-two-tracker-stores-and-the · LAW_DECISION · ACTIVE]
- The one exception, and it is the only one  [R-C-repo-layout-the-one-exception-and-it-is-the-only-one · LAW_DECISION · ACTIVE]
- The tree is the tree; read it.  [R-C-repo-layout-the-tree-is-the-tree-read-it · LAW_DECISION · ACTIVE]
- Every export reports its confidence mix.  [R-C-signal-integrity-every-export-reports-its-confidence-mix · LAW_DECISION · ACTIVE]
- This section names DECISIONS, never versions.  [R-C-stack-this-section-names-decisions-never-versions · LAW_DECISION · ACTIVE]
- Correct first. Fast second. Nothing third.  [R-C-the-order-of-every-trade-correct-first-fast-second-nothing-third · LAW_DECISION · ACTIVE]
- The repeatability bar (2026-08-20)  [R-X-the-repeatability-bar-2026-08-20 · DECISION · ACTIVE]
- The zip order (2026-08-20)  [R-X-the-zip-order-2026-08-20 · DECISION · ACTIVE]

## P0 tracker rows — 93 of 456 rows

Source: `docs/tracker.csv`, every row with Priority `P0`. Notes clipped to 130 characters.

| ID | Item | Status | Note |
|---|---|---|---|
| A07 | No-source refusal behavior | Done | Build as a constraint on A01, in the same PR. Do not ship a natural-language entry point without it. \|\| 2026-08-17 (g11). VERIFIE… |
| B06 | Document idea origin date | Done | 2026-08-17 CLOSED BY THE AUTHOR, disposition verbatim: "Idea on 8/7/2026". IDEA ORIGIN DATE RECORDED: 2026-08-07. Stated by the a… |
| B11 | Statewide executives - the governor joins who-governs (item 2… | Done | 2026-08-14 (third 08-14 session). Verified: AZ Hobbs 602-542-4331 + engage@az.gov off /constituent-services (draft path 404d, cor… |
| B13 | The thin-candidate line, and equal effort per candidate (item… | Done | 2026-08-14 (the tester's mobile pass). tests/candidate-cards.test.ts +3 tests. Thin count 101/136 by a heuristic walk of the thre… |
| D07 | OCD-ID resolution layer | Not started | 2026-08-11: the canonical OCD list (opencivicdata/ocd-division-ids, identifiers/country-us.csv) uses cd:at-large, not cd:1. Verif… |
| D09 | ZCTA centroid table - full | Done | Minutes of work. Highest demo-quality-per-effort item on the board. Do first. 2026-08-11 done: pnpm zcta:fetch run, lib/geo/zcta-… |
| D14 | Vendor and statute review per source | Done | Blocks D12 and D13. Created 2026-08-12 because D01 was scoped without any of it. Each finding must also answer the state-law ques… |
| D15 | Decide the OCD-ID convention and reconcile to the canonical l… | Done | 2026-08-12. Was docs/state.md 5.2 item 8 ('verify before Phase 5'); checked and it fails, so it is now a blocker for Phase 4.6 ra… |
| D26 | Meetings snapshot - the committed file production reads | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. Built: snapshot module with validation refusing count-less or all-failed snap… |
| D32 | Officials become people you can actually reach (3a-3e) | Done | 2026-08-14, branch claude/restore-representation-session-0814 (second session). 3a: Officeholder gained email; the Plural adapter… |
| D33 | AZ and NH ballot surfaces (S3, into S2's shape) | Done | 2026-08-14, branch claude/restore-representation-session-0814 (second session). ARIZONA (data/ballot/az-pima-2026.json): transcri… |
| D37 | NH 2026 ballot measures - the earned absence | Done | 2026-08-17: seven CACRs enumerated via LegiScan/CitizensCount/news, ALL dead (CACR 6 ITL 01/07; 12 failed House 3/5 05/14 193-148… |
| D38 | Coverage completeness audit - the official universe | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. Official universe measured: Pima 50 / Morris 98 / Merrimack 63 governments… |
| D39 | Sunnyside and Amphitheater wired live — the author's catch cl… | Done | 2026-08-18 (session date; wall clock 2026-08-14), branch claude/fec-funding-and-final-prep-0818. THE HONEST DIAGNOSIS FIRST: the… |
| D40 | FEC replication bug: one campaign books on three officials (c… | Done | Fix: target moved into the PATH (app/api/funding/[target]/route.ts, old query route deleted; funding-block fetches path form) - e… |
| D44 | FEC snapshot thin-guard - a shrinking book never ships silent… | Done | 2026-08-14 (second 08-14 session) branch claude/pipeline-proof-and-potholes-0814. lib/funding/guard.ts findShrinkRegressions (pur… |
| D50 | Photos round 2 - door 2 opens and the chamber tier ships (ite… | In progress | 2026-08-15 (round 3). 535 of 750 -> 590 of 750; 69 portraits shipped under door 2 (24 NH senators, 25 NH representatives, 20 cura… |
| D66 | The meetings snapshot counts two things and states one number | Done | 2026-08-17 (hotfix-0817, branch claude/h2-carry-forward-truth-0817). test 751 of 751 pass (13 new this session: 10 in tests/snaps… |
| F22 | Refresh meetings snapshot has been red since 2026-08-19 and t… | Done | 2026-08-20 (F22 items 1-3, branch claude/f22-refresh-red-0820). THE FIX IS ONE LINE OF SEMANTICS: tests/coverage-manifest.test.ts… |
| G01 | Who Governs Here states one number for one list | Done | 2026-08-17 (g6 item 1a, branch claude/g6-consolidation-0817): fixed. The brief's named suspect was HALF WRONG - the Public Housin… |
| G02 | Every route refuses an unrecognised or malformed parameter | Done | 2026-08-17 (g6 item 1b, branch claude/g6-consolidation-0817): fixed. ROOT CAUSE: Number(params.get('lat')) - params.get returns n… |
| G03 | walk:all prints its own census so no session transcribes a co… | Done | 2026-08-17 (g6 item 1c, branch claude/g6-consolidation-0817): reconciled by enumeration. NOTHING WAS LOST. Enumerated every check… |
| G11 | The meetings count agrees with itself in four places | Done | 2026-08-17 (g6 item 1d, branch claude/g6-consolidation-0817-b): CONFIRMED, not fixed - there was no live defect. One run, four zi… |
| M01 | Map entry screen | Done | Map entry, ZCTA fly-to, venue-grouped pins, meeting panel, empty-state cascade with tier reported on screen. Evidence: branch cla… |
| M08 | MapLibre vector tile fix | Done | RESOLVED 2026-08-11 - see the RESOLUTION paragraph at the end; the diagnosis before it was partly wrong and is kept for the recor… |
| M23 | Officials and representation vanished at the exact tier - res… | Done | 2026-08-14 branch claude/restore-representation-session-0814. Fix: render gate extracted to lib/registry/representation.ts (shoul… |
| M24 | Reset all did not work - reset registry and honest active cou… | Done | 2026-08-14 branch claude/restore-representation-session-0814. Structural fix per the count-invariant family: lib/state/reset.ts i… |
| M26 | S1 - the reader disambiguation prompt (4.6.3/4.6.3c) | Done | DEFERRED 2026-08-14, two reasons recorded honestly: (1) the approved verbatim wording is NOT in the repo - state.md says it was s… |
| M27 | District-type checkboxes dead while the overlay is off | Done | 2026-08-14, branch claude/restore-representation-session-0814 (second session). Fix is intent, not plumbing: touching the distric… |
| M28 | Friction batch 2a-2j from the author's production pass | Done | 2026-08-14, branch claude/restore-representation-session-0814 (second session). 2a lib/registry/links.ts: Google universal link (… |
| M29 | Welcome mission text and the license wording | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. 1a: mission text replaced verbatim (six sentences), zip entry and one-tap e… |
| M30 | Kelly-standard candidate cards on the ballot | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. components/ballot/candidate-card.tsx renders every candidate as a card; dat… |
| M32 | Newbury select-board fact and explainer | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. coverage-notice.tsx renders the fact line + all Selectboard members (genera… |
| M33 | Save my picks - device-local ballot marking | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. lib/ballot/picks.ts (single key, no network - pinned by tests/ballot-picks.… |
| M35 | Meetings surfaces - past variant + add-to-calendar + county p… | Done | 2026-08-17 branch claude/final-prep-nh-nj-depth-0817. 6a: past-meeting variant in meeting-popup.tsx (VENUE_MAP rung dropped when… |
| M46 | Rockaway mayor wore Tucson's language - cross-jurisdiction gu… | Done | 2026-08-14 (third 08-14 session). Audit found the mayor blurb was the ONLY contamination. GATE PASSED: walk0814c-07866-mayor-GATE… |
| M47 | Every district layer defaults ON - Kearsarge renders at 03255… | Done | 2026-08-14 (third 08-14 session). Rejected alternative recorded in lib/state/defaults.ts: the one-type-per-tier legibility defaul… |
| M48 | Officials group in three tiers everywhere - Local / State / F… | Done | 2026-08-14 (third 08-14 session). The who-governs card and the officials door both render the three headers; the door gained the… |
| M49 | The ballot becomes a call to action (item 4) | Done | 2026-08-14 (third 08-14 session). lib/calendar/event-links.ts pure + tested (all-day and timed shapes); meetings and ballot dates… |
| M52 | Overlays stop pushing history - the phone modal killer (the w… | Done | 2026-08-14 (third 08-14 session). Found by the walk clicking instead of believing green. Branch claude/tester-feedback-0814; test… |
| M53 | Arizona bled into New Hampshire through the ask box (item 1,… | Done | 2026-08-14 (the tester's mobile pass). tests/jurisdiction-content.test.ts +3 tests; regression proven by reintroducing the string… |
| M54 | The ballot was unreachable on a phone (item 2) | Done | 2026-08-14 (the tester's mobile pass). Verified in-browser at 390x844: bubble tappable at y=12, entry at y=180 pinned while the b… |
| M55 | Fixed controls sat over readable content at phone width (item… | Done | 2026-08-14 (the tester's mobile pass). Re-measured in-browser: sidebar-toggle clear, maplibregl-ctrl-top-right clear, legend clea… |
| M57 | The sidebar counters stated numbers their own doors contradic… | Done | 2026-08-15. Measured on production at all four zips before fixing (85701 officials 6 vs 24, bodies 13 vs 60; 07866 officials 6 vs… |
| M58 | Concluded meetings rendered nowhere - the Concluded chip was… | Done | 2026-08-15. Per-adapter denominators recorded in docs/source-ladder.md: 6 of 9 adapters already served history; apptegy did not (… |
| M60 | Mojibake in every candidate blurb attribution (item 3) | Done | 2026-08-15. Repaired at the data, never at the render: 158 sequences in the cards file, 34 regenerated out of docs/photo-report.m… |
| M61 | Party missing on who-governs rows (item 4) | Done | 2026-08-15. All three governors now carry a party from the election authority's own certified filing, cited per row: Hobbs Democr… |
| M86 | The division battlecard denied its own officeholders — a clas… | Done | 2026-08-15 (the truth session, branch claude/truth-session-0815). DIAGNOSED BEFORE FIXING, and the diagnosis narrows the author's… |
| P11 | Reaction outcome honesty - success earned by the 204 | Done | 2026-08-14 (second 08-14 session) branch claude/pipeline-proof-and-potholes-0814. lib/reactions/client.ts returns COUNTED/NOT_COU… |
| R01 | CLAUDE.md clobbering guard | Done | It will recur. The Drive mirror is a hedge, not a fix. If CLAUDE.md is ever tiny, restore it - never reconstruct from memory. \|\|… |
| R12 | Deploy pipeline pinned - netlify.toml and the unlisted posture | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. netlify.toml written (corepack enable && corepack pnpm run build; NODE_VERSIO… |
| R34 | Local development can no longer write to the production datab… | Done | 2026-08-17 (g7) THE BRACES SHIPPED AND ARE PROVED; THE BELT SHIPPED IN ITS STRONGEST AVAILABLE FORM; ONE HALF IS THE AUTHOR'S HAN… |
| R47 | NAMED REGRESSION: zooming out to z7 at 85701 wipes every pin | Done | FOUND 2026-08-18 (g13) by pnpm walk:all, which is exactly what that suite exists for - the check carries g3 as its shipping sessi… |
| R51 | Netlify stopped building on push: g15 merged to main and no d… | Done | 2026-08-18 (g15, branch claude/g15-audit-and-final-queue-0818). FOUND AT HANDOFF, and the diagnosis is NOT the one it first looke… |
| V02 | Use Locunity for a week | Done | 2026-08-17 CLOSED BY THE AUTHOR, disposition verbatim: "Already used, no issues. Close" (g7). |
| X04 | Two standing rules adopted into CLAUDE.md (item 7) | Done | 2026-08-14 (third 08-14 session). tests/org-characterization.test.ts. The rules are law regardless of guard reach. Branch claude/… |
| X08 | The transparency mandate and the fourteen-rung ladder become… | Done | 2026-08-16 (h item 0), branch claude/h-03255-depth-0816. FIRST ACTION of the session, before any retrieval, because this session'… |
| F01 | The author's 2026-08-18 testing pass: 40-odd findings across… | In progress | OPENED 2026-08-18 (g16, branch claude/g16-deploy-leaks-queue-0818). NOT BUILT THIS SESSION AND THAT IS THE DISPOSITION, not a sho… |
| D68 | A data-fetch script overwrote verified data with less of it,… | Open | Opened 2026-08-18 (g19 item 4). MITIGATED, NOT CLOSED. Three things landed with it: the resolver's merge is now non-destructive b… |
| D01 | Legistar adapter | Done | 2026-08-13 DONE VIA D12 AND THE COMPOSITE: real municipal agendas replaced the mock as the app active source. This row scoped the… |
| D10 | Persistence design for meetings | Done | Blocks D01 for scheduled ingestion. Does NOT block the demo - the Legistar spike can fetch live with an in-memory cache and no da… |
| D11 | Legistar live spike for demo jurisdictions | Done | Pick the cities to match the buyer call list. Someone typing their own city and seeing their real council agenda is the demo. 202… |
| D12 | Legistar Web API adapter | Done | Documented OData v3 API at webapi.legistar.com/v1/{client}/events, docs at webapi.legistar.com/Home/Examples. GET returns only it… |
| D27 | Morris County (IQM2) and Merrimack County (Revize) adapters | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. iqm2: built on Citizens/Calendar.aspx?From=&To= (server-rendered with future… |
| D59 | One person, one photo - photos key to the PERSON (item 6b) | Done | Done 2026-08-15. Audit first (scripts/photo-person-audit.mts, 813 photo rows, 795 distinct people): Hobbs was one of NINE, not on… |
| HUNT01 | The 03255 depth sweep across the full body universe | Not started | 2026-08-16 (h item 2), branch claude/h-03255-depth-0816. DEFERRED WHOLE, NOTHING HALF-BUILT. 2 subjects were touched (Kearsarge m… |
| M02 | Zip to district disambiguation | Done | Zip is orientation only, never district truth. 2026-08-11: M03 makes the problem visible - turn on Show districts and a zip strad… |
| M06 | Agenda hyperlink on every upcoming item | Done | Agenda link renders on every item that has one. Evidence: components/map/meeting-panel.tsx. 2026-08-12 REOPENED: the links did no… |
| M141 | The meetings panel renders empty until the mouse moves - a pa… | Done | 2026-08-17 (g6 item 3, branch claude/g6-consolidation-0817-b): CLOSED on measurement, with the mechanism named from the code rath… |
| M142 | A carried meeting row never inherits the snapshot's freshness | Done | 2026-08-17 (hotfix-0817, branch claude/h2-carry-forward-truth-0817). test 751 of 751 pass (13 new this session: 10 in tests/snaps… |
| M17 | Resolve the place/cousub duplicate at build time with FUNCSTA… | Done | 2026-08-12, branch claude/coverage-language-and-registry-dedupe. DONE: test (79 pass), lint, build all green. THE BRIEF WAS WRONG… |
| P02 | Ballot mapping | In progress | \|\| 2026-08-19 (g20 item 2c). BUILT, on D05 which shipped in the same commit. lib/candidates/issues.ts is the curated issue vocabu… |
| P03 | Reaction capture | In progress | 2026-08-15 THE SENSOR IS LIVE FOR FEDERAL VOTES (branch claude/reactions-and-plain-language-0815). Do you like this vote? Yes/No/… |
| A10 | The everyday-topics map - the pothole standard | Done | 2026-08-14 (second 08-14 session) branch claude/pipeline-proof-and-potholes-0814. Grid FINAL after in-browser verification: 9 top… |
| D30 | Search logging and the transparency page - shipped together | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. tests/search-log.test.ts pins the coupling structurally (log module present -… |
| HUNT02 | Body enumeration per unit - the missing second layer of the w… | Not started | 2026-08-16 (h item 1, found by building the denominator). THE FINDING, which is the reason this row exists: the 2022 Census of Go… |
| HUNT04 | The 03255 candidate sweep - 47 candidacies to the Kelly stand… | Not started | 2026-08-16 (h item 3). DEFERRED WHOLE. THE DENOMINATOR IS ALREADY FROZEN and that is the half that exists: the 2026 New Hampshire… |
| M22 | Responsive - the demo is opened on a phone | Done | 2026-08-13, branch claude/deploy-snapshot-and-demo. Gate met: all four zips screenshotted at 390x844 (screenshots/phone-{85701,85… |
| R23 | Turbopack: 'Dynamic filesystem access causes tracing of the w… | Done | CLOSED 2026-08-17 (g8), branch claude/g8-deploy-and-g7-queue-0817; test/lint/build all pass. THE WARNING WAS THE MECHANISM BEHIND… |
| R44 | Carry-forward clipped a failed source's archive to a window t… | Done | 2026-08-18 (g13, branch claude/g13-final-rows-0818). test and build pass; tsc --noEmit clean. DIAGNOSED BEFORE FIXING, and the M5… |
| T05 | Abuse policy live | Open | 2026-08-15 MINIMAL WIRING with the reaction surface: the reaction endpoint respects the abuse policy rate intent (serialized limi… |
| T09 | Refusal-log scrub before store | Done | 2026-08-14 (second 08-14 session) branch claude/pipeline-proof-and-potholes-0814. tests/ask-box.test.ts: fixture questions contai… |
| A11 | Tie-or-zero refuses - the PHA never answers for potholes (ite… | Done | 2026-08-14 (third 08-14 session). The fixture test walks EVERY topic route at 85723 and asserts no step names a body outside the… |
| D58 | Non-contribution receipts were rendering as contributions - F… | Done | Done 2026-08-15. Both hops now keep only contribution lines - 11* (individuals, party committees, other political committees, the… |
| D61 | The funding-reactions ripcord flips LIVE, and the funding que… | Done | 2026-08-15 (the truth session, branch claude/truth-session-0815). THE RULING, RECORDED VERBATIM in lib/ripcords.ts and docs/ripco… |
| M140 | The active-state model, built as specified - and the mask sto… | Done | 2026-08-16 (g5), branch claude/active-state-model-0816. DIAGNOSED BY MEASUREMENT, NOT BY READING: at the zoom a reader lands on f… |
| M15 | Division and body registry, generated from division type | Done | 2026-08-12. pnpm registry:build reads the committed boundary files and writes lib/registry/registry.json - 940 divisions, 297 bod… |
| T08 | Launch gate: hardening before the password comes down | Done | Opened 2026-08-15 with the reaction surface going live under the demo-grade-collection / launch-grade-schema split (state.md). Th… |
| M16 | Coverage language on screen for bodies with no source | Done | Phase 4.6.6. 2026-08-12, branch main. DONE: test (78 pass, 10 new in tests/coverage.test.ts), lint, build all green. lib/registry… |
| R43 | The intake tripwire's scheduled purge is refused by the write… | Done | 2026-08-18 (g13, branch claude/g13-final-rows-0818). test and build pass; tsc --noEmit clean. DIAGNOSIS from the failing run's ow… |
| M21 | Link ladder and body coverage audit | Done | 2026-08-12, branch claude/link-ladder-and-coverage-audit. DONE: test (147 pass, 15 new in tests/link-ladder.test.ts), lint, tsc a… |
| PB14 | RULING 7's equal-depth gate withholds most contests, and it b… | Done | 2026-08-20 (Prompt C item 2) CLOSED BY RULING 18. The author ruled: the gate is re-aimed at HUNT COMPLETION rather than field pre… |
| D73 | LIVE DATA LOSS: both sold stores stopped recording for 4h18m,… | Done | 2026-08-20 (Prompt C). FIXED UNDER THE BRIEF'S LIVE-DATA-LOSS EXCEPTION and named here rather than absorbed. WHAT WAS APPLIED, in… |

## Ripcords — 7

Source: `lib/ripcords.ts`, the state of record. State below is the **committed**
position; each flag can be flipped without a deploy via its environment variable
(`pulled` / `live`). Pull procedures: `docs/ripcords.md`.

**`ripcord.fecContributorDisplay`** — **live** · env `WTP_RIPCORD_FEC_CONTRIBUTOR_DISPLAY` · rows D23, D34

- Open question: Does 52 U.S.C. § 30111(a)(4) (the commercial-use restriction on FEC contributor information) permit reader-facing display of itemized contributions in this product?
- Closer: Counsel (the B05 hire) — nobody else may close it (D23)

**`ripcord.fundingReactionsInAggregates`** — **live** · env `WTP_RIPCORD_FUNDING_REACTIONS_IN_AGGREGATES` · rows D23, D34, D61

- Open question: RULED by the author 2026-08-15: what is licensed is reader-attention signal — anonymous reactions — and never FEC-derived data; a buyer receives opinions about displays, not contributor records. The separate § 30111(a)(4) question over the underlying contributor DATA is untouched by this ruling and still governs ripcord.fecContributorDisplay (D23).
- Closer: Author-ruled 2026-08-15; counsel review welcome (the B05 hire) and may re-pull it

**`ripcord.rateLimits`** — **live** · env `WTP_RIPCORD_RATE_LIMITS` · rows T08

- Open question: Operational, not legal: are the thresholds and the origin check calibrated so no legitimate reader is ever refused? (The author's standard: the fastest human thumb never hits a limit; a script hits one in its first second.)
- Closer: The author — this is a product-safety tuning question, not a counsel question

**`ripcord.askClassifier`** — **live** · env `WTP_RIPCORD_ASK_CLASSIFIER` · rows A09, A12

- Open question: Product, not legal: is a model choosing WHICH curated topic a question belongs to compatible with the no-generation rule, given that it writes none of the answer and its whole output is one identifier from a closed list?
- Closer: The author — RULED 2026-08-15: acceptable as built, stays live. Retained as a one-flip pull if the doctrine ever moves.

**`ripcord.reactionFreeText`** — **live** · env `WTP_RIPCORD_REACTION_FREE_TEXT` · rows P03, T05

- Open question: Operational and policy, not legal: can the moderation path in docs/abuse-policy.md absorb the verbatims this collects, and is the threat-notice posture holding? Open for the testing window the author declared 2026-08-18.
- Closer: The author — pulled when moderation cannot keep up, restored when it can

**`ripcord.reactionIntake`** — **live** · env `WTP_RIPCORD_REACTION_INTAKE` · rows T08

- Open question: Operational, not legal: held open for live-attack response — is the store currently under an attack that per-device limits cannot absorb?
- Closer: The author — pulled during an attack, restored when the attack ends

**`ripcord.unsourcedFallback`** — **live** · env `WTP_RIPCORD_UNSOURCED_FALLBACK` · rows ASK-12

- Open question: Product, not legal: does an unsourced general answer stay unmistakable from a sourced civic one in front of a real reader? The whole trust posture of this product is that it does not answer what it cannot source, and an answer a reader mistakes for sourced spends that.
- Closer: The author — he is the one who looks at it; pulled the moment the separation reads as thin

## Last 10 tracker status change(s), most recent first

Source: git history of `docs/tracker.csv` (first-parent), 14 commit(s) walked of 30 available. 96 row(s) first appeared in those commits and are not listed — a new row has no status to have changed.

| Date | ID | From → To | Commit |
|---|---|---|---|
| 2026-08-20 | R58 | Not started → Done | `7cc7d4c` Merge pull request #120 from SeanJ22/claude/promptd-r… |
| 2026-08-20 | F02 | Not started → In progress | `ae720a9` Merge pull request #119 from SeanJ22/claude/promptc-g… |
| 2026-08-20 | D70 | Not started → Blocked on the author | `ae720a9` Merge pull request #119 from SeanJ22/claude/promptc-g… |
| 2026-08-20 | PB14 | Blocked on the author → Done | `ae720a9` Merge pull request #119 from SeanJ22/claude/promptc-g… |
| 2026-08-20 | F25 | Not started → Done | `3bc8834` Merge pull request #116 from SeanJ22/claude/promptb-d… |
| 2026-08-20 | R48 | Open → Done | `3bc8834` Merge pull request #116 from SeanJ22/claude/promptb-d… |
| 2026-08-20 | F21 | Not started → Done | `9028521` Merge pull request #115 from SeanJ22/claude/f22-refre… |
| 2026-08-19 | F01 | Not started → In progress | `a119578` Merge pull request #108 from SeanJ22/claude/f01-walkt… |
| 2026-08-19 | D47 | Not started → Done | `b6dc706` Merge pull request #104 from SeanJ22/claude/g21-final… |
| 2026-08-19 | D52 | Not started → In progress | `b6dc706` Merge pull request #104 from SeanJ22/claude/g21-final… |

## Git

Source: the same facts `git-state.txt` carries, generated in the same run.

```
generated: 2026-08-27 11:12:40 EDT
branch: claude/85641-hyperfocus-0827
head sha: 74094e96a4e3789e5fb95b1ac0c86aceba466922
head subject: Session record: the stopping model, and 85641
origin/main sha: 0f5f43424540dcd617ce3de2c1f98c778185664e
origin/main subject: Session handoff: 6 commit(s) from claude/descent-resume-0826 (#208)
local main sha: 0f5f43424540dcd617ce3de2c1f98c778185664e
local main matches origin/main: yes
working tree: clean
open prs: none
last recorded tests: 463 (fail)
last recorded lint: not recorded
last recorded build: not recorded
last recorded status from: docs/state.md:19245
```
