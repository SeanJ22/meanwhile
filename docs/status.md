# Status — what each section delivers, and how far it is

**GENERATED FILE — do not hand-edit.** Written by `pnpm status:report`
(`scripts/status-report.mjs`) from `docs/tracker.csv`, in one pass.
Generated 2026-08-20 (America/Phoenix, from `pnpm stamp`).

A hand-maintained status page is a second tracker that disagrees with the
first, so nothing here is composed: every count is read, and the section a
row lands in is computed from the dependency graph rather than assigned.

**Sections come from dependencies; names come from what you get.** A section
is a set of rows where nothing inside it depends on anything in a later
section. The order is therefore not a judgement call. The names are, and they
answer *what does this deliver* rather than *what kind of work is it*.

---

## The whole tracker

- **454 rows** · **315 done** · **139 open** · **12 of the open ones blocked or parked**
- **10 OPEN P0** — the queue — of **93 P0 across all rows** (the rest have shipped)
- **7 sections** · **24 distinct Areas**

**P0 means: blocks a reader-visible outcome before 2026-11-03.** <!-- expected-future: US general polling day, the deadline this priority is defined against -->
(Adopted 2026-08-20, Prompt D item 4.) A row is P0 when a reader meets its
output on a surface, that surface is wrong, missing or unreachable until the
row closes, and it can land before polling day. Everything else is not P0
regardless of prior marking — real work, and no reader is blocked on it.
A priority field that marks three-quarters of a queue top priority sorts
nothing, which is what this definition exists to prevent.

**No row depends on anything in a later section.** The file reads front to back.

**No dangling dependency** — every `Depends on` points at a row that exists.

---

## Section 0 — Everything with no recorded prerequisite

**What you get:** NOT A DELIVERABLE, and named honestly rather than dressed as one. This is every row whose `Depends on` column is empty, which is most of the tracker — the column is sparse, so the graph cannot tell work that genuinely has no prerequisite from work whose prerequisite was never written down. See `R56`.

**246 rows** · **192 done** · **54 open** · **8 blocked or parked**

**Open P0 in this section (4):**

- `D07` — OCD-ID resolution layer *(Not started)*
- `D50` — Photos round 2 - door 2 opens and the chamber tier ships (item 6b) *(In progress)*
- `D68` — A data-fetch script overwrote verified data with less of it, and reported success *(Open)*
- `F01` — The author's 2026-08-18 testing pass: 40-odd findings across cards, meetings order, votes, the ask box, the ballot page and the map *(In progress)*

## Section 1 — The four pilot zips answer completely

**What you get:** A reader at 03255, 07866, 85641 or 85701 gets every body, every officeholder and every contest that place actually has — the depth sweeps, the blurb equalization, the state voting records and the funding surface all sit here.

**104 rows** · **55 done** · **49 open** · **0 blocked or parked**

**Open P0 in this section (3):**

- `HUNT01` — The 03255 depth sweep across the full body universe *(Not started)*
- `P02` — Ballot mapping *(In progress)*
- `P03` — Reaction capture *(In progress)*

## Section 2 — The bodies inside a government are known, not just the government

**What you get:** Tier 1 becomes Tier 2: enumeration per unit, the re-walk of every record written before the ladder existed, and the candidate sweep to Kelly depth. This is the step Census and NCES can never take for us.

**51 rows** · **31 done** · **20 open** · **2 blocked or parked**

**Open P0 in this section (3):**

- `HUNT02` — Body enumeration per unit - the missing second layer of the who-governs denominator *(Not started)*
- `HUNT04` — The 03255 candidate sweep - 47 candidacies to the Kelly standard *(Not started)*
- `T05` — Abuse policy live *(Open)*

## Section 3 — The hard territory resolves and the extractors exist

**What you get:** Special districts get territory, embedded-JSON pages give up their content, and the ask box answers the questions a reader actually arrives with.

**31 rows** · **21 done** · **10 open** · **2 blocked or parked**

_No open P0 in this section._

## Section 4 — The vendor layer is understood rather than guessed at

**What you get:** Vanity domains resolve to their tenants, the vendor review closes, and a new place's platform is identified rather than inferred.

**16 rows** · **10 done** · **6 open** · **0 blocked or parked**

_No open P0 in this section._

## Section 5 — The map's last dependent polish

**What you get:** Rendering work that waited on everything above it.

**3 rows** · **3 done** · **0 open** · **0 blocked or parked**

_No open P0 in this section._

## Section 6 — The deepest dependents

**What you get:** The tail of the graph — nothing depends on these.

**3 rows** · **3 done** · **0 open** · **0 blocked or parked**

_No open P0 in this section._

