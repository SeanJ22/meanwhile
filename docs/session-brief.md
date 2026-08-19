# Session brief — written by g19, 2026-08-18

Read `CLAUDE.md` first. Everything below sits under it.

---

## What g19 was, in one line

The deferred queue and nothing but: ten items, **seven whole, one partial
(item 7), one not reached (item 8's three rows), and the queue re-measured**.
Shipped as `bcbe466`.

---

## THE FIRST INSTRUCTION, and g19 is the evidence for it

**Verify before building. Read the tree.**

Four of g19's ten items turned out to be largely or wholly built already, and
the brief described each as unbuilt — correctly, because a brief carries a
last-known reading and not a fact. What matters is what happened when one of
those readings was acted on without checking:

A resolver was written for B15 on the premise that votes-on-laws was unbuilt.
It was already 18 of 20. The resolver ran against the committed snapshot,
resolved the four April 2024 siblings to their Senate vehicle — which has no
House vote of its own — and **overwrote four verified House roll calls**.
House coverage fell 18 → 15 while the run printed *"18/20 carry at least one
roll call"*, which was true before and after, because the entries kept their
Senate refs. A `git diff` against `HEAD` in the same session is the only
reason it was caught.

Recorded as **D68**, mitigated three ways (a fill-only merge rule, a coverage
floor in `tests/key-votes.test.ts`, the stale docblock corrected) and NOT
closed, because the general shape is not specific to votes: **every fetch
script in `scripts/` that rewrites a committed artifact can do this, and most
report a total that stays flat while a component of it falls.**

If you take one thing from this brief: before running a script that rewrites
a committed artifact, read the artifact.

---

## Where the queue stands

`pnpm deferred` was re-run (it had not run since before g7 and described a
330-row tracker against 366).

* **366 tracker rows · 280 done or absorbed · 86 still open.**
* All **75** author dispositions survived the regeneration.
* The generator REFUSES to overwrite a CSV carrying dispositions, and it is
  right to — the tracker does not hold that column. The way past is to save
  the column, move the marked file aside as the gate instructs, regenerate,
  and put every ruling back, refusing to write if one cannot be placed. Do
  not add a flag to the gate.
* `docs/session-map.md` queues corrected: D50 and D03's three-state half moved
  from Queue 4 (H) to Queue 3 (pre-H); P06/P07/P08 tabled into Queue 6 with
  their "What do I do now?" consolidation attached; D47's status corrected off
  `Parked`. H03 was checked and was already right — its `H` is an ID prefix,
  not a queue, and that has now confused two briefs.

---

## What is genuinely open, in the order g19 would take it

1. **Item 8, untouched** — D62 (the Polarization Research Lab corpus), D05
   (candidate info), B14 (the blurb-equalization sweep, **101 of 136 ballot
   candidates carry no photo, blurb, contact or link**). Not started at all,
   so nothing is half-built. B14 is the largest hunt in the queue and the
   equal-effort rule makes it mandatory rather than nice-to-have.
2. **D52** (item 7b) — the state money-translation program, NH/AZ/NJ. Not
   reached. Its per-state mapping tables are **author-approved before any
   translation ships** and that gate has not moved.
3. **M95** (item 7c) — governors' term end and birth date. Rungs walked and
   recorded; **nothing written**, which is what the row requires when a rung
   fails. The next rungs are named in the row: the live browser on
   `nj.gov/governor/admin/about/`, and the Wayback snapshot of
   `governor.nh.gov` — confirmed available, taken 2026-06-16, because the live
   host 403s at every path tried.
4. **D03's real remainder is match depth**, not wiring: 130 officeholders
   matched of 638 people seen (AZ 24/92, NJ 21/120, NH 85/426). The three
   states serve; 80% of their legislators render our recorded gap.
5. **A03/A05 remainders** — A03 searches AGENDAS, which is where zoning and
   permit items surface but is not the permit record itself. A05's route and
   extraction ship; a reader-facing surface for meeting mode is not wired.

---

## Two things g19 did NOT do, stated so they are not discovered later

* **No new `walk:all` checks were added.** The suite only grows, and this
  session grew it by zero. Its two reader-facing additions are POST paths —
  free-text capture is a WRITE and belongs in the excluded-by-name list, and
  `/api/ask/agenda` is same-origin. Neither is a GET a walk can issue as it
  stands. This is a real gap in the regression net for item 2's and item 6's
  work, and it wants a row.
* **The client budget baseline discrepancy is unresolved.** g17 committed
  2,716,856 raw / 818,526 gzip; g18 measured 142 raw and 81 gzip lower. R53
  retiring gzip splitting explains a gzip change and not a raw-byte one. The
  committed baseline is deliberately NOT restated at the lower figure — see
  AUD09. Nothing is blocked by it; this session built at 2,727,315 / 821,848
  against a 3,027,315 / 940,032 ceiling.

---

## Standing constraints g19 operated under and did not touch

* **`outputs/` is off-limits.** Present in the working tree, untracked, never
  read, written, committed or counted. Every file count in g19's report
  excludes it and says so. Do not add it to `.gitignore`.
* **F01 is parked whole.** The feedback doc is out of the repo. Do not
  reconstruct it or open the Drive "Screenshots from Feedback" folder.
* **The organic census is closed as a question.** All organic rows are the
  author's. `search_log` organic is **107**. State it; do not reopen it.
* `context.md`'s cap is **40 KB**.
* Ceilings move only on proof, at most baseline +15%, never toward the cap.
* The one sanctioned write path is `WTP_PRODUCTION_DATABASE_URL_WRITE`.

---

## The playbook grew by seven entries

`docs/zip-playbook.md`, all from real walls this session:

1. Read the body's own AGENDA before the law that created it — with the two
   traps that come with it (a "current agenda" that is a cancellation notice,
   and an agenda item's timed DURATION mistaken for a per-speaker limit).
2. A path-scoped WAF: the root answers 200 and the deep link 403s. Re-enter at
   `/` and walk the site's own navigation. Read the redirect target of a
   refused URL — it names the vendor platform for free.
3. A New Jersey municipality's comment rule is in the CODE, not on its
   CivicPlus pages.
4. Widening a schedule grammar is how a body escapes a "publishes nothing"
   bucket — and a classification count is re-measured against today's parser,
   never inherited.
5. An index that carries IDs and no titles: searching its text is a false miss.
6. A bill folded into another appears in NO public-law list; read the
   vehicle's own related-bills record.
7. PDF agenda text: two extraction traps, plus the greedy-quantifier trap that
   parsed "October 2026" as day 20.

---

## Needs the author, carried forward

See g19's report for the full list. The two that block work:

* **D70's network clearance** — nothing runs until it is given.
* **D52's per-state mapping tables** — no translation ships without approval.
