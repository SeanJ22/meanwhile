# The close-out report contract

**Created 2026-08-22 (Discovery Conduct session, item 5).**

**What was expected here and was not:** the brief asked this session to *amend
the close-out contract template every hunt session uses*. **There was no such
template.** The contract has lived in each session's own brief, written fresh by
the chat every time — which is exactly why the figure that would have caught the
discovery failure (*what did you find that was not on the list*) had never
appeared in one. A contract that is rewritten every session cannot accumulate.
So the template is created here, and from now on it is amended rather than
reinvented.

---

## How to use this

Every hunt session's close-out report answers **every line below**. A brief may
add to it; a brief does not subtract from it.

**A report missing any required figure is INCOMPLETE, and the session says so
about itself.** That sentence is the whole enforcement mechanism: no gate can
read a chat message, so the honesty has to be the session's, and a session that
notices a missing figure and stays quiet has done the thing this file exists to
prevent.

Every figure is a NUMBER, and every number states its **denominator**. `N of M`,
never `N`. Where collection and rendering can differ, **both are stated as a
pair** and they reconcile — a single figure standing in front of two
measurements is a data-destruction pattern.

---

## 1. Per item, individually, by item number

For every numbered item in the brief: **done**, **partial** with exactly what
remains, or **not started** with why. No item is omitted and none is summarised
into a neighbour.

---

## 2. THE DISCOVERY FIGURES — required, and new as of 2026-08-22

These seven exist because nothing before them ever asked a session what it found
that was not on the list. RULING 88 makes the expansion section mandatory; these
are how it is counted.

| Figure | Form | Where the rule is |
|---|---|---|
| **Expansion routes conceived** | `N` | RULING 88 |
| **Expansion routes returning rows** | `N of N` | RULING 88 |
| **Expansion routes returning zero** | `N of N` | RULING 88 — **a route returning zero is a reported SUCCESS.** The invention is the deliverable, not the yield |
| **Stuck protocols run** | `N` | RULING 94 |
| **Fields returned to owed for a missing stuck protocol** | `N` | RULING 94 — an absence with no stuck-protocol block is void |
| **Credentials proven** | `N of M` | RULING 95 — proven by CALLING, via `pnpm credentials` |
| **Sources past expiry** | `N of M` | RULING 96 — 7 days for candidate fields, 14 for bodies and rosters, 14 for walled sources |

**The two that are most likely to be quietly skipped, named so they cannot be.**

- **Routes returning zero.** Every other figure in this project rewards rows
  found, so a session that invented four routes and got nothing from all four
  will be tempted to report the expansion section as empty. It is not empty. It
  is four successes with zero yield, and it reads that way.
- **Fields returned to owed.** This number going UP is the protocol working. A
  session reporting zero here on a run that recorded absences should check that
  it is not reporting zero because it never ran the protocol.

---

## 3. The expansion section itself

Not a count — the routes. For each route that did not exist at session start:

1. **How it was conceived** — the question or observation that led to it.
2. **The literal query or URL.** Not a description of the search. The text that
   was typed.
3. **What it returned, including zero.**
4. **Whether it generalises to a class of entities**, or reached only the one
   thing it was invented for.

**An empty expansion section fails the item** (RULING 88).

**A side quest is not expansion** (RULING 89). Expansion ends at a field the
item list already owes. A new capability, a new surface, new infrastructure, or
work on a zip that is not the current zip is a tracker row, and a session that
built one while citing RULING 88 reports the scope breach.

---

## 4. Founder finds

Where the author found a source, route or fact the sessions did not (RULING 97),
the report answers three questions:

1. **What procedure would have found this without him?**
2. **Why did that procedure not run?**
3. **What changed so it runs next time?**

Adding the find to the manifest and moving on is **not** an adequate answer.

---

## 5. Coverage and data figures

- **Collection against rendering, as a pair**, reconciled. 261 collected against
  0 rendering is why this rule exists.
- **Stated N equals rendered rows.** A count a surface states is the count of
  the rows that surface actually rendered, built from the same list in the same
  pass.
- **Class sweeps**: for every named defect, **count found and count fixed**. A
  named instance is an example of a class-wide defect; the named instance alone
  reported as closed is how a class defect survives the session that found it.
- **Owed fields**, `N of M`, per zip.
- **Screenshots**: `N of N read as images`, and for each one read, confirmation
  it showed what it claimed. A capture too large to read is **reported unread**
  — the item it belongs to is a boundary stop, not a finish (RULING 2).

---

## 6. Gates and shipping

- `test` pass / fail, `lint`, `tsc --noEmit`, `build` in both modes.
- **`pnpm main:green`** — the question only the server can answer. Four verdicts
  kept apart: green, red, pending, **could-not-tell** (RULING 24).
- **`pnpm walk:all`** against the deploy: passed, regressions **named with the
  session that shipped the claim**, and **could-not-run reported separately from
  failed**.
- **Rows this session wrote to production**, named individually — timestamp,
  target, and what it was proving. The walk's own rows count.
- **Code SHA and close-out record SHAs, stated separately and labelled**, so a
  reader can tell which commit changed what a reader sees.
- **Netlify deploy id**, confirmed against the live site.

---

## 7. Tracker

- **N rows opened**, with ids and sections.
- **N Needs Sean rows closed**, listed individually by id with the ruling number
  and shipping SHA that closed each (RULING 79). Rows that are genuinely his
  judgement and carry no ruling stay open and are named.
- **N open after, by section.**
- **His resolution notes**: what was read, and what was done about each. A
  **Conditionally resolved** row's condition is a live requirement — satisfied,
  or reported unsatisfied with the reason (RULING 38).

---

## 8. What was wrong

**Anything in the brief that turned out to be wrong against the repo, stated
plainly.** This line is not optional politeness. A brief is written from the
last session's report, so an error that goes uncorrected is an error the next
brief inherits — and this file exists because one did.

---

## 9. What is prohibited in a close-out report

- **"Nothing further."** And every polite form of it — *the manifest is
  exhausted*, *every route returned nothing*, *this appears to be genuinely
  unavailable*. The item fails (RULING 90).
- **A remaining-budget percentage.** That instrument was wrong every time and
  only gave sessions a number to stop on.
- **An asserted absence.** Absence is earned, dated, and carries its branches.
- **A green gate reported for a tree that no longer matches what is on the
  server** (RULING 75).
