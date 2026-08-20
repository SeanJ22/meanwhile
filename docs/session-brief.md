# Session brief — written by F01-continued session 2 for whoever comes next

**Written 2026-08-19 at the close of F01-continued session 2.** This file is
overwritten every session; what it says is what the last session actually left
behind, not a plan.

---

## Where the tree is

`main` at **`af2f208`**. Production is serving **`7d986cb`**, verified via
`/api/build`, and that is what the final `walk:all` ran against — `af2f208` is
a close-out record touching `scripts/walk-all.mts` and nothing a reader sees.

**F01 IS CLOSED.** Session 2 carried ten items — 0A through 0D and 12 through
17 — and finished all ten. **The next artifact is Prompt B.**

**Two code merges, and the second is a reported deviation from RULING 1:**

| SHA | What it carries |
|---|---|
| `2c9e19f` → PR #113 → `1407c53` | Items 0A–0D and 12–17. |
| `1fd1796` → PR #114 → `7d986cb` | The regression the first live walk found in what #113 had just shipped. |
| `af2f208` | Close-out record: two standing walk checks follow the surfaces item 12 moved. Instrument only. |

Gates at the close: **test 1320 pass / 0 fail · lint 0 errors, 11 allowlisted
warnings · `tsc --noEmit` clean · build green in default AND standalone.**
`walk:all` against the live build: **350 passed, 0 regressions, 0 could not
run** — baseline 332, added 18, GONE 0.

Working tree clean. No open PRs.

---

## The one thing waiting for the author

**`F21` — two identical "Where can I vote?" pills on the ballot.** Item 15
converged two polling-place LINKS onto one in-app pill, and the page renders it
twice, because item 6 (2026-08-15) committed a guard requiring the pointer in
the dates header AND the checker box, by name. Two identical controls read
worse than two links did.

I removed one and the suite refused it. Overturning an author-directed decision
about this page while fixing something else is scope creep, so both render and
the row states what changes under either answer. **It needs a sentence from the
author, not a session.**

---

## What to know before touching anything

### The ballot's long sections live in the battlecard now

`components/ballot/candidate-battlecard.tsx`. Three sections moved — "in their
own words", campaign money, the incumbent record door — and the row keeps
portrait, name, party, the short sourced line, the links row, a one-line count
and the pill.

**Do not "simplify" this into `OfficialModal`.** That surface only opens for an
INCUMBENT, and using it here would delete a CHALLENGER's own words and funding
block in every contest while leaving the incumbent's. The header of the new
component carries the full argument. If you are ever tempted to merge the two,
read it first.

**Two consequences for anything that looks at the ballot page:**

* A check that counts something on the ballot ROW may now need to open a card.
  Two standing checks got this wrong on the first live run and one of them
  printed a prior session's win as a NAMED REGRESSION. **The claim was intact;
  the check was looking where the content used to be.**
* The funding block renders only on a FEDERAL contest, so on 85701 the first
  fifteen cards have none — it starts at the sixteenth, Adelita Grijalva.

### There are TWO statement corpora and the search index is their union

`lib/corpus/unified.ts`. `data/corpus/statements.json` is keyed by officeholder
id; `data/candidates/corpus-2026.json` is keyed by candidate key. The battlecard
search read the first alone, so any candidate whose words live only in the
second answered "we haven't collected anything they've published" four inches
below their published words.

**The files are deliberately NOT merged.** They are append-only evidence stores
with different collectors, and rekeying either destroys the guarantee that makes
them worth anything. The UNION is built at read time.

### `politeGetText` now refuses a challenge page

`lib/sources/http.ts`. A host can answer an unfamiliar client with `200 OK` and
a bot-detection interstitial, and every layer above will behave perfectly and
produce a lie. The client escalates to the other TLS stack (rung 4, unchanged)
and THROWS naming the wall if that is challenged too.

**If an adapter starts reporting a source as failed where it used to report
zero rows, this is why, and the new answer is the true one.**

### A reaction write must declare whose traffic it is

`lib/db/reactions.ts`. `writeReaction` throws without a `marker`. There is no
default — the search log's `ORGANIC` default cost this project five rows in the
sold store in a single day, and a reaction row is the thing the business sells.

The `run_id` is **namespaced and digested** against the search log's raw label,
so the two stores share a column NAME and no VALUE SPACE. That is what keeps
the n-stores-never-join rule intact. **Do not "fix" it to store the raw id.**

### The sweeping instrument

**`git grep -a`, or ripgrep with binary handling forced.** The default tool
skips a file containing a literal NUL byte and skips hidden paths, and says
nothing either time. Session 1 swept the NUL class with the skipping tool and
found one of three files. `tests/nul-bytes.test.ts` guards the first condition;
the second — 11 tracked files under dot-prefixed directories, 6 of them
source-class — is recorded and not yet guarded.

---

## Five things this session learned the hard way

1. **A check that CRASHES is worse than a check that fails.** The positions
   search box sits inside a collapsed section; `fill` waited thirty seconds and
   threw, and took every check after it down. The suite stopped REPORTING
   rather than reporting a failure.
2. **A cannot-run can be a did-not-look.** The first candidate on 07866
   mentions 0 of 12 issues, so their card holds no text to draw a search term
   from — and the check gave up on a zip where the next card would have
   answered.
3. **Run the verification before believing the fix.** Item 13's verification
   found a defect the fix had not addressed: a term we hold and will not quote
   was rendering as the candidate's silence.
4. **Two numbers that both sum to the same total can still be about different
   populations.** 591 + 311 and 531 + 23 + 348 both make 902 and share no
   denominator. The residue was 34 candidate-card portraits and 3 governors a
   reach map could not see.
5. **A guard can be right and its conclusion wrong.** "run_id on both stores
   would be a join path" was correct; "therefore the sold table carries no
   attribution" was not.

---

## What the live walk catches that reading does not

Every finding in the previous section except the fourth came from RUNNING
something — the walk against the deploy, the verification against the corpus,
the byte scan against the tree. The first live run of this session's own new
checks found three defects in those checks and one reader-facing regression the
session had shipped ten minutes earlier.

**Run `pnpm walk:all` against the deploy before writing the report, not after.**
