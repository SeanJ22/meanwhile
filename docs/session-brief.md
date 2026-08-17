# Session brief

The last brief executed was **g7** (2026-08-17, branch
`claude/g7-dispositions-0817`) — the session where the author's 117
dispositions became the work. This file is overwritten by each session with the
brief it ran; what follows is what this session was asked to do, what it did,
and what it deliberately did not.

## What this session was asked for

Nine items, in a stated priority order, with the brief declaring outright that
nothing in it was cuttable. The governing fact was that the author had
dispositioned all 117 open rows in `docs/deferred.csv`, and the brief carried
every row he marked "now" or "G7".

The deferral rule in `CLAUDE.md` governed how it ended: work the items in
order, complete each whole, keep starting the next until the session genuinely
ends, defer whatever remains whole with a row, and report completion against
the denominator. One precedence rule sat above the brief itself — where a
disposition in `docs/deferred.csv` and the brief disagree, **the disposition
governs**, because it is the author's own ruling, verbatim.

1. Closures and recordings (tracker only, no build).
2. The production database is unreachable from local (P0).
3. Twenty small fixes the author marked "now".
4. The ask surface — one build closing six rows.
5. G05, the interface consolidation.
6. G07, the pill label that carries the teaching.
7. D35, the positions three-answer machinery.
8. The remaining "finish now" rows, sixteen of them.
9. Handoff.

## Where it got to: items 1 and 2 whole, item 3 at 7 of 20, items 4–8 not started

**Items 1–2 of 9 complete; item 3 is 7 of its 20 sub-items; items 4 through 8
were never started.** That is the honest denominator and the brief asked for it
in exactly this form. A g7b session picks up at item 3's eighth sub-item (R05,
the map layer tests) and runs the same order from there.

Nothing was half-built. The deferral boundary fell between sub-items, never
inside one — every sub-item listed as done is done, tested, and recorded on its
row; every one not started is untouched and still carries its full spec.

### Item 1 — the author's rulings enter the record (whole)

Twelve dispositions recorded verbatim in the rows they govern. Eight closed:
M120, G09, M131, R16, R17, R02, V02, B06. Three recorded a ruling without
moving status, because the ruling settles a question the row is not gated on —
T04 (publication still waits on T01), T03 (an accepted risk is not a retired
one), D03 (the state list is **NH, AZ, NJ**; the author confirmed "NH, NH, AZ"
was a typo). T10 recorded that its empty disposition is a deliberate
non-ruling.

Two disagreements were recorded rather than smoothed. **R02**'s disposition
reads "Unsure what the ask is here" while the brief said close it; it closed on
the brief's stated ground, which is checkable and checks out, with both texts
quoted in the row so the author can reopen on sight. **T04**'s wording follows
the disposition's punctuation, not the brief's, per the precedence rule.

**The one thing item 1 could not do**, reported as a failed retrieval rather
than approximated: `docs/session-map.md` does not exist. Eight rungs walked and
recorded on **R33** — working tree, every branch in git history, the Drive
mirror folder, a recursive name search under it, the Drive root, the Drive API
by title, the Drive API by content, and a grep across `docs/` and `scripts/`.
Absent at every one, and the API rung rules out a sync gap: it is not in Drive
at all.

It was not reconstructed from the census, and the reason is the deliverable:
the 117 dispositions carry **87 distinct free-text strings**, so the seven
queues are an authoring judgement made on top of them and not recoverable from
them. Seven groups invented here would be this session's ordering wearing the
author's name, on the one document whose whole job is to carry his. The mirror
set was left at 13 for the same reason — declaring a file that is not there
would report MISSING on every handoff, and a permanently red check is one
everybody learns to scroll past.

**To close R33: the author supplies the content by any route.** The mechanical
half is small and fully specced on the row.

### Item 2 — local can no longer write to the store we sell from (whole)

The braces: `lib/db/write-guard.ts`, called first by all four write sites
across the search log, reactions and the intake limiter. Two signals, both
failing closed. `WTP_DB_ROLE` declares what `DATABASE_URL` points at and
**unset means production**, so anything undeclared is refused rather than
trusted. `NODE_ENV` decides the runtime, chosen over `NETLIFY` or `CONTEXT`
because Next sets it itself rather than a deploy setting someone has to
remember — a platform variable that turned out to be absent at function runtime
would refuse every production write, and that outage is the one thing this must
not be able to cause.

Writes are guarded and reads deliberately are not: the harm is a row in a sold
store, not a SELECT.

The belt: `DATABASE_URL` is now **unset** in `.env.local`. It costs nothing,
and why is worth keeping — **nothing in the app reads the database.** All four
`getDb()` call sites are writes. The production string survives under
`WTP_PRODUCTION_DATABASE_URL_READONLY`, a name the app never reads.

Proved, not asserted: 11 tests pin the four runtime-by-database pairings; two
planted breaks were run against the real suite first and both failed it; all
three write paths threw against the real production string (3 refused, 0
leaked); and the control — the same call with the role declared local and a
bogus host — reaches `insert into "search_log"` and dies on the connection, so
the guard is demonstrably the gate.

**Production census, read either side of all local work: 3543 rows, ORGANIC 17,
SYNTHETIC 681, UNKNOWN 2845, reactions 35 — identical on both reads.** Zero
rows created by this session's local work.

**A discrepancy with the brief, stated rather than smoothed.** The brief's
premise was "the census stands at 0 organic." It does not. There are 17, all
dated 2026-08-17, none of them this session's, and none recorded in
`docs/synthetic-runs.md`. Fourteen are a burst at 17:11:47–17:12:30Z; three are
searches at 17:54 and 18:01Z. **Nothing was back-marked** — the brief forbids
it and this session cannot attribute them, and guessing a window is the
fabrication that file already records one session committing. **The author
should rule on whose they are.**

**R34's remainder needs the author's hands:** there is still no local database.
The choice is diagnosed and stated — a **Neon branch**, not a local Postgres,
because the app speaks Neon's HTTP driver rather than the Postgres wire
protocol, so a local Postgres needs a proxy or a second driver, and a second
driver means local stops testing what ships. Not provisioned here: no Neon API
key in the environment, and no psql, Postgres or Docker on the machine.

### Item 3 — 7 of 20 sub-items

Done: **R01** (the CLAUDE.md clobber guard, proved twice against the real
pre-commit hook), **R19** (the size warning that fired every run; the band now
derives from `EXPECTED_KB` so it cannot go stale again), **R18** (generated-at
in Eastern, four files, scope held narrow), **R08** (the mirror comparison
hardened both ways), **R11** (a branch named must be a branch that existed),
the **stamp-audit allowlist**, and the **build-stamp endpoint** with the
handoff wired to it.

Two of those produced findings bigger than the fix:

- **R08 was not dormant.** CLAUDE.md is 45417 bytes in the working tree and
  45147 in git — a 270-byte gap that is exactly its 270 CRLF line endings.
  Proved on the real Drive mirror: old logic reports 2 of 11 current, new logic
  10 of 11. Eight files were being needlessly recopied every run, forever.
- **R11 found a third fabricated branch on its first run, and the largest.**
  `claude/apple-clean-0816` is claimed by **eight rows** (M128, M129, M130,
  M132, M133, M135, M139, R28) and appears in no ref, reflog, commit message or
  merge subject. Tracing each 2026-08-16 commit to its merge shows the M-series
  work landed on `claude/active-state-model-0816` via PRs #51–#54, while R28
  came through #56 from `claude/h-03255-depth-0816`. **They do not share one
  answer**, so they were not rewritten here — that is a per-row evidence pass,
  and rewriting historical Notes on a guess is the exact failure this family is
  about. Deferred as **R35** with the evidence carried into it.

**The thirteen not started**, in the brief's order, each still carrying its
full spec on its row: R05 (map layer tests), R23 (Turbopack tracing), G04 (the
walk's probe counter — rows landed, not requests issued), the walk's
**check-identity set**, the reader-facing source name (`schedulepage` must
never reach a reader), M19 (overlapping pins), D19 (sitting-as attribution),
D18 (virtual meetings render as "online"), D24 (the 348 unmatched OCD
divisions), D31 (the identifier convention), M12 (the school overlay split),
D22 (the NovusAgenda adapter — **read the row's own correction first**, the
Vail tenant is an archive), and B01 (the interim rename to **Meanwhile** across
every on-site surface).

### Items 4–8 — not started, untouched

Item 4 (the ask surface, one build closing A01, A02, M119, A07, A06 and G05's
rule 4d), item 5 (G05's interface consolidation, rules 4a–4f and 4h), item 6
(G07, the pill label), item 7 (D35, the positions three-answer machinery), and
item 8 (sixteen "finish now" rows, M134 through M93).

Every one of these was deferred **whole**. None was started and abandoned, and
none has had its spec diluted. Their rows are unchanged and remain the
authority; this brief deliberately does not restate what a row already carries.

## What the next session should know before it starts

- **The disposition governs the brief.** Where `docs/deferred.csv` and a brief
  disagree, the author's disposition wins. Item 1 hit this twice.
- **`docs/deferred.csv` is the author's marked census and is NOT regenerated.**
  The refusal guard stands.
- **`.env.local` no longer carries `DATABASE_URL`.** That is deliberate and
  nothing in the app needs it. Do not "restore" it. If you need to read
  production for a census, use `WTP_PRODUCTION_DATABASE_URL_READONLY` and know
  that you are reading production.
- **The handoff now warns about `claude/apple-clean-0816` on every run.** That
  is R35 doing its job, not noise to suppress.
- **`walk:all` does not yet emit its check-identity set.** That sub-item was
  not reached, so comparisons are still integer subtraction and a lost check is
  still invisible by name.
