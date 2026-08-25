# we-the-people — current context

**GENERATED FILE — do not edit, and do not copy it back into the repo.**
Written by `pnpm handoff` (`scripts/context-file.mjs`) at test.
Session day 2026-08-23 (America/Phoenix, from `pnpm stamp`).

It has no repo counterpart, is never compared for drift, is skipped by
`pnpm handoff --check`, and is overwritten after every successful `--ship`.

It exists so a conversation outside the repo can get current without pulling
the 1002 KB `state.md`. **Nothing in it is composed** — every line is read
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

> **Source: `CLAUDE.md`, the `## DISCOVERY CONDUCT` section, verbatim.**
> `CLAUDE.md` is the authority; this is a copy of it, pinned here because the
> failure RULING 88 fixes is a session not knowing there was anything to look up.
> `tests/context-pinned-conduct.test.ts` fails the build if the two diverge.

## DISCOVERY CONDUCT

(Adopted 2026-08-22, the author's Discovery Conduct brief, item 3. Eight rulings
adopted together — **RULINGS 88, 89, 94, 95, 96, 97, 98 and 99** — held in full
here rather than as pointers. `docs/rulings.md` carries them with the same text
and the letter-to-number mapping the brief's A-through-H lettering maps onto.)

**Why this section exists, and it is a diagnosis rather than an exhortation.**

Sessions walk the routes the brief names and no others. **This is not
disobedience; it is what the system asks for.** Scope is a ceiling by rule, the
branch manifest is a checklist with a completion condition, the discipline rules
correctly make speculative moves feel like confessable defects, and — the part
nothing had noticed — **no report contract has ever asked a session what it
found that was NOT on the list.** A session that walked eleven known routes and
a session that invented three new ones produced identically-shaped reports and
were graded the same.

The consequences are measured, not asserted. **Wikipedia as a Tier A source was
identified by the author, not by a session**, and when finally walked it
returned 261 officials, 898 rows, 818 citations confirmed against primary
sources (91.1%), and 174 governing bodies against a registry holding 12. **API
credentials the author personally obtained sat uncalled** until NJ Hunt 5 called
several and closed 119 owed fields in one run; the Census key was invalid and
that was found only because something finally hit it. **A paid search API was
recommended** while Wikipedia's Rockaway Township page — two clicks from a plain
Google search, carrying the mayor, nine council members, seven county
commissioners and the county constitutional officers, all footnoted — had never
been opened.

**More principles will not fix this.** RULING 90 and RULING 93 are principles and
behaviour did not change. What changes behaviour is **a required output that
cannot be produced by walking a list**. That is RULING 88. The other seven make
it real.

### RULING 88 — THE EXPANSION REQUIREMENT

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

### RULING 89 — EXPANSION IS NOT A SIDE QUEST

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

### RULING 94 — THE STUCK PROTOCOL

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

### RULING 95 — CREDENTIALS ARE PROVEN, NOT ASSUMED

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

### RULING 96 — SOURCES HAVE FRESHNESS

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

### RULING 97 — A FOUNDER FIND IS A CLASS-WIDE DEFECT

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

### RULING 98 — EXPLORATION HOLDS A GUARANTEED POSITION IN ITEM ORDER

**In every hunt brief, expansion work is its own NUMBERED ITEM and is NEVER
LAST. This binds the chat writing briefs as much as the session executing
them.**

*The reason, stated plainly because it is a fact about how this system actually
behaves.* Whatever sits at item 1 eats the run. Expansion placed at the tail
never happens, because it is scheduled to begin after exhaustion — and
exhaustion never arrives, by design, since RULING 90 exists precisely to stop a
session declaring it. **A brief that puts exploration last has not
deprioritised it; it has cancelled it, while appearing to require it.**

### RULING 99 — THE AMENDMENT PROCEDURE

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

### THE REPORT CONTRACT IS A FILE NOW, AND IT IS AMENDED RATHER THAN REINVENTED

(Adopted 2026-08-22, the same brief, item 5.) **`docs/report-contract.md` is the
close-out contract every hunt session answers.** A brief may ADD to it; a brief
does not subtract from it.

**What was found when this was written:** there was no template. The contract
lived in each session's own brief, rewritten by the chat every time — which is
precisely why the one figure that would have caught the discovery failure had
never appeared in it. **A contract that is rewritten every session cannot
accumulate.**

It enumerates seven required figures, each with its denominator: **expansion
routes conceived**, **routes returning rows (N of N)**, **routes returning zero
(N of N)**, **stuck protocols run**, **fields returned to owed for a missing
stuck protocol**, **credentials proven (N of M)**, and **sources past expiry
(N of M)**. **A report missing any of these is INCOMPLETE and the session says
so about itself.**

### THE MAPPING TABLE — the brief's letters against the numbers they carry

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

**88 and 89 were held open on 2026-08-22** so the author could claim them rather
than have `docs/rulings.md` renumber a ruling of his. He claimed them here. C
through H continue from 93, the highest then in use.

*(Pinned verbatim from `CLAUDE.md` by `scripts/context-file.mjs`. Every other
section of this file is an index; this one is the text, because the failure it
fixes is a session not knowing there was anything to look up.)*

---

## Rulings — 140 recorded

Source: `docs/rulings.md`, append-only. **This is an index, not the text.**
`CLAUDE.md` is law; these are the author's calls that are not, and a session
told to hardcode a ruling as fact reads the file rather than the chat it came
from. Each entry there names what it supersedes.

- RULING 1 — merge cadence
- RULING 2 — full-page screenshots are read as images
- RULING 3 — the organic census is closed as a question
- RULING 4 — `CLAUDE.md` has no rules 4g or 4h
- RULING 5 — `walk:all` does not tap reactions
- RULING 6 — the coverage tier vocabulary, used verbatim everywhere
- RULING 7 — a zip below Tier 2 renders what is known and names what is not
- RULING 8 — no API client was built in Prompt C
- RULING 9 — Census counts governments; the product renders bodies
- RULING 10 — ZCTA is not a ZIP code
- RULING 11 — not issued
- RULING 12 — WALL versus JOB
- RULING 13 — a green build check does not mean the tests ran
- RULING 14 — path comparisons may not assume a separator
- RULING 15 — the Kearsarge 15-row floor is retired
- RULING 16 — the retrieval-mechanics ladder in `CLAUDE.md` is canonical
- RULING 17 — `walledAtRung` values written before F22 are provenance-unknown
- RULING 18 — hunt-completion gating
- RULING 19 — the nonpartisanship and committee-sale section is deferred
- RULING 20 — portraits and PDF corpora do not go in git
- RULING 21 — `DATA_GOV_API_KEY` exists
- `F21` — closed as correct-as-shipped (2026-08-20)
- `F02` — the committee denominator is PER REPRESENTATIVE (2026-08-20)
- The two portraits — accepted (2026-08-20)
- The 12.1 and 13.2 visual calls — accepted (2026-08-20)
- The organic census — closed (2026-08-20)
- `F03` — closed, and Vail's superintendent is John Carruth (2026-08-20)
- The zip order (2026-08-20)
- The repeatability bar (2026-08-20)
- RULING 26 — SHOW EVERYTHING WE FIND
- RULING 27 — no suppression path may exist in the codebase
- RULING 28 — absence is one buried annotation per contest, never a per-field indicator
- RULING 22 — recorded by description, and dead
- RULING 23 — the four-state field is data, not a gate
- RULING 24 — a check that cannot run says so
- RULING 25 — reader-facing behaviour is not degraded to fix an internal problem
- `THIN_CANDIDATE_LINE` was KEPT on the card (2026-08-20)
- The `*` is reserved across the whole ballot page (2026-08-20)
- `NOT_APPLICABLE` moved NOTHING out of the 249 (2026-08-20)
- RULING 29 — three priority levels, ranked inside a section and never across sections
- RULING 30 — five P1 rows maximum per section, and an over-cap section is STOPPED
- RULING 31 — Needs Sean is always the first section
- RULING 32 — every row has a home
- RULING 33 — gaps are not tracker rows
- RULING 34 — the reader artifacts are generated, and hold no duplicated content
- RULING 35 — every section is a queue that empties
- RULING 36 — three resolution states, and only these three
- RULING 37 — who may move a row
- RULING 38 — the author's resolution notes are instructions, not commentary
- RULING 39 — resolution timestamps are written by the script, not by the spreadsheet
- RULING 40 — attribution has no soft landing
- RULING 41 — the author writes rows too
- RULING 42 — the page-level disclosure replaces `THIN_CANDIDATE_LINE`
- RULING 43 — a source may not report success with zero normalized rows from a non-zero fetch
- RULING 44 — per-card completeness statements are gone, in any wording
- RULING 45 — the Kelly standard, and there are no tiers of it
- RULING 46 — the author may delete a row outright; a session never may
- RULING 47 — the per-card issue count is removed
- RULING 48 — a session may not use git to revert the author's files
- RULING 49 — a merge to satisfy a mid-session instruction from the author does not count against the cadence
- RULING 50 — photos-first ordering is presentation; withholding data is suppression, and the two are never conflated again
- RULING 51 — the collection disclosure renders once per surface, and there are two surfaces
- RULING 57 — every twig is named
- RULING 58 — `VERIFIED_ABSENT` requires two INDEPENDENT branches
- RULING 59 — the page says one thing about completeness and nothing else
- RULING 60 — the session hand-works bodies, and that is the point
- RULING 61 — the branch manifest, and what exhaustion means
- RULING 62 — a test file may not lose guards silently
- RULING 63 — every zip inherits; no zip starts from scratch
- RULING 64 — shared office contacts are published, labeled as the office
- RULING 65 — the footer-address branch
- RULING 66 — Facebook by compliant routes only
- RULING 67 — an enumeration states its geography and is checked externally
- RULING 68 — control queries are mandatory
- RULING 69 — reference data belongs in the repo, named and refreshable
- RULING 70 — Ballotpedia is not scraped
- RULING 71 — a zip cannot answer "who governs you"; a street address can
- RULING 72 — a walled host is never evidence a body is unreachable
- RULING 73 — large reference documents: commit the CONTENT, never the binary
- RULING 74 — an address, once given, is never asked for twice
- RULING 75 — a close-out commit is gated like any other commit to `main`
- RULING 76 — session-dated scripts are COMMITTED, and held to every standard
- RULING 77 — verify locally, ship once
- RULING 78 — CI runs where it earns its cost
- RULING 79 — a ruling closes the Needs Sean row it answers
- RULING 80 — the committed geometry follows the reader, not the county
- RULING 81 — an exhausted Actions balance is not a broken tree
- RULING 82 — the job watcher's sampling was the defect, not its logic
- RULINGS 83 THROUGH 87 — the five process rulings of NJ Hunt 5
- RULING 83 — the free-source floor
- RULING 84 — the manifest is tiered, and walked in order
- RULING 85 — the two-click test
- RULING 86 — per-state source enumeration precedes the hunt
- RULING 87 — Wikipedia is a Tier A discovery source, never a source of record
- RULINGS 88 AND 89 — deliberately unassigned
- RULING 90 — exhaustion must be argued, not asserted
- RULING 52 — discovery is a tree, not a ladder
- RULING 53 — recorded absences expire
- RULING 54 — the filed mailing address renders
- RULING 55 — only a reviewed photo renders, and a decision is about an IMAGE
- RULING 56 — a scheduled job that fails tells someone
- RULING 91 — every key in `.env.local` is a Tier A route and is walked
- RULING 92 — fix the generator, never the artifact
- RULING 93 — ask what the tier above publishes about the tier below
- RULING 88 — the expansion requirement
- RULING 89 — expansion is not a side quest
- RULING 94 — the stuck protocol
- RULING 95 — credentials are proven, not assumed
- RULING 96 — sources have freshness
- RULING 97 — a founder find is a class-wide defect
- RULING 98 — exploration holds a guaranteed position in item order
- RULING 99 — the amendment procedure
- RULING 100 — a partial answer that adds up is still a wrong answer
- RULING 101 — our own identifier never leaves our own site
- RULING 102 — fixing the recipe is not finished until you re-cook the dish
- RULING 103 — a sweep looks for the same code twice, not just the same symptom
- RULING 104 — a file you put in the repo is something a session must go and read
- RULING 105 — say what is rendering, what is out of scope, and what is still dark
- RULING 106 — no generated file has a size limit
- RULING 107 — a freshness date is written only by the code that read the source
- RULING 108 — anything a session must read at the start lives in the repository
- RULING 109 — a brief says what it needs to run, and the session checks before item one
- RULING 110 — a search that finds nothing must show it looked in the right FORM
- RULING 111 — a join is never a lookup for a fact that lives on only one side
- RULING 112 — a first-party instrument is symmetric by construction, or it is not shipped
- RULING 113 — a step that reports success is asked whether it did the thing
- RULING 114 — a layer that always renders must be right, because finishing it removed the honest silence
- RULING 115 — a drill is not a failure, and an alarm that cannot tell them apart spends the next real one
- RULING 116 — a guard may pin an invariant or a direction, never the size of a gap
- RULING 117 — the asset store has a public address, and a restore is proved by hash
- RULING 118 — an appointed official never carries the govern verb
- RULING 119 — a sovereign tribal nation is its own category of government
- RULING 120 — equal solicitation is the obligation; who buys is not
- RULING 121 — one body that spans two towns has one identity, and renders in both
- RULING 122 — a page on a party's own site can be a candidate's page, with the host named
- RULING 123 — the author's decisions of 2026-08-24, recorded as a batch
- RULING 124 — a commit that cannot change what a reader sees does not cost a deploy
- RULING 125 — verification happens on the local production build; production is the delivery truck, not the test bench
- RULING 126 — campaign-finance data renders for readers and never enters anything sold
- RULING 127 — no tool prints a credential value, and the guard is the values themselves

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

## Ripcords — 6

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

_No git facts available this run._

