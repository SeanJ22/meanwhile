# Session C (resume) — the owner's audit package

Written for you, not for a machine. **Every claim below is paired with exactly
where to check it**, one line each: a production URL and what to do there, a
tracker view and what it should show, a file path, or a command. Nothing here
asks you to take a session's word for anything.

*Generated 2026-08-31. Session C was reopened by name after a close-out that
claimed it was finished; that close-out is rejected and this continues it.*

---

## 1. What a reader can now see that they could not before

*(RULING 225, adopted this session: a report leads in reader terms. If a reader
loading the page would see what they saw yesterday, it does not go here.)*

### Arizona — the money is acquired and does NOT reach you yet

**Read this before the New Hampshire section, because it is the correction.**
Arizona campaign finance is collected, normalized, reconciled 255 of 255 against
the publisher's own itemised ledger, and committed as
`data/funding/state-money-az-2026.json` with 44 candidates carrying real filed
totals — Katie Hobbs $11,109,720, Kris Mayes $4,612,992.

**Four of them render.** Measured on production and on a local build of the same
tree, which agree exactly: at 85701, 24 candidate cards and **4** money
sections; at 85641, 29 cards and **4**. Thirty-six of the 38 candidacies in the
contests shown at 85701 have a record. Thirty-two show nothing.

The cause is one key. Contests that render as a *certified lineup* pass
`<contestId>|<name>` where the snapshot is keyed on the candidacy id, so the
lookup returns nothing and the section is omitted. The four that work are the
Corporation Commissioner candidates, whose contest renders through the other
branch.

It was not fixed at the end of this session on purpose: the only join available
is by NAME, and this session measured name joins turning five live committees
into manufactured absences. A wrong join here puts one candidate's fundraising
on their opponent's card. The full reasoning and the recommended smaller repair
are in `docs/frontier.md`.

> **Check it:** open `/ballot?zip=85701`, count the cards with a Campaign money
> section. It should be 4, and it should be about 36.

### New Hampshire — eight people stop carrying a false claim

**Six were told the state has never heard of them.** Karen Ebel, Tobin Menard,
Jason Gerhard, Steven Endres, Dianne Schuett and Samantha Morse each had a card
reading *"No reports on file with the New Hampshire Secretary of State"* — while
the snapshot held their committee's id, registered name, filed office and
election cycle. The state had heard of all six. They now read:

> *Ebel for State Representative — Registered committee. No money raised and
> none spent has been reported to the New Hampshire Secretary of State —
> Campaign Finance System as of 31 August 2026.*

The true sentence was **already in the record**. The renderer was discarding it
in favour of the false one.

**Two more were published as records New Hampshire does not hold.** Jon Raiche
and Meg Hagaman. The registry holds `Raiche, Jonathan M. (Raiche, Jon )` and
`Meg For Merrimack` / `Meghan Hagaman` — both real, both with money. Our
inability to match a name form had become the state's silence. Their cards now
say the gap is **ours**.

> **Check it:** open the ballot at **03255**, expand the money section on Karen
> Ebel's card. It should say *Registered committee*, not *No reports on file*.

**Measured on production after the merge, not asserted.** The served page at
`/ballot?zip=03255` carries the phrase *"Registered committee"* exactly **6**
times and *"No reports on file"* exactly **11** times — which is the snapshot's
own distribution, so stated N equals rendered rows. Before this, it was 0 and
19.

### Everything shipped before this is intact

All nine New Hampshire positives still render: Ayotte $5,995,303 / $3,276,135,
Warmington, Liot Hill, Harned, Innis, Sargent, Shephard, Cassidy, Rogers.

> **Check it:** same page, Kelly Ayotte's card.

### Two tabs now agree

Answer *"Would you vote for them?"* in one tab and the other now shows your
answer within milliseconds. Before, the second tab kept showing the question
unanswered for as long as it stayed open.

> **Check it:** open the ballot in two tabs, answer in one, look at the other.

---

## 2. What advanced without anyone choosing it

**This was the session's mission, and it is proven.** The workers used to hunt
meetings and nothing else. A campaign-finance obligation existed in the code but
was reachable only from its own test.

Sixteen non-meeting obligations now come due, get picked up, run, and finish —
with **no operator selecting their route**. Five of the six recorded cycles ran
with no filter at all, so the scheduler chose them out of the whole registry.

| | |
| --- | ---: |
| obligations in the control plane | 99 |
| of those, non-meeting | 16 |
| reached a committed disposition | 16 of 16 |
| reached a staged state | 16 of 16 |
| cycles run with **no filter** | 5 of 6 |

Two of them came back with real data, each matching the number the **publisher
itself** declares:

- **Arizona Secretary of State, SeeTheMoney — 370 of 370 filers.** Every
  statewide committee, with its entity id, committee name and office.
- **New Hampshire Secretary of State — 5,738 of 5,738 filers.**

Both are normalized and **staged**, one step short of a reader. The other
fourteen carry an honestly named gap, and nine real walls each name the adapter
that is missing rather than reporting an absence.

> **Check it:** `data/health/autonomous-advancement/2026-08-31-autonomous-advancement.json`.
> It carries its own **"how to disbelieve this"** — re-run `pnpm autonomy:evidence`
> against the same database and the same rows come back. It also states what it
> does **not** claim: the pilot is not healthy, and nothing reached a reader.

**Why nothing reached a reader.** Unattended promotion is OFF by your standing
constraint. Under RULING 224 the pipeline now runs automatically all the way to
STAGED, and a session carries the last mile. That is the design, not a shortfall.

### The runner

> **Start it:** `pnpm pilot:start`. Stop with `pnpm pilot:stop`, check with
> `pnpm pilot:status`. Documented in `docs/pilot-runner.md`.

> **Read it:** `G:\My Drive\we-the-people\pilot-digest.md` — same filename every
> cycle, so it is one bookmark. PILOT HEALTH first, then cost by role and by
> model. Headlines accumulate in `pilot-digest-log.md`.

**Two honest caveats.** The Windows Scheduled Task was **refused** on this host —
`Access denied` unelevated — so what is installed is a per-user startup entry.
It survives a reboot; it does **not** restart a crashed runner. Run
`pnpm pilot:install` from an **elevated** PowerShell to get the real task.
And the digest's cache-hit rate reads **NOT MEASURED**, not 0% — nothing records
cache reads yet, and a zero there would be a measurement nobody took.

---

## 3. What genuinely requires you

### OWN03 — nine portraits, one look

The row has sat unanswered because approving a portrait means **seeing** it
(RULING 55), and the record held only URLs. Nine URLs is not a thing anyone
reviews.

> **Check it:** open `docs/photo-review/own03-nine.png`. Nine official
> headshots on one numbered grid — Fontes, Mayes, Yee, Myers, Walden, Thompson,
> Márquez Peterson, Lopez, Caldwell. Approve or refuse by number.
> Regenerate any time with `pnpm own03:stage` then `pnpm sheet`.

**A correction you should know about before you decide.** The row told you the
nine were *"Mayes, Fontes and Horne among them."* **Tom Horne was never one of
them.** His image never decoded — `azed.gov` answered a Cloudflare interstitial,
and the file is 60px against a 96px floor anyway. Approving him would have meant
approving an image the system never read. He is not a decision for you; he is
hunt work, and he has been moved there.

> **Check it:** `docs/owner-audit/own03-portrait-count-correction.md`.

### Three things you were told were blocking that were not

Presented to you in the last close-out as the current state of your project.
All three had stopped being true.

| Row | What it claimed | What is actually so |
| --- | --- | --- |
| NH272 | the read-only DB secret is missing | production integrity reads 24 of 24 migrations live, and a HELD reading **cannot be produced without the secret** |
| NH281 | stuck since 7/13/2025 | two releases published and were **observed serving** — `0bd520f3` and `a36679be` |
| NH300 | needs a live Postgres proof | `proof-mthbrw87.json` is 7 of 7 on the Postgres lane, and was on disk when the row was shown to you |

They aged into falsehood because **nothing in the queue was capable of
noticing.** That is now fixed at the generator rather than left to a session's
diligence: RULING 227 requires every escalation to carry either a
machine-checkable predicate that re-runs on every generation and auto-resolves
the row, or an explicit *not machine verifiable* marking with a decision card.

> **Check it:** `docs/tracker-owner-view.md`, sorted by priority and age, every
> row dated and carrying a verification state.

### The queue, against a stated denominator of 389 open rows

| | |
| --- | ---: |
| auto-resolved with evidence | 3 |
| converted to a machine obligation | 6 |
| merged into a class row | 9 |
| **needing a decision from you** | **69** |
| closed won't-fix | 0 |
| ordinary open work | 302 |
| **total** | **389** |

All 69 are marked *not machine verifiable* and carry a card stating what is
needed, the options, each consequence, and the row's age. The three rows that
**did** carry a checkable predicate all auto-resolved and left the queue — which
is the rule working.

**Dates:** 302 dated, 87 UNKNOWN. Git was deliberately not used as a source —
this clone is shallow and grafted at 2026-08-25, so a first-appearance walk
would silently date every older row to the graft boundary.

### A guard that needs your ruling

`tracker amend` refuses a row the current session did not open. That is why the
false sentence naming Horne is corrected in his **card** but still stands in the
row's own description, which `docs/log.md` and `docs/tracker.md` render
verbatim. **A later session cannot correct an earlier session's false
description of a named person.** The lane reported it rather than working around
the guard, which was right, and it needs a decision.

---

## 4. Where the instruments were lying

Five verifications reported green while measuring something other than what they
claimed. Named in full, each with the substitution it made, in
`docs/false-verifications.md`.

The one worth your time: a sweep row marked **FIXED_VERIFIED** cited a check
called `rq:wgh-22-panel-seats`. That check **does not exist**.
`data/health/reader-questions.json` holds seven rows, `Q2` through `Q9`, and the
string `wgh` appears nowhere in the file. The row measured that a citation
field held a non-empty string.

> **Check it:** `node -e "const d=require('./data/health/reader-questions.json'); console.log(JSON.stringify(d).includes('wgh'))"` → `false`

The general form, which is the durable output: **name the thing the claim is
about, and name what was read; if they are not the same object, the
verification is of the second one.**

### And the gate that reports RED while measuring the host

`pnpm gates` can fail the `test` gate on a tree whose suite passes. It does it
by **aborting**, not by failing an assertion — measured tonight at 59 seconds
against a 75-second full pass. That is why no session has ever been able to name
the failing test: there was never one to find.

> **Check it:** `data/health/gate-abort-evidence/2026-08-31-test-gate-false-red.md`

The last close-out reported *"14 of 14 green."* The committed record for that
tree, `data/ops/gate-runs/2026-08-31-41.json`, says `test: FAIL`.

---

## 5. New law adopted this session

Five rulings, through the canonical ledger. `pnpm governance:check` passes with
0 semantic conflicts and 0 stale views.

| | |
| --- | --- |
| **223** | a session's discretion covers **how**, never **what**. *"I chose depth over coverage"* is not a stop condition. |
| **224** | acquisition without promotion is inventory, not product. An obligation closes at the **reader**, not at the vault. |
| **225** | every report leads in reader terms; infrastructure counts afterward. |
| **226** | aggregate-only is an **exposure** boundary, not a storage rule. OWN-Q6's implementation is ratified. |
| **227** | escalation without reconciliation is prohibited. |

> **Check it:** `pnpm governance:open --task meta-governance`, or
> `docs/governance/policies/` for the full text of each.

---

## 6. What is not done

*(Completed at session close. A Part reaching this list is named here with its
exact resume point, per RULING 223 — an unreached item is named, never summarised
as "the rest".)*
